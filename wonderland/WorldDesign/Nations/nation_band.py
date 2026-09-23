#!/usr/bin/env python3
"""IC03, NC03, TQ03 -- THE SECOND CIVILIZATION BAND for all three nations.

FOUNDER DIRECTIVE (2026-09-22): "Build the NEXT CIVILIZATION BAND beginning around the current ~850 m frontier.
Do not fill the entire remaining distance with random props. Build actual district/civilization structure."

WHERE THE FRONTIER ACTUALLY IS, measured rather than assumed. Each quarter lays 42 rows of 740 cm plate from
U_START 50,400, so band one ends at exactly 81,480 -- 814.8 m, which is what the coverage audit independently
reported (815 m Noctis, 824 Icarus, 848 Tartarus). This band starts there, at the plate the first one stopped
on, so no lawn shows between them. That seam is the whole reason IC02 had to be walked twice: its floor began
10 m past where IC01's causeway ended and the Dog fell into the gap.

ONE SKELETON, THREE CIVILISATIONS. The structure is shared because a district IS a shared idea -- an avenue,
courts either side, blocks beyond them, towers on anchor sites, connectors between the towers, a civic plaza at
the heart and a gate where you enter. What differs is the VOCABULARY each nation builds it from, and that comes
from the canon rather than from taste: Icarus builds creation halls and studio pavilions in pearl and silver,
Noctis builds cinematic halls and media towers in obsidian and dark glass, Tartarus builds engineering halls and
application foundries in crimson and bronze. Same bones, three civilisations, none of them generic.

THE TRANSFORM RULE, OBEYED BY CONSTRUCTION. Every placement goes through add_module, which converts local (u, v)
to world through the nation's own bearing, applies the module's yaw in that rotated frame, and carries a uniform
scale onto every part of the module. The footprints written out beside the spec record the SCALED size, so the
detail pass that decorates these buildings sees the world-space wall, not the mesh's own outline. That is the
Golden Arrival base-course failure -- 301 of 421 core buildings were scaled and the course was laid on unscaled
outlines -- and it is not going to happen twice.

GVE ANCHORS COME FROM THE CANON. Each nation's nations.json entry lists its gve_spaces; the anchors this pass
drops are named from that list, so the runtime lane finds "physics simulation" in Icarus and "sound stages" in
Noctis by tag rather than by a coordinate someone has to keep in step.

    python nation_band.py         (writes ic03_band.json, nc03_band.json, tq03_band.json)
"""
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import nations                               # noqa: E402

KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
CANON = json.loads((HERE.parent / "CANON" / "nations.json").read_text(encoding="utf-8"))
GVE = {n["id"]: n.get("gve_spaces", []) for n in CANON["nations"]}

PLATE = {"mesh": "/Game/WonderlandV2/Architecture/Stairs/SM_terrace_platform.SM_terrace_platform",
         "len_x": 1440.0, "len_y": 740.0, "top_local": 140.0}
PAVING_TOP = 12.0
BAND_U0 = 81480.0                 # where band one's last plate ends: 50400 + 42 * 740
BAND_ROWS = 46                    # 34,040 cm -> the frontier moves from 815 m to 1,155 m
CULL_NEAR, CULL_MID, CULL_FAR = 12000.0, 26000.0, 60000.0

SILVER_IC, PEARL, ASHLAR = "MI_V2_IcarusSilver", "MI_V2_IcarusPearl", "MI_V2_IcarusAshlar"
OBSIDIAN, CHARCOAL, SILVER_NC = "MI_V2_NoctisObsidian", "MI_V2_NoctisCharcoal", "MI_V2_NoctisSilver"
CRIMSON, BLACK_TQ, METAL = "MI_V2_TartarusCrimson", "MI_V2_TartarusBlack", "MI_V2_TartarusMetal"

