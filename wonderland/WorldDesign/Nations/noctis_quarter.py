#!/usr/bin/env python3
"""NC01 -- THE NOCTIS APPROACH AND FIRST QUARTER: the black nation's first built ground.

FOUNDER DIRECTIVE (2026-09-22): "After Icarus reaches a credible district boundary, continue preparing/expanding
the other nations rather than leaving the majority of Wonderland empty." NOCTIS is BLACK -- obsidian, dark glass,
silver, luminous details -- and it is the CONTENT CREATION civilization: film, music, streams, art, writing. The
founder's warning is explicit and is the hardest part of the brief: "Cinematic and elegant. NOT gloomy generic evil
architecture."

WHY THIS IS BUILDABLE NOW AND WAS NOT THIS MORNING. CANON/nations.json listed Noctis with materials_existing: [].
A nation with no materials can only be built by tinting at placement time, which is the trap make_nation_materials
exists to avoid. Five Noctis instances were built today -- Obsidian, Charcoal, Glass, Silver and Luminous -- and
the obsidian is POLISHED (roughness 0.17, specular 0.78) precisely so the nation reads as black glass catching
light rather than as a dark hole in the world. That single decision is what keeps this cinematic instead of gloomy.

HOW CONTENT CREATION IS SAID IN ARCHITECTURE, never in a label:
  THE APPROACH        -- a dark causeway out of the neutral core, lit down both sides. Noctis is the nation you
                         arrive at in the evening, so its road tells you that before any building does.
  THE SCREENING COURT -- a court walled with the kit's glass screens: great dark panes standing in ranks. This is
                         where work is shown.
  THE AMPHITHEATRE    -- a curved colonnade closing a half-round space, left empty in the middle. Performance
                         needs a room made of people, so the architecture makes the room and stops.
  THE OBSIDIAN HALL   -- the grand dome in polished obsidian with dark glass, the nation's own great room.
  THE GALLERY WALKS   -- long straight colonnades running out from the court: covered walls to hang work on.
  THE BROADCAST TOWERS-- stacked towers with LUMINOUS crowns. A signal tower says what this nation sends out, and
                         the luminous material is the only thing in Noctis that is allowed to be bright.
  THE STUDIO TERRACES -- houses in rows, because a content nation is individual makers, not only institutions.

EVERYTHING LEARNED ON IC02 IS APPLIED HERE RATHER THAN REDISCOVERED:
  * the floor is tiled EXACTLY on the plate grid so bands meet and no lawn shows through;
  * it is BANDED by use, so the ground says where you are;
  * towers stack on the kit's own sockets and a mismatched join raises;
  * every building records its footprint and gets a plinth base course from it;
  * veg_anchor panels are skipped -- they render as green slabs;
  * kerb runs, not kerb stones, because the run carries its own gutter course;
  * and the quarter's paving MEETS the approach's last plate, because IC02's walk fell down a 2.8 m hole where a
    pass declared an end its own loop never reached.

THE QUARTER IS BUILT IN A LOCAL FRAME AND ROTATED. Noctis's sector is bearing 150..270, so its axis runs out at
210 degrees and nothing here is axis-aligned. Laying it out in (u along the axis, v across) and rotating into the
world keeps the code readable and -- the reason it matters -- makes the same generator reusable for Tartarus,
which runs out at -30.

    python noctis_quarter.py           (writes nc01_quarter.json)
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

PASS = "NC01"
BEARING = 210.0                  # the middle of Noctis's sector (150..270)
U_START = 50400.0                # just outside the neutral core (50,000 uu)
PAVING_TOP = 12.0
PLATE = {"mesh": "/Game/WonderlandV2/Architecture/Stairs/SM_terrace_platform.SM_terrace_platform",
         "len_x": 1440.0, "len_y": 740.0, "top_local": 140.0}

OBSIDIAN = "MI_V2_NoctisObsidian"
CHARCOAL = "MI_V2_NoctisCharcoal"
NOX_GLASS = "MI_V2_NoctisGlass"
SILVER = "MI_V2_NoctisSilver"
LUMINOUS = "MI_V2_NoctisLuminous"
#: Noctis reads the kit's parts its own way. Its roofs are charcoal, its metal is silver, and the one thing
#: allowed to be bright is the luminous accent -- which is why `gold` maps to silver and not to the glow.
PART_MATERIAL = {"gold": SILVER, "stone": OBSIDIAN, "stone_dark": CHARCOAL, "glass": NOX_GLASS,
                 "roof": CHARCOAL, "roof_alt": CHARCOAL, "kerb": CHARCOAL, "metal": SILVER,
                 "moss": "MI_V2_Moss", "gold_aged": SILVER,
                 "paving": "MI_V2_GroundFlag_PlazaGrey", "paving_shade": "MI_V2_GroundFlag_PlazaShade",
                 "paving_warm": "MI_V2_GroundFlag_PlazaGrey"}
NO_COLLIDE_PARTS = ("glass", "gold", "roof", "roof_alt", "veg_anchor", "moss", "metal", "gold_aged")
SKIP_PARTS = ("veg_anchor",)
CULL_NEAR, CULL_MID, CULL_FAR = 12000.0, 26000.0, 60000.0

_RAD = math.radians(BEARING)
_DIR = (math.cos(_RAD), math.sin(_RAD))
_LEFT = (-math.sin(_RAD), math.cos(_RAD))


def world(u, v):
    """Local (u along the nation's axis, v across it) -> world (x, y)."""
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
                raise SystemExit("cannot stack %s (%s/%s) onto %s/%s"
                                 % (name, bot.get("kind"), bot.get("rung"), expect[0], expect[1]))
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
                       "tags": ["WL_NATION_NOCTIS", "WL_GVE_" + gve, "WL_DISTRICT_NOCTIS_FIRST"]})
        stats["anchor"] += 1

    # ---------------------------------------------------------------- 1. the floor, tiled exactly and banded
    ROWS = 42
    U0 = U_START
    U1 = U0 + PLATE["len_y"] * ROWS                  # 81480

    def pave_band(cols_from, cols_to, material, key, rows_from=0, rows_to=None):
        for c in range(cols_from, cols_to):
            v = (c + 0.5) * PLATE["len_x"]
            for j in range(rows_from, ROWS if rows_to is None else rows_to):
                add(key, PLATE["mesh"], material, U0 + PLATE["len_y"] * (j + 0.5), v,
                    PAVING_TOP - PLATE["top_local"], 0.0, cull=CULL_FAR, collides=True, shadow=False)

    APPROACH_ROWS = 18                                # the causeway, before the quarter widens
    pave_band(-1, 1, PART_MATERIAL["paving"], "Causeway", 0, APPROACH_ROWS)
    pave_band(-1, 1, PART_MATERIAL["paving"], "Avenue", APPROACH_ROWS, None)
    pave_band(-3, -1, PART_MATERIAL["paving_shade"], "CourtBand", APPROACH_ROWS, None)
    pave_band(1, 3, PART_MATERIAL["paving_shade"], "CourtBand", APPROACH_ROWS, None)
    pave_band(-6, -3, PART_MATERIAL["paving_shade"], "GalleryBlock", APPROACH_ROWS + 4, None)
    pave_band(3, 6, PART_MATERIAL["paving_shade"], "GalleryBlock", APPROACH_ROWS + 4, None)
    FLOOR_HALF = 6 * PLATE["len_x"]
    QUARTER_U = U0 + PLATE["len_y"] * APPROACH_ROWS

    # kerb runs down the causeway and the quarter's outer edge
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

    # ---------------------------------------------------------------- 2. the approach, lit down both sides
    # Noctis is the nation you arrive at in the evening. Wall lanterns on standards every 16 m, and the luminous
    # material on the lantern glass is the nation's signature doing the work a sign would otherwise do.
    lamp_step = 1600.0
    n_lamp = int((QUARTER_U - U0) // lamp_step)
    for i in range(n_lamp):
        u = U0 + lamp_step * (i + 0.5)
        for side in (-1.0, 1.0):
            add_module("WL_Object_LanternStandard", u, side * (PLATE["len_x"] + 190.0), PAVING_TOP, 0.0,
                       cull=CULL_MID, collide=True)
    anchor("APPROACH", "NoctisApproach", U0 + (QUARTER_U - U0) * 0.5, 0.0, PAVING_TOP)

    # a twin-tiered arch where the approach becomes the quarter
    add_module("WL_Arch_Twin_Tiered", QUARTER_U - 300.0, 0.0, PAVING_TOP, 0.0, cull=CULL_FAR)

    # ---------------------------------------------------------------- 3. the screening court
    # Ranks of the kit's great glass screens standing in the court: dark panes, where work is shown.
    SCREEN_U = QUARTER_U + 1500.0
    screen_w = KIT["WL_Gatehouse_Screen"]["size"][0]
    for side in (-1.0, 1.0):
        for i in range(3):
            add_module("WL_Gatehouse_Screen", SCREEN_U + i * (screen_w * 0.42), side * (2100.0 + i * 520.0),
                       PAVING_TOP, 90.0 * side, cull=CULL_MID, record=True)
    anchor("SCREENING", "ScreeningCourt", SCREEN_U + 600.0, 0.0, PAVING_TOP)

    # ---------------------------------------------------------------- 4. the amphitheatre
    # A curved colonnade closing a half-round space, left EMPTY in the middle: performance needs a room made of
    # people, so the architecture makes the room and then stops.
    AMPH_U = QUARTER_U + 5200.0
    for k in range(7):
        a = math.radians(-75.0 + k * 25.0)
        r = 3000.0
        add_module("WL_Colonnade_Curved", AMPH_U + r * math.cos(a), r * math.sin(a), PAVING_TOP,
                   math.degrees(a) + 90.0, cull=CULL_MID, record=True)
    add_module("WL_Ground_Plaza_Medallion", AMPH_U, 0.0, PAVING_TOP + 1.0, 0.0, cull=CULL_MID)
    anchor("PERFORMANCE", "Amphitheatre", AMPH_U, 0.0, PAVING_TOP)

    # ---------------------------------------------------------------- 5. the obsidian hall
    HALL_U = QUARTER_U + 11000.0
    add_module("WL_Palace_Dome_Grand", HALL_U, 0.0, PAVING_TOP, 0.0, cull=CULL_FAR, record=True)
    anchor("GREAT_HALL", "ObsidianHall", HALL_U, 0.0, PAVING_TOP)
    for side in (-1.0, 1.0):
        add_module("WL_Palace_Pavilion", HALL_U - 400.0, side * 4300.0, PAVING_TOP, 0.0, cull=CULL_FAR,
                   record=True)

    # ---------------------------------------------------------------- 6. the gallery walks
    gallery = KIT["WL_Colonnade_Arcade"]["size"][0]
    for side in (-1.0, 1.0):
        u = QUARTER_U + 3000.0
        while u < U1 - 2200.0:
            add_module("WL_Colonnade_Arcade", u, side * 4300.0, PAVING_TOP, 90.0, cull=CULL_MID, record=True)
            u += gallery * 1.12
    anchor("GALLERY", "GalleryWalks", QUARTER_U + 7000.0, 4300.0, PAVING_TOP)

    # ---------------------------------------------------------------- 7. the broadcast towers
    CHAINS = (
        ("WL_Tower_Base_Battered", "WL_Tower_Mid_Ashlar", "WL_Tower_Mid_Arcade", "WL_Tower_Mid_Balconied",
         "WL_Spire_Needle"),
        ("WL_Tower_Base_Buttressed", "WL_Tower_Mid_Machicolated", "WL_Tower_Mid_Fluted", "WL_Tower_Crown_Cone"),
        ("WL_Tower_Base_Arcaded", "WL_Tower_Mid_Arcade", "WL_Tower_Mid_Ribbed", "WL_Tower_Crown_Belvedere"),
    )
    SITES = [(QUARTER_U + 2600.0, -7000.0), (QUARTER_U + 2600.0, 7000.0),
             (QUARTER_U + 9000.0, -7200.0), (QUARTER_U + 9000.0, 7200.0),
             (QUARTER_U + 15000.0, -4200.0), (QUARTER_U + 15000.0, 4200.0)]
    tops = []
    for i, (tu, tv) in enumerate(SITES):
        top, joints = stack(CHAINS[i % len(CHAINS)], tu, tv, PAVING_TOP, rng.choice((0.0, 45.0, 90.0)))
        tops.append((tu, tv, top, joints))
        # the luminous crown: the one bright thing in Noctis, and it says what the nation sends out
        add_module("WL_Detail_Pinnacle_Grand", tu, tv, top, 0.0, cull=CULL_FAR, collide=False)
        anchor("BROADCAST", "BroadcastTower%d" % (i + 1), tu, tv, PAVING_TOP)

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
        n = max(1, int(round(span / bridge)))
        for k in range(n):
            t = (k + 0.5) / n
            add_module("WL_Bridge_Sky", u0 + du * (SHAFT_INSET + span * t), v0 + dv * (SHAFT_INSET + span * t),
                       deck - DECK_IN_MODULE, yaw, cull=CULL_FAR)
        anchor("ELEVATED_PATH", "NoctisBridge_%d_%d" % (a, b), (u0 + u1) / 2, (v0 + v1) / 2, deck)

    # ---------------------------------------------------------------- 8. the studio terraces
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
        anchor("STUDIO_ROW", "NoctisStudios%s" % ("W" if side < 0 else "E"), QUARTER_U + 9000.0,
               side * 6400.0, PAVING_TOP)

    # ---------------------------------------------------------------- 9. base courses, from real footprints
    plinth = KIT["WL_Detail_Plinth_Block"]
    plinth_len = plinth["size"][0]
    for name, bu, bv, bz, byaw, bw, bd in footprints:
        half_w, half_d = bw / 2.0, bd / 2.0
        ca, sa = math.cos(math.radians(byaw)), math.sin(math.radians(byaw))
        full_ring = name.startswith("WL_Palace") or name.startswith("WL_Colonnade")
        faces = ((0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0)) if full_ring else ((0.0, -1.0),)
        for fx, fy in faces:
            run_len = bw if fy else bd
            n = max(1, int(run_len // plinth_len))
            for i in range(n):
                t = (i + 0.5) / n - 0.5
                lx = (t * bw if fy else fx * half_w)
                ly = (fy * half_d if fy else t * bd)
                add("PlinthCourse", plinth["parts"][0]["mesh"], OBSIDIAN,
                    bu + lx * ca - ly * sa, bv + lx * sa + ly * ca, bz, byaw + (0.0 if fy else 90.0),
                    cull=8000.0, shadow=False)

    spec = {"pass": PASS,
            "tags": ["WL_NATION_NOCTIS", "WL_DISTRICT_NOCTIS_FIRST"],
            "folder": "Wonderland/Authored/NC01_NoctisQuarter",
            "actors": actors,
            "batches": [b for b in batches.values() if b["instances"]]}
    (HERE / "nc01_quarter.json").write_text(json.dumps(spec, indent=1), encoding="utf-8")

    total = sum(len(b["instances"]) for b in spec["batches"])
    colliding = sum(len(b["instances"]) for b in spec["batches"] if b["collides"])
    cx, cy = world(QUARTER_U + 9000.0, 0.0)
    print("NC01 -> nc01_quarter.json")
    print("  batches %d, instances %d (%d colliding), anchors %d" % (len(spec["batches"]), total, colliding,
                                                                     len(actors)))
    print("  quarter centre world (%.0f, %.0f) -> %s" % (cx, cy, (nations.zone_at(cx, cy),)))
    for key, n in stats.most_common(8):
        print("    %-32s %5d" % (key, n))


if __name__ == "__main__":
    main()
