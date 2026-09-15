#!/usr/bin/env python3
"""GA01 -- Golden Arrival hero view: the first authored layer over the recovered world.

WHAT IT ANSWERS. Seen from HeroCam_GoldenArrivalBible (then HeroCam_V2_MarbleReference), the historical Marble image showed a path running
into a GOLDEN ARCH, a big HEART TOPIARY to the right, red-capped GIANT MUSHROOMS framing the left,
and flower beds on the path's low stone edging. The authored world had the path and the castle,
a pink floral arch, a heart hidden behind a tree, and bare kerbs.

WHERE THE NUMBERS COME FROM. Heights are measured, not guessed (PIE ground probe, 2026-09-13):
ground slab top z -14; kerb walls at x +/-250 top z 33.6; the path climbs the approach steps from
z 20 (y 2940) to z 76 (y 3450); arrival gate piers at x +/-260, y -910, top z 650. Mesh extents
are the assets' own bounds (SM_gate_arch_gold 192 x 9 x 135 about z 694, SM_gate_pier 88 x 88 x 325
about z 325, SM_heart_topiary 588 x 199 x 541 about z 404).

Run:  python wonderland/WorldDesign/GoldenArrival/ga01_hero_view.py   (writes ga01_hero_view.json)
Apply with wonderland/Tools/editor_jobs/apply_layer.py.

JUDGED AGAINST (historical): this pass was judged against the Marble image, the authority at the time.
The current authority is the GPT Wonderland Bible boards (WorldDesign/VISUAL_AUTHORITY.md, 2026-09-13).
"""
import json
import math
import random
from pathlib import Path

