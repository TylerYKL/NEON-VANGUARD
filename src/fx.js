import * as THREE from 'three';
import { makeGlowTexture, makeRingTexture, rand, randSign, clamp, TAU } from './util.js';

/* ============================================================
   FX — one pooled GPU particle system + pooled ring/beam meshes
   Everything additive, tuned to explode under the bloom pass.
   ============================================================ */

const MAX_P = 6000;

export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.time = 0;
    this.shake = 0;
    this.shakeDecay = 6;
    this.flash = 0;
    this.flashColor = new THREE.Color(0xffffff);
    this.pMul = 1;       // particle budget multiplier (FX Intensity setting)
    this.shakeMul = 1;   // screen-shake multiplier (accessibility setting)
    this._initParticles();
    this._initRings();
    this._initBeams();
    this._initSparks();
    this._initTells();
  }

  /* ---------------- particles ---------------- */
  _initParticles() {
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_P * 3);
    this.pCol = new Float32Array(MAX_P * 3);
    this.pAlpha = new Float32Array(MAX_P);
    this.pSize = new Float32Array(MAX_P);
    this.vel = new Float32Array(MAX_P * 3);
    this.life = new Float32Array(MAX_P);
    this.maxLife = new Float32Array(MAX_P);
    this.drag = new Float32Array(MAX_P);
    this.grav = new Float32Array(MAX_P);
    this.size0 = new Float32Array(MAX_P);
    this.spin = new Float32Array(MAX_P);
    this.mode = new Uint8Array(MAX_P); // 0 free-fly, 1 orbit-attract, 2 rise
    this.tx = new Float32Array(MAX_P * 3); // target for attract
    this.head = 0;
    this.alive = 0;

    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.pCol, 3));
    g.setAttribute('palpha', new THREE.BufferAttribute(this.pAlpha, 1));
    g.setAttribute('psize', new THREE.BufferAttribute(this.pSize, 1));
    g.setDrawRange(0, MAX_P);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 500);

    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeGlowTexture(128, 0.18) }, pxRatio: { value: 1 } },
      vertexShader: `
        attribute vec3 pcolor; attribute float palpha; attribute float psize;
        varying vec3 vC; varying float vA;
        void main(){
          vC = pcolor; vA = palpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(psize * (420.0 / max(0.5,-mv.z)), 0.0, 220.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vC; varying float vA;
        void main(){
          if(vA <= 0.001) discard;
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(min(vC * vA * 1.6, vec3(6.0)), clamp(t.a * vA, 0.0, 1.0));
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.scene.add(this.points);
  }

  spawn(o) {
    const i = this.head;
    this.head = (this.head + 1) % MAX_P;
    const i3 = i * 3;
    this.pPos[i3] = o.x; this.pPos[i3 + 1] = o.y; this.pPos[i3 + 2] = o.z;
    this.vel[i3] = o.vx; this.vel[i3 + 1] = o.vy; this.vel[i3 + 2] = o.vz;
    const c = o.color;
    this.pCol[i3] = c.r; this.pCol[i3 + 1] = c.g; this.pCol[i3 + 2] = c.b;
    this.life[i] = o.life; this.maxLife[i] = o.life;
    this.size0[i] = o.size; this.pSize[i] = o.size;
    this.pAlpha[i] = 1;
    this.drag[i] = o.drag ?? 1.6;
    this.grav[i] = o.grav ?? 0;
    this.mode[i] = o.mode ?? 0;
    this.spin[i] = o.spin ?? 0;
    if (o.target) { this.tx[i3] = o.target.x; this.tx[i3 + 1] = o.target.y; this.tx[i3 + 2] = o.target.z; }
    return i;
  }

  burst(pos, color, count, opts = {}) {
    count = Math.max(1, Math.round(count * this.pMul));
    const sp = opts.speed ?? 8, up = opts.up ?? 0.5, life = opts.life ?? 0.6;
    const size = opts.size ?? 0.5, spread = opts.spread ?? 1, y0 = opts.y ?? 0;
    for (let k = 0; k < count; k++) {
      const a = Math.random() * TAU;
      const el = (Math.random() - 0.3) * Math.PI * up;
      const s = sp * (0.35 + Math.random() * 0.9);
      this.spawn({
        x: pos.x + rand(spread, -spread) * 0.3,
        y: pos.y + y0 + rand(spread, -spread) * 0.3,
        z: pos.z + rand(spread, -spread) * 0.3,
        vx: Math.cos(a) * Math.cos(el) * s,
        vy: Math.sin(el) * s + (opts.rise ?? 0),
        vz: Math.sin(a) * Math.cos(el) * s,
        color, life: life * rand(1.35, 0.6), size: size * rand(1.5, 0.5),
        drag: opts.drag ?? 2.2, grav: opts.grav ?? -6,
      });
    }
  }

  ringBurst(pos, color, count, radius, opts = {}) {
    count = Math.max(1, Math.round(count * this.pMul));
    const life = opts.life ?? 0.7, size = opts.size ?? 0.45, sp = opts.speed ?? 10;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU + rand(0.2);
      this.spawn({
        x: pos.x + Math.cos(a) * radius, y: pos.y + (opts.y ?? 0.3), z: pos.z + Math.sin(a) * radius,
        vx: Math.cos(a) * sp, vy: rand(3, 0.5), vz: Math.sin(a) * sp,
        color, life: life * rand(1.3, 0.7), size: size * rand(1.4, 0.6),
        drag: opts.drag ?? 3.0, grav: opts.grav ?? -3,
      });
    }
  }

  /** motes that fly toward a point (heal / singularity intake) */
  attract(from, to, color, count, opts = {}) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * TAU, r = opts.r ?? 2;
      this.spawn({
        x: from.x + Math.cos(a) * r * Math.random(), y: from.y + rand(2.2, 0), z: from.z + Math.sin(a) * r * Math.random(),
        vx: rand(2, -2), vy: rand(2, 0), vz: rand(2, -2),
        color, life: opts.life ?? 0.8, size: opts.size ?? 0.45,
        drag: 0.6, grav: 0, mode: 1, target: to, spin: opts.pull ?? 26,
      });
    }
  }

  updateParticles(dt) {
    const P = this.pPos, V = this.vel, L = this.life, A = this.pAlpha, S = this.pSize;
    for (let i = 0; i < MAX_P; i++) {
      if (L[i] <= 0) { if (A[i] !== 0) A[i] = 0; continue; }
      L[i] -= dt;
      if (L[i] <= 0) { A[i] = 0; continue; }
      const i3 = i * 3;
      if (this.mode[i] === 1) {
        const dx = this.tx[i3] - P[i3], dy = this.tx[i3 + 1] - P[i3 + 1], dz = this.tx[i3 + 2] - P[i3 + 2];
        const d = Math.max(0.2, Math.hypot(dx, dy, dz));
        const f = this.spin[i] * dt / d;
        V[i3] += dx * f; V[i3 + 1] += dy * f; V[i3 + 2] += dz * f;
      } else {
        V[i3 + 1] += this.grav[i] * dt;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      V[i3] *= dr; V[i3 + 1] *= dr; V[i3 + 2] *= dr;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      if (P[i3 + 1] < 0.02 && this.mode[i] === 0) { P[i3 + 1] = 0.02; V[i3 + 1] *= -0.28; V[i3] *= 0.7; V[i3 + 2] *= 0.7; }
      const t = L[i] / this.maxLife[i];
      A[i] = t * t * (3 - 2 * t);
      S[i] = this.size0[i] * (0.35 + 0.65 * t);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.palpha.needsUpdate = true;
    g.attributes.psize.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
  }

  /* ---------------- expanding rings / discs ---------------- */
  _initRings() {
    this.ringTex = makeRingTexture(256, 0.22);
    this.rings = [];
    this.ringPool = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 6;
      this.scene.add(m);
      this.ringPool.push(m);
    }
  }

  ring(pos, color, opts = {}) {
    const m = this.ringPool.pop();
    if (!m) return null;
    m.visible = true;
    m.position.set(pos.x, pos.y + (opts.y ?? 0.12), pos.z);
    m.material.color.set(color);
    m.material.opacity = 1;
    m.rotation.set(-Math.PI / 2, 0, opts.roll ?? 0);
    if (opts.vertical) { m.rotation.set(0, opts.yaw ?? 0, 0); }
    const st = {
      m, t: 0, dur: opts.dur ?? 0.55, r0: opts.r0 ?? 0.5, r1: opts.r1 ?? 8,
      fade: opts.fade ?? 1, spin: opts.spin ?? 0, ease: opts.ease ?? 'out',
    };
    this.rings.push(st);
    return st;
  }

  updateRings(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      let k = Math.min(1, r.t / r.dur);
      const e = r.ease === 'out' ? 1 - Math.pow(1 - k, 3) : k * k;
      const rad = r.r0 + (r.r1 - r.r0) * e;
      r.m.scale.set(rad * 2, rad * 2, 1);
      r.m.material.opacity = Math.pow(1 - k, r.fade) * 0.95;
      r.m.rotation.z += r.spin * dt;
      if (k >= 1) { r.m.visible = false; this.ringPool.push(r.m); this.rings.splice(i, 1); }
    }
  }

  /* ---------------- beams ---------------- */
  _initBeams() {
    this.beams = [];
    this.beamPool = [];
    const geo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.visible = false; m.renderOrder = 7;
      this.scene.add(m);
      this.beamPool.push(m);
    }
  }

  beam(from, to, color, opts = {}) {
    const m = this.beamPool.pop();
    if (!m) return;
    m.visible = true;
    m.material.color.set(color);
    m.material.opacity = 1;
    m.position.copy(from);
    m.lookAt(to);
    const len = from.distanceTo(to);
    const w = opts.w ?? 0.22;
    m.scale.set(w, w, len);
    this.beams.push({ m, t: 0, dur: opts.dur ?? 0.22, w, flare: opts.flare ?? 1 });
  }

  updateBeams(dt) {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      b.m.material.opacity = Math.pow(1 - k, 1.6);
      const s = b.w * (1 - k * 0.75) * (1 + b.flare * (1 - Math.pow(1 - k, 6)) * 0.6);
      b.m.scale.x = s; b.m.scale.y = s;
      if (k >= 1) { b.m.visible = false; this.beamPool.push(b.m); this.beams.splice(i, 1); }
    }
  }

  /* ---------------- spark streaks (line trails) ---------------- */
  _initSparks() {
    const MAXS = 400;
    this.sPos = new Float32Array(MAXS * 6);
    this.sCol = new Float32Array(MAXS * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 500);
    this.sparkLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9,
    }));
    this.sparkLines.frustumCulled = false;
    this.sparkLines.renderOrder = 7;
    this.scene.add(this.sparkLines);
    this.sparks = [];
    this.MAXS = MAXS;
  }

  spark(pos, dir, color, opts = {}) {
    if (this.sparks.length >= this.MAXS) this.sparks.shift();
    this.sparks.push({
      x: pos.x, y: pos.y, z: pos.z,
      vx: dir.x, vy: dir.y, vz: dir.z,
      c: color, t: 0, dur: opts.dur ?? 0.35, len: opts.len ?? 1.2, grav: opts.grav ?? -14, drag: opts.drag ?? 1.2,
    });
  }

  sparkBurst(pos, color, n, speed = 16) {
    n = Math.max(1, Math.round(n * this.pMul));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, el = Math.random() * 1.1;
      const s = speed * rand(1.3, 0.4);
      this.spark(pos, { x: Math.cos(a) * Math.cos(el) * s, y: Math.sin(el) * s, z: Math.sin(a) * Math.cos(el) * s }, color, { dur: rand(0.45, 0.18) });
    }
  }

  updateSparks(dt) {
    let n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      if (s.t >= s.dur) { this.sparks.splice(i, 1); continue; }
      s.vy += s.grav * dt;
      const dr = Math.exp(-s.drag * dt);
      s.vx *= dr; s.vy *= dr; s.vz *= dr;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < 0.03) { s.y = 0.03; s.vy *= -0.3; }
    }
    for (let i = 0; i < this.sparks.length && n < this.MAXS; i++, n++) {
      const s = this.sparks[i];
      const k = 1 - s.t / s.dur;
      const L = s.len * 0.02;
      const o = n * 6;
      this.sPos[o] = s.x; this.sPos[o + 1] = s.y; this.sPos[o + 2] = s.z;
      this.sPos[o + 3] = s.x - s.vx * L; this.sPos[o + 4] = s.y - s.vy * L; this.sPos[o + 5] = s.z - s.vz * L;
      const c = s.c;
      this.sCol[o] = c.r * k; this.sCol[o + 1] = c.g * k; this.sCol[o + 2] = c.b * k;
      this.sCol[o + 3] = c.r * k * 0.1; this.sCol[o + 4] = c.g * k * 0.1; this.sCol[o + 5] = c.b * k * 0.1;
    }
    this.sparkLines.geometry.setDrawRange(0, n * 2);
    this.sparkLines.geometry.attributes.position.needsUpdate = true;
    this.sparkLines.geometry.attributes.color.needsUpdate = true;
  }

  /* ---------------- camera juice ---------------- */
  addShake(a) { this.shake = Math.min(1.6, this.shake + a * this.shakeMul); }

  /* ---------------- ground telegraphs ----------------
     Every hostile attack draws its impact zone on the floor before it lands.
     One pooled plane per telegraph, filled by a radial/linear wipe shader. */
  _initTells() {
    this.tellPool = [];
    this.tellsUsed = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0xff2b4a) },
          uP: { value: 0 }, uShape: { value: 0 }, uHalf: { value: 1.0 }, uFade: { value: 1 },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `
          uniform vec3 uColor; uniform float uP; uniform float uShape; uniform float uHalf; uniform float uFade;
          varying vec2 vUv;
          void main(){
            vec2 q = vUv * 2.0 - 1.0;
            float inside, fillEdge, outline;
            if (uShape < 0.5) {                       // disc / cone
              float r = length(q);
              float ang = abs(atan(q.x, q.y));
              inside  = step(r, 1.0) * step(ang, uHalf);
              fillEdge = smoothstep(uP + 0.05, uP - 0.02, r);
              outline = smoothstep(0.02, 0.0, abs(r - 1.0));
            } else {                                   // lane
              float y = vUv.y;
              inside  = 1.0;
              fillEdge = smoothstep(uP + 0.04, uP - 0.02, y);
              outline = smoothstep(0.05, 0.0, abs(abs(q.x) - 1.0)) + smoothstep(0.02, 0.0, abs(y - 1.0));
            }
            float body = 0.10 + 0.05 * sin(uP * 34.0);
            float a = inside * (body + fillEdge * 0.30 + outline * 0.85) * uFade;
            gl_FragColor = vec4(uColor * (0.7 + fillEdge * 1.6 + outline * 2.2), a);
          }`,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 5;
      this.scene.add(m);
      this.tellPool.push(m);
    }
  }

  /** grab a telegraph. shape: 'disc' | 'cone' | 'lane'. Returns null when the pool is dry. */
  telegraph(color, shape = 'disc', halfAngle = Math.PI) {
    const m = this.tellPool.pop();
    if (!m) return null;
    m.visible = true;
    m.material.uniforms.uColor.value.set(color);
    m.material.uniforms.uShape.value = shape === 'lane' ? 1 : 0;
    m.material.uniforms.uHalf.value = shape === 'cone' ? halfAngle : Math.PI;
    m.material.uniforms.uP.value = 0;
    m.material.uniforms.uFade.value = 1;
    return m;
  }

  /** place + advance a telegraph. `p` 0..1 */
  tellSet(m, x, z, facing, radius, p, len) {
    if (!m) return;
    m.position.set(x, 0.09, z);
    m.rotation.z = -facing;
    if (m.material.uniforms.uShape.value > 0.5) {
      m.scale.set(radius * 2, len ?? radius * 2, 1);
      m.position.x += Math.sin(facing) * (len ?? 0) * 0.5;
      m.position.z += Math.cos(facing) * (len ?? 0) * 0.5;
    } else {
      m.scale.set(radius * 2, radius * 2, 1);
    }
    m.material.uniforms.uP.value = p;
  }

  tellRelease(m) {
    if (!m) return;
    m.visible = false;
    this.tellPool.push(m);
  }

  update(dt) {
    this.time += dt;
    this.updateParticles(dt);
    this.updateRings(dt);
    this.updateBeams(dt);
    this.updateSparks(dt);
    this.shake *= Math.exp(-this.shakeDecay * dt);
    if (this.shake < 0.001) this.shake = 0;
    this.flash *= Math.exp(-9 * dt);
  }
}
