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

## An hour is a request to a running clock, not a setting (2026-09-27, internal lane)

`wl.Sky.DayMinutes` defaults to **24.0**: a whole Wonderland day every twenty-four REAL minutes, so one game
hour passes every real minute. A job that sets `wl.Sky.Hour` and then takes several photographs has a sky that
walks on between the request and the shutter, and again between every shot.

Two jobs photographed "night" **brighter** than "day" — mean frame luma 0.2583 against 0.2250 at the same view
— and every per-hour number they produced was void, including a clause that PASSED and was reported to the
founder.

**Issue `wl.Sky.DayMinutes 0` first, read it back, and VOID if it is running.** Re-issue the hour before every
capture rather than once per block.

**And carry a positive control for the hour itself.** If a job compares a night reading with a day one, noon's
subject must measure clearly brighter than midnight's, or the run voids — otherwise every clause in it is
comparing one lighting condition with itself, and some of them will pass.

The set was enumerated rather than remembered, and the grep took ten seconds:

```sh
for f in $(grep -rl "wl.Sky.Hour" Tools/editor_jobs/*.py); do
  [ "$(grep -c 'wl.Sky.DayMinutes' "$f")" = 0 ] && echo "CLOCK RUNNING: $f"
done
```

Eighty jobs set the hour; seventy-eight stopped the clock. The two that did not were both written the same
day, and reading would not have found the second — nobody was looking at that file.

## Crop the capture and look at it

The clock bug was found by enlarging one frame, not by reading a number. The picture showed a bright cyan sky
on a shot labelled night, a camera close enough to fill the frame with the chest, and HUD keycaps along the
bottom — three faults at once, none of which any clause was asking about.

A region expressed as a fraction of the FRAME is only meaningful if the framing is verified, and a job that
never looks at its own captures cannot verify it. Where a widget can report its own geometry — the wardrobe's
`GetSkinPreviewRect` — take the region from that and never from a fraction of the screen.

## If every subject measures IDENTICALLY, the instrument is measuring something they share

The other lane's stance profiler was aimed at a widget's chrome instead of the figure inside it, so all
five skins returned the same numbers — the frame, measured five times. A guard that fails when the
subjects are indistinguishable caught it on the first run, in a completely different place from the one
it was written for.

This tree already knew the shape: *flat on both sides means a broken instrument*. Same rule, stated
positively — if a measurement cannot tell five different things apart, it is not measuring them.

```python
vals = [round(v, 4) for v in readings.values()]
record("X_DISTINCT", "the subjects are distinguishable, so this is measuring them and not their frame",
       len(readings) > 1 and len(set(vals)) > 1,
       readings=readings,
       note="identical values across different subjects means the instrument found something they "
            "share — the window, the background, the chrome — rather than the thing being compared")
```

Cheap, and it fires in places nobody predicted.

## An answer the engine states exactly beats any amount of measurement

Seven versions of a pixel-based stance profiler measured a market stall, a street lamp, drapery, an
edge common to all five skins, and twice the widget's own frame — before the seventh worked and showed
the question is unanswerable from silhouettes at all, because every costume changes what touches the
ground. The Dog publishes a canonical worn pose and each costume has joint writers for it, so "does
every skin receive the same pose" is an *exact* question the engine will answer.

It had been ruled out on day one by over-reading "fix the cause, not cosmetic offsets" as forbidding
*reading* the pose, when it forbids *fixing* the problem with offsets.

Before building a measurement, ask what the engine already knows:

```bash
grep -rn "UFUNCTION(BlueprintPure\|UFUNCTION(BlueprintCallable" ../../Source/Wonderland/*.h | grep -i "<thing>"
```

And if the accessor exists but Python cannot reach it, the answer is a `UBlueprintFunctionLibrary`
static — **not** a fourth guess at a subsystem getter. UE 5.8's Python has no world-subsystem getter of
any kind; that cost four attempts, a wrong root cause relayed to a third lane, and two `EVIDENCE ONLY`
gates.

## Before measuring pixels, ask whether the engine already publishes the answer

Seven versions of two jobs tried to decide, from a rendered frame, whether each mascot skin stands the way
Relay OG stands. They failed seven distinct ways — a fixed band profiled a market stall, a brightest-row
search found street lamps, raw column lists could not be compared and "could not compare" was reported as
"differs", a silhouette measured drapery, feet found by differencing measured an edge shared by all five
skins because hiding the subject also hides UI attached to it, and the preview rect turned out to include the
widget's chrome so every figure box was the frame.

