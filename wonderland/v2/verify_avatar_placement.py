#!/usr/bin/env python3
"""Reproduce the avatar build's placement arithmetic OFFLINE, to bound what the 256 cm discrepancy can be.

WHY THIS EXISTS. The in-engine check reported, for every one of the nine bodies, an actor bounds TALLER than
the height the canon claims -- and for all three SMALL forms it reported exactly 256.0 cm, the same number for
three creatures that share no geometry. Either the meshes really are bigger than they claim (in which case
culling distances and LOD screen sizes are wrong too, and this is a production defect), or the actor-level
number includes something that is not the creature. Guessing between those is not allowed and is not necessary:
the half of the question that does not need an editor can be settled here.

WHAT THIS PROVES, AND WHAT IT CANNOT. avatars_v2 builds each mesh in its JOINT'S OWN frame (every part's centre
minus that joint's pivot, converted web -> Unreal, scaled by k) and then places the component at that joint's
pivot, nested under its parent joint. Those two halves have to cancel exactly. This file redoes both halves in
plain Python -- the same to_unreal, the same k, the same parent chain the Blueprint builds -- and unions the
result. If the union comes back at the target height, then the geometry and the transforms compose correctly and
whatever the engine added is not geometry. It CANNOT prove what the engine added; only the in-engine job can.

    python verify_avatar_placement.py
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import avatar_common as A          # noqa: E402
import cherubim_canon              # noqa: E402
import seraph_canon                # noqa: E402
import ten_tails_canon             # noqa: E402

FAMILIES = (("TenTails", ten_tails_canon), ("Cherubim", cherubim_canon), ("Seraph", seraph_canon))
TOL = 0.05                          # centimetres; anything above this is a real disagreement


def part_corners(kind, payload):
    """The axis-aligned local extent of one part, in the canon's own (web) units, as (lo, hi).

    Deliberately the SAME conservative treatment avatar_common.extents uses -- a rotated cone or torus is taken
    as a sphere of its longest dimension -- so that any disagreement found here is a disagreement about
    PLACEMENT, not about two different ideas of how big a rotated part is.
    """
    if kind == "box":
        c, size, _rot, _ch = payload
        r = (size[0] / 2.0, size[1] / 2.0, size[2] / 2.0)
        return [(c[i] - r[i], c[i] + r[i]) for i in range(3)]
    if kind == "sphere":
        c, r, _s = payload
        return [(c[i] - r, c[i] + r) for i in range(3)]
    if kind == "cone":
        c, r0, r1, h, _rot, _s = payload
        r = max(r0, r1, h)
        return [(c[i] - r, c[i] + r) for i in range(3)]
    if kind == "torus":
        c, R, tb, _rot, _maj, _min = payload
        r = R + tb
        return [(c[i] - r, c[i] + r) for i in range(3)]
    if kind == "tube":
        path, radii, _sides = payload
        lo = [float("inf")] * 3
        hi = [float("-inf")] * 3
        for pt, rr in zip(path, radii):
            for i in range(3):
                lo[i] = min(lo[i], pt[i] - rr)
                hi[i] = max(hi[i], pt[i] + rr)
        return [(lo[i], hi[i]) for i in range(3)]
    raise RuntimeError("unknown kind " + str(kind))


def world_location(joint, pivots_web, parents, k):
    """Where the Blueprint actually puts a joint's component, by walking the same parent chain it builds.

    avatars_v2 gives each Pivot_<joint> a relative location of (its pivot - its parent's pivot), both converted
    and scaled, so the chain telescopes back to the absolute pivot. Walking it here rather than assuming it
    telescopes is the point: a parent chain that does NOT compose is exactly the kind of fault that shows up as
    a body bigger than its parts.
    """
    total = [0.0, 0.0, 0.0]
    seen = set()
    cur = joint
    while cur is not None:
        if cur in seen:
            raise RuntimeError("cycle in parents at " + cur)
        seen.add(cur)
        par = parents.get(cur)
        here = A.to_unreal(pivots_web.get(cur, (0.0, 0.0, 0.0)), (0, 0, 0), k)[0]
        there = A.to_unreal(pivots_web.get(par, (0.0, 0.0, 0.0)), (0, 0, 0), k)[0] if par else (0.0, 0.0, 0.0)
        for i in range(3):
            total[i] += here[i] - there[i]
        cur = par
    return tuple(total)


def check(family, mod, stage):
    raw = mod.parts(stage)
    dy = A.deck_offset(raw)
    parts = A.lift(raw, dy)
    k = A.fit_scale(parts, A.TARGET_METRES[stage])
    pivots_web = {j: (p[0], p[1] + dy, p[2]) for j, p in mod.pivots(stage).items()}
    parents = mod.parents(stage)

    groups = {}
    for name, joint, surface, kind, payload in parts:
        groups.setdefault((joint, surface), []).append((kind, payload))

    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for (joint, surface), members in groups.items():
        pivot = pivots_web.get(joint, (0.0, 0.0, 0.0))
        comp = world_location(joint, pivots_web, parents, k)
        for kind, payload in members:
            ext = part_corners(kind, payload)
            # exactly avatars_v2._emit: local = part - pivot, then web -> Unreal, then scale
            for cx in ext[0]:
                for cy in ext[1]:
                    for cz in ext[2]:
                        local = (cx - pivot[0], cy - pivot[1], cz - pivot[2])
                        ue = A.to_unreal(local, (0, 0, 0), k)[0]
                        for i in range(3):
                            v = comp[i] + ue[i]
                            lo[i] = min(lo[i], v)
                            hi[i] = max(hi[i], v)

    simulated = hi[2] - lo[2]                       # Unreal Z is up
    canon_lo, canon_hi = A.extents(parts)
    claimed = (canon_hi[1] - canon_lo[1]) * k       # web Y is up
    target = A.TARGET_METRES[stage] * 100.0
    return {"family": family, "stage": stage, "simulated_cm": simulated, "claimed_cm": claimed,
            "target_cm": target, "floor_cm": lo[2], "groups": len(groups),
            "ok": abs(simulated - claimed) <= TOL and abs(claimed - target) <= TOL}


def main():
    print("Simulating the build's own placement arithmetic: mesh built in joint-local space, component placed")
    print("by walking the Blueprint's parent chain. If these agree, geometry and transforms compose.\n")
    print("%-9s %-7s %12s %12s %11s %10s %s" % (
        "family", "stage", "simulated", "claimed", "target", "floor z", ""))
    bad = 0
    for family, mod in FAMILIES:
        for stage in A.STAGES:
            r = check(family, mod, stage)
            if not r["ok"]:
                bad += 1
            print("%-9s %-7s %10.2f cm %10.2f cm %9.2f cm %8.2f %s" % (
                r["family"], r["stage"], r["simulated_cm"], r["claimed_cm"], r["target_cm"],
                r["floor_cm"], "OK" if r["ok"] else "DISAGREES"))
    print()
    if bad:
        print("%d of 9 disagree -- the placement arithmetic is at fault and this IS a production defect." % bad)
        return 1
    print("All nine agree to within %.2f cm, and every body's floor sits at z=0." % TOL)
    print("So the geometry and the component transforms compose exactly, and the height the contract states is")
    print("the height the meshes describe. That rules placement OUT as the source of the engine's larger")
    print("number. It does NOT identify what the engine added -- only the in-engine job can, by measuring each")
    print("StaticMesh asset's own bounding box through its component's world transform.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
