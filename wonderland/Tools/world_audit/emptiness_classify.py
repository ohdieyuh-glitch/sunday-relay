#!/usr/bin/env python3
"""EMPTINESS, CLASSIFIED: every remaining empty region of the disc, labelled with WHY it is empty.

The founder's rule (2026-09-29): every large empty area must be AUTHORED or EXPLICITLY INTENTIONAL, with a
reason -- vista, meadow, plaza, traversal, sightline, landscape composition, gameplay, dramatic negative space.
"Nothing happened to be built there" is not a reason. emptiness.py says where the world isn't; this says what
each empty region IS. The labels are PROPOSALS for a person to confirm on the frames, not verdicts.

Same grid and coverage as emptiness.py: 5 m cells, 9 m reach, structure-only by default; its loader is reused.
A region keeps its cells here, and the classes are tested in order:
  CLEARING           >= 60% of its cells inside a wild-ring clearing circle (the sidecars' groups)
  VISTA              >= 50% of its cells within 40 m of an avenue's axis (the AV01/AV02/AV03 paving, fitted)
  TRAVERSAL_VERGE    >= 60% of its cells within 25 m of road paving (ring roads, avenues, seam ways) -- the open
                     verge a road needs to read as a road
  GARDEN_LAWN        <= 3 ha, inside a fill wedge, and fill groups on at least 3 of 4 sides within 40 m of the
                     region's edge: a meadow enclosed by gardens
  CORE_COMPOSITION   centre inside 400 m: Golden Arrival and the core quarters, CORE's to judge
  UNINTENDED         none of the above
Output: JSON (area by class + every region >= --min-ha with its class and evidence) and a PNG (colour by class).

    python emptiness_classify.py [--census PATH] [--extra CSV.gz ...] [--min-ha 0.5] --json out.json --png out.png
"""
import argparse
import csv
import glob
import gzip
import json
import math
import os
import sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import emptiness as E                                             # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
WEDGES = os.path.join(ROOT, "WorldDesign", "Wedges")
ROAD_PASSES = ("RR01", "RR02", "AV01", "AV02", "AV03", "SR030", "SR150", "CP02", "CP03", "CP04", "CP05")
AVENUES = ("AV01", "AV02", "AV03")
FILL_PREFIX = ("HT", "HN", "HI", "S2")
COLOURS = {"CLEARING": (120, 200, 120), "VISTA": (90, 150, 255), "TRAVERSAL_VERGE": (200, 200, 200),
           "GARDEN_LAWN": (240, 220, 120), "CORE_COMPOSITION": (200, 140, 255), "UNINTENDED": (255, 60, 60)}


