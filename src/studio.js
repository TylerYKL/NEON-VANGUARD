import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Hero, HERO_DEFS } from './heroes.js';
import { ensureGLBSkins, ensureTuning, loadFXBank } from './glbskin.js';
import { parseGLB, normalizeToStage, gatherStats } from './gltfutil.js';
import { animateRig } from './rig.js';
import { TAU, clamp } from './util.js';

/* ============================================================
   HERO STUDIO — tune the uploaded GLB heroes: size, action
   motion, and per-hero skill-effect GLB. SAVE writes
   models/uploads/hero_tuning.json through the :8081 dropbox
   server; the game reads it at startGame().
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

function flash(msg, color) {
  const el = $('msg'); el.textContent = msg; el.style.color = color || '#9ff';
  clearTimeout(flash.t); flash.t = setTimeout(() => { el.textContent = ''; }, 3000);
}

/* studio-side copy of the upload server origin (same sandbox, port 8081) */
const UP = 'https://' + location.hostname.replace(/^\d+-/, '8081-');

/* ---------- boot ---------- */
const effects = [];
let heroes = [], active = 0, action = 'idle';
let cfg = null, fxBank = null;
const G = {
  scene, time: 0,
  addEffect: (e) => effects.push(e),
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

function buildSliders() {
  $('mot').innerHTML = '';
  for (const [k, label, min, max, step] of MOT_DEFS) {
    const row = document.createElement('div');
    row.className = 'mrow';
    row.innerHTML = `<span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"><b></b>`;
    const inp = row.querySelector('input');
    inp.oninput = () => {
      const v = +inp.value;
      cfg[HERO_DEFS[active].id].motion[k] = v;
      heroes[active].motion[k] = v;
      row.querySelector('b').textContent = v.toFixed(step < 0.01 ? 3 : 2);
    };
    $('mot').appendChild(row);
  }
}

function syncPanel() {
  const h = heroes[active], d = HERO_DEFS[active], c = cfg[d.id];
  document.documentElement.style.setProperty('--c', '#' + d.color.toString(16).padStart(6, '0'));
  $('gname').textContent = d.name;
  $('tris').textContent = gatherStats(h.rig.glb ? h.body : h.group).tris.toLocaleString();
  $('hgt').textContent = (2.4 * h.tunScale).toFixed(2) + ' m';
  $('sz').value = h.tunScale;
  for (const row of $('mot').children) {
    const k = row.querySelector('input').dataset.k;
    row.querySelector('input').value = c.motion[k];
    row.querySelector('b').textContent = (+c.motion[k]).toFixed(2);
  }
  syncFX();
}

function syncFX() {
  const c = cfg[HERO_DEFS[active].id];
  $('fxname').textContent = c.fx ? 'assigned: ' + c.fx.split('/').pop() + (c.fxOn ? '' : ' (disabled)') : 'none assigned';
  $('fxon').classList.toggle('on', !!c.fxOn);
  $('fxon').textContent = c.fxOn ? 'fx on' : 'fx off';
}

function setActive(i) {
  active = i;
  heroes.forEach((h, k) => {
    const on = k === i;
    h.group.visible = on;
    if (h.drone) h.drone.group.visible = on;
  });
  document.querySelectorAll('#head .tab').forEach((t, k) => t.classList.toggle('on', k === i));
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

async function uploadFX(file) {
  if (!file) return;
  if (!/\.glb$/i.test(file.name)) { flash('ONLY .GLB EFFECTS', '#ff3b5c'); return; }
  const id = HERO_DEFS[active].id, name = id + '-fx.glb';
  flash('UPLOADING ' + file.name + '…');
  try {
    const r = await fetch(UP + '/upload/' + name, { method: 'PUT', body: file });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const gltf = await parseGLB(await file.arrayBuffer());
    const tpl = gltf.scene || gltf.scenes[0];
    normalizeToStage(tpl, 1.8);
    fxBank[id] = tpl;
    G.fxBank = fxBank;
    cfg[id].fx = 'models/uploads/' + name;
    cfg[id].fxOn = true;
    syncFX();
    flash('FX ASSIGNED TO ' + HERO_DEFS[active].name, '#3dffb0');
  } catch (e) {
    flash('FX UPLOAD FAILED: ' + (e.message || e), '#ff3b5c');
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
    flash('SAVED — START THE GAME TO APPLY', '#3dffb0');
  } catch (e) {
    flash('SAVE FAILED: ' + (e.message || e), '#ff3b5c');
  }
}

/* ---------- wire UI ---------- */
$('sz').oninput = () => {
  const v = +$('sz').value;
  heroes[active].setScale(v);
  cfg[HERO_DEFS[active].id].scale = heroes[active].tunScale;
  $('hgt').textContent = (2.4 * heroes[active].tunScale).toFixed(2) + ' m';
};
$('save').onclick = save;
$('spin').onclick = () => {
  const on = $('spin').classList.toggle('on');
  controls.autoRotate = on; controls.autoRotateSpeed = 2.2;
};
$('fxplay').onclick = () => {
  if (!heroes[active].playFX(G)) flash('NO FX ASSIGNED — DROP A .GLB', '#ffb14a');
};
$('fxon').onclick = () => {
  const c = cfg[HERO_DEFS[active].id];
  c.fxOn = !c.fxOn; syncFX();
};
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

/* ---------- boot ---------- */
(async () => {
  G.glbSkins = await ensureGLBSkins();
  cfg = await ensureTuning();
  G.glbTuning = cfg;
  fxBank = await loadFXBank(cfg);
  G.fxBank = fxBank;

  heroes = HERO_DEFS.map((d, i) => new Hero(d, G, i));
  heroes.forEach((h) => { h.motion = cfg[h.def.id].motion; });

  const tabs = $('head');
  HERO_DEFS.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.innerHTML = `<b>${d.name}</b><span>${d.role}</span>`;
    b.onclick = () => setActive(i);
    tabs.appendChild(b);
  });

  buildSliders();
  setActive(0);
  setAction('idle');

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
      if (!effects[i].update(dt)) effects.splice(i, 1);
    }
    renderer.render(scene, camera);
  });
  flash('STUDIO READY — TUNE & SAVE', '#7cf9ff');
})();
