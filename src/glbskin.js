import { parseGLB, normalizeToStage } from './gltfutil.js';

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
   STUDIO TUNING — hero-studio.html saves per-hero size / motion
   settings (and skill-effect assignments) to
   models/uploads/hero_tuning.json; the game reads it at
   startGame() so studio edits land in the real match.
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

let tuningPromise = null;
/** Resolve once to per-hero { scale, motion, fx, fxOn }. Never rejects. */
export function ensureTuning() {
  if (!tuningPromise) {
    tuningPromise = fetch('models/uploads/hero_tuning.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((raw) => {
        const out = {};
        for (const id of ['aegis', 'lyra', 'nyx']) {
          const t = raw[id] || {};
          const motion = {};
          for (const [k, dv] of Object.entries(DEFAULT_MOTION)) {
            const v = Number(t.motion && t.motion[k]);
            motion[k] = Number.isFinite(v) && v >= 0 && v < 100 ? v : dv;
          }
          const scale = Number(t.scale);
          out[id] = {
            scale: Number.isFinite(scale) ? Math.min(2, Math.max(0.5, scale)) : 1,
            motion,
            fx: typeof t.fx === 'string' && /\.glb$/i.test(t.fx) ? t.fx : null,
            fxOn: t.fxOn !== false,
          };
        }
        return out;
      });
  }
  return tuningPromise;
}

let fxPromise = null;
/** Preload configured skill-effect GLBs into { [heroId]: template }. Never rejects. */
export function loadFXBank(tuning) {
  if (!fxPromise) {
    fxPromise = Promise.all(
      Object.entries(tuning || {}).map(async ([id, t]) => {
        if (!t.fx) return null;
        try {
          const res = await fetch(t.fx);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const gltf = await parseGLB(await res.arrayBuffer());
          const template = gltf.scene || gltf.scenes[0];
          normalizeToStage(template, 1.8);
          return [id, template];
        } catch (e) {
          console.warn('[glbskin] skill fx for ' + id + ' unavailable: ' + (e.message || e));
          return null;
        }
      })
    ).then((pairs) => {
      const out = {};
      for (const p of pairs) if (p) out[p[0]] = p[1];
      return out;
    });
  }
  return fxPromise;
}
