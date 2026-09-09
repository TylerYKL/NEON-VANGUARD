import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildWorld, ARENA } from './world.js';
import { FX } from './fx.js';
import { Hero, HERO_DEFS } from './heroes.js';
import { ensureGLBSkins, ensureTuning, loadFXBank } from './glbskin.js';
import { Enemy, ENEMY_TYPES, ProjectileSystem, ELITES } from './entities.js';
import { UI } from './ui.js';
import { SFX } from './audio.js';
import { Pickup } from './pickups.js';
import { LightPool } from './lights.js';
import { UPGRADES, MOD_DEFAULTS, RARITY_COLOR, rollOffers } from './upgrades.js';
import { BALANCE as B, applyBalance } from './balance.js';
import { initDevTools, DEV_CSS } from './devtools.js';

/* ============================================================
   SETTINGS — persisted, applied live.
   ============================================================ */
const DEFAULTS = { master: 0.85, music: 0.5, sfx: 0.9, fx: 1, shake: 1, palette: 'neon', dmgNumbers: true };
const SETTINGS = Object.assign({}, DEFAULTS);
const PALETTES = {
  neon:  { skitter: 0xff2b4a, brute: 0xff5a2b, sentinel: 0xff1cc4, juggernaut: 0xff2b4a },
  // deuteranopia-safe: hostiles move to amber/blue, away from the mint/green allies
  cb:    { skitter: 0xffa53d, brute: 0xff7a18, sentinel: 0x4aa3ff, juggernaut: 0xffc21f },
};
function loadSettings() {
  try {
    const raw = localStorage.getItem('nv.settings');
    if (raw) Object.assign(SETTINGS, JSON.parse(raw));
  } catch (e) { /* storage blocked — defaults are fine */ }
}
function saveSettings() {
  try { localStorage.setItem('nv.settings', JSON.stringify(SETTINGS)); } catch (e) {}
}
function bestRun() {
  try { return JSON.parse(localStorage.getItem('nv.best') || '{"score":0,"wave":0,"kills":0}'); }
  catch (e) { return { score: 0, wave: 0, kills: 0 }; }
}
function saveBest(b) { try { localStorage.setItem('nv.best', JSON.stringify(b)); } catch (e) {} }

import { clamp, rand, damp, lerp, flatDist, TAU, angleTo, shortAngle } from './util.js';

/* ============================================================
   NEON VANGUARD — vertical slice
   ============================================================ */

const app = document.getElementById('app');

const CAPTURE = location.search.includes('shot');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.info.autoReset = false;   // accumulate across composer passes, not just the final quad
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.5, 400);
camera.position.set(0, 30, 22);
camera.lookAt(0, 0, 0);

/* ---------- post ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// Guard pass: kill NaN/Inf and clamp HDR before the bloom mip chain.
// (A single Inf pixel spreads across every mip and blacks out the frame.)
const ClampShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      c = mix(c, vec4(0.0), vec4(notEqual(c, c)));           // NaN -> 0
      c.rgb = min(c.rgb, vec3(4.5));                         // clamp blowouts
      float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)); // roll very hot pixels toward white
      c.rgb = mix(c.rgb, vec3(lum), clamp((lum - 1.6) * 0.5, 0.0, 0.55));
      gl_FragColor = vec4(max(c.rgb, vec3(0.0)), 1.0);
    }`,
};
composer.addPass(new ShaderPass(ClampShader));

const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth * 0.5, innerHeight * 0.5), 0.52, 0.45, 0.82);
composer.addPass(bloom);

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFlashCol: { value: new THREE.Color(0xffffff) },
    uDmg: { value: 0 },
    uAberr: { value: 0.0018 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uFlash; uniform vec3 uFlashCol;
    uniform float uDmg; uniform float uAberr; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d,d);
      float ab = uAberr * (1.0 + r2*7.0) * (1.0 + uFlash*4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d*ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d*ab).b;
      // scanline + grain
      col *= 0.97 + 0.03*sin(uv.y*900.0);
      float grain = fract(sin(dot(uv*vec2(uTime*0.7+12.9898,78.233),vec2(1.0,1.0)))*43758.5453);
      col += (grain-0.5)*0.022;
      // vignette
      col *= smoothstep(1.15, 0.28, r2*1.9);
      // damage edge
      col = mix(col, vec3(0.75,0.05,0.16), uDmg * smoothstep(0.06,0.42,r2));
      // ult flash
      col += uFlashCol * uFlash * 0.55;
      gl_FragColor = vec4(col,1.0);
    }`,
};
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);
composer.addPass(new OutputPass());

/* Slot-priority biases for the light pool (subtracted from squared distance).
   Hoisted out of the frame loop so a frame allocates nothing. */
const ENEMY_LIGHT_BIAS = (o) => (o.T.boss ? 1e9 : 0);
const PICKUP_LIGHT_BIAS = (o) => (o.core ? 1e9 : 0);

/* ---------- game state ---------- */
const ui = new UI();
const fx = new FX(scene, camera);
const world = buildWorld(scene, renderer);
// Fixed-size point-light pool. Created once; never resized during play, so the
// scene's light count (and therefore three.js's compiled shader programs)
// cannot change when enemies spawn or die. See src/lights.js.
const lights = new LightPool(scene, B.perf);

const G = {
  scene, camera, renderer, fx, world, ui, lights,
  heroes: [], enemies: [], effects: [], barriers: [], pickups: [],
  corePoints: 0, coreNeed: 16,
  hitStop: 0, drafting: false, god: false, mods: Object.assign({}, MOD_DEFAULTS), taken: {}, hpScale: 1, dmgScale: 1, maxAlive: 45, elitesSeen: 0, bestChain: 0,
  enemyPool: {}, settings: SETTINGS,
  ultChain: 0, ultChainT: 0, ultMul: 1, overdriveT: 0,
  timeScale: 1, timeScaleTarget: 1,
  projectiles: null,
  time: 0, dt: 0, fps: 60,
  wave: 0, score: 0, combo: 1, comboT: 0, kills: 0,
  spawnQueue: [], waveActive: false, waveTimer: 3,
  running: false, paused: false, over: false,
  active: null, activeIndex: 0,
  damageVignette: 0,
  aimPoint: new THREE.Vector3(0, 0, 5),
  mouse: new THREE.Vector2(-1, -1),
  screenAim: { x: -100, y: -100 },
};
G.projectiles = new ProjectileSystem(scene, G);

/* ---------- helpers exposed to systems ---------- */
G.nearestEnemy = (pos, maxD = 999) => {
  let best = null, bd = maxD * maxD;
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
};
G.nearestHero = (pos) => {
  let best = null, bd = 1e9;
  for (const h of G.heroes) {
    if (h.dead || h.downed) continue;
    const d = flatDist(h.pos, pos);
    // taunt weighting: tank is more attractive
    const w = h.def.id === 'aegis' ? 0.7 : 1;
    if (d * w < bd) { bd = d * w; best = h; }
  }
  if (!best) best = G.heroes.find((h) => !h.dead) ?? null;
  return best;
};
G.countEnemiesNear = (pos, r) => {
  let n = 0;
  for (const e of G.enemies) if (!e.dead && flatDist(e.pos, pos) < r) n++;
  return n;
};
G.weakestHero = () => {
  let best = null, bf = 2;
  for (const h of G.heroes) { if (h.dead) continue; const f = h.downed ? -1 : h.hp / h.maxHp; if (f < bf) { bf = f; best = h; } }
  return best;
};
G.downedCount = () => G.heroes.filter((h) => h.downed).length;

G.panOf = (p) => clamp((p.x - camTarget.x) / 24, -1, 1);

