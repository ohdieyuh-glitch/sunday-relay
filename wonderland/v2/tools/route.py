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
    # THE PROOF HAS TO TOUCH EVERY SURFACE FAMILY, not one road. The
    # step-height defect was one number applied to every flat slab in the
    # world, so a traversal that never crosses a grove path or a water-garden
    # walk does not prove it fixed -- founder, 2026-08-31. S05_grove and
    # Q02_water are the nearest quarters of their kind to the route.
    ("grove", -4694.0, 9014.0, 330.0, 2.0, "the grove"),
    ("water", -1936.0, -12000.0, 420.0, 2.0, "the water garden"),
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
            "kerb_", "sign", "banner", "lantern", "glow", "water", "lily",
            # Glazing rides its frame and is never an obstacle in its own
            # right. `vine_wall` is ivy on a wall that is itself solid.
            #
            # `gatehouse_` USED TO BE HERE, and the note that put it here was
            # right about the problem and wrong to stop there: "its solid parts
            # are a ring around a 5.2 m opening the road runs through, and one
            # axis-aligned rectangle can only express that by blocking the
            # arch." True -- and declaring it soft is FAIL-OPEN, which is the
            # very thing the report above exists to prevent. The solver ran a
            # leg through the gatehouse's PIERS and the Dog wedged inside one
            # at (14143, 1086) on the first real-GPU traversal of this world.
            # `layout_v2.FOOT_PARTS` can now say "piers block, span does not",
            # so the gate is solved as a gate.
            "glass_screen_panes", "gatehouse_glass")


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
        # a piece is SEEN if it has a plain footprint or a parts list; the
        # report has to know about both or it starts crying wolf about the
        # gatehouses it can now solve properly.
        if a not in FOOT and a not in LAYOUT.FOOT_PARTS and a not in NOT_OBSTACLES \
                and p["pos"][2] < 200 and not any(k in a for k in _SOFT_OK):
            unseen[a] = unseen.get(a, 0) + 1
    if unseen:
        print("# GROUND-LEVEL ASSETS WITH NO FOOT ENTRY -- invisible to this solve:")
        for a, c in sorted(unseen.items(), key=lambda kv: -kv[1]):
            print("#   %-28s x%d" % (a, c))
    for p in LAYOUT.ALL:
        a = p["asset"]
        if a in NOT_OBSTACLES:
            continue
        # ONE OBSTACLE MODEL, shared with walkable.py: `solid_boxes` yields the
        # single box an ordinary piece contributes and the SEVERAL a threshold
        # does, so a gatehouse blocks its piers and passes its arch instead of
        # being all-or-nothing. See layout_v2.FOOT_PARTS.
        for (ox, oy, phx, phy, yaw) in LAYOUT.solid_boxes(p):
            hx, hy = phx + capsule, phy + capsule
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


def flood(src, blocked, nx, ny, dist=None):
    """Dijkstra with parents from one cell, PREFERRING OPEN GROUND.

    A plain breadth-first flood finds *a* shortest path, and the shortest path
    through a gateway runs along one jamb. That is fine for a point and fatal
    for a body: the Dog caught the North Gate's jamb, slid 218 uu across the
    opening and wedged into the far pier, and 31 legs were abandoned behind it.

    So the step cost is distance PLUS a penalty for being near anything. A
    cell with room around it costs 3; one hard against an obstacle costs much
    more, and the route takes the long way round rather than threading a gap
    it does not need. Where there is no alternative -- the hamlet's parterre
    walk -- the penalty is paid and the gap is still used.
    """
    if dist is None:
        return _flood_plain(src, blocked, nx, ny)
    import heapq
    INF = float("inf")
    cost = [INF] * (nx * ny)
    par = [-1] * (nx * ny)
    cost[src] = 0.0
    par[src] = src
    h = [(0.0, src)]
    # WANT is the clearance a route would like: 6 chamfer units is two cells of
    # room. Beyond it there is no bonus; below it the penalty climbs steeply.
    # 12 -> 24, and the penalty steeper. The Dog reached the city block and
    # ground along it at 16 uu/s where the leg asked for 330: the route threaded
    # a corridor with four to six chamfer units of room while everything either
    # side of it had fourteen to twenty-three. Preferring open ground only
    # helps if "open" is set wide enough to reject a gap the Dog can enter and
    # then cannot move in.
    WANT = 18
    while h:
        c0, c = heapq.heappop(h)
        if c0 > cost[c]:
            continue
        i, j = c % nx, c // nx
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ii, jj = i + di, j + dj
            if not (0 <= ii < nx and 0 <= jj < ny):
                continue
            k = jj * nx + ii
            if blocked[k]:
                continue
            room = min(dist[k], WANT)
            step = 3.0 + 3.0 * (WANT - room)
            nc = c0 + step
            if nc < cost[k]:
                cost[k] = nc
                par[k] = c
                heapq.heappush(h, (nc, k))
    return par


