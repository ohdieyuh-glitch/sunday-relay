#!/usr/bin/env python3
"""What the kit COSTS, and how much of that cost is visible.

    python3 wonderland/art/blender/scripts/report_performance.py

A triangle budget is easy to state and useless on its own: 347,000 triangles
means nothing without knowing whether they are buying silhouette or buying
nothing. So this reports three things, in rising order of usefulness:

  COUNTS        totals, medians, the largest, the over-budget -- from the
                manifest, so they are the same numbers the world session gets
  DENSITY       triangles per metre of HEIGHT and per square metre of ground.
                A needle earns its triangles by being 118 m tall; a doorstep
                spending the same number is spending them on nothing anybody
                will resolve
  HIDDEN SHARE  the fraction of each module's surface AREA that is never hit by
                a ray from outside it. That is geometry serving nothing at all,
                and it is MEASURED rather than guessed: a BVH tree is built
                over the module and rays are cast onto it from a sphere of
                directions, marking every face that is reachable. What is left
                is interior -- the buried faces of a union of solids, which is
                what every module in this kit is.

WHAT A HIGH HIDDEN SHARE MEANS, AND WHAT IT DOES NOT. It does not mean a module
is badly built: overlapping solids is this kit's idiom, it is why the meshes are
manifold and why the coincident-surface class of bug is rare here, and Nanite
does not care. It means the module is carrying faces that could be removed by a
boolean union if one were ever wanted, and it tells you WHICH modules would
benefit most if that day comes. Nothing here deletes anything.
"""

import argparse
import io
import json
import math
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy                                          # noqa: E402
from mathutils import Vector                        # noqa: E402
from mathutils.bvhtree import BVHTree               # noqa: E402

from forge import mesh as M                         # noqa: E402
from forge import units as U                        # noqa: E402
from forge.registry import builders as ALL_BUILDERS  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, ".."))
MANIFEST = os.path.join(ROOT, "manifests", "wonderland-blender-kit.json")
OUT = os.path.join(ROOT, "validation", "PERFORMANCE_REPORT.json")


