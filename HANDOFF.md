# NEON VANGUARD — Engineering Handoff

**For:** the next agent or a fresh chat picking this up cold.
**Read this first.** It is the authoritative index; the other docs are deeper dives.

Last verified: 2026-09-09 (v1.11.3, MOTION-AUDIT F3–F8: the bench drives the body) ·
`neon-vanguard.html` 797 KB · 21 modules in `src/`. Headless suites all pass: `lighttest` 35/35,
`geocheck` clean, `glbtest` 25/25, `skintest` 153/153, `herofit` 18/18, `simtest` 56/56,
`animcheck` 30/30, `fxsample` clean. **The puppeteer suites were NOT run** — this sandbox still cannot reach the Chrome
download hosts (only the npm registry works), so there is no browser to point them at. Re-run all eight
before trusting anything visual, and say so plainly in the commit. See §6.

---

## 0. Sixty-second orientation

**Neon Vanguard** is a 3D top-down cyberpunk arena action game for the browser, built on **three.js r169**.
You pilot one of three operatives; the other two fight as AI. Wave survival, boss every 5th wave, an
implant draft between waves, and an ultimate-chain combo system that rewards swapping mid-fight.

Everything in the game is procedural — geometry, textures, animation, all 38 sound effects and the music.
**There is not a single asset file required to boot.** The whole game ships as one self-contained HTML file.
(The uploaded hero skins and skill-effect clips in `models/uploads/` are an *optional* art pipeline: the game
reads them if they are there and falls back to the procedural rig if they are not — see §7a.)

**The deliverables:**
| File | What |
|---|---|
| `neon-vanguard.html` | the game (717 KB, open it directly, no server needed) |
| `character-bay.html` | character turntable viewer (589 KB) |
| `model-viewer.html` | art-direction tool — drop a GLB next to the procedural rig (674 KB) |
| `hero-studio.html` | Hero Studio — tune uploaded skins and edit per-skill effects (695 KB) |

---

## 1. Build & run

```bash
git clone https://github.com/TylerYKL/NEON-VANGUARD.git
cd NEON-VANGUARD
npm install              # REQUIRED after any session restart — see the warning below
node build.mjs           # bundles src/ into both HTML deliverables
python3 -m http.server 8080 --bind 0.0.0.0 --directory .   # live preview
```

> ### ⚠️ `node_modules` does not survive between sessions
> The workspace snapshot excludes `node_modules`, `.cache` and friends. After a restart, `node build.mjs`
> will fail with `Cannot find package 'esbuild'`. Run `npm install` first.
>
> **Puppeteer also needs system libraries** that don't persist. If Chrome fails with
> `libnspr4.so: cannot open shared object file`, run:
> ```bash
> sudo -n apt-get install -y -qq libnspr4 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 \
>   libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
>   libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libatspi2.0-0t64
> ```
> The built HTML files are unaffected by any of this — they are self-contained and always current.

`build.mjs` inlines the minified bundle into the HTML. **The replacement must use a function**, because
minified esbuild output contains `$&`, which a string replacement would expand. This bug has bitten once.

---

## 2. Repo map

