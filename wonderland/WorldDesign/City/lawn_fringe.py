#!/usr/bin/env python3
"""GT01 -- grass grows where the paving ends (2026-09-17).

THE GAP (founder material-realism phase; the ground census's largest surface). Half the ground a player sees is lawn
(MI_V2_Lawn / Meadow / Moss), and it reads as one flat carpet that stops at the paving on a drawn line. GS01 proved
this is not a material problem: macro colour breakup and per-instance tone, in two strengths, changed nothing at nine
cameras. A lawn needs EDGE and SILHOUETTE -- blades standing up where the grass meets stone.

WHAT. The forge's WL_Garden_Grass_Tuft (e47bf501): 13 tapered blades, 13-32 cm, out of a low leaf clump. 191 tris,
no collision, culled at CULL.

WHAT THE GROUND IS. Two things, and the first cut only knew one of them: 385 SM_garden_lawn boxes whose top is at
z = -2, and ONE 3 km square slab (`V2_GroundSlab`, a Cube in MI_V2_Moss, top at z = -14) that is the world's floor
and, by the ground census over the gameplay cameras, the single largest surface a player sees. Walking only the
garden lawns left the Hamlet, the Tea Terrace, the Water Garden and the south bare. Ground is read from
ground_boxes.json, which finds ground by its MATERIAL whatever mesh carries it.

WHERE, and the mistake that came first. The lawns are a handful of enormous slabs -- 385 boxes over 1.66 km2 -- and
the first cut planted their BOX edges. Every tuft landed at least 107 m from the lawn cameras and nothing was visible
at any of them: the lawn a player sees is the MIDDLE of a slab, and the visible boundary is drawn by the paving
platforms lying ON TOP of it. Measured: the paving stands 14-16 cm above the lawn, so that boundary is a hard little
cliff with a drawn line at its foot.

So the edge is walked from the PAVING, not the lawn. The paving is both systems: the street census's tiles AND the
1,543 SM_terrace_platform boxes (terrace_boxes.json) -- the first cut at this missed Lantern Lane entirely, because
the lawn there is bounded by terrace platforms, which are not street tiles.

Every piece's perimeter is sampled every STEP, and a sample counts when the ground just outside it is not covered by
more paving but IS a lawn box below it. Tufts stand on the lawn just outside the stone, with a sparser second row
further out so the fringe fades instead of ending on a line of its own, each with its own jitter, yaw and scale, in
its own lawn's material. STEP and RANGE are set where the count is affordable and every lawn camera still has grass
in front of it: at 60 cm and 60 m it was 52,747 tufts, which is not a fringe but a lawn.

    python lawn_fringe.py            (writes gt01_<prefix>.json)
"""
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import facade_dressing as F
import street_dressing as SD

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import nations                                                    # noqa: E402  (WorldDesign/nations.py)

HERE = Path(__file__).resolve().parent
KIT = F.KIT
TMP = F.TMP
CAMS = TMP / "channel" / "done" / "a00_cams.json"

PASS = "GT01"
TUFT = "WL_Garden_Grass_Tuft"
GRASS = ("MI_V2_Lawn", "MI_V2_Meadow", "MI_V2_Moss")
STEP = 95.0                      # along the paving's edge
ROW1 = (18.0, 40.0)              # how far out on the lawn the front row stands
ROW2 = (55.0, 85.0)              # the sparse second row
ROW2_SHARE = 0.30
RANGE = 4500.0                   # from a gameplay camera
DROP_MAX = 60.0                  # the lawn must be at or below the paving, not a terrace above it
CULL = 4000.0
SCALE = (0.80, 1.30)


