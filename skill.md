# Skill Ability Authoring Guide

This document is the source-of-truth checklist for adding, importing, assigning, disabling, or removing a skill ability from the NEON VANGUARD VFX Editor and Hero Studio (Beta).

It covers both halves of a skill:

1. **Reference VFX ability** — targeting, timing, shader effects, particles, pooling, live lil-gui controls, and the VFX Lab skill bar.
2. **Playable gameplay mechanic** — damage, healing, knockback, status effects, cooldowns, energy, hero routing, and CAST SIM behavior.

A JSON manifest describes the skill, but it does not execute code or register a new ability by itself.

---

## Current importer behavior

### Right-side VFX Editor → Presets → Import JSON

This accepts either:

- A complete reference-VFX settings snapshot with `global` and registered ability blocks such as `ice`, `thunder`, `meteor`, `beam`, or `snare`.
- A collection of named settings presets.
- A `neon-vanguard-skill` manifest such as `examples/skills/solar-flare.skill.json`.

A skill manifest is loaded into:

```text
Hero Studio (Beta) → Imported skill manifest
```

After a skill is registered, the manifest can be applied with the explicit **Apply manifest to VFX editor** action. That updates the registered VFX profile and in-memory hero assignments; use **Save routing to game** to persist both the routing and the applied manifest profile for the next game boot. An unregistered manifest remains a review-only card and cannot cast.

Unknown settings are ignored by the VFX settings merger until the matching ability is registered in code.

### Legacy Hero Studio → IMPORT JSON

This imports `hero_tuning.json` data for the existing heroes:

```json
{
  "aegis": {},
  "lyra": {},
  "nyx": {}
}
```

It supports model tuning, animation choices, legacy GLB/video FX, GPU VFX profiles, audio cues, and Q/E/R slots. It does not register a new gameplay ability.

---

## Skill manifest format

Use `examples/skills/solar-flare.skill.json` as the starting template.

A manifest should describe:

```json
{
  "$schema": "neon-vanguard-skill-v1",
  "kind": "neon-vanguard-skill",
  "version": 1,
  "id": "solar",
  "label": "Solar Flare",
  "input": {},
  "timing": {},
  "gameplay": {},
  "phases": [],
  "vfxProfile": {},
  "assignments": {}
}
```

The `implementation` section is documentation only. Never dynamically import or execute a module path from JSON.

## Effect ID naming

`phases[].effect` is currently a manifest label only. The runtime does not resolve it as an asset or module ID, so there is no enforced prefix rule today.

Use the project convention below for future compatibility:

```text
{id}.{phase}
```

Examples:

```text
solar-flare.projectile
solar-flare.impact
solar-flare.fade
wanjian.sword-converge
```

Therefore `wanjian.sword-converge` is valid for a skill with the ID `wanjian`; keep the phase suffix readable and stable. Do not put a file path, JavaScript module path, or executable expression in this field.

## Current registered skill lists

The current VFX Lab ability registry is:

```js
['ice', 'thunder', 'meteor', 'beam', 'snare', 'solar']
```

The current Hero Studio reference-cast registry contains these IDs:

| ID | Label | Key |
|---|---|---|
| `ice` | Frost Lance | Q |
| `thunder` | Storm Lance | E |
| `meteor` | Cinder Fall | R |
| `beam` | Nova Beam | F |
| `snare` | Voltaic Snare | V |
| `solar` | Solar Flare | X |

`solar` is now registered as the first manifest-backed test ability. Its JSON can be imported, applied to the Solar Flare profile, and assigned to hero slots. The remaining manifest workflow still validates IDs and requires explicit save actions.

---

# Adding a new skill

## Step 1 — Define the permanent contract

Decide and record:

- Stable skill ID, for example `solar`.
- Display label, for example `Solar Flare`.
- Keyboard key in the VFX Lab.
- Line or zone targeting.
- Range and minimum range.
- Cast, travel, impact, hold, fade, and cooldown timing.
- Damage, healing, status, knockback, energy, or other gameplay effects.
- Hero assignments, if the skill should be available to Aegis, Nyx, or Lyra.
- Audio cue and asset requirements.

Do not change a skill ID after users have saved assignments to it.

---

## Step 2 — Add the VFX settings profile

Edit:

```text
src/reference-vfx/config/settings.js
```

Add a serialisable settings object:

```js
solar: {
  range: 7.5,
  minRange: 1.0,
  speed: 13,
  cooldown: 5.0,
  castAnim: 'cast1',
  impactRadius: 1.25,
  damage: 75,
  burnDuration: 2.0,
  burnTick: 0.5,
  burnDamage: 8,
  colorCore: '#fff1a6',
  colorEdge: '#ff6b24'
}
```

