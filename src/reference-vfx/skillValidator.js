const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const HERO_IDS = new Set(['aegis', 'nyx', 'lyra']);
const SLOT_KEYS = new Set(['Q', 'E', 'R', 'F', 'V', 'X']);
const TARGETING = new Set(['line', 'zone', 'point', 'self', 'cone']);
const REGISTERED_IDS = new Set(['solar', 'solar-flare']);
const MANIFEST_KINDS = new Set(['neon-vanguard-skill', 'neon-vanguard-ability']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value) => Number.isFinite(Number(value));
const add = (list, path, message) => list.push({ path, message });

/**
 * Validate a skill or ability manifest without executing its implementation.
 * This is intentionally a structural/content check: an unregistered but valid
 * manifest can be uploaded for review, while only registered IDs can be played.
 */
export function validateSkillManifest(manifest) {
  const errors = [];
  const warnings = [];
  if (!isObject(manifest)) {
    return { valid: false, registered: false, errors: [{ path: '$', message: 'manifest must be a JSON object' }], warnings: [] };
  }

  if (!MANIFEST_KINDS.has(manifest.kind)) {
    add(errors, 'kind', 'must be neon-vanguard-skill or neon-vanguard-ability');
  }
  if (!Number.isInteger(Number(manifest.version)) || Number(manifest.version) !== 1) {
    add(errors, 'version', 'must be version 1');
  }
  if (typeof manifest.id !== 'string' || !ID_RE.test(manifest.id)) {
    add(errors, 'id', 'must use 2–64 lowercase letters, numbers, or hyphens');
  }
  if (typeof manifest.label !== 'string' || manifest.label.trim().length < 2) {
    add(errors, 'label', 'must be a descriptive string');
  }

  if (!isObject(manifest.input)) add(errors, 'input', 'is required');
  else {
    if (manifest.input.key !== undefined && !SLOT_KEYS.has(manifest.input.key)) {
      add(errors, 'input.key', 'must be a known input key');
    }
    if (manifest.input.targeting !== undefined && !TARGETING.has(manifest.input.targeting)) {
      add(errors, 'input.targeting', 'must be line, zone, point, self, or cone');
    }
    for (const field of ['range', 'minRange']) {
      if (manifest.input[field] !== undefined && !isFiniteNumber(manifest.input[field])) {
        add(errors, `input.${field}`, 'must be finite');
      }
    }
  }

  if (!isObject(manifest.timing)) add(errors, 'timing', 'is required');
  else {
    for (const field of ['cooldown', 'castTime', 'travelTime', 'impactTime', 'holdTime', 'fadeTime']) {
      if (manifest.timing[field] !== undefined && (!isFiniteNumber(manifest.timing[field]) || Number(manifest.timing[field]) < 0)) {
        add(errors, `timing.${field}`, 'must be a non-negative finite number');
      }
    }
  }

  if (!Array.isArray(manifest.phases) || manifest.phases.length === 0) {
    add(errors, 'phases', 'must contain at least one phase');
  } else {
    manifest.phases.forEach((phase, index) => {
      if (!isObject(phase)) {
        add(errors, `phases[${index}]`, 'must be an object');
        return;
      }
      if (typeof phase.id !== 'string' || !phase.id.trim()) add(errors, `phases[${index}].id`, 'is required');
      if (phase.duration !== undefined && (!isFiniteNumber(phase.duration) || Number(phase.duration) < 0)) {
        add(errors, `phases[${index}].duration`, 'must be a non-negative finite number');
      }
    });
  }

  if (manifest.gameplay !== undefined && !isObject(manifest.gameplay)) add(errors, 'gameplay', 'must be an object');
  if (manifest.vfxProfile !== undefined && !isObject(manifest.vfxProfile)) add(errors, 'vfxProfile', 'must be an object');
  if (manifest.assignments !== undefined) {
    if (!isObject(manifest.assignments)) add(errors, 'assignments', 'must be an object');
    else {
      for (const [heroId, slot] of Object.entries(manifest.assignments)) {
        if (!HERO_IDS.has(heroId)) add(errors, `assignments.${heroId}`, 'unknown hero ID');
        if (slot !== null && slot !== undefined && !SLOT_KEYS.has(slot)) {
          add(errors, `assignments.${heroId}`, 'must be a known slot or null');
        }
      }
    }
  }

  if (manifest.implementation !== undefined) {
    if (!isObject(manifest.implementation)) add(errors, 'implementation', 'must be an object');
    else warnings.push({ path: 'implementation', message: 'metadata only; upload/import never executes implementation paths' });
  }
  if (!manifest.vfxProfile) warnings.push({ path: 'vfxProfile', message: 'no VFX profile supplied; runtime defaults will be used' });
  if (!manifest.gameplay) warnings.push({ path: 'gameplay', message: 'no gameplay payload supplied; manifest remains VFX/design-only' });

  const id = typeof manifest.id === 'string' ? manifest.id : '';
  const registered = REGISTERED_IDS.has(id);
  if (!registered && errors.length === 0) {
    warnings.push({ path: 'id', message: 'valid manifest, but runtime registration is required before it is playable' });
  }
  return { valid: errors.length === 0, registered, errors, warnings };
}

export function isSupportedManifestKind(value) {
  return MANIFEST_KINDS.has(value);
}
