/* ============================================================
   LIGHTTEST — asserts the point-light invariant.

   three.js compiles a shader program per light COUNT:
     numPointLights: lights.point.length   (WebGLPrograms.getParameters)
     array.push( parameters.numPointLights )   (getProgramCacheKeyParameters)
   So a light appearing or disappearing recompiles every material in the frame.
   The pool in src/lights.js exists to make that count constant. These tests
   drive the real Enemy and Pickup constructors and fail if anything makes the
   count move again.

   Usage:  node tools/lighttest.mjs
   ============================================================ */

import * as THREE from 'three';

/* ---- minimal DOM so the real modules import ---- */
const ctx2d = () => ({
  clearRect() {}, fillRect() {}, strokeRect() {}, save() {}, restore() {},
  createLinearGradient: () => ({ addColorStop() {} }),
});
globalThis.window = globalThis.window || {};
globalThis.document = globalThis.document || {
  createElement: (tag) => (tag === 'canvas' ? { width: 1, height: 1, getContext: () => ctx2d() } : {}),
};

const { LightPool } = await import('../src/lights.js');
const { Enemy, ENEMY_TYPES } = await import('../src/entities.js');
const { Pickup } = await import('../src/pickups.js');
const { BALANCE } = await import('../src/balance.js');

/* ---- what the renderer would actually count ---- */
function countPointLights(scene) {
  let n = 0;
  scene.traverse((o) => {
    if (!o.isPointLight || !o.visible) return;
    let p = o.parent, hidden = false;
    while (p) { if (!p.visible) { hidden = true; break; } p = p.parent; }
    if (!hidden) n++;
  });
  return n;
}

/* ---- test harness ---- */
let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

/* ---- shared fake context ---- */
const scene = new THREE.Scene();
const noop = () => {};
const G = {
  scene,
  fx: {
    tellRelease: noop, ring: noop, burst: noop, sparkBurst: noop, addShake: noop,
    spawn: noop, ringBurst: noop, attract: noop, flash: 0, flashColor: new THREE.Color(),
  },
  heroes: [], enemies: [], pickups: [], barriers: [], hazards: [],
  mods: {}, hpScale: 1, dmgScale: 1, time: 0, kills: 0, score: 0,
  panOf: () => 0,
  onEnemyKilled: noop,
  damageEnemy: noop,
  ui: { banner: noop, feed: noop },
  world: { arenaPulse: noop },
  projectiles: { fire: noop },
  active: null,
};

console.log('LIGHTTEST — point-light invariant');
console.log('budget from src/balance.js: enemy ' + BALANCE.perf.lightsEnemy +
  ', pickup ' + BALANCE.perf.lightsPickup + ', effect ' + BALANCE.perf.lightsEffect);

const pool = new LightPool(scene, BALANCE.perf);
const BUDGET = pool.size;
const BASE = countPointLights(scene);
check('pool creates exactly budget lights (' + BUDGET + ')',
  BASE === BALANCE.perf.lightsEnemy + BALANCE.perf.lightsPickup + BALANCE.perf.lightsEffect,
  'scene has ' + BASE);
check('all pooled lights start dark and parked',
  scene.children.filter((o) => o.isPointLight).every((l) => l.intensity === 0 && l.position.y < -100));
check('pooled lights stay visible (hiding them would change the count)',
  scene.children.filter((o) => o.isPointLight).every((l) => l.visible === true));

/* ---- 1. enemies no longer build their own light ---- */
console.log('\n[1] Enemy.build() must not create a light');
let built = 0;
for (const type of Object.keys(ENEMY_TYPES)) {
  const e = new Enemy(type, G);
  let lights = 0;
  e.group.traverse((o) => { if (o.isLight) lights++; });
  built += lights;
  check(type + ' group contains 0 lights', lights === 0, 'found ' + lights);
}

