import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Hero, HERO_DEFS } from './heroes.js';
import { ensureGLBSkins, ensureTuning, loadFXBank } from './glbskin.js';
import { parseGLB, normalizeToStage, gatherStats } from './gltfutil.js';
import { animateRig } from './rig.js';
import { clampFX, fxCount, fxDefsFor, fxEdit, fxKind, fxPreviewFor, FX_SHARED, FX_SLOTS, spawnFX } from './fxpack.js';
import { clamp } from './util.js';

/* ============================================================
   HERO STUDIO — tune the uploaded GLB heroes: size, action
   motion, placement, and a skill-effect slot per skill (Q / E / R)
   plus a shared slot. An effect is a .GLB prop or a video
   billboard, uploaded here, recorded from this canvas, or picked
   out of models/uploads/. SAVE writes models/uploads/
   hero_tuning.json through the :8081 dropbox server; the game
   reads it at startGame().
   ============================================================ */

const $ = (id) => document.getElementById(id);
const app = $('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050b);
scene.fog = new THREE.FogExp2(0x04050b, 0.02);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
camera.position.set(2.6, 1.9, 3.6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.52;

scene.add(new THREE.HemisphereLight(0x38539c, 0x0c0714, 1.0));
const key = new THREE.DirectionalLight(0xcfe0ff, 2.4); key.position.set(4, 7, 7); scene.add(key);
const fill = new THREE.DirectionalLight(0x5f80ff, 1.0); fill.position.set(-7, 3.5, 4); scene.add(fill);
const rim = new THREE.PointLight(0xffffff, 9, 15, 2); rim.position.set(-2.6, 2.6, -2.8); scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(20, 72),
  new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.5, metalness: 0.6 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.GridHelper(20, 40, 0x18e0ff, 0x10203a);
grid.material.transparent = true; grid.material.opacity = 0.22; grid.position.y = 0.01;
scene.add(grid);

/* the game's "glow light" parameter borrows from the fixed pool (src/lights.js);
   the studio mirrors the API with four real lights so the slider previews honestly */
const studioLights = (() => {
  const free = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 20, 2);
    l.position.set(0, -50, 0);
    scene.add(l);
    free.push(l);
  }
  return {
    acquire() { return free.length ? free.pop() : null; },
    release(l) { if (l && free.indexOf(l) < 0) { l.intensity = 0; l.position.set(0, -50, 0); free.push(l); } },
    set(l, color, intensity, distance, decay = 2) {
      if (!l) return null;
      l.color.set(color); l.intensity = intensity; l.distance = distance; l.decay = decay;
      return l;
    },
  };
})();

function flash(msg, color) {
  const el = $('msg'); el.textContent = msg; el.style.color = color || '#9ff';
  clearTimeout(flash.t); flash.t = setTimeout(() => { el.textContent = ''; }, 3600);
}

/* studio-side copy of the upload server origin (same sandbox, port 8081) */
const UP = 'https://' + location.hostname.replace(/^\d+-/, '8081-');
const UPDIR = 'models/uploads/';

/* ---------- boot state ---------- */
const effects = [];
let heroes = [], active = 0, action = 'idle';
let cfg = null, fxBank = null;
const G = {
  scene, time: 0, camera,
  addEffect: (e) => effects.push(e),
  lights: studioLights,
  glbSkins: null, glbTuning: null, fxBank: null,
};

const MOT_DEFS = [
  ['stepRate', 'step rate', 0, 15, 0.1],
  ['bob', 'walk bob', 0, 0.2, 0.005],
  ['walkLean', 'walk lean', 0, 0.3, 0.005],
  ['lunge', 'atk lunge', 0, 1.2, 0.01],
  ['twist', 'atk twist', 0, 0.8, 0.01],
  ['castLean', 'cast lean', 0, 0.4, 0.005],
  ['hurtLean', 'hurt recoil', 0, 0.5, 0.005],
  ['idleSway', 'idle sway', 0, 0.05, 0.002],
  ['fallSpeed', 'fall speed', 1, 12, 0.1],
];

/* Placement is an ADJUSTMENT on top of what the loader already did:
   normalizeToStage() centres the model and lifts it by its own half-height, and
   those numbers are what a rebuilder gets wrong. 0 / 0 / 0 must therefore mean
   "as the loader placed it" — not "origin", which buries the hero to the waist. */
const PL_DEFS = [
  ['x', 'offset x', -3, 3, 0.01],
  ['y', 'offset y', -3, 3, 0.01],
  ['z', 'offset z', -3, 3, 0.01],
  ['yawDeg', 'yaw deg', -180, 180, 1],
];