def main():
    streets = json.loads((TMP / "street_census.json").read_text(encoding="utf-8"))
    terraces = json.loads((TMP / "terrace_boxes.json").read_text(encoding="utf-8"))
    paving = [{"label": t["label"], "x": t["x"], "y": t["y"], "yaw": t["yaw"],
               "hx": t["len_x"] * 0.5, "hy": t["len_y"] * 0.5, "top": t["top"]} for t in streets]
    paving += [{"label": b["label"], "x": b["x"], "y": b["y"], "yaw": b["yaw"],
                "hx": b["hx"], "hy": b["hy"], "top": b["zmax"]} for b in terraces]
    ground = json.loads((TMP / "ground_boxes.json").read_text(encoding="utf-8"))
    lawns = [b for b in ground if b["mat"] in GRASS and b["mesh"] in ("SM_garden_lawn", "Cube")]
    buildings = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
    cams = [(c[1], c[2]) for c in json.loads(CAMS.read_text(encoding="utf-8"))["cams"]]
    pg = F.grid_of(paving, lambda t: (t["x"], t["y"]))
    sg = F.grid_of(streets, lambda t: (t["x"], t["y"]))
    small = [b for b in lawns if b["hx"] < 50000.0]
    world_floor = [b for b in lawns if b["hx"] >= 50000.0]
    lg = F.grid_of(small, lambda b: (b["x"], b["y"]))
    bg = F.grid_of(buildings, lambda b: (b["x"], b["y"]))
    stats = Counter()
    by_prefix = defaultdict(dict)

    def covered(x, y, above):
        """The paving piece standing over this point, if any: a tuft may not be planted under stone."""
        for j in F.around(pg, x, y):
            t = paving[j]
            th = math.radians(t["yaw"])
            dx, dy = x - t["x"], y - t["y"]
            lx = dx * math.cos(th) + dy * math.sin(th)
            ly = -dx * math.sin(th) + dy * math.cos(th)
            if abs(lx) <= t["hx"] and abs(ly) <= t["hy"] and t["top"] > above:
                return t
        return None

    def _in(b, x, y):
        th = math.radians(b["yaw"])
        dx, dy = x - b["x"], y - b["y"]
        lx = dx * math.cos(th) + dy * math.sin(th)
        ly = -dx * math.sin(th) + dy * math.cos(th)
        return abs(lx) <= b["hx"] and abs(ly) <= b["hy"]

    def lawn_at(x, y):
        """The grass a tuft would stand on: a garden lawn if there is one here, else the world's own ground slab."""
        for j in F.around(lg, x, y):
            if _in(small[j], x, y):
                return small[j]
        for b in world_floor:
            if _in(b, x, y):
                return b
        return None

    def prefix_at(t, x, y):
        """The district a tuft belongs to. A terrace platform that is a batch instance is labelled after its batch, not
        after anywhere, so those borrow the nearest street tile's district."""
        label = t["label"]
        if not label.startswith("WonderlandInstancedBatch"):
            return label.split("_")[0]
        best, bd = None, 1e18
        for j in F.around(sg, x, y):
            q = streets[j]
            d = (q["x"] - x) ** 2 + (q["y"] - y) ** 2
            if d < bd:
                best, bd = q["label"].split("_")[0], d
        return best or "Garden"

    def near_camera(x, y):
        return any((x - cx) ** 2 + (y - cy) ** 2 < RANGE * RANGE for (cx, cy) in cams)

    for ti, t in enumerate(paving):
        th = math.radians(t["yaw"])
        c, s = math.cos(th), math.sin(th)
        hx, hy = t["hx"], t["hy"]
        rng = random.Random("%s:%d" % (PASS, ti))
        for (ax, ay, bx, by, ox, oy) in ((-hx, -hy, hx, -hy, 0.0, -1.0), (hx, -hy, hx, hy, 1.0, 0.0),
                                         (hx, hy, -hx, hy, 0.0, 1.0), (-hx, hy, -hx, -hy, -1.0, 0.0)):
            length = math.hypot(bx - ax, by - ay)
            n = int(length // STEP)
            for i in range(n):
                u = (i + 0.5) / n
                for (lo, hi) in ([ROW1] + ([ROW2] if rng.random() < ROW2_SHARE else [])):
                    out = rng.uniform(lo, hi)
                    along = rng.uniform(-STEP * 0.35, STEP * 0.35) / max(length, 1.0)
                    lx = ax + (bx - ax) * (u + along) + ox * out
                    ly = ay + (by - ay) * (u + along) + oy * out
                    x, y = t["x"] + lx * c - ly * s, t["y"] + lx * s + ly * c
                    if not near_camera(x, y):
                        continue
                    stats["samples_near_a_camera"] += 1
                    b = lawn_at(x, y)
                    if b is None:
                        stats["not_lawn"] += 1
                        continue
                    if any(F.inside_box(buildings[j], x, y, b["zmax"] + 40.0) for j in F.around(bg, x, y)):
                        stats["inside_a_building"] += 1
                        continue
                    if covered(x, y, b["zmax"] + 5.0) is not None:
                        stats["still_paving"] += 1
                        continue
                    if not (-5.0 <= t["top"] - b["zmax"] <= DROP_MAX):
                        stats["lawn_is_not_below_the_paving"] += 1
                        continue
                    prefix = prefix_at(t, x, y)
                    sc = round(rng.uniform(*SCALE), 3)
                    for part in KIT[TUFT]["parts"]:
                        k = "%s_%s_Tuft_%s" % (PASS, prefix, b["mat"].replace("MI_V2_", ""))
                        bt = by_prefix[prefix].setdefault(k, {"id": k, "mesh": part["mesh"], "material": b["mat"],
                                                              "instances": [], "collides": False, "cast_shadow": True,
                                                              "affect_df": False, "cull_distance": CULL})
                        bt["instances"].append([round(x, 1), round(y, 1), round(b["zmax"], 1), 0.0,
                                                round(rng.uniform(0.0, 360.0), 1), 0.0, sc, sc, sc])
                    stats["tufts"] += 1
    for old in HERE.glob("gt01_*.json"):
        old.unlink()
    for prefix, batches in sorted(by_prefix.items()):
        inst = next(iter(batches.values()))["instances"][0]
        layer = {"pass": "%s_%s" % (PASS, prefix), "title": "GT01 %s: grass where the paving ends" % prefix,
                 "tags": [PASS, nations.tag(nations.nation_at(inst[0], inst[1]))],
                 "actors": [], "batches": list(batches.values())}
        (HERE / ("gt01_%s.json" % prefix.lower())).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    return stats


if __name__ == "__main__":
    print(dict(main()))
