import * as THREE from 'three';
import { clamp } from './util.js';

/*
   GPU VFX PROFILE + RUNTIME
   -------------------------
   This is the vanilla-three adapter for the ideas in three-vfx: one instanced
   mesh per effect, CPU work only when particles are spawned, and GPU animation
   for lifetime, movement, scale, colour and opacity. The upstream three-vfx
   package is React/R3F-only and explicitly marked work-in-progress, so the game
   keeps a small serialisable profile instead of coupling the self-contained
   deliverable to React.

   The Hero Studio edits these profiles. The exact same spawnVFX() path is used
   by the studio preview and by Hero.playFX() in the match.
*/

export const VFX_SLOTS = 3;
export const VFX_SHARED = -1;

/* [key, label, min, max, step] — the editor renders this table directly. */
export const VFX_NUM_DEFS = [
  ['burst', 'burst count', 1, 160, 1],
  ['rate', 'emit /s', 0, 180, 1],
  ['duration', 'emitter s', 0.08, 4, 0.01],
  ['life', 'particle life', 0.12, 4, 0.01],
  ['speed', 'speed', 0, 18, 0.1],
  ['spread', 'spread', 0, 1, 0.01],
  ['accelY', 'gravity', -18, 18, 0.1],
  ['size0', 'size start', 0.02, 2.5, 0.01],
  ['size1', 'size end', 0, 2.5, 0.01],
  ['spin', 'spin /s', -18, 18, 0.1],
  ['opacity0', 'alpha start', 0, 1, 0.01],
  ['opacity1', 'alpha end', 0, 1, 0.01],
];

export const VFX_OPT_DEFS = [
  ['shape', 'emitter', ['cone', 'radial', 'fountain'], 0],
  ['blend', 'blend', ['additive', 'alpha'], 0],
  ['billboard', 'billboard', ['flat', 'face camera'], 1],
  ['easing', 'easing', ['linear', 'quadratic out', 'cubic out', 'sine out', 'back out'], 2],
  ['follow', 'anchor', ['cast point', 'follow hero'], 0],
];

export const VFX_COLOR_DEFS = [
  ['color0', 'colour start', '#18e0ff'],
  ['color1', 'colour end', '#ffffff'],
];

export const DEFAULT_VFX = {
  burst: 36, rate: 0, duration: 0.72, life: 0.9, speed: 5.5, spread: 0.55,
  accelY: -2.5, size0: 0.22, size1: 0.035, spin: 2.5,
  opacity0: 0.95, opacity1: 0, shape: 0, blend: 0, billboard: 1,
  easing: 2, follow: 0, color0: '#18e0ff', color1: '#ffffff',
};

const NUM_RANGE = Object.fromEntries(VFX_NUM_DEFS.map(([k, , lo, hi]) => [k, [lo, hi]]));
const OPT_RANGE = Object.fromEntries(VFX_OPT_DEFS.map(([k, , opts]) => [k, opts.length]));
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));

export function clampVFX(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, , lo, hi] of VFX_NUM_DEFS) {
    const v = Number(src[key]);
    out[key] = Number.isFinite(v) ? clamp(v, lo, hi) : DEFAULT_VFX[key];
  }
  for (const [key, , , fallback] of VFX_OPT_DEFS) {
    const v = Number(src[key]);
    const n = OPT_RANGE[key];
    out[key] = Number.isFinite(v) ? Math.round(clamp(v, 0, n - 1)) : fallback;
  }
  for (const [key, , fallback] of VFX_COLOR_DEFS) {
    out[key] = isHex(src[key]) ? String(src[key]).toLowerCase() : fallback;
  }
  return out;
}

export function vfxFor(tuning, heroId, slot) {
  const t = tuning && tuning[heroId];
  if (!t) return null;
  if (slot >= 0) {
    const entry = t.vfxSlots && t.vfxSlots[slot];
    if (entry && entry.on !== false) return { p: clampVFX(entry.p), shared: false };
  }
  if (t.vfx && t.vfx.on !== false) return { p: clampVFX(t.vfx.p), shared: true };
  return null;
}

