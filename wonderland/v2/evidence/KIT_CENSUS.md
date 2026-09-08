# The forge kit against the 33-camera census

`framescape_BEFORE.txt` and `framescape_AFTER.txt` are the raw runs. This is
what happened between them, because the interesting part is the four cycles
where a pass measured as **zero** and the reason each time was an instrument,
not the placements.

| | placements | mean built | cameras moved | one piece holds a third | frames over half green |
|---|---|---|---|---|---|
| before | 13,816 | 67.78% | — | 10 | 9 |
| after | 14,679 | **74.82%** | 24 of 33 | 9 | 5 |

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

## The fifth and sixth zeros: an angle measured as a distance, twice

Both are the same confusion in different clothes, and both cost stands that
fitted.

**The bearing step.** It is derived from the ground two stands need between
them -- 2,600 uu at 11 km is 13 degrees. On an arc 11 degrees wide that tries
exactly ONE bearing, and one blocked bearing reads as "no clear ground" for the
whole arc. It refused the founder's reference frame.

**The separation test.** Same number, same error: two stands 2,600 uu apart on
the ground are 15 degrees apart at 10 km, so a stand on one arc of a frame
silently refused every spot on the arc 13 degrees away. What a frame cares
about is how far apart two towers LOOK; what the ground cares about is that
they do not intersect, and that is a much smaller number. Separation is now
`MIN_SEP_DEG` in the frame plus 1,400 uu on the ground.

Together: `HeroCam_V2_MarbleReference` 57.5% -> 61.7%, `TeaTerraceCam16` 82.5%
-> 95.8%, `ClockGrandCam23` to 100%, mean built 73.61% -> 74.82%.

## The founder's reference frame, in detail

It is built **61.7%** against the 71.5% of the image it reproduces, and it is
the most valuable number in this file: every other camera is judged against a
reading, this one against a picture. Its ceiling, per column:

| columns | holder | elevation | distance | room to the frame edge |
|---|---|---|---|---|
| 26 | `GiantMushroom_Spots` | +33.8 | 34.8 m | **0.0 — pinned** |
| 13 | `ClockTree_Canopy1` | +29.1 | 29.7 m | +4.7 |
| 8 | `ClockTree_Canopy0` | +29.1 | 29.7 m | +4.7 |
| 1 | `Approach_Canopy2` | +18.3 | 63.9 m | +15.6 |

**More than half its green is one giant mushroom at 35 m, reaching above the
top of the picture.** No placement can move it — see the strict `>` above. Both
`ClockTree` arcs now carry a stand. The rest of the gap is the mushroom's, and
the mushroom is the world stream's asset: this is world mismatch #2 (a
district's fungus out-topping its architecture) standing on the one frame with
a ground truth.

## A batch that measured nothing, kept anyway, and labelled

`castle_precinct` puts three walled precincts -- curtain runs, mural towers,
corner bastions, a postern gate, a colonnade and a ceremonial arch, weathered
at the far end of each run -- on ground `tools/emptiness.py` found empty, at
the distance the world's mismatch #3 calls its thinnest.

Measured against that ring afterwards, it did nothing:

| ring | p50 top | built% |
|---|---|---|
| 180-360 m | +0.4 -> +0.5 | 65.0% -> 65.3% |

and the 33-camera census is unchanged to the decimal. 631 pieces into a ring
holding 67,608 cannot move a percentile, and a 40 m precinct at 300 m reads at
+8 degrees against frame edges of +29.

**It is kept, and relabelled.** Five families had ZERO presence in the world --
`walls`, `thresholds`, `civic`, `variants` (all nine weathered modules) and
most of `civic` -- and three audited-empty regions had no built edge. That is a
coverage gap in a castle world, and it is a different thing from a silhouette
defect. Modules placed went 42 of 101 to 52 of 101.

The reason this is written down rather than quietly dropped: a batch that
produces no number is not automatically waste, and a batch that claims a number
it did not produce is worse than one that admits none.

## Not proven

No frame here has been rendered. These are silhouette censuses computed from
`layout_v2.ALL` and the measured bounding boxes — the same arithmetic the
engine would use to place the actors, run without one.
`wonderland/art/unreal/import-plan.json` still reads
`imported_into_an_editor: false`.