Also add `solar` to `ELEMENTS` and `ELEMENT_META` so the existing HUD, cooldown loop, aim system, and editor can recognize it.

Unknown JSON settings are ignored until this profile exists.

---

## Step 3 — Implement the reference ability class

Create:

```text
src/reference-vfx/abilities/SolarFlareAbility.js
```

Extend the shared `Ability` lifecycle. Follow an existing ability such as:

```text
src/reference-vfx/abilities/IceAbility.js
src/reference-vfx/abilities/MeteorAbility.js
src/reference-vfx/abilities/BeamAbility.js
```

The class should provide the appropriate lifecycle for the skill:

- `createShaders()`
- `createParticles()`
- `onSpawn()`
- Travel/update phase
- Impact phase
- Hold phase, if needed
- Fade/cleanup phase
- `dispose()`

Use pooled shared systems instead of allocating new effect resources every cast:

- `ParticleEngine`
- `LightPool`
- `GroundDecals`
- `GroundFissures`
- `BurstSystem`
- Shared shader/material helpers

Every cast must reset all state so a pooled instance cannot inherit data from the previous cast.

---

## Step 4 — Register the ability with the reference runtime

Edit:

```text
src/reference-vfx/abilities/AbilityManager.js
```

Add the import and registry entry:

```js
import { SolarFlareAbility } from './SolarFlareAbility.js';

const ABILITY_TYPES = {
  ice: IceAbility,
  thunder: ThunderAbility,
  meteor: MeteorAbility,
  beam: BeamAbility,
  snare: SnareAbility,
  solar: SolarFlareAbility
};
```

Without this step, the VFX Editor may show the name but cannot cast it.

---

## Step 5 — Add editor controls

Edit:

```text
src/reference-vfx/ui/Editor.js
```

Add a `Solar Flare` folder and bind each controller directly to `settings.solar`:

```js
_buildSolar() {
  const folder = this.gui.addFolder('☀ Solar Flare');
  const s = settings.solar;

  Editor.range(folder, s, 'range', 1, 20, 0.1, 'range');
  Editor.range(folder, s, 'speed', 1, 30, 0.1, 'travel speed');
  Editor.range(folder, s, 'cooldown', 0.1, 15, 0.1, 'cooldown');
  Editor.range(folder, s, 'impactRadius', 0.1, 5, 0.05, 'impact radius');
  Editor.range(folder, s, 'damage', 0, 300, 1, 'damage');
  Editor.range(folder, s, 'burnDuration', 0, 10, 0.1, 'burn duration');
}
```

Call the builder from the `Editor` constructor.

Because the settings object is live, sliders should update the active cast while the simulation is running or paused.

---

## Step 6 — Add the skill to the VFX Lab HUD and input

Edit:

```text
src/reference-vfx/config/settings.js
src/reference-vfx/input/InputManager.js
```

Example metadata:

```js
solar: {
  label: 'Solar Flare',
  accent: '#ffb347',
  key: 'X',
  hint: 'Solar Flare'
}
```

Then add an input case:

```js
case 'KeyX':
case 'Digit6':
  this.emit('action', 'ability', 5);
  break;
```

The HUD is generated from `ELEMENTS`. Once `solar` is a registered element, it becomes a normal playable card instead of the amber manifest-only card.

---

## Step 7 — Register the cast for Hero Studio routing

Edit:

```text
src/reference-vfx/heroSkills.js
```

Add the cast to `REFERENCE_CASTS`:

```js
{
  id: 'solar',
  label: 'Solar Flare',
  key: 'X'
}
```

The same ID must be accepted by `REFERENCE_CAST_IDS` and `normalizeReferenceSkills()`.

This allows the right-side Hero Studio routing controls to assign Solar Flare to:

- Aegis Q/E/R
- Nyx Q/E/R
- Lyra Q/E/R

Do not bypass `normalizeReferenceSkills()`. It prevents malformed JSON from inserting arbitrary IDs into gameplay routing.

---

## Step 8 — Apply manifest assignments safely

The sample manifest may contain:

```json
"assignments": {
  "aegis": "Q",
  "nyx": "E",
  "lyra": null
}
```

These values mean which hero slot should receive the new skill. They are not executable instructions.

The importer should provide an explicit action such as:

```text
Apply manifest assignments
```

Before applying, validate:

- The skill ID is registered.
- Each hero is `aegis`, `nyx`, or `lyra`.
- Each slot is `Q`, `E`, or `R`.
- The skill is available to that hero.

