# Skill VFX reference

**Primary reference:** [LinearAbiltyCastingThreeJS](https://github.com/achrefelouafi/LinearAbiltyCastingThreeJS)

Reference revision reviewed for this project: `ba61847cb6887e5ccae9cd591e6390082cac5f05`.
Its MIT licence permits study and reuse with the required copyright notice. The approved runtime port
now lives in `src/reference-vfx/`, with its reference UI stylesheet in `vfx-lab.css` and the associated
HDRI/FBX/ground textures in `vfx-assets/`. The port is bundled into `hero-studio.html`; the vendored
source carries the upstream notice at `src/reference-vfx/LICENSE`.

## What we are taking from the reference

### 1. A cast is a readable sequence, not one burst

Future abilities should be authored as explicit phases:

```text
idle → arm / telegraph → travel → impact → hold / re-strike → fade → release
```

The player should be able to answer these questions before committing:

- Where will the skill land?
- How wide and long is it?
- When is the dangerous or useful moment?
- How long does the field remain?
- What is still happening after impact?

The reference's linear arrow cast and far-target circle are the model for that readability. In NEON
VANGUARD the equivalent must fit the top-down arena, hero facing, range/min-range rules, telegraph
colours, and the existing camera framing.

### 2. Build silhouettes before decoration

Each new skill gets a strong primary read first:

- **Line cast:** ground indicator, travel front, impact wall or beam.
- **Far cast:** radius circle, snap/landing event, field boundary.
- **Hold field:** stable boundary, interior motion, periodic re-strikes.
- **Projectile:** readable arc or line, wake, impact shell.

Only after that read is correct should secondary particles, debris, sparks, motes, distortion, and
extra lights be added. A beautiful effect that cannot be read during a boss wave is not finished.

### 3. Keep the profile as the VFX API

Future skills should keep their tunable values in a serialisable profile rather than scattering
numbers through the ability implementation. The reference's live settings and preset workflow are the
model. Every authored field should have:

- a safe default;
- a bounded range;
- a clear semantic name;
- an editor control when it affects presentation;
- a test for invalid or extreme input.

The current implementation points are:

| Concern | NEON VANGUARD location |
| --- | --- |
| Hero/skill data and cast timing | `src/heroes.js`, `src/balance.js` |
| Legacy GLB/video skill FX | `src/fxpack.js` |
| GPU particle profiles and instanced runtime | `src/vfx.js` |
| Shared pooled particles, rings, beams and sparks | `src/fx.js` |
| Hero Studio preview, tuning and save/import | `src/studio.js` |
| External and procedural audio | `src/audio.js` |
| Normalisation and tuning persistence | `src/glbskin.js` |

The Studio preview must continue to call the same runtime path as the match. A preview-only renderer
or a second set of visual constants is not acceptable.

### 4. Resolve live settings during the cast

For effects that are being edited or paused, dimensions should be resolved from the current profile
while the effect is alive. Do not permanently bake metres, radii, colours, or timing into an event if
that prevents the editor from reshaping the live effect. A cast may store deterministic unitless
random values such as line fraction, lateral offset, seed, or particle identity; the profile resolves
them into world values.

This is particularly important for:

- crystal and spike fields;
- lightning paths;
- beam radius and sheath width;
- ground burns and cracks;
- far-cast circles and field radii;
- particle lifetime and re-strike timing.

### 5. Use GPU paths for density and pools for lifetime

The reference's shader-first approach is the target for dense future skills:

- vertex/fragment shaders for ribbons, tubes, ground marks and animated surfaces;
- GPU particles for motes, sparks, chips, mist and glitter;
- instancing for repeated geometry;
- pooled lights and pooled effect instances;
- no allocation or disposal inside a repeated cast/update path unless the pool contract explicitly
  allows it.

The current game already provides pooled legacy FX, pooled particles/lights, and an instanced VFX
runtime. New skills should extend those paths rather than introduce ad-hoc meshes or one-off timers.

### 6. Pair visual phases with audio phases

Each future skill should have an optional audio cue for its meaningful phases:

- arm/charge;
- travel or whoosh;
- impact/release;
- hold/re-strike;
- fade or collapse.

External OGG/WAV/MP3 cues are additive. The procedural Web Audio cue remains the fallback when a sample
is missing or fails to decode. Audio assignment must stay in the same Hero Studio ALL/Q/E/R workflow as
the visual profile.

## Authoring checklist for a new skill

1. Define the player-facing action and its targeting shape.
2. Define range, minimum range, cast time, travel time, impact time, hold time and cooldown.
3. Write the cast phases and the player feedback for each phase.
4. Create the primary silhouette and telegraph before secondary detail.
5. Put tunable values in a profile with defaults and clamps.
6. Reuse `Hero.playFX()`, `spawnFX()`, `spawnVFX()`, pooled `G.fx` systems and the audio bus.
7. Add the skill's audio cue slot and preserve procedural fallback.
8. Preview it in Hero Studio using the real cast simulator.
9. Test paused/live tuning, cleanup, repeated casts, missing assets, extreme values and no-NaN guards.
10. Validate readability with the other two heroes, active enemies, screen shake and a boss-wave density.

## Deliberate differences from the reference

The reference is a focused VFX sandbox built around Vite, lil-gui, FBX animation clips and five
linear/far-cast elemental abilities. NEON VANGUARD remains a self-contained Three.js arena game with
its existing procedural heroes, squad AI, wave director, GLB/video pipeline, Hero Studio and generated
single-file deliverables. We will not replace those systems wholesale.

The reference remains the **authoring standard and visual benchmark** for the game, while the Hero
Studio surface is now the approved Three.js reference lab. The game shell and its existing procedural,
GLB/video, GPU VFX, and audio systems remain separate deliverables; Hero Studio keeps those prior
workflow assets available through the upload/library path while using the reference runtime for live
ability authoring. Godot migration remains deferred until this Three.js implementation is feature-complete
and stable.