The seventh works, and its finding is that the question cannot be answered that way at all: every costume
changes what touches the ground, so a robe's hem is not a foot.

**The Dog had been publishing the answer the whole time.** `GetCanonicalWornPose` is `BlueprintPure` and
returns the pose built this frame; the costume's `GetWornPose` returns what it is wearing. "Is one canonical
stack driving every skin" is a field-by-field comparison of two structs, not a photograph.

The same shape appeared in the world lane on the same evening: `DescribePracticalLights` already reported the
engine's own count of lit lamps, and three attempts inferred it from spawned actors instead, producing a
confident and false theory about the light radius.

**A photograph is for what only an eye can judge — does it look right.** For anything the engine computes,
read the value and use the picture to confirm the value agrees.

### And do not let a brief about FIXING become a rule about MEASURING

The instruction was "fix the skeleton/AnimBP/retarget/root-pose cause, not cosmetic offsets". That forbids
fixing the problem with offsets. It was read as forbidding the pose to be READ, which is a different sentence,
and that misreading cost the evening. When a constraint seems to rule out the cheap measurement, re-read it:
it is usually about the remedy, not the instrument.

## Put the skin back, and read it back

Seventy-six jobs in this tree wear a Relay Dog skin. About fifty never restore Relay OG afterwards.

That cost another lane a whole acceptance attempt's photographs: a job wore five skins, restored none, and
Celestial Light was standing in the world nine minutes later when they captured — a large teal crystal form
in every frame, which they had to ask about. It invalidated none of their clauses, which read widget state,
but it would have reached the founder in a screenshot as an unexplained object.

Every render knob in this tree already follows the rule that a job leaving a knob changed makes every later
measurement a reading of that job. The SKIN is the most visible piece of state in the world and is the one
place the rule was not applied.

```python
ui.wear_relay_skin("relay_og")
yield 3.0
worn = str(dog.get_worn_skin_id())      # a restore that silently failed is the same as no restore
record("X", "Relay OG went back", "relay_og" in worn.lower(), worn_after_restore=worn)
```

```sh
for f in Tools/editor_jobs/*.py; do
  grep -q wear_relay_skin "$f" && ! grep -q 'wear_relay_skin("relay_og")' "$f" && echo "NO RESTORE: $f"
done
```

## A control that fails is worth more than the clauses it invalidates

Three times in one evening a positive control turned a confident pass into a known unknown.

- Every mascot skin reported the canonical gait pose, field for field, exactly. The control said the Dog's
  stride phase had moved **0.0000** across six samples — it was standing still, a gait pose at rest is a
  constant, and two frozen structs agree perfectly.
- Five costumes measured the identical stance to four decimals. The control said all five figure boxes were
  the same pixel size, which is the widget's frame and not a figure.
- A day-versus-night comparison passed a clause about feet. The control said night photographed *brighter*
  than day, because the sky clock was running.

Each control cost one extra clause to write. Each caught a failure whose natural signature is a **pass**.
Build the control before the measurement, and make it VOID the run rather than sit as one red beside the
greens — a null from an instrument never shown to register a positive is not evidence of anything.

## Record WHERE the subject was, in every row — this one caused four wrong mechanisms in a day

More measurements went wrong this way than any other cause, and each time the wrong reading looked
fine and produced a confident explanation before anyone doubted it:

| reading | what was wrong | what it produced |
|---|---|---|
| mascot 97% crushed at night | the job never recorded where the mascot stood | a true sentence about an unknown place, relayed as evidence about the world |
| dusk ground 0.69 luma at 19:00 | the camera stood on the monument it had always aimed at | "brighter than noon, in the dark" |
| three-region ladder | the pawn respawned 153 km away mid-run | a region silently dropped |
| light-budget ladder | the pawn **alternated** between two districts between rungs | the "31s", a phantom plateau at 127, and a confident inference that the radius was 4,200 when it reads 12,000 |

The last one is the clearest. Placed once, gated once, never watched again. Once each reading was
matched to where the pawn *actually* was, all five rungs fitted `Lit = Min(Near, Pool)` exactly and
there was no anomaly at all — the engine had been correct the whole time and a convergence gate had been
built for a phenomenon that was a teleport.

