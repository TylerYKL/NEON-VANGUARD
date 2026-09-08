import * as THREE from 'three';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
import { clamp } from './util.js';

/* ============================================================
   SKILL FX PACK — the data + runtime layer behind the Hero
   Studio's "SKILL EFFECT" editor.

   A hero has one FX slot per skill (Q / E / R) plus a shared slot
   that covers every skill (the pre-per-skill behaviour, kept for
   compatibility). Each assignment is a file URL + a small parameter
   block, so the studio edits *how the effect reads in the match* —
   not only which file is bolted on to the hero.

   Everything expensive is cached and reused, in the spirit of the
   pooling invariant (HANDOFF §4.1):
     * cloned GLB subtrees come back from a per-entry free list
     * tinted / re-blended material sets are cached per signature, so
       N concurrent casts of one tuned effect allocate nothing
     * one <video> element + VideoTexture per file, refcounted,
       instead of a decoder per cast
   `kill()` disposes NOTHING: a cast that needs its own material set (because it
   fades or goes translucent) recycles it through a per-look free list, so no
   cast ever drops a shader program. The Hero Studio drives the same `spawnFX`,
   which is why an effect that looks right in the editor is the object the match
   draws.
   ============================================================ */

export const FX_SLOTS = 3;               // skills per hero: Q / E / R
export const FX_SHARED = -1;             // "applies to every skill" (legacy)

/* ---------- parameter table: the studio builds its rows from this ---------- */

/* [key, label, min, max, step, kinds]   kinds: [] = both kinds */
export const FX_NUM_DEFS = [
  ['scale', 'scale', 0.1, 4, 0.01, []],
  ['y', 'height', 0, 4, 0.01, []],
  ['dur', 'duration s', 0.15, 5, 0.05, []],
  ['grow', 'grow', -0.8, 3, 0.01, []],
  ['spin', 'spin /s', -12, 12, 0.1, []],
  ['rise', 'rise', -2, 5, 0.01, []],
  ['fade', 'fade tail', 0, 0.95, 0.01, []],
  ['opacity', 'opacity', 0.05, 1, 0.01, []],
  ['light', 'glow light', 0, 24, 0.5, []],
  ['rate', 'clip rate', 0.25, 3, 0.01, ['video']],
];

/* enumerated rows: the stored value is the index into `opts` */
export const FX_OPT_DEFS = [
  ['blend', 'blend', ['as authored', 'additive', 'alpha'], ['glb'], 0],
  ['vblend', 'video blend', ['additive', 'alpha'], ['video'], 0],
  ['face', 'facing', ['skill dir', 'face cam'], ['video'], 1],
  ['loop', 'clip', ['play once', 'loop'], ['video'], 0],
];

export const FX_COLOR_DEFS = [['tint', 'tint']];

const NUM_RANGE = {};
for (const row of FX_NUM_DEFS) NUM_RANGE[row[0]] = [row[2], row[3]];
const OPT_SET = {};
for (const row of FX_OPT_DEFS) OPT_SET[row[0]] = row[2].length;

/** Defaults differ by kind: a GLB prop sits on the deck, a video billboard
    floats at chest height and runs for about as long as the clip. */
/* Each kind stores only the rows it can actually use, so a slot keeps a clean
    block and switching a slot between a prop and a clip resets just the rows
    that changed meaning. */
export const DEFAULT_FX = {
  glb: {
    scale: 1, y: 0.05, dur: 1.1, grow: 0.4, spin: 2.4, rise: 0.8, fade: 0.35,
    opacity: 1, light: 6, blend: 0, tint: '#ffffff',
  },
  video: {
    scale: 1, y: 1.15, dur: 1.6, grow: 0.55, spin: 0, rise: 0.35, fade: 0.3,
    opacity: 1, light: 4, rate: 1, vblend: 0, face: 1, loop: 0, tint: '#ffffff',
  },
};

export const fxKind = (url) => (/\.(mp4|webm|ogv)$/i.test(String(url || '')) ? 'video' : 'glb');

/** Which rows one kind of effect exposes (the studio renders exactly these). */
export function fxDefsFor(kind) {
  const on = (row, i) => !row[i].length || row[i].indexOf(kind) >= 0;
  return {
    num: FX_NUM_DEFS.filter((r) => on(r, 5)),      // [key, label, min, max, step, kinds]
    opt: FX_OPT_DEFS.filter((r) => on(r, 3)),      // [key, label, opts, kinds, default]
  };
}

/** Sanitise one parameter block. Unknown / non-finite input never reaches the
    renderer: a NaN scale poisons the bloom chain and blacks out the whole
    frame (HANDOFF §4.8), so everything is clamped at the load boundary. */
