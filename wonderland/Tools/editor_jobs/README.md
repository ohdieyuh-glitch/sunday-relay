# Editor jobs

Scripts that drive a live Unreal Editor session through `wonderland/Tools/editor_channel.py`.

**Visual authority:** captures are judged against the GPT Wonderland Bible boards, not the Marble image
(`wonderland/WorldDesign/VISUAL_AUTHORITY.md`, founder ruling 2026-09-13). The hero camera is
`HeroCam_GoldenArrivalBible` (renamed from `HeroCam_V2_MarbleReference` on 2026-09-13); the hidden Marble scaffold
is historical source only. Compare every capture with the Bible panel it aims at:
`wonderland/Tools/bible-compare.ps1 -Capture <png> -Panels hero_b1,skyline_b4 -Out <jpg>`
(panels are named in `wonderland/WorldDesign/Reference/bible_panels.json`).

Launch the editor with the channel once:

    UnrealEditor.exe Wonderland.uproject /Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2 ^
      -ForceEnablePython -ExecCmds="py <repo>/wonderland/Tools/editor_channel.py <channel dir>" -NoLiveCoding

Then write a job into `<channel dir>/inbox/` ATOMICALLY: write `<name>.py.tmp`, then rename it to `<name>.py`. The channel polls every 0.25 s and will run a half-written file. The result lands in `<channel dir>/done/<name>.json`,
and any captures go to `<channel dir>/../captures/`.

| job | world | does |
|---|---|---|
| `probe_editor.py` | editor | actors, batches, editor-preview pieces, anchors, registry rows |
| `anchors_search.py` | PIE | safe, walkable, clear-camera arrival spot per registry row, with a capture from each |
| `place_anchors.py` | editor | places/moves `AWonderlandTravelAnchor` actors from `done/anchors_search.json`, saves the map |
| `ui_tests.py` | PIE | 32 checks: usage HUD, Julius 3.3 terminal (Ctrl+T), world map (M) and teleport, PIE restart |
| `camera_census.py` | editor | every CameraActor (label, pose, FOV) and the Marble scaffold placement |
| `reference_suite.py` | PIE | each suite camera twice: the authored world, and the historical scaffold alone (provenance, never the target) |
| `camera_shots.py` | PIE | authored captures from named cameras (`CAMERAS`, `TAG`), plus a frame-rate sample |
| `topdown.py` | PIE | orthographic plans of the corridor (cm per pixel = ortho width / viewport height) |
| `corridor_census.py` | editor | actors and batch instances along the Golden Arrival corridor; how the generator used hero meshes |
| `probe_ground.py` | PIE | every floor under a list of XY points (`probe_points.json`); batch collision exists only at runtime |
| `apply_layer.py` | editor | applies an authored layer (`wonderland/WorldDesign/**.json`), tagged `WL_PASS_<id>`; re-apply is exact, `REMOVE_ONLY` removes it |
| `grade_variants.py` | PIE | look/lighting variants on the PIE copy, captured side by side; nothing saved |
| `apply_look.py` | editor | applies a look (`wonderland/WorldDesign/Look/*.json`) over recorded before-values; `REVERT = True` restores them |
| `import_kit.py` | editor | imports the Blender forge kit from its import plan: no material assets, V2 instance in slot 0, Nanite and collision enforced, resumable, read back |
| `skyline_profile.py` | editor, read-only, concurrent | horizon elevation per degree of azimuth from a camera, with the nearest dominant piece |
| `reload_channel.py` | editor | swaps the running listener for the repo's current `editor_channel.py` without restarting the editor |

Rules the jobs follow, each learned in a real run:
- The founder may be using the same editor and may start Play-In-Editor at any time. EditorAssetLibrary and
  EditorActorSubsystem refuse every call during PIE (`does_asset_exist` answers False for real assets), so asset
  and map jobs wait for `get_game_world() is None`; read-only jobs read the editor world through
  `unreal.find_object(None, <map object path>)` and `GameplayStatics`, and declare `CONCURRENT = True` so they can
  start beside a running job. A job that saves the map must not save someone else's unsaved edits.
- A synthetic Ctrl+T must hold Ctrl across frames; the game's chord reads key state when it processes the press.
- Never send Escape unless a panel is open: with no panel, the editor takes Escape and ends PIE.
- Anything that saves or loads pumps Slate; the channel guards against re-entering a running job.

