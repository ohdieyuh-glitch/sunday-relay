# LW01: the lawn's own material -- finer tile, less acid green (SAVED 2026-09-17)

## Gap
A fresh survey of 16 gameplay cameras put the lawns first among the surfaces that still read as unfinished: a large,
evenly lit, strongly yellow-green plane. Measured on the instance: the sward texture tiled at TexScale 0.009, i.e. one
tile every 1.11 m, so a blade of grass was a metre long; BaseColor was (0.27, 0.37, 0.14), an acid green well outside
the Bible's olive-leaning colour harmony (BOARD_2).

## Tried, at 10 identical cameras in one session (`lw01_poses.json`)
| variant | change |
|---|---|
| v1 | TexScale 0.018 on Lawn, Meadow and Moss -- a 55 cm tile, nothing else |
| v2 | v1 plus BaseColor deepened and de-yellowed (Lawn 0.20/0.30/0.12, Meadow 0.22/0.31/0.13, Moss 0.18/0.27/0.11), Specular 0.20 -> 0.15, RoughVary 0.6 -> 0.7 |

## Judgement
- Close up (`LW_lawn_close`): v1's grain is visibly finer and reads as mown turf rather than mottled felt; v2 the same
  with a deeper colour.
- At path level (`GroveRoadCam18`): v2's green sits against the paving instead of glowing next to it.
- Aerial (`WorldCam12`): no shimmer, no tiling pattern, no noise at distance -- the failure mode a finer tile risks.
- Mid-distance garden cameras: little difference; the plane is still a plane. That is a planting problem (GC01), not
  a material one.

Modest but real, free, and closer to the boards' palette. v2 KEPT and saved (the instances are saved assets, so no
map change). The originals are in `record.json`; `tune_material_instances.py REVERT` restores them exactly.