```
NEON-VANGUARD/                  (repo root — also the GitHub Pages root)
├── index.html              landing page: play links + roster + doc index
├── neon-vanguard.html      DELIVERABLE — the game, self-contained, 703 KB
├── character-bay.html      DELIVERABLE — character viewer, 576 KB
├── HANDOFF.md              ← you are here
├── NEON-VANGUARD-PROPOSAL.md   the plan: engine choice, design, roadmap, changelog (v1.7)
├── NEON-VANGUARD-REVIEW.md     the critical review that drove v0.5–v0.9
├── README.md               developer quick reference
├── build.mjs               esbuild → inline → both deliverables
├── shell/                  HTML shells + all CSS/HUD (game.html, bay.html) — build inputs
├── concept/                3 AI-rendered concept sheets (Phase 3 art target)
├── screenshots/            12 gameplay + 7 character-bay captures
├── tools/                  headless puppeteer test suites (see §6)
└── src/
    ├── main.js      1474  bootstrap, post FX, input, gamepad, camera, wave director, draft,
    │                      hazards, settings, dev-tool wiring, the shared context object `G`
    ├── heroes.js    1389  hero data, all 12 abilities, buffs, damage/heal, squad AI, playFX per skill slot
    ├── sim.js         411  CAST SIM: the studio bench — real useSkill against stand-in targets + hooks
    ├── entities.js   704  projectile pool, enemy types + AI, elites, telegraph driver, pooling
    ├── audio.js      587  WebAudio synth toolkit, 38 SFX cues, adaptive music sequencer
    ├── showcase.js   459  character bay (separate entry point)
    ├── viewer.js     215  model viewer: GLB drop + procedural rig side-by-side (art tool)
    ├── gltfutil.js    78  DOM-free GLB parse/stats/normalise + the stage stamp a clone keeps (viewer/herofit)
    ├── studio.js     913  Hero Studio: size / placement / motion / per-skill FX editor / CAST SIM → hero_tuning.json
    ├── fxpack.js     454  skill-effect layer: slot resolution, clampFX, pooled clones, video + light reuse
    ├── glbskin.js    159  uploaded hero skins + hero_tuning.json reader (v2) + URL-keyed effect bank
    ├── fx.js         431  pooled particles/rings/beams/sparks/telegraphs, shake, flash
    ├── world.js      311  arena, floor shader, baked skyline, billboards, rain, cover pylons
    ├── rig.js        354  faceted humanoid rig (chamfer/seg + flat shading) + animator + weapons
    ├── ui.js         205  HUD binding (DOM overlay)
    ├── devtools.js   180  the dev overlay (backtick): sliders, cheats, perf, JSON round-trip
    ├── pickups.js    169  charge shards + Charge Cores
    ├── lights.js     161  fixed-size PointLight pool — keeps the scene's light count constant
    ├── balance.js    145  EVERY tunable number + ranges + applyBalance()
    ├── upgrades.js   136  21 implants + rarity-weighted draft roller
    └── util.js       121  math/material/texture helpers + disposeObj()
```

**Editing the HUD or page chrome?** That lives in `shell/game.html` (and `shell/studio.html`,
`shell/bay.html`, `shell/viewer.html`), not in a built file. The four root `*.html` deliverables are
generated by `node build.mjs` — never hand-edit them.

---

## 3. Architecture

**One shared context object, `G`** (defined in `main.js`, exposed as `window.G`). Every system receives it.
No circular imports; trivially serialisable later for replays or netcode.

**Key fields on `G`:** `heroes[] enemies[] effects[] pickups[] barriers[] hazards[]`, `mods` (implant
modifiers), `taken` (implants owned), `wave waveActive spawnQueue`, `hpScale dmgScale eliteChance maxAlive`,
`ultChain ultChainT ultMul overdriveT timeScale hitStop`, `drafting tut god perfBudget`,
`fx ui world scene camera projectiles enemyPool`.

**Effects are coroutines.** `G.addEffect({ update(dt) { …; return stillAlive; } })`. Multi-phase ultimates
(charge → detonate → fade) read top to bottom. Anything time-based must go through this, never `setTimeout`
— see §4.

**Data-driven content.** `HERO_DEFS` (heroes.js), `ENEMY_TYPES` + `ELITES` (entities.js), `WAVES` (main.js),
`UPGRADES` (upgrades.js), `BALANCE` (balance.js). Adding content should not touch engine code.

**Render/sim separation.** Simulation `dt` is clamped at 50 ms and then multiplied by `G.timeScale`
(bullet-time) and hit-stop. Wall-clock `rawDt` is kept separately for timers that must ignore both.

---

## 4. Invariants — break these and things go subtly wrong

1. **Pool everything.** Particles (6,000), rings, beams, sparks, telegraphs (28), projectiles, combat text
   are all pooled. Never allocate inside the frame loop.
2. **Release what you take.** `fx.telegraph()` must be paired with `fx.tellRelease()` on death, interrupt
   *and* cleanup. If the pool starves, enemies stop telegraphing. `tools/` tests assert it returns to 28.
3. **`disposeObj(scene, obj)` for anything an ability builds at cast time.** `scene.remove()` alone leaks a
   geometry and a shader per cast. Used in 6 places in `heroes.js` — but deliberately **not** in
   `playFX()`: an uploaded effect is a clone of a bank template (see invariant 13).
4. **Flag animated meshes.** `bakeStatics()` in `entities.js` merges every non-animated child sharing a
   material. If you animate a mesh, set `o.userData.animated = 1` or it will be swallowed into the merge.
5. **Enemy materials are shared per type** (`SHARED_MATS`). Never mutate them per instance — per-instance
   glow lives on the separate `glowMats` array.
6. **Enemies are pooled per type.** `spawnEnemy()` calls `reset()` on a recycled instance rather than
   rebuilding the mesh tree. Do not `new Enemy()` in gameplay code.
