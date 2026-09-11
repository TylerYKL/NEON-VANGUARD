import { Vector3 } from 'three';
import { AbilityManager } from './abilities/AbilityManager.js';
import { ParticleEngine } from './particles/ParticleEngine.js';
import { LightPool } from './effects/LightPool.js';
import { DecalSystem } from './effects/GroundDecals.js';
import { FissureSystem } from './effects/GroundFissures.js';
import { BurstSystem } from './effects/BurstSphere.js';
import { CameraShake } from './effects/CameraShake.js';
import { ScreenFlash } from './effects/ScreenFlash.js';
import { frame } from './core/FrameUniforms.js';
import { patchOnBeforeCompile } from './utils/shaderPatch.js';
import { normalizeReferenceSkills } from './heroSkills.js';
import { settings } from './config/settings.js';

/**
 * Runs the reference ability pool inside the real arena renderer.
 *
 * The game retains each hero's combat rule (damage, healing, knockback and
 * cooldown ownership), but the cast's targeting line, travel, impact and fade
 * are now the same pooled reference abilities used by Linear VFX Lab. The
 * hero mechanic is released on the reference impact phase instead of firing
 * immediately, so the authored visual and gameplay beat stay together.
 */
export class GameReferenceVFX {
  constructor({ scene, camera, renderer, gameFX }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.gameFX = gameFX;
    this.mapping = normalizeReferenceSkills(null);
    this.pending = new Map();
    this.elapsed = 0;

    // Reference materials use this hook to add their world-space shader terms.
    // The arena does not use the reference depth prepass, so the adapter only
    // installs the shader patch and leaves the shared depth sampler unbound.
    const environment = {
      registerShadowCasterWithPatch(material, patch) {
        patchOnBeforeCompile(material, patch);
      },
    };

    this.particles = new ParticleEngine(scene);
    this.lights = new LightPool(scene);
    this.decals = new DecalSystem(scene);
    this.fissures = new FissureSystem(scene);
    this.bursts = new BurstSystem(scene);
    this.shakeRig = { shakeOffset: new Vector3(), shakeRoll: 0 };
    this.shake = new CameraShake(this.shakeRig);
    this.flash = new ScreenFlash();

    this.abilities = new AbilityManager({
      scene,
      camera,
      environment,
      particles: this.particles,
      lights: this.lights,
      decals: this.decals,
      fissures: this.fissures,
      bursts: this.bursts,
      shake: this.shake,
      flash: this.flash,
    });
  }

  setTuning(tuning) {
    this.mapping = normalizeReferenceSkills(tuning?.referenceSkills);
  }

  /**
   * Start a reference cast for one real hero skill.
   * @param {object} hero NEON VANGUARD Hero instance
   * @param {number} slot 0 = Q, 1 = E, 2 = R
   * @param {object} hooks callback fired at the reference impact phase
   */
  cast(hero, slot, hooks = {}) {
    const element = this.mapping.on ? this.mapping.map[hero.def.id]?.[slot] : null;
    if (!element) return null;

    const direction = new Vector3(
      Math.sin(hero.facing),
      0,
      Math.cos(hero.facing)
    );
    const aim = hero.controlled && hero.G?.aimPoint;
    if (aim) {
      direction.set(aim.x - hero.pos.x, 0, aim.z - hero.pos.z);
      if (direction.lengthSq() > 0.001) direction.normalize();
    }
    const fallbackDistance = hero.def.id === 'nyx' ? 14 : 10;
    const rawDistance = aim
      ? Math.hypot(aim.x - hero.pos.x, aim.z - hero.pos.z)
      : fallbackDistance;
    const config = settings[element];
    const distance = Math.max(
      config?.minRange ?? 2.5,
      Math.min(config?.range ?? 18, rawDistance || fallbackDistance)
    );
    const ability = this.abilities.cast(hero.pos, direction, distance, element);
    if (!ability) return null;

    this.pending.set(ability, {
      ability,
      hero,
      hooks,
      previousPhase: ability.phase,
      impactFired: false,
    });
    return ability;
  }

  update(dt, gameTime) {
    this.elapsed = gameTime;
    frame.uTime.value = gameTime;
    frame.uDelta.value = dt;
    this.abilities.update(dt);

    for (const record of this.pending.values()) {
      const { ability } = record;
      if (!record.impactFired && ability.phase === 'impact') {
        record.impactFired = true;
        record.hooks.onImpact?.(ability);
      }
      record.previousPhase = ability.phase;
    }

    for (const ability of this.pending.keys()) {
      if (ability.phase === 'idle' || ability.phase === 'done') this.pending.delete(ability);
    }

    this.particles.flush();
    this.decals.update(dt);
    this.fissures.update(dt);
    this.bursts.update(dt);
    this.lights.update(dt);
    this.shake.update(dt);
    this.flash.update(dt);
  }

  clear() {
    for (const record of this.pending.values()) record.hooks.onCancel?.();
    this.pending.clear();
    this.abilities.clear();
    this.particles.reset();
    this.decals.clear();
    this.fissures.clear();
    this.bursts.clear();
    this.lights.reset();
    this.shake.reset();
    this.flash.reset();
  }
}
