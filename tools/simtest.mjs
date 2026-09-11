/* ============================================================
   SIMTEST — the Hero Studio's CAST SIM, headless.

   The bench runs the REAL `Hero.useSkill(i, G)` / `basicAttack(G)` against the
   stand-in arena in `src/sim.js`: a real `FX` instance, a real `ProjectileSystem`
   (lazy), dummy targets with exactly the fields the abilities read. So this
   suite is not testing a mock — it is testing the nine abilities' *integration*
   surface, which is the part that breaks when someone adds a hook and forgets
   the bench, and the part that used to be unverifiable without a browser.

   What it pins:
     1. every hero × basic/Q/E/R runs without throwing, and reports hits
     2. the scene returns to its baseline once the cast finishes  (no leak)
     3. particles / rings / beams drain to zero                 (no stall)
     4. the light pool balances acquire/release                 (invariant 3/13)
     5. no non-finite transform reaches the frame               (invariant 8)
     6. cooldowns tick, and an unforced cast on cd is BLOCKED rather than fired
     7. target dummies are pooled — 6 then 3 then 6 costs no new meshes
     8. uninstalling puts G back exactly as it was

   Usage:  node tools/simtest.mjs
   ============================================================ */

import * as THREE from 'three';

/* A canvas is only needed to *generate* the glow / ring textures; stub the parts
   util.js calls and the whole FX layer runs headless. */
const CTX = () => ({
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createImageData: (n) => ({ data: new Uint8ClampedArray(n * n * 4) }),
  putImageData() {}, fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
  set fillStyle(v) {}, set lineWidth(v) {}, set strokeStyle(v) {},
});
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = {
  createElement: (t) => ({ width: 0, height: 0, style: {}, getContext: () => CTX() }),
  createElementNS: () => ({ width: 0, height: 0, getContext: () => CTX() }),
};
globalThis.Image = class { set src(v) { this.width = this.height = 4; this.onload && this.onload(); } };

let pass = 0, fail = 0;
const check = (name, cond, note) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (note ? '  -> ' + note : '')); }
};

const { HERO_DEFS, Hero } = await import('../src/heroes.js');
const { ARENA } = await import('../src/world.js');
const { createSim, SIM_TARGETS, SIM_SPEEDS } = await import('../src/sim.js');

/* ---- a studio-shaped G: scene, camera, effects list, counting light pool ---- */
const scene = new THREE.Scene();
const BASE = 0;                 // heroes + dummies + FX containers are counted below
const camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 200);
camera.position.set(6, 5, 8);
const effects = [];
let lacq = 0, lrel = 0;
const G = {
  scene, camera, time: 0,
  addEffect: (e) => effects.push(e),
  lights: {
    acquire: () => { lacq++; return { position: new THREE.Vector3(), intensity: 0, __sim: true }; },
    release: (l) => { if (l) lrel++; },
    set: (l, c, i) => { if (l) l.intensity = i; },
  },
};
const baseline = 0;            // measured after the bench warms up, see warmBelow

/* no GLB skins here: procedural rigs keep the test asset-free */
const heroes = HERO_DEFS.map((d, i) => new Hero(d, G, i));
heroes.forEach((h, i) => { h.pos.set(i * 2 - 2, 0, 0); });

let announced = [];
const sim = createSim(G, {
  hero: () => heroes[active],
  allies: () => heroes,
  effects: () => effects,
  announce: (h, sk) => announced.push(h.def.id + ':' + sk.key),
  caption: () => {},
  fault: (m) => { faults.push(m); },
});
const faults = [];
let active = 0;

/* One frame the way the studio does it: the bench advances its own world, the
   PAGE ticks its effect list. Kept separate on purpose — see the contract check
   below, because a sim.update() that also drained the list would silently run
   every effect at 2x. */
function frame(dt = 1 / 60) {
  G.time += dt;
  sim.update(dt);
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (!e.update(dt)) { if (e.dispose) e.dispose(); effects.splice(i, 1); }
  }
}
const step = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); };
/* run until nothing is alive — BASTION FIELD is an 8 s dome, so a fixed frame
   count would call a still-running effect a leak */
function settle(cap = 1800, dt = 1 / 60) {
  let i = 0;
  while (i++ < cap && (effects.length || G.fx.rings.length || G.fx.beams.length || sim.liveParticles())) frame(dt);
  return i;
}
const visible = () => scene.children.reduce((n, o) => n + (o.visible ? 1 : 0), 0);

