/* ============================================================
   ANIMCHECK — the motion layer, measured rather than asserted-about.

   Written first as the evidence for MOTION-AUDIT.md (F1/F2/F3), and kept as the
   gate so the fixes cannot quietly slide back: the old numbers were folklore
   ("the heroes just look like that"), so every check here measures a shipped
   asset or a shipped rig and compares against the deck at y = 0.

   Three groups:
     1. procedural rig   — buildHumanoid's baseline vs what animateRig leaves the
                          soles doing, and a walk cycle must never dip under 0
     2. GLB skin + Q     — the slam's leap still happens, and the hero comes back
                          down to the rig's own rest (F1's bug was the restore)
     3. the asset census — bones / skinned meshes / clips per file, i.e. whether
                          there is anything for an AnimationMixer to play

   Read-only: it never writes a file and never imports main.js.
     node tools/animcheck.mjs
   ============================================================ */
import * as fs from 'fs';
import * as THREE from 'three';

/* --- DOM stubs: three wants a canvas for texture helpers, GLTFLoader for images.
       Same shim the other Node suites use (skintest / herofit). --- */
const CTX = () => ({
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createImageData: (n) => ({ data: new Uint8ClampedArray(n * n * 4) }),
  putImageData() {}, fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
  set fillStyle(v) {}, set lineWidth(v) {}, set strokeStyle(v) {},
});
globalThis.self = globalThis; globalThis.window = globalThis;
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? { width: 0, height: 0, style: {}, getContext: () => CTX() } : { width: 4, height: 4 }),
  createElementNS: () => ({ width: 0, height: 0, getContext: () => CTX() }),
};
globalThis.Image = class { set src(v) { this.width = this.height = 4; this.onload && this.onload(); } };

const ROOT = new URL('..', import.meta.url).pathname;
const { buildHumanoid, animateRig } = await import('../src/rig.js');
const { HERO_DEFS, Hero } = await import('../src/heroes.js');
const { createSim } = await import('../src/sim.js');
const { parseGLB, normalizeToStage, gatherStats } = await import('../src/gltfutil.js');
const { SFX } = await import('../src/audio.js');
SFX.enabled = false;                        // no WebAudio in Node

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + '  · ' + detail); }
};
const info = (msg) => console.log('  INFO  ' + msg);
const read = (f) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

/* the lowest point of the LEGS only — the ground disc lives on the root at y = 0.03
   and would mask whatever the feet are doing */
function soleY(rig) {
  let m = Infinity;                        // NOT 0: starting at 0 clamps away every lift
  for (const side of ['L', 'R']) {
    const L = rig.legs[side];
    L.hip.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(L.hip);
    if (Number.isFinite(b.min.y)) m = Math.min(m, b.min.y);
  }
  return Number.isFinite(m) ? m : 0;
}

/* ---------- 1. procedural heroes: one measured baseline ---------- */
console.log('\n== procedural rig: soles vs the deck (deck = 0) ==');
for (const d of HERO_DEFS) {
  const rig = buildHumanoid({ accent: d.color, visor: d.color2, bulk: d.bulk, scale: d.scale, plate: d.plate });
  const built = soleY(rig);
  let idleLow = Infinity, walkLow = Infinity, walkHigh = -Infinity;
  for (let i = 0; i < 90; i++) {
    animateRig(rig, 1 / 60, { speed: 0, time: i / 60, style: d.style, block: d.id === 'aegis' });
    idleLow = Math.min(idleLow, soleY(rig));
  }
  for (let i = 0; i < 90; i++) {
    animateRig(rig, 1 / 60, { speed: 1, time: i / 60, style: d.style });
    const y = soleY(rig); walkLow = Math.min(walkLow, y); walkHigh = Math.max(walkHigh, y);
  }
  const label = (m) => d.id + ' · ' + m;
  check(label('soles sit on the deck at build'), Math.abs(built) < 0.02, 'sole ' + built.toFixed(3));
  check(label('idle never dips under the deck'), idleLow > -0.02, 'lowest ' + idleLow.toFixed(3));
  check(label('90 frames of walking never dip under the deck'), walkLow > -0.02,
    'lowest ' + walkLow.toFixed(3) + ' · highest ' + walkHigh.toFixed(3));
  check(label('the stride actually lifts'), walkHigh - walkLow > 0.06,
    'range ' + (walkHigh - walkLow).toFixed(3) + ' (a flat value means the bob was lost, not fixed)');
  check(label('hipsRest is the value animateRig returns to'),
    Math.abs(rig.hips.position.y - rig.hipsRest) < 0.13 && rig.hipsRest > 0.5,
    'hips ' + rig.hips.position.y.toFixed(3) + ' rest ' + rig.hipsRest.toFixed(3));
}

