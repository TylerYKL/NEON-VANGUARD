import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Hero, HERO_DEFS } from './heroes.js';
import { ensureGLBSkins, ensureTuning, normalizeTuning, loadFXBank, ANIM_NAME_KEYS } from './glbskin.js';
import { parseGLB, normalizeToStage, gatherStats } from './gltfutil.js';
import { animateRig } from './rig.js';
import { clampFX, fxCount, fxDefsFor, fxEdit, fxKind, fxPreviewFor, FX_SHARED, FX_SLOTS, spawnFX } from './fxpack.js';
import { clampVFX, VFX_AUDIO_NUM_DEFS, VFX_COLOR_DEFS, VFX_NUM_DEFS, VFX_OPT_DEFS, VFX_SHARED, VFX_SLOTS, spawnVFX, vfxCount, vfxEdit } from './vfx.js';
import { createSim, SIM_TARGETS, SIM_SPEEDS } from './sim.js';
import { clamp } from './util.js';
import { SFX } from './audio.js';

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

/* Keep a WebGL/loader failure visible instead of leaving a silent black canvas.
   This is especially useful on a preview host where the asset API and the page
   run on sibling ports. */
function reportStudioError(label, value) {
  const msg = $('msg');
  const text = label + ': ' + (value && (value.message || value.reason || value) || 'unknown error');
  console.error('[Hero Studio] ' + text);
  if (msg) { msg.textContent = text; msg.style.color = '#ff3b5c'; }
}
addEventListener('error', (e) => reportStudioError('STUDIO ERROR', e.error || e.message));
addEventListener('unhandledrejection', (e) => reportStudioError('STUDIO LOAD ERROR', e.reason));

/* The properties rail is long by design: it contains the body fit, clip binding,
   CAST SIM, and every FX slot. Keep every parameter available, but let artists
   narrow the rail to the sections they are actively editing. The section wrapper
   is built from the existing labels so the editor's stable element IDs and live
   bindings do not change. */
function initPropertySections() {
  const panel = $('right');
  if (!panel) return;
  const tools = document.createElement('div');
  tools.id = 'propTools';
  tools.innerHTML = '<button class="act" id="propsNarrow" title="Collapse every settings section">narrow all</button>' +
    '<button class="act" id="propsExpand" title="Expand every settings section">expand all</button>';
  panel.insertBefore(tools, panel.firstChild);
  const heads = Array.from(panel.children).filter((n) => n.classList && n.classList.contains('lbl'));
  const sections = [];
  for (const head of heads) {
    const section = document.createElement('section');
    section.className = 'propSection';
    panel.insertBefore(section, head);
    section.appendChild(head);
    head.classList.add('sectionHead');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    const move = () => {
      const collapsed = section.classList.toggle('isCollapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
    };
    head.addEventListener('click', (e) => {
      if (e.target.closest('button, input, select, a')) return;
      move();
    });
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); move(); }
    });
    let node = section.nextSibling;
    while (node && !(node.nodeType === 1 && node.classList.contains('lbl'))) {
      const next = node.nextSibling;
      section.appendChild(node);
      node = next;
    }
    sections.push(section);
  }
  const setAll = (open) => {
    for (const section of sections) {
      section.classList.toggle('isCollapsed', !open);
      const head = section.querySelector('.sectionHead');
      if (head) head.setAttribute('aria-expanded', String(open));
    }
    try { localStorage.setItem('nv.studio.properties', open ? 'expanded' : 'narrow'); } catch (e) {}
  };
  $('propsNarrow').onclick = () => setAll(false);
  $('propsExpand').onclick = () => setAll(true);
  try {
    const saved = localStorage.getItem('nv.studio.properties');
    if (saved === 'narrow') setAll(false);
  } catch (e) {}
}
initPropertySections();

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

/* ---------- camera view ----------
   FOLLOW keeps the active hero centred, including when the CAST SIM moves it.
   FREE leaves OrbitControls' target exactly where the artist put it, so poses,
   hero switches and simulated movement cannot steal a hand-built composition. */
let cameraMode = 'follow';
const cameraFollowTarget = new THREE.Vector3();
const cameraModeEl = $('cameraMode');
const cameraModeButtons = cameraModeEl.querySelectorAll('[data-camera-mode]');
function setCameraMode(mode, silent = false) {
  if (mode !== 'follow' && mode !== 'free') return;
  cameraMode = mode;
  if (mode === 'free' && controls.autoRotate) {
    // A free view should hold still; auto-spin can be re-enabled explicitly.
    controls.autoRotate = false;
    $('spin').classList.remove('on');
  }
  cameraModeButtons.forEach((b) => {
    const active = b.dataset.cameraMode === mode;
    b.classList.toggle('on', active);
    b.setAttribute('aria-pressed', String(active));
  });
  cameraModeEl.dataset.mode = mode;
  if (!silent) flash(mode === 'follow' ? 'CAMERA FOLLOW' : 'CAMERA FREE VIEW', '#7cf9ff');
}
cameraModeButtons.forEach((b) => { b.onclick = () => setCameraMode(b.dataset.cameraMode); });
setCameraMode('follow', true);

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

let configDirty = false;
let baseConfig = null;
function markDirty() {
  configDirty = true;
  const el = $('saveState');
  if (el) { el.textContent = 'UNSAVED'; el.className = 'warn'; }
}
function markClean() {
  configDirty = false;
  const el = $('saveState');
  if (el) { el.textContent = 'SAVED'; el.className = 'ok'; }
}
function syncApplyState() {
  const b = $('applyPreview');
  if (!b) return;
  b.classList.toggle('on', skinStale);
  b.textContent = skinStale ? 'apply + rebuild' : 'rebuild preview';
}

/* studio-side copy of the upload server origin (same sandbox, port 8081).
   Preview hosts use the platform's `8080-…` / `8081-…` hostnames; local runs use
   the same protocol and an explicit port. Keeping this here instead of hardcoding
   localhost makes the importer work in both environments. */
const UP = (() => {
  const host = location.hostname;
  if (/^\d+-/.test(host)) return location.protocol + '//' + host.replace(/^\d+-/, '8081-');
  return location.protocol + '//' + host + ':8081';
})();
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
  ['recoilKick', 'recoil kick', 0, 0.3, 0.005],
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

/* ---------------- GLB MODEL + CLIPS (tuning v3) ----------------
   Two rows that answer the same complaint from the other side: the file a hero wears is
   not a code change any more, and neither is which clip means "walk". */
