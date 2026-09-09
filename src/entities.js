import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { metalMat, addMat, TAU, rand, clamp, damp, flatDist, angleTo, shortAngle } from './util.js';
import { ARENA } from './world.js';
import { SFX } from './audio.js';

const HOSTILE = 0xff2b4a;
const HOSTILE2 = 0xff7a1f;

/* ============================================================
   PROJECTILES (pooled)
   ============================================================ */
export class ProjectileSystem {
  constructor(scene, G) {
    this.G = G;
    this.scene = scene;
    this.list = [];
    this.pool = [];
    const geoCore = new THREE.SphereGeometry(1, 8, 8);
    const geoTrail = new THREE.CylinderGeometry(0.35, 1, 1, 6, 1, true);
    geoTrail.translate(0, -0.5, 0);
    geoTrail.rotateX(Math.PI / 2);
    for (let i = 0; i < 160; i++) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(geoCore, addMat(0xffffff, 1));
      const trail = new THREE.Mesh(geoTrail, addMat(0xffffff, 0.3));
      g.add(core); g.add(trail);
      g.visible = false;
      scene.add(g);
      this.pool.push({ g, core, trail, light: null });
    }
  }

  fire(o) {
    const v = this.pool.pop();
    if (!v) return null;
    v.g.visible = true;
    v.core.material.color.set(o.color);
    v.trail.material.color.set(o.color);
    const s = o.size ?? 0.24;
    v.core.scale.setScalar(s);
    v.trail.scale.set(s * 0.95, s * 0.95, (o.trail ?? 2.2));
    const p = {
      v, pos: o.pos.clone(), dir: o.dir.clone().normalize(), speed: o.speed ?? 40,
      dmg: o.dmg ?? 10, life: o.life ?? 2.2, t: 0, hostile: !!o.hostile,
      color: new THREE.Color(o.color), pierce: o.pierce ?? 0, homing: o.homing ?? 0,
      target: o.target ?? null, radius: o.radius ?? 0.5, onHit: o.onHit ?? null,
      chain: o.chain ?? 0, spiral: o.spiral ?? 0, phase: Math.random() * TAU,
      hitSet: new Set(), aoe: o.aoe ?? 0, knock: o.knock ?? 0, size: s,
      grav: o.grav ?? 0, spawnDelay: o.spawnDelay ?? 0,
    };
    this.list.push(p);
    return p;
  }

  update(dt) {
    const G = this.G;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.spawnDelay > 0) { p.spawnDelay -= dt; p.v.g.visible = false; continue; }
      p.v.g.visible = true;
      p.t += dt;

      // homing
      if (p.homing > 0) {
        if (!p.target || p.target.dead) p.target = G.nearestEnemy(p.pos, 40);
        if (p.target) {
          const tp = p.target.pos;
          const d = new THREE.Vector3(tp.x - p.pos.x, (tp.y + 0.9) - p.pos.y, tp.z - p.pos.z).normalize();
          p.dir.lerp(d, clamp(p.homing * dt, 0, 1)).normalize();
        }
      }
      if (p.spiral > 0) {
        p.phase += dt * 14;
        const up = new THREE.Vector3(0, 1, 0);
        const side = new THREE.Vector3().crossVectors(p.dir, up).normalize();
        const upv = new THREE.Vector3().crossVectors(side, p.dir).normalize();
        p.pos.addScaledVector(side, Math.cos(p.phase) * p.spiral * dt);
        p.pos.addScaledVector(upv, Math.sin(p.phase) * p.spiral * dt);
      }
      if (p.grav) p.dir.y -= p.grav * dt * 0.02;

      p.pos.addScaledVector(p.dir, p.speed * dt);
      p.v.g.position.copy(p.pos);
      p.v.g.lookAt(p.pos.clone().add(p.dir));
      const flick = 0.85 + 0.15 * Math.sin(p.t * 60);
      p.v.core.scale.setScalar(p.size * flick * 1.05);

      // trail particles
      if (Math.random() < 0.55) {
        G.fx.spawn({
          x: p.pos.x, y: p.pos.y, z: p.pos.z,
          vx: rand(1.4, -1.4), vy: rand(1.2, -0.4), vz: rand(1.4, -1.4),
          color: p.color, life: rand(0.32, 0.14), size: p.size * rand(2.2, 1.1), drag: 4, grav: 0,
        });
      }

      let hit = false;
      if (p.hostile) {
        for (const h of G.heroes) {
          if (h.dead) continue;
          const d = p.pos.distanceTo(h.center());
          if (d < p.radius + 0.7) {
            if (G.absorbedByBarrier(p.pos)) { hit = true; break; }
            h.takeDamage(p.dmg, p.pos);
            hit = true; break;
          }
        }
        if (!hit && G.barrierBlocks(p.pos, p.radius)) hit = true;
      } else {
        for (const e of G.enemies) {
          if (e.dead || p.hitSet.has(e.id)) continue;
          const d = p.pos.distanceTo(e.center());
          if (d < p.radius + e.radius) {
            p.hitSet.add(e.id);
            G.damageEnemy(e, p.dmg, p.pos, { knock: p.knock, source: p.owner });
            if (p.chain > 0) G.chainLightning(e, p.chain, p.dmg * 0.5, p.color, p.owner);
            if (p.aoe > 0) G.explode(p.pos, p.aoe, p.dmg * 0.7, p.color, p.owner);
            hit = p.pierce-- <= 0;
            if (p.onHit) p.onHit(e, p);
            if (hit) break;
          }
        }
      }

      if (p.pos.y < 0.1) { hit = true; p.pos.y = 0.1; }
      if (Math.abs(p.pos.x) > ARENA + 2 || Math.abs(p.pos.z) > ARENA + 2) hit = true;

      if (hit || p.t > p.life) {
        if (hit) {
          G.fx.burst(p.pos, p.color, 10, { speed: 7, life: 0.3, size: p.size * 2.2, grav: -4 });
          G.fx.sparkBurst(p.pos, p.color, 5, 10);
          G.fx.ring(p.pos, p.color, { r0: 0.2, r1: 1.6, dur: 0.25, y: 0.05 });
        }
        p.v.g.visible = false;
        this.pool.push(p.v);
        this.list.splice(i, 1);
      }
    }
  }
}

