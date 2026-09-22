#!/usr/bin/env python3
"""IC02 -- THE ICARUS FIRST DISTRICT: what the ceremonial gate was leading to.

FOUNDER DIRECTIVE (2026-09-22): "Existing Icarus March / gate work should lead into an actual functioning district.
Build the first substantial Icarus district behind the ceremonial gate. It should communicate VIDEO GAME
DEVELOPMENT CIVILIZATION ... but do not make it empty or sterile. It should feel inhabited, purposeful, and
architecturally sophisticated."

WHY HERE, MEASURED FIRST. world_coverage.py laid a 100 m grid over the whole map and counted every instance in it:
the neutral core holds 126,008 instances across 80 cells with one cell empty, while ICARUS holds 2,903 across 294
cells with 200 of them EMPTY -- 68%. The gate at y = 639 m opens onto nothing. That is the largest single gap in
Wonderland, and it is why this pass exists rather than another polish of the core.

THE PROGRAMME, told in architecture and never in a label. The founder's rule is environmental storytelling, so a
player learns what Icarus does by walking through it:

  THE ARRIVAL COURT (y 646-690 m)  -- the march's paving widens into a civic court the moment it clears the gate,
      colonnaded down both sides. Colonnades are the collaborative-creation courtyards: covered, open-sided, made
      for people to gather and work along.
  THE SIMULATION DOME (y ~715 m)   -- the grand glass dome on the axis, raised on its own terrace and approached by
      ceremonial stairs. The biggest glass volume in the nation: this is where a world is run and watched.
  THE TWO GREAT HALLS (x +/-42 m)  -- palace wings flanking the dome, the making halls. Deliberately a matched pair:
      a discipline with two halves, design and build.
  THE STUDIO ROWS (x +/-60..96 m)  -- houses with shopfronts, gabled and hipped and jettied, in terraced rows facing
      the avenue. This is the "inhabited, not sterile" half of the brief: individual creators, at human scale,
      between the monuments.
  THE PROVING COURT (y ~790 m)     -- a wide open flagged court ringed by balustrade and pinnacles, left CLEAR in
      the middle. Multiplayer proving ground: the architecture makes a space and declines to fill it.
  THE TOWER CLUSTER (y 740-820 m)  -- stacked ethereal towers in pearl and bright glass, joined at height by sky
      bridges. The founder's "interconnected elevated paths" and "tall ethereal towers", built from the kit's own
      Base -> Mid -> Crown -> Spire socket chain rather than by stacking boxes and hoping.

TOWERS ARE STACKED BY THEIR SOCKETS, NOT BY EYE. kit_modules.json gives every module a bottom and top socket with a
KIND and a RUNG -- ground, then tower/XL, tower/L, tower/M, then crown. stack() below walks that chain and refuses a
join that does not match, so a tower cannot end up with a crown floating above a gap, and every module sits exactly
on the one beneath it. That is what "readable construction logic" has to mean if it is to be checkable.

COLLISION IS TARGETED, NOT BLANKET (founder: "Use targeted collision, not indiscriminate expensive collision").
Buildings, towers, walls, colonnades, stairs and the paving a player stands on collide. Glass panes, gold trim,
roofs above head height, planting, balustrade detail and the sky bridges' ornament do not -- a player never reaches
them, and a physics body for each is a cost with no return.

MATERIALS are the nation's, already built by make_nation_materials.py: MI_V2_IcarusPearl, MI_V2_IcarusSilver,
MI_V2_IcarusAshlar, with the core's flagstone paving twins. Silver is Icarus's accent where the core uses gold, and
bright glass is the nation's signature -- so every _glass part in the kit is kept and given the pale glass instance.

    python icarus_district.py          (writes ic02_district.json)
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

PASS = "IC02"
AXIS_X = 0.0
GATE_Y = 63900.0                 # where IC01's ceremonial gatehouse stands
PAVING_TOP = 12.0                # the height the core's paving sits at, and the march's
PLATE = {"mesh": "/Game/WonderlandV2/Architecture/Stairs/SM_terrace_platform.SM_terrace_platform",
         "len_x": 1440.0, "len_y": 740.0, "top_local": 140.0}
KERB = {"mesh": "/Game/WonderlandV2/Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone", "len": 120.0}

PEARL, SILVER, ASHLAR = "MI_V2_IcarusPearl", "MI_V2_IcarusSilver", "MI_V2_IcarusAshlar"
#: Icarus reads its own parts differently from the core: gold becomes silver, roofs become pearl, and glass stays
#: bright because bright glass IS the nation's signature.
PART_MATERIAL = {"gold": SILVER, "stone": PEARL, "stone_dark": ASHLAR, "glass": "MI_V2_IcarusGlass",
                 "roof": PEARL, "roof_alt": ASHLAR, "veg_anchor": "MI_V2_LeafMid", "kerb": "MI_V2_MarblePale",
                 "metal": SILVER, "moss": "MI_V2_Moss",
                 "paving": "MI_V2_GroundFlag_PlazaCream", "paving_shade": "MI_V2_GroundFlag_PlazaShade",
                 "paving_warm": "MI_V2_GroundFlag_PlazaWarm"}
#: Parts a player can never touch, or that are pure ornament: they draw, they do not block.
NO_COLLIDE_PARTS = ("glass", "gold", "roof", "roof_alt", "veg_anchor", "moss", "metal")
#: VEG_ANCHOR IS NOT DRAWN. The kit ships a flat panel on planters, verges and retaining walls marking where
#: vegetation belongs. Given a leaf material it renders as a bright green SLAB -- visible as rectangles down both
#: verges in the first detailed cut. The anchor is an instruction, not geometry: it is skipped, and real planting
#: is placed at those runs instead.
SKIP_PARTS = ("veg_anchor",)
CULL_NEAR, CULL_MID, CULL_FAR = 12000.0, 26000.0, 60000.0

#: Read off mesh_inventory.json, not remembered: SM_topiary_ball_small does not exist and the apply refused on it,
#: which is the layer system doing its job. These three are clipped topiary rather than loose shrubs on purpose --
#: Icarus is a disciplined nation and its planting should look kept, not wild. They are dense meshes (15-22k tris
#: each), so the counts stay low and the cull distance stays short.
PLANTS = [("/Game/WonderlandV2/Vegetation/Topiary/SM_topiary_cone_plain.SM_topiary_cone_plain", "MI_V2_LeafDark"),
          ("/Game/WonderlandV2/Vegetation/Topiary/SM_topiary_spiral.SM_topiary_spiral", "MI_V2_LeafMid"),
          ("/Game/WonderlandV2/Vegetation/Topiary/SM_topiary_ball.SM_topiary_ball", "MI_V2_LeafMid")]


def socket(name, which):
    return (KIT[name].get("sockets") or {}).get(which)


def main():
    batches = {}
    actors = []
    stats = Counter()
    rng = random.Random(PASS)

    def add(key, mesh, material, x, y, z, yaw, scale=1.0, cull=CULL_NEAR, shadow=True, collides=False):
        bt = batches.setdefault(key, {"id": "%s_%s" % (PASS, key), "mesh": mesh, "material": material,
                                      "instances": [], "collides": collides, "cast_shadow": shadow,
                                      "affect_df": False, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                                round(scale, 3), round(scale, 3), round(scale, 3)])
        stats[key] += 1

    footprints = []

    def add_module(name, x, y, z, yaw, scale=1.0, cull=CULL_NEAR, collide=True, record=False):
        """Place every part of a kit module at one transform. A module is multi-material because the kit ships one
        mesh per material; they are coincident by construction."""
        for part in KIT[name]["parts"]:
            if part["part"] in SKIP_PARTS:
                continue
            mat = PART_MATERIAL.get(part["part"], part["material"])
            blocks = collide and part["part"] not in NO_COLLIDE_PARTS
            add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], mat, x, y, z, yaw, scale, cull,
                collides=blocks)
        if record:
            sz = KIT[name]["size"]
            footprints.append((name, x, y, z, yaw, sz[0] * scale, sz[1] * scale))

    def stack(chain, x, y, z, yaw, cull=CULL_FAR):
        """Stack tower modules on their own sockets. Refuses a join whose rungs do not match, so a tower cannot end
        up with a crown hanging over a gap -- the fault that 'readable construction logic' is supposed to exclude."""
        top_z = z
        joints = []
        expect = ("ground", None)
        for name in chain:
            bot = socket(name, "bottom")
            if bot is None:
                raise SystemExit("%s has no bottom socket; it cannot be stacked" % name)
            if bot.get("kind") != expect[0] or (expect[1] is not None and bot.get("rung") != expect[1]):
                raise SystemExit("cannot stack %s (bottom %s/%s) onto %s/%s"
                                 % (name, bot.get("kind"), bot.get("rung"), expect[0], expect[1]))
            add_module(name, x, y, top_z - bot.get("z", 0.0), yaw, cull=cull)
            top = socket(name, "top")
            if top is None:
                break
            top_z = top_z - bot.get("z", 0.0) + top.get("z", 0.0)
            joints.append(top_z)
            expect = (top.get("kind"), top.get("rung"))
        return top_z, joints

    def anchor(gve, label, x, y, z, yaw=0.0):
        """A tagged, near-invisible marker the runtime lane can find by tag instead of by a coordinate someone has
        to keep in step. The world lane owns the PLACE; Internal Development owns what happens there."""
        actors.append({"id": label, "mesh": KIT["WL_Ground_Plaza_Medallion"]["parts"][0]["mesh"],
                       "loc": [round(x, 1), round(y, 1), round(z, 1)], "rot": [0.0, yaw, 0.0],
                       "materials": [PART_MATERIAL["paving"]], "scale": [0.25, 0.25, 0.02],
                       "collision": "none", "cast_shadow": False,
                       "tags": ["WL_NATION_ICARUS", "WL_GVE_" + gve, "WL_DISTRICT_ICARUS_FIRST"]})
        stats["anchor"] += 1

    # ---------------------------------------------------------------- 1. the ground the district stands on
    # THE FLOOR IS TILED EXACTLY, AND IT IS BANDED. Two faults in the first cut: paved rectangles were sized by
    # rounding, so their edges did not meet and green lawn showed through the district in stripes; and the whole
    # floor was one material, which reads as a poured slab rather than as laid stone (the same fault GR01 fixed in
    # the core). So every band is a whole number of 14.4 m plates measured out from the axis, the bands are
    # contiguous by construction, and the paving TONE changes with what the ground is for: a warm carriageway on
    # the avenue, cream for the civic courts either side of it, and a cooler shade across the studio blocks.
    # That is the founder's "border courses / directional alignment" -- the floor tells you where you are.
    # THE FLOOR REACHES THE MARCH. The first cut started the district floor at 64600 while IC01's causeway ends
    # at 63600, leaving a 10 m band of open lawn with the ceremonial gatehouse standing in it. The walk found it
    # immediately: the Dog stopped short of the gate standing on GRASS at z=75 -- the world slab -- with the
    # district's paved edge ahead of it. A gate you cannot walk up to is not a gate. The civic bands now run from
    # the march's own last plate; the studio blocks still begin further north, so the quarter narrows to its gate.
    COURT_S, COURT_N = 64600.0, 69000.0
    # WHERE THE MARCH ACTUALLY ENDS, not where it was meant to. IC01 lays its causeway with
    # int((END_Y - START_Y) // len_y) = 18 plates from 50000, so its last plate finishes at 63320 -- 280 cm short
    # of the 63600 the pass declares. Starting this floor at 63600 left a 2.8 m hole, and the walk fell into it:
    # the Dog stood at z=101 on paving at 62652, z=75 on the world slab at 63554, and z=101 again at 64565 inside
    # the district. A hole 2.8 m wide is invisible in every screenshot ever taken of this place.
    MARCH_END = 63320.0
    FLOOR_S = MARCH_END
    ROWS = 25
    FLOOR_N = FLOOR_S + PLATE["len_y"] * ROWS
    SPINE_N = FLOOR_N
    court_half = 4320.0                                 # 3 plates
    spine_half = 1440.0                                 # 1 plate

    def pave_band(cols_from, cols_to, material, key, y_start=None):
        """Tile whole plates between two COLUMN indices measured from the axis, so bands always meet."""
        y0 = FLOOR_S if y_start is None else y_start
        rows = int(round((FLOOR_N - y0) / PLATE["len_y"]))
        for c in range(cols_from, cols_to):
            x = (c + 0.5) * PLATE["len_x"]
            for j in range(rows):
                add(key, PLATE["mesh"], material, x, y0 + PLATE["len_y"] * (j + 0.5),
                    PAVING_TOP - PLATE["top_local"], 0.0, cull=CULL_FAR, collides=True, shadow=False)

    pave_band(-1, 1, PART_MATERIAL["paving_warm"], "Avenue")        # the carriageway, 28.8 m
    pave_band(-3, -1, PART_MATERIAL["paving"], "CourtBand")
    pave_band(1, 3, PART_MATERIAL["paving"], "CourtBand")
    pave_band(-7, -3, PART_MATERIAL["paving_shade"], "StudioBlock", y_start=64600.0)
    pave_band(3, 7, PART_MATERIAL["paving_shade"], "StudioBlock", y_start=64600.0)
    FLOOR_HALF = 7 * PLATE["len_x"]                                  # 10080

    # kerb runs where the floor ends and the world's lawn begins -- WB01 and GT01: an edge is what makes ground
    # read as built, and the kit's kerb run carries its own gutter course.
    def kerb_run(x, y0, y1, yaw=90.0):
        run = KIT["WL_Ground_Kerb_Run"]["size"][0]
        n = int((y1 - y0) // run)
        for i in range(n):
            add_module("WL_Ground_Kerb_Run", x, y0 + run * (i + 0.5), PAVING_TOP, yaw, cull=CULL_NEAR,
                       collide=False)

    for side in (-1.0, 1.0):
        kerb_run(side * FLOOR_HALF, 64600.0, FLOOR_N)
        # and down the shoulder where the narrow civic bands meet lawn, south of the studio blocks
        kerb_run(side * 3.0 * PLATE["len_x"], FLOOR_S, 64600.0)

    # and a grass fringe outside the kerb, where the paving steps down to the ground (the GT01 rule)
    tuft = KIT["WL_Garden_Grass_Tuft"]["parts"][0]
    y = 64600.0
    while y < FLOOR_N:
        for side in (-1.0, 1.0):
            add("Fringe", tuft["mesh"], "MI_V2_Moss", side * (FLOOR_HALF + rng.uniform(18.0, 62.0)),
                y + rng.uniform(-30.0, 30.0), PAVING_TOP - 26.0, rng.uniform(0, 360),
                scale=rng.uniform(0.8, 1.25), cull=4000.0, shadow=False)
        y += 105.0

    PROVE_S, PROVE_N = 77600.0, 81300.0

    # ---------------------------------------------------------------- 2. the arrival court's colonnades
    col = KIT["WL_Colonnade_Straight"]["size"][0]
    n_col = int((COURT_N - COURT_S) // col)
    for i in range(n_col):
        y = COURT_S + col * (i + 0.5)
        for side in (-1.0, 1.0):
            add_module("WL_Colonnade_Straight", side * (court_half - 200.0), y, PAVING_TOP, 90.0 * side,
                       cull=CULL_MID, record=True)
    anchor("COLLAB_COURT", "ArrivalCourt", AXIS_X, (COURT_S + COURT_N) / 2, PAVING_TOP)

    # a ceremonial arch at the court's north end: the threshold from civic space into the making quarter
    add_module("WL_Arch_Ceremonial", AXIS_X, COURT_N + 200.0, PAVING_TOP, 0.0, cull=CULL_FAR)

    # ---------------------------------------------------------------- 3. the simulation dome and the two halls
    DOME_Y = 72050.0
    add_module("WL_Palace_Dome_Grand", AXIS_X, DOME_Y, PAVING_TOP, 0.0, cull=CULL_FAR, record=True)
    anchor("SIMULATION", "SimulationDome", AXIS_X, DOME_Y, PAVING_TOP)
    for side in (-1.0, 1.0):
        add_module("WL_Palace_Wing", side * 4200.0, DOME_Y - 300.0, PAVING_TOP, 90.0 * side, cull=CULL_FAR, record=True)
        anchor("MAKING_HALL", "GreatHall%s" % ("W" if side < 0 else "E"), side * 4200.0, DOME_Y - 300.0, PAVING_TOP)
    # ceremonial stairs up to the dome's terrace, on the axis, where the avenue meets it
    add_module("WL_Stair_Ceremonial", AXIS_X, 70050.0, PAVING_TOP, 0.0, cull=CULL_MID)

    # ---------------------------------------------------------------- 4. the studio rows
    # Terraced houses facing the avenue, alternating type so a row reads as built over time rather than stamped.
    HOUSE = ("WL_House_Gabled", "WL_House_Hipped", "WL_House_Jettied")
    house_w = KIT["WL_House_Gabled"]["size"][0]
    for side in (-1.0, 1.0):
        for row, x_off in enumerate((6000.0, 9000.0)):
            y = 65200.0
            n = 0
            while y < 77000.0:
                # a gap every few houses: a street into the block, so the row is a terrace and not a wall
                if n % 7 == 6:
                    y += house_w * 1.6
                    n += 1
                    continue
                name = HOUSE[(n + row) % len(HOUSE)]
                add_module(name, side * x_off, y, PAVING_TOP - 12.0, 90.0 * side + rng.choice((0.0, 0.0, 180.0)),
                           cull=CULL_MID, record=True)
                if n % 3 == 1:
                    add_module("WL_House_Shopfront", side * (x_off - 330.0 * side), y, PAVING_TOP - 12.0,
                               90.0 * side, cull=CULL_NEAR)
                y += house_w * 1.05
                n += 1
            anchor("STUDIO_ROW", "StudioRow%s%d" % ("W" if side < 0 else "E", row), side * x_off, 71000.0, PAVING_TOP)

    # ---------------------------------------------------------------- 5. the tower cluster and its sky bridges
    # Base -> Mid -> Mid -> Crown/Spire, assembled on the kit's own sockets.
    CHAINS = (
        ("WL_Tower_Base_Arcaded", "WL_Tower_Mid_Ashlar", "WL_Tower_Mid_Arcade", "WL_Tower_Mid_Ribbed",
         "WL_Tower_Mid_Balconied", "WL_Spire_Needle"),
        ("WL_Tower_Base_Buttressed", "WL_Tower_Mid_Machicolated", "WL_Tower_Mid_Fluted", "WL_Tower_Crown_Cone"),
        ("WL_Tower_Base_Battered", "WL_Tower_Mid_Arcade", "WL_Tower_Mid_Oriel", "WL_Tower_Crown_Belvedere"),
        ("WL_Tower_Base_Terraced", "WL_Tower_Mid_Ashlar", "WL_Tower_Mid_Arcade", "WL_Tower_Mid_Balconied",
         "WL_Spire_Twisted"),
        ("WL_Tower_Base_Arcaded", "WL_Tower_Mid_Machicolated", "WL_Tower_Mid_Lantern", "WL_Tower_Crown_Tiered"),
    )
    TOWER_SITES = [(-4600.0, 74600.0), (4600.0, 74600.0), (-7400.0, 78200.0), (7400.0, 78200.0),
                   (-3200.0, 81600.0), (3200.0, 81600.0), (-8600.0, 71200.0), (8600.0, 71200.0)]
    tower_tops = []
    for i, (tx, ty) in enumerate(TOWER_SITES):
        chain = CHAINS[i % len(CHAINS)]
        top, joints = stack(chain, tx, ty, PAVING_TOP, rng.choice((0.0, 45.0, 90.0, 135.0)))
        tower_tops.append((tx, ty, top, joints))
        anchor("TOWER", "Tower%02d" % (i + 1), tx, ty, PAVING_TOP)

    # Sky bridges between neighbouring towers, sitting at the height of the lower tower's first mid joint so they
    # read as a walkable level rather than as decoration pinned to the sky.
    # A SKY BRIDGE HAS TO LAND ON SOMETHING. The first cut ran them at a flat 26 m between tower centres and
    # they read as an aqueduct floating past the towers rather than joining them: they crossed open air, and where
    # they did meet a tower they went through its shaft. Now the deck height is the lowest shared JOINT of the two
    # towers it joins -- a height where both towers actually have a floor -- and the span is inset by the shaft
    # radius at each end, so a bridge starts and stops at masonry.
    bridge = KIT["WL_Bridge_Sky"]["size"][0]
    DECK_IN_MODULE = KIT["WL_Bridge_Sky"]["sockets"]["end_a"]["z"]     # the deck sits 402 above the module origin
    SHAFT_INSET = 760.0
    # NEIGHBOURS ONLY. Pairing towers across the whole district gave a 148 m span that read as an aqueduct
    # crossing the sky rather than a link between two buildings, so any pair further apart than MAX_SPAN is
    # dropped -- an elevated path should join two things a person can see are joined.
    MAX_SPAN = 8000.0
    for a, b in ((0, 1), (6, 0), (1, 7), (2, 4), (3, 5), (0, 2), (1, 3)):
        x0, y0, _, ja = tower_tops[a]
        x1, y1, _, jb = tower_tops[b]
        idx = min(2, len(ja) - 1, len(jb) - 1)
        deck_z = min(ja[idx], jb[idx])
        full = math.hypot(x1 - x0, y1 - y0)
        if full < 2.0 * SHAFT_INSET + bridge or full > MAX_SPAN:
            continue
        ux, uy = (x1 - x0) / full, (y1 - y0) / full
        ax, ay = x0 + ux * SHAFT_INSET, y0 + uy * SHAFT_INSET
        span = full - 2.0 * SHAFT_INSET
        yaw = math.degrees(math.atan2(uy, ux))
        n = max(1, int(round(span / bridge)))
        for k in range(n):
            t = (k + 0.5) / n
            add_module("WL_Bridge_Sky", ax + ux * span * t, ay + uy * span * t, deck_z - DECK_IN_MODULE, yaw,
                       cull=CULL_FAR, collide=True)
        anchor("ELEVATED_PATH", "SkyBridge_%d_%d" % (a, b), (x0 + x1) / 2, (y0 + y1) / 2, deck_z)

    # ---------------------------------------------------------------- 6. the proving court
    # Ringed and left EMPTY in the middle: the architecture makes the space and declines to fill it.
    run = KIT["WL_Detail_Balustrade_Run"]["size"][0]
    for side in (-1.0, 1.0):
        n = int((PROVE_N - PROVE_S) // run)
        for i in range(n):
            add_module("WL_Detail_Balustrade_Run", side * 5000.0, PROVE_S + run * (i + 0.5), PAVING_TOP, 90.0,
                       cull=CULL_NEAR, collide=True)
        for y in (PROVE_S, PROVE_N):
            add_module("WL_Detail_Pinnacle_Grand", side * 5000.0, y, PAVING_TOP, 0.0, cull=CULL_FAR)
    add_module("WL_Ground_Plaza_Medallion", AXIS_X, (PROVE_S + PROVE_N) / 2, PAVING_TOP + 1.0, 0.0, cull=CULL_MID)
    anchor("PROVING_GROUND", "ProvingCourt", AXIS_X, (PROVE_S + PROVE_N) / 2, PAVING_TOP)

    # ---------------------------------------------------------------- 7. planting, so it is inhabited not sterile
    for side in (-1.0, 1.0):
        y = COURT_S + 400.0
        while y < COURT_N - 200.0:
            mesh, mat = PLANTS[rng.randrange(len(PLANTS))]
            add("Plant_" + mesh.rsplit("/", 1)[-1].split(".")[0].replace("SM_", ""), mesh, mat,
                side * (court_half - 620.0), y + rng.uniform(-80.0, 80.0), PAVING_TOP,
                rng.uniform(0, 360), scale=rng.uniform(0.85, 1.15), cull=8000.0)
            y += 900.0
        y = COURT_N + 600.0
        while y < SPINE_N - 400.0:
            mesh, mat = PLANTS[rng.randrange(len(PLANTS))]
            add("Plant_" + mesh.rsplit("/", 1)[-1].split(".")[0].replace("SM_", ""), mesh, mat,
                side * (spine_half + 260.0 + rng.uniform(0.0, 120.0)), y + rng.uniform(-100.0, 100.0),
                PAVING_TOP - 12.0, rng.uniform(0, 360), scale=rng.uniform(0.85, 1.2), cull=8000.0)
            y += 1150.0

    # ---------------------------------------------------------------- 8. architectural detail and contact
    # FOUNDER, 2026-09-22: "facade-to-ground contact", "base plinths", "foundation transitions", "window recesses",
    # "gutters/drainage details where appropriate", "trim transitions". A building that meets the floor at a bare
    # edge reads as a model dropped on a surface; a base course is the single cheapest thing that makes it read as
    # BUILT. Every one of these comes off a real footprint recorded when the building was placed, so the detail
    # cannot drift away from the architecture it belongs to.
    plinth = KIT["WL_Detail_Plinth_Block"]
    plinth_len = plinth["size"][0]
    for name, bx, by, bz, byaw, bw, bd in footprints:
        half_w, half_d = bw / 2.0, bd / 2.0
        ca, sa = math.cos(math.radians(byaw)), math.sin(math.radians(byaw))
        full_ring = name.startswith("WL_Palace") or name.startswith("WL_Colonnade")
        faces = ((0.0, -1.0), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0)) if full_ring else ((0.0, -1.0),)
        for fx, fy in faces:
            run = bw if fy else bd
            n = max(1, int(run // plinth_len))
            for i in range(n):
                t = (i + 0.5) / n - 0.5
                lx = (t * bw if fy else fx * half_w)
                ly = (fy * half_d if fy else t * bd)
                wx, wy = bx + lx * ca - ly * sa, by + lx * sa + ly * ca
                face_yaw = byaw + (0.0 if fy else 90.0)
                add("PlinthCourse", plinth["parts"][0]["mesh"], PEARL, wx, wy, bz, face_yaw,
                    cull=8000.0, shadow=False, collides=False)

    # verge, tree grate and a tree every 28 m down the avenue: street furniture is what makes a road a street
    verge = KIT["WL_Ground_Verge_Run"]["size"][0]
    n_verge = int((FLOOR_N - FLOOR_S) // verge)
    for i in range(n_verge):
        y = FLOOR_S + verge * (i + 0.5)
        for side in (-1.0, 1.0):
            add_module("WL_Ground_Verge_Run", side * (spine_half + 130.0), y, PAVING_TOP, 90.0, cull=CULL_NEAR,
                       collide=False)
    # planting in the verge itself, in place of the anchor panel
    for i in range(n_verge):
        if i % 2:
            continue
        y = FLOOR_S + verge * (i + 0.5)
        for side in (-1.0, 1.0):
            mesh, mat = PLANTS[rng.randrange(len(PLANTS))]
            add("Verge_" + mesh.rsplit("/", 1)[-1].split(".")[0].replace("SM_", ""), mesh, mat,
                side * (spine_half + 130.0), y + rng.uniform(-60.0, 60.0), PAVING_TOP,
                rng.uniform(0, 360), scale=rng.uniform(0.55, 0.8), cull=7000.0)

    step = 2800.0
    n_tree = int((FLOOR_N - FLOOR_S) // step)
    for i in range(n_tree):
        y = FLOOR_S + step * (i + 0.9)
        for side in (-1.0, 1.0):
            x = side * (spine_half + 420.0)
            add_module("WL_Ground_Tree_Grate", x, y, PAVING_TOP, 0.0, cull=CULL_NEAR, collide=False)
            add("AvenueTree", "/Game/WonderlandV2/Vegetation/Trees/SM_tree_slender_trunk.SM_tree_slender_trunk",
                "MI_V2_Bark", x, y, PAVING_TOP, rng.uniform(0, 360), scale=rng.uniform(0.9, 1.1), cull=CULL_MID,
                collides=True)
            add("AvenueCanopy", "/Game/WonderlandV2/Vegetation/Trees/SM_canopy_medium.SM_canopy_medium",
                "MI_V2_LeafMid", x, y, PAVING_TOP + 760.0, rng.uniform(0, 360), scale=rng.uniform(0.9, 1.15),
                cull=CULL_MID)

    # drainage where the courts shed water: a channel down both sides of the avenue at the court crossings
    drain = KIT["WL_Ground_Drain_Channel"]["size"][0]
    for y0 in (COURT_N + 400.0, 73900.0, PROVE_S - 400.0):
        for side in (-1.0, 1.0):
            for i in range(3):
                add_module("WL_Ground_Drain_Channel", side * (spine_half + 300.0 + drain * i), y0, PAVING_TOP,
                           0.0, cull=CULL_NEAR, collide=False)

    # windows and a wall lantern on the great halls' long flanks, so a 25 m wall is not a blank plane
    for name, bx, by, bz, byaw, bw, bd in footprints:
        if not name.startswith("WL_Palace_Wing"):
            continue
        ca, sa = math.cos(math.radians(byaw)), math.sin(math.radians(byaw))
        for fy in (-1.0, 1.0):
            n = 6
            for i in range(n):
                t = (i + 0.5) / n - 0.5
                lx, ly = t * bw, fy * (bd / 2.0 + 18.0)
                wx, wy = bx + lx * ca - ly * sa, by + lx * sa + ly * ca
                add_module("WL_Detail_Window_Arched", wx, wy, bz + 420.0, byaw + (0.0 if fy > 0 else 180.0),
                           cull=CULL_NEAR, collide=False)
                if i % 2 == 0:
                    add_module("WL_Detail_Wall_Lantern", wx, wy, bz + 300.0,
                               byaw + (0.0 if fy > 0 else 180.0), cull=8000.0, collide=False)

    spec = {"pass": PASS,
            "tags": ["WL_NATION_ICARUS", "WL_DISTRICT_ICARUS_FIRST"],
            "folder": "Wonderland/Authored/IC02_IcarusDistrict",
            "actors": actors,
            "batches": [b for b in batches.values() if b["instances"]]}
    out = HERE / "ic02_district.json"
    out.write_text(json.dumps(spec, indent=1), encoding="utf-8")

    total = sum(len(b["instances"]) for b in spec["batches"])
    colliding = sum(len(b["instances"]) for b in spec["batches"] if b["collides"])
    print("IC02 -> %s" % out.name)
    print("  batches %d, instances %d (%d colliding, %d not), anchors %d"
          % (len(spec["batches"]), total, colliding, total - colliding, len(actors)))
    # nations.py works in UNREAL UNITS, not metres: CORE_R is 50000 uu = 500 m. Dividing by 100 here
    # put the district inside the neutral core and printed None.
    print("  nation/zone at the district centre: %s" % (nations.zone_at(AXIS_X, 73000.0),))
    for key, n in stats.most_common(12):
        print("    %-34s %5d" % (key, n))


if __name__ == "__main__":
    main()