After `place_anchors.py`, regenerate the registry:

    python wonderland/Tools/travel_registry.py --audit <audit.json> --anchors <channel dir>/done/anchors_search.json

## get_actor_bounds is not a measurement. Do not quote a number derived from it.

**Measured 2026-09-22.** `Actor.get_actor_bounds()` returns a **cube** for Blueprint actors in this project, not
the actor's real extent, and it over-reports badly. The proof is a quantity this project already knows exactly:

| actor | what `get_actor_bounds` said | what it actually is |
|---|---|---|
| canonical Relay Dog | `bounds_extent [1010, 1010, 1010]` &rarr; **2020 cm tall** | **174 cm** (`dog_canon.EAR_TOP * 60`) |
| Relay Dog Sub-Agent Cub | `bounds_extent [128, 128, 128]` &rarr; 256 cm | a floating head, far smaller |
| Ten Tails / Cherubim / Seraph, SMALL | `256.0 x 256.0 x 256.0` for **all three** | 1.15 m tall, three different footprints |

An 11.6x over-report on the Dog, and one identical cube for three creatures that share no geometry. The giveaway
is that the three axes come back **equal** — a real creature's bounds are never a perfect cube.

This matters beyond one job: **every bounds-derived number anyone has quoted in this project is suspect**,
including the extents recorded in `cub_figures.json`. If a figure came out of `get_actor_bounds`, re-derive it
before relying on it.

**What to use instead.** Ask the mesh, then place it:

```python
sm = comp.get_editor_property("static_mesh")        # StaticMeshComponent has NO 'bounds' property in 5.8 Python
box = sm.get_bounding_box()                          # the asset's own box, in its own space
world = comp.get_world_transform().transform_location(unreal.Vector(box.min.x, box.min.y, box.min.z))
```

Union the eight transformed corners of every component's box. `verify_avatars.py` does exactly this.

For an asset built by this project's own generators there is also an offline answer that needs no editor at all:
`wonderland/v2/verify_avatar_placement.py` on the forge branch redoes the build's arithmetic in plain Python and
reports the true height to 0.05 cm. It is how the avatars were cleared without the editor.

## Lit and unlit emissive have working bands ~20x apart. Never carry a value between them.

**Measured 2026-09-22, by two lanes who each had a number and disagreed by a factor of twenty.** Internal
Development swept a small UNLIT emissive (`LevelColorationUnlitMaterial`) across six exposure floors in one PIE
session and photographed each, against this map's pinned EV100 13.5 daylight:

| scene units | what the frame shows |
|---|---|
| 1,700 | dark maroon — reads as a shadow, not a colour |
| **3,400** | a deep, unmistakable red — **chosen** |
| 13,700 | washed out to orange; it has stopped being red |
| 56,000 | far past white |

And the world lane's own measured band, for emissive on the **lit/opaque** `M_V2_Surface`, is **55,000–62,000** —
where 2.2 renders black. Both numbers are right. Each is wrong by more than an order of magnitude on the other
path: 56,000 is blown out on an unlit material, and 3,400 is invisible on a lit one.

So the transferable rule is not a number:

> A brightness measured on a lit material must never be carried to an unlit one, or the reverse. Sweep and
> photograph on the path you are actually shipping.

This is the same family as the Cub Ghost rendering black at 2.2 and the Bee's wings vanishing at 9,000 and again
at 58,000 before they were moved off the translucent master. Before spending a rebuild on a colour value, check
which path the material is on.

## Verified by reading, not by photograph (2026-09-25)

Two of the founder's P0/P1 requirements are satisfied by construction, and the construction was read
rather than photographed. Recorded here because "I looked at the source" is evidence only if the
reading is written down.

**P0-4, the fire's FLICKER.** `zc_skin_parity_all` proves each skin wears the Dog's pose and performs
its act; it says nothing about the fire. `AWonderlandCompanionEmbodiment::RebuildFlames(TimeSeconds)` is
called every tick from `Animate(TimeSeconds)`, and the ribbon shape is driven by three NON-HARMONIC sine
terms -- periods 0.37 s, 0.19 s and 0.83 s, each offset by a per-source seed -- summed into `Flick` and
clamped into `Lick`. Non-harmonic periods never come back into phase, so the flame never repeats itself.
That is the same principle the water normals and the python's route use.

