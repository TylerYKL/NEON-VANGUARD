# Skill JSON sample

`solar-flare.skill.json` is the design and implementation manifest for the registered Solar Flare test ability. It documents the input shape, timing phases, gameplay payload, VFX profile, audio cue, hero assignments, and the code registration points used by the runtime.

## Import and apply behavior

This sample is now a registered Solar Flare test ability. It still uses an explicit two-stage import/apply flow so uploading JSON cannot silently modify gameplay.

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

When `solar-flare.skill.json` is imported through the right-side VFX Editor:

1. It is displayed in **Hero Studio (Beta) → Imported skill manifest**.
2. Solar Flare appears in the bottom skill bar as a registered `X` ability.
3. Choose **Apply manifest to VFX editor** to apply the validated VFX profile and in-memory Aegis Q / Nyx E assignments.
4. Choose **Save routing to game** to persist the routing through the config API.
5. Use **CAST SIM** or press `X` in the VFX Lab to test the real Solar Flare ability.

The importer validates the manifest and never executes its `implementation` section. The compatibility panel reports what remains legacy-only.
