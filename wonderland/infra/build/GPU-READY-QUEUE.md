# GPU-ready queue

> **2026-08-21 — READ THIS FIRST, THE STATE BELOW IS OLDER THAN IT LOOKS.**
>
> The bring-up is **closed**: WonderlandHub builds, cooks, packages, launches
> on an **NVIDIA L4** with UE 5.8 + PixelStreaming2 and streams the correct
> world. Two defects got it there — the package had no map pinned, and had no
> streamer in it. Do not reopen that work.
>
> What changed since, and what the next GPU session should actually do:
>
> 1. **The launcher passed no `-ExecCmds` at all.** Every Lightning frame so
>    far rendered at the engine's DEFAULT exposure, while a comment in
>    `run-stream.sh` said the AutoExposure bias was being applied from the LOOK
>    table. Settings now come from `wonderland/rendering/profiles.json` via
>    `WL_RENDER_PROFILE` (default `BALANCED`).
> 2. **Probe the engine before believing any setting:**
>    `bash wonderland/rendering/probe-cvars.sh`. Unreal ignores an unknown CVar
>    without failing, so `render-profile.py --strict` refuses anything the
>    probe says is absent, and `bench.sh` will not measure without it.
> 3. **Then measure, don't guess:**
>    `bash wonderland/rendering/bench.sh --label before --profile BALANCED`,
>    change one thing, run it again with a new label, and
>    `python3 wonderland/rendering/compare.py before after`.
> 4. **Run once, for the draw-call question:**
>    `r.MeshDrawCommands.LogDynamicInstancingStats 1`. The world is 33,028
>    components over 116 (mesh, material) pairs; UE5 auto-instancing is on by
>    default and has probably already collapsed them. If it has, draw calls are
>    solved and the remaining cost is per-primitive.
> 5. The Relay Dogs exist now. They did not before — see the pre-cook gates.
>
> **2026-08-21, later — THE L4 MEASURED THE WORLD AND THE WORLD WAS THE PROBLEM.**
>
> Browser-side on the L4: 1280x720, H264, 18 Mb/s, **12 FPS**, zero freezes,
> **GPU utilisation ~10%**, VRAM 1.6 GB, RenderThread 55-80% of one core,
> 33,149 actors. A GPU at ten per cent while the frame rate is twelve is
> starved. The cost was never shading — it was submitting thirty-three thousand
> actors, one per decorative piece.
>
> The world is now **batched**: every purely visual piece is an instance inside
> one of ~144 `AWonderlandInstancedBatch` actors, keyed by (mesh, material,
> casts-shadow). Markers, portals, interactables, lights, cameras and the Relay
> Dogs stay individual actors — semantics are worth their overhead, ornament is
> not.
>
> | | before | after |
> | --- | --- | --- |
> | actors per build | ~33,000 | **~256** |
> | loose StaticMeshActors | 32,512 | **0** |
> | visible pieces | 31,996 | **31,996** |
>
> The composition preview measures the frame **identical to the decimal** —
> objects 95.855%, sky 4.104%, 49 materials, 4 readable Relay Dogs, hero Dog
> 171.867px. Nothing was removed to get the actor count down, and the dry run
> now fails if anyone tries: it caps loose actors AND floors the piece count.
>
> `WONDERLAND_BATCH=0` regenerates the old architecture for an A/B.
>
> **Nothing here has been compiled.** There is no Unreal in the development
> environment. The next build is the first time this C++ meets a compiler.
>
> The p23 comparison advice below still stands and is still the cheapest way to
> localise a visual regression.

Everything on `relay/wonderland-ca-fixes` after commit `a6bb099` (the sky pass)
was authored **without a renderer**. The last real streamed frame is `p23`,
captured from the California host before it stopped. Since then: **55 commits,
28 of them touching the world**, `+3,590 / -191` lines across the generator and
the layout.

That is a large unrendered delta, and it is deliberate — cost mode says keep
building — but it means the first cook after compute returns is not a check.
It is a **bisection problem with fifteen-plus suspects landing at once.** This
file exists so that session is spent measuring rather than remembering.

Nothing here is merged. Nothing here has a PR. Merging is founder-authorized only.

---

## The one command, first

```bash
git fetch origin && git checkout relay/wonderland-ca-fixes && git log -1 --oneline
```

Then follow `HANDOVER.md` for the host: it has the resume path, the ports that
are actually reachable, and what the box's `onstart` does and does not bring up.
**Read its "If the first build looks worse than p23" section before cooking** —
the box still holds the p23-era generator, so an A/B against the last known-good
render costs one extra cook and is the fastest way to localise a regression.

---

## Run in this order

Each step is cheap and each one can fail on its own, which is the point: do not
cook until the free checks pass.

