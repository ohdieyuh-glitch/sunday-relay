#!/usr/bin/env python3
"""Where in Wonderland can you stand and have nothing to walk to?

    python3 wonderland/v2/tools/region.py [--cell 10] [--decile 90]
                                          [--sectors] [--json out.json]

The four audits this project already has each answer one question well, and
on 2026-09-06 all four passed on a world that still has three neighbouring
quarters made entirely of plants:

    emptiness.py --scaled        304 m2 empty in the whole world
    walkable.py --window=world   0 of 60 quarters unreachable, 0 of 30 stops
    hierarchy.py                 GROUND core:far 10.05x, 0 nested, 0 stray roads
    camera_framing.py            every camera's near band accounted for

That is the gap this file closes. **A place can be full of actors, reachable,
correctly sparse for its own tier, and still be nothing to arrive at.**
Presence is not a destination, and none of the four can tell the difference.

## What it measures

Three distances, from a grid over the whole accessible world:

    BUILT   to the nearest built piece at least 25 m tall -- something you
            can navigate BY. The world's own measured p90 silhouette is
            28.7 m, so 25 m is "reads from the next region", not a bar
            invented here.
    ARCH    to the nearest architecture or prop of any size -- anything at
            all that somebody put there on purpose.
    ROAD    to the nearest road segment -- the world's own movement network.

BUILT, not TALL. The first version of this measure reported the worst region
as having 81 m of silhouette in it and the 81 m was a HOT-AIR BALLOON; the
next four were tree canopies. Both were already in this project's ledger --
skyline.py found the second-tallest thing in Wonderland was a balloon, and
occlusion.py found seven of the eighteen largest presences were crowns. A
tree is scenery. You do not navigate by it and you do not cross a world to
reach it, so vegetation and the balloons are excluded from BUILT and ARCH.

## What it ranks

Ground is FORSAKEN when all three distances are past the world's own 90th
percentile -- the worst tenth on every axis at once. Self-calibrating on
purpose: a fixed threshold would be a statement about Wonderland's size
rather than about its structure, and the far tier is SUPPOSED to be sparse.
`--decile` moves the bar and prints where it was set.

Forsaken cells are then flood-filled into contiguous regions and ranked BY
AREA, because the ranking this project needs is not "which cell scores worst"
but "where are the most square metres of it" -- three passes went to a
twenty-metre patch because a camera happened to be pointed at it, and a
plan-view audit exists to stop that happening again.

`--sectors` adds a bearing-by-ring table of the same world: coarser, and
useful for seeing whether a fault is one pocket or a whole rim.
"""
import json
import math
import os
import sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "infra", "build", "hd"))
sys.path.insert(0, HERE)
os.environ.setdefault("WLV2_PASS02", "1")
os.environ.setdefault("WLV2_PASS03", "1")

import layout_v2 as LAYOUT     # noqa: E402
import hierarchy as HIER_TOOL  # noqa: E402
import skyline as SKY          # noqa: E402

#: uu. The accessible world: `layout_v2._H_R1` is the far edge of the walkable
#: world and the quarters reach 343 m, so the ranked disc is Golden Arrival's
#: outskirt outward. Inside `R_IN` is the founder-approved arrival composition
#: and is never a candidate for repair.
R_IN, R_OUT = 6500.0, 36000.0

#: m. What "there is something built here" means vertically. Measured p90 of
#: the whole world's silhouette is 28.7 m and its median is 5.5.
LOOK_H = 25.0

#: Classes that can BE the thing you look at, and the sky furniture that
#: cannot, however tall its bounding box happens to be.
LOOK_CLASSES = ("arch", "prop")
LOOK_EXCLUDE = ("balloon_", "cloud_", "sky_")