/* ============================================================
   ENEMIES
   ============================================================ */
let ENEMY_ID = 1;
const SHARED_MATS = {};

/** Collapse every static child that shares one of `mats` into a single mesh per
    material. Anything flagged userData.animated (or a Group/Light) is left alone.
    Cuts a brute from 12 meshes to 6 with no visual change. */
function bakeStatics(group, mats) {
  const _m = new THREE.Matrix4();
  for (const mat of mats) {
    const victims = group.children.filter(
      (c) => c.isMesh && c.material === mat && !c.userData.animated
    );
    if (victims.length < 2) continue;
    // mergeGeometries needs every input in the same index state. Keep the index
    // when they already agree — de-indexing triples the vertex count.
    const allIndexed = victims.every((v) => v.geometry.index);
    const geos = [];
    for (const v of victims) {
      v.updateMatrix();
      const src = v.geometry;
      const gg = allIndexed ? src.clone() : (src.index ? src.toNonIndexed() : src.clone());
      gg.applyMatrix4(v.matrix);
      geos.push(gg);
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((x) => x.dispose());
    if (!merged) continue;
    for (const v of victims) { group.remove(v); v.geometry.dispose(); }
    group.add(new THREE.Mesh(merged, mat));
  }
}


export const ENEMY_TYPES = {
  skitter: {
    name: 'SKITTER DRONE', hp: 55, speed: 10.5, radius: 0.55, dmg: 9, range: 16, cd: 1.9, tell: 0.38, tellR: 1.6,
    score: 10, color: HOSTILE, fly: 1.5, ranged: true, xp: 6,
  },
  brute: {
    name: 'RIOT BRUTE', hp: 210, speed: 6.2, radius: 0.95, dmg: 22, range: 2.6, cd: 1.5, tell: 0.5, tellR: 2.7,
    score: 25, color: HOSTILE2, fly: 0, ranged: false, xp: 14,
  },
  sentinel: {
    name: 'ARC SENTINEL', hp: 130, speed: 3.4, radius: 0.8, dmg: 15, range: 22, cd: 2.6, tell: 0.55, tellR: 1.4, lane: true,
    score: 30, color: 0xff1cc4, fly: 2.2, ranged: true, burst: 3, xp: 16,
  },
  juggernaut: {
    name: 'ONI-CLASS JUGGERNAUT', hp: 2600, speed: 4.6, radius: 2.2, dmg: 38, range: 4.5, cd: 2.0, tell: 0.85, tellR: 5.5,
    score: 500, color: 0xff2b4a, fly: 0, ranged: false, boss: true, xp: 200,
  },
};

/* Elite prefixes: one system that multiplies variety without new art or new AI. */
export const ELITES = {
  shielded:    { name: 'SHIELDED',    color: 0x39c6ff, hp: 1.5, note: 'front arc absorbs 70%' },
  volatile:    { name: 'VOLATILE',    color: 0xffb14a, hp: 1.3, note: 'detonates on death' },
  swift:       { name: 'SWIFT',       color: 0x7cff5a, hp: 1.2, note: '+45% speed' },
  overclocked: { name: 'OVERCLOCKED', color: 0xff5ad0, hp: 1.4, note: 'fires twice as often' },
};
const ELITE_KEYS = Object.keys(ELITES);

export class Enemy {
  constructor(type, G) {
    this.G = G;
    this.id = ENEMY_ID++;
    this.type = type;
    const T = ENEMY_TYPES[type];
    this.T = T;
    this.maxHp = T.hp;
    this.hp = T.hp;
    this.radius = T.radius;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.dead = false;
    this.cd = rand(1.2, 0.2);
    this.stun = 0;
    this.slow = 0;
    this.slowPow = 0;
    this.hitFlash = 0;
    this.pull = new THREE.Vector3();
    this.spawnT = 0;
    this.attackAnim = 0;
    this.burstLeft = 0;
    this.mark = 0;
    // telegraph + elite state
    this.windup = 0;
    this.windupMax = 0;
    this.tell = null;
    this.tellAim = new THREE.Vector3();
    this.elite = null;
    this.speedMul = 1;
    this.cdMul = 1;
    this.dmgMul = 1;
    this.build();
  }

  /** re-arm a pooled instance instead of rebuilding its mesh tree */
  reset(G) {
    const T = this.T;
    this.G = G;
    this.id = ENEMY_ID++;
    this.dead = false;
    this.hp = this.maxHp = T.hp * (G.hpScale || 1);
    this.cd = rand(1.2, 0.2);
    this.stun = 0; this.slow = 0; this.slowPow = 0; this.hitFlash = 0; this.mark = 0;
    this.spawnT = 0; this.attackAnim = 0; this.burstLeft = 0;
    this.windup = 0; this.windupMax = 0;
    this.vel.set(0, 0, 0); this.pull.set(0, 0, 0);
    this.speedMul = 1; this.cdMul = 1; this.dmgMul = 1;
    this.light = null;            // re-assigned from G.lights if we earn one
    this.setElite(null);
    this.group.scale.setScalar(1);
    this.group.visible = true;
  }

  /** roll and apply an elite prefix (null clears) */
  setElite(kind) {
    this.elite = kind;
    if (this.crown) this.crown.visible = false;
    this.speedMul = 1; this.cdMul = 1;
    if (!kind) return;
    const E = ELITES[kind];
    this.maxHp = Math.round(this.maxHp * E.hp);
    this.hp = this.maxHp;
    if (kind === 'swift') this.speedMul = 1.45;
    if (kind === 'overclocked') this.cdMul = 0.55;
    if (!this.crown) {
      const c = new THREE.Group();
      const t = new THREE.Mesh(new THREE.TorusGeometry(this.radius * 1.15, 0.055, 6, 20), addMat(E.color, 0.9));
      t.rotation.x = Math.PI / 2;
      c.add(t);
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), addMat(E.color, 0.95));
        sp.position.set(Math.cos(i / 3 * TAU) * this.radius * 1.15, 0, Math.sin(i / 3 * TAU) * this.radius * 1.15);
        c.add(sp);
      }
      c.position.y = this.T.boss ? 3.2 : 1.25;
      this.crownRing = t;
      this.crown = c;
      this.group.add(c);
    }
    this.crown.visible = true;
    this.crown.traverse((o) => { if (o.material && o.material.color) o.material.color.set(E.color); });
  }

  /** scaled contact damage */
  dmg() { return this.T.dmg * (this.G.dmgScale || 1) * this.dmgMul; }

  /** shielded elites eat damage taken through their front arc */
  damageScale(fromPos) {
    if (this.elite !== 'shielded' || !fromPos) return 1;
    const a = Math.atan2(fromPos.x - this.pos.x, fromPos.z - this.pos.z);
    let d = a - this.facing;
    while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    return Math.abs(d) < 1.05 ? 0.3 : 1;
  }

  /** release GPU buffers — called when the pool is full or the run resets */
  disposeMeshes() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  /** repaint every emissive surface (colour-blind palette switch) */
  retint(c) {
    this.T.color = c;
    for (const m of this.glowMats) m.color.set(c);
    if (this.light) this.light.color.set(c);
    if (this.disc) this.disc.material.color.set(c);
    this.group.traverse((o) => {
      if (o.material && o.material.emissive) o.material.emissive.set(c);
    });
  }

  build() {
    const T = this.T;
    const g = new THREE.Group();
    this.group = g;
    // One shared material pair per enemy TYPE instead of per instance:
    // 45 live enemies used to mean ~270 material objects and as many shader
    // state changes. Never mutate these per-instance (retint touches them
    // deliberately, which is fine because it applies to the whole type).
    if (!SHARED_MATS[this.type]) {
      SHARED_MATS[this.type] = {
        dark: new THREE.MeshStandardMaterial({ color: 0x1a0a12, emissive: new THREE.Color(T.color), emissiveIntensity: 0.12, roughness: 0.45, metalness: 0.9 }),
        shell: new THREE.MeshStandardMaterial({ color: 0x2b0f1a, emissive: new THREE.Color(T.color), emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.9 }),
      };
    }
    const dark = SHARED_MATS[this.type].dark;
    const shell = SHARED_MATS[this.type].shell;
    this.glowMats = [];
    const glow = (c, o = 1) => { const m = addMat(c, o); this.glowMats.push(m); return m; };

    if (this.type === 'skitter') {
      // hull + 3 legs baked into one geometry: 4 draw calls -> 1
      const parts = [];
      const hullG = new THREE.OctahedronGeometry(0.5, 0);
      hullG.scale(1, 0.7, 1.25);
      parts.push(hullG);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), glow(T.color));
      eye.position.z = 0.42; g.add(eye);
      this.eye = eye;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 5, 18), glow(T.color, 0.8));
      ring.rotation.x = Math.PI / 2; g.add(ring);
      this.ring = ring;
      const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        const legG = new THREE.CapsuleGeometry(0.05, 0.4, 3, 6);
        _e.set(-Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5);
        _m.compose(new THREE.Vector3(Math.cos(a) * 0.32, -0.3, Math.sin(a) * 0.32), _q.setFromEuler(_e), _one);
        legG.applyMatrix4(_m);
        parts.push(legG);
      }
      // mergeGeometries needs a consistent index state across inputs
      const flat = parts.map((x) => (x.index ? x.toNonIndexed() : x));
      const body = new THREE.Mesh(mergeGeometries(flat, false), shell);
      g.add(body);
      parts.forEach((x) => x.dispose());
      flat.forEach((x) => { if (!parts.includes(x)) x.dispose(); });
    } else if (this.type === 'brute') {
      const torso = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.2, 0.9), shell);
      torso.position.y = 1.5; g.add(torso);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), dark);
      head.position.y = 2.3; g.add(head);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.06), glow(T.color));
      eye.position.set(0, 2.32, 0.26); g.add(eye);
      this.eye = eye;
      for (let s = -1; s <= 1; s += 2) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.8, 4, 8), dark);
        arm.position.set(s * 0.85, 1.35, 0); g.add(arm);
        const fist = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), shell);
        fist.position.set(s * 0.85, 0.78, 0); fist.userData.animated = 1; g.add(fist);
        const knuck = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.1), glow(T.color, 0.9));
        knuck.position.set(s * 0.85, 0.78, 0.22); g.add(knuck);
        if (s > 0) this.fistR = fist;
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.7, 4, 8), dark);
        leg.position.set(s * 0.35, 0.55, 0); leg.userData.animated = 1; g.add(leg);
        (s < 0 ? (this.legL = leg) : (this.legR = leg));
      }
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.1), glow(T.color, 0.8));
      vent.position.set(0, 1.75, -0.46); g.add(vent);
    } else if (this.type === 'sentinel') {
      const base = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 6), dark);
      base.rotation.x = Math.PI; base.position.y = 1.4; g.add(base);
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), shell);
      head.position.y = 2.15; g.add(head);
      this.head = head;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), glow(T.color));
      eye.position.set(0, 2.15, 0.5); g.add(eye);
      this.eye = eye;
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.85 - i * 0.12, 0.03, 5, 22), glow(T.color, 0.7));
        r.position.y = 2.1; r.rotation.x = Math.PI / 2 + i * 0.5; g.add(r);
        (this.rings ||= []).push(r);
      }
    } else { // juggernaut
      const torso = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.6, 2.0), shell);
      torso.position.y = 3.4; g.add(torso);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 14), glow(0xffcc22));
      core.position.set(0, 3.5, 1.02); g.add(core);
      this.eye = core;
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 1.0), dark);
      head.position.y = 5.1; g.add(head);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.1), glow(T.color));
      visor.position.set(0, 5.2, 0.52); g.add(visor);
      for (let s = -1; s <= 1; s += 2) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.6), shell);
        pad.position.set(s * 1.85, 4.4, 0); g.add(pad);
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.7, 4, 8), dark);
        arm.position.set(s * 1.9, 3.0, 0); g.add(arm);
        const fist = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), shell);
        fist.position.set(s * 1.9, 1.9, 0); g.add(fist);
        if (s > 0) this.fistR = fist;
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.4, 4, 8), dark);
        leg.position.set(s * 0.8, 1.2, 0); g.add(leg);
        (s < 0 ? (this.legL = leg) : (this.legR = leg));
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.5), glow(T.color, 0.9));
        strip.position.set(s * 1.55, 4.4, 0); g.add(strip);
      }
    }

    // No PointLight here. One per enemy meant 45 lights at the cap, and
    // three.js keys its shader programs on the light COUNT — so every spawn and
    // death recompiled every material. The nearest handful of enemies borrow a
    // light from G.lights each frame instead (see src/lights.js).
    this.light = null;

    // ground marker
    if (!window.__nobake) bakeStatics(g, [shell, dark]);

    const disc = new THREE.Mesh(new THREE.RingGeometry(T.radius * 0.9, T.radius * 1.2, 22), addMat(T.color, 0.7));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.05;
    g.add(disc);
    this.disc = disc;

    // health bar sprite
    const cv = document.createElement('canvas'); cv.width = 96; cv.height = 10;
    this.barCanvas = cv; this.barCtx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    this.barTex = tex;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    spr.scale.set(T.boss ? 6 : 1.7, T.boss ? 0.62 : 0.18, 1);
    spr.position.y = T.boss ? 6.4 : (this.type === 'brute' ? 2.9 : 1.3) + T.fly;
    spr.renderOrder = 20;
    g.add(spr);
    this.bar = spr;
    this.drawBar();
  }

  drawBar() {
    const c = this.barCtx, w = 96, h = 10;
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, 0, w, h);
    const f = clamp(this.hp / this.maxHp, 0, 1);
    const grd = c.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#ff3b5c'); grd.addColorStop(1, '#ff9a2b');
    c.fillStyle = grd; c.fillRect(1, 1, (w - 2) * f, h - 2);
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, w - 1, h - 1);
    this.barTex.needsUpdate = true;
  }

  center() { return new THREE.Vector3(this.pos.x, this.pos.y + this.T.fly + (this.T.boss ? 3.2 : this.type === 'brute' ? 1.5 : 0.6), this.pos.z); }

  spawnAt(x, z) {
    this.pos.set(x, 0, z);
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(0.01);
    this.spawnT = 0;
  }

  update(dt, G) {
    if (this.dead) return;
    const T = this.T;
    this.spawnT += dt;
    if (this.spawnT < 0.5) {
      const k = this.spawnT / 0.5;
      this.group.scale.setScalar(0.2 + 0.8 * (1 - Math.pow(1 - k, 3)));
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.stun = Math.max(0, this.stun - dt);
    this.slow = Math.max(0, this.slow - dt);
    if (this.slow <= 0) this.slowPow = 0;
    this.attackAnim = Math.max(0, this.attackAnim - dt * 3);
    this.mark = Math.max(0, this.mark - dt);
    // a stun cancels a wind-up outright — that is the reward for interrupting
    if (this.stun > 0 && this.windup > 0) {
      this.windup = 0;
      G.fx.tellRelease(this.tell); this.tell = null;
      G.popText(this.center(), 'INTERRUPTED', '#7cf9ff', 1.0);
    }

    const target = G.nearestHero(this.pos);
    let mvx = 0, mvz = 0;
    if (target && this.stun <= 0) {
      const d = flatDist(this.pos, target.pos);
      const desired = T.ranged ? T.range * 0.72 : T.range * 0.6;
      const ang = angleTo(this.pos, target.pos);
      this.facing += shortAngle(this.facing, ang) * Math.min(1, dt * 8);
      let move = 0;
      if (d > desired) move = 1;
      else if (d < desired * 0.6) move = -0.6;
      // strafe for ranged types
      const strafe = T.ranged ? Math.sin(G.time * 0.8 + this.id) * 0.55 : 0;
      const sp = T.speed * (this.slow > 0 ? (1 - (this.slowPow || 0.55)) : 1) * this.speedMul;
      mvx = (Math.sin(ang) * move + Math.cos(ang) * strafe) * sp;
      mvz = (Math.cos(ang) * move - Math.sin(ang) * strafe) * sp;

      // ---- wind-up -> telegraph -> attack ----
      if (this.windup > 0) {
        move *= 0.12;                       // commit: you can walk out of it
        this.windup -= dt;
        const p = 1 - this.windup / this.windupMax;
        const lane = T.lane || (!T.ranged && !T.boss && false);
        if (this.tell) {
          if (T.ranged && !T.boss) {
            // aimed at where the shot will land
            G.fx.tellSet(this.tell, this.tellAim.x, this.tellAim.z, this.facing, T.tellR, p);
          } else {
            const hx = this.pos.x + Math.sin(this.facing) * T.range * 0.6;
            const hz = this.pos.z + Math.cos(this.facing) * T.range * 0.6;
            G.fx.tellSet(this.tell, hx, hz, this.facing, T.tellR, p);
          }
        }
        if (this.windup <= 0) {
          G.fx.tellRelease(this.tell); this.tell = null;
          this.attack(G, target);
          this.cd = T.cd * this.cdMul * rand(1.2, 0.85);
        }
      } else {
        this.cd -= dt;
        if (this.cd <= 0 && d < T.range * 1.05) {
          this.windupMax = this.windup = (T.tell || 0.4) * (this.elite === 'overclocked' ? 0.7 : 1);
          this.tellAim.copy(target.pos);
          this.tell = G.fx.telegraph(T.color, T.boss ? 'cone' : T.ranged ? 'disc' : 'cone', T.boss ? 1.1 : 0.85);
          SFX.play('tell', { pan: G.panOf(this.pos), gap: 0.08, v: T.boss ? 1.3 : 0.8 });
        }
      }
    }

    // separation from other enemies
    let sx = 0, sz = 0;
    for (const o of G.enemies) {
      if (o === this || o.dead) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const rr = (this.radius + o.radius) * 1.05;
      if (d2 < rr * rr && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const f = (rr - d) / rr;
        sx += (dx / d) * f * 14; sz += (dz / d) * f * 14;
      }
    }
    mvx += sx; mvz += sz;

    this.vel.x = damp(this.vel.x, mvx, 8, dt) + this.pull.x;
    this.vel.z = damp(this.vel.z, mvz, 8, dt) + this.pull.z;
    this.pull.multiplyScalar(Math.exp(-7 * dt));

    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -ARENA + 1, ARENA - 1);
    this.pos.z = clamp(this.pos.z + this.vel.z * dt, -ARENA + 1, ARENA - 1);
    G.resolveObstacles(this.pos, this.radius);

    const bob = T.fly > 0 ? Math.sin(G.time * 3 + this.id) * 0.18 : 0;
    this.group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.group.rotation.y = this.facing;

    // per-type flourish
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (this.type === 'skitter' && this.ring) {
      this.ring.rotation.z += dt * 6;
      this.group.rotation.z = -clamp(spd * 0.03, -0.4, 0.4) * Math.sin(G.time * 3);
      this.group.position.y += T.fly;
    } else if (this.type === 'sentinel') {
      this.group.position.y += T.fly * 0.4;
      if (this.rings) this.rings.forEach((r, i) => { r.rotation.z += dt * (0.8 + i * 0.5); r.rotation.y += dt * 0.4; });
    } else if (this.legL) {
      const ph = G.time * (4 + spd * 0.8);
      this.legL.rotation.x = Math.sin(ph) * 0.5 * clamp(spd / T.speed, 0, 1);
      this.legR.rotation.x = -Math.sin(ph) * 0.5 * clamp(spd / T.speed, 0, 1);
      if (this.fistR) this.fistR.position.z = this.attackAnim * (T.boss ? 2.4 : 1.4);
    }

    // wind-up read on the body itself
    if (this.windup > 0) {
      const p = 1 - this.windup / this.windupMax;
      const pull = Math.sin(p * Math.PI) * 0.22;
      this.group.position.x -= Math.sin(this.facing) * pull;
      this.group.position.z -= Math.cos(this.facing) * pull;
      this.group.scale.setScalar(1 + 0.10 * Math.sin(p * Math.PI));
    } else if (this.spawnT > 0.5) {
      this.group.scale.setScalar(1);
    }
    if (this.crown) { this.crown.rotation.y += dt * 2.2; }

    // hit flash on emissive
    const fl = this.hitFlash;
    for (const m of this.glowMats) m.opacity = clamp(0.75 + fl * 2, 0, 1);
    // Pooled light: only the nearest few enemies get one, so this is nullable.
    // The slot lives in the scene root, so position it in world space.
    if (this.light) {
      const gp = this.group.position;
      this.light.position.set(gp.x, gp.y + (T.boss ? 3.5 : 1.2) * this.group.scale.y, gp.z);
      this.light.color.set(T.color);
      this.light.distance = T.boss ? 14 : 5;
      this.light.decay = 2;
      this.light.intensity = 1.2 + fl * 6 + (this.mark > 0 ? 1.5 : 0);
    }
    this.disc.material.opacity = 0.35 + 0.25 * Math.sin(G.time * 4 + this.id) + fl;
    this.bar.material.opacity = this.hp < this.maxHp ? 1 : 0.35;
  }

  attack(G, target) {
    const T = this.T;
    this.attackAnim = 1;
    const c = this.center();
    if (T.ranged) {
      const n = T.burst ?? 1;
      for (let i = 0; i < n; i++) {
        const dir = new THREE.Vector3().subVectors(target.center(), c).normalize();
        dir.x += rand(0.06, -0.06); dir.z += rand(0.06, -0.06);
        G.projectiles.fire({
          pos: c, dir, speed: 26, dmg: this.dmg(), color: T.color, hostile: true, size: 0.22,
          spawnDelay: i * 0.13, life: 3,
        });
      }
      G.fx.burst(c, T.color, 6, { speed: 4, life: 0.25, size: 0.3 });
      SFX.play('enemyShot', { pan: G.panOf(this.pos), gap: 0.05, v: 0.8 });
    } else {
      // melee slam
      const hitPos = new THREE.Vector3(this.pos.x + Math.sin(this.facing) * T.range * 0.6, 0.4, this.pos.z + Math.cos(this.facing) * T.range * 0.6);
      G.fx.ring(hitPos, T.color, { r0: 0.3, r1: T.boss ? 5.5 : 2.6, dur: 0.4 });
      G.fx.burst(hitPos, T.color, 18, { speed: 9, life: 0.5, size: 0.4 });
      SFX.play('bruteSlam', { pan: G.panOf(this.pos), gap: 0.06, v: T.boss ? 1.2 : 0.8 });
      G.fx.addShake(T.boss ? 0.5 : 0.18);
      for (const h of G.heroes) {
        if (h.dead) continue;
        if (flatDist(h.pos, hitPos) < (T.boss ? 5.5 : 2.7)) h.takeDamage(this.dmg(), hitPos);
      }
      if (T.boss) {
        // boss also fires a fan of plasma
        for (let i = -3; i <= 3; i++) {
          const a = this.facing + i * 0.18;
          G.projectiles.fire({
            pos: c, dir: new THREE.Vector3(Math.sin(a), -0.05, Math.cos(a)), speed: 22, dmg: 14,
            color: 0xffcc22, hostile: true, size: 0.3, spawnDelay: 0.35 + Math.abs(i) * 0.04, life: 3,
          });
        }
      }
    }
  }

  die(G, killer) {
    if (this.dead) return;
    this.dead = true;
    G.fx.tellRelease(this.tell); this.tell = null;
    const c = this.center();
    const T = this.T;
    if (this.elite === 'volatile') {
      const R = 4.6;
      G.fx.ring(this.pos, 0xffb14a, { r0: 0.4, r1: R, dur: 0.5 });
      G.fx.ring(this.pos, 0xffffff, { r0: 0.4, r1: R * 0.6, dur: 0.35 });
      G.fx.burst(c, 0xffb14a, 60, { speed: 18, life: 0.7, size: 0.6, grav: -6 });
      G.fx.addShake(0.35);
      SFX.play('explode', { pan: G.panOf(this.pos) });
      for (const h of G.heroes) {
        if (h.dead || h.downed) continue;
        const d = flatDist(h.pos, this.pos);
        if (d < R) h.takeDamage(62 * (1 - d / R) * (G.dmgScale || 1), this.pos);
      }
      for (const e of G.enemies) {
        if (e === this || e.dead) continue;
        const d = flatDist(e.pos, this.pos);
        if (d < R) G.damageEnemy(e, 70 * (1 - d / R), this.pos, { silent: true });
      }
    }
    SFX.play(T.boss ? 'bossDie' : 'enemyDie', { pan: G.panOf(this.pos), gap: T.boss ? 0 : 0.04 });
    if (T.boss) SFX.duck(0.25, 2.2);
    const n = T.boss ? 220 : 40;
    G.fx.burst(c, T.color, n, { speed: T.boss ? 26 : 13, life: T.boss ? 1.4 : 0.7, size: T.boss ? 1.0 : 0.5, grav: -8 });
    G.fx.burst(c, 0xffffff, n * 0.4, { speed: T.boss ? 30 : 16, life: 0.4, size: 0.4 });
    G.fx.sparkBurst(c, T.color, T.boss ? 60 : 16, T.boss ? 34 : 18);
    G.fx.ring(this.pos, T.color, { r0: 0.4, r1: T.boss ? 16 : 3.4, dur: T.boss ? 0.9 : 0.45 });
    if (T.boss) {
      G.fx.ring(this.pos, 0xffffff, { r0: 0.4, r1: 24, dur: 1.4, fade: 2 });
      G.fx.addShake(1.5);
      G.world.arenaPulse();
    } else G.fx.addShake(0.12);
    G.scene.remove(this.group);
    G.onEnemyKilled(this, killer);
  }
}
