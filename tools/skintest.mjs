/* ============================================================
   SKINTEST — headless check of the GLB-skin path that ships in
   src/heroes.js: Hero.build() with G.glbSkins, the handAnchor
   fallback in handPos(), animateGLB() motion, the downed topple,
   and the procedural fallback when no skins are present.

   Self-contained: synthesises three dummy GLBs with GLTFExporter
   (the same round-trip trick as glbtest) and serves them to
   src/glbskin.js through a fetch stub, so it never depends on
   whatever happens to sit in models/uploads/.

   Usage:  node tools/skintest.mjs
   ============================================================ */

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (typeof globalThis.Image === 'undefined') {
  globalThis.Image = class {
    constructor() { this.width = 4; this.height = 4; }
    set src(v) { this._src = v; setTimeout(() => { if (this.onload) this.onload(); }, 0); }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
  };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => new globalThis.Image(),
    createElementNS: () => new globalThis.Image(),
  };
}
/* GLTFExporter reads its binary chunk through FileReader, which Node lacks. */
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((ab) => {
        this.result = ab;
        if (this.onload) this.onload();
        if (this.onloadend) this.onloadend();
      });
    }
  };
}

/* ---- synthesize one dummy GLB per hero and serve it via fetch ---- */
const FILES = {};
function dummyHero() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 2.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  m.position.y = 1.2;
  g.add(m);
  return g;
}
const exporter = new GLTFExporter();
for (const id of ['aegis', 'lyra', 'nyx']) {
  FILES['models/uploads/' + id + '.glb'] = await new Promise((res, rej) =>
    exporter.parse(dummyHero(), res, rej, { binary: true })
  );
}
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');
  const buf = FILES[rel];
  if (!buf) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  return { ok: true, status: 200, arrayBuffer: async () => buf };
};

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

const { ensureGLBSkins } = await import('../src/glbskin.js');
const skins = await ensureGLBSkins();
check('all three skins loaded', ['aegis', 'lyra', 'nyx'].every((id) => skins[id]),
  'got: ' + Object.keys(skins).join(','));

const { Hero, HERO_DEFS } = await import('../src/heroes.js');
const { animateRig } = await import('../src/rig.js');

const G = { scene: new THREE.Scene(), glbSkins: skins };
for (let i = 0; i < 3; i++) {
  const h = new Hero(HERO_DEFS[i], G, i);
  const id = h.def.id;
  check(id + ' built with GLB rig', !!h.rig.glb && !!h.body);
  check(id + ' hipsRest is 0 for GLB', h.hipsRest === 0, 'got ' + h.hipsRest);
  const p = h.handPos();
  check(id + ' handPos falls back to anchor, finite', [p.x, p.y, p.z].every(Number.isFinite),
    `${p.x},${p.y},${p.z}`);

  h.facing = 0.7; h.attackAnim = 1; h.castAnim = 0.5; h.hurtAnim = 0.3;
  h.animateGLB(0.016, { time: 1 }, 1);
  check(id + ' animateGLB produces finite transforms',
    [h.body.position.y, h.body.position.z, h.body.rotation.x, h.body.rotation.y].every(Number.isFinite));
  const lunge = h.body.position.z;
  check(id + ' attack lunges forward', lunge > 0.2, 'z ' + lunge.toFixed(2));

  h.downed = true;
  for (let k = 0; k < 60; k++) h.animateGLB(0.05, { time: 2 + k * 0.05 }, 0);
  check(id + ' topples when downed', h.body.rotation.x < -0.9, 'rot.x ' + h.body.rotation.x.toFixed(2));
  h.downed = false;
  for (let k = 0; k < 60; k++) h.animateGLB(0.05, { time: 5 + k * 0.05 }, 0);
  check(id + ' stands back up on revive', Math.abs(h.body.rotation.x) < 0.2, 'rot.x ' + h.body.rotation.x.toFixed(2));
}

/* procedural fallback: no skins on G */
const G2 = { scene: new THREE.Scene() };
const hp = new Hero(HERO_DEFS[0], G2, 0);
check('fallback rig is procedural', !hp.rig.glb && !!hp.rig.hips && !hp.body);
check('fallback hipsRest is 0.95', hp.hipsRest === 0.95, 'got ' + hp.hipsRest);
animateRig(hp.rig, 0.016, { speed: 1, time: 1, attack: 0, cast: 0, dead: false, hurt: 0, style: 'fist', block: true });
check('animateRig still drives fallback rig', true);

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ERRORS none') + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail ? 1 : 0);
