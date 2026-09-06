# NEON VANGUARD — Engineering Handoff

**For:** the next agent or a fresh chat picking this up cold.
**Read this first.** It is the authoritative index; the other docs are deeper dives.

Last verified: 2026-09-06 · build `neon-vanguard.html` 701 KB · 6,387 lines across 14 modules · all 6 test
suites green.

---

## 0. Sixty-second orientation

**Neon Vanguard** is a 3D top-down cyberpunk arena action game for the browser, built on **three.js r169**.
You pilot one of three operatives; the other two fight as AI. Wave survival, boss every 5th wave, an
implant draft between waves, and an ultimate-chain combo system that rewards swapping mid-fight.

Everything is procedural — geometry, textures, animation, all 38 sound effects and the music. **There is
not a single asset file in the build.** The whole game ships as one self-contained HTML file.

**The two deliverables:**
| File | What |
|---|---|
| `neon-vanguard.html` | the game (701 KB, open it directly, no server needed) |
| `character-bay.html` | character turntable viewer (576 KB) |

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
├── neon-vanguard.html      DELIVERABLE — the game, self-contained, 701 KB
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
    ├── main.js      1445  bootstrap, post FX, input, gamepad, camera, wave director, draft,
    │                      hazards, settings, dev-tool wiring, the shared context object `G`
    ├── heroes.js    1241  hero data, all 12 abilities, buffs, damage/heal, squad AI
    ├── entities.js   693  projectile pool, enemy types + AI, elites, telegraph driver, pooling
    ├── audio.js      587  WebAudio synth toolkit, 38 SFX cues, adaptive music sequencer
    ├── showcase.js   459  character bay (separate entry point)
    ├── fx.js         431  pooled particles/rings/beams/sparks/telegraphs, shake, flash
    ├── world.js      311  arena, floor shader, baked skyline, billboards, rain, cover pylons
    ├── rig.js        282  procedural humanoid rig + animator + weapon builders
    ├── ui.js         205  HUD binding (DOM overlay)
    ├── devtools.js   180  the dev overlay (backtick): sliders, cheats, perf, JSON round-trip
    ├── upgrades.js   136  21 implants + rarity-weighted draft roller
    ├── balance.js    135  EVERY tunable number + ranges + applyBalance()
    ├── util.js       121  math/material/texture helpers + disposeObj()
    └── pickups.js    161  charge shards + Charge Cores
```

**Editing the HUD or page chrome?** That lives in `shell/game.html`, not in a built file. The two root
`*.html` deliverables are generated — never hand-edit them.

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
   geometry and a shader per cast. Currently used in 7 places in `heroes.js`.
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

---

## 6. Test suites

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

Every one prints `ERRORS none` on success. **Run all six after any gameplay change.** They take about
three minutes total. They leave `*.png` captures in the project root — delete them before committing.

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

## 8. What I would do next — in order

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
| Triangles | < 400 k | 20 k – 33 k |
| First load | < 1.5 s | single 701 KB file |

An **adaptive governor** watches frame time: sustained >24 ms sheds 5 from the enemy cap (floor 18) and
trims the particle budget; sustained <14 ms restores it, never above the player's FX setting.

Note: all headless numbers come from swiftshader (software GL) at ~250 ms/frame. Frame *time* readings from
tests are meaningless; draw calls and triangle counts are accurate.

---

## 10. Document index

| Doc | Read it for |
|---|---|
| `HANDOFF.md` | this file — orientation, invariants, traps, backlog |
| `NEON-VANGUARD-PROPOSAL.md` | engine comparison, full game design, VFX/audio architecture, roadmap, and a per-version changelog (v1.0 → v1.7) |
| `NEON-VANGUARD-REVIEW.md` | the critical review that drove the last four passes; the P2 items are still open and still valid |
| `README.md` | developer quick reference: controls, build, module map, subsystem notes |

**Open questions still owed by the stakeholder** (§9 of the proposal): monetisation/platform, whether co-op
is the product or a nice-to-have (this changes the architecture *now*), art budget, and final roster size.
