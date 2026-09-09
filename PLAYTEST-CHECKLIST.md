# NEON VANGUARD — browser QA and outside playtest

This is the manual pass that should happen before adding more arenas, enemies, or FX. It is intentionally
short enough for a stakeholder to follow without reading the source.

## Start the preview

From the repository root:

```bash
python3 -m http.server 8080 --bind 0.0.0.0 --directory .
python3 tools/upload_server.py                 # needed by Hero Studio SAVE / LIBRARY
```

Open `neon-vanguard.html` first. The other useful pages are `character-bay.html`, `hero-studio.html`, and
`model-viewer.html`. Use a fresh browser tab for each page and watch the browser console for errors.

## Browser smoke pass

Record **pass / fail / notes** for each row. A fail should include the browser, OS, page URL, exact steps,
and a screenshot or console error.

### Game — `neon-vanguard.html`

- [ ] Page boots to the menu without a console error or missing asset request.
- [ ] Mouse movement aims; click/hold fires; WASD or arrow keys move.
- [ ] `1`, `2`, `3` switch heroes and the controlled portrait follows the switch.
- [ ] `Space`/signature and each hero's basic, Q, E, and R ability fire.
- [ ] Dash moves the hero, respects its cooldown, and does not leave a stuck effect or light.
- [ ] Enemies spawn, approach, take damage, die, and do not leave orphan meshes.
- [ ] Later waves introduce CHARGER FRAME and WARDEN BEACON; their melee/ranged telegraphs are readable.
- [ ] Wave transitions visibly rotate NEON GRID, CROSSFIRE, and DEADZONE cover layouts.
- [ ] Low / Normal / Cinematic FX intensity changes readability without stopping gameplay; Low keeps heroes visible.
- [ ] Pause/resume works; mute works; settings or dev overlay do not trap keyboard focus.
- [ ] A wave can be cleared and the implant draft can be opened, selected, skipped, and closed.
- [ ] The ultimate chain can be started and completed with hero switching.
- [ ] A run can reach game over or be reset without duplicate heroes, enemies, lights, or effects.

### Character Bay — `character-bay.html`

- [ ] All three heroes load; switching with `1`, `2`, `3` keeps the subject framed.
- [ ] Drag orbit and wheel zoom work in both normal and weapon-detail views.
- [ ] `FOLLOW` keeps the subject framed; `FREE VIEW` preserves a hand-built composition.
- [ ] Pressing `F` toggles the camera mode and does not trigger while typing in a control.
- [ ] Auto-spin can be toggled independently and free view stops it when appropriate.
- [ ] Idle, move, attack, cast, and downed poses remain finite and feet stay on the deck.
- [ ] Signature effects play and clean up; weapon detail frames the actual weapon.

### Hero Studio — `hero-studio.html`

- [ ] All three heroes and their drones load once; switching does not duplicate groups.
- [ ] CAST SIM basic, Q, E, R, auto, target count, slow motion, MOVE, and dash all work.
- [ ] Turning CAST SIM off removes targets and live effects and returns the hero to its starting position.
- [ ] Size, motion, placement, yaw, tint, FX parameters, assignments, mute, and clear controls show `UNSAVED`.
- [ ] Changing a model or clip binding highlights **APPLY + REBUILD PREVIEW**.
- [ ] Apply rebuilds the roster once, preserves selection/position/facing, and leaves no stale mixers,
  drones, or preview effects.
- [ ] Reset restores the selected hero's values from tab open and leaves the required Apply state clear.
- [ ] Export downloads valid `hero_tuning.json`; import restores direct exports and `{ "tuning": ... }`
  files, rejects malformed files, and marks the config unsaved.
- [ ] Save reports success only after the upload server accepts the request; stop the server and verify
  the failure message identifies the server/HTTP problem.
- [ ] FX Library lists the files in `models/uploads/`; previewing a library row does not assign it.
- [ ] Repeated Apply, CAST SIM, preview, and hero switching do not increase scene groups or lights.

### Model Viewer — `model-viewer.html`

- [ ] A shipped GLB can be selected or dropped and shows parse status, triangles, materials, bones, and
  textures without a console error.
- [ ] A malformed or unsupported file reports a useful failure instead of breaking the page.
- [ ] The procedural comparison rig still loads after a model is rejected.

## Outside playtest — 15 minutes

Use four people who have not seen the game. Do not explain the controls beyond the first line below.
Observe silently for the first five minutes.

1. Say: **"Try to survive and use every button that looks useful."**
2. At minute 5, ask them to switch heroes and use an ultimate chain.
3. At minute 10, ask what felt unfair, confusing, or visually unreadable.
4. At minute 15, ask whether they would play another run and why.

Record these answers verbatim:

| Tester | First action | Found dash? | Found hero switch? | Found abilities? | Understood danger? | Would replay? | Biggest issue |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |

Do not turn outside feedback into a feature immediately. Cluster it first into **readability**, **control feel**,
**difficulty/fairness**, **performance**, and **content desire**. Re-rank the roadmap only after that clustering.

## Automated fallback in this sandbox

Puppeteer is installed but Chrome is not available here, so `node tools/smoke.mjs` cannot currently launch a
browser. Until Chrome is available, run the browser-independent checks:

```bash
node tools/skintest.mjs
node tools/glbtest.mjs
node tools/herofit.mjs
node tools/simtest.mjs
node tools/lighttest.mjs
node tools/geocheck.mjs
node tools/animcheck.mjs
```

These validate the GLB/FX pipeline, deck fit, real CAST SIM paths, fixed light budget, enemy geometry,
and animation timing. They do not replace a human visual pass.