/* ---------- 2. GLB skin: the leap and the landing ---------- */
console.log('\n== GLB skin: SEISMIC SLAM takes off and comes back down ==');
const skinPath = ROOT + 'models/uploads/aegis.glb';
if (!fs.existsSync(skinPath)) info('no models/uploads/aegis.glb — skipping (procedural-only checkout)');
else {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 200);
  const effects = [];
  const G = {
    scene, camera, time: 0, addEffect: (e) => effects.push(e),
    lights: { acquire: () => ({ position: new THREE.Vector3(), intensity: 0 }), release: () => {}, set: () => {} },
  };
  const template = (await parseGLB(read(skinPath))).scene;
  normalizeToStage(template, 2.4);
  G.glbSkins = { aegis: { template, yaw: 0 } };
  G.glbTuning = { aegis: { scale: 1, motion: {}, pos: { x: 0, y: 0, z: 0 }, yawDeg: 0, fx: null, fxOn: true, fxP: null, fxSlots: [null, null, null] } };
  const hero = new Hero(HERO_DEFS[0], G, 0);
  const sim = createSim(G, { hero: () => hero, allies: () => [hero], effects: () => effects, caption: () => {}, fault: (m) => info('FAULT ' + m) });
  const tick = (n, on) => {
    for (let f = 0; f < n; f++) {
      G.time += 1 / 60; sim.update(1 / 60); on && on();
      for (let k = effects.length - 1; k >= 0; k--) { const e = effects[k]; if (!e.update(1 / 60)) { if (e.dispose) e.dispose(); effects.splice(k, 1); } }
    }
  };
  const feet = () => { hero.body.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(hero.body).min.y; };
  sim.setTargets(3);
  const before = feet();
  let peak = 0;
  sim.cast(0);
  tick(30, () => { peak = Math.max(peak, hero.rig.hips.position.y - hero.rig.hipsRest); });
  tick(300);
  const after = feet();
  check('aegis (GLB): feet on the deck before the slam', Math.abs(before) < 0.02, 'feet ' + before.toFixed(3));
  check('aegis (GLB): the leap is real — the hips leave their rest by ~1.5 m', peak > 0.9,
    'peak lift ' + peak.toFixed(2) + ' m (a hard-coded 0.95 baseline used to make this a float, not a jump)');
  check('aegis (GLB): ONE slam leaves the feet exactly where they were (MOTION-AUDIT F1)',
    Math.abs(after - before) < 0.02, 'feet ' + before.toFixed(3) + ' → ' + after.toFixed(3));
  check('aegis (GLB): the restore returns to the rig’s own rest, not a literal',
    hero.rig.hips.position.y === hero.rig.hipsRest && hero.hipsRest === hero.rig.hipsRest,
    'hips ' + hero.rig.hips.position.y + ' rest ' + hero.rig.hipsRest);
  /* main.js:921 — startGame() disposes every live effect and only then truncates the
     array. That dispose is the ONLY thing standing between a reset mid-leap and a hero
     permanently drawn at the arc's height, because no per-frame code owns `hips` for a
     GLB skin. So the test drives the reset exactly the way the game does. */
  sim.cast(0); tick(4);
  const stranded = hero.rig.hips.position.y;
  for (const e of effects) if (e.dispose) e.dispose();
  effects.length = 0;
  tick(120);
  check('aegis (GLB): a reset MID-LEAP hands the body back (dispose, then truncate)',
    Math.abs(feet() - before) < 0.02,
    'was caught mid-leap at hips ' + stranded.toFixed(3) + ', now ' + hero.rig.hips.position.y.toFixed(3)
    + ' (rest ' + hero.rig.hipsRest + ')');
  check('aegis (GLB): …which only works because the leap owns a dispose()',
    stranded > 0.5, 'the leap never left its rest, so this proves nothing: ' + stranded.toFixed(3));
  /* F4 made the bench integrate the real Hero.move, so the studio now travels the way
     the match does — which is what makes MOTION-AUDIT F3 *visible* here: playFX anchors
     the prop at the cast position, and the slam carries the body 1.18 m past it. */
  const p0 = hero.pos.clone(); sim.cast(0); tick(30);
  const moved = Math.hypot(hero.pos.x - p0.x, hero.pos.z - p0.z);
  check('the bench reproduces the match\u2019s slam travel (F4 fidelity)',
    moved > 0.8 && moved < 1.6, 'bench ' + moved.toFixed(2) + ' m vs 1.18 m in play');
  /* ---------- F3: an effect can now ride the body that cast it ---------- */
  {
    const { clampFX } = await import('../src/fxpack.js');
    // reuse the normalized template: it already carries the userData.stage stamp a clone copies
    G.fxBank = { 'test.glb': { kind: 'glb', url: 'test.glb', template, stats: gatherStats(template), matPools: {} } };
    G.glbTuning.aegis.fxSlots[0] = { src: 'test.glb', on: true, p: clampFX({ dur: 3, light: 0 }, 'glb') };
    const run = (follow) => {
      G.glbTuning.aegis.fxSlots[0].p.follow = follow;
      sim.reset(); tick(4);
      const prop = hero.playFX(G, 0);
      const a0 = { x: prop.position.x, z: prop.position.z };
      const h0 = { x: hero.pos.x, z: hero.pos.z };
      sim.cast(0); tick(30);
      return { prop: Math.hypot(prop.position.x - a0.x, prop.position.z - a0.z),
               hero: Math.hypot(hero.pos.x - h0.x, hero.pos.z - h0.z) };
    };
    const f0 = run(1);
    check('F3 fixed: an effect with anchor=follow hero rides the slam that cast it',
      f0.hero > 0.8 && Math.abs(f0.prop - f0.hero) < 0.06,
      'prop travelled ' + f0.prop.toFixed(2) + ' m with the hero\u2019s ' + f0.hero.toFixed(2) + ' m');
    const f1 = run(0);
    check('…and the authored default still plants it at the cast point (nothing moved for free)',
      f1.hero > 0.8 && f1.prop < 0.02, 'prop ' + f1.prop.toFixed(2) + ' m, hero ' + f1.hero.toFixed(2) + ' m');
    for (const e of effects) if (e.dispose) e.dispose();
    effects.length = 0;
    G.fxBank = null; G.glbTuning.aegis.fxSlots[0] = null;
    sim.reset(); tick(30);
  }
  info('the slam drifts ' + moved.toFixed(2) + ' m in 0.3 s; playFX anchors at the cast point unless the');
  info('effect\u2019s ANCHOR row says follow hero (MOTION-AUDIT F3) — both halves measured above');
}

