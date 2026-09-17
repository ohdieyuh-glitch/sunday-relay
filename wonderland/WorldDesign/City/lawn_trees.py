#!/usr/bin/env python3
"""TG01 -- trees in the big open lawns (2026-09-17).

THE GAP. After GC01 planted the borders and the garden groups, a survey of 16 gameplay cameras still shows one thing
above all others: a hero street view (SW_StreetGate46) whose whole foreground is an unbroken green plane, and the same
emptiness behind the south and west quarters. Beds and shrubs sit at ankle height; what those views lack is
SILHOUETTE -- something standing up in the middle distance, casting shade across the grass.

The world already grows trees: 412 trunks and 850 canopies, composed as a trunk mesh with a canopy set on it. This
measures that composition rather than inventing one (`tree_pairs.json`, sampled from the world's own instances): a
slender trunk carries a medium canopy and a mature trunk a large one, the canopy sits at DZ_RATIO of the scaled trunk
height, and its scale is about 1.15 of the trunk's.

WHAT. Loose groves -- two to four trees together, never evenly spaced -- on open lawn that no path, building or prop
occupies, away from the cameras' own standing points and out of the near cone of what they look at, so a vista stays
a vista. Canopy colour follows the world's own mix, with the occasional blossom for the Bible's colour.

    python lawn_trees.py            (writes tg01_<prefix>.json)
"""
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import facade_dressing as F

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import nations                                                    # noqa: E402  (WorldDesign/nations.py)

HERE = Path(__file__).resolve().parent
TMP = F.TMP
CAMS = TMP / "channel" / "done" / "a00_cams.json"

PASS = "TG01"
GRASS = ("MI_V2_Lawn", "MI_V2_Meadow", "MI_V2_Moss")
VEG = "/Game/WonderlandV2/Vegetation/Trees/%s.%s"
# (trunk mesh, trunk height cm, canopy mesh, dz ratio of scaled trunk height, canopy scale ratio, trunk radius cm)
KINDS = [("SM_tree_slender_trunk", 1299.0, "SM_canopy_medium", 0.77, 1.15, 283.0),
         ("SM_tree_mature_trunk", 1940.0, "SM_canopy_large", 0.67, 1.30, 442.0)]
SLENDER_SHARE = 0.6
LEAF = [("MI_V2_LeafMid", 0.52), ("MI_V2_LeafLight", 0.22), ("MI_V2_LeafDark", 0.16), ("MI_V2_LeafCream", 0.05),
        ("MI_V2_PetalPink", 0.03), ("MI_V2_PetalWhite", 0.02)]
BARK = "MI_V2_Bark"
RANGE = 4500.0                   # from a gameplay camera
GROVE_STEP = 1700.0              # between candidate grove centres
GROVE_SHARE = 0.45
GROVE_TREES = (2, 4)
GROVE_SPREAD = 700.0
PAVING_CLEAR = 700.0
BUILDING_CLEAR = 500.0
CAMERA_CLEAR = 1500.0            # never right on top of where a camera stands
VISTA_DEG = 18.0                 # nor in the near cone of what it looks at
VISTA_NEAR = 4000.0
SCALE = (0.85, 1.35)
CULL = 25000.0


