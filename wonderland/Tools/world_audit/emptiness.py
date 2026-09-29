#!/usr/bin/env python3
"""Where is the SHIPPING Wonderland world still empty? The forge's emptiness audit, run on the real map.

    python emptiness.py [--census PATH] [--cell 500] [--reach 900] [--png out.png] [--json out.json]
                        [--structure]  [--wedge BEAR0,BEAR1,R0,R1]

WHY THIS EXISTS. The forge's `v2/tools/emptiness.py` found 461,488 m2 of empty ground that no camera had shown
("a camera shows what it points at; only an audit shows where the world is not"). But it reads the forge's
Blender layout inside a +/-360 m window, and the shipping map is a ~1,480 m disc with three nations. This is
the same method on the Unreal world's own population: the census written by the editor job
`zc_world_census` (every StaticMeshActor and ISM instance, with a footprint from the mesh's bounds).

THE METHOD, unchanged from the forge: grid the disc; a cell is COVERED when some placement's footprint,
grown by `reach`, covers the cell centre; the uncovered cells are grouped into contiguous regions and ranked
largest first, with their centres -- which are where the next work goes.

WHAT IS NOT COVERAGE, each learned elsewhere in this project and each a way to fool the audit:
  - SINK_UU trims (z < -50,000) are deliberately hidden content, not world.
  - Sky: clouds, sky domes and anything floating more than SKY_Z above the ground plane.
  - GROUND PLATES: a flat piece wider than 50 m is the floor itself; counting it would mark everything
    it underlies as covered, which is exactly the kind of silent pass a coverage audit must not have.
  - OTHER rows (lights, volumes, anchors) carry no footprint.
  - With --structure, ground cover (grass tufts, moss, lawn, clover) is dropped as well, so a field of
    tufts reads as the empty land it looks like from a camera.

It is a REPORT, not a gate: empty ground is allowed when it is intentional (a plaza, a vista, DF01's
clearings). The report names where each region is (nation zone, bearing, ring) so the question "WHY is
this empty?" can be asked of every large one.
"""
import argparse
import csv
import gzip
import json
import math
import os
import struct
import sys
import zlib
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "WorldDesign"))
try:
    import nations                                                   # noqa: E402
except Exception:                                                     # noqa: BLE001
    nations = None

DEFAULT_CENSUS = os.path.join(HERE, "..", "captures", "zc", "census", "world_census.csv.gz")
SINK_Z = -50000.0
SKY_Z = 6000.0                 # uu above 0: clouds, islands, balloons -- not ground coverage
PLATE_HALF = 5000.0            # a flat piece wider than 100 m is floor, not content
PLATE_HEIGHT = 300.0
SKY_WORDS = ("cloud", "sky_dome", "skydome", "skysphere", "sky_island", "balloon")
COVER_WORDS = ("grass_tuft", "tuft", "moss", "lawn", "clover", "groundcover", "ground_cover")


def load(path, structure_only):
    rows, dropped = [], {"sink": 0, "sky": 0, "plate": 0, "other": 0, "cover": 0}
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            kind = r["kind"]
            if kind == "OTHER":
                dropped["other"] += 1
                continue
            # THE HIDDEN REFERENCE SCAFFOLD (VISUAL_AUTHORITY.md) is not world: one 205 x 313 m box at the origin whose
            # 156 m half-extent + reach covered every cell within ~165 m, so the audit could not see the core at all
            # (found 2026-09-29 while routing Golden Arrival; the placement and walk occupancies skip it too)
            if r.get("owner") == "V2_MarbleWorld_Scaffold":
                dropped["hidden"] = dropped.get("hidden", 0) + 1
                continue
            # THE INVISIBLE WORLD-EDGE RING (EDGE01, window 4a): 48 hidden pawn-only wall segments, 198 m long. As
            # discs of their half-length + reach they "covered" a ~110 m band inside the rim that is forest floor,
            # clearing or bare -- an invisible wall is not world content
            if r.get("owner", "").startswith("EDGE01"):
                dropped["hidden"] = dropped.get("hidden", 0) + 1
                continue
            x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
            ex, ey, ez = float(r["ex"]), float(r["ey"]), float(r["ez"])
            name = r["mesh"].lower()
            if z < SINK_Z:
                dropped["sink"] += 1
                continue
            if z > SKY_Z or any(w in name for w in SKY_WORDS):
                dropped["sky"] += 1
                continue
            if max(ex, ey) > PLATE_HALF and ez < PLATE_HEIGHT:
                dropped["plate"] += 1
                continue
            if structure_only and any(w in name for w in COVER_WORDS):
                dropped["cover"] += 1
                continue
            rows.append((x, y, max(ex, ey), kind == "UNLOADED"))
    return rows, dropped


