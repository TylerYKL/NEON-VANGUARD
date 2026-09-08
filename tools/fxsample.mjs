/* ============================================================
   FXSAMPLE — writes the four AEGIS skill-effect props that the
   guide in FX-AEGIS.md walks you through, into models/uploads/:

     aegis-fx.glb      shared / ALL slot   (fallback + "⎘ from all" source)
     aegis-s0-fx.glb   Q  SEISMIC SLAM     ground shockwave + rock shards
     aegis-s1-fx.glb   E  BASTION FIELD    hard-light dome + hex plates
     aegis-s2-fx.glb   R  MAGNETRON PULSE  core, 8 magnetised spikes, 2 arcs

   The names are not decoration: the studio writes <id>-s<slot>-fx.* when YOU
   record, so these sit exactly where its output would land and are picked up by
   the LIBRARY list (it filters to .glb / .mp4 / .webm / .ogv).

   They are authored to be *cheap on purpose* — a handful of faceted meshes each,
   well inside the studio's heavy guard (>24 meshes or >60k tris per cast), and
   exported with flat normals so they read as faceted plate armour next to the
   procedural rigs (rig.js does the same thing).

   It also writes aegis-fx.sample.json — the same tuning the studio would save for
   these four files (copy it to models/uploads/hero_tuning.json to try it whole).
   Every emitted file is re-parsed and put through the REAL runtime spawn path
   (fxpack.spawnFX + clampFX) before the tool calls it good, so a sample can never
   ship in a state the match would choke on.

   Usage:  node tools/fxsample.mjs [--out models/uploads]
   ============================================================ */

import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/* GLTFExporter (and the loader we re-check with) expect a DOM; these stubs are
   the ones tools/skintest.mjs uses. */
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
  globalThis.document = { createElement: () => new globalThis.Image(), createElementNS: () => new globalThis.Image() };
}
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

const { parseGLB, normalizeToStage, gatherStats } = await import('../src/gltfutil.js');
const { HERO_DEFS } = await import('../src/heroes.js');
const { spawnFX, clampFX, fxFor, fxKind, fxStats } = await import('../src/fxpack.js');

const aegis = HERO_DEFS.find((d) => d.id === 'aegis');
const ACCENT = aegis.color, GLOW = aegis.color2;

/* --- tiny authoring helpers ------------------------------------------- */
/* Polyhedra come out of three.js already non-indexed; only re-derive the ones
   that need it, and recompute normals either way so the prop reads faceted. */
const flat = (g) => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); if (n !== g) g.dispose(); return n; };
const mat = (color, { emissive = color, power = 1.1, opacity = 1, side = THREE.FrontSide } = {}) =>
  new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity: power, roughness: 0.35, metalness: 0.55,
    transparent: opacity < 1, opacity, side, depthWrite: opacity >= 1,
  });
function part(geo, material, name, at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(flat(geo), material);
  m.name = name;
  m.position.set(at[0], at[1], at[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  m.scale.set(scale[0], scale[1], scale[2]);
  return m;
}
const ring = (r, tube, seg = 20, radial = 6) => new THREE.TorusGeometry(r, tube, radial, seg);
const disc = (r, seg = 12) => new THREE.CylinderGeometry(r, r, 0.02, seg);
const spike = (r, h, seg = 4) => new THREE.ConeGeometry(r, h, seg);

/* Q — SEISMIC SLAM: two ground rings, a flash disc, six rock shards thrown out. */
function seismicSlam() {
  const g = new THREE.Group();
  g.name = 'seismic-slam';
  const hard = mat(ACCENT, { power: 1.5 });
  const soft = mat(ACCENT, { power: 0.9, opacity: 0.55, side: THREE.DoubleSide });
  const rock = mat(0x6b7a8f, { emissive: ACCENT, power: 0.35 });
  g.add(part(ring(1.0, 0.07), hard, 'shockwave-outer', [0, 0.03, 0], [-Math.PI / 2, 0, 0]));
  g.add(part(ring(0.62, 0.05), hard, 'shockwave-inner', [0, 0.05, 0], [-Math.PI / 2, 0, 0]));
  g.add(part(disc(0.5, 10), soft, 'ground-flash', [0, 0.01, 0]));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    g.add(part(spike(0.12, 0.52), rock, 'rock-' + i,
      [Math.cos(a) * 0.78, 0.16, Math.sin(a) * 0.78],
      [Math.PI / 2 - 0.55, 0, -a]));
  }
  return g;
}

/* E — BASTION FIELD: faceted dome over a plate ring. */
function bastionField() {
  const g = new THREE.Group();
  g.name = 'bastion-field';
  const shell = mat(GLOW, { power: 1.25, opacity: 0.3, side: THREE.DoubleSide });
  const frame = mat(ACCENT, { power: 1.6 });
  g.add(part(new THREE.SphereGeometry(1.0, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), shell, 'dome'));
  g.add(part(ring(1.0, 0.055, 24, 5), frame, 'base-ring', [0, 0.02, 0], [-Math.PI / 2, 0, 0]));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(part(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 6), frame, 'plate-' + i,
      [Math.cos(a) * 0.92, 0.05, Math.sin(a) * 0.92], [0, a, 0]));
  }
  return g;
}