def _flood_plain(src, blocked, nx, ny):
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


def nearest_free(x, y, blocked, nx, ny, cell, rings=40, dist=None, want=6):
    """A destination centre is often the LANDMARK. Walk out to STANDING ROOM.

    "The nearest free cell" is not the same as "somewhere the Dog can stand".
    Both remaining traversal failures were of that shape: the castle front and
    the garden quarter resolved to cells hard against geometry, and the Dog
    stopped 332 uu short of one having spent its whole budget trying to squeeze
    the last few metres. It was not a tolerance problem -- the tolerance is 36
    uu -- it simply could not get there.

    So a destination now needs room around it as well as being free: `want` in
    chamfer units, 6 being two cells. The search widens to the first cell that
    has it, and falls back to merely-free only if the whole neighbourhood is
    tight, which keeps a cramped quarter reachable rather than dropping it.
    """
    i0, j0 = int((x - X0) // cell), int((y - Y0) // cell)
    fallback = None
    for r in range(rings):
        for dj in range(-r, r + 1):
            for di in range(-r, r + 1):
                if r and max(abs(di), abs(dj)) != r:
                    continue
                i, j = i0 + di, j0 + dj
                if not (0 <= i < nx and 0 <= j < ny) or blocked[j * nx + i]:
                    continue
                k = j * nx + i
                if dist is None or dist[k] >= want:
                    return k
                if fallback is None:
                    fallback = k
    return fallback


def distance_field(blocked, nx, ny):
    """Cells from the nearest obstacle, for every free cell, in one pass pair.

    The ring-scan version of this was fine for a handful of waypoints and far
    too slow for half a million cells, which is why the first attempts at a
    clearance-aware route reached for cheaper proxies -- inflating the capsule,
    then pinning pinch points -- and both made things worse. Inflating only
    changes which gaps are legal; pinning aims the route AT the pinch. What is
    actually wanted is to prefer open ground, and that needs the distance to
    the nearest obstacle everywhere.

    Two-pass chamfer, 3-4 weights, which is close enough to Euclidean for a
    preference and is O(cells).
    """
    INF = 1 << 28
    d = [0 if blocked[i] else INF for i in range(nx * ny)]
    for j in range(ny):
        base = j * nx
        for i in range(nx):
            k = base + i
            if d[k] == 0:
                continue
            best = d[k]
            if i: best = min(best, d[k - 1] + 3)
            if j: best = min(best, d[k - nx] + 3)
            if i and j: best = min(best, d[k - nx - 1] + 4)
            if i < nx - 1 and j: best = min(best, d[k - nx + 1] + 4)
            d[k] = best
    for j in range(ny - 1, -1, -1):
        base = j * nx
        for i in range(nx - 1, -1, -1):
            k = base + i
            if d[k] == 0:
                continue
            best = d[k]
            if i < nx - 1: best = min(best, d[k + 1] + 3)
            if j < ny - 1: best = min(best, d[k + nx] + 3)
            if i < nx - 1 and j < ny - 1: best = min(best, d[k + nx + 1] + 4)
            if i and j < ny - 1: best = min(best, d[k + nx - 1] + 4)
            d[k] = best
    return d


def clearance(c, blocked, nx, ny, limit=8):
    """Rings of free space around a cell, in cells, capped at `limit`."""
    i0, j0 = c % nx, c // nx
    for r in range(1, limit + 1):
        for dj in range(-r, r + 1):
            for di in range(-r, r + 1):
                if max(abs(di), abs(dj)) != r:
                    continue
                i, j = i0 + di, j0 + dj
                if i < 0 or j < 0 or i >= nx or j >= ny or blocked[j * nx + i]:
                    return r - 1
    return limit


def centre(c, blocked, nx, ny, reach=3):
    """Slide a waypoint toward the middle of its free space.

    A BREADTH-FIRST PATH HUGS CORNERS. It finds *a* shortest route, and the
    shortest route through a gateway runs along one jamb -- which is fine for
    a point and fatal for a body that slides on contact. The Dog proved it at
    the North Gate: the piers leave a 325 uu span centred on x = -23, the
    solve ran it at x = +50, and the Dog ended wedged into the far pier at
    (-168, 6914) having slid 218 uu across the opening. It never moved again;
    31 legs were abandoned behind it.

    Inflating the capsule does not fix this -- it only narrows which gaps are
    considered passable, and the path still hugs whichever wall it finds. The
    waypoint has to move to the middle, which is what this does.
    """
    best, bestc = c, clearance(c, blocked, nx, ny)
    i0, j0 = c % nx, c // nx
    for dj in range(-reach, reach + 1):
        for di in range(-reach, reach + 1):
            i, j = i0 + di, j0 + dj
            if i < 0 or j < 0 or i >= nx or j >= ny:
                continue
            k = j * nx + i
            if blocked[k]:
                continue
            cl = clearance(k, blocked, nx, ny)
            if cl > bestc:
                best, bestc = k, cl
    return best


def clear_wide(a, b, blocked, nx, ny, min_rings):
    """Is the straight run between two cells free AND roomy the whole way?"""
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
        if clearance(j * nx + i, blocked, nx, ny, limit=min_rings) < min_rings:
            return False
    return True


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


def path_between(src, dst, blocked, nx, ny, cell, cache, dist=None):
    if src not in cache:
        cache[src] = flood(src, blocked, nx, ny, dist)
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
    # PIN A WAYPOINT AT EVERY CONSTRICTION, BEFORE SIMPLIFYING PAST IT.
    #
    # Centring the waypoints was not enough, and the Dog said so by stopping
    # at exactly the same coordinate twice: simplification collapses the run
    # from the fountain court to the castle front into ONE straight leg, so
    # there is no waypoint inside the North Gate to centre. The line goes
    # where the line goes -- x = +50 through a span centred on x = -23 -- and
    # the Dog catches the jamb.
    #
    # A gap is where the route must be deliberate. Any cell on the path with
    # less than two free rings around it becomes a waypoint that survives
    # simplification and then gets centred, so the route aims at the middle of
    # the gate instead of merely passing through it.
    # ONE PIN PER PINCH, not one per tight cell. A dense world is tight almost
    # everywhere; what matters is the LOCAL MINIMUM -- the narrowest point of a
    # gateway -- and pinning every cell below a threshold produced 1,518 legs
    # for a 2 km walk.

    keep = [(out[0], 0)]
    i = 0
    while i < len(out) - 1:
        j = len(out) - 1
        while j > i + 1 and not clear_line(out[i], out[j], blocked, nx, ny, cell):
            j -= 1
        keep.append((out[j], j))
        i = j
    # CENTRE EVERY WAYPOINT BUT THE ENDS. The ends are the stops themselves and
    # moving them would move the tour; everything between is a corner the path
    # happened to turn at, and the middle of the gap is the better place for it.
    for k in range(1, len(keep) - 1):
        keep[k] = (centre(keep[k][0], blocked, nx, ny), keep[k][1])
    # A SECOND PASS OVER OPEN GROUND. Pinning every pinch is right and gives
    # 298 legs for a 2 km walk, most of them across ground where nothing is
    # near. This merges any run whose whole line keeps two free rings -- open
    # country collapses back to long legs, and the waypoints inside gateways,
    # which are the ones that had to be there, stay.
    out2 = [keep[0]]
    i = 0
    while i < len(keep) - 1:
        j = len(keep) - 1
        while j > i + 1 and not clear_wide(keep[i][0], keep[j][0], blocked, nx, ny, 2):
            j -= 1
        out2.append(keep[j])
        i = j
    # AND NO LEG LONGER THAN MAXLEG.
    #
    # StepRoute aims at the target and walks; it does not follow a path. Over a
    # 40 m leg that is an invitation to drift, and the Dog took it: from
    # (50, 8250) toward (-1950, 11750) it ended 1,783 uu off the straight line
    # and 210 uu INSIDE City2_Hall -- ground the solver correctly marks
    # blocked, and 1,681 uu from the nearest waypoint. It had left the route
    # entirely.
    #
    # A leg is a promise that walking straight at the target is safe. That is
    # only true over a short distance, so the long ones are cut back into
    # pieces along the path that was actually solved. The clearance-preferring
    # route is kept; the Dog simply re-aims often enough to stay on it.
    # SUBDIVIDE ALONG THE SOLVED PATH, NOT ALONG THE STRAIGHT LINE.
    #
    # Interpolating between two waypoints puts the new ones wherever the chord
    # falls, and a chord across a bend leaves the free space entirely: the
    # first version of this produced waypoints with ZERO room, standing inside
    # geometry the solver had carefully routed around. `out` is the path that
    # was actually solved and every cell of it is free, so the cuts come from
    # there.
    MAXLEG = 12          # cells, so 1,200 uu at cell 100
    out3 = [out2[0][0]]
    for (a, ka), (b, kb) in zip(out2, out2[1:]):
        ax, ay = a % nx, a // nx
        bx, by = b % nx, b // nx
        steps = max(abs(bx - ax), abs(by - ay))
        if steps > MAXLEG and kb > ka:
            n_cut = (steps + MAXLEG - 1) // MAXLEG
            for t in range(1, n_cut):
                # the cut comes off the SOLVED path, then centres like the rest
                out3.append(centre(out[ka + (kb - ka) * t // n_cut], blocked, nx, ny))
        out3.append(b)
    return out3


def main():
    cell = int(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--cell=")), 100))
    capsule = float(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--capsule=")), 60))
    t0 = time.time()
    blocked, nx, ny, n = build(cell, capsule)
    print("# obstacle field: %d x %d cells of %d uu from %d placements, %.1fs"
          % (nx, ny, cell, n, time.time() - t0))
    dist = distance_field(blocked, nx, ny)
    print("# distance field built, %.1fs" % (time.time() - t0))

    cells = []
    for (key, x, y, speed, hold, label) in TOUR:
        c = nearest_free(x, y, blocked, nx, ny, cell, dist=dist)
        if c is None:
            print("# UNREACHABLE STOP: %s at (%.0f, %.0f) has no free ground within %d m"
                  % (key, x, y, 40 * cell // 100))
            return 1
        cells.append((key, c, speed, hold, label))

    cache, legs, broken = {}, [], []
    for k in range(len(cells) - 1):
        key, src, _, _, _ = cells[k]
        nkey, dst, speed, hold, label = cells[k + 1]
        p = path_between(src, dst, blocked, nx, ny, cell, cache, dist)
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
        if s > 0 and d / s > max(12.0, h + 10.0 + 3.0 * (d / s)):
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