G.damageEnemy = (e, dmg, from, opts = {}) => {
  if (e.dead) return;
  const crit = Math.random() < (G.mods.critChance) && !opts.silent;
  const um = opts.ult && opts.source ? (opts.source.ultMul || 1) : 1;
  const shield = e.damageScale ? e.damageScale(opts.fromPos || (opts.source && opts.source.pos) || from) : 1;
  const fromHero = opts.source && opts.source.def;
  const gm = fromHero ? G.mods.dmg * (opts.source.dmgBuffT > 0 ? 1.4 : 1) : 1;
  const amount = dmg * (crit ? G.mods.critMul : 1) * um * shield * gm;
  if (fromHero && G.mods.lifesteal > 0 && !opts.dot) {
    const heal = amount * G.mods.lifesteal;
    let weakest = null, wf = 1;
    for (const h of G.heroes) { if (h.dead || h.downed) continue; const f = h.hp / h.maxHp; if (f < wf) { wf = f; weakest = h; } }
    if (weakest && wf < 0.999) weakest.heal(heal, true);
  }
  if (shield < 1 && !opts.silent) G.popText(e.center(), 'BLOCKED', '#39c6ff', 0.9);
  e.hp -= amount;
  e.hitFlash = 1;
  e.drawBar();
  if (opts.knock) {
    const a = angleTo(from, e.pos);
    const k = opts.knock * (e.T.boss ? 0.14 : 1);
    e.pull.x += Math.sin(a) * k; e.pull.z += Math.cos(a) * k;
  }
  const src = opts.source;
  if (src) { src.stats.dmg += amount; src.addEnergy(amount * (src.def.id === 'aegis' ? 0.07 : 0.055)); }
  if (!opts.silent) {
    // the heavier the blow, the longer the freeze
    if (amount >= 45) G.punch(Math.min(0.075, 0.022 + amount * 0.00012));
    else if (crit) G.punch(0.02);
    SFX.play(crit ? 'crit' : 'hit', { pan: G.panOf(e.pos), gap: crit ? 0.05 : 0.03 });
    G.popText(e.center(), Math.round(amount), crit ? '#ffe36a' : '#ffffff', crit ? 1.5 : 1);
    G.fx.burst(e.center(), e.T.color, crit ? 12 : 5, { speed: 6, life: 0.28, size: 0.32 });
  }
  if (e.hp <= 0) e.die(G, src);
};

G.explode = (pos, radius, dmg, color, source) => {
  for (const e of G.enemies) {
    if (e.dead) continue;
    const d = flatDist(e.pos, pos);
    if (d < radius + e.radius) G.damageEnemy(e, dmg * (1 - d / (radius * 1.5)), pos, { knock: 5, source });
  }
  SFX.play('explode', { pan: G.panOf(pos), gap: 0.05 });
  G.fx.ring(pos, color, { r0: 0.3, r1: radius * 1.2, dur: 0.35 });
  G.fx.burst(pos, color, 24, { speed: 12, life: 0.45, size: 0.45 });
  G.fx.sparkBurst(pos, color, 8, 16);
};

G.chainLightning = (from, jumps, dmg, color, source) => {
  let cur = from;
  const hit = new Set([from.id]);
  for (let j = 0; j < jumps; j++) {
    let best = null, bd = 10;
    for (const e of G.enemies) {
      if (e.dead || hit.has(e.id)) continue;
      const d = flatDist(e.pos, cur.pos);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) break;
    hit.add(best.id);
    SFX.play('chain', { pan: G.panOf(best.pos), gap: 0.05 });
    const a = cur.center(), b = best.center();
    // jagged bolt
    const N = 6;
    for (let i = 0; i < N; i++) {
      const p1 = a.clone().lerp(b, i / N).add(new THREE.Vector3(rand(0.5, -0.5), rand(0.5, -0.5), rand(0.5, -0.5)));
      const p2 = a.clone().lerp(b, (i + 1) / N).add(new THREE.Vector3(rand(0.5, -0.5), rand(0.5, -0.5), rand(0.5, -0.5)));
      G.fx.beam(p1, p2, color, { w: 0.09, dur: 0.14, flare: 0.4 });
    }
    G.damageEnemy(best, dmg, cur.pos, { source });
    cur = best;
  }
};

G.popText = (worldPos, text, color, scale = 1) => {
  const v = worldPos.clone().project(camera);
  if (v.z > 1) return;
  const x = (v.x * 0.5 + 0.5) * innerWidth;
  const y = (-v.y * 0.5 + 0.5) * innerHeight;
  ui.pop(x, y, text, color, scale);
};

G.announceSkill = (hero, sk) => {
  const col = '#' + hero.def.color.toString(16).padStart(6, '0');
  if (hero === G.active) {
    ui.skillCall(sk.name, col);
    ui.fireSkill(hero.def.skills.indexOf(sk));
  } else {
    ui.feed(`${hero.def.name} · ${sk.name}`, col);
  }
  if (sk.ult) { fx.addShake(0.35); SFX.duck(0.3, 1.1); }
};

G.addEffect = (e) => G.effects.push(e);

/* ============================================================
   IMPLANT DRAFT — three offers between waves. The sim halts,
   rendering continues, and the pick is applied to G.mods.
   ============================================================ */
let draftOffers = [];

function openDraft() {
  draftOffers = rollOffers(G.taken, 3, G.wave);
  if (!draftOffers.length) { G.waveTimer = 3.2; return; }
  G.drafting = true;
  SFX.duck(0.4, 1.2);
  SFX.play('ultReady');
  const el = document.getElementById('draft');
  el.classList.remove('hidden');
  el.querySelector('.dsub').textContent = 'Wave ' + G.wave + ' cleared \u00B7 choose an implant';
  el.querySelector('.dcards').innerHTML = draftOffers.map((u, i) => {
    const owned = G.taken[u.id] || 0;
    return '<div class="dcard ' + u.rarity + '" data-i="' + i + '" style="--c:' + RARITY_COLOR[u.rarity] + '">' +
      '<div class="dkey">' + (i + 1) + '</div>' +
      '<div class="dicon">' + u.icon + '</div>' +
      '<div class="drar">' + u.rarity + (u.hero ? ' \u00B7 ' + u.hero : '') + '</div>' +
      '<div class="dname">' + u.name + '</div>' +
      '<div class="ddesc">' + u.desc + '</div>' +
      (owned ? '<div class="downed">owned \u00D7' + owned + ' / ' + u.max + '</div>' : '') +
    '</div>';
  }).join('');
  for (const c of el.querySelectorAll('.dcard')) {
    c.onmouseenter = () => SFX.play('uiHover');
    c.onclick = () => takeDraft(+c.dataset.i);
  }
}

function takeDraft(i) {
  if (!G.drafting) return;
  const u = draftOffers[i];
  const el = document.getElementById('draft');
  if (u) {
    u.apply(G.mods);
    G.taken[u.id] = (G.taken[u.id] || 0) + 1;
    // stats that need to be pushed onto live objects
    G.coreNeed = Math.max(6, 16 - G.mods.coreNeed);
    for (const h of G.heroes) h.applyMods && h.applyMods(G.mods);
    ui.feed('IMPLANT INSTALLED \u00B7 ' + u.name, RARITY_COLOR[u.rarity]);
    SFX.play('coreGet');
    fx.flash = 0.3; fx.flashColor.set(RARITY_COLOR[u.rarity]);
    for (const h of G.heroes) fx.ring(h.pos, RARITY_COLOR[u.rarity], { r0: 0.4, r1: 3.4, dur: 0.5 });
  }
  el.classList.add('hidden');
  G.drafting = false;
  G.waveTimer = 2.6;
  renderBuild();
}

function skipDraft() {
  if (!G.drafting) return;
  document.getElementById('draft').classList.add('hidden');
  G.drafting = false;
  G.waveTimer = 2.0;
  G.score += B.economy.skipBonus;
  ui.feed('DRAFT SKIPPED \u00B7 +300', '#9fb');
}

/** running list of installed implants, shown on pause + end screen */
function renderBuild() {
  const el = document.getElementById('buildlist');
  if (!el) return;
  const ids = Object.keys(G.taken);
  if (!ids.length) { el.innerHTML = '<span class="bnone">no implants installed</span>'; return; }
  el.innerHTML = ids.map((id) => {
    const u = UPGRADES.find((x) => x.id === id);
    if (!u) return '';
    return '<span class="bchip" style="--c:' + RARITY_COLOR[u.rarity] + '">' + u.icon + ' ' + u.name +
      (G.taken[id] > 1 ? ' \u00D7' + G.taken[id] : '') + '</span>';
  }).join('');
}

/* ============================================================
   ARENA HAZARDS — from wave 6 the deck starts discharging.
   Telegraphed grid tiles that hurt BOTH sides, so they are
   positioning pressure rather than just extra incoming damage.
   ============================================================ */
G.hazards = [];
G.hazardTimer = 6;

function spawnHazard() {
  // biased toward the fight so it is positioning pressure, not background noise
  const anchor = G.active ? G.active.pos : { x: 0, z: 0 };
  const a = Math.random() * TAU;
  const r = rand(13, 4);
  const h = {
    x: clamp(anchor.x + Math.cos(a) * r, -ARENA + 6, ARENA - 6),
    z: clamp(anchor.z + Math.sin(a) * r, -ARENA + 6, ARENA - 6),
    rad: rand(B.hazard.radMax, B.hazard.radMin), t: 0, phase: 0,
    tell: fx.telegraph(0x39c6ff, 'disc'),
  };
  G.hazards.push(h);
  SFX.play('tell', { pan: G.panOf(h), v: 1.4, gap: 0 });
}

