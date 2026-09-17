#!/usr/bin/env python3
"""GT02 -- clumps of grass out in the open lawn (2026-09-17).

THE GAP. GT01 planted the edge where paving meets grass, and a fresh survey of 16 gameplay cameras says the edge now
reads: what is still flat is the MIDDLE. The Hamlet, the Tea Terrace, the Water Garden, the Mushroom Grove and the
south all show a large, unbroken, evenly lit green plane. Measured: 147,753 m2 of open lawn stands within 35 m of the
60 gameplay cameras.

WHAT. The same forge tuft (WL_Garden_Grass_Tuft, 191 tris), scattered thinly across that open ground -- one per
DENSITY square metres, jittered off its grid cell so no line or lattice appears, a fifth of them in twos or threes so
the spacing itself varies, and a wider scale range than the fringe uses, since nothing here is measured against a
kerb. A lawn is not a field: this is deliberately sparse, and the test is whether the plane stops reading as felt.

WHERE. Ground comes from ground_boxes.json (a garden lawn if there is one, else the world's own moss slab). A cell is
open lawn when nothing paves it, no building stands on it and it is within RANGE of a gameplay camera.

    python lawn_scatter.py            (writes gt02_<prefix>.json)
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
KIT = F.KIT
TMP = F.TMP
CAMS = TMP / "channel" / "done" / "a00_cams.json"

PASS = "GT02"
TUFT = "WL_Garden_Grass_Tuft"
GRASS = ("MI_V2_Lawn", "MI_V2_Meadow", "MI_V2_Moss")
DENSITY = 18.0                   # square metres per clump
RANGE = 3500.0                   # from a gameplay camera
CLUSTER_SHARE = 0.20             # clumps that come in twos or threes
CLUSTER_SPREAD = 70.0
CULL = 3500.0
SCALE = (0.70, 1.45)


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
    cams = [(c[0], c[1], c[2]) for c in json.loads(CAMS.read_text(encoding="utf-8"))["cams"]]
    lg = F.grid_of(small, lambda b: (b["x"], b["y"]))
    pg = F.grid_of(paving, lambda t: (t["x"], t["y"]))
    bg = F.grid_of(buildings, lambda b: (b["x"], b["y"]))
    rg = F.grid_of(props, lambda r: (r["x"], r["y"]))
    sg = F.grid_of(streets, lambda t: (t["x"], t["y"]))
    stats = Counter()
    by_prefix = defaultdict(dict)
    step = math.sqrt(DENSITY) * 100.0

    def _in(b, x, y):
        th = math.radians(b["yaw"])
        dx, dy = x - b["x"], y - b["y"]
        lx = dx * math.cos(th) + dy * math.sin(th)
        ly = -dx * math.sin(th) + dy * math.cos(th)
        return abs(lx) <= b["hx"] and abs(ly) <= b["hy"]

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

    def plant(x, y, rng, seen):
        b = lawn_at(x, y)
        if b is None:
            stats["not_lawn"] += 1
            return
        if any(_in(paving[k], x, y) and paving[k]["top"] > b["zmax"] + 5.0 for k in F.around(pg, x, y)):
            stats["paved"] += 1
            return
        if any(F.inside_box(buildings[k], x, y, b["zmax"] + 40.0) for k in F.around(bg, x, y)):
            stats["inside_a_building"] += 1
            return
        if any(math.hypot(props[k]["x"] - x, props[k]["y"] - y) < props[k]["radius"] * 0.6
               and props[k]["zmin"] < b["zmax"] + 60.0 for k in F.around(rg, x, y)):
            stats["under_a_prop"] += 1
            return
        key = (round(x / 50.0), round(y / 50.0))
        if key in seen:
            stats["duplicate"] += 1
            return
        seen.add(key)
        prefix = prefix_at(x, y)
        sc = round(rng.uniform(*SCALE), 3)
        for part in KIT[TUFT]["parts"]:
            k = "%s_%s_Clump_%s" % (PASS, prefix, b["mat"].replace("MI_V2_", ""))
            bt = by_prefix[prefix].setdefault(k, {"id": k, "mesh": part["mesh"], "material": b["mat"],
                                                  "instances": [], "collides": False, "cast_shadow": True,
                                                  "affect_df": False, "cull_distance": CULL})
            bt["instances"].append([round(x, 1), round(y, 1), round(b["zmax"], 1), 0.0,
                                    round(rng.uniform(0.0, 360.0), 1), 0.0, sc, sc, sc])
        stats["clumps"] += 1

    seen = set()
    for (name, cx, cy) in cams:
        rng = random.Random("%s:%s" % (PASS, name))
        n = int(RANGE // step)
        for i in range(-n, n + 1):
            for j in range(-n, n + 1):
                x = cx + i * step + rng.uniform(-step * 0.45, step * 0.45)
                y = cy + j * step + rng.uniform(-step * 0.45, step * 0.45)
                if (x - cx) ** 2 + (y - cy) ** 2 > RANGE * RANGE:
                    continue
                plant(x, y, rng, seen)
                if rng.random() < CLUSTER_SHARE:
                    for _ in range(rng.randint(1, 2)):
                        a = rng.uniform(0.0, math.tau)
                        d = rng.uniform(25.0, CLUSTER_SPREAD)
                        plant(x + math.cos(a) * d, y + math.sin(a) * d, rng, seen)
    for old in HERE.glob("gt02_*.json"):
        old.unlink()
    for prefix, batches in sorted(by_prefix.items()):
        inst = next(iter(batches.values()))["instances"][0]
        layer = {"pass": "%s_%s" % (PASS, prefix), "title": "GT02 %s: clumps of grass in the open lawn" % prefix,
                 "tags": [PASS, nations.tag(nations.nation_at(inst[0], inst[1]))],
                 "actors": [], "batches": list(batches.values())}
        (HERE / ("gt02_%s.json" % prefix.lower())).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    return stats


if __name__ == "__main__":
    print(dict(main()))
