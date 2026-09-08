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
/* A rebuilder that bakes the pivot at the model's centre (the common case, and
   what aegis/lyra/nyx.glb actually are): normalizeToStage must then LIFT the
   root by half its height, and the game must keep that lift. */
function dummyCenteredHero(h = 2.4) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, h, 0.4), new THREE.MeshStandardMaterial({ color: 0x888888 })));
  return g;   // position 0/0/0 -> bbox is [-h/2 .. h/2]
}
const exporter = new GLTFExporter();
for (const id of ['aegis', 'lyra', 'nyx']) {
  FILES['models/uploads/' + id + '.glb'] = await new Promise((res, rej) =>
    exporter.parse(dummyHero(), res, rej, { binary: true })
  );
}
/* aegis: a v1 file (hero-wide fx, no slots) — must still load.
   nyx:  v2 per-skill slots, one disabled, one empty.
   lyra: references an fx that is not in the dropbox -> bank drops it. */
const FXFILES = ['models/uploads/aegis-fx.glb', 'models/uploads/nyx-shared-fx.glb',
  'models/uploads/nyx-s1-fx.glb', 'models/uploads/nyx-s2-fx.glb'];
for (const f of FXFILES) FILES[f] = await new Promise((res, rej) => exporter.parse(dummyHero(), res, rej, { binary: true }));
FILES['models/uploads/hero_tuning.json'] = new TextEncoder().encode(JSON.stringify({
  aegis: { fx: 'models/uploads/aegis-fx.webm', scale: 1.2, pos: { y: 0.4 }, yawDeg: 45 },
  lyra: { fx: 'models/uploads/lyra-fx-missing.glb' },
  nyx: {
    fx: 'models/uploads/nyx-shared-fx.glb', fxOn: true, fxP: { scale: 0.8 },
    fxSlots: [
      null,
      { src: 'models/uploads/nyx-s1-fx.glb', on: true, p: { scale: 2, dur: 0.5, tint: '#ff0000', light: 0 } },
      { src: 'models/uploads/nyx-s2-fx.glb', on: false, p: { scale: 3 } },
    ],
  },
})).buffer;
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');
  const buf = FILES[rel];
  if (!buf) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
  return {
    ok: true, status: 200,
    arrayBuffer: async () => buf,
    json: async () => JSON.parse(new TextDecoder().decode(buf)),
  };
};

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

const { ensureGLBSkins, ensureTuning, loadFXBank, DEFAULT_MOTION } = await import('../src/glbskin.js');
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

/* studio tuning: size multiplier, motion overrides, playFX safety */
const tun = { aegis: { scale: 1.3, motion: { lunge: 0.9, fallSpeed: 9 }, pos: { x: 0.25, y: 0.5 }, yawDeg: 90 }, lyra: {}, nyx: {} };
const fxList = [];
const G3 = { scene: new THREE.Scene(), glbSkins: skins, glbTuning: tun, fxBank: null, time: 0, addEffect: (e) => fxList.push(e) };
const ht = new Hero(HERO_DEFS[0], G3, 0);
check('tuning scale multiplies body', Math.abs(ht.body.scale.x / ht._baseScale - 1.3) < 1e-6,
  'got ' + (ht.body.scale.x / ht._baseScale).toFixed(3));
check('tuning motion override + defaults merged',
  ht.motion.lunge === 0.9 && ht.motion.fallSpeed === 9 && ht.motion.bob === DEFAULT_MOTION.bob);
check('tuning placement + yaw applied',
  ht.offset.x === 0.25 && ht.offset.y === 0.5 && Math.abs(ht._yaw - Math.PI / 2) < 1e-9,
  'yaw ' + ht._yaw.toFixed(3));
ht.attackAnim = 1;
ht.animateGLB(0.016, { time: 1 }, 0);
check('overridden lunge drives motion', Math.abs(ht.body.position.z - 0.9) < 1e-6, 'z ' + ht.body.position.z);
check('placement offsets the body',
  Math.abs(ht.body.position.x - 0.25) < 1e-6 && Math.abs(ht.body.rotation.y - (Math.PI / 2 + 0.22)) < 1e-6,
  `x ${ht.body.position.x} rot ${ht.body.rotation.y.toFixed(3)}`);
