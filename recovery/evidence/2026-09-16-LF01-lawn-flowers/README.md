# LF01 -- flower drifts in the lawns where visitors walk (2026-09-16)

Lawn is 48% of what a visitor sees in the city, and read as a flat green sheet. MQ08 warmed the colour; MQ09's grass
texture was rejected. What the Bible's lawns have that ours lack is flowers standing UP out of them, in drifts.

## Budget first

The lawns are 506 batch instances over **1.8 km^2** of stacked slabs. The first generation came to **306,000**
instances -- far too many for decoration, culled or not. Three levers brought it to a tenth: candidates only within
18 m of a street tile or authored paving (where visitors walk), a coarser grid, and fewer runs per patch. And the
batch actor gained a **cull distance** (C++, zero = never, so no existing batch changes): these batches stop drawing
beyond 60 m, fading from 48 m.

## Never through a path

Lawn tops sit centimetres under the paving laid over them, so a 40 cm flower on the lawn beneath a plaza stands up
through its slabs. Candidates are dropped near authored paving, street tiles, censused props -- and, after the first
preview exposed the gap, near **all generator ground cover and buildings** (ground_cover.json: 280,000 footprint
points). That second exclusion removed nearly half the patches, which is how many would have been buried in plazas
and walls.

## Drifts, and how dense

A smooth world-space value-noise field places drifts, continuous across lawn slabs. At threshold 0.70 (`lf01a.jpg`)
a drift looked exactly right where it landed -- SW colonnade -- but most views held none. At 0.56 (`lf01b.jpg`)
drifts show along Lantern Lane's pavilion, behind Grove Road's bushes, across SW plaza's lawn, at the Cloister; the
hero and skyline views are unchanged. Final: **3,980 patches, 23,855 instances** in 14 layers (200 m cells).

## Cost (`perf_remove_ab.json`)

All 84 LF01 batch actors destroyed in PIE, two rounds, three cameras: on minus off ranges from -2.6 to +3.7 ms and
changes SIGN between rounds -- inside the noise. Absolute frame times (46-80 ms) are the laptop's thermal state and
the HUD mini-map, not this pass.

Map saved.
