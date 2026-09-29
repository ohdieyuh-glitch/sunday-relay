#!/usr/bin/env python3
"""SECTOR FILL -- structured garden districts in the empty nation heartlands.

WHY. The census after the ring roads (2026-09-28, 195,938 rows) puts the walkable disc at 50.1% empty with
structure only, and the empty ground is not scattered: it is five heartland regions of 12-25 hectares, one
between each nation's band avenue and its seams, all at 600-1,150 m (emptiness.py --structure, regions_top):

    NOCTIS    bearing 181  255,075 m2      TARTARUS  bearing 356  204,975 m2
    NOCTIS    bearing 238  194,350 m2      ICARUS    bearing  57  152,000 m2
    TARTARUS  bearing 308  118,900 m2

The founder's rule for completion is "aggressive environmental completion ... density must not be random
clutter ... empty space only where intentional". So nothing here is scattered. The ground is measured first,
then filled largest-first with DESIGNED GROUPS, each already proven on the rear seam (w270_rear_seam.py):

  * GARDEN QUARTERS -- four 30 m garden rooms around a cross of stepping-stone lanes, where 80 m is clear;
  * one MUSHROOM WOOD per region (the Bible's mushroom woods, in the nation's cap colours);
  * single GARDEN ROOMS where 36 m is clear;
  * GROVES of six to eleven trees with a shrub-and-rose rim where 30 m is clear;
  * MEADOW DRIFTS -- one species to an arc -- in the gaps between;
  * and what is left stays LAWN, on purpose: the spaces between groups are part of the design.
Every door of every room is joined to the nearest existing paving (a band avenue, a ring road, a court) by
stepping stones laid along a path searched through the free ground, so nothing is marooned in the grass.

THE GROUND IS THE CENSUS, THROUGH w270_rear_seam's occupancy -- with its load_census filtering by the CURRENT
frame (the fix of 2026-09-28: it used to hard-code the rear seam's wedge, and the pockets built on it tested
clearance against an empty world). Every stamp is then placed with that occupancy's own exact tests.

    python sector_fill.py [--only HN181,...]      writes <id>_<nation>_heartland.json + a plan per region
"""
import argparse
import csv
import gzip
import json
import math
import random
import sys
from collections import Counter, deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import w270_rear_seam as W                                       # noqa: E402  frame, occupancy, Pass, stamps

CELL = 500.0                                                     # the free-ground raster, cm
LAYERS = ("existing", "solid", "paved", "way")

#: the five heartlands (bearing and radial span from emptiness.py's regions_top; the half-angle holds the region)
REGIONS = {
    "HN181": dict(nation_cfg="NC03", bearing=181.0, half=22.0, r=(62000.0, 115000.0)),
    "HT356": dict(nation_cfg="TQ03", bearing=356.0, half=20.0, r=(61000.0, 110000.0)),
    "HN238": dict(nation_cfg="NC03", bearing=238.0, half=17.0, r=(61000.0, 114000.0)),
    "HI057": dict(nation_cfg="IC03", bearing=57.0, half=17.0, r=(60000.0, 112000.0)),
    "HT308": dict(nation_cfg="TQ03", bearing=308.0, half=14.0, r=(60000.0, 111000.0)),
}
LEAVES = {"NOCTIS": ("MI_V2_LeafDark", "MI_V2_LeafDark", "MI_V2_LeafMid", "MI_V2_PetalWhite"),
          "TARTARUS": ("MI_V2_LeafCopper", "MI_V2_LeafGold", "MI_V2_LeafMid", "MI_V2_LeafDark"),
          "ICARUS": ("MI_V2_LeafMid", "MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_PetalWhite")}
CAPS = {"NOCTIS": ("MI_V2_MushPurple", "MI_V2_MushCream"), "TARTARUS": ("MI_V2_MushRed", "MI_V2_MushTerracotta"),
        "ICARUS": ("MI_V2_MushCream", "MI_V2_PetalWhite")}
FLOWERS = ("WL_Flower_Rose_Run", "WL_Flower_Lavender_Run", "WL_Flower_Daisy_Run")
FLAGS = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")

H = 1620.0                     # a garden room's half-size to its hedge line (the rear seam's room)
HEDGE = (303.0, 71.0)          # SM_hedge_block half-extents (6.06 x 1.42 m)
#: clearance needed (cm, from the group's centre to anything standing) and caps per region
NEED = {"quarter": 4000.0, "room": 1800.0, "wood": 3600.0, "grove": 2000.0, "drift": 900.0}
CAP = {"quarter": 3, "room": 8, "wood": 1, "grove": 14, "drift": 16}


