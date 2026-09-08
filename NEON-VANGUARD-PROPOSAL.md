# NEON VANGUARD — Game Proposal & Technical Plan
**3D top-down squad action for the browser · cyber-modern setting · 3 switchable operatives**

Version 1.7 · prepared 2026‑09‑06 · *render optimisation pass*

> **Picking this up cold?** Start with **`HANDOFF.md`** — build steps, architecture invariants, the traps
> that cost time to find, and the prioritised backlog. This document is the design and decision record. · includes a **playable vertical-slice demo** (`neon-vanguard.html`)

---

## 1. The pitch

> **Sector 07, Night City Grid.** Three operatives share one contract, one mind, one body of firepower.
> You are all of them — switch on the fly, and the two you leave behind fight beside you.

**Neon Vanguard** is a 3D **top-down arena action game** that runs in any modern browser with no install.
You control a **squad of three** — a tank, a healer and a gunner-mage — but only ever *pilot* one at a time.
The other two are driven by AI and keep fighting, healing and shooting alongside you. Tapping `1 / 2 / 3`
snaps you into a different body mid-combo, which turns "class switching" into the core mechanic instead of a menu.

| | |
|---|---|
| **Genre** | Top-down 3D action / horde survival with squad-swapping |
| **Platform** | Web (desktop first, controller + mobile later). Single HTML file, no install |
| **Session** | 8–15 minutes per run, wave-based, boss every 5th wave |
| **Camera** | Fixed-angle top-down (~55° pitch), smooth follow, aim-lead offset |
| **Setting** | Near-future cyberpunk: rain, holograms, hard-light tech, no swords or wizards' staves |
| **USP** | Hot-swap between 3 fully distinct kits **during** a fight; the abandoned bodies keep fighting as AI |

---

## 2. "Is three.js the right choice?" — the engine decision

**Short answer: yes for this game, and the demo proves it.** The demo you have runs the full stack —
custom shaders, bloom, 6 000 particles, 40+ AI agents — in one 618 KB self-contained HTML file with zero
build step for the player. But here is the honest comparison, because the answer changes if your goals change.

### 2.1 Options considered

| Option | Bundle / load | 3D power | Editor & tooling | Team ramp-up | Verdict for Neon Vanguard |
|---|---|---|---|---|---|
| **three.js** (chosen) | ~600 KB gz ~150 KB, instant load | Excellent — full control of shaders, post FX, instancing | **None built-in** (code-first); pair with Blender + a custom debug UI | Low if you know JS; you own every system | ✅ **Recommended.** Best size/perf/control ratio for a stylised, VFX-heavy arena game |
| **Babylon.js** | ~1.5 MB+ | Excellent, more batteries-included (physics, GUI, node material editor, WebGPU) | Playground + Inspector + Node Material Editor | Low–medium | Strong runner-up. Pick it if you want a **node-based shader editor** and built-in physics/GUI rather than writing them |
| **PlayCanvas** | ~500 KB runtime | Very good | **Real browser editor**, collaborative, asset pipeline, one-click publish | Low | Best choice if you want a **Unity-like editor in the browser** and non-programmers on the team |
| **Unity 6 → WebGL/WebGPU** | 15–40 MB, 10–30 s first load | Excellent | Industry-standard editor, huge asset store | Medium | Overkill here. Heavy downloads, poor mobile web, long iteration; worth it only if you also ship Steam/console |
| **Godot 4 → Web export** | 20–35 MB (WASM), needs SharedArrayBuffer headers | Very good | Great editor, free | Medium | Web export is still the weakest Godot target (threads, audio, iOS Safari issues) |
| **Unreal → Web** | Not viable | — | — | — | ❌ No practical web target |
| **2D engines** (Phaser, PixiJS) | Small | 2D only | Good | Low | ❌ Rules out real 3D skill VFX |

### 2.2 Why three.js wins *this* brief

1. **The brief is VFX-led.** "Skills must be awesome" means custom shaders, additive particle systems,
   post-processing and full control of the render loop. three.js gives you raw WebGL with none of an
   engine's abstractions in the way — the singularity, hard-light dome and railgun in the demo are each
   ~40 lines of shader.
2. **Instant play = distribution.** A link that loads in under a second beats a 30 MB Unity WebGL build for
   a browser game. That is the entire growth strategy for a web title.
3. **Top-down = cheap.** Fixed camera + stylised low-poly + emissive materials means you never need PBR
   texture sets, lightmaps or LOD chains. three.js's weakness (no editor/asset pipeline) mostly doesn't bite.
4. **AI-assisted development fits code-first engines.** Your `Claude-Code-Game-Studios` workflow generates
   *code and design docs*, not editor scenes — a code-first engine multiplies that advantage.

### 2.3 Where three.js will hurt (and the mitigation)

| Risk | Mitigation baked into the plan |
|---|---|
| No editor → level/tuning iteration is slow | Ship a **dev overlay** (dat.GUI / tweakpane) + all balance numbers in one `balance.json` hot-reloaded in dev |
| No animation pipeline out of the box | Demo uses **procedural rigs** (no assets). Phase 3 swaps in glTF + Mixamo clips through `AnimationMixer` — the rig interface is already abstracted in `rig.js` |
| No physics | Not needed: capsule-vs-circle overlap + separation steering is enough for top-down. Add `rapier3d` WASM (~200 KB) only if destructible cover ships |
| No built-in netcode | Co-op is Phase 5: authoritative Node/Colyseus server + client prediction. Simulation is already deterministic-ish and separated from rendering |
| Mobile GPUs choke on bloom | Quality tiers already scaffolded (bloom at half-res). Phase 4 adds Low/Med/High auto-detect |

### 2.4 Recommended final stack

```
Runtime      three.js r169+ (WebGL2, WebGPU-ready later)
Language     TypeScript (demo is JS — migration is Phase 2, ~2 days)
Build        Vite + esbuild → single-file build for itch.io/CDN
State/UI     HTML+CSS overlay HUD (as in the demo) — crisp text, free accessibility, zero draw calls
Audio        procedural WebAudio synth engine (implemented) — no sample downloads
Physics      none → rapier3d (WASM) only if required
Netcode      Colyseus (Phase 5, co-op)
Art          Blender (low-poly, emissive) → glTF + Draco; Mixamo for humanoid clips
Analytics    PostHog / simple beacon: wave reached, hero used, ability uptime
Hosting      Static CDN (Cloudflare Pages / itch.io). No server needed until co-op
```

---

## 3. Game design

### 3.1 Core loop

```
DEPLOY → wave spawns → fight & swap heroes → wave clear (+score, +partial heal)
   ↑                                                  ↓
   └──────── boss every 5th wave ── upgrade pick ─────┘        (upgrade draft = Phase 2)
```

* **Moment-to-moment:** move (WASD) · aim (mouse) · basic attack (hold LMB) · 2 skills (Q/E) · ultimate (R)
  · dash (Space) · **swap operative (1/2/3 or Tab)**.
* **Tactical layer:** each hero owns one answer — Aegis controls space, Lyra sustains, Nyx deletes.
  You swap to the answer the wave demands, and the other two keep contributing.
