import * as THREE from 'three';
import {
  buildHumanoid, animateRig, buildIonGauntlets, buildRiotShield,
  buildMedGloves, buildRailPistol, buildDrone,
} from './rig.js';
import { addMat, metalMat, TAU, rand, clamp, damp, lerp, flatDist, angleTo, shortAngle, disposeObj } from './util.js';
import { ARENA } from './world.js';
import { SFX } from './audio.js';
import { BALANCE as B } from './balance.js';

/* ============================================================
   HERO ROSTER — 3 switchable operatives, cyber-modern loadouts
   ============================================================ */

export const HERO_DEFS = [
  {
    id: 'aegis', name: 'AEGIS-7', tag: 'BULWARK', role: 'WARRIOR / TANK',
    color: 0xff8a2b, color2: 0x18e0ff, hp: 340, speed: 7.6, armor: 0.35,
    weapon: 'ION GAUNTLETS + HARD-LIGHT RIOT SHIELD',
    style: 'fist', bulk: 1.22, scale: 1.4, pauldrons: true, crest: true, plate: 0x3a3f57,
    basic: { name: 'ION FIST COMBO', cd: 0.4 },
    skills: [
      { key: 'Q', name: 'SEISMIC SLAM', cd: 7, desc: 'Leap-slam the deck. 8m shockwave, heavy knockback + 1.2s stun.' },
      { key: 'E', name: 'BASTION FIELD', cd: 15, desc: 'Deploy a hard-light dome. Eats enemy fire, 50% DR for allies inside.' },
      { key: 'R', name: 'MAGNETRON PULSE', cd: 0, ult: true, desc: 'Magnetise every hostile in 18m, reel them in, then detonate the core.' },
    ],
    bio: 'Riot-control frame retrofitted with an ion knuckle rig. Holds the line so the others can work.',
  },
  {
    id: 'lyra', name: 'LYRA-V', tag: 'NANOMEDIC', role: 'SUPPORT / HEALER',
    color: 0x3dffb0, color2: 0x7cf9ff, hp: 220, speed: 8.3, armor: 0.05,
    weapon: 'NANITE MED-GLOVES + REPAIR DRONE',
    style: 'support', bulk: 0.92, scale: 1.3, hood: true, plate: 0x24493f,
    basic: { name: 'NANITE BOLT', cd: 0.3 },
    skills: [
      { key: 'Q', name: 'BLOOM FIELD', cd: 9, desc: 'Seed a nanite garden. Heals allies 24/s, dissolves hostiles 14/s.' },
      { key: 'E', name: 'SYNAPSE TETHER', cd: 8, desc: 'Hard-link the weakest ally: 20 HP/s, +30% speed, damage shared.' },
      { key: 'R', name: 'PHOENIX PROTOCOL', cd: 0, ult: true, desc: 'Reboot the squad — full heal, revive the downed, 120 overshield.' },
    ],
    bio: 'Combat medic running a nanite swarm. Her drone stitches armour back together mid-firefight.',
  },
  {
    id: 'nyx', name: 'NYX-0', tag: 'RAILWITCH', role: 'WIZARD / GUNNER',
    color: 0xff3df0, color2: 0xa855ff, hp: 195, speed: 8.7, armor: 0.0,
    weapon: 'ARC RAIL PISTOL + SWARM POD',
    style: 'gun', bulk: 0.9, scale: 1.32, crest: true, plate: 0x3a2352,
    basic: { name: 'ARC ROUNDS', cd: 0.22 },
    skills: [
      { key: 'Q', name: 'RAILSHOT', cd: 5, desc: 'Overcharge the rails. Pierces everything in a 40m line.' },
      { key: 'E', name: 'SWARM MISSILES', cd: 8, desc: 'Twelve homing micro-missiles off the shoulder pod.' },
      { key: 'R', name: 'SINGULARITY', cd: 0, ult: true, desc: 'Fold space at the cursor. Drags hostiles in, then implodes.' },
    ],
    bio: 'Techno-arcanist. Treats a railgun like a spellbook and the grid like an open API.',
  },
];

/* ============================================================ */

export class Hero {
  constructor(def, G, index) {
    this.def = def;
    this.G = G;
    this.index = index;
    this.color = new THREE.Color(def.color);
    this.color2 = new THREE.Color(def.color2);
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.shield = 0;
    this.maxShield = 0;
    this.energy = 0;
    this.maxEnergy = 100;
    this.pos = new THREE.Vector3(index * 3 - 3, 0, 6);
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.dead = false;
    this.downed = false;
    this.reviveT = 0;
    this.cds = [0, 0, 0];
    this.attackCd = 0;
    this.attackAnim = 0;
    this.castAnim = 0;
    this.hurtAnim = 0;
    this.dashCd = 0;
    this.dashT = 0;
    this.iframe = 0;
    this.dmgBuffT = 0;
    this.dashDir = new THREE.Vector3();
    this.combo = 0;
    this.comboT = 0;
    this.buffs = { speed: 0, dr: 0, regen: 0 };
    this.charge = 0;
    this.ultMul = 1;
    this.controlled = false;
    this.aim = new THREE.Vector3(0, 0, 1);
    this.stats = { dmg: 0, heal: 0, kills: 0 };
    this.build();
  }

