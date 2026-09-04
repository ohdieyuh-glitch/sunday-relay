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
#: The measured plan half-footprints now live in `layout_v2.FOOT` -- the
#: layout needs the same numbers to keep its own pieces out of each other
#: (see `_declutter`), and this file having its own copy is exactly the
#: "two descriptions of one quantity" defect the ledger records.
FOOT = LAYOUT.FOOT

#: Walkable on purpose: paving and low platforms are surfaces, not obstacles.
NOT_OBSTACLES = ("terrace_platform", "garden_lawn", "stone_ring_base", "path_steps",
                 "side_steps", "ground_flowers", "ground_blooms",
                 # Declared rather than left missing, because a missing FOOT
                 # entry FAILS OPEN and looks exactly like a considered
                 # decision. tea_saucer is a 2.6 m flat disc you step onto;
                 # mushroom_small and key_ornate are ankle-height props.
                 "tea_saucer", "mushroom_small", "key_ornate",
                 # PASS 28. The glazing meshes ride on frames that ARE in
                 # FOOT -- glass_pavilion_lights on glass_pavilion,
                 # lantern_strange_glass on lantern_strange,
                 # flower_colossal_bloom on flower_colossal -- so giving them
                 # footprints of their own would model each object twice.
                 # Declared here for the same reason as the line above: route.py
                 # lists what it cannot see, and an entry it never mentions is
                 # indistinguishable from one somebody thought about.
                 "glass_pavilion_lights", "lantern_strange_glass",
                 "flower_colossal_bloom", "spire_halo_ring")

#: THE WINDOW WAS GOLDEN ARRIVAL AND THE WORLD IS NOT.
#:
#: This sampled x -90..90 m, y -100..95 m, and every one of its eighteen
#: destinations stood inside that box. Meanwhile the outer world grew to
#: fifty-three quarters out to 340 m, joined by radial roads and two ring
#: circuits, and NOT ONE metre of it was ever tested -- "0 of 18 destinations
#: unreachable" was true and was a statement about the district. The tool that
#: found both flanks were cul-de-sacs could not have found a cul-de-sac in the
#: outer world, because the outer world was outside its frame.
#:
#: `--window=world` samples the whole walkable ground and adds every quarter
#: centre to the destination list, so road continuity is something the audit
#: answers rather than something the road-building code promises.
WINDOWS = {"district": (-9000, 9000, -10000, 9500),
           "world": (-36000, 36000, -36000, 40000)}
X0, X1, Y0, Y1 = WINDOWS["district"]


