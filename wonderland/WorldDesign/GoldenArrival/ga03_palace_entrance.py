#!/usr/bin/env python3
"""GA03 -- the Palace entrance: the payoff at the end of the Golden Arrival corridor.

WHAT WAS THERE. The heart garden path ended on a lawn in front of a blank white arcade wall
(V2_castle_arcade, 17.8 m x 11.4 m, front face y ~10606, centred x 300): no door, no forecourt,
no gold. The corridor's destination looked like the back of a building.

WHAT THIS LAYER ADDS.
  PORTAL     the forge's gold filigree screen (WL_Gatehouse_Screen, GAP 16: two 4.3 x 8.6 m lattice
             leaves between stone piers with gold pinnacles, an ogee crown with heart finials) at 1.2x
             on a low dais with steps, against the arcade.
             GA03b (2026-09-15): it replaces GA03a's garden arch cast in gold at 1.5x, its heart crown
             and the closed gold doors inside it. At that scale the arch's rustic blocks read as
             crumpled gold with dark blotches, and the doors doubled the gold behind it (pvscreen).
  FORECOURT  plaza paving from the palace walkway to the dais, flanking ivory columns with gold
             finials, flower urns, and and nothing hung across the court (see the note in build()).
  THE WALL   gold cornice trims across the arcade and roses along its base.

MEASURED INPUTS. obstacles_palace.json (arcade r 912 at (300, 10769) z 0..1142; facade panels at
y 10817 z 714..1785; gold-finial pedestals at (67, 9559), (130, 9527), (720, 9423)); ground z -14;
the palace walkway terraces run along y 9190..9286. Mesh sizes: mesh_bounds.json.
"""
import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "GA03"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
GROUND = -14.0
V2 = "/Game/WonderlandV2/"
MESH = {
    "garden_arch": V2 + "Architecture/Garden/SM_garden_arch_stone.SM_garden_arch_stone",
    "gate_leaf": V2 + "Architecture/Gates/SM_gate_leaf.SM_gate_leaf",
    "finial_heart": V2 + "Architecture/Gates/SM_gate_finial_heart.SM_gate_finial_heart",
    "finial_ball": V2 + "Architecture/Gates/SM_gate_finial_ball.SM_gate_finial_ball",
    "column": V2 + "Architecture/Castle/SM_column_ornate.SM_column_ornate",
    "terrace": V2 + "Architecture/Stairs/SM_terrace_platform.SM_terrace_platform",
    "path_steps": V2 + "Architecture/Stairs/SM_path_steps.SM_path_steps",
    "kerb": V2 + "Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone",
    "vine_wall": V2 + "Vegetation/Ivy/SM_vine_wall.SM_vine_wall",
    "rose_bush": V2 + "Vegetation/Roses/SM_rose_bush.SM_rose_bush",
    "rose_bloom": V2 + "Vegetation/Roses/SM_rose_bloom.SM_rose_bloom",
    "urn": V2 + "Props/Garden/SM_garden_urn.SM_garden_urn",
    "blossom": V2 + "Vegetation/Flowers/SM_blossom_cluster.SM_blossom_cluster",
    "swag": V2 + "Props/Garden/SM_lantern_swag.SM_lantern_swag",
    "swag_glass": V2 + "Props/Garden/SM_lantern_swag_glass.SM_lantern_swag_glass",
    "slab0": V2 + "Ground/Cobblestone/SM_plaza_slab_0.SM_plaza_slab_0",
    "slab3": V2 + "Ground/Cobblestone/SM_plaza_slab_3.SM_plaza_slab_3",
    "slab6": V2 + "Ground/Cobblestone/SM_plaza_slab_6.SM_plaza_slab_6",
}

AXIS_X = 300.0          # the arcade's centre line
WALL_Y = 10600.0        # the arcade's front face
ARCADE_TOP = 1142.0 + GROUND