function updateHazards(dt) {
  if (G.wave >= B.hazard.fromWave && G.waveActive) {
    G.hazardTimer -= dt;
    if (G.hazardTimer <= 0) {
      G.hazardTimer = Math.max(B.hazard.minGap, B.hazard.baseGap - G.wave * B.hazard.gapStep);
      if (G.hazards.length < 3) spawnHazard();
    }
  }
  for (let i = G.hazards.length - 1; i >= 0; i--) {
    const h = G.hazards[i];
    h.t += dt;
    if (h.phase === 0) {
      const p = h.t / B.hazard.warn;
      fx.tellSet(h.tell, h.x, h.z, 0, h.rad, p);
      if (h.t >= B.hazard.warn) {
        h.phase = 1; h.t = 0;
        // keep the decal through the discharge so the kill zone stays unmistakable
        if (h.tell) {
          h.tell.material.uniforms.uP.value = 1;
          h.tell.material.uniforms.uColor.value.set(0x9ff4ff);
        }
        fx.ring(h, 0x7cf9ff, { r0: 0.5, r1: h.rad, dur: 0.35 });
        fx.addShake(0.3);
        SFX.play('chain', { pan: G.panOf(h), v: 1.6, gap: 0 });
        world.arenaPulse();
      }
    } else {
      // discharge
      const dps = B.hazard.heroDps * (G.dmgScale || 1);
      for (const hero of G.heroes) {
        if (hero.dead || hero.downed) continue;
        if (flatDist(hero.pos, h) < h.rad) hero.takeDamage(dps * dt, h);
      }
      for (const e of G.enemies) {
        if (e.dead) continue;
        if (flatDist(e.pos, h) < h.rad) G.damageEnemy(e, B.hazard.enemyDps * G.mods.hazardBoost * dt, h, { silent: true });
      }
      for (let k = 0; k < 2; k++) if (Math.random() < 0.8) {
        const a1 = Math.random() * TAU, a2 = a1 + rand(2.4, 1.2);
        fx.beam(
          new THREE.Vector3(h.x + Math.cos(a1) * h.rad * 0.9, 0.25, h.z + Math.sin(a1) * h.rad * 0.9),
          new THREE.Vector3(h.x + Math.cos(a2) * h.rad * 0.9, 0.25, h.z + Math.sin(a2) * h.rad * 0.9),
          0x7cf9ff, { w: 0.1, dur: 0.11, flare: 1 }
        );
      }
      if (Math.random() < 0.5) {
        const a1 = Math.random() * TAU, rr = Math.sqrt(Math.random()) * h.rad;
        fx.spawn({
          x: h.x + Math.cos(a1) * rr, y: 0.05, z: h.z + Math.sin(a1) * rr,
          vx: 0, vy: rand(6, 2), vz: 0, color: new THREE.Color(0x7cf9ff),
          life: 0.35, size: 0.34, drag: 1.5, grav: 0,
        });
      }
      if (h.tell) {
        h.tell.material.uniforms.uFade.value = 1.15 + Math.sin(h.t * 40) * 0.35;
        fx.tellSet(h.tell, h.x, h.z, 0, h.rad, 1);
      }
      fx.ring(h, 0x39c6ff, { r0: h.rad * 0.96, r1: h.rad, dur: 0.12, y: 0.05 });
      if (h.t >= B.hazard.zap) { fx.tellRelease(h.tell); h.tell = null; G.hazards.splice(i, 1); }
    }
  }
}

/* ============================================================
   ADAPTIVE LOAD GOVERNOR — draw calls scale with live enemies,
   so on weak hardware we shed bodies and particles instead of
   dropping frames. Never fights the player's FX setting; it only
   scales below whatever they chose.
   ============================================================ */
G.perfBudget = { slow: 0, fast: 0, aliveCap: 0, note: 0 };
function updateGovernor(dt) {
  const P = G.perfBudget;
  const ms = G.frameMs || 16;
  if (!P.aliveCap) P.aliveCap = B.scaling.maxAlive;
  if (ms > 24) { P.slow += dt; P.fast = 0; } else if (ms < 14) { P.fast += dt; P.slow = 0; } else { P.slow *= 0.9; P.fast *= 0.9; }
  if (P.slow > 1.5 && P.aliveCap > 18) {
    P.aliveCap = Math.max(18, P.aliveCap - 5);
    fx.pMul = Math.max(0.35, SETTINGS.fx * 0.6);
    P.slow = 0;
    if (!P.note) { P.note = 1; ui.feed('PERFORMANCE MODE \u00B7 REDUCING LOAD', '#ffb14a'); }
  } else if (P.fast > 4 && P.aliveCap < B.scaling.maxAlive) {
    P.aliveCap = Math.min(B.scaling.maxAlive, P.aliveCap + 3);
    if (P.aliveCap >= B.scaling.maxAlive) fx.pMul = SETTINGS.fx;
    P.fast = 0;
  }
  G.maxAlive = Math.min(B.scaling.maxAlive, P.aliveCap);
}

/** freeze the world for a few frames. `a` in seconds, capped so it can never stack into a stall. */
G.punch = (a) => { G.hitStop = Math.min(B.combat.hitStopMax, Math.max(G.hitStop, a)); };

/* ============================================================
   ULTIMATE CHAIN — cast an ult, and you have 6.5 s to swap and
   fire another. 2 in a row = LINK (x1.45). All 3 = TRINITY
   OVERDRIVE: bullet-time, refreshed kit, arena-wide detonation.
   ============================================================ */
G.onUltCast = (hero) => {
  G.ultChain = G.ultChainT > 0 ? Math.min(3, G.ultChain + 1) : 1;
  G.bestChain = Math.max(G.bestChain || 0, G.ultChain);
  G.ultChainT = B.chain.window * G.mods.chainWindow;
  G.ultMul = [1, 1, B.chain.mul2, B.chain.mul3][G.ultChain];
  hero.ultMul = G.ultMul;
  G.chainCast = G.chainCast || new Set();
  if (G.ultChain === 1) G.chainCast.clear();
  G.chainCast.add(hero.def.id);
  if (G.ultChain === 2) {
    SFX.play('chainLink');
    ui.skillCall('CHAIN \u00D72  \u2014  LINK', '#ffe36a');
    ui.feed('ULT CHAIN x2 \u00B7 +45% ULT DAMAGE', '#ffe36a');
    fx.flash = 0.35; fx.flashColor.set(0xffe36a);
    fx.addShake(0.3);
  } else if (G.ultChain >= 3 && G.chainCast.size >= 3) {
    G.trinityOverdrive(hero);
  }
};

G.setTimeScale = (v, ret = 1) => { G.timeScale = v; G.timeScaleTarget = ret; };

G.trinityOverdrive = (hero) => {
  G.overdriveT = B.chain.overdriveTime;
  SFX.play('overdrive');
  SFX.duck(0.18, 2.6);
  SFX.setTempo(74);
  G.setTimeScale(B.chain.overdriveScale, 1);
  ui.banner('Trinity', 'OVERDRIVE');
  ui.feed('TRINITY OVERDRIVE \u00B7 SQUAD SYNCHRONISED', '#ffffff');
  fx.flash = 1; fx.flashColor.set(0xffffff);
  fx.addShake(1.1);
  world.arenaPulse();

  const centre = new THREE.Vector3(hero.pos.x, 0, hero.pos.z);
  for (const h of G.heroes) {
    h.shield = B.chain.trinityShield; h.maxShield = B.chain.trinityShield;
    h.buffs.speed = Math.max(h.buffs.speed, 0.5);
    h.buffTimer = 8;
    h.cds[0] = 0; h.cds[1] = 0;
    if (h.downed) h.revive(1); else h.heal(h.maxHp * 0.5);
    fx.ring(h.pos, h.def.color, { r0: 0.4, r1: 5, dur: 0.6 });
  }

  G.addEffect({
    t: 0, fired: false,
    update(dt) {
      this.t += dt;
      // three tribute beams converging on the epicentre
      if (Math.random() < 0.6) {
        for (const h of G.heroes) {
          fx.beam(h.center(), new THREE.Vector3(centre.x, 2.4, centre.z), h.def.color, { w: 0.16, dur: 0.2, flare: 1.4 });
          fx.attract(h.pos, new THREE.Vector3(centre.x, 2.4, centre.z), h.color, 3, { r: 1.5, life: 0.5, pull: 40 });
        }
      }
      if (!this.fired && this.t > 0.9) {
        this.fired = true;
        for (const e of G.enemies) {
          if (e.dead) continue;
          const d = flatDist(e.pos, centre);
          G.damageEnemy(e, (B.chain.trinityDmg + e.maxHp * 0.14) * clamp(1 - d / 48, 0.35, 1), centre, { knock: 30, source: hero, ult: true });
          fx.ring(e.pos, 0xffffff, { r0: 0.2, r1: 2.4, dur: 0.4 });
        }
        fx.flash = 1; fx.flashColor.set(0xffe36a);
        fx.ring(centre, 0xffffff, { r0: 1, r1: 26, dur: 0.6 });
        fx.ring(centre, 0xffe36a, { r0: 1, r1: 38, dur: 1.1, fade: 2 });
        fx.ring(centre, 0xff8a2b, { r0: 1, r1: 50, dur: 1.7, fade: 3 });
        fx.burst({ x: centre.x, y: 1.5, z: centre.z }, 0xffe36a, 240, { speed: 42, life: 1.4, size: 1.0, grav: -8 });
        fx.sparkBurst({ x: centre.x, y: 1.5, z: centre.z }, 0xffffff, 90, 48);
        fx.addShake(1.6);
        world.arenaPulse();
        G.score += 2500;
        G.popText(new THREE.Vector3(centre.x, 3, centre.z), '+2500', '#ffe36a', 2.0);
      }
      return this.t < 3.2;
    },
  });
};

