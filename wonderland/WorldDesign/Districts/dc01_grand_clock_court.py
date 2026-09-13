#!/usr/bin/env python3
"""DC01 -- The Grand Clock: the first district arrival composed to the Golden Arrival bar.

THE GAP (PRIVATE_BETA_GATE.md item 11; beta_tour 2026-09-13). The map lands a visitor at (10603, -928) facing
yaw -5 on a 9 m paved promenade (terrace platforms, z 19; a road at z 12 on its left, lawn at z -14 on its right)
that runs 24 m to the clockyard gate arch. What the visitor sees first: two 3 m balustrade fragments across the
promenade 5 m ahead, a lone ornate column with a gold ball on its edge, a 6 m garden-wall stub standing across the
middle at 12 m, and two more lone columns off to the side. The place is called The Grand Clock and has no clock
in view.

WHAT THIS PASS DOES.
  TRIM (dc01_grand_clock_trim.json, apply_vegetation_trim.py): the two balustrade fragments, three lone columns and
       their gold balls, and the wall stub are sunk 1 km under the ground -- every one with its exact before
       transform, REVERT puts them back. The symmetric urn pedestals, the lamps and the gate arch stay.
  LAYER (dc01_grand_clock_court.json):
       PROMENADE  the Golden Arrival's language carried here (GA07): gold border courses along both edges, rose
                  bands framed in gold, a gold-and-rose medallion 7 m ahead.
       THE CLOCK  the forge's gold pocket clock, 5.8 m tall on a pedestal in a stone rondel of flowers, 15.5 m
                  ahead on the axis, dial to the visitor, with the gate arch behind it. One clock, as a landmark
                  (clock discipline).
       LAMPS      three pairs of amber lamps along the edges; two spiral topiaries behind the rondel.
Nothing new stands on the walked line except the rondel, which the promenade passes on both sides (2.9 m each).

MEASURED INPUTS. Probe 217 (41 points): promenade top z 19 from 3 to 24 m ahead, lateral -3..+3 m. Props census
216 (object names, batch indices, transforms). mesh_bounds.json; kit_modules.json for the pocket clock.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "DC01"
V2 = "/Game/WonderlandV2/"
AX, AY, AYAW = 10603.0, -928.0, -5.0
FLOOR = 19.0
SINK_UU = 100000.0
CENSUS = HERE / "dc01_props_census_2026-09-13.json"
MESH = {
    "kerb": V2 + "Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone",
    "ring_base": V2 + "Mushrooms/Landmark/SM_stone_ring_base.SM_stone_ring_base",
    "pedestal": V2 + "Props/Garden/SM_pedestal_finial.SM_pedestal_finial",
    "clock_enamel": V2 + "Kit/objects/WL_Object_PocketClock_enamel.WL_Object_PocketClock_enamel",
    "clock_gold": V2 + "Kit/objects/WL_Object_PocketClock_gold.WL_Object_PocketClock_gold",
    "blooms0": V2 + "Vegetation/Flowers/SM_flower_bed_blooms_0.SM_flower_bed_blooms_0",
    "blossom": V2 + "Vegetation/Flowers/SM_blossom_cluster.SM_blossom_cluster",
    "rose_bush": V2 + "Vegetation/Roses/SM_rose_bush.SM_rose_bush",
    "waymarker": V2 + "Props/Garden/SM_waymarker.SM_waymarker",
    "waymarker_lamp": V2 + "Props/Garden/SM_waymarker_lamp.SM_waymarker_lamp",
    "spiral": V2 + "Vegetation/Topiary/SM_topiary_spiral.SM_topiary_spiral",
}
# (batch object name, instance index): what the visitor must not see first (props census 216)
TRIM = [
    ("WonderlandInstancedBatch_278", 62, "balustrade fragment across the promenade, 5 m ahead, left"),
    ("WonderlandInstancedBatch_278", 63, "balustrade fragment across the promenade, 5 m ahead, right"),
    ("WonderlandInstancedBatch_306", 13, "lone ornate column on the promenade edge, 10 m ahead"),
    ("WonderlandInstancedBatch_184", 72, "its gold ball"),
    ("WonderlandInstancedBatch_306", 14, "lone ornate column by the road, 6 m ahead"),
    ("WonderlandInstancedBatch_184", 73, "its gold ball"),
    ("WonderlandInstancedBatch_306", 22, "lone ornate column by the road, 10 m ahead"),
    ("WonderlandInstancedBatch_304", 120, "garden-wall stub standing across the promenade, 12 m ahead"),
]
BORDER_LAT = 370.0


def at(d, lat):
    th = math.radians(AYAW)
    return (AX + math.cos(th) * d - math.sin(th) * lat, AY + math.sin(th) * d + math.cos(th) * lat)


def build_trim():
    census = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    by_key = {(r["name"], r.get("index")): r for r in census if r["kind"] == "instance"}
    trims = []
    for name, index, why in TRIM:
        row = by_key[(name, index)]
        before = row["transform"]
        after = list(before)
        after[2] = round(before[2] - SINK_UU, 3)
        trims.append({"name": name, "label": row["label"], "mesh": row["mesh"], "index": index, "why": why,
                      "before": before, "after": after})
    return {"pass": PASS + "_TRIM", "title": "The Grand Clock: clutter sunk out of the arrival view (reversible)", "trims": trims}


def build_layer():
    actors, batches = [], {}

    def actor(id_, mesh, loc, materials, scale=1.0, yaw=0.0, collision="block"):
        s = [scale] * 3 if isinstance(scale, (int, float)) else list(scale)
        actors.append({"id": id_, "mesh": MESH[mesh], "loc": [round(v, 2) for v in loc], "rot": [0.0, round(yaw, 2), 0.0],
                       "scale": [round(v, 4) for v in s], "materials": materials, "collision": collision})

    def inst(key, mesh, material, x, y, z, yaw, sx, sy, sz, shadow=False):
        b = batches.setdefault(key, {"id": key, "mesh": MESH[mesh], "material": material, "instances": [], "collides": False,
                                     "cast_shadow": shadow, "affect_df": False})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 2), 0.0, round(yaw, 1), 0.0, round(sx, 3), round(sy, 3), round(sz, 3)])

    # ---- promenade ornament (GA07's courses: kerb stones laid flush, 2 cm proud)
    def strip_along(key, material, lat, d0, d1, width, height=2.0):
        n = max(1, int(round((d1 - d0) / 118.0)))
        step = (d1 - d0) / n
        for i in range(n):
            x, y = at(d0 + step * (i + 0.5), lat)
            inst(key, "kerb", material, x, y, FLOOR, AYAW, step / 120.0 * 1.01, width / 36.2, height / 28.2)

    def strip_across(key, material, d, lat0, lat1, width, height=2.0):
        n = max(1, int(round((lat1 - lat0) / 118.0)))
        step = (lat1 - lat0) / n
        for i in range(n):
            x, y = at(d, lat0 + step * (i + 0.5))
            inst(key, "kerb", material, x, y, FLOOR, AYAW + 90.0, step / 120.0 * 1.01, width / 36.2, height / 28.2)

    def ring(key, material, d, lat, radius, width, height=2.0, seg_len=38.0):
        cx, cy = at(d, lat)
        n = max(12, int(round(2.0 * math.pi * radius / seg_len)))
        for i in range(n):
            a = 2.0 * math.pi * (i + 0.5) / n
            chord = 2.0 * radius * math.sin(math.pi / n) * 1.04
            inst(key, "kerb", material, cx + radius * math.cos(a), cy + radius * math.sin(a), FLOOR,
                 math.degrees(a) + 90.0, chord / 120.0, width / 36.2, height / 28.2)

    for side in (1.0, -1.0):
        strip_along("BorderGold", "MI_V2_Gold", side * BORDER_LAT, 150.0, 1180.0, 16.0)
        strip_along("BorderGold", "MI_V2_Gold", side * BORDER_LAT, 1920.0, 2250.0, 16.0)
    for d in (300.0, 1100.0, 2150.0):
        strip_across("BandRose", "MI_V2_RoofRose", d, -BORDER_LAT + 10.0, BORDER_LAT - 10.0, 60.0, 1.6)
        for dd in (-36.0, 36.0):
            strip_across("BandGold", "MI_V2_Gold", d + dd, -BORDER_LAT + 10.0, BORDER_LAT - 10.0, 6.0, 2.0)
    R = 230.0
    ring("MedallionGold", "MI_V2_Gold", 700.0, 0.0, R, 16.0, 2.2)
    for rr in (R - 26.0, R - 44.0, R - 62.0):
        ring("MedallionRose", "MI_V2_RoofRose", 700.0, 0.0, rr, 19.0, 1.8)
    ring("MedallionGold", "MI_V2_Gold", 700.0, 0.0, R * 0.55, 12.0, 2.2)
    ring("MedallionGold", "MI_V2_Gold", 700.0, 0.0, R * 0.16, 10.0, 2.4, seg_len=20.0)

    # ---- the clock rondel
    D_CLOCK = 1550.0
    cx, cy = at(D_CLOCK, 0.0)
    ring_scale = (1.0, 1.0, 0.55)
    actor("Rondel_Ring", "ring_base", (cx, cy, FLOOR - 4.0), ["MI_V2_IvoryStone"], ring_scale, yaw=AYAW)
    ring_top = FLOOR - 4.0 + 76.8 * ring_scale[2]
    ring("RondelGold", "MI_V2_Gold", D_CLOCK, 0.0, 262.0, 14.0, 3.0)
    for k in range(6):
        a = 2.0 * math.pi * (k + 0.5) / 6.0
        bx, by = cx + 175.0 * math.cos(a), cy + 175.0 * math.sin(a)
        mat = ["MI_V2_PetalViolet", "MI_V2_PetalPink"][k % 2]
        inst("RondelBlooms_%s" % mat[-4:], "blooms0", mat, bx, by, ring_top - 8.0, math.degrees(a), 0.55, 0.55, 0.9, True)
        inst("RondelRoses", "rose_bush", "MI_V2_RosePink", cx + 205.0 * math.cos(a + 0.5), cy + 205.0 * math.sin(a + 0.5),
             ring_top - 10.0, math.degrees(a), 0.45, 0.45, 0.5, True)
    ped_scale = 1.35
    actor("Clock_Pedestal", "pedestal", (cx, cy, ring_top - 6.0), ["MI_V2_MarblePale"], ped_scale, yaw=AYAW)
    clock_base = ring_top - 6.0 + 124.0 * ped_scale - 8.0
    clock_scale = 1.4
    # the dial is on the clock's local +x face (GA06: yaw -90 turned it to -y); +x toward the visitor is yaw AYAW+180
    actor("Clock_Dial", "clock_enamel", (cx, cy, clock_base), ["MI_V2_Ceramic"], clock_scale, yaw=AYAW + 180.0, collision="none")
    actor("Clock_Gold", "clock_gold", (cx, cy, clock_base), ["MI_V2_Gold"], clock_scale, yaw=AYAW + 180.0)

    # ---- lamps and topiary
    for k, d in enumerate((400.0, 1000.0, 2050.0)):
        for side, tag in ((1.0, "L"), (-1.0, "R")):
            x, y = at(d, side * (BORDER_LAT + 45.0))
            actor("LampPost%d%s" % (k, tag), "waymarker", (x, y, FLOOR), ["MI_V2_IvoryStone"], 0.42)
            actor("Lamp%d%s" % (k, tag), "waymarker_lamp", (x, y, FLOOR), ["MI_V2_GlassAmber"], 0.42, collision="none")
    for side, tag in ((1.0, "L"), (-1.0, "R")):
        x, y = at(1950.0, side * 300.0)
        actor("Spiral%s" % tag, "spiral", (x, y, FLOOR), ["MI_V2_LeafDark"], 0.7)

    return {"pass": PASS, "title": "The Grand Clock: promenade courses, the grand pocket clock in a flower rondel, lamps",
            "folder": "Wonderland/Authored/DC01", "tags": ["V2_Districts"], "actors": actors, "batches": list(batches.values())}


if __name__ == "__main__":
    trim = build_trim()
    (HERE / "dc01_grand_clock_trim.json").write_text(json.dumps(trim, indent=1) + "\n", encoding="utf-8", newline="\n")
    layer = build_layer()
    (HERE / "dc01_grand_clock_court.json").write_text(json.dumps(layer, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d trims; %d actors, %d batches, %d instances" % (PASS, len(trim["trims"]), len(layer["actors"]), len(layer["batches"]),
          sum(len(b["instances"]) for b in layer["batches"])))
