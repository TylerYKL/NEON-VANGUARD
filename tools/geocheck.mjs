/* ============================================================
   GEOCHECK — headless render-cost harness for the enemy build path.

   Runs the REAL `Enemy.build()` from src/entities.js in Node (no browser,
   no WebGL) and reports what a frame has to submit:

     · draw calls   = visible Mesh / Sprite / Points / Line objects
     · vertices     = sum of position.count across unique geometries
     · triangles    = index count / 3 (or position / 3 when unindexed)
     · lights       = every Light in the scene (three.js compiles one shader
                      variant per light COUNT, so this number is a frame-time
                      cliff, not just a uniform)
     · materials    = unique material objects (each is a state change)
     · textures     = unique GPU textures (each is an upload)
     · bbox         = world-space bounding box, for lossless-change proofing

   This is the §5 verification method from HANDOFF.md: image diffs of a live
   game are meaningless, geometry counts are exact.

   Usage:  node tools/geocheck.mjs [enemiesPerType]     (default 12)
   ============================================================ */

import * as THREE from 'three';

/* ---- minimal DOM surface so the real code runs unmodified ---- */
const ctx2d = () => ({
  clearRect() {}, fillRect() {}, strokeRect() {}, save() {}, restore() {},
  createLinearGradient: () => ({ addColorStop() {} }),
});
globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || {
  createElement: (tag) => (tag === 'canvas'
    ? { width: 1, height: 1, getContext: () => ctx2d() }
    : {}),
};

const { Enemy, ENEMY_TYPES } = await import('../src/entities.js');

/* ---- measurement ---- */
function measure(scene) {
  const geo = new Set(), mat = new Set(), tex = new Set();
  let drawCalls = 0, verts = 0, tris = 0, lights = 0, meshes = 0, sprites = 0;
  const box = new THREE.Box3();
  const _v = new THREE.Vector3();

  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.visible) return;
    let self = o.parent;
    let hidden = false;
    while (self) { if (!self.visible) { hidden = true; break; } self = self.parent; }
    if (hidden) return;

    if (o.isLight) lights++;
    if (o.isMesh || o.isSprite || o.isPoints || o.isLineSegments || o.isLine) {
      drawCalls++;
      if (o.isSprite) sprites++; else if (o.isMesh) meshes++;
    }
    const g = o.geometry;
    if (g && !geo.has(g.uuid)) {
      geo.add(g.uuid);
      const pos = g.attributes && g.attributes.position;
      if (pos) {
        verts += pos.count;
        tris += g.index ? g.index.count / 3 : pos.count / 3;
      }
      if (o.isMesh) {
        g.computeBoundingBox();
        if (g.boundingBox) {
          box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
        }
      }
    }
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (!mat.has(m.uuid)) {
        mat.add(m.uuid);
        for (const k of ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'roughnessMap']) {
          if (m[k] && !tex.has(m[k].uuid)) tex.add(m[k].uuid);
        }
      }
    }
  });

  const size = new THREE.Vector3(), c = new THREE.Vector3();
  if (!box.isEmpty()) { box.getSize(size); box.getCenter(c); }
  return {
    drawCalls, meshes, sprites, lights,
    verts, tris: Math.round(tris),
    materials: mat.size, textures: tex.size,
    bbox: box.isEmpty() ? null : {
      min: [r3(box.min.x), r3(box.min.y), r3(box.min.z)],
      max: [r3(box.max.x), r3(box.max.y), r3(box.max.z)],
      size: [r3(size.x), r3(size.y), r3(size.z)],
      center: [r3(c.x), r3(c.y), r3(c.z)],
    },
  };
}
const r3 = (v) => Math.round(v * 1000) / 1000;

/* fake context — Enemy.build() does not touch it, but the ctor stores it */
const G = { hpScale: 1, dmgScale: 1, time: 0, enemies: [] };

function buildType(type) {
  const scene = new THREE.Scene();
  const e = new Enemy(type, G);
  scene.add(e.group);
  const m = measure(scene);
  // elite prefix cost (crown is built lazily on first elite)
  const sceneE = new THREE.Scene();
  const e2 = new Enemy(type, G);
  e2.setElite('shielded');
  sceneE.add(e2.group);
  const me = measure(sceneE);
  return { base: m, elite: me };
}