G.barrierBlocks = (pos, r) => {
  for (const b of G.barriers) {
    if (!b.active) continue;
    const d = flatDist(pos, b.pos);
    if (Math.abs(d - b.r) < 0.6 + r && pos.y < 5) {
      fx.ring({ x: pos.x, y: pos.y, z: pos.z }, 0x7cf9ff, { r0: 0.1, r1: 1.4, dur: 0.3, vertical: true, yaw: Math.atan2(pos.x - b.pos.x, pos.z - b.pos.z) });
      fx.burst(pos, 0x7cf9ff, 12, { speed: 6, life: 0.3, size: 0.35 });
      SFX.play('domeHit', { pan: G.panOf(pos), gap: 0.06 });
      return true;
    }
  }
  return false;
};
G.absorbedByBarrier = () => false;
G.barrierProtects = (pos) => {
  for (const b of G.barriers) if (b.active && flatDist(pos, b.pos) < b.r) return true;
  return false;
};

/** fade cover pylons that sit between the camera and a hero */
const _occA = new THREE.Vector3(), _occB = new THREE.Vector3(), _occP = new THREE.Vector3();
function updateOcclusion(dt) {
  const cam = camera.position;
  for (const o of world.obstacles) {
    let blocked = false;
    for (const h of G.heroes) {
      if (h.dead) continue;
      _occA.set(cam.x, 0, cam.z);
      _occB.set(h.pos.x, 0, h.pos.z);
      _occP.set(o.x, 0, o.z);
      const ab = _occB.clone().sub(_occA);
      const len = ab.length();
      if (len < 0.01) continue;
      const t = clamp(_occP.clone().sub(_occA).dot(ab) / (len * len), 0, 1);
      if (t <= 0.02 || t >= 0.98) continue;              // only things actually in between
      const closest = _occA.clone().addScaledVector(ab, t);
      if (closest.distanceTo(_occP) < o.r + 1.1) { blocked = true; break; }
    }
    o.fade = damp(o.fade ?? 1, blocked ? 0.22 : 1, 9, dt);
    if (!o.faded) {
      o.mesh.traverse((m) => {
        if (m.material && m.material.transparent !== undefined && m !== o.glow) {
          m.material.transparent = true;
        }
      });
      o.faded = true;
    }
    o.mesh.traverse((m) => {
      if (m.material && m !== o.glow && m.material.opacity !== undefined) m.material.opacity = o.fade;
    });
    if (o.glow) o.glow.material.opacity *= 0.35 + 0.65 * o.fade;
  }
}

G.resolveObstacles = (pos, r) => {
  for (const o of world.obstacles) {
    const dx = pos.x - o.x, dz = pos.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + r;
    if (d < min && d > 0.001) {
      pos.x = o.x + (dx / d) * min;
      pos.z = o.z + (dz / d) * min;
    }
  }
};

G.groundAim = (hero, maxRange) => {
  if (hero === G.active) {
    const p = G.aimPoint.clone();
    const d = flatDist(p, hero.pos);
    if (d > maxRange) {
      const a = angleTo(hero.pos, p);
      p.set(hero.pos.x + Math.sin(a) * maxRange, 0, hero.pos.z + Math.cos(a) * maxRange);
    }
    p.y = 0;
    return p;
  }
  const t = G.nearestEnemy(hero.pos, maxRange);
  return t ? new THREE.Vector3(t.pos.x, 0, t.pos.z)
    : new THREE.Vector3(hero.pos.x + Math.sin(hero.facing) * 8, 0, hero.pos.z + Math.cos(hero.facing) * 8);
};

G.aimEnemy = (hero, range, tolerance) => {
  let best = null, bs = -1;
  const fx0 = Math.sin(hero.facing), fz0 = Math.cos(hero.facing);
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.pos.x - hero.pos.x, dz = e.pos.z - hero.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    const dot = (fx0 * dx + fz0 * dz) / (d || 1);
    if (dot < tolerance) continue;
    const s = dot * 2 - d / range;
    if (s > bs) { bs = s; best = e; }
  }
  return best;
};

G.spawnPickup = (type, x, z) => { G.pickups.push(new Pickup(G, type, x, z)); };

G.onEnemyKilled = (e, killer) => {
  G.kills++;
  G.punch(e.T.boss ? 0.10 : e.elite ? 0.055 : 0.018);
  // charge economy: shards trickle in, and every `coreNeed` points a full CORE drops
  const T = e.T;
  const shardChance = T.boss ? 1 : (e.type === 'skitter' ? B.economy.shardChanceChaff : B.economy.shardChanceElite);
  if (Math.random() < shardChance) G.spawnPickup('shard', e.pos.x, e.pos.z);
  G.corePoints += T.boss ? 12 : 1;
  if (T.boss) { for (let i = 0; i < 4; i++) G.spawnPickup('shard', e.pos.x + rand(4, -4), e.pos.z + rand(4, -4)); }
  if (G.corePoints >= (G.coreNeed || B.economy.coreNeed)) { G.corePoints = 0; G.spawnPickup('core', e.pos.x, e.pos.z); }
  G.comboT = B.combat.comboDecay;
  G.combo = Math.min(8, G.combo + 0.2);
  G.score += Math.round(e.T.score * G.combo);
  if (killer) { killer.stats.kills++; killer.addEnergy(e.T.boss ? 60 : 6); }
  if (e.T.boss) ui.feed('BOSS ELIMINATED', '#ffe36a');
};

G.onHeroDowned = (h) => {
  ui.feed(`${h.def.name} DOWN`, '#ff4466');
  if (h === G.active) {
    const alive = G.heroes.filter((x) => !x.downed);
    if (alive.length) switchTo(G.heroes.indexOf(alive[0]), true);
  }
  if (G.heroes.every((x) => x.downed)) gameOver();
};

/* ---------- squad ---------- */
function createSquad() {
  for (const h of G.heroes) { scene.remove(h.group); if (h.drone) scene.remove(h.drone.group); }
  G.heroes = HERO_DEFS.map((d, i) => new Hero(d, G, i));
  G.heroes[0].pos.set(-3, 0, 8);
  G.heroes[1].pos.set(0, 0, 10);
  G.heroes[2].pos.set(3, 0, 8);
  ui.buildSquad(G.heroes);
  switchTo(0, false);
}

function switchTo(i, silent) {
  if (i < 0 || i >= G.heroes.length) return;
  const h = G.heroes[i];
  if (h.downed && !silent) return;
  if (G.active === h) return;
  const prev = G.active;
  if (prev) prev.controlled = false;
  G.active = h;
  G.activeIndex = i;
  h.controlled = true;
  ui.buildSkills(h);
  if (prev) {
    fx.ring(prev.pos, prev.def.color, { r0: 0.4, r1: 3.2, dur: 0.4 });
    fx.burst(prev.center(), prev.def.color, 18, { speed: 7, life: 0.4, size: 0.4 });
  }
  fx.ring(h.pos, h.def.color, { r0: 3.6, r1: 0.5, dur: 0.4, ease: 'in' });
  fx.ringBurst(h.pos, h.def.color, 26, 2.6, { speed: -7, life: 0.5, size: 0.45, grav: 1 });
  fx.addShake(0.16);
  fx.flash = 0.22; fx.flashColor.set(h.def.color);
  SFX.play('swap');
  if (!silent) ui.feed(`${h.def.name} ONLINE`, '#' + h.def.color.toString(16).padStart(6, '0'));
}

