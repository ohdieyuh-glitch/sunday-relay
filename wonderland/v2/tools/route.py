#!/usr/bin/env python3
"""Solve a WALKABLE tour of the whole world and emit it as route legs.

    python3 wonderland/v2/tools/route.py [--cell 100] [--capsule 60] [--cpp]

The founder's instruction is that the Relay Dog must walk this world -- Golden
Arrival, the castle corridor, the outer road, a garden quarter, the mushroom
wood, the tower court, the hamlet, and home -- and that where a route does not
work, THE WORLD is repaired rather than the Dog.

Hand-placed waypoints do not survive that. Two of them have already been found
inside planting, each costing a capture: the Dog reaches the hedge, the arrival
tolerance is never met, and the take films leaves. So the waypoints are solved
against the same obstacle model `walkable.py` audits with, and a leg that
cannot be solved is REPORTED as a world defect instead of being written out and
discovered on the GPU.

ONE BFS, MANY DESTINATIONS. The first attempt ran a separate search per leg and
did not finish in ten minutes. A single breadth-first flood from the spawn
carries a parent pointer, so every destination in the world is solved in the
same pass -- seconds, not minutes -- and the path to any of them is read back
by walking parents. Legs between two destinations are solved by re-flooding
from the previous one, which is a handful of floods rather than one per leg.
"""
import math, os, sys, time
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "infra", "build", "hd"))
os.environ.setdefault("WLV2_PASS02", "1"); os.environ.setdefault("WLV2_PASS03", "1")
import layout_v2 as LAYOUT     # noqa: E402
from walkable import NOT_OBSTACLES, FOOT     # noqa: E402

X0, X1, Y0, Y1 = -36000, 36000, -36000, 40000

#: The tour, in the founder's order. Each stop is a place with an identity, and
#: the labels are what the capture's log will read out.
TOUR = [
    ("spawn", 0.0, -1460.0, 0.0, 4.0, "spawn: stand and look around"),
    ("gate", 0.0, -2200.0, 240.0, 2.0, "out through the arrival gate, and turn"),
    ("plaza", 0.0, 500.0, 150.0, 1.5, "back in, across the plaza"),
    ("court", 0.0, 5400.0, 300.0, 1.0, "the fountain court"),
    ("castle", 0.0, 8200.0, 300.0, 3.0, "the castle front, look up"),
    ("garden", 4969.0, 9516.0, 330.0, 2.5, "the garden quarter"),
    ("wood", 5423.0, -11475.0, 420.0, 2.5, "the mushroom wood"),
    ("clockyard", 12565.0, -3374.0, 420.0, 2.5, "the clock quarter"),
    ("hamlet", -12099.0, 8769.0, 420.0, 2.5, "the hamlet"),
    ("home", 0.0, -1460.0, 300.0, 5.0, "home, and idle"),
]


#: Assets with no FOOT entry that are DELIBERATELY not obstacles -- soft
#: scatter, elevated pieces, things you walk through. Anything else missing is
#: reported, because a missing footprint FAILS OPEN: the solver routes straight
#: through it and only the Dog finds out.
_SOFT_OK = ("flower_", "blossom_", "ground_", "petal", "lavender_", "rose_bloom",
            "ivy_", "vine_", "canopy_", "cloud_", "sky_", "balloon_", "leaf_",
            "roof_", "finial_", "balcony_", "dome", "bridge", "arch", "spire",
            "kerb_", "sign", "banner", "lantern", "glow", "water", "lily")


