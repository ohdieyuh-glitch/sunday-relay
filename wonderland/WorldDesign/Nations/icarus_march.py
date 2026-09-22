#!/usr/bin/env python3
"""IC01 -- the Icarus March: the white nation's first built ground (2026-09-17).

THE CANON (CANON/NATIONS.md, founder directive today). Wonderland holds three nations around a neutral Golden
Arrival. ICARUS is the white one -- ivory, pearl, silver, bright glass, ethereal light -- and its sector runs from
bearing 30 to 150 degrees. The founder's rule for expansion: grow OUTWARD from the accepted city, never rebuild it,
and give a new region real nation identity instead of generic territory.

WHERE. Measured before building: the Icarus band from 500 m to 1 km holds 28 distant skyline halls and NOTHING else
-- no streets, no terraces, no props. So this lays the first ground a player would walk on leaving the core to the
north: a processional avenue on the axis due north, from the neutral core's edge at 500 m out to the threshold at
636 m, and nothing of Golden Arrival is touched.

WHAT, and why each piece. The march is Icarus saying what it is before a word is spoken:
  - a 14.4 m causeway of the city's own paving plates, wearing GR01's FLAGSTONE twin rather than the plain plaza
    material: the first cut used MI_V2_PlazaCream and read as one poured slab, which is the exact fault GR01 fixed
    in the core;
  - a medallion set into the causeway every 42 m, in the same flagstones so it reads as laid stone rather than a
    blank white disc (it did, at 28 m, in the second cut);
  - a fringe of grass where the causeway's edge steps down to the ground, the GT01 rule;
  - kerbs both sides, because WB01 and GT01 taught that an edge is what makes ground read as built;
  - balustrade runs in ICARUS PEARL, with newel urns at their joints in pearl and SILVER -- silver is the nation's
    accent metal where the core uses gold (make_nation_materials.py built it from the tuned gold instance);
  - grand pinnacles and slender white towers flanking, at 28 m, so the approach has Icarus's vertical silhouette
    from far off;
  - the kit's own ceremonial gatehouse on the axis where the march ends: two flanking drum towers, 26 m, with a
    machicolated bridge and an 8 m passage, in pearl with silver and white spires. The first cut used the garden
    gate threshold and it read as a plain white block with an arch in it; the kit already had the right building,
    which is the founder's rule about not making what exists;
  - planting along the outside of the balustrades, the boards' rule that ground is paving plus dense planting.

Materials are the city's premium set, re-tinted for the nation: MI_V2_IcarusPearl, MI_V2_IcarusSilver,
MI_V2_IcarusAshlar, with the core's PlazaCream paving and MarblePale kerbs.

    python icarus_march.py            (writes ic01_march.json)
"""
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
import nations                                                    # noqa: E402