def zone(x, y):
    """`nations.zone_at` answers a (nation, band) TUPLE such as ('TARTARUS', 'heartland'), not a string."""
    if nations is None:
        return "?"
    try:
        z = nations.zone_at(x, y)
    except Exception:                                                  # noqa: BLE001
        return "?"
    if isinstance(z, (tuple, list)):
        return "/".join(str(p) for p in z if p)
    return str(z).replace("WL_NATION_", "")


def bearing(x, y):
    return math.degrees(math.atan2(y, x)) % 360.0


def write_png(path, w, h, pixels):
    """Pure-python RGB PNG: `pixels` is a bytes-like of w*h*3."""
    raw = b"".join(b"\x00" + bytes(pixels[y * w * 3:(y + 1) * w * 3]) for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", default=DEFAULT_CENSUS)
    ap.add_argument("--cell", type=float, default=500.0, help="uu per grid cell (default 5 m)")
    ap.add_argument("--reach", type=float, default=900.0, help="uu a placement covers beyond its footprint")
    ap.add_argument("--radius", type=float, default=148000.0, help="uu: the walkable disc")
    ap.add_argument("--frontier", type=float, default=120000.0, help="uu: built world vs wilderness belt")
    ap.add_argument("--structure", action="store_true", help="ignore ground cover (grass, moss, lawn)")
    ap.add_argument("--png")
    ap.add_argument("--json")
    ap.add_argument("--wedge", help="BEAR0,BEAR1,R0_M,R1_M: report a sector on its own (degrees, metres)")
    ap.add_argument("--top", type=int, default=25)
    a = ap.parse_args()

    rows, dropped = load(a.census, a.structure)
    c = a.cell
    n = int(math.ceil(2 * a.radius / c))
    x0 = y0 = -a.radius
    covered = bytearray(n * n)
    unloaded_cover = bytearray(n * n)
    for (x, y, half, unl) in rows:
        rr = half + a.reach
        i0 = max(0, int((x - rr - x0) // c))
        i1 = min(n - 1, int((x + rr - x0) // c))
        j0 = max(0, int((y - rr - y0) // c))
        j1 = min(n - 1, int((y + rr - y0) // c))
        rr2 = rr * rr
        for j in range(j0, j1 + 1):
            cy = y0 + (j + 0.5) * c - y
            cy2 = cy * cy
            base = j * n
            for i in range(i0, i1 + 1):
                cx = x0 + (i + 0.5) * c - x
                if cx * cx + cy2 <= rr2:
                    covered[base + i] = 1
                    if unl:
                        unloaded_cover[base + i] = 1

    inside = bytearray(n * n)
    R2 = a.radius * a.radius
    for j in range(n):
        cy = y0 + (j + 0.5) * c
        for i in range(n):
            cx = x0 + (i + 0.5) * c
            if cx * cx + cy * cy <= R2:
                inside[j * n + i] = 1

    # ---- CONTIGUOUS EMPTY REGIONS, largest first.
    seen = bytearray(n * n)
    regions = []
    cell_m2 = (c / 100.0) ** 2
    for start in range(n * n):
        if not inside[start] or covered[start] or seen[start]:
            continue
        q = deque([start])
        seen[start] = 1
        cells = []
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
        sx = sum((k % n) for k in cells) / len(cells)
        sy = sum((k // n) for k in cells) / len(cells)
        cx, cy = x0 + (sx + 0.5) * c, y0 + (sy + 0.5) * c
        rad = [math.hypot(x0 + ((k % n) + 0.5) * c, y0 + ((k // n) + 0.5) * c) for k in cells]
        inner = sum(1 for r in rad if r <= a.frontier)
        regions.append({
            "area_m2": round(len(cells) * cell_m2),
            "built_world_m2": round(inner * cell_m2),
            "centre_uu": [round(cx), round(cy)],
            "centre_radius_m": round(math.hypot(cx, cy) / 100.0),
            "bearing_deg": round(bearing(cx, cy)),
            "zone": zone(cx, cy),
            "radius_span_m": [round(min(rad) / 100.0), round(max(rad) / 100.0)],
        })
    regions.sort(key=lambda r: -r["built_world_m2"])

    tot_in = sum(inside)
    tot_empty = sum(1 for k in range(n * n) if inside[k] and not covered[k])
    ring_cnt, ring_emp = {}, {}
    for k in range(n * n):
        if not inside[k]:
            continue
        j, i = divmod(k, n)
        r0 = int(math.hypot(x0 + (i + 0.5) * c, y0 + (j + 0.5) * c) / 100.0) // 100 * 100
        ring_cnt[r0] = ring_cnt.get(r0, 0) + 1
        if not covered[k]:
            ring_emp[r0] = ring_emp.get(r0, 0) + 1
    rings = [{"ring_m": [r0, r0 + 100], "empty_pct": round(100.0 * ring_emp.get(r0, 0) / ring_cnt[r0], 1),
              "empty_m2": round(ring_emp.get(r0, 0) * cell_m2)} for r0 in sorted(ring_cnt)]

    # ---- EMPTY BY SECTOR AND RING. Where empty ground connects all the way round the disc, "the largest
    # region" is one annulus and names nothing. A 30-degree x 100 m table maps straight onto assignments.
    sec_cnt, sec_emp = {}, {}
    for k in range(n * n):
        if not inside[k]:
            continue
        j, i = divmod(k, n)
        px_, py_ = x0 + (i + 0.5) * c, y0 + (j + 0.5) * c
        key = (int(bearing(px_, py_) // 30) * 30, int(math.hypot(px_, py_) / 100.0) // 100 * 100)
        sec_cnt[key] = sec_cnt.get(key, 0) + 1
        if not covered[k]:
            sec_emp[key] = sec_emp.get(key, 0) + 1
    sectors = []
    for (b0, r0) in sorted(sec_cnt):
        mid = math.radians(b0 + 15.0)
        rm = (r0 + 50.0) * 100.0
        sectors.append({"bearing": [b0, b0 + 30], "ring_m": [r0, r0 + 100],
                        "zone": zone(rm * math.cos(mid), rm * math.sin(mid)),
                        "empty_pct": round(100.0 * sec_emp.get((b0, r0), 0) / sec_cnt[(b0, r0)], 1),
                        "empty_m2": round(sec_emp.get((b0, r0), 0) * cell_m2)})

    out = {
        "census": os.path.abspath(a.census), "placements_used": len(rows), "dropped": dropped,
        "sectors": sectors,
        "cell_m": c / 100.0, "reach_m": a.reach / 100.0, "structure_only": a.structure,
        "disc_m2": round(tot_in * cell_m2), "empty_m2": round(tot_empty * cell_m2),
        "empty_pct": round(100.0 * tot_empty / max(1, tot_in), 1),
        "covered_only_by_unloaded_descriptors_m2": round(sum(unloaded_cover) * cell_m2),
        "rings": rings, "regions_top": regions[:a.top], "regions_total": len(regions),
    }

    if a.wedge:
        b0, b1, r0, r1 = (float(v) for v in a.wedge.split(","))
        cnt = emp = 0
        for k in range(n * n):
            j, i = divmod(k, n)
            px, py = x0 + (i + 0.5) * c, y0 + (j + 0.5) * c
            rm = math.hypot(px, py) / 100.0
            b = bearing(px, py)
            inb = (b0 <= b <= b1) if b0 <= b1 else (b >= b0 or b <= b1)
            if inb and r0 <= rm <= r1:
                cnt += 1
                if not covered[k]:
                    emp += 1
        out["wedge"] = {"bearing": [b0, b1], "radius_m": [r0, r1], "area_m2": round(cnt * cell_m2),
                        "empty_m2": round(emp * cell_m2), "empty_pct": round(100.0 * emp / max(1, cnt), 1)}

    if a.png:
        # One pixel per cell, north (+Y) up. Covered = stone; empty inside the frontier = red; empty in the
        # wilderness belt = dim red; outside the disc = dark; rings every 200 m and the three nation lines.
        px = bytearray(n * n * 3)
        for j in range(n):
            for i in range(n):
                k = j * n + i
                o = ((n - 1 - j) * n + i) * 3
                if not inside[k]:
                    col = (18, 20, 26)
                elif covered[k]:
                    col = (196, 188, 170) if not unloaded_cover[k] else (150, 170, 196)
                else:
                    rm = math.hypot(x0 + (i + 0.5) * c, y0 + (j + 0.5) * c)
                    col = (214, 46, 46) if rm <= a.frontier else (120, 40, 44)
                px[o:o + 3] = bytes(col)
        for j in range(n):
            for i in range(n):
                wx, wy = x0 + (i + 0.5) * c, y0 + (j + 0.5) * c
                rm = math.hypot(wx, wy)
                o = ((n - 1 - j) * n + i) * 3
                if abs(rm % 20000.0) < c * 0.5 and rm > 1000:
                    px[o:o + 3] = bytes((60, 90, 140))
                b = bearing(wx, wy)
                if rm > 50000 and any(abs(((b - L + 180) % 360) - 180) < (c / max(rm, 1.0)) * 57.3
                                      for L in (30.0, 150.0, 270.0)):
                    px[o:o + 3] = bytes((250, 210, 60))
        write_png(a.png, n, n, px)
        out["png"] = os.path.abspath(a.png)

    text = json.dumps(out, indent=1)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)


if __name__ == "__main__":
    main()
