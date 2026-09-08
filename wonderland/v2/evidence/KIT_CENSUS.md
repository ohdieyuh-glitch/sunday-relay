# The forge kit against the 33-camera census

`framescape_BEFORE.txt` and `framescape_AFTER.txt` are the raw runs. This is
what happened between them, because the interesting part is the four cycles
where a pass measured as **zero** and the reason each time was an instrument,
not the placements.

| | placements | mean built | cameras moved | one piece holds a third | frames over half green |
|---|---|---|---|---|---|
| before | 13,816 | 67.78% | — | 10 | 9 |
| after | 14,529 | **73.99%** | 23 of 33 | 9 | 5 |

The founder's reference, classified from its own pixels, is built **71.5%**.

## The four times a pass measured zero

**1. The census could not see the kit.** `skyline.bboxes()` built its table by
running every `assets_v2` recipe, so a forge mesh had no bounding box and was
invisible to every instrument that reads one. Seven 60 m towers changed the
census by nothing. Fixed at the root: `build_assets.py` now measures a
`profile_uu` per mesh into the manifest and `skyline._kit_bboxes()` reads it.

**2. The towers were 131 degrees off axis.** `framescape` computes a bearing as
`atan2(dx, dy) - (yaw - 90)`, so forward is `(-cos yaw, sin yaw)` — not
`(cos yaw, sin yaw)`, which is right only for the two cameras whose yaw is 90
or 270. `kit_layout.forward()` carries the derivation now.

**3. The frames targeted had no headroom.** `census` clips elevation to the
frame's top edge and awards a column on a strict `>`, so a frame already
reading `+29.4` cannot be moved by anything taller. Only frames whose median
top is *below* their own edge can be filled; `HEADROOM_FRAMES` is that list.

**4. `tops_at` ignored pitch.** The census reports elevations relative to a
camera's own axis. Written without the pitch term, the helper read WorldCam12
— which looks 16 degrees down — a full 16 degrees high, and every window
matched against it was that far out. The two cameras whose pitch is 0 hid it.
`HEADROOM_FRAMES` no longer carries typed windows for the same reason: they are
derived from the median and the frame edge.

## What the last pass attacked, and what it could not

The world's mismatch #4 is *ten frames have ONE piece holding a third of the
ceiling*. Measured per column, those ten split in two:

- **six are edge-pinned** — the incumbent already reads the frame's top edge,
  so no piece placed can ever take the column. `TeapotCam24`'s gatehouse tops
  at `+50.0` against an edge of `+33.8`; `WorldNorthCam19`'s spire at `+63.2`
  against `+31.5`. Adding towers to those frames costs a pass and changes the
  census by zero. `kit_layout.EDGE_PINNED` records all six with their numbers.
- **four have real room**, and two of those are held by *vegetation* — the
  district's own fungus and an avenue cone out-topping their architecture,
  which is mismatch #2 as well. Those are what `_ceiling_break` answers.
  `ClockQuarterCam13` fell off the list: its mushroom went 35% → 26%.

Of the other two, `ClockGrandCam23` and `GateArchCam30` are held by the SAME
swag standing 15 m from two cameras 1.7 m apart. Out-topping a foreground piece
at 1,535 uu from behind needs `(h - 170) > 0.70 · r`; at any distance a stand
may legally occupy that is a 400 m tower. **The swag has to move or shrink, and
it is the world stream's asset, not the kit's.** It still went 71% → 61%,
because the depth stands took columns beside it.

## The fifth zero: a narrow arc sampled once

The bearing step is the angle that separates two stands on the ground -- 2,600
uu at 11 km is 13 degrees. On an arc 11 degrees wide that tries exactly ONE
bearing, and one blocked bearing reads as "no clear ground" for the whole arc.
It refused **the founder's own reference frame**, the one camera in the suite
with a ground truth to miss: `HeroCam_V2_MarbleReference` is built 60.0% where
the image it reproduces is 71.5%. Sampling any arc at least four ways found it
ground at 9,200 uu on bearing -36.2 and took the frame 57.5% -> 60.0%.

It is still 11.5 points short. Its remaining green tops out at +29.1 from 29.7
m away, which needs a 63 m tower inside 10.9 km on two narrow bearings, and the
ground there is nearly all spoken for. **That gap is the next pass's first
job**, and it is the most valuable number in this file: every other camera is
judged against a reading, this one against a picture.

## Not proven

No frame here has been rendered. These are silhouette censuses computed from
`layout_v2.ALL` and the measured bounding boxes — the same arithmetic the
engine would use to place the actors, run without one.
`wonderland/art/unreal/import-plan.json` still reads
`imported_into_an_editor: false`.