function sliderRow(label, min, max, step, onInput) {
  const row = document.createElement('div');
  row.className = 'mrow';
  row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><b></b>`;
  const inp = row.querySelector('input'), out = row.querySelector('b');
  inp.oninput = () => onInput(+inp.value, out, inp);
  row._input = inp; row._out = out;
  return row;
}

function buildSliders() {
  $('mot').innerHTML = '';
  for (const [k, label, min, max, step] of MOT_DEFS) {
    const row = sliderRow(label, min, max, step, (v, out) => {
      cfg[HERO_DEFS[active].id].motion[k] = v;
      heroes[active].motion[k] = v;
      out.textContent = v.toFixed(step < 0.01 ? 3 : 2);
    });
    row._key = k; row._dec = step < 0.01 ? 3 : 2;
    $('mot').appendChild(row);
  }
  buildPlacement();
}

/* one row = label, slider, editable number — both controls drive the same value */
function buildPlacement() {
  const box = $('plc');
  box.innerHTML = '';
  for (const [k, label, min, max, step] of PL_DEFS) {
    const row = document.createElement('div');
    row.className = 'prow';
    row.innerHTML = `<span>${label}</span>` +
      `<input type="range" min="${min}" max="${max}" step="${step}">` +
      `<input type="number" min="${min}" max="${max}" step="${step}">`;
    row._key = k; row._min = min; row._max = max; row._step = step;
    row._dec = step < 1 ? 2 : 0;
    const rng = row.children[1], num = row.children[2];
    const apply = (v, from) => {
      v = clamp(+v || 0, min, max);
      const c = cfg[heroId()], h = heroes[active];
      if (k === 'yawDeg') { c.yawDeg = v; h.setYawDeg(v); }
      else { c.pos[k] = v; h.offset[k] = v; }
      if (from !== rng) rng.value = v;
      if (from !== num) num.value = v.toFixed(row._dec);
      measureFit();
    };
    rng.oninput = () => apply(rng.value, rng);
    num.oninput = () => apply(num.value, num);
    num.onblur = () => { num.value = (+num.value || 0).toFixed(row._dec); };
    box.appendChild(row);
  }
}

/** Where the body actually sits, so "I fixed it" is a number and not a vibe.
    Measured at the REST pose — animateGLB writes this position next frame with
    bob / lunge on top, and the preview's current transform is whatever the last
    frame left there, so measuring it as-is would read one frame stale. */
const _bb = new THREE.Box3();
function measureFit() {
  const h = heroes[active];
  if (!h) return null;
  const b = h.body, snap = h.rig.glb
    ? [b.position.x, b.position.y, b.position.z, b.rotation.x, b.rotation.y, b.rotation.z] : null;
  if (h.rig.glb) {
    const B = h._basePos || { x: 0, y: 0, z: 0 }, O = h.offset, S = h.tunScale || 1;
    b.position.set(B.x * S + O.x, B.y * S + O.y, B.z * S + O.z);   // same maths as animateGLB
    b.rotation.set(0, h._yaw || 0, 0);
  }
  h.group.updateMatrixWorld(true);
  _bb.setFromObject(h.rig.glb ? h.body : h.group);
  if (snap) {   // restore: this runs inside the render loop, and leaving the
    b.position.set(snap[0], snap[1], snap[2]);      // rest pose there would drop a
    b.rotation.set(snap[3], snap[4], snap[5]);      // frame of walk bob every 0.3 s
  }
  const st = (h.rig.glb && h.body.userData.stage) || null;
  const clipped = _bb.min.y < -0.02;
  const el = $('pcfeet');
  el.textContent = 'feet ' + _bb.min.y.toFixed(2) + ' m · head ' + _bb.max.y.toFixed(2) + ' m' +
    (clipped ? ' · ' + (-_bb.min.y).toFixed(2) + ' m BURIED' : '');
  el.classList.toggle('bad', clipped);
  $('pcnote').textContent = (st
    ? 'loader lift ' + st.lift.toFixed(3) + ' m (its own centring) — offsets add to that'
    : 'procedural rig — no loader lift') +
    (Math.abs(cfg[heroId()].pos.y) > 0.4 && !clipped ? ' · note: a saved Y this large may be an old pre-fix compensation' : '');
  return { min: _bb.min.y, max: _bb.max.y, clipped };
}

function nudgePlacementTo(fn) {
  const h = heroes[active];
  if (!h || !h.rig.glb) { flash('PLACEMENT APPLIES TO UPLOADED GLB SKINS', '#ffb14a'); return; }
  const c = cfg[heroId()];
  for (const k of ['x', 'y', 'z']) { c.pos[k] = clamp(fn(k), -3, 3); h.offset[k] = c.pos[k]; }
  syncPlacement();
  measureFit();
}

function syncPlacement() {
  const c = cfg[heroId()];
  for (const row of $('plc').children) {
    const v = row._key === 'yawDeg' ? c.yawDeg : c.pos[row._key];
    row.children[1].value = v;
    row.children[2].value = (+v).toFixed(row._dec);
  }
}

/* ============================================================
   SKILL EFFECT EDITOR
   One FX slot per skill + a shared slot ("ALL") that covers every
   skill — which is all a v1 tuning file had. The runtime resolves
   the same way (fxpack.fxFor), so what plays here is what plays
   in the match.
   ============================================================ */
let slot = FX_SHARED;
let fxKindShown = null;
let libFiles = [];

const heroId = () => HERO_DEFS[active].id;
/* the editor and the match read the same record through fxpack.fxEdit, so a
   slot that previews correctly here cannot resolve differently in-game */
const asg = () => fxEdit(cfg, heroId(), slot);

function buildFXPanel() {
  const kind = asg().src ? fxKind(asg().src) : 'glb';
  fxKindShown = kind;
  $('fxkind').textContent = '· ' + (kind === 'video' ? 'video billboard' : 'glb prop');
  const { num, opt } = fxDefsFor(kind);
  const box = $('fxp');
  box.innerHTML = '';
  const a = asg();
  for (const [k, label, min, max, step] of num) {
    const row = sliderRow(label, min, max, step, (v, out) => {
      asg().p[k] = v;
      out.textContent = (+v).toFixed(step < 0.1 ? 2 : 1);
    });
    row._key = k;
    row._input.value = a.p[k];
    row._out.textContent = (+a.p[k]).toFixed(step < 0.1 ? 2 : 1);
    box.appendChild(row);
  }
  for (const [k, label, opts] of opt) {
    const row = sliderRow(label, 0, opts.length - 1, 1, (v, out) => {
      asg().p[k] = v;
      out.textContent = opts[v] || '';
    });
    row._key = k; row._opts = opts;
    row._input.value = a.p[k];
    row._out.textContent = opts[a.p[k]] || '';
    box.appendChild(row);
  }
  /* tint is a colour, not a range — same grid, different control */
  const crow = document.createElement('div');
  crow.className = 'mrow';
  crow.innerHTML = '<span>tint</span><input type="color"><b></b>';
  crow._key = 'tint';
  const cin = crow.querySelector('input'), cout = crow.querySelector('b');
  cin.value = asg().p.tint;
  cout.textContent = asg().p.tint;
  cin.oninput = () => { asg().p.tint = cin.value; cout.textContent = cin.value; };
  box.appendChild(crow);
}

function syncFXPanel() {
  const kind = asg().src ? fxKind(asg().src) : 'glb';
  if (kind !== fxKindShown) buildFXPanel();
  const a = asg();
  for (const row of $('fxp').children) {
    const k = row._key;
    const v = a.p[k];
    if (k === 'tint') { row.querySelector('input').value = v; row.querySelector('b').textContent = v; continue; }
    row._input.value = v;
    row._out.textContent = row._opts ? (row._opts[v] || '') : (+v).toFixed(+row._input.step < 0.1 ? 2 : 1);
  }
}

function slotLabel(i) {
  if (i === FX_SHARED) return 'ALL';
  const sk = HERO_DEFS[active].skills[i];
  return sk ? sk.key : 'S' + i;
}

function buildChips() {
  const box = $('fxslots');
  box.innerHTML = '';
  const mk = (i, label, title) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<b>${label}</b>${i === FX_SHARED ? 'shared' : slotName(i)}<i></i>`;
    b.title = title;
    b.onclick = () => setSlot(i);
    b._slot = i;
    box.appendChild(b);
  };
  mk(FX_SHARED, 'ALL', 'One effect for every skill (the v1 behaviour)');
  for (let i = 0; i < FX_SLOTS; i++) mk(i, slotLabel(i), 'Effect for skill ' + slotLabel(i));
}
const slotName = (i) => {
  const sk = HERO_DEFS[active].skills[i];
  return sk ? sk.name.toLowerCase().split(' ')[0] : 'skill ' + i;
};

