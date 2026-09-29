#!/usr/bin/env python3
"""SX01 -- SEAM BYPASSES: stepping stones round the two things that break SR030, so the seam way connects.

    python WorldDesign/Rings/seam_bypass.py        (writes sx01_seam_bypass.json)

WHY (2026-09-29, CORE Q5). SR030 (seam_radials.py) is paved from the march ring to the outer ring except where
something stands on its line: a SKY05 tower base at ~716-722 m (4 plates refused) and a V2 hedge mass at its
RR02 junction (~1,116 m, 1 plate). A road that stops at a tower is a cul-de-sac unless the way round is made.
WHAT. For each broken stretch (sr030_refused.json, grouped), a 1 m grid search (BFS, 8-connected) round the
blocker from the last laid plate before the gap to the first after it, over the census Occupancy
(forge_districts.Site: anything standing, a 0.9 m walker half-width plus margin) with SR030's own plates as
open ground. Stepping stones every ~4.5 m along the found way (the heartland recipe: WL_Ground_Flagstone_A/B/C
at 0.55, -13, not colliding, 260 m cull). A gap with no way round within 80 m is reported, not paved.
"""
import json
import math
import random
import sys
from collections import deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
WD = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(WD / "Districts"))
import forge_districts as FD                                              # noqa: E402
import ring_roads as RR                                                   # noqa: E402

PASS = "SX01"
FLAGS = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
CELL = 100.0
BOX = 8000.0                        # 80 m each way: a SKY05 tower base plus its cluster
HALF = 70.0                         # walker half-width (the Dog's capsule is ~0.4 m)
STEP = 450.0


def plates(spec):
    return [(i[0], i[1]) for b in spec["batches"] if "_Plate_" in b["id"] for i in b["instances"]]


def groups(refused):
    out = []
    for r in sorted(refused, key=lambda r: r["bearing"]):
        if out and math.hypot(r["x"] - out[-1][-1]["x"], r["y"] - out[-1][-1]["y"]) < 1500.0:
            out[-1].append(r)
        else:
            out.append([r])
    return out


def bfs(site, a, b, cx, cy):
    n = int(2 * BOX / CELL) + 1
    def cell(x, y):
        return int(round((x - cx + BOX) / CELL)), int(round((y - cy + BOX) / CELL))
    def world(i, j):
        return cx - BOX + i * CELL, cy - BOX + j * CELL
    blocked = {}
    def free(i, j):
        if (i, j) not in blocked:
            x, y = world(i, j)
            blocked[(i, j)] = site.occ.hits(x, y, HALF, HALF, 0.0, 20.0, ("existing",)) is None
        return blocked[(i, j)]
    s, t = cell(*a), cell(*b)
    prev = {s: None}
    q = deque([s])
    while q:
        c = q.popleft()
        if c == t:
            break
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                nb = (c[0] + di, c[1] + dj)
                if nb in prev or not (0 <= nb[0] < n and 0 <= nb[1] < n):
                    continue
                if not free(*nb) and nb != t:
                    continue
                prev[nb] = c
                q.append(nb)
    if t not in prev:
        return None
    path, c = [], t
    while c is not None:
        path.append(world(*c))
        c = prev[c]
    return path[::-1]


def main():
    rng = random.Random(30)
    sr = json.loads((HERE / "sr030_seam_way.json").read_text(encoding="utf-8"))
    refused = json.loads((HERE / "sr030_refused.json").read_text(encoding="utf-8"))
    laid = plates(sr)
    # the far side of a gap at SR030's outer end is the OUTER RING's paving, not more of SR030
    ring = plates(json.loads((HERE / "rr02_outer_ring.json").read_text(encoding="utf-8")))
    spec = RR.Spec(PASS, "Wonderland/Authored/SX01_SeamBypass")
    k = 0
    for g in groups(refused):
        gx = sum(r["x"] for r in g) / len(g)
        gy = sum(r["y"] for r in g) / len(g)
        near = sorted(laid, key=lambda p: math.hypot(p[0] - gx, p[1] - gy))
        a = near[0]
        # the first laid plate on the OTHER side of the gap: far enough from `a` to lie beyond the refused run
        span = max(math.hypot(r["x"] - g[0]["x"], r["y"] - g[0]["y"]) for r in g) + 800.0
        b = next((p for p in near[1:] if math.hypot(p[0] - a[0], p[1] - a[1]) > span and
                  ((p[0] - gx) * (a[0] - gx) + (p[1] - gy) * (a[1] - gy)) < 0), None)
        if b is None or math.hypot(b[0] - gx, b[1] - gy) > BOX:
            b = min(ring, key=lambda p: math.hypot(p[0] - gx, p[1] - gy))
            if math.hypot(b[0] - gx, b[1] - gy) > BOX:
                b = None
        site = FD.Site(gx, gy, BOX + 1500.0)
        way = bfs(site, a, b, gx, gy) if b else None
        what = g[0]["blocker"].split(":")[-1][:30]
        if not way:
            print("   gap at %.1f deg %d m (%s): NO way round within %d m" % (g[0]["bearing"], g[0]["r_m"], what, BOX / 100))
            spec.stats["gap_no_way"] += 1
            continue
        length, last = 0.0, None
        for (x, y) in way:
            if last is not None:
                length += math.hypot(x - last[0], y - last[1])
            if last is None or math.hypot(x - last_stone[0], y - last_stone[1]) >= STEP:
                name = FLAGS[k % 3]
                for part in RR.KIT[name]["parts"]:
                    if part["part"] != "veg_anchor":
                        spec.add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], part["material"],
                                 x, y, -13.0, rng.uniform(0.0, 360.0), 0.55, 0.55, 0.55, collides=False, cull=26000.0)
                last_stone = (x, y)
                k += 1
                spec.stats["stone"] += 1
            last = (x, y)
        spec.stats["gap_bridged"] += 1
        print("   gap at %.1f deg %d m (%s): way round %.0f m" % (g[0]["bearing"], g[0]["r_m"], what, length / 100.0))
    out = spec.out(["WL_AUTHORED", "WL_PASS_%s" % PASS, "WL_RING_ROAD"])
    (HERE / "sx01_seam_bypass.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print("%s: %d stones, %d instances, %d batches; %s" % (PASS, spec.stats["stone"],
          sum(len(b["instances"]) for b in out["batches"]), len(out["batches"]), dict(spec.stats)))


if __name__ == "__main__":
    main()
