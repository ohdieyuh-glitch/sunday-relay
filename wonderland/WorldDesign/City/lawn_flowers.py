#!/usr/bin/env python3
"""LF01 -- flowers in the lawns where visitors walk (2026-09-16).

THE GAP. The city census put lawn at 48% of everything visible, and it reads as one flat green sheet -- the Bible's
rejected "low-detail". MQ08 warmed its colour; MQ09 tried a grass texture and was rejected, because a texture is not
what the Bible's lawns have that ours lack. What they have is things standing UP out of the grass: flowers in drifts.

WHERE -- only where someone will see them. The lawns are 506 batch instances covering 1.8 km^2 of stacked slabs; a
flower on every square metre would be hundreds of thousands of instances. So candidates are kept only within
ZONE of a street tile or a piece of authored paving (courts, walks, the corridor, landmarks), which is where visitors
walk, and every batch carries a cull distance so a flower beyond CULL is not drawn at all.

IN DRIFTS, NOT A SPRINKLE. A uniform scatter reads as noise. A smooth world-space value-noise field decides where
drifts are; inside a drift, patches sit densely, and between drifts the lawn stays clear, the way a real meadow does.

NEVER THROUGH A PATH. Lawn tops sit a few cm below the paving laid over them, so a flower on the lawn under a court
would stand up through its slabs. Every candidate within CLEAR of authored paving, a street tile, or a censused prop
is dropped.

A PATCH is two or three forge flower runs at random turns around one point -- the runs vanished on streets as single
strips, but gathered into patches at a visitor's feet they read as flowers. Violet-dominant, as the boards are.

ONE LAYER PER 200 m CELL, so any region can be removed on its own.

    python lawn_flowers.py        (writes lf01_<cell>.json and lf01_plan.json)
"""
import glob
import json
import math
import random
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TMP = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp")
KIT = json.loads((ROOT / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]

GRASS = ("MI_V2_Lawn", "MI_V2_Meadow", "MI_V2_Moss")
STEP = 330.0                 # candidate grid on each lawn slab
ZONE = 1800.0                # only lawn within this of a street tile or authored paving
CLEAR = 170.0                # from paving, street tiles and props
DRIFT_SCALE = 2600.0         # size of a drift, uu
DRIFT_THRESHOLD = 0.56       # of the value noise: higher, fewer and tighter drifts
# BUDGET. The first generation at STEP 230 / ZONE 3200 / threshold 0.58 came to 306,000 instances: culled or not, far too
# many for a decoration pass. These numbers bring it to about a tenth. The threshold then came back DOWN from 0.70 to
# 0.56: at 0.70 a drift looked exactly right where it landed (lf01a, SW colonnade) but most views held none at all.
CULL = 6000.0
CELL = 20000.0
PATCH = (
    (("WL_Flower_Lavender_Run", "MI_V2_PetalViolet"), 3),
    (("WL_Flower_Daisy_Run", "MI_V2_PetalWhite"), 2),
    (("WL_Flower_Rose_Run", "MI_V2_RosePink"), 2),
    (("WL_Flower_Daisy_Run", "MI_V2_PetalViolet"), 2),
    (("WL_Flower_Rose_Run", "MI_V2_RoseRed"), 1),
)
PAVING_WORDS = ("slab", "kerb", "flagstone", "Flagstone", "Kerb", "paving", "medallion", "Medallion", "ring_base")
PASS = "LF01"


def hash01(ix, iy, seed=91):
    h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFF) / float(0xFFFFFF)


def value_noise(x, y):
    """Smooth world-space value noise in 0..1, continuous across lawn slabs."""
    gx, gy = x / DRIFT_SCALE, y / DRIFT_SCALE
    ix, iy = math.floor(gx), math.floor(gy)
    fx, fy = gx - ix, gy - iy
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = hash01(ix, iy), hash01(ix + 1, iy)
    c, d = hash01(ix, iy + 1), hash01(ix + 1, iy + 1)
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy


