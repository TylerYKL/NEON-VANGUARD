/* ============================================================
   REFERENCE VFX GAME BRIDGE TEST
   Verifies the shared Hero Studio routing contract and the
   reference ability pool used by the playable game.
   ============================================================ */
import * as THREE from 'three';
import { normalizeTuning } from '../src/glbskin.js';
import { GameReferenceVFX } from '../src/reference-vfx/gameRuntime.js';
import { REFERENCE_CASTS } from '../src/reference-vfx/heroSkills.js';
import { settings } from '../src/reference-vfx/config/settings.js';
import { isRegisteredSkillManifest } from '../src/reference-vfx/skillManifest.js';

let pass = 0;
let fail = 0;
function check(name, value, detail = '') {
  if (value) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

const normalized = normalizeTuning({
  referenceSkills: {
    on: true,
    legacyFx: false,
    map: { aegis: ['snare', 'invalid', 'meteor'] },
  },
});
check('reference routing defaults missing slots',
  normalized.referenceSkills.map.aegis.join(',') === 'snare,thunder,meteor');
check('reference routing defaults all heroes',
  normalized.referenceSkills.map.nyx.length === 3 && normalized.referenceSkills.map.lyra.length === 3);
check('reference routing clamps unknown casts',
  normalized.referenceSkills.map.aegis.every((id) => REFERENCE_CASTS.some((cast) => cast.id === id)));
const solarNormalized = normalizeTuning({
  referenceSkills: {
    on: true,
    map: { aegis: ['solar', 'thunder', 'meteor'] },
  },
});
check('solar manifest ID is a registered reference cast',
  solarNormalized.referenceSkills.map.aegis[0] === 'solar');
check('arbitrary manifest IDs remain unregistered',
  !isRegisteredSkillManifest({ id: 'prototype-skill' }));

const runtime = new GameReferenceVFX({
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  renderer: {},
  gameFX: null,
});
runtime.setTuning(normalized);
const hero = { def: { id: 'aegis' }, pos: new THREE.Vector3(), facing: 0 };
let impacts = 0;
const cast = runtime.cast(hero, 0, { onImpact: () => impacts++ });
check('game bridge selects the studio-assigned cast', cast?.element === 'snare', cast?.element);
for (let i = 0; i < 240; i++) runtime.update(1 / 60, i / 60);
check('game bridge fires hero mechanic at reference impact', impacts === 1, String(impacts));
runtime.clear();
check('game bridge clears active pooled casts', runtime.abilities.active.length === 0);

runtime.setTuning(solarNormalized);
const persistedSolar = normalizeTuning({
  referenceSkills: { map: { aegis: ['solar', 'thunder', 'meteor'] } },
  skillManifests: {
    'solar-flare': { id: 'solar-flare', input: { range: 9.25 } },
  },
});
runtime.setTuning(persistedSolar);
check('saved solar manifest reapplies its profile on game boot', Math.abs(settings.solar.range - 9.25) < 1e-9);
let solarImpacts = 0;
const solarCast = runtime.cast(hero, 0, { onImpact: () => solarImpacts++ });
check('solar ability class is pooled by the game bridge', solarCast?.element === 'solar', solarCast?.element);
for (let i = 0; i < 240; i++) runtime.update(1 / 60, i / 60);
check('solar reaches its real reference impact phase', solarImpacts === 1, String(solarImpacts));
runtime.clear();

const prismNormalized = normalizeTuning({
  referenceSkills: { map: { aegis: ['prism', 'thunder', 'meteor'] } },
  skillManifests: {
    'prism-burst': {
      id: 'prism-burst',
      input: { range: 11.5 },
      gameplay: { damage: 42, impactRadius: 1.6, status: { duration: 1.5 } },
      timing: { travelTime: 0.46, holdTime: 0.18, fadeTime: 0.42 },
      vfxProfile: { rate: 48, life: 0.72, speed: 8.5, color0: '#e9ffff', color1: '#9f6bff' },
    },
  },
});
runtime.setTuning(prismNormalized);
check('saved Prism Burst manifest reapplies its profile on game boot', Math.abs(settings.prism.range - 11.5) < 1e-9);
let prismImpacts = 0;
const prismCast = runtime.cast(hero, 0, { onImpact: () => prismImpacts++ });
check('Prism Burst ability class is pooled by the game bridge', prismCast?.element === 'prism', prismCast?.element);
for (let i = 0; i < 240; i++) runtime.update(1 / 60, i / 60);
check('Prism Burst reaches its real reference impact phase', prismImpacts === 1, String(prismImpacts));
runtime.clear();

const wanjianNormalized = normalizeTuning({
  referenceSkills: { map: { aegis: ['wanjian', 'thunder', 'meteor'] } },
  skillManifests: {
    'wanjian': {
      id: 'wanjian',
      input: { range: 15.0 },
      gameplay: { damage: 500, impactRadius: 9.0, status: { duration: 4.0 } },
      timing: { travelTime: 4.25, holdTime: 0.6, fadeTime: 1.65 },
      vfxProfile: { burst: 500, speed: 32.0, color0: '#88e0ff', color1: '#d0f0ff' },
    },
  },
});
runtime.setTuning(wanjianNormalized);
check('saved Wanjian manifest reapplies its profile on game boot',
  Math.abs(settings.wanjian.range - 15.0) < 1e-9);
let wanjianImpacts = 0;
const wanjianCast = runtime.cast(hero, 0, { onImpact: () => wanjianImpacts++ });
check('Wanjian ability class is pooled by the game bridge',
  wanjianCast?.element === 'wanjian', wanjianCast?.element);
/* The wanjian travel phase is a fixed 4.25 s sequence (converge → fuse → form →
   charge → strike), so the impact lands at roughly frame 255 of 60 Hz. 480 frames
   = 8 s gives headroom for the fade phase to start; the assertion is on the
   count, not the timestamp, matching the pattern solar / prism established. */
for (let i = 0; i < 480; i++) runtime.update(1 / 60, i / 60);
check('Wanjian reaches its real reference impact phase', wanjianImpacts === 1, String(wanjianImpacts));
runtime.clear();


if (fail) {
  console.log(`\nERRORS ${fail}  (${pass} passed, ${fail} failed)`);
  process.exitCode = 1;
} else {
  console.log(`\nERRORS none  (${pass} passed, 0 failed)`);
}