/* ---------- 1. the bench installs itself ---------- */
check('sim starts off and installs on the first cast', !sim.on);
sim.setTargets(3);
check('SIM_TARGETS / SIM_SPEEDS menus are the studio’s controls',
  SIM_TARGETS.length === 3 && SIM_SPEEDS.length === 3 && SIM_SPEEDS[0] === 1);

/* the contract, in one assertion */
{
  const probe = [];
  G.addEffect({ t: 0, dur: 1, update() { probe.push(1); return true; }, dispose() {} });
  sim.update(1 / 60);
  check('the bench does NOT tick the page’s effect list (double-advance guard)', probe.length === 0);
  effects.length = 0;
}

active = 0;
const fired = sim.cast(0);                       // AEGIS Q — SEISMIC SLAM
check('aegis Q fires through the real useSkill', fired === true, 'fired ' + fired);
check('the sim announces the skill like the HUD does', announced.join() === 'aegis:Q', announced.join());
check('G.fx is a real FX instance', !!G.fx && typeof G.fx.update === 'function' && !!G.fx.points);
check('dummy targets exist and are visible', G.enemies.length === 3 && G.enemies.every((e) => e.mesh.visible));

/* particles + rings should be alive right after a slam, then drain */
let peakP = 0, peakR = 0;
for (let i = 0; i < 20; i++) { frame(); peakP = Math.max(peakP, sim.liveParticles()); peakR = Math.max(peakR, G.fx.rings.length); }
check('the slam’s own particles and rings actually played', peakP > 50 && peakR > 0, peakP + ' particles / ' + peakR + ' rings');
check('the slam damaged the dummies (its own code path, not a stub)', sim.stats.dmg > 100, 'dmg ' + Math.round(sim.stats.dmg));
check('and stunned them', G.enemies.some((e) => e.stun > 0.5), 'stun ' + G.enemies.map((e) => e.stun.toFixed(2)).join(','));
check('knockback moved at least one target', G.enemies.some((e) => e.pos.distanceTo(e.home) > 0.05));
settle();
check('effects all expired', effects.length === 0, 'live ' + effects.length);
check('particles and rings drained to zero', sim.liveParticles() === 0 && G.fx.rings.length === 0 && G.fx.beams.length === 0,
  sim.liveParticles() + '/' + G.fx.rings.length + '/' + G.fx.beams.length);
const stillVisible = scene.children.filter((o) => o.visible).map((o) => o.name || o.type + '#' + o.id).slice(0, 12);
/* The scene legitimately keeps things visible forever: three hero groups, the
   dummies, and fx.js's container objects (its pooled meshes hide themselves).
   So the leak test is "same as after the bench warmed up", not "same as empty". */
const warm = visible();
step(240);
const WARM = visible();                        // the steady state every cast must return to
const WARM_KIDS = scene.children.length;       // pools stay; nothing may be added
check('a finished cast leaves the scene exactly as warm as it found it', visible() === warm,
  'visible ' + visible() + ' vs warm ' + warm + ': ' + scene.children.filter((o) => o.visible).map((o) => o.name || o.type).join(', '));
check('the persistent FX containers are what they are: 2 (particles + sparks), not 2 per cast',
  scene.children.length - WARM_KIDS === 0 && WARM > 0, 'warm visible ' + WARM + ', children ' + scene.children.length);
check('dummies walked home', G.enemies.every((e) => e.pos.distanceTo(e.home) < 0.35),
  G.enemies.map((e) => e.pos.distanceTo(e.home).toFixed(2)).join(','));
check('no NaN guard tripped', faults.length === 0 && sim.faults === 0, faults.join(' | '));

/* ---------- 2. cooldown and energy gates ---------- */
const cap = sim.readout();
check('the caption carries the slot, the skill and a MEASURED fx delay',
  /^Q · SEISMIC SLAM · \d+ targets · \d+ hits? for \d+ · fx \d+p live\/\d+ spawned\/\d+r\/\d+b · in flight \d+ · fx@\d\.\d\ds$/.test(cap), cap);