def _top_m(bb, p):
    """A placement's measured top in m, from the built mesh and its z scale.

    `ztop` and `scale[2]`, exactly as `skyline.tops()` reads them -- one
    definition of how tall a thing is, shared, so this file cannot drift from
    the tool that measured the geometry.

    PITCH IS HANDLED, because it has to be: a recipe that lies flat in its own
    space (portal_ring is 12 m across and 0.14 m thick) stood upright by
    `pitch=90` is a 12 m gateway, and reading `ztop` alone would call it
    ankle-high. The rotated extent is the bounding box turned by the pitch --
    exact for a box, conservative for anything inside one.
    """
    pitch = math.radians(p["rot"][0]) if p.get("rot") else 0.0
    sx, sz = abs(p["scale"][0]), abs(p["scale"][2])
    h, w = bb["ztop"] * sz, bb["rx"] * sx
    if abs(pitch) > 1e-6:
        h = abs(h * math.cos(pitch)) + abs(w * math.sin(pitch))
    return (p["pos"][2] + h) / 100.0


def collect():
    """Built silhouettes, all architecture, and the road segments."""
    boxes = SKY.bboxes()
    built, arch, road = [], [], []
    for p in LAYOUT.ALL:
        a = p["asset"]
        lab = p.get("label") or ""
        if a == "terrace_platform" and "_Seg" in lab:
            road.append((p["pos"][0], p["pos"][1]))
        k = HIER_TOOL.klass(a)
        if k in ("sky", "surface", "veg"):
            continue
        if any(a.startswith(x) for x in LOOK_EXCLUDE):
            continue
        arch.append((p["pos"][0], p["pos"][1], a, lab))
        bb = boxes.get(a)
        if bb and _top_m(bb, p) >= LOOK_H:
            built.append((p["pos"][0], p["pos"][1], a, lab))
    return built, arch, road


