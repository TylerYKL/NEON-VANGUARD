import { settings } from './config/settings.js';

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const MANIFEST_RUNTIME_IDS = Object.freeze({
  solar: 'solar',
  'solar-flare': 'solar',
  prism: 'prism',
  'prism-burst': 'prism',
});

export function runtimeIdForManifest(manifest) {
  return MANIFEST_RUNTIME_IDS[manifest?.id] || null;
}

export const isRegisteredSkillManifest = (manifest) => Boolean(runtimeIdForManifest(manifest));

/**
 * Apply the safe, serialisable portion of a registered skill manifest to the
 * live reference settings. This never imports or executes the manifest's
 * implementation field.
 */
export function applySkillManifestSettings(manifest) {
  const runtimeId = runtimeIdForManifest(manifest);
  if (!runtimeId) return false;
  const c = settings[runtimeId];
  const input = manifest.input || {};
  const timing = manifest.timing || {};
  const gameplay = manifest.gameplay || {};
  const status = gameplay.status || {};
  const profile = manifest.vfxProfile || {};

  c.range = clamp(finite(input.range, c.range), 1, 20);
  c.minRange = clamp(finite(input.minRange, c.minRange), 0, c.range);
  const travelTime = finite(timing.travelTime, 0);
  const travelSpeed = finite(timing.travelSpeed, travelTime > 0 ? c.range / travelTime : c.speed);
  c.speed = clamp(travelSpeed, 1, 30);
  c.cooldown = clamp(finite(timing.cooldown, c.cooldown), 0.1, 15);
  c.impactDuration = clamp(finite(timing.holdTime, c.impactDuration), 0.1, 3);
  c.fadeDuration = clamp(finite(timing.fadeTime, c.fadeDuration), 0.1, 3);
  c.impactRadius = clamp(finite(gameplay.impactRadius, c.impactRadius), 0.1, 5);
  c.damage = clamp(finite(gameplay.damage, c.damage), 0, 300);
  c.sparkRate = clamp(finite(profile.rate, c.sparkRate), 0, 240);
  c.sparkLifetime = clamp(finite(profile.life, c.sparkLifetime), 0.1, 3);
  c.sparkSpeed = clamp(finite(profile.speed, c.sparkSpeed), 0, 20);
  if (/^#[0-9a-f]{6}$/i.test(profile.color0 || '')) c.colorCore = profile.color0;
  if (/^#[0-9a-f]{6}$/i.test(profile.color1 || '')) c.colorEdge = profile.color1;

  if (runtimeId === 'solar') {
    c.burnDuration = clamp(finite(status.duration, c.burnDuration), 0, 10);
    c.burnTick = clamp(finite(status.tickInterval, c.burnTick), 0.1, 5);
    c.burnDamage = clamp(finite(status.damagePerTick, c.burnDamage), 0, 100);
  } else {
    c.exposeDuration = clamp(finite(status.duration, c.exposeDuration), 0, 10);
  }
  return true;
}