function setSlot(i) {
  slot = i;
  syncFX();
}

async function bankPut(url, buf) {
  if (fxBank[url]) return fxBank[url];
  if (/\.(mp4|webm|ogv)$/i.test(url)) {
    fxBank[url] = { kind: 'video', url };
  } else {
    const ab = buf || (await (await fetch(url)).arrayBuffer());
    const gltf = await parseGLB(ab);
    const tpl = gltf.scene || gltf.scenes[0];
    normalizeToStage(tpl, 1.8);
    fxBank[url] = { kind: 'glb', url, template: tpl, stats: gatherStats(tpl) };
  }
  G.fxBank = fxBank;
  return fxBank[url];
}

/** point this slot at a file (uploaded or already sitting in models/uploads/).
    Returns true when the effect is too heavy to be a per-cast prop. */
async function assign(url) {
  await bankPut(url);
  const a = asg();                            // re-read: the await may have moved the user
  a.setSrc(url);
  a.setOn(true);
  a.setP(clampFX(a.p, fxKind(url)));          // kind-only rows get their defaults
  if (fxKind(url) === 'video') probeClip(url);
  syncFX();
  refreshLib();
  const st = fxBank[url] && fxBank[url].stats;
  if (st && (st.meshes > 24 || st.tris > 60000)) {
    flash('ASSIGNED, BUT HEAVY: ' + st.meshes + ' MESHES / ' + st.tris.toLocaleString() +
      ' TRIS PER CAST — DECIMATE IN THE DCC AND RE-DROP', '#ffb14a');
    return true;
  }
  flash('FX ASSIGNED → ' + slotLabel(slot).toUpperCase() + ' · ' + HERO_DEFS[active].name, '#3dffb0');
  return false;
}

