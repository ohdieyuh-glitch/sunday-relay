#!/usr/bin/env python3
"""TR01 -- THE TARTARUS APPROACH AND FIRST QUARTER: the red nation's first built ground.

FOUNDER DIRECTIVE (2026-09-22). TARTARUS is CRIMSON, dark red, black and warm metal, and it is the SOFTWARE AND
APPLICATION CREATION civilization. The founder's warning is the mirror of Noctis's and just as important:
"Engineering-focused. NOT demonic generic evil architecture." Red is not evil here; red is a forge.

WHY IT IS BUILDABLE NOW. Tartarus listed materials_existing: [] this morning. Five instances were built today --
Crimson, Roof, Metal, Black and Ember -- and the deliberate choice that keeps this a workshop rather than a hell is
the ember: an emissive at 2300 in scene units, a forge glow at the base of things, never a fire in the sky. Its
metal is worked bronze at metallic 0.86, not something molten.

HOW SOFTWARE IS SAID IN ARCHITECTURE, never in a label. Software is made by people at benches, tested hard, and
shipped; so this quarter is a working yard, not a palace precinct:

  THE FOUNDRY APPROACH -- a causeway lit by ember standards, arriving at a working place rather than a ceremonial
                          one. Where Icarus has balustrades and urns, Tartarus has lamps and kerbs.
  THE ASSEMBLY YARDS   -- ranks of market arcades and canopies: open-sided working bays with benches under cover.
                          This is the nation's most-repeated building because it is where the work happens.
  THE PROVING HALLS    -- palace wings flanking the axis. Applications are not finished when they are written;
                          they are finished when they have been tested, so the halls face each other across the
                          road and the road runs between them.
  THE FORGE            -- the grand dome in crimson with ember accents at its base, the nation's great room.
  THE ENGINE TOWERS    -- stacked towers with ember-lit crowns, joined at height.
  ARTISAN TERRACES     -- houses in rows, because a software nation is individual makers too.

Built in the same local frame as NC01 and rotated: Tartarus's sector is bearing -90..30, so its axis runs out at
-30 degrees. Every lesson from IC02 and NC01 is applied rather than rediscovered -- exact plate tiling so no lawn
shows through, banding by use, socket-stacked towers, plinth courses off recorded footprints, skipped veg_anchor
panels, kerb runs rather than kerb stones, and a floor that starts where the approach's own last plate ends.

    python tartarus_quarter.py         (writes tr01_quarter.json)
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

PASS = "TR01"
BEARING = -30.0                  # the middle of Tartarus's sector (-90..30)
U_START = 50400.0
PAVING_TOP = 12.0
PLATE = {"mesh": "/Game/WonderlandV2/Architecture/Stairs/SM_terrace_platform.SM_terrace_platform",
         "len_x": 1440.0, "len_y": 740.0, "top_local": 140.0}

CRIMSON = "MI_V2_TartarusCrimson"
TR_ROOF = "MI_V2_TartarusRoof"
METAL = "MI_V2_TartarusMetal"
BLACK = "MI_V2_TartarusBlack"
EMBER = "MI_V2_TartarusEmber"
#: Tartarus reads the kit its own way: its stone is crimson masonry, its accents are worked metal, its dark stone
#: is black, and the ember is reserved for glass and lamps -- a glow from inside a working building.
PART_MATERIAL = {"gold": METAL, "stone": CRIMSON, "stone_dark": BLACK, "glass": EMBER,
                 "roof": TR_ROOF, "roof_alt": TR_ROOF, "kerb": BLACK, "metal": METAL,
                 "moss": "MI_V2_Moss", "gold_aged": METAL,
                 "paving": "MI_V2_GroundFlag_PlazaShade", "paving_shade": "MI_V2_GroundFlag_PlazaGrey",
                 "paving_warm": "MI_V2_GroundFlag_PlazaWarm"}
NO_COLLIDE_PARTS = ("glass", "gold", "roof", "roof_alt", "veg_anchor", "moss", "metal", "gold_aged")
SKIP_PARTS = ("veg_anchor",)
CULL_NEAR, CULL_MID, CULL_FAR = 12000.0, 26000.0, 60000.0

_RAD = math.radians(BEARING)
_DIR = (math.cos(_RAD), math.sin(_RAD))
_LEFT = (-math.sin(_RAD), math.cos(_RAD))


def world(u, v):
    return (_DIR[0] * u + _LEFT[0] * v, _DIR[1] * u + _LEFT[1] * v)


def socket(name, which):
    return (KIT[name].get("sockets") or {}).get(which)


def main():
    batches, actors, footprints = {}, [], []
    stats = Counter()
    rng = random.Random(PASS)

    def add(key, mesh, material, u, v, z, yaw_local, scale=1.0, cull=CULL_NEAR, shadow=True, collides=False):
        x, y = world(u, v)
        bt = batches.setdefault(key, {"id": "%s_%s" % (PASS, key), "mesh": mesh, "material": material,
                                      "instances": [], "collides": collides, "cast_shadow": shadow,
                                      "affect_df": False, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0,
                                round((yaw_local + BEARING) % 360.0, 1), 0.0,
                                round(scale, 3), round(scale, 3), round(scale, 3)])
        stats[key] += 1

    def add_module(name, u, v, z, yaw_local, scale=1.0, cull=CULL_NEAR, collide=True, record=False):
        for part in KIT[name]["parts"]:
            if part["part"] in SKIP_PARTS:
                continue
            mat = PART_MATERIAL.get(part["part"], part["material"])
            blocks = collide and part["part"] not in NO_COLLIDE_PARTS
            add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], mat, u, v, z, yaw_local,
                scale, cull, collides=blocks)
        if record:
            sz = KIT[name]["size"]
            footprints.append((name, u, v, z, yaw_local, sz[0] * scale, sz[1] * scale))

    def stack(chain, u, v, z, yaw_local, cull=CULL_FAR):
        top_z, joints, expect = z, [], ("ground", None)
        for name in chain:
            bot = socket(name, "bottom")
            if bot is None:
                raise SystemExit("%s has no bottom socket" % name)
            if bot.get("kind") != expect[0] or (expect[1] is not None and bot.get("rung") != expect[1]):
                raise SystemExit("cannot stack %s onto %s/%s" % (name, expect[0], expect[1]))
            add_module(name, u, v, top_z - bot.get("z", 0.0), yaw_local, cull=cull)
            top = socket(name, "top")
            if top is None:
                break
            top_z = top_z - bot.get("z", 0.0) + top.get("z", 0.0)
            joints.append(top_z)
            expect = (top.get("kind"), top.get("rung"))
        return top_z, joints

    def anchor(gve, label, u, v, z):
        x, y = world(u, v)
        actors.append({"id": label, "mesh": KIT["WL_Ground_Plaza_Medallion"]["parts"][0]["mesh"],
                       "loc": [round(x, 1), round(y, 1), round(z, 1)], "rot": [0.0, BEARING, 0.0],
                       "materials": [PART_MATERIAL["paving"]], "scale": [0.25, 0.25, 0.02],
                       "collision": "none", "cast_shadow": False,
                       "tags": ["WL_NATION_TARTARUS", "WL_GVE_" + gve, "WL_DISTRICT_TARTARUS_FIRST"]})
        stats["anchor"] += 1

    # ---------------------------------------------------------------- 1. the floor
    ROWS = 42
    U0 = U_START
    U1 = U0 + PLATE["len_y"] * ROWS

    def pave_band(cols_from, cols_to, material, key, rows_from=0, rows_to=None):
        for c in range(cols_from, cols_to):
            v = (c + 0.5) * PLATE["len_x"]
            for j in range(rows_from, ROWS if rows_to is None else rows_to):
                # YAW 90, NOT 0. The plate is 1440 along its own X and 740 along its Y. In a ROTATED quarter
                # the local frame turns with the nation's bearing, so at yaw 0 the 1440 side runs ALONG the axis
                # while this grid spaces columns 1440 apart ACROSS it -- which left a 700 mm gap between every
                # pair of columns and striped the whole quarter with lawn. Turning each plate 90 degrees puts its
                # long side across the axis, where the column spacing actually is.
                add(key, PLATE["mesh"], material, U0 + PLATE["len_y"] * (j + 0.5), v,
                    PAVING_TOP - PLATE["top_local"], 90.0, cull=CULL_FAR, collides=True, shadow=False)

    APPROACH_ROWS = 18
    pave_band(-1, 1, PART_MATERIAL["paving"], "Causeway", 0, APPROACH_ROWS)
    pave_band(-1, 1, PART_MATERIAL["paving"], "Road", APPROACH_ROWS, None)
    pave_band(-3, -1, PART_MATERIAL["paving_shade"], "YardBand", APPROACH_ROWS, None)
    pave_band(1, 3, PART_MATERIAL["paving_shade"], "YardBand", APPROACH_ROWS, None)
    pave_band(-6, -3, PART_MATERIAL["paving_shade"], "WorksBlock", APPROACH_ROWS + 4, None)
    pave_band(3, 6, PART_MATERIAL["paving_shade"], "WorksBlock", APPROACH_ROWS + 4, None)
    FLOOR_HALF = 6 * PLATE["len_x"]
    QUARTER_U = U0 + PLATE["len_y"] * APPROACH_ROWS

    run = KIT["WL_Ground_Kerb_Run"]["size"][0]
    for side in (-1.0, 1.0):
        n = int((QUARTER_U - U0) // run)
        for i in range(n):
            add_module("WL_Ground_Kerb_Run", U0 + run * (i + 0.5), side * PLATE["len_x"], PAVING_TOP, 90.0,
                       cull=CULL_NEAR, collide=False)
        n = int((U1 - QUARTER_U - PLATE["len_y"] * 4) // run)
        for i in range(n):
            add_module("WL_Ground_Kerb_Run", QUARTER_U + PLATE["len_y"] * 4 + run * (i + 0.5),
                       side * FLOOR_HALF, PAVING_TOP, 90.0, cull=CULL_NEAR, collide=False)

    # ---------------------------------------------------------------- 2. the foundry approach
    lamp_step = 1600.0
    for i in range(int((QUARTER_U - U0) // lamp_step)):
        u = U0 + lamp_step * (i + 0.5)
        for side in (-1.0, 1.0):
            add_module("WL_Object_LanternStandard", u, side * (PLATE["len_x"] + 190.0), PAVING_TOP, 0.0,
                       cull=CULL_MID, collide=True)
    anchor("APPROACH", "TartarusApproach", U0 + (QUARTER_U - U0) * 0.5, 0.0, PAVING_TOP)
    add_module("WL_Arch_Twin_Tiered", QUARTER_U - 300.0, 0.0, PAVING_TOP, 0.0, cull=CULL_FAR)

    # ---------------------------------------------------------------- 3. the assembly yards
    # Open-sided working bays in ranks. The most repeated building in the nation, because it is where work happens.
    bay = KIT["WL_Market_Arcade_Insert"]["size"][0] if "WL_Market_Arcade_Insert" in KIT else 800.0
    for side in (-1.0, 1.0):
        u = QUARTER_U + 1200.0
        n = 0
        while u < QUARTER_U + 11000.0:
            add_module("WL_Market_Canopy", u, side * 2600.0, PAVING_TOP, 90.0 * side, cull=CULL_MID, record=True)
            if n % 2 == 0:
                add_module("WL_Market_Corner_Storefront", u + 300.0, side * 3700.0, PAVING_TOP, 90.0 * side,
                           cull=CULL_MID, record=True)
            u += bay * 1.5
            n += 1
    anchor("ASSEMBLY_YARD", "AssemblyYards", QUARTER_U + 5600.0, 0.0, PAVING_TOP)

    # ---------------------------------------------------------------- 4. the proving halls, facing each other
    HALLS_U = QUARTER_U + 13200.0
    for side in (-1.0, 1.0):
        add_module("WL_Palace_Wing", HALLS_U, side * 4200.0, PAVING_TOP, 90.0 * side, cull=CULL_FAR, record=True)
        anchor("PROVING_HALL", "ProvingHall%s" % ("W" if side < 0 else "E"), HALLS_U, side * 4200.0, PAVING_TOP)

    # ---------------------------------------------------------------- 5. the forge
    FORGE_U = QUARTER_U + 19000.0
    add_module("WL_Palace_Dome_Grand", FORGE_U, 0.0, PAVING_TOP, 0.0, cull=CULL_FAR, record=True)
    anchor("FORGE", "TheForge", FORGE_U, 0.0, PAVING_TOP)
    # ember at the base of the forge: a glow from inside a working building, never a fire in the sky
    for k in range(8):
        a = math.radians(k * 45.0)
        add_module("WL_Detail_Wall_Lantern", FORGE_U + 2050.0 * math.cos(a), 2050.0 * math.sin(a),
                   PAVING_TOP + 260.0, math.degrees(a), cull=CULL_NEAR, collide=False)

    # ---------------------------------------------------------------- 6. the engine towers
    CHAINS = (
        ("WL_Tower_Base_Buttressed", "WL_Tower_Mid_Machicolated", "WL_Tower_Mid_Fluted", "WL_Tower_Crown_Cone"),
        ("WL_Tower_Base_Battered", "WL_Tower_Mid_Ashlar", "WL_Tower_Mid_Arcade", "WL_Tower_Crown_Belvedere"),
        ("WL_Tower_Base_Terraced", "WL_Tower_Mid_Arcade", "WL_Tower_Mid_Oriel", "WL_Tower_Crown_Onion"),
    )
    SITES = [(QUARTER_U + 3000.0, -7000.0), (QUARTER_U + 3000.0, 7000.0),
             (QUARTER_U + 9800.0, -7200.0), (QUARTER_U + 9800.0, 7200.0),
             (QUARTER_U + 16400.0, -4600.0), (QUARTER_U + 16400.0, 4600.0)]
    tops = []
    for i, (tu, tv) in enumerate(SITES):
        top, joints = stack(CHAINS[i % len(CHAINS)], tu, tv, PAVING_TOP, rng.choice((0.0, 45.0, 90.0)))
        tops.append((tu, tv, top, joints))
        anchor("ENGINE_TOWER", "EngineTower%d" % (i + 1), tu, tv, PAVING_TOP)

    bridge = KIT["WL_Bridge_Sky"]["size"][0]
    DECK_IN_MODULE = KIT["WL_Bridge_Sky"]["sockets"]["end_a"]["z"]
    SHAFT_INSET, MAX_SPAN = 760.0, 9000.0
    for a, b in ((0, 2), (1, 3), (2, 4), (3, 5)):
        u0, v0, _, ja = tops[a]
        u1, v1, _, jb = tops[b]
        idx = min(2, len(ja) - 1, len(jb) - 1)
        deck = min(ja[idx], jb[idx])
        full = math.hypot(u1 - u0, v1 - v0)
        if full < 2.0 * SHAFT_INSET + bridge or full > MAX_SPAN:
            continue
        du, dv = (u1 - u0) / full, (v1 - v0) / full
        span = full - 2.0 * SHAFT_INSET
        yaw = math.degrees(math.atan2(dv, du))
        for k in range(max(1, int(round(span / bridge)))):
            t = (k + 0.5) / max(1, int(round(span / bridge)))
            add_module("WL_Bridge_Sky", u0 + du * (SHAFT_INSET + span * t), v0 + dv * (SHAFT_INSET + span * t),
                       deck - DECK_IN_MODULE, yaw, cull=CULL_FAR)
        anchor("ELEVATED_PATH", "TartarusBridge_%d_%d" % (a, b), (u0 + u1) / 2, (v0 + v1) / 2, deck)

    # ---------------------------------------------------------------- 7. artisan terraces
    HOUSE = ("WL_House_Gabled", "WL_House_Hipped", "WL_House_Jettied")
    house_w = KIT["WL_House_Gabled"]["size"][0]
    for side in (-1.0, 1.0):
        u = QUARTER_U + 3400.0
        n = 0
        while u < U1 - 3000.0:
            if n % 6 == 5:
                u += house_w * 1.6
                n += 1
                continue
            add_module(HOUSE[n % len(HOUSE)], u, side * 6400.0, PAVING_TOP - 12.0, 90.0 * side,
                       cull=CULL_MID, record=True)
            u += house_w * 1.06
            n += 1
        anchor("STUDIO_ROW", "TartarusArtisans%s" % ("W" if side < 0 else "E"), QUARTER_U + 9000.0,
               side * 6400.0, PAVING_TOP)

    # ---------------------------------------------------------------- 8. base courses from real footprints
    plinth = KIT["WL_Detail_Plinth_Block"]
    plinth_len = plinth["size"][0]
    for name, bu, bv, bz, byaw, bw, bd in footprints:
        half_w, half_d = bw / 2.0, bd / 2.0
        ca, sa = math.cos(math.radians(byaw)), math.sin(math.radians(byaw))
        full_ring = name.startswith("WL_Palace")
        faces = ((0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0)) if full_ring else ((0.0, -1.0),)
        for fx, fy in faces:
            run_len = bw if fy else bd
            n = max(1, int(run_len // plinth_len))
            for i in range(n):
                t = (i + 0.5) / n - 0.5
                lx = (t * bw if fy else fx * half_w)
                ly = (fy * half_d if fy else t * bd)
                add("PlinthCourse", plinth["parts"][0]["mesh"], BLACK,
                    bu + lx * ca - ly * sa, bv + lx * sa + ly * ca, bz, byaw + (0.0 if fy else 90.0),
                    cull=8000.0, shadow=False)

    spec = {"pass": PASS,
            "tags": ["WL_NATION_TARTARUS", "WL_DISTRICT_TARTARUS_FIRST"],
            "folder": "Wonderland/Authored/TR01_TartarusQuarter",
            "actors": actors,
            "batches": [b for b in batches.values() if b["instances"]]}
    (HERE / "tr01_quarter.json").write_text(json.dumps(spec, indent=1), encoding="utf-8")

    total = sum(len(b["instances"]) for b in spec["batches"])
    colliding = sum(len(b["instances"]) for b in spec["batches"] if b["collides"])
    cx, cy = world(QUARTER_U + 9000.0, 0.0)
    print("TR01 -> tr01_quarter.json")
    print("  batches %d, instances %d (%d colliding), anchors %d" % (len(spec["batches"]), total, colliding,
                                                                     len(actors)))
    print("  quarter centre world (%.0f, %.0f) -> %s" % (cx, cy, (nations.zone_at(cx, cy),)))
    for key, n in stats.most_common(8):
        print("    %-32s %5d" % (key, n))


if __name__ == "__main__":
    main()
