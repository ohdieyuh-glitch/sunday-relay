#!/usr/bin/env python3
"""Where is Wonderland still EMPTY? A district-wide audit, not a camera view.

    python3 wonderland/v2/tools/emptiness.py [--cell 400] [--radius 900]

Three passes were spent inside one twenty-metre patch because a camera showed
it. A camera shows what it points at; this grids the WHOLE district and ranks
every empty region by area, so the next hour goes to the biggest hole in the
world rather than the one that happened to be in frame.

A cell is EMPTY when no placement stands within `radius` of its centre. The
report groups empty cells into contiguous regions and prints them largest
first with their centres -- which are the room sites.
"""
import math, os, sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "infra", "build", "hd"))
os.environ.setdefault("WLV2_PASS02", "1"); os.environ.setdefault("WLV2_PASS03", "1")
import layout_v2 as LAYOUT     # noqa: E402

X0, X1, Y0, Y1 = -12000, 12000, -12000, 14000
SKIP = ("garden_lawn", "terrace_platform", "cloud_cumulus_a", "cloud_cumulus_b",
        "cloud_cumulus_c", "cloud_veil", "sky_dome")


def main():
    cell = int(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--cell=")), 400))
    rad = float(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--radius=")), 900))
    pts = [(p["pos"][0], p["pos"][1]) for p in LAYOUT.ALL if p["asset"] not in SKIP]
    nx, ny = (X1 - X0) // cell, (Y1 - Y0) // cell
    # occupancy by stamping each placement's radius, far cheaper than n*m
    near = bytearray(nx * ny)
    for (px, py) in pts:
        i0, i1 = max(0, int((px - rad - X0) // cell)), min(nx - 1, int((px + rad - X0) // cell))
        j0, j1 = max(0, int((py - rad - Y0) // cell)), min(ny - 1, int((py + rad - Y0) // cell))
        for j in range(j0, j1 + 1):
            cy = Y0 + j * cell + cell * 0.5
            for i in range(i0, i1 + 1):
                cx = X0 + i * cell + cell * 0.5
                if (cx - px) ** 2 + (cy - py) ** 2 <= rad * rad:
                    near[j * nx + i] = 1
    seen = bytearray(nx * ny)
    regions = []
    for start in range(nx * ny):
        if near[start] or seen[start]:
            continue
        q = deque([start]); seen[start] = 1; cells = []
        while q:
            c = q.popleft(); cells.append(c)
            i, j = c % nx, c // nx
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ii, jj = i + di, j + dj
                if 0 <= ii < nx and 0 <= jj < ny:
                    k = jj * nx + ii
                    if not seen[k] and not near[k]:
                        seen[k] = 1; q.append(k)
        xs = [X0 + (c % nx) * cell + cell // 2 for c in cells]
        ys = [Y0 + (c // nx) * cell + cell // 2 for c in cells]
        regions.append((len(cells), sum(xs) / len(xs), sum(ys) / len(ys),
                        min(xs), max(xs), min(ys), max(ys)))
    regions.sort(reverse=True)
    area_cell = (cell / 100.0) ** 2
    print("EMPTY REGIONS (no placement within %.0f m), cell %d uu" % (rad / 100.0, cell))
    print("%6s %9s   %-18s %-28s" % ("cells", "area m2", "centre (uu)", "extent x / y (m)"))
    print("-" * 72)
    tot = 0
    for (n, cx, cy, xa, xb, ya, yb) in regions[:16]:
        if n < 3:
            continue
        tot += n
        print("%6d %9.0f   (%6.0f,%6.0f)   %5.0f..%-5.0f  %5.0f..%-5.0f" %
              (n, n * area_cell, cx, cy, xa / 100.0, xb / 100.0, ya / 100.0, yb / 100.0))
    print("\ntotal empty in the top regions: %.0f m2 over %d cells" % (tot * area_cell, tot))
    print("district sampled: %.0f x %.0f m" % ((X1 - X0) / 100.0, (Y1 - Y0) / 100.0))


if __name__ == "__main__":
    main()