**A reading whose subject's position is unrecorded is not a measurement.** Put the position in the ROW,
not just in a setup gate, and re-assert it per rung rather than trusting a placement to hold:

```python
pnow = unreal.GameplayStatics.get_player_pawn(live(), 0)
here = None if pnow is None else pnow.get_actor_location()
row["subject_at"] = None if here is None else [round(here.x, 1), round(here.y, 1), round(here.z, 1)]
row["drift_uu"]  = None if here is None else round(math.hypot(here.x - SPOT[0], here.y - SPOT[1]), 1)
# ...and a gate, because a recorded drift nobody reads is the same as no record
record("X_STILL", "the subject is at the measurement spot at EVERY rung, not just when it was placed",
       all(r["drift_uu"] is not None and r["drift_uu"] <= 500.0 for r in rows), ...)
```

This applies to anything with a position: the pawn, the camera, a figure, a light. If `Assign()`,
a capture, or a trace reads it, the row records it.

## `stat unit` is a TOGGLE — issuing it "to keep it alive" turns it off

The engine binds it to `UEngine::ToggleStatUnit`, so **every call flips the overlay**, and
`FStatUnitData` only advances while the overlay draws. Jobs that re-issued it per rung or per window
"in case it froze" were switching the instrument off half the time — a fault the frozen-counter guard
then faithfully detected. The other lane found it in six of their jobs; seven of these issue it more
than once or issue it inside a loop.

Issuing once is **not** the fix: that assumes it started off, and a previous job may have left it on.
Flip at most twice and verify the raw counter actually moves between two rendered frames:

```bash
# the set: anything issuing it more than once, or inside a loop
grep -c '"stat unit"' zc_*.py | grep -v ':1$'
```

**OPEN BACKLOG** — still toggling, none in the current loop: `zc_beta_perf` (5), `zc_avatar_cost` (3),
`zc_nav_cost` (2), and `zc_avatar_ladder`, `zc_nav_invoker`, `zc_night_ladder` (one each, **in a loop**).
Fixed: `zc_practical_budget`.

## The panel is not the world — photograph the asset where the founder judges it before changing it

Skeleton Flame looked white in the Wardrobe. The founder's own correction says the spectral blue/cyan
sections are approved and must be preserved, so "it is white" pointed straight at the skin, and the
generator was one edit away from being changed.

The same costume, the same build, measured two ways on 2026-09-27:

| | blue-dominant | fully blown | zero-chroma |
|---|---|---|---|
| in-world (differenced against a figure-hidden control) | 0.837 | **0.000** | 0.117 |
| wardrobe preview | 0.074 | **0.355** | 0.871 |

The skin is blue and the **panel** does not show it. That difference is measured and stands.

**WHY it does not is NOT established, and the earlier explanation here was withdrawn on 2026-09-27.** This
section previously said the stage over-exposes, and named the same over-exposure as the cause of two item 1
clauses on Apollo and a suspect for item 6's C07. That was inferred from a `PreviewGlow` sweep in which
five rungs produced five identical pictures — and the sweep could not move the term at all, because
`IsNearlyEqual(GlowScale, Wanted, 0.001f)` guards a knob that ships at 0.001, so every value it tried was
silently dropped. See "Verifying the INPUT is not verifying the effect" below.

Keep the measured difference; do not carry the cause. The Apollo and C07 readings are unexplained again
rather than attributed.

**Before editing an approved asset because it looks wrong somewhere, measure it somewhere else.** If the
two disagree, the renderer between them is the subject, not the asset — and then find out WHICH part of
the renderer, with a knob you have shown can move.

## A window shorter than the subject's slowest period is a coin toss, not a measurement

`zc_snake_follow` Y01 read front 227, behind 1 of 240 and looked like a flat product defect. The yaw walk's
slowest term has a period of **54.8 seconds** and the window was **24**. Simulating the shipped steering
maths over forty separate 24-second looks puts the median "behind" at 0.288 and finds one look in forty with
none at all: the same code answers differently depending only on when you started watching.

Worse, `Elapsed` is not wall time — `Tick` clamps `DeltaSeconds` to 0.25 and spends it in 1/120 substeps, so
a loaded PIE session runs the animal in slow motion, and a capture run is exactly when the machine is loaded.

Two rules fall out, and the second is the one that generalises:

