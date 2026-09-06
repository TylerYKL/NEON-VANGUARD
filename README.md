<div align="center">

# NEON VANGUARD

**3D top-down cyberpunk squad action that runs in a browser tab.**
Three switchable operatives · wave survival · procedural everything · **zero asset files**.

[**▶ Play**](./neon-vanguard.html) &nbsp;·&nbsp; [**Character Bay**](./character-bay.html) &nbsp;·&nbsp; [**Handoff**](./HANDOFF.md) &nbsp;·&nbsp; [**Proposal**](./NEON-VANGUARD-PROPOSAL.md) &nbsp;·&nbsp; [**Review**](./NEON-VANGUARD-REVIEW.md)

![Neon Vanguard](./screenshots/01-squad-combat.jpg)

</div>

> **New here (human or AI)?** Read **[`HANDOFF.md`](./HANDOFF.md)** first — orientation, architecture
> invariants, the traps that cost time to find, and the prioritised backlog. This README is the developer
> quick reference.

Built with **three.js r169**. You pilot one of three operatives; the other two fight as AI. Swap mid-combo,
chain ultimates across all three, draft implants between waves, and survive. Every polygon, texture,
animation, sound effect and music cue is generated at runtime.

## Two builds

| File | What it is |
|---|---|
| `neon-vanguard.html` | the game — 3 switchable operatives, waves, boss, ultimate chain, audio |
| `character-bay.html` | character turntable viewer — orbit, poses, weapon detail, ability preview |
| `concept/*.jpg` | rendered concept sheets (art-direction target for Phase 3) |

## Play it

* **Zero setup:** open `neon-vanguard.html` — one self-contained 618 KB file, no server, no network.
* **Or serve it:** `python3 -m http.server 8080 --directory .`

### Controls

| Input | Action |
|---|---|
| `WASD` / arrows | Move |
| Mouse | Aim / ground-target |
| Hold `LMB` | Basic attack |
| `Q` `E` | Skills |
| `R` | Ultimate (requires full charge) |
| `Space` | Dash |
| `1` `2` `3` / `Tab` | Switch operative (the other two fight as AI) |
| `P` | Pause |
| `M` | Mute / unmute (or the widget top-right) |

**Ultimate chain:** kills drop charge shards; every 16 kills a **Charge Core** drops that fills all three
ultimates. Fire an ult, swap, fire again within 6.5 s — ×2 is +45% ult damage, all three is **Trinity
Overdrive** (bullet-time, refreshed kit, arena-wide detonation).

**Options** (menu or pause): master/music/SFX volume, FX intensity, screen shake, colour-blind-safe hostile
palette, damage-number toggle. Settings and your personal best persist in `localStorage`.

**Combat feel:** every hostile telegraphs its attack on the ground before it lands — **stunning an enemy
mid-wind-up cancels the attack entirely**. Dash has 0.20 s of i-frames; a clean dodge pays back ult charge.
Heavy blows trigger hit-stop. From wave 6 the deck discharges telegraphed grid zones that hurt both sides.

**Training:** a gated wave 0 runs on your first visit (or from the menu). `K` skips it.

**Implant draft:** clear a wave and pick 1 of 3 implants (mouse, `1`/`2`/`3`, or gamepad). `ESC` skips for
+300. 21 implants across squad stats, run mechanics and per-hero ability rewrites; rarity-weighted with
stack caps. Your build shows on the pause screen and the end-of-run summary.

**Lyra's drone:** aim within 2.8 m of an ally to **lock** the repair drone onto them — 17 HP/s instead of the
6 HP/s passive, and overheal banks as shield. The reticle turns mint when locked.

**Gamepad:** left stick move, right stick aim, RT fire, B dash, X/Y skills, LT ultimate, d-pad switch, Start pause.

**Character Bay controls:** drag to orbit · scroll to zoom · `1 2 3` switch · `Space` fire signature ·
pose buttons drive the procedural rig (idle / move / attack / cast / downed).

## Develop

```bash
npm install          # three + esbuild (+ puppeteer for the smoke test)
node build.mjs       # bundles src/ and inlines it into neon-vanguard.html and public/index.html
node tools/smoke.mjs     # headless playthrough: catches runtime errors, writes ability screenshots
node tools/combotest.mjs # verifies charge cores + x2 link + Trinity Overdrive
node tools/audiotest.mjs # verifies all 38 SFX cues produce signal
node tools/bayshots.mjs  # re-renders the character sheets in screenshots/
node tools/p0test.mjs    # telegraphs, i-frames, elites, settings, persistence, run summary
node tools/phase1test.mjs # training gates, hit-stop, occlusion fade, drone lock
node tools/drafttest.mjs # implant draft: offers, apply, stacking, skip
node tools/devtest.mjs   # dev overlay: sliders reach gameplay, cheats, export/reset
```

Source layout:

