#!/usr/bin/env python3
"""TW01 Tower Rise and MG01 Mushroom Grove -- the two forge districts the shipping map never received.

    python WorldDesign/Districts/forge_districts.py      (writes tw01_tower_rise.json, mg01_mushroom_grove.json)

PASS ID: Tower Rise is TW01, not TR01. TR01 belongs to GoldenArrival/tr01_clock_plaza_steps.json, and apply_layer
deletes a pass's existing actors, so a TR01 Tower Rise would have removed the clock-plaza steps (caught 2026-09-29
by validate_layer_spec's pass-id collision check, before any apply).

WHY (2026-09-28, world completion, CORE C4). The forge's layout names 14 districts (`_DISTRICT_SEEDS` in
wonderland-blender-forge/wonderland/v2/layout_v2.py). Run the forge's own district metric over every authored
pass in the Unreal core and 12 of them are there. Two are not:
  TOWER RISE     seed bearing 120, 130 m, palette towers / court / clockyard. Within 40 m of the seed the census
                 finds grass tufts, ground flowers, shrubs and a few trees -- not one tower.
  MUSHROOM GROVE seed bearing 300, 140 m, palette grove / wood / grove. Within 40 m: tufts, kerbs, a glass screen
                 facade -- not one mushroom.
This builds each from the forge's own recipe in the V2 kit the map already uses:
  TW01  `_quarter_towers`: capped towers of falling height round a dominant one (tower_capped in IvoryStone,
        roof_cone_steep in the rose / pink / lilac / blue / navy roofs, a gold finial spire, balcony rings on the
        landmark ones), a clock tower for the clockyard, court planting on a ring between them, and a garden wall
        round the cluster with an opening toward the city.
  MG01  a grove: giant mushrooms (the four-part SM_mushroom_giant in cream / red / terracotta with gold rims) on
        stone ring bases, a landmark mushroom, and medium and small ones gathered round their feet.
NOTHING THROUGH WHAT IS THERE. Every piece is placed with the WORLD session's oriented-rectangle Occupancy over
the census: a tower or a stem must stand clear of anything standing (flowers and kerbs included), a cap or a roof
clear of anything 6 m and taller. A slot that is blocked searches a spiral up to 9 m for a clear spot, else it is
left out and counted. Heights come from the ground under each piece (lawn -14, plates and paving by their real
tops, mesh_bounds.json).
"""
import csv
import gzip
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
WD = HERE.parent
CENSUS = WD.parent / "Tools" / "captures" / "zc" / "census" / "world_census.csv.gz"
sys.path.insert(0, str(WD / "Wedges"))
from w270_rear_seam import Occupancy                                    # noqa: E402

MB = json.loads((WD / "mesh_bounds.json").read_text(encoding="utf-8"))["meshes"]
LAWN = -14.0
TILE = 20000.0
SURFACE_WORDS = ("Flagstone", "Kerb_Run", "Plaza", "terrace_platform", "plaza_slab", "paving", "verge", "garden_lawn")


def path(name):
    return MB[name]["path"] + "." + name


def top_of(mesh, z, ez):
    b = MB.get(mesh)
    if b and b["ext"][2] > 0:
        return z + (b["origin"][2] + b["ext"][2]) * (ez / b["ext"][2])
    return z + (2.0 * ez if mesh.startswith("WL_") else ez)