async function uploadFX(file) {
  if (!file) return;
  const mVid = file.name.match(/\.(mp4|webm|ogv)$/i);
  if (!/\.glb$/i.test(file.name) && !mVid) { flash('USE .GLB OR VIDEO (.MP4/.WEBM/.OGV)', '#ff3b5c'); return; }
  const id = heroId();
  const name = id + (slot === FX_SHARED ? '-fx' : '-s' + slot + '-fx') + '.' + (mVid ? mVid[1].toLowerCase() : 'glb');
  flash('UPLOADING ' + file.name + ' → ' + name + '…');
  try {
    const r = await fetch(UP + '/upload/' + name, { method: 'PUT', body: file });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const url = UPDIR + name;
    const ab = await file.arrayBuffer();
    if (!/\.(mp4|webm|ogv)$/i.test(name)) fxBank[url] = null;   // re-parse the fresh bytes
    if (!(await assign(url))) flash('UPLOADED + ASSIGNED ' + name + ' — SAVE TO KEEP', '#3dffb0');
  } catch (e) {
    flash('FX UPLOAD FAILED: ' + (e.message || e), '#ff3b5c');
  }
}

/* a video billboard should live as long as the clip — read its metadata and
   snap `duration` to it, so the plane never holds a frozen last frame */
function probeClip(url) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('video');
  el.preload = 'metadata';
  el.onloadedmetadata = () => {
    const d = Number(el.duration);
    const a = asg();
    if (Number.isFinite(d) && d > 0 && a.src === url) {
      a.setP(clampFX(Object.assign({}, a.p, { dur: Math.min(4.95, +d.toFixed(2)) }), 'video'));
      syncFX();
    }
    el.removeAttribute('src');
  };
  el.onerror = () => {};
  el.src = url;
}

/* record the studio canvas while this slot's effect plays, then assign the
   recording to the slot as a video effect */
let rec = null;
function recordFX() {
  if (rec) return;
  if (pv.url) stopPreview();        // the plate is the slot's effect, not a stray preview
  if (!renderer.domElement.captureStream || typeof MediaRecorder === 'undefined') {
    flash('RECORDING NOT SUPPORTED IN THIS BROWSER', '#ff3b5c');
    return;
  }
  const id = heroId();
  const name = id + (slot === FX_SHARED ? '-fx' : '-s' + slot + '-fx') + '.webm';
  const ms = Math.round(clamp(asg().p.dur, 0.6, 5) * 1000);
  const chunks = [];
  rec = new MediaRecorder(renderer.domElement.captureStream(30));
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = async () => {
    rec = null;
    $('fxrec').classList.remove('on');
    const blob = new Blob(chunks, { type: 'video/webm' });
    flash('SAVING RECORDING…');
    try {
      const r = await fetch(UP + '/upload/' + name, { method: 'PUT', body: blob });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      fxBank[UPDIR + name] = null;
      if (!(await assign(UPDIR + name))) flash('RECORDED + ASSIGNED ' + name + ' — SAVE TO KEEP', '#3dffb0');
    } catch (e) {
      flash('RECORD SAVE FAILED: ' + (e.message || e), '#ff3b5c');
    }
  };
  $('fxrec').classList.add('on');
  rec.start();
  setAction('cast');
  heroes[active].playFX(G, slot);        // capture this slot's effect as it plays
  setTimeout(() => { if (rec) rec.stop(); }, ms);
}