/* ---------- waves ---------- */
const WAVES = [
  { skitter: 6 },
  { skitter: 8, brute: 2 },
  { skitter: 8, brute: 3, sentinel: 2 },
  { skitter: 12, brute: 4, sentinel: 3 },
  { juggernaut: 1, skitter: 8, brute: 3 },
  { skitter: 14, brute: 6, sentinel: 4 },
  { skitter: 16, brute: 7, sentinel: 5 },
  { juggernaut: 2, skitter: 12, brute: 6, sentinel: 4 },
];

function startWave(n) {
  G.wave = n;
  const def = WAVES[Math.min(n - 1, WAVES.length - 1)];
  // count grows slowly; the real ramp is per-enemy strength + elite density
  const scale = n > WAVES.length ? 1 + (n - WAVES.length) * B.scaling.countStep : 1;
  G.hpScale = 1 + Math.max(0, n - 3) * B.scaling.hpStep;
  G.dmgScale = 1 + Math.max(0, n - 3) * B.scaling.dmgStep;
  G.maxAlive = B.scaling.maxAlive;
  G.eliteChance = n < B.scaling.eliteFromWave ? 0 : Math.min(B.scaling.eliteMax, (n - 3) * B.scaling.eliteStep);
  G.spawnQueue = [];
  for (const [type, count] of Object.entries(def)) {
    const c = Math.round(count * scale);
    for (let i = 0; i < c; i++) G.spawnQueue.push(type);
  }
  // shuffle
  for (let i = G.spawnQueue.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [G.spawnQueue[i], G.spawnQueue[j]] = [G.spawnQueue[j], G.spawnQueue[i]];
  }
  G.waveActive = true;
  G.spawnTimer = 0;
  const boss = def.juggernaut;
  SFX.play(boss ? 'bossAlarm' : 'waveStart');
  SFX.setIntensity(boss ? 4 : Math.min(3, 1 + Math.floor((n - 1) / 2)));
  ui.banner(boss ? 'Warning' : 'Wave', boss ? 'BOSS' : String(n).padStart(2, '0'));
  ui.feed(boss ? 'ONI-CLASS SIGNATURE DETECTED' : `WAVE ${n} INBOUND`, boss ? '#ff2b4a' : '#18e0ff');
  if (boss) { fx.addShake(0.6); world.arenaPulse(); }
  if (n === 6) ui.feed('DECK INTEGRITY FAILING \u00B7 GRID DISCHARGES INBOUND', '#39c6ff');
  // heal a bit between waves
  if (n > 1) for (const h of G.heroes) { h.heal(h.maxHp * B.economy.waveHeal, true); h.addEnergy(B.economy.waveEnergy); }
}

function spawnEnemy(type) {
  const pool = G.enemyPool[type] || (G.enemyPool[type] = []);
  let e = pool.pop();
  if (e) e.reset(G);
  else { e = new Enemy(type, G); e.maxHp = e.hp = e.T.hp * G.hpScale; }
  // elite prefix
  if (!e.T.boss && Math.random() < (G.eliteChance || 0)) {
    const keys = Object.keys(ELITES);
    const kind = keys[(Math.random() * keys.length) | 0];
    e.setElite(kind);
    G.elitesSeen++;
  }
  let x, z, tries = 0;
  do {
    const a = Math.random() * TAU;
    const r = ARENA * rand(0.95, 0.62);
    x = Math.cos(a) * r; z = Math.sin(a) * r;
    tries++;
  } while (tries < 12 && G.active && flatDist({ x, z }, G.active.pos) < 16);
  e.spawnAt(x, z);
  scene.add(e.group);
  G.enemies.push(e);
  // spawn portal fx
  const p = { x, y: 0, z };
  fx.ring(p, e.T.color, { r0: 0.2, r1: e.T.boss ? 8 : 2.6, dur: 0.6 });
  fx.ringBurst(p, e.T.color, e.T.boss ? 60 : 16, 1.2, { speed: e.T.boss ? 8 : 4, life: 0.7, size: 0.4, grav: 2 });
  for (let i = 0; i < (e.T.boss ? 70 : 16); i++) {
    fx.spawn({
      x: x + rand(1.4, -1.4), y: 0.1, z: z + rand(1.4, -1.4),
      vx: 0, vy: rand(9, 2), vz: 0, color: new THREE.Color(e.T.color),
      life: rand(0.9, 0.4), size: 0.4, drag: 1.2, grav: -2,
    });
  }
  return e;
}

/* ---------- input ---------- */
const keys = {};
let mouseDown = false;
let mouseHeld = false;
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'p') togglePause();
  if (k === 'k') skipTutorial();
  if (G.drafting) {
    if (k === '1') takeDraft(0);
    if (k === '2') takeDraft(1);
    if (k === '3') takeDraft(2);
    if (k === 'escape') skipDraft();
    return;
  }
  if (k === 'm') { const m = SFX.toggleMute(); syncAudioBtn(); if (G.running) ui.feed(m ? 'AUDIO MUTED' : 'AUDIO ON', '#18e0ff'); }
  if (!G.running || G.paused) return;
  if (k === '1') switchTo(0);
  if (k === '2') switchTo(1);
  if (k === '3') switchTo(2);
  if (e.key === 'Tab') {
    e.preventDefault();
    for (let i = 1; i <= 3; i++) {
      const idx = (G.activeIndex + i) % 3;
      if (!G.heroes[idx].downed) { switchTo(idx); break; }
    }
  }
  if (k === 'q') G.active.useSkill(0, G);
  if (k === 'e') G.active.useSkill(1, G);
  if (k === 'r') G.active.useSkill(2, G);
  if (k === ' ') { e.preventDefault(); G.active.dash(); }
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
addEventListener('mousedown', (e) => { if (e.button === 0) { mouseDown = true; mouseHeld = true; } });
addEventListener('mouseup', (e) => { if (e.button === 0) { mouseDown = false; mouseHeld = false; } });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  G.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  G.screenAim.x = e.clientX; G.screenAim.y = e.clientY;
});
addEventListener('blur', () => { mouseDown = false; mouseHeld = false; for (const k in keys) keys[k] = false; });

function updateAim() {
  if (PAD.on && (Math.abs(PAD.aimX) + Math.abs(PAD.aimZ)) > 0.05) return;
  raycaster.setFromCamera(G.mouse, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) {
    G.aimPoint.copy(hit);
  }
  ui.setCross(G.screenAim.x, G.screenAim.y, G.running && !G.paused);
}

/* ---------- camera ---------- */
const camTarget = new THREE.Vector3(0, 0, 0);
const camPos = new THREE.Vector3(0, 30, 22);
function updateCamera(dt) {
  const a = G.active;
  if (!a) return;
  // look slightly toward aim
  const lead = new THREE.Vector3().subVectors(G.aimPoint, a.pos).clampLength(0, 12).multiplyScalar(0.22);
  camTarget.x = damp(camTarget.x, a.pos.x + lead.x, 5, dt);
  camTarget.z = damp(camTarget.z, a.pos.z + lead.z, 5, dt);
  const h = 23.5, back = 15.5;
  camPos.x = damp(camPos.x, camTarget.x, 6, dt);
  camPos.z = damp(camPos.z, camTarget.z + back, 6, dt);
  camPos.y = damp(camPos.y, h, 5, dt);
  const s = fx.shake;
  camera.position.set(
    camPos.x + Math.sin(G.time * 43.7) * s * 0.9,
    camPos.y + Math.sin(G.time * 51.3) * s * 0.7,
    camPos.z + Math.cos(G.time * 47.1) * s * 0.9
  );
  camera.lookAt(camTarget.x + Math.sin(G.time * 39) * s * 0.5, 1.0, camTarget.z + Math.cos(G.time * 41) * s * 0.5);
}

