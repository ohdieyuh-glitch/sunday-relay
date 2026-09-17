# GR02 -- the garden and park paths laid in flagstones (2026-09-17)

After the first material cycle (GR01, IV01, RF01, GD01, GL01, LT01), a 24-camera re-survey (sv6_all.jpg) showed the
largest remaining ground gap in the gardens: paths at GroveRoadCam18, TeapotCam24, CloisterCam31, BridgeCam32 read as
flat sand / concrete strips -- the same giant-block look GR01 fixed in the city.

path_census.json: those paths are SM_terrace_platform instances in generator BATCHES (GR01 reached only the 196
standalone tile actors). terrace_batches.json: V2Batch_terrace_platform_MI_V2_PlazaCream (388 tiles, 29,489 m2),
_PlazaWarm (377, 22,445), _PlazaGrey (88, 5,922), _PlazaShade (49, 1,426); the Water batch left alone.

Tool: apply_batch_material.py -- sets a batch's Material (and MaterialPath, its record) by object name, refusing a
batch that does not hold the recorded before; REVERT restores (gr02_batch_swaps.json). A fifth twin,
MI_V2_GroundFlag_PlazaGrey, made on GR01's recipe. Swap: 4 batches changed, 0 refused (swap.json).

Judgement (gr02_down.jpg, gr02_normal.jpg; identical cameras): the paths are laid flagstones in the gardens as in the
city, and read at gameplay distance; the cobble plazas unchanged; no regressions. Kept. Saved (saved.json).
Performance: material swap on four batches, same master, no geometry.