function ensureEntry(t, key, index) {
  if (index === VFX_SHARED) {
    if (!t.vfx) t.vfx = { on: false, p: clampVFX(null) };
    if (!t.vfx.p) t.vfx.p = clampVFX(null);
    return t.vfx;
  }
  if (!Array.isArray(t.vfxSlots)) t.vfxSlots = [];
  if (!t.vfxSlots[index]) t.vfxSlots[index] = { on: false, p: clampVFX(null) };
  if (!t.vfxSlots[index].p) t.vfxSlots[index].p = clampVFX(null);
  return t.vfxSlots[index];
}

/** Editor-facing live record. It stays read-only until a setter is called, so merely
    opening the VFX panel cannot make a default effect play in the match. */
export function vfxEdit(tuning, heroId, slot) {
  const t = tuning && tuning[heroId];
  if (!t) return null;
  const existing = slot === VFX_SHARED ? t.vfx : (t.vfxSlots && t.vfxSlots[slot]);
  const p = clampVFX(existing && existing.p);
  return {
    configured: !!existing,
    on: !!(existing && existing.on !== false),
    p,
    setOn(value) { ensureEntry(t, 'vfx', slot).on = !!value; },
    setP(value) { ensureEntry(t, 'vfx', slot).p = clampVFX(value); },
    clear() {
      if (slot === VFX_SHARED) delete t.vfx;
      else if (Array.isArray(t.vfxSlots)) t.vfxSlots[slot] = null;
    },
  };
}

export function vfxCount(tuning) {
  let n = 0;
  for (const t of Object.values(tuning || {})) {
    if (!t) continue;
    if (t.vfx) n++;
    for (const entry of t.vfxSlots || []) if (entry) n++;
  }
  return n;
}

const VERTEX = /* glsl */ `
  attribute mat4 instanceMatrix;
  attribute vec2 aLife;
  attribute vec3 aVelocity;
  attribute vec3 aAcceleration;
  attribute vec3 aScale;
  attribute vec4 aColor0;
  attribute vec4 aColor1;
  attribute float aSpin;
  uniform float uTime;
  uniform bool uBillboard;
  uniform int uEasing;
  varying vec2 vUv;
  varying vec4 vColor;

  float ease(float x) {
    if (uEasing == 1) return 1.0 - (1.0 - x) * (1.0 - x);
    if (uEasing == 2) return 1.0 - pow(1.0 - x, 3.0);
    if (uEasing == 3) return sin(x * 1.57079632679);
    if (uEasing == 4) { float f = x - 1.0; return f * f * ((2.7 + 1.0) * f + 2.7) + 1.0; }
    return x;
  }

  void main() {
    float age = uTime - aLife.x;
    float progress = age / max(0.001, aLife.y - aLife.x);
    if (progress < 0.0 || progress > 1.0) {
      vColor = vec4(0.0);
      gl_Position = vec4(0.0, 0.0, 0.0, 0.0);
      return;
    }
    float e = clamp(ease(progress), -0.5, 1.5);
    float angle = aSpin * age;
    float cs = cos(angle), sn = sin(angle);
    vec2 local = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
    float particleScale = mix(aScale.x, aScale.y, e);
    vec3 drift = aVelocity * age + 0.5 * aAcceleration * age * age;
    vec3 origin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 quad;
    if (uBillboard) {
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      quad = right * local.x + up * local.y;
    } else {
      quad = vec3(local.x, 0.0, local.y);
    }
    vec4 world = modelMatrix * vec4(origin + drift + quad * particleScale, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    vUv = uv;
    vColor = mix(aColor0, aColor1, e);
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    float d = distance(vUv, vec2(0.5)) * 2.0;
    float soft = 1.0 - smoothstep(0.68, 1.0, d);
    if (soft <= 0.001 || vColor.a <= 0.001) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * soft);
  }
`;

const tmpMatrix = new THREE.Matrix4();
const tmpColor0 = new THREE.Color();
const tmpColor1 = new THREE.Color();
const ZERO = new THREE.Vector3();
const MAX_PARTICLES = 1024;

function setAttribute(geometry, name, array, size) {
  const attr = new THREE.InstancedBufferAttribute(array, size);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attr);
  return attr;
}

function spawnVelocity(p, facing) {
  const angle = facing + (Math.random() - 0.5) * Math.PI * 2 * p.spread;
  const speed = p.speed * (0.7 + Math.random() * 0.6);
  const horizontal = p.shape === 1 ? Math.random() * speed : speed * (0.25 + Math.random() * 0.55);
  let y = p.shape === 2 ? speed * (0.7 + Math.random() * 0.5) : speed * (0.25 + Math.random() * 0.75);
  if (p.shape === 1) y = (Math.random() - 0.5) * speed;
  return new THREE.Vector3(Math.sin(angle) * horizontal, y, Math.cos(angle) * horizontal);
}