ht.setScale(0.7);
check('setScale live studio edit', Math.abs(ht.body.scale.x / ht._baseScale - 0.7) < 1e-6);
check('playFX safe without bank', ht.playFX(G3) === null);
check('playFX safe with an unknown slot', ht.playFX(G3, 99) === null);
G3.fxBank = { 'models/uploads/aegis-fx.glb': { kind: 'glb', url: 'models/uploads/aegis-fx.glb', template: skins.aegis.template } };
G3.glbTuning = { aegis: { fx: 'models/uploads/aegis-fx.glb', fxOn: true } };
const spawned = ht.playFX(G3);
check('playFX spawns bank clone into scene', !!spawned && G3.scene.children.includes(spawned));
check('playFX registered an effect', fxList.length === 1);
check('effect can be released by a run reset', typeof fxList[0].dispose === 'function');
fxList[0].dispose();
check('dispose removes it from the scene', !G3.scene.children.includes(spawned));
fxList[0].dispose();
check('dispose is idempotent (double kill is safe)', true);

/* ---------------- fxpack: parameter sanitising ---------------- */
const { clampFX, fxCount, fxEdit, fxFor, fxPreviewFor, fxSources, fxKind, fxDefsFor, spawnFX, fxStats, DEFAULT_FX, FX_SHARED, FX_SLOTS } =
  await import('../src/fxpack.js');
check('fxKind splits video from prop', fxKind('a.webm') === 'video' && fxKind('a.glb') === 'glb' && fxKind(null) === 'glb');
const junk = clampFX({ scale: NaN, dur: 1e9, spin: 'x', tint: 'red', blend: 7, opacity: -4 }, 'glb');
check('clampFX drops non-finite to defaults', junk.scale === DEFAULT_FX.glb.scale && junk.spin === DEFAULT_FX.glb.spin,
  JSON.stringify(junk));
check('clampFX clamps out-of-range', junk.dur === 5 && junk.opacity === 0.05);
check('clampFX rejects a bad tint', junk.tint === '#ffffff');
check('clampFX clamps option indices', junk.blend === 2);
const vidDefaults = clampFX({}, 'video');
check('video defaults float at chest height, additive', vidDefaults.y === DEFAULT_FX.video.y
  && vidDefaults.face === 1 && vidDefaults.vblend === 0);
check('a video block carries no glb-only rows', vidDefaults.blend === undefined && !('blend' in vidDefaults));
check('a prop block carries no clip rows', !('rate' in junk) && !('vblend' in junk) && junk.blend === 2);
check('tuned keys survive a kind switch', clampFX({ y: 2, dur: 0.4 }, 'video').y === 2);
const rows = fxDefsFor('glb');
check('glb rows hide video-only params', !rows.num.some((r) => r[0] === 'rate')
  && !rows.opt.some((r) => r[0] === 'vblend'));
check('video rows expose clip rate', fxDefsFor('video').num.some((r) => r[0] === 'rate'));
const allRows = [...rows.num, ...rows.opt, ...Object.values(fxDefsFor('video')).flat()].map((r) => r[0]);
const { FX_COLOR_DEFS } = await import('../src/fxpack.js');
const panelKeys = [...allRows, ...FX_COLOR_DEFS.map((r) => r[0])];
check('every tunable has an editor row in at least one kind',
  Object.keys(DEFAULT_FX.glb).every((k) => panelKeys.includes(k)),
  Object.keys(DEFAULT_FX.glb).filter((k) => !panelKeys.includes(k)).join(',') || 'all covered');
check('the glb panel exposes exactly the glb-relevant rows',
  rows.num.every((r) => !r[5].length || r[5].includes('glb')) && rows.num.length === 9,
  rows.num.map((r) => r[0]).join(','));

/* ---------------- tuning v2: per-skill slots + legacy migration ---------------- */
const tunCfg = await ensureTuning();
check('v1 hero-wide fx still parses', tunCfg.aegis.fx.endsWith('.webm'), String(tunCfg.aegis.fx));
check('v1 hero gets empty slots, not missing ones',
  Array.isArray(tunCfg.aegis.fxSlots) && tunCfg.fxSlots === undefined && tunCfg.aegis.fxSlots.every((s) => s === null));
check('tuning parses pos + yawDeg + scale',
  tunCfg.aegis.pos.y === 0.4 && tunCfg.aegis.yawDeg === 45 && tunCfg.aegis.scale === 1.2);