**P1-7, the HUD row NAMES.** The founder asked for "COMPOUND AGENT: <user-created name>" and two more.
`WonderlandUsageHudWidget` reads all three from `UWonderlandCompanionPreviewSettings` and draws the name
after the label at 0.72 alpha, `if (!Row.Named.IsEmpty())`. Two names are in `DefaultGame.ini`
(`AgentName=Claude Code Fable 5`, `LlmCompanionName=GPT 6 Astra`) and the third is a class default
(`CompoundAgentName = TEXT("Julius")`), so all three rows carry a name with no config at all.

Neither is a substitute for a measurement where one is possible -- see `zc_mascot_persist`, which exists
because "the Wardrobe photograph looked right" hid a colour that never reached the world Dog.

## Waiting for a thing to arrive

Five jobs in one day published or voided on this, and the fix did not transfer on its own even while
two lanes were holding it. Read this before writing any wait.

**A settle watches the PICTURE. It cannot see whether the thing you are measuring has arrived.**
Four things that hold perfectly still while still wrong, each of which cost a run:

| looks settled | actually | what sees it |
|---|---|---|
| frame cost identical every read | `stat unit` overlay off, `FStatUnitData` frozen while the frame counter advances | re-issue `stat unit`; reject N byte-identical raw reads across advancing frames |
| light count steady at 127 | pool assignment paused mid-climb, reached 192 later | read the count either side of an **independent wait** |
| district steady and dark | World Partition still streaming after a teleport | `FlushLevelStreaming`, then settle |
| world steady after BeginPlay | still arriving; first rung read 0.4932 where the next three agreed at 0.2350 | warm up before the first rung, and let the settle fall through rather than trim |

**No number of CONSECUTIVE reads separates a plateau from an arrival, because consecutive reads share
the same moment.** A wait between reads is the only thing that does. Three equal samples of something
pausing on its way up is exactly what a plateau looks like.

For the picture itself, use the **window spread** — `max - min` over the last three reads — not steps:

```python
window = []
for _ in range(24):
    yield 1.0
    now = patch(0.5, 0.5, 0.46, 0.44)
    if now is None:
        continue
    window.append(now["luma"])
    if len(window) > 3:
        window.pop(0)
    if len(window) == 3 and (max(window) - min(window)) < 0.004:
        return
# Fell through: trim NOTHING. The rung's own two-read spread then carries the damage into the noise
# gate and voids the run, instead of a tidy number taken from the tail of an arrival that never happened.
```

Steps compound — three of 0.0039 walk the window 0.0117 while every adjacent pair passes — and both the
pair test and the three-step test return early on `[200, 60, 66, 61, 50, 49, 48.5]`. A window spread
assumes nothing about direction, rate or shape.

**Take two reads of every rung and gate on their spread before reading any value.** A gate should report
its own noise first: the traversal harness measured one route at 230, 0, 35.2 and 86.0 in a single
session and every conclusion drawn from it came from a single draw of a distribution nobody had checked.

## Two more that are not about waiting

**Read the value, do not infer it.** A cvar's value is something to read back from the engine. Inferring
`PracticalRadius ≈ 4200` from a downstream lit count fitted the data beautifully and was false — the
readback said 12000.0, the declared default. Same family: a docstring read for behaviour (the
`PracticalCount` help string described a sort two commits after it changed), a p95 taken off
`GetFrameCostMs` (the filtered half of `FStatUnitData`, peaks already removed), and a mean standing in
for a distribution (C_GROUND passed dusk at mean 0.0673 while 78.9% of the same ground was crushed).

**When an accessor will not answer, measure what the value DRIVES.** Two subsystem routes for `Nightfall`
returned nothing on two builds, so the gate failed twice for want of an instrument rather than for want
of a fix. `MoonLux` is linear in `Nightfall` and `Nightfall` is exactly 1.0 at 23:00 — so the moon's
intensity divided by its 23:00 value *is* `Nightfall`, read off the light the curve actually drives.

