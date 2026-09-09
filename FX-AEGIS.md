# AEGIS skill FX — sample files and the step-by-step flow

Everything here is for **one hero: AEGIS-7** (`aegis`), skills `Q` SEISMIC SLAM · `E` BASTION FIELD ·
`R` MAGNETRON PULSE. It covers the four sample effects that ship in `models/uploads/`, how to put them on
the skills, and how to use **● REC** to make a video effect of your own.

---

## 1. The sample files

Regenerate or re-check them any time with `node tools/fxsample.mjs` (it writes the files *and* validates
each one through the real runtime path, exiting non-zero if a sample would choke the match).

| File | Slot | Meshes | Tris | Size | What it is | Spans at the sample tuning |
|---|---|---|---|---|---|---|
| `models/uploads/aegis-fx.glb` | `ALL` (shared) | 3 | 184 | 21 KB | 4-point star + halo ring — the fallback look | 1.81 × 0.18 × 1.81 m |
| `models/uploads/aegis-s0-fx.glb` | `Q` | 9 | 568 | 63 KB | two ground rings, a flash disc, 6 rock shards | 3.21 × 0.76 × 3.21 m |
| `models/uploads/aegis-s1-fx.glb` | `E` | 8 | 440 | 49 KB | faceted dome + 6 hex plates + base ring | 5.25 × 2.48 × 5.06 m |
| `models/uploads/aegis-s2-fx.glb` | `R` | 11 | 424 | 53 KB | octahedron core, 8 magnetised spikes, 2 field arcs | 5.77 × 5.01 × 5.77 m |
| `models/uploads/aegis-fx.sample.json` | — | — | — | 1.5 KB | the tuning those four numbers came from | — |

* The names are not decoration. When **you** record, the studio writes `<id>-s<slot>-fx.webm`
  (`slot` = `0/1/2` for `Q/E/R`, or `-fx` with no slot for `ALL`) — so the samples sit exactly where your
  recordings land and are picked up by the same LIBRARY list.
* All four are deliberately cheap: 3–11 meshes and 184–568 tris each, far inside the studio's per-cast
  guard (`>24` meshes or `>60k` tris triggers a warning flash). A prop is cloned from a pool per cast, so
  "meshes" is roughly "draw calls per cast".
* Faceted flat normals + flat-shaded PBR, so they read as hard-light plate armour next to the procedural
  rigs, and their colours are AEGIS's own (`#ff8a2b` accent, `#18e0ff` glow — read from `HERO_DEFS`, so
  regenerating after a palette change re-tints them).
* Nothing replaces the ability's built-in `fx.js` burst. A studio effect is *added on top*, which is the
  point: it is the layer you can author.

**Want a video sample instead of a prop?** There is no encoder in this sandbox, so the `.webm` sample has
to come from your browser — which is what **● REC** is for (§3). REC captures the studio canvas while the
slot plays, so *assign a sample → tune it → REC* gives you a video version of that look in one pass.

---

## 2. Load the whole sample set at once (60 seconds)

Fastest way to see all four in place, no clicking:

```bash
cd /home/user/NEON-VANGUARD
cp models/uploads/aegis-fx.sample.json models/uploads/hero_tuning.json
python3 -m http.server 8080 --bind 0.0.0.0 --directory . &     # the pages
python3 tools/upload_server.py &                                 # the :8081 dropbox (SAVE + file list)
```

Open `http://localhost:8080/neon-vanguard.html`, press **START**, then cast `Q`, `E`, `R`. Because the game
re-reads `hero_tuning.json` on every **run restart** (`ensureTuning(true)`, cache-bypassed), that copy is
all it takes — no rebuild, no page reload. Then open `http://localhost:8080/hero-studio.html`, click the
`Q` / `E` / `R` chips and you will find all four already assigned and tuned, ready to edit.

> `hero_tuning.json` is *untracked* (a sandbox artefact the studio writes). Check `git status` before
> `git add -A`, or commit it deliberately when you want the tuning to ship with the build.

---

## 3. Assign a sample to one skill, by hand

