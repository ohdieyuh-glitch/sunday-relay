#!/usr/bin/env python3
"""SR030 / SR150 -- THE SEAM WAYS: a road on each open seam, from the march ring out to the outer ring.

    python WorldDesign/Rings/seam_radials.py        (writes seam_routes.json, sr030_seam_way.json, sr150_seam_way.json)

WHY (2026-09-29, world completion, CORE Q5 / S02). Three avenues run out from the city, one per nation, and the two
rings join them. The seams between the nations had no road of their own, except the rear one (W270's seam way,
511-1,111 m). A walker on the march ring at 30 deg or 150 deg could see the outer ring and not reach it.

WHAT STANDS ON THE SEAMS (seam_probe.py, 05:05 census). The seam lines themselves are rows of skyline towers: at
30 deg a 28.8 m way down the line is blocked from 500 to 1,165 m with only short gaps, at 150 deg the same, with
the V2 hedge ring across it at 894-1,119 m. So the road is FOUND beside the tower row, the way the rings were
found: a Viterbi path over radial distance u (2 m steps) and sideways offset v (2 m steps, +/-150 m), with the
Occupancy of ring_probe.load (the shared SAT test). A full 20 m corridor is preferred, a 10 m lane where only
that passes, and a stretch where nothing passes is REPORTED with what blocks it, never paved through.
THE PAVING is ring_roads.build (the nations' plates, kerbs, lanterns every 24 m, avenue trees), walked along an
open polyline instead of a loop. Existing floor is skipped, so the junctions with RR01 / RR02 join their plates.
FIRST BUILD (05:05 census): SR150 434 m, 0 blocked. SR030 569 m with two breaks: ~30 m at a SKY05 tower near 710 m
(every lane within +/-130 m is shut there by the cluster and the far-side lane is shut further out), and ~7 m at a
V2 hedge mass where it meets RR02 inside that ring's own SKY05 break (23-32 deg). Both to be walked in play.
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ring_roads                                                        # noqa: E402
from ring_probe import load as load_census, png                          # noqa: E402
from w270_rear_seam import Occupancy                                     # noqa: E402

DU = 200.0                     # uu along the seam per step
DV = 200.0                     # uu of sideways offset per candidate
V_MAX = 22000.0                # the road may stand up to 220 m off the seam line: at 30 deg a SKY05 cluster fills +/-130 m at 690-716 m
HALF_WIDTH = ring_roads.PLATE_X * 0.5 + 300.0          # plate + kerbs + a margin: the corridor the paving needs
NARROW_HALF = ring_roads.PLATE_X * 0.25 + 300.0
NARROW_COST = 3.0
BLOCK = 5e6
MAX_SIDE = 300.0               # uu of sideways move per 2 m step: bends round a tower, not zig-zags
SEAMS = {"SR030": 30.0, "SR150": 150.0}
RINGS = json.loads((HERE / "ring_routes.json").read_text(encoding="utf-8"))


def ring_r(name, bearing):
    pts = RINGS[name]["points"]
    return min(pts, key=lambda p: abs(((p[0] - bearing) + 180.0) % 360.0 - 180.0))[1]


def search(occ, bearing):
    th = math.radians(bearing)
    D, L = (math.cos(th), math.sin(th)), (-math.sin(th), math.cos(th))
    u0, u1 = ring_r("MARCH", bearing), ring_r("OUTER", bearing)
    us = [u0 + DU * i for i in range(int((u1 - u0) / DU) + 1)]
    vs = [-V_MAX + DV * j for j in range(int(2 * V_MAX / DV) + 1)]
    lvl, why = [], []
    for u in us:
        row, wrow = [], []
        for v in vs:
            x, y = D[0] * u + L[0] * v, D[1] * u + L[1] * v
            hit = occ.hits(x, y, DU * 0.5 + 150.0, HALF_WIDTH, bearing, 0.0, ("existing",))
            level = 0
            if hit is not None:
                level = 1 if occ.hits(x, y, DU * 0.5 + 150.0, NARROW_HALF, bearing, 0.0, ("existing",)) is None else 2
            row.append(level)
            wrow.append(hit)
        lvl.append(row)
        why.append(wrow)
    INF = 1e18
    span = int(MAX_SIDE / DV) + 1
    # the ends meet the rings wherever they are clear: start free, weighted only by the offset
    cost = [abs(v) / 1000.0 + (BLOCK if lvl[0][j] == 2 else 0.0) for j, v in enumerate(vs)]
    back = []
    for i in range(1, len(us)):
        new, arg = [INF] * len(vs), [0] * len(vs)
        for j, v in enumerate(vs):
            level = lvl[i][j]
            local = abs(v) / 2000.0 + (BLOCK if level == 2 else (NARROW_COST if level == 1 else 0.0))
            best, bj = INF, 0
            for k in range(max(0, j - span), min(len(vs), j + span + 1)):
                dv = abs(vs[k] - v) / 100.0
                c = cost[k] + dv + dv * dv
                if c < best:
                    best, bj = c, k
            new[j], arg[j] = best + local, bj
        back.append(arg)
        cost = new
    j = min(range(len(vs)), key=lambda k: cost[k])
    path = [j]
    for arg in reversed(back):
        j = arg[j]
        path.append(j)
    path.reverse()
    pts = []
    for i, j in enumerate(path):
        u, v = us[i], vs[j]
        x, y = D[0] * u + L[0] * v, D[1] * u + L[1] * v
        pts.append({"u": u, "v": v, "x": round(x, 1), "y": round(y, 1), "level": lvl[i][j], "blocker": why[i][j]})
    return pts


def resample_open(points, step):
    """ring_roads.resample for an OPEN polyline: smoothed, walked at a fixed arc length, no wrap at the ends."""
    pts = [(p[2], p[3], p[4]) for p in points]
    n, h = len(pts), ring_roads.SMOOTH // 2
    sm = []
    for i in range(n):
        ks = [min(n - 1, max(0, i + k)) for k in range(-h, h + 1)]
        sm.append((sum(pts[k][0] for k in ks) / len(ks), sum(pts[k][1] for k in ks) / len(ks), max(pts[k][2] for k in ks)))
    out, carry = [], 0.0
    for i in range(n - 1):
        a, b = sm[i], sm[i + 1]
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        if seg <= 0.0:
            continue
        head = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        t = carry
        while t < seg:
            f = t / seg
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, head, max(a[2], b[2])))
            t += step
        carry = t - seg
    return out


def main():
    occ = Occupancy()
    print("census: %s" % dict(load_census(occ)))
    routes = {}
    ring_roads.resample = resample_open
    for pid, bearing in SEAMS.items():
        pts = search(occ, bearing)
        blocked = [p for p in pts if p["level"] == 2]
        length = sum(math.hypot(pts[k]["x"] - pts[k - 1]["x"], pts[k]["y"] - pts[k - 1]["y"]) for k in range(1, len(pts))) / 100.0
        vs = [p["v"] / 100.0 for p in pts]
        print("\n%s seam %g deg: %.0f m from r %.0f to %.0f m, offset %.0f..%.0f m, %d narrow, %d blocked steps"
              % (pid, bearing, length, pts[0]["u"] / 100.0, pts[-1]["u"] / 100.0, min(vs), max(vs),
                 sum(1 for p in pts if p["level"] == 1), len(blocked)))
        for p in blocked[:12]:
            print("   blocked at u %.0f m, v %.0f m by %s" % (p["u"] / 100.0, p["v"] / 100.0, (p["blocker"] or "?")[:70]))
        ring = {"points": [[math.degrees(math.atan2(p["y"], p["x"])) % 360.0, math.hypot(p["x"], p["y"]), p["x"], p["y"],
                            p["level"]] for p in pts],
                "length_m": round(length), "clear_fraction": 1.0 - len(blocked) / float(len(pts)),
                "narrow_fraction": sum(1 for p in pts if p["level"] == 1) / float(len(pts))}
        routes[pid] = {"bearing": bearing, **ring}
        ring_roads.PASSES[pid] = (pid, "%s_seam_way.json" % pid.lower(), "Wonderland/Authored/%s_SeamWay" % pid)
        ring_roads.build(pid, ring, occ)          # adds its own plates, lanterns and trees to occ as it goes
    (HERE / "seam_routes.json").write_text(json.dumps(routes, indent=1), encoding="utf-8")
    print("\nwrote seam_routes.json and the SR specs")


if __name__ == "__main__":
    main()