def hidden_share(objs, bearings=10, grid=40):
    """The fraction of surface AREA no ray from outside can reach.

    Rays are cast from a shell of directions onto the module's own bounding
    sphere. `bearings` directions at `grid` x `grid` each is coarse on purpose:
    the number wanted is "roughly what share", not a certificate, and 16,000
    rays per module is already a couple of minutes across the kit.
    """
    verts, polys, areas = [], [], []
    for obj in objs.values():
        base = len(verts)
        mw = obj.matrix_world
        verts += [mw @ v.co for v in obj.data.vertices]
        for p in obj.data.polygons:
            idx = [base + i for i in p.vertices]
            for t in range(1, len(idx) - 1):
                polys.append((idx[0], idx[t], idx[t + 1]))
                areas.append(p.area / max(1, len(idx) - 2))
    if not polys:
        return None
    tree = BVHTree.FromPolygons([tuple(v) for v in verts], polys,
                                all_triangles=True)
    lo = Vector((min(v.x for v in verts), min(v.y for v in verts),
                 min(v.z for v in verts)))
    hi = Vector((max(v.x for v in verts), max(v.y for v in verts),
                 max(v.z for v in verts)))
    centre = (lo + hi) * 0.5
    radius = max((hi - lo).length * 0.5, 0.5)
    seen = set()
    for b in range(bearings):
        # a spiral over the sphere, weighted towards the horizon because that
        # is where a camera stands
        t = (b + 0.5) / bearings
        az = 2.0 * math.pi * t * 3.7
        el = math.radians(-8.0 + 62.0 * t)
        fwd = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el),
                      math.sin(el)))
        right = fwd.cross(Vector((0.0, 0.0, 1.0)))
        right = right.normalized() if right.length > 1e-6 else Vector((1.0, 0.0, 0.0))
        up = right.cross(fwd).normalized()
        for iu in range(grid):
            tu = ((iu + 0.5) / grid * 2.0 - 1.0) * radius
            for ir in range(grid):
                tr = ((ir + 0.5) / grid * 2.0 - 1.0) * radius
                origin = centre + right * tr + up * tu + fwd * (radius * 2.0)
                hit = tree.ray_cast(origin, -fwd, radius * 4.0)
                if hit[2] is not None:
                    seen.add(hit[2])
    total = sum(areas)
    lit = sum(areas[i] for i in seen)
    return max(0.0, min(1.0, 1.0 - lit / total)) if total > 0 else None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--no-hidden", action="store_true",
                    help="skip the ray-cast pass (it is the slow one)")
    args = ap.parse_args(argv)

    with io.open(MANIFEST, encoding="utf8") as fh:
        manifest = json.load(fh)
    by_id = {a["asset_id"]: a for a in manifest["assets"]}

    hidden = {}
    if not args.no_hidden:
        for group, builder in ALL_BUILDERS():
            M.clear_scene()
            forge = M.Forge()
            spec = builder(forge)
            forge.parts = {}
            hidden[spec.asset_id] = hidden_share(spec.parts)

    rows = []
    for a in manifest["assets"]:
        h_m = U.uu_to_m(a["height_uu"])
        sz = [U.uu_to_m(v) for v in a["size_uu"]]
        ground = max(sz[0] * sz[1], 0.01)
        rows.append({
            "asset_id": a["asset_id"],
            "family_group": a["family_group"],
            "tris": a["tris_total"],
            "meshes": a["part_count"],
            "height_m": round(h_m, 2),
            "tris_per_m_height": round(a["tris_total"] / max(h_m, 0.1), 1),
            "tris_per_m2_ground": round(a["tris_total"] / ground, 1),
            "over_budget": a["over_budget"],
            "budget": a["tri_budget"],
            "nanite_recommended": a["nanite_recommended"],
            "hidden_area_share": (None if hidden.get(a["asset_id"]) is None
                                  else round(hidden[a["asset_id"]], 3)),
        })
    rows.sort(key=lambda r: -r["tris"])

    tris = [r["tris"] for r in rows]
    per_h = [r["tris_per_m_height"] for r in rows]
    by_group = {}
    for r in rows:
        g = by_group.setdefault(r["family_group"],
                                {"assets": 0, "tris": 0, "meshes": 0})
        g["assets"] += 1
        g["tris"] += r["tris"]
        g["meshes"] += r["meshes"]

    hid = [r["hidden_area_share"] for r in rows if r["hidden_area_share"] is not None]
    report = {
        "schema": "wonderland-kit-performance/1",
        "kit_version": manifest.get("kit_version"),
        "from_manifest": os.path.relpath(MANIFEST, ROOT),
        "totals": {
            "assets": len(rows),
            "meshes": sum(r["meshes"] for r in rows),
            "triangles": sum(tris),
            "median_triangles": int(statistics.median(tris)),
            "mean_triangles": int(statistics.mean(tris)),
            "largest": rows[0]["asset_id"],
            "largest_triangles": rows[0]["tris"],
            "over_budget": [r["asset_id"] for r in rows if r["over_budget"]],
        },
        "density": {
            "median_tris_per_m_height": round(statistics.median(per_h), 1),
            "heaviest_per_m_height": sorted(
                rows, key=lambda r: -r["tris_per_m_height"])[:5],
            "note": ("triangles per metre of height is the silhouette measure: "
                     "a 118 m needle spending 330 a metre is buying skyline, a "
                     "1.5 m prop spending 1,200 a metre is buying nothing "
                     "anybody will resolve"),
        },
        "hidden": {
            "measured": bool(hid),
            "median_share": round(statistics.median(hid), 3) if hid else None,
            "worst": sorted([r for r in rows if r["hidden_area_share"] is not None],
                            key=lambda r: -r["hidden_area_share"])[:8],
            "note": ("the share of surface AREA no ray from outside reaches. "
                     "It is the price of building by union rather than by "
                     "boolean, it is the same price that makes these meshes "
                     "manifold, and nothing here removes it -- this says which "
                     "modules would gain most if a union pass is ever wanted"),
        },
        "by_group": dict(sorted(by_group.items())),
        "assets": rows,
    }
    with io.open(args.out, "w", encoding="utf8") as fh:
        json.dump(report, fh, indent=2)
        fh.write(u"\n")
    t = report["totals"]
    print("performance -> %s" % os.path.relpath(args.out, ROOT))
    print("  %d assets, %d meshes, %d triangles" % (t["assets"], t["meshes"],
                                                    t["triangles"]))
    print("  median %d, mean %d, largest %s at %d"
          % (t["median_triangles"], t["mean_triangles"], t["largest"],
             t["largest_triangles"]))
    print("  median %.0f triangles per metre of height"
          % report["density"]["median_tris_per_m_height"])
    if hid:
        print("  median %.0f%% of surface area is never reachable from outside"
              % (report["hidden"]["median_share"] * 100.0))
    if t["over_budget"]:
        print("  OVER BUDGET: %s" % ", ".join(t["over_budget"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