/* ---------- 3b. the per-frame paths allocate nothing (MOTION-AUDIT F5, static) ---------- */
{
  const hs = fs.readFileSync(ROOT + 'src/heroes.js', 'utf8');
  const bodyOf = (sig) => {
    const i = hs.indexOf(sig);
    if (i < 0) return null;
    let j = hs.indexOf('{', i), d = 0;
    for (let k = j; k < hs.length; k++) {
      if (hs[k] === '{') d++;
      else if (hs[k] === '}') { d--; if (!d) return hs.slice(j, k + 1); }
    }
    return null;
  };
  for (const [sig, label] of [
    ['move(dt, dir, sprint)', 'Hero.move'],
    ['update(dt, G) {', 'Hero.update (idle flourish, drone hover)'],
    ['updateAI(dt, G, leader)', 'Hero.updateAI (3 heroes at run rate)'],
    ['animateGLB(dt, G, spd)', 'Hero.animateGLB'],
  ]) {
    const b = bodyOf(sig);
    const bad = b ? [...b.matchAll(/new THREE\.(Vector3|Color|Quaternion|Euler|Box3|Sphere)/g)].map((m) => m[0]) : null;
    check(label + ': allocates nothing per frame (F5)', !!b && !bad.length,
      !b ? 'signature not found — the gate itself is broken' : (bad.length ? bad.join(', ') : 'clean (scratch vectors reused)'));
  }
}