/* ---- per-type single-enemy cost ---- */
console.log('ENEMY RENDER COST — one instance per type');
console.log('type        draws  meshes sprite lights  verts   tris  mats  tex');
const per = {};
for (const type of Object.keys(ENEMY_TYPES)) {
  const { base, elite } = buildType(type);
  per[type] = base;
  console.log(
    type.padEnd(12) +
    String(base.drawCalls).padStart(5) +
    String(base.meshes).padStart(7) +
    String(base.sprites).padStart(7) +
    String(base.lights).padStart(7) +
    String(base.verts).padStart(7) +
    String(base.tris).padStart(7) +
    String(base.materials).padStart(6) +
    String(base.textures).padStart(5)
  );
  console.log(
    '             +elite: draws ' + elite.drawCalls + ', lights ' + elite.lights +
    ', mats ' + elite.materials + ', tex ' + elite.textures
  );
}

/* ---- scene at the live cap ---- */
const n = Number(process.argv[2] ?? 12);
const scene = new THREE.Scene();
const made = [];
for (let i = 0; i < n; i++) {
  // rough late-wave mix: light drones plus the charger/warden variants
  const roll = Math.random();
  const type = roll < 0.34 ? 'skitter' : roll < 0.54 ? 'brute' : roll < 0.70 ? 'charger' : roll < 0.87 ? 'sentinel' : 'warden';
  const e = new Enemy(type, G);
  if (Math.random() < 0.3) e.setElite('shielded');
  e.spawnAt((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80);
  scene.add(e.group);
  made.push(e);
}
const cap = measure(scene);
console.log('\nSCENE — ' + n + ' enemies (random late-wave mix, ~30% elite)');
console.log('  draw calls : ' + cap.drawCalls);
console.log('  meshes     : ' + cap.meshes + '   sprites: ' + cap.sprites);
console.log('  LIGHTS     : ' + cap.lights);
console.log('  materials  : ' + cap.materials);
console.log('  textures   : ' + cap.textures);
console.log('  vertices   : ' + cap.verts.toLocaleString() + '   tris: ' + cap.tris.toLocaleString());

/* ---- the number that matters: lights vs enemy count ---- */
console.log('\nLIGHT COUNT vs LIVE ENEMIES (three.js recompiles the program when this changes)');
for (const count of [1, 5, 10, 20, 30, 45]) {
  const s = new THREE.Scene();
  for (let i = 0; i < count; i++) {
    const e = new Enemy(i % 3 === 2 ? 'brute' : 'skitter', G);
    s.add(e.group);
  }
  const m = measure(s);
  console.log(
    String(count).padStart(3) + ' enemies -> ' + String(m.lights).padStart(3) +
    ' point lights, ' + String(m.drawCalls).padStart(4) + ' draw calls, ' +
    String(m.textures).padStart(3) + ' textures, ' + String(m.materials).padStart(3) + ' materials'
  );
}

/* ---- pooling sanity: reset() must not rebuild or leak ---- */
console.log('\nPOOLING — reset() on a recycled instance');
console.log('  (baseline taken AFTER the first elite, because setElite() lazily');
console.log('   builds the crown once — that is a one-time cost, not a leak)');
for (const type of ['skitter', 'brute', 'charger', 'sentinel', 'warden']) {
  const e0 = new Enemy(type, G);
  const fresh = countMeshes(e0.group);
  e0.setElite('swift');                       // build the crown once
  const base = { meshes: countMeshes(e0.group), geo: countGeo(e0.group) };
  for (let i = 0; i < 25; i++) { e0.reset(G); e0.setElite(i % 4 === 0 ? 'swift' : null); }
  const after = { meshes: countMeshes(e0.group), geo: countGeo(e0.group) };
  const okM = base.meshes === after.meshes, okG = base.geo === after.geo;
  console.log(
    '  ' + type.padEnd(9) + ' meshes: fresh ' + fresh + ' -> with crown ' + base.meshes +
    ' -> after 25 resets ' + after.meshes + (okM ? '  OK' : '  <-- GROWING') +
    '   | geometries: ' + base.geo + ' -> ' + after.geo + (okG ? '  OK' : '  <-- LEAKING')
  );
}
/* elite HP must not compound across a pooled lifetime */
const eh = new Enemy('skitter', G);
G.hpScale = 2;
eh.reset(G); eh.setElite('shielded');
const hp1 = eh.maxHp;
eh.reset(G); eh.setElite('shielded');
const hp2 = eh.maxHp;
eh.reset(G);
const hp3 = eh.maxHp;
console.log('  elite HP across recycle: ' + hp1 + ' -> ' + hp2 + ' (must be equal), cleared: ' + hp3 +
  (hp1 === hp2 && hp3 === 55 * 2 ? '  OK' : '  <-- WRONG'));

function countMeshes(g) { let n = 0; g.traverse((o) => { if (o.isMesh || o.isSprite) n++; }); return n; }
function countGeo(g) { const s = new Set(); g.traverse((o) => { if (o.geometry) s.add(o.geometry.uuid); }); return s.size; }

console.log('\nGEOCHECK done — ' + made.length + ' enemies simulated, no runtime errors.');
