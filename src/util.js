import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b = 0) => b + Math.random() * (a - b);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const C = (h) => new THREE.Color(h);

const _v = new THREE.Vector3();
export function flatDist(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}
export function flatDist2(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return dx * dx + dz * dz;
}
export function angleTo(from, to) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}
export function shortAngle(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** radial glow sprite generated at runtime (no external assets) */
export function makeGlowTexture(size = 128, hardness = 0.25) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(hardness, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeRingTexture(size = 256, thickness = 0.16) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 2 - 1, ny = (y / size) * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      let a = 1 - Math.abs(r - 0.78) / thickness;
      a = Math.max(0, Math.min(1, a));
      a = Math.pow(a, 1.6);
      if (r > 1) a = 0;
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = (a * 255) | 0;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** simple deterministic-ish noise for procedural motion */
export function noise1(x) {
  return Math.sin(x * 1.13) * 0.5 + Math.sin(x * 2.37 + 1.7) * 0.3 + Math.sin(x * 4.71 + 3.1) * 0.2;
}

export function emissiveMat(color, emissiveIntensity = 2, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: 0x0a0a12,
    emissive: new THREE.Color(color),
    emissiveIntensity,
    roughness: 0.35,
    metalness: 0.6,
    ...opts,
  });
}

export function metalMat(color, rough = 0.4, metal = 0.9) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

export function addMat(color, opacity = 1, texture = null) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    map: texture,
    side: THREE.DoubleSide,
  });
}


/** remove an object from the scene AND release its GPU buffers.
    Ability VFX build fresh geometry+shaders on every cast; without this a long
    run leaks a material and a geometry per ultimate. */
export function disposeObj(scene, obj) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
  scene.remove(obj);
}