### 1. Offline gates (no GPU, ~20 min on a laptop, seconds on the box)

```bash
cd wonderland/infra/build
python3 verify-look-table.py        # LOOK table wired + overrides refused correctly
python3 verify-docs.py              # these docs still describe code that exists
python3 verify-generator-classes.py # every /Script/Wonderland.X the generator spawns EXISTS
python3 verify-dog-proxy.py         # the preview's Dog still matches the shared C++ table
python3 verify-generator-dryrun.py  # the generator EXECUTES; counts actors; surfaces warnings
python3 verify-hero-composition.py /tmp/hero.png   # per-object frame coverage
python3 verify-hero-lighting.py     /tmp/lit.png   # CPU value structure
python3 verify-visual-target.py     # the frame against WorldDesign/visual-target.json
cd ../../rendering && bash rendering.test.sh       # profiles, probe parser, bench, report
```

**`verify-generator-classes.py` is new and it is the cheap one to never skip.**
It caught the worst defect this project has had: the generator had been
spawning `WonderlandStrollingDog`, a class nobody ever wrote, and
`unreal.load_class` returns `None` rather than raising — so the hero Relay Dog
and seven companions were absent from every build ever made, silently, and the
dry run could not see it because its stub makes the lookup succeed.

`verify-visual-target.py` will currently report **4 criteria not met**, all
palette, and that is the truth rather than a regression. See section A.

All of them must exit 0 except verify-visual-target.py, whose misses are the
open art work. The dry run is the one that has actually saved a cook:
it caught an art pass silently deleting another pass's kits. `verify-dog-proxy.py`
is the one that caught the worst error of the sprint — see below.

### 2. Cook and stream, unchanged settings

Do not touch a value yet. The first frame's job is to be **comparable to p23**,
not to be good.

### 3. Capture the hero camera and compare

Same camera, same framing as p23. Then, and only then, work the queue below.

---

## The queue, ordered by how likely it is to be wrong

Highest risk first. This ordering is the deliverable — it is where the
unrendered work is most likely to have gone astray, and why.

### A. THE HERO FRAME HAS ALMOST NO SKY — measured, unresolved

The reference names **vivid blue sky and soft clouds** as an element. Measured
by real visible-pixel ownership (not projected boxes), the hero frame is:

```
95.8% objects     4.1% SKY     0.1% bare ground plane
```

Four per cent is not a sky. The frame is pinched at both edges: the Dog's feet
land at y=430 in a 449-tall frame, and the castle's tallest spires reach y=19.
There is no room above or below without moving something structural.

Measured ownership of the TOP THIRD — who is actually roofing the shot:

```
10.6% sky, 89.4% covered
  golden_gate          9.5%      tree canopy, all sources  ~31.6%
  TreeBranchCard12     7.7%      (the framing branch + the great trees)
  GreatTree0_lc3       4.8%
  framing_tree         3.7%
```

So the canopy is the biggest single cause and the gate is the second. Opening a
two-segment window in the framing branch changed total sky by **nothing** —
whatever sits behind it fills the same pixels — so thinning the canopy piecemeal
is not the answer. That experiment was reverted rather than kept.

The options, none of them free:

1. **Tilt the camera up.** Gains sky, pushes the Dog's feet out of frame.
2. **Lower the castle silhouette** (drop the donjon, or push the city further
   out). Gains sky, and partly undoes the skyline mass just added.
3. **Open holes in the canopy.** A real canopy is dappled and this one is
   solid; gaps would let sky through without moving the camera. Best art
   answer, hardest to control from a kit.
4. **Accept it** — decide the hero shot is a canopied garden view and the sky
   belongs to a different camera.

**This is deliberately unresolved.** It is a composition judgement that wants a
real frame and the founder's eye, and making it blind from a CPU preview is the
mistake that has already cost two passes today. Look at the first Lightning
render before changing any of it.

### A2. The instrument was wrong three times — trust the NEW numbers only

Every composition figure quoted before 2026-08-19 late-session is suspect. Three
separate defects in the offline harness, all involving large flat surfaces or
occlusion:

1. **One depth per object.** Each blob carried its nearest corner's depth
   applied to every pixel it painted, so the plaza bed overdrew hundreds of
   cobbles genuinely in front of it. It measured 8.1% of the visible frame and
   ranked as the largest lone primitive in the world; the truth was zero. Fixed
   by fitting depth as a plane across the footprint.
2. **Bounding-box area printed as "% of frame on screen."** Occlusion ignored.
   Now reports pixels actually owned.
3. **Leaf cards absent entirely.** The masked leaf master cannot be built
   offline, so seven `if "leafcard" in MATS` guards took their false branch and
   every preview showed a world with no foliage cards in it.

Each time several signals AGREED, because they shared the broken substrate.
**Agreement between metrics built on the same rasteriser is not corroboration.**

