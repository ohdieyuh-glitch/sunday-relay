#!/usr/bin/env python3
"""GA04 -- the APPROACH: the processional avenue from the rear gate to the arrival gate.

WHAT WAS THERE. From the rear gate (ivory piers at x +/-300, y -6000, a thin gold crest) to the
arrival wall (y ~-1700) ran a 43 m lawn between hedge rows that flare from x +/-715 to +/-880:
no path, no light, no flowers -- a strip of grass leading to the world's front door.

WHAT THIS LAYER ADDS.
  GOLDEN GATE  the garden arch cast in gold over the rear gate, crowned with a gold heart, so the
               corridor opens and closes with the same golden arch (GA01 put one at the garden).
  AVENUE       a 4.8 m paved processional avenue with stone kerbs, from outside the rear gate to
               the arrival apron.
  RONDEL       halfway, the avenue widens into a round flower bed ringed by paving and spiral
               topiaries -- a pause on the walk.
  BORDERS      flower beds between the kerbs and the hedges, amber lamps every 9 m.

MEASURED INPUTS. obstacles_approach.json; ground z -14 along the axis (PIE probe); rear gate piers
and finials; urns on pedestals at (+/-700, -2300). Mesh sizes: mesh_bounds.json.
"""
import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "GA04"
GROUND = -14.0
V2 = "/Game/WonderlandV2/"
MESH = {
    "garden_arch": V2 + "Architecture/Garden/SM_garden_arch_stone.SM_garden_arch_stone",
    "finial_heart": V2 + "Architecture/Gates/SM_gate_finial_heart.SM_gate_finial_heart",
    "slab0": V2 + "Ground/Cobblestone/SM_plaza_slab_0.SM_plaza_slab_0",
    "slab3": V2 + "Ground/Cobblestone/SM_plaza_slab_3.SM_plaza_slab_3",
    "slab6": V2 + "Ground/Cobblestone/SM_plaza_slab_6.SM_plaza_slab_6",
    "kerb": V2 + "Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone",
    "waymarker": V2 + "Props/Garden/SM_waymarker.SM_waymarker",
    "waymarker_lamp": V2 + "Props/Garden/SM_waymarker_lamp.SM_waymarker_lamp",
    "bed_base0": V2 + "Vegetation/Flowers/SM_flower_bed_base_0.SM_flower_bed_base_0",
    "bed_base2": V2 + "Vegetation/Flowers/SM_flower_bed_base_2.SM_flower_bed_base_2",
    "bed_blooms0": V2 + "Vegetation/Flowers/SM_flower_bed_blooms_0.SM_flower_bed_blooms_0",
    "bed_blooms2": V2 + "Vegetation/Flowers/SM_flower_bed_blooms_2.SM_flower_bed_blooms_2",
    "lavender": V2 + "Vegetation/Flowers/SM_lavender_heads.SM_lavender_heads",
    "spiral": V2 + "Vegetation/Topiary/SM_topiary_spiral.SM_topiary_spiral",
    "blossom": V2 + "Vegetation/Flowers/SM_blossom_cluster.SM_blossom_cluster",
    "ring_base": V2 + "Mushrooms/Landmark/SM_stone_ring_base.SM_stone_ring_base",
    "rose_bush": V2 + "Vegetation/Roses/SM_rose_bush.SM_rose_bush",
}

Y_START, Y_END = -6450.0, -1580.0   # the arrival apron starts at y ~-1520 (GA04a stopped 2.5 m short)
HALF_WIDTH = 240.0
RONDEL_Y, RONDEL_R = -4000.0, 560.0


