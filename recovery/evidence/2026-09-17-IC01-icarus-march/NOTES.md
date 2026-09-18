# IC01: the Icarus March -- the first ground of the white nation (SAVED 2026-09-17)

The founder's expansion rule: the pause is over, grow OUTWARD from the accepted city, never rebuild it, and give new
regions real nation identity rather than generic territory.

## Where, and why there
Measured before building: the ICARUS band (bearing 30-150 degrees) from 500 m to 1 km holds 28 distant skyline halls
and nothing else -- no streets, no terraces, no props. The march runs due north on the axis from the neutral core's
edge at 500 m to a threshold at 636 m. Golden Arrival is untouched; `nations.nation_at` confirms every actor is in
ICARUS, and all 22 carry the WL_NATION_ICARUS tag.

## What it is
- A 14.4 m causeway of the city's own paving plates, kerbed both sides.
- Balustrade runs in **Icarus pearl** with newel urns at the joints, their metal in **Icarus silver** -- the nation's
  accent where the core uses gold. Both materials were built for this by `make_nation_materials.py`, copying the
  tuned instances they descend from (MQ06's gold roughness carries into the silver) and overriding only what makes
  them Icarus's.
- Grand pinnacles and slender towers in **Icarus ashlar** alternating every 28 m, so the approach has the nation's
  vertical silhouette from far off.
- A garden threshold on the axis where the march ends.
- Planting outside the balustrades, and a grass fringe where the causeway's edge steps down to the ground.

667 instances in 22 batches.

## Three cuts
1. **Guessed asset paths.** The apply refused: "asset did not load". The layer system doing its job; paths are now
   read off the meshes themselves (`mesh_bounds_v2.json`).
2. **MI_V2_PlazaCream on 14.4 m plates read as one poured slab** -- the exact fault GR01 fixed in the core. Swapped
   to GR01's flagstone twin, and the causeway now reads as laid stone (`cut2_*.jpg`).
3. **The medallion read as a blank white disc** every 28 m. Its paving parts now use the same flagstone twins and it
   appears every 42 m, so it is an accent rather than a repeated blob.

## Judgement (`ic01_poses.json`, before and after at identical cameras)
`cut3_final.jpg`: from the core's edge the march reads as a formal white avenue with balustrades, urns, pinnacles and
planting; the flagstones read as stone underfoot; from the city the white ribbon leads the eye north out of Golden
Arrival, which is exactly what a nation approach should do.

**The threshold, fixed the same session.** It read as a plain white block with an arch, and the fix was not to make
anything: the kit already held `WL_Gatehouse_Twin` -- two flanking drum towers, a machicolated bridge, an 8 m
passage, 26 m tall, 13,048 tris -- already imported and never placed. It now stands on the axis in pearl, silver and
white spires (`cut4_ceremonial_gatehouse.jpg`). From the middle of the march it closes the vista, which is what a
processional way is for; from the core's edge it is the destination in the distance.

## Saved
667 instances, 22 actors, all nation-tagged, umap mtime verified, nothing left dirty.
