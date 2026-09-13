#!/usr/bin/env python3
"""SKY03 -- floating islands carrying small castles, in the sky the arrival looks at.

WHAT THE BIBLE SHOWS (VISUAL_AUTHORITY.md). Every board puts floating islands over the skyline:
BOARD_1 centre and "Floating Elements", BOARD_3 key landmarks and "Sky & Atmosphere", BOARD_4 panel 01,
BOARD_5 "Fantasy Skyline", BOARD_6 "Skyline & Floating Elements". An island is a lawn in a stone lip over
a hanging rock underside, with a castle -- slender towers under pink cones -- standing on it, and cloud
drifting under it.

WHAT WAS THERE. Balloons, cumulus, gold keys, teacups and a clock in the air (SKY01) -- and no island.
The Blender forge now has three (families/sky.py: WL_Sky_Island_Small/Medium/Large, 9/16/26 m).

WHAT THIS LAYER ADDS. Five islands on bearings that flank the castle from HeroCam_GoldenArrivalBible,
from 200 to 360 m out. Each carries a castle spelled from the kit's own tower grammar (kitstack.py) at a
reduced scale, topiary at the lip, and a cumulus under the underside. Every piece of one island is an
AWonderlandHoverProp with the SAME amplitude, period and phase and NO sway, so the island, its castle and
its cloud rise and fall as one body (a yaw sway turns each actor about its own origin, which would slide
the towers across the lawn).

MEASURED INPUTS. Heights: each island's underside tip is placed above the city silhouette at its bearing
from the hero and the arrival eyes (census_north_2026-09-13.json, the same occluder table SKY02 uses) by
UNDERSIDE_CLEAR_UU, and never lower than its authored altitude. Mesh sizes: kit_modules.json (islands:
top radius 4.6/8.0/13.0 m, underside 7.5/12.0/18.0 m) and the 2026-09-13 bounds read (cumulus_c
47 x 29 x 31 m at 1x; topiary cone 2.3 x 3.2 m).
"""
import json
import math
import random
from pathlib import Path

import kitstack as kit
import sky02_needle_skyline as sky02

HERE = Path(__file__).resolve().parent
PASS = "SKY03"
V2 = "/Game/WonderlandV2/"
CLOUD = V2 + "Sky/SM_cloud_cumulus_c.SM_cloud_cumulus_c"
TOPIARY = {"cone": V2 + "Vegetation/Topiary/SM_topiary_cone_plain.SM_topiary_cone_plain",
           "spiral": V2 + "Vegetation/Topiary/SM_topiary_spiral.SM_topiary_spiral",
           "ball": V2 + "Vegetation/Topiary/SM_topiary_ball.SM_topiary_ball"}
UNDERSIDE_CLEAR_UU = 1500.0
TREE = {"trunk": V2 + "Vegetation/Trees/SM_tree_slender_trunk.SM_tree_slender_trunk",
        "crown": V2 + "Vegetation/Trees/SM_canopy_medium.SM_canopy_medium"}
# SKY03a (previewed 2026-09-13, not saved) read as grey saucers carrying toy towers under cumulus as big as
# the islands. So each island group is scaled up as ONE body (island, castle, trees, offsets), the underside
# takes a warm rock instead of the ashlar grey, trees break the rim, and the cloud is a wisp under it.
GROUP_SCALE = {"small": 1.8, "medium": 2.0, "large": 2.2}
PART_MATERIAL = {"stone_dark": "MI_V2_Soil"}      # PathWarm (SKY03b) still read grey from below
HERO = sky02.EYES["hero"]

SIZES = {"small": ("WL_Sky_Island_Small", 460.0, 750.0),
         "medium": ("WL_Sky_Island_Medium", 800.0, 1200.0),
         "large": ("WL_Sky_Island_Large", 1300.0, 1800.0)}

# (id, size, bearing deg from the hero, distance uu, authored top z, castle: [(lateral offset uu, scale, height rank)])
# SKY03b put islands 30-50 degrees up, where the eye sees mostly underside. The Bible sees islands
# nearly side-on, so the flank islands go where the city silhouette is LOW (wide bearings) and take the
# lowest height that still clears it: their authored top is a floor, and the census clearance decides.
ISLANDS = [
    ("IslandRight", "large", 124.0, 26000.0, 9000.0, [(0.0, 0.55, 0), (-900.0, 0.36, 2), (900.0, 0.36, 1)]),
    ("IslandLeft", "medium", 58.0, 24000.0, 9000.0, [(0.0, 0.50, 0)]),
    ("IslandFarRight", "small", 138.0, 34000.0, 12000.0, [(0.0, 0.36, 1)]),
    ("IslandFarLeft", "small", 46.0, 32000.0, 12000.0, [(0.0, 0.36, 0)]),
    ("IslandHigh", "medium", 101.0, 38000.0, 24500.0, [(0.0, 0.46, 1)]),
]
NARROW_FEET = ("WL_Tower_Base_Arcaded", "WL_Tower_Base_Battered", "WL_Tower_Base_Buttressed")


