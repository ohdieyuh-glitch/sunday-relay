#!/usr/bin/env python3
"""GA05 -- flowers at the visitor's feet on the arrival plaza.

WHAT WAS THERE. From HeroCam_V2_MarbleReference the lower 40 percent of the frame is empty pale
paving; the Marble reference puts flower beds right beside the viewer. The plaza is the spawn and
the first thing every visitor walks across, so the middle stays open.

WHAT THIS LAYER ADDS. Two long planters each side of the plaza's inner edge (x +/-470, clear of the
side steps at +/-660 and the gold studs at y -800 and 100), planted with blooms, blossom clusters and roses,
framing the view up the garden path. The central lane (x +/-390) and the portal stay clear.

MEASURED INPUTS. obstacles_arrival_plaza.json; the spawn V2_ArrivalSpawn is at (0, -1460) yaw 90;
plaza slab tops are z ~+12 (arrival anchor probe); planter box 210 x 210 x 70 at 1x.
"""
import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLAZA_TOP = 12.0
V2 = "/Game/WonderlandV2/"
MESH = {
    "planter": V2 + "Props/Garden/SM_planter_box.SM_planter_box",
    "blooms0": V2 + "Vegetation/Flowers/SM_flower_bed_blooms_0.SM_flower_bed_blooms_0",
    "blooms3": V2 + "Vegetation/Flowers/SM_flower_bed_blooms_3.SM_flower_bed_blooms_3",
    "blossom": V2 + "Vegetation/Flowers/SM_blossom_cluster.SM_blossom_cluster",
    "rose_bloom": V2 + "Vegetation/Roses/SM_rose_bloom.SM_rose_bloom",
    "kerb": V2 + "Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone",
}


def build():
    rng = random.Random(20260913 + 5)
    actors, batches = [], {}

    def actor(id_, mesh, loc, materials, scale, yaw=0.0, collision="block"):
        actors.append({"id": id_, "mesh": MESH[mesh], "loc": [round(v, 2) for v in loc], "rot": [0.0, yaw, 0.0],
                       "scale": [round(v, 4) for v in scale], "materials": materials, "collision": collision})

    def instance(batch_id, mesh, material, loc, scale, yaw):
        key = "%s_%s" % (batch_id, material.split("_")[-1])
        b = batches.setdefault(key, {"id": key, "mesh": MESH[mesh], "material": material, "instances": [], "collides": False,
                                     "cast_shadow": True, "affect_df": False})
        s = scale if isinstance(scale, (list, tuple)) else [scale] * 3
        b["instances"].append([round(loc[0], 1), round(loc[1], 1), round(loc[2], 2), 0.0, round(yaw, 1), 0.0] + [round(v, 3) for v in s])

    planter_scale = (0.78, 1.7, 0.95)                  # 164 x 357 x 67 cm, long along the plaza
    top = PLAZA_TOP + 70.0 * planter_scale[2]
    for side, sx in (("L", 470.0), ("R", -470.0)):
        for k, py in enumerate((-370.0, 420.0)):
            actor("Planter%s%d" % (side, k), "planter", (sx, py, PLAZA_TOP), ["MI_V2_IvoryStone"], planter_scale)
            # A gold lip on the planter's plaza-facing edge.
            actor("Planter%s%d_GoldLip" % (side, k), "kerb", (sx - math.copysign(84.0, sx), py, top - 6.0), ["MI_V2_Gold"], (2.9, 0.35, 0.4), yaw=90.0, collision="none")
            for j, dy in enumerate((-110.0, 0.0, 110.0)):
                bloom_material = ["MI_V2_PetalPink", "MI_V2_RoseRed", "MI_V2_PetalViolet"][(j + k) % 3]
                instance("PlanterBlooms", "blooms0" if j % 2 == 0 else "blooms3", bloom_material, (sx, py + dy, top - 18.0), (0.72, 0.62, 0.9), 90.0 + rng.uniform(-6, 6))
            # GA05a planted SM_lavender_heads here: heads with no stems read as white spikes floating
            # half a metre over the soil. Blossom clusters sit on the soil and carry the lavender tone.
            for j in range(3):
                material = "MI_V2_PetalViolet" if (j + k) % 2 == 0 else "MI_V2_PetalPink"
                instance("PlanterBlossom", "blossom", material, (sx + math.copysign(40.0, sx), py - 120.0 + j * 120.0, top - 12.0), rng.uniform(0.4, 0.48), rng.uniform(0, 360))
            for j in range(5):
                material = "MI_V2_RoseRed" if j % 2 else "MI_V2_RosePink"
                instance("PlanterRoses", "rose_bloom", material, (sx - math.copysign(30.0, sx) + rng.uniform(-20, 20), py - 140.0 + j * 70.0, top - 30.0), rng.uniform(0.42, 0.55), rng.uniform(0, 360))

    return {"pass": "GA05", "title": "Arrival plaza planters: flowers beside the visitor, central lane clear",
            "folder": "Wonderland/Authored/GA05", "tags": ["V2_Arrival"], "actors": actors, "batches": list(batches.values())}


if __name__ == "__main__":
    spec = build()
    out = HERE / "ga05_arrival_plaza_planters.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("GA05: %d actors, %d batches, %d instances -> %s" % (len(spec["actors"]), len(spec["batches"]),
                                                           sum(len(b["instances"]) for b in spec["batches"]), out.name))
