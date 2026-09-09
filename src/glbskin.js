import { parseGLB, normalizeToStage } from './gltfutil.js';
import { clampFX, fxKind, fxSources, FX_SLOTS } from './fxpack.js';

/* A skin file a rebuilder produced can be *rigged* — bones, a SkinnedMesh, animation
   clips. Nothing in `models/uploads/` is today (`animcheck`'s census: every shipped file
   is `bones 0 · clips 0`), so every path below is written to degrade to exactly the old
   behaviour when the answer is zero. */
const clampN = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

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

/* Templates are parsed once per URL and reused — the same trick the FX bank uses, so a
   restart after re-exporting a hero pays for that file only. `normalizeToStage` is part of
   the parse (it mutates the root), so it lives here and never on a per-hero copy. */
const skinCache = new Map();
async function skinEntry(url) {
  if (skinCache.has(url)) return skinCache.get(url);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const gltf = await parseGLB(await res.arrayBuffer());
  const template = gltf.scene || gltf.scenes[0];
  normalizeToStage(template, 2.4);
  /* THE LINE PHASE B IS ABOUT: `gltf.animations` was already in hand here and was dropped
     on the floor. Tracks address bones by NAME, which survives both the glTF round trip and
     the skeleton-isolating clone, so they can be replayed on any hero's own copy. A clip of
     zero duration would divide by it in the mixer, so it never gets that far. */
  const entry = { template, clips: (gltf.animations || []).filter((c) => c && c.duration > 0) };
  skinCache.set(url, entry);
  return entry;
}

/**
 * Load (or reuse) the hero skins.
 * @param tuning optional `ensureTuning` result: a hero's `model` field overrides the
 *   `<id>.glb` manifest, which is what lets the studio point a hero at any uploaded rigged
 *   file without a code change. The tuning is therefore read BEFORE this (main.js:931).
 */
export function ensureGLBSkins(tuning) {
  return Promise.all(
    MANIFEST.map(async (m) => {
      const over = tuning && tuning[m.id] && tuning[m.id].model;
      const url = over || m.url;
      try {
        const e = await skinEntry(url);
        return [m.id, { template: e.template, clips: e.clips, yaw: m.yaw || 0, url }];
      } catch (err) {
        console.warn('[glbskin] ' + m.id + ': procedural fallback (' + (err.message || err) + ')');
        return null;
      }
    })
  ).then((pairs) => {
    const out = {};
    for (const p of pairs) if (p) out[p[0]] = p[1];
    const n = Object.keys(out).reduce((t, k) => t + (out[k].clips ? out[k].clips.length : 0), 0);
    console.info('[glbskin] loaded: ' + (Object.keys(out).join(', ') || 'none — procedural rigs') +
      ' \u00b7 ' + n + ' clip(s)');
    return out;
  });
}

/** One line per hero wearing a GLB skin, for the console at boot.
    The studio shows all of this per hero in its own clip block, but a shipped
    `hero_tuning.json` is played in the GAME, where a typo'd clip name and a clip two slots
    both claim used to be silent — `hero.anim.miss` existed and nobody read it. The
    "nothing happened" case (a static mesh, which is every real file today) prints nothing:
    a boot log that is always noisy is a boot log nobody opens. */
export function clipReport(G) {
  const out = [];
  for (const h of (G && G.heroes) || []) {
    const skin = G.glbSkins && G.glbSkins[h.def.id];
    if (!skin || !h.rig || !h.rig.glb) continue;         // procedural body: nothing to report
    const an = h.anim;
    const file = String(skin.url || (h.def.id + '.glb')).split('/').pop();
    if (!an) {
      if (skin.clips && skin.clips.length) {
        out.push({ bad: false, msg: h.def.id + ': ' + skin.clips.length + ' clip(s) in ' + file +
          ' but anim.on is 0 — no mixer, the transform layer alone' });
      }
      continue;
    }
    const bits = [];
    const bound = ANIM_NAME_KEYS.filter((s) => an.act[s]).map((s) => s + '=' + an.used[s]);
    if (bound.length) bits.push('bound ' + bound.join(' '));
    else bits.push('NOTHING BOUND — no slot resolved to a clip in ' + file);
    if (an.miss.length) bits.push('NOT IN FILE: ' + an.miss.join(', '));
    if (an.clash.length) {
      bits.push('one clip per layer — ' + an.clash.map((c) => c.clip + ' also named for ' + c.slot +
        (c.takenBy ? ' (held by ' + c.takenBy + ')' : '')).join(', '));
    }
    out.push({ bad: an.miss.length > 0 || an.clash.length > 0 || !bound.length,
      msg: h.def.id + ' (' + file + '): ' + bits.join(' · ') });
  }
  return out;
}