- Find the subject's slowest driver and make the window several multiples of it.
- **Add a progression control**: the subject must demonstrably travel before coverage is read. Y00 now
  requires the head to turn twice around the brain and VOIDs below that, because "does not go behind" and
  "was watched in slow motion" look identical from the front and want opposite fixes.

## `app_active` is a precondition for every pointer click — a run without focus reads as a product defect

`zc_nav_click_cause` first reported all five nav tiles failing **and** its own wallet control failing: on its
face, "pointer clicks are broken". The subsystem's own diagnosis said why:

```
pointing 0
app_active 0
```

Slate does not route pointer events into an inactive application. The editor had lost OS focus — this session
runs shell commands on the same machine between steps — so the run measured the focus state, not the click
path, and every clause under it was void rather than failing.

The earlier `zzAP1_hud_proof` had `app_active 1`, `pointing 1`, and there the wallet completed while every
tile failed. That is the real question, and a focus-less run cannot answer it.

So: **take focus before every click, read `app_active` back, and VOID when it is 0.** A wall of failures is
the most convincing possible disguise for an instrument that was not plugged in. Note also what this does NOT
excuse — the wiring clause passed in the same void run (all five tiles increment and their surfaces open via
`SimulateNavTileClick`), and a passing clause in a run whose control failed is worth keeping only because it
never depended on the pointer at all.

## Verifying the INPUT is not verifying the effect — even with a passing readback

The strongest version of "instrument the output, not the input", because here the input check **passed
every time and was honest**.

The other lane swept `wl.Look.PreviewGlow` and read the cvar back after every rung. It had always taken
the value. Five rungs produced five identical pictures, which read as "this term contributes nothing".
The term was refusing the values:

```cpp
if (FMath::IsNearlyEqual(GlowScale, Wanted, 0.001f)) { return; }   // and the knob ships at 0.001
```

**A fixed tolerance can be the entire working range of the knob it guards.** Every value from 0.0 to
0.002 is "nearly equal" to the shipped 0.001 and silently dropped — including the sweep's own control,
"turn it off entirely", which never turned anything off.

So a verified input, a real cvar, a passing gate, and no connection to the output at all. Two checks are
needed and they are different questions:

```bash
# does any early-out compare a knob against a tolerance of the same order as its shipped value?
grep -n "IsNearlyEqual" ../../Source/Wonderland/*.cpp
grep -n "^static float GWonderland.* = " ../../Source/Wonderland/*.cpp
```

Audited in this lane after it was reported: the only such guard is
`IsNearlyEqual(Night, LastNight, 0.002f) && IsNearlyEqual(PracticalGain, LastGain, 0.001f)` — 0.2% and
0.1% of their respective ranges, so no knob here is being swallowed. Checked, not assumed.

**And the sweep's control is the thing to verify hardest.** If "off" and "on" produce the same picture,
suspect the switch before the subject — the zero end of a sweep is exactly where a tolerance guard bites.

## "handled" is not "happened" — name the widget, not the return value

Item 7's six failing clauses all rest on a nav tile click that does not register. Three successive runs read
this line as proof the press landed:

```
WLUI pointer click on brain at (955, 1034): under the point 1, down 1, up 1
```

`down 1` is `RoutePointerDownEvent(...).IsEventHandled()`. It says SOMETHING in a 57-deep path handled the
press. It does not name what, and `SButton::OnMouseButtonUp` returns Handled whether or not it ever reaches
the OnClicked delegate — so `up 1` is compatible with no click at all.

Each probe added killed a hypothesis and none of them was the cause:

| probe | answer | what it ruled out |
|---|---|---|
| `app_active` | 1 | Slate refusing to route into a background app |
| captor after the down | the target's **own** `SButton` | capture theft, window stacking, the viewport |
| point inside target geometry | 1 | render transform / DPI mismatch |
| `SimulateNavTileClick` | increments **and** opens the surface | the handler, counter, Id mapping, navigation |

The wallet's `SButton` completes through the identical routing, in the same run, with identical probe
answers. So the two are indistinguishable on every condition measured and differ only in outcome.

Two further asymmetries were chased and are also dead, recorded so nobody spends the time again:

- **The delegate binding form.** The tile uses `.OnClicked(this, &Method, Index)` and the wallet a lambda —
  but `SimulateNavTileClick` fires that same delegate and both increments the counter and opens the surface,
  so the binding is live and correct. The delegate is reached; the path to reaching it is not.
