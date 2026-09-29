#!/usr/bin/env python3
"""DW01 -- DUBEL WALK: stepping stones along Dubel Forest's own path, joined to the wild-ring trail at both ends.

    python WorldDesign/Districts/dubel_walk.py        (writes dw01_dubel_walk.json)

WHY (2026-09-29, CORE R51). DF01 lays its path as 29 SM_garden_lawn patches at scale 0.055 -- about 3.3 x 4 m each --
one every 30 m along path_points(). From the ground that is a row of dots in a forest, not a way through it. The
wild ring (SECOND, R50) runs its trail round the world on Dubel's path radius and meets DF01's two ends: 5 m
from the 58 deg end, 15 m from the 122 deg end.
WHAT. The heartland/wild-ring stepping stones (WL_Ground_Flagstone_A/B/C at 0.55, on the ground at -13, not
colliding, one every ~4.5 m with a little jitter) laid along the SAME path_points(), densified, plus a straight run
from each end to the wild ring's nearest trail stone. Additive: DF01 is not re-applied, so its forest and its
lawn patches stay exactly as they are. A stone that would land in anything standing (a trunk, a mushroom foot)
is skipped and counted; DF01 keeps its trees 6.2 m clear of the path, so none should be.
"""
import json
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WD = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(WD / "Rings"))
import dubel_forest as DF                                                 # noqa: E402
import forge_districts as FD                                              # noqa: E402
import ring_roads as RR                                                   # noqa: E402
import seam_bypass as SB                                                  # noqa: E402

PASS = "DW01"
FLAGS = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
STEP = 450.0
Z = -13.0
SCALE = 0.55
CULL = 26000.0                     # 260 m: the heartland distant-view finding, not the wild ring's 120 m
TRAIL_ENDS = {"58": (73270.0, 116745.0, "WI030"), "122": (-69880.0, 110695.0, "WI122")}   # the wild ring's stones


def densify(pts, step):
    out, carry = [], 0.0
    for a, b in zip(pts, pts[1:]):
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        t = carry
        while t < seg:
            f = t / seg
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))))
            t += step
        carry = t - seg
    return out


def main():
    rng = random.Random(51)
    path = DF.path_points()
    lines = [[TRAIL_ENDS["58"][:2], path[0]], path, [path[-1], TRAIL_ENDS["122"][:2]]]
    site = FD.Site(0.0, 132000.0, 95000.0)
    spec = RR.Spec(PASS, "Wonderland/Authored/DW01_DubelWalk")
    stones = []                                   # (x, y, yaw) in walking order
    for line in lines:
        for (x, y, head) in densify(line, STEP):
            jx, jy = x + rng.uniform(-40.0, 40.0), y + rng.uniform(-40.0, 40.0)
            if site.occ.hits(jx, jy, 110.0, 110.0, 0.0, 10.0, ("existing",)):
                # DETOUR. DF01's own path line runs through a SKY05 tower base and V2 hedge masses at 115-122 deg
                # (~125 m); the walk steps sideways, nearest clear offset first, up to 30 m, rather than stop
                lx, ly = -math.sin(math.radians(head)), math.cos(math.radians(head))
                for off in [s * d for d in range(300, 3001, 300) for s in (1.0, -1.0)]:
                    if not site.occ.hits(jx + lx * off, jy + ly * off, 110.0, 110.0, 0.0, 10.0, ("existing",)):
                        jx, jy = jx + lx * off, jy + ly * off
                        spec.stats["stone_detoured"] += 1
                        break
                else:
                    spec.stats["stone_refused"] += 1
                    continue
            stones.append((jx, jy, head + rng.uniform(-8.0, 8.0)))
    # BRIDGES. Where refusals or side-flipping detours leave a step longer than 7 m -- DF01's path ENDS inside the
    # SKY05 tower base at 122 deg (the World session's Dog landed on the tower there) -- a 1 m grid search round
    # whatever stands between (seam_bypass.bfs, the SR030 bypass instrument) lays stones on the way it finds.
    walked = [stones[0]]
    for st in stones[1:]:
        a = walked[-1]
        if math.hypot(st[0] - a[0], st[1] - a[1]) > 700.0:
            way = SB.bfs(site, a[:2], st[:2], 0.5 * (a[0] + st[0]), 0.5 * (a[1] + st[1]))
            if way:
                last = a
                for (x, y) in way[1:-1]:
                    if math.hypot(x - last[0], y - last[1]) >= STEP:
                        walked.append((x, y, rng.uniform(0.0, 360.0)))
                        last = (x, y)
                        spec.stats["stone_bridge"] += 1
            else:
                spec.stats["gap_unbridged"] += 1
        walked.append(st)
    # ONLY WHAT CONNECTS. Group the stones into chains (8 m); keep the chain that starts at the 58 deg trail join and
    # the chain that ends at the 122 deg one, drop any chain stranded between them. At 116-122 deg a V2 hedge-ring
    # mass seals DF01's path between two SKY05 towers (no 1.8 m way round within 150 m): stones across it would
    # promise a way that is not there. The seal is recorded in the matrix beside the ring-road hedge barriers.
    chain = list(range(len(walked)))
    def root(i):
        while chain[i] != i:
            chain[i] = chain[chain[i]]
            i = chain[i]
        return i
    for i in range(1, len(walked)):
        if math.hypot(walked[i][0] - walked[i - 1][0], walked[i][1] - walked[i - 1][1]) <= 800.0:
            chain[root(i)] = root(i - 1)
    keep = {root(0), root(len(walked) - 1)}
    spec.stats["stone_stranded_dropped"] = sum(1 for i in range(len(walked)) if root(i) not in keep)
    walked = [w for i, w in enumerate(walked) if root(i) in keep]
    for k, (jx, jy, yaw) in enumerate(walked):
        name = FLAGS[k % 3]
        for part in RR.KIT[name]["parts"]:
            if part["part"] == "veg_anchor":
                continue
            spec.add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], part["material"], jx, jy, Z,
                     yaw, SCALE, SCALE, SCALE, collides=False, cull=CULL)
        spec.stats["stone"] += 1
    out = spec.out(["WL_AUTHORED", "WL_PASS_%s" % PASS, "WL_DISTRICT_DUBEL_FOREST"])
    out["title"] = "Dubel Walk: stepping stones on Dubel Forest's path, joined to the wild-ring trail"
    (HERE / "dw01_dubel_walk.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    total = sum(len(b["instances"]) for b in out["batches"])
    print("%s: %d stones, %d instances in %d batches; %s" % (PASS, spec.stats["stone"], total, len(out["batches"]),
                                                           dict(spec.stats)))


if __name__ == "__main__":
    main()