Then convert the result to the existing route format:

```js
{
  on: true,
  legacyFx: false,
  map: {
    aegis: ['solar', 'thunder', 'meteor'],
    nyx: ['beam', 'solar', 'snare'],
    lyra: ['ice', 'beam', 'snare']
  }
}
```

Never automatically change live gameplay just because a file was uploaded. Import first, show the manifest, then require an explicit Apply action.

---

## Step 9 — Add the gameplay mechanic

The reference ability controls the readable VFX phase. The main game still needs its own gameplay behavior.

Edit:

```text
src/heroes.js
```

The current game calls the hero-slot mechanic on impact. If Solar Flare should be a genuinely new mechanic, the impact callback must include the selected reference cast ID rather than dispatching only by hero and slot.

Conceptually:

```js
const referenceCastId =
  G.referenceVFX?.mapping.map[this.def.id]?.[i];

G.referenceVFX?.cast(this, i, {
  onImpact: () => this._runSkillMechanic(i, G, referenceCastId)
});
```

Then dispatch Solar Flare separately:

```js
_runSkillMechanic(i, G, referenceCastId) {
  if (referenceCastId === 'solar') {
    this.solarFlareMechanic(G);
    return;
  }

  // Existing hero-slot mechanics remain here.
}
```

Otherwise assigning Solar Flare to Aegis Q would only change the visual cast while still running the old Aegis Q mechanic.

Implement and test:

- Damage or healing
- Burn/status effects
- Knockback
- Cooldown and energy payment
- Target filtering
- Friendly/enemy behavior
- Impact timing
- Death/downed behavior

---

## Step 10 — Add CAST SIM support

Edit:

```text
src/sim.js
src/studio.js
```

The CAST SIM should be able to:

- Select Solar Flare
- Force a cast through the real ability path
- Display the correct skill name
- Display the measured impact timing
- Apply the real gameplay mechanic
- Show damage/status results
- Reset all pooled effects
- Repeat the cast without leaks

Do not create a preview-only simulation path.

---

## Step 11 — Add tests

Update or extend:

```text
 tools/reftest.mjs
 tools/vfxtest.mjs
 tools/simtest.mjs
```

Required checks:

### Routing

- `solar` is accepted as a registered cast ID.
- Invalid IDs still fall back safely.
- Aegis Q and Nyx E can map to Solar Flare.

### VFX

- Solar Flare can be selected.
- It spawns correctly.
- It reaches impact once.
- It fades and cleans up.
- Pool resources are reused.
- Extreme settings do not create NaN values.

### Gameplay

- Damage is applied once.
- Burn ticks have the expected count and duration.
- Cooldown blocks an unforced second cast.
- CAST SIM can force a cast and reports that it did so.
- Reset removes all active effects.

Run the full validation set:

```bash
node build.mjs
git diff --check
node tools/reftest.mjs
node tools/vfxtest.mjs
node tools/skintest.mjs
node tools/simtest.mjs
```

---

## Step 12 — Rebuild and verify manually

After code and tests pass:

```bash
node build.mjs
```

Open `hero-studio.html` and verify:

1. Solar Flare is a normal skill card, not `JSON · NOT PLAYABLE`.
2. The `X` key selects it.
3. The VFX Editor contains a Solar Flare folder.
4. Q/E/R routing can assign it to each hero.
5. Importing the manifest shows the registered skill.
6. Applying assignments updates the Hero Studio routing controls.
7. CAST SIM fires the real skill.
8. The main match uses the same impact timing and mechanic.

---

# Portable skill packages and uploaded assets

A folder-based skill package is recommended for source control and handoff, but uploading asset files alone does not create a real ability. The code registry and gameplay implementation are still required.

## Recommended repository layout

Use a stable skill-ID folder for source material:

```text
examples/skills/<skill-id>/
├── <skill-id>.skill.json       # manifest and tuning contract
├── README.md                   # art, gameplay, and implementation notes
├── preview/                    # optional PNG/GIF reference artwork
└── checksums.txt               # optional asset verification

src/reference-vfx/abilities/
└── <PascalCase>Ability.js      # real pooled ability implementation

models/uploads/
├── <skill-id>-s0-fx.glb        # optional Q FX asset
├── <skill-id>-s1-fx.glb        # optional E FX asset
├── <skill-id>-s2-fx.glb        # optional R FX asset
├── <skill-id>.webm             # optional video FX
└── <skill-id>.ogg              # optional audio cue
```

