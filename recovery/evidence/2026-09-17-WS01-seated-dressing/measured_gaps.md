# WS01 -- how far the city's wall dressing stood off its walls (measured 2026-09-17, before the fix)

Method: every instance in the saved layers matched to the census box face it stands on (within 15 cm, inside the
face's span and height, turned to face out of it), then compared with the real wall from `wall_seat.wall_depth`
over the instance's own module height band.

| pass | mesh | face | n | median gap | p10 | p90 |
|---|---|---|---|---|---|---|
| FD02 windows | SM_castle_hall | +X | 1350 | 29.4 | 25.8 | 57.0 |
| FD02 windows | SM_castle_hall | -X | 1284 | 27.6 | 25.2 | 31.2 |
| FD02 windows | SM_castle_hall | +Y | 270 | 72.2 | 53.2 | 79.8 |
| FD02 windows | SM_castle_hall | -Y | 171 | 63.0 | 39.0 | 63.0 |
| FD04 banners | SM_castle_hall | all | 903 | 29.4 | | 63.0 max |
| FD05 lanterns | SM_castle_hall | all | 460 | 20.0 | | 72.3 max |
| SF01 shopfronts | SM_castle_hall | all | 568 | 30.0 | 27.6 | 60.8 |

The window is a 39 cm deep clip-on with a flat back plate; the lantern's and the banner's wall plates are flat; the
shopfront is 1.45 m deep and hides most of its own gap.

FD01's dressing is NOT affected: it is keyed to the generator's own window panes and sits 14 cm INSIDE the real wall
(286 of 398 instances at -14 cm), which is where a balcony bracket belongs.

Meshes with no cross-section keep their old positions: arcades, gatehouses and cloisters (57 + 33 + 3 banner parts,
6 + 2 + 6 lantern parts, 16 + 48 + 16 shop parts).
