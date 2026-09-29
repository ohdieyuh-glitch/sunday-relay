#!/usr/bin/env python3
"""C7 CORE COPSE -- CORE's copy of SECOND's S6 copse fill (Wedges/copse_fill.py, b7004598) for the CORE RIM AND
MARCHES (350-620 m), the band S6 leaves to CORE. Changes from S6, nothing else: the band (R_LO/R_HI), the pass prefix C7
(S6's sector names would COLLIDE -- apply_layer deletes a pass's actors), and the outputs written to Districts/.

S6 COPSE FILL -- tree massing for the heartlands and frontiers: groves and pairs of large trees on the ground that is
still unexplained, so the outer world reads as wooded parkland from a distance.

WHY. CORE's visual review (2026-09-29 11:48): from ~1.3 km "the outer world still reads as a green plain with lone
skyline towers. The fills are real, but low (flower runs, stones, single trees), so they don't read at distance ...
prefer grove clumps and tree massing over flower runs." Measured: window 5a applied 57 trees against 1,795 flower-run
pieces and 1,496 stones. The sector-fill recipe cannot mass in the pockets that are left: its groves need a clear core
(13 m even with sector_fill2 --massing) and its walks claim the rest -- a massing re-plan of the same ground came out at
118 trees for 1,993 flower-run pieces and 2,384 stones. So this pass drops the recipe: no walks, no rooms, no drifts.

WHAT. On cells CORE's class audit calls UNINTENDED (emptiness_classes.classify on the planning census), 620-1,210 m:
  GROVE  3-5 trees within 10 m, half of them mature pairs (the large canopy), scale 0.95-1.35, the nation's leaves with
         a gold / copper accent; a shrub or rose at a third of the trunks                        weight 0.7, reach 22 m
  PAIR   two trees 7-9 m apart, 70 % mature                                                        weight 0.3, reach 16 m
A placed clump retires the target cells within its reach, so the fill stops when the ground is explained. Trees cull at
600 m: they are what is seen from a distance.

ONE PASS PER 20-DEGREE SECTOR (S6<nation letter><sector centre>), each small enough for one in-play stand at its middle
to stream every batch (the grid loads 512 m): its residency is provable, not assumed.

KEPT CLEAR: the census (everything standing, planned passes included); CORE's footprints and bands (TW01, MG01, the
TW03 band 100-135 deg inside 1,210 m) and the sightlines and checkpoint grounds (sector_fill2.keep_out_blocks /
vista_blocks); Dubel's arc beyond 1,040 m (S5's); the core and marches (inside 620 m, CORE's). THE WALKS: every applied
walk (a sidecar whose pass the census holds) is swept offline with a Dog-sized square against the new trunks; one block
and the script refuses to write. It re-checks the sightlines, grounds and bands on its own output the same way.

    python copse_fill.py --census PATH [--proof-dir DIR]     writes s6<x><bbb>_copse.json + copse_new_placements.csv.gz
"""
import argparse
import csv
import glob
import gzip
import json
import math
import os
import random
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WEDGES = HERE.parent / "Wedges"
sys.path.insert(0, str(WEDGES))
sys.path.insert(0, str(ROOT / "Tools" / "world_audit"))
import sector_fill as S                                                  # noqa: E402
import sector_fill2 as F2                                                # noqa: E402
import emptiness_classes as EC                                           # noqa: E402
W = S.W

R_LO, R_HI = 35000.0, 62000.0              # CORE: the rim and marches (S6 is 620-1,210 m)
DUBEL = (58.0, 122.0, 104000.0)                   # S5's scope: Dubel's arc beyond 1,040 m
TW03 = (100.0, 135.0, 121000.0)
SECTOR = 20.0
REACH = {"grove": 2200.0, "pair": 1600.0}
ACCENT = ("MI_V2_LeafGold", "MI_V2_LeafCopper")


def nation_of(b):
    cfg, letter = F2.nation_cfg(b)
    return cfg, letter, W.NB.NATIONS[cfg]["nation"]


