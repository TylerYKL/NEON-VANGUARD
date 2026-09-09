import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { HERO_DEFS } from './heroes.js';
import { ensureTuning, ensureGLBSkins } from './glbskin.js';
import { parseGLB, normalizeToStage } from './gltfutil.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import {
  buildHumanoid, animateRig, buildIonGauntlets, buildRiotShield,
  buildMedGloves, buildRailPistol, buildDrone,
} from './rig.js';
import { FX } from './fx.js';
import { addMat, metalMat, rand, clamp, damp, lerp, TAU } from './util.js';
import { SFX } from './audio.js';

/* ============================================================
   CHARACTER BAY — a turntable viewer for the three operatives and
   any body GLBs uploaded through Hero Studio. Procedural rigs and
   uploaded skins share the same stage and studio lighting.
   ============================================================ */

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: location.search.includes('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050b);
scene.fog = new THREE.FogExp2(0x04050b, 0.028);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);

/* ---------- post ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c=texture2D(tDiffuse,vUv); c=mix(c,vec4(0.0),vec4(notEqual(c,c)));
      gl_FragColor=vec4(max(min(c.rgb,vec3(12.0)),vec3(0.0)),1.0); }`,
}));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth * 0.5, innerHeight * 0.5), 0.66, 0.8, 0.78);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFlash: { value: 0 }, uCol: { value: new THREE.Color(0xffffff) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uFlash; uniform vec3 uCol; varying vec2 vUv;
    void main(){
      vec2 uv=vUv; vec2 d=uv-0.5; float r2=dot(d,d);
      float ab=0.0016*(1.0+r2*6.0)*(1.0+uFlash*3.0);
      vec3 c; c.r=texture2D(tDiffuse,uv+d*ab).r; c.g=texture2D(tDiffuse,uv).g; c.b=texture2D(tDiffuse,uv-d*ab).b;
      c *= 0.975+0.025*sin(uv.y*1100.0);
      float g=fract(sin(dot(uv*vec2(uTime*0.6+12.9898,78.233),vec2(1.0)))*43758.5453);
      c += (g-0.5)*0.02;
      c *= smoothstep(1.2,0.24,r2*1.85);
      c += uCol*uFlash*0.5;
      gl_FragColor=vec4(c,1.0);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

/* ---------- studio ---------- */
const fx = new FX(scene, camera);

scene.add(new THREE.HemisphereLight(0x38539c, 0x0c0714, 0.9));
const keyLight = new THREE.DirectionalLight(0xcfe0ff, 2.4); keyLight.position.set(4, 7, 7); scene.add(keyLight);
const front = new THREE.DirectionalLight(0x9fc4ff, 1.1); front.position.set(0, 2.5, 9); scene.add(front);
const fill = new THREE.DirectionalLight(0x5f80ff, 1.0); fill.position.set(-7, 3.5, 4); scene.add(fill);
const rimA = new THREE.PointLight(0xffffff, 11, 15, 2); rimA.position.set(-2.6, 2.6, -2.8); scene.add(rimA);
const rimB = new THREE.PointLight(0xffffff, 6, 14, 2); rimB.position.set(2.8, 1.4, -2.2); scene.add(rimB);
const upLight = new THREE.PointLight(0xffffff, 4, 9, 2); upLight.position.set(0, 0.25, 1.4); scene.add(upLight);