- **The strip's `Pointing` attribute.** The nav bar takes one and the wallet does not, and `BeginPointing()`
  flips it at the start of every nav click — a promising way to invalidate a press mid-click. It drives only
  `ColorAndOpacity`. A tint cannot change layout, visibility or hit-testability.

The rule that generalises: **a boolean return from a routing call names nothing.** When a click, a message or
an event "was handled" but nothing happened, log the identity of whatever handled it before forming any
hypothesis — three runs of diagnosis here rested on an inference from a bool that could not carry it.

## A negative result survives a machine under load; a positive one may not

A peer warned that two of my runs overlapped a window with 0.6 GB free of 15.7 GB, and asked whether the
readings could be artefacts. Worth taking seriously, and worth being precise about rather than waving away:

The reading was "eight stops of exposure bias change nothing" — luma 0.5014 / 0.4837 / 0.5074 / 0.4831 /
0.5129 across a 256x change. **Paging can manufacture a change; it cannot erase a monotone trend from a
ladder.** A stall would have added noise on top of the trend, not flattened one that was there.

The inverse is not true. Had the ladder shown a clean descent, memory pressure would have been a live
alternative explanation and the run would have needed repeating on a quiet machine. So: when a run overlaps
a degraded machine, ask which DIRECTION the degradation pushes. Noise-shaped faults invalidate positive
findings far more readily than negative ones.

## Before calling a click failure a product defect, ask whose click it was

Item 7's six red clauses all read as "the HUD buttons do not work". They do not establish that, and the
distinction matters more than the diagnosis:

- `SimulateNavTileClick` increments the counter **and opens the surface** for all five tiles. The button, its
  handler, the counter, the Id mapping and the navigation all work end to end.
- What fails is a *synthetic* pointer click — Slate events this harness fabricates and routes itself. A
  person clicking the strip generates real OS input that never goes near that code.

So the six failures may be entirely a limitation of the test harness, with the product fine. They may also be
a real defect that the harness happens to expose. **Nothing measured so far separates those two**, and
reporting either one as settled would be a guess.

The cheap discriminator is not another probe: it is one human clicking BRAIN in a running editor. Until then
the honest statement is "the buttons are wired correctly and the automated pointer route cannot complete a
click on them", not "the buttons are broken".

General form: **a synthetic-input harness that fails is evidence about the harness until something rules the
harness out.** The four probes that eliminated capture theft, window stacking, app focus and geometry
mismatch all narrowed *where* the synthetic click dies; none of them showed a real click would die there too.

## "Night is darker than day" is false for emissive subjects — the bar is 19.6%

`AutoExposureBias` is `Lerp(1.45f, -0.9f, Daylight)`: **−0.9 EV at noon, +1.45 at night**. That is
2.35 EV, a factor of **5.10**. So:

> **Any surface retaining more than 19.6% of its noon LUMINANCE reads brighter at night.**

An emissive surface does not dim when the sun sets — it keeps 100% — so it clears that bar five times
over. This is why `ScaleGlowsForNight` exists, and a luminous skin reading above 1.0 night-over-noon is
that compensation being present but incomplete, not a lighting defect.

Measured on 2026-09-27, all after the Nightfall complement landed:

| subject | night / noon | glow geometry | provenance |
|---|---|---|---|
| world ground | **0.596** | — | one job, one camera, one vantage |
| Relay OG (matte mascot) | **0.545** | none | **same run, same spot, same pose as the row below** |
| Skeleton Flame | **1.357** | 83% | **same run, same spot, same pose as the row above** |
| Arden Infernal | 1.360 | 45% | earlier run, recorded before any of the night work |

The matte control and the emissive subject were measured **in one run at one spot**, which is what makes
this a comparison rather than two readings. They land either side of the 19.6% line: 0.545 and 1.357.
The world ground agrees with the matte figure at 0.596. **The variable is the subject's own emission,
not the world** — and Arden read 1.360 before any of the night work, so this was never a regression.

An earlier cross-job figure of 0.625 for Relay OG pointed at the same conclusion and was discarded
rather than used, because it came from a different job at a different place. A number that agrees with
you is exactly the one to check the provenance of.

When a day/night ratio surprises you, check whether the subject emits before checking whether the world
changed. And measure the control **in the same job at the same spot**: a matte subject beside the
luminous one settles it in one rung, where a cross-job comparison produced a four-hour phantom decline
earlier the same day.

