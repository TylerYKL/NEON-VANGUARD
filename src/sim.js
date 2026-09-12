import * as THREE from 'three';
import { FX } from './fx.js';
import { MOD_DEFAULTS } from './upgrades.js';
import { ProjectileSystem } from './entities.js';
import { addMat, clamp, flatDist } from './util.js';

/* ============================================================
   CAST SIM — the Hero Studio's test bench.

   An uploaded effect is 90% of the picture, but a skill effect is only
   judged in the middle of a CAST: the leap, the impact timing, the rings
   and particles the ability already owns, the shake, the knockback it has
   to read against. `▶ play` in the panel fires one pooled prop; this runs
   the *real* `Hero.useSkill(i, G)` against a small stand-in arena so the
   effect is seen exactly where it will live.

   It is deliberately not a game: no waves, no scoring, no player control.
   The only thing it promises is that every hook an ability touches behaves
   the way the match's does, so nothing in `heroes.js` needs a special case
   to run here. The surface it installs is short and it is all of it:

     G.enemies      the training dummies (see TARGET FIELDS below)
     G.barriers     plain array — BASTION FIELD pushes/splices into it
     G.mods         MOD_DEFAULTS, so `1 - mods.cdr` maths is the real maths
     G.fx           a real FX instance (particles / rings / shake / flash)
     G.projectiles  a real ProjectileSystem, made on first use (NYX)
     G.damageEnemy  hp + knockback + a hit ring; no scoring, no death
     G.popText      counted, not drawn
     G.groundAim    a point `range` ahead of the hero's facing
     G.world        { arenaPulse: no-op } — the deck shader is not in this page
     G.panOf        camera-relative audio pan, same formula as the game
     G.announceSkill/G.onUltCast  routed to the caller so the panel can caption

   TARGET FIELDS: the nine abilities read only `dead pos radius stun pull
   slow slowPow center()` on an enemy, so that is what a dummy is — plus the
   `hp` the sim's own damage hook uses. Anything more would mean the sim is
   faking a system instead of standing in for one, which is the failure mode
   this file has to avoid.

   Slow motion is NOT here on purpose: the studio scales `dt` once, before the
   hero, the effects and this all read it, so the whole page slows together and
   nothing about timing is simulated twice.
   ============================================================ */

export const SIM_TARGETS = [0, 3, 6, 9, 12];
export const SIM_SPEEDS = [1, 0.5, 0.25];     // the studio scales dt; this is just the menu
const DUMMY_H = 1.7, DUMMY_R = 0.5;
/** what the CAST SIM's MOVE row offers; `idle` is the only one that leaves the hero alone */
export const SIM_MOVE = ['idle', 'walk', 'strafe', 'circle', 'wasd'];