def road_points(census):
    """Paving rows of the road passes, and each avenue's axis bearing (the mean bearing of its paving)."""
    pts, av = [], {k: [] for k in AVENUES}
    fills = []
    with gzip.open(census, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            o = r["owner"]
            pre = o.split("_")[0]
            x, y = float(r["x"]), float(r["y"])
            if pre in ROAD_PASSES and any(k in r["mesh"] for k in ("Ground_", "paving", "kerb", "Plate", "plate")):
                pts.append((x, y))
                if pre in AVENUES:
                    av[pre].append((x, y))
            if pre.startswith(FILL_PREFIX) and len(pre) >= 5:
                fills.append((x, y))
    axes = {}
    for k, v in av.items():
        if v:
            sx = sum(math.cos(math.atan2(y, x)) for (x, y) in v)
            sy = sum(math.sin(math.atan2(y, x)) for (x, y) in v)
            axes[k] = math.degrees(math.atan2(sy, sx)) % 360.0
    return pts, axes, fills


def clearings():
    out = []
    for f in glob.glob(os.path.join(WEDGES, "w[int][0-9][0-9][0-9]_walk.json")):
        for g in json.load(open(f, encoding="utf-8"))["groups"]:
            if g["kind"] == "clearing":
                out.append((g["centre"][0], g["centre"][1], g.get("radius", 3000.0)))
    return out


def grid_index(pts, cell=2500.0):
    d = {}
    for p in pts:
        d.setdefault((int(p[0] // cell), int(p[1] // cell)), []).append(p)
    return d, cell


def near(idx, x, y, dist):
    d, cell = idx
    ci, cj = int(x // cell), int(y // cell)
    rng = int(dist // cell) + 1
    for i in range(ci - rng, ci + rng + 1):
        for j in range(cj - rng, cj + rng + 1):
            for (px, py) in d.get((i, j), ()):
                if (px - x) ** 2 + (py - y) ** 2 <= dist * dist:
                    return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", default=E.DEFAULT_CENSUS)
    ap.add_argument("--extra", nargs="*", default=[], help="extra census-format csv.gz of planned rows")
    ap.add_argument("--min-ha", type=float, default=0.5)
    ap.add_argument("--json", required=True)
    ap.add_argument("--png")
    a = ap.parse_args()
    rows, _ = E.load(a.census, True)
    for x in a.extra:
        more, _ = E.load(x, True)
        rows += more
    c, R, reach = 500.0, 148000.0, 900.0
    n = int(math.ceil(2 * R / c))
    x0 = -R
    covered = bytearray(n * n)
    for (x, y, half, _unl) in rows:
        rr = half + reach
        for j in range(max(0, int((y - rr - x0) // c)), min(n - 1, int((y + rr - x0) // c)) + 1):
            cy = x0 + (j + 0.5) * c - y
            for i in range(max(0, int((x - rr - x0) // c)), min(n - 1, int((x + rr - x0) // c)) + 1):
                cx = x0 + (i + 0.5) * c - x
                if cx * cx + cy * cy <= rr * rr:
                    covered[j * n + i] = 1

    def xy(k):
        j, i = divmod(k, n)
        return x0 + (i + 0.5) * c, x0 + (j + 0.5) * c

    inside = bytearray(n * n)
    for k in range(n * n):
        px, py = xy(k)
        if px * px + py * py <= R * R:
            inside[k] = 1
    roads, axes, fills = road_points(a.census)
    ridx, fidx = grid_index(roads), grid_index(fills)
    clear = clearings()
    seen = bytearray(n * n)
    regions, totals = [], {}
    for start in range(n * n):
        if not inside[start] or covered[start] or seen[start]:
            continue
        q, cells = deque([start]), []
        seen[start] = 1
        while q:
            k = q.popleft()
            cells.append(k)
            j, i = divmod(k, n)
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                jj, ii = j + dj, i + di
                if 0 <= jj < n and 0 <= ii < n:
                    kk = jj * n + ii
                    if inside[kk] and not covered[kk] and not seen[kk]:
                        seen[kk] = 1
                        q.append(kk)
        pts = [xy(k) for k in cells]
        area = len(cells) * 25.0
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        m = len(pts)
        f_clear = sum(1 for (x, y) in pts if any((x - a_) ** 2 + (y - b_) ** 2 <= r_ * r_ for (a_, b_, r_) in clear)) / m
        f_vista = 0.0
        for ax in axes.values():
            ux, uy = math.cos(math.radians(ax)), math.sin(math.radians(ax))
            f = sum(1 for (x, y) in pts if abs(-x * uy + y * ux) <= 4000.0 and x * ux + y * uy > 0) / m
            f_vista = max(f_vista, f)
        f_verge = sum(1 for (x, y) in pts if near(ridx, x, y, 2500.0)) / m
        # enclosure: fill rows within 40 m beyond the region's bounding box, on each of 4 sides
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        sides = 0
        for (sx, sy) in (((min(xs) - 2000, cy)), ((max(xs) + 2000, cy)), ((cx, min(ys) - 2000)), ((cx, max(ys) + 2000))):
            if near(fidx, sx, sy, 4000.0):
                sides += 1
        rc = math.hypot(cx, cy)
        if f_clear >= 0.6:
            cls = "CLEARING"
        elif f_vista >= 0.5:
            cls = "VISTA"
        elif f_verge >= 0.6:
            cls = "TRAVERSAL_VERGE"
        elif area <= 30000.0 and sides >= 3:
            cls = "GARDEN_LAWN"
        elif rc < 40000.0:
            cls = "CORE_COMPOSITION"
        else:
            cls = "UNINTENDED"
        totals[cls] = totals.get(cls, 0.0) + area
        if area >= a.min_ha * 1e4:
            regions.append({"class": cls, "area_ha": round(area / 1e4, 2), "centre_uu": [round(cx), round(cy)],
                            "bearing_deg": round(E.bearing(cx, cy)), "centre_radius_m": round(rc / 100),
                            "zone": E.zone(cx, cy),
                            "evidence": {"clearing": round(f_clear, 2), "vista": round(f_vista, 2),
                                         "verge": round(f_verge, 2), "enclosed_sides": sides}})
        for k in cells:
            seen[k] = 2 + list(COLOURS).index(cls)
    regions.sort(key=lambda r: -r["area_ha"])
    empty = sum(totals.values())
    out = {"census": a.census, "extra": a.extra, "empty_m2": round(empty),
           "by_class_m2": {k: round(v) for k, v in sorted(totals.items(), key=lambda kv: -kv[1])},
           "by_class_pct_of_empty": {k: round(100 * v / empty, 1) for k, v in totals.items()},
           "avenue_axes_deg": {k: round(v, 1) for k, v in axes.items()},
           "regions": regions}
    json.dump(out, open(a.json, "w"), indent=1)
    if a.png:
        step = 2
        w = n // step
        px = bytearray()
        for jj in range(w - 1, -1, -1):
            px.append(0)
            for ii in range(w):
                k = (jj * step) * n + ii * step
                if not inside[k]:
                    px += bytes((12, 12, 12))
                elif covered[k]:
                    px += bytes((40, 60, 40))
                else:
                    px += bytes(COLOURS[list(COLOURS)[seen[k] - 2]] if seen[k] >= 2 else (255, 255, 255))
        E.write_png(a.png, w, w, bytes(px))
    print(json.dumps({k: v for k, v in out.items() if k != "regions"}, indent=1))
    for r in regions[:25]:
        print("  %-17s %5.2f ha  bearing %3d  r %4d m  %s  %s" % (r["class"], r["area_ha"], r["bearing_deg"],
                                                               r["centre_radius_m"], r["zone"], r["evidence"]))


if __name__ == "__main__":
    main()