// mirror-ish floor with a radial tech grid
const floorUni = { uTime: { value: 0 }, uCol: { value: new THREE.Color(0x18e0ff) }, uAcc: { value: new THREE.Color(0xff8a2b) } };
const floor = new THREE.Mesh(new THREE.CircleGeometry(26, 96), new THREE.ShaderMaterial({
  uniforms: floorUni,
  vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz;
    gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `
    uniform float uTime; uniform vec3 uCol; uniform vec3 uAcc; varying vec3 vW;
    // derivative-aware lines: distant rings fade out instead of aliasing into moire
    float lineMask(float v, float w){ float d = abs(fract(v) - 0.5) / max(fwidth(v), 1e-5); return 1.0 - min(d * w, 1.0); }
    void main(){
      vec2 p = vW.xz; float r = length(p); float a = atan(p.y, p.x);
      float ringL  = lineMask(r * 0.5 - uTime * 0.05, 1.1);
      float spokeL = lineMask(a / 6.28318 * 24.0, 1.4) * smoothstep(1.1, 2.6, r) * smoothstep(11.0, 5.0, r);
      float pad     = smoothstep(2.25, 1.85, r);
      float padEdge = smoothstep(0.07, 0.0, abs(r - 2.05));
      vec3 c = vec3(0.008, 0.011, 0.024);
      c += uCol * ringL * 0.055;
      c += uCol * spokeL * 0.03;
      c += uAcc * padEdge * 1.5;
      c += uAcc * pad * 0.05;
      c *= smoothstep(22.0, 2.0, r) * 0.92 + 0.08;
      gl_FragColor = vec4(c, 1.0);
    }`,
}));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// backdrop panels
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * TAU;
  const h = 5 + Math.random() * 8;
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 0.4), metalMat(0x0a0c16, 0.55, 0.85));
  m.position.set(Math.cos(a) * 11, h / 2 - 1.5, Math.sin(a) * 11);
  m.lookAt(0, m.position.y, 0);
  scene.add(m);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, h * 0.7, 0.1), addMat(i % 3 ? 0x18e0ff : 0xff2fa0, 0.7));
  strip.position.set(Math.cos(a) * 10.7, h * 0.4, Math.sin(a) * 10.7);
  scene.add(strip);
}
// slow drifting motes
const moteGeo = new THREE.BufferGeometry();
{
  const N = 300, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rand(16, -16); pos[i * 3 + 1] = rand(11, -0.5); pos[i * 3 + 2] = rand(16, -16); }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: 0.045, color: 0x8fd8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
scene.add(motes);

// rotating pedestal
const pedestal = new THREE.Group();
scene.add(pedestal);
const podRing = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.04, 8, 96), addMat(0xffffff, 0.8));
podRing.rotation.x = Math.PI / 2; podRing.position.y = 0.02; pedestal.add(podRing);
const podRing2 = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.018, 6, 80), addMat(0xffffff, 0.4));
podRing2.rotation.x = Math.PI / 2; podRing2.position.y = 0.02; pedestal.add(podRing2);
const podTicks = new THREE.Group(); pedestal.add(podTicks);
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * TAU;
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, i % 6 === 0 ? 0.42 : 0.2), addMat(0xffffff, 0.55));
  t.position.set(Math.cos(a) * 2.24, 0.02, Math.sin(a) * 2.24);
  t.rotation.y = -a;
  podTicks.add(t);
}
const holoCyl = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 3.4, 48, 1, true), new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(0xffffff) } },
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `uniform float uTime; uniform vec3 uCol; varying vec2 vUv;
    void main(){
      float scan=smoothstep(0.9,1.0,sin(vUv.y*10.0-uTime*1.2));
      float band=0.03+0.05*sin(vUv.x*120.0);
      float fade=pow(1.0-vUv.y,1.6);
      float a=(band+scan*0.25)*fade*0.5;
      gl_FragColor=vec4(uCol*a*1.6,a*0.55);
    }`,
}));
holoCyl.position.y = 1.7;
pedestal.add(holoCyl);

/* ---------- heroes + uploaded GLB skins ---------- */
const UP = (() => {
  // Arena previews use sibling 8080/8081 hosts; local development uses ports.
  if (/^\d+-/.test(location.hostname)) return location.protocol + '//' + location.hostname.replace(/^\d+-/, '8081-');
  if (location.hostname) return location.protocol + '//' + location.hostname + ':8081';
  return 'http://localhost:8081';
})();
const UPDIR = 'models/uploads/';
const UPLOAD_POLL_MS = 2500;
const uploadCache = new Map();
const customModels = new Map();

function buildBayModel(d) {
  const rig = buildHumanoid({
    accent: d.color, visor: d.color2, bulk: d.bulk, scale: d.scale,
    pauldrons: d.pauldrons, hood: d.hood, crest: d.crest, plate: d.plate,
  });
  const g = new THREE.Group();
  g.add(rig.root);
  scene.add(g);
  g.visible = false;
  const M = { def: d, rig, group: g, drone: null, addons: [], importedBody: null, importedSkin: null, mixer: null, importedAction: null };
  if (d.id === 'aegis') {
    M.gauntlets = buildIonGauntlets(rig, d.color); M.shield = buildRiotShield(rig, d.color2);
    M.addons.push(M.gauntlets.L.group, M.gauntlets.R.group, M.shield.group);
  } else if (d.id === 'lyra') {
    M.gloves = buildMedGloves(rig, d.color); M.drone = buildDrone(rig, d.color2); g.add(M.drone.group);
    M.addons.push(M.gloves.L.group, M.gloves.R.group, M.drone.group);
  } else {
    M.pistol = buildRailPistol(rig, d.color); M.drone = buildDrone(rig, d.color2); g.add(M.drone.group);
    M.addons.push(M.pistol.group, M.drone.group);
  }
  rig.disc.material.opacity = 0.0;
  return M;
}

