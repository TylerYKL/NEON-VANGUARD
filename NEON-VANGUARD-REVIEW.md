# NEON VANGUARD — Demo Review

**Build reviewed:** `neon-vanguard.html` (647 KB) + `character-bay.html` (572 KB) · 4 715 lines across 11 modules
**Method:** frame-by-frame pass over the captured playthrough and character sheets, plus a source audit of
the combat, spawn, memory and settings paths.

---

## Verdict

**As a prototype it does its job and then some.** It proves the engine choice, the squad-swap hook and the
VFX ceiling — the three things the proposal needed to de-risk. If the question is *"is this worth building?"*,
the answer the demo gives is yes.

**As a game it is not yet fair, not yet configurable, and not yet readable at peak intensity.** Those three
things — in that order — are what stand between this and a slice you could put in front of a player who
isn't you. None of them are architectural; they're all a week of focused work.

Below, ordered by what I'd fix first.

---

## P0 — Fix before anyone else plays it

### 1. Bloom veils the screen during big moments ⚠️ *worst issue*

Look at `screenshots/bay-aegis-signature.jpg`: the moment Seismic Slam fires, the entire frame goes milky
white-orange and **the character you're supposed to be admiring disappears**. The same thing happens in
`04-nyx-railshot.jpg` and in Trinity Overdrive. The peak-excitement moment is the moment you can see least.

**Cause:** `main.js:57` — `UnrealBloomPass(..., strength 0.6, radius 0.85, threshold 0.8)`. A radius of 0.85
is very wide; combined with dozens of additive particles stacking past the clamp ceiling of 12.0
(`main.js:51`) the bloom mip chain smears highlights across the whole frame.

**Fix**
- `radius 0.85 → 0.45`, `strength 0.6 → 0.52`
- clamp ceiling `12.0 → 4.5` (still HDR, far less veiling)
- cap simultaneous spark-streak spawns; the ultimates each dump 90–240 particles with no global budget check
- desaturate highlights above ~2.0 before bloom so white-hot doesn't tint the whole arena

**Also add an "FX Intensity" setting (Low / Normal / Cinematic).** Some players will want the fireworks;
some need to see their character. Right now there's no choice.

### 2. Enemies have zero attack telegraphs

A source search for `windup|telegraph|warn|preAttack` in `entities.js` returns **nothing**. Enemies close to
range and damage simply happens. You cannot react, only pre-empt — so every hit feels arbitrary rather than
earned, and the tank's 35% mitigation is doing invisible work.

**Fix (biggest game-feel win available for the effort)**
- 0.35–0.45 s windup on every attack: a ground decal in the attacker's colour, a body-lean pose, a rising
  audio tick
- Brute charge: a telegraph *line* along the charge path
- Sentinel burst: a laser sight that snaps to the target before the first round
- Juggernaut: 0.8 s wind-up on the slam and a visible fan arc for the plasma spread

This single change is what will make the dodge feel skilful and the tank feel necessary.

### 3. Dash can't dodge

`heroes.js:244` — `this.dashT = 0.18` only feeds an acceleration multiplier (`heroes.js:216`). There are no
i-frames anywhere in the codebase. A dodge that doesn't dodge is a movement button with a cooldown.

**Fix:** 0.20 s invulnerability, a ghost-trail of 3 fading copies of the rig, a small speed-line effect,
and a distinct "successful dodge" audio cue when a projectile passes through the i-frame window.

---

## P1 — Fix during the vertical slice

### 4. No settings at all