Current, post-fix numbers:

```
lone primitives carrying the frame   0.72%   (stop condition 2, now measurable)
largest single visible object        1.28%   mushroom_red_a_cap
sky                                  4.1%
```

A frame where the biggest object owns 1.28% is a densely detailed frame; no one
thing carries it. That is the shape you want, and it is worth checking the real
render agrees rather than assuming the CPU preview earned it.

### B. Emissive budget — HIGH RISK

Three separate regressions this sprint came from multiplying emissive geometry
without dividing its radiance: clouds (28→44 clusters *and* 2.6→3.6 radiance),
the arcane spill (78 strips at radiance 11), the Brain (5→72 lobes at 2.2).

**Why it keeps happening:** histogram auto-exposure meters against the *whole
frame*, so adding light anywhere darkens everything else. The symptom is never
"the sky is too bright." It is always "**the foreground is mud**," which reads
as a foreground problem and sends you to fix the wrong thing.

**What to check:** if the foreground is muddy, look at the sky and the emissives
*first*. Sweep `exposureBias` and confirm it barely moves — if it does move the
frame a lot, that itself is new information, because it did not at p23.

### C. Hero practicals — NEW, NEVER RENDERED

Three shadowless point lights (arcane circle, gate, rose arch) added on top of
a world that previously had only lantern practicals. Tightly attenuated by
design, but attenuation radius is exactly the knob that behaves differently
under Lumen than it reads on paper.

**A/B in one cook:**
```bash
WONDERLAND_LOOK="heroLights=0"   # then rebuild the level and compare
```
If they wash out the plaza, drop `heroLightLumens` before dropping the lights —
the violet bounce onto the Dog's white chest is the point of the whole beat.

### D. Procedural normals and roughness breakup

Added to the master material, so **every surface in the world** inherits them at
once. `DetailAmp` and `RoughVary` are per-instance and tuned per family, but the
whole system has never been seen. Failure mode: ceramic and gold look
sandblasted, or the noise scale is wrong for the world's unit scale and
everything looks like orange peel.

**If so:** the fix is per-family `DetailAmp`, not a global reduction — a global
one trades one uniformity for another.

### E. Generated textures

`gen-textures.py` synthesises cobble, ashlar, sward, bark, plaster, roof and
leaf cards from pure stdlib. They have been inspected as PNGs and never as
materials on geometry. Watch for tiling repetition at mid-distance, which is the
usual way procedural texture betrays itself and which no still inspection shows.

### F. Frame rate — the world grew 35% and nobody decided to

**33,048 actors per build**, against the only figure ever actually streamed:
**~25,000 movable actors at 1280x720 / 140 fps on an RTX 6000 Ada**. Everything
above that number is extrapolation. The world is at 132% of it — just under the
tripwire the dry run now carries, which warns at 135% and fails at 200%.

The growth was one justified pass at a time, which is exactly how a budget is
spent without anyone deciding to. Where it went, by group:

```
tuft 1224 (3.6%)   flowers 1134 (3.4%)   townhouses 1746 (5.2%)
brain 737 (2.2%)   castles 1278 (3.8%)   clouds 570 (1.7%)
```

Nothing pathological — no group over 3.6%, and the distribution is flat, which
is what a densely detailed world should look like.

**Nanite is deliberately NOT used, and the temptation should be resisted.**
These are engine BasicShapes — a dozen triangles each. Nanite's per-instance
overhead exceeds any benefit on geometry that simple, so switching it on here
would cost frame time rather than save it. The brief says "use Nanite
appropriately", and appropriately here means not at all.

**If the stream is short of frames, the lever is HISM**, not deleting detail:
tufts, flowers and leaf cards are roughly a fifth of the world between them and
are highly repeated (mesh, material) pairs. Instancing those is a contained
change. Deleting them undoes the lushness the whole sprint was for.

The shadow budget below already trims 29% of casters, so that lever is spent.

### G. Shadow budget

29.2% of meshes were switched to cast nothing. This was a performance change
justified by "nobody can see these shadows" — a claim made from projection
geometry, not from a render. If contact shadows have gone missing somewhere the
eye lands, `NO_SHADOW_MATS` / `NO_SHADOW_PREFIX` in the generator is the dial.

### H. Ornament vocabulary and density

`+2,845` static meshes from the ornament, shrub and topiary passes. Two things
to watch: frame rate on the stream, and whether the near-camera guard
(`in_camera_lap`) is doing its job — the tracer says the topiary sits at 19% of
frame height, but the tracer has been wrong about geometry before.

### I. The hero Dog's size in frame — CHECK THIS FIRST BY EYE

Not a code risk, a **judgement** one, and the only item here that wants the
founder's eye rather than a measurement.