## A gate that passed may have been wrong all along and merely dim

The other lane's day-versus-night control compared a mostly-emissive skin at noon against the same skin
at midnight. Given the 19.6% threshold above, **that control could never have worked** — it was asking
an emissive subject to prove the sun had gone down, which it cannot do at any hour, in any build,
however correct the clock is.

It had been passing. It only started *failing* when the glow got bright enough to show it.

> **The version that passed was not more correct than the version that voided. It was just dimmer.**

So a green history is not evidence a clause is sound. It is evidence the clause has not yet met the
input that exposes it, and a value moving somewhere else in the project is enough to change that.

**The specific form to hunt: a clause whose PASS means "this term does not matter".** It passes both
when the term genuinely does not matter and when the term was never given a chance to. `X_COSINE`
asserts the moon's brightness does not reach the dusk ground — and would have passed, falsely
confirming the account it was written to kill, if `MoonGain` had been small for some unrelated reason.

So every such clause needs a companion proving the term COULD have mattered:

```python
# the term is allowed to be irrelevant; it is not allowed to be untested
record("X_SWITCH", "the knob actually changes the picture somewhere, so the arm is live",
       max(effects) > max(4.0 * noise, 0.005), arm_effects=effects, knob_as_found=found,
       note="a dead switch and an irrelevant term produce the same null")
```

That is the same rule as verifying a sweep's control, one level up: **a negative result is only evidence
if the positive case was reachable.**

## A band down "the figure" that is a fraction of the FRAME measures whatever is at that fraction

`zc_skeleton_parts` has been answering two of the founder's Skeleton Flame questions — do the black leg parts
glow, is the skull still black — since it was written. Its region boxes were fractions of the frame:

```python
"skull": (0.40, 0.23, 0.60, 0.33),
"legs":  (0.40, 0.64, 0.60, 0.74),
```

Drawn onto one of its own captures and looked at: **the "skull" box contained only cyan tailfire with no
skull in it, the "torso" box contained a wing, and the "legs" and "feet" boxes were both on the torso.** The
head was not inside any box. So S02 was comparing a wing against a chest plate, and S03 was asking whether a
wing was darker than a chest plate. Both failed; neither failure meant anything.

The job could not have been right even in principle: it photographs at 260 uu **and** 900 uu, so the figure's
on-screen height changes by a factor of three between two of its own views, against one set of fixed
fractions.

**Find the subject before measuring it.** The fix is one background plate per pose with the Dog *and its
costume* hidden — `set_actor_hidden_in_game` hides an actor's own components, and the skin is a separate
attached actor, so hiding only the Dog leaves the mascot standing in the plate — then the figure's box is the
difference, and the bands are fractions of *that*. One plate per pose, not per hour: the camera depends only
on the pose and the Dog does not move.

When the plate is missing the code falls back to frame fractions **and says so in the result**, so a run
without one degrades visibly instead of silently returning the old wrong numbers.

## Check the subject is IN THE PICTURE before arguing about which band of it you measured

`zc_skeleton_parts` was corrected twice in one evening — first its day-night control (an emissive subject
cannot prove the sun went down), then its region boxes (fractions of the frame, so the "skull" box held only
tailfire). Both were real. Neither was the reason it could not answer the founder's question. Looking at its
own captures:

- **Close view, 260 uu:** the legs and feet are **not in frame**. The camera sits 30 uu above the look-at
  point at three metres and photographs the tailfire and the top of the skull.
- **Gameplay view, 900 uu:** the whole figure is framed — with the HUD's own nav strip drawn across the
  bottom centre, directly over the feet, and two AI Companions standing either side of the Dog.

So both views measured *something* and neither measured legs. Three rounds of fixing how a band was located
inside a picture that never contained the subject.

**Ask "is the thing I am measuring visible in this frame?" before asking "is my box in the right place".**
Cheapest possible check, and it is one crop.

## Prefer the knob that answers the question to the proxy that correlates with it

"Do the black parts glow?" was being asked as *"do they hold their brightness at night better than the torso
does?"* — a day/night ratio in the world. That proxy needed a matte control just to establish the sun had
gone down, and it is weak anyway: the exposure opens 2.35 EV between noon and midnight, so everything holds
more of its daylight value than intuition says.