def build():
    rng = random.Random(20260913 + 4)
    actors, batches = [], {}

    def actor(id_, mesh, loc, materials, scale=1.0, yaw=0.0, collision="block"):
        s = [scale] * 3 if isinstance(scale, (int, float)) else list(scale)
        actors.append({"id": id_, "mesh": MESH[mesh], "loc": [round(v, 2) for v in loc], "rot": [0.0, round(yaw, 2), 0.0],
                       "scale": [round(v, 4) for v in s], "materials": materials, "collision": collision})

    def instance(batch_id, mesh, material, loc, scale, yaw, collides=False):
        s = [scale] * 3 if isinstance(scale, (int, float)) else list(scale)
        key = "%s_%s_%s" % (batch_id, mesh, material.split("_")[-1])
        b = batches.setdefault(key, {"id": key, "mesh": MESH[mesh], "material": material, "instances": [],
                                     "collides": collides, "cast_shadow": True, "affect_df": collides})
        b["instances"].append([round(loc[0], 1), round(loc[1], 1), round(loc[2], 2), 0.0, round(yaw, 1), 0.0,
                               round(s[0], 3), round(s[1], 3), round(s[2], 3)])

    # ------------------------------------------------------------ the golden rear gate
    arch_y = -6150.0
    actor("RearGate_GoldArch", "garden_arch", (0.0, arch_y, GROUND), ["MI_V2_Gold"], 1.1, collision="none")
    actor("RearGate_HeartCrown", "finial_heart", (0.0, arch_y, GROUND + 723.0 * 1.1 - 12.0), ["MI_V2_Gold"], 1.7, collision="none")

    # ------------------------------------------------------------ avenue and rondel paving
    slabs = ["slab0", "slab3", "slab6"]
    materials = ["MI_V2_PlazaCream"] * 5 + ["MI_V2_PlazaWarm"] * 3 + ["MI_V2_PlazaGrey"]
    y = Y_START
    row = 0
    while y <= Y_END:
        near_rondel = abs(y - RONDEL_Y) < RONDEL_R
        for col in range(-2, 2):
            x = col * 128.0 + 64.0
            if near_rondel and math.hypot(x, y - RONDEL_Y) < 300.0:
                continue                        # the flower bed
            instance("AvenueSlabs", slabs[(row + col) % 3], rng.choice(materials), (x, y, GROUND + 0.5), 0.985, rng.choice([0.0, 180.0]), collides=True)
        y += 128.0
        row += 1
    # The rondel's ring of paving, laid in courses facing the bed.
    radius = 364.0
    course = 0
    while radius <= RONDEL_R - 40.0:
        count = int(round(2.0 * math.pi * radius / 132.0))
        for k in range(count):
            ang = 360.0 * (k + 0.5 * (course % 2)) / count
            x = radius * math.cos(math.radians(ang))
            yy = RONDEL_Y + radius * math.sin(math.radians(ang))
            if abs(x) < HALF_WIDTH + 40.0:
                continue                        # the straight avenue already paves this band
            instance("RondelSlabs", slabs[(k + course) % 3], rng.choice(materials), (x, yy, GROUND + 0.5), 0.985, ang, collides=True)
        radius += 128.0
        course += 1

    # Kerbs along both avenue edges (broken at the rondel).
    y = Y_START + 60.0
    while y <= Y_END - 60.0:
        if abs(y - RONDEL_Y) > RONDEL_R + 60.0:
            for side in (1.0, -1.0):
                instance("AvenueKerbs", "kerb", "MI_V2_Kerb", (side * (HALF_WIDTH + 22.0), y, GROUND), (1.0, 0.8, 0.9), 90.0)
        y += 120.0
    # A gold ring around the rondel bed and one around the rondel rim.
    for radius, count in ((290.0, 16), (RONDEL_R, 30)):
        for k in range(count):
            ang = 360.0 * k / count
            x = radius * math.cos(math.radians(ang))
            yy = RONDEL_Y + radius * math.sin(math.radians(ang))
            if radius > 400.0 and abs(x) < HALF_WIDTH + 30.0:
                continue
            instance("RondelGold", "kerb", "MI_V2_Gold", (x, yy, GROUND), (2.0 * math.pi * radius / count / 118.0, 0.7, 0.6), ang + 90.0)

    # ------------------------------------------------------------ the rondel's flower bed and topiaries
    actor("Rondel_BedRing", "ring_base", (0.0, RONDEL_Y, GROUND), ["MI_V2_IvoryStone"], (1.05, 1.05, 0.55), collision="block")
    for k in range(14):
        ang = 2.0 * math.pi * k / 14.0
        r = rng.uniform(60.0, 210.0)
        material = ["MI_V2_PetalPink", "MI_V2_PetalRose", "MI_V2_PetalViolet", "MI_V2_RoseRed"][k % 4]
        instance("RondelBlooms", "blossom", material, (r * math.cos(ang), RONDEL_Y + r * math.sin(ang), GROUND + 30.0), rng.uniform(0.6, 0.8), rng.uniform(0, 360))
    for k, ang in enumerate((45.0, 135.0, 225.0, 315.0)):
        x = (RONDEL_R + 120.0) * math.cos(math.radians(ang))
        yy = RONDEL_Y + (RONDEL_R + 120.0) * math.sin(math.radians(ang))
        instance("RondelSpirals", "spiral", "MI_V2_LeafDark", (x, yy, GROUND), 1.05, 0.0)

    # ------------------------------------------------------------ flower borders and lamps
    y = Y_START + 300.0
    k = 0
    while y <= Y_END - 500.0:
        if abs(y - RONDEL_Y) > RONDEL_R + 200.0:
            for side in (1.0, -1.0):
                x = side * rng.uniform(420.0, 470.0)
                base, blooms = (("bed_base0", "bed_blooms0") if k % 2 == 0 else ("bed_base2", "bed_blooms2"))
                material = ["MI_V2_PetalPink", "MI_V2_PetalViolet", "MI_V2_RoseRed", "MI_V2_PetalRose"][(k + (0 if side > 0 else 1)) % 4]
                yaw = 90.0 + rng.uniform(-8, 8)
                instance("BorderBeds", base, "MI_V2_Soil", (x, y, GROUND), 1.0, yaw)
                instance("BorderBlooms", blooms, material, (x, y, GROUND), 1.0, yaw)
                instance("BorderLavender", "lavender", "MI_V2_Lavender", (x + side * 110.0, y + 60.0, GROUND), rng.uniform(1.0, 1.25), rng.uniform(0, 360))
        y += 260.0
        k += 1
    y = -5700.0
    k = 0
    while y <= -2400.0:
        if abs(y - RONDEL_Y) > RONDEL_R + 150.0:
            for side, tag in ((1.0, "L"), (-1.0, "R")):
                actor("AvenueLampPost%d%s" % (k, tag), "waymarker", (side * 340.0, y, GROUND), ["MI_V2_IvoryStone"], 0.46)
                actor("AvenueLamp%d%s" % (k, tag), "waymarker_lamp", (side * 340.0, y, GROUND), ["MI_V2_GlassAmber"], 0.46, collision="none")
            k += 1
        y += 900.0

    return {"pass": PASS, "title": "Processional approach: golden rear gate, paved avenue with kerbs, flower rondel, flower borders, amber lamps",
            "folder": "Wonderland/Authored/GA04", "tags": ["V2_Arrival"], "actors": actors, "batches": list(batches.values())}


if __name__ == "__main__":
    spec = build()
    out = HERE / "ga04_processional_approach.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d actors, %d batches, %d instances -> %s" % (PASS, len(spec["actors"]), len(spec["batches"]),
                                                           sum(len(b["instances"]) for b in spec["batches"]), out.name))