export function clampFX(raw, kind) {
  const base = DEFAULT_FX[kind === 'video' ? 'video' : 'glb'];
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k in base) {
    if (k === 'tint') continue;
    if (NUM_RANGE[k]) {
      const v = Number(src[k]);
      const [min, max] = NUM_RANGE[k];
      out[k] = Number.isFinite(v) ? clamp(v, min, max) : base[k];
    } else {
      const n = OPT_SET[k] || 2;
      const v = Number(src[k]);
      out[k] = Number.isFinite(v) ? Math.round(clamp(v, 0, n - 1)) : base[k];
    }
  }
  const t = String(src.tint || '');
  out.tint = /^#[0-9a-f]{6}$/i.test(t) ? t.toLowerCase() : base.tint;
  return out;
}

/* ---------- which file does a cast use? ---------- */

/** Resolve the assignment for one hero + skill slot, falling back to the
    shared slot so a hero tuned before per-skill FX keeps working untouched. */
export function fxFor(tuning, heroId, slot) {
  const t = (tuning || {})[heroId];
  if (!t) return null;
  if (slot >= 0) {
    const s = t.fxSlots && t.fxSlots[slot];
    if (s && s.src && s.on !== false) return s;
  }
  if (t.fx && t.fxOn !== false) return { src: t.fx, on: true, p: t.fxP, shared: true };
  return null;
}

/** The record the Hero Studio edits, materialised so tuning survives before a
    file lands in a slot. Lives next to `fxFor` on purpose: editor and runtime
    read the same shape through the same door, so they cannot drift.
    `setSrc` / `setOn` / `setP` write straight through to the config object. */
export function fxEdit(tuning, heroId, slot) {
  const c = (tuning || {})[heroId];
  if (!c) return null;
  if (slot === FX_SHARED) {
    if (!c.fxP) c.fxP = clampFX(null, 'glb');
    return {
      src: c.fx || null, on: c.fxOn !== false, p: c.fxP,
      setSrc: (v) => { c.fx = v || null; },
      setOn: (v) => { c.fxOn = !!v; },
      setP: (v) => { c.fxP = v; },
    };
  }
  if (!Array.isArray(c.fxSlots)) c.fxSlots = [];
  let s = c.fxSlots[slot];
  if (!s) s = c.fxSlots[slot] = { src: null, on: true, p: clampFX(null, 'glb') };
  if (!s.p) s.p = clampFX(null, 'glb');
  return {
    src: s.src || null, on: s.on !== false, p: s.p,
    setSrc: (v) => { s.src = v || null; },
    setOn: (v) => { s.on = !!v; },
    setP: (v) => { s.p = v; },
  };
}

/** Which parameter block a LIBRARY PREVIEW should use for a file that may not be
    assigned to anything. The studio fires previews through the same `spawnFX` as
    a real cast, and it must not have to touch the config to do it, so the lookup
    is: the slot being edited (if it already holds this file) → the hero's shared
    slot → any other slot of this hero → kind defaults. Read-only by construction:
    `clampFX` returns a fresh object, so a preview can never mutate the tuning. */
export function fxPreviewFor(tuning, heroId, slot, url) {
  const kind = fxKind(url);
  const c = (tuning || {})[heroId];
  if (c) {
    const s = slot >= 0 && c.fxSlots ? c.fxSlots[slot] : null;
    if (s && s.src === url) return { p: clampFX(s.p, kind), from: 'slot' };
    if (c.fx === url) return { p: clampFX(c.fxP, kind), from: 'shared' };
    for (let i = 0; i < FX_SLOTS; i++) {
      const o = c.fxSlots && c.fxSlots[i];
      if (o && o.src === url) return { p: clampFX(o.p, kind), from: 'slot' + i };
    }
  }
  return { p: clampFX(null, kind), from: 'defaults' };
}

/** How many slots across the roster hold a file — the studio's save readout. */
export function fxCount(tuning) {
  let n = 0;
  for (const t of Object.values(tuning || {})) {
    if (!t) continue;
    if (t.fx) n++;
    for (const s of t.fxSlots || []) if (s && s.src) n++;
  }
  return n;
}

/** Every distinct file any hero references — what the bank has to preload. */
export function fxSources(tuning) {
  const set = new Set();
  for (const t of Object.values(tuning || {})) {
    if (!t) continue;
    if (t.fx) set.add(t.fx);
    for (const s of t.fxSlots || []) if (s && s.src) set.add(s.src);
  }
  return [...set];
}

/* ---------- shared material sets, cached per look ---------- */

const matCache = new Map();

const needsOverride = (p) => p.tint !== '#ffffff' || p.opacity < 1 || p.blend !== 0;   // glb only
/** per-instance opacity (fade / translucency) needs material nobody else holds */
const needsOwn = (p) => p.fade > 0 || p.opacity < 1;

