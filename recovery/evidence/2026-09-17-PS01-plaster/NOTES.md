# PS01: the city gets plaster (SAVED 2026-09-17)

## Gap
Every wall in Wonderland is the same material. The visible-material census lists, for walls, only coursed ashlar
marble in five tints: MI_V2_AshlarMarblePale 9,267 m2 in view, AshlarMarbleBlush 2,835, AshlarCeramic 2,739,
AshlarMarbleCool 2,534, AshlarMarbleShade 2,323. BOARD_2's material palette names CREAM STUCCO beside pale stone, and
a plastered wall is not an ashlar wall with its joints turned off -- it is a different scale of relief. The founder's
material-realism order lists plaster third, after ground and ivory.

## What was made
- `hd_textures.stucco`: a 2048 px tiling set -- sand tooth at millimetre scale over the slow undulation a trowel
  leaves at half a metre, limewash cloudiness, a few open pores. No cracks, no runs, no grime. The first cut's tooth
  was invisible at wall scale; the sand amplitude was roughly doubled (`stucco_texture_preview.png` is the second).
- `make_stucco_materials.py`: MI_V2_StuccoCream / StuccoBlush / StuccoShade on M_V2_SurfaceHD, each taking its tint
  from the ashlar instance it stands beside in the palette (Pale, Blush, Shade); Cream is warmed 3%, the only
  invention. TexScale 0.004 lays the set at 2.5 m, so the tiling hides and the sand stays fine.
- `ps01_stucco.py`: chooses which walls. A WonderlandInstancedBatch draws every instance with one material, so the
  batch is the unit -- but with 178 building batches at a median of 5 buildings each, a third plastered reads as
  building-to-building variety, not as a repainted district. 41 of 135 candidate batches, 352 buildings, chosen by a
  stable hash of the batch name so the choice reproduces and neighbours differ, with the stucco tint following the
  ashlar tint it replaces (25 Cream, 9 Shade, 7 Blush).

## Judgement (identical cameras, one session; `ps01_poses.json`)
- `PS_wall_close`, `East_QuarterStreet58`, `South_StreetHero34`: a plastered facade now stands beside an ashlar one.
  The street reads as a street of different buildings rather than one block cut five ways.
- `ClockQuarterCam13`: its big cream wall reads as render with trim on it, which is what the boards show.
- `SW_Colonnade45`: unchanged -- none of its batches were chosen.
- `WorldCam12` (aerial): no visible change, no noise.

## Performance
Not measured, and it does not need to be: the ashlar instances this replaces are already on M_V2_SurfaceHD with the
same three texture slots plus Macro, so the swap changes no shader, no instance count, no draw call -- only which
textures those draws sample.

## Saved
352 buildings confirmed wearing stucco in the map, umap mtime changed, nothing left dirty. `apply_batch_material.py`
with REVERT restores every batch's recorded material exactly.
