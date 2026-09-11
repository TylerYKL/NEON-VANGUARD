# Skill JSON sample

`solar-flare.skill.json` is a design and implementation manifest for a future skill. It documents the input shape, timing phases, gameplay payload, VFX profile, audio cue, hero assignments, and the code registration points required to make the skill playable.

## Important: this is not currently a drop-in importer

There are two existing JSON import paths:

1. **Right-side VFX Editor → Presets → Import JSON…**
   - Accepts a complete reference-VFX settings snapshot containing `global` and `ice`.
   - Or imports a collection of named lil-gui settings snapshots.
   - It changes live VFX settings only; it does not create a new gameplay ability.

2. **Legacy Hero Studio → IMPORT JSON**
   - Accepts `hero_tuning.json`, either directly or wrapped as `{ "tuning": { ... } }`.
   - Recognised hero keys are `aegis`, `lyra`, and `nyx`.
   - It updates model scale, placement, yaw, animation, legacy skill FX slots, GPU VFX slots, and reference routing.
   - It does not register a new skill ID or new ability class.

When `solar-flare.skill.json` is imported through the right-side VFX Editor, it is now recognized as a skill manifest and displayed in **Hero Studio (Beta) → Imported skill manifest**. It does not add Solar Flare to gameplay or change an existing cast. The VFX Editor shows this limitation in **Compatibility / not migrated → skillImport**.

To make this sample a real playable skill, implement the steps in its `importStatus.nextSteps`: add the ability class, registry entry, gameplay hook, editor profile, routing support, and tests. After that, a dedicated manifest importer can be added safely without accepting arbitrary executable behavior from JSON.
