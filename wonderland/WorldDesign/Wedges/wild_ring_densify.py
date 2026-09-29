#!/usr/bin/env python3
"""WILD RING DENSIFY (R50b) -- an ADDITIVE pass on the applied wild ring: an outer forest wall, and a fuller wood.

WHY. Window 1's frames (zzW106, wn150_aerial) showed the ring as scattered trees on lawn from the air, and its outer
edge thinned to nothing: the world ended in a flat plane running to the horizon. The ring's density field copied
Dubel's (dense at mid-radius, zero at BOTH edges) at 10 trees a degree, about one tree per 650 m2. The founder's
standard for the wild ring: "change the design if broad visual evidence shows ... sparse composition".

WHAT. Six new passes, WX030 / WX122 / WX150 / WX210 / WX270 / WX330, one over each wood's arc. Nothing is
deleted or moved (a re-apply of the ring would delete 1,705 packages and rewrite them), and the passes are planned
against the census, which holds the ring.
  1. THE FOREST WALL, 1,420-1,478 m: trees at ~15 a degree, cull 600 m, so the edge of the world reads as forest
     from the heartlands.
  2. THE WOOD, 1,210-1,420 m: +10 trees a degree, denser toward the wall (0.45 at the inner edge -> 1.0 at
     1,420 m), so the ring thickens outward rather than peaking in the middle.
  3. KEPT OPEN: every clearing (its radius + 6 m), every mushroom patch (30 m), and the trail (4 m either side of
     its walk, on top of the census's own stones). Clearings stay meadows with a landmark, not woods.
Undergrowth goes at a quarter of the new trunks, in the nation's leaf.

    python wild_ring_densify.py [--only WX150,...]   writes wx<arc>_<nation>_densify.json + census-format rows
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
import sector_fill as S                                          # noqa: E402
import wild_ring as R                                            # noqa: E402
W = S.W

WALL = (142000.0, 147800.0)
WOOD = (121000.0, 142000.0)
WALL_PER_DEG, WOOD_PER_DEG = 15.0, 10.0
ARCS = {"WX030": "WI030", "WX122": "WI122", "WX150": "WN150", "WX210": "WN210", "WX270": "WT270", "WX330": "WT330"}


def wood_density(r):
    """0.45 at the wood's inner edge rising to 1.0 at the wall: the ring thickens toward the world's edge."""
    t = (r - WOOD[0]) / (WOOD[1] - WOOD[0])
    return 0.45 + 0.55 * max(0.0, min(1.0, t))


def densify(pid, src):
    D = R.WOODS[src]
    arc = D["b1"] - D["b0"]
    bc = (D["b0"] + D["b1"]) * 0.5
    S.set_frame(bc % 360.0, arc * 0.5)
    W.CENSUS_R = (WOOD[0] - 10000.0, WALL[1] + 4000.0)
    cfg = W.NB.NATIONS[D["nation_cfg"]]
    nation = cfg["nation"]
    leaves = S.LEAVES[nation]
    occ = W.Occupancy()
    n_census = W.load_census(occ)
    side = json.load(open(HERE / ("%s_walk.json" % src.lower()), encoding="utf-8"))
    for g in side["groups"]:
        x, y = g["centre"][:2]
        rad = (g.get("radius", 3000.0) + 600.0) if g["kind"] == "clearing" else 3000.0
        occ.add("existing", x, y, rad, rad, 0.0, "%s:keep_open_%s" % (pid, g["kind"]))
    for (x, y) in side["walk"][::2]:
        occ.add("way", x, y, 400.0, 400.0, 0.0, "%s:trail" % pid)
    rng = random.Random("wild-ring-densify-" + pid)
    p = W.Pass(pid, ["WL_WILD_RING", "WL_WILD_RING_DENSIFY", "WL_NATION_" + nation, "WL_DISTRICT_%s_WILDWOOD" % nation],
               "Wonderland/Authored/%s_%sWood" % (pid, nation.title()), dict(cfg["materials"]), occ, pid)

    def to_uv(b_deg, r):
        x, y = r * math.cos(math.radians(b_deg)), r * math.sin(math.radians(b_deg))
        return x * W.DIR[0] + y * W.DIR[1], x * W.LEFT[0] + y * W.LEFT[1]

    def band(lo, hi, target, dens, stat):
        placed, tries = 0, 0
        while placed < target and tries < target * 40:
            tries += 1
            b = rng.uniform(D["b0"] + 0.3, D["b1"] - 0.3)
            r = rng.uniform(lo, hi)
            if rng.random() > dens(r):
                continue
            u, v = to_uv(b, r)
            kind = "tree_slender" if rng.random() < 0.55 else "tree_mature"
            leaf = rng.choice(leaves + ("MI_V2_LeafCopper", "MI_V2_LeafGold"))
            if p.plant(kind, u, v, rng.uniform(0.85, 1.3), leaf, rng.uniform(0, 360), margin=40.0):
                placed += 1
                if rng.random() < 0.25:
                    t, d = rng.uniform(0, math.tau), rng.uniform(250.0, 450.0)
                    p.plant(rng.choice(("shrub", "shrub", "rose")), u + math.cos(t) * d, v + math.sin(t) * d,
                            rng.uniform(0.6, 1.0), leaves[2], rng.uniform(0, 360), margin=0.0, radius=100.0)
        p.stats[stat] = placed
        p.stats[stat + "_target"] = target

    band(WALL[0], WALL[1], int(WALL_PER_DEG * arc), lambda r: 1.0, "wall_trees")
    band(WOOD[0], WOOD[1], int(WOOD_PER_DEG * arc), wood_density, "wood_trees")
    spec = p.spec()
    # the ring's rule is 1,200-1,480 m: undergrowth offset from a wall tree can land up to 4.5 m past it
    for bt in spec["batches"]:
        kept = [t for t in bt["instances"] if math.hypot(t[0], t[1]) <= 147900.0]
        p.stats["clamped_past_edge"] += len(bt["instances"]) - len(kept)
        bt["instances"] = kept
    spec["batches"] = [bt for bt in spec["batches"] if bt["instances"]]
    # the wall's trees are seen from the heartlands: a batch whose instances stand mostly in the wall keeps them to
    # 600 m, the rest keep the plant's 260 m
    for bt in spec["batches"]:
        rs = [math.hypot(t[0], t[1]) for t in bt["instances"]]
        if rs and sum(1 for r_ in rs if r_ >= WALL[0] - 1000.0) >= 0.7 * len(rs) and \
                any(k in bt["mesh"] for k in ("canopy", "trunk")):
            bt["cull_distance"] = W.CULL_FAR
    return p, spec, n_census


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    want = [s for s in a.only.split(",") if s] or list(ARCS)
    rows = []
    for pid in want:
        p, spec, n_census = densify(pid, ARCS[pid])
        nation = spec["tags"][2].replace("WL_NATION_", "").lower()
        (HERE / ("%s_%s_densify.json" % (pid.lower(), nation))).write_text(json.dumps(spec, indent=1), encoding="utf-8")
        inst = [t for b in spec["batches"] for t in b["instances"]]
        rr = [math.hypot(t[0], t[1]) / 100 for t in inst]
        print("%s  census %d  batches %d  inst %d  wall %d/%d  wood %d/%d  r %.0f-%.0f m  far-cull batches %d" % (
            pid, n_census, len(spec["batches"]), len(inst), p.stats["wall_trees"], p.stats["wall_trees_target"],
            p.stats["wood_trees"], p.stats["wood_trees_target"], min(rr), max(rr),
            sum(1 for b in spec["batches"] if b["cull_distance"] == W.CULL_FAR)))
        rows += [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], pid) for r in p.new_rows]
    with gzip.open(HERE / "wild_ring_densify_new_placements.csv.gz", "wt", encoding="utf-8", newline="") as f:
        f.write("kind,x,y,z,ex,ey,ez,yaw,mesh,owner\n")
        for (k, x, y, z, ex, ey, ez, mesh, owner) in rows:
            f.write("%s,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,0,%s,%s\n" % (k, x, y, z, ex, ey, ez, mesh, owner))


if __name__ == "__main__":
    main()