check('slot count matches the skill count', tunCfg.nyx.fxSlots.length === FX_SLOTS);
check('slot 1 keeps its file + params', tunCfg.nyx.fxSlots[1].src.endsWith('nyx-s1-fx.glb')
  && tunCfg.nyx.fxSlots[1].p.scale === 2 && tunCfg.nyx.fxSlots[1].p.tint === '#ff0000');
check('slot 0 stays empty', tunCfg.nyx.fxSlots[0] === null);
check('disabled slot keeps its data', tunCfg.nyx.fxSlots[2] && tunCfg.nyx.fxSlots[2].on === false);
check('shared params default when absent', tunCfg.nyx.fxP.scale === 0.8 && tunCfg.nyx.fxP.spin === DEFAULT_FX.glb.spin);

check('empty slot falls back to the shared fx', fxFor(tunCfg, 'nyx', 0).src.endsWith('nyx-shared-fx.glb'));
check('per-slot fx wins for that skill', fxFor(tunCfg, 'nyx', 1).src.endsWith('nyx-s1-fx.glb'));
check('muted slot falls back too', fxFor(tunCfg, 'nyx', 2).src.endsWith('nyx-shared-fx.glb'));
check('hero with no fx resolves to null', fxFor(tunCfg, 'nobody', 0) === null);
check('muted hero-wide fx resolves to null',
  fxFor({ x: { fx: 'a.glb', fxOn: false, fxSlots: [] } }, 'x', 0) === null);
check('sources are deduped across heroes', (() => {
  const s = fxSources({ a: { fx: 'u.glb', fxSlots: [{ src: 'u.glb' }, null, { src: 'v.glb' }] }, b: { fx: 'u.glb', fxSlots: [] } });
  return s.length === 2 && s.includes('u.glb') && s.includes('v.glb');
})());

/* ---------------- the bank is keyed by URL, so a file can serve many slots ---------------- */
const bank = await loadFXBank(tunCfg);
check('bank keys are fx URLs', Object.keys(bank).every((k) => k.startsWith('models/uploads/')),
  Object.keys(bank).join(','));
check('bank holds every referenced file once', Object.keys(bank).length === 4, Object.keys(bank).join(','));
check('video fx bank entry needs no parse', bank['models/uploads/aegis-fx.webm'].kind === 'video');
check('glb fx bank entry is a real subtree', (() => {
  const tpl = bank['models/uploads/nyx-s1-fx.glb'].template;
  let meshes = 0; tpl.traverse((o) => { if (o.isMesh) meshes++; });
  return tpl.isObject3D && meshes > 0 && tpl.scale.x > 0;
})());
check('unreachable fx dropped from bank', !bank['models/uploads/lyra-fx-missing.glb']);
check('cast survives a missing bank entry', new Hero(HERO_DEFS[1],
  { scene: new THREE.Scene(), glbTuning: tunCfg, fxBank: bank, addEffect: () => {} }, 1).playFX(
  { scene: new THREE.Scene(), glbTuning: tunCfg, fxBank: bank, addEffect: () => {} }, 0) === null);

/* ---------------- fxpack runtime: pooling, shared materials, lights ---------------- */
function tinyScene() { return new THREE.Scene(); }
const entry = bank['models/uploads/nyx-s1-fx.glb'];
let tmesh = null;
entry.template.traverse((o) => { if (o.isMesh && !tmesh) tmesh = o; });
const tmat = tmesh.material;

let disposeCalls = 0, disposedTemplate = 0;
const realDispose = THREE.Material.prototype.dispose;
THREE.Material.prototype.dispose = function () {
  disposeCalls++;
  if (this === tmat) disposedTemplate++;
  return realDispose.apply(this, arguments);
};
function runOut(inst, limit = 60) { let n = 0; while (n++ < limit && inst.update(0.02)); return n; }

const sc1 = tinyScene();
const G4 = { scene: sc1, camera: null, lights: null };
const pPlain = clampFX({ scale: 1.5, y: 0.4, dur: 0.3, rise: 1, spin: 4, fade: 0, light: 0, blend: 0 }, 'glb');
const i1 = spawnFX(G4, entry, pPlain, { x: 1, y: 0.4, z: 2 }, 0);
check('spawnFX puts the prop in the scene at the anchor', sc1.children.length === 1
  && Math.abs(i1.obj.position.x - 1) < 1e-9 && Math.abs(i1.obj.position.y - 0.4) < 1e-9);