def build():
    rng = random.Random(20260913 + 103)
    occ = sky02._occluders()
    spellings = [(s, h) for s, h in kit.spellings(3)
                 if s[0] in NARROW_FEET and kit.MODULES[s[-1]]["role"] == "needle"]
    spellings.sort(key=lambda sh: -sh[1])
    hovers, islands = [], []

    for (iid, size, bearing, dist, authored_top, castle) in ISLANDS:
        mesh_id, top_r, depth = SIZES[size]
        G = GROUP_SCALE[size]
        top_r, depth = top_r * G, depth * G
        x = HERO[0] + dist * math.cos(math.radians(bearing))
        y = HERO[1] + dist * math.sin(math.radians(bearing))
        city = max(sky02._need(occ, name, x, y) for name in sky02.EYES)
        top_z = max(authored_top, city + UNDERSIDE_CLEAR_UU + depth)
        face = math.degrees(math.atan2(HERO[1] - y, HERO[0] - x))       # local +X toward the hero
        motion = {"amp": round(rng.uniform(120.0, 190.0), 1), "period": round(rng.uniform(15.0, 21.0), 2),
                  "sway": 0.0, "phase": round(rng.uniform(0.0, 1.0), 3)}

        def hover(hid, mesh, material, loc, scale, yaw):
            hovers.append(dict({"id": "%s_%s" % (iid, hid), "mesh": mesh, "material": material,
                                "loc": [round(v, 1) for v in loc], "rot": [0.0, round(yaw % 360.0, 1), 0.0],
                                "scale": [round(scale, 3)] * 3}, **motion))

        # The island itself: one hover per part, all at the island's origin.
        module = kit.MODULES[mesh_id]
        for part in module["parts"]:
            hover(part["part"], part["mesh"], PART_MATERIAL.get(part["part"], part["material"]), (x, y, top_z), G, face)

        # The castle, across the view (lateral offsets run perpendicular to the line to the hero).
        side = (math.cos(math.radians(face + 90.0)), math.sin(math.radians(face + 90.0)))
        towers = []
        for k, (lateral, scale, rank) in enumerate(castle):
            lateral, scale = lateral * G, scale * G
            stack, height = spellings[min(rank * 7 + rng.randrange(3), len(spellings) - 1)]
            foot = kit.footprint(stack) * scale
            assert abs(lateral) + foot <= top_r, "%s tower %d overhangs the lip" % (iid, k)
            tx, ty = x + side[0] * lateral, y + side[1] * lateral
            tyaw = face + rng.choice((0.0, 90.0, 180.0, 270.0))
            for name, z in kit.storeys(stack):
                for part in kit.MODULES[name]["parts"]:
                    hover("T%d_%s_%s" % (k, name.replace("WL_", ""), part["part"]), part["mesh"], part["material"],
                          (tx, ty, top_z + z * scale - 20.0 * scale), scale, tyaw)
            towers.append({"stack": stack, "scale": scale, "height_uu": round(height * scale)})

        # Trees break the rim, left and right of the castle as the hero sees it; topiary at the back of the lip.
        # Front pair at (+/-0.45 r, +0.60 r) and back pair at (+/-0.35 r, -0.55 r) clear every foot: on the
        # large island the nearest is a flank foot at 1850 uu against its 750 uu radius. A small island has
        # no room beside its single foot, so it keeps only its topiary.
        n_trees = {"small": 0, "medium": 2, "large": 4}[size]
        for j in range(n_trees):
            lat = (-1.0 if j % 2 == 0 else 1.0) * top_r * (0.45 if j < 2 else 0.35)
            fwd = top_r * (0.60 if j < 2 else -0.55)
            tx = x + side[0] * lat + math.cos(math.radians(face)) * fwd
            ty = y + side[1] * lat + math.sin(math.radians(face)) * fwd
            ts = G * rng.uniform(0.55, 0.75)
            hover("TreeTrunk%d" % j, TREE["trunk"], "MI_V2_Bark", (tx, ty, top_z), ts, rng.uniform(0, 360))
            hover("TreeCrown%d" % j, TREE["crown"], "MI_V2_LeafMid" if j % 2 else "MI_V2_LeafLight",
                  (tx, ty, top_z + 820.0 * ts), ts * 1.25, rng.uniform(0, 360))
        n_top = {"small": 1, "medium": 3, "large": 4}[size]
        kind = {"small": "ball", "medium": "spiral", "large": "cone"}[size]
        for j in range(n_top):
            ang = face + 180.0 + (j - (n_top - 1) / 2.0) * 38.0
            r = top_r - 150.0 * G
            hover("Topiary%d" % j, TOPIARY[kind], "MI_V2_LeafDark",
                  (x + r * math.cos(math.radians(ang)), y + r * math.sin(math.radians(ang)), top_z), 0.8 * G, rng.uniform(0, 360))

        # A cumulus under the larger islands only (under a small one it reads as a cotton ball its own size).
        cloud_scale = top_r * 1.0 / 4720.0
        if size != "small":
            hover("Cloud", CLOUD, "MI_V2_Cloud", (x, y, top_z - depth - 1573.0 * cloud_scale * 0.4), cloud_scale, face + 90.0)

        islands.append({"id": iid, "size": size, "at": [round(x), round(y)], "bearing": bearing, "distance_m": round(dist / 100.0),
                        "top_z": round(top_z), "city_silhouette_z": round(city), "motion": motion, "towers": towers})

    return {"pass": PASS, "title": "Floating islands with small castles over the arrival skyline",
            "folder": "Wonderland/Authored/SKY03", "tags": ["V2_Skyline"], "actors": [], "batches": [], "hovers": hovers,
            "islands": islands}


if __name__ == "__main__":
    spec = build()
    out = HERE / "sky03_floating_islands.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d islands, %d hover pieces -> %s" % (PASS, len(spec["islands"]), len(spec["hovers"]), out.name))
    for i in spec["islands"]:
        print("  %-15s %-6s at %s top %5.0f m (city %4.0f m) towers %s" % (i["id"], i["size"], i["at"], i["top_z"] / 100.0,
              i["city_silhouette_z"] / 100.0, [t["height_uu"] // 100 for t in i["towers"]]))
