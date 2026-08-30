#!/usr/bin/env python3
"""Is the world CONNECTED for a walker? A flood fill, not a line scan.

    python3 wonderland/v2/tools/walkable.py [--cell 50] [--capsule 36]

A straight-line clearance scan answers "does a 3 m path fit down a constant
x", which is a question about paving. The founder's requirement is that the
Relay Dog can get places, and a walker does not travel at constant x -- it
weaves. Those are different questions and the first one nearly cost a real
finding: no straight corridor fits anywhere along the Golden Arrival flanks
(best clearance -33 uu over x 2,600..7,400), which says a paved spine is
impossible and says NOTHING about whether the garden is walkable.

So: grid the ground, mark every cell whose centre clears every solid actor by
the capsule radius, flood from the spawn, and report which named destinations
the fill reaches. Vegetation with no collision is excluded -- that is a real
property of this world, recorded in the ledger, not an oversight here.

This is still a plan-view approximation: it knows nothing about steps, risers
or z. The locomotion phase already proved that only walking it finds a 60 uu
riser. What this catches is the other thing -- a place the geometry has
enclosed - and it catches it before a GPU minute is spent.
"""
import math
import os
import sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "infra", "build", "hd"))
os.environ.setdefault("WLV2_PASS02", "1")
os.environ.setdefault("WLV2_PASS03", "1")
import layout_v2 as LAYOUT     # noqa: E402

#: MEASURED plan half-footprints (half_x, half_y) in uu at scale 1, from the
#: recipe contact sheets -- not circles. The first version of this tool used
#: one radius per asset and reported the parterre centres unreachable, which
#: was its own approximation talking: a parterre edge is hedge_block stretched
#: to 618 x 135, and a circle of r=153 both over-blocks the walk beside it and
#: under-blocks along its run. An elongated piece needs an ORIENTED RECTANGLE
#: or the answer is about the model rather than the world.
FOOT = {"hedge_block": (176, 75), "hedge_mass": (320, 320), "garden_wall": (255, 50),
        "retaining_wall": (255, 50), "gate_pier": (95, 95), "gate_leaf": (210, 40),
        "pedestal_finial": (35, 35), "garden_urn": (55, 55), "planter_box": (105, 105),
        "topiary_cone_plain": (115, 120), "topiary_cone_roses": (115, 120),
        "topiary_ball": (93, 92), "topiary_spiral": (95, 95), "heart_topiary": (589, 199),
        "tree_mature_trunk": (105, 105), "tree_slender_trunk": (55, 55),
        "tree_clock_trunk": (170, 170), "mushroom_landmark": (150, 150),
        "mushroom_giant": (260, 260), "mushroom_medium": (90, 90),
        "fountain_basin": (300, 300), "balustrade": (255, 40),
        "castle_tower": (400, 400), "castle_hall": (600, 600), "tower_capped": (400, 400),
        "rose_bush": (98, 105), "shrub_flowering": (90, 90), "tea_plinth": (200, 200)}
#: Walkable on purpose: paving and low platforms are surfaces, not obstacles.
NOT_OBSTACLES = ("terrace_platform", "garden_lawn", "stone_ring_base", "path_steps",
                 "side_steps", "ground_flowers", "ground_blooms")

X0, X1, Y0, Y1 = -9000, 9000, -10000, 9500