const models = HERO_DEFS.map(buildBayModel);

function disposeImported(M) {
  if (M.importedBody) {
    M.group.remove(M.importedBody);
    M.importedBody = null;
  }
  if (M.mixer) M.mixer.stopAllAction();
  M.mixer = null;
  M.importedAction = null;
  M.importedSkin = null;
  M.importedTuning = null;
  M.rig.root.visible = true;
  M.addons.forEach((o) => { if (o) o.visible = true; });
}

const clipAliases = {
  idle: ['idle', 'stand', 'rest'], move: ['walk', 'walking', 'run', 'jog'],
  attack: ['attack', 'atk', 'swing', 'slash', 'melee'], cast: ['cast', 'spell', 'ability'],
  down: ['death', 'die', 'down', 'defeat'],
};
function importedClip(M, pose) {
  const clips = M.importedSkin && M.importedSkin.clips || [];
  const anim = M.importedTuning && M.importedTuning.anim || {};
  const slot = pose === 'move' ? 'walk' : pose === 'down' ? 'death' : pose;
  const want = String(anim[slot] || 'auto').trim().toLowerCase();
  if (want === 'off' || want === 'none' || want === '') return null;
  if (want !== 'auto') {
    return clips.find((c) => String(c.name || '').toLowerCase() === want) ||
      clips.find((c) => String(c.name || '').toLowerCase().includes(want));
  }
  const aliases = clipAliases[pose] || clipAliases.idle;
  return aliases.map((a) => clips.find((c) => String(c.name || '').toLowerCase().includes(a))).find(Boolean) ||
    (pose === 'idle' || pose === 'move' ? clips[0] : null);
}
function setImportedPose(M, pose) {
  if (!M.mixer || !M.importedSkin) return;
  const clip = importedClip(M, pose);
  if (!clip) {
    if (M.importedAction) M.importedAction.action.fadeOut(0.12);
    M.importedAction = null;
    return;
  }
  if (M.importedAction && M.importedAction.clip === clip && M.importedAction.pose === pose) return;
  if (M.importedAction) M.importedAction.action.fadeOut(0.12);
  const action = M.mixer.clipAction(clip);
  action.reset();
  action.clampWhenFinished = pose === 'attack' || pose === 'cast' || pose === 'down';
  const speed = Number(M.importedTuning && M.importedTuning.anim && M.importedTuning.anim.speed);
  action.setEffectiveTimeScale(Number.isFinite(speed) ? speed : 1);
  action.setLoop(action.clampWhenFinished ? THREE.LoopOnce : THREE.LoopRepeat, action.clampWhenFinished ? 1 : Infinity);
  action.fadeIn(0.12).play();
  M.importedAction = { clip, pose, action };
}
function applyImportedSkin(M, skin, tuning = null) {
  disposeImported(M);
  if (!skin || !skin.template) return;
  const body = cloneRig(skin.template);
  const scale = Number.isFinite(tuning && tuning.scale) ? tuning.scale : 1;
  const pos = tuning && tuning.pos || { x: 0, y: 0, z: 0 };
  body.scale.multiplyScalar(scale);
  body.position.set(body.position.x * scale + (pos.x || 0), body.position.y * scale + (pos.y || 0), body.position.z * scale + (pos.z || 0));
  body.rotation.y = (skin.yaw || 0) + ((tuning && tuning.yawDeg || 0) * Math.PI / 180);
  M.group.add(body);
  M.importedBody = body;
  M.importedSkin = skin;
  M.importedTuning = tuning;
  M.rig.root.visible = false;
  M.addons.forEach((o) => { if (o) o.visible = false; });
  M._importedBase = { pos: body.position.clone(), rot: body.rotation.clone() };
  if (skin.clips && skin.clips.length && (!tuning || !tuning.anim || tuning.anim.on !== 0)) {
    M.mixer = new THREE.AnimationMixer(body);
    setImportedPose(M, 'idle');
  }
}

function customDef(file) {
  const base = HERO_DEFS[0];
  let h = 0;
  for (let i = 0; i < file.length; i++) h = (h * 33 + file.charCodeAt(i)) & 0xffffff;
  const stem = file.replace(/\.(glb|gltf)$/i, '');
  return Object.assign({}, base, {
    id: 'upload:' + file,
    name: stem.toUpperCase().slice(0, 20),
    tag: 'UPLOADED GLB', role: 'CUSTOM MODEL',
    bio: 'Imported from Hero Studio · ' + file,
    weapon: 'UPLOADED MODEL · HERO STUDIO',
    color: (h ^ 0x18e0ff) & 0xffffff,
    color2: (h ^ 0xff2fa0) & 0xffffff,
  });
}