let libFilter = 'all';        // 'all' | 'glb' | 'video' — the media tab of the panel

async function refreshLib() {
  const box = $('fxlib');
  try {
    const r = await fetch(UP + '/files');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    libFiles = (await r.json()).filter((f) => /\.(glb|mp4|webm|ogv)$/i.test(f.name));
  } catch (e) {
    box.innerHTML = '<div id="note">dropbox offline — start it with<br>python3 tools/upload_server.py</div>';
    return;
  }
  const used = new Map();
  for (const d of HERO_DEFS) {
    const c = cfg[d.id];
    if (!c) continue;
    if (c.fx) used.set(c.fx, (used.get(c.fx) || '') + ' ' + d.name + ':all');
    for (let i = 0; i < FX_SLOTS; i++) {
      const s = (c.fxSlots || [])[i];
      if (s && s.src) used.set(s.src, (used.get(s.src) || '') + ' ' + d.name + ':' + slotLabel(i));
    }
  }
  box.innerHTML = '';
  const shown = libFiles.filter((f) => libFilter === 'all' || fxKind(f.name) !== (libFilter === 'glb' ? 'video' : 'glb'));
  if (!shown.length) {
    box.innerHTML = '<div id="note">' + (libFiles.length
      ? 'no ' + libFilter + ' files in models/uploads — try the other filter'
      : 'nothing in models/uploads yet — drop a file above') + '</div>';
    syncLibTools();
    return;
  }
  const cur = asg().src;
  for (const f of shown) {
    const url = UPDIR + f.name;
    const kind = fxKind(url);
    const row = document.createElement('div');
    row.className = 'lib' + (url === cur ? ' on' : '') + (url === pv.url ? ' pv' : '');
    row._url = url;
    const kb = f.bytes > 0 ? (f.bytes / 1024).toFixed(1) + ' kb' : '—';
    const ent = fxBank[url];
    const cost = ent && ent.stats ? ent.stats.tris.toLocaleString() + ' tris · ' + ent.stats.meshes + ' mesh' + (ent.stats.meshes === 1 ? '' : 'es') : kind;
    const tag = used.has(url) ? used.get(url).trim()
      : /^(aegis|lyra|nyx)\.glb$/i.test(f.name) ? 'hero skin' : 'assign';
    row.innerHTML = `<span>${f.name.replace(/\.(glb|mp4|webm|ogv)$/i, '')}</span>` +
      `<i>${kb} · ${cost}</i><u>${tag}</u>`;
    row.title = used.has(url) ? 'in use by:' + used.get(url) : 'click to assign to slot ' + slotLabel(slot).toUpperCase();
    row.onclick = () => assign(url);
    /* ▶ previews WITHOUT assigning: the same spawnFX a real cast uses, fired at
       the hero, so a file can be judged before it costs a slot. */
    const play = document.createElement('button');
    play.className = 'act mini';
    play.textContent = url === pv.url ? '■' : '▶';
    play.title = 'preview in the arena (no assignment)';
    play.onclick = (e) => { e.stopPropagation(); togglePreview(url); };
    row.appendChild(play);
    box.appendChild(row);
  }
  syncLibTools();
}

/** loop / stop / filter buttons + the line that explains what a preview is using */
function syncLibTools() {
  for (const b of $('fxlibfilter').children) b.classList.toggle('on', b._f === libFilter);
  $('fxloop').classList.toggle('on', pv.loop);
  $('fxstop').style.opacity = pv.url ? '1' : '0.35';
  if (!pv.url) { $('fxlibnote').textContent = '▶ previews any file in the arena without assigning it — click the row to assign.'; return; }
  const ent = fxBank[pv.url], st = ent && ent.stats;
  const r = fxPreviewFor(cfg, heroId(), slot, pv.url);
  $('fxlibnote').textContent = '▶ ' + pv.url.split('/').pop() +
    ' · ' + (ent ? ent.kind + ' · ' : '') + (st ? st.tris.toLocaleString() + ' tris · ' + st.meshes + ' meshes · ' : '') +
    'params from ' + (r.from === 'slot' ? slotLabel(slot).toUpperCase() : r.from === 'shared' ? 'ALL'
      : r.from === 'defaults' ? 'kind defaults' : 'slot ' + r.from.slice(-1)) +
    (pv.loop ? ' · looping' : '') + ' · ▶ again to stop';
}