/* ---- 2. at the cap, only the budget is lit ---- */
console.log('\n[2] 45 live enemies -> only lightsEnemy are lit');
for (let i = 0; i < 45; i++) {
  const e = new Enemy(i % 3 === 2 ? 'brute' : 'skitter', G);
  e.spawnAt((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80);
  scene.add(e.group);
  G.enemies.push(e);
}
const focus = new THREE.Vector3(0, 0, 0);
const litCount = pool.assignNearest('enemy', G.enemies, focus, (o) => (o.T.boss ? 1e9 : 0));
check('scene point-light count unchanged (' + BASE + ')', countPointLights(scene) === BASE,
  'got ' + countPointLights(scene));
check('exactly lightsEnemy enemies were given a light', litCount === BALANCE.perf.lightsEnemy,
  'got ' + litCount);
check('the rest are unlit (this.light === null)',
  G.enemies.filter((e) => e.light).length === BALANCE.perf.lightsEnemy);

/* the winners must be the nearest */
const d = (e) => Math.hypot(e.pos.x - focus.x, e.pos.z - focus.z);
const lit = G.enemies.filter((e) => e.light).map(d);
const unlit = G.enemies.filter((e) => !e.light).map(d);
check('every lit enemy is nearer than every unlit one',
  Math.max(...lit) <= Math.min(...unlit) + 1e-6,
  'farthest lit ' + Math.max(...lit).toFixed(2) + ' vs nearest unlit ' + Math.min(...unlit).toFixed(2));

/* ---- 3. the boss always wins a slot ---- */
console.log('\n[3] boss priority');
const boss = new Enemy('juggernaut', G);
boss.spawnAt(44, 44);              // as far from the player as the arena allows
scene.add(boss.group);
G.enemies.push(boss);
pool.assignNearest('enemy', G.enemies, focus, (o) => (o.T.boss ? 1e9 : 0));
check('the far-side boss still holds a light', boss.light !== null);
check('count still ' + BASE, countPointLights(scene) === BASE, 'got ' + countPointLights(scene));

/* ---- 4. spawn/kill churn must not move the count ---- */
console.log('\n[4] spawn + death churn (the thing that used to recompile shaders)');
let minSeen = Infinity, maxSeen = -Infinity;
for (let round = 0; round < 40; round++) {
  // kill a third of them the way the game does
  for (const e of G.enemies.slice(0, 12)) e.die(G, null);
  G.enemies = G.enemies.filter((e) => !e.dead);
  // spawn replacements
  while (G.enemies.length < 40) {
    const e = new Enemy(Math.random() < 0.5 ? 'skitter' : 'sentinel', G);
    e.spawnAt((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80);
    scene.add(e.group);
    G.enemies.push(e);
  }
  pool.assignNearest('enemy', G.enemies, focus, (o) => (o.T.boss ? 1e9 : 0));
  const n = countPointLights(scene);
  minSeen = Math.min(minSeen, n); maxSeen = Math.max(maxSeen, n);
}
check('40 rounds of spawn/kill kept the count at ' + BASE,
  minSeen === BASE && maxSeen === BASE, 'saw ' + minSeen + '..' + maxSeen);

/* ---- 5. pickups ---- */
console.log('\n[5] pickups');
const pickups = [];
for (let i = 0; i < 30; i++) pickups.push(new Pickup(G, 'shard', (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70));
const core = new Pickup(G, 'core', 40, -40);
pickups.push(core);
G.pickups = pickups;
const plit = pool.assignNearest('pickup', G.pickups, focus, (o) => (o.core ? 1e9 : 0));
check('Charge Core on the far side wins a slot', core.light !== null);
check('only lightsPickup pickups are lit', plit === BALANCE.perf.lightsPickup, 'got ' + plit);
check('count still ' + BASE, countPointLights(scene) === BASE, 'got ' + countPointLights(scene));
check('no pickup created its own light',
  pickups.every((p) => { let n = 0; p.group.traverse((o) => { if (o.isLight) n++; }); return n === 0; }));
// collect every pickup and watch the count
for (const p of pickups) p.remove(G);
pool.assignNearest('pickup', [], focus, null);
check('count still ' + BASE + ' after every pickup is removed',
  countPointLights(scene) === BASE, 'got ' + countPointLights(scene));

/* ---- 6. the transient effect pool ---- */
console.log('\n[6] ability lights (effect pool)');
const grabbed = [];
for (let i = 0; i < BALANCE.perf.lightsEffect; i++) grabbed.push(pool.acquire('effect'));
check('can acquire every effect slot', grabbed.every(Boolean));
check('acquire past the budget returns null (never a new light)', pool.acquire('effect') === null);
check('count still ' + BASE, countPointLights(scene) === BASE, 'got ' + countPointLights(scene));
const L0 = grabbed[0];
pool.set(L0, 0xff2b4a, 12, 46, 2);
check('set() styles the light', L0?.intensity === 12 && L0?.distance === 46);
pool.release(L0);
check('release parks and darkens it', L0?.intensity === 0 && L0?.position.y < -100);
pool.release(L0);
check('double release is safe', pool.free.effect.filter((l) => l === grabbed[0]).length === 1);
pool.release(null);
check('release(null) is safe', true);
for (const l of grabbed) pool.release(l);
check('all effect slots return to the free list', pool.free.effect.length === BALANCE.perf.lightsEffect,
  'free ' + pool.free.effect.length);

/* ---- 7. clear() recovers a leaked slot (abandoned ultimate on run reset) ---- */
console.log('\n[7] clear() on run reset');
const leaked = pool.acquire('effect');
check('slot is taken', leaked !== null && pool.free.effect.length === BALANCE.perf.lightsEffect - 1);
pool.clear();
check('clear() returns every slot', pool.free.effect.length === BALANCE.perf.lightsEffect);
check('clear() nulls the enemy/pickup .light back-references',
  G.enemies.every((e) => e.light === null) );
check('count still ' + BASE, countPointLights(scene) === BASE, 'got ' + countPointLights(scene));

/* ---- 8. setBudget is the only thing allowed to change the count ---- */
console.log('\n[8] setBudget (dev overlay)');
pool.setBudget({ lightsEnemy: 2, lightsPickup: 1, lightsEffect: 1 });
check('shrinking removes lights from the scene', countPointLights(scene) === 4,
  'got ' + countPointLights(scene));
check('trimming clears owner back-references', G.enemies.every((e) => e.light === null));
pool.setBudget(BALANCE.perf);
check('restoring the budget returns to ' + BASE, countPointLights(scene) === BASE,
  'got ' + countPointLights(scene));
pool.setBudget({ lightsEnemy: 0, lightsPickup: 0, lightsEffect: 0 });
check('a zero budget is survivable', countPointLights(scene) === 0 &&
  pool.assignNearest('enemy', G.enemies, focus, null) === 0);
pool.setBudget(BALANCE.perf);

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ERRORS none') + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail ? 1 : 0);