async function loadCustomSkin(url, key) {
  const cached = uploadCache.get(url);
  if (cached && cached.key === key) return cached.skin;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const gltf = await parseGLB(await r.arrayBuffer());
  const template = gltf.scene || gltf.scenes[0];
  normalizeToStage(template, 2.4);
  const skin = { template, clips: (gltf.animations || []).filter((c) => c && c.duration > 0), yaw: 0, url };
  uploadCache.set(url, { key, skin });
  return skin;
}

function removeCustomModel(url) {
  const M = customModels.get(url);
  if (!M) return;
  disposeImported(M);
  scene.remove(M.group);
  const i = models.indexOf(M);
  if (i >= 0) models.splice(i, 1);
  customModels.delete(url);
}


/* ---------- state ---------- */
const S = {
  index: 0, model: models[0],
  yaw: 0.62, pitch: 0.20, dist: 7.6, targetY: 1.78,
  cameraMode: 'follow',
  spin: true, pose: 'idle', poseT: 0, attack: 0, cast: 0,
  drag: false, lastX: 0, lastY: 0, time: 0, flash: 0,
  detail: false, focus: new THREE.Vector3(0, 1.78, 0),
};
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/* ---------- UI ---------- */
const tabsEl = document.getElementById('tabs');
function renderTabs() {
  tabsEl.innerHTML = '';
  models.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.dataset.i = i;
    b.style.setProperty('--c', hex(m.def.color));
    const name = document.createElement('b');
    name.textContent = m.def.name;
    const role = document.createElement('span');
    role.textContent = m.def.role;
    b.append(name, role);
    b.onclick = () => select(i);
    b.onmouseenter = () => SFX.ready && SFX.play('uiHover');
    tabsEl.appendChild(b);
  });
}
renderTabs();

const bayStatus = document.getElementById('uploadState');
const defaultSkinURLs = new Set(HERO_DEFS.map((d) => UPDIR + d.id + '.glb'));
let bayFileSignature = '';
let bayTuningSignature = '';
let baySyncBusy = false;
function setBayStatus(text, tone = '') {
  if (!bayStatus) return;
  bayStatus.textContent = text;
  bayStatus.className = tone;
}
function customUploadFiles(files, tuning) {
  const assigned = new Set(defaultSkinURLs);
  for (const d of HERO_DEFS) {
    const model = tuning && tuning[d.id] && tuning[d.id].model;
    if (model) assigned.add(model);
  }
  return files.filter((f) => {
    if (!f || !/\.(glb|gltf)$/i.test(f.name)) return false;
    // Hero Studio also stores per-skill GLBs in the same library; those are
    // effects, not bodies, and should not become Character Bay tabs.
    if (/(?:-s\d+)?-fx\.(?:glb|gltf)$/i.test(f.name)) return false;
    return !assigned.has(UPDIR + f.name);
  });
}
async function syncBayUploads(initial = false) {
  if (baySyncBusy) return;
  baySyncBusy = true;
  try {
    const [filesRes, tuning] = await Promise.all([
      fetch(UP + '/files', { cache: 'no-store' }).then((r) => r.ok ? r.json() : []),
      ensureTuning(true),
    ]);
    const files = Array.isArray(filesRes) ? filesRes : [];
    const fileSignature = files.filter((f) => /\.(glb|gltf)$/i.test(f.name))
      .map((f) => f.name + ':' + f.bytes + ':' + (f.mtime || '')).sort().join('|');
    const tuningSignature = JSON.stringify(tuning || {});
    if (!initial && fileSignature === bayFileSignature && tuningSignature === bayTuningSignature) return;
    bayFileSignature = fileSignature;
    bayTuningSignature = tuningSignature;
    setBayStatus('SYNCING HERO STUDIO LIBRARY…');

    // The three roster tabs use exactly the same tuning/model contract as the
    // game. Saving a new model assignment in Hero Studio therefore changes the
    // body shown here without a code change or page reload.
    const skins = await ensureGLBSkins(tuning, true);
    for (const d of HERO_DEFS) applyImportedSkin(models.find((m) => m.def.id === d.id), skins[d.id] || null, tuning[d.id] || null);

    const wanted = customUploadFiles(files, tuning);
    const wantedURLs = new Set(wanted.map((f) => UPDIR + f.name));
    for (const url of [...customModels.keys()]) if (!wantedURLs.has(url)) removeCustomModel(url);
    for (const f of wanted) {
      const url = UPDIR + f.name;
      const key = f.name + ':' + f.bytes + ':' + (f.mtime || '');
      let M = customModels.get(url);
      if (!M) {
        M = buildBayModel(customDef(f.name));
        customModels.set(url, M);
        models.push(M);
      }
      try {
        const skin = await loadCustomSkin(url, key);
        if (M._uploadKey !== key) { applyImportedSkin(M, skin); M._uploadKey = key; }
      } catch (e) {
        setBayStatus('UPLOAD LIBRARY · ' + f.name + ' FAILED', 'bad');
      }
    }

    const selectedId = S.model && S.model.def.id;
    renderTabs();
    const keep = models.findIndex((m) => m.def.id === selectedId);
    select(keep >= 0 ? keep : 0, true);
    setBayStatus(models.length > HERO_DEFS.length
      ? 'HERO STUDIO SYNCED · ' + (models.length - HERO_DEFS.length) + ' UPLOADED MODEL' + (models.length - HERO_DEFS.length === 1 ? '' : 'S')
      : 'HERO STUDIO SYNCED · PROCEDURAL ROSTER', 'ok');
  } catch (e) {
    setBayStatus('HERO STUDIO LIBRARY OFFLINE · RETRYING', 'bad');
  } finally {
    baySyncBusy = false;
  }
}

