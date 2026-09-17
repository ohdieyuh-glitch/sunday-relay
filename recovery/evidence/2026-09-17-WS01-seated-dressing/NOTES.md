# WS01: the city's wall dressing stands ON the wall (SAVED 2026-09-17)

## Gap
WB01 found that a building's census BOX face is not its wall. Every facade pass had placed its clip-ons on that box
face, so they hung in the air: measured per pass in `measured_gaps.md`, a median 28-30 cm for FD02's arched windows
(63-72 cm on castle halls' long sides), 30-38 cm for SF01's shopfronts, 17-28 cm for FD04's banners and FD05's wall
lanterns. A window is a 39 cm deep clip-on with a flat back plate, so the gap shows at any oblique angle.

## What was done
`seat_layers.py` rewrites the SAVED layer files in place. For each instance standing on a box face (within 15 cm of
the plane, inside its span and height, turned to face out of it) it moves the instance back along the face normal by
`wall_seat.wall_depth` over that module's own height band. Ids, counts, heights, rotations, scales and materials are
untouched -- verified instance by instance against HEAD: 5,202 instances compared, 5,111 moved, only x and y differ.
Because a seated instance is no longer within 15 cm of the box face, running it again moves nothing.

| pass | seated | median move | max |
|---|---|---|---|
| FD02 windows | 3,075 | 29.4 cm | 79.8 |
| FD04 banners | 936 | 29.4 cm | 70.0 |
| SF01 shopfronts | 632 | 31.8 cm | 61.6 |
| FD05 lanterns | 468 | 20.8 cm | 72.3 |

**Refused on purpose (MAX_MOVE 90 cm):** 57 banner, 6 lantern and 16 shop parts on `SM_gatehouse_district`, and 3
banner parts on `SM_castle_arcade`. A district gatehouse's foot outline is 2.1 m inside its bounds while its upper
structure is not, so seating would have driven a banner two metres into a landmark. That is a different problem.
`mesh_sections.py` now slices ten wall meshes (`wall_sections.json`), including the towers, arcade, gatehouse and
cloister: the insets are castle hall 30-38 cm, facade panel 56, tower 28, octagon tower 40, slender tower 14,
district tower 156, gatehouse 210, cloister 50, arcade 35, square tower 0.

## Judgement (same session, identical cameras; `ws01_poses.json`)
- `WS_window_typ`, `WS_window_typ2`, `WS_window_long`: before, each surround stands off the wall with a lit edge and
  a shadow gap behind it; after, it sits in the wall, and the sill and jambs line up with the stone.
- `City_FillEE54`: the two arched windows now read as openings in the wall rather than panels hung on it.
- `WS_banner`, `WS_lantern`: the rod's end plate and the lantern's back plate meet the wall.
- `WS_shop`, `SW_NarrowStreet43`: no visible change; nothing was lost at street distance.

Better close up, unchanged at distance, no new defect. KEPT and saved (umap mtime verified, no dirty packages left).

**Performance was not re-measured, and does not need to be:** the instance count, meshes, materials, batching and cull
distances are identical; only positions changed.

## FD01 is deliberately untouched
FD01's balconies and oriels are keyed to the generator's own window panes and sit 14 cm INSIDE the real wall (286 of
398 instances), which is where a bracket belongs.
