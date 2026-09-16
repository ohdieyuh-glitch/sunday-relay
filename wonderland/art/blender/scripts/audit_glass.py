"""Audit: can the glass in each kit module actually be seen?

    python scripts/audit_glass.py [--min 0.5] [--reach 0.6]

WHY. WL_Detail_Oriel_Bay shipped with its glazing prism INSIDE its solid stone
prism. Every gate passed -- the glass part existed, was measured, exported, read
back and hashed -- and in the world every oriel was a blank grey box. Nothing
asked whether the glass could be SEEN.

HOW. Each module is built in a clean scene. Over every face of its glass part, rays
leave a grid of sample points along the face normal; a sample counts as visible
if its ray travels REACH metres without hitting any other part of the module. The
module's score is the visible share of its glass AREA. A window behind a
mullion or in a deep reveal still scores; a pane sealed inside stone does not.

Exit 1 if any module scores below MIN. A closed glass prism set into a wall shows
about half its area (its caps and back face are meant to be hidden), which is
why the palace modules sit near 47% and MIN defaults to 35%.

First run, 2026-09-16, after the oriel fix: WL_Detail_Oriel_Bay 57% (was
sealed); still below MIN: WL_Tower_Mid_Oriel 0% (24 placements in the world's
distant metropolis, SKY05) and WL_Market_Corner_Storefront 20% (unplaced).
"""

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy                                          # noqa: E402  (first: it provides bmesh and mathutils)
import bmesh                                        # noqa: E402
from mathutils.bvhtree import BVHTree               # noqa: E402

from forge import mesh as M                         # noqa: E402
from forge.registry import groups as GROUPS         # noqa: E402

GLASS_KEYS = ("glass",)
#: barycentric (u, v) sample points inside a triangle, u + v < 1
SAMPLES = [((i + 0.5) / 6.0, (j + 0.5) / 6.0) for i in range(6) for j in range(6) if (i + 0.5) / 6.0 + (j + 0.5) / 6.0 < 1.0]


def tree_of(objs):
    bm = bmesh.new()
    for o in objs:
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(o.matrix_world)
        me = bpy.data.meshes.new("audit_tmp")
        tmp.to_mesh(me)
        tmp.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def score(glass_objs, other_objs, reach):
    if not other_objs:
        return 1.0, 0.0
    tree = tree_of(other_objs)
    seen = total = 0.0
    for o in glass_objs:
        mw = o.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        verts = o.data.vertices
        for poly in o.data.polygons:
            if poly.area <= 0.0:
                continue
            n = (nm @ poly.normal).normalized()
            pts = [mw @ verts[i].co for i in poly.vertices]
            # SAMPLED, not one ray per face: a prism's side is ONE quad, and its centre is exactly where a mullion
            # stands, so a centre ray called a whole glazed light hidden (the fixed oriel scored 24%).
            for i in range(1, len(pts) - 1):
                a, b, c = pts[0], pts[i], pts[i + 1]
                tri = (b - a).cross(c - a).length * 0.5
                if tri <= 0.0:
                    continue
                for (u, v) in SAMPLES:
                    q = a + (b - a) * u + (c - a) * v
                    total += tri / len(SAMPLES)
                    if tree.ray_cast(q + n * 0.004, n, reach)[0] is None:
                        seen += tri / len(SAMPLES)
    return (seen / total if total else 1.0), total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min", type=float, default=0.35)
    ap.add_argument("--reach", type=float, default=0.6)
    args = ap.parse_args()
    rows, bad = [], []
    for group, builders in GROUPS():
        for builder in builders:
            M.clear_scene()
            forge = M.Forge()
            spec = builder(forge)
            glass = [o for k, o in spec.parts.items() if k in GLASS_KEYS]
            if not glass:
                continue
            others = [o for k, o in spec.parts.items() if k not in GLASS_KEYS]
            frac, area = score(glass, others, args.reach)
            rows.append((spec.asset_id, frac, area))
            if frac < args.min:
                bad.append(spec.asset_id)
    for (aid, frac, area) in sorted(rows, key=lambda r: r[1]):
        print("  %-32s visible %5.1f%% of %7.2f m2%s" % (aid, 100.0 * frac, area, "   <-- HIDDEN" if frac < args.min else ""))
    print("\n%d module(s) with glass, %d below %.0f%% visible" % (len(rows), len(bad), 100.0 * args.min))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