/* ---------- flow ---------- */
async function startGame(training) {
  SFX.init(); SFX.resume(); SFX.play('uiClick'); SFX.startMusic(1); syncAudioBtn();
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  ui.show();
  for (const e of G.enemies) scene.remove(e.group);
  G.enemies.length = 0;
  for (const p of G.pickups) p.remove(G);
  G.pickups.length = 0;
  G.lights.clear();
  for (const b of G.barriers) b.active = false;
  G.barriers.length = 0;
  G.corePoints = 0; G.ultChain = 0; G.ultChainT = 0; G.ultMul = 1; G.overdriveT = 0;
  G.timeScale = 1; G.timeScaleTarget = 1; SFX.setTempo(124);
  G.hpScale = 1; G.dmgScale = 1; G.eliteChance = 0; G.elitesSeen = 0; G.bestChain = 0;
  G.dodges = 0; G.coresTaken = 0; G.runStart = performance.now();
  for (const h of G.hazards) fx.tellRelease(h.tell);
  G.hazards.length = 0; G.hazardTimer = 6;
  G.perfBudget = { slow: 0, fast: 0, aliveCap: B.scaling.maxAlive, note: 0 };
  G.mods = Object.assign({}, MOD_DEFAULTS);
  G.taken = {};
  G.coreNeed = B.economy.coreNeed;
  G.drafting = false;
  document.getElementById('draft').classList.add('hidden');
  renderBuild();
  G.effects.length = 0;
  G.score = 0; G.kills = 0; G.combo = 1; G.wave = 0;
  G.over = false; G.paused = false;
  G.glbSkins = await ensureGLBSkins();   // uploaded hero models (models/uploads/*.glb), if any
  G.glbTuning = await ensureTuning();    // studio-saved size / motion / skill-fx config
  G.fxBank = await loadFXBank(G.glbTuning);
  createSquad();
  G.running = true;
  G.waveActive = false;
  G.waveTimer = 2.2;
  G.tut = { active: false, step: 0, t: 0, travel: 0, dashes: 0, skills: 0 };
  document.getElementById('tut').classList.remove('on');
  if (training) {
    G.tut.active = true;
    G.waveTimer = 1e9;                     // waves wait until training is done
    ui.banner('Training', 'SECTOR 07');
    setTimeout(() => { if (G.tut.active) tutStep(0); }, 900);
  } else {
    ui.banner('Sector 07', 'DEPLOY');
  }
}

/* ============================================================
   TRAINING — a gated wave 0. Each step teaches one verb and
   will not advance until the player actually performs it.
   ============================================================ */
const TUT_STEPS = [
  {
    title: 'MOVEMENT', key: 'W A S D',
    hint: 'Walk the deck. The camera follows you.',
    init(G) { G.tut.travel = 0; },
    done(G) { return G.tut.travel > 9; },
  },
  {
    title: 'PRIMARY FIRE', key: 'MOUSE + HOLD LMB',
    hint: 'Aim with the mouse, hold left click. Take down the three practice drones.',
    init(G) { spawnDummies(3); },
    done(G) { return G.enemies.filter((e) => !e.dead).length === 0; },
  },
  {
    title: 'DASH', key: 'SPACE',
    hint: 'Dash has 0.2s of invulnerability — time it through an attack to dodge it. Dash twice.',
    init(G) { G.tut.dashes = 0; },
    done(G) { return G.tut.dashes >= 2; },
  },
  {
    title: 'SWITCH OPERATIVE', key: '1  2  3   /   TAB',
    hint: 'You pilot one; the other two fight as AI. Switch to another operative.',
    init(G) { G.tut.startHero = G.heroes.indexOf(G.active); },
    done(G) { return G.heroes.indexOf(G.active) !== G.tut.startHero; },
  },
  {
    title: 'ABILITIES', key: 'Q   E',
    hint: 'Each operative has two skills. Enemies telegraph their attacks — a stun cancels the wind-up.',
    init(G) { G.tut.skills = 0; spawnDummies(4); },
    done(G) { return G.tut.skills >= 2; },
  },
  {
    title: 'ULTIMATE CHAIN', key: 'R  →  SWITCH  →  R',
    hint: 'Kills drop charge. Fire an ultimate, switch operative, fire again inside 6.5s to CHAIN.',
    init(G) { for (const h of G.heroes) h.energy = h.maxEnergy; spawnDummies(5); },
    done(G) { return (G.bestChain || 0) >= 2; },
  },
];

function spawnDummies(n) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + Math.random();
    const r = 11 + Math.random() * 5;
    const e = spawnEnemy('skitter');
    if (!e) continue;
    e.pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    e.spawnAt(e.pos.x, e.pos.z);
    e.stun = 9999;              // inert practice target: no movement, no attacks
    e.dummy = true;
  }
}

function tutStep(i) {
  G.tut.step = i;
  const st = TUT_STEPS[i];
  const el = document.getElementById('tut');
  if (!st) {
    el.classList.remove('on');
    G.tut.active = false;
    try { localStorage.setItem('nv.trained', '1'); } catch (e) {}
    ui.banner('Training', 'COMPLETE');
    ui.feed('TRAINING COMPLETE \u00B7 LIVE HOSTILES INBOUND', '#3dffb0');
    SFX.play('waveClear');
    for (const e of G.enemies) e.die(G, G.active);
    G.waveTimer = 3.2;
    return;
  }
  st.init && st.init(G);
  el.classList.add('on');
  el.innerHTML =
    '<div class="tnum">STEP ' + (i + 1) + ' / ' + TUT_STEPS.length + '</div>' +
    '<div class="ttitle">' + st.title + '</div>' +
    '<div class="tkey">' + st.key + '</div>' +
    '<div class="thint">' + st.hint + '</div>' +
    '<div class="tskip">press <b>K</b> to skip training</div>';
  SFX.play('uiClick');
}

function updateTutorial(dt) {
  if (!G.tut || !G.tut.active) return;
  const st = TUT_STEPS[G.tut.step];
  if (!st) return;
  G.tut.t += dt;
  if (G.tut.t > 0.6 && st.done(G)) {
    SFX.play('waveClear', { v: 0.5 });
    G.fx.flash = Math.max(G.fx.flash, 0.2);
    G.tut.t = 0;
    tutStep(G.tut.step + 1);
  }
}

function skipTutorial() {
  if (!G.tut || !G.tut.active) return;
  G.tut.active = false;
  document.getElementById('tut').classList.remove('on');
  for (const e of G.enemies) e.die(G, G.active);
  try { localStorage.setItem('nv.trained', '1'); } catch (e) {}
  ui.feed('TRAINING SKIPPED', '#ffb14a');
  G.waveTimer = 2.5;
}

function gameOver() {
  SFX.play('gameOver'); SFX.stopMusic(2.2);
  G.running = false;
  G.over = true;
  const el = document.getElementById('gameover');
  el.classList.remove('hidden');

  const prev = bestRun();
  const isBest = G.score > (prev.score || 0);
  if (isBest) saveBest({ score: G.score, wave: G.wave, kills: G.kills });

  const secs = Math.max(1, (performance.now() - (G.runStart || performance.now())) / 1000);
  const runTime = Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0');
  const totalDmg = G.heroes.reduce((a, h) => a + h.stats.dmg, 0) || 1;
  const hx = (n) => '#' + n.toString(16).padStart(6, '0');
  const DOT = '\u00B7';
  const stat = (label, value) => '<div class="gostat"><i>' + label + '</i><b>' + value + '</b></div>';

  document.getElementById('go-title').textContent = isBest ? 'New Record' : 'Squad Down';
  document.getElementById('go-sub').textContent = 'Signal lost ' + DOT + ' wave ' + G.wave;
  document.getElementById('stats').innerHTML =
    '<div class="gorow">' +
      stat('Score', G.score.toLocaleString()) +
      stat('Waves cleared', Math.max(0, G.wave - 1)) +
      stat('Kills', G.kills) +
      stat('Best chain', G.bestChain > 2 ? 'TRINITY' : '\u00D7' + (G.bestChain || 1)) +
    '</div>' +
    '<div class="gorow sub">' +
      stat('Elites downed', G.elitesSeen || 0) +
      stat('Dodges', G.dodges || 0) +
      stat('Cores taken', G.coresTaken || 0) +
      stat('Run time', runTime) +
    '</div>' +
    '<div class="gohero">' + G.heroes.map((h) => {
      const frac = h.stats.dmg / totalDmg;
      return '<div class="gh" style="--c:' + hx(h.def.color) + '">' +
        '<div class="ghn">' + h.def.name + '<em>' + h.def.role + '</em></div>' +
        '<div class="ghbar"><s style="transform:scaleX(' + frac.toFixed(3) + ')"></s></div>' +
        '<div class="ghv">' + Math.round(h.stats.dmg).toLocaleString() + ' dmg <em>' + Math.round(frac * 100) + '%</em> ' + DOT + ' ' +
        Math.round(h.stats.heal).toLocaleString() + ' healed ' + DOT + ' ' + h.stats.kills + ' kills</div>' +
      '</div>';
    }).join('') + '</div>' +
    '<div class="gohead">Implants</div><div id="gobuild" class="gochips">' +
      (Object.keys(G.taken).length
        ? Object.keys(G.taken).map((id) => {
            const u = UPGRADES.find((x) => x.id === id);
            return u ? '<span class="bchip" style="--c:' + RARITY_COLOR[u.rarity] + '">' + u.icon + ' ' + u.name +
              (G.taken[id] > 1 ? ' \u00D7' + G.taken[id] : '') + '</span>' : '';
          }).join('')
        : '<span class="bnone">none installed</span>') + '</div>' +
    '<div class="gobest">' + (isBest ? '\u2605 PERSONAL BEST'
      : 'personal best ' + DOT + ' ' + (prev.score || 0).toLocaleString() + ' pts ' + DOT + ' wave ' + (prev.wave || 0)) + '</div>';
}

