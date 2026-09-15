#!/usr/bin/env python3
"""GA04 -- the APPROACH: the processional avenue from the rear gate to the arrival gate.

WHAT WAS THERE. From the rear gate (ivory piers at x +/-300, y -6000, a thin gold crest) to the
arrival wall (y ~-1700) ran a 43 m lawn between hedge rows that flare from x +/-715 to +/-880:
no path, no light, no flowers -- a strip of grass leading to the world's front door.

WHAT THIS LAYER ADDS.
  GOLDEN GATE  a polished gold rose garden arch over the rear gate (GA04b, the kit's WL_Arch_Garden_Rose), so the
               corridor opens and closes with the same golden arch (GA01 puts one at the garden).
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
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
PASS = "GA04"
REAR_ARCH_SCALE = 1.5
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
    # FL02: the forge flower bed runs (GAP 19), registered under short keys
    for module in ("WL_Flower_Daisy_Run", "WL_Flower_Lavender_Run", "WL_Flower_Rose_Run"):
        for part in KIT[module]["parts"]:
            MESH["%s_%s" % (module.replace("WL_Flower_", "").replace("_Run", "").lower(), part["part"])] = part["mesh"]
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

    def plant(batch, kind, petal, loc, yaw, scale=1.0, leaf="MI_V2_LeafMid"):
        """One flower bed run: every part as its own batch; the petal takes `petal`."""
        module = {"daisy": "WL_Flower_Daisy_Run", "lavender": "WL_Flower_Lavender_Run", "rose": "WL_Flower_Rose_Run"}[kind]
        for part in KIT[module]["parts"]:
            material = petal if part["part"] == "petal" else (leaf if part["part"] == "leaf" else part["material"])
            instance(batch, "%s_%s" % (kind, part["part"]), material, loc, scale, yaw)

    # ------------------------------------------------------------ the golden rear gate
    # GA04b (2026-09-15, AR01 series): the world's stone garden arch cast in gold at 1.1x with a heart crown read as a
    # crumpled ring of gold blocks with dark blotches (goldA). It is now the same polished gold rose garden arch as
    # GA01c's garden gate (WL_Arch_Garden_Rose), so the corridor still opens and closes with one golden arch. At 1.5x
    # (9.4 m wide, 13.5 m tall) its columns stand outside the generator's ivory gate piers (x +/-300, y -6000), which
    # frame the path inside it; at 1.2x the columns merged with the piers (ga04b). The columns collide.
    arch_y = -6150.0
    for part in KIT["WL_Arch_Garden_Rose"]["parts"]:
        if part["part"] == "veg_anchor":
            continue
        key = "RearGate_Arch_%s" % part["part"]
        batches[key] = {"id": key, "mesh": part["mesh"], "material": "MI_V2_Gold", "collides": part["part"] == "stone",
                        "cast_shadow": True, "affect_df": part["part"] == "stone",
                        "instances": [[0.0, arch_y, GROUND, 0.0, 0.0, 0.0, REAR_ARCH_SCALE, REAR_ARCH_SCALE, REAR_ARCH_SCALE]]}

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
    # FL02 (2026-09-13): the bed was 14 blossom clusters -- colour pads. Six flower runs round the ring, turned along
    # it, and a rose run across the centre, on the ring base's top (42 cm).
    ring_top = GROUND + 76.8 * 0.55 - 2.0
    # FL02b: seven runs left the 5 m bed mostly bare stone. Concentric rings of runs fill it: 11 at r 2.2 m, 8 at 1.5 m,
    # 4 at 0.8 m and a rose run across the centre, turned along their rings, violet outside, pink and red within.
    kinds = [("daisy", "MI_V2_PetalViolet"), ("lavender", "MI_V2_PetalViolet"), ("rose", "MI_V2_RosePink"),
             ("daisy", "MI_V2_PetalPink"), ("rose", "MI_V2_RoseRed"), ("lavender", "MI_V2_PetalViolet")]
    n = 0
    for radius, count, scale in ((222.0, 11, 1.05), (150.0, 8, 1.1), (80.0, 4, 1.15)):
        for k in range(count):
            ang = 2.0 * math.pi * (k + 0.5 * (count % 2)) / count
            kind, petal = kinds[n % len(kinds)]
            plant("RondelFlowers", kind, petal, (radius * math.cos(ang), RONDEL_Y + radius * math.sin(ang), ring_top),
                  math.degrees(ang) + 90.0, scale, leaf="MI_V2_LeafDark" if n % 2 else "MI_V2_LeafMid")
            n += 1
    plant("RondelFlowers", "rose", "MI_V2_RosePink", (0.0, RONDEL_Y, ring_top), 0.0, 1.2)
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
                # FL02: bed pads and paper-blade lavender heads replaced by two flower runs side by side
                kind, petal = [("daisy", "MI_V2_PetalViolet"), ("rose", "MI_V2_RosePink"), ("daisy", "MI_V2_PetalPink"),
                               ("rose", "MI_V2_RoseRed")][(k + (0 if side > 0 else 1)) % 4]
                yaw = 90.0 + rng.uniform(-6, 6)
                # FL02b: a bed of four runs (2 x 2), ~2.4 x 1.2 m, so a border reads as planted beds, not lone clumps
                for (dx, dy, bed_kind, bed_petal) in ((-28.0, -62.0, kind, petal), (-28.0, 62.0, "lavender", "MI_V2_PetalViolet"),
                                                      (28.0, -62.0, "lavender", "MI_V2_PetalViolet"), (28.0, 62.0, kind, petal)):
                    plant("BorderFlowers", bed_kind, bed_petal, (x + side * dx, y + dy, GROUND), yaw, rng.uniform(1.1, 1.25),
                          leaf="MI_V2_LeafDark" if bed_kind == "lavender" else "MI_V2_LeafMid")
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
