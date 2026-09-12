import {
  InstancedMesh,
  InstancedBufferAttribute,
  Mesh,
  Object3D,
  Vector3,
  BoxGeometry,
  ConeGeometry,
  SphereGeometry,
  ShaderMaterial,
  Group,
  Color,
  AdditiveBlending,
  DoubleSide
} from 'three';
import { Ability, AbilityPhase } from './Ability.js';
import { ParticleShape } from '../particles/ParticleSystem.js';
import { RateEmitter } from '../particles/ParticleEngine.js';
import { DecalType } from '../effects/GroundDecals.js';
import { BurstMode } from '../effects/BurstSphere.js';
import { LAYER } from '../core/Layers.js';
import { frame } from '../core/FrameUniforms.js';
import { settings } from '../config/settings.js';
import { getColor } from '../utils/color.js';
import { saturate, lerp, Easing, randRange } from '../utils/math.js';

const MAX_SWORDS = 500;
const TAU = Math.PI * 2;

const _pos = new Vector3();
const _next = new Vector3();
const _center = new Vector3();
const _dir = new Vector3();
const _forward = new Vector3(0, 0, 1);
const _dummy = new Object3D();
const _emit = {};

/**
 * WANJIAN — 万剑归宗.
 *
 * The travel phase is a fixed-length sequence, not a distance-covering front:
 *
 *   0.0 ─ 2.6s   the swarm converges
 *   2.6 ─ 3.2s   the blades fuse into the core (they scale to zero)
 *   2.8 ─ 3.4s   the giant sword forms above the impact point
 *   3.4 ─ 4.0s   it charges, pulsing and lit from within
 *   4.0 ─ 4.25s  it falls
 *   4.25s        impact — burst, fissures, shockwave, flash, shake
 *
 * Everything is driven off `this.age`; the base class's `advance()` is
 * overridden so `u` climbs linearly against `travelDuration` regardless of
 * how far the player actually cast. A cast captures only dice (per-sword
 * spiral parameters), never a metre or a second.
 */
export class WanjianAbility extends Ability {
  constructor(context) {
    super('wanjian', context);
  }

  /* ------------------------------------------------------------------ */
  /* Construction                                                        */
  /* ------------------------------------------------------------------ */

  createShaders() {
    /* --- 500 blades --- */
    this.swordGeometry = new BoxGeometry(0.05, 0.02, 1.0);
    this.swordGeometry.translate(0, 0, 0.55);

    this.swordSeeds = new InstancedBufferAttribute(new Float32Array(MAX_SWORDS), 1);
    this.swordGeometry.setAttribute('aSeed', this.swordSeeds);

    this.swordMaterial = this._buildSwordMaterial();

    this.swords = new InstancedMesh(this.swordGeometry, this.swordMaterial, MAX_SWORDS);
    this.swords.frustumCulled = false;
    this.swords.count = 0;
    this.swords.layers.set(LAYER.VFX);
    this.swords.renderOrder = 11;
    this.group.add(this.swords);

    /* --- the giant sword --- */
    this.giantMaterial = this._buildGiantMaterial();
    this.giant = new Group();
    this.giant.rotation.x = Math.PI / 2; // tip (+Z) → -Y, i.e. down
    this.giant.visible = false;
    this.group.add(this.giant);

    const blade = new Mesh(
      new BoxGeometry(
        settings.wanjian.giantBladeWidth,
        settings.wanjian.giantBladeWidth * 0.28,
        settings.wanjian.giantBladeLength
      ),
      this.giantMaterial
    );
    blade.position.z = settings.wanjian.giantBladeLength * 0.5;
    this.giant.add(blade);

    const tip = new Mesh(new ConeGeometry(0.42, 1.6, 4), this.giantMaterial);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = settings.wanjian.giantBladeLength + 0.6;
    this.giant.add(tip);

    const guard = new Mesh(new BoxGeometry(2.4, 0.35, 0.4), this.giantMaterial);
    guard.position.z = 0.1;
    this.giant.add(guard);

    const hilt = new Mesh(new BoxGeometry(0.45, 0.45, 1.8), this.giantMaterial);
    hilt.position.z = -0.8;
    this.giant.add(hilt);

    /* --- core orb (the fusion point) --- */
    this.coreMaterial = this._buildCoreMaterial();
    this.core = new Mesh(new SphereGeometry(1.0, 24, 24), this.coreMaterial);
    this.core.visible = false;
    this.core.layers.set(LAYER.VFX);
    this.core.renderOrder = 11;
    this.group.add(this.core);

    /* --- dice pool (fixed-size, zero allocations at cast time) --- */
    this.records = [];
    for (let i = 0; i < MAX_SWORDS; i++) {
      this.records.push({
        theta0: 0, radius0: 0, y0: 0, delay: 0, duration: 0,
        turns: 0, waveAmp: 0, scaleJit: 0
      });
    }
    this._count = 0;
  }