7. **Never `setTimeout` for gameplay timing.** It ignores pause and bullet-time. Use `G.addEffect`.
   (Two exceptions exist deliberately in `main.js` for UI sequencing outside the sim.)
8. **A NaN/Inf clamp pass runs before the bloom.** One overflowing additive pixel becomes `Inf`, spreads
   through the bloom mip chain and blacks out the entire frame. Do not remove `ClampShader`.
9. **Schedule audio 20 ms ahead.** Cues fire at `currentTime + 0.02`. Scheduling into the current render
   quantum truncates short envelopes — a punch degrades into a click.
10. **All balance numbers live in `balance.js`.** Don't reintroduce literals into gameplay files.
11. **All implant effects read `G.mods`.** If you add an implant, wire it to a real call site in the same
    change. The pool is deliberately free of cosmetic stats.
12. **Never create a `PointLight` in gameplay code — the scene's light count must not change during play.**
    three.js bakes the light COUNT into its shader program cache key (`numPointLights: lights.point.length`
    → `getProgramCacheKeyParameters`), so a light appearing or disappearing recompiles *every* material in
    the frame. Enemies, pickups and abilities all borrow from `G.lights` (`src/lights.js`), a fixed pool
    built once at boot. Spare slots stay `visible` at intensity 0 — `projectObject()` skips invisible
    objects before it ever reaches the `isLight` branch, so hiding a spare would change the count and
    defeat the whole scheme. `tools/lighttest.mjs` asserts the invariant.
13. **Uploaded skill effects borrow, they never own.** `fxpack.spawnFX()` clones a bank subtree out of a
    per-file free list, applies a *cached* material set, shares one `<video>` + `VideoTexture` per clip file
    (refcounted) and borrows a light from `G.lights`. So `disposeObj()` on a spawned effect would destroy the
    bank's geometry for every later cast — call `inst.kill()` instead. It is idempotent, and every FX
    coroutine carries `dispose() { inst.kill() }`, because a run reset truncates `G.effects`; skipping that
    strands a video decoder and a pooled light slot. A cast that fades or goes translucent needs material of
    its own, and even those come from a free list keyed by look and are *returned*, never `dispose()`d —
    disposing would drop a shader program's refcount between casts and make the next one recompile.
