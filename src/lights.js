import * as THREE from 'three';

/* ============================================================
   LIGHT POOL — a fixed set of PointLights for the whole session.

   three.js bakes the light COUNT into the shader program cache key:

     WebGLPrograms.getParameters():   numPointLights: lights.point.length
     getProgramCacheKeyParameters():  array.push( parameters.numPointLights )
     WebGLProgram:                    .replace( /NUM_POINT_LIGHTS/g, ... )

   So every light added or removed makes every material in the frame compile a
   fresh program. Spawns, deaths, dropped shards and ability casts all used to
   do exactly that: 45 live enemies meant 45 point lights (one per enemy,
   entities.js) plus one per live shard (pickups.js), and the fragment shader
   looped over all of them for every lit pixel.

   The pool is created once at boot. Unassigned lights stay in the scene at
   intensity 0, parked under the floor, so the count never changes and no
   program is ever recompiled for lighting. They must stay `visible = true` —
   projectObject() skips invisible objects before it ever reaches the isLight
   branch, so hiding a spare would change the count and defeat the point.

   A leaked slot is benign by construction: it costs a glow, never a hitch.
   ============================================================ */

const PARK_Y = -200;                 // under the floor, outside every radius
const KINDS = ['enemy', 'pickup', 'effect'];

export class LightPool {
  constructor(scene, budget) {
    this.scene = scene;
    this.slots = { enemy: [], pickup: [], effect: [] };
    this.free = { enemy: [], pickup: [], effect: [] };
    this.budget = { enemy: 0, pickup: 0, effect: 0 };
    this._taken = new Set();
    this.setBudget(budget);
  }

  /** Create or trim slots. Only call at boot or from the dev overlay:
      changing the count is precisely what recompiles the programs.
      Takes BALANCE.perf directly (lightsEnemy / lightsPickup / lightsEffect). */
  setBudget(b) {
    const wantOf = {
      enemy: b?.lightsEnemy,
      pickup: b?.lightsPickup,
      effect: b?.lightsEffect,
    };
    for (const kind of KINDS) {
      const want = Math.max(0, Math.round(wantOf[kind] || 0));
      const slots = this.slots[kind], free = this.free[kind];
      while (slots.length < want) {
        const l = new THREE.PointLight(0xffffff, 0, 1, 2);
        l.position.set(0, PARK_Y, 0);
        l.castShadow = false;
        l.userData.kind = kind;
        l.userData.owner = null;
        this.scene.add(l);
        slots.push(l); free.push(l);
      }
      while (slots.length > want) {
        const l = slots.pop();
        const i = free.indexOf(l);
        if (i >= 0) free.splice(i, 1);
        if (l.userData.owner) { l.userData.owner.light = null; l.userData.owner = null; }
        this.scene.remove(l);
        l.dispose();
      }
      this.budget[kind] = want;
    }
    return this;
  }

  /** Point `kind`'s slots at the members of `list` nearest `focus`, writing
      `.light` on the winners and nulling it on everyone else — so callers can
      just test `if (this.light)`. Runs once a frame; slots live in the scene
      root and are never re-parented, so the light count cannot change.
      `bias(o)` is subtracted from the squared distance (use it to guarantee a
      slot for the boss or for Charge Cores). Allocation-free. */
  assignNearest(kind, list, focus, bias) {
    const slots = this.slots[kind];
    for (const l of slots) {
      if (l.userData.owner) { l.userData.owner.light = null; l.userData.owner = null; }
      l.intensity = 0;
    }
    if (!slots.length || !list || !list.length || !focus) return 0;

    const taken = this._taken;
    taken.clear();
    let n = 0;
    for (const l of slots) {
      let best = null, bestD = Infinity;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (!o || o.dead || taken.has(o)) continue;
        const dx = o.pos.x - focus.x, dz = o.pos.z - focus.z;
        const d = dx * dx + dz * dz - (bias ? bias(o) : 0);
        if (d < bestD) { bestD = d; best = o; }
      }
      if (!best) break;
      taken.add(best);
      l.userData.owner = best;
      best.light = l;
      n++;
    }
    return n;
  }

  /** Transient lights for abilities. Returns null when the kind is exhausted —
      callers must tolerate that (the ability still plays, just unlit). */
  acquire(kind) {
    const free = this.free[kind];
    if (!free || !free.length) return null;
    const l = free.pop();
    l.userData.owner = null;
    return l;
  }

  /** Return a light to the pool. Safe to call twice, and safe with null. */
  release(l) {
    if (!l) return;
    const kind = l.userData.kind;
    const free = this.free[kind];
    l.intensity = 0;
    l.position.set(0, PARK_Y, 0);
    l.userData.owner = null;
    if (free && !free.includes(l)) free.push(l);
  }

  /** Style a pooled light in one call (abilities set wildly different looks). */
  set(l, color, intensity, distance, decay = 2) {
    if (!l) return null;
    l.color.set(color);
    l.intensity = intensity;
    l.distance = distance;
    l.decay = decay;
    return l;
  }

  /** Total lights this pool holds — the number the renderer will compile for. */
  get size() { return this.slots.enemy.length + this.slots.pickup.length + this.slots.effect.length; }

  /** Every light currently doing something. Diagnostic for the dev overlay. */
  get active() {
    let n = 0;
    for (const k of KINDS) for (const l of this.slots[k]) if (l.intensity > 0) n++;
    return n;
  }

  /** Drop every assignment — used when a run resets. */
  clear() {
    for (const k of KINDS) {
      for (const l of this.slots[k]) {
        if (l.userData.owner) { l.userData.owner.light = null; l.userData.owner = null; }
        l.intensity = 0;
        l.position.set(0, PARK_Y, 0);
        if (!this.free[k].includes(l)) this.free[k].push(l);
      }
    }
  }
}
