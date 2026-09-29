#!/usr/bin/env python3
"""S5 DUBEL EDGE -- Dubel Forest's inner margin, graded out into the frontier: meadow, groves, forest fringe.

WHY. After window 4b the largest unintended ground left in SECOND's lane is Dubel Forest's inner edge: pockets at
64 / 76 / 97 / 111 deg, 1,093-1,340 m, ~4.5 ha (emptiness_classes, built walks only). DF01's tree density is 1 - t^2
across 1,230-1,480 m -- ZERO at its inner edge, by design, "so the nations' outskirts are not walled off" -- and the
frontier's fills stop at 1,100-1,160 m, so between them lies lawn that nothing explains. CORE (2026-09-29): "a forest
edge should grade into meadow and groves, not stop dead." Keep DF01's clearings open, +/-5 m round the DW01 stones,
DF01's three landmarks and CP05's ground; no clones of the wild-ring woods; grade Dubel's own palette out.

WHAT, by radius -- the ecotone a real woodland edge has, from the open side in:
  MEADOW MARGIN  1,050-1,230 m  drifts: the heartlands' daisy / lavender runs nearest the frontier, DF01's flower
                                clusters and small mushrooms nearer the trees; a rare solitary tree
  GROVES         1,150-1,290 m  3-6 trees in DF01's pairing (slender 62 % / mature 38 %) and leaf mix, with DF01's
                                undergrowth (flowering shrub 42 %, flower cluster 30 %, small mushroom 28 %)
  FOREST FRINGE  1,230-1,345 m  single trees thickening toward DF01's heart, each with undergrowth
The zones overlap and each feature is drawn by weight, so the edge grades instead of banding.

WHERE. Only on cells CORE's class audit calls UNINTENDED (emptiness_classes.classify on the planning census): it builds
where the world is unexplained and nowhere else. A feature, once placed, retires the target cells within its reach, so
the fill stops when the ground is explained -- it does not carpet what is already a meadow, a verge or a clearing.

KEPT CLEAR (solid / way occupancy on top of the census): DF01's five clearings (+6 m; the three landmarks stand in
them), DF01's path (+/-7 m; its own tree rule is 6.2 m), every DW01 stone (+5 m), CP05's ground and the 90 deg
sightline (sector_fill2.vista_blocks), CORE's TW03 band (100-135 deg inside 1,210 m), SKY05's towers and the HG2A hedge
gates (+15 m). The script re-checks each rule on its own output and refuses to write if any is broken.

Dubel is not a nation (CANON: "never force it into a nation"): the pass carries WL_DUBEL / WL_WILDERNESS, no nation.

    python dubel_edge.py --census PATH [--proof-walk OUT.json]
        writes s5d090_dubel_edge.json + dubel_edge_new_placements.csv.gz (census-format rows for projections)
"""
import argparse
import csv
import gzip
import json
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "Districts"))
sys.path.insert(0, str(ROOT / "Tools" / "world_audit"))
import sector_fill as S                                                  # noqa: E402
import sector_fill2 as F2                                                # noqa: E402
import dubel_forest as DF                                                # noqa: E402
import emptiness_classes as EC                                           # noqa: E402
W = S.W

PID = "S5D090"
ARC = (58.0, 122.0)
R_LO, R_HI = 105000.0, 134500.0
TW03 = (100.0, 135.0, 121000.0)                  # CORE's tower approaches: sector_fill2.KEEP_OUT_BANDS + 10 m
V2 = "/Game/WonderlandV2/"
W.VEG.setdefault("flower_cluster", V2 + "Vegetation/Flowers/SM_flower_cluster.SM_flower_cluster")
W.VEG.setdefault("mushroom_small", V2 + "Mushrooms/Small/SM_mushroom_small.SM_mushroom_small")
LEAF = [m for m, _ in DF.LEAF]
LEAF_W = [w for _, w in DF.LEAF]
MEADOW_RUNS = ("WL_Flower_Daisy_Run", "WL_Flower_Lavender_Run")
#: how far a placed feature explains the ground round it (cm): its own spread plus most of the audit's 9 m reach
REACH = {"drift": 1300.0, "solitary": 1500.0, "grove": 2300.0, "fringe": 1100.0}


def ramp(r, a, b):
    return max(0.0, min(1.0, (r - a) / (b - a)))


def weights(r):
    """Each feature's weight at radius r: meadow nearest the frontier, groves mid-margin, fringe toward DF01's heart."""
    return {"drift": 1.0 - ramp(r, 115000.0, 123000.0),
            "solitary": 0.2 * (1.0 - ramp(r, 113000.0, 119000.0)),
            "grove": min(ramp(r, 115000.0, 119000.0), 1.0 - ramp(r, 125000.0, 129000.0)),
            "fringe": ramp(r, 123000.0, 129000.0)}


