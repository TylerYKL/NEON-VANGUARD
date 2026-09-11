/* ============================================================
   REFERENCE VFX GAME BRIDGE TEST
   Verifies the shared Hero Studio routing contract and the
   reference ability pool used by the playable game.
   ============================================================ */
import * as THREE from 'three';
import { normalizeTuning } from '../src/glbskin.js';
import { GameReferenceVFX } from '../src/reference-vfx/gameRuntime.js';
import { REFERENCE_CASTS } from '../src/reference-vfx/heroSkills.js';

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
let solarImpacts = 0;
const solarCast = runtime.cast(hero, 0, { onImpact: () => solarImpacts++ });
check('solar ability class is pooled by the game bridge', solarCast?.element === 'solar', solarCast?.element);
for (let i = 0; i < 240; i++) runtime.update(1 / 60, i / 60);
check('solar reaches its real reference impact phase', solarImpacts === 1, String(solarImpacts));
runtime.clear();

if (fail) {
  console.log(`\nERRORS ${fail}  (${pass} passed, ${fail} failed)`);
  process.exitCode = 1;
} else {
  console.log(`\nERRORS none  (${pass} passed, 0 failed)`);
}