def build(cell, capsule):
    nx, ny = (X1 - X0) // cell, (Y1 - Y0) // cell
    blocked = bytearray(nx * ny)
    n = 0
    # WHAT THE SOLVER CANNOT SEE. castle_tower was in FOOT and its octagon,
    # square and slender siblings were not, so 38 towers were air to every
    # route solve and every walkable audit until the Dog walked into one.
    unseen = {}
    for p in LAYOUT.ALL:
        a = p["asset"]
        if a not in FOOT and a not in NOT_OBSTACLES and p["pos"][2] < 200 \
                and not any(k in a for k in _SOFT_OK):
            unseen[a] = unseen.get(a, 0) + 1
    if unseen:
        print("# GROUND-LEVEL ASSETS WITH NO FOOT ENTRY -- invisible to this solve:")
        for a, c in sorted(unseen.items(), key=lambda kv: -kv[1]):
            print("#   %-28s x%d" % (a, c))
    for p in LAYOUT.ALL:
        a = p["asset"]
        if a in NOT_OBSTACLES or a not in FOOT:
            continue
        sc = p["scale"]
        sx, sy = (abs(sc[0]), abs(sc[1])) if isinstance(sc, (list, tuple)) else (abs(sc), abs(sc))
        hx, hy = FOOT[a][0] * sx + capsule, FOOT[a][1] * sy + capsule
        ox, oy, yaw = p["pos"][0], p["pos"][1], math.radians(p["rot"][1])
        c, sn = math.cos(yaw), math.sin(yaw)
        reach = math.hypot(hx, hy)
        i0, i1 = max(0, int((ox - reach - X0) // cell)), min(nx - 1, int((ox + reach - X0) // cell))
        j0, j1 = max(0, int((oy - reach - Y0) // cell)), min(ny - 1, int((oy + reach - Y0) // cell))
        for j in range(j0, j1 + 1):
            cy = Y0 + j * cell + cell * 0.5
            for i in range(i0, i1 + 1):
                cx = X0 + i * cell + cell * 0.5
                dx, dy = cx - ox, cy - oy
                if abs(dx * c + dy * sn) <= hx and abs(-dx * sn + dy * c) <= hy:
                    blocked[j * nx + i] = 1
        n += 1
    return blocked, nx, ny, n


def flood(src, blocked, nx, ny):
    """BFS with parents from one cell. Solves every destination at once."""
    par = [-1] * (nx * ny)
    par[src] = src
    q = deque([src])
    while q:
        c = q.popleft()
        i, j = c % nx, c // nx
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ii, jj = i + di, j + dj
            if 0 <= ii < nx and 0 <= jj < ny:
                k = jj * nx + ii
                if par[k] == -1 and not blocked[k]:
                    par[k] = c
                    q.append(k)
    return par


def nearest_free(x, y, blocked, nx, ny, cell, rings=40):
    """A destination centre is often the LANDMARK. Walk out to open ground."""
    i0, j0 = int((x - X0) // cell), int((y - Y0) // cell)
    for r in range(rings):
        for dj in range(-r, r + 1):
            for di in range(-r, r + 1):
                if r and max(abs(di), abs(dj)) != r:
                    continue
                i, j = i0 + di, j0 + dj
                if 0 <= i < nx and 0 <= j < ny and not blocked[j * nx + i]:
                    return j * nx + i
    return None


def clear_line(a, b, blocked, nx, ny, cell):
    """Is the straight segment between two cells free? (route simplification)"""
    ax, ay = a % nx, a // nx
    bx, by = b % nx, b // nx
    steps = max(abs(bx - ax), abs(by - ay))
    if steps == 0:
        return True
    for s in range(steps + 1):
        i = ax + round((bx - ax) * s / steps)
        j = ay + round((by - ay) * s / steps)
        if blocked[j * nx + i]:
            return False
    return True


def path_between(src, dst, blocked, nx, ny, cell, cache):
    if src not in cache:
        cache[src] = flood(src, blocked, nx, ny)
    par = cache[src]
    if par[dst] == -1:
        return None
    out, c = [], dst
    while c != src:
        out.append(c)
        c = par[c]
    out.append(src)
    out.reverse()
    # SIMPLIFY BY SIGHT, NOT BY ANGLE. A grid path is a staircase; keeping every
    # turn would emit hundreds of legs. Keep a waypoint only where the straight
    # run to the next one would clip something.
    keep = [out[0]]
    i = 0
    while i < len(out) - 1:
        j = len(out) - 1
        while j > i + 1 and not clear_line(out[i], out[j], blocked, nx, ny, cell):
            j -= 1
        keep.append(out[j])
        i = j
    return keep


def main():
    cell = int(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--cell=")), 100))
    capsule = float(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--capsule=")), 60))
    t0 = time.time()
    blocked, nx, ny, n = build(cell, capsule)
    print("# obstacle field: %d x %d cells of %d uu from %d placements, %.1fs"
          % (nx, ny, cell, n, time.time() - t0))

    cells = []
    for (key, x, y, speed, hold, label) in TOUR:
        c = nearest_free(x, y, blocked, nx, ny, cell)
        if c is None:
            print("# UNREACHABLE STOP: %s at (%.0f, %.0f) has no free ground within %d m"
                  % (key, x, y, 40 * cell // 100))
            return 1
        cells.append((key, c, speed, hold, label))

    cache, legs, broken = {}, [], []
    for k in range(len(cells) - 1):
        key, src, _, _, _ = cells[k]
        nkey, dst, speed, hold, label = cells[k + 1]
        p = path_between(src, dst, blocked, nx, ny, cell, cache)
        if p is None:
            broken.append((key, nkey))
            print("# NO WALKABLE ROUTE: %s -> %s. THIS IS A WORLD DEFECT." % (key, nkey))
            continue
        # The intermediate waypoints carry the leg's travel speed; the named
        # stop carries its hold, so the Dog pauses at the PLACE, not en route.
        for c in p[1:-1]:
            legs.append((X0 + (c % nx) * cell + cell * 0.5,
                         Y0 + (c // nx) * cell + cell * 0.5, speed, 0.0, ""))
        legs.append((X0 + (dst % nx) * cell + cell * 0.5,
                     Y0 + (dst // nx) * cell + cell * 0.5, speed, hold, label))

    x0 = X0 + (cells[0][1] % nx) * cell + cell * 0.5
    y0 = Y0 + (cells[0][1] // nx) * cell + cell * 0.5
    print("# %d legs over %d stops, %.1fs total" % (len(legs) + 1, len(cells), time.time() - t0))
    # A LEG LONGER THAN ITS OWN BUDGET IS SILENTLY DROPPED.
    #
    # StepRoute abandons a leg after max(12, hold + 25) seconds -- a guard
    # written after a capture spent ninety seconds filming a Dog stuck in a
    # hedge. It cannot tell "stuck" from "still walking", so a leg whose
    # honest travel time exceeds the budget is abandoned mid-stride and the
    # tour quietly loses a stop. Nothing downstream would report it: the
    # capture simply ends up shorter than the route it was given.
    dist, overruns = 0.0, []
    px, py = x0, y0
    for (x, y, s, h, lb) in legs:
        d = math.hypot(x - px, y - py); px, py = x, y
        dist += d
        if s > 0 and d / s > max(12.0, h + 25.0):
            overruns.append((d / 100.0, d / s, max(12.0, h + 25.0), lb))
    print("# tour length %.0f m" % (dist / 100.0))
    for (dm, t, b, lb) in overruns:
        print("# LEG OVERRUNS ITS BUDGET: %.0f m takes %.0fs against a %.0fs budget -- %s"
              % (dm, t, b, lb or "connector"))
    if overruns:
        print("# %d leg(s) would be ABANDONED mid-travel; raise the speed or "
              "the budget in RelayDogCharacter::StepRoute" % len(overruns))
    if broken:
        print("# %d BROKEN CONNECTION(S) -- fix the world, not the route" % len(broken))
    if "--cpp" in sys.argv:
        print("\tAdd(%.1ff, %.1ff, %.1ff, %.1ff, TEXT(\"%s\"));"
              % (x0, y0, cells[0][2], cells[0][3], cells[0][4]))
        for (x, y, s, h, lb) in legs:
            print("\tAdd(%.1ff, %.1ff, %.1ff, %.1ff, TEXT(\"%s\"));" % (x, y, s, h, lb))
    return 1 if (broken or overruns) else 0


if __name__ == "__main__":
    sys.exit(main())
