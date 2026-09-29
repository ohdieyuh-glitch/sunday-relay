#!/usr/bin/env python3
"""WHY IS IT EMPTY? Every empty 5 m cell of the structure-only emptiness audit, classified by what the design
declares there -- the founder's seven classes (2026-09-29): "We finish Wonderland by eliminating unexplained
emptiness, not by covering every square metre with objects."

    python Tools/world_audit/emptiness_classes.py [--json out.json] [--png out.png] [--top 20]

Same raster as emptiness.py --structure (5 m cells, 9 m reach, 1,480 m disc, the census at
Tools/captures/zc/census/world_census.csv.gz). An EMPTY cell takes the first class whose declared feature covers it:
  6 LANDSCAPE / FOREST CLEARING  inside a declared clearing: DF01's CLEARINGS, and every "clearing" group in the
                                 wild ring's walk sidecars (WorldDesign/Wedges/w[int]*_walk.json); and FOREST FLOOR,
                                 within 15 m of a Dubel or wild-ring trunk (checked after vistas and ways)
  3 INTENTIONAL VISTA            the Golden Arrival axis and the three avenues' sightlines (+/-25 m of 90 / 210 / 330
                                 deg, 0-1,200 m), and each checkpoint's ceremonial ground: its paving + 30 m (CP01-05;
                                 the planners reserve the same, sector_fill2.vista_blocks)
  5 TRAVERSAL SPACE              within 20 m of a way: ring and seam plates, avenue plates, the heartland / fill /
                                 wild-ring walks (sidecars), Dubel's walk and the gate walks
  4 PLAZA / COURT                inside a paved footprint wider than the 9 m reach (a plaza's middle)
  2 INTENTIONAL MEADOW           a heartland's own lawn: inside its declared wedge (sector_fill.REGIONS) AND within
                                 40 m of that heartland's placements -- lawn beside its rooms and walks, not the
                                 unreached middle of an empty wedge
  7 OTHER JUSTIFIED              the world's rim apron beyond 1,460 m
  1 UNINTENDED EMPTY             none of the above
The largest UNINTENDED regions are listed first: those are what gets built next.

ONLY WHAT IS BUILT COUNTS. A planner writes its walk sidecar when it PLANS a pass, so Wedges/ holds the walks of passes
that are staged, or never applied. A sidecar (and a checkpoint spec) counts only when its pass id is an owner prefix in
the census being measured. Before this rule the 38 staged S3 walks were credited as traversal: post-4a UNINTENDED read
11.3 % against 12.0 % built (2026-09-29). A projected census carries its passes' rows, so projections still count them.
"""
import argparse
import glob
import json
import math
import os
import sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
WD = os.path.join(ROOT, "WorldDesign")
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(WD, "Wedges"))
sys.path.insert(0, os.path.join(WD, "Districts"))
import emptiness as E                                                     # noqa: E402

CLASSES = {1: "UNINTENDED EMPTY", 2: "INTENTIONAL MEADOW", 3: "INTENTIONAL VISTA", 4: "PLAZA/COURT",
           5: "TRAVERSAL SPACE", 6: "LANDSCAPE/FOREST CLEARING", 7: "OTHER JUSTIFIED"}
COLORS = {0: (40, 44, 52), 1: (230, 60, 60), 2: (120, 200, 90), 3: (90, 160, 240), 4: (220, 200, 150),
          5: (240, 190, 60), 6: (40, 130, 70), 7: (130, 130, 140)}


def spec_points(path, id_has=None):
    s = json.load(open(path, encoding="utf-8"))
    out = []
    for b in s.get("batches", []):
        if id_has and not any(h in b["id"] for h in id_has):
            continue
        out += [(i[0], i[1]) for i in b["instances"]]
    return out


CEREMONY_MARGIN = 3000.0        # cm of ceremonial ground beyond a checkpoint's paving


