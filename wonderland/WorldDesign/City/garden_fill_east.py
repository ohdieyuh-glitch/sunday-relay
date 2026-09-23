#!/usr/bin/env python3
"""GF01 -- the eastern quarter gets the garden every other quarter already has.

THE GAP, AND WHY NOBODY SAW IT. Golden Arrival was audited all day by RADIUS and read as merely thin at its
edge. Re-measured in 100 m x 30 degree cells it is not thin at the edge at all -- it is thin on one SIDE:

    ring        bearing 270      bearing 120
    200-300 m         4,864               288
    300-400 m         5,321                22

Twenty-two instances in a 30-degree wedge of the 300-400 m ring, against five thousand in the wedge opposite.
A radial histogram averages that away completely, which is why it survived every coverage audit this session
until the cells were cut.

THE CAUSE IS IN THE GENERATOR THAT DID THE PLANTING. lawn_planting.py (GC01) plants around the sixty gameplay
CAMERAS -- its own docstring counts props "within 35 m of each of the 60 gameplay cameras". So the world was
planted where the cameras look. The 90-150 degree sector has no cameras in it, so it was never planted, and no
screenshot was ever going to reveal that. The founder's rule for this exact failure: a camera shows what it
points at; an audit shows where the world isn't.

WHAT THIS PLACES. Nothing new. The same vocabulary the neighbouring fills already use, read off SD01_FillNE so
this quarter matches its neighbours rather than introducing a style: daisy and rose runs in two leaf tones and
four petal tones, planter boxes with a gold lip, rose bushes, waymarker lamps with amber glass, and a few
topiary spirals.

CLUSTERED, NOT SCATTERED. The boards' rule is "everything placed with intent, no uniform repetition, no cheap
procedural look", so this plants BEDS -- a bed has a centre, a size and a mix -- strung along two implied
garden walks rather than sprinkled across the wedge. Empty ground between beds is intended: a garden is beds
and the space to see them from.

PERFORMANCE. SM_topiary_spiral is 21,004 triangles and SM_rose_bush 10,080, both single-LOD, in a world already
89% vegetation by triangle count. Spirals are capped hard and used as accents at bed corners, not as filler.
"""
import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
#: One generator, several wedges. The camera-driven planting left more than one sector bare, and copying this
#: file per sector is how NO_COLLIDE_PARTS ended up in four generators and drifted in three.
#: (pass id, bearing lo, bearing hi, r in cm, r out cm, beds, spiral cap, output file)
WEDGES = [
    ("GF01", 96.0, 148.0, 20500.0, 47000.0, 34, 14, "gf01_garden_fill_east.json"),
    ("GF02", 164.0, 208.0, 19000.0, 34000.0, 22, 9, "gf02_garden_fill_south.json"),
]

V2 = "/Game/WonderlandV2/"
MESH = {
    "rose": V2 + "Vegetation/Roses/SM_rose_bush.SM_rose_bush",
    "planter": V2 + "Props/Garden/SM_planter_box.SM_planter_box",
    "kerb": V2 + "Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone",
    "daisy_leaf": V2 + "Kit/flowers/WL_Flower_Daisy_Run_leaf.WL_Flower_Daisy_Run_leaf",
    "daisy_petal": V2 + "Kit/flowers/WL_Flower_Daisy_Run_petal.WL_Flower_Daisy_Run_petal",
    "daisy_centre": V2 + "Kit/flowers/WL_Flower_Daisy_Run_petal_centre.WL_Flower_Daisy_Run_petal_centre",
    "rose_petal": V2 + "Kit/flowers/WL_Flower_Rose_Run_petal.WL_Flower_Rose_Run_petal",
    "waymarker": V2 + "Props/Garden/SM_waymarker.SM_waymarker",
    "lamp": V2 + "Props/Garden/SM_waymarker_lamp.SM_waymarker_lamp",
    "spiral": V2 + "Vegetation/Topiary/SM_topiary_spiral.SM_topiary_spiral",
}

ARC_LO, ARC_HI = 96.0, 148.0        # degrees; 90 is the Icarus approach road, kept clear
R_IN, R_OUT = 20500.0, 47000.0      # cm: 205 m to 470 m
SPIRAL_CAP = 14
CULL = 30000.0

PETALS = [("MI_V2_PetalViolet", 0.30), ("MI_V2_PetalPink", 0.28), ("MI_V2_RosePink", 0.24), ("MI_V2_RoseRed", 0.18)]
LEAVES = [("MI_V2_LeafMid", 0.62), ("MI_V2_LeafDark", 0.38)]


def polar(r, deg):
    a = math.radians(deg)
    return r * math.cos(a), r * math.sin(a)


