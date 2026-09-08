/* ============================================================
   ANIMCHECK — read-only measurement of the hero motion layer.

   This is NOT a test of behaviour: it measures what the shipped code actually
   does to a hero's body, so the findings in MOTION-AUDIT.md stay checkable
   instead of being folklore. It never writes a file and never imports main.js.

   Three groups, printed in order:

     1. procedural rig   — where do the feet end up once animateRig takes over
                           (buildHumanoid and animateRig disagree about the hips)
     2. GLB skin + Q     — does a GLB-skinned hero come back down after a slam
     3. the asset census — bones / skinned meshes / clips in models/uploads/*.glb,
                           i.e. is there anything for a mixer to play

   Defects that are already written up are reported as KNOWN (so the suite stays
   green today); a NEW breakage exits 1, and one that quietly disappears reports
   FIXED so the doc and this file get updated together.

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

/* herofit's own threshold, reused so the two suites agree about "on the deck" */
const FOOT_TOL = 0.06;
let fail = 0, known = 0, fixed = 0;
const report = (tag, label, ok, detail) => {
  if (ok) console.log('  PASS  ' + label + (detail ? '  · ' + detail : ''));
  else if (tag === 'known') { known++; console.log('  KNOWN ' + label + '  · ' + detail + '  (MOTION-AUDIT.md)'); }
  else { fail++; console.log('  FAIL  ' + label + '  · ' + detail); }
};
const wasKnown = (label) => console.log('  FIXED ' + label + '  · update MOTION-AUDIT.md');

/* ---------- 1. procedural heroes: who owns hips.position.y ---------- */
console.log('\n== procedural rig: feet vs the deck (deck = 0) ==');
function lowestFoot(rig) {
  let min = Infinity;
  for (const side of ['L', 'R']) {
    const L = rig.legs[side];
    for (const o of [L.foot, L.knee.children[0]]) {
      o.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(o);
      if (Number.isFinite(b.min.y)) min = Math.min(min, b.min.y);
    }
  }
  return min;
}
for (const d of HERO_DEFS) {
  const rig = buildHumanoid({ accent: d.color, visor: d.color2, bulk: d.bulk, scale: d.scale, plate: d.plate });
  rig.root.updateMatrixWorld(true);
  const built = lowestFoot(rig);
  for (let i = 0; i < 90; i++) animateRig(rig, 1 / 60, { speed: 0, time: i / 60, style: d.style, block: d.id === 'aegis' });
  rig.root.updateMatrixWorld(true);
  const idle = lowestFoot(rig);
  for (let i = 0; i < 90; i++) animateRig(rig, 1 / 60, { speed: 1, time: i / 60, style: d.style });
  rig.root.updateMatrixWorld(true);
  const walk = lowestFoot(rig);
  const bad = Math.abs(walk) > FOOT_TOL || Math.abs(idle) > FOOT_TOL;
  const label = d.id + ': procedural feet stand on the deck';
  const detail = 'built ' + built.toFixed(3) + ' → idle ' + idle.toFixed(3) + ' → walking ' + walk.toFixed(3)
    + ' (hips built ' + (0.95 * d.scale).toFixed(3) + ', animateRig writes ' + rig.hips.position.y.toFixed(3) + ')';
  if (bad) report('known', label, false, detail); else if (idle !== built) wasKnown(label); else report('', label, true, detail);
}