/* ---------- LIBRARY PREVIEW -------------------------------------------------
   Fire any file in models/uploads at the hero, through the same fxpack.spawnFX
   a real cast uses, without writing anything into the config. That last part is
   the point: fxPreviewFor reads the tuning and hands back a CLAMPED COPY of the
   params the file would cast with, so previewing cannot dirty a save.
   Loop is for the 0.6 s things you cannot judge from one play. */
const pv = { url: null, live: false, loop: false, gap: 0, inst: null, at: 0 };

async function togglePreview(url) {
  if (pv.url === url) { stopPreview(); return; }
  try {
    await bankPut(url);                                  // fetch + parse on demand
  } catch (e) {
    flash('PREVIEW FAILED: ' + (e.message || e), '#ff3b5c');
    return;
  }
  if (!fxBank[url]) { flash('PREVIEW FAILED: NOT IN THE BANK', '#ff3b5c'); return; }
  setAction('idle');      // judge the effect, not the walk cycle (loop keeps your action)
  pv.loop = false;
  firePreview(url);
  const st = fxBank[url] && fxBank[url].stats;
  if (st && (st.meshes > 24 || st.tris > 60000)) {
    flash('PREVIEW LOOKS FINE, BUT IT IS HEAVY: ' + st.meshes + ' MESHES / ' + st.tris.toLocaleString() +
      ' TRIS PER CAST', '#ffb14a');
  }
}

function firePreview(url, quiet) {
  const ent = fxBank[url];
  const { p } = fxPreviewFor(cfg, heroId(), slot, url);
  const h = heroes[active];
  const inst = spawnFX(G, ent, p, new THREE.Vector3(h.pos.x, p.y, h.pos.z), h.facing || 0);
  pv.url = url; pv.inst = inst; pv.live = true; pv.at = G.time; pv.gap = 0.22;
  G.addEffect({
    t: 0, dur: p.dur,
    update(dt) { const alive = inst.update(dt); pv.live = alive; return alive; },
    dispose() { inst.kill(); pv.live = false; },
  });
  if (!quiet) flash('PREVIEW · ' + url.split('/').pop().toUpperCase() + (p.dur > 0 ? ' · ' + p.dur.toFixed(2) + ' s' : ''), '#7cf9ff');
  refreshLibRows();
  syncLibTools();
}

function stopPreview() {
  const had = !!pv.url;
  pv.loop = false; pv.url = null; pv.gap = 0;
  if (pv.inst) { pv.inst.kill(); pv.inst = null; }
  pv.live = false;
  if (had) { refreshLibRows(); syncLibTools(); }
}

/* class-only refresh: a full refreshLib() re-fetches the listing, and the loop
   would be doing that every time a preview ends */
function refreshLibRows() {
  for (const row of $('fxlib').children) {
    if (!row._url) continue;
    row.classList.toggle('pv', row._url === pv.url);
    const b = row.querySelector('button');
    if (b) b.textContent = row._url === pv.url ? '■' : '▶';
  }
}

/* called from the render loop: re-fire while looping, drop the highlight after a
   one-shot preview finishes */
function tickPreview(dt) {
  if (!pv.url || pv.live) return;
  if (pv.loop) { if ((pv.gap -= dt) <= 0) firePreview(pv.url, true); return; }   // quiet: a flash per fire is a strobe
  if (G.time - pv.at > 0.05) { pv.url = null; pv.inst = null; refreshLibRows(); syncLibTools(); }
}

function syncFX() {
  const a = asg();
  const c = cfg[heroId()];
  for (const b of $('fxslots').children) {
    b.classList.toggle('on', b._slot === slot);
    const s = b._slot === FX_SHARED ? { src: c.fx } : (c.fxSlots || [])[b._slot];
    b.classList.toggle('has', !!(s && s.src));
  }
  const nm = a.src ? a.src.split('/').pop() : null;
  const shared = a.src && slot !== FX_SHARED && a.src === c.fx;
  if (nm) {
    const ent = fxBank[a.src];
    const cost = ent && ent.stats ? ' <em>' + ent.stats.tris.toLocaleString() + ' tris · ' + ent.stats.meshes + ' mesh' + (ent.stats.meshes === 1 ? '' : 'es') + '</em>' : '';
    $('fxname').innerHTML = a.src.split('/').pop() + cost +
      (a.on ? '' : ' <em>(muted)</em>') +
      (fxKind(a.src) === 'video' ? ' <em>video billboard</em>' : ' <em>glb prop</em>') +
      (shared ? ' <em>(same as ALL)</em>' : '');
  } else {
    $('fxname').innerHTML = c.fx
      ? 'this slot is empty → falls back to ALL'
      : 'none assigned — drop a .glb / video, or pick from the library';
  }
  $('fxon').classList.toggle('on', !!a.on);
  $('fxon').textContent = a.on ? 'on' : 'muted';
  $('fxclear').style.opacity = a.src ? '1' : '0.35';
  syncFXPanel();
}