def in_scope(x, y):
    b = math.degrees(math.atan2(y, x)) % 360.0
    r = math.hypot(x, y)
    if not (ARC[0] + 0.4 <= b <= ARC[1] - 0.4 and R_LO <= r <= R_HI):
        return False
    return not (TW03[0] <= b <= TW03[1] and r < TW03[2])


def to_uv(x, y):
    return x * W.DIR[0] + y * W.DIR[1], x * W.LEFT[0] + y * W.LEFT[1]


def path_line(step=500.0):
    """DF01's path, densified to one point every `step` cm (DW01 lays its stones along the same line)."""
    pts = DF.path_points()
    out = []
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(bx - ax, by - ay) // step))
        out += [(ax + (bx - ax) * k / n, ay + (by - ay) * k / n) for k in range(n)]
    return out + [pts[-1]]


def keep_clear(occ, census):
    """CORE's list, as occupancy. Returns the DW01 stones and the SKY05 / HG2A rows for the self-check."""
    for (cx, cy, cr) in DF.CLEARINGS:
        occ.add("solid", cx, cy, cr + 600.0, cr + 600.0, 0.0, "keep:df01_clearing")
    for (x, y) in path_line():
        occ.add("way", x, y, 700.0, 700.0, 0.0, "keep:df01_path")
    F2.vista_blocks(occ, F2.checkpoints(census))
    # CORE's TW03 band as 1-degree radial slabs, so a grove's outer tree cannot lean into it from a seed outside it
    for b10 in range(int(TW03[0] * 10), int(TW03[1] * 10) + 1, 10):
        t = math.radians(b10 / 10.0)
        rm = 0.5 * (95000.0 + TW03[2])
        occ.add("solid", rm * math.cos(t), rm * math.sin(t), 0.5 * (TW03[2] - 95000.0), 1200.0, b10 / 10.0,
                "keep:tw03_band")
    stones, guarded = [], []
    with gzip.open(census, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            pre = r["owner"].split("_")[0]
            if pre not in ("DW01", "SKY05", "HG2A"):
                continue
            x, y = float(r["x"]), float(r["y"])
            if not (ARC[0] - 4.0 <= math.degrees(math.atan2(y, x)) % 360.0 <= ARC[1] + 4.0):
                continue
            ex, ey, yaw = float(r["ex"]), float(r["ey"]), float(r["yaw"])
            if pre == "DW01":
                occ.add("way", x, y, ex + 500.0, ey + 500.0, yaw, "keep:dw01")
                stones.append((x, y, ex, ey))
            else:
                occ.add("solid", x, y, ex + 1500.0, ey + 1500.0, yaw, "keep:" + pre.lower())
                guarded.append((x, y, ex, ey, pre))
    return stones, guarded


def tree(p, rng, u, v, margin=40.0):
    kind = "tree_slender" if rng.random() < DF.KINDS[0][5] else "tree_mature"
    leaf = rng.choices(LEAF, weights=LEAF_W)[0]
    return p.plant(kind, u, v, rng.uniform(0.82, 1.38), leaf, rng.uniform(0.0, 360.0), margin=margin)


def undergrowth(p, rng, u, v, n):
    """DF01's own mix at a trunk's foot: flowering shrub 42 %, flower cluster 30 %, small mushroom 28 %."""
    for _ in range(n):
        a, d = rng.uniform(0.0, math.tau), rng.uniform(260.0, 900.0)
        uu, vv = u + d * math.cos(a), v + d * math.sin(a)
        pick = rng.random()
        if pick < 0.42:
            p.plant("shrub", uu, vv, rng.uniform(0.55, 1.05), "MI_V2_LeafDark", rng.uniform(0, 360), margin=0.0,
                    radius=100.0)
        elif pick < 0.72:
            p.plant("flower_cluster", uu, vv, rng.uniform(0.6, 1.2), "MI_V2_LeafMid", rng.uniform(0, 360),
                    margin=0.0, radius=80.0)
        else:
            p.plant("mushroom_small", uu, vv, rng.uniform(0.45, 0.95), "MI_V2_RoofRose", rng.uniform(0, 360),
                    margin=0.0, radius=60.0)


def drift(p, rng, u, v, r):
    """A meadow drift that grades with radius: the frontier's daisy / lavender runs at 1,100 m, DF01's flower clusters
    and small mushrooms by 1,220 m, and a flowering shrub in the forest's gold or copper as the trees come near."""
    t = ramp(r, 110000.0, 122000.0)
    arc0 = rng.uniform(0.0, math.tau)
    placed = 0
    for q in range(rng.randint(7, 12)):
        a = arc0 + q * 0.26 + rng.uniform(-0.08, 0.08)
        d = rng.uniform(250.0, 650.0)
        uu, vv = u + d * math.cos(a), v + d * math.sin(a)
        if rng.random() >= t:
            ok = p.add_module(rng.choice(MEADOW_RUNS), uu, vv, W.GROUND_Z + 2.0, math.degrees(a) + 90.0,
                              cull=W.CULL_NEAR, collide=False, margin=0.0)
        elif rng.random() < 0.72:
            ok = p.plant("flower_cluster", uu, vv, rng.uniform(0.6, 1.2), "MI_V2_LeafMid", rng.uniform(0, 360),
                         margin=0.0, radius=80.0)
        else:
            ok = p.plant("mushroom_small", uu, vv, rng.uniform(0.45, 0.95), "MI_V2_RoofRose", rng.uniform(0, 360),
                         margin=0.0, radius=60.0)
        placed += 1 if ok else 0
    if t > 0.4 and rng.random() < t:
        a = rng.uniform(0.0, math.tau)
        p.plant("shrub", u + 200.0 * math.cos(a), v + 200.0 * math.sin(a), rng.uniform(0.7, 1.1),
                rng.choice(("MI_V2_LeafGold", "MI_V2_LeafCopper")), rng.uniform(0, 360), margin=0.0, radius=100.0)
    return placed >= 4


def grove(p, rng, u, v):
    placed = []
    for _ in range(rng.randint(3, 6)):
        for _try in range(12):
            a, d = rng.uniform(0.0, math.tau), rng.uniform(300.0, 1000.0) if placed else rng.uniform(0.0, 250.0)
            tu, tv = u + d * math.cos(a), v + d * math.sin(a)
            if tree(p, rng, tu, tv):
                placed.append((tu, tv))
                break
    for (tu, tv) in placed:
        undergrowth(p, rng, tu, tv, rng.randint(1, 3))
    return len(placed) >= 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", required=True, help="the planning census (a projection holding every staged pass)")
    ap.add_argument("--proof-walk", default=None, help="write the in-play proof's walk (DF01's path in the arc) here")
    a = ap.parse_args()
    W.CENSUS = a.census
    S.set_frame(90.0, 35.0)
    W.CENSUS_R = (R_LO - 5000.0, R_HI + 7000.0)
    occ = W.Occupancy()
    n_census = W.load_census(occ)
    stones, guarded = keep_clear(occ, a.census)
    p = W.Pass(PID, ["WL_DUBEL", "WL_WILDERNESS", "WL_DUBEL_EDGE"], "Wonderland/Authored/%s_DubelEdge" % PID, {},
               occ, PID)
    rng = random.Random("dubel-edge-" + PID)

    g = EC.classify(a.census)
    n, x0, C, cls = g["n"], g["x0"], g["C"], g["cls"]
    target = {}
    for k in range(n * n):
        if cls[k] != 1:
            continue
        j, i = divmod(k, n)
        x, y = x0 + (i + 0.5) * C, x0 + (j + 0.5) * C
        if in_scope(x, y):
            target[k] = (x, y)
    area0 = len(target) * (C / 100.0) ** 2
    order = sorted(target)
    rng.shuffle(order)
    feats = {"drift": 0, "solitary": 0, "grove": 0, "fringe": 0, "failed": 0}

    def retire(x, y, reach):
        i0, i1 = int((x - reach - x0) // C), int((x + reach - x0) // C)
        j0, j1 = int((y - reach - x0) // C), int((y + reach - x0) // C)
        for jj in range(j0, j1 + 1):
            for ii in range(i0, i1 + 1):
                kk = jj * n + ii
                if kk in target and math.hypot(x0 + (ii + 0.5) * C - x, x0 + (jj + 0.5) * C - y) <= reach:
                    del target[kk]

    for k in order:
        if k not in target:
            continue
        x, y = target[k]
        r = math.hypot(x, y)
        w = weights(r)
        kinds = [kk for kk in w if w[kk] > 0.0]
        kind = rng.choices(kinds, weights=[w[kk] for kk in kinds])[0]
        u, v = to_uv(x, y)
        if kind == "drift":
            ok = drift(p, rng, u, v, r)
        elif kind == "grove":
            ok = grove(p, rng, u, v)
        else:
            ok = tree(p, rng, u, v, margin=40.0 if kind == "fringe" else 120.0)
            if ok:
                undergrowth(p, rng, u, v, rng.randint(1, 3) if kind == "fringe" else rng.randint(1, 2))
        if ok:
            feats[kind] += 1
            retire(x, y, REACH[kind])
        else:
            feats["failed"] += 1
            del target[k]

    spec = p.spec()
    for bt in spec["batches"]:
        if "Trunk" in bt["id"] or "Canopy" in bt["id"]:
            bt["cull_distance"] = W.CULL_FAR        # DF01's trees are seen from the heartlands (900 m); the edge's too
        elif "Flower_Daisy" not in bt["id"] and "Flower_Lavender" not in bt["id"]:
            bt["cull_distance"] = W.CULL_MID        # DF01's undergrowth keeps 350 m; the meadow runs keep 120 m
    spec["title"] = "S5D090: Dubel Forest's inner edge graded into the frontier (meadow, groves, forest fringe)"
    inst = [t for bt in spec["batches"] for t in bt["instances"]]

    # ---- THE SELF-CHECK: every rule of the brief, on the output, before anything is written ----------------
    bad = []
    ux, uy = 0.0, 1.0
    cps = F2.checkpoints(a.census)
    for (x, y, *_r) in inst:
        b = math.degrees(math.atan2(y, x)) % 360.0
        rr = math.hypot(x, y)
        if any(math.hypot(x - cx, y - cy) <= cr + 600.0 for (cx, cy, cr) in DF.CLEARINGS):
            bad.append(("df01_clearing", x, y))
        if any(abs(x - sx) <= ex + 500.0 and abs(y - sy) <= ey + 500.0 for (sx, sy, ex, ey) in stones):
            bad.append(("dw01_stone", x, y))
        if 0.0 < x * ux + y * uy <= 130000.0 and abs(-x * uy + y * ux) <= 2500.0:
            bad.append(("sightline_90", x, y))
        if any(abs(x - cx) <= max(5000.0, cr + 3000.0) - 500.0 and abs(y - cy) <= max(5000.0, cr + 3000.0) - 500.0
               for (cx, cy, cr, _k) in cps):
            bad.append(("checkpoint_ground", x, y))
        if TW03[0] <= b <= TW03[1] and rr < TW03[2] - 900.0:
            bad.append(("tw03_band", x, y))
        if not (ARC[0] - 1.0 <= b <= ARC[1] + 1.0):
            bad.append(("outside_arc", x, y))
    # DF01's path, swept with a Dog-sized square against the new solids only (the census was clear before)
    blocked = 0
    new_solid = W.Occupancy()
    for (k, x, y, z, hx, hy, hz, mesh, owner) in p.new_rows:
        if mesh.startswith("tree_"):
            new_solid.add("solid", x, y, 180.0, 180.0, 0.0, mesh)
    for (x, y) in path_line(250.0):
        if in_scope(x, y) or math.hypot(x, y) <= R_HI + 1000.0:
            if new_solid.hits(x, y, 60.0, 60.0, 0.0, 0.0, ("solid",)):
                blocked += 1
    print("%s  census rows %d  target %.2f ha  features %s" % (PID, n_census, area0 / 1e4, feats))
    print("  batches %d  instances %d  r %.0f-%.0f m  stones kept %d  guarded rows %d  path blocked %d" % (
        len(spec["batches"]), len(inst), min(math.hypot(t[0], t[1]) for t in inst) / 100,
        max(math.hypot(t[0], t[1]) for t in inst) / 100, len(stones), len(guarded), blocked))
    print("  skipped", dict(p.skipped), " why", dict(p.skip_why.most_common(6)))
    if bad or blocked:
        from collections import Counter
        raise SystemExit("REFUSED: rule breaks %s, path blocked %d" % (dict(Counter(b[0] for b in bad)), blocked))

    (HERE / ("%s_dubel_edge.json" % PID.lower())).write_text(json.dumps(spec, indent=1), encoding="utf-8")
    with gzip.open(HERE / "dubel_edge_new_placements.csv.gz", "wt", encoding="utf-8", newline="") as f:
        f.write("kind,x,y,z,ex,ey,ez,yaw,mesh,owner\n")
        for (k, x, y, z, ex, ey, ez, mesh, owner) in p.new_rows:
            f.write("%s,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,0,%s,%s\n" % (k, x, y, z, ex, ey, ez, mesh, owner))
    if a.proof_walk:
        walk = [[round(x, 1), round(y, 1)] for (x, y) in path_line(500.0)]
        json.dump({"pass": PID, "bearing": 90.0, "walk": walk, "groups": [],
                   "note": "DF01's path through the arc (DW01's stones lie on it): S5 must leave it walkable"},
                  open(a.proof_walk, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