function togglePause() {
  if (!G.running) return;
  G.paused = !G.paused;
  if (G.paused) SFX.suspend(); else SFX.resume();
  document.getElementById('paused').classList.toggle('hidden', !G.paused);
}

loadSettings();
applySettings();

/* ---------- dev overlay (backtick) ---------- */
{
  const st = document.createElement('style');
  st.textContent = DEV_CSS;
  document.head.appendChild(st);
  initDevTools(G, {
    apply() {
      applyBalance(HERO_DEFS, ENEMY_TYPES);
      G.coreNeed = Math.max(6, B.economy.coreNeed - G.mods.coreNeed);
      G.mods.critChance = B.combat.critChance + (G.taken.crit ? G.taken.crit * 0.10 : 0);
      G.mods.critMul = B.combat.critMul + (G.taken.crit ? G.taken.crit * 0.3 : 0);
      G.maxAlive = B.scaling.maxAlive;
      G.lights.setBudget(B.perf);   // deliberate: this recompiles programs once
      for (const h of G.heroes) {
        const frac = h.maxHp > 0 ? h.hp / h.maxHp : 1;
        h.maxHp = h.def.hp;
        h.hp = Math.min(h.maxHp, h.maxHp * frac);
      }
    },
    action(a) {
      if (a === 'wave') { G.spawnQueue.length = 0; for (const e of G.enemies) e.die(G, G.active); }
      else if (a === 'boss') { const e = spawnEnemy('juggernaut'); if (e) ui.feed('DEV: BOSS SPAWNED', '#ff2b4a'); }
      else if (a === 'kill') { for (const e of G.enemies) e.die(G, G.active); }
      else if (a === 'draft') { G.waveActive = false; openDraft(); }
      else if (a === 'charge') { for (const h of G.heroes) h.energy = h.maxEnergy; }
      else if (a === 'slow') { G.timeScale = G.timeScale === 1 ? 0.25 : 1; }
    },
    stats() {
      return {
        ms: (G.frameMs || 0).toFixed(1), fps: (G.fps || 0).toFixed(0),
        enemies: G.enemies.length + '/' + G.maxAlive, calls: G.renderCalls || 0, tris: (G.renderTris || 0).toLocaleString(),
        // lit / total pooled lights. The total must never change during play —
        // if it does, three.js is recompiling programs. See src/lights.js.
        lights: G.lights ? G.lights.active + '/' + G.lights.size : '-',
      };
    },
  });
  applyBalance(HERO_DEFS, ENEMY_TYPES);
}
buildSettingsUI(document.getElementById('opts-pause'));
buildSettingsUI(document.getElementById('opts-menu'));
{
  const b = bestRun();
  const el = document.getElementById('bestline');
  if (el && b.score > 0) el.textContent = 'personal best \u00B7 ' + b.score.toLocaleString() + ' pts \u00B7 wave ' + b.wave + ' \u00B7 ' + b.kills + ' kills';
}
const optBtn = document.getElementById('optbtn');
if (optBtn) optBtn.onclick = () => {
  document.getElementById('optwrap').classList.toggle('hidden');
  SFX.init(); SFX.resume(); SFX.play('uiClick');
};
const trainBtn = document.getElementById('trainbtn');
if (trainBtn) trainBtn.onclick = () => startGame(true);
document.getElementById('start').onclick = () => {
  // first-ever visit drops straight into training
  let trained = true;
  try { trained = !!localStorage.getItem('nv.trained'); } catch (e) {}
  startGame(!trained);
};
document.getElementById('restart').onclick = () => startGame(false);

/* ============================================================
   SETTINGS PANEL — lives on the pause screen and the main menu.
   ============================================================ */
function applySettings() {
  SFX.setVolume(SETTINGS.master);
  SFX.sfxVol = SETTINGS.sfx;
  SFX.musicVol = SETTINGS.music;
  if (SFX.ready) {
    SFX.sfxBus.gain.setTargetAtTime(SETTINGS.sfx, SFX.ctx.currentTime, 0.05);
    if (SFX.playing) SFX.musicBus.gain.setTargetAtTime(SETTINGS.music, SFX.ctx.currentTime, 0.05);
  }
  fx.pMul = SETTINGS.fx;
  fx.shakeMul = SETTINGS.shake;
  bloom.strength = SETTINGS.fx <= 0.5 ? 0.38 : SETTINGS.fx >= 1.5 ? 0.62 : 0.52;
  bloom.radius = SETTINGS.fx <= 0.5 ? 0.3 : 0.45;
  const pal = PALETTES[SETTINGS.palette] || PALETTES.neon;
  for (const [k, c] of Object.entries(pal)) if (ENEMY_TYPES[k]) ENEMY_TYPES[k].color = c;
  for (const e of G.enemies) if (e.retint) e.retint(pal[e.type] || e.T.color);
  for (const list of Object.values(G.enemyPool)) for (const e of list) if (e.retint) e.retint(pal[e.type] || e.T.color);
  document.body.classList.toggle('nodmg', !SETTINGS.dmgNumbers);
  saveSettings();
}

function buildSettingsUI(root) {
  if (!root) return;
  const rows = [
    ['master', 'Master volume', 'range', 0, 1, 0.05],
    ['music', 'Music', 'range', 0, 1, 0.05],
    ['sfx', 'Effects', 'range', 0, 1, 0.05],
    ['fx', 'FX intensity', 'select', [['0.5', 'Low - readable'], ['1', 'Normal'], ['1.6', 'Cinematic']]],
    ['shake', 'Screen shake', 'select', [['0', 'Off'], ['0.5', 'Reduced'], ['1', 'Full']]],
    ['palette', 'Hostile palette', 'select', [['neon', 'Neon (default)'], ['cb', 'Colour-blind safe']]],
    ['dmgNumbers', 'Damage numbers', 'select', [['1', 'Show'], ['0', 'Hide']]],
  ];
  root.innerHTML = rows.map(([key, label, kind, a, b, c]) => {
    if (kind === 'range') {
      return '<label class="set"><span>' + label + '</span>' +
        '<input type="range" data-k="' + key + '" min="' + a + '" max="' + b + '" step="' + c + '" value="' + SETTINGS[key] + '">' +
        '<b data-v="' + key + '">' + Math.round(SETTINGS[key] * 100) + '</b></label>';
    }
    const opts = a.map((o) => '<option value="' + o[0] + '">' + o[1] + '</option>').join('');
    return '<label class="set"><span>' + label + '</span><select data-k="' + key + '">' + opts + '</select></label>';
  }).join('');
  for (const el of root.querySelectorAll('[data-k]')) {
    const k = el.dataset.k;
    if (el.tagName === 'SELECT') {
      el.value = typeof SETTINGS[k] === 'boolean' ? (SETTINGS[k] ? '1' : '0') : String(SETTINGS[k]);
      el.onchange = () => {
        SETTINGS[k] = k === 'palette' ? el.value : k === 'dmgNumbers' ? el.value === '1' : parseFloat(el.value);
        applySettings();
        if (SFX.ready) SFX.play('uiClick');
      };
    } else {
      el.oninput = () => {
        SETTINGS[k] = parseFloat(el.value);
        const out = root.querySelector('[data-v="' + k + '"]');
        if (out) out.textContent = Math.round(SETTINGS[k] * 100);
        applySettings();
      };
    }
  }
}

/* ---------- audio toggle widget ---------- */
const audioBtn = document.getElementById('audiobtn');
function syncAudioBtn() {
  if (!audioBtn) return;
  const on = SFX.ready && !SFX.muted;
  audioBtn.textContent = on ? '\u25B6 AUDIO ON' : '\u2716 MUTED';
  audioBtn.classList.toggle('off', !on);
}
if (audioBtn) {
  audioBtn.onclick = () => { SFX.init(); SFX.resume(); SFX.toggleMute(); syncAudioBtn(); };
  syncAudioBtn();
}
for (const b of document.querySelectorAll('.btn')) {
  b.addEventListener('mouseenter', () => { if (SFX.ready) SFX.play('uiHover'); });
}

/* ============================================================
   GAMEPAD — standard mapping. Right stick aims in world space,
   so the aim reticle is driven by the stick instead of the mouse.
   ============================================================ */