function setActive(i) {
  active = i;
  heroes.forEach((h, k) => {
    const on = k === i;
    h.group.visible = on;
    if (h.drone) h.drone.group.visible = on;
  });
  document.querySelectorAll('#head .tab').forEach((t, k) => t.classList.toggle('on', k === i));
  buildChips();
  syncPanel();
}

function setAction(a) {
  action = a;
  const h = heroes[active];
  if (a === 'attack') h.attackAnim = 1;
  if (a === 'cast') h.castAnim = 1;
  if (a === 'hurt') h.hurtAnim = 1;
  if (a === 'down') h.downed = true;
  if (a === 'idle' || a === 'walk') h.downed = false;
  document.querySelectorAll('#bottom [data-a]').forEach((b) => b.classList.toggle('on', b.dataset.a === a));
}

async function save() {
  flash('SAVING…');
  try {
    const r = await fetch(UP + '/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const n = fxCount(cfg);
    flash('SAVED — ' + n + ' FX SLOT' + (n === 1 ? '' : 'S') + ' · RESTART THE RUN TO APPLY', '#3dffb0');
    refreshLib();
  } catch (e) {
    flash('SAVE FAILED: ' + (e.message || e) + ' (is tools/upload_server.py running?)', '#ff3b5c');
  }
}
/* ---------- wire UI ---------- */
$('sz').oninput = () => {
  const v = +$('sz').value;
  heroes[active].setScale(v);
  cfg[heroId()].scale = heroes[active].tunScale;
  $('hgt').textContent = (2.4 * heroes[active].tunScale).toFixed(2) + ' m';
  measureFit();          // size moves the feet unless the base rides with it
};
$('save').onclick = save;
$('pclift').onclick = () => nudgePlacementTo((k) => {
  const before = measureFit();
  return k === 'y' ? cfg[heroId()].pos.y - (before ? before.min : 0) : cfg[heroId()].pos[k];
});
$('pcreset').onclick = () => { nudgePlacementTo(() => 0); flash('PLACEMENT RESET TO THE LOADER\u2019S OWN', '#7cf9ff'); };
$('spin').onclick = () => {
  const on = $('spin').classList.toggle('on');
  controls.autoRotate = on; controls.autoRotateSpeed = 2.2;
};
$('fxplay').onclick = () => {
  const a = asg();
  if (!a.src) { flash('NO FX IN ' + slotLabel(slot).toUpperCase() + ' — DROP A FILE OR PICK ONE', '#ffb14a'); return; }
  if (!heroes[active].playFX(G, slot)) flash('FX FILE NOT IN THE BANK — RE-ASSIGN IT', '#ffb14a');
};
$('fxrec').onclick = recordFX;
$('fxon').onclick = () => { const a = asg(); a.setOn(!a.on); syncFX(); };
$('fxclear').onclick = () => {
  const a = asg();
  if (!a.src) { flash('NOTHING TO CLEAR IN ' + slotLabel(slot).toUpperCase(), '#ffb14a'); return; }
  a.setSrc(null);
  a.setP(clampFX(a.p, 'glb'));
  syncFX();
  flash('CLEARED ' + slotLabel(slot).toUpperCase() + ' — SAVE TO KEEP', '#ff8a2b');
};
$('fxcopy').onclick = () => {
  if (slot === FX_SHARED) { flash('PICK Q / E / R FIRST — ALL IS THE SOURCE', '#ffb14a'); return; }
  const c = cfg[heroId()];
  if (!c.fx) { flash('NOTHING IN ALL TO COPY', '#ffb14a'); return; }
  const a = asg();
  a.setP(clampFX(Object.assign({}, c.fxP), fxKind(c.fx)));
  a.setSrc(c.fx);
  a.setOn(true);
  syncFX();
  flash('COPIED ALL → ' + slotLabel(slot).toUpperCase() + ' · TUNE FREELY', '#3dffb0');
};
$('fxref').onclick = refreshLib;
const FILTERS = { 'fxf-all': 'all', 'fxf-glb': 'glb', 'fxf-video': 'video' };
for (const b of $('fxlibfilter').children) {
  b._f = FILTERS[b.id] || 'all';
  b.onclick = () => { libFilter = b._f; refreshLib(); };
}
$('fxloop').onclick = () => {
  if (!pv.url) { flash('CLICK ▶ ON A LIBRARY ROW FIRST', '#ffb14a'); return; }
  pv.loop = !pv.loop;
  if (pv.loop && !pv.live) firePreview(pv.url);
  syncLibTools();
};
$('fxstop').onclick = () => stopPreview();
$('fxdrop').onclick = () => $('fxfile').click();
$('fxfile').onchange = (e) => uploadFX(e.target.files[0]);
addEventListener('dragover', (e) => { e.preventDefault(); $('fxdrop').classList.add('hot'); });
addEventListener('dragleave', (e) => { if (e.relatedTarget === null) $('fxdrop').classList.remove('hot'); });
addEventListener('drop', (e) => {
  e.preventDefault(); $('fxdrop').classList.remove('hot');
  uploadFX(e.dataTransfer.files[0]);
});
document.querySelectorAll('#bottom [data-a]').forEach((b) => { b.onclick = () => setAction(b.dataset.a); });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function syncPanel() {
  const h = heroes[active], d = HERO_DEFS[active], c = cfg[d.id];
  document.documentElement.style.setProperty('--c', '#' + d.color.toString(16).padStart(6, '0'));
  $('gname').textContent = d.name;
  $('tris').textContent = gatherStats(h.rig.glb ? h.body : h.group).tris.toLocaleString();
  $('hgt').textContent = (2.4 * h.tunScale).toFixed(2) + ' m';
  $('sz').value = h.tunScale;
  for (const row of $('mot').children) {
    const v = c.motion[row._key];
    row._input.value = v;
    row._out.textContent = (+v).toFixed(row._dec);
  }
  syncPlacement();
  measureFit();
  syncFX();
}

/* ---------- boot ---------- */
(async () => {
  G.glbSkins = await ensureGLBSkins();
  cfg = await ensureTuning();
  G.glbTuning = cfg;
  for (const d of HERO_DEFS) {                       // normalise for the editor
    const c = cfg[d.id];
    c.fxP = clampFX(c.fxP, fxKind(c.fx || ''));
    for (let i = 0; i < FX_SLOTS; i++) fxEdit(cfg, d.id, i);   // materialise every slot
  }
  fxBank = await loadFXBank(cfg);
  G.fxBank = fxBank;

  heroes = HERO_DEFS.map((d, i) => new Hero(d, G, i));
  heroes.forEach((h) => {
    h.motion = cfg[h.def.id].motion;
    h.offset = cfg[h.def.id].pos;
  });

  const tabs = $('head');
  HERO_DEFS.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.innerHTML = `<b>${d.name}</b><span>${d.role}</span>`;
    b.onclick = () => setActive(i);
    tabs.appendChild(b);
  });

  buildSliders();
  buildChips();
  setActive(0);
  setAction('idle');
  refreshLib();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    G.time += dt;
    controls.update();
    const h = heroes[active];
    h.attackAnim = Math.max(0, h.attackAnim - dt * 5);
    h.castAnim = Math.max(0, h.castAnim - dt * 2.2);
    h.hurtAnim = Math.max(0, h.hurtAnim - dt * 4);
    if (action === 'attack' && h.attackAnim <= 0) h.attackAnim = 1;   // loop the preview
    if (action === 'cast' && h.castAnim <= 0) h.castAnim = 1;
    if (action === 'hurt' && h.hurtAnim <= 0) h.hurtAnim = 1;
    const spd = action === 'walk' ? 1 : 0;
    if (h.rig.glb) {
      h.animateGLB(dt, G, spd);
    } else {
      animateRig(h.rig, dt, {
        speed: clamp(spd, 0, 1.4), time: G.time, attack: h.attackAnim,
        cast: h.castAnim, dead: h.downed, hurt: h.hurtAnim,
        style: h.def.style, block: h.def.id === 'aegis',
      });
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      if (!e.update(dt)) { if (e.dispose) e.dispose(); effects.splice(i, 1); }
    }
    if (G.time - (measureFit.t || 0) > 0.3) { measureFit.t = G.time; measureFit(); }
    tickPreview(dt);
    renderer.render(scene, camera);
  });
  flash('STUDIO READY — TUNE & SAVE', '#7cf9ff');
})();