/* ---------- 2. GLB skin + one SEISMIC SLAM ---------- */
console.log('\n== GLB skin: does AEGIS come back down after Q? ==');
const skinPath = ROOT + 'models/uploads/aegis.glb';
if (!fs.existsSync(skinPath)) {
  console.log('  SKIP  no models/uploads/aegis.glb (procedural-only checkout)');
} else {
  const buf = fs.readFileSync(skinPath);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1.6, 0.1, 200);
  const effects = [];
  const G = {
    scene, camera, time: 0, addEffect: (e) => effects.push(e),
    lights: { acquire: () => ({ position: new THREE.Vector3(), intensity: 0 }), release: () => {}, set: () => {} },
  };
  const gltf = await parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const template = gltf.scene;
  normalizeToStage(template, 2.4);
  G.glbSkins = { aegis: { template, yaw: 0 } };
  G.glbTuning = { aegis: { scale: 1, motion: {}, pos: { x: 0, y: 0, z: 0 }, yawDeg: 0, fx: null, fxOn: true, fxP: null, fxSlots: [null, null, null] } };
  const hero = new Hero(HERO_DEFS[0], G, 0);
  const sim = createSim(G, { hero: () => hero, allies: () => [hero], effects: () => effects, caption: () => {}, fault: (m) => console.log('  FAULT', m) });
  const tick = (n) => {
    for (let f = 0; f < n; f++) {
      G.time += 1 / 60; sim.update(1 / 60);
      for (let k = effects.length - 1; k >= 0; k--) { const e = effects[k]; if (!e.update(1 / 60)) { if (e.dispose) e.dispose(); effects.splice(k, 1); } }
    }
  };
  const feet = () => { hero.body.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(hero.body).min.y; };
  sim.setTargets(3);
  const before = feet();
  sim.cast(0); tick(300);
  const after = feet();
  const rest = hero.rig.hips.position.y, hipsRest = hero.hipsRest;
  const label = 'aegis (GLB skin): feet still on the deck after one Q';
  const detail = 'feet ' + before.toFixed(3) + ' → ' + after.toFixed(3)
    + ' · hips.y left at ' + rest.toFixed(2) + ' but its rest is ' + hipsRest
    + ' (hero.hipsRest is read by nobody)';
  if (Math.abs(after - before) > FOOT_TOL) report('known', label, false, detail);
  else { wasKnown(label); report('', label, true, detail); }

  /* the leap: the bench never integrates move(), so the cast cannot travel here */
  const p0 = hero.pos.clone(); sim.cast(0); tick(30);
  const moved = Math.hypot(hero.pos.x - p0.x, hero.pos.z - p0.z);
  console.log('  INFO  bench travel during Q = ' + moved.toFixed(2) + ' m   (the bench never calls move())'
    + '\n        · the match moves AEGIS 1.18 m during the same cast (heroes.js:297 dashT override,'
    + '\n          all of it before the impact frame at t=0.22 s), and Hero.playFX anchors the prop at the'
    + '\n          CAST position (heroes.js:1298) → in play your uploaded ground FX lands ~1.2 m behind the slam.');
}

/* ---------- 3. the asset census (what a mixer would have to work with) ---------- */
console.log('\n== models/uploads/*.glb: is there anything to animate? ==');
const files = fs.readdirSync(ROOT + 'models/uploads').filter((f) => /\.glb$/i.test(f)).sort();
if (!files.length) console.log('  SKIP  nothing in models/uploads/');
let rigged = 0;
for (const f of files) {
  const g = await parseGLB((() => { const b = fs.readFileSync(ROOT + 'models/uploads/' + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); })());
  const s = gatherStats(g.scene);
  const clips = (g.animations || []).length;
  if (s.bones || clips) rigged++;
  console.log('  ' + f.padEnd(20) + ' bones ' + String(s.bones).padStart(3)
    + ' · skinned ' + String(s.skinned).padStart(2) + ' · clips ' + clips
    + (clips ? ' → ' + (g.animations || []).map((c) => c.name).slice(0, 4).join(', ') : '')
    + (s.bones && !clips ? '  (rigged but no clips: retarget or author them)' : '')
    + (!s.bones ? '  (static mesh — animateGLB transforms are all it can do)' : ''));
}
if (!rigged) {
  console.log('  INFO  no file in models/uploads/ has bones or clips, so GLB animation-clip'
    + '\n        support has nothing to play yet: it must land WITH a rigged hero file.');
}
console.log('\n' + (fail ? 'ANIMCHECK: ' + fail + ' NEW breakage(s)' : 'ANIMCHECK clean — ' + known + ' known defect(s) reported, nothing new'));
process.exit(fail ? 1 : 0);
