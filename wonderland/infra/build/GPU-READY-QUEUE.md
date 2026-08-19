# GPU-ready queue

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
python3 verify-generator-dryrun.py  # the generator EXECUTES; counts actors; surfaces warnings
python3 verify-hero-composition.py /tmp/hero.png   # per-object frame coverage
python3 verify-hero-lighting.py     /tmp/lit.png   # CPU value structure
```

All four must exit 0. The dry run is the one that has actually saved a cook:
it caught an art pass silently deleting another pass's kits.

### 2. Cook and stream, unchanged settings

Do not touch a value yet. The first frame's job is to be **comparable to p23**,
not to be good.

### 3. Capture the hero camera and compare

Same camera, same framing as p23. Then, and only then, work the queue below.

---

## The queue, ordered by how likely it is to be wrong

Highest risk first. This ordering is the deliverable — it is where the
unrendered work is most likely to have gone astray, and why.

### A. Emissive budget — HIGHEST RISK

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

### B. Hero practicals — NEW, NEVER RENDERED

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

### C. Procedural normals and roughness breakup

Added to the master material, so **every surface in the world** inherits them at
once. `DetailAmp` and `RoughVary` are per-instance and tuned per family, but the
whole system has never been seen. Failure mode: ceramic and gold look
sandblasted, or the noise scale is wrong for the world's unit scale and
everything looks like orange peel.

**If so:** the fix is per-family `DetailAmp`, not a global reduction — a global
one trades one uniformity for another.

### D. Generated textures

`gen-textures.py` synthesises cobble, ashlar, sward, bark, plaster, roof and
leaf cards from pure stdlib. They have been inspected as PNGs and never as
materials on geometry. Watch for tiling repetition at mid-distance, which is the
usual way procedural texture betrays itself and which no still inspection shows.

### E. Shadow budget

29.2% of meshes were switched to cast nothing. This was a performance change
justified by "nobody can see these shadows" — a claim made from projection
geometry, not from a render. If contact shadows have gone missing somewhere the
eye lands, `NO_SHADOW_MATS` / `NO_SHADOW_PREFIX` in the generator is the dial.

### F. Ornament vocabulary and density

`+2,845` static meshes from the ornament, shrub and topiary passes. Two things
to watch: frame rate on the stream, and whether the near-camera guard
(`in_camera_lap`) is doing its job — the tracer says the topiary sits at 19% of
frame height, but the tracer has been wrong about geometry before.

### G. The clouds

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
**+94% luma, +26% contrast, −76% saturation** against the real renderer. It once
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