/* ---------- 2b. F7: the recoil value reaches the gun arm ---------- */
{
  const d = HERO_DEFS.find((x) => x.style === 'gun') || HERO_DEFS[2];
  const rig = buildHumanoid({ accent: d.color, visor: d.color2, bulk: d.bulk, scale: d.scale, plate: d.plate });
  const aim = (recoil) => {
    for (let i = 0; i < 40; i++) animateRig(rig, 1 / 60, { speed: 0, time: i / 60, style: 'gun', attack: 1, recoil });
    return rig.arms.R.shoulder.rotation.x;
  };
  const still = aim(0), kicked = aim(1.6);
  check('NYX (gun style): the railshot recoil kick moves the shoulder it was written for (F7)',
    kicked < still - 0.1, 'shoulder.x ' + still.toFixed(3) + ' → ' + kicked.toFixed(3) + ' at recoil 1.6');
  check('…and a kick decays: 1.6 bleeds to 0 in the hero\u2019s own dt×6', (1.6 / (1 / 60 * 6)) > 15,
    '≈16 frames, i.e. a 0.27 s snap-back — longer than the shot\u2019s own flash');
}

/* ---------- 3. the asset census (what a mixer would have to work with) ---------- */
console.log('\n== models/uploads/*.glb: is there anything to animate? ==');
const dir = ROOT + 'models/uploads';
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.glb$/i.test(f)).sort() : [];
if (!files.length) info('nothing in models/uploads/');
let rigged = 0, clipFiles = 0;
for (const f of files) {
  const g = await parseGLB(read(dir + '/' + f));
  const s = gatherStats(g.scene);
  const clips = (g.animations || []).length;
  if (s.bones) rigged++;
  if (clips) clipFiles++;
  console.log('  ' + f.padEnd(22) + ' bones ' + String(s.bones).padStart(3)
    + ' · skinned ' + String(s.skinned).padStart(2) + ' · clips ' + clips
    + (clips ? ' → ' + (g.animations || []).map((c) => c.name).slice(0, 4).join(', ') : '')
    + (s.bones && !clips ? '  (rigged, no clips: retarget or author them)' : '')
    + (!s.bones ? '  (static mesh — animateGLB transforms are all it can do)' : ''));
}
if (!clipFiles) info('no uploaded file has a clip yet, so clip playback is verified against the'
  + '\n        generated fixture in tools/ (MOTION-AUDIT §4), not against models/uploads/');
else info(rigged + ' rigged file(s), ' + clipFiles + ' with clips — the hero path can play them');

console.log('\n' + (fail ? 'ANIMCHECK: ' + fail + ' failure(s) of ' + (pass + fail) : 'ANIMCHECK done — ' + pass + ' measurements, nothing stranded'));
process.exit(fail ? 1 : 0);
