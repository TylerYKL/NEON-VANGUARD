import { REFERENCE_CAST_IDS, HERO_IDS } from './heroSkills.js';

/**
 * A validated, ready-to-apply manifest assignment set.
 *
 * `assignments` in a `neon-vanguard-skill` manifest describes which hero slot
 * the new skill should occupy, but is deliberately *not* executable and must
 * not silently change live gameplay. This module turns the raw block into a
 * strict, side-effect-free plan: `validate()` only reads, `apply()` only
 * writes to the passed mapping object.
 *
 * Every failure mode is reported by path + message so the editor can toast the
 * first one, mirroring `PresetManager`'s validation result shape.
 */

const VALID_SLOTS = ['Q', 'E', 'R'];
const SLOT_INDEX = { Q: 0, E: 1, R: 2 };

/**
 * @param {object} manifest a parsed `neon-vanguard-skill-v1` manifest
 * @returns {{
 *   valid: boolean,
 *   registered: boolean,
 *   errors: Array<{path: string, message: string}>,
 *   plan: {heroId: string, slot: string, slotIndex: number}[] | null
 * }}
 */
export function validateSkillAssignments(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, registered: false, errors: [{ path: 'manifest', message: 'not an object' }], plan: null };
  }

  const id = manifest.id;
  if (typeof id !== 'string' || !id) {
    return { valid: false, registered: false, errors: [{ path: 'id', message: 'missing skill id' }], plan: null };
  }

  const registered = REFERENCE_CAST_IDS.has(id);

  const raw = manifest.assignments;
  if (raw == null) {
    return { valid: true, registered, errors: [], plan: [] };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, registered, errors: [{ path: 'assignments', message: 'must be an object' }], plan: null };
  }

  const plan = [];
  for (const [heroId, slot] of Object.entries(raw)) {
    if (!HERO_IDS.includes(heroId)) {
      errors.push({ path: `assignments.${heroId}`, message: `unknown hero (expected one of ${HERO_IDS.join(', ')})` });
      continue;
    }
    if (slot === null) continue; // explicit "no assignment" is legal
    if (typeof slot !== 'string' || !VALID_SLOTS.includes(slot)) {
      errors.push({ path: `assignments.${heroId}`, message: `slot must be Q, E, R or null (got ${JSON.stringify(slot)})` });
      continue;
    }
    plan.push({ heroId, slot, slotIndex: SLOT_INDEX[slot] });
  }

  // A key error (unregistered id) alone does not invalidate the plan shape —
  // it only means Apply must be refused by the caller. Keep both flags so the
  // editor can show "review-only" without pretending the file is malformed.
  return { valid: errors.length === 0, registered, errors, plan: errors.length === 0 ? plan : null };
}

/**
 * Apply a validated plan to a live mapping.
 *
 * The mapping is the same shape `normalizeReferenceSkills()` returns and reads:
 *   { on: boolean, legacyFx: boolean, map: { aegis: [id,id,id], ... } }
 *
 * This mutates `mapping.map[heroId][slotIndex]` in place. It does *not* register
 * the skill, does not touch the ability manager, does not change routing state —
 * that separation is the point: importing a file must never change gameplay
 * without a second explicit click.
 *
 * @returns {number} how many slots were actually written
 */
export function applySkillAssignments(mapping, plan, skillId) {
  if (!mapping || !mapping.map || !Array.isArray(plan)) return 0;
  let written = 0;
  for (const entry of plan) {
    const slots = mapping.map[entry.heroId];
    if (!Array.isArray(slots)) continue;
    if (slots[entry.slotIndex] === skillId) continue; // already there
    slots[entry.slotIndex] = skillId;
    written++;
  }
  return written;
}

/**
 * One-line human summary for the toast.
 */
export function describePlan(plan, skillId) {
  if (!plan || plan.length === 0) return `${skillId}: no assignments to apply`;
  return `${skillId} → ` + plan.map((p) => `${p.heroId} ${p.slot}`).join(', ');
}