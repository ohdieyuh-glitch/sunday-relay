"""An arrival court for a withheld district, in the Golden Arrival's language (RG01 generalised, 2026-09-15).

Round paved court about the visitor's feet: plaza slabs in courses, a warm edge band over the outer course, a gold rim
line, a gold-and-rose medallion, a lamp pair, beds of forge flower runs round the rim (open where paths run), and
optionally a stone rose garden arch climbed by roses at the court's front edge framing the view (rose_arch.py).

Heights: the court's top can sit above the lawn (to cover a raised path it crosses); a kerb step ring then splits the
rise so the Dog (31 cm steps) can walk on from any side. Everything is in the arrival frame of courtkit.Court.
"""
import json
import math
import sys
from pathlib import Path

import courtkit as K

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "GoldenArrival"))
import rose_arch  # noqa: E402

KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
RUNS = {"daisy": "WL_Flower_Daisy_Run", "lavender": "WL_Flower_Lavender_Run", "rose": "WL_Flower_Rose_Run"}
BED_KINDS = [("rose", "MI_V2_RosePink"), ("lavender", "MI_V2_PetalViolet"), ("daisy", "MI_V2_PetalWhite"), ("rose", "MI_V2_RoseRed")]


def _kit_batch(c, key, part, material, instance, collides=False):
    b = c.batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": material, "instances": [],
                                   "collides": collides, "cast_shadow": True, "affect_df": collides})
    b["instances"].append(instance)


def build(pass_id, ax, ay, yaw, lawn, court_top, seed, court_d=60.0, court_r=470.0, openings=((0.0, 35.0), (180.0, 35.0)),
          arch=True, arch_scale=0.9, arch_gap=40.0, bed_kinds=BED_KINDS, lamps=True, title=None):
    """openings: (angle in the arrival frame, half-width in degrees) where no flower bed is laid (paths, the view)."""
    floor = court_top - 13.5                      # slabs sit at floor + 0.5 and are 13 cm thick
    c = K.Court(pass_id, ax, ay, yaw, floor, seed)
    c.pave_disc("CourtSlabs", court_d, 0.0, -64.0, court_r + 30.0, floor)
    c.ring("CourtEdge", "MI_V2_PlazaWarm", court_d, 0.0, court_r + 30.0, 72.0, floor + 0.6, height=13.3)
    rise = court_top - lawn
    if rise > 26.0:                              # one kerb step at half the rise
        c.ring("CourtStep", "MI_V2_Kerb", court_d, 0.0, court_r + 78.0, 56.0, lawn, height=rise * 0.5)
        bed_r = court_r + 160.0
    else:
        c.ring("CourtKerb", "MI_V2_Kerb", court_d, 0.0, court_r + 70.0, 24.0, lawn, height=rise + 1.5)
        bed_r = court_r + 130.0
    c.ring("CourtRimGold", "MI_V2_Gold", court_d, 0.0, court_r + 44.0, 10.0, court_top + 0.5, 1.4)
    c.medallion(court_d, 0.0, 170.0, court_top)
    if lamps:
        c.lamp_pair("Court", court_d, court_r - 40.0, court_top)

    cx, cy = c.at(court_d, 0.0)
    n = int(round(2.0 * math.pi * bed_r / 120.0))
    k = 0
    for i in range(n):
        a = 360.0 * (i + 0.5) / n
        if any(abs((a - oa + 180.0) % 360.0 - 180.0) < half for (oa, half) in openings):
            continue
        kind, petal = bed_kinds[k % len(bed_kinds)]
        k += 1
        wa = math.radians(yaw + a)
        x, y = cx + bed_r * math.cos(wa), cy + bed_r * math.sin(wa)
        for part in KIT[RUNS[kind]]["parts"]:
            material = petal if part["part"] == "petal" else ("MI_V2_LeafDark" if part["part"] == "leaf" and k % 2 else part["material"])
            _kit_batch(c, "%s_Rim_%s_%s" % (pass_id, part["part"], material.replace("MI_V2_", "")), part, material,
                       [round(x, 1), round(y, 1), lawn, 0.0, round((yaw + a + 90.0) % 360.0, 1), 0.0, 1.05, 1.05, 1.05])

    if arch:
        arch_d = court_d + court_r + arch_gap
        ax_, ay_ = c.at(arch_d, 0.0)
        for part in KIT["WL_Arch_Garden_Rose"]["parts"]:
            if part["part"] == "veg_anchor":
                continue
            material = "MI_V2_Gold" if part["part"] == "gold" else "MI_V2_IvoryStone"
            _kit_batch(c, "%s_Arch_%s" % (pass_id, part["part"]), part, material,
                       [round(ax_, 1), round(ay_, 1), lawn, 0.0, round(yaw + 90.0, 1), 0.0, arch_scale, arch_scale, arch_scale],
                       collides=part["part"] == "stone")
        for j, (rx, ry, rz, rp, ryaw, rr, rs) in enumerate(rose_arch.climbing_runs(ax_, ay_, lawn, arch_scale, yaw + 90.0, run_s=0.95)):
            petal = "MI_V2_RoseRed" if j % 3 == 1 else "MI_V2_RosePink"
            leaf = "MI_V2_LeafDark" if j % 2 else "MI_V2_LeafMid"
            for part in KIT["WL_Flower_Rose_Run"]["parts"]:
                material = petal if part["part"] == "petal" else leaf
                _kit_batch(c, "%s_ArchRoses_%s_%s" % (pass_id, part["part"], material.replace("MI_V2_", "")), part, material,
                           [round(rx, 1), round(ry, 1), round(rz, 1), round(rp, 1), round(ryaw, 1), round(rr, 1), rs, rs, rs])
    layer = c.layer(title or "%s: arrival court" % pass_id)
    layer["arrival_yaw"] = yaw
    layer["court"] = {"centre": [round(cx, 1), round(cy, 1)], "radius": court_r + 106.0, "top": court_top}
    return layer
