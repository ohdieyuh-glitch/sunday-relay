# Wild ring R50 -- review package (PLANNED / NOT APPLIED)

Status 2026-09-29 05:20: **held at the founder approval boundary.** Nothing here is in the map. Generator
`Wedges/wild_ring.py`; plan `Wedges/plans/wild_ring_plan.png` (`wild_ring_plan.py`).

## Re-checked against the world as it is now

- The census was re-exported after HN238 / HI057 / HT308 were applied (zzW62, 208,756 rows, 0 unloaded).
- All six woods regenerate **byte-identical** against it: 12 specs and sidecars, and the placement rows.
- The top-down plan was redrawn over that census, so the three new heartlands show in grey.
- **All placements fall within 1,203.0-1,476.8 m** (measured over all 13,209 spec instances). None lies outside
  the 1,200-1,480 m band.

## Six arcs

| wood | nation | arc | batches | instances | trees | clearings (bearing, radius) | trail |
|---|---|---|---|---|---|---|---|
| WI030 | ICARUS | 30-58° | 192 | 1,290 | 280 | 46° 1,357 m | 785 m |
| WI122 | ICARUS | 122-150° | 168 | 1,226 | 280 | 136° 1,332 m | 675 m |
| WN150 | NOCTIS | 150-210° | 368 | 2,687 | 600 | 166° 1,346 m; 195° 1,403 m | 1,502 m |
| WN210 | NOCTIS | 210-270° | 344 | 2,670 | 600 | 225° 1,354 m; 254° 1,305 m | 1,450 m |
| WT270 | TARTARUS | 270-330° | 313 | 2,647 | 600 | 286° 1,290 m; 315° 1,346 m | 1,441 m |
| WT330 | TARTARUS | 330-30° | 320 | 2,689 | 600 | 346° 1,394 m; 15° 1,388 m | 1,528 m |
| **total** | | 296° | **1,705** | **13,209** | **2,960** (+29 at patches = 2,989) | **10**, each with a landmark mushroom | **7,380 m** |

Trail lengths are measured polylines. The generator's `trail_m` counts 5 m stones (6,795).

## Nation identity

- **ICARUS** (white): PetalWhite canopies in the leaf mix, cream caps on the landmarks.
- **NOCTIS** (black/purple): LeafDark-heavy canopies, purple caps.
- **TARTARUS** (red): copper and gold canopies, red caps, no white canopies.

The NOCTIS/TARTARUS change at 270° is a hard line on the plan, with no blended strip.

## Trail continuity -- OPEN ITEM, decide before the apply

The trail is one loop round the world, as designed: Dubel's own path covers 58-122° and the six woods cover the
rest. **But every junction leaves an unpaved break**, because each wood's trail stops about 0.5° short of its
arc boundary:

| junction | break |
|---|---|
| WI122 -> WN150 at 150° | 20.8 m |
| WN150 -> WN210 at 210° | 22.3 m |
| WN210 -> WT270 at 270° | 15.3 m |
| WT270 -> WT330 at 330° | 21.0 m |
| WT330 -> WI030 at 30° | 35.2 m (30 m radial mismatch, 1,360 vs 1,390 m) |
| Dubel path -> WI030 at 58° | 20.9 m |
| WI122 -> Dubel path at 122° | 15.4 m |

The gaps are lawn, so they are walkable. They are not a traversal block, but the trail reads as broken seven
times. Recommended fix: run each trail's end onto the boundary point of `trail_r`, and add seam stones.
That is a generator change, and it would need a fresh plan review.

## Dubel Forest transition

- The woods take Dubel's density field (dense at mid-radius, thinning to both edges), and route their trails
  along Dubel's path formula.
- They abut Dubel at 58° and 122°.
- The ICARUS arcs either side are the narrowest (28° each, 280 trees), so the ring thins from Dubel's
  mature forest into a lighter ICARUS wood before the 60° woods.
- The trail joins to Dubel's path are the 58° and 122° breaks above.

## Emptiness (structure-only, `emptiness.py --structure`, 5 m cells, 9 m reach, 1,480 m disc)

| state | empty | % of disc |
|---|---|---|
| **before (ACTUAL, zzW62, after the three heartlands)** | 3,103,775 m2 | **45.1%** |
| after (PROJECTED, + wild ring rows) | 1,860,825 m2 | **27.0%** |
| 1,200-1,480 m band | 1.80 km2 -> 0.56 km2 | |

The projection counts ground within 9 m of any placement as covered, so a thin forest scores well. Read it with
the plan beside it. What stays empty in the band afterwards is the clearings, the trail margin and the thin
edges, which is intended. Inside 1,200 m the remaining empty ground is heartland lawn and the unfilled NOCTIS
166° / 196° / 253° and TARTARUS 7° / 294° pockets, which the wild ring does not touch.

## Likely streaming / batch impact

- **Batches:** +1,705 batch actors. WP descriptors go from 23,803 to 25,508 (+7.2%).
- **Instances:** +13,209, from 208,756 to 221,965 census rows (+6.3%).
- **Trees:** 2,989. Canopies run 3.0-4.8 k triangles, so the ring holds on the order of 10-14 M canopy triangles
  in total, spread over about 1.9 km2. Vegetation is already about 89% of the world's triangles.
- **Density per streaming cell:** the batches are tiled at 200 m, and a ring cell holds roughly 60 trees. That
  is the same density as Dubel, which is already in play.
- **After any apply:** run a perf-frame comparison (`perf_frames` / `zc_veg_cost`) at a ring stand and at the
  centre. The 512 m / 1,024 m distant-streaming question stays held and is not changed by this.

## Proof plan after an apply (not run)

- One save in a fresh editor session.
- A hash-check against a pre-ring checkpoint.
- The in-play trail proof on the six `w*_walk.json` sidecars: stands, capsule sweep, clearings, residency in play.
- The beta walk: W05 judges the wilderness belt.
- Before/after frames.
