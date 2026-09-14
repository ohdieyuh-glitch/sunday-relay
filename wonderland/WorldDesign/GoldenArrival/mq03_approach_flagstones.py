#!/usr/bin/env python3
"""MQ03 -- the processional approach laid in real stone.

THE GAP (founder quality directive and environment quality reference, 2026-09-13). GA04's avenue from the rear golden
gate to the arrival apron is four columns of V2 plaza slabs on a 128 cm grid (x -256..+256, tops z -0.5): the same
tinted sheet MQ02 replaced on the arrival plaza and the garden path. The corridor survey (corr2) showed it plainly
from the rear gate: a clean tile strip between flower beds.

WHAT THIS LAYER ADDS. The forge's flagstone fields (GAP 18) over the avenue, as MQ02: patches 4.8 m wide (x +/-240,
inside GA04's kerbs at +/-262), in two runs either side of the rondel -- y -6450..-4600 and -3400..-1580 -- so the
rondel's own radial courses and its flower bed are untouched. Variants and half-turns alternate; no collision (the
slabs carry the walk).
MEASURED INPUTS. GA04's own constants: Y_START -6450, Y_END -1580, HALF_WIDTH 240, RONDEL_Y -4000, RONDEL_R 560, slab
tops at GROUND -14 + 0.5 + 13 = -0.5. kit_modules.json.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "MQ03"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
VARIANTS = ("WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C", "WL_Ground_Flagstone_A")
DATUM = -0.5
HALF = 240.0
RUNS = ((-6450.0, -4600.0, 5), (-3400.0, -1580.0, 5))


def build():
    batches = {}

    def inst(mesh, material, x, y, z, yaw, sx, sy, sz):
        k = "%s_%s_%s" % (PASS, mesh.split(".")[-1].replace("WL_Ground_", ""), material.replace("MI_V2_", ""))
        b = batches.setdefault(k, {"id": k, "mesh": mesh, "material": material, "instances": [], "collides": False,
                                   "cast_shadow": True, "affect_df": False})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 2), 0.0, round(yaw, 1), 0.0, round(sx, 4), round(sy, 4), round(sz, 4)])

    placed = []
    n = 0
    for y0, y1, rows in RUNS:
        d = (y1 - y0) / rows
        for r in range(rows):
            y = y0 + d * (r + 0.5)
            for part in KIT[VARIANTS[n % 3]]["parts"]:
                inst(part["mesh"], part["material"], 0.0, y, DATUM, 180.0 * (n % 2), HALF * 2.0 / 400.0, d / 400.0, 1.0)
            placed.append([0.0, round(y)])
            n += 1
    return {"pass": PASS, "title": "Processional approach laid in flagstone fields either side of the rondel",
            "folder": "Wonderland/Authored/MQ03", "tags": ["V2_Arrival"], "actors": [], "batches": list(batches.values()),
            "patches": placed}


if __name__ == "__main__":
    spec = build()
    out = HERE / "mq03_approach_flagstones.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d patches, %d batches, %d instances -> %s" % (PASS, len(spec["patches"]), len(spec["batches"]),
          sum(len(b["instances"]) for b in spec["batches"]), out.name))
