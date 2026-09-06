import * as THREE from 'three';
import { addMat, metalMat, rand, clamp, TAU, flatDist } from './util.js';
import { SFX } from './audio.js';

/* ============================================================
   PICKUPS — charge shards and full CHARGE CORES dropped by kills.
   Shards trickle ult energy in; a Core fills the whole squad and
   is what makes a 3-hero ULTIMATE CHAIN possible.
   ============================================================ */

export class Pickup {
  constructor(G, type, x, z) {
    this.G = G;
    this.type = type;                 // 'shard' | 'core'
    this.core = type === 'core';
    this.pos = new THREE.Vector3(x, this.core ? 1.5 : 1.0, z);
    this.vel = new THREE.Vector3(rand(3, -3), rand(7, 4), rand(3, -3));
    this.life = this.core ? 26 : 15;
    this.dead = false;
    this.t = rand(6);
    this.magnet = 0;

    const col = this.core ? 0xffe36a : 0xffb14a;
    const g = new THREE.Group();
    const size = this.core ? 0.62 : 0.3;
    this.shell = new THREE.Mesh(
      this.core ? new THREE.IcosahedronGeometry(size, 0) : new THREE.OctahedronGeometry(size, 0),
      addMat(col, 0.95)
    );
    g.add(this.shell);
    this.cage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size * 1.7, 0),
      new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    g.add(this.cage);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(size * 2.1, size * 0.09, 6, 24), addMat(this.core ? 0xffffff : col, 0.7));
    this.ring.rotation.x = Math.PI / 2;
    g.add(this.ring);
    if (this.core) {
      this.ring2 = new THREE.Mesh(new THREE.TorusGeometry(size * 2.6, size * 0.05, 6, 26), addMat(0xff8a2b, 0.6));
      this.ring2.rotation.set(Math.PI / 2.4, 0.4, 0);
      g.add(this.ring2);
      // beacon column so you can see it across the arena
      this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 16, 12, 1, true), addMat(col, 0.16));
      this.beam.position.y = 7;
      g.add(this.beam);
    }
    this.light = new THREE.PointLight(col, this.core ? 5 : 1.6, this.core ? 16 : 6, 2);
    g.add(this.light);

    const disc = new THREE.Mesh(new THREE.RingGeometry(size * 2.2, size * 2.9, 24), addMat(col, 0.6));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -this.pos.y + 0.06;
    g.add(disc);
    this.disc = disc;

    g.position.copy(this.pos);
    this.group = g;
    G.scene.add(g);

    G.fx.ring({ x, y: 0, z }, col, { r0: 0.3, r1: this.core ? 6 : 2.2, dur: 0.5 });
    if (this.core) {
      G.fx.burst({ x, y: 1, z }, col, 60, { speed: 10, life: 0.9, size: 0.6, rise: 4 });
      SFX.play('coreDrop', { pan: G.panOf({ x }) });
    }
  }

  update(dt, G) {
    this.t += dt;
    this.life -= dt;
    if (this.life <= 0) return this.remove(G, false);

    // physics settle
    this.vel.y -= 22 * dt;
    this.pos.addScaledVector(this.vel, dt);
    const floor = this.core ? 1.5 : 1.0;
    if (this.pos.y < floor) { this.pos.y = floor; this.vel.y *= -0.35; this.vel.x *= 0.6; this.vel.z *= 0.6; }
    this.vel.x *= Math.exp(-2.4 * dt); this.vel.z *= Math.exp(-2.4 * dt);

    // magnet toward the closest hero
    const mg = (G.mods ? G.mods.magnet : 1);
    let best = null, bd = (this.core ? 12 : 8) * mg;
    for (const h of G.heroes) {
      if (h.downed || h.dead) continue;
      const d = flatDist(h.pos, this.pos);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) {
      this.magnet = Math.min(1, this.magnet + dt * 2.2);
      const k = this.magnet * 26 * dt;
      this.pos.x += (best.pos.x - this.pos.x) / Math.max(0.4, bd) * k;
      this.pos.z += (best.pos.z - this.pos.z) / Math.max(0.4, bd) * k;
      this.pos.y += ((best.pos.y + 1.1) - this.pos.y) * Math.min(1, dt * 3);
      if (bd < 1.3) return this.collect(G, best);
    }

    const bob = Math.sin(this.t * 3) * 0.14;
    this.group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.shell.rotation.y += dt * 2.2;
    this.shell.rotation.x += dt * 1.4;
    this.cage.rotation.y -= dt * 1.1;
    this.cage.rotation.z += dt * 0.7;
    this.ring.rotation.z += dt * 2.6;
    if (this.ring2) this.ring2.rotation.z -= dt * 1.9;
    this.disc.position.y = -(this.pos.y + bob) + 0.06;
    const flick = 0.7 + 0.3 * Math.sin(this.t * (this.core ? 9 : 6));
    this.shell.material.opacity = flick;
    this.light.intensity = (this.core ? 4 : 1.4) * flick;
    if (this.beam) this.beam.material.opacity = 0.10 + 0.08 * flick;
    // blink out near expiry
    if (this.life < 3) this.group.visible = Math.sin(this.life * 18) > -0.2;

    if (Math.random() < (this.core ? 0.9 : 0.3)) {
      G.fx.spawn({
        x: this.pos.x + rand(0.6, -0.6), y: this.pos.y + rand(0.6, -0.6), z: this.pos.z + rand(0.6, -0.6),
        vx: 0, vy: rand(1.6, 0.2), vz: 0,
        color: new THREE.Color(this.core ? 0xffe36a : 0xffb14a),
        life: 0.5, size: this.core ? 0.42 : 0.26, drag: 1.6, grav: 0,
      });
    }
    return true;
  }

  collect(G, hero) {
    const col = this.core ? 0xffe36a : 0xffb14a;
    if (this.core) {
      G.coresTaken = (G.coresTaken || 0) + 1;
      for (const h of G.heroes) {
        h.addEnergy(h.maxEnergy);
        G.fx.ring(h.pos, col, { r0: 0.4, r1: 4.5, dur: 0.55 });
        G.fx.attract({ x: h.pos.x, y: 0, z: h.pos.z }, h.center(), new THREE.Color(col), 26, { r: 3.5, life: 0.7, pull: 46 });
      }
      G.fx.ring(this.pos, 0xffffff, { r0: 0.5, r1: 16, dur: 0.7, fade: 2 });
      G.fx.burst(this.pos, col, 120, { speed: 20, life: 1.0, size: 0.7 });
      G.fx.addShake(0.5);
      G.fx.flash = 0.4; G.fx.flashColor.set(0xffe36a);
      G.world.arenaPulse();
      G.ui.banner('Charge Core', 'SQUAD OVERCHARGED');
      G.ui.feed('ALL ULTIMATES ONLINE — CHAIN THEM', '#ffe36a');
      SFX.play('coreGet');
    } else {
      const sv = (G.mods ? G.mods.shardValue : 1);
      hero.addEnergy(24 * sv);
      for (const h of G.heroes) if (h !== hero) h.addEnergy(11 * sv);
      G.fx.ring(this.pos, col, { r0: 0.3, r1: 2.2, dur: 0.35 });
      G.fx.burst(this.pos, col, 16, { speed: 7, life: 0.4, size: 0.35 });
      SFX.play('shardGet', { pan: G.panOf(this.pos), gap: 0.05 });
    }
    return this.remove(G, true);
  }

  remove(G) {
    this.dead = true;
    G.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    return false;
  }
}
