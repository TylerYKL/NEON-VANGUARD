import { parseGLB, normalizeToStage } from './gltfutil.js';
import { clampFX, fxKind, fxSources, FX_SLOTS } from './fxpack.js';

/* ============================================================
   GLB SKINS — uploaded hero models (models/uploads/<id>.glb)
   replace the procedural bodies when present. A missing or
   unparseable file quietly falls back to the procedural rig,
   so the game never fails to boot.

   `yaw` corrects the forward axis if a reconstructor bakes the
   hero facing -Z (flip to Math.PI and the hero stops walking
   backwards).
   ============================================================ */

const MANIFEST = [
  { id: 'aegis', url: 'models/uploads/aegis.glb', yaw: 0 },
  { id: 'lyra', url: 'models/uploads/lyra.glb', yaw: 0 },
  { id: 'nyx', url: 'models/uploads/nyx.glb', yaw: 0 },
];

let promise = null;
export function ensureGLBSkins() {
  if (!promise) {
    promise = Promise.all(
      MANIFEST.map(async (m) => {
        try {
          const res = await fetch(m.url);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const gltf = await parseGLB(await res.arrayBuffer());
          const template = gltf.scene || gltf.scenes[0];
          normalizeToStage(template, 2.4);
          return [m.id, { template, yaw: m.yaw || 0 }];
        } catch (e) {
          console.warn('[glbskin] ' + m.id + ': procedural fallback (' + (e.message || e) + ')');
          return null;
        }
      })
    ).then((pairs) => {
      const out = {};
      for (const p of pairs) if (p) out[p[0]] = p[1];
      console.info('[glbskin] loaded: ' + (Object.keys(out).join(', ') || 'none — procedural rigs'));
      return out;
    });
  }
  return promise;
}

/* ============================================================
   STUDIO TUNING — hero-studio.html saves per-hero size / motion /
   skill-effect settings to models/uploads/hero_tuning.json; the
   game reads it at startGame(), so studio edits land in the real
   match. Shape (v2 — v1 files still load):

     { "aegis": {
         scale: 1.0,  pos: {x,y,z},  yawDeg: 0,  motion: {…},
         fx: "models/uploads/aegis-fx.glb", fxOn: true, fxP: {…},   // shared slot
         fxSlots: [ {src, on, p:{…}}, null, {…} ]                    // Q, E, R
       } }

   `fx` is the legacy hero-wide effect and keeps working: a per-slot
   entry wins for that skill, otherwise the shared one plays.
   ============================================================ */

export const DEFAULT_MOTION = {
  stepRate: 7,     // walk cycle speed
  bob: 0.06,       // walk bounce height
  walkLean: 0.06,  // forward lean while moving
  lunge: 0.45,     // step-into-the-swing on attack
  twist: 0.22,     // hip twist on attack
  castLean: 0.10,  // lean-back while casting
  hurtLean: 0.16,  // recoil when hit
  idleSway: 0.012, // breathing sway at rest
  fallSpeed: 6,    // how fast the body topples when downed
};

const FX_FILE_RE = /\.(glb|gltf|mp4|webm|ogv)$/i;
const fxURL = (v) => (typeof v === 'string' && FX_FILE_RE.test(v) ? v : null);

let tuningPromise = null;
/** Per-hero { scale, motion, pos, yawDeg, fx, fxOn, fxP, fxSlots }. Never rejects —
    a broken file means default tuning, not a broken game. `refresh` re-reads the
    file, bypassing the HTTP cache: the Hero Studio writes it while the game tab is
    open, so a run restart picks up what you just saved. */
export function ensureTuning(refresh) {
  if (!tuningPromise || refresh) {
    tuningPromise = fetch('models/uploads/hero_tuning.json', refresh ? { cache: 'no-store' } : undefined)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((raw) => {
        const out = {};
        for (const id of ['aegis', 'lyra', 'nyx']) {
          const t = (raw && raw[id]) || {};
          const motion = {};
          for (const [k, dv] of Object.entries(DEFAULT_MOTION)) {
            const v = Number(t.motion && t.motion[k]);
            motion[k] = Number.isFinite(v) && v >= 0 && v < 100 ? v : dv;
          }
          const scale = Number(t.scale);
          const pos = {};
          for (const k of ['x', 'y', 'z']) {
            const v = Number(t.pos && t.pos[k]);
            pos[k] = Number.isFinite(v) ? Math.min(3, Math.max(-3, v)) : 0;
          }
          const yawDeg = Number(t.yawDeg);
          const fx = fxURL(t.fx);
          const slots = [];
          for (let i = 0; i < FX_SLOTS; i++) {
            const s = (t.fxSlots || [])[i];
            const src = fxURL(s && s.src);
            slots.push(src ? { src, on: !(s.on === false), p: clampFX(s.p, fxKind(src)) } : null);
          }
          out[id] = {
            scale: Number.isFinite(scale) ? Math.min(2, Math.max(0.5, scale)) : 1,
            motion,
            pos,
            yawDeg: Number.isFinite(yawDeg) ? Math.min(180, Math.max(-180, yawDeg)) : 0,
            fx,
            fxOn: t.fxOn !== false,
            fxP: clampFX(t.fxP, fxKind(fx)),
            fxSlots: slots,
          };
        }
        return out;
      });
  }
  return tuningPromise;
}

/** Preload every referenced effect into a bank keyed by **URL**, so one file can
    serve several heroes/slots and a slot swap never needs a re-parse. Videos are
    not parsed at all — the plane streams them at cast time. Already-parsed files
    are reused across calls, so re-reading the tuning on a restart only pays for
    whatever the studio assigned since then. */
const parsed = new Map();
export function loadFXBank(tuning) {
  return Promise.all(
    fxSources(tuning).map(async (url) => {
      if (/\.(mp4|webm|ogv)$/i.test(url)) return [url, { kind: 'video', url }];
      if (parsed.has(url)) return [url, parsed.get(url)];
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const gltf = await parseGLB(await res.arrayBuffer());
        const template = gltf.scene || gltf.scenes[0];
        normalizeToStage(template, 1.8);
        const entry = { kind: 'glb', url, template };
        parsed.set(url, entry);
        return [url, entry];
      } catch (e) {
        console.warn('[glbskin] skill fx unavailable: ' + url + ' (' + (e.message || e) + ')');
        return null;
      }
    })
  ).then((pairs) => {
    const out = {};
    for (const p of pairs) if (p) out[p[0]] = p[1];
    return out;
  });
}