PASS = "GA01"
MESH = {
    "arch_gold": "/Game/WonderlandV2/Architecture/Gates/SM_gate_arch_gold.SM_gate_arch_gold",
    "pier": "/Game/WonderlandV2/Architecture/Gates/SM_gate_pier.SM_gate_pier",
    "finial_heart": "/Game/WonderlandV2/Architecture/Gates/SM_gate_finial_heart.SM_gate_finial_heart",
    "heart": "/Game/WonderlandV2/Vegetation/Topiary/SM_heart_topiary.SM_heart_topiary",
    "garden_arch": "/Game/WonderlandV2/Architecture/Garden/SM_garden_arch_stone.SM_garden_arch_stone",
    "rose_bloom": "/Game/WonderlandV2/Vegetation/Roses/SM_rose_bloom.SM_rose_bloom",
    "mush_medium": "/Game/WonderlandV2/Mushrooms/Medium/SM_mushroom_medium.SM_mushroom_medium",
    "mush_small": "/Game/WonderlandV2/Mushrooms/Small/SM_mushroom_small.SM_mushroom_small",
    "flower_cluster": "/Game/WonderlandV2/Vegetation/Flowers/SM_flower_cluster.SM_flower_cluster",
    "lavender_heads": "/Game/WonderlandV2/Vegetation/Flowers/SM_lavender_heads.SM_lavender_heads",
}
GROUND = -14.0
# the forge kit snapshot (flower bed runs, FL01)
KIT = json.loads((Path(__file__).resolve().parent.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
KERB_TOP = 33.6
PIER_HEIGHT = 650.0
ARCH_BOTTOM_LOCAL = 694.0 - 135.0   # the crest's lowest point at scale 1
ARCH_HALF_WIDTH = 192.0


def actor(id_, mesh, loc, materials, scale=1.0, yaw=0.0, collision="block", **extra):
    s = [scale, scale, scale] if isinstance(scale, (int, float)) else scale
    row = {"id": id_, "mesh": MESH[mesh], "loc": [round(v, 2) for v in loc], "rot": [0.0, yaw, 0.0],
           "scale": [round(v, 4) for v in s], "materials": materials, "collision": collision}
    row.update(extra)
    return row


def gate(prefix, y, pier_x, ground, crest_scale, finial_scale=0.9):
    """Two ivory piers, heart finials, and a gold crest resting just above the pier tops."""
    top = ground + PIER_HEIGHT
    crest_z = top + 15.0 - ARCH_BOTTOM_LOCAL * crest_scale
    return [
        actor(prefix + "_PierL", "pier", (pier_x, y, ground), ["MI_V2_IvoryStone"]),
        actor(prefix + "_PierR", "pier", (-pier_x, y, ground), ["MI_V2_IvoryStone"]),
        actor(prefix + "_FinialL", "finial_heart", (pier_x, y, top), ["MI_V2_Gold"], finial_scale, collision="none"),
        actor(prefix + "_FinialR", "finial_heart", (-pier_x, y, top), ["MI_V2_Gold"], finial_scale, collision="none"),
        actor(prefix + "_Crest", "arch_gold", (0.0, y, crest_z), ["MI_V2_Gold"], crest_scale, collision="none"),
    ]


def build():
    rng = random.Random(20260913)
    actors = []
    batches = {}

    def instance(batch_id, mesh, material, loc, scale, yaw, **flags):
        b = batches.setdefault(batch_id, {"id": batch_id, "mesh": MESH[mesh], "material": material, "instances": [], **flags})
        b["instances"].append([round(loc[0], 1), round(loc[1], 1), round(loc[2], 1), 0.0, round(yaw, 1), 0.0,
                               round(scale, 3), round(scale, 3), round(scale, 3)])

    # 1. THE ARRIVAL GATE GETS ITS CROWN. The piers and gold leaves exist; nothing spans them.
    #    The crest clears the gold ball finials (top z 778) and meets the pier centres at +/-260.
    crest_scale = 1.35
    actors.append(actor("ArrivalGate_Crest", "arch_gold", (0.0, -910.0, 790.0 - ARCH_BOTTOM_LOCAL * crest_scale),
                        ["MI_V2_Gold"], crest_scale, collision="none"))

    # 2. THE GOLDEN GATE INTO THE GARDEN, at the head of the approach steps, in front of the rose arch.
    #    GA01a tried piers plus the filigree crest: the crest is 18 cm of gold lace and vanished at the
    #    hero camera's 34 m. GA01b cast the world's stone garden arch in gold with a gold heart crown and a rose
    #    garland: at walking distance its rustic voussoirs read as a crumpled ring of gold blocks (arch0, pvg).
    #    GA01c (2026-09-15, AR01 series): the forge's rose garden arch (WL_Arch_Garden_Rose, families/thresholds.py) at
    #    1.2x -- 7.5 m wide, 10.8 m to its pointed crown, a 6.5 m opening -- every part in polished gold (MQ06 tune),
    #    its columns standing outside the path's kerb walls (x +/-250). The columns collide.
    arch_y, arch_scale = 3200.0, 1.2
    for part in KIT["WL_Arch_Garden_Rose"]["parts"]:
        if part["part"] == "veg_anchor":
            continue
        key = "GardenGate_Arch_%s" % part["part"]
        batches[key] = {"id": key, "mesh": part["mesh"], "material": "MI_V2_Gold", "instances": [[0.0, arch_y, GROUND, 0.0, 0.0, 0.0, arch_scale, arch_scale, arch_scale]],
                        "collides": part["part"] == "stone", "cast_shadow": True, "affect_df": part["part"] == "stone"}

    # 3. A HEART TOPIARY THE VISITOR CAN SEE: right of the path, past the gate, facing the arrival.
    #    GA01a stood it behind the gate's right pier facing down the path: seen edge-on and hidden.
    #    Now it turns 40 degrees toward the path and the arrival, in the open lawn right of the hedge.
    heart_scale, heart_yaw = 0.72, 40.0
    heart = (-1020.0, 2230.0, GROUND)
    actors.append(actor("HeartTopiary", "heart", heart, ["MI_V2_LeafMid"], heart_scale, yaw=heart_yaw))
    # Red roses on its face: points on a heart curve, scaled to the topiary's 0.6 size.
    for k in range(22):
        t = 2.0 * math.pi * k / 22.0
        hx = 16.0 * math.sin(t) ** 3
        hz = 13.0 * math.cos(t) - 5.0 * math.cos(2 * t) - 2.0 * math.cos(3 * t) - math.cos(4 * t)
        lx = hx * 17.0 * heart_scale / 0.6
        lz = 404.0 * heart_scale + hz * 17.0 * heart_scale / 0.6
        yaw = math.radians(heart_yaw)
        # On the face turned toward the path: offset along the heart's local -Y (its front).
        front = -150.0 * heart_scale / 0.6
        wx = heart[0] + lx * math.cos(yaw) - front * math.sin(yaw)
        wy = heart[1] + lx * math.sin(yaw) + front * math.cos(yaw)
        instance("HeartRoses", "rose_bloom", "MI_V2_RoseRed", (wx, wy, heart[2] + lz), rng.uniform(0.42, 0.55), rng.uniform(0, 360))

    # 4. GIANT MUSHROOMS FRAMING THE LEFT, clear of the plaza (x <= 657) and the side garden gate.
    # MU01 (2026-09-13): the forge's mushrooms (GAP 20) -- cap, gills, spots and stalk as separate materials -- where
    # SM_mushroom_medium / SM_mushroom_small painted cap and stalk in one material. Same places, same sizes (the
    # toadstool is the medium's 5.2 m cap, the button the small's 2.4 m); only the stalk collides.
    def mushroom(id_, module, loc, scale, yaw, cap_material="MI_V2_MushRed"):
        for part in KIT[module]["parts"]:
            MESH.setdefault(part["mesh"], part["mesh"])
            material = cap_material if part["part"] == "mush_cap" else part["material"]
            collision = "block" if (part["part"] == "mush_stem" and module != "WL_Mushroom_Button") else "none"
            actors.append(actor("%s_%s" % (id_, part["part"]), part["mesh"], loc, [material], scale, yaw=yaw, collision=collision))

    mushroom("Mushroom_RedTall", "WL_Mushroom_Toadstool", (1120.0, 860.0, GROUND), 1.1, 30.0)
    mushroom("Mushroom_RedLow", "WL_Mushroom_Toadstool", (1320.0, 420.0, GROUND), 0.85, 110.0)
    mushroom("Mushroom_Cream", "WL_Mushroom_Tall", (1430.0, 2150.0, GROUND), 0.9, 200.0, cap_material="MI_V2_MushPurple")
    mushroom("Mushroom_SmallA", "WL_Mushroom_Button", (780.0, 430.0, GROUND), 1.4, 15.0)
    mushroom("Mushroom_SmallB", "WL_Mushroom_Button", (880.0, 1020.0, GROUND), 1.1, 75.0)

    # 5. FLOWER BEDS ON THE PATH'S STONE EDGING, both sides, from the plaza to the gate steps.
    # FL01 (2026-09-13): the edging was SM_flower_cluster blobs every 58 cm, which read as pink and violet cushions
    # ("flowers should not read as flat color clusters"). It is now planted with the forge's flower bed runs (GAP 19):
    # 1.2 m runs of daisies, lavender and roses, each flower its own petals on its own stem, laid end to end along
    # the kerb tops in a repeating daisy / lavender / rose rhythm, petal colours violet-led as the Bible's beds.
    runs = [("WL_Flower_Daisy_Run", "MI_V2_PetalViolet"), ("WL_Flower_Lavender_Run", "MI_V2_Lavender"),
            ("WL_Flower_Rose_Run", "MI_V2_RosePink"), ("WL_Flower_Daisy_Run", "MI_V2_PetalPink"),
            ("WL_Flower_Lavender_Run", "MI_V2_PetalViolet"), ("WL_Flower_Rose_Run", "MI_V2_RoseRed")]
    y = 1040.0
    k = 0
    while y <= 2840.0:
        for side in (1.0, -1.0):
            module, petal = runs[(k + (0 if side > 0 else 3)) % len(runs)]
            x = side * rng.uniform(250.0, 258.0)
            yaw = 90.0 + rng.choice((0.0, 180.0)) + rng.uniform(-3.0, 3.0)
            for part in KIT[module]["parts"]:
                key = "FL_%s_%s_%s" % (module.replace("WL_Flower_", "").replace("_Run", ""), part["part"],
                                       (petal if part["part"] == "petal" else part["material"]).split("_")[-1])
                MESH.setdefault(part["mesh"], part["mesh"])
                material = petal if part["part"] == "petal" else ("MI_V2_LeafDark" if (k % 2) else part["material"]) \
                    if part["part"] == "leaf" else part["material"]
                instance(key, part["mesh"], material, (x, y + rng.uniform(-6, 6), KERB_TOP - 1.0), rng.uniform(0.95, 1.1), yaw,
                         cast_shadow=True, collides=False)
            if k % 3 == 1:
                # beside the wall's foot: a lavender run where SM_lavender_heads read as white paper blades (FL01a)
                for part in KIT["WL_Flower_Lavender_Run"]["parts"]:
                    material = "MI_V2_Lavender" if part["part"] == "petal" else "MI_V2_LeafDark"
                    MESH.setdefault(part["mesh"], part["mesh"])
                    instance("FL_WallLavender_%s" % part["part"], part["mesh"], material, (side * rng.uniform(290.0, 305.0), y + 20.0, GROUND),
                             rng.uniform(0.9, 1.1), 90.0 + rng.uniform(-6.0, 6.0), cast_shadow=True, collides=False)
        y += 118.0
        k += 1

    return {
        "pass": PASS,
        "title": "Golden Arrival hero view: crowned arrival gate, golden garden gate, visible heart topiary, mushroom framing, path flower beds",
        "folder": "Wonderland/Authored/GA01",
        "tags": ["V2_Garden"],
        "actors": actors,
        "batches": list(batches.values()),
    }


if __name__ == "__main__":
    out = Path(__file__).with_name("ga01_hero_view.json")
    spec = build()
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d actors, %d batches, %d instances -> %s" % (
        PASS, len(spec["actors"]), len(spec["batches"]), sum(len(b["instances"]) for b in spec["batches"]), out))