def main():
    global X0, X1, Y0, Y1
    win = next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--window=")), "district")
    X0, X1, Y0, Y1 = WINDOWS[win]
    cell = int(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--cell=")),
                    50 if win == "district" else 100))
    cap = float(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--capsule=")), 36))
    obst = []
    for p in LAYOUT.ALL:
        a = p["asset"]
        if a in NOT_OBSTACLES:
            continue
        # A THRESHOLD IS NOT A BLOCK. `layout_v2.solid_boxes` yields one box for
        # an ordinary piece and SEVERAL for the few that a single rectangle
        # cannot describe -- a gatehouse is two towers, two wall stubs and a
        # 5.2 m opening the road runs through. Before this the choice was
        # between walling off the arch and declaring the whole gate soft, and
        # the second was chosen: the solver drew a route through the piers and
        # the Dog wedged in one on the first real traversal.
        for (bx, by, hx, hy, yaw) in LAYOUT.solid_boxes(p):
            obst.append((bx, by, hx + cap, hy + cap, yaw))
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
        # PASS 23: the way past the castle. Reaching a quarter by walking all
        # the way round is reachability; walking out of the castle court and
        # continuing is a ROUTE, and only one of those is a world.
        #
        # THE TARGETS ARE THE WAY'S OWN WAYPOINTS, read from layout_v2 rather
        # than restated: written out by hand they went stale the moment the
        # route was re-solved, and this tool then reported a turn unreachable
        # that the world no longer had.
        ("north gate", int(LAYOUT.NORTH_WAY[0][0]), int(LAYOUT.NORTH_WAY[0][1])),
    ]
    # PASS 30: THE SOUTHERN QUARTER. It was built, measured, and then could not
    # be reached -- an attempt to drive there ended against a retaining wall.
    # "Is it reachable" is a question this tool already answers for every other
    # quarter, and the new one was simply not on the list. Read from the layout
    # for the reason the comment above gives.
    for si, (sx, sy) in enumerate(getattr(LAYOUT, "SOUTH_WAY", ())):
        targets.append(("south way %d" % si, int(sx), int(sy)))
    if win == "world":
        for wi, (wx, wy) in enumerate(LAYOUT.NORTH_WAY[1:]):
            targets.append(("north way %d" % (wi + 1), int(wx), int(wy)))

    print("walkable flood from the spawn: %d cells of %d uu (%.0f%% of the sampled ground)"
          % (n, cell, 100.0 * n / float(nx * ny)))
    print("%-24s %8s %s" % ("destination", "r (m)", "reached"))
    print("-" * 48)
    bad = 0
    unreached = []
    for name, tx, ty in targets:
        k = idx(float(tx), float(ty))
        if blocked[k]:
            # a target standing ON an object (a plinth, a landmark) is not a
            # failure; ask whether its immediate surroundings are reachable.
            #
            # THIS USED TO SAMPLE NINE POINTS and it reported the LEFT flank
            # landmark unreachable while a walker can stand 2.5 m from it. The
            # nine were (0, +/-250) on each axis; the open ground beside that
            # landmark is at (-175, -175) from it, between them. The RIGHT
            # landmark passed the identical geometry only because its open
            # ground happened to land on a sampled offset. A probe that misses
            # by falling between its own samples is the instrument talking, so
            # the ring is SWEPT rather than sampled -- every cell out to the
            # 354 uu diagonal the nine already accepted, no threshold moved.
            near = False
            rad = int(math.ceil(354.0 / cell))
            ci, cj = k % nx, k // nx
            for dj in range(-rad, rad + 1):
                jj = cj + dj
                if not (0 <= jj < ny):
                    continue
                for di in range(-rad, rad + 1):
                    ii = ci + di
                    if not (0 <= ii < nx):
                        continue
                    if math.hypot(di, dj) * cell > 354.0:
                        continue
                    if seen[jj * nx + ii]:
                        near = True
                        break
                if near:
                    break
            print("%-24s %8.0f %s" % (name, math.hypot(tx, ty) / 100.0,
                                       "yes (approach)" if near else "NO"))
            bad += 0 if near else 1
            if not near:
                unreached.append(name)
        else:
            ok = bool(seen[k])
            print("%-24s %8.0f %s" % (name, math.hypot(tx, ty) / 100.0, "yes" if ok else "NO"))
            bad += 0 if ok else 1
            if not ok:
                unreached.append(name)
    print("\n%d of %d destinations unreachable%s"
          % (bad, len(targets), (": " + ", ".join(unreached)) if unreached else ""))

    # --- THE OUTER WORLD ---------------------------------------------------
    #
    # A quarter is not a point. Asked at its exact centre, seventeen of the
    # fifty-three came back unreachable and every one of them was a `towers`
    # quarter -- because `plan[0]` stands a tower ON the centre, so the audit
    # was asking whether a walker can get INSIDE a building. That is the same
    # mistake this tool's own docstring records finding in the world (a
    # landmark placed inside a tower), made one level up in the instrument.
    #
    # So a quarter is probed as a place: twelve points on a ring inside it,
    # plus its centre. The fraction that the flood reaches is the answer, and
    # it is printed, because "reachable" at one probe of thirteen is a sliver
    # a walker would have to find, and that is worth seeing before it is worth
    # calling connected.
    if win == "world":
        print("\nOUTER WORLD -- can a walker get INTO each quarter?")
        print("%-14s %8s %7s  %s" % ("quarter", "r (m)", "probes", "verdict"))
        print("-" * 52)
        cut = 0
        for s in sorted(LAYOUT.SITES, key=lambda s: math.hypot(s["x"], s["y"])):
            rr = s.get("reach", 2200.0) * 0.55
            probes = [(s["x"], s["y"])] + [
                (s["x"] + math.cos(6.283 * i / 12.0) * rr,
                 s["y"] + math.sin(6.283 * i / 12.0) * rr) for i in range(12)]
            hit = free = 0
            for (px, py) in probes:
                if not (X0 <= px < X1 and Y0 <= py < Y1):
                    continue
                k = idx(px, py)
                if blocked[k]:
                    continue
                free += 1
                if seen[k]:
                    hit += 1
            verdict = "unreachable" if hit == 0 else ("SLIVER" if hit * 3 < free else "open")
            if hit == 0 or hit * 3 < free:
                cut += 1
            print("%-14s %8.0f %4d/%-3d  %s"
                  % (s["tag"], math.hypot(s["x"], s["y"]) / 100.0, hit, free, verdict))
        print("\n%d of %d quarters unreachable or reachable only through a sliver"
              % (cut, len(LAYOUT.SITES)))
        bad += cut

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
                ("LEFT parterre -> grove", 3115, 520, 5450, 3650),
                # PASS 23: the way past the castle, derived rather than drawn.
                # Written by hand it ran into the BeyondL hedge wall (which
                # stands at x 7,229-7,571 from y 5,514 to 9,286) and the audit
                # reported its first turn unreachable. The flank walk was
                # solved the same way in PASS 12 and the lesson holds: ask for
                # the route a walker takes, then pave THAT.
                ("castle court -> north milestone", 0, 6900,
                 int(LAYOUT.NORTH_WAY[-1][0]), int(LAYOUT.NORTH_WAY[-1][1]))):
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