def build():
    rng = random.Random(20260913 + 3)
    actors, batches = [], {}

    def actor(id_, mesh, loc, materials, scale=1.0, yaw=0.0, collision="block"):
        s = [scale] * 3 if isinstance(scale, (int, float)) else list(scale)
        actors.append({"id": id_, "mesh": MESH[mesh], "loc": [round(v, 2) for v in loc], "rot": [0.0, round(yaw, 2), 0.0],
                       "scale": [round(v, 4) for v in s], "materials": materials, "collision": collision})

    def instance(batch_id, mesh, material, loc, scale, yaw, collides=False):
        s = [scale] * 3 if isinstance(scale, (int, float)) else list(scale)
        b = batches.setdefault(batch_id, {"id": batch_id, "mesh": MESH[mesh], "material": material, "instances": [],
                                          "collides": collides, "cast_shadow": True, "affect_df": collides})
        b["instances"].append([round(loc[0], 1), round(loc[1], 1), round(loc[2], 2), 0.0, round(yaw, 1), 0.0,
                               round(s[0], 3), round(s[1], 3), round(s[2], 3)])

    # ---------------------------------------------------------------- dais and steps
    dais_z_scale = 0.3                               # terrace platform is 140 tall at 1x -> 42 cm
    dais_top = GROUND + 140.0 * dais_z_scale
    actor("Dais", "terrace", (AXIS_X, WALL_Y - 190.0, GROUND), ["MI_V2_PlazaCream"], (1.0, 0.52, dais_z_scale))
    # Steps up to the dais from the forecourt (SM_path_steps rises along +Y from its origin).
    actor("DaisSteps", "path_steps", (AXIS_X, WALL_Y - 190.0 - 370.0 * 0.52 - 272.0 * 0.9, GROUND), ["MI_V2_PlazaCream"], (1.6, 0.9, 0.75))

    # ---------------------------------------------------------------- the gold portal
    # The screen's piers (base 1.86 m at 1.2x, centres x +/-618) stay inside the dais (x +/-720, y 10218..10602)
    # and clear the ivory columns' round bases at (+/-780, 10340). Its ivy anchor strips are flat green boxes
    # meant for a vine pass, so they are left out (a stretched SM_vine_wall on the piers read as a green sausage, ga03b).
    screen_scale, screen_y = 1.2, 10500.0
    for part in KIT["WL_Gatehouse_Screen"]["parts"]:
        if part["part"] == "veg_anchor":
            continue
        key = "Screen_%s" % part["part"]
        batches[key] = {"id": key, "mesh": part["mesh"], "material": part["material"], "collides": part["part"] == "stone",
                        "cast_shadow": True, "affect_df": part["part"] == "stone",
                        "instances": [[AXIS_X, screen_y, dais_top, 0.0, 0.0, 0.0, screen_scale, screen_scale, screen_scale]]}
    # The passage behind the leaves: the arcade wall shows through the lattice as flat cream and the gold is lost
    # against it (ga03b), so a shadowed recess stands between the leaves and the wall, as an open gate would show.
    leaves_w, leaves_h = (4.30 * 2.0 + 0.84) * 100.0 * screen_scale, 8.60 * 100.0 * screen_scale
    actor("PassageShadow", "kerb", (AXIS_X, screen_y + 45.0, dais_top + 105.0 * screen_scale - 10.0), ["MI_V2_WindowDark"],
          (leaves_w / 120.0, 30.0 / 36.2, (leaves_h + 20.0) / 28.2), collision="none")

    # ---------------------------------------------------------------- columns and urns
    for side, dx in (("L", -780.0), ("R", 780.0)):
        cx = AXIS_X + dx
        actor("Column" + side, "column", (cx, WALL_Y - 260.0, GROUND), ["MI_V2_IvoryStone"], (1.0, 1.0, 1.08))
        actor("Column%s_Finial" % side, "finial_ball", (cx, WALL_Y - 260.0, GROUND + 950.0 * 1.08), ["MI_V2_Gold"], 1.5, collision="none")
        ux = AXIS_X + dx * 0.62
        actor("Urn" + side, "urn", (ux, WALL_Y - 760.0, GROUND), ["MI_V2_Ceramic"], 1.05)
        for k in range(5):
            ang = 2.0 * math.pi * k / 5.0
            instance("UrnBlooms", "blossom", "MI_V2_PetalPink" if k % 2 else "MI_V2_PetalRose",
                     (ux + 38.0 * math.cos(ang), WALL_Y - 760.0 + 38.0 * math.sin(ang), GROUND + 185.0), rng.uniform(0.5, 0.62), rng.uniform(0, 360))

    # ---------------------------------------------------------------- gold trims on the arcade
    for k, z in enumerate((ARCADE_TOP - 18.0, GROUND + 700.0)):
        actor("CorniceGold%d" % k, "kerb", (AXIS_X, WALL_Y - 12.0, z), ["MI_V2_Gold"], (14.9, 0.7, 0.8), collision="none")

    # ---------------------------------------------------------------- roses along the wall
    # No SM_vine_wall: at this scale its leaf clusters read as chains of bright green balls against the wall's
    # coursed stone (mq05b, 2026-09-15). The rose bushes along the base stay.
    x = AXIS_X - 880.0
    while x <= AXIS_X + 880.0:
        if abs(x - AXIS_X) > 470.0:
            instance("WallRoseBushes", "rose_bush", "MI_V2_LeafDark", (x, WALL_Y - 95.0, GROUND), rng.uniform(0.5, 0.6), rng.uniform(0, 360))
            instance("WallRoses_" + ("RoseRed" if int(x) % 3 else "RosePink"), "rose_bloom", "MI_V2_RoseRed" if int(x) % 3 else "MI_V2_RosePink",
                     (x + rng.uniform(-25, 25), WALL_Y - 110.0, GROUND + 50.0), rng.uniform(0.5, 0.65), rng.uniform(0, 360))
        x += 110.0

    # ---------------------------------------------------------------- forecourt paving
    keep_out = [(67.0, 9559.0, 70.0), (130.0, 9527.0, 70.0), (720.0, 9423.0, 70.0)]
    y = 9380.0
    materials = ["MI_V2_PlazaCream"] * 5 + ["MI_V2_PlazaWarm"] * 3 + ["MI_V2_PlazaGrey"]
    slabs = ["slab0", "slab3", "slab6"]
    row = 0
    while y <= WALL_Y - 190.0 - 370.0 * 0.52 - 272.0 * 0.9 - 40.0:
        x = AXIS_X - 900.0 + (64.0 if row % 2 else 0.0)
        while x <= AXIS_X + 900.0:
            if all(math.hypot(x - kx, y - ky) > kr + 64.0 for (kx, ky, kr) in keep_out):
                mesh, material = slabs[(row + int(x // 128)) % 3], rng.choice(materials)
                # One batch per mesh and material: a batch carries exactly one of each.
                instance("ForecourtSlabs_%s_%s" % (mesh, material.split("_")[-1]), mesh, material, (x, y, GROUND + 0.5), 0.985,
                         rng.choice([0.0, 180.0]), collides=True)
            x += 128.0
        y += 128.0
        row += 1

    # NO LANTERN SWAG. GA03a hung SM_lantern_swag across the court: at this scale its lanterns are
    # solid gold drums at head height and they blocked the portal from every approach camera.

    return {"pass": PASS, "title": "Palace entrance: gold filigree screen on a dais, forecourt paving, columns, urns, gold cornices, roses",
            "folder": "Wonderland/Authored/GA03", "tags": ["V2_Castle"], "actors": actors, "batches": list(batches.values())}


if __name__ == "__main__":
    spec = build()
    out = HERE / "ga03_palace_entrance.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d actors, %d batches, %d instances -> %s" % (PASS, len(spec["actors"]), len(spec["batches"]),
                                                           sum(len(b["instances"]) for b in spec["batches"]), out.name))