def in_scope(x, y):
    b = math.degrees(math.atan2(y, x)) % 360.0
    r = math.hypot(x, y)
    if not (R_LO <= r <= R_HI):
        return False
    if DUBEL[0] <= b <= DUBEL[1] and r > DUBEL[2]:
        return False
    return not (TW03[0] <= b <= TW03[1])


def band_slabs(occ, b0, b1, r0, r1, tag):
    for b10 in range(int(b0 * 10), int(b1 * 10) + 1, 10):
        t = math.radians(b10 / 10.0)
        rm = 0.5 * (r0 + r1)
        occ.add("solid", rm * math.cos(t), rm * math.sin(t), 0.5 * (r1 - r0), 1200.0, b10 / 10.0, tag)


RADIAL_ROUTES = HERE / "radial_routes.json"   # CORE's proven core -> nation-end walks (planner v2.1, 2026-09-29)


def route_slabs(occ, tag="keep:radial_route", half_w=1000.0):
    """Keep the radial walks clear: a 20 m corridor on every leg of radial_routes.json. The ICARUS and TARTARUS walks
    arrived SELF-POWERED with 0 stops before C7 existed; a copse on their lawn stretches (the causeway starts, the
    GreatSpire promenade) would undo that proof."""
    if not RADIAL_ROUTES.exists():
        return
    for leg in json.load(open(RADIAL_ROUTES, encoding="utf-8")):
        pts = [tuple(q[:2]) for q in leg["points"]]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            m = max(1, int(math.hypot(bx - ax, by - ay) // 2000.0) + 1)
            for i in range(m):
                sx, sy = ax + (bx - ax) * i / m, ay + (by - ay) * i / m
                ex, ey = ax + (bx - ax) * (i + 1) / m, ay + (by - ay) * (i + 1) / m
                occ.add("solid", 0.5 * (sx + ex), 0.5 * (sy + ey), 0.5 * math.hypot(ex - sx, ey - sy) + 0.5 * half_w, half_w,
                        math.degrees(math.atan2(ey - sy, ex - sx)), tag)


def applied_walks(census):
    """Every applied walk (its pass is in the census), densified to 1 m: sidecars sample every 5 m, and a trunk midway
    between two samples would slip a 60 cm Dog square."""
    built = EC.census_passes(census)
    out = []
    for f in glob.glob(str(WEDGES / "*_walk.json")):
        if EC.sidecar_pass(f) not in built:
            continue
        pts = [tuple(q[:2]) for q in json.load(open(f, encoding="utf-8")).get("walk", [])]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            d = math.hypot(bx - ax, by - ay)
            if d > 2000.0:                       # a gap in the sidecar, not a step of the walk
                out.append((ax, ay))
                continue
            m = max(1, int(d // 100.0))
            out += [(ax + (bx - ax) * i / m, ay + (by - ay) * i / m) for i in range(m)]
        out += pts[-1:]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", required=True)
    ap.add_argument("--proof-dir", default=None)
    a = ap.parse_args()
    W.CENSUS = a.census

    g = EC.classify(a.census)
    n, x0, C, cls = g["n"], g["x0"], g["C"], g["cls"]
    cells = {}
    for k in range(n * n):
        if cls[k] == 1:
            j, i = divmod(k, n)
            x, y = x0 + (i + 0.5) * C, x0 + (j + 0.5) * C
            if in_scope(x, y):
                cells[k] = (x, y)
    area0 = len(cells) * (C / 100.0) ** 2
    cps = F2.checkpoints(a.census)
    walks = applied_walks(a.census)
    rows_out, report, stands = [], [], []
    for s0 in range(0, 360, int(SECTOR)):
        bc = s0 + SECTOR * 0.5
        mine = {k: v for k, v in cells.items() if s0 <= math.degrees(math.atan2(v[1], v[0])) % 360.0 < s0 + SECTOR}
        if len(mine) * (C / 100.0) ** 2 < 2500.0:          # under a quarter hectare: lawn between groups, not unfinished
            continue
        cfg, letter, nation = nation_of(bc)
        pid = "C7%s%03d" % (letter, int(bc) % 360)
        S.set_frame(bc, SECTOR * 0.5 + 2.0)
        W.CENSUS_R = (R_LO - 4000.0, R_HI + 4000.0)
        occ = W.Occupancy()
        W.load_census(occ)
        F2.keep_out_blocks(occ)
        F2.vista_blocks(occ, cps)
        route_slabs(occ)
        band_slabs(occ, TW03[0], TW03[1], 55000.0, TW03[2], "keep:tw03_band")
        band_slabs(occ, DUBEL[0], DUBEL[1], DUBEL[2], 150000.0, "keep:s5_dubel_arc")
        leaves = S.LEAVES[nation][:3]
        p = W.Pass(pid, ["WL_CORE_COPSE", "WL_COPSE", "WL_NATION_" + nation],
                   "Wonderland/Authored/%s_%sCopse" % (pid, nation.title()), dict(W.NB.NATIONS[cfg]["materials"]), occ, pid)
        rng = random.Random("copse-" + pid)

        def to_uv(x, y):
            return x * W.DIR[0] + y * W.DIR[1], x * W.LEFT[0] + y * W.LEFT[1]

        def tree(u, v, mature_share):
            kind = "tree_mature" if rng.random() < mature_share else "tree_slender"
            leaf = rng.choice(ACCENT) if rng.random() < 0.15 else rng.choice(leaves)
            return p.plant(kind, u, v, rng.uniform(0.95, 1.35), leaf, rng.uniform(0.0, 360.0), margin=60.0)

        def under(u, v):
            t, d = rng.uniform(0.0, math.tau), rng.uniform(300.0, 700.0)
            p.plant(rng.choice(("shrub", "shrub", "rose")), u + math.cos(t) * d, v + math.sin(t) * d,
                    rng.uniform(0.8, 1.2), leaves[2], rng.uniform(0, 360), margin=0.0, radius=110.0)

        order = sorted(mine)
        rng.shuffle(order)
        feats = Counter()
        for k in order:
            if k not in mine:
                continue
            x, y = mine[k]
            u, v = to_uv(x, y)
            kind = "grove" if rng.random() < 0.7 else "pair"
            placed = []
            want = rng.randint(3, 5) if kind == "grove" else 2
            for _ in range(want):
                for _try in range(10):
                    if not placed:
                        tu, tv = u + rng.uniform(-150.0, 150.0), v + rng.uniform(-150.0, 150.0)
                    else:
                        t = rng.uniform(0.0, math.tau)
                        d = rng.uniform(700.0, 950.0) if kind == "pair" else rng.uniform(500.0, 1000.0)
                        tu, tv = placed[0][0] + math.cos(t) * d, placed[0][1] + math.sin(t) * d
                    if tree(tu, tv, 0.5 if kind == "grove" else 0.7):
                        placed.append((tu, tv))
                        break
            for (tu, tv) in placed:
                if rng.random() < 0.33:
                    under(tu, tv)
            if len(placed) >= 2:
                feats[kind] += 1
                reach = REACH[kind]
                for kk in [kk for kk, (cx, cy) in mine.items() if math.hypot(cx - x, cy - y) <= reach]:
                    del mine[kk]
            else:
                feats["failed"] += 1
                del mine[k]
        spec = p.spec()
        if not spec["batches"]:
            continue
        for bt in spec["batches"]:
            if "Trunk" in bt["id"] or "Canopy" in bt["id"]:
                bt["cull_distance"] = W.CULL_FAR
        spec["title"] = "%s: tree massing, %s, %d-%d deg (CORE rim / marches)" % (pid, nation, s0, s0 + SECTOR)
        # ---- the self-check on this pass's own output --------------------------------------------------------
        bad = Counter()
        for (x, y, *_r) in [t for bt in spec["batches"] for t in bt["instances"]]:
            b = math.degrees(math.atan2(y, x)) % 360.0
            rr = math.hypot(x, y)
            for axb in F2.VISTA_BEARINGS:
                ux, uy = math.cos(math.radians(axb)), math.sin(math.radians(axb))
                if 0.0 < x * ux + y * uy <= 130000.0 and abs(-x * uy + y * ux) <= 2500.0:
                    bad["sightline"] += 1
            if any(abs(x - cx) <= max(5000.0, cr + 3000.0) - 500.0 and abs(y - cy) <= max(5000.0, cr + 3000.0) - 500.0
                   for (cx, cy, cr, _k) in cps):
                bad["checkpoint_ground"] += 1
            if TW03[0] <= b <= TW03[1] and rr < TW03[2] - 900.0:
                bad["tw03_band"] += 1
            if DUBEL[0] <= b <= DUBEL[1] and rr > DUBEL[2] + 900.0:
                bad["s5_dubel_arc"] += 1
            if any(math.hypot(x - c[0], y - c[1]) < rad - 900.0 for (c, rad, _k) in F2.KEEP_OUT):
                bad["core_keepout"] += 1
        trunks = W.Occupancy()
        for (k_, x, y, z, hx, hy, hz, mesh, owner) in p.new_rows:
            if mesh.startswith("tree_"):
                trunks.add("solid", x, y, 180.0, 180.0, 0.0, mesh)
        blocked = sum(1 for (x, y) in walks if trunks.hits(x, y, 60.0, 60.0, 0.0, 0.0, ("solid",)))
        n_tr = sum(len(bt["instances"]) for bt in spec["batches"] if "Trunk" in bt["id"])
        inst = [t for bt in spec["batches"] for t in bt["instances"]]
        report.append((pid, len(spec["batches"]), len(inst), n_tr, dict(feats), dict(bad), blocked))
        if bad or blocked:
            raise SystemExit("REFUSED %s: rule breaks %s, applied-walk points blocked %d" % (pid, dict(bad), blocked))
        (HERE / ("%s_copse.json" % pid.lower())).write_text(json.dumps(spec, indent=1), encoding="utf-8")
        rows_out += [r for r in p.new_rows]
        # the residency stand: the clearest point within 150 m of the pass's middle, clear of this pass's own trunks
        cx = sum(t[0] for t in inst) / len(inst)
        cy = sum(t[1] for t in inst) / len(inst)
        cand = [(cx + dx, cy + dy) for dx in range(-15000, 15001, 1500) for dy in range(-15000, 15001, 1500)]
        best = max(cand, key=lambda q: min([math.hypot(q[0] - r_[1], q[1] - r_[2]) - max(r_[4], r_[5])
                                            for r_ in p.new_rows] + [1e9]) if not occ.hits(q[0], q[1], 300.0, 300.0, 0.0,
                                                                                             0.0, ("existing", "solid", "way")) else -1e9)
        stands.append((pid, best))
    for rp in report:
        print("%-7s batches %3d  inst %4d  trees %3d  %s" % (rp[0], rp[1], rp[2], rp[3], rp[4]))
    tot_tr = sum(rp[3] for rp in report)
    print("target %.2f ha unintended in scope; %d passes, %d batches, %d instances, %d trees; applied-walk points checked %d" % (
        area0 / 1e4, len(report), sum(rp[1] for rp in report), sum(rp[2] for rp in report), tot_tr, len(walks)))
    with gzip.open(HERE / "core_copse_new_placements.csv.gz", "wt", encoding="utf-8", newline="") as f:
        f.write("kind,x,y,z,ex,ey,ez,yaw,mesh,owner\n")
        for (k, x, y, z, ex, ey, ez, mesh, owner) in rows_out:
            f.write("%s,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,0,%s,%s\n" % (k, x, y, z, ex, ey, ez, mesh, owner))
    if a.proof_dir:
        for (pid, (x, y)) in stands:
            json.dump({"pass": pid, "walk": [[round(x, 1), round(y, 1)], [round(x, 1), round(y + 300.0, 1)]], "groups": [],
                       "note": "residency stand at the pass's middle (one 20-degree sector; the grid loads 512 m)"},
                      open(os.path.join(a.proof_dir, "proofwalk_%s.json" % pid.lower()), "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
