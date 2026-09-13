#!/usr/bin/env python3
"""SKY05 -- the distant metropolis: the enormous enchanted city the garden sits inside.

WHAT THE BIBLE SHOWS (VISUAL_AUTHORITY.md; bible_panels.json hero_b1, skyline_b4, scale_depth_b2). "200 m+
distant skyline" is not a backdrop band -- it is a city: dense stands of needle towers under pink and
lavender cones at many heights, receding plane after plane, with bridges strung between them, so that
from the garden the city rises across the whole width of the view.

WHAT WAS THERE (census_city_2026-09-13.json, bible-compare). A far city of 2,235 pieces already stands at
350-1,100 m, but under a height ceiling: from the player path the castle city 110-300 m out hides every
piece of it. From the arrival the skyline is a strip.

WHAT THIS LAYER ADDS. Clusters of kit towers (legal spellings, kitstack.py) at three depths -- near
(480-600 m), middle (660-800 m), far (860-1,040 m) and farthest (1,080-1,250 m) -- across the view on both sides of the Great Spire's
bearing. Every tower is SIZED FROM MEASUREMENT: it must rise above everything in front of it, from the
hero, arrival and path eyes, by a share of its own height (occluders: census_north tall pieces plus the
existing far city). Heights therefore come out large -- 150-360 m -- which is what an enchanted metropolis
seen over a castle is; at that range a 300 m needle subtends what a 30 m tower does at 90 m, and the
atmosphere cools it into the distance. Within a cluster heights fall away from its core, and one or two
pairs are joined by sky bridges. Feet collide (the outer world is walkable ground); nothing casts shadows
at this range.
"""
import json
import math
import random
from collections import defaultdict
from pathlib import Path

import kitstack as kit
import sky02_needle_skyline as sky02

HERE = Path(__file__).resolve().parent
PASS = "SKY05"
CITY = json.loads((HERE / "census_city_2026-09-13.json").read_text(encoding="utf-8"))
NORTH = sky02.CENSUS
GROUND_Z = -14.0

EYES = {"hero": (0.0, -150.0, 262.0), "arrival": (0.0, -1460.0, 180.0), "path": (0.0, 1100.0, 175.0)}
HERO = EYES["hero"]
BEARINGS = (28.0, 152.0)
SPIRE_KEEPOUT_DEG = 8.0
BANDS = ((48000.0, 60000.0), (66000.0, 80000.0), (86000.0, 104000.0), (108000.0, 125000.0))
SCALE_RANGE = (1.8, 4.6)
FAR_SCALE_MAX = 6.0          # beyond 860 m a needle may reach ~500 m: at 1 km that subtends what a castle tower does at 110 m
MAX_TOWERS = 150
BROAD = ("WL_Tower_Crown_Cap", "WL_Tower_Crown_Pavilion")
SOFT_WORDS = ("canopy", "tree", "blossom", "hedge", "leaf", "flower", "topiary", "vine", "ivy", "rose", "bloom",
              "cloud", "balloon", "shrub", "bush", "lavender", "grass", "fern", "petal")


def _solid(mesh_name):
    """Skyline visibility is judged against ARCHITECTURE. Crowns are leafy, gappy and being framed
    (vegetation trims), so a canopy 60 m from the path must not decide how tall a city 700 m out is."""
    low = mesh_name.lower()
    return not any(w in low for w in SOFT_WORDS)


def _occluders():
    """Per eye and whole degree: (distance, elevation) of the top of every near and far piece."""
    rows = [(r[2], r[3], r[4], r[6]) for r in NORTH["tall"] if _solid(r[1])]
    rows += [(r[2], r[3], r[5], r[7]) for r in CITY["far"] if _solid(r[1])]
    table = {}
    for name, (ex, ey, ez) in EYES.items():
        by_deg = defaultdict(list)
        for x, y, radius, zmax in rows:
            dist = math.hypot(x - ex, y - ey)
            if dist < 500.0:
                continue
            az = math.degrees(math.atan2(y - ey, x - ex))
            half = math.degrees(math.asin(min(1.0, radius / dist)))
            elev = math.degrees(math.atan2(zmax - ez, dist))
            for a in range(int(math.floor(az - half)), int(math.ceil(az + half)) + 1):
                by_deg[a % 360].append((dist, elev))
        table[name] = by_deg
    return table


def _need(occ, x, y):
    worst = -1e9
    for name, (ex, ey, ez) in EYES.items():
        dist = math.hypot(x - ex, y - ey)
        az = int(round(math.degrees(math.atan2(y - ey, x - ex)))) % 360
        elev = max([e for d, e in occ[name][az] if d < dist - 1500.0] + [-89.0])
        worst = max(worst, ez + math.tan(math.radians(elev)) * dist)
    return worst