* **Meta layer (Phase 2):** between waves, draft one of three cyber-implants (e.g. *"Ion Fist chains to a
  second target"*, *"Bloom Field slows 40%"*, *"Railshot refunds 2 s on a kill"*).

### 3.2 The squad

Every kit is built from **modern / near-future hardware** — gauntlets, shields, drones, rail pistols.
No swords, no wooden staves, no fantasy bows.

#### ⬢ AEGIS‑7 «BULWARK» — Warrior / Tank · *amber #ff8a2b*
*Riot-control frame retrofitted with an ion knuckle rig.*

| Slot | Name | Effect | VFX signature |
|---|---|---|---|
| **Gear** | **Ion Gauntlets + Hard-Light Riot Shield** | Melee bruiser, 340 HP, 35% flat damage reduction | Knuckle plates glow hotter as the combo builds |
| LMB | **Ion Fist Combo** | 3-hit chain; the 3rd hit is a cone shockwave with knockback | Cone of sparks, screen kick, ground ring |
| Q | **Seismic Slam** | Leap-slam: 8.5 m shockwave, heavy knockback, 1.3 s stun | Triple expanding ring + radial floor fissures + 0.9 shake |
| E | **Bastion Field** | 6 m hard-light dome, 7 s: eats hostile projectiles, 50% DR for allies inside | Hexagonal dome shader with a vertical scan sweep |
| R | **Magnetron Pulse** *(ult)* | Magnetises everything within 19 m, reels it in for 1.1 s, then detonates for ~300 | Orbiting particle funnel → white flash → 3 stacked rings + arena-wide floor pulse |

#### ⬢ LYRA‑V «NANOMEDIC» — Support / Healer · *mint #3dffb0*
*Combat medic running a nanite swarm and a repair drone.*

| Slot | Name | Effect | VFX signature |
|---|---|---|---|
| **Gear** | **Nanite Med-Gloves + Repair Drone** | 220 HP, drone passively heals the weakest ally 7 HP/s | Orbiting drone streams motes to the wounded |
| LMB | **Nanite Bolt** | Soft-homing swarm bolt, 21 dmg | Green tracer with a mote trail |
| Q | **Bloom Field** | 6.4 m garden, 7 s: allies +24 HP/s, hostiles −15 HP/s and slowed | Three counter-rotating rings, rising pollen, light lattice pillars |
| E | **Synapse Tether** | 5 s hard-link to the weakest ally: +22 HP/s, +30% speed, +20% DR | Live sine-wave ribbon between the two, particles running along it |
| R | **Phoenix Protocol** *(ult)* | Revives the downed, full-heals the squad, 120 overshield, +40% speed | 40 m light pillar, white screen flash, per-hero rebirth rings |

#### ⬢ NYX‑0 «RAILWITCH» — Wizard / Archer / Gunner · *magenta #ff3df0*
*Techno-arcanist: treats a railgun like a spellbook.*

| Slot | Name | Effect | VFX signature |
|---|---|---|---|
| **Gear** | **Arc Rail Pistol + Swarm Pod** | 195 HP, glass cannon, fastest mover | Rails and coil charge visibly before each shot |
| LMB | **Arc Rounds** | Fast bolts, 26 dmg, chain-lightning to 1 extra target | Jagged multi-segment bolt between victims |
| Q | **Railshot** | 0.3 s charge → pierces **everything** in a 40 m line for 135 | Triple-layered beam (white core → magenta → violet halo) + recoil dash + 0.7 shake |
| E | **Swarm Missiles** | 12 spiralling homing micro-missiles, 34 dmg + small AoE | Corkscrew trails converging from the shoulder pod |
| R | **Singularity** *(ult)* | 3 s black hole: drags hostiles in, 26 dps, then implodes for ~360 | Fresnel void sphere, twin accretion rings, spiral intake, white implosion |

**Swap feel:** switching plays a phase-in/phase-out ring, a 0.22 screen flash tinted to the new hero,
a small shake and a HUD slide. It reads as a *stylish* action, not a UI operation.

### 3.2b Charge economy & the ULTIMATE CHAIN ✅ *(implemented)*

Swapping needed a *reason* beyond "the right tool for the job". This is it — the mechanic that makes the
three-operative design pay off, and the highest skill-expression ceiling in the game.

**Charge economy — kills feed the ultimates**

| Source | Gain |
|---|---|
| Dealing / taking damage | 5.5–7% of damage as charge (baseline trickle) |
| Kill | +6 charge to the killer |
| **Charge Shard** (drops from ~30% of chaff, ~55% of elites) | +24 to whoever grabs it, +11 to the other two — auto-magnetises from 8 m |
| **CHARGE CORE** (guaranteed every 16 kills; bosses drop one + 4 shards) | **Fills all three ultimates instantly.** Beacon column, visible across the arena, magnetises from 12 m |

The Overdrive meter in the HUD shows progress to the next Core, so the player can *see* the payoff coming
and bank their ultimates for it.

**The chain — ult, swap, ult**

Casting an ultimate opens a **6.5 second chain window**. Swap operative and fire another inside it:

| Chain | Name | Effect |
|---|---|---|
| ×1 | — | Normal ultimate |
| ×2 | **LINK** | **+45% ultimate damage**, gold HUD banner, screen flash, audio stinger |
| ×3 (all three operatives) | **TRINITY OVERDRIVE** | **×2 ultimate damage** · bullet-time (world drops to 0.28× for ~2.6 s, and the music tempo drags with it) · all three heroes get a 160 overshield, +50% speed, cooldowns wiped and downed allies revived · three tribute beams converge on the epicentre and detonate for `260 + 14% of each enemy's max HP` arena-wide · +2 500 score |

The AI squadmates understand it too — an AI hero with a full bar will deliberately fire its ultimate while
your chain window is open, so a Core pickup can cascade into a Trinity even if you only press `R` once.

**Why it works:** it converts the swap button from a convenience into a combo input, gives kills a visible
compounding payoff, and creates a *decision* every time the Overdrive meter fills — spend now, or hold for
the boss and delete it.

### 3.3 Enemies

| Unit | Role | HP | Behaviour |
|---|---|---|---|
| **Skitter Drone** | Chaff | 55 | Fast flyer, strafes, plasma pot-shots |
| **Riot Brute** | Melee pressure | 210 | Charges the nearest hero (weighted toward the tank), slam AoE |
| **Arc Sentinel** | Ranged control | 130 | Hovers at range, 3-round burst |
| **Oni-Class Juggernaut** | Boss (wave 5, 10, …) | 2 600 | Slam + 7-round plasma fan, knockback-resistant, arena-wide death explosion |

Enemies use **soft aggro weighting** (the tank pulls 1.4× harder), boid-like separation, and stun/slow/
knockback states so crowd control feels real.

### 3.4 Difficulty & scoring

* Waves 1‑8 are hand-authored compositions, then scale ×1.22 per wave.
* **Combo multiplier** (×1 → ×8) decays 3.2 s after the last kill → rewards aggression.
* Downed heroes self-revive after 12 s (or instantly via Phoenix Protocol / wave clear). Run ends only when
  all three are down simultaneously — so the squad *is* the health bar.

---

## 4. Making the skills "awesome" — the VFX system

This is the part the brief cares most about, so it is a first-class engineering system, not decoration.

| Layer | Implementation | Why it matters |
|---|---|---|
| **Bloom** | `UnrealBloomPass` at half resolution, threshold 0.85 | Turns every emissive material into light. This single pass is 70% of the "neon" look |
| **NaN/HDR guard** | Custom clamp pass **before** bloom | *Real bug found during the build:* one overflowing additive pixel becomes `Inf`, spreads through the bloom mip chain and blacks out the whole frame. The guard clamps to 12.0 and kills NaN |
| **Particles** | One pooled `Points` system, 6 000 particles, CPU-integrated, additive shader | Zero allocation at runtime, one draw call, supports gravity/drag/orbit-attract modes |
| **Spark streaks** | Pooled `LineSegments` with velocity-stretched segments | Cheap "metal impact" language |
| **Shockwaves** | Pooled additive ring quads with an eased radius curve | Every impact gets a readable ground footprint |
| **Beams** | Pooled open-ended cylinders, layered 3 deep with different widths | Rail beams and chain lightning |
| **Volumes** | Bespoke `ShaderMaterial`s: hex-dome, holo-billboard, light pillar, Fresnel void sphere | The "signature" of each ultimate |
| **Camera juice** | Trauma-based shake, aim-lead offset, exponential damping | Makes 26 damage feel different from 300 damage |
| **Grade pass** | Chromatic aberration (scales with the flash), scanlines, grain, vignette, damage tint | Ties everything into one cyberpunk photographic look |
| **Floor** | Shader with dual grids, travelling data pulses, player proximity glow, arena-wide event pulse | The ground reacts to your ultimates |
| **Feedback** | Floating combat text (DOM, pooled), crits at 1.9×, hit flashes, skill call-outs, kill feed | Readability under chaos |

**Planned additions (Phase 2‑3):** hit-stop (2–4 frames on heavy impacts), radial motion blur on ultimates,
decals for scorch marks, and a GPU particle path (transform feedback) for 50 k+ particles.

---

## 4b. Audio — procedural, adaptive, zero download

Audio is **fully synthesized at runtime with WebAudio**. There is not a single `.mp3` or `.wav` in the build:
the whole soundtrack and all 38 SFX are generated from oscillators, filtered noise and a procedural
convolution reverb. That keeps the game a single self-contained file and makes every cue tunable by number
instead of by re-export.

| Layer | Design |
|---|---|
| **Signal chain** | voices → SFX bus / music bus → master → limiter (compressor, −11 dB, 10:1) → out, with two global sends: a **procedural convolution reverb** (2.1 s impulse generated from decaying noise) and a **dotted-8th delay** locked to the tempo |
| **Synth toolkit** | `tone()` (osc + freq sweep + filter sweep + ADSR + pan + sends) and `noise()` (looped noise buffer through a sweeping filter). Every cue is 2–6 of these stacked |
| **38 cues** | one per ability phase — e.g. Railshot is `railCharge` (rising band-passed saw) then `railFire` (3 kHz→120 Hz saw sweep + 260 Hz sub + noise burst); Singularity is a 3 s sub drone + reverse riser, then `implode` |
| **Adaptive score** | 124 BPM synthwave in A minor over `Am–F–C–G`. A 25 ms lookahead scheduler sequences 16th notes. **Layers unlock with the wave:** pad → +bass/kick → +snare/hats/arp → +lead motif. Boss waves jump straight to full intensity |
| **Ducking** | every ultimate ducks the music bus to 20–30% for the length of its cast, so the big cues punch through |
| **Mixing** | a per-cue `LEVELS` table calibrated against an offline peak meter: frequent cues sit at 0.04–0.13, combat at 0.15–0.35, ultimates at 0.5–0.99. Repeated cues are throttled (min-gap per cue name) so 12 missiles don't become a wall of noise |
| **Spatialisation** | stereo pan derived from world-X relative to the camera target — you hear which side of the arena a brute lands on |
| **Controls** | `M` or the top-right widget toggles mute; the context is suspended on pause (`P`) so nothing keeps ringing |

**Two real bugs this shook out**, both worth remembering:
1. **Envelope truncation.** Cues were scheduled at `currentTime + 1 ms`, i.e. inside the render quantum that
   was already being processed — short punches lost most of their body. Fixed with 20 ms of lookahead.
2. **Measurement lies.** A `ScriptProcessor` peak meter reads low when the main thread is saturated by the
   3D loop. The mix was calibrated in an isolated page running only the audio module.

**Still to do (Phase 1):** per-hero musical identity (a stinger on swap), a proper master-volume slider,
crowd/ambience bed, and optional announcer VO.

---

## 5. Technical architecture

```
src/
├── main.js       bootstrap · renderer · post-processing chain · input · camera · wave director · game state (G)
├── world.js      arena, floor shader, skyline, holo billboards, rain, cover pylons
├── fx.js         FX manager: particle pool, ring pool, beam pool, spark pool, shake, flash
├── rig.js        procedural humanoid rig + animator + weapon builders (gauntlets/shield/gloves/pistol/drone)
├── heroes.js     hero definitions, stats, all 12 abilities, buffs, damage/heal, squad AI
├── entities.js   projectile pool + enemy types, steering, aggro, boss
├── audio.js      WebAudio synth toolkit, 38 procedural SFX cues, adaptive music sequencer, mix bus
├── pickups.js    charge shards + Charge Cores (magnetism, beacons, squad-wide overcharge)
├── showcase.js   Character Bay: studio lighting, turntable, pose driver, ability preview
├── ui.js         HUD binding (squad cards, skill bar, banners, combat text, kill feed)
└── util.js       math, colour, material and procedural-texture helpers
```

**Principles already in force in the demo**

* **Pool everything** — particles, rings, beams, projectiles, DOM combat text. No GC spikes mid-fight.
* **One shared context object `G`** passed to systems — no circular imports, trivially serialisable for replays/netcode later.
* **Data-driven heroes/enemies** — `HERO_DEFS` and `ENEMY_TYPES` are plain data; adding a 4th operative is a data entry plus one skill function.
* **Effects as coroutines** — every ability pushes an `{ update(dt) → bool }` object; multi-phase ultimates (charge → detonate → fade) read top-to-bottom.
* **Render/sim separation** — `dt` is clamped at 50 ms; the sim never depends on frame rate.
* **HUD in DOM** — crisp at any DPI, animatable in CSS, costs zero draw calls.

**Performance budget (target: 60 fps on a 2020 laptop iGPU @1080p)**

| Metric | Budget | Demo today |
|---|---|---|
| Draw calls | < 350 | **~168 base / 347 at 15 enemies** (after the v1.7 pass) |
| Triangles | < 400 k | **20 k / 33 k** (measured) |
| Particles | 6 000 | 6 000 pooled |
| Active AI agents | 60 | 40+ tested |
| Frame time (GPU) | < 12 ms | dominated by bloom → half-res |
| First load | < 1.5 s | single 618 KB file |

---

## 6. Art & audio direction

**Visual pillars:** *wet neon · hard-light · black chrome.* Dark, near-black surfaces so emissive accents
carry all the colour. Silhouettes must be readable from the top-down camera: Aegis is wide and blocky,
Lyra is small and hooded with an orbiting drone, Nyx is thin with a long weapon line.

**Colour code is a gameplay system, not decoration** — amber = you're the tank, mint = healing is happening,
magenta = burst damage, red-orange = hostile. A player should be able to read the fight from colour alone.

**Character design — three passes, all viewable now**

| Pass | What exists | Where to look |
|---|---|---|
| **1. Playable rig** ✅ | Procedural humanoid built from primitives — hips/torso/neck/2 arms/2 legs with procedural walk, aim, recoil, cast and death animation. Silhouette, bulk, pauldrons, hood and crest are per-hero parameters | in the game, and in the **Character Bay** |
| **2. Turntable review** ✅ | `character-bay.html` — a studio-lit viewer: orbit/zoom, pose selector (idle / move / attack / cast / downed), weapon-detail focus that frames the actual weapon mesh, live ability VFX preview, full stat + kit dossier | `character-bay.html` |
| **3. Art-direction targets** ✅ | Rendered concept sheets for all three operatives — the look the Phase 3 authored models should hit | `concept/*.jpg` |

The gap between pass 1 and pass 3 is exactly the Phase 3 art budget. The rig interface in `rig.js` is the
contract: swapping the primitive rig for an authored glTF + Mixamo clips does not touch gameplay code.

**Asset plan**

| Phase | Characters | Environment |
|---|---|---|
| Now (demo) | 100% procedural primitives + procedural animation — zero asset load | Procedural: shader floor, box skyline, shader billboards |
| Phase 3 | Blender low-poly (~4–6 k tris), emissive masks, Mixamo clips retargeted via `AnimationMixer`, blended with procedural aim/recoil layers | Modular kit: 12 hand-built props, 3 arena layouts |
| Phase 4 | Optional: 1 texture atlas per hero, glTF + Draco, ~250 KB each | Baked emissive trim sheets |

**Audio: ✅ implemented in the demo** — see §4b. Layered stingers per ability (charge / release / impact), an
adaptive synthwave score that adds layers as the wave escalates, ducking on ultimates, and a phase whoosh on
hero swap. Everything is synthesized, so Phase 1 audio work is *mixing and identity*, not asset production.

---

## 7. Roadmap

| Phase | Deliverable | Scope | Est. |
|---|---|---|---|
| **0 — Prototype** ✅ | 3 heroes × 4 abilities, 4 enemy types, boss, waves, HUD, full VFX stack, procedural audio + adaptive score, charge economy + ultimate chain, character bay viewer, concept sheets | done | — |
| **0.5 — Review pass** ✅ | **Everything from the P0/P1 list in `NEON-VANGUARD-REVIEW.md`:** attack telegraphs, dash i-frames, bloom legibility, settings + accessibility, elite modifiers, enemy pooling + disposal, persistence, run summary | done | — |
| **0.6 — Combat pass** ✅ | Training wave, hit-stop, camera occlusion fade, gamepad, Lyra repair-lock rework, arena hazards, balance trims | done | — |
| **0.7 — Meta layer** ✅ | 21-implant draft between waves with rarity weighting, stack caps and a build readout | done | — |
| **0.8 — Tuning** ✅ | All balance extracted to one data module; in-game dev overlay with live sliders, cheats, perf readout and JSON round-trip | done | — |
| **0.9 — Render pass** ✅ | Static geometry baking, shared enemy materials, VFX disposal, adaptive load governor | done | — |
| **1 — Vertical slice** | TypeScript migration, 3 arenas, online leaderboard, touch controls | Make one 10-minute run genuinely great | 3–4 wks |
| **2 — Content** | Heroes 4–6 (drone-commander / cryo-engineer / blade-runner), enemies 5–9, elite modifiers, 2 more bosses, daily-seed mode | Depth & replay | 4–6 wks |
| **3 — Production art** | glTF characters + Mixamo animation, modular environment kit, full SFX/OST, cinematic hero-select | The "shippable" look | 5–7 wks |
| **4 — Platform polish** | Quality tiers, gamepad, mobile touch layout, WebGPU renderer path, accessibility (colour-blind, shake toggle, remap), i18n | Reach | 3 wks |
| **5 — Online** | 3-player co-op (Colyseus, server-authoritative, client prediction), shared leaderboards, spectate | The obvious growth lever | 6–8 wks |

**Team shape:** 1 gameplay/engine dev (full time) + 1 tech artist (from Phase 3) + audio contract.
A solo dev with AI assistance can realistically hit Phase 1‑2; Phase 3 is where a dedicated artist pays for itself.

---

## 8. Fit with `Claude-Code-Game-Studios`

The repo you linked is a **Claude Code agent framework** — 49 agents / ~73 skills mirroring a real studio
hierarchy across a 7-phase pipeline. It is not an engine, so it composes perfectly with the three.js stack:
it drives *process and documents*, three.js is the *runtime*. Suggested mapping:

| Their skill | Use it for Neon Vanguard |
|---|---|
| `/brainstorm` → Path B (prototype-first) | Already effectively done — this demo *is* the concept prototype |
| `/create-gdd`, `/ux-design` | Turn §3 of this document into the formal GDD + HUD/UX spec |
| `/create-architecture`, `/architecture-review` | Formalise §5, add the TypeScript module boundaries and the netcode seam before Phase 5 |
| `/asset-spec` (entity & screen inventory) | Generate `design/assets/entity-inventory.md` for the Phase 3 art order (heroes, enemies, props, VFX, screens) |
| `/vertical-slice` + `/gate-check` | Phase 1 exit gate — the demo passes "built and working", the slice gate is the audio + tuning + upgrade layer |
| `/create-epics`, `/sprint-plan`, `/dev-story` | Break Phases 1‑2 into epics/stories; each ability = one story with acceptance criteria |
| `/regression-suite`, `/tech-debt`, `/hotfix` | Keep the FPS budget and the pooling invariants honest as content lands |
| `/milestone-review`, `/retrospective` | End of each phase |

**Practical note:** clone the template into the game repo (`.claude/`), keep `src/` as the runtime, and let the
agents write to `design/` and `production/`. The demo's data-driven hero/enemy tables are deliberately
shaped so a `/dev-story` run can add content without touching engine code.

---

## 9. Risks & open questions

| Risk | Severity | Response |
|---|---|---|
| VFX density hurts readability during boss waves | **High** — this is the classic failure mode of this genre | Enforce a colour contract (hostile = red only), cap simultaneous ults, add an "FX intensity" slider, playtest at 4 people |
| Squad AI feels dumb / steals kills / stands in fire | Medium | Phase 1: utility-based AI, ally "don't stand in the AoE" avoidance, stance selector (aggressive/defensive/follow) |
| Mobile GPU performance | Medium | Quality tiers, disable bloom mips + rain on Low, halve particle budget |
| Scope creep on hero count | Medium | Freeze at 3 until Phase 2; every new hero costs ~1 week including VFX and AI |
| Balance across 3 kits with AI companions | Medium | All numbers in `balance.json`; add a headless sim harness to run 1 000 waves overnight |

**Open questions for you**
1. **Monetisation / platform** — free on itch.io + Steam wrapper (Electron/Tauri), or a portal deal (Poki/CrazyGames)? This changes the Phase 4 requirements.
2. **Co-op priority** — is 3-player co-op a Phase 5 nice-to-have or the actual product? If it's the product, the netcode seam must land in Phase 1, not Phase 5.
3. **Art budget** — do you want to keep the stylised procedural/low-poly look permanently (cheap, distinctive, ships faster) or move to authored 3D characters in Phase 3?
4. **Roster size** — is 3 operatives the final design (tight, memorable) or the start of a 6–9 hero collection?

---

## 10. The demo in your hands

**File:** `neon-vanguard.html` — one self-contained 618 KB file. Double-click it, or open the live preview.
No server, no install, no network access required.

**Controls**

| Input | Action |
|---|---|
| `WASD` / arrows | Move |
| Mouse | Aim (heroes turn to the cursor; ground-targeted skills land at the cursor) |
| Hold `LMB` | Basic attack |
| `Q` / `E` | Skill 1 / Skill 2 |
| `R` | Ultimate — needs a full amber charge bar (fills by dealing/taking damage) |
| `Space` | Dash (i-frame-free burst, 1.5 s cooldown) |
| `1` `2` `3` / `Tab` | Switch operative — the other two immediately become AI. **Ult → swap → ult inside 6.5 s to chain** |
| `P` | Pause |
| `M` | Mute / unmute (or the widget top-right) |

**What's implemented:** 3 heroes × (basic + 2 skills + ultimate), squad AI with formation and role-based
skill heuristics, 4 enemy types + boss, wave director with scaling, combo scoring, downed/revive, cover
pylons with collision, full post-processing chain, HUD, kill feed, floating combat text, end-of-run stats,
38 procedural SFX + an adaptive synthwave score that layers up wave by wave, **charge shards / Charge Cores
and the ×2 / Trinity Overdrive ultimate chain**, plus a separate **Character Bay** turntable viewer.

**Deliberately not in the demo:** upgrade draft, save/leaderboard, gamepad/touch, authored art,
multiple arenas, tutorial, announcer VO. Those are Phase 1‑3 items above.

> **Headphones recommended.** Audio starts on the *Deploy Squad* click (browser autoplay policy) — press `M`
> or use the top-right widget to mute.

**Try this for the best first impression**
1. Open with Aegis, hold LMB into a group, land the 3rd combo hit (the wide orange cone).
2. `Q` into a pack — Seismic Slam with the floor fissures.
3. `Tab` to Nyx mid-fight, `Q` immediately — the railgun through a whole line.
4. Get to wave 5 for the Oni-Class Juggernaut, and save Nyx's `R` (Singularity) for its escort —
   listen for the score jumping to full intensity and the music ducking under the implosion.
5. **Grab a Charge Core** (the gold beacon that drops every 16 kills), then fire `R` → `2` → `R` → `3` → `R`
   as fast as you can. That's **Trinity Overdrive**: bullet-time, refreshed kit, arena wipe.

**Second build:** `character-bay.html` — the character turntable. Orbit with the mouse, `1 2 3` to switch
operative, `Space` to fire the signature move, *Weapon Detail* to frame the gauntlets / med-gloves / rail pistol.

---

## 11. Review pass — what changed (v1.3)

Everything the P0 list in `NEON-VANGUARD-REVIEW.md` called out is now in the build.

| Review item | Shipped |
|---|---|
| **P0-1 Bloom veiling** | Bloom radius 0.85 → **0.45**, strength 0.6 → 0.52, HDR clamp 12.0 → **4.5**, plus a highlight roll-toward-white above luminance 1.6. Particle counts now run through a global budget multiplier |
| **P0-2 No attack telegraphs** | New pooled **ground-telegraph system** (`fx.telegraph`): a shader decal with a radial/linear fill wipe. Every hostile now winds up before striking — skitter 0.38 s, brute 0.5 s, sentinel 0.55 s, boss 0.85 s — leans into the blow, commits (movement drops to 12%), and **a stun cancels the wind-up outright** with an `INTERRUPTED` callout. Paired with a two-tick audio cue |
| **P0-3 Dash can't dodge** | **0.20 s of i-frames**, a 4-silhouette afterimage trail, a streak beam along the dash path, a `DODGE` callout and **+5 ult charge** for a clean dodge — dodging now *builds* your ultimate |
| **P1-4 No settings** | Options panel on the **menu and the pause screen**: master / music / SFX sliders, FX Intensity (Low-readable / Normal / Cinematic — also drives bloom), Screen shake (Off / Reduced / Full), **colour-blind-safe hostile palette** (hostiles move to amber/blue, away from the mint allies — live-retints existing enemies), damage-number toggle. All persisted |
| **P1-5 No persistence** | `localStorage` settings + personal best (score / wave / kills), shown on the menu and the end screen |
| **P1-6 Wrong difficulty axis** | Count growth halved (0.22 → **0.12**/wave); **per-enemy HP +9%/wave and damage +5.5%/wave** instead; hard cap of **45 concurrent enemies**; and a new **elite prefix system** — `SHIELDED` (front arc absorbs 70%, shows `BLOCKED`), `VOLATILE` (4.6 m detonation on death that also hurts its own side), `SWIFT` (+45% speed), `OVERCLOCKED` (double fire rate, shorter tells). Elite density ramps to 34% |
| **P1-7 Zero `dispose()`** | Enemies are **pooled per type** with a `reset()` path (no mesh rebuild on spawn); overflow and pickups call a real `disposeMeshes()` |
| **P1-8 `setTimeout` audio** | Missile stagger moved onto the game clock — obeys pause and bullet-time |
| **P2-10 FPS readout lied** | Now reports true wall-clock **frame time in ms** plus fps, measured before the simulation clamp |
| **P2-14 Chain discoverability** | Squad cards of anyone who can extend the chain pulse gold with an `ULT READY` tag the moment the window opens |
| **P2-16 No run breakdown** | End screen now shows score / waves / kills / best chain, elites downed / dodges / cores taken / run time, and a **per-hero damage-share bar** with heal and kill totals |

### Combat pass (v1.4) — the rest of the review list

| Item | Shipped |
|---|---|
| **Training wave** | A gated Wave 0 that will not advance until the player performs each verb: move → primary fire (three inert practice drones) → dash ×2 → switch operative → two abilities → **land a ×2 ultimate chain**. Auto-runs on a first-ever visit, available from the menu any time, `K` skips. Completion is remembered |
| **Hit-stop** | `G.punch()` — a capped, non-stacking freeze: ~20 ms on a crit, up to 75 ms on a 300-damage blow, 55 ms on an elite kill, **100 ms on a boss kill**. Runs off raw wall-clock time so it composes correctly with bullet-time |
| **Camera occlusion** | Cover pylons that sit on the camera→hero line now fade to 22% opacity (damped, per-pylon). Verified: the blocking pylon reads 0.30 while its neighbours stay at 1.0 |
| **Gamepad** | Standard mapping: left stick move, **right stick aims in world space** (drives the reticle and disables the mouse raycast while active), RT/A fire, B/RB dash, X/Y skills, LT/LB ultimate, d-pad switches operative, Start pauses. Hot-plug detected with a HUD callout |
| **Lyra repair-lock** | The healer is now an aiming skill. Aim within 2.8 m of an ally and the drone **locks on**: 17 HP/s (11 on herself) versus 6 HP/s passive triage, the drone physically flies to them, and a target already at full HP banks the stream as **shield up to 70**. Target selection is distance biased by 3.0 × missing-HP, so aiming into a clustered squad picks whoever is hurt. The reticle turns mint and reads `REPAIR LOCK`. Measured: +16.3 HP/s locked, 10 shield/s on overheal |
| **Arena hazards** | From wave 6 the deck starts discharging: telegraphed grid zones (reusing the telegraph shader) spawn 4–13 m from the squad, warn for 1.4 s, then discharge for 0.9 s — **30 dps to heroes and 46 dps to enemies**. They hurt both sides, so they are positioning pressure and a tool, not just extra incoming damage. Cadence tightens from 8.5 s to 4.2 s as waves climb |
| **Balance trims** | Bastion Field 7 s→**5.5 s** duration and 13 s→**15 s** cooldown (uptime 54% → 37%); combo decay 3.2 s→**2.5 s**; self-revive 12 s, now scaling to **20 s** past wave 10 |

### Implant draft (v1.5) — the meta layer

Section 3.1 promised "between waves, draft one of three cyber-implants". It's in.

**How it plays.** Clear a wave and the sim halts (rendering continues) for the **Implant Bay**: three offers,
picked with the mouse, `1`/`2`/`3`, or the gamepad. `ESC` skips for +300 score. Installed implants show as
chips on the pause screen and in the end-of-run summary, so the build is always legible.

**21 implants**, every one wired to a real call site — no dead stats:

| Group | Examples |
|---|---|
| **Squad** | Overclock (+12% damage, ×4), Ablative Plating (+8% DR), Servo Boost (+10% speed), Cryo Coolant (−15% cooldowns, capped at 55%), Capacitor Bank (+25% ult charge), Gravity Well (double magnet + richer shards), Weak-Point Scanner (+10% crit, +0.3× crit damage), **Nanite Siphon** (4% of damage returns as healing to whoever is lowest) |
| **Mechanics** | **Sync Protocol** (+45% chain window — makes Trinity reliably reachable), Core Recycler (Cores drop 3 kills sooner), **Reflex Weave** (a clean dodge grants +40% damage for 3s — the dodge now *pays out*), Grid Tap (+80% hazard damage to hostiles, turning the deck into a weapon) |
| **AEGIS** | Shock Knuckles (finisher cleaves 3m wider *and* through a wider arc), Concussive Charge (+1s slam stun — which now also cancels more enemy wind-ups), **Mirror Lattice** (Bastion Field burns anything touching it for 45/s) |
| **LYRA** | Viscous Nanites (Bloom Field's slow deepens and lingers), Wide-Band Emitter (+2m repair-lock range), **Hard Reboot** (Phoenix overshield ×1.8) |
| **NYX** | Kinetic Reclaim (each Railshot kill refunds 1.2s of its cooldown — chain a lane of enemies and it never goes down), Expanded Pods (+5 missiles, ×3), **Event Horizon** (Singularity radius ×1.5) |

**Draft design details that matter:**
- Rarity weighting 60 / 30 / 12, with a guarantee from wave 3 that a draft is **never three commons**.
  Measured over 400 drafts: 46% common, 45% rare, 10% epic, **zero** all-common drafts.
- Stack caps per implant (1–4) and offers filtered against what you already own, so late drafts can't
  dead-end.
- Hero-specific cards are drawn from the same pool — taking a NYX epic while piloting AEGIS is a real
  decision about who you intend to swap to.

**Verified over an 8-draft run:** modifiers stack correctly (dmg 1.24, cdr 0.15, hazardBoost 1.8, slamStun 1…),
7 chips render, the enemy pool recycles, and the telegraph pool returns clean to 28. No runtime errors.

### Balance data + tuning overlay (v1.6)

**`src/balance.js` is now the single source of truth** for every number worth arguing about — 60+ values
across eight groups: combat, economy, scaling, hazard, chain, dash, per-hero vitals and per-enemy stats.
`applyBalance()` pushes them into the live `HERO_DEFS` / `ENEMY_TYPES` tables, and gameplay code reads the
module rather than carrying literals.

**The overlay** (backtick or `F2` — hidden, never linked from any UI):

| | |
|---|---|
| **Live sliders** | Every value with a sensible range, paired slider + number box, applied on the frame you drag it. Change `enemies.skitter.hp` and the next spawn has it — verified |
| **Cheats** | skip wave · spawn boss · kill all · force draft · full charge · **god mode** · slow-mo |
| **Perf readout** | Frame time, fps, live enemies, **draw calls and triangles** |
| **JSON round-trip** | *Copy JSON* puts the whole tuned balance on the clipboard; *Paste JSON* applies a pasted block; *Reset* restores defaults. The workflow is: tune in-game → copy → paste into `balance.js` → commit |
| **Session persistence** | An open tuning session survives reload via `localStorage`, so you don't lose a pass to an F5 |

**A measurement worth acting on.** The perf readout exposed a bug in my own instrumentation: reading
`renderer.info` after `composer.render()` only reports the final fullscreen quad (the infamous "1 call,
1 triangle"). Fixed with `renderer.info.autoReset = false` plus a manual reset, which accumulates across
every pass. The honest numbers:

| | Draw calls | Triangles |
|---|---|---|
| Idle wave (3 enemies) | **266** | 18,144 |
| Under load (8 enemies + FX) | **312** | 24,122 |
| Budget from §5 | < 350 | < 400,000 |

Triangles are a non-issue — we are at 6% of budget. **Draw calls are the real ceiling and we are at ~89% of
it.** Every enemy, pickup and prop currently builds its own materials. Before Phase 2 content lands, the
work is material sharing and instancing on the enemy meshes; that is the difference between 45 concurrent
enemies and 150.

### Render optimisation (v1.7)

v1.6's measurement said draw calls were the ceiling. This pass went after them — and everything here is
**provably lossless**, verified by comparing vertex counts and world-space bounding boxes before and after.

| Change | Effect |
|---|---|
| **Skyline baked** | 120 towers + ~240 window strips were ~360 separate meshes — the single biggest sink. Now two merged geometries: one lit shell, one additive strip mesh carrying neon colour *and* brightness in vertex colours. **World group: 437 → 56 meshes** |
| **Ambient motes** | 26 spheres → one `Points` cloud (1 draw call), animated through the position buffer |
| **Shared enemy materials** | Materials were built per instance — 45 live enemies meant ~270 material objects and as many state changes. Now one shared pair per enemy *type* |
| **Static mesh baking** | A generic `bakeStatics()` collapses every non-animated child sharing a material into one mesh, skipping anything flagged `userData.animated` (legs, fists, rotating rings). **Juggernaut 15 → 7 meshes, brute 13 → 11, skitter 8 → 4** |
| **Index preservation** | First cut de-indexed everything to satisfy `mergeGeometries`, which tripled vertex counts (juggernaut 1,135 → 3,823). Now it only de-indexes when inputs genuinely disagree — **vertex counts are now byte-identical to the unmerged build** |
| **VFX disposal** | Every ability built fresh geometry + shaders per cast and only called `scene.remove()`. A `disposeObj()` helper now releases them; verified stable across repeated ultimate casts |

**Result:** fixed scene cost (no enemies) **242 → ~168 draw calls, a 31% cut**, with identical output.

**Verification method worth keeping:** the first image A/B was worthless — two runs of a game with random
spawns and live FX never produce comparable frames. The check that actually proved correctness was
geometric: build each enemy type with and without baking, then compare mesh count, **vertex count and
world-space bounding box**. All four types: bbox identical, verts identical, mesh count down.

**Adaptive load governor.** Draw calls scale with live enemies, so rather than pick one cap for all
hardware the game now watches frame time: sustained >24 ms sheds 5 from the enemy cap (floor 18) and
trims the particle budget; sustained <14 ms restores it, up to the player's chosen FX setting. It announces
itself once and never overrides a manual setting upward. Under swiftshader (250 ms frames) it correctly
walked the cap from 45 down to 18.

**Honest remaining limit.** At ~8 meshes per enemy the cap of 45 would still cost ~360 calls on top of the
base. The next real step is **`InstancedMesh` per enemy type** — one draw call for every skitter body, with
hit-flash moved to `instanceColor`. That is the difference between 45 and 150 concurrent enemies, and it is
a day of work rather than an afternoon. It should happen before Phase 2 content, not after.

**Still open** (Phase 1 proper): enemy instancing, TypeScript migration, additional arenas, touch controls,
and an online leaderboard.

**New regression tests:** `tools/p0test.mjs` covers telegraphs, i-frames, elite spawning, live settings
application, persistence and the summary screen. `smoke`, `combotest` and `audiotest` all still pass clean.

### Point-light pool (v1.8)

v1.7's closing note said the next step was `InstancedMesh`. It still is — but measuring first turned up
something bigger that no roadmap item covered.

**The finding.** `Enemy.build()` gave every enemy its own `PointLight`, and `Pickup` did the same for every
charge shard. A shard drops on most kills and lives 15 s, so a busy wave stacked dozens of them on top of
up to 45 enemies. Measured with a new Node harness that runs the real constructors: **45 live enemies =
45 point lights**, 330 draw calls, 213 materials, 45 canvas textures.

**Why that is worse than it sounds.** three.js r169 bakes the light *count* into the shader program cache
key, in the installed library:

| Line | Code |
|---|---|
| 20843 | `numPointLights: lights.point.length` |
| 20974 | `array.push( parameters.numPointLights )` — inside `getProgramCacheKeyParameters` |
| 19566 | `.replace( /NUM_POINT_LIGHTS/g, parameters.numPointLights )` |

So every spawn, death and shard pickup changed the count and made every material in the frame compile a new
program — and meanwhile the fragment shader looped over 45+ lights for every lit pixel. None of this showed
up in the test suite, because under swiftshader every frame already costs ~250 ms.

**The fix.** `src/lights.js` — a fixed pool created once at boot (8 enemy + 4 pickup + 4 effect slots, in
`BALANCE.perf`). Each frame the nearest enemies and pickups borrow a light, with the boss and Charge Cores
guaranteed a slot; abilities `acquire()`/`release()` theirs. Unused slots stay `visible` at intensity 0,
because `projectObject()` skips invisible objects *before* it reaches the `isLight` branch — hiding a spare
would change the count and defeat the scheme.

**Result:** the scene's point-light count is now **constant at 16** for the entire run, down from 45+ and
climbing. No spawn, death, pickup or ultimate can recompile a shader any more. A leaked slot is benign by
construction — it costs a glow, never a hitch.

**Two bugs the new test caught on the first run**, both of which would have shipped:
- `setBudget()` read `budget.enemy` while `balance.js` stores `lightsEnemy`, so the pool built **zero**
  lights. The game still ran — just completely unlit.
- Four ability code paths wrote `light.intensity` without checking for `null`. `acquire()` returns null
  when the effect pool is exhausted (four ultimates at once), so the first Trinity chain would have thrown.

**Verification, and its limit.** `tools/lighttest.mjs` runs 35 assertions against the real `Enemy` and
`Pickup` constructors — light count invariant across 40 rounds of spawn/kill churn, nearest-wins ordering,
boss and Core priority, pool exhaustion, double-release, `clear()` on run reset, and budget resizing.
`tools/geocheck.mjs` reports per-type draw calls, vertices, bbox, materials and textures; enemy lights are
now zero at every population. **The six puppeteer suites were not run** — the sandbox had no browser and
blocked every Chrome download host. The lighting *look* is therefore unverified: the far-field red wash
from dozens of overlapping 5 m lights is gone by design, and the 8 nearest enemies still light the floor
around the player.

---

### Character hard-surface pass (v1.9)

Every hero was built from smooth primitives — `BoxGeometry` torsos, `CapsuleGeometry` limbs,
`SphereGeometry` shoulder pads — which is exactly why they read as "square and round" next to the
`concept/*.jpg` sheets, which are all **chamfered, faceted plate armour**.

**Two ingredients produce the hard-surface read, both procedural (still zero asset files):**

1. **Chamfered plates.** A new `chamfer(w,h,d,mat)` builder makes a box whose outline is beveled by a
   single angular bevel (`ExtrudeGeometry` with `bevelSegments:1`). Chest, collar, abs, pelvis, head,
   pauldrons, fists and feet all became chamfered plates; limbs became tapered hexagonal segments
   (`seg()`), shoulder pads faceted icosahedra, and the chest core a hex prism — matching the concept's
   hex cores.
2. **Flat shading.** `flatShading: true` on the two metal materials, so each facet catches the key light
   as a distinct plane. This alone is the difference between "armour" and "smooth plastic".

Per-hero silhouette beats were added: layered angled pauldrons for AEGIS, a hood + waist tabard for LYRA,
a crest blade + tabard for NYX, hip tassets for all. The bone/joint names returned by `buildHumanoid` are
unchanged, so `animateRig` and `heroes.js` work untouched. Rig triangles actually **dropped** (aegis
3,760 → 1,180), so the pass is free on the triangle budget; heroes add ~a dozen draw calls each, which is
a fixed cost (3 heroes) and the enemy-instancing work is what addresses the enemy side.

**A headless art loop, because the sandbox has no WebGL:** `tools/charpreview.mjs` runs the real
`buildHumanoid` + `animateRig` + weapon builders in Node and dumps world-space triangles to JSON;
`tools/render.py` rasterises that JSON to a PNG (painter's algorithm + flat lambert + emissive) that a
person can actually look at. Before/after captures are in `screenshots/rig-before-*.png` and
`rig-after-*.png`. This loop is now the sanctioned way to iterate on character art without a browser —
image diffs of the live game remain meaningless, but a controlled posed dump is not.

### Hero Studio: skins, skill effects and a cast bench (v1.9.1 → v1.11.3)

The proposal's long-run plan says the asset pipeline is where this goes next: concept sheet → image-to-3D →
GLB. That only works if someone can *fit* the result into the game without rebuilding it, so the art tools got
a third surface: `hero-studio.html`, beside `model-viewer.html` and `character-bay.html`.

**What it edits** (all of it written to `models/uploads/hero_tuning.json`, read once by `startGame()`):

1. **Size and placement** — `scale`, `pos{x,y,z}`, `yawDeg`. This is what fixes the AI-rebuild artefact of a
   body sunk to the floor or facing backwards; previously it needed a code change and a rebuild. In v1.10.1 it
   became trustworthy: the three uploaded hero GLBs were exporting with their pivot at the body centre, the
   loader compensated (centring + a 1.199 m lift written into `root.position`), and the hero animation loop —
   which owns that position every frame — overwrote the compensation. The lower half of every hero sat under
   the deck plate. `pos` is now documented and implemented as an **adjustment on top of the loader's fit**
   (0/0/0 is correct), the lift survives a clone via `userData.stage`, the size multiplier is carried by the
   same base so a 1.35× hero still stands on the floor, and the studio panel gained type-in boxes next to the
   sliders, a feet/head readout that flags clipping, `auto-lift` and `reset`.
2. **Action motion** — the nine `DEFAULT_MOTION` coefficients that give an unrigged statue its walk bob,
   lunge, hip twist, cast lean, hurt recoil, idle sway and topple.
3. **Skill effects, per skill** — v1.9 had exactly one effect slot per hero, so SEISMIC SLAM, BASTION FIELD
   and MAGNETRON all fired the same burst. v1.10 gives every hero a slot per skill (Q / E / R) plus a shared
   slot that keeps a v1 file working unchanged, and each slot carries its own **look**: `scale y dur grow
   spin rise fade opacity light tint blend` for a `.glb` prop, plus `rate vblend face loop` for a video
   billboard (`.mp4` / `.webm` / `.ogv`).

**How the effect reaches the frame.** `useSkill(i)` calls `Hero.playFX(G, i)` → `fxpack.fxFor()` resolves
that slot (per-skill, else shared, else nothing) → `fxpack.spawnFX()` builds it. The studio previews through
the same `spawnFX`, so a tuned effect that looks right in the editor is the same object the match draws —
there is no second preview path to drift.

**Cost discipline, because uploaded content is the one thing the render budget cannot see.** `spawnFX`
allocates nothing per cast in the common case: GLB subtrees come from a per-file free list, tinted /
re-blended material sets are cached per look signature and shared by concurrent casts (a fade or a
translucent look is the only case that needs its own material set, and even those are recycled rather than
disposed, so no cast ever drops a shader program), one
`<video>` + `VideoTexture` is refcounted per clip file instead of a decoder per cast, and the glow light is
borrowed from the fixed pool in `lights.js` so the scene's light count still never moves. `kill()` — not
`disposeObj()` — releases the effect, and every FX coroutine carries a `dispose()` hook so the run reset that
truncates `G.effects` cannot strand one. The studio also prints the tri/mesh cost of whatever you drop and
warns above 24 meshes, because that is draw calls **per cast**.

**A bench inside the editor (v1.11).** An effect is only 90% of the picture: what it *reads* against is the
cast — the leap, the impact frame, the ability's own rings and shake, bodies flying. `src/sim.js` gives the
studio a stand-in arena (0/3/6 targets with only the fields the abilities read) and runs the **real**
`Hero.useSkill(i, G)` in it, with `½×`/`¼×` slow motion applied once to `dt` so the whole page slows together.
`tools/simtest.mjs` (41 assertions) drives all nine abilities plus the basic attacks through it headlessly and
checks the things nobody could check without a browser: that every cast expires, that the scene is left
*identical* (same visible set, same total children — a planted per-cast leak turns it red), that the light pool
balances, that no non-finite transform reaches the frame, and that the bench never double-ticks the page's own
effect list. The studio also gained an in-panel **HOW FX WORK IN THIS BUILD** explainer, because the six-step chain
(`useSkill → playFX → fxFor → spawnFX → coroutine → kill`) is exactly the thing people get lost on.

Reviewing the same question one layer down produced **`MOTION-AUDIT.md`**: heroes have no animation clips at
all — a frame is one positional write plus four decaying envelopes (`attackAnim`, `castAnim`, `hurtAnim`,
`downed`), and an uploaded GLB skin is a rigid statue that those envelopes rock and bob. It measures two
shipping bugs (`seismicSlam` restores the hips to a hardcoded `0.95`, so a GLB-skinned AEGIS floats 0.95 m
above the deck for the rest of the run after one Q; `animateRig` writes a flat `0.95` where `buildHumanoid`
built `0.95 * scale`, so every procedural hero stands ~15 cm inside the deck) and states why
`template.clone(true)` must become `SkeletonUtils.clone` *before* anyone wires a mixer: today the four heroes
share one skeleton because nothing writes a bone. `tools/animcheck.mjs` re-measures all of it and stays green
until something new breaks — the report came first, the fixes followed it.

**v1.11.3** landed phase A's skeleton-isolated clones (`cloneRig`, so a hero body and a pooled FX prop never deform from the
same bones). The pass after it gave the bench a body: `CAST SIM` now runs the game's own order — `Hero.move` then
`Hero.update` — behind a **MOVE** row and a `dash` button, so walk, drift, dash, the 1.1 s combo clock and every
envelope decay are previewable at all, and the studio stops hand-decaying the envelopes while the bench owns them.
Three consequences worth stating: the panel can no longer *lie* about a timing (it is ticking the same state
machine), the per-frame paths were stripped down to zero allocations and are now gated statically so they stay
that way, and — the reason the change was worth making — the first cast through the new loop failed the "no leak"
assertion and exposed a shipping bug nothing had ever been able to see: `railshot` wrote its charge ramp every
frame and cleared it in the fire branch, so its own coroutine wrote `1` back over the clear and NYX kept the
overcharge aura, a maxed coil and a particle per frame **for the rest of the run**. One gate fixed it (F8).
`FX LOOK` also gained an `anchor` row — *cast point* (unchanged default) or *follow hero* — because the slam turns
out to move the caster 1.18 m past where its uploaded effect was planted (F3), and that is a choice for the person
making the effect, not one a bug fix should make for them.

**Judging a file before you spend a slot.** The LIBRARY list got its own preview: every row ends in `▶`,
which fires that file at the hero through the same `spawnFX` a real cast uses, with the params the file would
actually cast with (edited slot → shared → this hero's other slot → kind defaults, via `fxpack.fxPreviewFor`).
Because a preview must not become an edit, `fxPreviewFor` hands back a clamped **copy** — `skintest` asserts
that the tuning object is byte-identical before and after a preview, and that an entry no slot references
still spawns, pools and dies cleanly. `⟳ loop` re-fires on a 0.22 s beat, because a 0.65 s shockwave is not
judgable from one play.

**Testing without a browser.** `tools/skintest.mjs` grew from 39 to 138 assertions, plus a new
`tools/herofit.mjs` (18) that walks the real committed GLBs through parse → normalise → `Hero.build` →
`animateGLB` and asserts the feet land on y = 0 at default tuning, at 1.35× size and 90 frames into a walk —
the cheapest possible guard against a "looks fine in the viewer, buried in the game" class of bug. The suite now covers the whole
pipeline headlessly: v1 → v2 config migration, slot resolution and fallback, `clampFX` against NaN /
out-of-range / hand-edited JSON, URL-keyed bank de-duplication, free-list reuse, shared-material mutation
(proved by hooking `Material.prototype.dispose`), light acquire/release balance, video refcounting, and that a
run-reset `dispose()` leaves the scene clean.

**An onboarding path for the art side.** Because the whole loop is file-based, the repo ships four sample AEGIS
skill effects and the guide that walks a non-programmer through them (`FX-AEGIS.md`, generated and validated by
`node tools/fxsample.mjs`). Each sample is 3–11 meshes / 184–568 tris and the generator spawns every one
through the real `fxpack` path before calling it good — so the examples double as a regression fixture for the
effect layer, and the "too heavy to be a per-cast prop" guard has something to be measured against.

**Not done, on purpose.** `hero_tuning.json` is a sandbox-only artefact (the dropbox server writes it, and the
game re-reads it on each restart), so deployment needs a checked-in copy or a real backend; `nyx.glb` is still a byte-identical copy of
`aegis.glb`; and the studio cannot retarget an *animated* GLB (no skinning/clip support yet — see the
backlog in `HANDOFF.md` §8).

### Recommendation

**Proceed on three.js.** Approve Phase 1 (vertical slice, 3–4 weeks) with a hard gate:
*audio + hit-stop + upgrade draft + tuning overlay*, then re-evaluate against the four open questions above.
If the answer to Q2 is "co-op is the product", insert a 1-week netcode-seam spike **before** Phase 1 content work.

---

## Long-run deployment & content pipeline

**Verdict.** The single-file, zero-asset build is the right *vertical slice* — instant load, no pipeline,
nothing to break — but the wrong *product* packaging. For real deployment, split the engine from its
content, move characters/props to an authored asset pipeline, and keep procedural generation only where it
earns its keep (FX, particles, arena dressing, the music). AI image-to-3D is a **content-acceleration
stage**, not a runtime dependency.

**Staged plan.**

1. **Ship the slice and playtest it.** Four strangers, fifteen minutes each. The dominant risk for a real
   product is the fun loop, not the tech — every item below is secondary to that signal (see §9 of the
   original proposal).
2. **Packaging: bundler + CDN, not one HTML file.** Move to a Vite/esbuild build that emits hashed JS/CSS
   and content files served from a CDN with cache headers. A single 717 KB file defeats HTTP caching: every
   update forces a full re-download. Keep the single-file build as a demo artifact.
3. **Content pipeline on glTF.** Standardise on GLB + one shared humanoid skeleton. Flow: concept sheet →
   image-to-3D (Tripo / TRELLIS) for the base mesh → retopo + bake to budget + LODs in Blender → export GLB
   → `GLTFLoader`. Keep the procedural rig as the in-engine fallback and for FX, and reuse its animator
   targets where possible.
4. **Runtime perf for real (including low-end) devices:** enemy `InstancedMesh` (already backlog #1),
   texture atlases, LODs, and the fixed light pool from v1.8. These are what let the enemy cap grow.
5. **Decide platform + co-op before heavy content investment.** Web keeps lean budgets; native (Electron /
   Steam) or mobile changes asset budgets and packaging. If co-op is the product, insert the netcode seam
   *now* — it is the one open question that reshapes the architecture rather than the content.

**Licensing note for shipped assets.** Free tiers don't cover shipping: Tripo's free plan is
non-commercial and Meshy's free outputs are public CC BY 4.0. For a real game, budget ~$20/mo on a hosted
tool or self-host an MIT-licensed model (TRELLIS.2).
