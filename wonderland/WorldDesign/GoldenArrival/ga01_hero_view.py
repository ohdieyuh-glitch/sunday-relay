#!/usr/bin/env python3
"""GA01 -- Golden Arrival hero view: the first authored layer over the recovered world.

WHAT IT ANSWERS. Seen from HeroCam_V2_MarbleReference, the Marble reference shows a path running
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
    #    hero camera's 34 m. The reference's gate is a SOLID gold arch, so this is the world's own
    #    stone garden arch (820 wide, 724 tall, 120 deep) cast in gold, crowned with a gold heart.
    arch_y, arch_scale = 3200.0, 1.0
    actors.append(actor("GardenGate_GoldArch", "garden_arch", (0.0, arch_y, GROUND), ["MI_V2_Gold"], arch_scale, collision="none"))
    actors.append(actor("GardenGate_HeartCrown", "finial_heart", (0.0, arch_y, GROUND + 724.0 * arch_scale - 10.0), ["MI_V2_Gold"], 1.5, collision="none"))
    # A rose garland over the arch's crown: pink and red blooms on a shallow curve above the opening.
    for k in range(17):
        u = -1.0 + 2.0 * k / 16.0
        gx = u * 330.0
        gz = GROUND + 560.0 + 130.0 * (1.0 - u * u)
        material = "MI_V2_RoseRed" if k % 3 == 0 else "MI_V2_RosePink"
        instance("GateGarland_" + material.split("_")[-1], "rose_bloom", material, (gx, arch_y - 70.0, gz), rng.uniform(0.55, 0.75), rng.uniform(0, 360))

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
    actors.append(actor("Mushroom_RedTall", "mush_medium", (1120.0, 860.0, GROUND), ["MI_V2_MushRed"], 1.1, yaw=30.0))
    actors.append(actor("Mushroom_RedLow", "mush_medium", (1320.0, 420.0, GROUND), ["MI_V2_MushRed"], 0.85, yaw=110.0))
    actors.append(actor("Mushroom_Cream", "mush_medium", (1430.0, 2150.0, GROUND), ["MI_V2_MushCream"], 1.0, yaw=200.0))
    actors.append(actor("Mushroom_SmallA", "mush_small", (780.0, 430.0, GROUND), ["MI_V2_MushRed"], 1.4, yaw=15.0, collision="none"))
    actors.append(actor("Mushroom_SmallB", "mush_small", (880.0, 1020.0, GROUND), ["MI_V2_MushRed"], 1.1, yaw=75.0, collision="none"))

    # 5. FLOWER BEDS ON THE PATH'S STONE EDGING, both sides, from the plaza to the gate steps.
    palette = ["MI_V2_RosePink", "MI_V2_PetalViolet", "MI_V2_PetalRose", "MI_V2_RosePink", "MI_V2_Lavender"]
    y = 980.0
    k = 0
    while y <= 2880.0:
        for side in (1.0, -1.0):
            material = palette[(k + (0 if side > 0 else 2)) % len(palette)]
            x = side * rng.uniform(246.0, 262.0)
            instance("EdgeFlowers_" + material.split("_")[-1], "flower_cluster", material, (x, y + rng.uniform(-12, 12), KERB_TOP),
                     rng.uniform(0.5, 0.68), rng.uniform(0, 360))
            if k % 3 == 1:
                instance("EdgeLavender", "lavender_heads", "MI_V2_Lavender", (side * rng.uniform(270.0, 290.0), y + 20.0, GROUND),
                         rng.uniform(0.9, 1.2), rng.uniform(0, 360))
        y += 58.0
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