def build(PASS, ARC_LO, ARC_HI, R_IN, R_OUT, BEDS, SPIRAL_CAP, outfile):
    rng = random.Random(20260923 + int(ARC_LO))
    batches = {}
    spirals = [0]

    def add(key, mesh, material, x, y, z, yaw, scale, collides=False, shadow=False):
        b = batches.setdefault(key, {"id": "%s_%s" % (PASS, key), "mesh": mesh, "material": material,
                                     "instances": [], "collides": collides, "cast_shadow": shadow,
                                     "affect_df": False, "cull_distance": CULL})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                               round(scale, 3), round(scale, 3), round(scale, 3)])

    #: Two implied garden walks through the wedge, one inner one outer, that the beds are strung along.
    walks = []
    for i, frac in enumerate((0.34, 0.70)):
        r = R_IN + (R_OUT - R_IN) * frac
        walks.append([(polar(r + 1800.0 * math.sin(math.radians(a * 3.1 + i * 55.0)), a)) for a in
                      [ARC_LO + (ARC_HI - ARC_LO) * k / 40.0 for k in range(41)]])

    # ---- lamps along both walks, the thing that makes a walk read as a walk at dusk -----------------------
    for w in walks:
        for n, (x, y) in enumerate(w):
            if n % 6:
                continue
            add("LampPost", MESH["waymarker"], "MI_V2_IvoryStone", x, y, 12.0, 0.0, 1.0)
            add("LampHead", MESH["lamp"], "MI_V2_GlassAmber", x, y, 178.0, 0.0, 1.0)

    # ---- beds -------------------------------------------------------------------------------------------
    placed = []
    tries = 0
    while len(placed) < BEDS and tries < BEDS * 80:
        tries += 1
        a = rng.uniform(ARC_LO + 1.5, ARC_HI - 1.5)
        r = rng.uniform(R_IN, R_OUT)
        x, y = polar(r, a)
        if any(math.hypot(x - px, y - py) < 2600.0 for px, py in placed):
            continue
        placed.append((x, y))

    for bx, by in placed:
        size = rng.uniform(320.0, 760.0)
        yaw = rng.uniform(0.0, 360.0)
        # the bed's kerb lip, then its planting, densest at the centre
        ring_n = max(6, int(2.0 * math.pi * size / 150.0))
        for k in range(ring_n):
            ang = 360.0 * k / ring_n
            px, py = bx + size * math.cos(math.radians(ang)), by + size * math.sin(math.radians(ang))
            add("PlanterLip", MESH["kerb"], "MI_V2_Gold", px, py, 12.0, ang + 90.0, 0.72)
        add("Planter", MESH["planter"], "MI_V2_IvoryStone", bx, by, 12.0, yaw, rng.uniform(0.8, 1.25))

        #: DENSITY, CORRECTED FROM THE CAPTURE. size/42 gave 8-18 flowers in a bed 3-7 m across, which read
        #: as a kerb ring with a few flowers in it rather than as planting. A bed is dense or it is not a bed.
        for _ in range(int(size / 17.0)):
            d = size * math.sqrt(rng.random()) * 0.86
            ang = rng.uniform(0.0, 360.0)
            px, py = bx + d * math.cos(math.radians(ang)), by + d * math.sin(math.radians(ang))
            leaf = rng.choices([m for m, _ in LEAVES], weights=[w for _, w in LEAVES])[0]
            petal = rng.choices([m for m, _ in PETALS], weights=[w for _, w in PETALS])[0]
            rot = rng.uniform(0.0, 360.0)
            s = rng.uniform(0.85, 1.2)
            if petal.startswith("MI_V2_Rose"):
                add("Run_petal_%s" % petal.replace("MI_V2_", ""), MESH["rose_petal"], petal, px, py, 12.0, rot, s)
            else:
                add("Run_petal_%s" % petal.replace("MI_V2_", ""), MESH["daisy_petal"], petal, px, py, 12.0, rot, s)
                add("Run_petal_centre_LeafGold", MESH["daisy_centre"], "MI_V2_LeafGold", px, py, 12.0, rot, s)
            add("Run_leaf_%s" % leaf.replace("MI_V2_", ""), MESH["daisy_leaf"], leaf, px, py, 12.0, rot, s)

        for _ in range(rng.randint(1, 3)):
            ang = rng.uniform(0.0, 360.0)
            d = size * rng.uniform(0.9, 1.15)
            add("Rose", MESH["rose"], "MI_V2_LeafMid", bx + d * math.cos(math.radians(ang)),
                by + d * math.sin(math.radians(ang)), 12.0, rng.uniform(0, 360), rng.uniform(0.7, 1.1))

        if spirals[0] < SPIRAL_CAP and rng.random() < 0.45:
            spirals[0] += 1
            ang = rng.uniform(0.0, 360.0)
            add("Spiral", MESH["spiral"], "MI_V2_LeafDark", bx + size * 1.25 * math.cos(math.radians(ang)),
                by + size * 1.25 * math.sin(math.radians(ang)), 12.0, rng.uniform(0, 360), rng.uniform(0.8, 1.15))

    inst = sum(len(b["instances"]) for b in batches.values())
    spec = {"pass": PASS,
            "title": "%s: a quarter the camera-driven planting missed, planted by sector" % PASS,
            "tags": [PASS, "WL_GARDEN", "WL_GOLDEN_ARRIVAL"],
            "folder": "Wonderland/Authored/%s_GardenFill" % PASS,
            "actors": [], "batches": list(batches.values())}
    (HERE / outfile).write_text(json.dumps(spec, indent=1), encoding="utf-8")
    print("%s -> %s" % (PASS, outfile))
    print("  wedge %.0f-%.0f deg, r %.0f-%.0f m, %d beds, %d topiary spirals"
          % (ARC_LO, ARC_HI, R_IN / 100, R_OUT / 100, len(placed), spirals[0]))
    print("  batches %d, instances %d" % (len(batches), inst))
    for k in sorted(batches, key=lambda k: -len(batches[k]["instances"]))[:8]:
        print("    %-34s %5d" % (k, len(batches[k]["instances"])))
    return spec


def main():
    for w in WEDGES:
        build(*w)


if __name__ == "__main__":
    main()