def census_passes(census):
    """The owner prefixes the census holds: the passes that are BUILT (or, in a projected census, projected)."""
    import csv
    import gzip
    out = set()
    with gzip.open(census, "rt", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            out.add(r["owner"].split("_")[0].upper())
    return out


def sidecar_pass(path):
    """wn210_walk.json -> WN210, s3n232_walk.json -> S3N232"""
    return os.path.basename(path).split("_")[0].upper()


def classify(census=E.DEFAULT_CENSUS):
    """The classified raster: {n, x0, C, cls (bytearray, 0 = covered/outside, else a CLASSES key), covered, R2}.
    Shared with the generators that build on the UNINTENDED cells (TW03)."""
    C, REACH, RAD = 500.0, 900.0, 148000.0
    n = int(math.ceil(2 * RAD / C))
    x0 = -RAD
    rows, _dropped = E.load(census, True)
    built = census_passes(census)
    covered = bytearray(n * n)

    def stamp(grid, x, y, r, val=1, only_zero=False):
        i0, i1 = max(0, int((x - r - x0) // C)), min(n - 1, int((x + r - x0) // C))
        j0, j1 = max(0, int((y - r - x0) // C)), min(n - 1, int((y + r - x0) // C))
        r2 = r * r
        for j in range(j0, j1 + 1):
            cy = x0 + (j + 0.5) * C - y
            for i in range(i0, i1 + 1):
                cx = x0 + (i + 0.5) * C - x
                if cx * cx + cy * cy <= r2:
                    k = j * n + i
                    if not only_zero or grid[k] == 0:
                        grid[k] = val

    for (x, y, half, _unl) in rows:
        stamp(covered, x, y, half + REACH)
    cls = bytearray(n * n)            # 0 = not empty / outside

    def mark(val, x, y, r):
        """claim empty, still-unclassified cells within r of (x, y) for class val"""
        i0, i1 = max(0, int((x - r - x0) // C)), min(n - 1, int((x + r - x0) // C))
        j0, j1 = max(0, int((y - r - x0) // C)), min(n - 1, int((y + r - x0) // C))
        r2 = r * r
        for j in range(j0, j1 + 1):
            cy = x0 + (j + 0.5) * C - y
            for i in range(i0, i1 + 1):
                cx = x0 + (i + 0.5) * C - x
                k = j * n + i
                if cls[k] == 255 and cx * cx + cy * cy <= r2:
                    cls[k] = val

    R2 = RAD * RAD
    for j in range(n):
        cy = x0 + (j + 0.5) * C
        for i in range(n):
            cx = x0 + (i + 0.5) * C
            if cx * cx + cy * cy <= R2 and not covered[j * n + i]:
                cls[j * n + i] = 255                        # empty, unclassified
    # 6 CLEARINGS
    import dubel_forest as DF
    for (cx, cy, cr) in DF.CLEARINGS:
        mark(6, cx, cy, cr)
    for f in glob.glob(os.path.join(WD, "Wedges", "w[int]*_walk.json")):
        if sidecar_pass(f) not in built:
            continue
        for g in json.load(open(f, encoding="utf-8")).get("groups", []):
            if g.get("kind") == "clearing":
                mark(6, g["centre"][0], g["centre"][1], g["radius"])
    # 3 VISTAS: the axis and avenue sightlines, and the checkpoints' ceremonial ground
    for b in (90.0, 210.0, 330.0):
        t = math.radians(b)
        for d in range(0, 120001, 400):
            mark(3, d * math.cos(t), d * math.sin(t), 2500.0)
    for f in sorted(glob.glob(os.path.join(WD, "Districts", "cp0*_*_checkpoint.json"))):
        if "CP" + os.path.basename(f)[2:4] not in built:
            continue
        pts = spec_points(f)
        if pts:
            cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            mark(3, cx, cy, max(math.hypot(x - cx, y - cy) for (x, y) in pts) + CEREMONY_MARGIN)
    # 5 TRAVERSAL: 20 m of every way
    ways = []
    for f in ("Rings/rr01_march_ring.json", "Rings/rr02_outer_ring.json", "Rings/sr030_seam_way.json",
              "Rings/sr150_seam_way.json", "Nations/av01_icarus_avenue.json", "Nations/av02_noctis_avenue.json",
              "Nations/av03_tartarus_avenue.json", "Wedges/w270s_seam_way.json"):
        p = os.path.join(WD, f)
        if os.path.exists(p):
            ways += spec_points(p, ("Plate", "Flagstone", "Plaza", "Kerb"))[::2]
    for f in glob.glob(os.path.join(WD, "Wedges", "*_walk.json")):
        if sidecar_pass(f) not in built:
            continue
        ways += [tuple(q[:2]) for q in json.load(open(f, encoding="utf-8")).get("walk", [])]
    for f in ("Districts/dw01_dubel_walk.json", "Rings/hg2a_hedge_gates.json", "Rings/sx01_seam_bypass.json"):
        p = os.path.join(WD, f)
        if os.path.exists(p):
            ways += spec_points(p, ("paving_t",))
    for (x, y) in ways:
        mark(5, x, y, 2000.0)
    # 4 PLAZA / COURT: the middles of wide paved footprints (surfaces the census lists wider than the reach)
    import csv
    import gzip
    forest = []
    with gzip.open(census, "rt", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["kind"] == "OTHER":
                continue
            m = r["mesh"]
            # FOREST FLOOR: the ground between a forest's trees is the forest, not a gap in the world. Within 15 m of
            # a Dubel (DF01) or wild-ring (WI / WN / WT) trunk -> class 6 with the clearings.
            if ("trunk" in m.lower() or "canopy" in m.lower()) and r["owner"][:2] in ("DF", "WI", "WN", "WT"):
                forest.append((float(r["x"]), float(r["y"])))
            if any(w in m for w in ("Plaza", "plaza_slab", "terrace_platform", "Flagstone")):
                ex, ey = float(r["ex"]), float(r["ey"])
                if min(ex, ey) > REACH:
                    mark(4, float(r["x"]), float(r["y"]), min(ex, ey))
    for (x, y) in forest:
        mark(6, x, y, 1500.0)
    # 2 MEADOW: a heartland's lawn near its own placements, inside its declared wedge
    import sector_fill as SF
    for pid, reg in SF.REGIONS.items():
        spec = os.path.join(WD, "Wedges", "%s_%s_heartland.json" % (pid.lower(), {"HN": "noctis", "HT": "tartarus",
                                                                                   "HI": "icarus"}[pid[:2]]))
        if not os.path.exists(spec):
            continue
        pts = spec_points(spec)
        for (x, y) in pts[::3]:
            b = math.degrees(math.atan2(y, x)) % 360.0
            if abs(((b - reg["bearing"]) + 180.0) % 360.0 - 180.0) <= reg["half"] and \
                    reg["r"][0] <= math.hypot(x, y) <= reg["r"][1]:
                mark(2, x, y, 4000.0)
    # 7 THE RIM APRON
    for j in range(n):
        for i in range(n):
            k = j * n + i
            if cls[k] == 255 and math.hypot(x0 + (i + 0.5) * C, x0 + (j + 0.5) * C) > 146000.0:
                cls[k] = 7
    for k in range(n * n):
        if cls[k] == 255:
            cls[k] = 1
    return {"n": n, "x0": x0, "C": C, "cls": cls, "covered": covered, "R2": R2}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", default=E.DEFAULT_CENSUS)
    ap.add_argument("--json")
    ap.add_argument("--png")
    ap.add_argument("--top", type=int, default=20)
    a = ap.parse_args()
    g = classify(a.census)
    n, x0, C, cls, covered, R2 = g["n"], g["x0"], g["C"], g["cls"], g["covered"], g["R2"]
    cell_m2 = (C / 100.0) ** 2
    tot = {CLASSES[v]: round(sum(1 for k in range(n * n) if cls[k] == v) * cell_m2) for v in CLASSES}
    disc = round(sum(1 for j in range(n) for i in range(n)
                     if (x0 + (i + 0.5) * C) ** 2 + (x0 + (j + 0.5) * C) ** 2 <= R2) * cell_m2)
    empty = sum(tot.values())
    # the largest UNINTENDED regions
    seen = bytearray(n * n)
    regions = []
    for s in range(n * n):
        if cls[s] != 1 or seen[s]:
            continue
        q, cells = deque([s]), []
        seen[s] = 1
        while q:
            k = q.popleft()
            cells.append(k)
            j, i = divmod(k, n)
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                jj, ii = j + dj, i + di
                if 0 <= jj < n and 0 <= ii < n:
                    kk = jj * n + ii
                    if cls[kk] == 1 and not seen[kk]:
                        seen[kk] = 1
                        q.append(kk)
        sx = sum(k % n for k in cells) / len(cells)
        sy = sum(k // n for k in cells) / len(cells)
        cx, cy = x0 + (sx + 0.5) * C, x0 + (sy + 0.5) * C
        rad = [math.hypot(x0 + ((k % n) + 0.5) * C, x0 + ((k // n) + 0.5) * C) / 100.0 for k in cells]
        regions.append({"area_m2": round(len(cells) * cell_m2), "centre_uu": [round(cx), round(cy)],
                        "bearing_deg": round(E.bearing(cx, cy)), "centre_radius_m": round(math.hypot(cx, cy) / 100.0),
                        "radius_span_m": [round(min(rad)), round(max(rad))], "zone": E.zone(cx, cy)})
    regions.sort(key=lambda r: -r["area_m2"])
    out = {"census": os.path.abspath(a.census), "disc_m2": disc, "empty_m2": empty,
           "empty_pct": round(100.0 * empty / disc, 1),
           "by_class_m2": tot, "by_class_pct_of_disc": {k: round(100.0 * v / disc, 1) for k, v in tot.items()},
           "unintended_pct_of_disc": round(100.0 * tot[CLASSES[1]] / disc, 1),
           "unintended_regions_top": regions[:a.top], "unintended_regions_total": len(regions)}
    if a.png:
        px = bytearray(n * n * 3)
        for j in range(n):
            for i in range(n):
                k = j * n + i
                v = cls[k] if cls[k] else (0 if covered[k] else 0)
                col = COLORS[v] if cls[k] else ((70, 74, 84) if covered[k] else (20, 20, 24))
                kk = ((n - 1 - j) * n + i) * 3
                px[kk:kk + 3] = bytes(col)
        E.write_png(a.png, n, n, px)
        out["png"] = a.png
    s = json.dumps(out, indent=1)
    if a.json:
        open(a.json, "w", encoding="utf-8").write(s)
    print(s[:3000])


if __name__ == "__main__":
    main()
