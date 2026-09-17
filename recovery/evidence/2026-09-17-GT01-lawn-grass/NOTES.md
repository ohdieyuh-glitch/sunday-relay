# GT01: grass where the paving ends (SAVED 2026-09-17)

## Gap
The lawns are the largest surface a player sees -- the ground census over the gameplay cameras puts `Cube|MI_V2_Moss`
first with 4,058 samples, ahead of every stone surface -- and they read as one flat carpet that stops at the paving on
a drawn line. GS01 had already shown this is not a material problem: macro colour breakup and per-instance tone, in
two strengths, changed nothing at nine cameras. `measured.md` has the numbers.

## Two cuts
**Cut 1, planted on the lawns' own box edges: INVISIBLE, removed.** The lawns are 385 enormous slabs; a player stands
in the MIDDLE of one. Every one of the 6,202 tufts landed at least 107 m from the lawn cameras and nothing showed at
any of them (`cut1_lawn_box_edges_invisible.jpg`). The visible boundary is not the lawn's edge at all: the paving
platforms lie ON TOP of the lawn, 14-16 cm proud, and their edges draw the line the eye sees.

**Cut 2, walked from the paving: KEPT.** The paving is both systems -- the street census's tiles and the 1,543
SM_terrace_platform boxes (`terrace_boxes.json`, censused for this). Lantern Lane is bounded by terrace platforms and
no street tile, which is why a first attempt from street tiles alone still missed it. Every piece's perimeter is
sampled every 95 cm; a sample counts where the ground just outside is not covered by more paving but IS a lawn below
it. Tufts stand 18-40 cm out on the lawn, with a 30% second row at 55-85 cm, each with its own jitter, yaw, scale
(0.80-1.30) and its own lawn's material.

21,012 tufts, 59 batch actors, 191 tris each, no collision, cull 40 m. At 60 cm spacing and 60 m range it came to
52,747, which is a lawn and not a fringe; 95 cm and 45 m keeps grass in front of every garden camera at a fifth of
the cost of the dense version.

## Judgement (identical cameras, one session; `gt01_poses.json`)
- `GT_path_edge`, `GroveRoadCam18`, `TeapotCam24`, `CloisterCam31`: blades break the drawn line where the path or
  terrace meets the grass; the step from stone to lawn now has something growing at its foot.
- `SW_PlazaHero41`, `LanternLaneCam27`, `GT_lawn_down`: no visible change -- their lawn boundaries are further away.
- `WorldCam12` (aerial): no change and no noise; the tufts are culled long before.

## Performance
`perf_remove_ab.json`: PIE, same session, WARM window first, 50 pass actors destroyed, median frame ms.

| camera | R1 on | R1 off | R1 off2 | R2 on | R2 off | R2 off2 |
|---|---|---|---|---|---|---|
| GroveRoadCam18 | 37.88 | 37.38 | 36.45 | 38.02 | 37.76 | 36.07 |
| TeapotCam24 | 35.12 | 35.02 | 34.36 | 34.81 | 34.92 | 35.12 |
| CloisterCam31 | 35.61 | 35.49 | 37.59 | 36.01 | 37.91 | 35.28 |
| SW_PlazaHero41 | 61.42 | 59.38 | 58.95 | 58.64 | 56.85 | 59.01 |

Mean ON 42.2, OFF 41.8, OFF-again 41.6: about half a millisecond, inside the 2 ms that separates the two OFF windows
at CloisterCam31. Acceptable.

## A removal lesson
The first cut's actors were still in the map after its removal jobs ran: those jobs had been queued with paths to
layer FILES that were regenerated (and renamed) before they executed, so they removed per-district pass tags that no
longer matched. The map then held 32,560 instances instead of 21,012. Every actor also carries the pass's own plain
tag (`GT01`), so clearing by that tag and re-applying fixed it exactly. Remove BEFORE regenerating, or remove by the
pass tag.

## Saved
21,012 instances in 59 actors, `save_current_level` at 12:51, umap mtime changed, no dirty packages left.
