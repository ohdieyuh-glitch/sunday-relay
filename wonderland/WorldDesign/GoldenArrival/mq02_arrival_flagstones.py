#!/usr/bin/env python3
"""MQ02 -- the arrival plaza laid in real stone: flagstone fields over the V2 slabs.

THE GAP (founder quality directive and environment quality reference, 2026-09-13). The first ground every visitor
stands on is the arrival plaza: 12 x 23 m of V2 plaza slabs, one smooth tile shape on a grid, hairline joints, every
top in one plane -- a tinted sheet, however good its material (MQ01). The reference's plaza is chunky individual stones
in a loose light/dark checker, bevelled, a little proud or sunk against their neighbours, moss in the joints.

WHAT THIS LAYER ADDS. The forge's flagstone fields (paving family, GAP 18: 4 m patches of chamfered stones 5.0-5.9 cm
proud in three tints over a moss bed) laid over the plaza slabs (tops z 12-13, census 267):
  SIDE COLUMNS  x +200..+600 and -600..-200: six courses of patches from y -1500 to +840, each 3.9 m deep.
  CENTRE        x -200..+200: three patches from y -1500 to -360; then the PORTAL APRON, y -360..+300, left as the old
                slabs so the portal's rune rings (r 2.41 m at the origin, 5 cm proud) stay clear, framed by a gold course
                along its edges; then one patch from +300 to +840, turned 90 degrees so its courses run the long way.
Patch variants (A/B/C) and 180-degree turns alternate so no two neighbours repeat. Every patch is one instance of
four batches (three stone tints and the moss bed), no collision -- the slabs under them carry the walk.

GA07's plaza ornament (lane borders, rose bands, the plaza medallion) is re-laid on the new stone tops by GA07 itself
(its PLAZA_BASE moves to 18.3 and its plaza medallion to y 570, r 250, inside the stone field).
MEASURED INPUTS. Census 267 (plaza slab centres x -604..610, y -1436..740, tops 12-13); spawn actors 268 (portal rings
at the origin, gate leaves at y -870, x +/-200); kit_modules.json (flagstone parts and materials).
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "MQ02"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
DATUM = 12.3
X_COLS = (-400.0, 400.0)
SIDE_Y0, SIDE_Y1, SIDE_ROWS = -1500.0, 840.0, 6
CENTRE_ROWS = (-1500.0, -360.0, 3)
APRON = (-200.0, 200.0, -360.0, 300.0)
TOP_PATCH = (300.0, 840.0)
VARIANTS = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
KERB = "/Game/WonderlandV2/Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone"


def build():
    batches = {}

    def inst(mesh, material, x, y, z, yaw, sx, sy, sz, key=None):
        k = key or "%s_%s_%s" % (PASS, mesh.split(".")[-1].replace("WL_Ground_", ""), material.replace("MI_V2_", ""))
        b = batches.setdefault(k, {"id": k, "mesh": mesh, "material": material, "instances": [], "collides": False,
                                   "cast_shadow": True, "affect_df": False})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 2), 0.0, round(yaw, 1), 0.0, round(sx, 4), round(sy, 4), round(sz, 4)])

    def patch(n, x, y, yaw, sx, sy):
        for part in KIT[VARIANTS[n % 3]]["parts"]:
            inst(part["mesh"], part["material"], x, y, DATUM, yaw, sx, sy, 1.0)

    placed = []
    n = 0
    depth = (SIDE_Y1 - SIDE_Y0) / SIDE_ROWS
    for ci, x in enumerate(X_COLS):
        for r in range(SIDE_ROWS):
            y = SIDE_Y0 + depth * (r + 0.5)
            patch(n, x, y, 180.0 * ((r + ci) % 2), 1.0, depth / 400.0)
            placed.append([x, round(y), "side"])
            n += 1
    y0, y1, rows = CENTRE_ROWS
    d = (y1 - y0) / rows
    for r in range(rows):
        y = y0 + d * (r + 0.5)
        patch(n + 1, 0.0, y, 180.0 * (r % 2), 1.0, d / 400.0)
        placed.append([0.0, round(y), "centre"])
        n += 1
    ty0, ty1 = TOP_PATCH
    # turned 90 degrees: local x (the courses) runs along the plaza's length, stretched to the patch's depth
    patch(n + 2, 0.0, (ty0 + ty1) * 0.5, 90.0, (ty1 - ty0) / 400.0, 1.0)
    placed.append([0.0, round((ty0 + ty1) * 0.5), "top"])

    # the portal apron's gold frame, on the old slabs just inside the stone edge
    ax0, ax1, ay0, ay1 = APRON
    def strip(x0, y0_, x1, y1_):
        import math
        length = math.hypot(x1 - x0, y1_ - y0_)
        count = max(1, int(round(length / 118.0)))
        yaw = math.degrees(math.atan2(y1_ - y0_, x1 - x0))
        for i in range(count):
            t = (i + 0.5) / count
            inst(KERB, "MI_V2_Gold", x0 + (x1 - x0) * t, y0_ + (y1_ - y0_) * t, 12.8, yaw, length / count / 120.0 * 1.01,
                 16.0 / 36.2, 2.2 / 28.2, key="%s_ApronGold" % PASS)
    inset = 14.0
    strip(ax0 + inset, ay0 + inset, ax1 - inset, ay0 + inset)
    strip(ax0 + inset, ay1 - inset, ax1 - inset, ay1 - inset)
    strip(ax0 + inset, ay0 + inset, ax0 + inset, ay1 - inset)
    strip(ax1 - inset, ay0 + inset, ax1 - inset, ay1 - inset)
    return {"pass": PASS, "title": "Arrival plaza laid in flagstone fields; portal apron framed in gold",
            "folder": "Wonderland/Authored/MQ02", "tags": ["V2_Arrival"], "actors": [], "batches": list(batches.values()),
            "patches": placed}


if __name__ == "__main__":
    spec = build()
    out = HERE / "mq02_arrival_flagstones.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d patches, %d batches, %d instances -> %s" % (PASS, len(spec["patches"]), len(spec["batches"]),
          sum(len(b["instances"]) for b in spec["batches"]), out.name))