**A look-at point is not a standing position.** `(0, -1460)` is the Golden Arrival monument, which four
jobs aimed a camera at from 500 uu away. Standing the pawn on it put the camera against lit stone and
read luma 0.6917 at night, brighter than noon. Stand at `(-320, -1900)`.

## The instrument answered a question next to the one asked (2026-09-27, internal lane)

Four of these cost a run each today. They share a shape with the settle traps above: the reading is steady,
plausible and about something else.

| The trap | What it looks like | What detects it |
| --- | --- | --- |
| `stat unit`'s fields are SMOOTHED | a p95 and a median that agree; a hitch that never appears | read `GetRawFrameCostMs`, not `GetFrameCostMs`, for anything about extremes |
| `editor_play_simulate` instead of `editor_request_begin_play` | every capture identical; `pose_camera` has no effect | hash the captures and require them to DIFFER |
| a clause whose failure condition is a non-empty list | PASS on a run that measured nothing | require a measurement for every subject the clause clears |
| a bound derived for one quantity, applied to a clipped one | a sound derivation that fails the thing it should pass | check the quantity can actually MOVE by the amount the derivation assumes |

**`FStatUnitData` keeps two parallel sets of fields and its own comment names them.** The block holding
`FrameTime` is "unit frame times filtered with a simple running average"; the block below is the "raw
equivalents". The filter is `FrameTime = 0.9 * FrameTime + 0.1 * RawFrameTime`, applied identically to game,
render and GPU — a ten-frame exponential average, which the engine's own performance snapshot assigns to a
variable called `AverageFrameTime`. A one-frame 200 ms spike arrives as 15 ms. Medians off the filtered field
are honest; every p95, worst case and hitch taken from it is a percentile of a curve with its peaks removed.
`zc_avatar_hitch` existed to measure hitches and read the filtered field for all eleven of its extremes.

**A frame counter advancing is not enough: the STAT has to advance too.** `FStatUnitData` only updates while
the overlay is drawing. When it stops, every field keeps its last value while `GFrameCounter` carries on, so a
reading deduped on the frame number is accepted as new and is the previous frame's number. Eight
byte-identical *raw* reads across advancing frames means the overlay, not a steady world. Re-issue `stat unit`
inside every sampling loop, not just the one that always did.

**Count FRAMES, not READS.** A loop polling a per-frame stat gets several reads inside one frame and none
inside the next, so percentiles come out weighted by how often Python happened to run. One ladder reported 253
"samples" whose median, p95 and worst agreed to the hundredth.

**In simulate mode there is no player camera.** `pose_camera` poses nothing, the viewport keeps showing the
editor's own fixed view, and the captures are a photograph of the editor. Thirty of them came back on one md5
while the skins, the hour and the camera all changed. `zc_beam_geom` carries a comment saying this after
hitting it first; reading the neighbouring jobs would have been cheaper than the run.

**A clause that fails on a non-empty list passes hardest when the list cannot be built.** "No other skin merges
its eyes" reported PASS over a run that had photographed nothing, because nothing could be flagged. Its two
neighbours failed honestly on the same empty data, because they asked `isinstance(v, float) and v <= bound` —
the guard was a habit rather than a decision. Make it a decision.

**A derivation is not safer than a guess if it is applied to the wrong quantity.** An eye-to-world ratio was
built on `light_mean`, and its bound derived from the eye glow falling 24 to 8 across the crossover: a factor of
three, so the ratio should fall by two. `light_mean` averages only cells already above 0.72 of full white,
whose luma is bounded at 1.0, so it sits near 0.9 whatever the emissive does. The entire measured movement was
the *world* term. A sound derivation applied to a clipped number survives scrutiny of the reasoning, which
makes it worse than a wrong one.

**And a reading with no place attached is a true sentence about nowhere.** A night-body job reported the mascot
97 per cent crushed and never recorded where the mascot stood; the world lane read the same district and hour
four times brighter, because their patch had nobody standing on it. Record the subject's position, and the
distance to the nearest thing that could explain a good result.

## A method carries its assumptions with it

Max-per-column finds a small bright thing on a DARK subject. Carried unchanged to a WHITE one it
saturates: the other lane's eye-gap profile took the brightest pixel per column across Relay OG's head,
the head is white, every column returned about 0.999, and the profile was flat. The instrument reported
"no gap between the eyes" while a 4x crop of the same capture showed two clearly separated glowing eyes
with a black visor between them. The method had been correct on the night-body job, where the subject
really is dark, and the assumption did not travel with it.