#: Each nation's own build vocabulary. Every module here is one the kit actually ships and the tower chains are
#: the three this project has already proven stack cleanly through their sockets.
NATIONS = {
    "IC03": dict(
        nation="ICARUS", bearing=90.0, out="ic03_band.json",
        folder="Wonderland/Authored/IC03_IcarusBand",
        tags=["WL_NATION_ICARUS", "WL_DISTRICT_ICARUS_SECOND", "WL_NATION_BAND"],
        materials={"gold": SILVER_IC, "stone": PEARL, "stone_dark": ASHLAR, "glass": "MI_V2_IcarusGlass",
                   "roof": PEARL, "roof_alt": ASHLAR, "kerb": "MI_V2_MarblePale", "metal": SILVER_IC,
                   "moss": "MI_V2_Moss", "gold_aged": SILVER_IC,
                   "paving": "MI_V2_GroundFlag_PlazaCream", "paving_shade": "MI_V2_GroundFlag_PlazaShade",
                   "paving_warm": "MI_V2_GroundFlag_PlazaWarm"},
        gate="WL_Arch_Ceremonial",
        gate_yaw=90.0,
        hall="WL_Colonnade_Straight",          # collaborative courtyards: open, colonnaded, luminous
        signature="WL_Palace_Pavilion",        # studio pavilions
        block="WL_House_Hipped",               # the creation halls' lower workshops
        # The rung ladder is ground -> XL -> L -> M -> crown and stack() refuses anything that does not meet.
        # It caught Mid_Lantern (M->M) being asked to sit on Mid_Arcade's L top on the first run, which is the
        # socket system doing exactly the job it exists for.
        chains=(("WL_Tower_Base_Arcaded", "WL_Tower_Mid_Arcade", "WL_Tower_Mid_Oriel",
                 "WL_Tower_Crown_Belvedere"),
                ("WL_Tower_Base_Battered", "WL_Tower_Mid_Ashlar", "WL_Tower_Mid_Arcade",
                 "WL_Tower_Mid_Balconied", "WL_Spire_Needle")),
        crown="WL_Detail_Pinnacle_Grand"),
    "NC03": dict(
        nation="NOCTIS", bearing=210.0, out="nc03_band.json",
        folder="Wonderland/Authored/NC03_NoctisBand",
        tags=["WL_NATION_NOCTIS", "WL_DISTRICT_NOCTIS_SECOND", "WL_NATION_BAND"],
        materials={"gold": SILVER_NC, "stone": OBSIDIAN, "stone_dark": CHARCOAL, "glass": "MI_V2_NoctisGlass",
                   "roof": CHARCOAL, "roof_alt": CHARCOAL, "kerb": CHARCOAL, "metal": SILVER_NC,
                   "moss": "MI_V2_Moss", "gold_aged": SILVER_NC,
                   "paving": "MI_V2_GroundFlag_PlazaGrey", "paving_shade": "MI_V2_GroundFlag_PlazaShade",
                   "paving_warm": "MI_V2_GroundFlag_PlazaGrey"},
        gate="WL_Gatehouse_Screen",
        gate_yaw=90.0,
        hall="WL_Colonnade_Arcade",            # cinematic halls: deep, arcaded, a screen of dark glass
        signature="WL_Palace_Wing",            # media halls
        block="WL_House_Jettied",              # editing and creation rooms over the arcade
        chains=(("WL_Tower_Base_Battered", "WL_Tower_Mid_Arcade", "WL_Tower_Mid_Oriel",
                 "WL_Tower_Crown_Onion"),
                ("WL_Tower_Base_Buttressed", "WL_Tower_Mid_Machicolated", "WL_Tower_Mid_Fluted",
                 "WL_Tower_Crown_Cone")),
        crown="WL_Detail_Pinnacle_Grand"),
    "TQ03": dict(
        nation="TARTARUS", bearing=-30.0, out="tq03_band.json",
        folder="Wonderland/Authored/TQ03_TartarusBand",
        tags=["WL_NATION_TARTARUS", "WL_DISTRICT_TARTARUS_SECOND", "WL_NATION_BAND"],
        materials={"gold": METAL, "stone": CRIMSON, "stone_dark": BLACK_TQ, "glass": "MI_V2_TartarusEmber",
                   "roof": "MI_V2_TartarusRoof", "roof_alt": "MI_V2_TartarusRoof", "kerb": BLACK_TQ,
                   "metal": METAL, "moss": "MI_V2_Moss", "gold_aged": METAL,
                   "paving": "MI_V2_GroundFlag_PlazaShade", "paving_shade": "MI_V2_GroundFlag_PlazaGrey",
                   "paving_warm": "MI_V2_GroundFlag_PlazaWarm"},
        gate="WL_Arch_Twin_Tiered",
        gate_yaw=90.0,
        hall="WL_Colonnade_Arcade",            # engineering halls
        signature="WL_Palace_Wing",            # systems architecture
        block="WL_Market_Canopy",              # application foundries: a working, roofed floor
        chains=(("WL_Tower_Base_Buttressed", "WL_Tower_Mid_Machicolated", "WL_Tower_Mid_Lantern",
                 "WL_Tower_Crown_Tiered"),
                ("WL_Tower_Base_Terraced", "WL_Tower_Mid_Arcade", "WL_Tower_Mid_Ribbed",
                 "WL_Tower_Crown_Onion")),
        crown="WL_Detail_Pinnacle_Grand"),
}


