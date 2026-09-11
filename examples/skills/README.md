# Skill JSON sample

`solar-flare.skill.json` is the design and implementation manifest for the registered Solar Flare test ability. It documents the input shape, timing phases, gameplay payload, VFX profile, audio cue, hero assignments, and the code registration points used by the runtime.

`prism-burst.ability.json` is a second sample for the upload validator. It is structurally valid and includes VFX/gameplay metadata, but it is intentionally unregistered so the upload result should be **VALID · REVIEW-ONLY** and the Apply action should remain disabled.

## Import and apply behavior

This sample is now a registered Solar Flare test ability. It still uses an explicit two-stage import/apply flow so uploading JSON cannot silently modify gameplay.

There are two existing JSON import paths, plus a validated workspace upload path:

1. **Right-side VFX Editor → Presets → Import JSON…**
   - Accepts a complete reference-VFX settings snapshot containing `global` and `ice`.
   - Or imports a collection of named lil-gui settings snapshots.
   - It changes live VFX settings only; it does not create a new gameplay ability.

2. **Legacy Hero Studio → IMPORT JSON**
   - Accepts `hero_tuning.json`, either directly or wrapped as `{ "tuning": { ... } }`.
   - Recognised hero keys are `aegis`, `lyra`, and `nyx`.
   - It updates model scale, placement, yaw, animation, legacy skill FX slots, GPU VFX slots, and reference routing.
   - It does not register a new skill ID or new ability class.

3. **VFX Editor → Upload + validate skill…**
   - Accepts `.skill.json` and `.ability.json` documents.
   - Validates kind, version, ID, input, timing, phases, assignments, and object shapes before sending them to `tools/upload_server.py`.
   - The API validates again and only saves valid manifests under `models/uploads/`; `GET /skills` reports valid, registered, and review-only status.
   - Upload/import never executes `implementation` paths. Valid unregistered documents are listed for review but cannot be applied or cast.

When `solar-flare.skill.json` is imported through the right-side VFX Editor:

1. It is displayed in **Hero Studio (Beta) → Imported skill manifest**.
2. Solar Flare appears in the bottom skill bar as a registered `X` ability.
3. Choose **Apply manifest to VFX editor** to apply the validated VFX profile and in-memory Aegis Q / Nyx E assignments.
4. Choose **Save routing to game** to persist the routing and applied Solar profile through the config API.
5. Press `X` in the VFX Lab to test the reference ability, or save routing and restart `neon-vanguard.html` to test the assigned Aegis/Nyx gameplay path with the saved manifest tuning. The headless CAST SIM test also covers the Solar Flare impact and burn path.

The importer and upload endpoint validate the manifest and never execute its `implementation` section. The compatibility panel reports what remains legacy-only. Start the API with `python3 tools/upload_server.py` to enable upload and reload discovery; the static VFX page still boots with local import and defaults if the API is offline.