check('spawnFX honours the tuned scale', Math.abs(i1.obj.scale.x - 1.5) < 1e-9);
check('untuned look shares the bank material (zero alloc)', i1.obj && tmesh.material === tmat && i1.obj.userData.fxMats[0] === tmat);
runOut(i1);
check('spawnFX expires on its own duration', i1.alive === false);
check('expiry removes it from the scene', sc1.children.length === 0);
check('expiry hands the clone back to the entry pool', entry.pool.length === 1 && entry.pool[0] === i1.obj);
const i2 = spawnFX(G4, entry, pPlain, { x: 0, y: 0, z: 0 }, 0);
check('a second cast reuses the pooled subtree', i2.obj === i1.obj && entry.pool.length === 0);
runOut(i2);

const pFade = clampFX({ scale: 1, dur: 0.2, fade: 0.4, opacity: 0.5, tint: '#ff0000', blend: 1, light: 0 }, 'glb');
const i3 = spawnFX(G4, entry, pFade, { x: 0, y: 0, z: 0 }, 0);
check('a retinted cast allocates nothing until it dies', disposeCalls === 0);
const castMat = (() => { let m = null; i3.obj.traverse((o) => { if (o.isMesh && !m) m = o.material; }); return m; })();
check('override cast gets its own material', castMat !== tmat);
check('override cast is additive + tinted', castMat.blending === THREE.AdditiveBlending
  && castMat.color.getHexString() === '880000', castMat.color.getHexString());
check('template material is untouched', tmat.color.getHexString() === '888888', tmat.color.getHexString());
const fadeEarly = (() => { i3.update(0.02); let m = null; i3.obj.traverse((o) => { if (o.isMesh && !m) m = o.material; }); return m.opacity; })();
check('per-instance opacity fades on the tail only', fadeEarly === 0.5, 'opacity ' + fadeEarly);
runOut(i3);
check('per-instance materials are recycled, not disposed (no program churn)',
  disposeCalls === 0 && disposedTemplate === 0, 'disposed ' + disposeCalls);
const i3b = spawnFX(G4, entry, pFade, { x: 0, y: 0, z: 0 }, 0);
let reborn = null; i3b.obj.traverse((o) => { if (o.isMesh && !reborn) reborn = o.material; });
check('the next fade cast reuses the same material set', reborn === castMat && fxStats().pooledMats >= 0);
i3b.kill();
check('pooled subtree is restored to its authored material', i3.obj && (() => {
  let m = null; i3.obj.traverse((o) => { if (o.isMesh && !m) m = o.material; }); return m === tmat;
})());
THREE.Material.prototype.dispose = realDispose;

/* a borrowed light must come back, however the cast ends */
let got = 0, back = 0;
const sc2 = tinyScene();
const G5 = {
  scene: sc2,
  lights: {
    acquire() { got++; return new THREE.PointLight(0xffffff, 0, 1, 2); },
    release() { back++; },
    set(l, c, i, d, dec) { l.intensity = i; l.distance = d; l.decay = dec; l.color.set(c); },
  },
};
const pLit = clampFX({ dur: 0.3, light: 8, fade: 0 }, 'glb');
const i4 = spawnFX(G5, entry, pLit, { x: 0, y: 0, z: 0 }, 0);
check('glow parameter borrows one pooled light', got === 1 && back === 0);
runOut(i4);
check('the light is returned when the effect ends', back === 1);
const i5 = spawnFX(G5, entry, pLit, { x: 0, y: 0, z: 0 }, 0);
i5.kill();
check('kill() releases the light too (run reset)', back === 2);

/* video billboards: one element per file, refcounted, never per cast */
const ventry = bank['models/uploads/aegis-fx.webm'];
const sc3 = tinyScene();
const G6 = { scene: sc3, camera: new THREE.PerspectiveCamera(40, 1, 0.1, 10) };
const pVid = clampFX({ dur: 0.2, scale: 1.2, y: 1.4, fade: 0.3, light: 0 }, 'video');
const v1 = spawnFX(G6, ventry, pVid, { x: 0, y: 1.4, z: 0 }, 0);
const v2 = spawnFX(G6, ventry, pVid, { x: 1, y: 1.4, z: 1 }, 0);
check('two concurrent video casts share one decoder', fxStats().videos === 1 && fxStats().videoUsers === 2,
  JSON.stringify(fxStats()));
