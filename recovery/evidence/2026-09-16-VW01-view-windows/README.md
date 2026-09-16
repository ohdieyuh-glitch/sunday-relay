# VW01 -- view windows: the corridor stops hiding its own city (2026-09-16)

## The finding

`city1.jpg` -- ten eye-height captures from the Golden Arrival axis. Looking FORWARD the world is already the Bible:
spires, domes, balloons, floating islands, the rondel. Looking SIDEWAYS from the same spot there is no city at all:
a continuous wall of generator hedge 4 to 9 m off the axis fills the frame with green for the whole walk.

`city2.jpg` -- the same stations with the camera raised to 9 m. The city is right there: pale spires, domes, teapot
pavilions, gardens, balloons, 30 to 150 m out.

So the gate's assumption was wrong. The midground is not missing and does not need the palace family placed in it;
it is hidden by a hedge one and a half metres above the visitor's eye.

## The change

Not a clearance -- foliage framing is wanted. A RHYTHM, which is what a processional avenue should have had:
20 of the 60 `SM_hedge_mass` instances sunk, so clipped hedge blocks alternate with windows about 6 m wide.

| run | before | sunk |
|---|---|---|
| avenue, y -5867..-2533, x +/-900 | six blocks a side, 7.4 m across on a 6.7 m pitch -- solid | alternate blocks, 3 a side |
| plaza flank, y +1100, x +/-560..+/-1700 | a thicket four deep | the two nearest the axis, a side |
| garden path, y +1950..+4190, x +/-390..+/-420 | eight blocks a side, 2.2-2.8 m tall at 4 m out | alternate blocks, 3 a side |
| mid air, (-600, 2800) and (-1250, 2760) | hedge masses standing 2.6 m clear of the ground | both |

Every instance carries its exact before transform; `apply_vegetation_trim.py REVERT` puts all 20 back
(`trim_result.json`: changed 20, refused 0).

## The result

- `vw01_ab.jpg` -- before/after at y -3000 and y +1400, both sides. Where the avenue had a green wall there is now
  a lawn with a garden pavilion, a market arcade and the pale city behind.
- `vw01_ab2.jpg` -- the control: y +5800 (no hedge there) is pixel-identical, and the forward views down the axis
  from y -5200 and -4000 are unchanged, so the avenue still frames its own procession.

Still walled at y +1400: trees and hanging vines rather than hedge. That is the next candidate.
