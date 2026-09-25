#!/usr/bin/env python3
"""FR01/FR02/FR03 -- THE PLANTED FRONTIER, where the built world stops and the forest has not started.

WHAT THIS CLOSES. zc_beta_walk measured the walkable world as a disc of radius 1,096 m holding 16,757 of the
level's 16,803 mesh actors, gridded it at 200 m, and found 75 tiles built, 5 sparse and 17 EMPTY -- 82.5%
coverage against the 85% the proof asks for. The emptiness is not scattered: nothing inside 600 m is empty at
all, and fourteen of the seventeen sit in the 1,000-1,200 m ring, past the p99 radius of 996.6 m. A Dog was
put down in eight of them and stood on ground in every one, so this is BARE, not missing -- the tiles have a
floor and nothing on it.

WHY IT IS PLANTING AND NOT ANOTHER BAND. THIRD_BAND_PREP records the founder's constraint in their own terms:
"do not make every band a copy of avenue + six towers + plaza + gate. The world needs increasingly
differentiated districts." A fourth ring of architecture at 1,100 m is exactly what that forbids, and the same
document says the 63 never-placed modules "each need a look in-engine before a band is built on them", which
is not a thing to do unreviewed. But the world's own geography already says what belongs here: Golden Arrival
inside 500 m, the nations out to ~1,155 m, and Dubel Forest at 1,230-1,480 m. Between the last street and the
first trees belongs a planted edge. That is differentiation by KIND rather than another variation on a plaza.

EVERY MODULE IS ON THE PROVEN LIST. Flower runs, verge runs, tree grates, retaining runs and planter walls are
all in THIRD_BAND_PREP's "already proven elsewhere" group -- placed in Golden Arrival and standing up
in-engine today. Nothing debuts here.

IT PLANTS THE MEASURED TILES, NOT THE WHOLE RING. The 1,000-1,200 m ring is about 1.4 square kilometres and
most of it already has content; blanketing it would bury built work and add vegetation to a world where
vegetation is already 89.3% of every triangle. So the tile centres below are the ones the walk actually
measured empty, and only those are planted.

ADDITIVE AND REMOVABLE, one pass per nation, tagged so it lifts out as a unit.
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

#: Read straight out of zc_beta_walk's result: every tile it gridded and found holding zero mesh actors,
#: as world centimetres. Kept as data rather than recomputed, because the grid that produced them is the
#: grid the proof will re-measure against.
EMPTY_TILES = [
    (100370, 370), (80370, 20370), (80370, 60370), (60370, 80370), (40370, 100370),
    (20370, 100370), (-19630, 100370), (-39630, 100370), (-99630, 40370), (-99630, -19630),
    (-39630, -99630), (-19630, -99630), (370, -79630), (20370, -99630), (40370, -99630),
    (60370, -59630), (100370, -39630),
]

#: Half a 200 m tile, less a margin so two neighbouring patches never meet in a hard line.
TILE_HALF = 9000.0
CULL_NEAR, CULL_MID = 12000.0, 26000.0

PASSES = {
    "FR01": dict(nation="ICARUS", bearing=90.0, module="icarus_district", out="fr01_icarus_frontier.json",
                 footprints=["ic03_band_footprints.json"]),
    "FR02": dict(nation="NOCTIS", bearing=210.0, module="noctis_quarter", out="fr02_noctis_frontier.json",
                 footprints=["nc01_footprints.json", "nc03_band_footprints.json"]),
    "FR03": dict(nation="TARTARUS", bearing=330.0, module="tartarus_quarter", out="fr03_tartarus_frontier.json",
                 footprints=["tq01_footprints.json", "tq03_band_footprints.json"]),
}

#: How far outside a recorded building plan anything here must stay, cm. Same reason as the seam passes:
#: a plant flush against a wall still intersects its base course.
CLEAR = 150.0


def load_palette(module_name):
    mod = __import__(module_name)
    return mod, dict(mod.PART_MATERIAL), getattr(mod, "LUMINOUS", None)


def occupied(cfg):
    """The building plans this frontier must not plant inside, in world coordinates.

    The seam passes learned this the hard way -- SF03's first build paved through a 20.7 m Tartarus hall
    because it never asked what was already standing. The nation passes record every building they place, so
    the plans are read rather than guessed at. These footprints are in each nation's own (u, v) frame, so they
    are rotated into world space on the nation's own bearing before being tested.
    """
    plans = []
    # The bearing comes from the pass config, the same way the seam passes carry it -- the canon record
    # is not relied on for a key this file would only discover was missing at run time.
    bearing = math.radians(cfg["bearing"])
    for name in cfg.get("footprints", ()):
        path = HERE / name
        if not path.exists():
            continue
        for fp in json.loads(path.read_text(encoding="utf-8")):
            scale = float(fp.get("scale", 1.0))
            u, v = float(fp["u"]), float(fp["v"])
            x = math.cos(bearing) * u - math.sin(bearing) * v
            y = math.sin(bearing) * u + math.cos(bearing) * v
            plans.append((x, y,
                          float(fp["w"]) * scale * 0.5 + CLEAR,
                          float(fp["d"]) * scale * 0.5 + CLEAR,
                          bearing + math.radians(float(fp.get("yaw", 0.0)))))
    return plans


def blocked(plans, x, y):
    for bx, by, hw, hd, yaw in plans:
        dx, dy = x - bx, y - by
        ca, sa = math.cos(-yaw), math.sin(-yaw)
        lx, ly = dx * ca - dy * sa, dx * sa + dy * ca
        if abs(lx) <= hw and abs(ly) <= hd:
            return True
    return False


def build(pass_id, cfg):
    mod, mats, accent = load_palette(cfg["module"])
    plans = occupied(cfg)
    rng = random.Random(pass_id)
    batches = {}
    stats = Counter()

    def add(key, mesh, material, x, y, z, yaw, scale, cull, collides):
        bt = batches.setdefault((key, mesh, material),
                                {"id": "%s_%s" % (pass_id, key), "mesh": mesh, "material": material,
                                 "instances": [], "collides": collides, "cast_shadow": True,
                                 "affect_df": False, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                                round(scale, 3), round(scale, 3), round(scale, 3)])
        stats[key] += 1

    def add_module(name, x, y, z, yaw, scale=1.0, cull=CULL_NEAR, collide=False):
        if name not in KIT:
            stats["missing_module_" + name] += 1
            return
        for part in KIT[name]["parts"]:
            if part["part"] in getattr(mod, "SKIP_PARTS", ("veg_anchor",)):
                continue
            material = mats.get(part["part"], part["material"])
            blocks = collide and part["part"] not in nations.NO_COLLIDE_PARTS
            add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], material,
                x, y, z, yaw, scale, cull, blocks)

    mine = [(x, y) for (x, y) in EMPTY_TILES
            if nations.nation_at(float(x), float(y)) == cfg["nation"]]
    stats["tiles"] = len(mine)

    flowers = ("WL_Flower_Rose_Run", "WL_Flower_Lavender_Run", "WL_Flower_Daisy_Run")

    for (cx, cy) in mine:
        cx, cy = float(cx), float(cy)
        # A MEADOW, NOT A GRID. The patch is scattered on a jittered lattice so it reads as ground cover
        # rather than as planting beds, and the density is deliberately low: vegetation is already 89.3% of
        # every triangle in Wonderland, so a frontier that doubled it would buy coverage with frame time.
        step = 2600.0
        n = int((TILE_HALF * 2) / step)
        for ix in range(n):
            for iy in range(n):
                x = cx - TILE_HALF + step * (ix + 0.5) + rng.uniform(-620.0, 620.0)
                y = cy - TILE_HALF + step * (iy + 0.5) + rng.uniform(-620.0, 620.0)
                if blocked(plans, x, y):
                    stats["skipped_under_building"] += 1
                    continue
                roll = rng.random()
                if roll < 0.55:
                    add_module(rng.choice(flowers), x, y, 0.0, rng.uniform(0.0, 360.0),
                               scale=rng.uniform(0.85, 1.3), cull=CULL_NEAR)
                elif roll < 0.80:
                    add_module("WL_Ground_Verge_Run", x, y, 0.0, rng.uniform(0.0, 360.0),
                               scale=rng.uniform(0.9, 1.2), cull=CULL_MID)
                else:
                    add_module("WL_Ground_Tree_Grate", x, y, 0.0, rng.uniform(0.0, 360.0),
                               cull=CULL_MID)

        # AND AN EDGE THAT READS AS ONE. A retaining run on the outward side of each patch, turned to face
        # the origin, so the frontier has a line rather than fading into nothing -- the founder's world ends
        # somewhere, and an edge that is drawn reads as a decision instead of as unfinished work.
        out = math.atan2(cy, cx)
        for k in (-1, 0, 1):
            ex = cx + math.cos(out) * (TILE_HALF + 400.0) + math.cos(out + math.pi / 2) * (k * 3200.0)
            ey = cy + math.sin(out) * (TILE_HALF + 400.0) + math.sin(out + math.pi / 2) * (k * 3200.0)
            if blocked(plans, ex, ey):
                stats["skipped_under_building"] += 1
                continue
            add_module("WL_Garden_Retaining_Run", ex, ey, 0.0,
                       math.degrees(out) + 90.0, cull=CULL_MID, collide=False)

    out_spec = {
        # "pass", not "id" -- apply_layer reads spec["pass"] to build its WL_PASS_<id> tag, and that tag is
        # what makes the layer removable as a unit. A spec with the wrong key applies nothing and raises.
        "pass": pass_id,
        "folder": "Wonderland/Authored/%s_%sFrontier" % (pass_id, cfg["nation"].title()),
        "tags": ["WL_AUTHORED", "WL_PASS_%s" % pass_id, nations.tag(cfg["nation"]), "WL_NATION_FRONTIER"],
        "batches": list(batches.values()),
    }
    (HERE / cfg["out"]).write_text(json.dumps(out_spec, indent=1), encoding="utf-8")
    total = sum(len(b["instances"]) for b in out_spec["batches"])
    print("%s  %-9s %5d instances in %3d batches across %d tile(s)  -> %s"
          % (pass_id, cfg["nation"], total, len(out_spec["batches"]), len(mine), cfg["out"]))
    for key, n in stats.most_common(6):
        print("    %-38s %5d" % (key, n))
    return total


def main():
    grand = 0
    for pass_id, cfg in sorted(PASSES.items()):
        grand += build(pass_id, cfg)
    print("\nFRONTIER TOTAL %d instances across %d measured-empty tiles" % (grand, len(EMPTY_TILES)))


if __name__ == "__main__":
    main()
