# DL01 -- the district walks get somewhere to arrive (2026-09-16)

DW01 gave every district court a walk to an overlook, and then named its own gap: eight of the twelve overlooks
looked at open generator ground. The walk arrived somewhere and stopped again. Gate item 8 records the same want
from the other side -- "teapot/key object language at landmark scale in the districts".

## Where a landmark may stand, measured

`probe_site_clear.py` (new) tested a 15 x 15 x 20 m box at five distances beyond every overlook: `site_clearance.json`.

| | result |
|---|---|
| WW02 FO02 ER02 TC02 CK02 SM02 WG02 | a clear site |
| RG02 CQ02 CL02 EQ02 LH02 | packed with city at every distance -- **no landmark laid** |

The five dense districts get nothing on purpose. Their overlooks already face built content, and forcing a building
into ground the probe proved full would be the opposite of the point.

## What stands, and what does not

| district | piece | reads |
|---|---|---|
| West Wood | spire cluster, x0.85 | yes -- spires over the wood |
| East Reach | ceremonial arch, x0.65 at 10 m | yes -- a gateway you walk through |
| Teapot Court | three market canopies | yes -- a little market on the green |
| The Colossal Key | straight colonnade | yes -- the best of the seven |
| South Meadows | palace pavilion at 21 m | yes -- 31 m of facade across open meadow |
| Water Gardens | water pavilion over its pool | yes |
| **Far Orchards** | **none** | **withheld -- see below** |

## Three corrections the captures forced

- **The spire cluster at x1.30** made its own base drum the landmark and the spires an afterthought. x0.85.
- **The ceremonial arch at 30 m, 7 m from the end of the walk**, was a blank wall whichever way it faced -- the
  visitor arrived inside its own footprint. Two thirds the size, 10 m further out, it is a gateway again.
- **The palace pavilion** ended the walk against its facade. South Meadows is open in every direction the probe
  tested, so it simply stands further off and can be seen whole.

## Far Orchards is withheld, not forgotten

`WL_Colonnade_Curved` does not sit where it is put: at both 180 and 90 degrees its mass landed a half-length off the
apron, so the module's origin is at one end rather than its centre. That wants a measured offset from
`mesh_bounds.json`, not a third guess. A colonnade standing beside its own paving is worse than open ground, so the
pass was removed from the map (16 actors) and the district keeps its walk and overlook until the offset is measured.

`lm1a/lm1b.jpg` first pass, `lm2.jpg` the three corrections, `lm3.jpg` the two re-sited. Map saved.