def set_frame(bearing, half_deg):
    W.BEARING = bearing
    r = math.radians(bearing)
    W.DIR = (math.cos(r), math.sin(r))
    W.LEFT = (-math.sin(r), math.cos(r))
    W.SEAM_HALF_DEG = half_deg


class Ground:
    """The region's free ground on a 5 m raster in the (u, v) frame, and each free cell's clearance."""

    def __init__(self, occ, r0, r1):
        self.occ = occ
        self.u0, self.u1 = r0, r1
        vmax = W.edge_v(r1)
        self.v0 = -vmax
        self.nu = int((r1 - r0) // CELL) + 1
        self.nv = int((2 * vmax) // CELL) + 1
        self.free = [[False] * self.nv for _ in range(self.nu)]
        self.lanes = set()
        self.paved = [[False] * self.nv for _ in range(self.nu)]
        for i in range(self.nu):
            u = self.u(i)
            e = W.edge_v(u)
            for j in range(self.nv):
                v = self.v(j)
                if abs(v) > e:
                    continue
                x, y = W.world(u, v)
                if occ.hits(x, y, CELL * 0.5, CELL * 0.5, W.BEARING, 0.0, ("paved", "way")):
                    self.paved[i][j] = True
                    continue
                self.free[i][j] = not occ.hits(x, y, CELL * 0.5, CELL * 0.5, W.BEARING, 150.0, LAYERS)
        self.recompute()

    def u(self, i):
        return self.u0 + CELL * (i + 0.5)

    def v(self, j):
        return self.v0 + CELL * (j + 0.5)

    def cell(self, u, v):
        return int((u - self.u0) // CELL), int((v - self.v0) // CELL)

    def recompute(self):
        """Clearance in cm: distance (8-connected BFS, in cells) from each free cell to the nearest non-free."""
        INF = 10 ** 9
        d = [[INF if self.free[i][j] else 0 for j in range(self.nv)] for i in range(self.nu)]
        q = deque((i, j) for i in range(self.nu) for j in range(self.nv) if d[i][j] == 0)
        while q:
            i, j = q.popleft()
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    a, b = i + di, j + dj
                    if 0 <= a < self.nu and 0 <= b < self.nv and d[a][b] > d[i][j] + 1:
                        d[a][b] = d[i][j] + 1
                        q.append((a, b))
        self.clear = [[(d[i][j] - 0.5) * CELL if d[i][j] < INF else 0.0 for j in range(self.nv)]
                      for i in range(self.nu)]

    def best(self, need):
        top, at = 0.0, None
        for i in range(self.nu):
            row = self.clear[i]
            for j in range(self.nv):
                if row[j] >= need and row[j] > top:
                    top, at = row[j], (i, j)
        return (self.u(at[0]), self.v(at[1]), top) if at else None

    def block(self, cells, r):
        """Mark every cell within r cells of the given cells as used (one clearance refresh for all)."""
        for (i, j) in cells:
            for a in range(max(0, i - r), min(self.nu, i + r + 1)):
                for b in range(max(0, j - r), min(self.nv, j + r + 1)):
                    self.free[a][b] = False
        self.recompute()

    def take(self, u, v, half_u, half_v):
        """Mark a box (in the frame) as used, then refresh clearances."""
        i0, j0 = self.cell(u - half_u, v - half_v)
        i1, j1 = self.cell(u + half_u, v + half_v)
        for i in range(max(0, i0), min(self.nu, i1 + 1)):
            for j in range(max(0, j0), min(self.nv, j1 + 1)):
                self.free[i][j] = False
        self.recompute()

    def nearest_free(self, u, v, radius_cells=12):
        """The free cell nearest (u, v), searching outward; or None."""
        c = self.cell(u, v)
        best = None
        for i in range(max(0, c[0] - radius_cells), min(self.nu, c[0] + radius_cells + 1)):
            for j in range(max(0, c[1] - radius_cells), min(self.nv, c[1] + radius_cells + 1)):
                if self.free[i][j]:
                    d = (i - c[0]) ** 2 + (j - c[1]) ** 2
                    if best is None or d < best[0]:
                        best = (d, (i, j))
        return best[1] if best else None

    def spine(self, a, b):
        """A walk from cell a to cell b through free cells, preferring clearance (Dijkstra, cost falls with
        clearance so the walk keeps to the middle of open ground rather than hugging what stands); or None."""
        import heapq
        dist = {a: 0.0}
        prev = {a: None}
        h = [(0.0, a)]
        while h:
            d, c = heapq.heappop(h)
            if c == b:
                out = []
                while c is not None:
                    out.append(c)
                    c = prev[c]
                return list(reversed(out))
            if d > dist.get(c, 1e18):
                continue
            i, j = c
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                n = (i + di, j + dj)
                if not (0 <= n[0] < self.nu and 0 <= n[1] < self.nv):
                    continue
                # A WALK MAY CROSS A ROAD: the ring roads run straight through every heartland, and a walk that
                # stopped at them would leave half the region unreachable. Paving costs a little more than
                # open lawn, so the walk crosses a road rather than following it.
                if self.paved[n[0]][n[1]]:
                    step = math.hypot(di, dj) * 3.0
                elif n in self.lanes:
                    step = math.hypot(di, dj) * 1.0          # a quarter's cross lane: the walk's own way through
                elif self.free[n[0]][n[1]]:
                    step = math.hypot(di, dj) * (1.0 + 6.0 / (1.0 + self.clear[n[0]][n[1]] / CELL))
                else:
                    continue
                nd = d + step
                if nd < dist.get(n, 1e18):
                    dist[n] = nd
                    prev[n] = c
                    heapq.heappush(h, (nd, n))
        return None

    def path_to_paving(self, u, v, max_cells=60):
        """Cells from (u, v) to the nearest free cell touching paving, through free cells (BFS); or None."""
        s = self.cell(u, v)
        if not (0 <= s[0] < self.nu and 0 <= s[1] < self.nv):
            return None
        prev = {s: None}
        q = deque([s])
        while q:
            c = q.popleft()
            i, j = c
            touch = any(0 <= i + a < self.nu and 0 <= j + b < self.nv and self.paved[i + a][j + b]
                        for a in (-1, 0, 1) for b in (-1, 0, 1))
            if touch:
                out = []
                while c is not None:
                    out.append(c)
                    c = prev[c]
                return list(reversed(out))
            for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (i + a, j + b)
                if n in prev or not (0 <= n[0] < self.nu and 0 <= n[1] < self.nv):
                    continue
                if not self.free[n[0]][n[1]] and n != s:
                    continue
                if abs(n[0] - s[0]) + abs(n[1] - s[1]) > max_cells:
                    continue
                prev[n] = c
                q.append(n)
        return None


# ------------------------------------------------------------------------------------------------ stamps
BENCH = W.V2 + "Props/Garden/SM_garden_bench.SM_garden_bench"
#: seven hedge blocks a side at 4.8 m pitch: each is 6.06 m long, so they overlap by 1.26 m -- a closed wall -- and
#: leaving out the middle one opens a 3.5 m door
WALL = (-1440.0, -960.0, -480.0, 0.0, 480.0, 960.0, 1440.0)


def bench(p, u, v, yaw_local):
    """SM_garden_bench (1.72 m long on its local Y) on the room's floor, turned by the caller to FACE the tree.

    Its seat faces local -X... measured, not assumed: the first rooms used the Golden Arrival clock garden's
    convention (ga02: yaw = the angle from the centre to the bench, "benches facing the fountain"), and an end-on
    frame (captures/passes/bench_profile__bench_check.png) showed every bench with its BACK to the tree. So the
    caller passes the angle from the bench TO the tree."""
    x, y = W.world(u, v)
    if p.occ.hits(x, y, 60.0, 110.0, yaw_local + W.BEARING, 10.0, ("existing",)):
        p.skipped["bench"] += 1
        return
    p.add("Bench", BENCH, p.mats.get("stone", "MI_V2_IvoryStone"), u, v, W.PAVING_TOP, yaw_local, 1.0, W.CULL_NEAR,
          collides=True)
    p.occ.add("solid", x, y, 60.0, 110.0, yaw_local + W.BEARING, "%s:bench" % p.id)
    p.stats["bench"] += 1


def garden_room(p, uc, vc, leaves, k, doors_v=False):
    """A garden room: closed hedge walls with a door in the middle of two opposite sides (the sides facing along u,
    or with doors_v the sides facing across v), topiary corners, a paved floor with a rose border, four flower
    beds, a tree at the centre and a pair of benches facing it."""
    # CLOSED WALLS. Core, from the door-level frame of 2026-09-29: "the hedge 'walls' read as separate blocks, so
    # there is no enclosure". The room's own hedges and corner cones overlap each other on purpose, so they are
    # tested only against what already stands (the census), not against one another.
    for e in WALL:
        for (du, dv, yaw) in ((e, -H, 0.0), (e, H, 0.0), (-H, e, 90.0), (H, e, 90.0)):
            if e == 0.0 and ((dv == 0.0) if not doors_v else (du == 0.0)):
                continue
            p.plant("hedge", uc + du, vc + dv, 1.0, "MI_V2_LeafMid", yaw, margin=0.0, rect=HEDGE,
                    layers=("existing",))
    for (du, dv) in ((-H, -H), (-H, H), (H, -H), (H, H)):
        p.plant("topiary_cone", uc + du, vc + dv, 1.2, leaves[0], 0.0, margin=0.0, radius=90.0,
                layers=("existing",))
    # THE ROOM'S OWN GROUND. Core, from the in-engine frames of 2026-09-29: "from 70 m up the rooms read as thin
    # outlines on the lawn -- low hedges and stepping stones have little height and no ground colour inside".
    # So the room is floored in the nation's warm paving (2 x 4 plates, 28.8 x 29.6 m, inside the hedge line at
    # 32.4), 26 cm up -- a step at the doors, as at every court -- and its beds stand on that floor.
    floor = p.mats.get("paving_warm") or p.mats.get("paving")
    for c in (-0.5, 0.5):
        for r in (-1.5, -0.5, 0.5, 1.5):
            p.plate(uc + r * W.PLATE["len_y"], vc + c * W.PLATE["len_x"], floor, "RoomFloor", layer="paved")
    for (du, dv) in ((-600.0, -600.0), (600.0, -600.0), (-600.0, 600.0), (600.0, 600.0)):
        for q in range(5):
            p.add_module(FLOWERS[(q + k) % 3], uc + du + (q - 2) * 130.0, vc + dv, W.PAVING_TOP + 2.0, 0.0,
                         cull=W.CULL_NEAR, collide=False, check=False)
    # A ROSE BORDER on the floor's rim, inside the hedge line, broken at the two doors: the colour that reads
    # against the pale floor at eye level (Core: "the beds vanish as thin lines"). Roses do not collide.
    for t in range(-1350, 1351, 300):
        rim = [(float(t), -1330.0), (float(t), 1330.0)]
        if abs(t) < 1350:
            rim += [(-1370.0, float(t)), (1370.0, float(t))]
        for (du, dv) in rim:
            on_door_side = (abs(du) == 1370.0) if not doors_v else (abs(dv) == 1330.0)
            if on_door_side and abs(t) < 300:
                continue
            p.plant("rose", uc + du, vc + dv, 0.9, "MI_V2_RosePink", 0.0, margin=0.0, radius=90.0,
                    layers=("existing",), base_z=W.PAVING_TOP)
    # ...and ONE TALL ELEMENT, which is what reads from the air and from the march: a mature tree in a grate at
    # the room's centre (where the rose stood), allowed on the room's own floor
    p.add_module("WL_Ground_Tree_Grate", uc, vc, W.PAVING_TOP + 0.5, 0.0, cull=W.CULL_NEAR, collide=False,
                 check=False)
    p.plant("tree_mature", uc, vc, 1.0, leaves[1], 0.0, margin=0.0, layers=("existing", "solid"),
            base_z=W.PAVING_TOP)
    # A BENCH PAIR facing the tree, on the axis the doors are NOT on, so the way in from either door is clear
    for s in (-1.0, 1.0):
        if not doors_v:
            bench(p, uc, vc + s * 420.0, 90.0 * s)
        else:
            bench(p, uc + s * 420.0, vc, 0.0 if s > 0 else 180.0)
    p.stats["garden_room"] += 1


def stepping(p, cells, g, rng):
    """Stepping flags every ~4.5 m along a raster path."""
    last = None
    k = 0
    for (i, j) in cells:
        u, v = g.u(i), g.v(j)
        if last is not None and math.hypot(u - last[0], v - last[1]) < 450.0:
            continue
        p.add_module(FLAGS[k % 3], u + rng.uniform(-40.0, 40.0), v + rng.uniform(-40.0, 40.0), W.GROUND_Z + 1.0,
                     rng.uniform(-8.0, 8.0), scale=0.55, cull=W.CULL_NEAR, collide=False, margin=10.0,
                     layer="paved", layers=("existing", "solid"))
        last = (u, v)
        k += 1
    p.stats["stepping_stones"] += k


def edge_point(occ, pid, x, y, reach=1500.0):
    """The nearest point on any CENSUS paving rectangle (not this pass's own stones) within reach of (x, y)."""
    best = None
    seen = set()
    for k in occ._keys(x, y, reach + 4000.0):
        for rec in occ.layers["paved"].get(k, ()):
            if id(rec) in seen or str(rec[5]).startswith(pid + ":"):
                continue
            seen.add(id(rec))
            rx, ry, hx, hy, yaw = rec[:5]
            c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
            lx, ly = (x - rx) * c + (y - ry) * s, -(x - rx) * s + (y - ry) * c
            qx, qy = max(-hx, min(hx, lx)), max(-hy, min(hy, ly))
            d = math.hypot(lx - qx, ly - qy)
            if d <= reach and (best is None or d < best[0]):
                best = (d, rx + qx * c - qy * s, ry + qx * s + qy * c)
    return best


STOP_SHORT = 120.0             # cm short of the paving's edge: the rings' kerb stones stand on that edge line


def finish_to_edge(p, occ, x, y, rng):
    """THE JUNCTION: from the path's last stone, straight on to just outside the paving it was joining -- the
    stones stop AT the road's edge (Core: existing floor is the junction), not on it and not metres short. Short
    of the edge by STOP_SHORT because the ring roads are kerbed: a stone 60 cm out lands on the kerb line and the
    occupancy refuses it (the first version counted those refusals as placed)."""
    e = edge_point(occ, p.id, x, y)
    if e is None or e[0] < STOP_SHORT + 150.0:
        return
    d, ex, ey = e
    n = max(1, int((d - STOP_SHORT) // 450.0))
    for q in range(1, n + 1):
        t = (q * 450.0) / d if q < n else (d - STOP_SHORT) / d
        wx, wy = x + (ex - x) * t, y + (ey - y) * t
        u = wx * W.DIR[0] + wy * W.DIR[1]
        v = wx * W.LEFT[0] + wy * W.LEFT[1]
        if p.add_module(FLAGS[q % 3], u, v, W.GROUND_Z + 1.0, rng.uniform(-8.0, 8.0), scale=0.55,
                        cull=W.CULL_NEAR, collide=False, margin=10.0, layer="paved", layers=("existing", "solid")):
            p.stats["junction_stones"] += 1
        else:
            p.stats["junction_refused"] += 1


def join(p, g, doors, rng):
    """Join a group to the paving from whichever of its doors has the shorter free path."""
    best = None
    for (u, v) in doors:
        path = g.path_to_paving(u, v)
        if path and (best is None or len(path) < len(best)):
            best = path
    if best:
        stepping(p, best, g, rng)
        p.stats["joined"] += 1
    else:
        p.stats["not_joined"] += 1


def grove(p, gu, gv, leaves, rng):
    gr = rng.uniform(1300.0, 1700.0)          # trees inside gr, the understorey rim to gr + 7 m: inside NEED + 1 m
    n_tree = rng.randint(6, 11)
    placed = 0
    for _ in range(n_tree * 4):
        if placed >= n_tree:
            break
        t, d = rng.uniform(0, math.tau), gr * math.sqrt(rng.random())
        kind = "tree_slender" if rng.random() < 0.8 else "tree_mature"
        if p.plant(kind, gu + math.cos(t) * d, gv + math.sin(t) * d, rng.uniform(0.85, 1.2), rng.choice(leaves),
                   rng.uniform(0, 360), margin=60.0):
            placed += 1
    for _ in range(rng.randint(5, 9)):
        t = rng.uniform(0, math.tau)
        d = gr + rng.uniform(200.0, 700.0)
        p.plant(rng.choice(("shrub", "shrub", "rose")), gu + math.cos(t) * d, gv + math.sin(t) * d,
                rng.uniform(0.8, 1.25), leaves[2], rng.uniform(0, 360), margin=0.0, radius=110.0)
    p.stats["trees"] += placed
    p.stats["grove"] += 1


def drift(p, gu, gv, rng):
    sp = FLOWERS[rng.randint(0, 2)]
    arc0 = rng.uniform(0, math.tau)
    for q in range(rng.randint(8, 14)):
        t = arc0 + q * 0.22
        d = rng.uniform(300.0, 700.0)
        p.add_module(sp, gu + math.cos(t) * d, gv + math.sin(t) * d, W.GROUND_Z + 2.0, math.degrees(t) + 90.0,
                     cull=W.CULL_NEAR, collide=False, check=False)
    p.stats["meadow_drift"] += 1


def wood(p, mu, mv, nation, leaves, rng):
    caps = CAPS[nation]
    n = 0
    for _ in range(70):
        if n >= 16:
            break
        t, d = rng.uniform(0, math.tau), 2800.0 * math.sqrt(rng.random())
        name = rng.choice(("WL_Mushroom_Toadstool", "WL_Mushroom_Tall", "WL_Mushroom_Tall", "WL_Mushroom_Button"))
        sc = rng.uniform(1.2, 3.2) if name != "WL_Mushroom_Button" else rng.uniform(1.0, 1.8)
        mm = {"mush_cap": caps[n % 2], "mush_gill": "MI_V2_MushCream", "mush_spot": "MI_V2_PetalWhite",
              "mush_stem": "MI_V2_MushStem"}
        if p.add_module(name, mu + math.cos(t) * d, mv + math.sin(t) * d, W.GROUND_Z, rng.uniform(0, 360),
                        scale=sc, cull=W.CULL_MID, record=True, margin=150.0, mats=mm, layers=LAYERS):
            n += 1
    for _ in range(10):
        t, d = rng.uniform(0, math.tau), rng.uniform(2600.0, 3600.0)
        p.plant("tree_slender", mu + math.cos(t) * d, mv + math.sin(t) * d, rng.uniform(0.9, 1.15), leaves[0],
                rng.uniform(0, 360), margin=60.0)
    p.stats["mushrooms"] += n
    p.stats["wood"] += 1


# ------------------------------------------------------------------------------------------------ a region
def fill(pid, R):
    set_frame(R["bearing"], R["half"])
    cfg = W.NB.NATIONS[R["nation_cfg"]]
    nation = cfg["nation"]
    leaves = LEAVES[nation]
    occ = W.Occupancy()
    n_census = W.load_census(occ)
    g = Ground(occ, *R["r"])
    free0 = sum(sum(1 for f in row if f) for row in g.free) * (CELL / 100.0) ** 2
    rng = random.Random("sector-fill-" + pid)
    p = W.Pass(pid, ["WL_SECTOR_FILL", "WL_NATION_" + nation, "WL_DISTRICT_%s_HEARTLAND" % nation],
               "Wonderland/Authored/%s_%sHeartland" % (pid, nation.title()), dict(cfg["materials"]), occ, pid)
    groups = []
    off = H + 600.0                                       # a quarter's rooms stand at +/-off from its centre

    def quarter(uc, vc):
        for k, (su, sv) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1))):
            garden_room(p, uc + su * off, vc + sv * off, leaves, k)
        lane = [(g.cell(uc + t, vc)) for t in range(-int(2 * off), int(2 * off) + 1, 450)] + \
               [(g.cell(uc, vc + t)) for t in range(-int(2 * off), int(2 * off) + 1, 450)]
        stepping(p, lane, g, rng)
        # (no centrepiece in the crossing: the garden walk runs through it -- zzW35 swept into the old one)
        g.take(uc, vc, off + H + 300.0, off + H + 300.0)
        p.stats["quarter"] += 1
        groups.append(("quarter", uc, vc))

    def room(uc, vc, doors_v=False):
        garden_room(p, uc, vc, leaves, p.stats["room_single"], doors_v=doors_v)
        g.take(uc, vc, H + 300.0, H + 300.0)
        p.stats["room_single"] += 1
        groups.append(("room_v" if doors_v else "room", uc, vc))

    def link(u0, v0, u1, v1):
        """A short straight line of stepping stones (a room's door to the walk beside it)."""
        n = max(1, int(math.hypot(u1 - u0, v1 - v0) // 450.0))
        for q in range(1, n + 1):
            t = q / float(n + 1)
            p.add_module(FLAGS[q % 3], u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, W.GROUND_Z + 1.0,
                         rng.uniform(-8.0, 8.0), scale=0.55, cull=W.CULL_NEAR, collide=False, margin=10.0,
                         layer="paved", layers=("existing", "solid"))
            p.stats["stepping_stones"] += 1

    qboxes = []

    def clearance_at(u, v):
        i, j = g.cell(u, v)
        return g.clear[i][j] if 0 <= i < g.nu and 0 <= j < g.nv else 0.0

    # 1. THE GARDEN WALK: a spine through the heartland's open ground, from its inner edge to its outer one,
    #    keeping to the middle of the open ground. Everything else is composed along it.
    a = g.nearest_free(R["r"][0] + 3000.0, 0.0, 20)
    b = g.nearest_free(R["r"][1] - 3000.0, 0.0, 20)
    walk = g.spine(a, b) if (a and b) else None
    if walk:
        # 2a. GARDEN QUARTERS ON THE WALK, where it crosses 80 m of clear ground (every ~45 m)
        k = 12
        while k < len(walk) - 12 and p.stats["quarter"] < CAP["quarter"]:
            u, v = g.u(walk[k][0]), g.v(walk[k][1])
            if clearance_at(u, v) >= NEED["quarter"]:
                quarter(u, v)
                qboxes.append((u, v, off + H + 300.0))
                k += 18
            else:
                k += 3
        # 2b. THE WALK REDRAWN THROUGH THEIR LANES. The first route was drawn before the quarters stood, and
        #     inside a quarter it wandered off the cross lane into the rooms' corners: the in-play proof (zzW35)
        #     swept 12 blocks into topiary in HT356. Each quarter's lanes are reopened as the walk's preferred
        #     ground (3 m either side of the lane's centre line), and the walk is drawn again.
        for (qu, qv, qh) in qboxes:
            i0, j0 = g.cell(qu - qh, qv - qh)
            i1, j1 = g.cell(qu + qh, qv + qh)
            for i in range(max(0, i0), min(g.nu, i1 + 1)):
                for j in range(max(0, j0), min(g.nv, j1 + 1)):
                    if abs(g.u(i) - qu) <= 300.0 or abs(g.v(j) - qv) <= 300.0:
                        g.free[i][j] = True
                        g.lanes.add((i, j))
        g.recompute()
        again = g.spine(a, b)
        if again:
            walk = again
        # 2c. ...and its corridor is RESERVED before any room is placed beside it: HN181's rooms stood on the walk
        #     where it bent toward them (zzW35: 6 blocks into hedges), their clearance having been tested against
        #     a corridor nothing had claimed yet
        g.block(walk, 1)
        p.stats["walk_m"] = int(len(walk) * CELL / 100)
        # 2d. SINGLE ROOMS BESIDE THE WALK, a door turned to it, every ~45 m where there is room
        k = 12
        while k < len(walk) - 12:
            i, j = walk[k]
            u, v = g.u(i), g.v(j)
            if any(abs(u - qu) <= qh + 1500.0 and abs(v - qv) <= qh + 1500.0 for (qu, qv, qh) in qboxes):
                k += 3
                continue
            du = g.u(walk[k + 4][0]) - g.u(walk[k - 4][0])
            dv = g.v(walk[k + 4][1]) - g.v(walk[k - 4][1])
            n = math.hypot(du, dv) or 1.0
            pu, pv = -dv / n, du / n                              # perpendicular to the walk
            placed = False
            for s_ in (1.0, -1.0):
                ru, rv = u + s_ * pu * (H + 900.0), v + s_ * pv * (H + 900.0)
                if p.stats["room_single"] < CAP["room"] and clearance_at(ru, rv) >= NEED["room"]:
                    room(ru, rv, doors_v=abs(pv) >= abs(pu))
                    du_, dv_ = (0.0, -s_ * H * (1 if pv >= 0 else -1)) if abs(pv) >= abs(pu) else                         (-s_ * H * (1 if pu >= 0 else -1), 0.0)
                    link(ru + du_, rv + dv_, u, v)
                    placed = True
            k += 10 if placed else 3
        # 3. THE MUSHROOM WOOD, the walk's destination: the most open ground within 150 m of its outer end
        eu, ev = g.u(walk[-1][0]), g.v(walk[-1][1])
        best = None
        for i in range(g.nu):
            for j in range(g.nv):
                c = g.clear[i][j]
                if c >= NEED["wood"] and math.hypot(g.u(i) - eu, g.v(j) - ev) < 15000.0:
                    if best is None or c > best[0]:
                        best = (c, g.u(i), g.v(j))
        if best:
            wood(p, best[1], best[2], nation, leaves, rng)
            g.take(best[1], best[2], 3600.0, 3600.0)
            groups.append(("wood", best[1], best[2]))
    else:
        p.stats["no_walk"] += 1

    # 4. GROVES in a belt beyond the rooms (within 130 m of the walk when there is one), largest ground first
    near_walk = set(walk or [])

    def in_belt(u, v):
        if not walk:
            return True
        i, j = g.cell(u, v)
        r = int(13000.0 // CELL)
        return any((i + a_, j + b_) in near_walk for a_ in range(-r, r + 1, 3) for b_ in range(-r, r + 1, 3))

    tries = 0
    while p.stats["grove"] < CAP["grove"] and tries < 200:
        tries += 1
        at = g.best(NEED["grove"])
        if at is None:
            break
        if not in_belt(at[0], at[1]):
            g.take(at[0], at[1], 1000.0, 1000.0)                  # leave that ground as lawn, look elsewhere
            continue
        grove(p, at[0], at[1], leaves, rng)
        g.take(at[0], at[1], 2400.0, 2400.0)
        groups.append(("grove", at[0], at[1]))

    # the walk itself, in stepping stones, and joined to the paving at both ends (laid last, round the groups)
    if walk:
        # through a quarter the walk IS the quarter's cross lane, which already has its stones
        outside = [c for c in walk if not g.paved[c[0]][c[1]]
                   and not any(abs(g.u(c[0]) - qu) <= qh and abs(g.v(c[1]) - qv) <= qh for (qu, qv, qh) in qboxes)]
        stepping(p, outside, g, rng)
        # the corridor was blocked for the groves; the ends' joins search from free ground just beyond it
        for end, beyond in ((walk[0], -1), (walk[-1], 1)):
            eu, ev = g.u(end[0]), g.v(end[1])
            c = g.nearest_free(eu + beyond * 1000.0, ev, 6)
            if c is not None:
                cells = g.path_to_paving(g.u(c[0]), g.v(c[1]))
                if cells:
                    stepping(p, cells, g, rng)
                    lu, lv = g.u(cells[-1][0]), g.v(cells[-1][1])
                    finish_to_edge(p, occ, *W.world(lu, lv), rng)
                    p.stats["joined"] += 1
                    continue
            p.stats["not_joined"] += 1
    while p.stats["meadow_drift"] < CAP["drift"]:
        at = g.best(NEED["drift"])
        if at is None:
            break
        drift(p, at[0], at[1], rng)
        g.take(at[0], at[1], 900.0, 900.0)
        groups.append(("drift", at[0], at[1]))

    free1 = sum(sum(1 for f in row if f) for row in g.free) * (CELL / 100.0) ** 2
    # THE OFFLINE SWEEP, before any editor sees it: every walk cell, a Dog-sized square (45 cm + 15 cm), against
    # what stands (the census) and what this fill made solid -- the in-play proof's capsule, approximated
    if walk:
        for (i, j) in walk:
            x, y = W.world(g.u(i), g.v(j))
            if occ.hits(x, y, 60.0, 60.0, W.BEARING, 0.0, ("existing", "solid")) and not g.paved[i][j]:
                p.stats["walk_blocked_offline"] += 1
    return p, n_census, free0, free1, groups, [(g.u(i), g.v(j)) for (i, j) in (walk or [])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    want = [s for s in a.only.split(",") if s] or list(REGIONS)
    with gzip.open(W.CENSUS, "rt", encoding="utf-8") as f:
        text = f.read()
    rows = []
    for pid in want:
        if ("," + pid + "_") in text:
            raise SystemExit("REFUSED: the census already contains %s -- a fill must not regenerate itself from a "
                             "world that holds it" % pid)
        R = REGIONS[pid]
        p, n_census, free0, free1, groups, walk_uv = fill(pid, R)
        # THE SIDECAR the in-play proof walks: the walk as a world polyline (every 5 m cell), and every group
        # with its centre and, for rooms, the door points (a quarter's rooms are listed one by one)
        side = {"pass": pid, "bearing": R["bearing"], "walk": [[round(c, 1) for c in W.world(u, v)] for (u, v) in walk_uv],
                "groups": []}
        off = H + 600.0
        for (kind, u, v) in groups:
            if kind == "quarter":
                for (su, sv) in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                    ru, rv = u + su * off, v + sv * off
                    side["groups"].append({"kind": "quarter_room", "centre": [round(c, 1) for c in W.world(ru, rv)],
                                           "doors": [[round(c, 1) for c in W.world(ru + d * (H + 250.0), rv)]
                                                     for d in (-1, 1)]})
                side["groups"].append({"kind": "quarter", "centre": [round(c, 1) for c in W.world(u, v)],
                                       "lane_ends": [[round(c, 1) for c in W.world(u + d * (off + H + 250.0), v)]
                                                     for d in (-1, 1)]})
            elif kind in ("room", "room_v"):
                doors = [(u + d * (H + 250.0), v) for d in (-1, 1)] if kind == "room" else                         [(u, v + d * (H + 250.0)) for d in (-1, 1)]
                side["groups"].append({"kind": "room", "centre": [round(c, 1) for c in W.world(u, v)],
                                       "doors": [[round(c, 1) for c in W.world(a, b)] for (a, b) in doors]})
            else:
                side["groups"].append({"kind": kind, "centre": [round(c, 1) for c in W.world(u, v)]})
        (HERE / ("%s_walk.json" % pid.lower())).write_text(json.dumps(side, indent=1), encoding="utf-8")
        spec = p.spec()
        nation = W.NB.NATIONS[R["nation_cfg"]]["nation"]
        out = "%s_%s_heartland.json" % (pid.lower(), nation.lower())
        (HERE / out).write_text(json.dumps(spec, indent=1), encoding="utf-8")
        total = sum(len(b["instances"]) for b in spec["batches"])
        print("%s -> %s  bearing %.0f  census rows %d  free %.1f ha -> %.1f ha left as lawn  batches %d  "
              "instances %d" % (pid, out, R["bearing"], n_census, free0 / 1e4, free1 / 1e4, len(spec["batches"]),
                                total))
        print("   " + ", ".join("%s %d" % kv for kv in sorted(p.stats.items()) if kv[0] in
                                  ("quarter", "wood", "room_single", "garden_room", "grove", "trees", "meadow_drift",
                                   "mushrooms", "stepping_stones", "junction_stones", "junction_refused", "joined", "not_joined", "walk_m", "no_walk", "walk_blocked_offline")))
        if p.skipped:
            print("   refused by the occupancy: " + ", ".join("%s %d" % kv for kv in p.skipped.most_common(8)))
        rows += [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], pid) for r in p.new_rows]
    with gzip.open(HERE / "sector_fill_new_placements.csv.gz", "wt", encoding="utf-8", newline="") as f:
        f.write("kind,x,y,z,ex,ey,ez,yaw,mesh,owner\n")
        for (k, x, y, z, ex, ey, ez, mesh, owner) in rows:
            f.write("%s,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,0,%s,%s\n" % (k, x, y, z, ex, ey, ez, mesh, owner))


if __name__ == "__main__":
    main()
