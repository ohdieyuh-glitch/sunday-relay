# IV02 -- carved ivory pieces read smooth, not pitted (2026-09-17)

After IV01 (NormalStrength 3.0 -> 1.0) the balusters at Lantern Lane and the Cloister still read lumpy close up.
The mesh is not the cause: the generator's SM_balustrade (assets_v2.py balustrade()) is a clean 12-step revolve with no
noise. The cause is MI_V2_IvoryStone's normal (1.0) plus its detail normal (0.3, at 4x frequency) on small curved
pieces viewed from 1-3 m.

Variants at 7 identical cameras (iv02_ab.jpg: Lantern Lane baluster close-up, bridge newel close-up, LanternLaneCam27,
CloisterCam31, ClockGrandCam23; SkylineRise and Hero captured too), reverted and saved to the original in between:
| iv2b | NormalStrength 1.0, DetailStrength 0.3 | pitted balusters |
| iv2v1 | NormalStrength 0.5, DetailStrength 0.0 | KEPT: balusters and newel read as smooth carved stone that still has grain |
| iv2v2 | NormalStrength 0.25, DetailStrength 0.0, RoughVary 0.4 | smoother still, starting to read as plaster/plastic |

Applied v1 to MI_V2_IvoryStone only and saved (applied_check.json; record.json holds the 1.0 / 0.3 before).
Scope: MI_V2_IvoryStone is the generator's carved-stone instance (balustrades, pedestals, columns, urns' stone,
kit stone parts); the marble and tower instances keep IV01's 1.0.