`wl.Look.PreviewLights 0` removes every lamp from the wardrobe stage. With no incident light in the room,
**anything still visible is emitting its own** — which is not a proxy for "does it glow", it is the
definition. On an isolated figure against a 0.008 black cyclorama, with no HUD over it and no companions
beside it, and where locating the subject is "brighter than the backdrop" instead of segmentation guesswork.

When a question has a direct switch, the ratio that merely correlates with it is not the cheap option. It is
the one that needs a control, a threshold nobody can derive, and a second job to explain its failures.

## The wardrobe figure is SELF-LIT — the stage lamps are a trim, not the light

`wl.Look.PreviewLights 0` sets all three stage lamps to zero intensity, and the cvar reads back 0.0. With
them off, **Relay OG — the one skin in the lineup with no fire of its own — is still 98.2% lit, mean 0.8242.**
Photographed and looked at: a fully visible white figure with glowing gold eyes, not a silhouette.

So the mascot in that preview is not being lit by the lamps in any meaningful sense. They contribute on the
order of 14% (the whole-window luma moved 0.43 → 0.37 when they were switched off); the rest is the figure
emitting. That is consistent with this project's voxel material being emissive-based throughout.

**This is probably the unifying explanation for why so many of that stage's knobs looked dead.**
`PreviewExposure` across eight stops, `PreviewLights` across its whole range, `PreviewGlow` before its
tolerance was fixed — each is a minor term against a dominant one nobody was measuring.

Two consequences worth carrying:

- **The wardrobe cannot tell "glowing" from "lit".** Any question of the form *does this part emit its own
  light* is unanswerable there, because every part does. That question has to be asked in the world.
- **A knob that "does not matter" may simply be small.** Before concluding a term is disconnected, check
  what fraction of the result it is responsible for — turning it fully off and measuring the remainder costs
  one rung and distinguishes "this lever is broken" from "this lever was never the dominant one".

## A band across the figure cannot measure a feature that is small and saturated

Item 6 asks whether SECONDARY colours the Relay Dog's eyes. Two instruments said no, and both were wrong in
the same way.

`zc_mascot_colours` C07 looked for **magenta pixels** after setting SECONDARY to magenta, and found none. But
the channel is applied by MULTIPLICATION, and Relay OG's eyes are warm gold `(1.0, 0.78, 0.16)` — gold times
magenta is **pink**, not magenta, and pink fails a `blue > green × 1.35` test.

`zc_eye_secondary` then measured the eye as a horizontal band at the brightest row — which spans the whole
head, so two small coloured eyes sit in a sea of white bone and black visor and barely move its mean:

| eye level | band says | saturated-pixel measure says | what the capture shows |
|---|---|---|---|
| **14 (shipped)** | moved 0.0059 — dead | **moved 0.444** | vividly pink vs vividly green |
| 1400 | moved 0.0889 — alive | moved 0.230 | blown white with a faint coloured rim |

**The band inverted the answer**, and on the strength of it I was one step from raising a shipped default a
hundredfold — which the captures show would have blown the eyes out, breaking the founder's "individually
readable rather than one blown-out light".

Two rules:

- **Match the locator to the feature.** The eyes are the most *saturated* thing on a bone-white figure behind
  a black visor, so the top few per cent by chroma is exactly them. A mean over a region containing mostly
  something else measures the something else.
- **Look at the picture before changing a shipped value.** The founder's own instruction — *judge from the
  actual rendered mascot, not material values or test variables* — is the check that caught this, and it
  caught it after two separate instruments had agreed with each other.

## Move one channel at a time, or you cannot read them apart

Item 6's proof set PRIMARY and SECONDARY together in one frame and then tried to attribute pixels. It cannot
be done, and the failure is instructive because it produced a **green 9/9 that was measuring the wrong
thing**:

- With PRIMARY driving the whole body to saturated green, the most saturated pixels on the figure are the
  **body**. An eye locator built on chroma then reports the body's colour, and the clause passes on the body
  having changed.
- Restricting the search to the visor does not save it: the visor is black and so is the backdrop around the
  head, so "the dark region in the head area" is a box spanning most of the frame.

The founder's requirement is that the channels be *genuinely independent*, and the direct test of that is to
**move one and check the other did not follow**. Setting both and attributing afterwards is the hard way to
ask an easy question.

