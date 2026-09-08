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
  const p0 = hero.pos.clone(); sim.cast(0); tick(30);
  const moved = Math.hypot(hero.pos.x - p0.x, hero.pos.z - p0.z);
  info('bench travel during Q = ' + moved.toFixed(2) + ' m');
  info('the match moves AEGIS 1.18 m in the same cast (heroes.js:297), and Hero.playFX anchors the');
  info('prop at the CAST position (heroes.js:1297) → in play a ground FX lands ~1.2 m behind the slam (F3)');
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
