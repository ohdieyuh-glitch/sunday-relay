#!/usr/bin/env python3
"""GA02 -- the Clock Plaza and the Heart Garden: the corridor between the golden gate and the palace.

WHAT WAS THERE. Walking past the golden gate, the recovered world opened onto a bare lawn with a
fountain and a scatter of tea-party props, then a long empty lawn and a 2.8 m paved strip to the
palace. It read as unfinished -- the opposite of "lush authored gardens" -- on the one stretch every
visitor walks.

WHAT THIS LAYER ADDS, in the founder's corridor order (APPROACH -> GOLDEN GATE -> GARDEN PATH ->
CLOCK PLAZA -> HEART GARDEN -> PALACE):
  CLOCK PLAZA   a paved round plaza (r 10.5 m) about the existing fountain, gold inlay rings, a
                flower ring at the basin, benches, rose-glass lamps, and a pair of ivory clock
                towers with gold dials and pink roofs marking the way on to the palace.
  HEART GARDEN  four heart-shaped parterres (clipped box border, roses inside) either side of the
                palace path, three rose trellis arches over the path crowned with gold hearts,
                heart topiaries at the palace end, and lamps along the walk.

MEASURED INPUTS. Ground z -14 across the court and garden (PIE probe); the palace path is one
terrace instance from (-25, 6923) to (425, 9477), 2.8 m wide, top z 19; the fountain basin is
r 298 at (0, 5400). obstacles_court_heart.json (editor job obstacles.py) lists every standing
piece; nothing here is placed inside one. Mesh sizes: wonderland/WorldDesign/mesh_bounds.json.

Run:  python wonderland/WorldDesign/GoldenArrival/ga02_clock_plaza_heart_garden.py
"""
import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
PASS = "GA02"
GROUND = -14.0
V2 = "/Game/WonderlandV2/"
MESH = {
    "slab0": V2 + "Ground/Cobblestone/SM_plaza_slab_0.SM_plaza_slab_0",
    "slab3": V2 + "Ground/Cobblestone/SM_plaza_slab_3.SM_plaza_slab_3",
    "slab6": V2 + "Ground/Cobblestone/SM_plaza_slab_6.SM_plaza_slab_6",
    "kerb": V2 + "Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone",
    "tower_clock": V2 + "Architecture/Castle/SM_tower_clock.SM_tower_clock",
    "roof_cone": V2 + "Architecture/Castle/SM_roof_cone_steep.SM_roof_cone_steep",
    "finial_spire": V2 + "Architecture/Castle/SM_finial_spire.SM_finial_spire",
    "clock_ornate": V2 + "Props/Clocks/SM_clock_ornate.SM_clock_ornate",
    "bench": V2 + "Props/Garden/SM_garden_bench.SM_garden_bench",
    "waymarker": V2 + "Props/Garden/SM_waymarker.SM_waymarker",
    "waymarker_lamp": V2 + "Props/Garden/SM_waymarker_lamp.SM_waymarker_lamp",
    "blossom": V2 + "Vegetation/Flowers/SM_blossom_cluster.SM_blossom_cluster",
    "topiary_ball": V2 + "Vegetation/Topiary/SM_topiary_ball.SM_topiary_ball",
    "rose_bush": V2 + "Vegetation/Roses/SM_rose_bush.SM_rose_bush",
    "rose_bloom": V2 + "Vegetation/Roses/SM_rose_bloom.SM_rose_bloom",
    "ground_blooms": V2 + "Vegetation/Flowers/SM_ground_blooms.SM_ground_blooms",
    "trellis": V2 + "Architecture/Garden/SM_floral_arch_trellis.SM_floral_arch_trellis",
    "finial_heart": V2 + "Architecture/Gates/SM_gate_finial_heart.SM_gate_finial_heart",
    "heart": V2 + "Vegetation/Topiary/SM_heart_topiary.SM_heart_topiary",
    "ring_base": V2 + "Mushrooms/Landmark/SM_stone_ring_base.SM_stone_ring_base",
}

PLAZA_C = (0.0, 5400.0)
PLAZA_R = 1050.0
PATH_A = (-25.0, 6923.0)
PATH_B = (425.0, 9477.0)