**Chroma — max channel minus min channel — separates all three by construction**: white head near zero,
black visor near zero, coloured glow high whatever its hue. On the five captures already on disk, luma
gave 0.946 / 0.949 / 1.000 / 1.000 / 0.962 and chroma gave 0.094 / 0.333 / 0.452 / 0.733 / 0.252.

Two rules follow, and the second is the cheaper one:

- **Before reusing a measurement technique, name the property of the subject it relies on** and check
  the new subject has it. Bright-on-dark, dark-on-bright, centred-in-frame, monotone-approach.
- **Validate a new method against captures you already have** before spending a run on it. That is free
  and it caught this on the sixth version.

The same job also split its window at the midpoint and took the max of each half, which assumes the face
is centred. The head sat at 0.44, so both halves peaked inside the same eye and every column "between
the peaks" was eye.

## Prove the instrument can detect the thing before trusting it to say the thing is absent

A null result from an instrument that has never been shown to register a positive is not evidence.
`zc_dusk_cause` tests whether the moon's brightness reaches the ground at dusk, where the claim is that
it cannot — so it first removes the moon at 23:00, where it certainly does, and **voids the entire run**
if that makes no difference. Failing the positive control is not a red clause beside the others; it means
nothing else in the run may be read.

Same shape as validating a method against known data, one level up: there, you check the method on a case
whose answer you know; here, you check the instrument on a case whose answer you know.

## A ratio is only a measurement if its two halves can move apart (2026-09-27, internal lane)

Two of the day's wrong numbers were RATIOS rather than readings, and both survived scrutiny of the reasoning
because the arithmetic was sound and the quantity underneath it could not vary.

**`light_mean` over world brightness.** The bound was derived from the eye glow falling 24 to 8 across the
crossover: a factor of three, so the ratio should fall by two. `light_mean` averages only cells already above
0.72 of full white, whose luma is bounded at 1.0, so it sits near 0.9 whatever the emissive does. The entire
measured movement was the world term. A sound derivation applied to a clipped number is worse than a wrong
one, because the reasoning holds up when you check it.

**Trough over peak on a flat profile.** Skeleton Flame's eye profile came back with peaks of 0.1843 and 0.1843
and a trough of 0.1804, giving 0.979 — read as "the two eyes are one mass". The photograph shows two eyes with
a clear black gap. The band was uniformly at one chroma because the skin's ghostfire covers the head, so the
numerator and the denominator were the same number wearing two names.

Before publishing a ratio, ask what its numerator would read if the thing being measured were absent, and what
its denominator would read if the thing were at maximum. If either answer is "about the same", the ratio is
describing something else. The cheap guards are an absolute CONTRAST floor beside every relative one, and a
positive control: a case where the effect is known to be present, which must register or the run voids.

## Max-per-column carries an assumption about the subject

`max` down a column finds a small bright thing on a DARK subject. Relay OG's head is WHITE, so every column in
the eye band returned about 0.999 and the profile was flat — it was measuring the head and reporting it as the
eyes. The same function was correct in the night-body job, where the subject is dark, and the assumption did
not travel with it.

CHROMA — max channel minus min channel — separates a neutral white head, a black visor and a coloured glow by
construction, for warm gold and spectral cyan alike. Across five skins, luma gave 0.946 / 0.949 / 1.000 /
1.000 / 0.962 and chroma gave 0.094 / 0.333 / 0.452 / 0.733 / 0.252.

It has its own limits, and they are gated rather than hidden: eyes too close to white to have chroma, a band
whose chroma is uniform, and peaks that do not straddle the head's centre. Each returns UNMEASURABLE.

**And validate a new method against captures already on disk before spending a run on it.** It is free, and it
is what finally broke a cycle of six unvalidated versions of one profile.

## A ratio is only a measurement if its numerator and denominator measure different things

The other lane's eye-gap clause reported trough-over-peak. On a FLAT profile both are the same number
wearing two names, so 0.979 read as "the eyes are one mass" while the photograph showed two eyes with a
clear black gap. Skeleton Flame's whole head is covered in cyan ghostfire, so the eyes are not separable
from their SURROUNDINGS by colour while being obviously separable from EACH OTHER — the ratio was
describing the flatness of the profile, not the eyes.

