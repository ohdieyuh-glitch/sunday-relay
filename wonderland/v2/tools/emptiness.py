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

THE WINDOW IS PART OF THE MEASUREMENT. This sampled +/- 120 m of a world
that reaches 450 m, so it reported 4,832 m2 empty while 37 HECTARES sat
outside its own frame -- the identical failure it was written to catch, one
level up. `--window=` now names it, and the default covers the whole
walkable world. `--window=district` restores the +/- 120 m view so the
numbers this tool has already published stay comparable.
"""
import math, os, sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "infra", "build", "hd"))
os.environ.setdefault("WLV2_PASS02", "1"); os.environ.setdefault("WLV2_PASS03", "1")
import layout_v2 as LAYOUT     # noqa: E402

#: uu. `world` is the ground a walker can reach; `district` is the old frame.
WINDOWS = {"world": (-36000, 36000, -36000, 40000),
           "district": (-12000, 12000, -12000, 14000)}
X0, X1, Y0, Y1 = WINDOWS["world"]
SKIP = ("garden_lawn", "terrace_platform", "cloud_cumulus_a", "cloud_cumulus_b",
        "cloud_cumulus_c", "cloud_veil", "sky_dome")


def main():
    global X0, X1, Y0, Y1
    cell = int(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--cell=")), 400))
    rad = float(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--radius=")), 900))
    win = next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--window=")), "world")
    if win in WINDOWS:
        X0, X1, Y0, Y1 = WINDOWS[win]
    else:
        X0, X1, Y0, Y1 = [int(v) for v in win.split(",")]
    scaled = "--scaled" in sys.argv
    pts = [(p["pos"][0], p["pos"][1]) for p in LAYOUT.ALL if p["asset"] not in SKIP]
    nx, ny = (X1 - X0) // cell, (Y1 - Y0) // cell
    # HOW MUCH EMPTINESS IS CORRECT DEPENDS ON WHERE YOU ARE.
    #
    # One radius for the whole world is a demand that the atmospheric distance
    # be as full as the plaza. Measured at a flat 9 m the world reports 46
    # hectares empty and always will, because 46 hectares of open country is
    # what a horizon IS -- and answering that by filling it would destroy the
    # hierarchy this measurement exists to protect.
    #
    # `--scaled` takes the radius from `layout_v2.HIER(x, y)["empty_tol"]`,
    # the SAME function the generator derives its densities from: 9 m in the
    # core, 55 m at the horizon. A region reported under --scaled is empty by
    # the standard of its own tier, which is the only version of this question
    # worth asking of a world with a hierarchy in it.
    tol = None
    if scaled:
        tol = [0.0] * (nx * ny)
        for j in range(ny):
            cy = Y0 + j * cell + cell * 0.5
            for i in range(nx):
                cx = X0 + i * cell + cell * 0.5
                tol[j * nx + i] = LAYOUT.HIER(cx, cy)["empty_tol"]
    # occupancy by stamping each placement's radius, far cheaper than n*m
    near = bytearray(nx * ny)
    stamp = max(rad, max(tol) if tol else rad)
    for (px, py) in pts:
        i0, i1 = max(0, int((px - stamp - X0) // cell)), min(nx - 1, int((px + stamp - X0) // cell))
        j0, j1 = max(0, int((py - stamp - Y0) // cell)), min(ny - 1, int((py + stamp - Y0) // cell))
        for j in range(j0, j1 + 1):
            cy = Y0 + j * cell + cell * 0.5
            for i in range(i0, i1 + 1):
                cx = X0 + i * cell + cell * 0.5
                r = tol[j * nx + i] if tol else rad
                if (cx - px) ** 2 + (cy - py) ** 2 <= r * r:
                    near[j * nx + i] = 1
    # THE WORLD IS A DISC AND THE WINDOW WAS A SQUARE. At +/- 360 m the
    # corners of the frame sit at 509 m -- past the far arc at 340 m and past
    # the approved city band at 450 m -- so four of the six largest "empty"
    # regions were ground the world was never meant to reach, and reporting
    # them as holes would have sent the next pass building outside its own
    # horizon. Cells beyond `--rmax` are not sampled at all.
    rmax = float(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--rmax=")), 36000))
    outside = 0
    seen = bytearray(nx * ny)
    for j in range(ny):
        cy = Y0 + j * cell + cell * 0.5
        for i in range(nx):
            cx = X0 + i * cell + cell * 0.5
            if cx * cx + cy * cy > rmax * rmax:
                seen[j * nx + i] = 1
                outside += 1
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
    print("EMPTY REGIONS (%s), cell %d uu, window %s"
          % ("no placement within the tier's own tolerance, 9-55 m" if scaled
             else "no placement within %.0f m" % (rad / 100.0), cell, win))
    print("%6s %9s   %-18s %-28s" % ("cells", "area m2", "centre (uu)", "extent x / y (m)"))
    print("-" * 72)
    tot = 0
    for (n, cx, cy, xa, xb, ya, yb) in regions[:16]:
        if n < 3:
            continue
        tot += n
        # A HOLE ON PURPOSE IS NOT A HOLE. The castle sightline is kept clear
        # at every radius -- approved composition since PASS 06/07 -- so the
        # ground up the axis reports as the largest empty region in the world
        # and always will. Saying so here is the difference between a backlog
        # item and a later pass helpfully filling in the founder's sky.
        note = ""
        if (math.hypot(cx, cy) > 15000.0
                and abs((math.degrees(math.atan2(cy, cx)) - 90.0 + 180.0) % 360.0 - 180.0)
                < getattr(LAYOUT, "_AXIS_KEEP_OUT", 15.0) + 6.0):
            note = "   <- castle sightline, deliberate"
        print("%6d %9.0f   (%6.0f,%6.0f)   %5.0f..%-5.0f  %5.0f..%-5.0f%s" %
              (n, n * area_cell, cx, cy, xa / 100.0, xb / 100.0, ya / 100.0, yb / 100.0, note))
    print("\ntotal empty in the top regions: %.0f m2 over %d cells" % (tot * area_cell, tot))
    print("region count: %d over 3 cells; %d in all" % (sum(1 for r in regions if r[0] >= 3), len(regions)))
    inside = nx * ny - outside
    print("window sampled: %.0f x %.0f m clipped to r <= %.0f m -- %d cells (%.1f ha)"
          % ((X1 - X0) / 100.0, (Y1 - Y0) / 100.0, rmax / 100.0, inside,
             inside * area_cell / 1e4))


if __name__ == "__main__":
    main()
