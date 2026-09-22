#!/usr/bin/env python3
"""BC01 -- A BASE COURSE FOR GOLDEN ARRIVAL, laid on the buildings' REAL feet.

FOUNDER DIRECTIVE (2026-09-22): "facade-to-ground contact", "base plinths", "foundation transitions". A building
that meets the floor at a bare edge reads as a model set down on a surface; a base course is the single cheapest
thing that makes it read as BUILT. IC02 proved it on the Icarus district with 768 blocks, and the core -- the part
of Wonderland a player sees most -- has none.

THE TRAP THIS PASS EXISTS TO AVOID. building_census.json gives each building a bounding box, and a bounding box is
NOT a wall. WB01 learned this the hard way in September: plinths placed on census box faces stood in a trough, off
the masonry, because a castle hall's wall is 30-38 cm inside its bounds, a facade panel's 56 cm, a gatehouse's
210 cm. Placing a base course on a bounding box would repeat that exactly.

So this uses wall_sections_all.json, which holds MEASURED outlines: for each mesh, the actual wall segments sliced
at a series of heights. The lowest slice is the building's real foot, and the base course is laid along those
segments, transformed by each building's own position and yaw. A plinth therefore sits against masonry by
construction rather than by hope.

WHICH BUILDINGS. Those that actually stand on the ground (zmin within 30 cm of it -- a hall floating on a terrace
top gets its contact from the terrace, not from here) and that are big enough for a base course to read at all.
Blocks are scaled along their run so the course is CONTINUOUS rather than a row of separate stones, and the course
does not collide: a player already cannot walk into the wall behind it.

    python core_base_course.py         (writes bc01_base_course.json)
"""
import json
import math
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

TMP = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp")
KIT = json.loads((ROOT / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
CENSUS = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
SECTIONS = json.loads((TMP / "wall_sections_all.json").read_text(encoding="utf-8"))

PASS = "BC01"
PLINTH = KIT["WL_Detail_Plinth_Block"]
PLINTH_LEN = PLINTH["size"][0]          # 100 cm
#: A block is stretched along its run so the course reads as one continuous moulding. 4 m keeps the instance count
#: to something the world can carry: 19 km of perimeter at 1 m would be 19,000 blocks for a detail.
RUN = 400.0
GROUND_TOL = 30.0                       # how close to the floor a building must sit to get a course
MIN_HALF = 400.0                        # at least 8 m across, or the course is invisible
OUT_OFFSET = 6.0                        # stand the course just proud of the wall
CULL = 9000.0
MATERIAL = "MI_V2_AshlarMarblePale"


def outline(mesh):
    """The measured wall segments at the LOWEST sliced height: the building's real foot."""
    rec = SECTIONS.get(mesh)
    if not rec or not rec.get("levels"):
        return None
    lowest = sorted(rec["levels"], key=float)[0]
    return rec["levels"][lowest]


def main():
    batches = {}
    stats = Counter()

    def add(key, mesh, material, x, y, z, yaw, scale):
        bt = batches.setdefault(key, {"id": "%s_%s" % (PASS, key), "mesh": mesh, "material": material,
                                      "instances": [], "collides": False, "cast_shadow": False,
                                      "affect_df": False, "cull_distance": CULL})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                                round(scale[0], 3), round(scale[1], 3), round(scale[2], 3)])
        stats[key] += 1

    used, skipped = 0, Counter()
    for b in CENSUS:
        if b.get("zmin", 999.0) > GROUND_TOL:
            skipped["not on the ground"] += 1
            continue
        if max(b["hx"], b["hy"]) < MIN_HALF:
            skipped["too small to read"] += 1
            continue
        segs = outline(b["mesh"])
        if segs is None:
            skipped["no measured outline: " + b["mesh"]] += 1
            continue
        ca, sa = math.cos(math.radians(b["yaw"])), math.sin(math.radians(b["yaw"]))
        for x0, y0, x1, y1 in segs:
            dx, dy = x1 - x0, y1 - y0
            length = math.hypot(dx, dy)
            if length < RUN * 0.5:
                continue                       # a stub between two runs; the neighbours already cover it
            n = max(1, int(round(length / RUN)))
            step = length / n
            ux, uy = dx / length, dy / length
            # push the course very slightly OUT of the wall, along the segment's outward normal
            nx, ny = uy, -ux
            for i in range(n):
                t = (i + 0.5) * step
                lx = x0 + ux * t + nx * OUT_OFFSET
                ly = y0 + uy * t + ny * OUT_OFFSET
                wx = b["x"] + lx * ca - ly * sa
                wy = b["y"] + lx * sa + ly * ca
                yaw = b["yaw"] + math.degrees(math.atan2(uy, ux))
                add("BaseCourse", PLINTH["parts"][0]["mesh"], MATERIAL, wx, wy, b.get("zmin", 0.0), yaw,
                    (step / PLINTH_LEN, 1.0, 1.0))
        used += 1

    spec = {"pass": PASS,
            "tags": ["WL_CORE_DETAIL", "WL_BASE_COURSE"],
            "folder": "Wonderland/Authored/BC01_BaseCourse",
            "actors": [],
            "batches": [v for v in batches.values() if v["instances"]]}
    out = HERE / "bc01_base_course.json"
    out.write_text(json.dumps(spec, indent=1), encoding="utf-8")

    total = sum(len(v["instances"]) for v in spec["batches"])
    print("BC01 -> %s" % out.name)
    print("  buildings given a base course: %d" % used)
    print("  blocks %d  (~%d triangles at %d tris each)" % (total, total * PLINTH["tris"], PLINTH["tris"]))
    print("  skipped:")
    for k, n in skipped.most_common(8):
        print("    %-44s %5d" % (k, n))


if __name__ == "__main__":
    main()
