# GC01: the bare quarters get their gardens (SAVED 2026-09-17)

## Gap, measured against the Bible
BOARD_2's ground language is paving plus dense planting -- beds, shrubs, topiary, ground cover, planted borders --
under the rules "everything placed with intent", "no uniform repetition", "no cheap procedural look". There is almost
no open mown lawn in the reference.

Counting the world's own planting props (city_props: 1,768 shrubs, hedges, topiary, roses) within 35 m of each of the
60 gameplay cameras: garden districts 38-69, MEDIAN camera 12, fourteen cameras at three or fewer, and five with
NONE -- City_FillW52, City_FillWE53, SW_StreetGate46, SW_TowerCluster42, WorldNorthCam19. 36 cameras were under the
target of 20. The survey's flattest, emptiest views are exactly those.

## What was placed (876 instances, 17 layers, no new asset)
Only near cameras under target, only on lawn, never on paving, inside a building, or within reach of a prop already
there. Sizes come from the medians of the world's own instances, materials from `prop_materials.json`.
- A border along the paving on the lawn side, every ~7 m and jittered: the forge's flower-bed runs laid ALONG the
  edge (102 daisy, 60 lavender, 16 rose), 158 rose bushes, 144 flowering shrubs.
- Topiary accents every fourth border point, alternating ball and cone (11 placed; most candidates were blocked).
- 105 hedge blocks against building walls that front lawn.
5,578 border candidates were refused because the ground just outside that edge is more paving, and 609 because a
building stands there: most "edges" in a dense quarter are interior joins, not lawn edges.

## Judgement (identical cameras, one session; `gc01_poses.json`)
- `SW_Colonnade45`, `South_PlayerClose40`: a planted border now runs along the path -- lavender and white blooms
  where there was bare grass. This is the boards' border.
- `SW_TowerCluster42`, `SW_PlazaHero41`: shrubs meet the wall bases and break the empty lawn.
- `SW_NarrowStreet43`: one shrub at a wall; small but right.
- `SW_StreetGate46`: almost unchanged -- its huge foreground lawn has no paving edge near it, so nothing was planted
  there. Still open.
- `City_FillW52` (all paved) and `WorldCam12` (aerial): no change, no noise.

## Performance
`perf_remove_ab.json`, PIE, same session, WARM window, 140 pass actors destroyed: mean ON 60.4 ms, OFF 62.6,
OFF-again 60.8. ON is not above OFF. This window was noisy (single cells swing 10 ms, e.g. South_PlayerClose40's two
OFF windows differ by 32 ms), so the honest reading is "no measurable cost", not a precise figure.

Saved: 876 instances, umap mtime changed, nothing left dirty.