The Dog is built by the C++ pawn, not the generator, so the offline harness
carries a transcription of it — and for most of this sprint that transcription
was three eyeballed cubes at barely half the real Dog's height. Corrected, the
Dog is **15.1% of frame width by 65.5% of its height**, not the 22.5% every
earlier note claimed. Its feet land at y=430 in a 449-tall frame, the golden
gate is clear of it, and its head overlaps the lower Brain.

The staging was deliberately left alone, because the number had just been
fixed and moving the world on the strength of a freshly-corrected instrument
is how you introduce the opposite error. But 65.5% is a **character portrait
with a city behind it**, not a city establishing shot with a character in it,
and which of those the hero frame should be is the founder's call. If it wants
to be the latter, move the Dog's staging back along the boulevard rather than
shrinking it — the Dog standing ON its arcane identity circle is the beat.

### J. The clouds

Geometry cumulus, because UE's stock volumetric cloud material renders as a flat
grey sheet under this lighting. Lowest risk of the group and the easiest to turn
off, but if the sky reads as floating balls rather than cloud, the silhouette
scale is the first thing to change, not the count.

---

## Sweeps worth running while the GPU is hot

`WONDERLAND_LOOK` exists so a lighting session is a sweep instead of
edit-rebuild-look. Unknown keys are refused, so a typo stops the cook rather than
silently rendering the default.

```bash
# key light
WONDERLAND_LOOK="sunLux=260"      # / 340 (current) / 420
# grade brightness — the real lever, since it runs AFTER metering
WONDERLAND_LOOK="gain=0.52/0.52/0.56"    # / 0.60/0.60/0.64 (current) / 0.70/0.70/0.74
# saturation
WONDERLAND_LOOK="saturation=1.30/1.28/1.36"   # against 1.52/1.48/1.60
# practicals off
WONDERLAND_LOOK="heroLights=0"
```

**Do not sweep a MEASURED value from a CPU preview.** The offline tracer runs
brighter and far less saturated than the real renderer — it was once measured
at +94% luma, +26% contrast, −76% saturation, but **those magnitudes are stale**:
the tracer now samples roughness maps, which moved its own output to luma 94.0,
contrast 50.3, saturation 0.311. The direction of each offset still holds; the
ratios do not. **Re-derive them from the first Lightning frame** — that is a
five-minute job with a captured frame and it makes every later comparison
honest. It once
told me the palette read washed out; the streamed frame said the opposite. The
table tags every value with its provenance for exactly this reason.

---

## What a "done" frame looks like

The founder's four stop conditions, restated as things to look at:

1. **Substantially closer to the reference** than p23.
2. **Primitive prototype appearance no longer dominant** — the test is whether
   you can find a raw cube, cylinder or cone reading as itself in the hero frame.
3. **The hero view reads as a lush premium fantasy city** — dense, warm,
   handcrafted, with near detail and far silhouette clearly separated.
4. **The California stream is up and reviewable by the founder.**

---

## Known traps, so they are not rediscovered

- **`FScreenshotRequest` is a phantom** in this configuration — it returns
  success and writes nothing. Capture from the browser side.
- **Auto-exposure never converges** in the packaged stream; a bias-0 histogram
  read avg 254/255. Treat exposure as fixed and grade instead.
- **The PostProcessVolume and the camera grade do not reach the packaged Pixel
  Streaming render.** The launch cvar `r.AutoExposure.Bias` does.
- **`unreal.Rotator()` positional args are ambiguous** — always set `pitch`,
  `yaw`, `roll` by name. A mis-ordered rotator aimed the sun at the sky and
  rendered a black frame.
- **Playwright's bundled Chromium has no H264.** Use `channel: "chrome"` or the
  stream is black with no error.
- **`ss` is not installed on the box** — it reports "nothing listening" when
  something is. Use `netstat` or `/proc/net/tcp`.
- **A 261 GiB UBA sparse file** killed the export once. Check free disk before
  cooking; the 350 GB disk is not as roomy as it sounds.

---

## Still queued, not yet built

Offline work that remains, in the order I would take it:

- **Props**, continued — teacups and teapots, floating keys, playing-card motifs
  and heart motifs beyond the signpost and clock already upgraded.
- **Project Avatar contracts** — domain layer only, no render dependency.
- **Coliseum** — gaps only, per the founder's scoping.
- **The split UE project configuration.** `relay/wonderland-foundation`
  (uncommitted worktree) and this branch have diverged **in both directions**
  across four files: `WonderlandPlayerController.cpp` has `OnPossess` only in
  the committed branch, while `RelayWorldState.h` and `Wonderland.Build.cs` are
  newer in the foundation worktree. This needs a real three-way merge and is
  flagged rather than guessed at, because the only configuration known to build
  Wonderland is the one on the Vast disk.
