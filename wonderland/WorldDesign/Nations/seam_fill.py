#!/usr/bin/env python3
"""SF01/SF02/SF03 -- THE 800-900 m SEAM, filled in all three nations.

WORLD_BETA_LEDGER blocker 5, row L: "The **800-900 m ring is a density trough in all three nations at once** --
ICARUS 852, NOCTIS 715, TARTARUS 1,060, against 1,300-2,600 in the rings either side. That ring is the
first->second band seam." And, in the blocker list: "The thinnest ring inside every nation's frontier is
exactly where the first band meets the second. Both the likeliest traversal break and the likeliest visual
break."

So this is not a new district and not a third band. It is the JOIN -- the hundred metres where one band's work
stops and the next one's starts, which every pass so far has treated as somebody else's edge.

WHAT IT PLANTS, AND WHY EACH THING IS SAFE
------------------------------------------
Every module here is on THIRD_BAND_PREP's "already proven elsewhere" list -- placed in Golden Arrival and
standing up in-engine today -- because a seam is the wrong place to debut untested geometry:

  * A CONTINUOUS FLOOR across the join. Flagstone runs laid on the nation's own axis, so the surface a player
    walks does not stop and restart at 800 m. This is the traversal half of the blocker: row B records
    TARTARUS already stuck at a seam where the band was laid over ground at a different height, and a floor
    that spans the join is what stops that being possible.
  * KERB AND VERGE at the road edges, so the avenue reads as a road through the seam rather than as paving
    that happens to continue.
  * PLANTED EDGES -- retaining runs and planter walls with flower runs on them -- which is the visual half:
    the rings either side hold 1,300-2,600 instances and this one has to stop looking like a gap between them.
  * A THRESHOLD at the midpoint of each seam, so the join is a PLACE rather than an absence. Arrival at a
    boundary should be marked; that is what a garden gate threshold is for.

EACH NATION IN ITS OWN MATERIALS. The palette comes from the quarter module that already owns that nation, so
Icarus stays pale, Noctis stays obsidian and charcoal, Tartarus stays red -- and Noctis's luminous accent is
used on its threshold lamps, which is the rule established when row F was closed.

EVERYTHING IS ADDITIVE AND REMOVABLE. Three separate passes, one per nation, each tagged so it can be lifted
out as a unit without touching a single generator actor.
"""
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))
import nations                                                    # noqa: E402

