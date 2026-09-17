# GT01 -- why grass at the lawn EDGE, and why only there (measured 2026-09-17)

The ground census over the gameplay cameras puts the lawns first by a wide margin: `Cube|MI_V2_Moss` 4,058 samples
against `SM_terrace_platform|MI_V2_PlazaShade` 1,859 and `|MI_V2_Cobble` 1,665. The visible-area census agrees --
Meadow 33,915, Lawn 28,437, Moss 17,062, ahead of every stone surface.

GS01 already proved the lawn is not a material problem: macro colour breakup and per-instance tone, in two strengths,
changed nothing at nine cameras.

What a blanket of grass would cost, measured from lawn_census:
| scope | size |
|---|---|
| all lawn (Lawn + Meadow + Moss) | 385 boxes, 1.66 km2, 94 km of box perimeter |
| a tuft every 40 cm along every perimeter | ~236,000 |
| a tuft per 4 m2 across the lawns | ~415,000 |

Neither is possible. But most of that perimeter is not an edge at all: lawn boxes tile the world, so box edges are
mostly interior joins between neighbouring lawns. Sampling each perimeter at 5 m, keeping only samples within 60 m of
one of the 60 gameplay cameras, and then only those with something OTHER than lawn 80 cm outside:

| filter | samples |
|---|---|
| perimeter samples | 18,020 |
| within 60 m of a camera | 11,815 |
| and bordering non-lawn | 559 -> about 2.8 km of real edge |

At a tuft every 50 cm with a sparse second row, that is 6,202 tufts -- the scale of WB01's 5,457 plinth blocks, on a
191-tri mesh culled at 40 m.
