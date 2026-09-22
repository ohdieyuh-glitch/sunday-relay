# BR01: the world becomes walkable (SAVED 2026-09-22)

Founder beta directive: "A beautiful screenshot is not enough for beta. The world must function." This is the first
functional audit, and it found the largest blocker in the world.

## The audit (`zzFA00_collision_audit.json`, rows in `collision_audit_rows.json`)
19,819 drawing actors, by what they draw and whether they collide:

| kind | collision | actors | instances |
|---|---|---|---|
| architecture | QUERY_AND_PHYSICS (BlockAll) | 14,852 | 14,852 |
| architecture | **NoCollision** | 691 | **14,557** |
| ground | QUERY_AND_PHYSICS | 629 | 629 |
| ground | **NoCollision** | 458 | **29,909** |
| foliage | NoCollision | 1,178 | 62,288 |

The single-mesh actors block movement. The BATCHES -- which is how most of the city is drawn -- did not. A beta
player would walk through most buildings and stand on the world slab, 26 cm below the pavement they can see.

(The first run of this audit reported "?" for all 19,819 rows: a primitive's collision answers to methods, not to
get_editor_property. Fixed before any conclusion was drawn.)

## Proven by walking, not by reading
`walk_route.py` drives the Relay Dog with real movement input along the Icarus March and reports where it sticks.

| leg | before | after |
|---|---|---|
| causeway south | reached, standing z=75 | reached, standing **z=101** |
| causeway mid | reached, z=75 | reached, **z=101** |
| **into a gatehouse tower** | **reached** -- walked through 26 m of stone | **stuck** -- blocked |
| through the 8 m gate passage | reached | reached |

z=75 is the pawn standing on the world slab; z=101 is the same pawn standing on the pavement (paving top +12 plus an
88 cm capsule half-height). The tower leg is the honest proof: before, a player could walk through the gatehouse;
after, they cannot, while the passage still lets them through.

## What changed
`set_batch_collision.py`, reversibly: 687 batches, 36,955 instances, kinds ARCHITECTURE and GROUND only.
Foliage (1,148 batches) was deliberately left alone -- a player should walk through a flower bed -- and batches over
4,000 instances are skipped, since thousands of physics bodies for grass buys nothing. 1,154 batches now collide.

## Cost
`perf_frames.py` (new: perf_remove_ab prices a pass by destroying actors, and a collision flag has no actors to
destroy), four cameras, same session: mean **50.03 ms before, 51.25 ms after**. +1.2 ms, inside the per-camera noise
(single cameras move 4 ms in both directions). Cheap for a world that can be walked.

## Spawn safety (`zzFD10_spawn_audit.json`)
The arrival spawn and two march points: ground under all three, 3.5 m of headroom, 6 m of clear radius, and a drop
of 1.1-1.3 m to the floor. No spawn is inside geometry or over a hole.

## Still open
- 835 "other" batches (lanterns, banners, urns and such) remain NoCollision. A lamp post a player walks through is a
  smaller fault than a building, but it is on the list.
- Foliage stays walk-through by choice, including the 89 trees. If trees should stop a player, that is a decision,
  not a bug.