def _clearance_grid():
    grid = defaultdict(list)
    for r in NORTH["tall"]:
        grid[(int(r[2] // 4000), int(r[3] // 4000))].append((r[2], r[3], r[4]))
    for r in CITY["far"]:
        if r[5] >= 800.0:                      # houses, halls, towers -- not kerbs, balustrades or glass panes
            grid[(int(r[2] // 4000), int(r[3] // 4000))].append((r[2], r[3], r[5]))
    return grid


def _clear(grid, x, y, radius):
    gx, gy = int(x // 4000), int(y // 4000)
    for i in range(gx - 2, gx + 3):
        for j in range(gy - 2, gy + 3):
            for (px, py, pr) in grid.get((i, j), ()):
                if math.hypot(px - x, py - y) < pr + radius + 300.0:
                    return False
    return True


def build():
    rng = random.Random(20260913 + 105)
    occ = _occluders()
    grid = _clearance_grid()
    spellings = [(s, h) for s, h in kit.spellings(3) if s[-1] not in BROAD]
    needles = [c for c in spellings if kit.MODULES[c[0][-1]]["role"] == "needle"]
    crowns = [c for c in spellings if kit.MODULES[c[0][-1]]["role"] == "crown"]
    batches = kit.Batches(PASS)
    towers, bridges, placed = [], [], []

    centres = []
    b = BEARINGS[0]
    k = 0
    while b <= BEARINGS[1]:
        if abs(b - 90.0) >= SPIRE_KEEPOUT_DEG:
            band = BANDS[(k * 3) % len(BANDS)]
            centres.append((b + rng.uniform(-1.5, 1.5), rng.uniform(*band), k))
            k += 1
        b += rng.uniform(3.5, 5.0)

    for (bearing, dist, ci) in centres:
        cx = HERO[0] + dist * math.cos(math.radians(bearing))
        cy = HERO[1] + dist * math.sin(math.radians(bearing))
        members = rng.randint(5, 8)
        cluster = []
        core_scale = None
        for m in range(members):
            if len(towers) >= MAX_TOWERS:
                break
            core = m == 0
            pool = needles if (core or rng.random() < 0.72) else crowns
            stack, height = pool[rng.randrange(len(pool))]
            foot = kit.footprint(stack)
            for attempt in range(24):
                # Members ring the core at a spacing scaled by the core tower's own size.
                if core:
                    ring = 0.0 if attempt == 0 else 1500.0 * attempt ** 0.8   # search outward for a clear footing
                else:
                    if core_scale is None:
                        break
                    ring = rng.uniform(2.0, 3.4) * 950.0 * core_scale * (1.0 + 0.18 * m)
                ang = rng.uniform(0.0, 2.0 * math.pi)
                x, y = cx + ring * math.cos(ang), cy + ring * math.sin(ang)
                need = _need(occ, x, y) - GROUND_Z
                show = (0.36 if core else rng.uniform(0.08, 0.22))
                target = need / (1.0 - show)
                s = target / height
                cap = SCALE_RANGE[1] if dist < 86000.0 else FAR_SCALE_MAX
                if s > cap:
                    s = cap
                    if height * s < need + 2500.0:
                        continue                 # it would not show: a tower nobody sees is not built
                s = max(s, SCALE_RANGE[0])
                r = foot * s
                if not _clear(grid, x, y, r) or any(math.hypot(x - px, y - py) < r + pr + 600.0 for px, py, pr in placed):
                    continue
                yaw = math.degrees(math.atan2(HERO[1] - y, HERO[0] - x)) + rng.choice((0.0, 90.0, 180.0, 270.0))
                top = batches.add_stack(stack, x, y, GROUND_Z - 60.0 * s, yaw, s)
                placed.append((x, y, r))
                rec = {"cluster": ci, "at": [round(x), round(y)], "bearing": round(math.degrees(math.atan2(y - HERO[1], x - HERO[0])), 1),
                       "distance_m": round(math.hypot(x - HERO[0], y - HERO[1]) / 100.0), "scale": round(s, 2),
                       "height_m": round(height * s / 100.0), "need_m": round(need / 100.0), "top_z": round(top), "stack": stack}
                towers.append(rec)
                cluster.append((x, y, r, top, s))
                if core:
                    core_scale = s
                break
        # A sky bridge between the two towers of the cluster closest in height and spacing.
        best = None
        for i in range(len(cluster)):
            for j in range(i + 1, len(cluster)):
                (x1, y1, r1, t1, s1), (x2, y2, r2, t2, s2) = cluster[i], cluster[j]
                d = math.hypot(x2 - x1, y2 - y1)
                span = d - 0.45 * (r1 + r2)
                bs = span / 2896.0
                if 1.2 <= bs <= 4.5 and (best is None or d < best[0]):
                    best = (d, cluster[i], cluster[j], bs)
        if best is not None:
            d, (x1, y1, r1, t1, s1), (x2, y2, r2, t2, s2), bs = best
            z = (min(t1, t2) - GROUND_Z) * rng.uniform(0.38, 0.52) + GROUND_Z - 402.0 * bs
            batches.add_module("WL_Bridge_Sky", (x1 + x2) / 2.0, (y1 + y2) / 2.0, z,
                               math.degrees(math.atan2(y2 - y1, x2 - x1)), bs)
            bridges.append({"cluster": ci, "scale": round(bs, 2), "z": round(z)})

    feet = {part["mesh"] for m in kit.MODULES.values() if m["role"] == "foot" for part in m["parts"]}
    batch_list = batches.as_list()
    for bt in batch_list:
        bt["cast_shadow"] = False
        bt["collides"] = bt["mesh"] in feet
    heights = sorted(t["height_m"] for t in towers)
    return {"pass": PASS, "title": "Distant metropolis: clustered kit towers 520-1150 m out, sized to rise over the castle city",
            "folder": "Wonderland/Authored/SKY05", "tags": ["V2_Skyline"], "actors": [], "batches": batch_list,
            "summary": {"clusters": len(centres), "towers": len(towers), "bridges": len(bridges),
                        "height_m_min_median_max": [heights[0], heights[len(heights) // 2], heights[-1]] if heights else None},
            "towers": towers, "bridges": bridges}


if __name__ == "__main__":
    spec = build()
    out = HERE / "sky05_distant_metropolis.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %s, %d batches, %d instances -> %s" % (PASS, spec["summary"], len(spec["batches"]),
          sum(len(b["instances"]) for b in spec["batches"]), out.name))
