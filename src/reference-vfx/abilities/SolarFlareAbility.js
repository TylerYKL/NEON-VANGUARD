import { Vector3 } from 'three';
import { Ability } from './Ability.js';
import { ParticleShape } from '../particles/ParticleSystem.js';
import { RateEmitter } from '../particles/ParticleEngine.js';
import { BurstMode } from '../effects/BurstSphere.js';
import { DecalType } from '../effects/GroundDecals.js';
import { frame } from '../core/FrameUniforms.js';
import { getColor } from '../utils/color.js';

const _emit = {};
const _up = new Vector3(0, 1, 0);

/**
 * Solar Flare is the first manifest-backed ability made playable end to end.
 *
 * The JSON manifest describes the contract, but this class owns the safe,
 * pooled implementation. It fires a warm line of sparks, blooms a shader-first
 * burst and leaves a paired scorch/shockwave decal at impact. Gameplay damage
 * and burn are released by heroes.js at the same reference impact phase.
 */
export class SolarFlareAbility extends Ability {
  constructor(context) {
    super('solar', context);
    this.impact = new Vector3();
    this.sparkEmitter = new RateEmitter();
  }

  /** Solar Flare uses the shared burst/decal shader pools. */
  createShaders() {}

  createParticles() {
    this.sparks = this.ctx.particles.get('solar.sparks', {
      capacity: 3200,
      shape: ParticleShape.STREAK,
      additive: true,
      stretch: true,
      softFade: 0.24
    });
    this.sparks.uniforms.uEndSize.value = 0.12;
    this.sparks.uniforms.uSizeIn.value = 0.025;
    this.sparks.uniforms.uFadeIn.value = 0.04;
    this.sparks.uniforms.uFadeOut.value = 0.42;
  }

  get impactDuration() {
    return Math.max(0.12, this.config.impactDuration);
  }

  get fadeDuration() {
    return Math.max(0.12, this.config.fadeDuration);
  }

  lightShimmer() {
    return 0.88 + 0.12 * Math.sin(this.age * 8.5) * Math.sin(this.age * 3.1);
  }

  onSpawn() {
    this.sparkEmitter.reset();
    this.impact.copy(this.origin);
    const c = this.config;
    this.sparks.uniforms.uColor0.value.copy(getColor(c.colorCore));
    this.sparks.uniforms.uColor1.value.copy(getColor(c.colorEdge));
    this.sparks.uniforms.uColor2.value.copy(getColor(c.colorSmoke));
    this.sparks.uniforms.uColor3.value.copy(getColor(c.colorSmoke));
  }

  onTravel(dt) {
    const count = this.sparkEmitter.tick(dt, this.config.sparkRate);
    if (count <= 0) return;

    _emit.position = this.position;
    _emit.radius = 0.12;
    _emit.direction = this.direction;
    _emit.speed = this.config.sparkSpeed;
    _emit.speedVariance = 0.7;
    _emit.spread = 0.38;
    _emit.inherit = null;
    _emit.size = 0.11;
    _emit.sizeVariance = 0.5;
    _emit.life = this.config.sparkLifetime;
    _emit.lifeVariance = 0.35;
    _emit.spin = 0;
    _emit.tint = null;
    _emit.time = frame.uTime.value;
    this.sparks.emit(count, _emit);
  }

  onImpact() {
    const c = this.config;
    this.impact.copy(this.position);

    this.ctx.bursts.spawn(BurstMode.FIRE, this.impact, {
      radius: 0.35,
      endRadius: c.impactRadius * 1.8,
      life: this.impactDuration,
      intensity: 1.5,
      opacity: 1,
      fresnel: 1.8,
      displace: 0.28,
      turbulence: 1.2,
      colorA: getColor(c.colorCore),
      colorB: getColor(c.colorEdge),
      colorC: getColor(c.colorSmoke),
      squash: 0.7
    });
    this.ctx.decals.spawn(DecalType.SCORCH, this.impact, {
      radius: c.impactRadius,
      life: this.impactDuration + this.fadeDuration,
      colorA: getColor(c.colorEdge),
      colorB: getColor(c.colorCore),
      intensity: 1.4,
      width: 0.18,
      growth: 0.35,
      height: 0.025
    });
    this.ctx.decals.spawn(DecalType.SHOCKWAVE, this.impact, {
      radius: c.impactRadius * 1.2,
      life: this.fadeDuration,
      colorA: getColor(c.colorCore),
      colorB: getColor(c.colorEdge),
      intensity: 1.2,
      width: 0.1,
      growth: 0.6,
      height: 0.03
    });

    this.lightBoost = c.lightIntensity * 0.8;
    this.ctx.flash.trigger(getColor(c.colorCore), c.castFlash);
  }

  onFade(_dt, phase) {
    // Keep a small warm mote trail during the bloom/fade without allocating a
    // second system. The impact burst and decals own their own pooled lifetimes.
    if (phase <= 1) {
      const count = this.sparkEmitter.tick(_dt, this.config.sparkRate * 0.35);
      if (count > 0) {
        _emit.position = this.impact;
        _emit.radius = this.config.impactRadius * 0.6;
        _emit.direction = _up;
        _emit.speed = this.config.sparkSpeed * 0.5;
        _emit.speedVariance = 0.8;
        _emit.spread = 0.95;
        _emit.size = 0.08;
        _emit.sizeVariance = 0.65;
        _emit.life = this.config.sparkLifetime;
        _emit.lifeVariance = 0.5;
        _emit.spin = 1;
        _emit.time = frame.uTime.value;
        this.sparks.emit(count, _emit);
      }
    }
  }

  onDestroy() {
    this.sparkEmitter.reset();
    this.impact.set(0, 0, 0);
  }
}