Keep source manifests and documentation under `examples/skills/<skill-id>/` or a future `skills/<skill-id>/` directory. Keep runtime-discovered GLB, video, and audio files in `models/uploads/` until the library API supports nested package directories.

## Important upload limitation

`tools/upload_server.py` currently accepts a **flat filename** and saves it directly into `models/uploads/`. It strips directory components and only accepts supported file extensions. The current VFX Editor `/files` picker also scans that flat upload directory.

Therefore:

- `models/uploads/solar-flare-s0-fx.glb` will be discovered by the current library.
- `skills/solar-flare/assets/solar-flare-s0-fx.glb` will not automatically appear in the current picker.
- A folder can be committed to the repository for portability, but nested files need library-scanner/importer support before they become selectable in the UI.
- Use unique skill-prefixed filenames to avoid collisions in the flat upload directory.
- Do not put JavaScript source in `models/uploads/`; code belongs in `src/` and must be reviewed, tested, and bundled.

## Portable skill package checklist

```text
[ ] Stable skill ID chosen and documented
[ ] <skill-id>.skill.json included
[ ] Effect IDs use {id}.{phase}, for example solar-flare.impact
[ ] README explains targeting, timing, gameplay, VFX, audio, and assignments
[ ] Preview PNG/GIF references included if needed
[ ] Ability class included under src/reference-vfx/abilities/
[ ] GLB/video/audio files use unique flat names in models/uploads/
[ ] JSON asset paths point to models/uploads/<filename>
[ ] Settings profile added to settings.js
[ ] AbilityManager registry entry added
[ ] ELEMENTS and ELEMENT_META entry added
[ ] Input key registered
[ ] REFERENCE_CASTS and normalization entry added
[ ] Hero Studio assignment support added
[ ] Gameplay mechanic added to heroes.js
[ ] CAST SIM support added
[ ] Missing assets have a procedural or silent fallback
[ ] Repeated casts and cleanup tested
[ ] node build.mjs completed
[ ] all skill/runtime tests pass
[ ] package and assets are committed together
```

## Making a package portable

For a portable handoff, commit the manifest, implementation, documentation, and referenced assets together. A fresh checkout still needs:

```bash
npm install
node build.mjs
python3 -m http.server 8080 --bind 0.0.0.0 --directory .
python3 tools/upload_server.py
```

The upload server is only needed for Hero Studio save/config and library discovery. Committed assets can be served directly, but their JSON paths must match the location used by the runtime.

---

# Removing or disabling a skill

Removing a skill requires a migration plan because saved routing and preset files may still reference its ID.

## Safe disable

Use this when the skill should remain in old saved files but not be assignable:

1. Set its availability to disabled in the skill registry.
2. Remove it from the default assignment map.
3. Keep a compatibility fallback in `normalizeReferenceSkills()`.
4. Show `Skill unavailable` in the UI instead of silently changing a user assignment.
5. Keep the ability class available for old replays or saved sessions if required.
6. Add a test proving old config loads safely.

## Full removal

Use this only after migration:

1. Find all references to the skill ID:

   ```bash
   grep -RIn "solar" src tools examples README.md HANDOFF.md
   ```

2. Migrate saved assignments to a replacement skill.
3. Remove it from `REFERENCE_CASTS` and `REFERENCE_CAST_IDS`.
4. Remove it from `ELEMENTS` and `ELEMENT_META`.
5. Remove its keyboard input case.
6. Remove its VFX settings block.
7. Remove its `Editor.js` folder.
8. Remove its `AbilityManager` registry entry.
9. Remove its ability class and unique assets if unused.
10. Remove its gameplay mechanic.
11. Remove its CAST SIM entry.
12. Update tests, manifests, documentation, and default assignments.
13. Rebuild and run the full validation set.

Never delete a skill ID first and migrate saved JSON later. That causes normalization to silently replace user assignments with defaults.

---

# Ready-to-ship checklist

```text
[ ] Stable ID and manifest contract documented
[ ] Settings profile added
[ ] Ability class implemented
[ ] AbilityManager registry updated
[ ] VFX Editor controls added
[ ] HUD metadata and keyboard input added
[ ] Hero Studio cast registry updated
[ ] Manifest assignment validation added
[ ] Gameplay mechanic added
[ ] CAST SIM added
[ ] Audio and asset fallback verified
[ ] Pool cleanup verified
[ ] Repeated casts verified
[ ] Import/export verified
[ ] Removal/migration path documented
[ ] reftest passes
[ ] vfxtest passes
[ ] skintest passes
[ ] simtest passes
[ ] Generated bundles rebuilt
[ ] git diff --check passes
```