const AN_DEFS = [
  ['speed', 'clip speed', 0.1, 4, 0.01],
  ['fade', 'cross-fade s', 0, 1, 0.005],
];
const AN_LABELS = { idle: 'idle clip', walk: 'walk clip', attack: 'attack clip', hurt: 'hurt clip', death: 'death clip' };

function buildAnim() {
  const box = $('anim');
  box.innerHTML = '';
  for (const k of ANIM_NAME_KEYS) {
    const row = document.createElement('div');
    row.className = 'mrow';
    row.innerHTML = '<span>' + AN_LABELS[k] + '</span><input type="text" maxlength="64" spellcheck="false"><b></b>';
    const inp = row.querySelector('input'), out = row.querySelector('b');
    inp.oninput = () => {
      const c = cfg[heroId()];
      c.anim[k] = inp.value.trim() || 'auto';
      markDirty();
      /* Re-resolve on the hero, not just in the config: `syncAnim` below reads what the
         mixer actually bound, so the echo and the pose agree. When there is no mixer (clips
         off, or a file with nothing to play) this is a no-op and the row says why. */
      const h = heroes[active];
      if (h && h.rebindClip && !skinStale) h.rebindClip(k, c.anim[k]);
      syncAnim();
    };
    row._name = k; row._input = inp; row._out = out;
    box.appendChild(row);
  }
  for (const [k, label, min, max, step] of AN_DEFS) {
    const row = sliderRow(label, min, max, step, (v, out) => {
      cfg[heroId()].anim[k] = v;
      markDirty();
      const h = heroes[active];
      if (h.anim) h.anim.a[k] = v;                 // takes effect on the next pose frame
      out.textContent = v.toFixed(k === 'fade' ? 3 : 2);
    });
    row._num = k; row._dec = k === 'fade' ? 3 : 2;
    box.appendChild(row);
  }
}
/* the clip census of the file this hero is currently wearing, and a name → clip check */
const fileClips = () => {
  const skin = (G.glbSkins || {})[heroId()];
  return skin && skin.clips ? skin.clips.map((c) => c.name || 'clip') : [];
};
function matched(want) {
  const list = fileClips(), w = String(want || '').toLowerCase();
  const hit = list.find((n) => n.toLowerCase() === w) || list.find((n) => n.toLowerCase().includes(w));
  return hit || null;
}
/* True once `model` or `clips on/off` moved: the mixer was built at load against the
 * PREVIOUS file, so every echo in this block would be describing a body that is about to be
 * replaced. Saying so is the whole point — a stale "Walk" next to a slot is exactly how
 * "the game ignores my animation" gets misdiagnosed as a loader bug. */
let skinStale = false;
function syncAnim() {
  const c = cfg[heroId()], h = heroes[active], box = $('anim');
  for (const row of box.children) {
    if (row._name) {
      row._input.value = c.anim[row._name];
      const resolved = h.anim && h.anim.used[row._name];
      const lost = h.anim && h.anim.clash.find((c) => c.slot === row._name);
      if (skinStale) { row._out.textContent = 'not applied yet'; row._out.className = 'warn'; }
      else if (resolved) { row._out.textContent = resolved; row._out.className = 'ok'; }
      else if (lost) { row._out.textContent = '`' + lost.clip + '` → ' + lost.takenBy; row._out.className = 'warn'; }
      else if (!h.rig.glb) { row._out.textContent = 'n/a (procedural)'; row._out.className = ''; }
      else if (!h.anim) { row._out.textContent = fileClips().length ? 'clips are off' : 'no clips in file'; row._out.className = 'warn'; }
      else if (c.anim[row._name] === 'auto') { row._out.textContent = 'auto · nothing matched'; row._out.className = 'warn'; }
      else { row._out.textContent = 'not in file'; row._out.className = 'warn'; }
    } else if (row._num) {
      row._input.value = c.anim[row._num];
      row._out.textContent = (+c.anim[row._num]).toFixed(row._dec);
    }
  }
  const on = $('animon');
  on.textContent = c.anim.on ? 'clips on' : 'clips off';
  on.classList.toggle('on', !!c.anim.on);
  const names = fileClips();
  const parts = [];
  if (skinStale) parts.push('SKIN CHANGED — rows describe the PREVIOUS file. APPLY + REBUILD PREVIEW to install it.');
  parts.push(names.length ? names.length + ' clip(s) here: ' + names.join(' · ')
    : (h.rig.glb ? 'this file has NO clips — the transform layer is all it can do' : 'procedural rig — no GLB file in use'));
  if (h.anim && h.anim.miss.length) parts.push('named but missing: ' + h.anim.miss.join(', '));
  if (h.anim && h.anim.clash.length) {
    parts.push('one clip drives one layer — ' + h.anim.clash.map((c) =>
      c.clip + ' is also named for ' + c.slot + (c.takenBy ? ' (held by ' + c.takenBy + ')' : '')).join(' · '));
  }
  $('animnote').innerHTML = parts.join('<br>');
  $('animnote').className = skinStale ? 'warn' : (h.anim ? 'ok' : '');
  const sel = $('mdl');
  if (sel) sel.value = c.model || '';
  $('mdlnote').textContent = c.model ? c.model.replace('models/uploads/', '') : 'default';
}
$('animon').onclick = () => {
  const c = cfg[heroId()];
  c.anim.on = c.anim.on ? 0 : 1;
  markDirty();
  /* the mixer's existence is decided in build(), so this one really does need a reload —
     unlike the name rows, which re-bind live through Hero.rebindClip */
  skinStale = true;
  syncApplyState();
  flash(c.anim.on ? 'CLIPS ENABLED — SAVE, THEN RELOAD THIS TAB (the mixer is built at load)'
    : 'CLIPS IGNORED — the file still drives nothing; SAVE, THEN RELOAD', '#ffb14a');
  syncAnim();
};
function buildModelSelect() {
  const sel = $('mdl');
  if (!sel) return;
  const glbs = libFiles.filter((f) => /\.(glb|gltf)$/i.test(f.name));
  sel.innerHTML = '<option value="">&lt;id&gt;.glb (manifest)</option>' +
    glbs.map((f) => '<option value="' + UPDIR + f.name + '">' + f.name + ' · ' + Math.round((f.bytes || 0) / 1024) + 'k</option>').join('');
  sel.onchange = () => {
    cfg[heroId()].model = sel.value || null;
    markDirty();
    skinStale = true;              // nothing below this row can be previewed until the body is rebuilt
    syncApplyState();
    flash(sel.value ? 'SKIN = ' + sel.value.replace(UPDIR, '') + ' — APPLY + REBUILD PREVIEW'
      : 'SKIN = the manifest default — APPLY + REBUILD PREVIEW', '#ffb14a');
    syncAnim();
  };
  sel.value = (cfg[heroId()] || {}).model || '';   // the list arrives after the first sync
}

