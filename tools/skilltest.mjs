/* ============================================================
   SKILL / ABILITY MANIFEST VALIDATION TEST
   Verifies upload-safe structural validation for VFX manifests.
   ============================================================ */
import fs from 'node:fs';
import { validateSkillManifest } from '../src/reference-vfx/skillValidator.js';

let pass = 0;
let fail = 0;
function check(name, value, detail = '') {
  if (value) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

const solar = JSON.parse(fs.readFileSync(new URL('../examples/skills/solar-flare.skill.json', import.meta.url), 'utf8'));
const solarReport = validateSkillManifest(solar);
check('Solar Flare manifest is valid', solarReport.valid, JSON.stringify(solarReport.errors));
check('Solar Flare is recognised as registered', solarReport.registered);
check('implementation metadata is never executable', solarReport.warnings.some((item) => item.path === 'implementation'));

const ability = {
  kind: 'neon-vanguard-ability',
  version: 1,
  id: 'prototype-beam',
  label: 'Prototype Beam',
  input: { key: 'F', targeting: 'line' },
  timing: { cooldown: 2, castTime: 0.1 },
  gameplay: {},
  phases: [{ id: 'cast', duration: 0.1 }],
  vfxProfile: {},
};
const abilityReport = validateSkillManifest(ability);
check('ability manifests use the same validated contract', abilityReport.valid);
check('valid unregistered abilities remain review-only', abilityReport.valid && !abilityReport.registered);
check('unregistered ability explains registration requirement', abilityReport.warnings.some((item) => /registration.*required/.test(item.message)));

const invalid = structuredClone(solar);
invalid.id = 'Bad ID';
invalid.input.key = 'G';
invalid.phases[0].duration = -1;
invalid.assignments = { aegis: 'G' };
const invalidReport = validateSkillManifest(invalid);
check('invalid manifest is rejected', !invalidReport.valid);
check('invalid ID is reported', invalidReport.errors.some((item) => item.path === 'id'));
check('invalid input key is reported', invalidReport.errors.some((item) => item.path === 'input.key'));
check('invalid phase timing is reported', invalidReport.errors.some((item) => item.path === 'phases[0].duration'));
check('invalid assignment is reported', invalidReport.errors.some((item) => item.path === 'assignments.aegis'));

const unsupported = { ...solar, kind: 'random-json', id: 'random-json' };
const unsupportedReport = validateSkillManifest(unsupported);
check('unsupported document kinds are rejected', !unsupportedReport.valid);

console.log(`\nERRORS ${fail ? `${fail} failed` : 'none'}  (${pass} passed, ${fail} failed)`);
if (fail) process.exitCode = 1;