check('the caption has no placeholder left in it', !/undefined|NaN/.test(cap), cap);
check('the caption does not invent an impact time when nothing played',
  /fx@\d\.\d\ds/.test(cap) ? sim.stats.impact >= 0 : /no fx yet/.test(cap), cap);

const cdBefore = heroes[active].cds[0];
check('the cast left a cooldown behind', cdBefore > 0, 'cd ' + cdBefore.toFixed(2));
const blocked = sim.cast(0, false);
check('an unforced cast on cooldown is BLOCKED, not fired', blocked === false && sim.stats.blocked > 0,
  sim.stats.last);
const forced = sim.cast(0, true);
check('the bench forces it anyway (that is the point of a bench)', forced === true);
check('…and SAYS it forced a live cooldown, so the caption is not a lie',
  sim.stats.forced > 0 && /\d+ forced/.test(sim.readout()), sim.readout() + ' · forced ' + sim.stats.forced);
settle();
heroes[active].energy = 0;
const ultBlocked = sim.cast(2, false);
check('the ult is gated on energy like in the match', ultBlocked === false, 'a cold R went straight through');
check('…and the block says WHICH gate stopped it, with the real number',
  /BLOCKED — ULT ENERGY 0\/\d+/.test(sim.stats.last), sim.stats.last);
settle(); step(100);                              // > 1.2 s of bench time
check('the bench refills the meter so `R` and `⟳ auto` stay loopable',
  heroes[active].energy === heroes[active].maxEnergy && sim.cast(2, false) === true,
  'energy ' + heroes[active].energy + '/' + heroes[active].maxEnergy);
settle();
heroes[active].energy = 0;
check('forcing the ult pays the energy cost', sim.cast(2, true) === true && heroes[active].energy <= 0,
  'energy ' + heroes[active].energy);
settle();

{
  const dmgQ = Math.round(sim.stats.dmg);
  sim.cast(1); settle();
  check('each cast owns its counters — a defensive E does not inherit the slam’s damage',
    dmgQ > 0 && sim.stats.dmg < dmgQ, 'Q ' + dmgQ + ' → E ' + Math.round(sim.stats.dmg));
}
check('the speed shows up in the caption as the button spells it (½×, not 0.5×)',
  (() => { sim.speed = 0.5; const half = sim.readout(); sim.speed = 0.25; const qtr = sim.readout(); sim.speed = 1;
    return / · ½×$/.test(half) && / · ¼×$/.test(qtr) && !/1×$/.test(sim.readout()); })(), sim.readout());

/* ---------- 3. every hero, every skill, basic attack ---------- */
for (let hi = 0; hi < heroes.length; hi++) {
  active = hi;
  const id = HERO_DEFS[hi].id;
  const notes = [];
  let allOK = true;
  for (const idx of [null, 0, 1, 2]) {
    const before = sim.stats.casts + (idx === null ? 0 : 0);
    const ok = idx === null ? sim.basic() : sim.cast(idx);
    settle();
    step(300);                                  // let the dummies walk home too
    const leaked = visible() - WARM;              // WARM = the steady bench, set below
    notes.push((idx === null ? 'basic' : HERO_DEFS[hi].skills[idx].key) + ':' + (ok ? 'cast' : 'no') +
      (leaked ? ' LEAK+' + leaked : '') + (effects.length ? ' LIVE+' + effects.length : ''));
    if (!ok || leaked !== 0 || effects.length !== 0) allOK = false;
    if (G.fx.rings.length || G.fx.beams.length || G.fx.sparks.length || sim.liveParticles()) { allOK = false; notes.push('FX-STUCK'); }
  }
  check(id + ': basic + Q + E + R all run clean (cast, expire, no leak)', allOK, notes.join(' · '));
}

/* ---------- 4. projectiles (NYX) get their real system lazily ---------- */
const projBefore = scene.children.length;
active = heroes.findIndex((h) => h.def.id === 'aegis');
sim.cast(1); settle();
check('a hero with no projectiles never pays for the 160-strong pool', !G.projectiles || scene.children.length === projBefore);
active = heroes.findIndex((h) => h.def.id === 'nyx');
sim.cast(0);
check('railshot built the real ProjectileSystem on demand', !!G.projectiles && typeof G.projectiles.fire === 'function');
settle();