/** Build the bench. `opts` is the seam to the page: everything UI-ish is a callback. */
export function createSim(G, opts = {}) {
  const hero = opts.hero;                       // () => Hero under test
  const allies = opts.allies || (() => [hero()]);
  const live = opts.effects || (() => G.__simEffects);
  const onCaption = opts.caption || (() => {});
  const onAnnounce = opts.announce || (() => {});
  const onFault = opts.fault || (() => {});

  const scene = G.scene;
  const scratch = new THREE.Vector3();
  const moveDir = new THREE.Vector3();        // the bench's stand-in for the player's input
  const sim = {
    on: false, speed: 1, targets: [], pool: [], n: 3, faults: 0,
    stats: { casts: 0, blocked: 0, forced: 0, hits: 0, parts: 0, dmg: 0, since: 0, last: '—', impact: -1, slot: '', name: '' },
    fx: null, projectiles: null, hooks: null,
    keys: new Set(),
  };
  // The studio runs in a browser, while the integration suite supplies a
  // deliberately minimal window stub. Keyboard input is optional in either
  // environment and must not make the headless bench fail to install.
  const keyboard = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
    ? window : null;

  /* ---------- the stand-in arena ---------- */
  function ensureFX() {
    if (!G.fx) { G.fx = new FX(scene, G.camera); G.fx.pMul = 1; }
    if (!G.world) G.world = { arenaPulse: () => {} };       // deck shader: not in this page
    return G.fx;
  }
  /* Cached in a local, not on G: G.projectiles is a *getter* (below), and reading
     it back here would recurse. */
  let proj = null;
  function ensureProjectiles() {
    if (!proj) proj = new ProjectileSystem(scene, G);
    return proj;
  }

  function makeDummy() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(DUMMY_R, DUMMY_R * 0.8, DUMMY_H, 8, 1), addMat(0x35516b, 0.92));
    body.position.y = DUMMY_H / 2;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.42), addMat(0x18e0ff, 0.9));
    head.position.y = DUMMY_H + 0.14;
    g.add(body, head);
    g.visible = false;
    scene.add(g);
    return {
      mesh: g, body, head, pos: new THREE.Vector3(), home: new THREE.Vector3(),
      radius: DUMMY_R, hp: 300, maxHp: 300, dead: false, stun: 0, slow: 0, slowPow: 0,
      pull: new THREE.Vector3(), tilt: 0, hit: 0,
      // same shape as the real Enemy.center(): a fresh vector, no shared scratch to
      // hand back to code that keeps it
      center() { return new THREE.Vector3(this.pos.x, 0.85, this.pos.z); },
    };
  }

  function place(n) {
    const h = hero();
    for (let i = 0; i < sim.targets.length; i++) { sim.targets[i].mesh.visible = false; sim.pool.push(sim.targets[i]); }
    sim.targets.length = 0;
    for (let i = 0; i < n; i++) {
      const d = sim.pool.pop() || sim.makeFresh();
      const a = ((i + 0.5) / n) * Math.PI * 0.9 - Math.PI * 0.45 + (h.facing || 0);
      const r = 5.5 + (i % 3) * 1.6;
      d.pos.set(h.pos.x + Math.sin(a) * r, 0, h.pos.z + Math.cos(a) * r);
      d.home.copy(d.pos);
      d.hp = d.maxHp; d.dead = false; d.stun = 0; d.slow = 0; d.pull.set(0, 0, 0);
      d.tilt = 0; d.hit = 0;
      d.mesh.position.copy(d.pos);
      d.mesh.rotation.set(0, 0, 0);
      d.mesh.scale.setScalar(1);
      d.mesh.visible = true;
      sim.targets.push(d);
    }
    sim.n = n;
  }
  sim.makeFresh = () => { const d = makeDummy(); return d; };

   /* ---------- WASD input ----------
     Only live while the bench is on AND the MOVE row is set to 'wasd', so a
     user typing in a lil-gui number field never moves the hero. The listener
     is bound on install and removed on uninstall — the page must not carry a
     global key handler when the sim is closed. */
  function onWasdDown(e) {
    if (!sim.on || sim.mmode !== 'wasd') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
      sim.keys.add(e.code);
    }
  }
  function onWasdUp(e) {
    sim.keys.delete(e.code);
  }
  function onWasdBlur() {
    sim.keys.clear();
  }

  /* ---------- the hooks the real ability code expects ---------- */
  function install() {
    if (sim.hooks) return;
    ensureFX();
    const h0 = hero();
    const prev = {};
    const set = (k, v) => { prev[k] = G[k]; G[k] = v; };
    // FX.alive is vestigial in fx.js (set once, never maintained), so the bench
    // counts spawns itself — the only way to tell "this cast emitted particles"
    // without scanning MAX_P every frame.
    if (G.fx && !G.fx.__simCount) {
      sim.spawn0 = G.fx.spawn.bind(G.fx);
      const inner = sim.spawn0;
      G.fx.spawn = (o) => { sim.stats.parts++; return inner(o); };
      G.fx.__simCount = true;
      sim.restoreSpawn = () => { G.fx.spawn = inner; G.fx.__simCount = false; };
    }
    sim.stats.dmg = 0; sim.stats.hits = 0;
    set('enemies', sim.targets);
    set('heroes', allies());
    set('barriers', []);
    set('mods', Object.assign({}, MOD_DEFAULTS));
    // lazy on first read: 160 pooled groups is not a price for a page that may
    // never fire a projectile (only NYX's swarm / railshot do)
    Object.defineProperty(G, 'projectiles', {
      configurable: true,
      get() { return ensureProjectiles(); },
      set(v) { G.__projOverride = v; },
    });
    set('panOf', (p) => clamp((p.x - (G.camera ? G.camera.position.x : 0)) / 24, -1, 1));
    set('groundAim', (h, range) => new THREE.Vector3(
      h.pos.x + Math.sin(h.facing) * range * 0.7, 0, h.pos.z + Math.cos(h.facing) * range * 0.7));
    set('popText', () => { sim.stats.pops = (sim.stats.pops || 0) + 1; });
    set('damageEnemy', (e, dmg, from, o = {}) => {
      if (!e || e.dead) return 0;
      const amt = Number.isFinite(dmg) ? dmg : 0;
      e.hp = Math.max(0, e.hp - amt);        // floors at 0; it never dies — see below
      e.hit = 1;
      sim.stats.hits++; sim.stats.dmg += amt;
      if (o.knock) {
        scratch.subVectors(e.pos, from || e.pos); scratch.y = 0;
        const l = scratch.length() || 1;
        e.pull.addScaledVector(scratch.divideScalar(l), o.knock);
        e.tilt = Math.min(0.5, o.knock / 40);
      }
      if (G.fx && e.pos) G.fx.ring(e.pos, 0xffe0a0, { r0: 0.2, r1: 1.5, dur: 0.35 });
      return amt;
    });
    set('nearestEnemy', (pos, range = 40) => {
      let best = null, bd = range;
      for (const e of sim.targets) {
        if (e.dead) continue;
        const d = flatDist(e.pos, pos);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    });
    // same rule as main.js: a live barrier within its radius eats the hit
    set('absorbedByBarrier', (pos) => {
      for (const b of G.barriers || []) if (b.active && flatDist(pos, b.pos) < b.r) return true;
      return false;
    });
    /* G.aimEnemy / G.explode below are *copies* of main.js:656 / main.js:241, not
       approximations — if those change there, the bench must change here, or the
       sim starts telling artists something the match does not do. */
    set('aimEnemy', (h, range, tol) => {
      let best = null, bs = -1;
      const fx0 = Math.sin(h.facing), fz0 = Math.cos(h.facing);
      for (const e of sim.targets) {
        if (e.dead) continue;
        const dx = e.pos.x - h.pos.x, dz = e.pos.z - h.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > range) continue;
        const dot = (fx0 * dx + fz0 * dz) / (d || 1);
        if (dot < tol) continue;
        const sc = dot * 2 - d / range;
        if (sc > bs) { bs = sc; best = e; }
      }
      return best;
    });
    // same shape as main.js's G.explode, so an AoE projectile behaves here as it
    // does in a match: damage in radius, ring, burst, sparks
    set('explode', (pos, radius, dmg, color, source) => {
      for (const e of sim.targets) {
        if (e.dead) continue;
        const d = flatDist(e.pos, pos);
        if (d < radius + e.radius) G.damageEnemy(e, dmg * (1 - d / (radius * 1.5)), pos, { knock: 5, source });
      }
      if (G.fx) {
        G.fx.ring(pos, color, { r0: 0.3, r1: radius * 1.2, dur: 0.35 });
        G.fx.burst(pos, color, 24, { speed: 12, life: 0.45, size: 0.45 });
        G.fx.sparkBurst(pos, color, 8, 16);
      }
    });
    /* Hero.update and move reach two more members of the page's context; without these
       the bench would be exercising a crippled hero instead of the shipped one. */
    set('resolveObstacles', (p) => p);                  // this arena has no props to avoid
    if (!G.ui) set('ui', { feed() {} });                 // addEnergy() feeds the HUD at 100
    // the page's hero is the one thing the bench is allowed to MOVE, so remember how it
    // was standing and put it back exactly (on reset, and on uninstall)
    if (h0) sim.home = { x: h0.pos.x, y: h0.pos.y, z: h0.pos.z, facing: h0.facing || 0 };
    sim.mmode = 'idle'; sim.dist = 0;
    set('announceSkill', (h, sk) => { sim.stats.last = sk.name; onAnnounce(h, sk); });
    set('onUltCast', () => { sim.stats.ult = (sim.stats.ult || 0) + 1; });
    if (keyboard) {
      keyboard.addEventListener('keydown', onWasdDown);
      keyboard.addEventListener('keyup', onWasdUp);
      keyboard.addEventListener('blur', onWasdBlur);
      sim._wasdBound = true;
    }
    sim.hooks = { prev, set };
    sim.on = true;
    place(sim.n);
  }

  function uninstall() {
    if (!sim.hooks) return;
    for (const k in sim.hooks.prev) G[k] = sim.hooks.prev[k];
    if (Object.getOwnPropertyDescriptor(G, 'projectiles')?.get) delete G.projectiles;
    if (sim.restoreSpawn) { sim.restoreSpawn(); sim.restoreSpawn = null; }
    if (sim._wasdBound) {
      keyboard.removeEventListener('keydown', onWasdDown);
      keyboard.removeEventListener('keyup', onWasdUp);
      keyboard.removeEventListener('blur', onWasdBlur);
      sim._wasdBound = false;
      sim.keys.clear();
    }
    sim.hooks = null;
    sim.on = false;                       // cast() is inert once the hooks are gone
    sim.mmode = 'idle';
    walkHome();
    place(0);
  }

  /* ---------- casts ---------- */
  sim.cast = (i, force = true) => {
    const h = hero();
    if (!h) return false;
    if (!sim.on) install();
    const sk = h.def.skills[i];
    if (!sk) return false;
    /* measure the gate BEFORE forcing clears it — that is the whole story of the caption */
    const gated = sk.ult ? h.energy < h.maxEnergy : h.cds[i] > 0;
    if (force) {
      if (sk.ult) { h.energy = h.maxEnergy; h.ultMul = 1; }
      else h.cds[i] = 0;
    }
    const before = sim.stats.casts;
    const blocked = gated && !force;        // forcing exists precisely to step over the gate
    /* Forcing is the point of a bench, but it must not be SILENT: `2 forced` in the caption
       tells you the match would still have been waiting on that cooldown. */
    if (force && gated) sim.stats.forced = (sim.stats.forced || 0) + 1;
    sim.stats.slot = sk.key || ('Q' + i);
    h.useSkill(i, G);
    if (blocked) {
      /* a blocked cast used to say "cd 0.0s" even when the ult meter was the gate, which read
         as a bug in the bench. Say which gate stopped it, and how far from open that gate is. */
      sim.stats.blocked++;
      sim.stats.last = sk.ult
        ? sk.name + ' · BLOCKED — ULT ENERGY ' + Math.round(h.energy) + '/' + h.maxEnergy
        : sk.name + ' · BLOCKED (cd ' + h.cds[i].toFixed(1) + 's)';
    }
    else {
      /* counters belong to THIS cast: the slam's 136 damage must not be read as the dome's,
         which is exactly what happened when they only ever accumulated */
      sim.stats.casts++; sim.stats.since = 0; sim.stats.impact = -1;
      sim.stats.hits = 0; sim.stats.dmg = 0; sim.stats.parts = 0;
      sim.stats.name = sk.name; sim.stats.last = sk.name;
    }
    return !blocked && sim.stats.casts > before;
  };
  sim.basic = (force = true) => {
    const h = hero();
    if (!h) return false;
    if (!sim.on) install();
    if (force) h.attackCd = 0;                 // tryAttack gates on it, like the match
    const before = sim.stats.casts;
    h.tryAttack(G);
    sim.stats.slot = 'basic';
    if (force && h.attackCd > 0) sim.stats.forced = (sim.stats.forced || 0) + 1;
    if (h.attackCd > 0) {
      sim.stats.casts++; sim.stats.last = h.def.basic.name; sim.stats.name = h.def.basic.name;
      sim.stats.since = 0; sim.stats.impact = -1; sim.stats.hits = 0; sim.stats.dmg = 0; sim.stats.parts = 0;
    }
    else { sim.stats.blocked++; sim.stats.last = (h.def.basic.name || 'BASIC') + ' · BLOCKED (atk cd ' + h.attackCd.toFixed(2) + 's)'; }
    return sim.stats.casts > before;
  };

  /* ---------- per-frame ---------- */
  /** One tick of the bench. The caller keeps ticking ITS effect list (previews,
      ability coroutines…) — this must not touch it, or everything would advance
      twice per frame and the sim would run at 2× while looking correct. */
  sim.update = (dt) => {
    if (!sim.on) return;
    const fx = G.fx;
    const h = hero();
    /* One owner per transform (HANDOFF invariants 16–17). Hero.update decays the four
       animation envelopes AND every cooldown, ticks buffs, `comboT` (the reason a match
       resets an idle combo) and the weapon flourishes. Decaying any of those here as well
       would run the page at 2×, so the bench supplies *input* and the hero keeps its own
       clocks — which is also what makes the slam's leap and a dash actually travel here. */
     if (h) {
      moveDir.set(0, 0, 0);
      if (sim.mmode === 'walk') moveDir.set(Math.sin(h.facing), 0, Math.cos(h.facing));
      else if (sim.mmode === 'strafe') moveDir.set(Math.cos(h.facing), 0, -Math.sin(h.facing));
      else if (sim.mmode === 'circle') {
        h.facing += dt * 0.8;                       // keeps a walking hero inside the arena
        moveDir.set(Math.sin(h.facing), 0, Math.cos(h.facing));
      } else if (sim.mmode === 'wasd') {
        /* Camera-relative: W is always "up the screen". The forward axis is the
           horizontal vector from the camera to the hero; the right axis is that
           vector rotated -90° about +Y. Works for any camera the page has — a
           fixed top-down, an orbit, a follow cam — without reading its type. */
        const ix = (sim.keys.has('KeyD') ? 1 : 0) - (sim.keys.has('KeyA') ? 1 : 0);
        const iz = (sim.keys.has('KeyW') ? 1 : 0) - (sim.keys.has('KeyS') ? 1 : 0);
        if (ix || iz) {
          const cam = G.camera;
          if (cam) {
            const dx = h.pos.x - cam.position.x;
            const dz = h.pos.z - cam.position.z;
            const len = Math.hypot(dx, dz) || 1;
            const fx = dx / len, fz = dz / len;    // forward (screen up)
            const rx = -fz, rz = fx;               // right   (screen right)
            moveDir.set(fx * iz + rx * ix, 0, fz * iz + rz * ix);
          } else {
            moveDir.set(ix, 0, iz);                // no camera: world axes
          }
          if (moveDir.lengthSq() > 1) moveDir.normalize();
          if (!h.downed) h.facing = Math.atan2(moveDir.x, moveDir.z);
        }
      }
      h.move(dt, moveDir);
      h.update(dt, G);                              // main.js's order: move, then update
      if (sim.lastX !== undefined) {
        sim.dist += Math.hypot(h.pos.x - sim.lastX, h.pos.z - sim.lastZ);
      }
      sim.lastX = h.pos.x; sim.lastZ = h.pos.z;
    }
    if (fx) fx.update(dt);
    if (G.projectiles && G.projectiles.update) G.projectiles.update(dt);
    for (let i = 0; i < sim.targets.length; i++) {
      const d = sim.targets[i];
      d.stun = Math.max(0, d.stun - dt);
      d.slow = Math.max(0, d.slow - dt);
      d.hit = Math.max(0, d.hit - dt * 3.2);
      // knockback integrates, then the dummy walks home — a bench you cannot reset
      // by waiting is a bench you stop using
      scratch.copy(d.pull).multiplyScalar(dt * 0.35);
      d.pos.add(scratch);
      d.pull.multiplyScalar(Math.exp(-6 * dt));
      if (d.pull.lengthSq() < 1e-4) d.pull.set(0, 0, 0);
      const back = scratch.subVectors(d.home, d.pos); back.y = 0;
      if (d.pull.lengthSq() < 0.04 && back.lengthSq() > 1e-4) d.pos.addScaledVector(back.normalize(), Math.min(1, dt * 2.4));
      d.mesh.position.copy(d.pos);
      const lean = d.tilt * Math.min(1, d.stun * 2 + d.hit);
      d.tilt = Math.max(0, d.tilt - dt * 1.2);
      d.mesh.rotation.z = lean;
      const flash = Math.min(1, d.hit);
      d.body.material.color.setRGB(0.208 + flash * 0.79, 0.317 + flash * 0.68, 0.42 + flash * 0.58);
      d.head.material.color.setRGB(0.09 + flash * 0.9, 0.878, 1);
      d.body.material.opacity = 0.92 - flash * 0.1;
      // A bench target must survive the session: real enemies die, and every
      // ability skips `dead` ones, so dying here would silently empty the arena
      // mid-tuning. hp floors at 0 for the readout; `dead` stays false.
      if (d.hp <= 0 && d.hp !== -1) d.hp = 0;
    }
    sim.stats.since += dt;
    /* The bench refills the ult meter once a cast has had its moment (1.2 s), so `R` and
       `⟳ auto` are loopable with no waves behind them. The gate is still real on the press
       itself — `cast(i, false)` against a cold meter is BLOCKED, which simtest checks. */
    if (h && sim.stats.since > 1.2 && !h.downed) h.energy = h.maxEnergy;
    // impact time = the first frame the ability's own particles show up
    if (sim.stats.impact < 0 && fx && (sim.stats.parts > 0 || fx.rings.length || fx.beams.length)) sim.stats.impact = sim.stats.since;

    guard();
  };

  /* NaN is the one fault that costs a whole page: a non-finite position reaching
     the bloom chain blacks out the frame (HANDOFF §4.8). On the bench, where a
     hand-edited file and hand-written JSON meet, check every frame and say so. */
  function guard() {
    const h = hero();
    const bad = (v) => !Number.isFinite(v);
    let f = 0;
    if (h && (bad(h.pos.x) || bad(h.pos.y) || bad(h.pos.z))) f++;
    for (const d of sim.targets) if (bad(d.pos.x) || bad(d.pos.z) || bad(d.hp)) f++;
    if (G.barriers) for (const b of G.barriers) if (b && b.pos && bad(b.pos.x)) f++;
    if (f && !sim.faulted) {
      sim.faulted = true; sim.faults++;
      onFault('SIM FAULT: non-finite transform — a tuning value is poisoned. Reset placement / check the JSON.');
    } else if (!f) sim.faulted = false;
  }

  sim.setTargets = (n) => { if (sim.on) place(n); else sim.n = n; };
  sim.setMove = (m) => {
    sim.mmode = SIM_MOVE.includes(m) ? m : 'idle';
    sim.keys.clear();                              // ← 新增：切模式时不残留按键
    if (sim.mmode === 'idle') { const hh = hero(); if (hh && hh.vel) hh.vel.set(0, 0, 0); }
  };
  /** The dodge is the one piece of movement with its own FX set — afterimages, a ring, a
      beam — and until now the only way to see it was to survive a wave. */
  sim.dash = (force) => {
    const h = hero();
    if (!sim.on || !h || h.downed) return false;
    if (h.dashCd > 0 && !force) {
      sim.stats.blocked++;
      sim.stats.last = 'DASH · BLOCKED (cd ' + h.dashCd.toFixed(1) + 's)';
      sim.tickCaption();                     // the page styles its own caption (warn/bad)
      return false;
    }
    if (force) h.dashCd = 0.01;
    sim.stats.since = 0; sim.stats.impact = -1;
    sim.stats.hits = 0; sim.stats.dmg = 0; sim.stats.parts = 0;
    sim.stats.slot = 'dash'; sim.stats.last = 'DASH'; sim.stats.name = 'DASH';
    h.dash();
    sim.tickCaption();
    return true;
  };
  /** the bench is off, but the particles it made must not hang in the frame */
  sim.setFXVisible = (v) => { if (G.fx) { G.fx.points.visible = v; if (!v && G.fx.pObj) G.fx.pObj.visible = false; } };
  sim.reset = () => {
    const list = live();
    if (list) { for (const e of list) if (e.dispose) e.dispose(); list.length = 0; }
    if (G.fx) { for (const r of G.fx.rings) { r.m.visible = false; G.fx.ringPool.push(r.m); } G.fx.rings.length = 0; }
    if (G.barriers) { for (const b of G.barriers) b.active = false; G.barriers.length = 0; }
    place(sim.n);
    walkHome();
    sim.stats.impact = -1; sim.stats.since = 0; sim.dist = 0;
    sim.stats.blocked = sim.stats.hits = 0; sim.stats.dmg = 0; sim.stats.forced = 0;
  };
  /* The bench moves the page's own hero. Leaving it wherever the last circle ended — or
     still sliding, because velocity survived — is how a tool gets distrusted. */
  function walkHome() {
    const hh = hero();
    if (!hh || !sim.home) return;
    hh.pos.set(sim.home.x, sim.home.y, sim.home.z);
    if (hh.vel) hh.vel.set(0, 0, 0);
    hh.facing = sim.home.facing;
    if (hh.group) hh.group.position.set(hh.pos.x, hh.pos.y, hh.pos.z);
    sim.dist = 0; sim.lastX = sim.lastZ = undefined;
  }

  sim.dispose = uninstall;

  /* fx.js keeps no live-particle counter, so scan the life buffer — ONLY here, on
     demand (the caption tick), never per frame: MAX_P is a few thousand slots. */
  sim.liveParticles = () => {
    const fx = G.fx;
    if (!fx || !fx.life) return 0;
    let n = 0;
    for (let i = 0, L = fx.life; i < L.length; i++) if (L[i] > 0) n++;
    return n;
  };

  /* One line, and every number in it is measured, not remembered. `in flight` is the page's own
     effect count (0 once the cast has unwound) and `fx@0.25s` is the delay
     between the press and the first frame the ability's own particles existed — the single
     most useful thing when you are deciding where your prop should land. */
  sim.readout = () => {
    const fx = G.fx;
    const st = sim.stats;
    const h = hero();
    return ((st.slot ? st.slot + ' · ' : '') + (st.last || '—') +
      ' · ' + sim.targets.length + ' target' + (sim.targets.length === 1 ? '' : 's') +
      ' · ' + st.hits + ' hit' + (st.hits === 1 ? '' : 's') + ' for ' + Math.round(st.dmg) +
      ' · fx ' + (fx ? sim.liveParticles() + 'p live/' + (sim.stats.parts || 0) + ' spawned/' + fx.rings.length + 'r/' + fx.beams.length + 'b' : 'off') +
      ' · in flight ' + (live() ? live().length : 0) +
      (st.impact >= 0 ? ' · fx@' + st.impact.toFixed(2) + 's' : ' · no fx yet') +
      (st.blocked ? ' · ' + st.blocked + ' blocked' : '') +
      (st.forced ? ' · ' + st.forced + ' forced' : '') +
      (h && sim.mmode !== 'idle'
        ? ' · ' + sim.mmode + (sim.dist > 0.5 ? ' ' + sim.dist.toFixed(1) + 'm' : '') : '') +
      (h && h.dashCd > 0.05 ? ' · dash ' + h.dashCd.toFixed(1) + 's' : '') +
      (sim.speed !== 1 ? ' · ' + (sim.speed === 0.5 ? '½' : sim.speed === 0.25 ? '¼' : sim.speed) + '×' : ''));
  };
  sim.tickCaption = () => onCaption(sim.readout());

  /** camera shake for the page to apply around its render (same source the game
      uses: fx.shake, so the bench and the match shake identically) */
  sim.shake = new THREE.Vector3();
  sim.applyShake = (camera) => {
    const fx = G.fx;
    sim.shake.set(0, 0, 0);
    if (!fx || !fx.shake || !camera) return null;
    const s = fx.shake * 0.35;
    sim.shake.set(Math.sin(fx.time * 61) * s, Math.cos(fx.time * 47) * s * 0.6, Math.sin(fx.time * 83) * s * 0.5);
    camera.position.add(sim.shake);
    return sim.shake;
  };
  sim.clearShake = (camera) => { if (sim.shake.lengthSq()) camera.position.sub(sim.shake); sim.shake.set(0, 0, 0); };
  sim.flash = () => (G.fx ? Math.min(1, G.fx.flash) : 0);

  return sim;
}
