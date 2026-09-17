# LT02: a lower sun, so the day rakes across the city (SAVED 2026-09-17)

## Gap
The last item on the founder's material-realism list is "lighting that reveals materials". After the ground, ivory,
roof, gold, glass, plinth, plaster, grass and planting passes, the light was still a 52-degree midday sun: frontal on
every facade, every shadow dropped at its own foot, and the new relief -- plinth courses, plaster tooth, grass at the
kerb -- lit flat.

## Tried, at 9 identical cameras in one session (`lt02_poses.json`)
| state | sun |
|---|---|
| lt0 | pitch -52, source angle 1.2 (as the world was) |
| lt1 | pitch -40, source angle 1.2 |
| lt2 | pitch -40, source angle 0.7 |

Intensity (70,000 lux), colour, the sky light and all three fill lights are untouched: this turns the sun, it does
not dim it.

## Judgement
- `LanternLaneCam27`: the balustrade now lays a long shadow across the lawn. The lawn has shape instead of being an
  evenly lit plane -- the same surface GS01 and GT02 could not fix by material or by scattering.
- `SW_PlazaHero41`, `East_QuarterStreet58`: facades keep a lit side and a shaded side; the plaster and the ashlar
  read as different surfaces because the light crosses them instead of facing them.
- `HeroCam_GoldenArrivalBible`: the arches throw longer shadows down the path. The Bible's own hero image has that.
- `WorldCam12` (aerial): more depth between buildings, no loss of brightness.
- lt2 over lt1: a sharper source (0.7 deg) gives contact shadows an edge. Small, and worth it where WB01's plinths
  and GC01's planting meet the ground.

KEPT lt2, saved (one actor's rotation; `record.json` + `apply_sun_angle.py REVERT` puts it back exactly).

## A tool bug this pass found and fixed
`apply_sun_angle.py` refuses to write when the sun is not where it last left it -- the guard that stops a pass from
overwriting someone else's change. But REVERT did not clear its "last written" note, so after the A/B reverted to
-52 the keep-run refused with "pitch is -52.0, not the -40.0 this job last wrote: someone changed it". The guard was
right to fire and the bookkeeping was wrong: REVERT now drops the note, and an apply with no note trusts the recorded
before. Filed here because the guard doing its job is the reason nothing was silently overwritten.
