import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { HERO_DEFS } from './heroes.js';
import {
  buildHumanoid, animateRig, buildIonGauntlets, buildRiotShield,
  buildMedGloves, buildRailPistol, buildDrone,
} from './rig.js';
import { FX } from './fx.js';
import { addMat, metalMat, rand, clamp, damp, lerp, TAU } from './util.js';
import { SFX } from './audio.js';

/* ============================================================
   CHARACTER BAY — a turntable viewer for the three operatives.
   Same rigs, same weapons, same shaders as the game; studio lit.
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

/* ---------- heroes ---------- */
const models = HERO_DEFS.map((d) => {
  const rig = buildHumanoid({
    accent: d.color, visor: d.color2, bulk: d.bulk, scale: d.scale,
    pauldrons: d.pauldrons, hood: d.hood, crest: d.crest, plate: d.plate,
  });
  const g = new THREE.Group();
  g.add(rig.root);
  scene.add(g);
  g.visible = false;
  const M = { def: d, rig, group: g, drone: null };
  if (d.id === 'aegis') { M.gauntlets = buildIonGauntlets(rig, d.color); M.shield = buildRiotShield(rig, d.color2); }
  else if (d.id === 'lyra') { M.gloves = buildMedGloves(rig, d.color); M.drone = buildDrone(rig, d.color2); g.add(M.drone.group); }
  else { M.pistol = buildRailPistol(rig, d.color); M.drone = buildDrone(rig, d.color2); g.add(M.drone.group); }
  rig.disc.material.opacity = 0.0;
  return M;
});

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
tabsEl.innerHTML = HERO_DEFS.map((d, i) => `
  <button class="tab" data-i="${i}" style="--c:${hex(d.color)}">
    <b>${d.name}</b><span>${d.role}</span>
  </button>`).join('');
tabsEl.querySelectorAll('.tab').forEach((b) => {
  b.onclick = () => select(+b.dataset.i);
  b.onmouseenter = () => SFX.ready && SFX.play('uiHover');
});

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
  const prev = S.model;
  S.index = i;
  S.model = models[i];
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
  if (!S.detail) return new THREE.Vector3(0, S.targetY, 0);
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

  // idle sparkle from the chest core
  if (Math.random() < 0.25) {
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
window.BAY = { S, select, signature, setCameraMode, models };
