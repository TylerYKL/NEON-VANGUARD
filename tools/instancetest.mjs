/* Enemy instancing smoke test — validates the game context, while geocheck keeps
   its pre-instancing per-enemy measurements for geometry comparison. */
import * as THREE from 'three';

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
const scene = new THREE.Scene();
const G = { scene, enemyBatches: {}, hpScale: 1, dmgScale: 1, time: 0, enemies: [] };
const made = [];
for (let i = 0; i < 45; i++) {
  const keys = Object.keys(ENEMY_TYPES).filter((k) => !ENEMY_TYPES[k].boss);
  const e = new Enemy(keys[i % keys.length], G);
  e.spawnAt((i % 9 - 4) * 5, (Math.floor(i / 9) - 2) * 7);
  scene.add(e.group);
  G.enemies.push(e);
  made.push(e);
}

const batches = Object.values(G.enemyBatches);
const instanced = [];
scene.traverse((o) => { if (o.isInstancedMesh) instanced.push(o); });
const visibleGroups = made.reduce((n, e) => n + (e.group.children.filter((o) => o.isMesh || o.isSprite).length), 0);
const batchInstances = instanced.reduce((n, m) => n + m.count, 0);

function ok(v, msg) {
  if (!v) { console.error('FAIL  ' + msg); process.exitCode = 1; }
  else console.log('PASS  ' + msg);
}

ok(batches.length === Object.keys(ENEMY_TYPES).filter((k) => !ENEMY_TYPES[k].boss).length,
  'one static batch exists per non-boss enemy type');
ok(instanced.length >= batches.length, 'static bodies are represented by InstancedMesh objects');
const expectedInstances = made.reduce((n, e) => n + e.batchSlots.length, 0);
ok(batchInstances === expectedInstances,
  'each enemy contributes all baked static body parts to its batch');
ok(visibleGroups < made.length * 8,
  'per-enemy groups retain only animated accents and health bars');
for (const b of batches) b.update();
for (const m of instanced) ok(m.instanceMatrix.version > 0, 'batch matrix buffer marked dirty after transform update');

// Overflow disposal must return its slots; otherwise long runs eventually
// exhaust the fixed InstancedMesh capacity even though gameplay pools recycle.
const victim = made[0];
const victimBatch = victim.batch;
const victimSlot = victim.batchSlots[0].index;
victim.disposeMeshes();
const replacement = new Enemy(victim.type, G);
scene.add(replacement.group);
ok(victimBatch.enemies.length === made.filter((e) => e !== victim && e.batch === victimBatch).length + 1,
  'disposing an overflow enemy removes it from the batch roster');
ok(replacement.batchSlots.some((s) => s.index === victimSlot),
  'a later enemy reuses the released static batch slot');

console.log('\nERRORS ' + (process.exitCode ? 'present' : 'none') +
  '  (' + (process.exitCode ? 'see failures' : 'instancing passed') + ')');
if (process.exitCode) process.exit(1);