```
src/main.js      bootstrap, post-processing chain, input, camera, wave director, shared game context `G`
src/world.js     arena, floor shader, skyline, holo billboards, rain, cover pylons
src/fx.js        pooled particles / rings / beams / sparks, camera shake, screen flash
src/audio.js     WebAudio synth toolkit, 38 SFX cues, adaptive synthwave sequencer, mix + ducking
src/rig.js       procedural humanoid rig + animator + weapon builders
src/heroes.js    hero data, all 12 abilities, buffs, squad AI
src/entities.js  projectile pool, enemy types, steering, boss
src/pickups.js   charge shards + Charge Cores (magnet, beacon, squad overcharge)
src/upgrades.js  implant definitions + rarity-weighted draft roller (writes into G.mods)
src/balance.js   every tunable number + ranges for the overlay + applyBalance()
src/devtools.js  the dev overlay (backtick): sliders, cheats, perf, JSON round-trip
src/showcase.js  Character Bay entry point (studio lighting, turntable, pose driver)
src/ui.js        HUD binding (DOM overlay)
src/util.js      math / material / procedural-texture helpers
```

### Notes for whoever picks this up

* **Everything is pooled.** Particles (6 000), rings, beams, projectiles and floating combat text all come
  from fixed pools — never allocate inside the frame loop.
* **A clamp pass runs before the bloom.** A single overflowing additive pixel becomes `Inf`, spreads through
  the bloom mip chain and blacks out the entire frame. `ClampShader` in `main.js` kills NaN and clamps to 12.0.
  Don't remove it.
* **Abilities are coroutines:** `G.addEffect({ update(dt) { ...; return stillAlive; } })`.
* **Heroes and enemies are data** (`HERO_DEFS`, `ENEMY_TYPES`) — adding content shouldn't touch engine code.
* `?shot=1` in the URL enables `preserveDrawingBuffer` for headless screenshots.
* **Enemies are pooled per type.** `spawnEnemy` reuses an instance via `reset()` rather than rebuilding the
  mesh tree; overflow calls `disposeMeshes()`. Don't `new Enemy()` in gameplay code.
* **Telegraphs come from a pool too** (`fx.telegraph` / `tellSet` / `tellRelease`). Always release on death
  or interrupt or you will starve the pool of 28.
* Particle counts pass through `fx.pMul` and shake through `fx.shakeMul` — both driven by the settings.
* **Hit-stop** goes through `G.punch(seconds)` — capped at 0.10 s and non-stacking. It multiplies `dt`, so
  never decrement a timer that should survive it with the scaled `dt`.
* **All upgrade effects read `G.mods`** (see `MOD_DEFAULTS`). If you add an implant, wire it to a real call
  site in the same commit — the pool is deliberately free of cosmetic stats.
* Arena hazards borrow the telegraph pool. They keep their decal through the discharge phase and release it
  on cleanup — check `fx.tellPool.length` returns to 28 if you touch that code.

### Dev overlay

Press **backtick** (or `F2`) in-game for the tuning overlay: live sliders over every value in
`src/balance.js`, cheats (skip wave / spawn boss / kill all / force draft / full charge / god / slow-mo),
a perf readout (frame time, fps, draw calls, triangles) and JSON round-trip.

**Tuning workflow:** play → drag sliders → *Copy JSON* → paste into `src/balance.js` → commit. An open
session persists across reloads in `localStorage`; *Reset* clears it.

`src/balance.js` is the single source of truth — don't reintroduce balance literals into gameplay files.
`applyBalance()` pushes values into `HERO_DEFS` / `ENEMY_TYPES`.

### Render budget

* **Static geometry is baked at build time.** `bakeStatics()` in `entities.js` merges every non-animated
  child that shares a material. Flag anything you animate with `userData.animated = 1` or it will be
  swallowed into the merge.
* **Enemy materials are shared per type** (`SHARED_MATS`). Never mutate them per instance — per-instance
  glow lives on the separate `glowMats` list.
* **`disposeObj(scene, obj)`** for anything an ability builds at cast time. `scene.remove()` alone leaks.
* An **adaptive governor** trims the enemy cap and particle budget when frame time exceeds 24 ms and
  restores them below 14 ms. It never exceeds the player's FX setting.
* To verify a geometry optimisation, compare **vertex count and world bounding box** before/after — image
  diffs of a live game are meaningless.

### Audio notes

* **Schedule with lookahead.** Cues fire at `currentTime + 20 ms`. Scheduling into the current render
  quantum truncates short envelopes — a punch loses its body and sounds like a click.
* **Per-cue levels live in `AudioEngine.LEVELS`**, calibrated with an offline peak meter, not by ear-guessing
  individual oscillator gains. Frequent cues 0.04–0.13, combat 0.15–0.35, ultimates 0.5–0.99.
* **Music intensity** is driven from `startWave()`: `SFX.setIntensity(0…4)` unlocks pad → bass/kick →
  snare/hats/arp → lead. Ultimates call `SFX.duck()`.
* `node tools/audiotest.mjs` verifies every cue produces signal and reports the master-bus peak.
  Measure levels in an **isolated page** — a `ScriptProcessor` meter reads low when the 3D loop saturates
  the main thread.
