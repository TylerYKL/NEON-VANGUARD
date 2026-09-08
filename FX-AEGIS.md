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
5. The row under the drop zone now reads
   `aegis-s0-fx.glb · 568 tris · 9 meshes · glb prop` (plus `(muted)` and `(same as ALL)` when either is
   true) — that cost is per cast, so read it. If you drop something heavy the flash says
   `ASSIGNED, BUT HEAVY: n MESHES / n TRIS PER CAST — DECIMATE IN THE DCC AND RE-DROP`.
6. **Tune it** in FX LOOK (see §5). Press **▶ play** to fire the slot on the preview; the readout updates
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

## 4. ● REC — record a video effect

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

## 5. FX LOOK cheat sheet (ranges are enforced on load by `clampFX`)

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
| `clip rate`, `facing`, `loop`, `video blend` (video only) | — | — | only shown on video slots, only saved for video slots |

`ensureTuning` re-clamps all of this on read, so hand-editing the JSON is safe: NaN / out-of-range / unknown
keys fall back to the defaults rather than poisoning the bloom chain.

---

## 6. If something looks wrong

| Symptom | Cause / fix |
|---|---|
| Nothing casts | The slot is muted (`muted` chip) or `clear`ed and `ALL` has no file. Also: the file must exist in `models/uploads/` — the flash `FX FILE NOT IN THE BANK — RE-ASSIGN IT` means the tuning points at a path nobody has. |
| Change saved, game unchanged | You reloaded the page instead of restarting the run, or the dropbox (`:8081`) wasn't running when you pressed save (`SAVE FAILED: …`). |
| Recorded clip shows the arena floor and hero | Expected — REC captures the canvas. Re-record from `idle` with auto-spin off, and keep `video blend = additive`. |
| `RECORD SAVE FAILED` | The `PUT /upload/<name>` needs `:8081`. Start `python3 tools/upload_server.py`. |
| Effect too small / huge | The prop is *fitted* to 1.8 m by `normalizeToStage` on load, so authoring scale in your DCC is irrelevant — use the FX `scale` slider, not your modeller's. |
| Lower half of the FX is missing in the match | The deck plate is opaque and the anchor is the prop's *centre*: raise `height` until the span clears it. `node tools/fxsample.mjs` prints each sample's measured span, and the same measurement is what the studio's PLACEMENT row shows for hero bodies (feet / head, `BURIED`). |
| Hero itself looks half-buried | Not an FX problem: that was the placement bug fixed in v1.10.1 (`HANDOFF.md` invariant 15). In the studio, PLACEMENT → `reset`, then save. |

---

## 7. Where this is tested

| Command | Proves |
|---|---|
| `node tools/fxsample.mjs` | the samples exist, clear the heavy guard, spawn through `spawnFX`, return their pooled clone and balance the light pool; the sample JSON round-trips through `fxFor` unchanged |
| `node tools/skintest.mjs` | 126 assertions: slot resolution + fallback, `clampFX`, URL-keyed bank reuse, free-list recycling, `dispose()`-free material handling, video refcounting, run-reset cleanliness |
| `node tools/herofit.mjs` | 18 assertions: the hero GLBs themselves still stand on the deck |
| `node tools/uploadstats.mjs` | tri / mesh / texture cost of everything in `models/uploads/` |

Related reading: `HANDOFF.md` §7a (the studio's design + invariants 12–15) and `README.md`
→ *Hero Studio — skins and skill effects*.
