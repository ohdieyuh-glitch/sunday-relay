#!/usr/bin/env python3
"""THE WILD RING -- Dubel Forest's language carried round the rest of the world beyond the nations (R50).

WHY. Assignment #4 in WORLD_COMPLETION_MATRIX.md: the frontiers, then the wild ring, "forest, mushroom woods,
meadows with purpose -- Dubel's clearings are the model". The census after the ring roads puts 1,200-1,500 m at
64-84% empty (emptiness.py --structure). Dubel Forest (DF01, Districts/dubel_forest.py) holds 58-122 degrees; this
is the other 296 degrees, in six woods split by nation so each takes its nation's leaves and caps:

    WI030  ICARUS    30- 58      WN150  NOCTIS    150-210      WT270  TARTARUS  270-330
    WI122  ICARUS   122-150      WN210  NOCTIS    210-270      WT330  TARTARUS  330- 30

DUBEL'S SIX RULES, kept: density that means something (dense heart at mid-radius, thinning toward both edges,
deterministic), CLEARINGS placed first and respected by everything after, A PATH, vertical variation (two trunk
kinds, scale jitter), UNDERGROWTH at the trunks, LANDMARK mushrooms tall enough to show over the canopy.

THE PATH IS ONE TRAIL ROUND THE WORLD. Each wood's trail starts and ends on the arc boundaries at the radius Dubel's
own path formula gives there, r(b) = mid + 52 m sin(2.3 b) + 21 m sin(5.7 b) -- so neighbouring woods meet, and the
woods either side of Dubel meet Dubel's path at 58 and 122 degrees. Between its ends each trail is routed through
the wood's open ground (Dijkstra, cost falling with clearance), so it goes round what already stands.

PERFORMANCE, remeasured (zc_veg_cost, 2026-09-29): every tree, shrub and topiary mesh is now Nanite (trunks ~1 k
triangles, canopies 3.0-4.8 k), so Dubel's 620-tree ceiling -- set when a large canopy was 31 k triangles with one
LOD -- is not this pass's; a wood takes about ten trees per degree, as Dubel did.

The ground is the census through w270_rear_seam's occupancy with its radial band widened to this ring (CENSUS_R);
an offline capsule sweep of every trail runs before any editor sees it.

    python wild_ring.py [--only WN150,...]     writes <id>_<nation>_wood.json + <id>_walk.json per wood
"""
import argparse
import gzip
import json
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sector_fill as S                                          # noqa: E402  frame, ground raster, stamps
W = S.W

R_IN, R_OUT = 120000.0, 148000.0
MID = 0.5 * (R_IN + R_OUT)
WOODS = {
    "WI030": dict(nation_cfg="IC03", b0=30.0, b1=58.0),
    "WI122": dict(nation_cfg="IC03", b0=122.0, b1=150.0),
    "WN150": dict(nation_cfg="NC03", b0=150.0, b1=210.0),
    "WN210": dict(nation_cfg="NC03", b0=210.0, b1=270.0),
    "WT270": dict(nation_cfg="TQ03", b0=270.0, b1=330.0),
    "WT330": dict(nation_cfg="TQ03", b0=330.0, b1=390.0),
}
TREES_PER_DEG = 10.0
MUSH = "/Game/WonderlandV2/Mushrooms/%s/%s.%s"
LANDMARK_MAT = {"ICARUS": "MI_V2_MushCream", "NOCTIS": "MI_V2_MushPurple", "TARTARUS": "MI_V2_MushRed"}


def trail_r(b_deg):
    """Dubel's path radius at a bearing (its formula, so the woods' trails meet it and each other)."""
    return MID + 5200.0 * math.sin(math.radians(b_deg * 2.3)) + 2100.0 * math.sin(math.radians(b_deg * 5.7))


def density_at(r):
    """1.0 at mid-radius, falling to 0 at both edges -- Dubel's field."""
    t = abs(r - MID) / (0.5 * (R_OUT - R_IN))
    return max(0.0, 1.0 - t * t)


