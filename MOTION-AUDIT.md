# MOTION-AUDIT — hero animation, movement and attack

**What this is.** A review of the layer *under* the FX: how a hero is posed, how it walks,
how an attack starts and lands. Read `FX-AEGIS.md` for effects; this is the audit that
answers "and what about the body?". Six findings, each with a measured number, plus the
plan for GLB animation clips.

**Status: all eight findings are fixed (invariants 16–20 in `HANDOFF.md` record the rules they broke), and
§4's phases A–D are in — clips load, bind and blend, and the studio can point a hero at a rigged file.** `node tools/animcheck.mjs` re-measures every number in
§2 and §3 and stays green until a *new* problem appears (`KNOWN` lines = written-up defects,
`FIXED` = a defect went away and this doc needs updating). Line refs are against
`2e2357e…4875a16`, `src/heroes.js` = 1368 ln, `src/rig.js` = 431 ln.

---

## 1. How a hero is actually moved

There are **no animation clips anywhere in this game.** A frame of a hero is the product of
one positional write and four decaying scalars:

```
main.js:1371-1379   facing  ← mouse/gamepad, angle-lerped (`shortAngle` × dt×16)
                    move(dt, dir)   → vel damped toward dir × speed, dash override, arena clamp
                    Hero.update(dt, G)
                      ├─ attackCd / dashCd / cds[i]          (cooldowns)
                      ├─ attackAnim, castAnim, hurtAnim, comboT, recoil   (the envelopes)
                      ├─ this.group.position = pos ; group.rotation.y = facing
                      └─ rig.glb ? animateGLB(dt,G,spd) : animateRig(rig,dt,{…})
```

| Envelope | Set by | Decays at | Drives |
|---|---|---|---|
| `attackAnim = 1` | `tryAttack` (`heroes.js:363`) | `dt × 5` → ~0.20 s | punch arc / arm aim (`rig.js:194-215`), GLB `twist` + `lunge` (`heroes.js:1261,1271`) |
| `castAnim = 1` | `useSkill` (`heroes.js:450`) | `dt × 2.2` → ~0.45 s | torso lean-back, GLB `castLean` |
| `hurtAnim = 1` | `onDamage` | `dt × 4` → 0.25 s | flinch, GLB `hurtLean` + a 6.4 Hz shudder |
| `downed` | `down()` | — | `rig.js:167` topple / GLB `fallSpeed` |

**Procedural body** (`rig.js:155 animateRig`): a 20-joint Group hierarchy, every joint
`damp()`-ed toward a target derived from `speed`, the phase counter and the envelopes. No
keyframes, so it can respond to anything at any frame rate.

**Uploaded GLB body** (`heroes.js:1252 animateGLB`): the model is treated as **one rigid
statue** — the whole body gets a bob, a walk lean, a step-into-the-swing (`lunge`), a hip
`twist`, a `castLean`, a hurt shudder and a downed topple, all nine coefficients tunable in
the studio (`DEFAULT_MOTION`, `glbskin.js:60`). It is a good trick and it is the reason an
uploaded skin reads as "floaty": there is no knee, elbow or spine in the loop at all.

`hero_tuning.json` never mentions `move` — speed, dash distance, attack wind-up and combo
timing live in `balance.js` and `heroes.js`, which is why the studio cannot preview them.

---

## 2. Findings

### F1 · `SEISMIC SLAM` left a GLB-skinned hero **floating 0.95 m above the deck** — P0 · ✅ FIXED