check('video cast is a textured billboard', !!v1.obj.material.map && v1.obj.material.map.isVideoTexture);
check('video cast sizes off the scale parameter', v1.obj.scale.x > 3 && v1.obj.scale.x < 5, 'w ' + v1.obj.scale.x);
v1.obj.updateMatrixWorld();
check('face-cam billboard turns to the camera', v1.obj.getWorldDirection(new THREE.Vector3()).z > 0.9);
runOut(v1); runOut(v2);
check('refcount drops to zero when both casts end', fxStats().videoUsers === 0, JSON.stringify(fxStats()));
const v3 = spawnFX(G6, ventry, pVid, { x: 0, y: 0, z: 0 }, 0);
check('billboard meshes are pooled (last one freed is reused)', v3.obj === v2.obj);
v3.kill();
check('video element survives for reuse (not disposed)', fxStats().videos === 1);

/* ---------------- library PREVIEW: fire anything, assign nothing ---------------- */
const pvCfg = {
  aegis: {
    fx: 'models/uploads/aegis-fx.glb', fxP: { scale: 1.1, dur: 1.1, light: 7 },
    fxSlots: [{ src: 'models/uploads/aegis-s0-fx.glb', on: true, p: { scale: 1.5, dur: 0.65, light: 9 } },
      null,
      { src: 'models/uploads/aegis-s2-fx.glb', on: true, p: { scale: 2.8, dur: 1.6, light: 16 } }],
  },
};
const before = JSON.stringify(pvCfg);
const inSlot = fxPreviewFor(pvCfg, 'aegis', 0, 'models/uploads/aegis-s0-fx.glb');
check('preview uses the slot its file is assigned to', inSlot.from === 'slot' && inSlot.p.scale === 1.5 && inSlot.p.dur === 0.65,
  inSlot.from + ' ' + JSON.stringify(inSlot.p));
check('preview of the shared file reads the shared block', (() => {
  const r = fxPreviewFor(pvCfg, 'aegis', 1, 'models/uploads/aegis-fx.glb');
  return r.from === 'shared' && r.p.light === 7;
})());
check('a file living in ANOTHER slot of this hero still previews with its own look', (() => {
  const r = fxPreviewFor(pvCfg, 'aegis', 0, 'models/uploads/aegis-s2-fx.glb');
  return r.from === 'slot2' && r.p.scale === 2.8;
})());
const unassigned = fxPreviewFor(pvCfg, 'aegis', 1, 'models/uploads/brand-new.glb');
check('an unassigned .glb gets the glb defaults', unassigned.from === 'defaults' && unassigned.p.dur === DEFAULT_FX.glb.dur);
const freshVid = fxPreviewFor(pvCfg, 'aegis', 1, 'models/uploads/brand-new.webm');
check('an unassigned video gets the video defaults (floats, longer, softer light)',
  freshVid.p.dur === DEFAULT_FX.video.dur && freshVid.p.y === DEFAULT_FX.video.y && freshVid.p.light === DEFAULT_FX.video.light,
  JSON.stringify(freshVid.p));
check('a hero with no entry at all still previews (no throw)', fxPreviewFor(pvCfg, 'lyra', 0, 'x.glb').from === 'defaults');
check('preview never writes to the tuning', JSON.stringify(pvCfg) === before);
const mutator = fxPreviewFor(pvCfg, 'aegis', 0, 'models/uploads/aegis-s0-fx.glb');
mutator.p.scale = 99;
check('…and hands a COPY, so editing the preview params cannot dirty a save',
  pvCfg.aegis.fxSlots[0].p.scale === 1.5 && JSON.stringify(pvCfg) === before);

/* spawning something NO slot references — the case a preview is, and the case
   the studio used to be unable to serve without spending a slot */
const orphanURL = 'models/uploads/unassigned-candidate.glb';
const orphan = { kind: 'glb', url: orphanURL, template: entry.template, stats: entry.stats, matPools: {} };
const scPv = tinyScene();
const GPv = { scene: scPv, camera: null, lights: null };
const pPv = fxPreviewFor(pvCfg, 'aegis', 0, orphanURL).p;      // defaults, since nothing holds it
const one = spawnFX(GPv, orphan, pPv, { x: 0, y: pPv.y, z: 0 }, 0);
const added = scPv.children.length;
runOut(one);
check('an unassigned file spawns and cleans up on its own', added === 1 && scPv.children.length === 0,
  'children ' + scPv.children.length);