class Site:
    def __init__(self, cx, cy, radius):
        self.cx, self.cy = cx, cy
        self.occ = Occupancy()
        self.surf = []
        with gzip.open(CENSUS, "rt", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["kind"] == "OTHER":
                    continue
                x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
                if z < -50000.0 or z > 20000.0 or math.hypot(x - cx, y - cy) > radius + 6000.0:
                    continue
                ex, ey, ez = float(r["ex"]), float(r["ey"]), float(r["ez"])
                mesh = r["mesh"]
                if max(ex, ey) > 5000.0 and ez < 300.0:
                    continue
                if any(w in mesh for w in SURFACE_WORDS):
                    self.surf.append((x, y, ex, ey, float(r["yaw"]), top_of(mesh, z, ez)))
                    self.occ.add("paved", x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["owner"])
                    continue
                if "tuft" in mesh.lower():
                    continue
                if "canopy" in mesh.lower():
                    self.occ.add("existing", x, y, 80.0, 80.0, 0.0, r["owner"] + ":trunk")
                    self.occ.add("solid", x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["owner"] + ":canopy")
                    continue
                self.occ.add("existing", x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["owner"] + ":" + mesh)
                if ez >= 300.0:
                    self.occ.add("solid", x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["owner"] + ":" + mesh)

    def ground(self, x, y):
        best = LAWN
        for (sx, sy, ex, ey, yaw, top) in self.surf:
            c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
            dx, dy = x - sx, y - sy
            if abs(dx * c + dy * s) <= ex and abs(-dx * s + dy * c) <= ey and top < 80.0:
                best = max(best, top)
        return best

    def find(self, x, y, foot, over=0.0, margin=100.0, reach=900.0):
        """A clear spot at or near (x, y): `foot` must clear anything standing, `over` (a cap or a roof) anything
        6 m and taller. Spiral search out to `reach`."""
        for rr in [0.0] + [100.0 * k for k in range(1, int(reach / 100.0) + 1)]:
            steps = 1 if rr == 0.0 else max(8, int(2 * math.pi * rr / 150.0))
            for k in range(steps):
                a = 2 * math.pi * k / steps
                px, py = x + rr * math.cos(a), y + rr * math.sin(a)
                if self.occ.hits(px, py, foot, foot, 0.0, margin, ("existing",)):
                    continue
                if over and self.occ.hits(px, py, over, over, 0.0, 0.0, ("solid",)):
                    continue
                return px, py
        return None


class Spec:
    def __init__(self, pass_id, folder, tags):
        self.id, self.folder, self.tags = pass_id, folder, tags
        self.batches, self.stats = {}, Counter()

    def add(self, key, mesh, material, x, y, z, yaw=0.0, s=1.0, collides=False, cull=26000.0):
        tkey = "%s_t%d_%d" % (key, math.floor(x / TILE), math.floor(y / TILE))
        bt = self.batches.setdefault((tkey, material), {
            "id": "%s_%s_%s" % (self.id, tkey, material.replace("MI_V2_", "")), "mesh": path(mesh),
            "material": material, "instances": [], "collides": collides, "cast_shadow": True,
            "affect_df": collides, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                                round(s, 3), round(s, 3), round(s, 3)])
        self.stats[key] += 1

    def out(self, title):
        return {"pass": self.id, "folder": self.folder, "title": title,
                "tags": ["WL_AUTHORED", "WL_PASS_" + self.id] + self.tags, "actors": [],
                "batches": list(self.batches.values())}


def polar(bearing, r_m):
    t = math.radians(bearing)
    return r_m * 100.0 * math.cos(t), r_m * 100.0 * math.sin(t)


def tower_rise(bearing=120.0, r_m=130.0):
    cx, cy = polar(bearing, r_m)
    site = Site(cx, cy, 5500.0)
    spec = Spec("TW01", "Wonderland/Authored/TW01_TowerRise", ["WL_DISTRICT", "WL_DISTRICT_TOWER_RISE"])
    rng = random.Random(1201)
    sp = 1.05
    # the forge's plan: dominant tower first, attendants round it (dx, dy, height, roof)
    plan = ((0, 0, 1.35, "MI_V2_RoofPink"), (1500, 900, 1.0, "MI_V2_RoofLilac"),
            (-1300, 1100, 1.15, "MI_V2_RoofBlue"), (700, -1500, 0.85, "MI_V2_RoofRose"),
            (-1600, -900, 1.05, "MI_V2_RoofNavy"), (2100, -2000, 1.22, "MI_V2_RoofPink"),
            (-2400, 2100, 0.95, "MI_V2_RoofRose"))
    placed = []
    for i, (dx, dy, h, roof) in enumerate(plan):
        spot = site.find(cx + dx * sp, cy + dy * sp, 190.0 * h + 60.0, over=210.0 * h, margin=120.0)
        if spot is None:
            spec.stats["tower_no_room"] += 1
            continue
        x, y = spot
        z = site.ground(x, y)
        yaw = rng.uniform(0.0, 360.0)
        spec.add("Tower", "SM_tower_capped", "MI_V2_IvoryStone", x, y, z, yaw, h, collides=True, cull=60000.0)
        spec.add("TowerCap", "SM_roof_cone_steep", roof, x, y, z + 1100.0 * h, yaw, h, cull=60000.0)
        spec.add("TowerSpire", "SM_finial_spire", "MI_V2_Gold", x, y, z + 1560.0 * h, yaw, 0.7 * h, cull=60000.0)
        if i in (0, 2, 5):
            spec.add("TowerBalcony", "SM_balcony_ring", "MI_V2_GoldAged", x, y, z + 585.0 * h, yaw, 0.65 * h)
        site.occ.add("existing", x, y, 190.0 * h, 190.0 * h, 0.0, "TW01:tower")
        site.occ.add("solid", x, y, 210.0 * h, 210.0 * h, 0.0, "TW01:tower")
        placed.append((x, y))
    # THE CLOCKYARD: the forge's palette names it -- a clock tower where the court opens toward the city
    tx, ty = cx - cx / math.hypot(cx, cy) * 1400.0, cy - cy / math.hypot(cx, cy) * 1400.0
    spot = site.find(tx, ty, 240.0, over=240.0, margin=150.0)
    if spot:
        x, y = spot
        z = site.ground(x, y)
        yaw = math.degrees(math.atan2(-y, -x))          # the clock faces the city
        spec.add("ClockTower", "SM_tower_clock", "MI_V2_GoldAged", x, y, z, yaw, 1.15, collides=True, cull=60000.0)
        spec.add("ClockCap", "SM_roof_cone_steep", "MI_V2_RoofNavy", x, y, z + 1190.0 * 1.15, yaw, 1.05, cull=60000.0)
        spec.add("ClockSpire", "SM_finial_spire", "MI_V2_Gold", x, y, z + 1190.0 * 1.15 + 600.0 * 1.05, yaw, 0.8)
        site.occ.add("existing", x, y, 240.0, 240.0, 0.0, "TW01:clock")
    else:
        spec.stats["clock_no_room"] += 1
    # the court between the towers, with its own planting
    for i in range(8):
        a = 2 * math.pi * i / 8 + 0.4
        spot = site.find(cx + math.cos(a) * 1000.0 * sp, cy + math.sin(a) * 1000.0 * sp, 130.0, margin=60.0, reach=400.0)
        if spot is None:
            spec.stats["court_plant_no_room"] += 1
            continue
        x, y = spot
        mesh, mat = (("SM_topiary_cone_plain", "MI_V2_LeafDark"), ("SM_shrub_flowering", "MI_V2_LeafMid"),
                     ("SM_topiary_ball", "MI_V2_LeafMid"), ("SM_topiary_spiral", "MI_V2_LeafDark"))[i % 4]
        spec.add("Court", mesh, mat, x, y, site.ground(x, y), 40.0 * i, 0.9, cull=26000.0)
        site.occ.add("existing", x, y, 130.0, 130.0, 0.0, "TW01:plant")
    # A NEIGHBOURHOOD, NOT TOWERS ON GRASS: a garden wall round the cluster, open toward the city
    wall_r = 3400.0
    toward_city = math.degrees(math.atan2(-cy, -cx))
    n = int(2 * math.pi * wall_r / 520.0)
    for i in range(n):
        a = 360.0 * i / n
        if abs(((a - toward_city) + 180.0) % 360.0 - 180.0) < 22.0:
            continue                                   # the way in
        t = math.radians(a)
        x, y = cx + wall_r * math.cos(t), cy + wall_r * math.sin(t)
        yaw = a + 90.0
        if site.occ.hits(x, y, 265.0, 60.0, yaw, 40.0, ("existing",)):
            spec.stats["wall_refused"] += 1
            continue
        spec.add("Wall", "SM_garden_wall", "MI_V2_IvoryStone", x, y, site.ground(x, y), yaw, 1.0, collides=True)
        spec.stats["wall"] += 1
    # gate piers either side of the way in
    for side in (-1.0, 1.0):
        t = math.radians(toward_city + side * 22.0)
        x, y = cx + wall_r * math.cos(t), cy + wall_r * math.sin(t)
        if not site.occ.hits(x, y, 95.0, 95.0, 0.0, 40.0, ("existing",)):
            z = site.ground(x, y)
            spec.add("GatePier", "SM_gate_pier", "MI_V2_IvoryStone", x, y, z, toward_city, 1.0, collides=True)
            spec.add("GateFinial", "SM_gate_finial_ball", "MI_V2_Gold", x, y, z + 650.0, 0.0, 1.0)
    return spec.out("Tower Rise: the forge's tower neighbourhood, a clockyard and a walled court"), placed, spec.stats


def mushroom_grove(bearing=300.0, r_m=140.0):
    cx, cy = polar(bearing, r_m)
    site = Site(cx, cy, 5500.0)
    spec = Spec("MG01", "Wonderland/Authored/MG01_MushroomGrove", ["WL_DISTRICT", "WL_DISTRICT_MUSHROOM_GROVE"])
    rng = random.Random(3001)
    giants = ((0, 0, 1.0, "MI_V2_MushRed", "MI_V2_MushCream"), (2300, 1500, 0.8, "MI_V2_MushCream", "MI_V2_MushRed"),
              (-2000, 1700, 0.7, "MI_V2_MushTerracotta", "MI_V2_MushCream"), (1200, -2400, 0.65, "MI_V2_MushRed", "MI_V2_MushCream"))
    feet = []
    for i, (dx, dy, s, cap, spots) in enumerate(giants):
        spot = site.find(cx + dx, cy + dy, 330.0 * s + 80.0, over=1000.0 * s, margin=120.0)
        if spot is None:
            spec.stats["giant_no_room"] += 1
            continue
        x, y = spot
        z = site.ground(x, y)
        yaw = rng.uniform(0.0, 360.0)
        spec.add("Giant", "SM_mushroom_giant", cap, x, y, z, yaw, s, collides=True, cull=60000.0)
        spec.add("GiantGills", "SM_mushroom_giant_gills", "MI_V2_MushCream", x, y, z, yaw, s, cull=60000.0)
        spec.add("GiantRim", "SM_mushroom_giant_rim", "MI_V2_Gold", x, y, z, yaw, s, cull=60000.0)
        spec.add("GiantSpots", "SM_mushroom_giant_spots", spots, x, y, z, yaw, s, cull=60000.0)
        spec.add("RingBase", "SM_stone_ring_base", "MI_V2_Stone", x, y, z, yaw, 1.2 * s, collides=True)
        site.occ.add("existing", x, y, 330.0 * s, 330.0 * s, 0.0, "MG01:stem")
        site.occ.add("solid", x, y, 1000.0 * s, 1000.0 * s, 0.0, "MG01:cap")
        feet.append((x, y, s))
    # the landmark mushroom where the grove meets the city
    tx, ty = cx - cx / math.hypot(cx, cy) * 1800.0, cy - cy / math.hypot(cx, cy) * 1800.0
    spot = site.find(tx, ty, 300.0, over=650.0, margin=120.0)
    if spot:
        x, y = spot
        spec.add("Landmark", "SM_mushroom_landmark", "MI_V2_MushTerracotta", x, y, site.ground(x, y),
                 rng.uniform(0, 360), 0.9, collides=True, cull=60000.0)
        site.occ.add("existing", x, y, 300.0, 300.0, 0.0, "MG01:landmark")
    # medium and small ones gathered round the giants' feet -- a grove, not a row
    for (gx, gy, s) in feet:
        for k in range(7):
            a = rng.uniform(0.0, 2 * math.pi)
            d = rng.uniform(450.0, 1100.0) * max(s, 0.7)
            spot = site.find(gx + d * math.cos(a), gy + d * math.sin(a), 150.0, margin=40.0, reach=300.0)
            if spot is None:
                spec.stats["medium_no_room"] += 1
                continue
            x, y = spot
            mat = ("MI_V2_MushRed", "MI_V2_MushCream")[k % 2]
            spec.add("Medium", "SM_mushroom_medium", mat, x, y, site.ground(x, y), rng.uniform(0, 360),
                     rng.uniform(0.7, 1.2), cull=26000.0)
            site.occ.add("existing", x, y, 150.0, 150.0, 0.0, "MG01:medium")
        for k in range(12):
            a = rng.uniform(0.0, 2 * math.pi)
            d = rng.uniform(350.0, 1500.0) * max(s, 0.7)
            spot = site.find(gx + d * math.cos(a), gy + d * math.sin(a), 70.0, margin=20.0, reach=200.0)
            if spot is None:
                spec.stats["small_no_room"] += 1
                continue
            x, y = spot
            mat = ("MI_V2_MushPurple", "MI_V2_MushRed")[k % 2]
            spec.add("Small", "SM_mushroom_small", mat, x, y, site.ground(x, y), rng.uniform(0, 360),
                     rng.uniform(0.6, 1.3), cull=26000.0)
            site.occ.add("existing", x, y, 70.0, 70.0, 0.0, "MG01:small")
    return spec.out("Mushroom Grove: giant mushrooms on stone rings, a landmark, and the small ones at their feet"), feet, spec.stats


# RELOCATED WITH INTENT (2026-09-29, founder directive "prefer outward expansion over destroying good completed core
# work"). Both forge seeds lie inside the fully planted core (TR01 found room for 3 of 7 towers there, MG01 for no
# giant). Each keeps its forge bearing and moves out along it to the nearest large empty region the structure-only
# emptiness audit reports (05:05 census): TW01 to the ICARUS march edge, MG01 to the TARTARUS outer heartland.
SITES = {"TW01": (111.0, 478.0), "MG01": (297.0, 984.0)}


def main():
    for build, fname, pid in ((tower_rise, "tw01_tower_rise.json", "TW01"),
                              (mushroom_grove, "mg01_mushroom_grove.json", "MG01")):
        spec, placed, stats = build(*SITES[pid])
        (HERE / fname).write_text(json.dumps(spec, indent=1), encoding="utf-8")
        total = sum(len(b["instances"]) for b in spec["batches"])
        print("%s: %d instances in %d batches, %d anchors placed -> %s" % (spec["pass"], total, len(spec["batches"]),
                                                                          len(placed), fname))
        print("    %s" % ", ".join("%s %d" % kv for kv in sorted(stats.items())))


if __name__ == "__main__":
    main()