function bars(def) {
  const rows = [
    ['ARMOUR', def.id === 'aegis' ? 0.95 : def.id === 'lyra' ? 0.35 : 0.2],
    ['DAMAGE', def.id === 'aegis' ? 0.7 : def.id === 'lyra' ? 0.45 : 1.0],
    ['SUPPORT', def.id === 'aegis' ? 0.4 : def.id === 'lyra' ? 1.0 : 0.15],
    ['MOBILITY', def.id === 'aegis' ? 0.55 : def.id === 'lyra' ? 0.8 : 0.9],
    ['RANGE', def.id === 'aegis' ? 0.2 : def.id === 'lyra' ? 0.7 : 1.0],
  ];
  return rows.map(([k, v]) => `<div class="st"><i>${k}</i><u><s style="transform:scaleX(${v})"></s></u></div>`).join('');
}

function select(i, silent) {
  if (!models[i]) return;
  const prev = S.model;
  S.index = i;
  S.model = models[i];
  S.targetY = S.model.importedBody ? 1.2 : 1.78;
  models.forEach((m, k) => { m.group.visible = k === i; });
  const d = S.model.def;
  document.documentElement.style.setProperty('--c', hex(d.color));
  document.documentElement.style.setProperty('--c2', hex(d.color2));
  tabsEl.querySelectorAll('.tab').forEach((b, k) => b.classList.toggle('on', k === i));

  document.getElementById('name').textContent = d.name;
  document.getElementById('tag').textContent = '«' + d.tag + '»';
  document.getElementById('role').textContent = d.role;
  document.getElementById('bio').textContent = d.bio;
  document.getElementById('kit').textContent = d.weapon;
  document.getElementById('stats').innerHTML = bars(d);
  document.getElementById('abilities').innerHTML = `
    <div class="ab"><em>LMB</em><div><b>${d.basic.name}</b><p>Primary weapon fire.</p></div></div>` +
    d.skills.map((s) => `<div class="ab ${s.ult ? 'ult' : ''}"><em>${s.key}</em><div><b>${s.name}</b><p>${s.desc}</p></div></div>`).join('');
  document.getElementById('hp').textContent = d.hp;
  document.getElementById('spd').textContent = d.speed.toFixed(1);
  document.getElementById('dr').textContent = Math.round(d.armor * 100) + '%';

  holoCyl.material.uniforms.uCol.value.set(d.color);
  floorUni.uAcc.value.set(d.color);
  rimA.color.set(d.color); rimB.color.set(d.color2); upLight.color.set(d.color);
  podRing.material.color.set(d.color);
  bloom.strength = 0.66;

  if (!silent) {
    // phase-in flourish
    fx.ring({ x: 0, y: 0, z: 0 }, d.color, { r0: 2.6, r1: 0.4, dur: 0.5, ease: 'in' });
    fx.ringBurst({ x: 0, y: 0, z: 0 }, d.color, 40, 2.0, { speed: -3, life: 0.9, size: 0.4, grav: 1.5, y: 0.2 });
    for (let k = 0; k < 60; k++) {
      fx.spawn({
        x: rand(1.2, -1.2), y: rand(3.4, 0), z: rand(1.2, -1.2),
        vx: 0, vy: rand(4, 1), vz: 0, color: new THREE.Color(d.color2),
        life: rand(0.9, 0.4), size: 0.32, drag: 1.4, grav: 0,
      });
    }
    S.flash = 0.3;
    SFX.ready && SFX.play('swap');
  }
}