const two = spawnFX(GPv, orphan, pPv, { x: 0, y: 0, z: 0 }, 0);
check('a second preview reuses the pooled clone (previews do not allocate per fire)', two.obj === one.obj);
runOut(two);
const many = [];
for (let i = 0; i < 5; i++) many.push(spawnFX(GPv, orphan, pPv, { x: i, y: 0, z: 0 }, 0));
check('five simultaneous previews take five clones out of the pool', scPv.children.length === 5, 'children ' + scPv.children.length);
for (const m of many) m.kill();
check('…and all five go back (pool capped, nothing disposed)', scPv.children.length === 0 && orphan.pool.length === 5,
  'pool ' + (orphan.pool || []).length);

/* ---------------- the studio editor writes through the same door ---------------- */
const cfg2 = JSON.parse(JSON.stringify(tunCfg));
const a0 = fxEdit(cfg2, 'lyra', 1);
check('an empty slot is materialised with defaults',
  a0.src === null && a0.p.dur === DEFAULT_FX.glb.dur && a0.p.tint === '#ffffff');
a0.setSrc('models/uploads/lyra-s1-fx.glb');
a0.p.scale = 2.5;
const lit = fxFor(cfg2, 'lyra', 1);
check('the runtime sees a studio edit immediately', !!lit && lit.p.scale === 2.5 && lit.src.endsWith('lyra-s1-fx.glb'));
const a0b = fxEdit(cfg2, 'lyra', 1);
check('params persist across editor calls', a0b.p.scale === 2.5 && a0b.src.endsWith('lyra-s1-fx.glb'));
a0b.setOn(false);
check('muting a slot falls back to the hero-wide fx',
  fxFor(cfg2, 'lyra', 1).src.endsWith('lyra-fx-missing.glb'));
a0b.setSrc(null);
check('clearing a slot leaves its look tuned',
  cfg2.lyra.fxSlots[1].src === null && cfg2.lyra.fxSlots[1].p.scale === 2.5);
const sh = fxEdit(cfg2, 'aegis', FX_SHARED);
check('the shared slot reads the legacy hero-wide fx', !!sh.src && sh.src.endsWith('aegis-fx.webm') && sh.on === true);
sh.setOn(false);
check('muting ALL takes fx off every skill', fxFor(cfg2, 'aegis', 0) === null && fxFor(cfg2, 'aegis', 2) === null);
check('fxCount counts files, not slots', fxCount(cfg2) === 5, 'got ' + fxCount(cfg2));
check('an unknown hero never throws', fxEdit(cfg2, 'nobody', 0) === null && fxEdit(null, 'aegis', 0) === null);
check('slot count is what the studio renders', FX_SLOTS === 3);
check('an out-of-range slot still falls back to the shared fx',
  fxFor(cfg2, 'nyx', FX_SLOTS).src.endsWith('nyx-shared-fx.glb'));

/* hero wiring: useSkill must pick the slot assignment, not the shared one */
const fxList2 = [];
const G7 = { scene: tinyScene(), glbTuning: tunCfg, fxBank: bank, time: 0, addEffect: (e) => fxList2.push(e) };
const hn = new Hero(HERO_DEFS[2], G7, 2);
hn.pos.set(0, 0, 0);
const baseChildren = G7.scene.children.length;
const oShared = hn.playFX(G7, 0);
const oSlot = hn.playFX(G7, 1);
check('slot 0 casts the shared fx with shared params', oShared && Math.abs(oShared.scale.x - tunCfg.nyx.fxP.scale) < 1e-9,
  'scale ' + (oShared && oShared.scale.x));
check('slot 1 casts its own fx with its own scale', oSlot && Math.abs(oSlot.scale.x - 2) < 1e-9,
  'scale ' + (oSlot && oSlot.scale.x));
check('per-slot cast spawns its own object', oShared !== oSlot);
check('unknown slot index never throws', hn.playFX(G7, 12) === null || true);
fxList2.forEach((e) => e.dispose());
check('all hero fx cleaned up by dispose', G7.scene.children.length === baseChildren,
  G7.scene.children.length + ' vs ' + baseChildren);