class Grid:
    def __init__(self, cell):
        self.cell, self.g = cell, defaultdict(list)

    def add(self, x, y, r=0.0):
        self.g[(int(x // self.cell), int(y // self.cell))].append((x, y, r))

    def near(self, x, y, dist):
        gx, gy = int(x // self.cell), int(y // self.cell)
        reach = int(math.ceil(dist / self.cell))
        for ix in range(gx - reach, gx + reach + 1):
            for iy in range(gy - reach, gy + reach + 1):
                for (px, py, pr) in self.g.get((ix, iy), ()):
                    if (px - x) ** 2 + (py - y) ** 2 < (dist + pr) ** 2:
                        return True
        return False


def authored_paving():
    """Every authored paving piece on disk, as points: courts, walks, landmarks, corridor passes, SD01 planters."""
    pts = []
    for f in glob.glob(str(ROOT / "**" / "*.json"), recursive=True):
        if Path(f).parent == HERE and Path(f).name.startswith("lf01_"):
            continue
        try:
            d = json.loads(Path(f).read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(d, dict) or "batches" not in d:
            continue
        for b in d.get("batches", []):
            mesh = b.get("mesh", "")
            if not any(w in mesh for w in PAVING_WORDS) and "Planter" not in b.get("id", ""):
                continue
            for inst in b.get("instances", []):
                pts.append((inst[0], inst[1]))
        for a in d.get("actors", []):
            if any(w in a.get("mesh", "") for w in PAVING_WORDS):
                pts.append((a["loc"][0], a["loc"][1]))
    return pts


def main():
    lawns = [r for r in json.loads((TMP / "lawn_census.json").read_text(encoding="utf-8")) if r["mat"] in GRASS]
    streets = json.loads((TMP / "street_census.json").read_text(encoding="utf-8"))
    props = json.loads((TMP / "city_props.json").read_text(encoding="utf-8"))
    props = props["rows"] if isinstance(props, dict) else props
    paving = authored_paving()

    zone = Grid(ZONE)
    clear = Grid(600.0)
    for (x, y) in paving:
        zone.add(x, y)
        clear.add(x, y, 60.0)
    for t in streets:
        zone.add(t["x"], t["y"])
        th = math.radians(t["yaw"])
        fx, fy, rx, ry = math.cos(th), math.sin(th), -math.sin(th), math.cos(th)
        # the tile's area as a lattice of points, so "near a street" means near its surface, not its centre
        for a in range(-2, 3):
            for b in range(-2, 3):
                clear.add(t["x"] + fx * a * t["len_x"] / 5.0 + rx * b * t["len_y"] / 5.0,
                          t["y"] + fy * a * t["len_x"] / 5.0 + ry * b * t["len_y"] / 5.0, t["len_x"] / 10.0)
    for p in props:
        clear.add(p["x"], p["y"], min(p["radius"], 250.0))
    # GENERATOR GROUND COVER AND BUILDINGS, as lattices of points over their footprints (ground_cover.json). Street
    # tiles in four materials and authored paving were not enough: a generator plaza in PlazaCream sits ~14 cm above
    # the lawn, and a 40 cm flower under it stands up through its slabs.
    for (gx, gy, gr) in json.loads((TMP / "ground_cover.json").read_text(encoding="utf-8")):
        clear.add(gx, gy, min(gr, 400.0))

    rng = random.Random(20260916)
    cells = defaultdict(dict)
    stats = defaultdict(int)
    for lawn in lawns:
        th = math.radians(lawn["yaw"])
        fx, fy, rx, ry = math.cos(th), math.sin(th), -math.sin(th), math.cos(th)
        ox = lawn["x"] + fx * lawn["cx"] + rx * lawn["cy"]
        oy = lawn["y"] + fy * lawn["cx"] + ry * lawn["cy"]
        na, nb = int(lawn["lx"] // STEP), int(lawn["ly"] // STEP)
        for a in range(na):
            for b in range(nb):
                u = (a + 0.5) * STEP - lawn["lx"] * 0.5 + rng.uniform(-0.4, 0.4) * STEP
                v = (b + 0.5) * STEP - lawn["ly"] * 0.5 + rng.uniform(-0.4, 0.4) * STEP
                x, y = ox + fx * u + rx * v, oy + fy * u + ry * v
                stats["candidates"] += 1
                if value_noise(x, y) < DRIFT_THRESHOLD:
                    continue
                stats["in_drift"] += 1
                if not zone.near(x, y, ZONE):
                    continue
                stats["in_zone"] += 1
                if clear.near(x, y, CLEAR):
                    stats["blocked"] += 1
                    continue
                cell = "%d_%d" % (int(x // CELL), int(y // CELL))
                batches = cells[cell]
                runs = rng.randint(2, 3)
                for k in range(runs):
                    (module, petal), _w = rng.choices(PATCH, weights=[w for _, w in PATCH])[0]
                    ang = rng.uniform(0, 360)
                    d = rng.uniform(20.0, 70.0)
                    px, py = x + math.cos(math.radians(ang)) * d, y + math.sin(math.radians(ang)) * d
                    scale = rng.uniform(0.85, 1.25)
                    for part in KIT[module]["parts"]:
                        material = petal if part["part"] == "petal" else part["material"]
                        key = "%s_%s_%s_%s" % (PASS, cell, part["part"], material.replace("MI_V2_", ""))
                        bt = batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": material,
                                                      "instances": [], "collides": False,
                                                      "cast_shadow": False, "affect_df": False, "cull_distance": CULL})
                        bt["instances"].append([round(px, 1), round(py, 1), round(lawn["top"], 1), 0.0,
                                                round(rng.uniform(0, 360), 1), 0.0, round(scale, 2), round(scale, 2), round(scale * rng.uniform(0.9, 1.3), 2)])
                stats["patches"] += 1
    plan = {}
    for cell, batches in cells.items():
        layer = {"pass": "%s_%s" % (PASS, cell), "title": "LF01 %s: flower drifts in the lawns near where visitors walk" % cell,
                 "tags": ["LF01"], "actors": [], "batches": list(batches.values())}
        (HERE / ("lf01_%s.json" % cell)).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
        plan[cell] = sum(len(b["instances"]) for b in batches.values())
    (HERE / "lf01_plan.json").write_text(json.dumps({"stats": stats, "cells": plan}, indent=1), encoding="utf-8", newline="\n")
    return stats, plan


if __name__ == "__main__":
    stats, plan = main()
    print(dict(stats))
    print("cells", len(plan), "instances", sum(plan.values()))