`M` toggles mute; that's the whole options surface. Missing: master / music / SFX sliders, FX intensity,
screen-shake toggle (there's a lot of shake, and it will make some players motion-sick), colour-blind palette
— relevant because hostile-red vs Lyra-mint is the primary readability contract.

`P` currently just freezes and shows a static overlay (`main.js:624`). **Make pause the settings home.**

### 5. Nothing persists

No high score, no best wave, no runs played. One `localStorage` key would give the loop a reason to exist
between sessions, and it costs 20 lines.

### 6. Difficulty scales the wrong dimension

`main.js:464` — `scale = 1 + (n - 8) * 0.22`, applied to **spawn counts only**. Enemies never get tougher,
and there is **no cap on concurrent enemies** (`grep 'enemies.length >'` → 0 hits). Wave 25 is therefore not
harder, it's just 5× as many identical skitters — which becomes a frame-rate problem, not a challenge.

**Fix**
- Scale HP and damage alongside count, at a lower rate
- Hard-cap alive enemies (~45) and let the spawn queue drain over time
- Introduce **elite modifiers** instead of raw count: `Shielded` (front arc immune), `Volatile` (explodes on
  death), `Swift` (+45% speed), `Overclocked` (fires 2× rate). One prefix system produces far more variety
  than four more enemy types.

### 7. Memory: not a single `dispose()` in 4 715 lines

Projectiles, rings, beams and combat text are pooled — good. **Enemies and pickups are not.** Each
`new Enemy()` (`entities.js:167`) and each `new Pickup()` builds fresh geometries, materials and lights;
`die()` and `remove()` only call `scene.remove()` (`entities.js:472`, `pickups.js`). Nothing is ever
released, so a long run leaks GPU buffers steadily.

**Fix:** pool enemies per type (reset instead of rebuild), and dispose everything on wave teardown. This also
removes a hitch: spawning 20 brutes currently means 20 geometry uploads mid-fight.

### 8. `setTimeout` in the swarm-missile audio

`heroes.js` schedules the missile SFX with `setTimeout(..., i * 90)`. That ignores both pause and the
Trinity Overdrive time-scale, so during bullet-time the sound desyncs from the visuals, and during a pause
the audio keeps firing. Route it through the game clock like every other effect.

---

## P2 — Polish and content

| # | Issue | Suggested fix |
|---|---|---|
| 9 | **No onboarding.** The menu is a wall of text; a new player will not discover the ultimate chain | A 25-second "Wave 0" that gates on each verb: move → shoot → dash → swap → chain |
| 10 | **The FPS readout lies.** It floors at 20 because `dt` is clamped at 0.05 — it looks like the game runs at 20 fps | Display real frame time, or drop the counter from the shipping build |
| 11 | No gamepad, no touch | Gamepad is ~half a day and makes it feel like a real action game |
| 12 | Cover pylons can fully hide a hero or a boss from the fixed camera | Fade occluders to 25% when they overlap a hero, or allow ±20° camera yaw |
| 13 | **Lyra is the least interesting hero to pilot.** Her drone auto-heals the weakest ally, so the healing fantasy happens without the player | Make the drone a *targeted* resource: aiming at an ally redirects it and doubles throughput; overheal converts to shield. Reward aim, not proximity |
| 14 | The chain window isn't discoverable in the moment | When it opens, pulse the other two squad cards and put a "READY" pip on their portraits — teach the input with the UI, not a tooltip |
| 15 | One arena, no hazards | Electrified floor tiles / collapsing cover: cheap, and forces movement instead of kiting in circles |
| 16 | End-of-run screen has no breakdown | Per-hero damage / healing / kills / best chain. Cheap to add, strong replay motivator |

---

## Balance notes (from the numbers, not from playtesting)

| Observation | Comment |
|---|---|
| **Bastion Field**: 7 s duration / 13 s cooldown = **54% uptime** at 50% DR | Very strong for a non-ultimate. Either drop to 5 s or raise the cooldown to 16 s |
| **Combo decay 3.2 s** (`main.js:399`) | Generous. 2.5 s would create real pressure — and the multiplier should feed ult charge so aggression compounds into the chain |
| **Self-revive at 12 s** (`heroes.js:184`) | With three bodies you essentially cannot lose before wave 10. Scale it: 12 s early, 18 s after wave 10 |
| **Ult chain window 6.5 s** | Correct for now. Discoverability beats difficulty at this stage — tighten to 5 s once the tutorial exists |
| **Ion Fist 3rd hit** does 52 + knockback + cone | Good. The combo counter should be visible on the crosshair so players learn to land the third hit |
| Charge Core every **16 kills** | Feels right for waves 1–8; consider scaling to 22 later so Trinity stays special |

---

## What is genuinely working — don't touch it

- **The swap mechanic.** Instant, tactile, and the AI hand-off is convincing. This is the game.
- **The ultimate chain.** The best design decision in the build. It turns a convenience button into a combo
  input and gives kills a compounding payoff.
- **Weapon and colour language.** Amber tank / mint medic / magenta gunner reads instantly, and the "no
  swords, only hardware" constraint gives the cast a coherent identity.
- **The audio.** 38 synthesized cues and an adaptive score in zero download is punching well above the
  build's weight. The tempo dragging during bullet-time is a lovely touch.
- **Zero-asset pipeline.** Sub-second load for a 3D game is a real competitive advantage; protect it.
- **The Character Bay.** Worth keeping in the shipping build as an unlockable, not just a dev tool.

---

## Suggested next sprint (2 weeks, ordered)

| Day | Work |
|---|---|
| 1 | Bloom/veiling pass + FX Intensity setting + settings menu on pause (P0-1, P1-4) |
| 2–3 | Enemy telegraph system across all four types (P0-2) |
| 4 | Dash i-frames + dodge feedback (P0-3) |
| 5 | Enemy pooling + dispose pass + alive cap (P1-7, P1-6a) |
| 6–7 | Elite modifier system + HP/damage scaling (P1-6) |
| 8 | localStorage persistence + end-of-run breakdown (P1-5, P2-16) |
| 9–10 | Tutorial wave + chain discoverability UI (P2-9, P2-14) |
| 11 | Lyra targeted-drone rework (P2-13) |
| 12 | Gamepad (P2-11) |
| 13–14 | Playtest with 4 people who have never seen it, then re-tune |

**The one thing I'd insist on:** get four strangers to play it before day 13. Every item above is my read of
the code and the frames — a single external playtest will reorder this list, and it's the cheapest
information you can buy.