def build(pass_id, cfg):
    bearing = cfg["bearing"]
    rad = math.radians(bearing)
    DIR = (math.cos(rad), math.sin(rad))
    LEFT = (-math.sin(rad), math.cos(rad))
    mats = cfg["materials"]
    rng = random.Random(pass_id)
    batches, actors, footprints = {}, [], []
    stats = Counter()

    def world(u, v):
        return (DIR[0] * u + LEFT[0] * v, DIR[1] * u + LEFT[1] * v)

    def add(key, mesh, material, u, v, z, yaw_local, scale=1.0, cull=CULL_NEAR, shadow=True, collides=False):
        x, y = world(u, v)
        bt = batches.setdefault(key, {"id": "%s_%s" % (pass_id, key), "mesh": mesh, "material": material,
                                      "instances": [], "collides": collides, "cast_shadow": shadow,
                                      "affect_df": False, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0,
                                round((yaw_local + bearing) % 360.0, 1), 0.0,
                                round(scale, 3), round(scale, 3), round(scale, 3)])
        stats[key] += 1

    def add_module(name, u, v, z, yaw_local, scale=1.0, cull=CULL_NEAR, collide=True, record=False):
        for part in KIT[name]["parts"]:
            if part["part"] == "veg_anchor":
                continue                       # a flat panel that renders as a green slab if given a leaf material
            mat = mats.get(part["part"], part["material"])
            # stone_dark is an ACCENT sub-mesh -- a plinth band or arch soffit of 12-216 triangles that sits
            # wholly inside the stone shell's own footprint, at the same transform. Letting it collide put a
            # second collision body inside a shell that already blocks: 178 of the second band's 2,288
            # colliding instances, 146 of them in NOCTIS, none of them reachable first. All 51 kit modules
            # that carry a stone_dark part also carry a stone shell, so nothing stops blocking by this.
            blocks = collide and part["part"] not in nations.NO_COLLIDE_PARTS
            add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], mat, u, v, z, yaw_local,
                scale, cull, collides=blocks)
        if record:
            sz = KIT[name]["size"]
            # THE SCALED size, so the detail pass decorates the world-space wall and not the mesh's own outline
            footprints.append({"module": name, "u": round(u, 1), "v": round(v, 1), "z": round(z, 1),
                               "yaw": round(yaw_local, 2), "w": round(sz[0] * scale, 1),
                               "d": round(sz[1] * scale, 1), "scale": round(scale, 3)})

    def socket(name, which):
        return (KIT[name].get("sockets") or {}).get(which)

    def stack(chain, u, v, z, yaw_local, cull=CULL_FAR):
        """Raise a tower through its sockets, refusing any joint that does not actually meet."""
        top_z, expect = z, ("ground", None)
        for name in chain:
            bot = socket(name, "bottom")
            if bot is None:
                raise SystemExit("%s has no bottom socket" % name)
            if bot.get("kind") != expect[0] or (expect[1] is not None and bot.get("rung") != expect[1]):
                raise SystemExit("%s bottom %s/%s does not meet %s/%s" % (name, bot.get("kind"),
                                                                         bot.get("rung"), expect[0], expect[1]))
            add_module(name, u, v, top_z - float(bot.get("z", 0.0)), yaw_local, cull=cull, record=True)
            top = socket(name, "top")
            if top is None:
                break
            top_z = top_z - float(bot.get("z", 0.0)) + float(top.get("z", 0.0))
            expect = (top.get("kind"), top.get("rung"))
        return top_z

    def anchor(gve, label, u, v, z):
        x, y = world(u, v)
        actors.append({"id": label, "mesh": KIT["WL_Ground_Plaza_Medallion"]["parts"][0]["mesh"],
                       "loc": [round(x, 1), round(y, 1), round(z, 1)], "rot": [0.0, bearing, 0.0],
                       "materials": [mats["paving"]], "scale": [0.25, 0.25, 0.02],
                       "collision": "none", "cast_shadow": False,
                       "tags": cfg["tags"] + ["WL_GVE_" + gve.upper().replace(" ", "_").replace("/", "_")]})
        stats["anchor"] += 1

    # ---------------------------------------------------------------- 1. the floor, tiled exactly
    U1 = BAND_U0 + PLATE["len_y"] * BAND_ROWS

    def pave(c0, c1, material, key, row0=0, row1=None):
        rows = BAND_ROWS if row1 is None else row1
        for c in range(c0, c1):
            v = (c + 0.5) * PLATE["len_x"]
            for j in range(row0, rows):
                add(key, PLATE["mesh"], material, BAND_U0 + PLATE["len_y"] * (j + 0.5), v,
                    PAVING_TOP - PLATE["top_local"], 0.0, cull=CULL_FAR, collides=True, shadow=False)

    pave(-1, 1, mats["paving_warm"], "Avenue")
    pave(-3, -1, mats["paving"], "CourtBand")
    pave(1, 3, mats["paving"], "CourtBand")
    pave(-6, -3, mats["paving_shade"], "WorkBlock", row0=4)
    pave(3, 6, mats["paving_shade"], "WorkBlock", row0=4)
    FLOOR_HALF = 6 * PLATE["len_x"]

    # kerbs where the paving meets the world's lawn, and a grass fringe outside them (the GT01 rule: an edge is
    # what makes ground read as built)
    run = KIT["WL_Ground_Kerb_Run"]["size"][0]
    n = int((U1 - BAND_U0 - PLATE["len_y"] * 4) // run)
    for side in (-1.0, 1.0):
        for i in range(n):
            add_module("WL_Ground_Kerb_Run", BAND_U0 + PLATE["len_y"] * 4 + run * (i + 0.5),
                       side * FLOOR_HALF, PAVING_TOP, 90.0, cull=CULL_NEAR, collide=False)
    tuft = KIT["WL_Garden_Grass_Tuft"]["parts"][0]
    u = BAND_U0 + PLATE["len_y"] * 4
    while u < U1:
        for side in (-1.0, 1.0):
            add("Fringe", tuft["mesh"], mats["moss"], u + rng.uniform(-30.0, 30.0),
                side * (FLOOR_HALF + rng.uniform(20.0, 70.0)), PAVING_TOP - 26.0, rng.uniform(0, 360),
                scale=rng.uniform(0.8, 1.25), cull=4000.0, shadow=False)
        u += 115.0

    # ---------------------------------------------------------------- 2. the gate you enter the band through
    #: GATES ARE NOT ALL AUTHORED ON THE SAME AXIS, and a walk proved it. Every gate was placed at
    #: yaw_local 0, which puts the mesh's local X along the road. WL_Arch_Ceremonial is 2310 x 776 and
    #: passable either way, so ICARUS walked through. WL_Gatehouse_Screen is 1218 x 188 -- a thin screen --
    #: and at yaw 0 its 12 m length lies ALONG the road: a Dog walking the Noctis approach stopped 628 cm
    #: short, which is half of 1218. WL_Arch_Twin_Tiered did the same at 746 cm and then climbed the
    #: structure to z=643. Both gates were walls across the only way in. This is the d164a56b regression
    #: in a new place: a gate that looks like a gate and does not admit a player.
    add_module(cfg["gate"], BAND_U0 + 900.0, 0.0, PAVING_TOP, cfg.get("gate_yaw", 0.0),
               cull=CULL_FAR, record=True)

    # ---------------------------------------------------------------- 3. the halls along the avenue
    hall = cfg["hall"]
    hl = KIT[hall]["size"][0]
    n_hall = 9
    for i in range(n_hall):
        hu = BAND_U0 + 4200.0 + i * (hl * 1.12)
        if hu > U1 - 3000.0:
            break
        for side in (-1.0, 1.0):
            add_module(hall, hu, side * 3300.0, PAVING_TOP, 90.0 * side, cull=CULL_MID, record=True)

    # ---------------------------------------------------------------- 4. the signature halls, facing the plaza
    sig = cfg["signature"]
    PLAZA_U = BAND_U0 + PLATE["len_y"] * BAND_ROWS * 0.52
    for side in (-1.0, 1.0):
        add_module(sig, PLAZA_U, side * 6100.0, PAVING_TOP, 90.0 * side, cull=CULL_FAR, record=True)

    # ---------------------------------------------------------------- 5. the civic plaza at the heart
    add_module("WL_Ground_Plaza_Medallion", PLAZA_U, 0.0, PAVING_TOP + 1.0, 0.0, cull=CULL_NEAR, collide=False)
    for side in (-1.0, 1.0):
        for k in range(4):
            add_module("WL_Detail_Balustrade_Run", PLAZA_U - 1400.0 + k * 830.0, side * 1500.0,
                       PAVING_TOP, 0.0, cull=CULL_NEAR, collide=False)

    # ---------------------------------------------------------------- 6. the working blocks beyond the courts
    blk = cfg["block"]
    bw = KIT[blk]["size"][0]
    for side in (-1.0, 1.0):
        for row in range(2):
            v = side * (5000.0 + row * 1500.0)
            u = BAND_U0 + 6000.0
            while u < U1 - 4000.0:
                add_module(blk, u, v, PAVING_TOP, 90.0 * side, cull=CULL_MID, record=True)
                u += bw * 1.10

    # ---------------------------------------------------------------- 7. towers, and the connectors between them
    chains = cfg["chains"]
    SITES = [(BAND_U0 + 7000.0, -7600.0), (BAND_U0 + 7000.0, 7600.0),
             (BAND_U0 + 17000.0, -7900.0), (BAND_U0 + 17000.0, 7900.0),
             (BAND_U0 + 27000.0, -7200.0), (BAND_U0 + 27000.0, 7200.0)]
    tops = []
    for i, (tu, tv) in enumerate(SITES):
        top = stack(chains[i % len(chains)], tu, tv, PAVING_TOP, rng.choice((0.0, 45.0, 90.0)))
        tops.append((tu, tv, top))
        add_module(cfg["crown"], tu, tv, top, 0.0, cull=CULL_FAR, collide=False)

    # elevated connectors: the founder asked for them in Icarus and they are how a media district and an
    # engineering district read as connected rather than as a row of separate towers.
    bridge = "WL_Bridge_Sky"
    deck = socket(bridge, "end_a")
    deck_z = float(deck.get("z", 0.0)) if deck else 0.0
    span = KIT[bridge]["size"][0]
    for a in range(0, len(tops) - 1, 2):
        (u0, v0, t0), (u1, v1, t1) = tops[a], tops[a + 1]
        mid_u, mid_v = (u0 + u1) * 0.5, (v0 + v1) * 0.5
        z = min(t0, t1) * 0.62
        gap = abs(v1 - v0)
        n_seg = max(1, int(round(gap / span)))
        for s in range(n_seg):
            f = (s + 0.5) / n_seg
            add_module(bridge, mid_u, v0 + (v1 - v0) * f, z - deck_z, 0.0, cull=CULL_FAR, collide=False)

    # ---------------------------------------------------------------- 8. GVE anchors, named from the canon
    spaces = GVE.get(cfg["nation"], [])[:6]
    for i, gve in enumerate(spaces):
        su = BAND_U0 + 5000.0 + (i % 3) * 9000.0
        sv = (-1.0 if i < 3 else 1.0) * 4300.0
        anchor(gve, "%s_GVE_%02d" % (cfg["nation"].title(), i), su, sv, PAVING_TOP)

    spec = {"pass": pass_id, "tags": cfg["tags"], "folder": cfg["folder"],
            "actors": actors, "batches": [b for b in batches.values() if b["instances"]]}
    (HERE / cfg["out"]).write_text(json.dumps(spec, indent=1), encoding="utf-8")
    (HERE / cfg["out"].replace("_band.json", "_band_footprints.json")).write_text(
        json.dumps(footprints, indent=1), encoding="utf-8")

    total = sum(len(b["instances"]) for b in spec["batches"])
    coll = sum(len(b["instances"]) for b in spec["batches"] if b["collides"])
    cx, cy = world((BAND_U0 + U1) * 0.5, 0.0)
    print("%s -> %s" % (pass_id, cfg["out"]))
    print("  band u %.0f..%.0f  (%.0f m .. %.0f m from the core)" % (BAND_U0, U1, BAND_U0 / 100, U1 / 100))
    print("  batches %d, instances %d (%d collide), anchors %d, footprints %d"
          % (len(spec["batches"]), total, coll, len(actors), len(footprints)))
    print("  band centre lands in %s" % (nations.nation_at(cx, cy),))
    for k, v in stats.most_common(6):
        print("    %-34s %5d" % (k, v))
    return spec


def main():
    for pass_id, cfg in NATIONS.items():
        build(pass_id, cfg)
        print()


if __name__ == "__main__":
    main()