/* ---------------- clips: what a hero layer plays, and on which bones ---------------- */

/* What an `anim` slot means when the tuner wrote "auto": the alias list a name is matched
   against, in order. Real files are named `Ae_A_00 Idle`, `Walk_Fwd`, `Death01`… */
export const CLIP_ALIASES = {
  idle: ['idle', 'stand', 'rest'],
  walk: ['walk', 'walking', 'run', 'jog'],
  attack: ['attack', 'atk', 'swing', 'slash', 'melee'],
  hurt: ['hurt', 'hit', 'reaction', 'flinch'],
  death: ['death', 'die', 'down', 'defeat'],
};

/** "" / none / off is a deliberate "this slot plays nothing" — which is NOT the same
    thing as a name that isn't in the file, and the difference is what the studio reports. */
export const clipOff = (v) => {
  const w = String(v == null ? '' : v).trim().toLowerCase();
  return !w || w === 'none' || w === 'off';
};

/** Exact name, then "contains", then the slot's aliases. Case-insensitive, because no
    export tool agrees on casing. Returns the AnimationClip or null. */
export function clipFor(clips, want, slot) {
  if (!Array.isArray(clips) || !clips.length) return null;
  const nm = (c) => String((c && c.name) || '').toLowerCase();
  const w = String(want == null ? '' : want).trim().toLowerCase();
  if (clipOff(w) ) return null;
  if (w !== 'auto') {
    return clips.find((c) => nm(c) === w) || clips.find((c) => nm(c).includes(w)) || null;
  }
  for (const a of (CLIP_ALIASES[slot] || [slot])) {
    const hit = clips.find((c) => nm(c) === a) || clips.find((c) => nm(c).includes(a));
    if (hit) return hit;
  }
  return null;
}

/** The v3 `anim{}` block. `on: 0` leaves a rigged file on the pure-transform path — exactly
    v2 — names are what the mixer looks up, and `fade` is how fast a layer's weight moves
    (Hero.poseClips), so 0 means instant. */
export const DEFAULT_ANIM = {
  on: 1,
  idle: 'auto', walk: 'auto', attack: 'auto', hurt: 'auto', death: 'auto',
  speed: 1,
  fade: 0.18,
};

export const ANIM_NAME_KEYS = ['idle', 'walk', 'attack', 'hurt', 'death'];

/** Same rule as `clampFX`: a hand-edited JSON may not poison a frame. Names are trimmed,
   capped, and stripped of the characters that would break the next write of the file. */
export function clampAnim(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { on: (src.on === 0 || src.on === false || src.on === '0') ? 0 : 1 };
  for (const k of ANIM_NAME_KEYS) {
    const v = src[k];
    out[k] = (typeof v === 'string' && v.trim())
      ? v.trim().slice(0, 64).replace(/[<>&"']/g, '')
      : DEFAULT_ANIM[k];
  }
  out.speed = clampN(Number(src.speed), 0.1, 4, DEFAULT_ANIM.speed);
  out.fade = clampN(Number(src.fade), 0, 1, DEFAULT_ANIM.fade);
  return out;
}

/* ============================================================
   STUDIO TUNING — hero-studio.html saves per-hero size / motion /
   skill-effect settings to models/uploads/hero_tuning.json; the
   game reads it at startGame(), so studio edits land in the real
   match. Shape (v3 — v1 and v2 files still load; every new field is optional):

     { "aegis": {
         scale: 1.0,  pos: {x,y,z},  yawDeg: 0,  motion: {…},
         model: "models/uploads/aegis-rig.glb",                       // overrides <id>.glb
         anim: { on, idle, walk, attack, hurt, death, speed, fade }, // clips (see §4)
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
  recoilKick: 0.05,// root kick while `recoil` is lit (a GLB skin has no gun node to kick)
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
          const model = /\.(glb|gltf)$/i.test(String(t.model || '')) ? String(t.model) : null;
          const anim = clampAnim(t.anim);
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
            model,
            anim,
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