1. **Start both servers** (the dropbox is required — the studio's file list and SAVE talk to `:8081`):
   ```bash
   python3 -m http.server 8080 --bind 0.0.0.0 --directory .
   python3 tools/upload_server.py
   ```
2. **Open `hero-studio.html`** and click the **AEGIS-7** tab. The preview is the real `Hero` class with the
   real GLB skin, so what you see is what the match draws.
3. In **SKILL EFFECT · PER SKILL**, click the chip for the slot:
   `ALL shared` · `Q seismic` · `E bastion` · `R magnetron`. A chip with a file on it shows a dot.
4. Pick the file — any of these three routes works:
   * **LIBRARY · models/uploads** (bottom of the panel): click `aegis-s0-fx` in the list. Nothing
     re-uploads — the effect bank is keyed by **URL**, so a file already used by another hero or slot is
     reused for free. Hit `refresh` after dropping a file into the folder.
   * **Drop zone**: drag the `.glb` onto *DROP .GLB OR VIDEO (.MP4/.WEBM) INTO THIS SLOT · OR CLICK*.
   * For a slot you want to start from the shared look: assign it on `ALL`, select `Q`, then
     **⎘ from all**. (On `ALL` itself that button says *PICK Q / E / R FIRST — ALL IS THE SOURCE*.)
   *Not sure yet?* Press **▶** on the row instead — that previews the file at AEGIS without assigning it (§4).

5. The row under the drop zone now reads
   `aegis-s0-fx.glb · 568 tris · 9 meshes · glb prop` (plus `(muted)` and `(same as ALL)` when either is
   true) — that cost is per cast, so read it. If you drop something heavy the flash says
   `ASSIGNED, BUT HEAVY: n MESHES / n TRIS PER CAST — DECIMATE IN THE DCC AND RE-DROP`.
6. **Tune it** in FX LOOK (see §6). Press **▶ play** to fire the slot on the preview; the readout updates
   live and the effect is the same object the match will spawn.
7. Press **save**. Flash: `SAVED — 3 FX SLOTS · RESTART THE RUN TO APPLY`.
8. Go to the game tab and **restart the run** (not a page reload — the tuning is read at `startGame()`).
   A page reload is only needed when hero *skin* files changed.

Two more controls on that row:

* **`on` / `muted`** turns the slot off without forgetting the file (`fxOn` on `ALL`, `on` per slot). A muted
  slot is skipped by `fxFor()`, which then falls through to `ALL`.
* **clear** unassigns *and* resets that slot's look to the `glb` defaults, so the panel reads
  `this slot is empty → falls back to ALL` and the skill starts using the shared effect again.
* **▶ play** with nothing on the slot says `NO FX IN Q — DROP A FILE OR PICK ONE`; if the file is listed but
  missing from disk it says `FX FILE NOT IN THE BANK — RE-ASSIGN IT`.

---

## 4. Preview any library file first — no slot spent

Every LIBRARY row ends in **▶**. It fires that file at AEGIS through the *same*
`fxpack.spawnFX` a real cast uses, so what you judge is what you get — and it assigns nothing: nothing is
written to `hero_tuning.json`, and the params handed to the preview are a **clamped copy** (`fxPreviewFor`),
so a preview cannot dirty a save. `tools/skintest.mjs` asserts both halves of that claim.

* **Which params does it use?** The slot you are editing, if it already holds that file → otherwise this
  hero's shared `ALL` block → otherwise whichever other slot holds it → otherwise the kind defaults. The
  line under the list prints which, e.g.
  `▶ aegis-s0-fx.glb · glb · 568 tris · 9 meshes · params from Q`.
* **⟳ loop** re-fires with a 0.22 s beat. A 0.65 s slam cannot be judged from a single play: turn the loop
  on, then move `grow` / `rise` / `scale` on the slot — each fire re-reads the panel, so the next one shows
  the change.
* **■ stop** (or clicking `▶` again) ends it. The clone returns to the entry's pool; nothing is disposed.
* `all · glb · video` filters the list once the folder has more than a handful of files in it.
* A file that has never been used is fetched and parsed on the first `▶`, so the preview also tells you the
  **real** tri / mesh count before you commit a slot to it. Drop a 16k-tri hero skin on there and the same
  heavy-prop flash fires.
* A muted slot still previews — preview is not a cast, and `on` only governs whether the *skill* plays it.
* Video rows preview too, through the refcounted `<video>` + `VideoTexture` path.

## 4a. CAST SIM — judge the effect against the ability

`▶ play` and the LIBRARY preview both show **one prop on an empty stage**. Most FX are not one prop: a slam is a
leap, an impact frame, rings, bodies flying. The **CAST SIM** row (bottom of the panel: `basic · Q · E · R · ⟳ auto · 1× ½× ¼× · 0 3 6 · reset`) runs the
real thing. If the panel itself has become unreadable, **HOW FX WORK IN THIS BUILD** (next to it) folds out the
six-step chain — press `hide` to put it away:

1. press **Q** / **E** / **R** (or **basic**). `Hero.useSkill` is the *game's* function, so the damage numbers, the
   rings and particles, the camera shake and the knockback all fire — your uploaded prop rides on top of them.
2. set **targets** to 0 / 3 / 6. Three is the default; at 0 you see the effect alone, at 6 you see it in a crowd.
3. drop to **½×** or **¼×** while you tune, then back to **1×** to decide. It is real time: at `¼×` the slam
   takes four times as long, so judge the *shape* slow and the *feel* at 1×.
4. **⟳ auto** loops basic → Q → E → R (it resumes from whichever button you last pressed), which is the fastest
   way to watch the same prop ride four different abilities. `reset` kills live effects and re-places the targets.
5. read the caption — every number in it is measured on the bench, never remembered from the last cast:

   ```
   Q · SEISMIC SLAM · 3 targets · 0 hits for 0 · fx 0p live/0 spawned/0r/0b · in flight 1 · no fx yet
   Q · SEISMIC SLAM · 3 targets · 3 hits for 136 · fx 0p live/186 spawned/0r/0b · in flight 0 · fx@0.25s
   ```

   The first line is nine frames into the leap: nothing has landed yet, so `no fx yet` is the truth. The second
   is after impact — three dummies hit for 136, 186 particles spawned, and `fx@0.25s` is the delay between the
   press and the first frame your effect existed. `in flight` is the page's own effect list, so `0` means the
   cast has fully unwound; `targets` after it (`3 targets`) is how many dummies are standing. The live-particle
   count is a scan of `fx.life`, because `FX.alive` in `fx.js` is vestigial: set once, never maintained.
6. press **Q** twice in a row and a third line appears:

   ```
   Q · SEISMIC SLAM · 3 targets · 0 hits for 0 · fx 0p live/0 spawned/0r/0b · in flight 2 · no fx yet · 1 forced
   ```

   `1 forced` means the bench stepped over a cooldown that would still be running in a match. It is there so the
   speed of the bench never becomes a lie about the game. `reset` clears the tally.
7. a white screen flash + a `!!` fault line means a transform went non-finite — that cast cannot reach a frame.

**A bench, not a wave.** Buttons force the cast and label it `N forced` (above), so a cooldown never hides your
effect; the gates themselves are still real code paths — `sim.cast(i, false)` against a cold ult answers
`R · MAGNETRON PULSE · BLOCKED — ULT ENERGY 0/100`, which is what `simtest` pins. Between casts the bench refills
the ult meter 1.2 s later, the one thing it does on purpose, because a bench you cannot loop is a bench you stop
using. A bench target exposes only the fields the abilities actually read. If a prop looks right here but wrong in
`neon-vanguard.html`, the difference is real gameplay state (barriers, `mods`, a crowd that dies) — worth knowing.

**Since v1.11.3 the bench moves the hero too.** `MOVE · walk/strafe/circle` + `dash` drive the real `Hero.move`, so
a cast is judged while the body travels — which is exactly when an effect anchored at the cast point starts to lag.
If your prop must stay glued to the hero through a leap, set its `anchor` row to *follow hero* (§6); if it is a
mark on the ground, leave it, and expect it to stay where you planted it. The four samples above are all ground FX
and say `follow: 0` out loud, so the file documents the choice rather than inheriting it.

## 5. ● REC — record a video effect

What the button actually does (`recordFX()` in `src/studio.js`):

* Requires `canvas.captureStream` + `MediaRecorder` — Chrome / Edge / Firefox are what this has been used
  with; anything else gets `RECORDING NOT SUPPORTED IN THIS BROWSER` and nothing else changes.
* Picks the name: `aegis-s0-fx.webm` for `Q` (`-s1` = `E`, `-s2` = `R`, `aegis-fx.webm` for `ALL`).
* Records the **whole studio canvas at 30 fps** for `clamp(dur, 0.6, 5)` seconds — i.e. as long as the
  slot's current **duration** — while it forces the hero into the `cast` action and plays this slot's FX.
* `PUT`s the blob to `:8081/upload/<name>`, then **assigns it to the slot for you**
  (`RECORDED + ASSIGNED aegis-s0-fx.webm — SAVE TO KEEP`). It lands in `models/uploads/` and shows up in
  the LIBRARY list, so it can be re-assigned to any other hero or slot without re-uploading.

The recipe for AEGIS's `Q`:

1. Turn the panel's action buttons to **idle** and switch **auto-spin off** — otherwise the camera drifts
   inside your recording. Hide whatever you do not want in the plate; what the canvas sees is what you get.
2. Assign `aegis-s0-fx.glb` to `Q` and tune the look the way you want it (§3). A duration of ~0.7 s makes a
   short, cheap clip; the recording is that long, ±.
3. Press **▶ play** once so you know what you're about to capture, then press **● REC**. The button lights
   up, the clip runs, and it stops itself.
4. Press **save**, restart the run, cast `Q` in the match.

**The alpha trick.** A canvas capture has no alpha channel — the studio's dark backdrop is baked into the
video black, not transparent. Black + `VIDEO BLEND = additive` is the arithmetic that makes it disappear,
so after REC:

| Setting | Value for a recorded plate |
|---|---|
| `video blend` | **additive** (default for video, keep it) |
| `clip` | play once (loop only for an ambient/idle cue) |
| `facing` | face cam (billboard) or skill dir for a directional trail |
| `clip rate` | 1 normally; 1.5–2 to make a 30 fps capture feel snappier than the source |
| `opacity` | leave at 1 — additive already drops the black; below 1 dims the whole plate |

If you must have true alpha, render the clip in a DCC / After Effects / `ffmpeg -pix_fmt yuva420p` VP9 and
drop *that* in — the studio accepts `.mp4`, `.webm`, `.ogv`.

Two limits worth knowing: a clip's real duration is probed on assign and **`duration` snaps to
`min(4.95 s, clip length)`** so the billboard never freezes on the last frame, and the dropbox accepts up
to 200 MB per file — but a video FX is decoded by *every* browser tab that plays it, so keep them small
(a few hundred KB for a sub-2 s 256–512 px plate is normal; anything over ~4 MB is a smell).

---

## 6. FX LOOK cheat sheet (ranges are enforced on load by `clampFX`)

| Slider | Range | Sample values `Q` / `E` / `R` / `ALL` | Notes |
|---|---|---|---|
| `scale` | 0.1 – 4 | 1.5 / 2.4 / 2.8 / 1.1 | multiplies the whole prop at spawn |
| `height` (`y`) | 0 – 4 | 0.02 / 0 / 0.85 / 0.6 | world Y of the FX anchor — ground ring vs chest-high burst. Keep it at or above **half the prop's span** or the deck hides the bottom half (the `R` sample spans 5.01 m, so at 0.85 m its lower arcs sit under the floor — on purpose for a burst, but it is the first thing to raise if you want the whole shape visible) |
| `duration s` | 0.15 – 5 | 0.65 / 2.2 / 1.6 / 1.1 | also how long ● REC runs |
| `grow` | −0.8 – 3 | 1.6 / 0.12 / 0.9 / 0.5 | scale ramp over life (eased). Negative = implode |
| `spin /s` | −12 – 12 | 0.6 / 0.35 / 5.5 / 2.2 | radians per second, Y axis (billboard: Z) |
| `rise` | −2 – 5 | 0 / 0.06 / 0.55 / 0.5 | added over life, so a slam stays down and a pulse climbs |
| `fade tail` | 0 – 0.95 | 0.45 / 0.55 / 0.35 / 0.4 | last fraction of life spent fading; **> 0 makes the cast take its own material set** (pooled, never disposed) |
| `opacity` | 0.05 – 1 | 1 / 0.85 / 1 / 1 | dome reads better translucent; a shockwave not so much |
| `glow light` | 0 – 24 | 9 / 5 / 16 / 7 | borrowed from the fixed `lights.js` pool — 0 means no light is touched at all |
| `tint` | `#rrggbb` | `#ffd9a8` / `#18e0ff` / `#18e0ff` / `#ffd9a8` | multiplies colour, drives the light colour too |
| `blend` (glb only) | as authored / additive / alpha | additive / as authored / additive / additive | additive is the fast way to make a prop feel like energy |
| `anchor` | cast point / follow hero | cast point ×4 | **where the prop is when the body moves.** `seismicSlam` carries AEGIS 1.18 m in the 0.3 s before impact; at *cast point* your prop stays at the take-off mark (a ground shock ring wants that), at *follow hero* it rides the hero (a muzzle or shoulder effect wants that). `spawnFX` re-reads `owner.pos` per frame only in the second case (MOTION-AUDIT F3) |
| `clip rate`, `facing`, `loop`, `video blend` (video only) | — | — | only shown on video slots, only saved for video slots |

`ensureTuning` re-clamps all of this on read, so hand-editing the JSON is safe: NaN / out-of-range / unknown
keys fall back to the defaults rather than poisoning the bloom chain.

---

## 7. If something looks wrong

| Symptom | Cause / fix |
|---|---|
| Nothing casts | The slot is muted (`muted` chip) or `clear`ed and `ALL` has no file. Also: the file must exist in `models/uploads/` — the flash `FX FILE NOT IN THE BANK — RE-ASSIGN IT` means the tuning points at a path nobody has. |
| Change saved, game unchanged | You reloaded the page instead of restarting the run, or the dropbox (`:8081`) wasn't running when you pressed save (`SAVE FAILED: …`). |
| Recorded clip shows the arena floor and hero | Expected — REC captures the canvas. Re-record from `idle` with auto-spin off, and keep `video blend = additive`. |
| `RECORD SAVE FAILED` | The `PUT /upload/<name>` needs `:8081`. Start `python3 tools/upload_server.py`. |
| Effect too small / huge | The prop is *fitted* to 1.8 m by `normalizeToStage` on load, so authoring scale in your DCC is irrelevant — use the FX `scale` slider, not your modeller's. |
| Pressing `▶` in the list does nothing | Look at the flash: `PREVIEW FAILED: …` means the dropbox could not serve the file or `parseGLB` rejected it (a `.gltf` with sidecars, or a truncated upload). |
| Lower half of the FX is missing in the match | The deck plate is opaque and the anchor is the prop's *centre*: raise `height` until the span clears it. `node tools/fxsample.mjs` prints each sample's measured span, and the same measurement is what the studio's PLACEMENT row shows for hero bodies (feet / head, `BURIED`). |
| Hero itself looks half-buried | Not an FX problem: that was the placement bug fixed in v1.10.1 (`HANDOFF.md` invariant 15). In the studio, PLACEMENT → `reset`, then save. |
| the caption says `2 forced` | You are casting faster than the match allows — the bench overrode live cooldowns to show you the effect anyway. Judge the timing at `1×`, not from a forced cast. |
| the caption says `no fx yet` | Your cast is mid-flight (the slam leaps first). Wait for `fx@0.25s` — that number *is* your timing. |
| It looks different in CAST SIM than under `▶ play` | Expected and useful: `▶ play` is the prop alone, the bench is the prop inside the ability. Decide in the bench. |
| The bench says `!! non-finite transform` | The FX put a NaN on a mesh — usually `dur` or `rate` typed as a non-number in the JSON, or a target whose position went bad. `↺ clear` and re-load. |

---

## 8. Where this is tested

| Command | Proves |
|---|---|
| `node tools/fxsample.mjs` | the samples exist, clear the heavy guard, spawn through `spawnFX`, return their pooled clone and balance the light pool; the sample JSON round-trips through `fxFor` unchanged |
| `node tools/skintest.mjs` | 126 assertions: slot resolution + fallback, `clampFX`, URL-keyed bank reuse, free-list recycling, `dispose()`-free material handling, video refcounting, run-reset cleanliness |
| `node tools/herofit.mjs` | 18 assertions: the hero GLBs themselves still stand on the deck |
| `node tools/uploadstats.mjs` | tri / mesh / texture cost of everything in `models/uploads/` |
| `node tools/simtest.mjs` | 41 assertions: the CAST bench — all 9 abilities + the three basics driven headlessly; every cast must expire, leave the scene *identical*, balance the light pool and stay finite |

Related reading: `HANDOFF.md` §7a (the studio's design + invariants 12–15) and `README.md`
→ *Hero Studio — skins and skill effects*.