async function uploadHeroGLB(file) {
  if (!file) return;
  if (!/\.glb$/i.test(file.name)) {
    flash('HERO IMPORT ONLY ACCEPTS .GLB FILES', '#ff3b5c');
    return;
  }
  const safe = file.name.replace(/[^\w.\-]+/g, '-').replace(/\.glb$/i, '').slice(0, 70) || 'hero';
  const name = heroId() + '-skin-' + safe + '.glb';
  flash('IMPORTING HERO GLB ' + file.name + ' → ' + name + '…');
  try {
    const r = await fetch(UP + '/upload/' + name, { method: 'PUT', body: file });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const url = UPDIR + name;
    cfg[heroId()].model = url;
    skinStale = true;
    markDirty();
    await refreshLib();
    buildModelSelect();
    syncAnim();
    syncApplyState();
    flash('GLB IMPORTED + ASSIGNED — APPLY + REBUILD PREVIEW', '#3dffb0');
  } catch (e) {
    flash('HERO GLB IMPORT FAILED: ' + (e.message || e), '#ff3b5c');
  }
}

function buildSliders() {
  $('mot').innerHTML = '';
  for (const [k, label, min, max, step] of MOT_DEFS) {
    const row = sliderRow(label, min, max, step, (v, out) => {
      cfg[HERO_DEFS[active].id].motion[k] = v;
      heroes[active].motion[k] = v;
      markDirty();
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
      markDirty();
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
  markDirty();
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
let audioFiles = [];
let audioPreview = null;
let vfxSlot = VFX_SHARED;

const SKILL_REFERENCE_ART = [
  { hero: 'AEGIS-7', key: 'impact', src: 'concept/upsampler/aegis-7-effect.png' },
  { hero: 'AEGIS-7', key: 'special', src: 'concept/upsampler/aegis-7-special.png' },
  { hero: 'LYRA-V', key: 'impact', src: 'concept/upsampler/lyra-v-effect.png' },
  { hero: 'LYRA-V', key: 'special', src: 'concept/upsampler/lyra-v-special.png' },
  { hero: 'NYX-0', key: 'impact', src: 'concept/upsampler/nyx-0-effect.png' },
  { hero: 'NYX-0', key: 'special', src: 'concept/upsampler/nyx-0-special.png' },
];

function showSkillReference(ref) {
  const overlay = $('refOverlay');
  const img = $('refOverlayImg');
  if (!overlay || !img) return;
  img.src = ref.src;
  img.alt = ref.hero + ' ' + ref.key + ' skill reference';
  $('refOverlayName').textContent = ref.hero + ' · ' + ref.key + ' · visual target';
  overlay.classList.add('on');
  document.querySelectorAll('.skillRef').forEach((el) => el.classList.toggle('on', el._ref === ref));
}

function setRefPhase(text) {
  const el = $('refPhase');
  if (el) el.textContent = text;
}

function buildReferenceGallery() {
  const box = $('skillRefs');
  if (!box) return;
  box.innerHTML = '';
  for (const ref of SKILL_REFERENCE_ART) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'skillRef';
    card._ref = ref;
    card.title = 'Open ' + ref.hero + ' ' + ref.key + ' skill reference';
    card.innerHTML = `<img src="${ref.src}" alt=""><b>${ref.hero} · ${ref.key}</b>`;
    card.onclick = () => showSkillReference(ref);
    box.appendChild(card);
  }
}

const heroId = () => HERO_DEFS[active].id;
const vfxAsg = () => vfxEdit(cfg, heroId(), vfxSlot);
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
      markDirty();
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
      markDirty();
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
  cin.oninput = () => { asg().p.tint = cin.value; markDirty(); cout.textContent = cin.value; };
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
  markDirty();
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

function stopAudioPreview() {
  if (audioPreview) {
    audioPreview.pause();
    audioPreview.currentTime = 0;
    audioPreview = null;
  }
}

function playAudioPreview(url) {
  stopAudioPreview();
  if (!url) return;
  audioPreview = new Audio(url);
  audioPreview.volume = 0.75;
  audioPreview.onended = () => { audioPreview = null; buildFXAudio(); buildVFXAudio(); };
  audioPreview.play().catch(() => flash('AUDIO PREVIEW BLOCKED — CLICK THE PLAY BUTTON AGAIN', '#ffb14a'));
  buildVFXAudio();
}

function setVFXAudio(url) {
  const a = vfxAsg();
  a.setP(Object.assign({}, a.p, { audio: url || null }));
  markDirty();
  syncVFX();
  buildVFXAudio();
  flash(url ? 'AUDIO ASSIGNED → ' + vfxSlotLabel(vfxSlot) + ' · SAVE TO KEEP' : 'AUDIO CLEARED · SAVE TO KEEP', url ? '#3dffb0' : '#ff8a2b');
}

async function uploadVFXAudio(file) {
  if (!file) return;
  const ext = (file.name.match(/\.(ogg|wav|mp3|m4a|aac|opus|flac)$/i) || [])[1];
  if (!ext) { flash('USE .OGG, .WAV, .MP3, .M4A, .AAC, .OPUS, OR .FLAC', '#ff3b5c'); return; }
  const id = heroId();
  const slotPart = vfxSlot === VFX_SHARED ? 'all' : 's' + vfxSlot;
  const name = id + '-vfx-' + slotPart + '.' + ext.toLowerCase();
  flash('UPLOADING AUDIO ' + file.name + ' → ' + name + '…');
  try {
    const r = await fetch(UP + '/upload/' + name, { method: 'PUT', body: file });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const url = UPDIR + name;
    setVFXAudio(url);
    await refreshLib();
    flash('AUDIO UPLOADED + ASSIGNED ' + name + ' — SAVE TO KEEP', '#3dffb0');
  } catch (e) {
    flash('AUDIO UPLOAD FAILED: ' + (e.message || e), '#ff3b5c');
  }
}

function setFXAudio(url) {
  const a = asg();
  a.setP(Object.assign({}, a.p, { audio: url || null }));
  markDirty();
  syncFX();
  flash(url ? 'LEGACY FX AUDIO ASSIGNED → ' + slotLabel(slot) + ' · SAVE TO KEEP' : 'LEGACY FX AUDIO CLEARED · SAVE TO KEEP', url ? '#3dffb0' : '#ff8a2b');
}

async function uploadFXAudio(file) {
  if (!file) return;
  const ext = (file.name.match(/\.(ogg|wav|mp3|m4a|aac|opus|flac)$/i) || [])[1];
  if (!ext) { flash('USE .OGG, .WAV, .MP3, .M4A, .AAC, .OPUS, OR .FLAC', '#ff3b5c'); return; }
  const id = heroId();
  const slotPart = slot === FX_SHARED ? 'all' : 's' + slot;
  const name = id + '-fx-' + slotPart + '.' + ext.toLowerCase();
  flash('UPLOADING FX AUDIO ' + file.name + ' → ' + name + '…');
  try {
    const r = await fetch(UP + '/upload/' + name, { method: 'PUT', body: file });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    setFXAudio(UPDIR + name);
    await refreshLib();
    flash('FX AUDIO UPLOADED + ASSIGNED ' + name + ' — SAVE TO KEEP', '#3dffb0');
  } catch (e) {
    flash('FX AUDIO UPLOAD FAILED: ' + (e.message || e), '#ff3b5c');
  }
}

function buildFXAudio() {
  const box = $('fxaudiolist');
  if (!box) return;
  const current = asg().p.audio;
  $('fxaudioname').textContent = current
    ? current.split('/').pop() + ' · ' + slotLabel(slot)
    : 'no legacy FX audio cue assigned';
  $('fxaudioclear').style.opacity = current ? '1' : '0.35';
  box.innerHTML = '';
  if (!audioFiles.length) {
    box.innerHTML = '<div id="note">no audio in models/uploads yet — drop a CC0 OGG/WAV above</div>';
    return;
  }
  for (const f of audioFiles) {
    const url = UPDIR + f.name;
    const row = document.createElement('div');
    row.className = 'lib audioLib' + (url === current ? ' on' : '');
    row.innerHTML = `<span>${f.name}</span><i>${(f.bytes / 1024).toFixed(1)} kb · audio</i><u>${url === current ? 'assigned' : 'assign'}</u>`;
    row.title = 'click to assign this cue to the legacy ' + slotLabel(slot) + ' slot';
    row.onclick = () => setFXAudio(url);
    const play = document.createElement('button');
    play.className = 'act mini'; play.textContent = audioPreview && audioPreview.src.endsWith(url) ? '■' : '▶';
    play.title = 'preview audio';
    play.onclick = (e) => { e.stopPropagation();
      if (audioPreview && audioPreview.src.endsWith(url)) stopAudioPreview(); else playAudioPreview(url);
      buildFXAudio();
    };
    row.appendChild(play); box.appendChild(row);
  }
}

function buildVFXAudio() {
  const box = $('vfxaudiolist');
  if (!box) return;
  const p = vfxAsg().p;
  const current = p.audio;
  $('vfxaudioname').textContent = current
    ? current.split('/').pop() + ' · ' + vfxSlotLabel(vfxSlot).toUpperCase()
    : 'no audio cue assigned';
  $('vfxaudioclear').style.opacity = current ? '1' : '0.35';
  box.innerHTML = '';
  if (!audioFiles.length) {
    box.innerHTML = '<div id="note">no audio in models/uploads yet — drop a CC0 OGG/WAV above</div>';
    return;
  }
  for (const f of audioFiles) {
    const url = UPDIR + f.name;
    const row = document.createElement('div');
    row.className = 'lib audioLib' + (url === current ? ' on' : '');
    row._url = url;
    row.innerHTML = `<span>${f.name}</span><i>${(f.bytes / 1024).toFixed(1)} kb · audio</i><u>${url === current ? 'assigned' : 'assign'}</u>`;
    row.title = 'click to assign this cue to ' + vfxSlotLabel(vfxSlot).toUpperCase();
    row.onclick = () => setVFXAudio(url);
    const play = document.createElement('button');
    play.className = 'act mini';
    play.textContent = audioPreview && audioPreview.src.endsWith(url) ? '■' : '▶';
    play.title = 'preview audio';
    play.onclick = (e) => { e.stopPropagation();
      if (audioPreview && audioPreview.src.endsWith(url)) stopAudioPreview(); else playAudioPreview(url);
      buildVFXAudio();
    };
    row.appendChild(play);
    box.appendChild(row);
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
      markDirty();
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
    const files = await r.json();
    libFiles = files.filter((f) => /\.(glb|mp4|webm|ogv)$/i.test(f.name));
    audioFiles = files.filter((f) => /\.(ogg|wav|mp3|m4a|aac|opus|flac)$/i.test(f.name));
    buildModelSelect();            // the SKIN picker is the same list, filtered to models
    buildVFXAudio();
  } catch (e) {
    audioFiles = [];
    box.innerHTML = '<div id="note">dropbox offline — start it with<br>python3 tools/upload_server.py</div>';
    buildModelSelect();
    buildVFXAudio();
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
  SFX.init();
  SFX.resume();
  if (p.audio) SFX.playClip(p.audio, { volume: p.audioVol, rate: p.audioRate });
  pv.url = url; pv.inst = inst; pv.live = true; pv.at = G.time; pv.gap = 0.22;
  G.addEffect({
    t: 0, dur: p.dur,
    update(dt) { const alive = inst.update(dt); pv.live = alive; return alive; },
    dispose() { inst.kill(); pv.live = false; },
  });
  setRefPhase('PREVIEW · ' + url.split('/').pop().toUpperCase() + ' · impact → hold → fade');
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
  buildFXAudio();
}

/* ============================================================
   GPU PARTICLE VFX EDITOR
   A profile is independent from the uploaded GLB/video slots. It is previewable
   without being enabled, and the same serialised profile is consumed by the game.
   ============================================================ */
function vfxSlotLabel(i) {
  if (i === VFX_SHARED) return 'ALL';
  const sk = HERO_DEFS[active].skills[i];
  return sk ? sk.key : 'S' + i;
}

function buildVFXChips() {
  const box = $('vfxslots');
  if (!box) return;
  box.innerHTML = '';
  const make = (i, title) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<b>${vfxSlotLabel(i)}</b>${i === VFX_SHARED ? 'shared' : slotName(i)}<i></i>`;
    b.title = title;
    b._vfxSlot = i;
    b.onclick = () => { vfxSlot = i; syncVFX(); };
    box.appendChild(b);
  };
  make(VFX_SHARED, 'GPU profile for every skill unless a skill profile overrides it');
  for (let i = 0; i < VFX_SLOTS; i++) make(i, 'GPU profile for skill ' + vfxSlotLabel(i));
}

function buildVFXPanel() {
  const box = $('vfxp');
  if (!box) return;
  box.innerHTML = '';
  const a = vfxAsg();
  for (const [key, label, min, max, step] of VFX_NUM_DEFS) {
    const row = sliderRow(label, min, max, step, (value, out) => {
      const next = Object.assign({}, vfxAsg().p, { [key]: value });
      vfxAsg().setP(next);
      markDirty();
      out.textContent = step < 0.1 ? (+value).toFixed(2) : (+value).toFixed(step < 1 ? 1 : 0);
    });
    row._vfxKey = key;
    row._input.value = a.p[key];
    row._out.textContent = step < 0.1 ? (+a.p[key]).toFixed(2) : (+a.p[key]).toFixed(step < 1 ? 1 : 0);
    box.appendChild(row);
  }
  for (const [key, label, opts] of VFX_OPT_DEFS) {
    const row = sliderRow(label, 0, opts.length - 1, 1, (value, out) => {
      vfxAsg().setP(Object.assign({}, vfxAsg().p, { [key]: value }));
      markDirty();
      out.textContent = opts[value] || '';
    });
    row._vfxKey = key; row._vfxOpts = opts;
    row._input.value = a.p[key]; row._out.textContent = opts[a.p[key]] || '';
    box.appendChild(row);
  }
  for (const [key, label, fallback] of VFX_COLOR_DEFS) {
    const row = document.createElement('div');
    row.className = 'mrow';
    row.innerHTML = `<span>${label}</span><input type="color"><b></b>`;
    row._vfxKey = key;
    const input = row.querySelector('input');
    const output = row.querySelector('b');
    input.value = a.p[key] || fallback;
    output.textContent = input.value;
    input.oninput = () => {
      vfxAsg().setP(Object.assign({}, vfxAsg().p, { [key]: input.value }));
      markDirty(); output.textContent = input.value;
    };
    box.appendChild(row);
  }
  for (const [key, label, min, max, step] of VFX_AUDIO_NUM_DEFS) {
    const row = sliderRow(label, min, max, step, (value, out) => {
      vfxAsg().setP(Object.assign({}, vfxAsg().p, { [key]: value }));
      markDirty();
      out.textContent = (+value).toFixed(2);
    });
    row._vfxKey = key;
    row._input.value = a.p[key];
    row._out.textContent = (+a.p[key]).toFixed(2);
    box.appendChild(row);
  }
}

function syncVFXPanel() {
  const box = $('vfxp');
  if (!box) return;
  if (!box.children.length) buildVFXPanel();
  const p = vfxAsg().p;
  for (const row of box.children) {
    const key = row._vfxKey;
    const input = row.querySelector('input');
    const out = row.querySelector('b');
    if (!key || !input || !out) continue;
    input.value = p[key];
    out.textContent = row._vfxOpts ? (row._vfxOpts[p[key]] || '')
      : input.type === 'color' ? p[key] : (+p[key]).toFixed(+input.step < 0.1 ? 2 : +input.step < 1 ? 1 : 0);
  }
}

function syncVFX() {
  if (!$('vfxslots')) return;
  const a = vfxAsg();
  for (const b of $('vfxslots').children) {
    b.classList.toggle('on', b._vfxSlot === vfxSlot);
    b.classList.toggle('has', !!(b._vfxSlot === VFX_SHARED
      ? cfg[heroId()].vfx
      : (cfg[heroId()].vfxSlots || [])[b._vfxSlot]));
  }
  $('vfxon').classList.toggle('on', a.on);
  $('vfxon').textContent = a.on ? 'enabled in game' : 'enable in game';
  $('vfxclear').style.opacity = a.configured ? '1' : '0.35';
  $('vfxname').innerHTML = (a.configured ? 'GPU PARTICLE PROFILE' : 'preview-only profile') +
    ' · ' + a.p.burst + ' burst · ' + a.p.life.toFixed(2) + ' s life · ' +
    (a.on ? '<em>enabled in game</em>' : '<em>not enabled in game</em>');
  syncVFXPanel();
  buildVFXAudio();
}

let vfxPreview = null;
function previewVFX() {
  const h = heroes[active];
  if (!h) return;
  if (vfxPreview) { vfxPreview.kill(); vfxPreview = null; }
  const p = clampVFX(vfxAsg().p);
  const inst = spawnVFX(G, p, new THREE.Vector3(h.pos.x, 0.08, h.pos.z), h.facing || 0, h);
  SFX.init();
  SFX.resume();
  if (p.audio) SFX.playClip(p.audio, { volume: p.audioVol, rate: p.audioRate });
  vfxPreview = inst;
  G.addEffect({
    update(dt) {
      const alive = inst.update(dt);
      if (!alive) vfxPreview = null;
      return alive;
    },
    dispose() { inst.kill(); if (vfxPreview === inst) vfxPreview = null; },
  });
  setRefPhase('PREVIEW · ' + vfxSlotLabel(vfxSlot) + ' · impact profile · ' + (p.duration + p.life).toFixed(2) + ' s');
  flash('GPU VFX PREVIEW · ' + vfxSlotLabel(vfxSlot) + ' · ' +
    (p.duration + p.life).toFixed(2) + ' s', '#7cf9ff');
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
  buildVFXChips();
  syncPanel();
  syncVFX();
}

function setAction(a) {
  action = a;
  setRefPhase('POSE · ' + a.toUpperCase() + ' · use PREVIEW or CAST SIM to inspect the full phase stack');
  const h = heroes[active];
  /* POSE is a preview input; the bench is a real cast. They write the same envelopes, so
     say which one the eye is looking at (MOTION-AUDIT F4). down is left alone: a
     deliberately held death pose is the only way to see the death FX at all. */
  if (sim.on && a !== 'idle' && a !== 'down') {
    flash('POSE · ' + a.toUpperCase() + ' OVER A LIVE CAST — ENVELOPES COMBINE, MOVE DRIVES THE LEGS', '#ffb14a');
  }
  if (a === 'attack') h.attackAnim = 1;
  if (a === 'cast') h.castAnim = 1;
  if (a === 'hurt') h.hurtAnim = 1;
  if (a === 'down') h.downed = true;
  if (a === 'idle' || a === 'walk') h.downed = false;
  document.querySelectorAll('#bottom [data-a]').forEach((b) => b.classList.toggle('on', b.dataset.a === a));
}

function clearStudioEffects() {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (e.dispose) e.dispose();
  }
  effects.length = 0;
}

function removeStudioHero(h) {
  if (!h) return;
  if (h.anim && h.anim.mixer) h.anim.mixer.stopAllAction();
  if (h.drone) G.scene.remove(h.drone.group);
  if (h.group) G.scene.remove(h.group);
}

/** Rebuild all three hero previews from the current tuning without losing the
    artist's selected hero or unsaved config. This is deliberately
    a full hero rebuild: model and clips are decided in Hero.build(), so a partial
    patch would leave the mixer describing a different file than the body. */
async function rebuildPreview() {
  if (!cfg || !heroes.length) return;
  const keep = active;
  const old = heroes.slice();
  let replacement = [];
  flash('REBUILDING HERO PREVIEW…');
  try {
    if (simOn) simToggle(false);
    stopPreview();
    clearStudioEffects();
    G.glbTuning = cfg;
    G.glbSkins = await ensureGLBSkins(cfg, true);
    fxBank = await loadFXBank(cfg);
    G.fxBank = fxBank;
    replacement = HERO_DEFS.map((d, i) => {
      const next = new Hero(d, G, i);
      const prev = old[i];
      if (prev) {
        next.pos.copy(prev.pos);
        next.vel.copy(prev.vel);
        next.facing = prev.facing;
      }
      return next;
    });
    heroes = replacement;
    old.forEach(removeStudioHero);
    active = keep;
    heroes.forEach((h, i) => {
      const on = i === active;
      h.group.visible = on;
      if (h.drone) h.drone.group.visible = on;
    });
    skinStale = false;
    syncApplyState();
    buildChips();
    buildVFXChips();
    syncPanel();
    syncVFX();
    setAction(action);
    flash('PREVIEW APPLIED · ' + HERO_DEFS[active].name, '#3dffb0');
  } catch (e) {
    // The old bodies were kept until the new bank and heroes were ready.
    replacement.forEach(removeStudioHero);
    heroes = old;
    old.forEach((h, i) => {
      G.scene.add(h.group);
      if (h.drone) G.scene.add(h.drone.group);
      h.group.visible = i === keep;
      if (h.drone) h.drone.group.visible = i === keep;
    });
    flash('PREVIEW REBUILD FAILED: ' + (e.message || e), '#ff3b5c');
  }
}

function resetHeroConfig() {
  if (!baseConfig || !baseConfig[heroId()]) return;
  const c = cfg[heroId()] = JSON.parse(JSON.stringify(baseConfig[heroId()]));
  const h = heroes[active];
  h.setScale(c.scale);
  h.motion = c.motion;
  h.offset = c.pos;
  h.setYawDeg(c.yawDeg);
  markDirty();
  skinStale = true;
  syncApplyState();
  syncPanel();
  flash('RESET ' + HERO_DEFS[active].name + ' · APPLY + REBUILD PREVIEW', '#ffb14a');
}

function exportConfig() {
  if (!cfg) return;
  const blob = new Blob([JSON.stringify(cfg, null, 2) + '\\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hero_tuning.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash('EXPORTED hero_tuning.json', '#7cf9ff');
}

async function importConfig(file) {
  if (!file || !cfg) return;
  try {
    const raw = JSON.parse(await file.text());
    const source = raw && raw.tuning && typeof raw.tuning === 'object' ? raw.tuning : raw;
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('expected hero tuning JSON');
    const imported = normalizeTuning(source);
    let count = 0;
    HERO_DEFS.forEach((d, i) => {
      if (!Object.prototype.hasOwnProperty.call(source, d.id)) return;
      const c = cfg[d.id] = imported[d.id];
      const h = heroes[i];
      h.setScale(c.scale);
      h.motion = c.motion;
      h.offset = c.pos;
      h.setYawDeg(c.yawDeg);
      count++;
    });
    if (!count) throw new Error('no aegis, lyra, or nyx entries found');
    markDirty();
    skinStale = true;
    syncApplyState();
    syncPanel();
    flash('IMPORTED ' + count + ' HERO' + (count === 1 ? '' : 'ES') + ' · APPLY + REBUILD PREVIEW', '#ffb14a');
  } catch (e) {
    flash('IMPORT FAILED: ' + (e.message || e), '#ff3b5c');
  }
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
    const vn = vfxCount(cfg);
    markClean();
    flash('SAVED — ' + n + ' ASSET FX · ' + vn + ' GPU VFX PROFILE' + (vn === 1 ? '' : 'S') + ' · RESTART THE RUN TO APPLY', '#3dffb0');
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
  markDirty();
  $('hgt').textContent = (2.4 * heroes[active].tunScale).toFixed(2) + ' m';
  measureFit();          // size moves the feet unless the base rides with it
};
$('save').onclick = save;
$('applyPreview').onclick = rebuildPreview;
$('resetHero').onclick = resetHeroConfig;
$('exportConfig').onclick = exportConfig;
$('importConfig').onclick = () => $('importConfigFile').click();
$('importConfigFile').onchange = (e) => {
  importConfig(e.target.files[0]);
  e.target.value = '';
};
$('simon').onclick = () => simToggle();
$('simbasic').onclick = doBasic;
$('simq').onclick = () => doCast(0);
$('sime').onclick = () => doCast(1);
$('simr').onclick = () => doCast(2);
$('simauto').onclick = () => { $('simauto').classList.toggle('on'); simNext = G.time + 0.2; };
$('sp1').onclick = () => setSpeed(0);
$('sp2').onclick = () => setSpeed(1);
$('sp3').onclick = () => setSpeed(2);
$('tg0').onclick = () => setTargets(0);
$('tg3').onclick = () => setTargets(3);
$('tg6').onclick = () => setTargets(6);
$('simreset').onclick = () => { sim.reset(); flash('SIM RESET — TARGETS BACK IN PLACE, EFFECTS KILLED', '#7cf9ff'); syncMove(); };
/* MOVE + DASH — MOTION-AUDIT F4. Motion is a layer no button here used to reach: the
   game's frame runs `h.move(dt, inputDir)` and only the player's keys set that dir, so
   a range that could never be seen from the studio. These are PREVIEW inputs (the bench
   philosophy in sim.js), and dash keeps the real cooldown — an on-cooldown press is
   reported, not forced, because a dodge you cannot see at full length is a lie. */
for (const b of $('simmove').querySelectorAll('[data-m]')) b.onclick = () => { if (!simOn) simToggle(true); sim.setMove(b.dataset.m); syncMove(); sayMove(); sim.tickCaption(); };
$('simdash').onclick = () => { if (!simOn) simToggle(true); sim.dash(); sim.tickCaption(); };
function syncMove() {
  const box = $('simmove');
  if (!box) return;
  for (const b of box.querySelectorAll('[data-m]')) b.classList.toggle('on', sim.on && b.dataset.m === sim.mmode);
}
function sayMove() {
  const el = $('simsay');
  el.textContent = 'MOVE · ' + sim.mmode + (sim.mmode === 'idle' ? ' · the hero stands' : ' · ' + sim.dist.toFixed(1) + 'm travelled');
  el.classList.add('on');
  saySkill.t = G.time + 1.2;
}
$('fxhelphide').onclick = () => {
  const h = $('fxhelp');
  h.style.display = h.style.display === 'none' ? '' : 'none';
  $('fxhelphide').textContent = h.style.display === 'none' ? 'how fx work' : 'hide';
};
$('pclift').onclick = () => nudgePlacementTo((k) => {
  const before = measureFit();
  return k === 'y' ? cfg[heroId()].pos.y - (before ? before.min : 0) : cfg[heroId()].pos[k];
});
$('pcreset').onclick = () => { nudgePlacementTo(() => 0); flash('PLACEMENT RESET TO THE LOADER\u2019S OWN', '#7cf9ff'); };
$('spin').onclick = () => {
  const on = $('spin').classList.toggle('on');
  controls.autoRotate = on; controls.autoRotateSpeed = 2.2;
};
addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
  if (e.key.toLowerCase() === 'f') setCameraMode(cameraMode === 'follow' ? 'free' : 'follow');
});
$('fxplay').onclick = () => {
  const a = asg();
  if (!a.src) { flash('NO FX IN ' + slotLabel(slot).toUpperCase() + ' — DROP A FILE OR PICK ONE', '#ffb14a'); return; }
  if (!heroes[active].playFX(G, slot)) flash('FX FILE NOT IN THE BANK — RE-ASSIGN IT', '#ffb14a');
};
$('fxrec').onclick = recordFX;
$('fxon').onclick = () => { const a = asg(); a.setOn(!a.on); markDirty(); syncFX(); };
$('fxclear').onclick = () => {
  const a = asg();
  if (!a.src) { flash('NOTHING TO CLEAR IN ' + slotLabel(slot).toUpperCase(), '#ffb14a'); return; }
  a.setSrc(null);
  a.setP(clampFX(a.p, 'glb'));
  markDirty();
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
  markDirty();
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
$('vfxplay').onclick = previewVFX;
$('vfxon').onclick = () => {
  const a = vfxAsg();
  const next = !a.on;
  a.setOn(next);
  markDirty();
  syncVFX();
  flash(next ? 'GPU VFX ENABLED IN GAME · SAVE TO APPLY' : 'GPU VFX MUTED IN GAME', next ? '#3dffb0' : '#ffb14a');
};
$('vfxclear').onclick = () => {
  const a = vfxAsg();
  if (!a.configured) { flash('NO GPU VFX PROFILE IN ' + vfxSlotLabel(vfxSlot), '#ffb14a'); return; }
  a.clear();
  markDirty();
  syncVFX();
  flash('CLEARED GPU VFX · SAVE TO KEEP', '#ff8a2b');
};
$('vfxaudioclear').onclick = () => {
  if (!vfxAsg().p.audio) { flash('NO AUDIO CUE IN ' + vfxSlotLabel(vfxSlot), '#ffb14a'); return; }
  setVFXAudio(null);
};
$('vfxaudiodrop').onclick = () => $('vfxaudiofile').click();
$('vfxaudiofile').onchange = (e) => uploadVFXAudio(e.target.files[0]);
$('vfxaudiodrop').addEventListener('dragover', (e) => {
  e.preventDefault(); e.stopPropagation(); $('vfxaudiodrop').classList.add('hot');
});
$('vfxaudiodrop').addEventListener('dragleave', (e) => {
  e.preventDefault(); e.stopPropagation(); $('vfxaudiodrop').classList.remove('hot');
});
$('vfxaudiodrop').addEventListener('drop', (e) => {
  e.preventDefault(); e.stopPropagation(); $('vfxaudiodrop').classList.remove('hot');
  uploadVFXAudio(e.dataTransfer.files[0]);
});
$('fxaudioclear').onclick = () => {
  if (!asg().p.audio) { flash('NO LEGACY FX AUDIO IN ' + slotLabel(slot), '#ffb14a'); return; }
  setFXAudio(null);
};
$('fxaudiodrop').onclick = () => $('fxaudiofile').click();
$('fxaudiofile').onchange = (e) => uploadFXAudio(e.target.files[0]);
$('skinDrop').onclick = () => $('skinFile').click();
$('skinFile').onchange = (e) => uploadHeroGLB(e.target.files[0]);
$('skinDrop').addEventListener('dragover', (e) => {
  e.preventDefault(); e.stopPropagation(); $('skinDrop').classList.add('hot');
});
$('skinDrop').addEventListener('dragleave', (e) => {
  e.preventDefault(); e.stopPropagation(); $('skinDrop').classList.remove('hot');
});
$('skinDrop').addEventListener('drop', (e) => {
  e.preventDefault(); e.stopPropagation(); $('skinDrop').classList.remove('hot');
  uploadHeroGLB(e.dataTransfer.files[0]);
});
$('refOverlayClose').onclick = () => $('refOverlay').classList.remove('on');
$('fxaudiodrop').addEventListener('dragover', (e) => {
  e.preventDefault(); e.stopPropagation(); $('fxaudiodrop').classList.add('hot');
});
$('fxaudiodrop').addEventListener('dragleave', (e) => {
  e.preventDefault(); e.stopPropagation(); $('fxaudiodrop').classList.remove('hot');
});
$('fxaudiodrop').addEventListener('drop', (e) => {
  e.preventDefault(); e.stopPropagation(); $('fxaudiodrop').classList.remove('hot');
  uploadFXAudio(e.dataTransfer.files[0]);
});
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

/* ---------- CAST SIM (src/sim.js) ----------
   Everything below is glue: buttons in, caption out. The behaviour lives in the
   real Hero.useSkill, so a cast here is a cast in the match. */
const sim = createSim(G, {
  hero: () => heroes[active],
  allies: () => heroes,
  effects: () => effects,
  announce: (h, sk) => saySkill(sk),
  caption: (t) => {
    const el = $('simcap');
    el.textContent = t;
    el.className = sim.faults ? 'bad' : (sim.stats.blocked || sim.stats.forced ? 'warn' : '');
  },
  fault: (msg) => { flash(msg, '#ff3b5c'); const el = $('simcap'); el.textContent = msg; el.className = 'bad'; },
});
G.timeScale = 1;
let simOn = false, simNext = 0, simSeq = 1;

function saySkill(sk) {
  const el = $('simsay');
  el.textContent = (sk.key || '') + ' · ' + sk.name;
  el.classList.add('on');
  saySkill.t = G.time + (sk.ult ? 1.6 : 1.1);
}

function simToggle(force) {
  simOn = force === undefined ? !simOn : !!force;
  $('simon').textContent = simOn ? 'on' : 'off';
  $('simon').classList.toggle('on', simOn);
  if (simOn) { if (!sim.on) sim.setTargets(sim.n); sim.setFXVisible(true); stopPreview(); }
  else { sim.setTargets(0); sim.setFXVisible(false); sim.reset(); }   // reset walks the hero home and drops MOVE
  syncMove();
  sim.tickCaption();
}

/* simSeq: what auto fires next — 0 = basic, 1..3 = skills Q,E,R — so auto always
   continues from the button you just pressed instead of restarting on it. */
function doCast(i) {
  if (!simOn) simToggle(true);
  stopPreview();
  sim.cast(i);
  simSeq = (i + 2) % 4;
  simNext = G.time + 0.45;
  sim.tickCaption();
}
function doBasic() {
  if (!simOn) simToggle(true);
  stopPreview();
  sim.basic();
  simSeq = 1;
  simNext = G.time + 0.3;
  sim.tickCaption();
}

/* auto = re-cast when the stage is clear, so long abilities (an 8 s dome) hold
   the queue instead of stacking on top of themselves */
function tickSim(dt, rdt) {
  const say = $('simsay');
  if (say.classList.contains('on') && G.time > (saySkill.t || 0)) say.classList.remove('on');
  if (!sim.on) return;
  sim.update(dt);
  if ($('simauto').classList.contains('on') && !effects.length && G.time > simNext) {
    if (simSeq === 0) sim.basic(); else sim.cast(simSeq - 1);
    simSeq = (simSeq + 1) % 4;
    simNext = G.time + 0.5;
    sim.tickCaption();
  }
  if (G.time - (sim.tick || 0) > 0.25) { sim.tick = G.time; sim.tickCaption(); }
}
function setSpeed(i) {
  G.timeScale = SIM_SPEEDS[i] || 1;
  sim.speed = G.timeScale;                 // the caption quotes this, so it must not drift
  for (let k = 0; k < 3; k++) $('sp' + (k + 1)).classList.toggle('on', k === i);
}
function setTargets(n) {
  sim.setTargets(n);
  for (const k of SIM_TARGETS) $('tg' + k).classList.toggle('on', k === n);
  sim.tickCaption();
}

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
  syncAnim();
  measureFit();
  syncFX();
  syncVFX();
}

/* ---------- boot ---------- */
(async () => {
  /* the tuning is read FIRST now, because its `model` field can point a hero at a
     different file than the manifest's <id>.glb — the skins are what that chooses */
  cfg = await ensureTuning();
  baseConfig = JSON.parse(JSON.stringify(cfg));
  markClean();
  G.glbTuning = cfg;
  G.glbSkins = await ensureGLBSkins(cfg);
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

  buildReferenceGallery();
  buildSliders();
  buildAnim();
  buildChips();
  setActive(0);
  setAction('idle');
  syncApplyState();
  refreshLib();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const rdt = Math.min(clock.getDelta(), 0.05);
    /* Slow motion scales dt ONCE, here, so the hero, the effects, the sim and the
       camera all slow together — a bench that slows only the FX would lie about
       timing, and timing is most of what an effect is. */
    const dt = rdt * G.timeScale;
    G.time += dt;
    const h = heroes[active];
    if (cameraMode === 'follow' && h) {
      cameraFollowTarget.set(h.pos.x, h.pos.y + 1.15, h.pos.z);
      controls.target.lerp(cameraFollowTarget, Math.min(1, rdt * 6));
    }
    controls.update();
    /* Who owns the body (MOTION-AUDIT F4/F5). While the bench is installed, sim.update
       calls the REAL Hero.update, which decays attackAnim/castAnim/hurtAnim and ticks
       hurtT/comboT — so this loop must not decay them a second time, or every timing
       read here runs at 2× the match. Off, this loop IS the owner, so it still does. */
    if (!sim.on) {
      h.attackAnim = Math.max(0, h.attackAnim - dt * 5);
      h.castAnim = Math.max(0, h.castAnim - dt * 2.2);
      h.hurtAnim = Math.max(0, h.hurtAnim - dt * 4);
    }
    if (action === 'attack' && h.attackAnim <= 0) h.attackAnim = 1;   // loop the preview
    if (action === 'cast' && h.castAnim <= 0) h.castAnim = 1;
    if (action === 'hurt' && h.hurtAnim <= 0) h.hurtAnim = 1;
    /* …and it owns the POSE too, not just the decay. `animateGLB` advances `_stepT`
       itself and the mixer has its own clock, so a second call per frame doubles the walk
       cadence and runs the clip at 2× — the same class of bug, one more node down.
       When the bench is off, this loop is the only thing that poses anything, so it
       still does, and there is no velocity here to measure (spd is an intent, not a lie). */
    if (!sim.on) {
      const spd = action === 'walk' ? 1 : 0;
      if (h.rig.glb) {
        h.animateGLB(dt, G, spd);
        if (h.anim) h.poseClips(dt, spd);
      } else {
        animateRig(h.rig, dt, {
          speed: clamp(spd, 0, 1.4), time: G.time, attack: h.attackAnim, recoil: h.recoil,
          cast: h.castAnim, dead: h.downed, hurt: h.hurtAnim,
          style: h.def.style, block: h.def.id === 'aegis',
        });
      }
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      if (!e.update(dt)) { if (e.dispose) e.dispose(); effects.splice(i, 1); }
    }
    if (G.time - (measureFit.t || 0) > 0.3) { measureFit.t = G.time; measureFit(); }
    tickPreview(dt);
    tickSim(dt, rdt);
    sim.applyShake(camera);
    renderer.render(scene, camera);
    sim.clearShake(camera);
    $('simflash').style.opacity = (sim.flash() * 0.55).toFixed(3);
  });
  flash('STUDIO READY — TUNE & SAVE', '#7cf9ff');
})();