def main():
    cell = int(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--cell=")), 50))
    cap = float(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--capsule=")), 36))
    obst = []
    for p in LAYOUT.ALL:
        a = p["asset"]
        if a in NOT_OBSTACLES or a not in FOOT:
            continue
        sc = p["scale"]
        sx, sy = (abs(sc[0]), abs(sc[1])) if isinstance(sc, (list, tuple)) else (abs(sc), abs(sc))
        hx, hy = FOOT[a]
        obst.append((p["pos"][0], p["pos"][1], hx * sx + cap, hy * sy + cap,
                     math.radians(p["rot"][1])))
    nx, ny = (X1 - X0) // cell, (Y1 - Y0) // cell
    blocked = bytearray(nx * ny)
    for (ox, oy, hx, hy, yaw) in obst:
        c, sn = math.cos(yaw), math.sin(yaw)
        reach = math.hypot(hx, hy)
        i0, i1 = max(0, int((ox - reach - X0) // cell)), min(nx - 1, int((ox + reach - X0) // cell))
        j0, j1 = max(0, int((oy - reach - Y0) // cell)), min(ny - 1, int((oy + reach - Y0) // cell))
        for j in range(j0, j1 + 1):
            cy = Y0 + j * cell + cell * 0.5
            for i in range(i0, i1 + 1):
                cx = X0 + i * cell + cell * 0.5
                dx, dy = cx - ox, cy - oy
                lx = dx * c + dy * sn          # into the piece's own frame
                ly = -dx * sn + dy * c
                if abs(lx) <= hx and abs(ly) <= hy:
                    blocked[j * nx + i] = 1

    def idx(x, y):
        return (int((y - Y0) // cell)) * nx + int((x - X0) // cell)

    start = idx(0.0, -1460.0)                      # the PlayerStart
    seen = bytearray(nx * ny)
    if blocked[start]:
        print("SPAWN CELL IS BLOCKED -- nothing to report"); return 1
    q = deque([start]); seen[start] = 1; n = 1
    while q:
        c = q.popleft()
        i, j = c % nx, c // nx
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ii, jj = i + di, j + dj
            if 0 <= ii < nx and 0 <= jj < ny:
                k = jj * nx + ii
                if not seen[k] and not blocked[k]:
                    seen[k] = 1; n += 1; q.append(k)
    targets = [
        ("plaza centre", 0, 0), ("castle approach", 0, 6000), ("fountain court", 0, 3300),
        ("LEFT flank entry", 2650, 400), ("LEFT parterre centre", 4350, 700),
        ("LEFT grove", 5450, 3650), ("LEFT landmark", 2750, 5950),
        ("RIGHT flank entry", -2650, 400), ("RIGHT parterre centre", -4350, 700),
        ("RIGHT grove", -5450, 3650), ("RIGHT landmark", -2750, 5950),
        ("rear gate", 0, -6000), ("rear world beyond", 0, -8200),
        ("R lane y=1500", -3225, 1500), ("R lane y=2500", -3225, 2500),
        ("R lane y=3500", -3225, 3500), ("R lane y=4500", -2975, 4500),
        ("R lane y=5200", -2900, 5200),
    ]
    print("walkable flood from the spawn: %d cells of %d uu (%.0f%% of the sampled ground)"
          % (n, cell, 100.0 * n / float(nx * ny)))
    print("%-24s %s" % ("destination", "reached"))
    print("-" * 40)
    bad = 0
    for name, tx, ty in targets:
        k = idx(float(tx), float(ty))
        if blocked[k]:
            # a target standing ON an object (a plinth, a landmark) is not a
            # failure; ask whether its immediate surroundings are reachable
            near = any(seen[idx(tx + dx, ty + dy)]
                       for dx in (-250, 0, 250) for dy in (-250, 0, 250)
                       if 0 <= idx(tx + dx, ty + dy) < nx * ny)
            print("%-24s %s" % (name, "yes (approach)" if near else "NO"))
            bad += 0 if near else 1
        else:
            ok = bool(seen[k])
            print("%-24s %s" % (name, "yes" if ok else "NO"))
            bad += 0 if ok else 1
    print("\n%d of %d destinations unreachable" % (bad, len(targets)))

    # --- ROUTES ------------------------------------------------------------
    # A straight paved spine does not fit the flanks -- measured, best
    # clearance -33 uu against the 150 a 3 m walk needs, because the garden is
    # planted along its whole length. That does not mean there is no way
    # through; it means the way is not straight. The same fill that answers
    # "can the Dog get there" can hand back the route it took, and a route is
    # what paving should follow.
    if "--routes" in sys.argv:
        print("\nROUTES (grid cells of %d uu, simplified to turns):" % cell)
        for name, ax, ay, bx, by in (
                # the APPROACH to each landmark, not its own cell: the
                # monument stands there, so routing to it asks for a way into
                # a plinth
                ("LEFT flank entry -> landmark", 2650, 400, 2750, 5650),
                ("RIGHT flank entry -> landmark", -2650, 400, -2750, 5650),
                ("LEFT entry -> parterre walk", 2650, 400, 3115, 520),
                ("LEFT parterre -> grove", 3115, 520, 5450, 3650)):
            path = _route(idx(float(ax), float(ay)), idx(float(bx), float(by)),
                          blocked, nx, ny)
            if path is None:
                print("  %-30s NO ROUTE" % name)
                continue
            pts = [(X0 + (c % nx) * cell + cell // 2, Y0 + (c // nx) * cell + cell // 2)
                   for c in path]
            turns = _simplify(pts, tol=cell * 1.5)
            print("  %-30s %d cells, %d waypoints" % (name, len(path), len(turns)))
            for (x, y) in turns:
                print("        (%6d, %6d)" % (x, y))
    return 1 if bad else 0


def _nearest_free(c, blocked, nx, ny, rings=12):
    """The nearest unblocked cell to c, or None.

    A route endpoint is usually a THING -- a landmark, a plinth, an urn -- and
    a thing occupies its own cell, so asking for a path INTO it returns "no
    route" and means nothing. That is what the right flank reported: the
    target sat inside the rose bush at the heart's foot, and a flank that the
    flood fill showed reachable at every probe along its length came back as
    unroutable. Route to the ground BESIDE the destination, which is where a
    walker actually stands.
    """
    if not blocked[c]:
        return c
    i0, j0 = c % nx, c // nx
    for r in range(1, rings + 1):
        for di in range(-r, r + 1):
            for dj in (-r, r) if abs(di) < r else range(-r, r + 1):
                i, j = i0 + di, j0 + dj
                if 0 <= i < nx and 0 <= j < ny and not blocked[j * nx + i]:
                    return j * nx + i
    return None


def _route(a, b, blocked, nx, ny):
    """Shortest cell path a -> b through unblocked cells, or None."""
    a = _nearest_free(a, blocked, nx, ny)
    b = _nearest_free(b, blocked, nx, ny)
    if a is None or b is None:
        return None
    prev = {a: None}
    q = deque([a])
    while q:
        c = q.popleft()
        if c == b:
            out = []
            while c is not None:
                out.append(c)
                c = prev[c]
            return out[::-1]
        i, j = c % nx, c // nx
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ii, jj = i + di, j + dj
            if 0 <= ii < nx and 0 <= jj < ny:
                k = jj * nx + ii
                if k not in prev and not blocked[k]:
                    prev[k] = c
                    q.append(k)
    return None


def _simplify(pts, tol):
    """Keep only the points where the route actually turns."""
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        ax, ay = out[-1]
        bx, by = pts[i]
        cx, cy = pts[i + 1]
        # cross product of (b-a) and (c-b): zero while the run is straight
        if abs((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) > tol * tol:
            out.append((bx, by))
    out.append(pts[-1])
    return out


if __name__ == "__main__":
    sys.exit(main())