def main():
    ground = json.loads((TMP / "ground_boxes.json").read_text(encoding="utf-8"))
    lawns = [b for b in ground if b["mat"] in GRASS and b["mesh"] in ("SM_garden_lawn", "Cube")]
    small = [b for b in lawns if b["hx"] < 50000.0]
    floor = [b for b in lawns if b["hx"] >= 50000.0]
    streets = json.loads((TMP / "street_census.json").read_text(encoding="utf-8"))
    terraces = json.loads((TMP / "terrace_boxes.json").read_text(encoding="utf-8"))
    paving = [{"x": t["x"], "y": t["y"], "yaw": t["yaw"], "hx": t["len_x"] * 0.5, "hy": t["len_y"] * 0.5,
               "top": t["top"], "label": t["label"]} for t in streets]
    paving += [{"x": b["x"], "y": b["y"], "yaw": b["yaw"], "hx": b["hx"], "hy": b["hy"],
                "top": b["zmax"], "label": b["label"]} for b in terraces]
    buildings = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
    props = json.loads(F.PROPS.read_text(encoding="utf-8"))
    props = props["rows"] if isinstance(props, dict) else props
    cams = json.loads(CAMS.read_text(encoding="utf-8"))["cams"]
    eyes = [(c[0], c[1], c[2], c[5]) for c in cams]                # name, x, y, yaw
    lg = F.grid_of(small, lambda b: (b["x"], b["y"]))
    pg = F.grid_of(paving, lambda t: (t["x"], t["y"]))
    bg = F.grid_of(buildings, lambda b: (b["x"], b["y"]))
    rg = F.grid_of(props, lambda r: (r["x"], r["y"]))
    sg = F.grid_of(streets, lambda t: (t["x"], t["y"]))
    stats = Counter()
    by_prefix = defaultdict(dict)
    placed = []

    def _in(b, x, y, slack=0.0):
        th = math.radians(b["yaw"])
        dx, dy = x - b["x"], y - b["y"]
        lx = dx * math.cos(th) + dy * math.sin(th)
        ly = -dx * math.sin(th) + dy * math.cos(th)
        return abs(lx) <= b["hx"] + slack and abs(ly) <= b["hy"] + slack

    def lawn_at(x, y):
        for j in F.around(lg, x, y):
            if _in(small[j], x, y):
                return small[j]
        for b in floor:
            if _in(b, x, y):
                return b
        return None

    def prefix_at(x, y):
        best, bd = None, 1e18
        for j in F.around(sg, x, y):
            t = streets[j]
            d = (t["x"] - x) ** 2 + (t["y"] - y) ** 2
            if d < bd:
                best, bd = t["label"].split("_")[0], d
        return best or "Garden"

    def blocks_a_view(x, y):
        """A tree may not stand where a camera stands, nor in the near cone of what it looks at."""
        for (_, cx, cy, yaw) in eyes:
            d = math.hypot(x - cx, y - cy)
            if d < CAMERA_CLEAR:
                return True
            if d < VISTA_NEAR:
                a = math.degrees(math.atan2(y - cy, x - cx)) - yaw
                if abs((a + 180.0) % 360.0 - 180.0) < VISTA_DEG:
                    return True
        return False

    def free(x, y, radius, top):
        if any(_in(paving[k], x, y, PAVING_CLEAR) and paving[k]["top"] > top - 40.0 for k in F.around(pg, x, y)):
            return False
        if any(F.inside_box(buildings[k], x, y, top + 40.0, slack=BUILDING_CLEAR) for k in F.around(bg, x, y)):
            return False
        if any(math.hypot(props[k]["x"] - x, props[k]["y"] - y) < props[k]["radius"] + radius
               for k in F.around(rg, x, y)):
            return False
        return all(math.hypot(px - x, py - y) >= pr + radius for (px, py, pr) in placed)

    def leaf(rng):
        r = rng.random()
        acc = 0.0
        for name, share in LEAF:
            acc += share
            if r <= acc:
                return name
        return LEAF[0][0]

    def plant(x, y, rng):
        b = lawn_at(x, y)
        if b is None:
            stats["not_lawn"] += 1
            return
        kind = KINDS[0] if rng.random() < SLENDER_SHARE else KINDS[1]
        trunk, height, canopy, dz_ratio, canopy_ratio, radius = kind
        sc = rng.uniform(*SCALE)
        if blocks_a_view(x, y):
            stats["in_a_view"] += 1
            return
        if not free(x, y, radius * sc, b["zmax"]):
            stats["no_room"] += 1
            return
        placed.append((x, y, radius * sc))
        prefix = prefix_at(x, y)
        yaw = round(rng.uniform(0.0, 360.0), 1)
        z = b["zmax"]
        for (mesh, material, scale, zz) in ((trunk, BARK, sc, z),
                                            (canopy, leaf(rng), sc * canopy_ratio, z + height * sc * dz_ratio)):
            k_id = "%s_%s_%s_%s" % (PASS, prefix, mesh.replace("SM_", ""), material.replace("MI_V2_", ""))
            bt = by_prefix[prefix].setdefault(k_id, {"id": k_id, "mesh": VEG % (mesh, mesh), "material": material,
                                                     "instances": [], "collides": False, "cast_shadow": True,
                                                     "affect_df": True, "cull_distance": CULL})
            bt["instances"].append([round(x, 1), round(y, 1), round(zz, 1), 0.0, yaw, 0.0,
                                    round(scale, 3), round(scale, 3), round(scale, 3)])
        stats["trees"] += 1
        stats[trunk] += 1

    for (name, cx, cy, _) in eyes:
        rng = random.Random("%s:%s" % (PASS, name))
        n = int(RANGE // GROVE_STEP)
        for i in range(-n, n + 1):
            for j in range(-n, n + 1):
                if rng.random() > GROVE_SHARE:
                    continue
                gx = cx + i * GROVE_STEP + rng.uniform(-GROVE_STEP * 0.35, GROVE_STEP * 0.35)
                gy = cy + j * GROVE_STEP + rng.uniform(-GROVE_STEP * 0.35, GROVE_STEP * 0.35)
                if (gx - cx) ** 2 + (gy - cy) ** 2 > RANGE * RANGE:
                    continue
                for k in range(rng.randint(*GROVE_TREES)):
                    a = rng.uniform(0.0, math.tau)
                    d = 0.0 if k == 0 else rng.uniform(300.0, GROVE_SPREAD)
                    plant(gx + math.cos(a) * d, gy + math.sin(a) * d, rng)
    for old in HERE.glob("tg01_*.json"):
        old.unlink()
    for prefix, batches in sorted(by_prefix.items()):
        inst = next(iter(batches.values()))["instances"][0]
        layer = {"pass": "%s_%s" % (PASS, prefix), "title": "TG01 %s: groves in the open lawn" % prefix,
                 "tags": [PASS, nations.tag(nations.nation_at(inst[0], inst[1]))],
                 "actors": [], "batches": list(batches.values())}
        (HERE / ("tg01_%s.json" % prefix.lower())).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    return stats


if __name__ == "__main__":
    print(dict(main()))