> **Fixed** by making the rig own its rest height: `buildHumanoid` measures `rig.hipsRest` from the leg bounds,
> the GLB shim declares `hipsRest: 0`, and the slam reads it on the way up, on the way down **and from
> `dispose()`** (a reset mid-leap used to strand the body at the arc's height). `animcheck` now asserts all
> three: the leap still lifts ~1.5 m, one slam leaves the feet where they were, and dispose-then-truncate hands
> the body back. What was written here stays, because the *shape* of the bug — two writers, one transform, no
> owner — is the thing to remember.

The slam owns the leap by writing the hips bone directly, and restores it to a hardcoded
number (`heroes.js:477, 512`):

```js
self.rig.hips.position.y = 0.95 + Math.sin(min(1, t / 0.24) * PI) * 1.5;   // leap
if (t >= this.dur) { self.rig.hips.position.y = 0.95; return false; }        // "restore"
```

A procedural rig's hips *do* rest at 0.95 (`rig.js:57`), so that restore is correct there.
A GLB rig's hips rest at **0** — `heroes.js:132` builds `rig = { root, hips: new Group(), glb: true }`
with the model hanging off it, and `this.hipsRest = 0` one line later. So after **one** Q:

```
feet 0.000 → 0.950 m     (aegis.glb, real file, through the bench; head 2.40 → 3.35 m)
```

and nothing ever writes it back: `animateGLB` writes `body.position` only (`:1266-1272`), never `hips`, not `hips`. 40% of the
hero's own height of air under the boots, for the rest of the run, on every AEGIS slam. The
squad is rebuilt per run (`main.js:701`), so it clears on the next deploy — and re-appears
on the first Q. If a run reset truncates `G.effects` mid-leap (`HANDOFF` §4.9), the hips
stop wherever the arc was (measured: 2.28 m).

`hipsRest` is **read by nobody** in `src/` — the field was added for exactly this, and never
wired. The fix is three lines and one source of truth (see F2):

```js
// rig.js  — the builder states the rest it chose
rig.hipsRest = 0.95 * scale;              // procedural
// heroes.js — both writers ask the rig instead of guessing
self.rig.hips.position.y = self.rig.hipsRest + arc;
```

### F2 · every **procedural** hero stood ~15 cm into the deck — P1 · ✅ FIXED

> **Fixed** by the same measurement (`hipsRest` solves soles → y = 0 instead of trusting `0.95`), plus a
> one-sided stride bob in `animateRig`: a ±bob costs *twice* its amplitude in clearance at the trough, which is
> how a 0.035 bob put 0.145 m of shin under the floor at this hero's scale. `skintest` gained the same
> measurement (build / idle / 90 frames of walking) so the invariant is pinned in two suites.

Same root cause, opposite direction. `buildHumanoid` scales the root *and* puts the hips at
`0.95 * scale` (`rig.js:54,57`) → double-applied; `animateRig` then writes a flat `0.95`
every frame (`rig.js:175`), so the built value is discarded on frame 1 and never restored:

```
aegis (scale 1.4)  feet built +0.392  →  idle −0.145  →  walking −0.122
lyra  (scale 1.3)  feet built +0.240  →  idle −0.158  →  walking −0.096
nyx   (scale 1.32) feet built +0.269  →  idle −0.159  →  walking −0.142
```

Neither value is right: at build the heroes float ~0.3 m, under `animateRig` their feet sink
through the deck plate (which is opaque, so shins clip). It has always looked like this, so
it reads as "the art", but it is a two-writer bug on the *same* transform — the same class as
the v1.10.1 GLB burial fix (`HANDOFF` invariant 15), which is why F1 was easy to miss.

`herofit.mjs` asserts `feet > −0.06` while walking — **for GLB heroes only**. Nothing measures
the procedural path, which is the fallback every player without uploaded skins sees, and the
one the studio shows when a skin fails to parse. One more loop in `animcheck` covers it now.

**Fix, both at once:** `hipsRest` as the single baseline, computed by the builder from the
mesh bounds (feet at 0) rather than a literal, read by `animateRig`, `seismicSlam` and
`animateGLB`; then `herofit` gains a procedural case so the number is pinned.

### F3 · a leap-cast's uploaded FX lands **1.18 m behind** where the ability hits — P1 · ✅ FIXED

`Hero.playFX` anchors the prop at cast time (`heroes.js:1297`):

```js
spawnFX(G, entry, p, new THREE.Vector3(this.pos.x, p.y, this.pos.z), this.facing)
```

but `seismicSlam` moves the hero *after* that (`this.dashT = 0.12`, integrated by `move`).
Measured with `move()` ticked the way the game ticks it: **1.18 m of travel, all of it before
the impact frame at t = 0.22 s.** The ability's own rings/particles are computed at impact, so
they are placed correctly — your `.glb` is left behind at the take-off point. On a ground FX
this is the difference between "the shockwave has a ring around it" and "there is a bit of
junk where I jumped from".

Three ways to fix it, cheapest first:
1. **delay** the prop to the impact frame (each skill already knows its own impact timing —
   the slam's is a named constant), i.e. `playFX(G, slot, atTime)`;
2. a per-slot **`follow`** checkbox in FX LOOK (the prop rides the hero; wrong for slams,
   right for auras);
3. let an ability announce `G.fxAnchor(self, 'impact', pos)` — the biggest change, the only
   one that also fixes LYRA's tether and NYX's rail origins.

**Done: 2, as a per-effect row.** `FX LOOK` gained `anchor · cast point | follow hero`
(`FX_OPT_DEFS` in `fxpack.js`), `spawnFX` takes the caster as `owner`, and when `p.follow === 1`
it re-reads `owner.pos` into its anchor each frame — four writes, no allocation, and the light moves
with it. **Default 0**, i.e. today's behaviour, because "the slam mark stays where I planted it" is a
legitimate look and I am not the one who decides that; what was unacceptable was that no one could
decide it. `animcheck` measures both halves on the real slam: follow=1 puts the prop exactly on the
hero's 1.18 m of travel, follow=0 leaves it at 0.00 m. `tools/fxsample.mjs` states `follow: 0` on
all four AEGIS samples so the documented block lists every row. Option 1 is still the right answer
for a *projectile-ish* skill and option 3 is still what a tether needs; neither is blocked by this.

### F4 · the studio and the bench do not tick `comboT`, so the **combo preview lies** — P2 · ✅ FIXED

`attackFist` sets `comboT = 1.1` and cycles `combo = (combo + 1) % 3`; `Hero.update` is the
only place `comboT` decays (`heroes.js:1091-1092`). The studio decays three envelopes by hand
(`studio.js:884-886`) — not `comboT`, not `recoil`, not `buffTimer`/`iframe`. Consequence in
`CAST SIM`: press **basic** three times slowly and you get the heavy cleave on press 3; in a
match, presses that slow reset `combo` to 0 every time, so **the heavy hit never lands from
isolated presses**. Judging `attackFist`'s 34-particle burst + 0.35 shake from the bench is
therefore judging an attack the game will not usually show.

The honest fix is structural, and it is the same fix as F5: **the bench must call
`Hero.update(dt, G)`** and drop its manual cooldown ticking (the double-advance class of bug
`simtest` already guards for the effects list). That needs five more `G` hooks
(`resolveObstacles`, `ui.feed`, `aimPoint`, `countEnemiesNear`-free — verified: the ones
`update` touches are exactly those) and buys walk, dash, knockback and every envelope decay
for free.

**Done, and it found F8 on the way.** `sim.update` now runs the game's own order —
`h.move(dt, moveDir)` then `h.update(dt, G)` — and the hand-ticked cooldown block is gone;
two more hooks went in to cover what `Hero.update` touches (`resolveObstacles` identity, `ui.feed`)
and `G.ui` was already stubbed. The studio's loop no longer decays `attackAnim/castAnim/hurtAnim`
while the bench is installed (`studio.js`): one owner per tick context, which is invariant 18.
`sim` also owns the *inputs* now — `SIM_MOVE` (`idle · walk · strafe · circle`) and `sim.dash()` —
so the bench has a movement layer for the first time, and `reset`/`uninstall` walk the hero back to
the position and facing it was found at, because a bench that moves the page's hero owes it back.
`simtest` pins all of it: the envelope decay is *absent* when `Hero.update` is stubbed and *present*
when it runs, and AEGIS's heavy cleave only appears inside the 1.1 s window (the ring radius is the
tell: 2.6 light, 4.6 heavy).

### F5 · allocation rule violations in the per-frame path — P2 · ✅ FIXED (and statically gated)

`HANDOFF` §4.4: no per-frame or per-cast allocation. Today:

| Site | Cost |
|---|---|
| `heroes.js:1310,1314,1316,1336` (`updateAI`) | 3–4 `Vector3` **per AI hero per frame** → ~700/s with two squadmates at 60 fps |
| `main.js:1375` | `new THREE.Vector3()` per frame whenever the player is standing still |
| `main.js:863,877` | `hit` + `lead` per frame in the aim path |
| `heroes.js:1230-1231` | 2 per frame for LYRA's drone (idle branch, so most frames) |
| `heroes.js:507` (`seismicSlam`) | `pos.clone()` + **96 `new THREE.Color`** per cast in the fissure loop, and `fx.spawn` already accepts a hex number |
| `heroes.js:376,399` (`attackFist`) | `origin` + a `Color` per swing |

The slam is the worst offender (~100 short-lived objects per press, every 7 s per AEGIS, times
however many AEGISes are on the field). `Color` in particular is free to hoist: `spawn({color: 0xffa03a})`.

**Done.** Hoisted to per-hero scratch (`_moveTarget`, `_aiDir`, `_aiSlot`, `_aiTmp`, `_fxAt`,
`_fistOrigin`, allocated once in the constructor) or to module consts (`DRONE_OFF`, `DRONE_TO`,
`DOWN_EMBER`, `SLAM_EMBER`, `FIST_EMBER`, and `AIM_HIT`/`AIM_LEAD`/`IDLE_DIR` in `main.js`).
Two the table above missed: `move()` did `dir.clone()` — one `Vector3` per hero per frame, the
hottest line in the layer, now `this._moveTarget.set(dir.x*spd, 0, dir.z*spd)`, exact because only
`.x`/`.z` are read — and `playFX` built a fresh anchor `Vector3` per cast. The reuse is safe for a
specific reason, not by luck: `move`, `damageEnemy` and `spawnFX` all copy out of the vector they
are handed and keep no reference (line 245 of `main.js` was already borrowing the hero's own vector,
which is how I knew).
`animcheck` now gates this *statically* — the bodies of `Hero.move`, `Hero.update`, `Hero.updateAI`
and `Hero.animateGLB` must contain no `new THREE.<anything>` — so the rule cannot quietly rot.
Left alone deliberately: `center()` and `handPos()` return fresh vectors (a getter that hands back
shared scratch invites the caller to mutate it), and the per-*cast* clones inside ability coroutines
are one or two objects behind a 7 s cooldown.

### F6 · `attackFist` dereferences `G.mods` unguarded — P3 · ✅ FIXED (guarded)

`heroes.js:374` `G.mods.fistCleave`, `:487` `G.mods.slamStun` — while `useSkill` (`:449`) and
LYRA's lock (`:1120`) both guard with `G.mods ? … : 0`. Any harness or tool that fakes a `G`
(the bench, `simtest`, a future editor) has to know which abilities read mods and which don't.
Two ways to settle it: guard everywhere, or declare `G.mods` **mandatory** and assert it once
in `startGame`. Worth deciding rather than drifting.

**Guarded.** `(third && G.mods ? G.mods.fistCleave : 0)`. The bench and every `tools/*.mjs` harness
fake a `G`, so the guard is what makes those harnesses exercise the same code as a live run instead
of a subset chosen by which methods happen to deref.

### F7 · `recoil` is dead — P3 · ✅ FIXED (wired into the gun arm)

Written by `attackRail` (`:435`) and by `railshot` (`:942`), decayed in `Hero.update` (`:1093`),
and **read nowhere** in `src/`. The `gun` block in `animateRig` is even commented *"right arm aims
forward, recoil kick"* — the value that drives it is `atkE` (i.e. `attackAnim`), so the recoil the
comment promises has never reached the arm. Either wire it (a gun-arm kick is the obvious consumer, and the
`fist`/`gun`/`caster` blocks in `animateRig` have room for it) or delete the three lines.

**Wired, procedurally only.** `animateRig` takes `recoil` and the gun block subtracts it from the shoulder and
adds it to the elbow, so a railshot (which pushes `recoil` to 1.6) snaps the arm up and back and the hero's own
`dt*6` decay settles it over ~16 frames; a normal shot kicks at 1.0. `animcheck` measures the shoulder delta
rather than trusting the arithmetic. The GLB path could not express it then — `motion` was a v2 table of nine
numbers and adding a tenth belonged with the v3 bump in §4, not with a bug fix. **That bump is in, so the kick
landed too**: `motion.recoilKick` pitches the root back and shoves it a metre-or-so less along the facing, off the
same `recoil` value, defaulting small (0.05 rad per unit). `animcheck` §2c measures the pitch, the shove, that
`recoilKick: 0` is bit-identical to the old build, that a kicked root returns to the rest pose *exactly* (F8's
residue class, one node up), and that a v2 file with no such key still reads the default instead of `undefined`.

### F8 · `railshot` leaves the overcharge aura switched on **forever** — P1 · 🐛 found by this bench, ✅ fixed

Not in the original list: it only became visible once something outside the hero ticked the state
its own coroutine writes. `railshot` ramped the charge visual and cleared it in the fire branch:

```js
this.t += dt;
self.charge = Math.min(1, this.t / 0.3);        // every frame of a 0.45 s effect
if (!this.fired && this.t >= 0.3) { … self.charge = 0; }
```

The fire frame does clear it — and then the remaining ~0.15 s of the coroutine writes `1` back on
top of the clear. `Hero.update` reads `charge` for the muzzle flourish, so in a match, after the
first railshot: the coil stays at full opacity, `pistol.light.intensity` stays at ~8.5 instead of
its idle 0.5, both rails stay lit, and `if (this.charge > 0.05 && Math.random() < 0.6)` spawns a
burst **every frame, forever** — 60 particles a second of a 6,000 pool, each one a fresh
`{}` literal, in a codebase whose §4.4 says it may not do that. It was never caught because nothing
on the bench called `Hero.update`; the studio decays envelopes by hand and never looked.

One-line fix, gating the write the way the fire branch already gates itself:

```js
if (!this.fired) self.charge = Math.min(1, this.t / 0.3);
```

`simtest` asserts the shape of it — `charge === 0` and `liveParticles() === 0` after a railshot
settles — which is a *test the code could not pass* before the fix, the only kind worth writing.
The general rule is invariant 19: an effect that writes a field every frame must gate the write
against the branch that clears it, or the clear is undone by the tail of its own coroutine.

---

## 3. What the studio can and cannot show you today

| Layer | In the match | In `hero-studio.html` | Verdict |
|---|---|---|---|
| Attack / cast / hurt envelopes | via `Hero.update` | **via `Hero.update`** when the bench is on; hand-decayed only when it is off | ✅ F4 — one owner per tick context |
| Walk cycle | `spd = hypot(vel)/def.speed`, 0…1.4, buff- and mod-dependent | measured off `h.vel` when the bench is on, `action === 'walk' ? 1 : 0` when it is off | ✅ F5 — `stepRate`/`walkLean` can be judged against a speed the match reproduces |
| `move()` — accel, dash override, arena clamp, obstacles | every frame | every frame, via `sim.update` + the MOVE row | ✅ F4 — the slam now drifts 1.18 m here too, which is what makes F3 measurable |
| `dash()` | SPACE / gamepad | `dash` button; real cooldown, real `BLOCKED (cd 0.4s)` caption instead of a silent no | ✅ F4 |
| Facing | mouse-lerped | fixed | still true — but the hero can now turn *under* the cast via circle/strafe |
| Combo reset | 1.1 s | 1.1 s, decayed by the hero | ✅ F4 |
| FX anchor | cast point (or `follow hero`, per effect) | same, since the bench travels like the match | ✅ F3 |
| Animation clips | `Hero.poseClips` (mixer, five weighted layers) if the file has any | **the same** — the studio's loop yields to the hero while the bench is on | ✅ §4 phase C; `model-viewer.html` still plays them raw, which is the way to audition a file before binding it |

The pattern is worth naming: `ACTION` (the pose preview) and `CAST SIM` (the ability bench) were
two systems that never saw each other — `ACTION` had the body without the ability, `CAST SIM` the
ability without the body, and both read the same four envelopes. They now share one tick: the bench
drives the body, and `ACTION` can only *overlay* an envelope on top of it (it says so in a flash when
you try, because a held `attack` over a live cast does combine, and pretending otherwise is how you
ship a pose you never see). The remaining gap is not plumbing but content: there is still nothing to
play on a GLB hero (§4).

---

## 4. GLB animation clips: the plan

**You already have half of it.** `model-viewer.html` parses and plays clips
(`viewer.js:110-113`: `mixer = new THREE.AnimationMixer(obj); mixer.clipAction(clips[0]).play()`
plus a button per clip), and `tools/uploadstats.mjs` already reports `bones / skinned / clips`
per file. `parseGLB` returns the full gltf, so `gltf.animations` is *in hand* at every call *(and
`glbtest` now proves the round trip survives it: 3 bones, 1 skinned mesh, both clip names, every track
resolving to a node of the re-parsed scene, a mixer visibly driving `hips.quaternion`)*.
site and thrown away by `ensureGLBSkins` (`glbskin.js:29-33`) and `loadFXBank` (`:146`), which
keep `{ template, yaw }` only.

### The landmine to defuse first

`heroes.js:111` instantiates a skin with `skin.template.clone(true)`. `Object3D.clone()` copies
`skeleton` and bone references **by pointer**, so today's four heroes (1 controlled + 3 squad)
cloned from one template share a single set of bones — `fxpack.js:360` pools FX clones with the same `template.clone(true)`. Nothing animates bones yet, so nothing
has shown it — the moment a mixer writes `hips.quaternion`, **all four heroes animate as one
body**, and `fxpack`'s pooled FX clones (`fx.js`/`fxpack.js` clone their templates the same way)
would share with them too. The fix is `three/addons/utils/SkeletonUtils.clone()` — it deep-copies
bones and remaps the skeleton — applied at both call sites, *before* any animation lands. A
one-line change with a test worth writing first: two heroes from one template, rotate a bone on
one, assert the other's world matrix is unchanged.

### Shape of the feature

| Phase | Work | Notes |
|---|---|---|
| **A** ✅ done | `cloneRig` (that is `SkeletonUtils.clone`) for hero bodies (`heroes.js:116`) and pooled FX clones (`fxpack.js:363`); a rigged fixture in `tools/lib/rigged.mjs`; 13 new assertions across `glbtest` + `skintest` | Two surprises worth keeping. (1) The hazard was **not** "all four heroes share one skeleton" — `clone(true)` does copy the bones; what it keeps is the **template's `Skeleton`**, so each clone deforms from bones no hero owns and its own copies are inert decoration. (2) `SkeletonUtils.clone` **drops `userData`**, so `normalizeToStage`'s stage stamp stopped riding along — which is exactly what `studio.js:199` reads for the PLACEMENT row. `heroes.js` copies it forward; invariant 15 records the trap and `glbtest` pins both halves. |
| **B** ✅ done | `ensureGLBSkins` keeps `gltf.animations` (dropping zero-duration clips) and honours a per-hero `model` override from the tuning; `clipFor(clips, want, slot)` resolves a slot — exact name, then substring, then the slot's alias list (`idle/stand/rest`, `walk/walking/run/jog`, `attack/atk/swing/slash/melee`, `hurt/hit/reaction/flinch`, `death/die/down/defeat`); `clipOff()` distinguishes *"this slot plays nothing"* from *"that name isn't in the file"* | the resolver is one pure function, so all 8 of its behaviours are asserted in `skintest` without a scene |
| **C** ✅ done | `Hero.poseClips(dt, spd)` — five weighted layers off the **same four envelopes** (idle = what's left, walk = `spd`, attack = `attackAnim`, hurt = `hurtAnim`, death = `downed`), weights damped by `anim.fade`, `timeScale` = `anim.speed` (× the gait for walk); `animateGLB` stays the additive ROOT layer | no new state at all, and `anim.on: 0` is byte-identical to v2: no mixer is built. `glbtest`'s clone isolation is what makes two heroes able to play the same clip apart, which `animcheck` now measures instead of hoping |
| **D ✅** done, and then made live | **SKIN FILE & CLIPS** in the studio: a `model` select over the dropbox's `.glb` files, a `clips on/off` switch, five name rows that echo back the clip each resolved to (`not in file` in amber), `clip speed` / `cross-fade s` sliders, and `hero_tuning.json` **v3** `anim: { on, idle, walk, attack, hurt, death, speed, fade }` + `model` | a v2 file needs no migration — `clampAnim(undefined)` is the defaults, which are "auto everywhere, on". Two fields instead of a wizard, because the honest failure mode here is a name that doesn't match, not a missing curve |

The name rows re-bind **as you type** — `Hero.rebindClip(slot, name)` stops the old action,
resolves the new one and plays it, because the weights come off the envelopes every frame anyway.
Without that the config would be written while the hero kept the clip it resolved at load, and the
row's echo (which reads the mixer, not the config) would contradict what you just typed two frames
later. The two things that genuinely cannot be applied live are `model` and `clips on/off` — the
mixer's *existence* is decided in `build()` — so the studio says `not applied yet` on every row
until the tab is reloaded rather than describing the previous file.

Two things this phase had to discover rather than assume:

* **`cast` has no slot.** The plan said cross-fade `cast` off `castAnim`, but there is no `cast` clip on a
  combat rig — the swing *is* the cast for three of the four heroes — so `castAnim` keeps driving the
  transform layer (`animateGLB`'s `castLean`) and only `attack/hurt/death/walk/idle` became bindable. If a
  hero ever ships a separate cast animation, `ANIM_NAME_KEYS` + `CLIP_ALIASES` + `DEFAULT_ANIM` are where
  it gets added: three lists, no other change.
* **`anim.on: 0` was not off.** First version read `const A = (tun.anim && tun.anim.on) ? tun.anim :
  DEFAULT_ANIM` — and since `DEFAULT_ANIM.on` is 1, "no tuning block" and "switched off" both landed on
  *on*. The skintest assertion `anim.on = 0 leaves a rigged file exactly as v2 left it` was the thing that
  caught it; the fix is to merge first (`Object.assign({}, DEFAULT_ANIM, tun.anim)`) and test the merged
  value. Same trap as `clipOff`: a missing answer and a negative answer are different answers.

Budget/limits to carry over: 20k-tri hero budget (`viewer.js:140`), `uploadstats` heavy guard,
one mixer per hero (4 heroes, no per-cast alloc — so `clipAction` handles cached in `actions{}`),
and morph targets need `mesh.morphTargetInfluences` to survive cloning (`fxpack` already had to
learn that materials don't).

### The blocker, plainly

```
aegis.glb  bones 0 · skinned 0 · clips 0
lyra.glb   bones 0 · skinned 0 · clips 0
nyx.glb    bones 0 · skinned 0 · clips 0
```

**Update while writing this: that is still true of every file the game ships, and it is now
*escapable* without art.** `node tools/riggeddemo.mjs` writes `models/uploads/aegis-rig.glb` — 9 KB, 3 bones,
one skinned mesh, four clips (`Aegis Idle · Walk · Aegis Attack · Death01`), all tracks binding — and phase D's
`SKIN FILE` select will put it on AEGIS. That is a stand-in to develop against and to try in a browser, not the
asset: the real one has to come from the art pipeline, with the bone names the game will resolve. Which is the
point of the row — the file is what was missing, not the code. The handover page for whoever makes it is
**`models/ref/RIG-SPEC.md`**, with bind-pose sheets for all three heroes beside it in `models/ref/`: everything
the code expects is written down there, and every rule in it is measured rather than assumed.

**No file in `models/uploads/` has a skeleton or a single clip** — they are static meshes, which
is why `animateGLB` exists at all. So "support GLB clips" is only half a feature until a rigged,
animated hero file arrives: phases A/B/C are code we can write and test now, but D is unverifiable
and the visual payoff is zero until the asset has bones. Two decisions needed from you (§5).

---

## 5. Suggested order

1. ~~**F1 + F2 together**~~ ✅ done — one measured `hipsRest` baseline, read by `animateRig`, `animateGLB`,
   the slam and its `dispose()`; `animcheck` (21 measurements) is the gate, `skintest` pins the rig side.
2. ~~**Phase A**~~ ✅ done — `SkeletonUtils.clone` for hero bodies and pooled FX clones; every later step was
   unsafe without it, and phase C is what proves it (two heroes, one clip library, two poses).
3. ~~**F4 + F5**~~ ✅ done — the bench calls `Hero.update`/`Hero.move`, the studio yields ownership, the
   per-frame allocations are gone and `animcheck` statically gates them. **This step is what found F8.**
4. ~~**F3**~~ ✅ done as a per-effect `anchor` row (default unchanged) rather than a forced re-anchor.
   ~~F6/F7~~ ✅ guard + wire, same commit.
5. ~~**Phases B/C/D**~~ in — clips load, bind and blend off the four envelopes; the studio can point a hero
   at any uploaded skin file and name its clips; `hero_tuning.json` is v3 (`model` + `anim`). `animcheck`
   measures 11 clip behaviours on the generated rigged fixture (`tools/lib/rigged.mjs`) because every real
   upload still has nothing to play — that part is an art task, not a code one. A GLB `recoilKick` still
   ~~A GLB `recoilKick` still belongs in the `motion table`~~ ✅ in — the tenth coefficient, `motion.recoilKick`,
   landed with the v3 bump it was waiting on (`animcheck` §2c measures all five of its promises).
6. If the slam's 1.18 m of drift itself is wrong, that is a balance call in `seismicSlam` — the FX
   side of it is now a checkbox, so the two questions are finally separable.

Related: `HANDOFF.md` §4.4 (allocations), §4.9 (truncated effects), §4.11 (rig), invariant 15
(loader owns `root.position`), `FX-AEGIS.md` §4a (the bench), `README.md` → *Hero Studio*.
