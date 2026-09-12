export const REFERENCE_CASTS = Object.freeze([
  { id: 'ice', label: 'Frost Lance', key: 'Q' },
  { id: 'thunder', label: 'Storm Lance', key: 'E' },
  { id: 'meteor', label: 'Cinder Fall', key: 'R' },
  { id: 'beam', label: 'Nova Beam', key: 'F' },
  { id: 'snare', label: 'Voltaic Snare', key: 'V' },
  { id: 'solar', label: 'Solar Flare', key: 'X' },
  { id: 'prism', label: 'Prism Burst', key: 'B' },
]);

export const REFERENCE_CAST_IDS = new Set(REFERENCE_CASTS.map((cast) => cast.id));

/** Sensible first pass: each roster gets three distinct reference silhouettes. */
export const DEFAULT_REFERENCE_SKILLS = Object.freeze({
  aegis: ['ice', 'thunder', 'meteor'],
  nyx: ['beam', 'thunder', 'snare'],
  lyra: ['ice', 'beam', 'snare'],
});

export const HERO_IDS = Object.freeze(['aegis', 'nyx', 'lyra']);

export function normalizeReferenceSkills(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const map = {};
  for (const heroId of HERO_IDS) {
    const candidate = Array.isArray(source.map?.[heroId]) ? source.map[heroId] : [];
    map[heroId] = DEFAULT_REFERENCE_SKILLS[heroId].map((fallback, slot) => {
      const id = candidate[slot];
      return REFERENCE_CAST_IDS.has(id) ? id : fallback;
    });
  }
  return {
    on: source.on !== false,
    legacyFx: source.legacyFx === true,
    map,
  };
}

export function referenceCastFor(raw, heroId, slot) {
  const normalized = normalizeReferenceSkills(raw);
  if (!normalized.on || !HERO_IDS.includes(heroId) || slot < 0 || slot > 2) return null;
  return normalized.map[heroId][slot] || null;
}
