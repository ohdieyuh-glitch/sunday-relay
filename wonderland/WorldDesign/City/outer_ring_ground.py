#!/usr/bin/env python3
"""GF03/04/05 -- put the outer-ring gardens on the ground that is actually there, and out of what now stands there.

WHY THIS EXISTS (2026-09-28, world completion, CORE C1). The three outer-ring garden fills were authored on
2026-09-23 (aeb23263) and are ABSENT from today's map: the census of every placement, taken with every World
Partition region resident, has no GF03/GF04/GF05 row. They are the fills that close Golden Arrival's 390-500 m
edge, so they go back -- but not as written:

  THE GROUND MOVED UNDER THEM. garden_fill_east.py lays every piece at z = +12, the paved shelf inside the city.
  The outer ring is not paved: the grass tufts growing there sit on the -14 plain (the census reads -14 under
  every GF03 bed that has grass near it). Applied as written, every planter, flower run and lamp would float
  26 cm above the lawn. So each piece is re-seated on the surface under it: the top of any paving, flagstone,
  kerb run or terrace plate whose footprint covers the point, else the -14 plain -- keeping the piece's own
  height above the +12 it was authored against (a lamp head stays 166 above its post's foot).

  THE WORLD GREW INTO THEM. Since 09-23 skyline towers and other passes landed in this ring. A piece whose point
  falls inside an existing solid's footprint is dropped rather than planted through a wall. A solid is a building
  -sized thing standing on the ground -- halls, towers, fountains, roofs over walls, hedge runs -- tested in its
  own rotated frame. A tree's canopy is not one: flowers under a tree are a garden, so only its trunk counts.

SOURCE AND DERIVED. *.authored.json are the 09-23 specs byte-for-byte (aeb23263). This script reads only those
and writes the grounded <name>.json that apply_layer applies, so running it twice gives the same answer and a
design change goes into the authored file (or garden_fill_east.py) and is grounded again. The census it reads is
Tools/captures/zc/census/world_census.csv.gz, taken with every World Partition region resident.

    python WorldDesign/City/outer_ring_ground.py

First grounded 2026-09-28: GF03 1643 kept / 210 dropped, GF04 1410 / 98, GF05 1153 / 92.
"""
import csv
import gzip
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent
CENSUS = PROJECT / "Tools" / "captures" / "zc" / "census" / "world_census.csv.gz"
SPECS = ["gf03_outer_ring_west.json", "gf04_outer_ring_north.json", "gf05_outer_ring_south.json"]
AUTHORED_Z = 12.0          # the shelf garden_fill_east.py assumed
PLAIN_Z = -14.0            # the ground beyond the city's paving (ground-shelves record)
SURFACE_WORDS = ("flagstone", "paving", "kerb_run", "terrace_platform", "plaza_slab", "verge_run", "garden_lawn",
                 "plaza_medallion")
# WHERE A SURFACE'S TOP REALLY IS. The census gives a pivot and a half-height, not a top, and the pivots differ:
# SM_garden_lawn hangs BELOW its pivot (origin z -12, extent 11.5: top = pivot - 0.5), SM_terrace_platform and
# the WL_ kit stand on theirs (top = pivot + 2 x half-height), the ground slab cube is centred. Reading the lawn
# as centred put its top at +10 instead of -2 (first grounding, 2026-09-28).
MESH_BOUNDS = {name: (b["origin"][2], b["ext"][2])
               for name, b in json.loads((HERE.parent / "mesh_bounds.json").read_text(encoding="utf-8"))["meshes"].items()}


def surface_top(mesh, z, ez):
    if mesh in MESH_BOUNDS and MESH_BOUNDS[mesh][1] > 0.0:
        oz, ext = MESH_BOUNDS[mesh]
        return z + (oz + ext) * (ez / ext)
    if mesh.startswith("WL_"):
        return z + 2.0 * ez
    return z + ez
SOFT_WORDS = ("tuft", "grass", "petal", "leaf", "daisy", "rose", "flower", "bloom", "moss", "lawn", "sky_")
SOLID_MIN_HALF = 150.0     # a solid worth dodging is at least 3 m across
CELL = 2000.0
TILE = 20000.0             # 200 m: the World Partition tile each derived batch is cut to