def clearing(p, g, cu, cv, rad, nation, rng, trail_uv):
    """A clearing: kept open, a landmark mushroom at its outer edge, and a rim of flowering shrubs -- broken where
    the trail comes in and goes out (the first trial ringed the trail shut: two offline-sweep blocks)."""
    # the landmark first (the first trial planted the rim first, and the rim's own claims refused every landmark), at
    # the clearing's outer edge -- or, where that is taken (WI030's was), the first free place round the rim, never
    # within 6 m of the trail (it collides)
    for ang in (0.0, 180.0, 90.0, 270.0, 45.0, 135.0, 225.0, 315.0):
        lu = cu + rad * 0.85 * math.cos(math.radians(ang))
        lv = cv + rad * 0.85 * math.sin(math.radians(ang))
        if any(math.hypot(lu - tu, lv - tv) < 600.0 for (tu, tv) in trail_uv):
            continue
        x, y = W.world(lu, lv)
        if p.occ.hits(x, y, 500.0, 500.0, W.BEARING, 100.0, ("existing", "solid", "paved", "way")):
            continue
        mesh = "SM_mushroom_giant" if rng.random() < 0.7 else "SM_mushroom_landmark"
        p.add("Landmark", MUSH % ("Landmark", mesh, mesh), LANDMARK_MAT[nation], lu, lv, W.GROUND_Z - 5.0, 180.0,
              rng.uniform(1.3, 1.7) if mesh == "SM_mushroom_giant" else rng.uniform(1.8, 2.2), W.CULL_FAR,
              collides=True)
        p.occ.add("solid", x, y, 500.0, 500.0, W.BEARING, "%s:landmark" % p.id)
        p.stats["landmark"] += 1
        break
    n = int(2 * math.pi * rad / 450.0)
    for k in range(n):
        t = 2 * math.pi * k / n + rng.uniform(-0.05, 0.05)
        su = cu + math.cos(t) * (rad + rng.uniform(0, 200))
        sv = cv + math.sin(t) * (rad + rng.uniform(0, 200))
        if any(math.hypot(su - tu, sv - tv) < 500.0 for (tu, tv) in trail_uv):
            continue                                       # the trail's way in and out
        p.plant("shrub", su, sv, rng.uniform(0.6, 0.95), "MI_V2_LeafMid", rng.uniform(0, 360), margin=0.0,
                radius=110.0)
    p.stats["clearing"] += 1