/* ---------- pose buttons ---------- */
const poses = [
  ['idle', 'IDLE'], ['move', 'MOVE'], ['attack', 'ATTACK'], ['cast', 'CAST'], ['down', 'DOWNED'],
];
const posesEl = document.getElementById('poses');
posesEl.innerHTML = poses.map(([k, n], i) => `<button class="pz ${i === 0 ? 'on' : ''}" data-p="${k}">${n}</button>`).join('');
posesEl.querySelectorAll('.pz').forEach((b) => {
  b.onclick = () => {
    S.pose = b.dataset.p; S.poseT = 0;
    posesEl.querySelectorAll('.pz').forEach((x) => x.classList.toggle('on', x === b));
    SFX.ready && SFX.play('uiClick');
  };
});

/* ---------- signature VFX preview ---------- */
function signature() {
  const d = S.model.def;
  const O = new THREE.Vector3(0, 0, 0);
  S.flash = 0.5;
  SFX.init(); SFX.resume();
  if (d.id === 'aegis') {
    S.pose = 'attack'; S.poseT = 0;
    SFX.play('slam');
    fx.ring(O, 0xffc46a, { r0: 0.4, r1: 6.5, dur: 0.6, fade: 1.2 });
    fx.ring(O, 0xffffff, { r0: 0.4, r1: 4.2, dur: 0.4 });
    fx.ring(O, d.color, { r0: 0.4, r1: 8.6, dur: 0.9, fade: 2 });
    fx.ringBurst(O, 0xffb14a, 90, 1.0, { speed: 14, life: 0.9, size: 0.55 });
    fx.sparkBurst({ x: 0, y: 0.3, z: 0 }, 0xffd08a, 46, 22);
    fx.addShake(0.5);
  } else if (d.id === 'lyra') {
    S.pose = 'cast'; S.poseT = 0;
    SFX.play('bloomField');
    fx.ring(O, d.color, { r0: 0.5, r1: 5.2, dur: 0.8 });
    fx.ring(O, d.color2, { r0: 0.5, r1: 3.4, dur: 1.1, fade: 2 });
    for (let i = 0; i < 220; i++) {
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 3.4;
      fx.spawn({
        x: Math.cos(a) * r, y: 0.05, z: Math.sin(a) * r,
        vx: rand(0.3, -0.3), vy: rand(3.4, 1.2), vz: rand(0.3, -0.3),
        color: new THREE.Color(Math.random() < 0.4 ? d.color2 : d.color),
        life: rand(1.7, 0.8), size: rand(0.4, 0.16), drag: 0.7, grav: 1.1,
      });
    }
  } else {
    S.pose = 'attack'; S.poseT = 0;
    SFX.play('railFire');
    const from = new THREE.Vector3(0.42, 1.22, 0.35), to = new THREE.Vector3(0.42, 1.22, 15);
    fx.beam(from, to, 0xffffff, { w: 0.3, dur: 0.35, flare: 2 });
    fx.beam(from, to, d.color, { w: 0.8, dur: 0.45, flare: 1.6 });
    fx.beam(from, to, d.color2, { w: 1.5, dur: 0.55, flare: 1 });
    for (let i = 0; i < 90; i++) {
      const k = Math.random();
      fx.spawn({
        x: lerp(from.x, to.x, k) + rand(0.3, -0.3), y: lerp(from.y, to.y, k) + rand(0.3, -0.3), z: lerp(from.z, to.z, k),
        vx: rand(4, -4), vy: rand(4, -1), vz: rand(4, -4),
        color: new THREE.Color(d.color), life: rand(0.7, 0.25), size: rand(0.6, 0.25), drag: 2.2, grav: -3,
      });
    }
    fx.ring({ x: 0, y: 0, z: 0 }, d.color, { r0: 0.4, r1: 4.5, dur: 0.5 });
    fx.addShake(0.45);
  }
}
document.getElementById('sig').onclick = () => { signature(); };
document.getElementById('spin').onclick = (e) => {
  S.spin = !S.spin;
  e.currentTarget.classList.toggle('on', S.spin);
  e.currentTarget.textContent = S.spin ? 'AUTO-SPIN ON' : 'AUTO-SPIN OFF';
};