KIT = json.loads((ROOT / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]

#: The trough the ledger measured, in cm from the origin.
SEAM_IN, SEAM_OUT = 80000.0, 90000.0
CULL_NEAR, CULL_MID, CULL_FAR = 12000.0, 26000.0, 60000.0

#: One entry per nation: the axis its band runs out along, and the quarter module whose palette it wears.
#: Bearings are the middle of each canon sector (CANON/nations.json): ICARUS 30..150, NOCTIS 150..-90,
#: TARTARUS -90..30.
PASSES = {
    "SF01": dict(nation="ICARUS", bearing=90.0, module="icarus_district", out="sf01_icarus_seam.json"),
    "SF02": dict(nation="NOCTIS", bearing=210.0, module="noctis_quarter", out="sf02_noctis_seam.json"),
    "SF03": dict(nation="TARTARUS", bearing=330.0, module="tartarus_quarter", out="sf03_tartarus_seam.json"),
}

#: A flagstone is 4 m square and a kerb run is 8 m long; the avenue is laid to those, not to a round number,
#: because a floor that does not tile on its own module leaves the hairline gaps the ledger calls a flat sheet.
FLAG = 400.0
KERB = 800.0
ROAD_HALF = 1600.0          # the avenue's half width, matching the quarters' PLATE len_y


def load_palette(module_name):
    """The nation's own material table, read from the generator that already owns it."""
    mod = __import__(module_name)
    return mod, dict(mod.PART_MATERIAL), getattr(mod, "LUMINOUS", None)


def build(pass_id, cfg):
    mod, mats, accent = load_palette(cfg["module"])
    rad = math.radians(cfg["bearing"])
    fwd = (math.cos(rad), math.sin(rad))
    left = (-math.sin(rad), math.cos(rad))
    rng = random.Random(pass_id)
    batches = {}
    stats = Counter()

    def world(u, v):
        return (fwd[0] * u + left[0] * v, fwd[1] * u + left[1] * v)

    def add(key, mesh, material, u, v, z, yaw_local, scale=1.0, cull=CULL_NEAR,
            collides=False, shadow=True):
        x, y = world(u, v)
        bt = batches.setdefault((key, mesh, material),
                                {"id": "%s_%s" % (pass_id, key), "mesh": mesh, "material": material,
                                 "instances": [], "collides": collides, "cast_shadow": shadow,
                                 "affect_df": False, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0,
                                round((yaw_local + cfg["bearing"]) % 360.0, 1), 0.0,
                                round(scale, 3), round(scale, 3), round(scale, 3)])
        stats[key] += 1

    def add_module(name, u, v, z, yaw_local, scale=1.0, cull=CULL_NEAR, collide=True, glow=()):
        for part in KIT[name]["parts"]:
            if part["part"] in getattr(mod, "SKIP_PARTS", ("veg_anchor",)):
                continue
            material = (accent if (accent and part["part"] in glow)
                        else mats.get(part["part"], part["material"]))
            blocks = collide and part["part"] not in nations.NO_COLLIDE_PARTS
            add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], material,
                u, v, z, yaw_local, scale, cull, collides=blocks)

    # ---------------------------------------------------------------- 1. the floor across the join
    # Laid on the module's own 4 m grid, five bays either side of the axis, for the whole hundred metres.
    # THE SEAM'S WHOLE POINT: the surface does not stop at 800 m and start again at 900.
    lanes = int(ROAD_HALF * 2 / FLAG)
    rows = int((SEAM_OUT - SEAM_IN) / FLAG)
    shapes = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
    for r in range(rows):
        u = SEAM_IN + FLAG * (r + 0.5)
        for c in range(lanes):
            v = -ROAD_HALF + FLAG * (c + 0.5)
            # Three shapes cycled rather than one repeated -- the lesson of row E, applied at laying time.
            add_module(shapes[(r + c) % 3], u, v, 0.0, 0.0, cull=CULL_MID, collide=(c in (0, lanes - 1)))

    # ---------------------------------------------------------------- 2. the road edges
    for side in (-1.0, 1.0):
        n = int((SEAM_OUT - SEAM_IN) / KERB)
        for i in range(n):
            u = SEAM_IN + KERB * (i + 0.5)
            add_module("WL_Ground_Kerb_Run", u, side * (ROAD_HALF + 160.0), 0.0, 90.0 * side,
                       cull=CULL_MID, collide=False)

    # ---------------------------------------------------------------- 3. planted edges beyond the kerb
    # Retaining runs hold the verge, planter walls sit on them, and the flower runs are the three families
    # THIRD_BAND_PREP lists as proven. They are also the world's heaviest triangles -- 89.3% of it -- so they
    # are planted at a measured spacing rather than scattered, and they are Nanite now.
    for side in (-1.0, 1.0):
        n = int((SEAM_OUT - SEAM_IN) / KERB)
        for i in range(n):
            u = SEAM_IN + KERB * (i + 0.5)
            v = side * (ROAD_HALF + 620.0)
            add_module("WL_Garden_Retaining_Run", u, v, 0.0, 90.0 * side, cull=CULL_MID)
            if i % 2 == 0:
                add_module("WL_Garden_Planter_Wall", u, side * (ROAD_HALF + 980.0), 310.0, 90.0 * side,
                           cull=CULL_MID, collide=False)
                for f in range(5):
                    flower = rng.choice(("WL_Flower_Rose_Run", "WL_Flower_Lavender_Run", "WL_Flower_Daisy_Run"))
                    add_module(flower, u - 300.0 + f * 150.0, side * (ROAD_HALF + 980.0), 413.0,
                               rng.uniform(0.0, 360.0), scale=rng.uniform(0.9, 1.25),
                               cull=CULL_NEAR, collide=False)

    # ---------------------------------------------------------------- 4. the join is a place
    # A threshold at the midpoint, flanked by lanterns. On Noctis those lanterns burn with the nation's
    # luminous accent, which is the rule established when ledger row F was closed.
    mid = (SEAM_IN + SEAM_OUT) * 0.5
    add_module("WL_Garden_Gate_Threshold", mid, 0.0, 0.0, 0.0, cull=CULL_FAR)
    for side in (-1.0, 1.0):
        add_module("WL_Object_LanternStandard", mid, side * (ROAD_HALF + 300.0), 0.0, 0.0,
                   cull=CULL_MID, glow=("glass",))

    out = {
        # THE KEY IS "pass", not "id". apply_layer reads spec["pass"] to build its WL_PASS_<id> tag, which is
        # what makes a layer removable as a unit -- a spec with the wrong key applies nothing and raises.
        "pass": pass_id,
        "folder": "Wonderland/Authored/%s_%sSeam" % (pass_id, cfg["nation"].title()),
        "tags": ["WL_AUTHORED", "WL_PASS_%s" % pass_id, nations.tag(cfg["nation"]), "WL_NATION_SEAM"],
        "batches": list(batches.values()),
    }
    (HERE / cfg["out"]).write_text(json.dumps(out, indent=1), encoding="utf-8")
    total = sum(len(b["instances"]) for b in out["batches"])
    print("%s  %-9s %5d instances in %3d batches -> %s"
          % (pass_id, cfg["nation"], total, len(out["batches"]), cfg["out"]))
    for key, n in stats.most_common(6):
        print("    %-38s %5d" % (key, n))
    return total


def main():
    grand = 0
    for pass_id, cfg in sorted(PASSES.items()):
        grand += build(pass_id, cfg)
    print("\nSEAM TOTAL %d instances across the three 800-900 m rings" % grand)


if __name__ == "__main__":
    main()
