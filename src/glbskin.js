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

/** Resolve once to { [heroId]: { template, yaw } }. Never rejects. */
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