def load_obstacles():
    rows = json.loads((HERE / "obstacles_court_heart.json").read_text(encoding="utf-8"))["obstacles"]
    return [(r[2], r[3], r[4], r[5], r[6], r[1]) for r in rows]


def heart_curve(t):
    """Unit heart, lobes at +y, point at -y; half-width ~1, height ~1.1."""
    x = 16.0 * math.sin(t) ** 3 / 16.0
    y = (13.0 * math.cos(t) - 5.0 * math.cos(2 * t) - 2.0 * math.cos(3 * t) - math.cos(4 * t)) / 16.0
    return x, y


def inside_heart(x, y, samples=240):
    """Point-in-polygon against the sampled unit heart."""
    poly = [heart_curve(2.0 * math.pi * k / samples) for k in range(samples)]
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def build():
    rng = random.Random(20260913 + 2)
    obstacles = load_obstacles()
    actors, batches = [], {}

    def clear(x, y, radius, margin=30.0, ignore_low=False):
        for (ox, oy, orad, zmin, zmax, mesh) in obstacles:
            if ignore_low and zmax < 40:
                continue
            if zmin > 150:      # raised arches, canopies and high ornaments do not occupy the ground
                continue
            # The obstacle radius is a bounding-box diagonal; most kit pieces are round in plan,
            # so 0.72 of the diagonal is the footprint (a first pass at 1.0 left the plaza 75% holes).
            if math.hypot(x - ox, y - oy) < orad * 0.72 + radius + margin:
                return False
        return True

    def actor(id_, mesh, loc, materials, scale=1.0, yaw=0.0, collision="block"):
        s = [scale] * 3 if isinstance(scale, (int, float)) else list(scale)
        actors.append({"id": id_, "mesh": MESH[mesh], "loc": [round(v, 2) for v in loc], "rot": [0.0, round(yaw, 2), 0.0],
                       "scale": [round(v, 4) for v in s], "materials": materials, "collision": collision})

    def plant(batch, kind, petal, loc, yaw, scale=1.0, leaf="MI_V2_LeafMid"):
        """FL03: one forge flower bed run (GAP 19); every part and material is its own batch."""
        module = {"daisy": "WL_Flower_Daisy_Run", "lavender": "WL_Flower_Lavender_Run", "rose": "WL_Flower_Rose_Run"}[kind]
        for part in KIT[module]["parts"]:
            material = petal if part["part"] == "petal" else (leaf if part["part"] == "leaf" else part["material"])
            key = "%s_%s_%s" % (kind, part["part"], material.split("_")[-1])
            MESH[key] = part["mesh"]
            instance("%s_%s" % (batch, key), key, material, loc, scale, yaw)

    def instance(batch_id, mesh, material, loc, scale, yaw, collides=False, cast_shadow=True):
        s = [scale] * 3 if isinstance(scale, (int, float)) else list(scale)
        b = batches.setdefault(batch_id, {"id": batch_id, "mesh": MESH[mesh], "material": material, "instances": [],
                                          "collides": collides, "cast_shadow": cast_shadow, "affect_df": collides})
        b["instances"].append([round(loc[0], 1), round(loc[1], 1), round(loc[2], 2), 0.0, round(yaw, 1), 0.0,
                               round(s[0], 3), round(s[1], 3), round(s[2], 3)])

    cx, cy = PLAZA_C

    # ------------------------------------------------------------------ CLOCK PLAZA: paving
    cell = 128.0
    slabs = ["slab0", "slab3", "slab6"]
    materials = ["MI_V2_PlazaCream"] * 6 + ["MI_V2_PlazaWarm"] * 3 + ["MI_V2_PlazaGrey"]
    n = int(PLAZA_R // cell) + 1
    # The lawn's small plantings stay where they are and get a stone ring planter each, so the
    # paving runs up to a planter instead of stopping in a ragged hole (GA02a left 64 holes).
    planters = []
    for (ox, oy, orad, zmin, zmax, mesh) in obstacles:
        # Upright plantings only (zmax >= 60): flat ground flowers sit happily on paving. A walk test
        # found six planters plus the cone topiaries jamming the Dog on the plaza's east side.
        if math.hypot(ox - cx, oy - cy) < PLAZA_R - 60 and 60 <= zmax < 200 and zmin < 80 and orad < 180 and mesh not in ("SM_garden_urn",):
            planters.append((ox, oy))
    kept_planters = []
    for (px, py) in planters:
        if all(math.hypot(px - qx, py - qy) > 150 for (qx, qy) in kept_planters):
            kept_planters.append((px, py))
    for k, (px, py) in enumerate(kept_planters):
        # Walk-through decoration: a 32 cm stone ring is a trip hazard, not a wall.
        instance("PlazaPlanterRings", "ring_base", "MI_V2_IvoryStone", (px, py, GROUND), (0.36, 0.36, 0.42), rng.uniform(0, 360), collides=False)

    def solid_clear(x, y, radius, margin):
        for (ox, oy, orad, zmin, zmax, mesh) in obstacles:
            if zmin > 150 or zmax < 200:
                continue      # low plantings sit in planters or on paving; raised pieces do not touch the ground
            if math.hypot(x - ox, y - oy) < orad * 0.72 + radius + margin:
                return False
        return all(math.hypot(x - px, y - py) > 92 + radius for (px, py) in kept_planters)

    # CONCENTRIC COURSES, not a grid. GA02a/b laid a square grid and from above it read as scattered
    # tiles on a lawn; a round plaza is laid in rings, each slab turned to face the fountain.
    radius = 520.0
    course = 0
    while radius <= PLAZA_R - 60.0:
        count = max(12, int(round(2.0 * math.pi * radius / 132.0)))
        for k in range(count):
            ang = 360.0 * (k + (0.5 if course % 2 else 0.0)) / count
            x = cx + radius * math.cos(math.radians(ang))
            y = cy + radius * math.sin(math.radians(ang))
            if y < 4480 and abs(x) < 300:      # the raised gate path lands here
                continue
            if not solid_clear(x, y, 58.0, margin=2.0):
                continue
            mesh = slabs[(k + course) % 3]
            material = rng.choice(materials)
            tangential = 2.0 * math.pi * radius / count / 130.0
            instance("PlazaSlabs_%s_%s" % (mesh, material.split("_")[-1]), mesh, material, (x, y, GROUND + 0.5),
                     (1.0, min(1.02, tangential * 1.02), 1.0), ang, collides=True)
        radius += 128.0
        course += 1

    # Gold inlay rings: the plaza's rim and a ring about the basin. Gaps where the paths enter.
    def ring(radius, count, skip_deg=()):
        for k in range(count):
            ang = 360.0 * k / count
            if any(abs((ang - s + 180.0) % 360.0 - 180.0) < 10.0 for s in skip_deg):
                continue
            x = cx + radius * math.cos(math.radians(ang))
            y = cy + radius * math.sin(math.radians(ang))
            if not clear(x, y, 50.0, margin=5.0, ignore_low=True):
                continue
            instance("InlayGold", "kerb", "MI_V2_Gold", (x, y, GROUND), (1.02 * 2 * math.pi * radius / count / 120.0, 0.8, 0.6), ang + 90.0)

    ring(PLAZA_R, 56, skip_deg=(90.0, 270.0))
    ring(430.0, 24)

    # A flower ring in the planting band between the basin ring and the paving.
    # FL03 (2026-09-13): 18 blossom clusters read as colour pads round the fountain; 20 flower runs laid round the ring,
    # turned along it, violet / pink / rose, fill the band.
    # FL03b: one ring at scale 1.0 read lower and sparser than the clusters it replaced. Two rings now: tall lavender and
    # roses against the basin (r 3.35 m, x1.35), daisies and roses at the gold edge (r 3.95 m, x1.15).
    for radius, count, scale, kinds in ((335.0, 18, 1.35, [("lavender", "MI_V2_PetalViolet"), ("rose", "MI_V2_RosePink"),
                                                          ("lavender", "MI_V2_PetalViolet"), ("rose", "MI_V2_RoseRed")]),
                                        (395.0, 22, 1.15, [("daisy", "MI_V2_PetalPink"), ("rose", "MI_V2_RosePink"),
                                                          ("daisy", "MI_V2_PetalViolet"), ("daisy", "MI_V2_PetalWhite")])):
        for k in range(count):
            ang = math.radians(360.0 * (k + 0.5) / count)
            x, y = cx + radius * math.cos(ang), cy + radius * math.sin(ang)
            kind, petal = kinds[k % len(kinds)]
            plant("BasinFlowers", kind, petal, (x, y, GROUND), math.degrees(ang) + 90.0, scale,
                  leaf="MI_V2_LeafDark" if k % 2 else "MI_V2_LeafMid")

    # Benches facing the fountain, and rose-glass lamps around the rim.
    for k, ang in enumerate((45.0, 135.0, 225.0, 315.0)):
        x, y = cx + 800.0 * math.cos(math.radians(ang)), cy + 800.0 * math.sin(math.radians(ang))
        if clear(x, y, 90.0, margin=10.0):
            actor("Bench%d" % k, "bench", (x, y, GROUND + 13.0), ["MI_V2_IvoryStone"], 1.0, yaw=ang)
    for k, ang in enumerate((20.0, 55.0, 125.0, 160.0, 200.0, 235.0, 305.0, 340.0)):
        x, y = cx + 1160.0 * math.cos(math.radians(ang)), cy + 1160.0 * math.sin(math.radians(ang))
        if clear(x, y, 70.0, margin=20.0):
            actor("PlazaLampPost%d" % k, "waymarker", (x, y, GROUND), ["MI_V2_IvoryStone"], 0.5)
            actor("PlazaLamp%d" % k, "waymarker_lamp", (x, y, GROUND), ["MI_V2_GlassRose"], 0.5, collision="none")

    # The clock towers: ivory, gold dials on all four faces, pink cone roofs, gold spires.
    tower_scale = 0.85
    for side, tx in (("L", 1250.0), ("R", -1250.0)):
        ty = 6350.0
        if not clear(tx, ty, 190.0, margin=10.0):
            raise SystemExit("clock tower %s would stand inside an existing piece" % side)
        top = GROUND + 1190.0 * tower_scale
        actor("ClockTower%s" % side, "tower_clock", (tx, ty, GROUND), ["MI_V2_IvoryStone"], tower_scale)
        actor("ClockTower%s_Roof" % side, "roof_cone", (tx, ty, top), ["MI_V2_RoofPink"], 0.82, collision="none")
        actor("ClockTower%s_Spire" % side, "finial_spire", (tx, ty, top + 604.0 * 0.82 - 10.0), ["MI_V2_Gold"], 1.3, collision="none")
        # GA02a hung 2.4x ornate clocks here and each read as a gold blob wider than the tower.
        # At 1.25x the dial is 195 cm across on a 300 cm face, a clock rather than an ornament.
        half = 176.0 * tower_scale + 16.0
        dial_z = GROUND + 820.0 * tower_scale
        for k, (dx, dy, yaw) in enumerate(((half, 0.0, 0.0), (-half, 0.0, 180.0), (0.0, half, 90.0), (0.0, -half, 270.0))):
            actor("ClockTower%s_Dial%d" % (side, k), "clock_ornate", (tx + dx, ty + dy, dial_z), ["MI_V2_Gold"], 1.25, yaw=yaw, collision="none")

    # ------------------------------------------------------------------ HEART GARDEN
    ax, ay = PATH_A
    bx, by = PATH_B
    length = math.hypot(bx - ax, by - ay)
    dx, dy = (bx - ax) / length, (by - ay) / length       # along the path, toward the palace
    nx, ny = dy, -dx                                       # across the path (+ is the walker's left)
    path_yaw = math.degrees(math.atan2(dy, dx))
    across_yaw = math.degrees(math.atan2(ny, nx))

    def along(s, offset):
        return ax + dx * s * length + nx * offset, ay + dy * s * length + ny * offset

    heart_half = 380.0
    for s in (0.26, 0.64):
        for side, offset in (("L", 610.0), ("R", -610.0)):
            hx0, hy0 = along(s, offset)
            tag = "%s%02d" % (side, int(s * 100))
            # Border: clipped box balls along the heart outline (heart axis along the path).
            count = 64
            for k in range(count):
                ux, uy = heart_curve(2.0 * math.pi * k / count)
                wx = hx0 + nx * ux * heart_half + dx * uy * heart_half
                wy = hy0 + ny * ux * heart_half + dy * uy * heart_half
                if clear(wx, wy, 25.0, margin=5.0):
                    instance("HeartBorder", "topiary_ball", "MI_V2_LeafDark", (wx, wy, GROUND), rng.uniform(0.27, 0.31), rng.uniform(0, 360))
            # Fill: roses and blooms on a staggered grid inside the outline.
            step = 0.2
            for gi in range(-6, 7):
                for gj in range(-7, 7):
                    ux = gi * step + (step / 2 if gj % 2 else 0.0)
                    uy = gj * step * 0.9
                    if not inside_heart(ux / 0.92, uy / 0.92):
                        continue
                    wx = hx0 + nx * ux * heart_half + dx * uy * heart_half
                    wy = hy0 + ny * ux * heart_half + dy * uy * heart_half
                    if not clear(wx, wy, 35.0, margin=5.0):
                        continue
                    pick = (gi + gj) % 4
                    if pick == 0:
                        instance("HeartRoseBush", "rose_bush", "MI_V2_LeafMid", (wx, wy, GROUND), rng.uniform(0.38, 0.46), rng.uniform(0, 360))
                    elif pick == 1:
                        # FL03: ground blooms read as cushions; a short daisy run
                        plant("HeartFlowers", "daisy", "MI_V2_PetalPink", (wx, wy, GROUND), rng.uniform(0, 360), rng.uniform(0.62, 0.72))
                    else:
                        # FL03: SM_rose_bloom read as bowls; a short rose run
                        material = "MI_V2_RoseRed" if pick == 2 else "MI_V2_RosePink"
                        plant("HeartFlowers", "rose", material, (wx, wy, GROUND), rng.uniform(0, 360), rng.uniform(0.62, 0.72),
                              leaf="MI_V2_LeafDark")

    # Rose trellis arches over the path, each crowned with a gold heart.
    trellis_scale = 0.62
    for k, s in enumerate((0.1, 0.45, 0.8)):
        x, y = along(s, 0.0)
        actor("HeartArch%d" % k, "trellis", (x, y, GROUND), ["MI_V2_PetalRose"], trellis_scale, yaw=across_yaw, collision="none")
        actor("HeartArch%d_Crown" % k, "finial_heart", (x, y, GROUND + 620.0 * trellis_scale - 6.0), ["MI_V2_Gold"], 1.25, yaw=across_yaw, collision="none")
        for g in range(9):
            u = -1.0 + 2.0 * g / 8.0
            gx, gy = along(s, u * 280.0)
            gz = GROUND + 290.0 + 70.0 * (1.0 - u * u)
            material = "MI_V2_RoseRed" if g % 2 else "MI_V2_RosePink"
            instance("ArchGarland_" + material.split("_")[-1], "rose_bloom", material, (gx, gy, gz), rng.uniform(0.45, 0.6), rng.uniform(0, 360))

    # Heart topiaries at the palace end, broad faces turned to the approaching visitor.
    for side, offset in (("L", 560.0), ("R", -560.0)):
        x, y = along(0.9, offset)
        if clear(x, y, 230.0, margin=10.0):
            actor("PalaceHeart%s" % side, "heart", (x, y, GROUND), ["MI_V2_LeafMid"], 0.42, yaw=across_yaw)

    # Lamps along the walk.
    for k, s in enumerate((0.3, 0.6, 0.9)):
        for side, offset in (("L", 245.0), ("R", -245.0)):
            x, y = along(s, offset)
            if clear(x, y, 60.0, margin=15.0):
                actor("WalkLampPost%d%s" % (k, side), "waymarker", (x, y, GROUND), ["MI_V2_IvoryStone"], 0.42)
                actor("WalkLamp%d%s" % (k, side), "waymarker_lamp", (x, y, GROUND), ["MI_V2_GlassRose"], 0.42, collision="none")

    return {
        "pass": PASS,
        "title": "Clock Plaza (paving, gold inlay, flower ring, benches, lamps, clock towers) and Heart Garden (heart parterres, rose arches, heart topiaries, lamps)",
        "folder": "Wonderland/Authored/GA02",
        "tags": ["V2_Garden"],
        "actors": actors,
        "batches": list(batches.values()),
    }


if __name__ == "__main__":
    spec = build()
    out = HERE / "ga02_clock_plaza_heart_garden.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d actors, %d batches, %d instances -> %s" % (
        PASS, len(spec["actors"]), len(spec["batches"]), sum(len(b["instances"]) for b in spec["batches"]), out.name))
