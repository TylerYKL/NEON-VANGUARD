import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { HERO_DEFS } from './heroes.js';
import {
  buildHumanoid, animateRig, buildIonGauntlets, buildRiotShield,
  buildMedGloves, buildRailPistol, buildDrone,
} from './rig.js';
import { disposeObj, addMat, metalMat, TAU } from './util.js';
import { parseGLB, gatherStats, normalizeToStage } from './gltfutil.js';

/* ============================================================
   MODEL VIEWER — drop a Tripo / Meshy / any GLB next to the
   procedural rig and compare. Zero-asset game stays untouched;
   this page is a separate build purely for art direction.
   ============================================================ */

const app = document.getElementById('app');
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
camera.position.set(3.2, 2.0, 4.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.5;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.52;

/* ---- post: the mandatory NaN/Inf clamp BEFORE bloom, then bloom + out ---- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c=texture2D(tDiffuse,vUv);
      gl_FragColor=vec4(max(min(c.rgb,vec3(12.0)),vec3(0.0)),1.0); }`,
}));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth * 0.5, innerHeight * 0.5), 0.5, 0.7, 0.8));
composer.addPass(new OutputPass());

/* ---- studio ---- */
scene.add(new THREE.HemisphereLight(0x38539c, 0x0c0714, 1.0));
const key = new THREE.DirectionalLight(0xcfe0ff, 2.4); key.position.set(4, 7, 7); scene.add(key);
const fill = new THREE.DirectionalLight(0x5f80ff, 1.0); fill.position.set(-7, 3.5, 4); scene.add(fill);
const rim = new THREE.PointLight(0xffffff, 9, 15, 2); rim.position.set(-2.6, 2.6, -2.8); scene.add(rim);
const rim2 = new THREE.PointLight(0xffffff, 5, 14, 2); rim2.position.set(2.8, 1.4, -2.2); scene.add(rim2);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(20, 72),
  new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.5, metalness: 0.6 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const grid = new THREE.GridHelper(20, 40, 0x18e0ff, 0x10203a);
grid.material.transparent = true; grid.material.opacity = 0.22; grid.position.y = 0.01;
scene.add(grid);

/* ---- holders: procedural rig on one side, GLB on the other ---- */
const procHolder = new THREE.Group(); scene.add(procHolder);
const glbHolder = new THREE.Group(); scene.add(glbHolder);
procHolder.position.x = -1.3;
glbHolder.position.x = 1.3;

/* ---------- procedural hero ---------- */
let rig = null, heroIdx = 0;
function buildProcedural(i) {
  heroIdx = i;
  while (procHolder.children.length) disposeObj(scene, procHolder.children[0]);
  const d = HERO_DEFS[i];
  rig = buildHumanoid({ accent: d.color, visor: d.color2, bulk: d.bulk, scale: 1, pauldrons: d.pauldrons, hood: d.hood, crest: d.crest, plate: d.plate });
  if (d.id === 'aegis') { buildIonGauntlets(rig, d.color); buildRiotShield(rig, d.color2); }
  else if (d.id === 'lyra') { buildMedGloves(rig, d.color); procHolder.add(buildDrone(rig, d.color2).group); }
  else { buildRailPistol(rig, d.color); procHolder.add(buildDrone(rig, d.color2).group); }
  procHolder.add(rig.root);
  document.getElementById('pname').textContent = d.name;
}

/* ---------- GLB ---------- */
let mixer = null, glbClips = [];
function clearGLB() {
  while (glbHolder.children.length) disposeObj(scene, glbHolder.children[0]);
  mixer = null; glbClips = [];
}
function placeGLB(gltf, name) {
  clearGLB();
  const obj = gltf.scene || gltf.scenes[0];
  normalizeToStage(obj, 2.4);
  glbHolder.add(obj);

  const s = gatherStats(obj);
  glbClips = gltf.animations || [];
  if (glbClips.length) {
    mixer = new THREE.AnimationMixer(obj);
    mixer.clipAction(glbClips[0]).play();
  }
  renderStats(s, name, glbClips.map((c) => c.name || 'clip'));
}
function loadBuffer(buf, name) {
  parseGLB(buf)
    .then((gltf) => { placeGLB(gltf, name); flash('LOADED ' + name, '#3dffb0'); })
    .catch((e) => { console.error(e); flash('FAILED: ' + (e.message || 'unparseable'), '#ff3b5c'); });
}
function handleFile(file) {
  if (!file) return;
  file.arrayBuffer().then((buf) => loadBuffer(buf, file.name));
}

/* ---------- UI ---------- */
const $ = (id) => document.getElementById(id);
function flash(msg, color) {
  const el = $('msg'); el.textContent = msg; el.style.color = color || '#9ff';
  clearTimeout(flash.t); flash.t = setTimeout(() => { el.textContent = ''; }, 3500);
}
function renderStats(s, name, clips) {
  $('gname').textContent = name || 'model.glb';
  $('stats').innerHTML =
    row('meshes', s.meshes) + row('triangles', s.tris.toLocaleString()) +
    row('materials', s.materials) + row('textures', s.textures) +
    row('bones', s.bones) + row('skinned', s.skinned) + row('clips', clips.length);
  $('budget').textContent =
    s.tris > 20000 ? 'OVER the 20k-tri hero budget — retopo/LOD before shipping' :
    s.tris > 8000 ? 'heavy for a hero — consider a LOD pass' : 'inside hero budget';
  const clipsEl = $('clips'); clipsEl.innerHTML = '';
  clips.forEach((cn, i) => {
    const b = document.createElement('button');
    b.className = 'act' + (i === 0 ? ' on' : ''); b.textContent = cn;
    b.onclick = () => {
      if (!mixer) return;
      mixer.stopAllAction(); mixer.clipAction(glbClips[i]).play();
      clipsEl.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
    };
    clipsEl.appendChild(b);
  });
}
function row(k, v) { return `<div class="st"><i>${k}</i><b>${v}</b></div>`; }

/* hero tabs */
const tabs = $('tabs');
HERO_DEFS.forEach((d, i) => {
  const b = document.createElement('button');
  b.className = 'tab' + (i === 0 ? ' on' : '');
  b.innerHTML = `<b>${d.name}</b><span>${d.role}</span>`;
  b.onclick = () => { buildProcedural(i); tabs.querySelectorAll('.tab').forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
  tabs.appendChild(b);
});

$('load').onclick = () => $('file').click();
$('file').onchange = (e) => handleFile(e.target.files[0]);
$('wire').onclick = () => {
  const on = $('wire').classList.toggle('on');
  glbHolder.traverse((o) => { if (o.isMesh) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => x.wireframe = on); } });
};
$('spin').onclick = () => {
  const on = $('spin').classList.toggle('on');
  controls.autoRotate = on; controls.autoRotateSpeed = 1.6;
  $('spin').textContent = on ? 'AUTO-SPIN ON' : 'AUTO-SPIN OFF';
};