/** Create one GPU-instanced effect. `profile` is a clamped VFX profile, `at` is the
    world anchor, and `owner` is optional for follow-hero profiles. */
export function spawnVFX(G, profile, at, facing = 0, owner = null) {
  const p = clampVFX(profile);
  const capacity = Math.min(MAX_PARTICLES, Math.max(32, Math.ceil(Math.max(p.burst, p.rate * p.duration) * 1.5)));
  const geometry = new THREE.PlaneGeometry(1, 1);
  const life = setAttribute(geometry, 'aLife', new Float32Array(capacity * 2), 2);
  const velocity = setAttribute(geometry, 'aVelocity', new Float32Array(capacity * 3), 3);
  const acceleration = setAttribute(geometry, 'aAcceleration', new Float32Array(capacity * 3), 3);
  const scale = setAttribute(geometry, 'aScale', new Float32Array(capacity * 2), 2);
  const color0 = setAttribute(geometry, 'aColor0', new Float32Array(capacity * 4), 4);
  const color1 = setAttribute(geometry, 'aColor1', new Float32Array(capacity * 4), 4);
  const spin = setAttribute(geometry, 'aSpin', new Float32Array(capacity), 1);
  geometry.boundingSphere = new THREE.Sphere(ZERO.clone(), 1000);

  tmpColor0.set(p.color0); tmpColor1.set(p.color1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uBillboard: { value: p.billboard === 1 }, uEasing: { value: p.easing },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: p.blend === 1 ? THREE.NormalBlending : THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = capacity;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const anchorY = at.y;
  mesh.position.set(at.x, anchorY, at.z);
  if (G.scene) G.scene.add(mesh);

  let cursor = 0;
  let elapsed = 0;
  let emitter = 0;
  let dead = false;
  let lastSpawn = 0;
  const follow = p.follow === 1 && owner && owner.pos;

  const spawnOne = () => {
    const i = cursor;
    cursor = (cursor + 1) % capacity;
    tmpMatrix.identity();
    mesh.setMatrixAt(i, tmpMatrix);
    const v = spawnVelocity(p, facing);
    const lifeTime = p.life * (0.72 + Math.random() * 0.56);
    life.setXY(i, elapsed, elapsed + lifeTime);
    velocity.setXYZ(i, v.x, v.y, v.z);
    acceleration.setXYZ(i, 0, p.accelY, 0);
    scale.setXY(i, p.size0 * (0.75 + Math.random() * 0.5), p.size1 * (0.75 + Math.random() * 0.5));
    color0.setXYZW(i, tmpColor0.r, tmpColor0.g, tmpColor0.b, p.opacity0);
    color1.setXYZW(i, tmpColor1.r, tmpColor1.g, tmpColor1.b, p.opacity1);
    spin.setX(i, p.spin * (0.7 + Math.random() * 0.6));
    for (const attr of [life, velocity, acceleration, scale, color0, color1, spin]) attr.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    lastSpawn = elapsed;
  };

  for (let i = 0; i < p.burst; i++) spawnOne();

  function kill() {
    if (dead) return;
    dead = true;
    if (G.scene) G.scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return {
    obj: mesh,
    kill,
    get alive() { return !dead; },
    update(dt) {
      if (dead) return false;
      elapsed += dt;
      material.uniforms.uTime.value = elapsed;
      if (follow) mesh.position.set(owner.pos.x, owner.pos.y + anchorY, owner.pos.z);
      if (p.rate > 0 && elapsed < p.duration) {
        emitter += dt * p.rate;
        const n = Math.min(capacity, Math.floor(emitter));
        if (n) {
          emitter -= n;
          for (let i = 0; i < n; i++) spawnOne();
        }
      }
      /* Keep the mesh alive until the final burst particle has completed. */
      if (elapsed >= p.duration + p.life) { kill(); return false; }
      return true;
    },
  };
}

export function vfxStats() {
  return { maxParticles: MAX_PARTICLES, model: 'instanced-gpu-lifetime-velocity-scale-colour' };
}

export { VERTEX as VFX_VERTEX_SHADER, FRAGMENT as VFX_FRAGMENT_SHADER };
