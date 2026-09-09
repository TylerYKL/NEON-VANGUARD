/* ============================================================
   HERO FIT CHECK — the "only the upper half shows" regression.
   A rebuilder that exports a model with its pivot at the body centre
   (which is what models/uploads/*.glb are) needs normalizeToStage() to
   lift the root by half its height, and every consumer that writes
   root.position afterwards must keep that lift. Hero.animateGLB() owns
   the body position every frame, so it carries both the lift and the
   size multiplier; when it did not, AEGIS / NYX / LYRA stood with 1.2 m
   of their 2.4 m body under the deck plate.

   This walks the real committed GLBs through the real game pipeline —
   parse -> normalise -> Hero.build -> animateGLB — and asserts the feet
   land on y = 0 with the whole body above it, at default tuning, at
   non-default size, and while walking. No browser, no WebGL.

     node tools/herofit.mjs
   ============================================================ */
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

/* GLTFLoader wants a DOM to decode textures; hand it a lazy fake so the
   geometry / materials still load (maps fail to upload, which is fine here). */
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: (ns, tag) => (tag === 'canvas' ? { width: 0, height: 0, style: {} } : {}) };
globalThis.Image = class { set src(v) { this.width = this.height = 4; this.onload && this.onload(); } };

const UP = 'models/uploads';
const dir = new URL('../', import.meta.url).pathname;
const files = fs.existsSync(path.join(dir, UP))
  ? fs.readdirSync(path.join(dir, UP)).filter((f) => f.toLowerCase().endsWith('.glb'))
  : [];
if (!files.length) {
  console.log('HEROFIT skipped — no .glb files in ' + UP + ' (procedural rigs only, nothing to measure).');
  process.exit(0);
}

const { parseGLB, normalizeToStage } = await import('../src/gltfutil.js');
const { Hero, HERO_DEFS } = await import('../src/heroes.js');
const { clampFX } = await import('../src/fxpack.js');

let pass = 0, fail = 0;
const check = (name, cond, note) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (note ? '  -> ' + note : '')); }
};

/* exactly what ensureGLBSkins() does with an uploaded file */
const skins = {};
for (const f of files) {
  const buf = fs.readFileSync(path.join(dir, UP, f));
  const gltf = await parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const root = gltf.scene || gltf.scenes[0];
  const n = normalizeToStage(root, 2.4);
  root.scale.setScalar(n.scale);
  const id = f.replace(/\.glb$/i, '');
  skins[id] = { template: root, yaw: id === 'lyra' ? -Math.PI / 2 : 0 };
  console.log('  ' + f.padEnd(12) + 'raw size ' + n.before.join(' x ') + ' -> centring lift ' +
    n.lift.toFixed(3) + ' m, scale ' + n.scale.toFixed(3) + ', fitted height ' + n.height.toFixed(2) + ' m');
}

const SIZE = 2.4;
const tuning = (id, scale, pos) => ({
  [id]: {
    scale: scale || 1, motion: {}, pos: pos || { x: 0, y: 0, z: 0 }, yawDeg: 0,
    fx: null, fxOn: true, fxP: clampFX(null, 'glb'), fxSlots: [null, null, null],
  },
});
function stand(id, tun, frames) {
  const def = HERO_DEFS.find((d) => d.id === id);
  if (!def) return null;
  const G = { scene: new THREE.Scene(), glbSkins: skins, time: 0, addEffect: () => {}, glbTuning: tun };
  const hero = new Hero(def, G, 0);
  if (!hero.rig.glb) return null;                       // no matching upload for this hero
  for (let i = 0; i < (frames || 1); i++) hero.animateGLB(1 / 60, { time: i / 60 }, frames ? 1 : 0);
  hero.group.updateMatrixWorld(true);
  return { hero, box: new THREE.Box3().setFromObject(hero.body) };
}

for (const id of Object.keys(skins)) {
  const idle = stand(id, tuning(id));
  if (!idle) { console.log('  (skipped ' + id + ' — not one of the six hero ids)'); continue; }
  check(id + ': default tuning stands on the deck', Math.abs(idle.box.min.y) < 0.02,
    'feet y = ' + idle.box.min.y.toFixed(3) + ' (a buried hero reads -1.20)');
  check(id + ': whole body above the deck', Math.abs(idle.box.max.y - SIZE) < 0.05,
    'head y = ' + idle.box.max.y.toFixed(2));
  const c = new THREE.Vector3();
  idle.box.getCenter(c);
  check(id + ': centred on X and Z', Math.abs(c.x) < 0.02 && Math.abs(c.z) < 0.02,
    'x ' + c.x.toFixed(3) + ' z ' + c.z.toFixed(3));
  const big = stand(id, tuning(id, 1.35));
  check(id + ': SIZE 1.35 keeps the feet planted (base rides with the scale)',
    Math.abs(big.box.min.y) < 0.02 && big.box.max.y > SIZE * 1.3,
    'feet ' + big.box.min.y.toFixed(3) + ', height ' + (big.box.max.y - big.box.min.y).toFixed(2));
  const moved = stand(id, tuning(id, 1, { x: 0.5, y: 0.3, z: -0.25 }));
  check(id + ': studio X/Y/Z nudge the body, they do not re-place it',
    Math.abs(moved.box.min.y - 0.3) < 0.02 && Math.abs(moved.hero.body.position.x - (skins[id].template.position.x + 0.5)) < 0.02,
    'y ' + moved.box.min.y.toFixed(3) + ' x ' + moved.hero.body.position.x.toFixed(3));
  const walked = stand(id, tuning(id), 90);
  check(id + ': 90 frames of walking never dip under the deck', walked.box.min.y > -0.06,
    'lowest y while walking ' + walked.box.min.y.toFixed(3));
}

console.log('\nHEROFIT ' + (fail ? fail + ' FAILURES' : 'done — every uploaded hero stands fully on the deck') +
  '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail ? 1 : 0);