def covered_cells(x, y, reach):
    """EVERY grid cell a footprint can touch -- not just the cells at its corners. The first version took the
    four corners only, which is blind to the middle of anything wider than two cells: a 72 m lawn or a 100 m
    hedge run was invisible wherever its interior was being asked about."""
    return [(gx, gy) for gx in range(int((x - reach) // CELL), int((x + reach) // CELL) + 1)
            for gy in range(int((y - reach) // CELL), int((y + reach) // CELL) + 1)]


def in_footprint(item, x, y):
    sx, sy, ex, ey, c, s = item[:6]
    dx, dy = x - sx, y - sy
    return abs(dx * c + dy * s) <= ex and abs(-dx * s + dy * c) <= ey


def main():
    surfaces = defaultdict(list)       # cell -> (x, y, ex, ey, cos, sin, top)
    solids = defaultdict(list)         # cell -> (x, y, ex, ey, cos, sin, mesh)
    with gzip.open(CENSUS, "rt", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["kind"] not in ("SMA", "ISM"):
                continue
            x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
            ex, ey, ez = float(r["ex"]), float(r["ey"]), float(r["ez"])
            if not (25000.0 <= math.hypot(x, y) <= 61000.0) or z < -50000.0:     # SINK_UU trims are not world
                continue
            mesh = r["mesh"].lower()
            # The census extents are the mesh's own (unrotated) half-sizes, so every footprint is tested in the
            # piece's own frame: a hedge run laid on a diagonal covers a strip, not the square around it.
            yaw = math.radians(float(r["yaw"] or 0.0))
            c, s = math.cos(yaw), math.sin(yaw)
            reach = math.hypot(ex, ey)
            if any(w in mesh for w in SURFACE_WORDS):
                top = surface_top(r["mesh"], z, ez)
                for cell in covered_cells(x, y, reach):
                    surfaces[cell].append((x, y, ex, ey, c, s, top))
            elif "canopy" in mesh:
                # A TREE'S CANOPY IS OVERHEAD. Flowers under a tree are a garden; only the trunk is in the way.
                # (First run dropped 395 pieces under canopies; hedges, halls and towers stay solid.)
                for cell in covered_cells(x, y, 80.0):
                    solids[cell].append((x, y, 80.0, 80.0, 1.0, 0.0, r["mesh"]))
            elif ex >= SOLID_MIN_HALF and ey >= SOLID_MIN_HALF and ez >= 150.0 \
                    and not any(w in mesh for w in SOFT_WORDS):
                for cell in covered_cells(x, y, reach):
                    solids[cell].append((x, y, ex, ey, c, s, r["mesh"]))

    def ground(x, y):
        best = None
        for item in surfaces.get((int(x // CELL), int(y // CELL)), ()):
            if item[6] < 60.0 and in_footprint(item, x, y):
                best = item[6] if best is None else max(best, item[6])
        return PLAIN_Z if best is None else best

    def inside_solid(x, y):
        for item in solids.get((int(x // CELL), int(y // CELL)), ()):
            if in_footprint(item, x, y):
                return item[6]
        return None

    for name in SPECS:
        path = HERE / name
        spec = json.loads((HERE / name.replace(".json", ".authored.json")).read_text(encoding="utf-8"))
        seated, dropped, grounds, blockers = 0, 0, Counter(), Counter()
        tiled = []
        for batch in spec["batches"]:
            tiles = {}
            for inst in batch["instances"]:
                x, y, z = inst[0], inst[1], inst[2]
                blocker = inside_solid(x, y)
                if blocker:
                    dropped += 1
                    blockers[blocker] += 1
                    continue
                g = ground(x, y)
                grounds[round(g)] += 1
                inst = list(inst)
                inst[2] = round(g + (z - AUTHORED_Z), 1)
                tiles.setdefault((math.floor(x / TILE), math.floor(y / TILE)), []).append(inst)
                seated += 1
            # ONE BATCH PER 200 m WORLD TILE. World Partition pages an actor by its bounds, and the authored batches
            # spanned up to 571 m of the ring: actors that big are promoted to a grid level that never unloads.
            # Same tile as the WORLD session's wedges (floor(x / 20000), floor(y / 20000)).
            for (tx, ty), rows in sorted(tiles.items()):
                piece = dict(batch)
                piece["id"] = "%s_t%d_%d" % (batch["id"], tx, ty)
                piece["instances"] = rows
                tiled.append(piece)
        spec["batches"] = tiled
        spec["ground_note"] = ("re-seated 2026-09-28 by outer_ring_ground.py: -14 plain unless paving covers the "
                               "point; pieces inside an existing solid dropped; one batch per 200 m world tile")
        path.write_text(json.dumps(spec, indent=1), encoding="utf-8")
        span = max(max(r[0] for r in b["instances"]) - min(r[0] for r in b["instances"]) for b in tiled) / 100.0
        print("%s  seated %d  dropped %d  in %d tiled batches (widest %.0f m)  ground z: %s"
              % (name, seated, dropped, len(tiled), span, dict(grounds.most_common(5))))
        print("    dropped inside: %s" % ", ".join("%s %d" % kv for kv in blockers.most_common(8)))


if __name__ == "__main__":
    main()