So SECONDARY is now also set on its own, against a body left at default white, where the eyes are
unambiguously the most saturated thing and the same locator is sound. Measured that way: the eyes move
**0.4353** and the shell moves **0.0004**.

**A passing clause is not evidence until you know which pixels it read.** This one was green, on a real
feature that genuinely works, for a reason that had nothing to do with what it claimed to measure — which
would have survived indefinitely, because nobody re-examines a pass.

## Five rungs answering to two decimal places is a saturated metric, not five identical subjects

`zc_fire_reach` swept the fire material and gain across five configurations and reported:

```
approved_voxel_glow  reach 98.61   shaped_g60  reach 98.61   shaped_g100 reach 98.61
shaped_g140          reach 98.61   shaped_g180 reach 98.61
```

and its qualifying clause went **green on all four shaped rungs**. Identical to two decimals across a
material change and a threefold gain change is not a finding about fire.

Drawing the measurement band onto a capture and looking showed it immediately: the column's topmost "hot"
pixels were the **Mission Contract strip's own gold text**, sitting in the top of the band in every frame.
The flame's real top was hundreds of pixels lower.

That is the third instrument this evening to measure the HUD instead of its subject — the others put a band
across the nav strip and over the feet. **The HUD is drawn on every in-world capture and it is bright; any
band that reaches the top or the bottom of the frame will find it.**

Two rules:

- **Exclude the HUD zones explicitly, and verify by drawing the band on a frame.** Guessing the fractions is
  what put all three of them there.
- **Add a saturation guard to every ladder**: if the rungs do not differ by more than the noise, VOID instead
  of interpreting. A clause that passes on five identical readings would pass on a disconnected knob, a
  frozen capture, or a band aimed at furniture — and it cannot tell you which.

## `stat unit` issued ONCE is a coin flip — check the numbers move, not the frame counter

The correction to loops that re-issued `stat unit` "to keep it alive" was to issue it once. That is only
right if it started OFF. It is a toggle (`FEngineStatToggle` → `ToggleStatUnit`), so if a previous job in the
session left it on, a single issue turns it **off** — and `FStatUnitData` then returns the same stale numbers
forever.

Observed: six consecutive rungs of one job returning **frame 36.81, render 26.54, game 37.84**, twenty-six
frames each, byte identical — including a Lumen rung that had saved 164.89 ms an hour earlier.

**The existing frozen-stat guard missed it, and the reason matters.** It watched the engine *frame number*,
which was advancing perfectly well the whole time. The frames were live; the *numbers* were frozen. A guard
aimed at the wrong signal is indistinguishable from no guard.

So: flip it, then read several times and require the values to **differ** — a real frame time never repeats to
four decimals — and flip again if they do not. VOID if it never reports changing numbers.

And add the same check one level up as a **ladder saturation guard**: if every rung's median lands within the
noise of every other, VOID instead of computing savings. Both of this evening's silent failures — the fire
reach at 98.61 five times and this at 36.81 six times — would have been caught by that one clause, and both
produced confident-looking numbers without it.

## Writing a UPROPERTY bitfield is not the same as calling its setter

The Project Avatar optimisation was measured from Python (`set_editor_property`) and then implemented in C++
as direct assignment plus `MarkRenderStateDirty()`:

```cpp
Part->bAffectDynamicIndirectLighting = false;   // looks equivalent. is not.
Part->bAffectDistanceFieldLighting  = false;
Part->MarkRenderStateDirty();
```

Read back off the actors the shipped path actually created — 3 avatars, 198 components:

```
distance_field_off  198 / 198     indirect_off  3 / 198
```

and the saving collapsed from **170.57 ms to 6.38 ms**. One of the two bits stuck and the one that mattered
did not. `UPrimitiveComponent::SetAffectDynamicIndirectLighting` does work the assignment does not.

**This is "set a cvar and never read it back" one layer down**, and it would have shipped as a fix that
compiled, looked right in review, and bought nothing — because the measurement that justified it was taken on
a *different code path* from the one that shipped.

Two rules:

- **Prefer the engine's setter to the field.** If a `UPROPERTY` has an `ENGINE_API Set…()` beside it, that
  function exists because assignment is insufficient.
- **Measure the path that ships, not an equivalent one.** The 170 ms was real and was measured on an actor
  the job spawned itself. Proving the shipped path does the same thing needed a hook into that path, and
  adding one was cheaper than the bug it caught.