/* R — MAGNETRON PULSE: core + eight spikes pulled inward + two field arcs. */
function magnetronPulse() {
  const g = new THREE.Group();
  g.name = 'magnetron-pulse';
  const core = mat(GLOW, { power: 2.2 });
  const arc = mat(ACCENT, { power: 1.4, opacity: 0.7, side: THREE.DoubleSide });
  const bolt = mat(ACCENT, { power: 1.8 });
  g.add(part(new THREE.OctahedronGeometry(0.26), core, 'core'));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(part(spike(0.09, 0.62), bolt, 'spike-' + i,
      [Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72],
      [0, -a, Math.PI / 2 + 0.35 * Math.sin(a * 2)]));
  }
  g.add(part(ring(0.86, 0.035, 22, 4), arc, 'arc-x', [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 0.45]));
  g.add(part(ring(0.7, 0.03, 22, 4), arc, 'arc-z', [0, 0, 0], [Math.PI / 2, 0, 0.5], [1, 1, 0.5]));
  return g;
}

/* shared / ALL — a 4-point star + ring: the fallback look, and the thing
   "⎘ from all" copies into a slot before you tune it apart. */
function sharedBurst() {
  const g = new THREE.Group();
  g.name = 'shared-burst';
  const hard = mat(ACCENT, { power: 1.7 });
  const halo = mat(GLOW, { power: 1.1, opacity: 0.5, side: THREE.DoubleSide });
  g.add(part(new THREE.BoxGeometry(0.16, 0.16, 1.5), hard, 'star-a', [0, 0, 0]));
  g.add(part(new THREE.BoxGeometry(0.16, 0.16, 1.5), hard, 'star-b', [0, 0, 0], [0, Math.PI / 2, 0]));
  g.add(part(ring(0.78, 0.045, 20, 4), halo, 'halo', [0, 0, 0], [-Math.PI / 2, 0, 0]));
  return g;
}

/* Per-slot look, in the units the sliders use. Q is a ground ring (fast, wide,
   almost no rise), E is a dome that has to HOLD before it fades, R is the ult so
   it gets the biggest light the pool will lend. All within clampFX's ranges. */
const SAMPLES = [
  ['aegis-fx.glb', sharedBurst, 'ALL  shared fallback', {
    scale: 1.1, y: 0.6, dur: 1.1, grow: 0.5, spin: 2.2, rise: 0.5, fade: 0.4,
    opacity: 1, light: 7, blend: 1, tint: '#ffd9a8' }],
  ['aegis-s0-fx.glb', seismicSlam, 'Q    SEISMIC SLAM', {
    scale: 1.5, y: 0.02, dur: 0.65, grow: 1.6, spin: 0.6, rise: 0, fade: 0.45,
    opacity: 1, light: 9, blend: 1, tint: '#ffd9a8' }],
  ['aegis-s1-fx.glb', bastionField, 'E    BASTION FIELD', {
    scale: 2.4, y: 0, dur: 2.2, grow: 0.12, spin: 0.35, rise: 0.06, fade: 0.55,
    opacity: 0.85, light: 5, blend: 0, tint: '#18e0ff' }],
  ['aegis-s2-fx.glb', magnetronPulse, 'R    MAGNETRON PULSE', {
    scale: 2.8, y: 0.85, dur: 1.6, grow: 0.9, spin: 5.5, rise: 0.55, fade: 0.35,
    opacity: 1, light: 16, blend: 1, tint: '#18e0ff' }],
];

const argv = process.argv.slice(2);
const out = path.join(path.dirname(new URL(import.meta.url).pathname).replace(/\/tools$/, ''),
  argv[argv.indexOf('--out') + 1] || 'models/uploads');
fs.mkdirSync(out, { recursive: true });

/* Spawn once, drive it to expiry, spawn again to prove the pool hands the same
   object back — with a fake G whose light pool counts borrows, so an unbalanced
   acquire/release in the sample's params cannot slip past this tool. */
async function driveFX(url, p, bank, slot) {
  let acquired = 0, released = 0;
  const scene = new THREE.Scene();
  const G = {
    scene, time: 0,
    lights: {
      acquire: () => { acquired++; return { position: new THREE.Vector3(), intensity: 0 }; },
      release: () => { released++; },
      set: () => {},
    },
  };
  const at = new THREE.Vector3(0, p.y, 0);
  const first = spawnFX(G, bank[url], p, at, 0);
  const bbox = new THREE.Box3().setFromObject(first.obj);
  const size = new THREE.Vector3(); bbox.getSize(size);
  let frames = 0;
  while (first.update(1 / 60)) { G.time += 1 / 60; frames++; if (frames > 600) break; }
  const second = spawnFX(G, bank[url], p, at, 0);
  const reused = second.obj === first.obj;
  let f2 = 0;
  while (second.update(1 / 60)) { f2++; if (f2 > 600) break; }
  const stranded = scene.children.length;
  const st = fxStats();
  if (!reused || stranded || acquired !== released || frames === 0) broken++;
  return '↳ ' + slot.split(' ')[0].padEnd(4) + 'spans ' + size.x.toFixed(2) + '×' + size.y.toFixed(2) + '×' +
    size.z.toFixed(2) + ' m · ' + frames + ' live frames · pool reuse ' + (reused ? 'yes' : 'NO') +
    ' · lights ' + acquired + '/' + released + (reused && !stranded && acquired === released && frames ? '' : '  <-- CHECK');
}