Same family as a derivation applied to a clipped quantity: something that cannot move, dressed as a
variable. When a ratio can go to 1 for a reason that has nothing to do with the thing being measured, it
needs a companion clause that detects that reason and returns **UNMEASURABLE** rather than a number.

Their three companions: a chroma floor, an absolute peak-to-trough CONTRAST floor, and a
peaks-straddle-the-centre check (Apollo's two "eyes" sat hard against one edge of the window, on its gold
crown — a pair of eyes straddles the head's centre, so two peaks bunched at one edge are some other
bright thing and the ratio between them means nothing).

## A threshold statistic is not comparable across regimes

`readable` — the share of ground above luma 0.14 — is the right ACCEPTANCE reading, because "can a walker
see the ground" is exactly a threshold question. It is the wrong reading for comparing step SIZES between
places. Near the threshold a thousandth of luma moves several per cent of the fraction; far from it the
same thousandth moves nothing, so "which region has the biggest step" gets answered by where each region
happens to sit relative to 0.14 rather than by the world.

Gate acceptance on the fraction. Detect and compare changes on the continuous quantity, and report the
fraction beside it so the amplification is visible. The same rule voided a run: a frame-luma spread of
0.0010 with a readable-fraction spread of 0.0107 is one instrument behaving well, not two disagreeing.

## Zero is a value, `or` cannot tell it from absence

`(offset or 9e9) > 500` reported a pawn that landed at offset **exactly 0.0** — a perfect placement — as
more than 5 m away, and voided a run in which all three vantages were valid. Write `x is None or x > 500`.
Distinguish three states explicitly: dead subject, empty sample, and a valid zero result.

## When you find a defect, ask what the SET is before fixing the instance

Five times in one day, across two lanes, the fix was applied to the cases in front of us and the set was
never enumerated:

- Eight jobs implement a settle. Seven were converted to the window spread; `zc_water_audit` still had
  the original pair test, untouched all day, in the one file neither lane had reason to open.
- The eye-halo fault had three sites — the gameplay Dog's rings, the costume eye pane, the cub ghost
  pane. The third was only found because the water-audit story prompted a search.
- `zc_territories` had six clauses missing a count, while `T10` **twenty lines above them** already had
  the right pattern.
- A predicate wait was used for BeginPlay at the top of a file and a hand-rolled sleep for the harder
  case twenty lines below it.
- A neighbouring job carried "PLAY, NOT SIMULATE" in a comment; the next job written hit the same trap.

The cheap move is a grep, and it is cheaper than the run that finds the eighth case:

```bash
# how many jobs do the thing at all, and how many do it the fixed way?
grep -rln "def settled" zc_*.py | wc -l
grep -rln "max(window) - min(window)" zc_*.py | wc -l   # the difference is the backlog
```

When those two numbers differ, the difference is a list, not a rounding error. And check the file you
just edited for a neighbour that already solved it — three of the five above were sitting in the same
file as their own answer.

## Known exposed gates — OPEN BACKLOG, not cleared

These `all()` clauses walk a collection whose only upstream protection is a SUBJECT check
(`if start is None`, `if terr is None`). That catches a missing subsystem, not an empty result: a walk
can begin from a perfectly valid start and append nothing. `Tools/find_vacuous_gates.py` does not flag
them, because its axis 3 accepts any early return — which means these are **argued safe, not shown
safe**, and the script's own docstring says so.

None is in the current loop. Repair when the job is next touched; do not treat the scan's silence as a
clean bill.

| job | clauses |
|---|---|
| `zc_walk_after_wp.py` | K01, K02, K03 |
| `zc_streaming_floor.py` | R01, R03 |
| `zc_checkpoints.py` | K06, K07 |
| `zc_beta_walk.py` | W02, W06 |
| `zc_beta_perf.py` | F02 |
| `zc_avatar_hitch.py` | H00 |
| `zc_avatar_ladder.py` | A04 |

Repaired already, for contrast: `zc_tile46` T00, `zc_floor_after_wp` F02, and `zc_territories` T11/T21/
T22/T23/T31/T32 — the last six against `len(rows)`, the pattern T10 in that same file already used.
