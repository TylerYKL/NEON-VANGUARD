# MOTION-AUDIT — hero animation, movement and attack

**What this is.** A review of the layer *under* the FX: how a hero is posed, how it walks,
how an attack starts and lands. Read `FX-AEGIS.md` for effects; this is the audit that
answers "and what about the body?". Six findings, each with a measured number, plus the
plan for GLB animation clips.

**Status: F1 and F2 are fixed (invariants 16–17 in `HANDOFF.md` record the rules they broke); F3–F7 are
open, in the order at §5.** `node tools/animcheck.mjs` re-measures every number in
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

### F3 · a leap-cast's uploaded FX lands **1.18 m behind** where the ability hits — P1

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

### F4 · the studio and the bench do not tick `comboT`, so the **combo preview lies** — P2

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

### F5 · allocation rule violations in the per-frame path — P2

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

### F6 · `attackFist` dereferences `G.mods` unguarded — P3

`heroes.js:374` `G.mods.fistCleave`, `:487` `G.mods.slamStun` — while `useSkill` (`:449`) and
LYRA's lock (`:1120`) both guard with `G.mods ? … : 0`. Any harness or tool that fakes a `G`
(the bench, `simtest`, a future editor) has to know which abilities read mods and which don't.
Two ways to settle it: guard everywhere, or declare `G.mods` **mandatory** and assert it once
in `startGame`. Worth deciding rather than drifting.

### F7 · `recoil` is dead — P3

Written by `attackRail` (`:435`) and by `railshot` (`:942`), decayed in `Hero.update` (`:1093`),
and **read nowhere** in `src/`. The `gun` block in `animateRig` is even commented *"right arm aims
forward, recoil kick"* — the value that drives it is `atkE` (i.e. `attackAnim`), so the recoil the
comment promises has never reached the arm. Either wire it (a gun-arm kick is the obvious consumer, and the
`fist`/`gun`/`caster` blocks in `animateRig` have room for it) or delete the three lines.

---

## 3. What the studio can and cannot show you today

| Layer | In the match | In `hero-studio.html` | Verdict |
|---|---|---|---|
| Attack / cast / hurt envelopes | via `Hero.update` | hand-decayed, never set except by `CAST SIM` or `ACTION` | works, but **not the same state machine** (F4) |
| Walk cycle | `spd = hypot(vel)/def.speed`, 0…1.4, buff- and mod-dependent | `spd = action === 'walk' ? 1 : 0` | `stepRate` / `walkLean` are tuned against a speed the match won't reproduce |
| `move()` — accel, dash override, arena clamp, obstacles | every frame | never called | **unpreviewable**; the bench's slam jumps in place (measured: 0.00 m vs 1.18 m) |
| `dash()` | SPACE / gamepad | no button, no row | unpreviewable, and it is the one movement FX with afterimages + a beam |
| Facing | mouse-lerped | fixed | a directional FX can't be judged off-axis |
| Combo reset | 1.1 s | never resets | F4 |
| Any clip | none exist | `model-viewer.html` **does** play them | §4 |

The pattern is worth naming: `ACTION` (the pose preview) and `CAST SIM` (the ability bench) are
two systems that never see each other. `ACTION` has the body without the ability; `CAST SIM` has
the ability without the body. That is a design accident, not a limit — both read the same four
envelopes.

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
| **B** | carry `animations` through `ensureGLBSkins`; `Hero` gains `mixer`, `actions{}`; a `clipFor(name)` resolver matching `idle walk run attack1-3 cast hurt death` (case-insensitive, substring, first hit) | one mixer per hero, `timeScale` from `spd` |
| **C** | blend from the **same four envelopes**: cross-fade `attack1/2/3` off `attackAnim`, `cast` off `castAnim`, `hurt` off `hurtAnim`, `death` off `downed`; keep `animateGLB` as the additive layer (bob/lunge/twist on top of the clip) | zero new state; a rigged file animates, an unrigged one behaves exactly as now |
| **D** | studio `ANIMATION` row: clips found in this file (0 → `NO CLIPS IN THIS FILE`), a bind per state, `animRate` / `animBlend` sliders, `hero_tuning.json` **v3** `anim: { idle: "Clip 0", walk: "Walk", … }` | the bench is already there to judge it: `CAST SIM` + `⟳ auto` is the loop you want for reviewing a cycle |

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

**No file in `models/uploads/` has a skeleton or a single clip** — they are static meshes, which
is why `animateGLB` exists at all. So "support GLB clips" is only half a feature until a rigged,
animated hero file arrives: phases A/B/C are code we can write and test now, but D is unverifiable
and the visual payoff is zero until the asset has bones. Two decisions needed from you (§5).

---

## 5. Suggested order

1. ~~**F1 + F2 together**~~ ✅ done — one measured `hipsRest` baseline, read by `animateRig`, `animateGLB`,
   the slam and its `dispose()`; `animcheck` (21 measurements) is the gate, `skintest` pins the rig side.
2. **Phase A** (`SkeletonUtils.clone`) — cheap, independent, and every later step is unsafe without it.
3. **F4 + F5** (`CAST SIM` calls `Hero.update`; hoist the per-frame/per-cast allocations) — makes the
   bench a real bench and satisfies §4.4.
4. **F3** (`playFX` at impact for movement skills) — the one that changes how your current FX files
   sit in the world.
5. **Phases B/C**, then D when a rigged hero GLB exists (or accept procedural-only and stop at 4).
6. F6/F7 cleanups with whatever commit they hitch a ride on.

Related: `HANDOFF.md` §4.4 (allocations), §4.9 (truncated effects), §4.11 (rig), invariant 15
(loader owns `root.position`), `FX-AEGIS.md` §4a (the bench), `README.md` → *Hero Studio*.