const fadeMats = (list, p) => list.map((m) => {
  const make = (x) => {
    const c = x.clone();
    c.transparent = true;
    c.depthWrite = false;
    c.opacity = p.opacity;
    return c;
  };
  return Array.isArray(m) ? m.map(make) : make(m);
});

/** tint / blending overrides, shared by every cast that asks for the same look */
function overrideMats(entry, p) {
  const sig = entry.template.uuid + '|' + p.tint + '|' + p.opacity + '|' + p.blend;
  let set = matCache.get(sig);
  if (set) return set;
  const tint = new THREE.Color(p.tint);
  set = [];
  entry.template.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const made = list.map((m) => {
      const c = m.clone();
      c.transparent = true;
      c.depthWrite = false;
      c.opacity = p.opacity;
      if (p.blend === 1) c.blending = THREE.AdditiveBlending;
      else if (p.blend === 2) c.blending = THREE.NormalBlending;
      if (c.color) c.color.multiply(tint);
      if (c.emissive) {
        c.emissive.copy(tint).multiplyScalar(0.35);
        if (c.emissiveIntensity !== undefined) c.emissiveIntensity = Math.max(0.6, c.emissiveIntensity || 1);
      }
      return c;
    });
    set.push(Array.isArray(o.material) ? made : made[0]);
  });
  matCache.set(sig, set);
  return set;
}

/* Per-instance material sets (a cast that fades or goes translucent cannot share
   them) come from a free list keyed by look, and go back to it on kill. Disposing
   them instead would drop the program refcount between casts and make the next one
   recompile — the exact hitch invariant 12 in HANDOFF.md is about avoiding. */
const poolRegistry = [];
function takeSet(pools, sig, make) {
  if (poolRegistry.indexOf(pools) < 0) poolRegistry.push(pools);
  const pool = pools[sig] || (pools[sig] = []);
  return pool.length ? pool.pop() : make();
}
function giveSet(pools, sig, set) {
  const pool = pools[sig] || (pools[sig] = []);
  if (pool.length < 8) pool.push(set);
}

const collectMats = (root) => {
  const out = [];
  root.traverse((o) => { if (o.isMesh && o.material) out.push(o.material); });
  return out;
};
const assignMats = (root, set) => {
  let i = 0;
  root.traverse((o) => { if (o.isMesh && o.material) o.material = set[i++ % set.length]; });
};

/* ---------- video cache: one element + texture per file, refcounted ---------- */

const vids = new Map();
export const videoOf = (url) => vids.get(url);

export function acquireVideo(url) {
  let v = vids.get(url);
  if (!v) {
    const el = document.createElement('video');
    el.src = url;
    el.muted = true; el.loop = false; el.playsInline = true; el.preload = 'auto';
    const tex = new THREE.VideoTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    v = { url, el, tex, users: 0, playing: false };
    vids.set(url, v);
  }
  v.users++;
  return v;
}

export function releaseVideo(v) {
  if (!v) return;
  v.users = Math.max(0, v.users - 1);
  if (v.users === 0 && v.playing) {
    try { v.el.pause(); } catch (e) { /* detached / not playable in this env */ }
    v.playing = false;
  }
}

const vidMatCache = new Map();
const vidMatPools = {};
function videoBaseMat(v, p) {
  const sig = v.url + '|' + p.tint + '|' + p.vblend;
  let m = vidMatCache.get(sig);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: v.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: p.vblend === 1 ? THREE.NormalBlending : THREE.AdditiveBlending,
      color: new THREE.Color(p.tint), toneMapped: false,
    });
    vidMatCache.set(sig, m);
  }
  return m;
}

/* one unit quad, plus a free list of billboard meshes, for the life of the page */
let PLANE = null;
const plane = () => (PLANE || (PLANE = new THREE.PlaneGeometry(1, 1)));
const quadPool = [];

/* ---------- the runtime instance ---------- */

const easeOut = (k) => 1 - (1 - k) * (1 - k);
const VID_SIZE = 3.2;                    // world units at scale = 1

/**
 * Spawn a bank entry (`loadFXBank` output) at `at`, tuned by `p`.
 * Returns a handle the caller drives from its coroutine:
 *   update(dt) -> alive,   kill() -> release everything borrowed.
 * kill() is idempotent so a run reset can clean up live effects.
 */