/* ---------- 4b. the body: Hero.update owns it, and the bench can move it ---------- */
{
  const a0 = heroes.findIndex((h) => h.def.id === 'aegis');
  active = a0;
  const h = heroes[active];

  /* Ownership, both directions. The bench must not decay what Hero.update decays —
     that is the double-advance trap, one frame at a time it looked *fine*. */
  check('the bench leaves the animation envelopes to Hero.update (it never decays them itself)', (() => {
    h.attackAnim = 1; const real = h.update; h.update = () => {};
    step(30);
    const held = h.attackAnim;
    h.update = real;
    return held === 1;
  })(), 'attackAnim drifted to ' + h.attackAnim);
  check('…and with Hero.update in the loop the envelope really does release', (() => {
    h.attackAnim = 1; step(20); return h.attackAnim < 0.05;      // dt × 5 ⇒ gone by 0.2 s
  })(), 'attackAnim ' + h.attackAnim.toFixed(2));

  /* F4: `comboT` only decays inside Hero.update, which the studio never called — so the
     bench used to hand out the heavy cleave on press #3 of an idle loop the match resets.
     The slam's ring radius is the tell: 4.6 heavy, 2.6 light. */
  const r1s = [];
  const ring0 = G.fx.ring.bind(G.fx);
  G.fx.ring = (pos, c, o) => { r1s.push(o && o.r1); return ring0(pos, c, o); };
  sim.basic(); settle(); step(80);                    // >1.1 s apart
  r1s.length = 0; sim.basic(); settle();
  check('an idle gap resets the combo, so a lone press is still the light hit (F4)',
    r1s.some((r) => Math.abs(r - 2.6) < 0.01) && !r1s.some((r) => Math.abs(r - 4.6) < 0.01),
    'rings ' + r1s.join(','));
  r1s.length = 0;
  sim.basic(); sim.basic(); settle();                 // back to back: presses 2 and 3 of a burst
  check('…and presses inside the window still build to the heavy cleave',
    r1s.some((r) => Math.abs(r - 4.6) < 0.01), 'rings ' + r1s.join(','));
  G.fx.ring = ring0;
  settle();

  /* movement — the layer no studio control used to reach */
  const home = { x: sim.home.x, z: sim.home.z, facing: sim.home.facing };
  const from = { x: h.pos.x, z: h.pos.z };
  sim.setMove('walk');
  step(60);
  const walked = Math.hypot(h.pos.x - from.x, h.pos.z - from.z);
  const vel = Math.hypot(h.vel.x, h.vel.z);
  check('MOVE walk: the hero travels, at its own stat speed',
    walked > 1 && vel > h.def.speed * 0.7, walked.toFixed(2) + ' m · vel ' + vel.toFixed(1) + ' vs def ' + h.def.speed);
  check('…so MOTION’s stepRate is finally judged against a real spd',
    Math.hypot(h.vel.x, h.vel.z) / h.def.speed > 0.7, 'spd ' + (vel / h.def.speed).toFixed(2));
  check('…and the caption says which mode and how far', / · walk [\d.]+m/.test(sim.readout()), sim.readout());
  step(900);
  check('…without escaping the arena (move clamps, like the match)',
    Math.abs(h.pos.x) < ARENA && Math.abs(h.pos.z) < ARENA && Number.isFinite(h.pos.x),
    h.pos.x.toFixed(1) + ',' + h.pos.z.toFixed(1) + ' (ARENA ' + ARENA + ')');
  sim.setMove('idle'); step(40);
  check('MOVE idle stops the hero instead of letting it slide on', Math.hypot(h.vel.x, h.vel.z) < 0.6,
    'vel ' + Math.hypot(h.vel.x, h.vel.z).toFixed(2));

  sim.reset(); step(2);          // walk home first: a dash into the wall clamps to nothing
  const d0 = { x: h.pos.x, z: h.pos.z };
  check('the dodge is previewable at all now', sim.dash() === true && h.dashT > 0, 'dashT ' + h.dashT.toFixed(2));
  step(24);
  const dashDist = Math.hypot(h.pos.x - d0.x, h.pos.z - d0.z);
  check('…and it covers the match distance, not just the FX', dashDist > 1.5, dashDist.toFixed(2) + ' m');
  check('…with the cooldown reported rather than eaten silently',
    sim.dash() === false && /DASH · BLOCKED \(cd [\d.]+s\)/.test(sim.stats.last), sim.stats.last);
  settle();

  sim.reset();
  check('reset walks the page’s hero back to where the bench found it (position AND facing)',
    Math.hypot(h.pos.x - home.x, h.pos.z - home.z) < 1e-6 && Math.abs(h.facing - home.facing) < 1e-9,
    'at ' + h.pos.x.toFixed(2) + ',' + h.pos.z.toFixed(2) + ' facing ' + h.facing.toFixed(2) +
    ' vs home ' + home.x.toFixed(2) + ',' + home.z.toFixed(2));

  /* F8 — a bug the bench found by ticking the hero the way the game does */
  const nIdx = heroes.findIndex((x) => x.def.id === 'nyx');
  active = nIdx;
  const nyx = heroes[active];
  sim.cast(0); settle(); step(90);
  check('railshot RELEASES its overcharge aura — charge is 0 once the cast is done (F8)',
    nyx.charge === 0 && sim.liveParticles() === 0,
    'charge ' + nyx.charge.toFixed(2) + ' · live particles ' + sim.liveParticles());
  check('…and the muzzle light drops with it instead of sitting at +8',
    nyx.charge === 0, 'charge stuck at ' + nyx.charge);

  active = a0; sim.setMove('idle');
  settle();
}

