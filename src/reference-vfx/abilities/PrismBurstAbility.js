import { SolarFlareAbility } from './SolarFlareAbility.js';
import { BurstMode } from '../effects/BurstSphere.js';
import { DecalType } from '../effects/GroundDecals.js';
import { getColor } from '../utils/color.js';

/**
 * Prism Burst is the registered implementation for the sample
 * `prism-burst.ability.json` manifest.
 *
 * It deliberately reuses Solar Flare's pooled line/spark lifecycle while
 * changing the impact language to an airy prism fracture. This keeps the
 * sample small enough to study: a new registered ability can share a proven
 * pooled transport and only own its distinct impact treatment.
 */
export class PrismBurstAbility extends SolarFlareAbility {
  constructor(context) {
    super(context, 'prism');
  }

  onImpact() {
    const c = this.config;
    this.impact.copy(this.position);
    const core = getColor(c.colorCore);
    const edge = getColor(c.colorEdge);
    const smoke = getColor(c.colorSmoke);

    this.ctx.bursts.spawn(BurstMode.AIR, this.impact, {
      radius: 0.22,
      endRadius: c.impactRadius * 2.0,
      life: this.impactDuration,
      intensity: 1.35,
      opacity: 0.95,
      fresnel: 2.2,
      displace: 0.18,
      turbulence: 0.75,
      colorA: core,
      colorB: edge,
      colorC: smoke,
      squash: 0.82,
    });
    this.ctx.decals.spawn(DecalType.ARC, this.impact, {
      radius: c.impactRadius,
      life: this.impactDuration + this.fadeDuration,
      colorA: edge,
      colorB: core,
      intensity: 1.5,
      width: 0.14,
      growth: 0.45,
      height: 0.025,
    });
    this.ctx.decals.spawn(DecalType.SHOCKWAVE, this.impact, {
      radius: c.impactRadius * 1.25,
      life: this.fadeDuration,
      colorA: core,
      colorB: edge,
      intensity: 1.3,
      width: 0.08,
      growth: 0.7,
      height: 0.03,
    });

    this.lightBoost = c.lightIntensity;
    this.ctx.flash.trigger(core, c.castFlash);
  }
}