14. **Studio tuning is clamped on read, never trusted.** `glbskin.ensureTuning()` + `fxpack.clampFX()` bound
    every value in `hero_tuning.json` — scale, offsets, motion and all eleven FX parameters. That file is a
    hand-editable input now, not a build input, and one unclamped NaN scale goes straight into the bloom chain
    and blacks out the frame (trap #1).

15. **The loader owns `root.position`; consumers adjust it, they never place it.** `normalizeToStage()`
    centres a body and lifts it by its own half-height (+1.199 m for a 2.4 m hero) by writing into
    `root.position`, and it returns + stamps `userData.stage` with that `lift`. Anything that later writes
    `position.set(x, y, z)` from a config throws the lift away — that is how every uploaded hero ended up
    buried to the waist. `Hero` therefore caches the fit as `_basePos` and writes `base * tunScale + offset`;
    the scale belongs in that product because scaling a body scales its offset from the root as well (§7a).
    **Trap found while adding `SkeletonUtils.clone`** (phase A of MOTION-AUDIT §4, now used for every hero body
    and every pooled FX clone): it deep-copies the skeleton but does **not** carry `userData`, so a stamped
    `userData.stage` does not ride along. `heroes.js` copies it forward by hand; `glbtest` pins both halves —
    the stamp is absent on a raw skeleton clone, and present (with the same fit) on a built `Hero`.
16. **A rest pose is measured once and read thereafter, never repeated as a literal.** The hips baseline used
    to live in three places that disagreed — `buildHumanoid` wrote `0.95 * scale` (a double-applied scale: the
    root is scaled too), `animateRig` overwrote it with a flat `0.95` every frame, and `Hero.hipsRest` carried
    a third copy nobody read. Net effect: every procedural hero stood ~15 cm *into* the deck, and a GLB-skinned
    AEGIS ended a slam **floating 0.95 m** above it, because a GLB rig's rest is 0 and the slam "restored" 0.95.
    `buildHumanoid` now solves `rig.hipsRest` from the leg bounds (soles land on y = 0) and every writer reads
    it; a shim rig with no builder must still *declare* its rest (`heroes.js:136`, `hipsRest: 0`). A stride's
    bob is one-sided for the same reason: a ±bob costs twice its amplitude in clearance at the trough.
17. **An effect that edits a transform it does not own every frame must restore it from `dispose()` too.**
    `startGame()` disposes what it drops (`main.js:921`) *before* truncating `G.effects`, so a restore written
    only at the end of `update()` leaves the world edited mid-flight — a reset during the leap used to leave the
    body at whatever height the arc was at, up to 2.45 m, with nothing per-frame to bring it back down.
    `fxpack.kill()` releasing lights and video refs is the same rule.
18. **One owner per state field, per tick context.** Whoever decays a field is the only thing allowed to
    decay it. `CAST SIM` runs the real `Hero.move` + `Hero.update`, so while the bench is installed the studio's
    frame loop must not decay `attackAnim/castAnim/hurtAnim` by hand (`studio.js:914`) — a double-advance looks
    *fine* one frame at a time and makes every timing read in the panel wrong by 2×. `simtest` asserts both
    directions: stub `Hero.update` and nothing may drift; let it run and the envelope must fall.
19. **A write that runs every frame must be gated against the branch that clears it.** `railshot` set
    `charge = min(1, t/0.3)` unconditionally and cleared it inside `if (!this.fired && t >= 0.3)` — so the last
    ~0.15 s of its own coroutine wrote `1` back over the clear and NYX kept the overcharge aura, a max coil and a
    60-per-second particle spawn for the rest of the run (MOTION-AUDIT F8). Gate the write (`if (!this.fired)`);
    and if a field has no consumer at all, delete it (F7 was that, and is now wired instead).

---

## 5. Traps discovered the hard way

| Trap | Reality |
|---|---|
| Black viewport in screenshots | Not a renderer bug — an `Inf` pixel spreading through the bloom chain (see invariant 8). It would hit real GPUs too. |
| `renderer.info` after `composer.render()` | Reports only the final fullscreen quad ("1 call, 1 triangle"). Fixed with `autoReset = false` + manual reset; now accumulates across passes. |
| The in-game FPS counter | Now honest (wall-clock ms measured before the sim clamp). It used to floor at 20 because `dt` is capped at 0.05. |
| Headless game clock | Puppeteer throttles rAF hard — **roughly 0.2 game-seconds per wall second**. A 3 s ability takes ~15 s of test time. Budget waits accordingly; a test that "fails" may just need longer. |
| `page.click('#start')` | Throws "not clickable" below ~600 px viewport height. Use `page.evaluate(() => document.getElementById('start').click())`. |
| Image A/B testing a live game | Worthless — random spawns and live FX never produce comparable frames. Verify geometry changes by comparing **vertex count and world-space bounding box** instead. |
| Audio level measurement | A `ScriptProcessor` meter reads low when the main thread is saturated by the 3D loop. Measure in an isolated page running only `audio.js`. |
| `mergeGeometries` returning null | All inputs must agree on index state. De-indexing to force agreement triples vertex counts — only do it when they genuinely disagree. |
| The draft halts the sim | `G.drafting` gates the whole update block. A test that spawns enemies after a wave clear must dismiss the draft (`Escape`) first. |
| String replace in `build.mjs` | Minified output contains `$&`. Use a function replacer. |
| A state field written per frame and cleared in a branch | The clear loses. `railshot` wrote `charge = min(1, t/0.3)` every frame of its own 0.45 s effect and zeroed it on the fire frame, so the effect's tail re-stamped `1` and NYX kept the aura + a particle per frame forever (MOTION-AUDIT F8). Gate the write with the same condition the clear uses. Invisible until something *outside* the hero ticked the flourish it feeds — the bench is that something. |
| Two tickers, one decay | `studio.js` hand-decayed the animation envelopes while `CAST SIM` was also running `Hero.update`: 2× every duration, in a panel whose whole job is judging durations. Neither side looked broken (invariant 18). |
| Uploaded hero shows only its upper half | Not the model, not the camera: the animation loop rewrote the root position that `normalizeToStage()` had used to lift the body, so the lower half sat under the deck (invariant 15). `node tools/herofit.mjs` measures it. If you already dialled `pos.y` ≈ +1.2 to fight it, that value now double-lifts — **RESET** the placement. |
| `Box3.setFromObject` on a moving preview | In the studio it reads whatever the *previous* frame's bob left there. `measureFit()` re-applies the rest maths, measures, then restores — otherwise the readout and auto-lift are one frame stale. |
| A `PointLight` per entity | Looked free, was not. Every enemy *and* every dropped shard carried one, so 45 enemies meant 45+ point lights, and the count moved on every spawn, death and pickup. three.js keys its shader programs on that count, so each change recompiled every material — and the fragment shader looped over all of them per pixel. Completely invisible under swiftshader, where every frame is already 250 ms. |
| Effect bank keyed by hero id | v1.9 stored one effect per hero (`fxBank[heroId]`), so every skill cast the same burst and a second file could not be assigned. The bank is keyed by **file URL** now (`fxpack` resolves `fxSlots[i]` → shared `fx`), which is what lets Q / E / R each hold a different effect — and lets one file serve several heroes without re-parsing. |
| One `<video>` per cast | v1.9 built a new element + `VideoTexture` (and a `PlaneGeometry`) for every cast and disposed them on fade. Two casts of the same clip meant two decoders. `fxpack.acquireVideo()` refcounts one element per file instead, and the quads come from a free list. |
| `disposeObj()` on an effect clone | Clones share the bank template's `BufferGeometry` and materials, so disposing a spawned effect deletes the model for every later cast (the next one renders nothing). `kill()` returns it to the pool; only materials a cast had to *own* (fade / opacity) are disposed. |
| Fading a shared material | The obvious way to fade an effect is `cachedMat.opacity = …`. If two allies cast the same tuned effect, they fight over one number and both flicker. `needsOwn()` clones per-instance materials only when a look actually fades or goes translucent, and disposes them on kill. |
| Studio save does nothing | The studio writes through the `:8081` dropbox (`tools/upload_server.py`). Without it running, `SAVE` 404s — the panel now says so instead of looking like it worked. |
| Pool budget key names | `LightPool.setBudget()` reads `lightsEnemy` / `lightsPickup` / `lightsEffect` straight out of `BALANCE.perf`. Pass it `{enemy: 8}` and it silently builds **zero** lights — the game still runs, just unlit. `tools/lighttest.mjs` catches it. |
| `?.` on a pooled light | `G.lights.acquire()` returns `null` when the kind is exhausted (four ultimates at once). Every `light.intensity = …` in an ability must be guarded `if (light) …`. Four were missed on the first pass and would have thrown on the first Trinity chain. |

---

## 6. Test suites

**Headless — plain Node, no browser, run these always.** They import the real modules from `src/` and
exercise the real code paths (three.js geometry and maths work fine without WebGL; only rendering needs a
context):

```bash
node tools/lighttest.mjs  # 35 assertions: the point-light count never moves (v1.8 invariant)
node tools/geocheck.mjs   # per-enemy draw calls / verts / bbox / lights / materials + pooling leak check
node tools/glbtest.mjs    # 12 assertions: the model-viewer GLB pipeline (export->parse->normalise->stats)
node tools/skintest.mjs   # 138 assertions: uploaded skins, hero_tuning.json v1->v2, FX slots, pooling, clamps
node tools/herofit.mjs    # 18 assertions: the REAL models/uploads/*.glb stand fully on the deck (invariant 15)
node tools/simtest.mjs    # 56 assertions: the studio cast bench — abilities + basics run, expire, leak nothing,
                        #   the body stays owned by Hero.update, MOVE/dash work, uninstall gives the page back
node tools/animcheck.mjs  # 30 measurements: the motion layer (feet vs deck, GLB slam float, FX anchor, bones/clips
                        #   per file) — and it statically gates that the per-frame paths allocate nothing
node tools/uploadstats.mjs # tri / mesh / texture cost of every GLB sitting in models/uploads/
node tools/fxsample.mjs   # writes + self-validates the AEGIS skill-FX samples in models/uploads/ (see FX-AEGIS.md)

# headless ART loop — see the characters without a browser (v1.9)
node tools/charpreview.mjs [aegis|lyra|nyx|all]   # run the REAL rig/animator, dump world-space tris to JSON
python3 tools/render.py .tmpbuild/char-<id>.json out.png   # rasterise that JSON to a PNG you can look at
```

> Character art iterates through that last pair. The rigs are faceted plate armour (`chamfer()` / `seg()`
> + flat shading in `rig.js`, v1.9) — if you touch them, re-render and compare against `concept/*.jpg`,
> not against the live game (random poses/FX make live frames incomparable).

**Browser — need puppeteer + a Chrome.** Every one prints `ERRORS none` on success. **Run all six after
any gameplay change.** They take about three minutes total. They leave `*.png` captures in the project
root — delete them before committing.

```bash
node tools/smoke.mjs      # full playthrough, all 12 abilities, boss; writes s1..s13 screenshots
node tools/combotest.mjs  # charge cores → ×2 link → Trinity Overdrive
node tools/p0test.mjs     # telegraphs, dash i-frames, elites, live settings, persistence, run summary
node tools/phase1test.mjs # training gates, hit-stop, occlusion fade, Lyra repair-lock
node tools/drafttest.mjs  # implant offers, apply, stacking, skip
node tools/devtest.mjs    # dev overlay: sliders reach gameplay, cheats, export/reset
node tools/audiotest.mjs  # all 38 SFX cues produce signal
node tools/bayshots.mjs   # re-render the character sheets (writes .png — re-encode to .jpg before committing)
```

> If `npm install` fails with `Failed to set up chrome`, the sandbox cannot reach the Chrome download
> hosts. `PUPPETEER_SKIP_DOWNLOAD=1 npm install` still gets you `three` + `esbuild`, so `node build.mjs`
> and the two headless suites work — but say plainly in the commit that the browser suites were not run.
> There is no substitute for them on anything visual.

Useful in-page hooks (already exposed): `window.G`, `window.SFX`, `G.EnemyClass`, `window.__passes`,
`window.__noPost` (raw render, no post), `window.__nobake` (disable static merging, for A/B).
`?shot=1` in the URL enables `preserveDrawingBuffer` for headless capture.

---

## 7. What exists today

**Combat.** 3 heroes × (basic + 2 skills + ultimate) · squad AI with formation and role heuristics ·
4 enemy types + boss · 4 elite prefixes (shielded/volatile/swift/overclocked) · attack telegraphs with
stun-cancel · dash i-frames · hit-stop · arena hazards from wave 6.

**Systems.** Wave director with per-enemy HP/damage scaling · charge economy (shards + Charge Cores) ·
ultimate chain (×2 link → Trinity Overdrive with bullet-time) · 21-implant draft between waves ·
combo scoring · downed/revive.

**Presentation.** Full post chain (clamp → bloom → grade) · 38 procedural SFX · adaptive synthwave score
that layers up with the wave and drags tempo during bullet-time · DOM HUD · training wave · run summary.

**Player-facing options.** Volume sliders, FX intensity, screen shake, colour-blind hostile palette,
damage-number toggle, gamepad, personal best — all persisted.

**Dev.** Backtick overlay with live balance sliders, cheats, perf readout, JSON round-trip.

---

## 7a. The Hero Studio (v1.10 → v1.10.1) — uploaded skins and skill effects

The `concept/*.jpg` → image-to-3D route is in the proposal's long-run plan; the studio is what makes it
practical. `hero-studio.html` boots the real `Hero` class against `models/uploads/*.glb`, and
`tools/upload_server.py` (`:8081`) is its save/load dropbox. Everything lands in
`models/uploads/hero_tuning.json`, which `startGame()` re-reads on every restart (`ensureTuning(true)`,
cache-bypassed, already-parsed files reused) — so the loop is **tune → SAVE → restart the run**, no page
reload. Nothing in the shipped build depends on the studio: a missing file means default tuning.

**Three editing surfaces, one config file:**

* **SIZE + PLACEMENT** (`scale`, `pos{x,y,z}`, `yawDeg`) — the fix for rebuilders that sink or rotate a body.
  `pos` is an **adjustment on top of the loader's own fit**, so 0 / 0 / 0 is the correct place to sit and the
  sliders start there; each axis has a slider *and* a type-in box (±3 m, matching the clamp in `ensureTuning`),
  and a live readout prints feet / head height and shouts `BURIED` when the deck clips the body. `auto-lift`
  sets Y so the lowest point touches the deck; `reset` zeroes all four for whatever a pre-fix file saved.
* **ACTION MOTION** (`motion`) — the nine `DEFAULT_MOTION` coefficients that give an unrigged statue walk,
  lunge, twist, cast lean, recoil, sway and topple.
* **SKILL EFFECT** — one effect slot per skill (`Q` / `E` / `R`) plus a shared `ALL` slot, each holding a
  `.glb` prop or a video billboard with eleven tuning parameters (`scale y dur grow spin rise fade opacity
  light tint blend`, plus `rate vblend face loop` for video). Assign by drop, by `● REC` (the studio records
  its own canvas while the slot plays and saves `<id>-s<n>-fx.webm`), or from the LIBRARY list of
  `models/uploads/` — the last one needs no re-upload because the bank is keyed by URL. Each library row ends
  in **▶ preview**: it fires the file through the same `spawnFX`, reading params through `fxPreviewFor`
  (edited slot → shared → this hero's other slot → kind defaults) and handing back a *clamped copy*, so a
  preview can never dirty a save; `⟳ loop` re-fires it every 0.22 s and `all · glb · video` filters the list.

The runtime path is deliberately short: `useSkill(i)` → `Hero.playFX(G, i)` → `fxpack.fxFor()` resolves the
slot (per-skill, else shared, else nothing) → `fxpack.spawnFX()` builds it from pooled parts. Both the studio
preview and the match go through `spawnFX`, so "it looked right in the studio" is a real claim. The shape, the
clamping and the pooling are covered by `tools/skintest.mjs` (138 assertions) and the placement maths by
`tools/herofit.mjs` (18), both headless. **`FX-AEGIS.md`** is the worked art-side walkthrough: four sample
effects for AEGIS, written and self-validated by `node tools/fxsample.mjs`, how to assign one per skill, and
what `● REC` actually captures (a canvas grab with no alpha — hence additive blending).

**`MOTION-AUDIT.md` is the review of everything under the FX** (animation, movement, attack), with
`tools/animcheck.mjs` re-measuring its numbers. Two of its findings are shipping bugs and are **not yet
fixed**, on purpose: `seismicSlam` restores `rig.hips.position.y` to a hardcoded `0.95`, which is right for
the procedural rig and wrong for a GLB skin (`hipsRest` is `0` there) → after one Q an AEGIS with an uploaded
skin floats 0.95 m above the deck for the rest of the run; and `animateRig` writes a flat `0.95` where
`buildHumanoid` built `0.95 * scale`, so every procedural hero's feet sit ~15 cm *inside* the deck. Both
are the same root cause — the hips baseline has three sources of truth, one of which (`hero.hipsRest`) is
read by nobody. Read the file before touching `heroes.js:477/512`, `rig.js:175` or anything to do with GLB
animation clips: `heroes.js:111` uses `template.clone(true)`, which **shares skeletons between all four
heroes** (and `fxpack.js:360` does the same to pooled FX clones) — harmless while nothing writes a bone,
catastrophic the moment a mixer does, so `SkeletonUtils.clone` is phase A of that feature.

**CAST SIM (`src/sim.js`) — the bench that makes the panel honest.** `▶ play` shows one prop; the sim runs the
real `Hero.useSkill(i, G)` — leap, impact timing, the ability's own rings/particles/shake, knockback — against
three or six stand-in dummies, with `½×`/`¼×` slow motion applied to `dt` *once* at the top of the studio loop
so nothing is timed twice. It installs the handful of `G` hooks an ability touches (`enemies barriers mods fx
projectiles damageEnemy popText groundAim nearestEnemy absorbedByBarrier explode aimEnemy panOf announceSkill
onUltCast world`) and puts them back on teardown. Two rules keep it from becoming a fake game: a bench target
exposes *only* the fields the abilities actually read (`dead pos radius stun pull slow slowPow center()`), and
`sim.update()` must never tick the page's effect list (double-advance — `simtest` asserts the contract). It
also counts particles by wrapping `fx.spawn`, because `FX.alive` is vestigial in `fx.js`: set once, never
maintained. `G.aimEnemy` and `G.explode` are verbatim copies of `main.js`, so a cast here cannot drift from a
cast there — if those change, change both (the comment in `sim.js` says so).
**Since v1.11.3 the bench also owns the body**: `sim.update` runs `h.move(dt, moveDir)` then `h.update(dt, G)` in
the game's order, which is what makes movement, dash, the combo clock and every envelope decay previewable — and
what caught F8. `SIM_MOVE` (`idle · walk · strafe · circle`) + `sim.dash()` are the inputs; `dash` reports
`BLOCKED (cd …)` rather than forcing, because forcing a cooldown would misrepresent the one movement ability whose
timing is its whole feel. `sim.reset()` (and `uninstall`) walk the hero back to the position *and* facing it was
found at: the bench moves the page's hero, so it owes it back.

---

## 8. What I would do next — in order

> **Landed since this list was written (v1.8): the point-light blowup.** It was not on this list — it was
> found by measuring. Enemy instancing below is still the right next task, and it is now cheaper: the
> enemy lights are already gone, so instancing only has to deal with meshes.
>
> **Landed since then (v1.9–v1.10): the character hard-surface pass and the Hero Studio** — uploaded GLB
> skins, placement/motion tuning, and a per-skill effect editor (§7a). Two things from that work belong on
> the list below: **an FX budget** (a cloned prop is 1 draw call per mesh per cast — the studio warns above
> 24 meshes, but decimating in the DCC is the only real fix) and **re-sourcing `nyx.glb`**, which is still a
> byte-identical copy of `aegis.glb` (same md5), so NYX currently wears AEGIS's armour.

### 1. Enemy instancing ⭐ *the recommended next task*

**Why:** draw calls are the ceiling. Fixed scene cost is ~168 calls; each enemy adds ~4–11 meshes. At the
cap of 45 that is ~360 calls on top of the base, over the 350 budget. Everything else in the backlog adds
content, and content costs draw calls. **Do this before Phase 2 content, not after.**

**Approach:**
- One `InstancedMesh` per enemy type for the baked static body (the merged mesh `bakeStatics` produces).
- Per-instance transform via `setMatrixAt`; hit-flash and the colour-blind retint via `instanceColor`.
- Animated parts (brute legs/fists, sentinel rings, glow eyes) stay as regular meshes for now — that alone
  takes a skitter from 4 draw calls to ~2 and a juggernaut from 7 to ~4.
- Watch out: instanced meshes need a manual bounding sphere or frustum culling will pop them.

**Expected:** 45 concurrent enemies for roughly the cost of 15 today. Effort: ~1 day.
**Verify with:** the §5 method — vertex count and bounding box unchanged, plus `tools/smoke.mjs`.

### 2. Rig mesh reduction (~half a day)
Each hero is ~40 meshes; three heroes are ~120 of the ~168 base. Per-bone `bakeStatics` on the rig would
cut maybe 8–10 per hero. Lower value than instancing but the same technique.

### 3. TypeScript migration (~2 days)
The data tables (`HERO_DEFS`, `ENEMY_TYPES`, `UPGRADES`, `BALANCE`) are where typing pays off most — they
are edited constantly and a typo currently fails silently.

### 4. Content: arenas + enemies (Phase 2)
Two more arena layouts, enemies 5–9, two more bosses. Cheap once instancing lands.

### 5. Touch controls + online leaderboard
Reach and retention. Both are self-contained.

### Deliberately *not* recommended yet
An upgrade-draft expansion, more heroes, or co-op netcode — all three multiply the surface area of a build
that has never been in front of an outside player.

> **The highest-value thing that is not code:** four strangers playing it for 15 minutes. Every priority
> above is inferred from the code and the frames. One external playtest will reorder this list, and it is
> the cheapest information available.

---

## 9. Measured performance

| Metric | Budget | Measured |
|---|---|---|
| Draw calls, no enemies | < 350 | **~168** (was 242 before the v1.7 pass) |
| Draw calls, 15 enemies | < 350 | **347** |
| Draw calls, 45 enemies | < 350 | **330** on top of the base — still over, this is what instancing is for |
| Triangles | < 400 k | 20 k – 33 k |
| Point lights, 45 enemies | constant | **16** total (8 enemy + 4 pickup + 4 effect), was 45+ and growing |
| First load | < 1.5 s | single 703 KB file |

Draw-call and light figures come from `tools/geocheck.mjs` and `tools/lighttest.mjs`, which run the real
`Enemy` / `Pickup` constructors in Node — so they are exact and repeatable, not estimates. Per-enemy cost
today: skitter 5 draw calls, brute 12, sentinel 8, juggernaut 8, each with one health-bar sprite and one
canvas texture, and **zero** lights.

An **adaptive governor** watches frame time: sustained >24 ms sheds 5 from the enemy cap (floor 18) and
trims the particle budget; sustained <14 ms restores it, never above the player's FX setting.

Note: all headless numbers come from swiftshader (software GL) at ~250 ms/frame. Frame *time* readings from
tests are meaningless; draw calls and triangle counts are accurate.

---

## 10. Document index

| Doc | Read it for |
|---|---|
| `HANDOFF.md` | this file — orientation, invariants, traps, backlog |
| `NEON-VANGUARD-PROPOSAL.md` | engine comparison, full game design, VFX/audio architecture, roadmap, and a per-version changelog (v1.0 → v1.11) |
| `NEON-VANGUARD-REVIEW.md` | the critical review that drove the last four passes; the P2 items are still open and still valid |
| `README.md` | developer quick reference: controls, build, module map, subsystem notes |
| `FX-AEGIS.md` | worked example for an art non-programmer: the AEGIS sample skill FX, the assign / tune / ● REC loop, and the tuning cheat sheet |
| `MOTION-AUDIT.md` | the layer under the FX: how a hero is posed/moved/attacked, 8 findings with measured numbers (7 fixed, incl. a shipping bug the bench itself caught), and the plan for GLB animation clips — `tools/animcheck.mjs` re-measures it |

**Open questions still owed by the stakeholder** (§9 of the proposal): monetisation/platform, whether co-op
is the product or a nice-to-have (this changes the architecture *now*), art budget, and final roster size.