KIT = json.loads((ROOT / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
# Every V2 mesh path here was read off the mesh itself (mesh_bounds_v2.json). The first cut guessed them by folder
# and the apply refused on "asset did not load" -- which is the layer system doing its job.

PASS = "IC01"
AXIS_X = 0.0
START_Y = 50000.0                # the neutral core's edge
END_Y = 63600.0                  # where the threshold stands
PAVING_TOP = 12.0                # the height the core's paving sits at
HALF_W = 720.0                   # the causeway's half width, one terrace plate
PLATE = {"mesh": "/Game/WonderlandV2/Architecture/Stairs/SM_terrace_platform.SM_terrace_platform",
         "len_y": 740.0, "top_local": 140.0}
KERB = {"mesh": "/Game/WonderlandV2/Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone", "len": 120.0}
TOWER = {"mesh": "/Game/WonderlandV2/Architecture/Castle/SM_castle_tower_slender.SM_castle_tower_slender"}
PEARL, SILVER, ASHLAR = "MI_V2_IcarusPearl", "MI_V2_IcarusSilver", "MI_V2_IcarusAshlar"
PART_MATERIAL = {"gold": SILVER, "stone": PEARL, "stone_dark": "MI_V2_Stone", "glass": "MI_V2_GlassTeal",
                 "roof": PEARL, "roof_alt": PEARL, "veg_anchor": "MI_V2_LeafMid", "kerb": "MI_V2_MarblePale",
                 "paving": "MI_V2_GroundFlag_PlazaCream", "paving_shade": "MI_V2_GroundFlag_PlazaShade",
                 "paving_warm": "MI_V2_GroundFlag_PlazaWarm",
                 "petal": "MI_V2_PetalWhite", "petal_centre": "MI_V2_LeafGold", "leaf": "MI_V2_LeafMid"}
PLANTS = [("/Game/WonderlandV2/Vegetation/Roses/SM_rose_bush.SM_rose_bush", "MI_V2_LeafMid", 93.0),
          ("/Game/WonderlandV2/Vegetation/Shrubs/SM_shrub_flowering.SM_shrub_flowering", "MI_V2_LeafMid", 184.0),
          ("/Game/WonderlandV2/Vegetation/Topiary/SM_topiary_cone_plain.SM_topiary_cone_plain", "MI_V2_LeafDark", 129.0)]
CULL_NEAR, CULL_FAR = 12000.0, 40000.0


def main():
    batches = {}
    stats = Counter()
    rng = random.Random(PASS)

    #: WHAT A PLAYER STANDS ON OR WALKS INTO. IC01 originally declared collides=False for EVERY batch, including
    #: the causeway a player is meant to walk along. BR01's world sweep later turned it on, so the fault was
    #: invisible -- until re-applying this pass reset it and the seam walk dropped straight back onto the world
    #: slab at z=75. A pass must declare its own collision; it cannot rely on a later sweep remembering.
    SOLID = ("Causeway", "Kerb", "Tower", "Gatehouse_Twin_stone", "Gatehouse_Twin_stone_dark",
             "Detail_Balustrade_Run_stone", "Detail_Pinnacle_Grand_stone", "Detail_Newel_Urn_stone")

    def add(key, mesh, material, x, y, z, yaw, scale=1.0, cull=CULL_NEAR, shadow=True):
        bt = batches.setdefault(key, {"id": "%s_%s" % (PASS, key), "mesh": mesh, "material": material,
                                      "instances": [], "collides": key in SOLID, "cast_shadow": shadow,
                                      "affect_df": False, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                                round(scale, 3), round(scale, 3), round(scale, 3)])
        stats[key] += 1

    def add_module(name, x, y, z, yaw, scale=1.0, cull=CULL_NEAR):
        for part in KIT[name]["parts"]:
            mat = PART_MATERIAL.get(part["part"], part["material"])
            add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], mat, x, y, z, yaw, scale, cull)

    # 1. the causeway
    n_plates = int((END_Y - START_Y) // PLATE["len_y"])
    for i in range(n_plates):
        y = START_Y + PLATE["len_y"] * (i + 0.5)
        add("Causeway", PLATE["mesh"], "MI_V2_GroundFlag_PlazaCream", AXIS_X, y, PAVING_TOP - PLATE["top_local"], 0.0,
            cull=CULL_FAR)
    # 2. kerbs down both edges
    n_kerbs = int((END_Y - START_Y) // KERB["len"])
    for i in range(n_kerbs):
        y = START_Y + KERB["len"] * (i + 0.5)
        for side in (-1.0, 1.0):
            add("Kerb", KERB["mesh"], "MI_V2_MarblePale", AXIS_X + side * HALF_W, y, PAVING_TOP, 90.0, cull=CULL_NEAR)
    # 3. balustrades just outside the kerbs, urns at their joints
    run = KIT["WL_Detail_Balustrade_Run"]["size"][0]
    n_runs = int((END_Y - START_Y) // run)
    for i in range(n_runs):
        y = START_Y + run * (i + 0.5)
        for side in (-1.0, 1.0):
            add_module("WL_Detail_Balustrade_Run", AXIS_X + side * (HALF_W + 60.0), y, PAVING_TOP, 90.0)
            if i % 2 == 0:
                add_module("WL_Detail_Newel_Urn", AXIS_X + side * (HALF_W + 60.0), y - run * 0.5, PAVING_TOP, 90.0)
    # 3b. a medallion set into the causeway every 28 m, and grass where its edge steps down to the ground
    med = KIT.get("WL_Ground_Plaza_Medallion")
    y = START_Y + 1400.0
    while med and y < END_Y - 1400.0:
        add_module("WL_Ground_Plaza_Medallion", AXIS_X, y, PAVING_TOP + 1.0, 0.0, cull=CULL_NEAR)
        y += 4200.0
    tuft = KIT["WL_Garden_Grass_Tuft"]["parts"][0]
    y = START_Y + 40.0
    while y < END_Y:
        for side in (-1.0, 1.0):
            add("Fringe", tuft["mesh"], "MI_V2_Moss", AXIS_X + side * (HALF_W + rng.uniform(22.0, 58.0)),
                y + rng.uniform(-30.0, 30.0), PAVING_TOP - 26.0, rng.uniform(0, 360),
                scale=rng.uniform(0.8, 1.25), cull=4000.0)
        y += 95.0

    # 4. the flanking order: a pinnacle and a slender tower alternating every 28 m
    step = 2800.0
    n_marks = int((END_Y - START_Y) // step)
    for i in range(n_marks):
        y = START_Y + step * (i + 0.7)
        for side in (-1.0, 1.0):
            if i % 2 == 0:
                add_module("WL_Detail_Pinnacle_Grand", AXIS_X + side * (HALF_W + 420.0), y, PAVING_TOP, 90.0,
                           cull=CULL_FAR)
            else:
                add("Tower", TOWER["mesh"], ASHLAR, AXIS_X + side * (HALF_W + 520.0), y, PAVING_TOP,
                    rng.uniform(0, 360), scale=rng.uniform(0.85, 1.05), cull=CULL_FAR)
    # 5. the gatehouse on the axis, where the march ends and Icarus begins
    # SEATED ON THE PAVING, NOT ON A HIDDEN PLINTH. floor_profile.py measured this gatehouse's interior floor at
    # z=90 while the paving either side is at z=12: a 78 cm sill on both faces. Unreal's max step height is 45, so
    # it was a wall with a doorway painted on it, and three seam walks stopped dead against it. Two attempts to
    # add steps made it worse -- the kit's ground "step" is a paving tile with a kerb lip, and the ceremonial
    # stair brought a 165 cm gold balustrade across the passage. Dropping the building 78 cm puts its floor flush
    # with the ground it stands on. The only cost is 78 cm of plinth buried in paving, which is what happens to a
    # real building set into a paved street.
    GATEHOUSE_SILL = 78.0
    add_module("WL_Gatehouse_Twin", AXIS_X, END_Y + 300.0, PAVING_TOP - 12.0 - GATEHOUSE_SILL, 0.0, cull=CULL_FAR)
    # 6. planting outside the balustrades: the boards' rule, in the nation's own restraint
    y = START_Y + 300.0
    while y < END_Y - 300.0:
        for side in (-1.0, 1.0):
            mesh, mat, radius = PLANTS[int(rng.random() * len(PLANTS))]
            x = AXIS_X + side * (HALF_W + 190.0 + rng.uniform(0.0, 120.0))
            add("Plant_" + mesh.rsplit("/", 1)[-1].split(".")[0].replace("SM_", ""), mesh, mat,
                x, y + rng.uniform(-90.0, 90.0), PAVING_TOP - 12.0, rng.uniform(0, 360),
                scale=rng.uniform(0.85, 1.2))
        y += 700.0

    mid = (START_Y + END_Y) * 0.5
    nation = nations.nation_at(AXIS_X, mid)
    layer = {"pass": PASS, "title": "IC01: the Icarus March, the white nation's first built ground",
             "tags": [PASS, nations.tag(nation)], "actors": [], "batches": list(batches.values())}
    (HERE / "ic01_march.json").write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    stats["nation"] = nation
    stats["instances"] = sum(len(b["instances"]) for b in batches.values())
    stats["batches"] = len(batches)
    return stats


if __name__ == "__main__":
    print(dict(main()))
