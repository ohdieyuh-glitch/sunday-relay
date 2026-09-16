# DW01 -- a walk on from each of the twelve arrival courts (2026-09-16)

Gate item 12. Before this pass every offered district arrived on an authored court and ended at its rose arch with
generator lawn beyond. Each court now has a walk through that arch: a 4 m paved band with a warm kerb either side,
a gold line each side, flower beds down both borders, a lamp pair at the halfway mark and at the end, and a round
overlook (r 3.5 m) with a gold rim where it stops.

## What is measured, not guessed

**Bearing.** Straight ahead is blocked in most districts, so each walk's bearing is swept +/-75 degrees off the
arrival yaw and takes the longest run with no census solid in it. That turns 0-12 m of clear walk into 7-24 m.

**Height.** `Tools/editor_jobs/probe_ground_editor.py` traced the editor world under all twelve walks
(426 points, `ground_probe.json`). The first version laid every walk at its court's top and was wrong both ways:

| district | first version | measured ground | defect |
|---|---|---|---|
| RG02, CL02 | top 19.5 | lawn -14.0 | paving hung 20 cm in the air |
| CQ02, WW02, CK02 | top 12.5 | lawn -14.0 | paving hung 13 cm in the air |
| EQ02 | top 12.5 | block floor 14.8 | 8 m of walk BURIED under the floor plate |
| SM02 | top 0.0 | platform 12.0 | first 6 m buried under the platform |

Walks are now laid to the measured profile in the courts' own convention -- `ground + 14.0` over lawn (the slab sits
on the grass), `ground + 0.5` over hard paving (the slab replaces it flush) -- cut into runs of constant top, with a
kerb step across the full width where two runs differ and the side kerbs skirted down to the lowest ground beside
them. `walk_ground.json` holds the measurement; `district_walks_plan.json` holds the resulting legs.

**Terminus.** `overlook_clearance.json`: eight overlooks stand clear of everything. RG02 has a road slab beside it,
CQ02 a clockyard gate, CL02 stands under an elevated district tower (underside 3.2 m, walkable), EQ02 on a street
platform. None is inside a building; none is a trap.

## Captures

- `walk2back_a/b.jpg` -- each walk seen from past its overlook, looking back to the court's arch.
- `walk2side_a/b.jpg` -- low side-on at mid length: the kerb reads as stone, with no gap under the paving.
- `walk3.jpg` -- RG02, CQ02, CL02, EQ02 at standing height from both ends, the four whose review cameras had
  landed inside geometry.

Map saved with all twelve applied.