class _Near(object):
    """Nearest-point queries on a fixed bucket grid. Plain, and exact.

    The ring walk keeps going one ring PAST the first hit: a point in a
    diagonal bucket can be nearer than one in the ring that first answered,
    and stopping on the first hit is the classic way to get a plausible wrong
    number out of a grid.
    """

    def __init__(self, pts, cell=6000.0):
        self.cell, self.g = cell, {}
        for q in pts:
            self.g.setdefault((int(q[0] // cell), int(q[1] // cell)), []).append(q)

    def nearest(self, x, y):
        gx, gy = int(x // self.cell), int(y // self.cell)
        best, bq, ring = 1e30, None, 0
        while ring <= 40:
            for a in range(gx - ring, gx + ring + 1):
                for b in range(gy - ring, gy + ring + 1):
                    if ring and max(abs(a - gx), abs(b - gy)) != ring:
                        continue
                    for q in self.g.get((a, b), ()):
                        d = (q[0] - x) ** 2 + (q[1] - y) ** 2
                        if d < best:
                            best, bq = d, q
            if bq is not None and math.sqrt(best) <= (ring - 1) * self.cell:
                break
            ring += 1
        return math.sqrt(best), bq


def sample(cell_m, decile):
    """Every ground cell with its three distances, and the world's own bar."""
    built, arch, road = collect()
    nb, na, nr = _Near(built), _Near(arch), _Near(road)
    cell = cell_m * 100.0
    n = int(2 * R_OUT // cell)
    cells = {}
    for i in range(n):
        for j in range(n):
            x, y = -R_OUT + (i + 0.5) * cell, -R_OUT + (j + 0.5) * cell
            if not (R_IN <= math.hypot(x, y) <= R_OUT):
                continue
            cells[(i, j)] = {"x": x, "y": y,
                             "built": nb.nearest(x, y)[0],
                             "arch": na.nearest(x, y)[0],
                             "road": nr.nearest(x, y)[0]}
    thr = {}
    for k in ("built", "arch", "road"):
        v = sorted(c[k] for c in cells.values())
        thr[k] = v[min(len(v) - 1, int(decile / 100.0 * len(v)))]
    return cells, thr, cell, (built, arch, road)


def flood(cells, thr, cell):
    """Contiguous runs of forsaken ground, largest first."""
    poor = {c for c, v in cells.items()
            if v["built"] > thr["built"] and v["arch"] > thr["arch"]
            and v["road"] > thr["road"]}
    seen, regs = set(), []
    for c in poor:
        if c in seen:
            continue
        q, comp = deque([c]), []
        seen.add(c)
        while q:
            cc = q.popleft()
            comp.append(cc)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    e = (cc[0] + dx, cc[1] + dy)
                    if e in poor and e not in seen:
                        seen.add(e)
                        q.append(e)
        xs = [cells[k]["x"] for k in comp]
        ys = [cells[k]["y"] for k in comp]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        regs.append({
            "cells": len(comp), "area_m2": len(comp) * (cell / 100.0) ** 2,
            "cx_m": cx / 100.0, "cy_m": cy / 100.0,
            "r_m": math.hypot(cx, cy) / 100.0,
            "bearing": math.degrees(math.atan2(cy, cx)) % 360.0,
            "x0_m": min(xs) / 100.0, "x1_m": max(xs) / 100.0,
            "y0_m": min(ys) / 100.0, "y1_m": max(ys) / 100.0,
            "worst_built_m": max(cells[k]["built"] for k in comp) / 100.0,
            "worst_arch_m": max(cells[k]["arch"] for k in comp) / 100.0,
            "worst_road_m": max(cells[k]["road"] for k in comp) / 100.0,
            "district": LAYOUT._district_of(cx, cy)[0],
        })
    regs.sort(key=lambda r: -r["area_m2"])
    return regs, len(poor)


def sectors(cells, rings=(6500.0, 14000.0, 23000.0, 36000.0), n=16):
    rows = []
    step = 360.0 / n
    for band in range(len(rings) - 1):
        for b in range(n):
            sel = [v for v in cells.values()
                   if rings[band] <= math.hypot(v["x"], v["y"]) < rings[band + 1]
                   and int((math.degrees(math.atan2(v["y"], v["x"])) % 360.0) / step) == b]
            if not sel:
                continue
            rows.append({
                "r0": rings[band] / 100.0, "r1": rings[band + 1] / 100.0,
                "b0": b * step, "b1": (b + 1) * step, "cells": len(sel),
                "built_p50": sorted(v["built"] for v in sel)[len(sel) // 2] / 100.0,
                "arch_p50": sorted(v["arch"] for v in sel)[len(sel) // 2] / 100.0,
                "road_p50": sorted(v["road"] for v in sel)[len(sel) // 2] / 100.0,
            })
    rows.sort(key=lambda r: -(r["built_p50"] + r["arch_p50"] + r["road_p50"]))
    return rows


def main():
    args = sys.argv[1:]

    def opt(name, d):
        return next((a.split("=")[1] for a in args if a.startswith("--%s=" % name)), d)

    cell_m = float(opt("cell", "10"))
    decile = float(opt("decile", "90"))
    out_json = opt("json", None)

    cells, thr, cell, (built, arch, road) = sample(cell_m, decile)
    regs, n_poor = flood(cells, thr, cell)

    area_ha = len(cells) * (cell_m ** 2) / 1e4
    print("REGION AUDIT -- the accessible world, %.0f..%.0f m, %.0f m cells"
          % (R_IN / 100.0, R_OUT / 100.0, cell_m))
    print("  %d built silhouettes >= %.0f m, %d architecture/props, %d road segments"
          % (len(built), LOOK_H, len(arch), len(road)))
    print("  %d ground cells = %.1f ha ranked\n" % (len(cells), area_ha))

    print("HOW FAR IS ANYTHING, over the whole accessible world")
    print("  %-30s %6s %6s %6s %6s" % ("", "p50", "p90", "p99", "max"))
    for k, name in (("built", "to a built thing >= %.0f m" % LOOK_H),
                    ("arch", "to any architecture or prop"),
                    ("road", "to a road")):
        v = sorted(c[k] / 100.0 for c in cells.values())
        print("  %-30s %6.0f %6.0f %6.0f %6.0f  m"
              % (name, v[len(v) // 2], v[int(0.90 * len(v))],
                 v[int(0.99 * len(v))], v[-1]))

    print("\nFORSAKEN GROUND -- past the world's own %.0fth percentile on ALL THREE"
          % decile)
    print("  the bar, set by this world: built > %.0f m, arch > %.0f m, road > %.0f m"
          % (thr["built"] / 100.0, thr["arch"] / 100.0, thr["road"] / 100.0))
    print("  %d cells = %d m2 (%.2f ha, %.1f%% of the accessible world) in %d regions\n"
          % (n_poor, n_poor * (cell_m ** 2), n_poor * (cell_m ** 2) / 1e4,
             100.0 * n_poor / len(cells), len(regs)))
    hdr = ("  %-9s %6s %9s %6s %6s   %-16s %6s %6s %6s"
           % ("area m2", "share", "centre", "r m", "bear", "district",
              "built", "arch", "road"))
    print(hdr)
    print("  " + "-" * (len(hdr) - 2))
    total = sum(r["area_m2"] for r in regs) or 1.0
    for r in regs[:10]:
        print("  %-9.0f %5.0f%% %9s %6.0f %6.0f   %-16s %6.0f %6.0f %6.0f"
              % (r["area_m2"], 100.0 * r["area_m2"] / total,
                 "%.0f,%.0f" % (r["cx_m"], r["cy_m"]), r["r_m"], r["bearing"],
                 r["district"], r["worst_built_m"], r["worst_arch_m"],
                 r["worst_road_m"]))

    if regs:
        w = regs[0]
        print("\nWORST REGION -- %s" % w["district"])
        print("  %.0f m2 (%.2f ha), %.0f%% of all the forsaken ground in Wonderland"
              % (w["area_m2"], w["area_m2"] / 1e4, 100.0 * w["area_m2"] / total))
        print("  centre (%.0f, %.0f) m -- r %.0f m, bearing %.0f deg"
              % (w["cx_m"], w["cy_m"], w["r_m"], w["bearing"]))
        print("  extent  x %.0f..%.0f m,  y %.0f..%.0f m"
              % (w["x0_m"], w["x1_m"], w["y0_m"], w["y1_m"]))
        print("  at its worst: %.0f m from a built silhouette, %.0f m from ANY"
              " architecture, %.0f m from a road"
              % (w["worst_built_m"], w["worst_arch_m"], w["worst_road_m"]))
        cx, cy = w["cx_m"] * 100.0, w["cy_m"] * 100.0
        near = sorted(arch, key=lambda q: math.hypot(q[0] - cx, q[1] - cy))[:6]
        print("  nearest built things to its centre:")
        for q in near:
            print("     %-22s %-28s %5.0f m"
                  % (q[2], (q[3] or "")[:28], math.hypot(q[0] - cx, q[1] - cy) / 100.0))

    if "--sectors" in args:
        print("\nBY SECTOR -- median distances, worst first")
        print("  %-24s %6s %6s %6s" % ("region", "built", "arch", "road"))
        for r in sectors(cells)[:12]:
            print("  %3.0f-%3.0f m  %3.0f-%3.0f deg  %6.0f %6.0f %6.0f"
                  % (r["r0"], r["r1"], r["b0"], r["b1"],
                     r["built_p50"], r["arch_p50"], r["road_p50"]))

    if out_json:
        with open(out_json, "w") as fh:
            json.dump({"thresholds_m": {k: v / 100.0 for k, v in thr.items()},
                       "cell_m": cell_m, "decile": decile,
                       "ground_cells": len(cells), "forsaken_cells": n_poor,
                       "regions": regs}, fh, indent=1)
        print("\njson -> %s" % out_json)


if __name__ == "__main__":
    main()