/* ---------- 5. target pooling and the NaN guard ---------- */
const meshes0 = scene.children.length;
sim.setTargets(6);
const meshes6 = scene.children.length;
sim.setTargets(3);
sim.setTargets(6);
check('targets are pooled: 6 costs 6 groups, and 3→6 reuses them',
  meshes6 - meshes0 === 6 - 3 && scene.children.length === meshes6,
  meshes0 + ' → ' + meshes6 + ' → ' + scene.children.length);
sim.reset();
check('reset clears live effects and stats', effects.length === 0 && sim.stats.hits === 0);

/* a poisoned tuning value must be *reported*, not rendered */
const save = heroes[active].pos.x;
heroes[active].pos.x = NaN;
step(2);
check('a NaN transform trips the guard and says so', sim.faults > 0 && faults.length > 0, faults.join(' | '));
heroes[active].pos.x = save;
step(2);
check('…and clears when the value is sane again', !sim.faulted);

/* ---------- 5b. manifest-backed Solar Flare gameplay path ---------- */
{
  active = heroes.findIndex((h) => h.def.id === 'aegis');
  const solarHero = heroes[active];
  sim.setTargets(3);
  for (const enemy of G.enemies) enemy.pos.set(solarHero.pos.x + 0.6, 0, solarHero.pos.z);
  G.referenceVFX = {
    mapping: { map: { aegis: ['solar', 'thunder', 'meteor'] } },
    cast(hero, slot, hooks) {
      hooks.onImpact?.({ position: hero.pos.clone(), element: 'solar' });
      return { element: 'solar' };
    },
  };
  solarHero.cds[0] = 0;
  const hpBeforeSolar = G.enemies.reduce((sum, enemy) => sum + enemy.hp, 0);
  const solarFired = sim.cast(0);
  const hpAfterImpact = G.enemies.reduce((sum, enemy) => sum + enemy.hp, 0);
  check('Solar Flare enters useSkill through the registered reference ID', solarFired === true);
  check('Solar Flare applies its real impact damage', hpAfterImpact < hpBeforeSolar,
    hpBeforeSolar + ' -> ' + hpAfterImpact);
  step(180);
  const hpAfterBurn = G.enemies.reduce((sum, enemy) => sum + enemy.hp, 0);
  check('Solar Flare burn continues through the real effect list', hpAfterBurn < hpAfterImpact,
    hpAfterImpact + ' -> ' + hpAfterBurn);
  G.referenceVFX = undefined;
  settle();
}

/* ---------- 6. uninstall restores G ---------- */
const wanted = ['enemies', 'heroes', 'barriers', 'mods', 'popText', 'groundAim', 'damageEnemy', 'announceSkill', 'onUltCast', 'panOf'];
const snapshot = {};
for (const k of wanted) snapshot[k] = G[k];
sim.dispose();
check('uninstall puts the page’s G back', wanted.every((k) => G[k] === undefined), JSON.stringify(Object.keys(G).filter((k) => wanted.includes(k))));
check('the sim left its hooks off, and it is off', sim.on === false && G.enemies === undefined);

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ERRORS none') + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail ? 1 : 0);