  build() {
    const d = this.def;
    this.rig = buildHumanoid({
      accent: d.color, visor: d.color2, bulk: d.bulk, scale: d.scale,
      pauldrons: d.pauldrons, hood: d.hood, crest: d.crest, plate: d.plate,
    });
    this.group = this.rig.root;
    this.G.scene.add(this.group);

    if (d.id === 'aegis') {
      this.gauntlets = buildIonGauntlets(this.rig, d.color);
      this.shieldObj = buildRiotShield(this.rig, d.color2);
    } else if (d.id === 'lyra') {
      this.gloves = buildMedGloves(this.rig, d.color);
      this.drone = buildDrone(this.rig, d.color2);
      this.G.scene.add(this.drone.group);
    } else {
      this.pistol = buildRailPistol(this.rig, d.color);
      this.drone = buildDrone(this.rig, d.color2);
      this.G.scene.add(this.drone.group);
    }

    // selection ring (shown when controlled)
    const sel = new THREE.Mesh(new THREE.RingGeometry(0.86, 0.99, 40), addMat(d.color, 0.5));
    sel.rotation.x = -Math.PI / 2; sel.position.y = 0.04;
    this.group.add(sel);
    this.selRing = sel;

    // overshield bubble
    const ob = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12), new THREE.MeshBasicMaterial({
      color: d.color2, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true,
    }));
    ob.position.y = 1.0;
    this.group.add(ob);
    this.overshieldMesh = ob;

    // AI marker (small chevron)
    const chev = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), addMat(d.color, 0.85));
    chev.position.y = 2.5; chev.rotation.x = Math.PI;
    this.group.add(chev);
    this.chev = chev;
  }

  center() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.15, this.pos.z); }
  handPos() {
    const v = new THREE.Vector3();
    (this.pistol ? this.pistol.muzzle : this.gauntlets ? this.gauntlets.R.knuck : this.gloves.R.emitter).getWorldPosition(v);
    return v;
  }

  /* ---------------- damage / heal ---------------- */
  takeDamage(amount, from) {
    if (this.dead || this.downed) return;
    const G = this.G;
    if (G.god) return;
    // dash i-frames: a clean dodge refunds tempo instead of just avoiding damage
    if (this.iframe > 0) {
      SFX.play('dodge', { pan: G.panOf(this.pos), gap: 0.1 });
      G.popText(this.center(), 'DODGE', '#7cf9ff', 1.15);
      G.fx.ring(this.pos, 0x7cf9ff, { r0: 1.6, r1: 0.3, dur: 0.28, ease: 'in' });
      G.fx.burst(this.center(), 0x7cf9ff, 10, { speed: 7, life: 0.3, size: 0.35 });
      this.addEnergy(B.dash.dodgeEnergy);
      G.dodges = (G.dodges || 0) + 1;
      if (G.mods && G.mods.dodgeBuff > 0) {
        this.dmgBuffT = G.mods.dodgeBuff;
        G.popText(this.center(), 'REFLEX +40%', '#ffe36a', 1.1);
      }
      if (this.controlled) G.fx.flash = Math.max(G.fx.flash, 0.12);
      return;
    }
    let amt = amount * (1 - this.def.armor) * (1 - this.buffs.dr) * (1 - (G.mods ? G.mods.armor : 0));
    if (G.barrierProtects(this.pos)) amt *= 0.5;
    if (this.shield > 0) {
      const s = Math.min(this.shield, amt);
      this.shield -= s; amt -= s;
      G.fx.ring(this.center(), this.def.color2, { r0: 0.6, r1: 1.8, dur: 0.3, y: 0 });
    }
    this.hp -= amt;
    this.hurtAnim = 1;
    this.energy = Math.min(this.maxEnergy, this.energy + amt * 0.18);
    SFX.play('hurt', { v: this.controlled ? 1 : 0.5, pan: G.panOf(this.pos), gap: 0.12 });
    G.fx.burst(this.center(), 0xff4466, 10, { speed: 6, life: 0.35, size: 0.35 });
    G.popText(this.center(), Math.round(amt), '#ff6a88', 0.9);
    if (this.controlled) { G.fx.addShake(0.14 + amt * 0.002); G.damageVignette = Math.min(0.8, G.damageVignette + 0.45); }
    if (this.hp <= 0) this.down();
  }

  heal(amount, silent) {
    if (this.dead) return 0;
    if (this.downed) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const got = this.hp - before;
    if (got > 0.5 && !silent) {
      this.G.popText(this.center(), '+' + Math.round(got), '#5dffc0', 0.8);
      this.G.fx.burst(this.center(), 0x3dffb0, 5, { speed: 3, life: 0.5, size: 0.3, grav: 4 });
    }
    return got;
  }

  down() {
    SFX.play('down');
    this.downed = true;
    this.hp = 0;
    this.reviveT = Math.min(B.combat.reviveMax, B.combat.reviveBase + Math.max(0, (this.G.wave || 1) - 10) * 0.7);
    const G = this.G;
    G.fx.burst(this.center(), this.def.color, 50, { speed: 12, life: 0.8, size: 0.6 });
    G.fx.ring(this.pos, 0xff3355, { r0: 0.5, r1: 5, dur: 0.7 });
    G.fx.addShake(0.6);
    G.onHeroDowned(this);
  }

  revive(pct = 1) {
    if (!this.downed) return;
    SFX.play('revive');
    this.downed = false;
    this.hp = this.maxHp * pct;
    const G = this.G;
    G.fx.ring(this.pos, this.def.color, { r0: 0.5, r1: 6, dur: 0.7 });
    G.fx.burst(this.center(), 0xffffff, 60, { speed: 8, life: 1.0, size: 0.5, grav: 3 });
    G.popText(this.center(), 'ONLINE', '#ffffff', 1.4);
  }

  addEnergy(v) {
    v *= (this.G.mods ? this.G.mods.energy : 1);
    const before = this.energy;
    this.energy = clamp(this.energy + v, 0, this.maxEnergy);
    if (before < this.maxEnergy && this.energy >= this.maxEnergy) {
      SFX.play('ultReady', { v: this.controlled ? 1 : 0.45 });
      if (this.controlled) this.G.ui.feed('ULTIMATE READY', '#' + this.def.color.toString(16).padStart(6, '0'));
    }
  }

  /* ---------------- movement ---------------- */
  move(dt, dir, sprint) {
    const spd = this.def.speed * (1 + this.buffs.speed + (this.G.mods ? this.G.mods.speed : 0)) * (this.downed ? 0 : 1);
    const target = dir.clone().multiplyScalar(spd);
    const accel = this.dashT > 0 ? 30 : 14;
    this.vel.x = damp(this.vel.x, target.x, accel, dt);
    this.vel.z = damp(this.vel.z, target.z, accel, dt);

    this.iframe = Math.max(0, this.iframe - dt);
    if (this.dmgBuffT > 0) this.dmgBuffT -= dt;
    if (this.dashT > 0) {
      this.dashT -= dt;
      const k = clamp(this.dashT / 0.18, 0, 1);
      this.vel.x = this.dashDir.x * 34 * k;
      this.vel.z = this.dashDir.z * 34 * k;
      if (Math.random() < 0.9) {
        this.G.fx.spawn({
          x: this.pos.x + rand(0.5, -0.5), y: rand(1.8, 0.2), z: this.pos.z + rand(0.5, -0.5),
          vx: -this.dashDir.x * 3, vy: rand(1, 0), vz: -this.dashDir.z * 3,
          color: this.color, life: 0.35, size: 0.7, drag: 3, grav: 0,
        });
      }
    }

    this.pos.x = clamp(this.pos.x + this.vel.x * dt, -ARENA + 1.2, ARENA - 1.2);
    this.pos.z = clamp(this.pos.z + this.vel.z * dt, -ARENA + 1.2, ARENA - 1.2);
    this.G.resolveObstacles(this.pos, 0.6);
  }

  dash() {
    if (this.dashCd > 0 || this.downed) return;
    const G = this.G;
    const d = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (d.lengthSq() < 0.5) d.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.dashDir.copy(d).normalize();
    this.dashT = B.dash.duration;
    this.dashCd = B.dash.cooldown;
    this.iframe = B.dash.iframe;                       // the dodge window
    SFX.play('dash', { pan: G.panOf(this.pos) });
    G.fx.ring(this.pos, this.def.color2, { r0: 0.4, r1: 2.6, dur: 0.35 });
    G.fx.burst(this.pos, this.color, 16, { speed: 6, life: 0.35, size: 0.4, y: 0.4 });

    // afterimage trail: 4 fading silhouettes dropped along the dash path
    const self = this, start = this.pos.clone();
    G.addEffect({
      t: 0, n: 0,
      update(dt) {
        this.t += dt;
        if (this.n < 4 && this.t > this.n * 0.035) {
          this.n++;
          const p = self.pos.clone();
          G.fx.ring(p, self.def.color, { r0: 0.9, r1: 0.2, dur: 0.28, ease: 'in', y: 0.05 });
          for (let i = 0; i < 5; i++) {
            G.fx.spawn({
              x: p.x + rand(0.3, -0.3), y: 0.4 + Math.random() * 1.1, z: p.z + rand(0.3, -0.3),
              vx: -self.dashDir.x * 2, vy: 0.4, vz: -self.dashDir.z * 2,
              color: self.color, life: 0.3, size: 0.5, drag: 3, grav: 0,
            });
          }
        }
        if (this.t > 0.2 && !this.done) {
          this.done = true;
          G.fx.beam(
            new THREE.Vector3(start.x, 0.9, start.z),
            new THREE.Vector3(self.pos.x, 0.9, self.pos.z),
            self.def.color2, { w: 0.5, dur: 0.22, flare: 1.2 }
          );
        }
        return this.t < 0.3;
      },
    });
  }

  /* ---------------- basic attack ---------------- */
  tryAttack(G) {
    if (this.attackCd > 0 || this.downed) return;
    const d = this.def;
    this.attackCd = d.basic.cd;
    this.attackAnim = 1;

    if (d.id === 'aegis') this.attackFist(G);
    else if (d.id === 'lyra') this.attackNanite(G);
    else this.attackRail(G);
  }

  attackFist(G) {
    this.comboT = 1.1;
    this.combo = (this.combo + 1) % 3;
    const third = this.combo === 0;
    const reach = 3.4 + (third ? G.mods.fistCleave : 0), arc = Math.cos(third ? 1.4 : 0.85);
    const dmg = third ? 52 : 28;
    const origin = new THREE.Vector3(this.pos.x + Math.sin(this.facing) * 1.2, 1.1, this.pos.z + Math.cos(this.facing) * 1.2);
    let hits = 0;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach + e.radius) continue;
      const dot = (Math.sin(this.facing) * dx + Math.cos(this.facing) * dz) / (dist || 1);
      if (dot < arc) continue;
      G.damageEnemy(e, dmg, origin, { knock: third ? 12 : 3, source: this });
      hits++;
    }
    // fx
    SFX.play(third ? 'fistHeavy' : 'fist', { pan: G.panOf(this.pos), gap: 0.05 });
    const c = third ? 0xffd06a : this.def.color;
    G.fx.ring(origin, c, { r0: 0.4, r1: third ? 4.6 : 2.6, dur: third ? 0.45 : 0.28, y: -0.6 });
    G.fx.burst(origin, c, third ? 34 : 14, { speed: third ? 15 : 8, life: 0.4, size: 0.45 });
    G.fx.sparkBurst(origin, c, third ? 18 : 6, third ? 20 : 12);
    if (third) {
      // cone shockwave
      for (let i = 0; i < 26; i++) {
        const a = this.facing + rand(0.8, -0.8);
        G.fx.spawn({
          x: this.pos.x, y: rand(1.8, 0.3), z: this.pos.z,
          vx: Math.sin(a) * rand(24, 12), vy: rand(3, 0), vz: Math.cos(a) * rand(24, 12),
          color: new THREE.Color(c), life: 0.4, size: 0.55, drag: 3.5, grav: -2,
        });
      }
      G.fx.addShake(0.35);
    } else G.fx.addShake(0.08);
    if (hits) this.addEnergy(third ? 8 : 4);
  }

  attackNanite(G) {
    const from = this.handPos();
    const t = G.aimEnemy(this, 30, 0.5);
    const dir = t ? new THREE.Vector3().subVectors(t.center(), from).normalize()
      : new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    G.projectiles.fire({
      pos: from, dir, speed: 38, dmg: 21, color: this.def.color, size: 0.2,
      homing: 5, target: t, trail: 3, owner: this,
    });
    G.fx.burst(from, this.def.color, 6, { speed: 3, life: 0.25, size: 0.25 });
    SFX.play('nanite', { pan: G.panOf(this.pos), gap: 0.05 });
    this.addEnergy(2.2);
  }

  attackRail(G) {
    const from = this.handPos();
    const dir = new THREE.Vector3(this.aim.x, 0, this.aim.z).normalize();
    G.projectiles.fire({
      pos: from, dir, speed: 68, dmg: 26, color: this.def.color, size: 0.18, trail: 4.5,
      chain: 1, pierce: 0, owner: this,
    });
    SFX.play('arc', { pan: G.panOf(this.pos), gap: 0.04 });
    // muzzle flash
    G.fx.burst(from, this.def.color, 8, { speed: 7, life: 0.16, size: 0.4 });
    G.fx.beam(from, from.clone().addScaledVector(dir, 2.2), 0xffffff, { w: 0.16, dur: 0.08 });
    G.fx.sparkBurst(from, this.def.color2, 3, 8);
    this.recoil = 1;
    if (this.controlled) G.fx.addShake(0.035);
    this.addEnergy(2.0);
  }

  /* ---------------- skills ---------------- */
  useSkill(i, G) {
    const sk = this.def.skills[i];
    if (this.downed) return;
    if (sk.ult) {
      if (this.energy < this.maxEnergy) return;
    } else if (this.cds[i] > 0) return;

    if (sk.ult) { this.energy = 0; this.ultMul = 1; G.onUltCast(this, sk); }
    else this.cds[i] = sk.cd * (1 - (G.mods ? G.mods.cdr : 0));
    this.castAnim = 1;
    G.announceSkill(this, sk);

    const key = this.def.id + i;
    switch (key) {
      case 'aegis0': this.seismicSlam(G); break;
      case 'aegis1': this.bastionField(G); break;
      case 'aegis2': this.magnetron(G); break;
      case 'lyra0': this.bloomField(G); break;
      case 'lyra1': this.synapseTether(G); break;
      case 'lyra2': this.phoenix(G); break;
      case 'nyx0': this.railshot(G); break;
      case 'nyx1': this.swarm(G); break;
      case 'nyx2': this.singularity(G); break;
    }
  }

  /* ---- AEGIS ---- */
  seismicSlam(G) {
    const dir = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.dashDir.copy(dir); this.dashT = 0.12;
    const self = this;
    G.addEffect({
      t: 0, dur: 0.34, fired: false,
      update(dt) {
        this.t += dt;
        self.rig.hips.position.y = 0.95 + Math.sin(Math.min(1, this.t / 0.24) * Math.PI) * 1.5;
        if (!this.fired && this.t > 0.22) {
          this.fired = true;
          const p = self.pos.clone();
          const R = 8.5;
          for (const e of G.enemies) {
            if (e.dead) continue;
            const d = flatDist(e.pos, p);
            if (d < R + e.radius) {
              G.damageEnemy(e, 95 * (1 - d / (R * 1.6)), p, { knock: 16, source: self });
              e.stun = Math.max(e.stun, 1.3 + G.mods.slamStun);
              G.fx.ring(e.pos, 0xffe0a0, { r0: 0.2, r1: 1.6, dur: 0.4 });
            }
          }
          G.fx.ring(p, 0xffc46a, { r0: 0.5, r1: R * 1.05, dur: 0.5, fade: 1.2 });
          G.fx.ring(p, 0xffffff, { r0: 0.5, r1: R * 0.65, dur: 0.34 });
          G.fx.ring(p, self.def.color, { r0: 0.5, r1: R * 1.4, dur: 0.8, fade: 2 });
          G.fx.ringBurst(p, 0xffb14a, 60, 1.2, { speed: 20, life: 0.7, size: 0.6 });
          G.fx.burst(p, 0xffffff, 30, { speed: 8, life: 0.5, size: 0.7, rise: 6 });
          G.fx.sparkBurst(p, 0xffd08a, 34, 26);
          SFX.play('slam', { pan: G.panOf(p) });
          G.fx.addShake(0.9);
          G.world.arenaPulse();
          // fissure cracks
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU + rand(0.3);
            for (let k = 0; k < 12; k++) {
              G.fx.spawn({
                x: p.x + Math.cos(a) * k * 0.75, y: 0.15, z: p.z + Math.sin(a) * k * 0.75,
                vx: rand(1, -1), vy: rand(6, 1), vz: rand(1, -1),
                color: new THREE.Color(0xffa03a), life: 0.55 - k * 0.02, size: 0.55, drag: 2.5, grav: -8,
              });
            }
          }
        }
        if (this.t >= this.dur) { self.rig.hips.position.y = 0.95; return false; }
        return true;
      },
    });
  }

  bastionField(G) {
    const self = this;
    const grp = new THREE.Group();
    const R = 6.0;
    const uni = { uTime: { value: 0 }, uCol: { value: new THREE.Color(this.def.color2) }, uFade: { value: 1 } };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20, 0, TAU, 0, Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vP; varying vec3 vN; void main(){ vP=position; vN=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uCol; uniform float uFade; varying vec3 vP; varying vec3 vN;
        float hex(vec2 p){ p *= 1.0; vec2 q = vec2(p.x*1.1547, p.y + p.x*0.5773);
          vec2 pi = floor(q); vec2 pf = fract(q);
          float v = mod(pi.x+pi.y,3.0);
          float ca = step(1.0,v), cb = step(2.0,v);
          vec2 ma = step(pf.xy, pf.yx);
          float e = dot(ma, 1.0-pf.yx + ca*(pf.x+pf.y-1.0) + cb*(pf.yx-2.0*pf.xy));
          return e; }
        void main(){
          vec2 uvp = vec2(atan(vP.z,vP.x)*2.4, vP.y*0.55);
          float h = hex(uvp*3.0);
          float grid = smoothstep(0.06,0.0,h);
          float sweep = smoothstep(0.85,1.0,sin(vP.y*0.7 - uTime*2.2));
          float rimf = pow(1.0-abs(dot(normalize(vN), vec3(0.0,1.0,0.0))), 2.0);
          float a = (grid*0.55 + 0.06 + sweep*0.4 + rimf*0.25) * uFade;
          gl_FragColor = vec4(uCol*a*1.8, a*0.75);
        }`,
    }));
    grp.add(dome);
    const base = new THREE.Mesh(new THREE.RingGeometry(R * 0.94, R, 48), addMat(this.def.color2, 0.9));
    base.rotation.x = -Math.PI / 2; base.position.y = 0.06; grp.add(base);
    grp.position.copy(this.pos);
    G.scene.add(grp);
    const light = new THREE.PointLight(this.def.color2, 3, 18, 2); light.position.y = 2; grp.add(light);

    const bar = { pos: grp.position.clone(), r: R, active: true };
    G.barriers.push(bar);
    SFX.play('domeUp', { pan: G.panOf(this.pos) });
    G.fx.ring(this.pos, this.def.color2, { r0: 0.5, r1: R, dur: 0.5 });
    G.fx.ringBurst(this.pos, this.def.color2, 40, R * 0.4, { speed: 8, life: 0.8, size: 0.4, grav: 2 });
    G.fx.addShake(0.3);

    G.addEffect({
      t: 0, dur: 5.5,
      update(dt) {
        this.t += dt;
        uni.uTime.value = G.time;
        if (G.mods.domeReflect > 0) {
          for (const e of G.enemies) {
            if (e.dead) continue;
            const d = flatDist(e.pos, self.pos);
            if (d < R + 0.6 && d > R - 1.6) G.damageEnemy(e, G.mods.domeReflect * dt, self.pos, { silent: true, source: self });
          }
        }
        const k = this.t / this.dur;
        uni.uFade.value = k > 0.8 ? (1 - (k - 0.8) / 0.2) : 1;
        base.material.opacity = uni.uFade.value * (0.7 + 0.3 * Math.sin(G.time * 6));
        light.intensity = 2 + Math.sin(G.time * 5);
        if (Math.random() < 0.5) {
          const a = Math.random() * TAU;
          G.fx.spawn({
            x: bar.pos.x + Math.cos(a) * R, y: 0.1, z: bar.pos.z + Math.sin(a) * R,
            vx: 0, vy: rand(4, 1), vz: 0, color: new THREE.Color(self.def.color2),
            life: 0.9, size: 0.35, drag: 1, grav: 0,
          });
        }
        for (const h of G.heroes) if (!h.downed && flatDist(h.pos, bar.pos) < R) h.buffs.dr = Math.max(h.buffs.dr, 0.5);
        if (this.t >= this.dur) {
          bar.active = false;
          const i = G.barriers.indexOf(bar); if (i >= 0) G.barriers.splice(i, 1);
          disposeObj(G.scene, grp);
          G.fx.ring(bar.pos, self.def.color2, { r0: R, r1: R * 1.4, dur: 0.4 });
          return false;
        }
        return true;
      },
    });
  }

  magnetron(G) {
    const self = this;
    const p = this.pos.clone();
    const R = 19;
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), addMat(0xffb14a, 1));
    core.position.set(p.x, 1.2, p.z);
    G.scene.add(core);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.09, 8, 40), addMat(0xffffff, 0.9));
    halo.position.copy(core.position); halo.rotation.x = Math.PI / 2;
    G.scene.add(halo);
    const light = new THREE.PointLight(0xffb14a, 6, 40, 2);
    light.position.copy(core.position); G.scene.add(light);
    SFX.play('magnetCharge');
    G.fx.addShake(0.5);
    G.world.arenaPulse();

    G.addEffect({
      t: 0, phase: 0,
      update(dt) {
        this.t += dt;
        core.rotation.y += dt * 5; core.rotation.x += dt * 3;
        halo.rotation.z += dt * 4;
        halo.scale.setScalar(1 + Math.sin(this.t * 8) * 0.15);
        if (this.t < 1.1) {
          const s = 1 + this.t * 1.6;
          core.scale.setScalar(s);
          light.intensity = 4 + this.t * 10;
          for (const e of G.enemies) {
            if (e.dead) continue;
            const d = flatDist(e.pos, p);
            if (d < R) {
              const f = (1 - d / R) * 46 * dt;
              e.pull.x += (p.x - e.pos.x) / (d || 1) * f;
              e.pull.z += (p.z - e.pos.z) / (d || 1) * f;
              e.stun = Math.max(e.stun, 0.3);
              if (Math.random() < 0.25) G.fx.attract(e.pos, core.position, new THREE.Color(0xffb14a), 2, { r: 1, life: 0.5, pull: 40 });
            }
          }
          if (Math.random() < 0.9) {
            const a = Math.random() * TAU, r = rand(R, 4);
            G.fx.spawn({
              x: p.x + Math.cos(a) * r, y: rand(4, 0.2), z: p.z + Math.sin(a) * r,
              vx: 0, vy: 0, vz: 0, color: new THREE.Color(0xffd08a),
              life: 0.7, size: 0.5, mode: 1, target: core.position, spin: 60, drag: 0.4,
            });
          }
          G.fx.addShake(0.06);
        } else if (this.phase === 0) {
          this.phase = 1;
          // DETONATE
          for (const e of G.enemies) {
            if (e.dead) continue;
            const d = flatDist(e.pos, p);
            if (d < 14) {
              G.damageEnemy(e, 300 * (1 - d / 22), p, { knock: 26, source: self, ult: true });
              e.stun = Math.max(e.stun, 0.8);
            }
          }
          G.fx.ring(p, 0xffffff, { r0: 1, r1: 16, dur: 0.45 });
          G.fx.ring(p, 0xffb14a, { r0: 1, r1: 19, dur: 0.85, fade: 2 });
          G.fx.ring(p, 0xff6a2b, { r0: 1, r1: 22, dur: 1.2, fade: 3 });
          G.fx.burst({ x: p.x, y: 1.2, z: p.z }, 0xffd08a, 180, { speed: 34, life: 1.2, size: 0.9, grav: -10 });
          G.fx.burst({ x: p.x, y: 1.2, z: p.z }, 0xffffff, 70, { speed: 40, life: 0.5, size: 0.6 });
          G.fx.sparkBurst({ x: p.x, y: 1.2, z: p.z }, 0xffe0a0, 70, 40);
          SFX.play('bigBoom'); SFX.duck(0.25, 1.4);
          G.fx.addShake(1.6);
          G.fx.flash = 1; G.fx.flashColor.set(0xffb14a);
          G.world.arenaPulse();
          light.intensity = 40;
        } else {
          core.scale.multiplyScalar(Math.exp(-9 * dt));
          light.intensity *= Math.exp(-5 * dt);
          halo.scale.multiplyScalar(1 + dt * 6);
          halo.material.opacity *= Math.exp(-4 * dt);
          if (this.t > 2.4) {
            disposeObj(G.scene, core); disposeObj(G.scene, halo); disposeObj(G.scene, light);
            return false;
          }
        }
        return true;
      },
    });
  }

  /* ---- LYRA ---- */
  bloomField(G) {
    const self = this;
    const p = G.groundAim(this, 16).clone();
    const R = 6.4;
    const grp = new THREE.Group();
    grp.position.copy(p);
    G.scene.add(grp);
    const discs = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(R * (0.3 + i * 0.22), R * (0.42 + i * 0.22), 40, 1), addMat(i === 1 ? this.def.color2 : this.def.color, 0.55));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.08 + i * 0.02;
      grp.add(m); discs.push(m);
    }
    const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(R, 40), addMat(this.def.color, 0.13));
    glowDisc.rotation.x = -Math.PI / 2; glowDisc.position.y = 0.05; grp.add(glowDisc);
    const light = new THREE.PointLight(this.def.color, 3.4, 20, 2); light.position.y = 2; grp.add(light);
    // lattice pillars
    const pillars = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 5), addMat(this.def.color2, 0.6));
      m.position.set(Math.cos(a) * R * 0.9, 1.6, Math.sin(a) * R * 0.9);
      grp.add(m); pillars.push(m);
    }
    SFX.play('bloomField', { pan: G.panOf(p) });
    G.fx.ring(p, this.def.color, { r0: 0.5, r1: R, dur: 0.6 });
    G.fx.ringBurst(p, this.def.color, 46, R * 0.5, { speed: 5, life: 1.2, size: 0.4, grav: 3 });

    G.addEffect({
      t: 0, dur: 7,
      update(dt) {
        this.t += dt;
        const k = this.t / this.dur;
        const fade = k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1;
        discs.forEach((d, i) => { d.rotation.z += dt * (0.6 + i * 0.5) * (i % 2 ? -1 : 1); d.material.opacity = 0.5 * fade; });
        glowDisc.material.opacity = (0.10 + 0.05 * Math.sin(G.time * 3)) * fade;
        light.intensity = (2.6 + Math.sin(G.time * 4)) * fade;
        pillars.forEach((m, i) => {
          m.position.y = 1.6 + Math.sin(G.time * 2 + i) * 0.3;
          m.material.opacity = (0.35 + 0.3 * Math.sin(G.time * 4 + i)) * fade;
        });
        if (Math.random() < 0.85) {
          const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * R;
          G.fx.spawn({
            x: p.x + Math.cos(a) * r, y: 0.1, z: p.z + Math.sin(a) * r,
            vx: rand(0.4, -0.4), vy: rand(3.2, 1.4), vz: rand(0.4, -0.4),
            color: new THREE.Color(Math.random() < 0.35 ? self.def.color2 : self.def.color),
            life: rand(1.4, 0.7), size: rand(0.42, 0.18), drag: 0.7, grav: 1.2,
          });
        }
        for (const h of G.heroes) {
          if (h.downed) continue;
          if (flatDist(h.pos, p) < R) {
            const g = h.heal(24 * dt, true);
            self.stats.heal += g;
            if (g > 0) self.addEnergy(g * 0.12);
            if (Math.random() < 0.25) G.fx.attract(h.pos, h.center(), new THREE.Color(self.def.color), 1, { r: 1.2, life: 0.4, pull: 30 });
          }
        }
        for (const e of G.enemies) {
          if (e.dead) continue;
          if (flatDist(e.pos, p) < R + e.radius) {
            G.damageEnemy(e, 15 * dt, e.pos, { silent: true, source: self });
            e.slow = 0.3 + G.mods.bloomSlow * 6;
            e.slowPow = Math.max(e.slowPow || 0, 0.55 + Math.min(0.25, G.mods.bloomSlow * 0.45));
          }
        }
        if (this.t >= this.dur) { disposeObj(G.scene, grp); return false; }
        return true;
      },
    });
  }

  synapseTether(G) {
    const self = this;
    let ally = null, best = 2;
    for (const h of G.heroes) {
      if (h === self || h.dead) continue;
      const f = h.downed ? -1 : h.hp / h.maxHp;
      if (f < best) { best = f; ally = h; }
    }
    if (!ally) ally = self;
    const seg = 14;
    const pts = new Float32Array((seg + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: this.def.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.frustumCulled = false;
    G.scene.add(line);
    const line2 = new THREE.Line(geo.clone(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    line2.frustumCulled = false;
    G.scene.add(line2);
    SFX.play('tether');
    G.popText(ally.center(), 'LINKED', '#7cf9ff', 1.1);

    G.addEffect({
      t: 0, dur: 5,
      update(dt) {
        this.t += dt;
        const a = self.handPos(), b = ally.center();
        for (let i = 0; i <= seg; i++) {
          const k = i / seg;
          const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k) + Math.sin(k * Math.PI) * 0.9, z = lerp(a.z, b.z, k);
          const w = Math.sin(k * 22 - G.time * 16) * 0.22 * Math.sin(k * Math.PI);
          pts[i * 3] = x + w; pts[i * 3 + 1] = y + Math.cos(k * 18 - G.time * 12) * 0.18 * Math.sin(k * Math.PI); pts[i * 3 + 2] = z + w;
        }
        geo.attributes.position.needsUpdate = true;
        line2.geometry.attributes.position.array.set(pts);
        line2.geometry.attributes.position.needsUpdate = true;
        const fade = this.t > this.dur - 0.6 ? (this.dur - this.t) / 0.6 : 1;
        line.material.opacity = fade; line2.material.opacity = fade * 0.6;
        if (ally !== self) {
          const g = ally.heal(22 * dt, true); self.stats.heal += g;
          ally.buffs.speed = Math.max(ally.buffs.speed, 0.3);
        } else self.heal(22 * dt, true);
        ally.buffs.dr = Math.max(ally.buffs.dr, 0.2);
        if (Math.random() < 0.7) {
          const k = Math.random();
          G.fx.spawn({
            x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) + Math.sin(k * Math.PI) * 0.9, z: lerp(a.z, b.z, k),
            vx: rand(0.6, -0.6), vy: rand(1.4, 0.2), vz: rand(0.6, -0.6),
            color: new THREE.Color(self.def.color2), life: 0.5, size: 0.3, drag: 2, grav: 0,
          });
        }
        if (this.t >= this.dur) { disposeObj(G.scene, line); disposeObj(G.scene, line2); return false; }
        return true;
      },
    });
  }

  phoenix(G) {
    const self = this;
    const p = this.pos.clone();
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 3.1, 40, 24, 1, true), new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(this.def.color) }, uFade: { value: 1 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: `uniform float uTime; uniform vec3 uCol; uniform float uFade; varying vec2 vUv;
        void main(){
          float streak = sin(vUv.x*60.0 + uTime*3.0)*0.5+0.5;
          float rise = fract(vUv.y*2.0 - uTime*0.9);
          float a = (0.25 + streak*0.4) * pow(1.0-vUv.y, 1.4) * (0.5+0.8*rise) * uFade;
          gl_FragColor = vec4(uCol*a*2.2, a*0.8);
        }`,
    }));
    pillar.position.set(p.x, 20, p.z);
    G.scene.add(pillar);
    const light = new THREE.PointLight(this.def.color, 12, 46, 2);
    light.position.set(p.x, 3, p.z); G.scene.add(light);

    SFX.play('phoenix'); SFX.duck(0.22, 2.0);
    G.fx.flash = 0.85; G.fx.flashColor.set(this.def.color);
    G.fx.addShake(0.6);
    G.world.arenaPulse();
    G.fx.ring(p, 0xffffff, { r0: 1, r1: 26, dur: 0.9, fade: 2 });
    G.fx.ring(p, this.def.color, { r0: 1, r1: 36, dur: 1.5, fade: 3 });

    for (const h of G.heroes) {
      if (h.dead) continue;
      if (h.downed) h.revive(1); else h.heal(h.maxHp);
      h.shield = Math.round(120 * (self.ultMul || 1) * G.mods.phoenixShield); h.maxShield = h.shield;
      h.buffs.speed = Math.max(h.buffs.speed, 0.4);
      h.buffTimer = 8;
      G.fx.ring(h.pos, self.def.color2, { r0: 0.4, r1: 4, dur: 0.6 });
      G.fx.attract({ x: h.pos.x, y: 0, z: h.pos.z }, h.center(), new THREE.Color(self.def.color), 40, { r: 4, life: 0.9, pull: 50 });
    }
    // wing-like particle sweep
    for (let i = 0; i < 200; i++) {
      const a = rand(TAU), r = rand(9, 1);
      G.fx.spawn({
        x: p.x + Math.cos(a) * r, y: rand(1, 0), z: p.z + Math.sin(a) * r,
        vx: Math.cos(a) * rand(5, 1), vy: rand(16, 6), vz: Math.sin(a) * rand(5, 1),
        color: new THREE.Color(Math.random() < 0.5 ? self.def.color : self.def.color2),
        life: rand(1.8, 0.9), size: rand(0.7, 0.3), drag: 1.1, grav: -1.5,
      });
    }

    G.addEffect({
      t: 0, dur: 2.6,
      update(dt) {
        this.t += dt;
        const k = this.t / this.dur;
        pillar.material.uniforms.uTime.value = G.time;
        pillar.material.uniforms.uFade.value = 1 - k;
        pillar.rotation.y += dt * 0.6;
        light.intensity = 12 * (1 - k);
        if (Math.random() < 0.9) {
          const a = Math.random() * TAU, r = rand(4.2, 1.5);
          G.fx.spawn({
            x: p.x + Math.cos(a) * r, y: 0.1, z: p.z + Math.sin(a) * r,
            vx: 0, vy: rand(20, 8), vz: 0, color: new THREE.Color(self.def.color),
            life: 1.2, size: 0.45, drag: 0.5, grav: 0,
          });
        }
        if (this.t >= this.dur) { disposeObj(G.scene, pillar); disposeObj(G.scene, light); return false; }
        return true;
      },
    });
  }

  /* ---- NYX ---- */
  railshot(G) {
    const self = this;
    const dir = new THREE.Vector3(this.aim.x, 0, this.aim.z).normalize();
    SFX.play('railCharge', { pan: G.panOf(this.pos) });
    // charge-up then fire
    G.addEffect({
      t: 0, fired: false,
      update(dt) {
        this.t += dt;
        self.charge = Math.min(1, this.t / 0.3);
        if (!this.fired && this.t >= 0.3) {
          this.fired = true;
          const from = self.handPos();
          const to = from.clone().addScaledVector(dir, 42);
          // hit everything along the line
          for (const e of G.enemies) {
            if (e.dead) continue;
            const v = new THREE.Vector3().subVectors(e.center(), from);
            const along = v.dot(dir);
            if (along < 0 || along > 42) continue;
            const perp = v.clone().addScaledVector(dir, -along).length();
            if (perp < 1.5 + e.radius) {
              const wasAlive = !e.dead;
              G.damageEnemy(e, 135, e.pos, { knock: 6, source: self });
              if (wasAlive && e.dead && G.mods.railRefund > 0) {
                self.cds[0] = Math.max(0, self.cds[0] - G.mods.railRefund);
              }
              G.fx.burst(e.center(), self.def.color, 26, { speed: 12, life: 0.5, size: 0.5 });
            }
          }
          SFX.play('railFire', { pan: G.panOf(self.pos) });
          G.fx.beam(from, to, 0xffffff, { w: 0.34, dur: 0.3, flare: 2 });
          G.fx.beam(from, to, self.def.color, { w: 0.85, dur: 0.42, flare: 1.6 });
          G.fx.beam(from, to, self.def.color2, { w: 1.6, dur: 0.5, flare: 1 });
          for (let i = 0; i < 60; i++) {
            const k = Math.random();
            const pp = from.clone().lerp(to, k);
            G.fx.spawn({
              x: pp.x, y: pp.y, z: pp.z, vx: rand(6, -6), vy: rand(6, -2), vz: rand(6, -6),
              color: new THREE.Color(self.def.color), life: rand(0.6, 0.2), size: rand(0.7, 0.3), drag: 2.4, grav: -3,
            });
          }
          G.fx.ring(from, self.def.color, { r0: 0.4, r1: 4, dur: 0.35, vertical: true, yaw: Math.atan2(dir.x, dir.z) });
          G.fx.sparkBurst(from, 0xffffff, 24, 26);
          G.fx.addShake(0.7);
          // recoil
          self.vel.addScaledVector(dir, -22);
          self.recoil = 1.6;
          self.charge = 0;
        }
        if (!this.fired) {
          const from = self.handPos();
          G.fx.attract({ x: from.x, y: from.y, z: from.z }, from, new THREE.Color(self.def.color), 3, { r: 1.6, life: 0.25, pull: 70 });
        }
        return this.t < 0.45;
      },
    });
  }

  swarm(G) {
    const self = this;
    const n = 12 + G.mods.swarmExtra;
    for (let i = 0; i < n; i++) {
      const a = this.facing + rand(1.2, -1.2);
      const from = this.drone ? this.drone.group.position.clone() : this.center();
      G.projectiles.fire({
        pos: from.clone().add(new THREE.Vector3(rand(0.5, -0.5), rand(0.5, -0.2), rand(0.5, -0.5))),
        dir: new THREE.Vector3(Math.sin(a), rand(0.5, 0.15), Math.cos(a)),
        speed: 31, dmg: 34, color: this.def.color2, size: 0.16, trail: 2.4,
        homing: 3.6, spiral: 3.4, life: 4, aoe: 2.2, spawnDelay: i * 0.045, owner: this,
      });
    }
    // staggered off the game clock, so it obeys pause and bullet-time
    G.addEffect({
      t: 0, n: 0,
      update(dt) {
        this.t += dt;
        if (this.n < 4 && this.t >= this.n * 0.09) { this.n++; SFX.play('missile', { pan: rand(0.6, -0.6), gap: 0 }); }
        return this.n < 4;
      },
    });
    G.fx.burst(this.center(), this.def.color2, 26, { speed: 8, life: 0.5, size: 0.4, rise: 4 });
    G.fx.ring(this.pos, this.def.color2, { r0: 0.5, r1: 4, dur: 0.4 });
  }

  singularity(G) {
    const self = this;
    const p = G.groundAim(this, 20).clone();
    p.y = 2.6;
    const SR = G.mods.singularityR;
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.1, 28, 22), new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(this.def.color) } },
      transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz);
        gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float uTime; uniform vec3 uCol; varying vec3 vN; varying vec3 vV;
        void main(){
          float f = pow(1.0-abs(dot(vN,vV)), 2.2);
          vec3 col = mix(vec3(0.0), uCol*2.4, f);
          col += vec3(1.0)*pow(f,6.0);
          gl_FragColor = vec4(col, 0.55 + f*0.45);
        }`,
    }));
    core.position.copy(p);
    G.scene.add(core);
    const accretion = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.5, 10, 48), addMat(this.def.color, 0.85));
    accretion.position.copy(p); accretion.rotation.x = Math.PI / 2.3;
    G.scene.add(accretion);
    const accretion2 = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.16, 8, 48), addMat(this.def.color2, 0.7));
    accretion2.position.copy(p); accretion2.rotation.x = Math.PI / 1.9; accretion2.rotation.z = 0.5;
    G.scene.add(accretion2);
    const light = new THREE.PointLight(this.def.color, 8, 34, 2);
    light.position.copy(p); G.scene.add(light);
    SFX.play('singularity', { pan: G.panOf(p) }); SFX.duck(0.3, 3.0);
    G.fx.addShake(0.5);
    G.fx.ring({ x: p.x, y: 0, z: p.z }, this.def.color, { r0: 0.5, r1: 14, dur: 0.8, fade: 2 });

    G.addEffect({
      t: 0, phase: 0,
      update(dt) {
        this.t += dt;
        core.material.uniforms.uTime.value = G.time;
        accretion.rotation.z += dt * 3.4;
        accretion2.rotation.z -= dt * 2.2;
        accretion.scale.setScalar(1 + Math.sin(this.t * 6) * 0.06);
        if (this.t < 3.0) {
          const R = 15 * SR;
          core.scale.setScalar(1 + Math.sin(this.t * 10) * 0.05 + this.t * 0.1);
          for (const e of G.enemies) {
            if (e.dead) continue;
            const d = flatDist(e.pos, p);
            if (d < R) {
              const f = (1 - d / R) * 40 * dt;
              e.pull.x += (p.x - e.pos.x) / (d || 1) * f;
              e.pull.z += (p.z - e.pos.z) / (d || 1) * f;
              G.damageEnemy(e, 26 * dt, e.pos, { silent: true, source: self, ult: true });
              e.slow = 0.4;
            }
          }
          if (Math.random() < 0.95) {
            const a = Math.random() * TAU, r = rand(15, 3);
            const sp = 3;
            G.fx.spawn({
              x: p.x + Math.cos(a) * r, y: rand(6, 0.2), z: p.z + Math.sin(a) * r,
              vx: -Math.sin(a) * sp, vy: 0, vz: Math.cos(a) * sp,
              color: new THREE.Color(Math.random() < 0.4 ? 0xffffff : self.def.color),
              life: 0.9, size: rand(0.55, 0.2), mode: 1, target: p, spin: 55, drag: 0.5,
            });
          }
          light.intensity = 6 + Math.sin(this.t * 12) * 2;
          G.fx.addShake(0.035);
        } else if (this.phase === 0) {
          this.phase = 1;
          for (const e of G.enemies) {
            if (e.dead) continue;
            const d = flatDist(e.pos, p);
            if (d < 16) G.damageEnemy(e, 360 * (1 - d / 24), p, { knock: 30, source: self, ult: true });
          }
          SFX.play('implode'); SFX.duck(0.2, 1.6);
          G.fx.flash = 1; G.fx.flashColor.set(self.def.color);
          G.fx.ring({ x: p.x, y: 0, z: p.z }, 0xffffff, { r0: 1, r1: 20, dur: 0.45 });
          G.fx.ring({ x: p.x, y: 0, z: p.z }, self.def.color, { r0: 1, r1: 22, dur: 0.85, fade: 2 });
          G.fx.ring({ x: p.x, y: 0, z: p.z }, self.def.color2, { r0: 1, r1: 28, dur: 1.3, fade: 3 });
          G.fx.burst(p, self.def.color, 220, { speed: 40, life: 1.3, size: 1.0, grav: -6 });
          G.fx.burst(p, 0xffffff, 90, { speed: 50, life: 0.5, size: 0.7 });
          G.fx.sparkBurst(p, self.def.color2, 80, 46);
          G.fx.addShake(1.5);
          G.world.arenaPulse();
          light.intensity = 40;
        } else {
          core.scale.multiplyScalar(Math.exp(-8 * dt));
          accretion.scale.multiplyScalar(1 + dt * 5);
          accretion.material.opacity *= Math.exp(-4.5 * dt);
          accretion2.scale.multiplyScalar(1 + dt * 7);
          accretion2.material.opacity *= Math.exp(-4.5 * dt);
          light.intensity *= Math.exp(-5 * dt);
          if (this.t > 4.4) {
            disposeObj(G.scene, core); disposeObj(G.scene, accretion); disposeObj(G.scene, accretion2); disposeObj(G.scene, light);
            return false;
          }
        }
        return true;
      },
    });
  }

  /* ---------------- per-frame ---------------- */
  update(dt, G) {
    if (this.dead) return;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    for (let i = 0; i < 3; i++) this.cds[i] = Math.max(0, this.cds[i] - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt * 5);
    this.castAnim = Math.max(0, this.castAnim - dt * 2.2);
    this.hurtAnim = Math.max(0, this.hurtAnim - dt * 4);
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) this.combo = 0;
    if (this.recoil) this.recoil = Math.max(0, this.recoil - dt * 6);
    if (this.buffTimer > 0) { this.buffTimer -= dt; if (this.buffTimer <= 0) { this.buffs.speed = 0; } }

    if (this.downed) {
      this.reviveT -= dt;
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      if (this.reviveT <= 0) this.revive(0.5);
      if (Math.random() < 0.4) {
        G.fx.spawn({
          x: this.pos.x + rand(0.8, -0.8), y: rand(0.6, 0.05), z: this.pos.z + rand(0.8, -0.8),
          vx: 0, vy: rand(1.4, 0.4), vz: 0, color: new THREE.Color(0xff3355), life: 0.8, size: 0.3, drag: 1, grav: 0,
        });
      }
    } else if (this.def.id === 'lyra') {
      /* ---------- LYRA'S DRONE ----------
         Passive triage when nobody is targeted; but aiming at an ally LOCKS the
         drone onto them for a much bigger stream, and overheal becomes shield.
         Piloting the healer is now an aiming skill, not a proximity check.      */
      let locked = null;
      if (this.controlled && G.aimPoint) {
        // nearest ally to the cursor, biased toward whoever is hurt — so aiming
        // at a clustered squad still picks the one who needs it
        const LOCK_R = 2.8 + (G.mods ? G.mods.lockRange : 0);
        let bestScore = LOCK_R;
        for (const h of G.heroes) {
          if (h.dead) continue;
          const d = flatDist(h.pos, G.aimPoint);
          if (d > LOCK_R) continue;
          const score = d - (1 - h.hp / h.maxHp) * 3.0 - (h.downed ? 2.0 : 0);
          if (score < bestScore) { bestScore = score; locked = h; }
        }
      }
      this.droneLock = locked;

      if (locked) {
        const rate = locked === this ? 11 : 17;           // self-repair is weaker
        const g = locked.heal(rate * dt, true);
        this.stats.heal += g;
        // a target already at full HP banks the stream as shield instead
        if (locked.hp >= locked.maxHp - 0.01) {
          locked.shield = Math.min(70, (locked.shield || 0) + rate * 0.6 * dt);
          locked.maxShield = Math.max(locked.maxShield || 0, 70);
          this.stats.heal += rate * 0.6 * dt;
        }
        if (!this._lockWas) { SFX.play('tether', { v: 0.5 }); G.popText(locked.center(), 'LOCK', '#7cf9ff', 1.0); }
        // beam + reticle
        if (this.drone) {
          const dp = this.drone.group.position;
          if (Math.random() < 0.9) {
            G.fx.spawn({
              x: dp.x, y: dp.y, z: dp.z,
              vx: rand(0.6, -0.6), vy: rand(0.4, -0.2), vz: rand(0.6, -0.6),
              color: this.color, life: 0.4, size: 0.34, mode: 1, target: locked.center(), spin: 34, drag: 0.4,
            });
          }
          if (Math.random() < 0.25) {
            G.fx.beam(dp.clone(), locked.center(), this.def.color2, { w: 0.09, dur: 0.1, flare: 0.8 });
          }
        }
        if (Math.random() < 0.4) G.fx.ring(locked.pos, this.def.color, { r0: 1.5, r1: 1.0, dur: 0.28, ease: 'in', y: 0.06 });
      } else {
        // passive triage: weakest ally, low throughput
        let ally = null, best = 1;
        for (const h of G.heroes) { if (h.downed || h.dead) continue; const f = h.hp / h.maxHp; if (f < best) { best = f; ally = h; } }
        if (ally && best < 0.999) {
          const g = ally.heal(6 * dt, true);
          this.stats.heal += g;
          if (Math.random() < 0.12 && this.drone) {
            G.fx.spawn({
              x: this.drone.group.position.x, y: this.drone.group.position.y, z: this.drone.group.position.z,
              vx: rand(1, -1), vy: rand(1, 0), vz: rand(1, -1),
              color: this.color, life: 0.55, size: 0.28, mode: 1, target: ally.center(), spin: 30, drag: 0.5,
            });
          }
        }
      }
      this._lockWas = !!locked;
    }

    // buffs decay (re-applied by effects each frame)
    this.buffs.dr = Math.max(0, this.buffs.dr - dt * 2);
    if (this.buffTimer <= 0) this.buffs.speed = Math.max(0, this.buffs.speed - dt * 0.8);

    // orientation
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.facing;
    const spd = Math.hypot(this.vel.x, this.vel.z) / this.def.speed;
    animateRig(this.rig, dt, {
      speed: clamp(spd, 0, 1.4), time: G.time, attack: this.attackAnim,
      cast: this.castAnim, dead: this.downed, hurt: this.hurtAnim,
      style: this.def.style, block: this.def.id === 'aegis',
    });

    // weapon flourishes
    if (this.pistol) {
      const c = 0.4 + this.charge * 3 + this.attackAnim * 2;
      this.pistol.coil.material.opacity = clamp(c, 0, 1);
      this.pistol.coil.scale.setScalar(1 + this.charge * 0.8);
      this.pistol.light.intensity = 0.5 + this.attackAnim * 5 + this.charge * 8;
      this.pistol.rails.forEach((r, i) => { r.material.opacity = 0.6 + this.charge * 0.4 + Math.sin(G.time * 10 + i) * 0.15; });
      if (this.charge > 0.05 && Math.random() < 0.6) {
        const mp = this.handPos();
        G.fx.spawn({ x: mp.x + rand(0.6, -0.6), y: mp.y + rand(0.6, -0.6), z: mp.z + rand(0.6, -0.6), vx: 0, vy: 0, vz: 0, color: this.color, life: 0.22, size: 0.35, mode: 1, target: mp, spin: 80, drag: 0.5 });
      }
    }
    if (this.gauntlets) {
      const g = 0.55 + this.attackAnim * 0.45 + (this.combo === 2 ? 0.3 : 0);
      this.gauntlets.L.knuck.material.opacity = g;
      this.gauntlets.R.knuck.material.opacity = g + this.attackAnim * 0.4;
      this.gauntlets.R.light.intensity = 0.9 + this.attackAnim * 6;
      this.gauntlets.L.light.intensity = 0.9;
    }
    if (this.gloves) {
      const g = 0.6 + 0.3 * Math.sin(G.time * 5) + this.attackAnim * 0.4;
      this.gloves.R.emitter.material.opacity = g;
      this.gloves.L.emitter.material.opacity = g * 0.8;
      this.gloves.R.ring.rotation.z += dt * 4;
      this.gloves.L.ring.rotation.z -= dt * 3;
    }
    if (this.drone) {
      const d = this.drone;
      if (this.droneLock && this.droneLock !== this) {
        // lean the drone toward whoever it is repairing
        const t = this.droneLock.center();
        d.group.position.x = damp(d.group.position.x, t.x, 4, dt);
        d.group.position.z = damp(d.group.position.z, t.z, 4, dt);
        d.group.position.y = damp(d.group.position.y, t.y + 1.0, 4, dt);
        d.eye.material.opacity = 1;
        if (d.light) d.light.intensity = 3.5;
        d.ringA.rotation.z += dt * 7;
        d.hull.rotation.x += dt * 2;
      } else {
      d.bob += dt;
      const off = new THREE.Vector3(Math.sin(this.facing + 2.3) * 1.15, 2.25 + Math.sin(d.bob * 2) * 0.16, Math.cos(this.facing + 2.3) * 1.15);
      d.group.position.lerp(new THREE.Vector3(this.pos.x + off.x, this.pos.y + off.y, this.pos.z + off.z), Math.min(1, dt * 7));
      d.group.rotation.y += dt * 1.4;
      d.ringA.rotation.z += dt * 3;
      d.hull.rotation.x += dt * 0.8;
      d.eye.material.opacity = 0.7 + 0.3 * Math.sin(G.time * 6);
      }
      d.group.visible = !this.downed;
    }

    // selection ring & chevron
    const sel = this.controlled;
    this.selRing.material.opacity = sel ? 0.32 + 0.14 * Math.sin(G.time * 5) : 0.0;
    this.selRing.scale.setScalar(sel ? 1 + 0.05 * Math.sin(G.time * 5) : 1);
    this.chev.visible = !sel && !this.downed;
    if (this.chev.visible) this.chev.position.y = 2.5 + Math.sin(G.time * 3 + this.index) * 0.12;
    this.overshieldMesh.material.opacity = this.shield > 0 ? 0.055 + 0.03 * Math.sin(G.time * 6) : 0;
    if (this.shield > 0) this.overshieldMesh.rotation.y += dt * 0.8;
  }

  /* ---------------- AI ---------------- */
  updateAI(dt, G, leader) {
    if (this.downed || this.dead) { this.move(dt, new THREE.Vector3()); return; }
    const target = G.nearestEnemy(this.pos, 40);
    const id = this.def.id;
    const preferred = id === 'aegis' ? 3.0 : id === 'lyra' ? 13 : 15;

    let dir = new THREE.Vector3();
    // formation slot behind leader
    const slotA = leader.facing + (this.index === 0 ? 2.4 : this.index === 1 ? -2.4 : Math.PI);
    const slot = new THREE.Vector3(
      leader.pos.x + Math.sin(slotA) * (id === 'aegis' ? 3.5 : 4.5),
      0,
      leader.pos.z + Math.cos(slotA) * (id === 'aegis' ? 3.5 : 4.5)
    );
    const distLeader = flatDist(this.pos, leader.pos);

    if (target && distLeader < 26) {
      const d = flatDist(this.pos, target.pos);
      this.facing += shortAngle(this.facing, angleTo(this.pos, target.pos)) * Math.min(1, dt * 9);
      this.aim.set(Math.sin(this.facing), 0, Math.cos(this.facing));
      if (d > preferred) {
        dir.set(target.pos.x - this.pos.x, 0, target.pos.z - this.pos.z).normalize();
      } else if (d < preferred * 0.65) {
        dir.set(this.pos.x - target.pos.x, 0, this.pos.z - target.pos.z).normalize().multiplyScalar(0.8);
      } else {
        const a = angleTo(this.pos, target.pos) + Math.PI / 2;
        dir.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(Math.sin(G.time * 0.7 + this.index) * 0.7);
      }
      // pull back toward leader if straying
      if (distLeader > 20) dir.add(new THREE.Vector3(slot.x - this.pos.x, 0, slot.z - this.pos.z).normalize().multiplyScalar(1.2));
      if (d < (id === 'aegis' ? 3.6 : 34)) this.tryAttack(G);

      // skill usage heuristics
      const nearCount = G.countEnemiesNear(this.pos, 9);
      const weakest = G.weakestHero();
      if (id === 'aegis') {
        if (this.cds[0] <= 0 && nearCount >= 2 && d < 5) this.useSkill(0, G);
        else if (this.cds[1] <= 0 && (this.hp / this.maxHp < 0.6 || nearCount >= 3)) this.useSkill(1, G);
        else if (this.energy >= 100 && G.countEnemiesNear(this.pos, 15) >= 4) this.useSkill(2, G);
      } else if (id === 'lyra') {
        if (this.cds[0] <= 0 && weakest && weakest.hp / weakest.maxHp < 0.75) this.useSkill(0, G);
        else if (this.cds[1] <= 0 && weakest && weakest.hp / weakest.maxHp < 0.6) this.useSkill(1, G);
        else if (this.energy >= 100 && (G.downedCount() > 0 || (weakest && weakest.hp / weakest.maxHp < 0.3))) this.useSkill(2, G);
      } else {
        if (this.energy >= 100 && G.ultChainT > 0 && G.countEnemiesNear(target.pos, 14) >= 2) this.useSkill(2, G);
        else if (this.cds[0] <= 0 && d > 6) this.useSkill(0, G);
        else if (this.cds[1] <= 0 && nearCount >= 1) this.useSkill(1, G);
        else if (this.energy >= 100 && G.countEnemiesNear(target.pos, 12) >= 4) this.useSkill(2, G);
      }
      // dodge
      if (this.dashCd <= 0 && this.hp / this.maxHp < 0.4 && d < 5 && Math.random() < dt * 2) this.dash();
    } else {
      const dd = flatDist(this.pos, slot);
      if (dd > 1.6) dir.set(slot.x - this.pos.x, 0, slot.z - this.pos.z).normalize().multiplyScalar(clamp(dd / 6, 0.4, 1));
      const fa = leader.facing;
      this.facing += shortAngle(this.facing, dir.lengthSq() > 0.01 ? Math.atan2(dir.x, dir.z) : fa) * Math.min(1, dt * 6);
    }
    this.move(dt, dir);
  }
}