/* ---------------- the half-buried hero fix ---------------- */
const centered = await new Promise((res, rej) => exporter.parse(dummyCenteredHero(), res, rej, { binary: true }));
const { parseGLB, normalizeToStage } = await import('../src/gltfutil.js');
const croot = (await parseGLB(centered)).scene || (await parseGLB(centered)).scenes[0];
const nrm = normalizeToStage(croot, 2.4);
check('normalise records the lift it applied', Math.abs(nrm.lift - 1.2) < 0.02, 'lift ' + nrm.lift);
check('lift is stamped on userData so a clone can keep it',
  Math.abs(croot.userData.stage.lift - 1.2) < 0.02 && Math.abs(croot.position.y - 1.2) < 0.02);

const skins2 = { aegis: { template: croot, yaw: 0 } };
const worldBox = (o) => { o.parent.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
function standHero(pos) {
  const g = { scene: new THREE.Scene(), glbSkins: skins2, time: 0, addEffect: () => {},
    glbTuning: { aegis: { scale: 1, motion: {}, pos: pos || { x: 0, y: 0, z: 0 }, yawDeg: 0 } } };
  const hero = new Hero(HERO_DEFS[0], g, 0);
  hero.animateGLB(0.016, { time: 0 }, 0);        // one real frame of the real motion driver
  return { hero, bb: worldBox(hero.body) };
}
const idle = standHero();
check('DEFAULT tuning puts the feet on the deck (was buried 1.2 m)',
  Math.abs(idle.bb.min.y) < 0.03, 'min.y ' + idle.bb.min.y.toFixed(3));
check('and the full 2.4 m body is above it', Math.abs(idle.bb.max.y - 2.4) < 0.05,
  'max.y ' + idle.bb.max.y.toFixed(3));
const lifted = standHero({ x: 0.5, y: 0.75, z: -0.5 });
check('studio offsets ADD to the loader placement',
  Math.abs(lifted.bb.min.y - 0.75) < 0.03 && Math.abs(lifted.hero.body.position.x - (croot.position.x + 0.5)) < 0.03,
  'y ' + lifted.bb.min.y.toFixed(3) + ' x ' + lifted.hero.body.position.x.toFixed(3));
check('negative Y still sinks it (the slider is a real control, not a no-op)',
  Math.abs(standHero({ x: 0, y: -1.2, z: 0 }).bb.min.y + 1.2) < 0.03);
const walked = standHero();
walked.hero.animateGLB(0.016, { time: 3 }, 1.2);        // mid-stride, bob + lunge active
check('motion rides on top of the placement, not instead of it',
  worldBox(walked.hero.body).min.y > -0.06, 'min.y while walking ' + worldBox(walked.hero.body).min.y.toFixed(3));
const sized = standHero();
sized.hero.setScale(1.5);
sized.hero.animateGLB(0.016, { time: 0 }, 0);
check('size + placement compose (taller hero, still standing on the deck)',
  Math.abs(worldBox(sized.hero.body).min.y) < 0.03 && worldBox(sized.hero.body).max.y > 3.5,
  'h ' + worldBox(sized.hero.body).max.y.toFixed(2));

/* ---------------- a studio SAVE is picked up by the next run (no page reload) ---------------- */
check('cached tuning is stable inside a session', (await ensureTuning()) === tunCfg);
FILES['models/uploads/lyra-s0-fx.glb'] = await new Promise((res, rej) => exporter.parse(dummyHero(), res, rej, { binary: true }));
FILES['models/uploads/hero_tuning.json'] = new TextEncoder().encode(JSON.stringify({
  lyra: { fxSlots: [{ src: 'models/uploads/lyra-s0-fx.glb', on: true, p: { scale: 1.75 } }, null, null] },
})).buffer;
const fresh = await ensureTuning(true);
check('refresh re-reads what the studio just saved',
  !!fresh.lyra.fxSlots[0] && fresh.lyra.fxSlots[0].p.scale === 1.75, JSON.stringify(fresh.lyra.fxSlots[0]));
check('a hero with nothing saved gets defaults', fresh.aegis.scale === 1 && fresh.aegis.fx === null);
const bank3 = await loadFXBank({ ...tunCfg, lyra: fresh.lyra });
check('newly assigned file is parsed on the restart', !!bank3['models/uploads/lyra-s0-fx.glb']);
check('files already in the bank are not re-parsed',
  bank3['models/uploads/nyx-s1-fx.glb'] === bank['models/uploads/nyx-s1-fx.glb']);
check('a restart only pays for what changed', Object.keys(bank3).length === Object.keys(bank).length + 1,
  Object.keys(bank3).length + ' vs ' + Object.keys(bank).length);

console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ERRORS none') + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail ? 1 : 0);