/* drag & drop anywhere */
const drop = $('drop');
addEventListener('dragover', (e) => { e.preventDefault(); drop.style.display = 'grid'; });
addEventListener('dragleave', (e) => { if (e.relatedTarget === null) drop.style.display = 'none'; });
addEventListener('drop', (e) => {
  e.preventDefault(); drop.style.display = 'none';
  handleFile(e.dataTransfer.files[0]);
});

/* ?model=path — fetch a workspace GLB (e.g. one dropped in the upload page) and load it */
const modelParam = new URLSearchParams(location.search).get('model');
if (modelParam && /\.glb$/i.test(modelParam) && !modelParam.includes('..') && !/^(https?:|\/)/i.test(modelParam)) {
  fetch(modelParam)
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then((buf) => loadBuffer(buf, decodeURIComponent(modelParam.split('/').pop())))
    .catch((e) => flash('FAILED: ' + (e.message || 'fetch'), '#ff3b5c'));
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

/* ---------- loop ---------- */
buildProcedural(0);
const clock = new THREE.Clock();
let t = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  controls.update();
  if (rig) animateRig(rig, dt, { speed: 0, time: t, attack: 0, cast: 0, dead: false, hurt: 0, style: HERO_DEFS[heroIdx].style, block: HERO_DEFS[heroIdx].id === 'aegis' });
  if (mixer) mixer.update(dt);
  composer.render();
});

/* expose for tests / console */
window.__viewer = { scene, loadBuffer, placeGLB, gatherStats, normalizeToStage, glbHolder, procHolder };