/* ---------- camera view ---------- */
const cameraModeEl = document.getElementById('cameraMode');
const cameraModeButtons = cameraModeEl.querySelectorAll('[data-camera-mode]');
function setCameraMode(mode, silent = false) {
  if (mode !== 'follow' && mode !== 'free') return;
  S.cameraMode = mode;
  // A free view should hold its composition; auto-spin can still be
  // re-enabled explicitly with the separate control.
  if (mode === 'free' && S.spin) {
    S.spin = false;
    const spinButton = document.getElementById('spin');
    spinButton.classList.remove('on');
    spinButton.textContent = 'AUTO-SPIN OFF';
  }
  cameraModeButtons.forEach((b) => {
    const active = b.dataset.cameraMode === mode;
    b.classList.toggle('on', active);
    b.setAttribute('aria-pressed', String(active));
  });
  cameraModeEl.dataset.mode = mode;
  if (!silent && SFX.ready) SFX.play('uiClick');
}
cameraModeButtons.forEach((b) => {
  b.onclick = () => setCameraMode(b.dataset.cameraMode);
});
/** frame the actual weapon mesh rather than a guessed height */
function focusPoint() {
  if (!S.detail || S.model.importedBody) return new THREE.Vector3(0, S.targetY, 0);
  const M = S.model, o = new THREE.Vector3();
  const node = M.pistol ? M.pistol.group : M.gauntlets ? M.gauntlets.R.group : M.gloves.R.group;
  node.getWorldPosition(o);
  return o;
}
document.getElementById('zoomw').onclick = (e) => {
  S.detail = !S.detail;
  S.dist = S.detail ? 2.7 : 7.6;
  e.currentTarget.classList.toggle('on', S.detail);
  e.currentTarget.textContent = S.detail ? 'FULL BODY' : 'WEAPON DETAIL';
  SFX.ready && SFX.play('uiClick');
};