const PAD = { on: false, aimX: 0, aimZ: 1, prev: {}, dead: 0.22 };
function padAxis(v) { return Math.abs(v) < PAD.dead ? 0 : (v - Math.sign(v) * PAD.dead) / (1 - PAD.dead); }
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) { if (PAD.on) { PAD.on = false; document.body.classList.remove('pad'); } return null; }
  if (!PAD.on) {
    PAD.on = true;
    document.body.classList.add('pad');
    if (G.running) ui.feed('CONTROLLER CONNECTED', '#18e0ff');
  }
  const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const pressed = (i) => { const now = b(i), was = PAD.prev[i]; PAD.prev[i] = now; return now && !was; };
  const out = {
    mx: padAxis(gp.axes[0] || 0),
    my: padAxis(gp.axes[1] || 0),
    ax: padAxis(gp.axes[2] || 0),
    ay: padAxis(gp.axes[3] || 0),
    fire: b(7) || b(0) || (gp.buttons[7] && gp.buttons[7].value > 0.3),
    dash: pressed(1) || pressed(5),      // B / RB
    q: pressed(2),                       // X
    e: pressed(3),                       // Y
    r: pressed(6) || pressed(4),         // LT / LB
    swapNext: pressed(9),                // right stick click / start-ish
    h1: pressed(12), h2: pressed(14), h3: pressed(15),
    pause: pressed(8) || pressed(16),
  };
  return out;
}

/* ---------- resize ---------- */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth * 0.5, innerHeight * 0.5);
});

/* ---------- loop ---------- */
let last = performance.now();
let fpsAcc = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  const rawDt = Math.min(dt, 0.25);
  last = now;
  if (dt > 0.05) dt = 0.05;
  // measure wall-clock frame time, not the clamped simulation dt
  fpsAcc += rawDt; fpsN++;
  if (fpsN >= 20) { G.frameMs = (fpsAcc / fpsN) * 1000; G.fps = 1000 / G.frameMs; fpsAcc = 0; fpsN = 0; }

  if (!G.paused) {
    // bullet-time (Trinity Overdrive)
    if (G.overdriveT > 0) {
      G.overdriveT -= dt;
      if (G.overdriveT <= 0) { G.timeScale = 1; SFX.setTempo(124); }
      else if (G.overdriveT < 0.9) G.timeScale = lerp(G.timeScale, 1, 1 - Math.exp(-3 * dt));
    }
    // hit-stop: a couple of frames of near-freeze on heavy impacts
    if (G.hitStop > 0) {
      G.hitStop -= rawDt;
      dt *= 0.06;
    }
    dt *= G.timeScale;
    G.dt = dt;
    G.time += dt;
    updateAim();

    if (G.running && G.drafting) {
      const pd = pollPad();
      if (pd) {
        if (pd.q) takeDraft(0);
        else if (pd.dash) takeDraft(1);
        else if (pd.e) takeDraft(2);
        else if (pd.pause) skipDraft();
      }
    }
    if (G.running && !G.drafting) {
      const a = G.active;
      const pad = pollPad();
      if (pad) {
        if (pad.pause) togglePause();
        if (pad.dash) a.dash();
        if (pad.q) a.useSkill(0, G);
        if (pad.e) a.useSkill(1, G);
        if (pad.r) a.useSkill(2, G);
        if (pad.h1) switchTo(0); if (pad.h2) switchTo(1); if (pad.h3) switchTo(2);
        if (pad.swapNext) switchTo((G.heroes.indexOf(a) + 1) % 3);
        // right stick sets the aim point 12m out from the hero
        if (Math.abs(pad.ax) + Math.abs(pad.ay) > 0.05) {
          PAD.aimX = pad.ax; PAD.aimZ = pad.ay;
        }
        if (PAD.on && (Math.abs(PAD.aimX) + Math.abs(PAD.aimZ)) > 0.05) {
          const l = Math.hypot(PAD.aimX, PAD.aimZ) || 1;
          G.aimPoint.set(a.pos.x + (PAD.aimX / l) * 12, 0, a.pos.z + (PAD.aimZ / l) * 12);
          const sp = G.aimPoint.clone().project(camera);
          G.screenAim.x = (sp.x * 0.5 + 0.5) * innerWidth;
          G.screenAim.y = (-sp.y * 0.5 + 0.5) * innerHeight;
        }
      }
      // ---- player control ----
      const dir = new THREE.Vector3(
        (pad ? pad.mx : 0) + (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0),
        0,
        (pad ? pad.my : 0) + (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0)
      );
      if (dir.lengthSq() > 1) dir.normalize();
      if (pad && pad.fire) mouseDown = true;
      else if (pad && PAD.on && !pad.fire && !mouseHeld) mouseDown = false;
      if (dir.lengthSq() > 0) dir.normalize();
      if (!a.downed) {
        const want = angleTo(a.pos, G.aimPoint);
        a.facing += shortAngle(a.facing, want) * Math.min(1, dt * 16);
        a.aim.set(G.aimPoint.x - a.pos.x, 0, G.aimPoint.z - a.pos.z).normalize();
        a.move(dt, dir);
        if (mouseDown) a.tryAttack(G);
      } else a.move(dt, new THREE.Vector3());

      for (const h of G.heroes) {
        if (h !== a) h.updateAI(dt, G, a);
        h.update(dt, G);
      }

      // ---- waves ----
      if (G.waveActive) {
        G.spawnTimer -= dt;
        if (G.spawnQueue.length && G.spawnTimer <= 0 && G.enemies.length < G.maxAlive) {
          spawnEnemy(G.spawnQueue.pop());
          G.spawnTimer = rand(B.scaling.spawnGapMax, B.scaling.spawnGapMin);
        }
        if (!G.spawnQueue.length && G.enemies.every((e) => e.dead)) {
          G.waveActive = false;
          G.waveTimer = 4.5;
          SFX.play('waveClear');
          ui.banner('Wave Clear', '+' + (B.economy.waveBonus * G.wave));
          G.score += B.economy.waveBonus * G.wave;
          for (const h of G.heroes) if (h.downed) h.revive(0.6);
          G.waveTimer = 1e9;                      // held until the draft resolves
          setTimeout(() => { if (G.running && !G.waveActive) openDraft(); }, 1100);
        }
      } else {
        G.waveTimer -= dt;
        if (G.waveTimer <= 0) startWave(G.wave + 1);
      }

      // combo decay
      if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.combo = 1; }
      // ultimate chain window
      if (G.ultChainT > 0) {
        G.ultChainT -= dt;
        if (G.ultChainT <= 0) { G.ultChain = 0; G.ultMul = 1; }
      }
      updateGovernor(rawDt);
      updateOcclusion(dt);
      updateHazards(dt);
      if (G.tut && G.tut.active) {
        G.tut.travel += Math.hypot(G.active.vel.x, G.active.vel.z) * dt;
        updateTutorial(dt);
      }
      // pickups
      for (let i = G.pickups.length - 1; i >= 0; i--) {
        if (!G.pickups[i].update(dt, G)) G.pickups.splice(i, 1);
      }
    }

    // ---- pooled lights ----
    // Hand the nearest few enemies and pickups a light. Bosses and Charge Cores
    // always win a slot; the pool size is the hard ceiling.
    const lightFocus = G.active ? G.active.pos : null;
    lights.assignNearest('enemy', G.enemies, lightFocus, ENEMY_LIGHT_BIAS);
    lights.assignNearest('pickup', G.pickups, lightFocus, PICKUP_LIGHT_BIAS);

    // ---- entities ----
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const e = G.enemies[i];
      if (e.dead) {
        G.enemies.splice(i, 1);
        const pool = G.enemyPool[e.type] || (G.enemyPool[e.type] = []);
        if (pool.length < 24) pool.push(e);
        else e.disposeMeshes();
        continue;
      }
      e.update(dt, G);
    }
    G.projectiles.update(dt);
    for (let i = G.effects.length - 1; i >= 0; i--) {
      if (!G.effects[i].update(dt)) G.effects.splice(i, 1);
    }

    fx.update(dt);
    world.update(dt, G.time, G.active ? G.active.pos : new THREE.Vector3());
    updateCamera(dt);

    G.damageVignette = Math.max(0, G.damageVignette - dt * 3.0);
    grade.uniforms.uTime.value = G.time;
    grade.uniforms.uFlash.value = fx.flash;
    grade.uniforms.uFlashCol.value.copy(fx.flashColor);
    grade.uniforms.uDmg.value = G.damageVignette * 0.7;
    bloom.strength = 0.62 + fx.flash * 0.5;

    if (G.running) ui.update(G);
    ui.updatePops(dt);
  }

  renderer.info.reset();
  if (window.__noPost) renderer.render(scene, camera); else composer.render();
  G.renderCalls = renderer.info.render.calls;
  G.renderTris = renderer.info.render.triangles;
}
requestAnimationFrame(frame);

// expose for debugging
window.G = G;
G.EnemyClass = Enemy;   // test hook
window.SFX = SFX;
window.__passes = { bloom, grade, composer };
