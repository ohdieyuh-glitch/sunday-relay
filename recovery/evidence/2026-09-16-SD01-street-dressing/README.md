# SD01 -- the city streets get planted (2026-09-16)

SC01/LOOK02 fixed the city streets being grey. This fixes them being EMPTY: the Bible's streets overflow with
flowers, and ours had nothing between the paving and the walls.

## Where, measured

`street_census.json` (street_census.py, new): 600 street tiles, 9.3 km of street. A tile edge with no other tile
beyond it is a REAL street edge (against a building base or a lawn); an edge that meets another tile is a seam.
Dressing goes on real edges only -- 619 of them -- which keeps every street's middle clear.

## What -- four previews, and the frames chose

| preview | pieces | result |
|---|---|---|
| sd01a | forge flower runs on the paving | invisible: a run is a low strip under a metre long |
| sd01b | raised flower beds 1.5x, spiral topiary, rose bushes | visible, but the bloom mesh reads as purple lettuce |
| sd01c | same, world-wide | patchy; a lamp stood in the middle of a bed |
| **sd01d/e** | **GA05's hero planter** -- the ivory trough with a gold lip, three rows of flower runs raised to the rim | reads as a real Wonderland planter |

The streets now speak the corridor's language -- the one planting in the world already proven from a camera --
instead of inventing a weaker one.

## Clearance, measured twice

Pieces are placed by geometry, so some land on columns, benches or doorways. Every candidate is tested two ways,
because each test is blind where the other sees:

- `probe_site_clear.py` box overlap in the editor world -- catches walls and actors, but is BLIND TO BATCHES,
  which have no editor collision;
- distance against `city_props.json`, a census of 10,104 props of which 9,291 are batch instances -- balustrades,
  columns, gates, lamps, benches. Linear props (balustrades, hedges) are capped at 80 uu, because a bounds-diagonal
  disc around a 4 m balustrade excluded 160 of one district's 180 pieces, most of them beds that belonged in front
  of it. Gates, steps, columns and trees keep their full footprint.

Lamps are placed WITHOUT collision: a lamp you walk through is a small flaw, one that blocks a doorway nobody
checked is a traversal bug, and traversal is a protected system.

Final: 778 pieces and 222 lamps world-wide, 473 candidates dropped for clearance, 9,054 instances in batches.

## Three bugs the frames and counts caught

- **A lamp in a flower bed.** Edge midpoints got both. Lamps now stand at corners.
- **Two lamps shoulder to shoulder** at every corner two edges share. One lamp per 9 m now.
- **Site ids drifted.** They were sequential, so skipping one duplicate lamp shifted every later id and the
  clearance answers stopped matching their candidates -- beds halved from 778 to 432 on a change that only touched
  lamps. Ids are positions now; a position cannot drift when a different piece is filtered.

`sd01e.jpg`: SW plaza now has one lamp and a planter packed with flowers; the hero camera and the world view are
unchanged. Map saved.