def wood(pid, D):
    arc = D["b1"] - D["b0"]
    bc = (D["b0"] + D["b1"]) * 0.5
    half = arc * 0.5
    S.set_frame(bc % 360.0, half)
    W.CENSUS_R = (R_IN - 10000.0, R_OUT + 4000.0)
    cfg = W.NB.NATIONS[D["nation_cfg"]]
    nation = cfg["nation"]
    leaves = S.LEAVES[nation]
    occ = W.Occupancy()
    n_census = W.load_census(occ)
    # THE RASTER IS THE RING'S SECTOR. Ground's raster is a wedge in the bearing frame, u from r0 to r1. With r0 = R_IN
    # it missed the ring's inner flanks (u < R_IN where the radius is still > R_IN: 186 m of the ring's 280 m at 30
    # degrees off the arc's centre), and its outer corners ran past R_OUT (radius u / cos(off), 1,709 m at 30
    # degrees) -- the emptiest ground, so the first plan's mushroom patches went there, up to 153 m past the ring.
    # Now it spans the whole sector and every cell off the annulus is closed.
    g = S.Ground(occ, R_IN * math.cos(math.radians(half)), R_OUT)
    for i in range(g.nu):
        for j in range(g.nv):
            if g.free[i][j] and not (R_IN <= math.hypot(*W.world(g.u(i), g.v(j))) <= R_OUT):
                g.free[i][j] = False
    g.recompute()
    rng = random.Random("wild-ring-" + pid)
    p = W.Pass(pid, ["WL_WILD_RING", "WL_NATION_" + nation, "WL_DISTRICT_%s_WILDWOOD" % nation],
               "Wonderland/Authored/%s_%sWood" % (pid, nation.title()), dict(cfg["materials"]), occ, pid)

    def to_frame(b_deg, r):
        x, y = r * math.cos(math.radians(b_deg)), r * math.sin(math.radians(b_deg))
        return x * W.DIR[0] + y * W.DIR[1], x * W.LEFT[0] + y * W.LEFT[1]

    # 1. THE TRAIL, from boundary to boundary at Dubel's radius, through open ground
    a_uv = to_frame(D["b0"] + 0.4, trail_r(D["b0"]))
    b_uv = to_frame(D["b1"] - 0.4, trail_r(D["b1"]))
    a = g.nearest_free(a_uv[0], a_uv[1], 30)
    b = g.nearest_free(b_uv[0], b_uv[1], 30)
    # the router keeps to open ground, and the outer band is the emptiest: left alone the trail ran along the world's
    # edge (~1,450 m). So it also pays for straying from Dubel's path radius: x2 at 20 m off, x10 at 60 m.
    def pref(cell):
        x, y = W.world(g.u(cell[0]), g.v(cell[1]))
        off = abs(math.hypot(x, y) - trail_r(math.degrees(math.atan2(y, x)) % 360.0)) / 2000.0
        return 1.0 + off * off
    g.pref = pref
    walk = g.spine(a, b) if (a and b) else None
    g.pref = None
    groups = []
    if walk:
        p.stats["trail_m"] = int(len(walk) * S.CELL / 100)
        # 2. CLEARINGS on the trail (placed first, kept open): one per ~30 degrees, at even fractions of it
        n_clear = max(1, int(round(arc / 30.0)))
        trail_uv = [(g.u(i), g.v(j)) for (i, j) in walk]
        for q in range(n_clear):
            i, j = walk[int(len(walk) * (q + 0.5) / n_clear)]
            cu, cv = g.u(i), g.v(j)
            rad = rng.uniform(2500.0, 3500.0)
            clearing(p, g, cu, cv, rad, nation, rng, trail_uv)
            g.take(cu, cv, rad, rad)
            groups.append({"kind": "clearing", "centre": [round(c, 1) for c in W.world(cu, cv)],
                           "radius": round(rad)})
        # the trail's corridor is reserved before the trees
        g.block(walk, 1)
    else:
        p.stats["no_trail"] += 1

    # 3. THE FOREST: candidates across the wood, accepted by Dubel's density field, placed through the occupancy
    target = int(TREES_PER_DEG * arc)
    free_cells = [(i, j) for i in range(g.nu) for j in range(g.nv) if g.free[i][j]]
    rng.shuffle(free_cells)
    trees = 0
    for (i, j) in free_cells:
        if trees >= target:
            break
        u, v = g.u(i) + rng.uniform(-200, 200), g.v(j) + rng.uniform(-200, 200)
        x, y = W.world(u, v)
        if rng.random() > density_at(math.hypot(x, y)):
            continue
        kind = "tree_slender" if rng.random() < 0.62 else "tree_mature"
        if p.plant(kind, u, v, rng.uniform(0.8, 1.25), rng.choice(leaves + ("MI_V2_LeafCopper", "MI_V2_LeafGold")),
                   rng.uniform(0, 360), margin=60.0):
            trees += 1
            # UNDERGROWTH at the trunk, on roughly half of them
            if rng.random() < 0.5:
                t = rng.uniform(0, math.tau)
                d = rng.uniform(250.0, 450.0)
                p.plant(rng.choice(("shrub", "shrub", "rose")), u + math.cos(t) * d, v + math.sin(t) * d,
                        rng.uniform(0.6, 1.0), leaves[2], rng.uniform(0, 360), margin=0.0, radius=100.0)
    p.stats["trees"] = trees

    # 4. MUSHROOM PATCHES in the forest (one per ~20 degrees), where the ground still has room: a patch is its
    # mushrooms within 28 m and a ring of trees at 26-36 m (sector_fill.wood), so it needs 36 m of open ring round it
    for _ in range(max(1, int(arc / 20.0))):
        at = g.best(3600.0)
        if at is None:
            break
        S.wood(p, at[0], at[1], nation, leaves, rng)
        g.take(at[0], at[1], 3000.0, 3000.0)
        groups.append({"kind": "mushrooms", "centre": [round(c, 1) for c in W.world(at[0], at[1])]})

    # 5. THE TRAIL'S STONES, laid last round everything
    if walk:
        S.stepping(p, [c for c in walk if not g.paved[c[0]][c[1]]], g, rng)
        # the offline sweep: every trail cell, a Dog-sized square, against what stands and what this wood made solid
        for (i, j) in walk:
            x, y = W.world(g.u(i), g.v(j))
            if occ.hits(x, y, 60.0, 60.0, W.BEARING, 0.0, ("existing", "solid")) and not g.paved[i][j]:
                p.stats["trail_blocked_offline"] += 1
    return p, n_census, groups, [(g.u(i), g.v(j)) for (i, j) in (walk or [])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    want = [s for s in a.only.split(",") if s] or list(WOODS)
    with gzip.open(W.CENSUS, "rt", encoding="utf-8") as f:
        text = f.read()
    for pid in want:
        if ("," + pid + "_") in text:
            raise SystemExit("REFUSED: the census already contains %s" % pid)
        D = WOODS[pid]
        p, n_census, groups, walk_uv = wood(pid, D)
        spec = p.spec()
        nation = W.NB.NATIONS[D["nation_cfg"]]["nation"]
        out = "%s_%s_wood.json" % (pid.lower(), nation.lower())
        (HERE / out).write_text(json.dumps(spec, indent=1), encoding="utf-8")
        side = {"pass": pid, "bearing": (D["b0"] + D["b1"]) * 0.5 % 360.0,
                "walk": [[round(c, 1) for c in W.world(u, v)] for (u, v) in walk_uv], "groups": groups}
        (HERE / ("%s_walk.json" % pid.lower())).write_text(json.dumps(side, indent=1), encoding="utf-8")
        total = sum(len(b["instances"]) for b in spec["batches"])
        print("%s -> %s  %s  arc %.0f-%.0f  census rows %d  batches %d  instances %d" % (
            pid, out, nation, D["b0"], D["b1"], n_census, len(spec["batches"]), total))
        print("   " + ", ".join("%s %d" % kv for kv in sorted(p.stats.items())))


if __name__ == "__main__":
    main()
