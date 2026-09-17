# The material-realism phase, 2026-09-17: what changed and what it cost

The founder's direction was to stop expanding the world and make its existing surfaces read as real materials, in a
given order: ground first, then ivory and pale stone, plaster, gold, roofs, windows and glass, material scale, macro
and micro detail, contact and depth, geometry where the mesh is the problem, edge quality, and lighting that reveals
materials. This is the whole list walked once, judged camera by camera.

## Kept

| pass | what | size |
|---|---|---|
| GR01 / GR02 | plazas, sidewalks, paths and garden paths laid in flagstones instead of one poured slab | 196 tiles + 4 batches |
| IV01 / IV02 | the ivory stone's normal calmed, then carved pieces made to read smooth rather than pitted | 3 instances |
| RF01, GD01, GL01 | roof tiles, gold's colour and roughness, glass's noise normal switched off | material instances |
| LOOK03 | the unshadowed fill lights halved, so recesses keep their shade | 3 lights |
| WB01 | 5,457 plinth blocks at the foot of 650 street walls, seated on the real wall face | 20 batches |
| WS01 | 5,111 windows, banners, lanterns and shopfronts moved back onto the walls they hang on | 4 passes |
| LW01 | the lawn's texture tiled at 55 cm instead of 1.11 m, in a deeper, less acid green | 3 instances |
| GT01 | 21,767 grass tufts where paving meets lawn | 22 batches |
| GC01 | 1,111 plants -- borders, rose and shrub clusters, topiary, hedges, garden groups -- in the quarters that had none | 17 layers |
| PS01 | 352 buildings plastered instead of ashlar, so a street is not one block cut five ways | 41 batches |
| TG01 | 89 trees in groves on the open lawns | 16 layers |
| LT02 | the sun down from 52 to 40 degrees, so the day rakes across the city | 1 actor |

## Rejected, with evidence

LL01 (12 m lantern standards), FD03 (2,992 upper-storey windows, +13 ms), AP01 (atmospheric haze), GS01 (lawn macro
breakup -- invisible), GT02 (9,211 tufts scattered on open lawn -- read as weeds on a mown lawn), and the first cuts
of WB01 (a jointless band) and GT01 (planted on the lawn slabs' own edges, 107 m from every camera).

## Investigated and closed with no change

- **The prop contact audit.** 2,020 props measured as "floating"; most are mounted by design, and five close-ups
  showed the remaining 698 plants standing on terrace slabs and in planters. The ground model was partial, not the
  world.
- **Window trim.** Some walls already carry framed recesses; others have bare slits. No clear defect.

## Cost

Every instanced pass was measured in PIE in the same session, with a warm-up window: WB01 no measurable cost, GT01
about half a millisecond, GC01 and TG01 no measurable cost. PS01 needed no measurement -- it swaps which textures a
draw samples, on the same master, with the same slots. Nothing this phase added a draw call to a different shader.

## The same fifteen cameras, before and after

`phase_ab1_*.jpg` and `phase_ab2_*.jpg` compare the survey that began the lawn work with the world as it now stands.
SW_StreetGate46's empty foreground has a tree and its shadow; SW_Colonnade45 and South_PlayerClose40 have planted
borders on a deeper lawn; East_QuarterStreet58 and ClockQuarterCam13 have plastered facades; the Mushroom Grove and
the Hamlet have groves and raking shade. The Golden Arrival hero framing is unchanged throughout, on purpose.

## What is still open

- SW_StreetGate46's deep foreground lawn wants a designed garden, which is a composition decision rather than
  dressing.
- Edge quality on the V2 generator meshes (bevels on primitive silhouettes) needs those meshes themselves, which are
  V2 content rather than forge modules.