const exporter = new GLTFExporter();
console.log('\nFX samples for ' + aegis.name + ' (accent #' + ACCENT.toString(16) + ' · glow #' + GLOW.toString(16) + ')\n');
console.log('  file                 slot                   meshes   tris   bytes   fitted');
let heavy = 0, broken = 0;
const SLOT_IDX = { Q: 0, E: 1, R: 2 };
const bank = {};
const tuning = { aegis: { scale: 1, pos: { x: 0, y: 0, z: 0 }, yawDeg: 0, motion: {}, fxSlots: [null, null, null] } };
for (const [file, build, slot, raw] of SAMPLES) {
  const buf = await new Promise((res, rej) => exporter.parse(build(), res, rej, { binary: true }));
  fs.writeFileSync(path.join(out, file), Buffer.from(buf));
  /* verify through the same pipeline the game will use */
  const gltf = await parseGLB(buf);
  const tpl = gltf.scene || gltf.scenes[0];
  const n = normalizeToStage(tpl, 1.8);            // what glbskin.bankPut does with an FX file
  const st = gatherStats(tpl);
  const over = st.meshes > 24 || st.tris > 60000;
  if (over) heavy++;
  console.log('  ' + file.padEnd(20) + slot.padEnd(22) + String(st.meshes).padStart(5) +
    String(st.tris).padStart(8) + String(Math.round(buf.byteLength / 1024) + 'k').padStart(8) +
    '   ' + n.height.toFixed(2) + ' m, ' + st.materials + ' mat' + (over ? '  <-- OVER THE STUDIO GUARD' : ''));
  const url = 'models/uploads/' + file;
  bank[url] = { kind: 'glb', url, template: tpl, stats: st, matPools: {} };
  const p = clampFX(raw, 'glb');
  const key = slot.trim()[0];
  if (key === 'A') tuning.aegis.fx = url; else tuning.aegis.fxSlots[SLOT_IDX[key]] = { src: url, on: true, p };
  if (JSON.stringify(p) !== JSON.stringify(raw)) broken++;   // a param outside the clamp is a doc bug
  /* and now the real thing: does it spawn, live and die through the runtime? */
  const report = await driveFX(url, p, bank, slot);
  if (report) console.log('  ' + report);
}
tuning.aegis.fxOn = true;
tuning.aegis.fxP = clampFX(SAMPLES[0][3], 'glb');
fs.writeFileSync(path.join(out, 'aegis-fx.sample.json'), JSON.stringify(tuning, null, 2) + '\n');
console.log('\n  models/uploads/aegis-fx.sample.json — copy over hero_tuning.json to load all four at once');

/* read the file back the way the game will, and resolve every skill through the
   same door (fxpack.fxFor) — a sample that only works when the tool is holding
   its hand is not a sample */
const written = JSON.parse(fs.readFileSync(path.join(out, 'aegis-fx.sample.json'), 'utf8'));
for (const k of [-1, 0, 1, 2]) {
  const label = k < 0 ? 'ALL' : ['Q', 'E', 'R'][k];
  const a = fxFor(written, 'aegis', k);
  const kind = fxKind(a ? a.src : '');
  const row = k < 0 ? SAMPLES[0] : SAMPLES[k + 1];
  const same = !!a && JSON.stringify(clampFX(a.p, kind)) === JSON.stringify(clampFX(row[3], kind));
  if (!a || !same) broken++;
  console.log('  ' + label.padEnd(4) + '→ ' + (a ? a.src.replace('models/uploads/', '') : 'NOTHING') +
    (a ? '  · params ' + (same ? 'survive the round-trip' : 'ALTERED') : '  <-- BROKEN'));
}

console.log('\n  written to ' + out + '/');
if (heavy || broken) {
  console.log('\n  ' + (heavy ? heavy + ' file(s) trip the >24 mesh / >60k tri per-cast guard' : '') +
    (broken ? (heavy ? ' · ' : '') + broken + ' runtime/param check(s) failed' : ''));
  process.exitCode = 1;
} else {
  console.log('\n  all four clear the heavy guard, spawn through the real fxpack path, return their');
  console.log('  pooled clones and balance the light pool — safe to ship as per-cast props');
}
console.log('  next: hero-studio.html → LIBRARY → assign → SAVE (see FX-AEGIS.md)\n');