export function spawnFX(G, entry, p, at, facing = 0) {
  const dur = Math.max(0.05, p.dur);
  const video = entry.kind === 'video';
  let obj, own = null, ownSig = '', base = null, vid = null, light = null;

  if (video) {
    vid = acquireVideo(entry.url);
    base = videoBaseMat(vid, p);
    /* a cast that fades owns its material — pooled per look, never disposed */
    if (needsOwn(p)) {
      ownSig = 'v|' + p.tint + '|' + p.vblend + '|' + p.opacity;
      own = takeSet(vidMatPools, ownSig, () => fadeMats([base], p));
    }
    obj = quadPool.pop() || new THREE.Mesh(plane(), null);
    obj.material = own ? own[0] : base;
    obj.renderOrder = 15;
    try {
      vid.el.loop = !!p.loop;
      vid.el.playbackRate = p.rate;
      if (typeof vid.el.currentTime === 'number') vid.el.currentTime = 0;
      const pr = vid.el.play && vid.el.play();
      if (pr && pr.catch) pr.catch(() => {});
      vid.playing = true;
    } catch (e) { /* autoplay refused: the decoded frame still shows */ }
  } else {
    const pool = entry.pool || (entry.pool = []);
    /* skeleton-isolated for the same reason hero bodies are (MOTION-AUDIT §4 phase A):
       a skinned FX file cloned with `template.clone(true)` would deform from the
       template's bones, so every concurrent cast would animate together. For the static
       meshes every FX file is today, `cloneRig` behaves exactly like a deep clone. */
    obj = pool.pop() || cloneRig(entry.template);
    if (!obj.userData.fxMats) obj.userData.fxMats = collectMats(obj);   // authored set, for hand-back
    if (needsOverride(p)) base = overrideMats(entry, p);
    if (needsOwn(p)) {
      ownSig = 'g|' + p.tint + '|' + p.blend + '|' + p.opacity;
      own = takeSet(entry.matPools || (entry.matPools = {}), ownSig,
        () => fadeMats(base || obj.userData.fxMats, p));
      assignMats(obj, own);
    } else if (base) assignMats(obj, base);
  }

  const anchor = { x: at.x, y: at.y, z: at.z };
  /* sizeAt(k) is used at spawn too, so a billboard never shows one wrong frame */
  const sizeAt = (k) => p.scale * (1 + p.grow * easeOut(k));
  obj.visible = true;
  obj.position.set(anchor.x, anchor.y, anchor.z);
  obj.rotation.set(0, facing, 0);
  if (video) { const w = VID_SIZE * sizeAt(0); obj.scale.set(w, w, 1); }
  else obj.scale.setScalar(sizeAt(0));
  if (G.scene) G.scene.add(obj);

  if (p.light > 0 && G.lights && G.lights.acquire) {
    light = G.lights.acquire('effect');
    if (light) {
      G.lights.set(light, p.tint, p.light, 20, 2);
      light.position.set(anchor.x, anchor.y + 0.4, anchor.z);
    }
  }

  let t = 0, dead = false;

  function kill() {
    if (dead) return;
    dead = true;
    if (G.scene) G.scene.remove(obj);
    if (light) { light.intensity = 0; if (G.lights.release) G.lights.release(light); light = null; }
    if (vid) { releaseVideo(vid); vid = null; }
    if (own) {
      giveSet(video ? vidMatPools : (entry.matPools || (entry.matPools = {})), ownSig, own);
      own = null;
    }
    if (video) {
      obj.material = null;
      if (quadPool.length < 8) quadPool.push(obj);
    } else {
      assignMats(obj, obj.userData.fxMats);        // drop overrides before pooling
      obj.scale.setScalar(1);
      obj.rotation.set(0, 0, 0);
      obj.position.set(0, -50, 0);
      const pool = entry.pool || (entry.pool = []);
      if (pool.indexOf(obj) < 0) { pool.push(obj); while (pool.length > 8) pool.shift(); }
    }
  }

  return {
    obj,
    kill,
    get alive() { return !dead; },
    update(dt) {
      if (dead) return false;
      t += dt;
      const k = Math.min(1, t / dur);
      if (video) {
        const w = VID_SIZE * sizeAt(k);
        obj.scale.set(w, w, 1);
        if (p.face === 1 && G.camera) { obj.lookAt(G.camera.position); obj.rotateZ(p.spin * t); }
        else obj.rotation.set(0, facing + p.spin * t, 0);
      } else {
        obj.scale.setScalar(sizeAt(k));
        obj.rotation.y = facing + p.spin * t;
      }
      obj.position.y = anchor.y + p.rise * k;
      const fade = p.fade > 0 && k > 1 - p.fade ? (1 - k) / p.fade : 1;
      if (own) for (const m of own) { const arr = Array.isArray(m) ? m : [m]; for (const x of arr) x.opacity = p.opacity * fade; }
      if (light) light.intensity = p.light * fade * fade;
      if (t >= dur) { kill(); return false; }
      return true;
    },
  };
}

/** Diagnostics for the dev overlay and the headless tests. */
export function fxStats() {
  let users = 0, pooled = 0;
  for (const v of vids.values()) users += v.users;
  for (const sets of [...Object.values(vidMatPools), ...poolRegistry]) {
    for (const p of Object.values(sets)) pooled += p.length;
  }
  return { matSets: matCache.size, vidMats: vidMatCache.size, videos: vids.size, videoUsers: users, pooledMats: pooled };
}
