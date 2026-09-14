#!/usr/bin/env python3
"""GA05 -- flowers at the visitor's feet on the arrival plaza.

WHAT WAS THERE. From HeroCam_GoldenArrivalBible the lower 40 percent of the frame is empty pale
paving; the Marble reference puts flower beds right beside the viewer. The plaza is the spawn and
the first thing every visitor walks across, so the middle stays open.

WHAT THIS LAYER ADDS. Two long planters each side of the plaza's inner edge (x +/-470, clear of the
side steps at +/-660 and the gold studs at y -800 and 100), planted with blooms, blossom clusters and roses,
framing the view up the garden path. The central lane (x +/-390) and the portal stay clear.

MEASURED INPUTS. obstacles_arrival_plaza.json; the spawn V2_ArrivalSpawn is at (0, -1460) yaw 90;
plaza slab tops are z ~+12 (arrival anchor probe); planter box 210 x 210 x 70 at 1x.

JUDGED AGAINST (historical): this pass was judged against the Marble image, the authority at the time.
The current authority is the GPT Wonderland Bible boards (WorldDesign/VISUAL_AUTHORITY.md, 2026-09-13).
"""
import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
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
            # FL01 (2026-09-13): planted with the forge's flower bed runs (GAP 19) where SM_flower_bed_blooms, blossom
            # clusters and SM_rose_bloom read as colour pads and bowls.
            # FL01c: at soil level and in two rows the planters read nearly empty from the hero camera, and MI_V2_Lavender
            # washed to white in full sun. Three rows now, raised to the rim and 30% taller so the planting mounds over
            # it; lavender takes the deeper violet.
            rows = [(sx - math.copysign(44.0, sx), [("WL_Flower_Daisy_Run", "MI_V2_PetalViolet"), ("WL_Flower_Daisy_Run", "MI_V2_PetalPink"),
                                                   ("WL_Flower_Daisy_Run", "MI_V2_PetalViolet")]),
                    (sx, [("WL_Flower_Rose_Run", "MI_V2_RosePink"), ("WL_Flower_Lavender_Run", "MI_V2_PetalViolet"),
                          ("WL_Flower_Rose_Run", "MI_V2_RoseRed" if k % 2 else "MI_V2_RosePink")]),
                    (sx + math.copysign(40.0, sx), [("WL_Flower_Lavender_Run", "MI_V2_PetalViolet"), ("WL_Flower_Rose_Run", "MI_V2_RoseRed"),
                                                    ("WL_Flower_Lavender_Run", "MI_V2_PetalViolet")])]
            for r_i, (row_x, row) in enumerate(rows):
                for j, (module, petal) in enumerate(row):
                    for part in KIT[module]["parts"]:
                        MESH.setdefault(part["mesh"], part["mesh"])
                        material = petal if part["part"] == "petal" else ("MI_V2_LeafDark" if part["part"] == "leaf" and (j + r_i) % 2 else part["material"])
                        key = "Planter_%s_%s_%s" % (module.replace("WL_Flower_", "").replace("_Run", ""), part["part"], material.split("_")[-1])
                        instance(key, part["mesh"], material, (row_x, py - 114.0 + j * 114.0 + (r_i - 1) * 20.0, top - 3.0),
                                 [0.95, 0.9, 1.3], 90.0 + rng.uniform(-3, 3))

    return {"pass": "GA05", "title": "Arrival plaza planters: flowers beside the visitor, central lane clear",
            "folder": "Wonderland/Authored/GA05", "tags": ["V2_Arrival"], "actors": actors, "batches": list(batches.values())}


if __name__ == "__main__":
    spec = build()
    out = HERE / "ga05_arrival_plaza_planters.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("GA05: %d actors, %d batches, %d instances -> %s" % (len(spec["actors"]), len(spec["batches"]),
                                                           sum(len(b["instances"]) for b in spec["batches"]), out.name))