/* ---------- input ---------- */
addEventListener('pointerdown', (e) => { if (e.target.closest('.panel,.bar,button')) return; S.drag = true; S.lastX = e.clientX; S.lastY = e.clientY; });
addEventListener('pointerup', () => { S.drag = false; });
addEventListener('pointermove', (e) => {
  if (!S.drag) return;
  S.yaw -= (e.clientX - S.lastX) * 0.008;
  S.pitch = clamp(S.pitch + (e.clientY - S.lastY) * 0.005, -0.15, 1.15);
  S.lastX = e.clientX; S.lastY = e.clientY;
});
addEventListener('wheel', (e) => { S.dist = clamp(S.dist + e.deltaY * 0.005, 2.4, 14); }, { passive: true });
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === '1') select(0); if (k === '2') select(1); if (k === '3') select(2);
  if (k === ' ') { e.preventDefault(); signature(); }
  if (k === 'f') setCameraMode(S.cameraMode === 'follow' ? 'free' : 'follow');
  if (k === 'm') SFX.toggleMute();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth * 0.5, innerHeight * 0.5);
});
// audio needs a gesture
const unlock = () => { SFX.init(); SFX.resume(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

select(0, true);
// Hero Studio writes into the shared upload dropbox. Poll both the library and
// hero_tuning.json so a newly uploaded model, or a new assignment to Aegis/Lyra/
// Nyx, appears in this bay without a manual refresh.
syncBayUploads(true);
setInterval(() => syncBayUploads(false), UPLOAD_POLL_MS);

/* ---------- loop ---------- */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  S.time += dt;
  S.poseT += dt;

  if (S.spin && !S.drag) S.yaw += dt * 0.24;

  // Follow mode keeps the framing on the body or weapon detail. Free mode
  // leaves the orbit pivot where the viewer put it, so changing pose/detail
  // cannot pull the camera away from a hand-picked composition.
  if (S.cameraMode === 'follow') S.focus.lerp(focusPoint(), Math.min(1, dt * 4.5));
  const cd = S.dist, cp = S.pitch;
  const cx = S.focus.x + Math.sin(S.yaw) * Math.cos(cp) * cd;
  const cz = S.focus.z + Math.cos(S.yaw) * Math.cos(cp) * cd;
  const cy = S.focus.y + Math.sin(cp) * cd;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 7));
  camera.lookAt(S.focus);

  // pose driving
  const M = S.model, rig = M.rig, d = M.def;
  let speed = 0, dead = false;
  if (S.pose === 'move') speed = 0.85;
  if (S.pose === 'down') dead = true;
  if (S.pose === 'attack' && S.poseT > 0.42) { S.attack = 1; S.poseT = 0; SFX.ready && SFX.play(d.id === 'aegis' ? 'fist' : d.id === 'lyra' ? 'nanite' : 'arc', { v: 0.6 }); }
  if (S.pose === 'cast') S.cast = Math.min(1, S.cast + dt * 3); else S.cast = Math.max(0, S.cast - dt * 3);
  S.attack = Math.max(0, S.attack - dt * 4);

  animateRig(rig, dt, {
    speed, time: S.time, attack: S.attack, cast: S.cast, dead,
    style: d.style, block: d.id === 'aegis',
  });
  if (M.importedBody) {
    setImportedPose(M, S.pose);
    const B = M._importedBase;
    M.importedBody.position.y = B.pos.y + (dead ? -0.15 : 0) + S.attack * 0.04;
    M.importedBody.rotation.x = B.rot.x - (dead ? 1.35 : 0) + S.cast * 0.08;
    M.importedBody.rotation.z = B.rot.z + Math.sin(S.time * 8) * 0.025 * speed;
    if (M.mixer) M.mixer.update(dt);
  }

  // weapon idles
  if (M.pistol) {
    M.pistol.coil.material.opacity = 0.4 + S.attack * 0.6 + 0.15 * Math.sin(S.time * 8);
    M.pistol.light.intensity = 0.6 + S.attack * 5;
    M.pistol.rails.forEach((r, i) => { r.material.opacity = 0.6 + 0.25 * Math.sin(S.time * 9 + i); });
  }
  if (M.gauntlets) {
    const g = 0.6 + S.attack * 0.4;
    M.gauntlets.L.knuck.material.opacity = g; M.gauntlets.R.knuck.material.opacity = g + S.attack * 0.3;
    M.gauntlets.R.light.intensity = 1 + S.attack * 6;
  }
  if (M.gloves) {
    M.gloves.R.ring.rotation.z += dt * 3; M.gloves.L.ring.rotation.z -= dt * 2.4;
    const g = 0.6 + 0.3 * Math.sin(S.time * 5) + S.cast * 0.4;
    M.gloves.R.emitter.material.opacity = g; M.gloves.L.emitter.material.opacity = g * 0.8;
  }
  if (M.drone) {
    const dr = M.drone;
    dr.bob += dt;
    dr.group.position.set(Math.sin(dr.bob * 0.5) * 0.8, 2.0 + Math.sin(dr.bob * 1.8) * 0.12, Math.cos(dr.bob * 0.5) * 0.8);
    dr.group.rotation.y += dt * 1.2;
    dr.ringA.rotation.z += dt * 3;
    dr.hull.rotation.x += dt * 0.9;
    dr.eye.material.opacity = 0.7 + 0.3 * Math.sin(S.time * 6);
  }

  // idle sparkle from the procedural chest core; imported bodies may not have
  // the game's core node, so do not emit invisible particles for them.
  if (!M.importedBody && Math.random() < 0.25) {
    const p = new THREE.Vector3();
    rig.core.getWorldPosition(p);
    fx.spawn({
      x: p.x + rand(0.1, -0.1), y: p.y, z: p.z + rand(0.1, -0.1),
      vx: rand(0.3, -0.3), vy: rand(0.9, 0.2), vz: rand(0.3, -0.3),
      color: new THREE.Color(d.color), life: 0.6, size: 0.16, drag: 1.6, grav: 0,
    });
  }

  pedestal.rotation.y += dt * 0.1;
  podTicks.rotation.y -= dt * 0.24;
  floorUni.uTime.value = S.time;
  holoCyl.material.uniforms.uTime.value = S.time;
  motes.rotation.y += dt * 0.012;

  fx.update(dt);
  S.flash *= Math.exp(-6 * dt);
  grade.uniforms.uTime.value = S.time;
  grade.uniforms.uFlash.value = S.flash + fx.flash;
  grade.uniforms.uCol.value.set(d.color);
  // camera shake from signature moves
  if (fx.shake > 0.001) {
    camera.position.x += Math.sin(S.time * 47) * fx.shake * 0.14;
    camera.position.y += Math.sin(S.time * 53) * fx.shake * 0.11;
  }
  composer.render();
}
requestAnimationFrame(frame);

setCameraMode('follow', true);
window.BAY = { S, select, signature, setCameraMode, models, syncBayUploads };
