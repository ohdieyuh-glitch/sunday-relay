#!/usr/bin/env python3
"""MQ04 -- the Heart Garden's walk to the palace laid in real stone.

THE GAP (corridor survey corr2, 2026-09-13). From the Clock Plaza to the palace dais the walk is one 2.8 m terrace
platform from (-25, 6923) to (425, 9477), top z 19 (GA02's measured inputs): a smooth plank across the lawn under the
rose arches -- the last tile strip on the hero corridor after MQ02 and MQ03.

WHAT THIS LAYER ADDS. Flagstone fields (GAP 18) along it: six patches turned to the walk's heading (80 degrees),
each stretched to a sixth of its 25.9 m and narrowed to 2.8 m, on a 19.0 datum. No collision.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "MQ04"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
A, B = (-25.0, 6923.0), (425.0, 9477.0)
WIDTH, DATUM, PATCHES = 280.0, 19.0, 6
VARIANTS = ("WL_Ground_Flagstone_C", "WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B")


def build():
    batches = {}
    length = math.hypot(B[0] - A[0], B[1] - A[1])
    heading = math.degrees(math.atan2(B[1] - A[1], B[0] - A[0]))
    for k in range(PATCHES):
        t = (k + 0.5) / PATCHES
        x, y = A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t
        for part in KIT[VARIANTS[k % 3]]["parts"]:
            key = "%s_%s_%s" % (PASS, part["mesh"].split(".")[-1].replace("WL_Ground_", ""), part["material"].replace("MI_V2_", ""))
            b = batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": part["material"], "instances": [],
                                         "collides": False, "cast_shadow": True, "affect_df": False})
            # local x runs along the walk (yaw = heading), stretched to the patch's length; local y across it
            b["instances"].append([round(x, 1), round(y, 1), DATUM, 0.0, round(heading + 180.0 * (k % 2), 1), 0.0,
                                   round(length / PATCHES / 400.0 * 1.01, 4), round(WIDTH / 400.0, 4), 1.0])
    return {"pass": PASS, "title": "Heart Garden walk to the palace laid in flagstone fields",
            "folder": "Wonderland/Authored/MQ04", "tags": ["V2_Garden"], "actors": [], "batches": list(batches.values())}


if __name__ == "__main__":
    spec = build()
    out = HERE / "mq04_palace_walk_flagstones.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d batches, %d instances -> %s" % (PASS, len(spec["batches"]), sum(len(b["instances"]) for b in spec["batches"]), out.name))