  _buildSwordMaterial() {
    return new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new Color(settings.wanjian.swordColorA) },
        uColorB: { value: new Color(settings.wanjian.swordColorB) },
        uCore: { value: new Color(settings.wanjian.swordCoreColor) },
        uFresnel: { value: settings.wanjian.swordFresnel }
      },
      vertexShader: `
        attribute float aSeed;
        varying float vSeed;
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        void main() {
          vSeed = aSeed;
          vec4 localPos = vec4(position, 1.0);
          vec3 localNrm = normal;
          #ifdef USE_INSTANCING
            localPos = instanceMatrix * localPos;
            localNrm = mat3(instanceMatrix) * localNrm;
          #endif
          vec4 worldPos = modelMatrix * localPos;
          vWorldPos = worldPos.xyz;
          vNormalW = normalize(mat3(modelMatrix) * localNrm);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uCore;
        uniform float uFresnel;
        varying float vSeed;
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        void main() {
          float f = pow(1.0 - max(0.0, dot(vNormalW, vViewDir)), 1.5);
          float flow = sin(vWorldPos.y * 8.0 - uTime * 6.0 + vSeed * TAU) * 0.5 + 0.5;
          vec3 col = mix(uColorA, uColorB, f * 0.7);
          col = mix(col, uCore, flow * 0.4 * (0.5 + vSeed * 0.5));
          float glow = 1.2 + f * uFresnel + flow * 0.6;
          gl_FragColor = vec4(col * glow, 1.0);
        }
      `.replace('TAU', '6.2831853'),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false
    });
  }

  _buildGiantMaterial() {
    return new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCharge: { value: 0 },
        uHit: { value: 0 },
        uColor: { value: new Color(settings.wanjian.giantColor) },
        uEdge: { value: new Color(settings.wanjian.giantEdgeColor) },
        uHot: { value: new Color(settings.wanjian.giantHotColor) }
      },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vL;
        void main() {
          vL = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uCharge;
        uniform float uHit;
        uniform vec3 uColor;
        uniform vec3 uEdge;
        uniform vec3 uHot;
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vL;
        void main() {
          float fres = pow(1.0 - max(0.0, dot(vN, vV)), 1.8);
          float flow = sin(vL.z * 3.5 - uTime * 10.0) * 0.5 + 0.5;
          float pulse = (sin(uTime * 18.0) * 0.5 + 0.5) * uCharge;
          vec3 col = mix(uColor, uEdge, fres * 0.6 + flow * 0.3);
          col = mix(col, uHot, uCharge * 0.4 + uHit * 0.7);
          float glow = 1.4 + fres * 2.0 + pulse * 1.4 + uHit * 4.0;
          gl_FragColor = vec4(col * glow, 1.0);
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false
    });
  }

  _buildCoreMaterial() {
    return new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uColor: { value: new Color(settings.wanjian.swordCoreColor) }
      },
      vertexShader: `
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec3 uColor;
        varying vec3 vN;
        varying vec3 vV;
        void main() {
          float fres = pow(1.0 - max(0.0, dot(vN, vV)), 2.0);
          float pulse = sin(uTime * 12.0) * 0.5 + 0.5;
          vec3 col = uColor * (0.8 + fres * 2.0 + pulse * 0.6);
          gl_FragColor = vec4(col, uIntensity * (0.4 + fres * 0.6));
        }
      `,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
  }

  createParticles() {
    const particles = this.ctx.particles;

    this.sparks = particles.get('wanjian.sparks', {
      capacity: 3000,
      shape: ParticleShape.STREAK,
      additive: true,
      stretch: true,
      softFade: 0.25
    });
    this.sparks.uniforms.uDrag.value = 0.7;
    this.sparks.uniforms.uEndSize.value = 0.22;
    this.sparks.uniforms.uSizeIn.value = 0.02;
    this.sparks.uniforms.uFadeOut.value = 0.5;

    this.motes = particles.get('wanjian.motes', {
      capacity: 2600,
      shape: ParticleShape.SOFT,
      additive: true,
      curl: true,
      softFade: 0.4
    });
    this.motes.uniforms.uDrag.value = 1.2;
    this.motes.uniforms.uEndSize.value = 0.05;
    this.motes.uniforms.uSizeIn.value = 0.04;

    this.smoke = particles.get('wanjian.smoke', {
      capacity: 2000,
      shape: ParticleShape.SMOKE,
      additive: false,
      curl: true,
      softFade: 1.2
    });
    this.smoke.uniforms.uDrag.value = 1.7;
    this.smoke.uniforms.uEndSize.value = 3.4;

    this.debris = particles.get('wanjian.debris', {
      capacity: 1400,
      shape: ParticleShape.CHIP,
      additive: false,
      lit: true,
      softFade: 0.25
    });
    this.debris.uniforms.uDrag.value = 0.25;
    this.debris.uniforms.uGravity.value.set(0, settings.wanjian.debrisGravity, 0);

    this.sparkEmitter = new RateEmitter();
    this.moteEmitter = new RateEmitter();
    this.smokeEmitter = new RateEmitter();
  }

  /* ------------------------------------------------------------------ */
  /* Timing                                                              */
  /* ------------------------------------------------------------------ */

  get impactDuration() {
    return Math.max(0.2, settings.wanjian.impactDuration);
  }

  get fadeDuration() {
    return Math.max(0.2, settings.wanjian.fadeDuration);
  }

  get instanceCount() {
    return this._count;
  }

  lightShimmer() {
    const c = settings.wanjian;
    const rate = Math.max(0.1, c.lightFlickerSpeed);
    const wobble = Math.sin(this.age * rate) * Math.sin(this.age * rate * 0.37 + 1.7);
    return 1 - saturate(c.lightFlicker) * (0.5 + 0.5 * wobble);
  }

  /**
   * Travel is a fixed duration, not a distance. `speed` from the base class
   * would compress the sub-beats whenever the player casts short — so we
   * ignore it and climb `u` linearly against `travelDuration`.
   */
  advance(dt) {
    const duration = Math.max(0.5, settings.wanjian.travelDuration);
    const easeIn = Easing.outQuad(saturate(this.age / 0.08));
    this.front += (this.length / duration) * easeIn * dt;
    const previousU = this.u;
    this.u = saturate(this.front / this.length);
    this.pointAt(this.u, this.position);
    return this.u >= 1 && previousU < 1;
  }

  /* ------------------------------------------------------------------ */
  /* Casting                                                             */
  /* ------------------------------------------------------------------ */

  onSpawn() {
    const c = settings.wanjian;

    this.sparkEmitter.reset();
    this.moteEmitter.reset();
    this.smokeEmitter.reset();

    this._count = Math.min(MAX_SWORDS, Math.max(1, Math.round(c.swordCount)));

    // The only dice rolled: one per sword. No metres, no seconds — those
    // resolve against settings each frame (see the class comment).
    for (let i = 0; i < this._count; i++) {
      const r = this.records[i];
      r.theta0 = Math.random() * TAU;
      r.radius0 = randRange(c.spawnRadiusMin, c.spawnRadiusMax);
      r.y0 = randRange(-c.spawnYSpread * 0.5, c.spawnYSpread * 0.5);
      r.delay = Math.random() * 0.6;
      r.duration = randRange(1.4, 2.4);
      r.turns = randRange(c.turnsMin, c.turnsMax);
      r.waveAmp = randRange(c.yWaveAmp * 0.5, c.yWaveAmp);
      r.scaleJit = randRange(0.7, 1.3);
      this.swordSeeds.array[i] = Math.random();
    }
    for (let i = this._count; i < MAX_SWORDS; i++) {
      this.swordSeeds.array[i] = 0;
    }
    this.swordSeeds.needsUpdate = true;
    this.swords.count = 0;

    this.giant.visible = false;
    this.giant.scale.setScalar(0.001);
    this.giant.position.set(0, c.giantStartY, 0);

    this.core.visible = false;
    this.core.scale.setScalar(0.001);
    this.coreMaterial.uniforms.uIntensity.value = 0;

    this._launchFx();
  }

  /* ------------------------------------------------------------------ */
  /* Per-frame                                                           */
  /* ------------------------------------------------------------------ */

  _convergeCenter(out) {
    const c = settings.wanjian;
    this.pointAt(1, out);
    out.y = c.convergeHeight;
    return out;
  }

  _updateSwords() {
    const c = settings.wanjian;
    const age = this.age;
    const convergeEnd = c.swordConvergeEnd;
    const fuseEnd = c.swordFuseEnd;

    this._convergeCenter(_center);

    // Fuse: from convergeEnd the blades shrink toward the core.
    let fuse = 1.0;
    if (age > convergeEnd) {
      fuse = saturate(1 - (age - convergeEnd) / Math.max(0.1, fuseEnd - convergeEnd));
    }

    let active = 0;
    for (let i = 0; i < this._count; i++) {
      const r = this.records[i];
      const p = (age - r.delay) / Math.max(0.1, r.duration);

      if (p <= 0 || p >= 1 || fuse <= 0) {
        _dummy.position.set(0, -9999, 0);
        _dummy.quaternion.identity();
        _dummy.scale.setScalar(0.0001);
        _dummy.updateMatrix();
        this.swords.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      const eR = Easing.inQuint(p);
      const eA = Easing.inOutCubic(p);
      const radius = r.radius0 * (1 - eR);
      const theta = r.theta0 + r.turns * TAU * eA;
      const yWave = Math.sin(p * Math.PI * 5 + r.theta0) * r.waveAmp * (1 - p);
      const y = _center.y + r.y0 * (1 - eA) + yWave;
      const x = _center.x + radius * Math.cos(theta);
      const z = _center.z + radius * Math.sin(theta);
      _pos.set(x, y, z);

      // Heading: look toward the next sample along the spiral.
      const p2 = Math.min(1, p + 0.01);
      const eR2 = Easing.inQuint(p2);
      const eA2 = Easing.inOutCubic(p2);
      const radius2 = r.radius0 * (1 - eR2);
      const theta2 = r.theta0 + r.turns * TAU * eA2;
      const y2 = _center.y + r.y0 * (1 - eA2)
        + Math.sin(p2 * Math.PI * 5 + r.theta0) * r.waveAmp * (1 - p2);
      _next.set(
        _center.x + radius2 * Math.cos(theta2),
        y2,
        _center.z + radius2 * Math.sin(theta2)
      );
      _dir.subVectors(_next, _pos);
      if (_dir.lengthSq() < 1e-8) _dir.set(0, -1, 0);
      _dir.normalize();

      _dummy.position.copy(_pos);
      _dummy.quaternion.setFromUnitVectors(_forward, _dir);
      const s = c.swordScale * r.scaleJit * Math.min(1, p * 10) * fuse;
      _dummy.scale.setScalar(s);
      _dummy.updateMatrix();
      this.swords.setMatrixAt(i, _dummy.matrix);
      active++;
    }

    this.swords.count = this._count;
    this.swords.instanceMatrix.needsUpdate = true;
    this._count_active = active;
  }

  _updateGiant() {
    const c = settings.wanjian;
    const age = this.age;

    if (age < c.giantFormStart) {
      this.giant.visible = false;
      this.core.visible = false;
      return;
    }

    this._convergeCenter(_center);

    if (age < c.giantFormEnd) {
      // Forming: scale from 0 → 1.
      const p = saturate((age - c.giantFormStart) / Math.max(0.05, c.giantFormEnd - c.giantFormStart));
      this.giant.visible = true;
      this.giant.scale.setScalar(Easing.outCubic(p));
      this.giant.position.set(_center.x, c.giantStartY, _center.z);
      this.giantMaterial.uniforms.uCharge.value = 0;
      this.giantMaterial.uniforms.uHit.value = 0;
      this.core.visible = true;
      this.core.position.set(_center.x, c.giantStartY, _center.z);
      this.core.scale.setScalar(0.5 + Easing.outCubic(p) * 1.6);
      this.coreMaterial.uniforms.uIntensity.value = Easing.outCubic(p);
      return;
    }

    if (age < c.giantChargeEnd) {
      // Charging: full size, pulsing.
      const p = saturate((age - c.giantFormEnd) / Math.max(0.05, c.giantChargeEnd - c.giantFormEnd));
      this.giant.visible = true;
      this.giant.scale.setScalar(1);
      this.giant.position.set(_center.x, c.giantStartY, _center.z);
      this.giant.rotation.y = this.age * c.giantChargeSpin;
      this.giantMaterial.uniforms.uCharge.value = Easing.inOutCubic(p);
      this.giantMaterial.uniforms.uHit.value = 0;
      this.core.visible = true;
      this.core.position.set(_center.x, c.giantStartY, _center.z);
      this.core.scale.setScalar(2.2 + Math.sin(this.age * 8) * 0.25);
      this.coreMaterial.uniforms.uIntensity.value = 1;
      return;
    }

    // Strike.
    const strikeStart = c.giantChargeEnd;
    const strikeEnd = Math.max(strikeStart + 0.05, c.strikeEnd);
    const p = saturate((age - strikeStart) / (strikeEnd - strikeStart));
    const e = p * p * p;
    this.giant.visible = true;
    this.giant.scale.setScalar(1);
    this.giant.rotation.y = this.age * c.giantChargeSpin;
    this.giant.position.set(
      _center.x,
      lerp(c.giantStartY, c.giantHitY, e),
      _center.z
    );
    this.giantMaterial.uniforms.uCharge.value = 1;
    this.giantMaterial.uniforms.uHit.value = 0;
    // Core dissolves into the strike.
    this.core.visible = p < 0.4;
    this.coreMaterial.uniforms.uIntensity.value = Math.max(0, 1 - p * 2.5);
  }

  _updateParticles(dt, mode) {
    const c = settings.wanjian;
    const g = settings.global;
    const time = frame.uTime.value;

    this._convergeCenter(_center);
    this.pointAt(1, _pos);

    // --- sparks ---
    const sparkCount = Math.round(this.sparkEmitter.tick(dt, c.sparkRate * (mode === 'hold' ? 0.5 : 1)) * g.particleCount);
    if (sparkCount > 0) {
      _emit.position = _pos.clone().setY(0.5);
      _emit.radius = c.shockRadius * 0.5;
      _emit.direction = _dir.set(0, 1, 0);
      _emit.speed = c.sparkSpeed;
      _emit.speedVariance = 0.8;
      _emit.spread = 0.95;
      _emit.inherit = null;
      _emit.anchor = null;
      _emit.size = c.sparkSize;
      _emit.sizeVariance = 0.7;
      _emit.life = c.sparkLifetime;
      _emit.lifeVariance = 0.5;
      _emit.spin = 0;
      _emit.tint = null;
      _emit.time = time;
      this.sparks.emit(sparkCount, _emit);
    }

    // --- motes ---
    const moteCount = Math.round(this.moteEmitter.tick(dt, c.moteRate) * g.particleCount);
    if (moteCount > 0) {
      _emit.position = _pos.clone().setY(1.0);
      _emit.radius = c.shockRadius * 0.7;
      _emit.direction = _dir.set(0, 1, 0);
      _emit.speed = c.moteSpeed;
      _emit.speedVariance = 0.6;
      _emit.spread = 0.9;
      _emit.size = c.moteSize;
      _emit.sizeVariance = 0.6;
      _emit.life = c.moteLifetime;
      _emit.lifeVariance = 0.45;
      this.motes.emit(moteCount, _emit);
    }

    // --- smoke ---
    const smokeCount = Math.round(this.smokeEmitter.tick(dt, c.smokeRate * (mode === 'hold' ? 0.7 : 1)) * g.particleCount);
    if (smokeCount > 0) {
      _emit.position = _pos.clone().setY(0.3);
      _emit.radius = c.scorchRadius * 1.1;
      _emit.direction = _dir.set(0, 1, 0);
      _emit.speed = c.smokeSpeed;
      _emit.speedVariance = 0.6;
      _emit.spread = 0.85;
      _emit.size = c.smokeSize;
      _emit.sizeVariance = 0.5;
      _emit.life = c.smokeLifetime;
      _emit.lifeVariance = 0.4;
      _emit.spin = 0.5;
      this.smoke.emit(smokeCount, _emit);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Phase hooks                                                         */
  /* ------------------------------------------------------------------ */

  onTravel(dt) {
    const c = settings.wanjian;
    const g = settings.global;
    const time = frame.uTime.value;

    // Keep the light up at the convergence point.
    this._convergeCenter(this.position);

    // Sync live uniforms.
    this.swordMaterial.uniforms.uTime.value = this.age;
    this.swordMaterial.uniforms.uColorA.value.copy(getColor(c.swordColorA));
    this.swordMaterial.uniforms.uColorB.value.copy(getColor(c.swordColorB));
    this.giantMaterial.uniforms.uTime.value = this.age;
    this.giantMaterial.uniforms.uColor.value.copy(getColor(c.giantColor));
    this.giantMaterial.uniforms.uEdge.value.copy(getColor(c.giantEdgeColor));
    this.giantMaterial.uniforms.uHot.value.copy(getColor(c.giantHotColor));
    this.coreMaterial.uniforms.uTime.value = this.age;

    this._updateSwords();
    this._updateGiant();
    this._updateParticles(dt, 'converge');
    this._syncParticleGradients();

    // Cast flash + rumble once.
    if (!this._castFlashFired && this.age > 0.05) {
      this._castFlashFired = true;
      this.ctx.flash.trigger(getColor(c.colorCastFlash), c.castFlash * g.explosionIntensity);
      this.lightBoost = c.lightIntensity * 0.5 * g.explosionIntensity;
    }

    this.ctx.shake.rumble(c.rumble * g.cameraShake, dt);
  }

  onImpact() {
    const c = settings.wanjian;
    const g = settings.global;
    const time = frame.uTime.value;
    const scale = c.burstSize * g.explosionIntensity;

    this.pointAt(1, _pos);
    _pos.y = 1.0;

    /* --- core shell --- */
    this.ctx.bursts.spawn(BurstMode.FIRE, _pos, {
      radius: scale * 0.15,
      endRadius: scale,
      life: 0.9,
      intensity: c.burstIntensity,
      opacity: 0.95,
      fresnel: 1.1,
      displace: 0.5,
      turbulence: 1.4,
      colorA: getColor(c.colorBurstC),
      colorB: getColor(c.colorBurstA),
      colorC: getColor(c.colorBurstB)
    });

    /* --- shockwave --- */
    this.ctx.decals.spawn(DecalType.SHOCKWAVE, _pos, {
      radius: c.shockRadius * g.explosionIntensity,
      life: 0.7,
      width: 0.09,
      intensity: 1.2,
      colorA: getColor(c.colorShockA),
      colorB: getColor(c.colorShockB)
    });

    /* --- fissures --- */
    this.ctx.fissures.spawn(_pos, {
      radius: c.fissureRadius * g.explosionIntensity,
      life: c.fissureLife
    });

    /* --- scorch --- */
    this.ctx.decals.spawn(DecalType.SCORCH, _pos, {
      radius: c.scorchRadius * g.explosionIntensity,
      life: c.scorchLife,
      intensity: c.scorchIntensity,
      colorA: getColor(c.colorScorch),
      colorB: getColor(c.colorShockA),
      height: 0.015
    });

    /* --- particle burst --- */
    _emit.position = _pos.clone().setY(0.6);
    _emit.radius = scale * 0.2;
    _emit.direction = _dir.set(0, 0.7, 0);
    _emit.speed = c.sparkSpeed * 2.4;
    _emit.speedVariance = 0.85;
    _emit.spread = 1.0;
    _emit.inherit = null;
    _emit.anchor = null;
    _emit.size = c.sparkSize * 1.4;
    _emit.sizeVariance = 0.7;
    _emit.life = c.sparkLifetime * 1.6;
    _emit.lifeVariance = 0.55;
    _emit.spin = 0;
    _emit.tint = null;
    _emit.time = time;
    this.sparks.emit(Math.round(c.burstSparks * g.particleCount), _emit);

    _emit.speed = c.moteSpeed * 2.6;
    _emit.size = c.moteSize * 1.4;
    _emit.life = c.moteLifetime * 1.4;
    this.motes.emit(Math.round(c.burstMotes * g.particleCount), _emit);

    _emit.position = _pos.clone().setY(0.35);
    _emit.radius = c.scorchRadius * 0.8;
    _emit.direction = _dir.set(0, 1, 0);
    _emit.speed = c.debrisSpeed;
    _emit.speedVariance = 0.75;
    _emit.spread = 0.9;
    _emit.size = c.debrisSize * 1.4;
    _emit.life = c.debrisLifetime;
    _emit.spin = 9;
    this.debris.emit(Math.round(c.burstDebris * g.particleCount), _emit);

    _emit.speed = c.smokeSpeed * 2.4;
    _emit.spread = 1.0;
    _emit.size = c.smokeSize * 1.6;
    _emit.sizeVariance = 0.5;
    _emit.life = c.smokeLifetime * 1.6;
    _emit.spin = 0.6;
    this.smoke.emit(Math.round(c.smokeRate * 2 * g.particleCount), _emit);

    /* --- feedback --- */
    this.ctx.shake.add(
      c.impactShake * g.explosionIntensity * g.cameraShake,
      1 / Math.max(0.1, c.shakeDuration),
      22
    );
    this.ctx.flash.trigger(getColor(c.colorFlash), c.impactFlash * g.explosionIntensity);
    this.lightBoost = c.lightIntensity * 2.6 * g.explosionIntensity;
  }

  onFade(dt, t) {
    const c = settings.wanjian;
    const g = settings.global;

    // The giant sword sinks a touch and cools.
    this.pointAt(1, _center);
    this.giant.position.set(_center.x, c.giantHitY - Math.min(0.6, this.impactTime * 1.5), _center.z);
    this.giantMaterial.uniforms.uHit.value = Math.max(0, 1 - this.impactTime * 3);

    // Dissolve during the fade phase (t ≥ 1).
    if (t > 1) {
      const p = saturate(t - 1);
      this.giant.scale.setScalar(1 - p * 0.6);
      this.giantMaterial.opacity = 1 - p;
      this.giantMaterial.transparent = true;
      if (p >= 1) this.giant.visible = false;
    }

    this._updateParticles(dt, 'hold');
    this._syncParticleGradients();

    // Cooldown the shake / light is handled by base.
  }

  /** Push every live setting into the particle systems — nothing captures at spawn. */
  _syncParticleGradients() {
    const c = settings.wanjian;
    const g = settings.global;

    this.sparks.setGradient(
      getColor(c.colorSparkA), getColor(c.colorSparkB),
      getColor(c.colorSparkC), getColor(c.colorSparkD)
    );
    this.sparks.uniforms.uGravity.value.set(0, c.sparkGravity, 0);
    this.sparks.uniforms.uSizeScale.value = c.sparkSize * g.particleSize * 7;
    this.sparks.uniforms.uLifeScale.value = c.sparkLifetime * 0.5 * g.particleLifetime;
    this.sparks.uniforms.uSpeedScale.value = g.particleSpeed;
    this.sparks.uniforms.uOpacity.value = g.opacity;
    this.sparks.uniforms.uStretch.value = c.sparkStretch;

    this.motes.setGradient(
      getColor(c.colorMoteA), getColor(c.colorMoteB),
      getColor(c.colorMoteC), getColor(c.colorMoteD)
    );
    this.motes.uniforms.uGravity.value.set(0, c.moteRise, 0);
    this.motes.uniforms.uSizeScale.value = c.moteSize * g.particleSize * 7;
    this.motes.uniforms.uLifeScale.value = c.moteLifetime * 0.5 * g.particleLifetime;
    this.motes.uniforms.uSpeedScale.value = g.particleSpeed;
    this.motes.uniforms.uOpacity.value = g.opacity;
    this.motes.uniforms.uTurbulence.value = c.moteTurbulence * g.turbulence;

    this.smoke.setGradient(
      getColor(c.colorSmokeA), getColor(c.colorSmokeB),
      getColor(c.colorSmokeC), getColor(c.colorSmokeD)
    );
    this.smoke.uniforms.uGravity.value.set(0, c.smokeRise, 0);
    this.smoke.uniforms.uSizeScale.value = c.smokeSize * g.particleSize;
    this.smoke.uniforms.uLifeScale.value = c.smokeLifetime * 0.5 * g.particleLifetime;
    this.smoke.uniforms.uSpeedScale.value = c.smokeSpeed * g.particleSpeed;
    this.smoke.uniforms.uOpacity.value = c.smokeOpacity * g.opacity;
    this.smoke.uniforms.uTurbulence.value = 0.45 * g.turbulence;

    this.debris.setGradient(
      getColor(c.colorDebrisA), getColor(c.colorDebrisB),
      getColor(c.colorDebrisC), getColor(c.colorDebrisD)
    );
    this.debris.uniforms.uGravity.value.set(0, c.debrisGravity, 0);
    this.debris.uniforms.uSizeScale.value = c.debrisSize * g.particleSize * 7;
    this.debris.uniforms.uLifeScale.value = g.particleLifetime;
    this.debris.uniforms.uSpeedScale.value = g.particleSpeed;
    this.debris.uniforms.uOpacity.value = g.opacity;
  }

  _launchFx() {
    this._castFlashFired = false;
    this._count_active = 0;
    this.swords.count = 0;
    this.giant.visible = false;
    this.core.visible = false;
  }

  onDestroy() {
    this._count = 0;
    this._count_active = 0;
    this.swords.count = 0;
    this.giant.visible = false;
    this.core.visible = false;
  }

  dispose() {
    this.swordGeometry.dispose();
    this.swordMaterial.dispose();
    this.giantMaterial.dispose();
    this.coreMaterial.dispose();
    this.giant.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.core.geometry.dispose();
    this.swords.dispose();
    super.dispose();
  }
}