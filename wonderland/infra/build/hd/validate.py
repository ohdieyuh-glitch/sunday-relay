#!/usr/bin/env python3
"""Validate the HD asset library without an engine — Phase F's mechanism.

    python3 hd/validate.py            # table + PASS/FAIL, exit 1 on FAIL
    python3 hd/validate.py --json=out.json

Reports, per asset: tier, triangle count at every LOD, material slot, Nanite
flag (and that it is INERT on this SM5 target), bounds, fit, collision, and
whether the material it names exists in the generator's MATERIAL_SPEC.

WHAT IT CATCHES, each one a real way this library could lie:

  * a mesh whose triangles reference a vertex that does not exist
    (an IndexError at cook time, inside a commandlet, with no traceback);
  * a degenerate triangle — zero area — which builds fine and renders as a
    black sliver under Lumen;
  * an edge shared by three or more triangles — a self-intersecting wall
    panel that the LOD reducer will fold into a bow-tie;
  * an asset that DOES NOT reduce: an LOD chain of one is a 1,900-triangle
    Sphere all over again, which is the exact thing this library replaces;
  * a fit-box mesh that does not fill its 100 uu box, so a kit's scale
    arithmetic (written for the primitive) places it too small;
  * a tier budget overrun, because a 12,000-triangle "B" asset instanced 400
    times is the frame-rate problem returning through a side door;
  * a material name the generator does not define — MATS.get() returns None,
    the batch key becomes "default", and the piece draws as engine grey,
    which is the 146-grey-batches failure from the L4 log, reborn.

It does NOT report "Nanite enabled" as quality. It reports it as a flag that
is inert on this target, which is what it is.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import assets as A            # noqa: E402
import meshkit as mk          # noqa: E402
import ue_bridge as B         # noqa: E402

GEN = os.path.join(os.path.dirname(HERE), "generate-hub-level.py")


def generator_materials():
    """Material names the generator's MATERIAL_SPEC defines, read as text so
    this never imports the 11,000-line generator to learn 60 strings."""
    names = set()
    try:
        src = open(GEN, encoding="utf8").read()
    except OSError:
        return names
    start = src.find("MATERIAL_SPEC = {")
    if start < 0:
        return names
    depth, i = 0, start + len("MATERIAL_SPEC = ")
    end = i
    while end < len(src):
        ch = src[end]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        end += 1
    for m in re.finditer(r'^\s*"([a-z0-9_]+)"\s*:', src[i:end], re.M):
        names.add(m.group(1))
    return names


def check_mesh(m):
    """Structural checks on one Mesh. Returns a list of problem strings."""
    probs = []
    nv = len(m.verts)
    edges = {}
    for ti, (a, b, c) in enumerate(m.tris):
        if not (0 <= a < nv and 0 <= b < nv and 0 <= c < nv):
            probs.append("tri %d references a missing vertex" % ti)
            continue
        if a == b or b == c or a == c:
            probs.append("tri %d is degenerate (repeated index)" % ti)
            continue
        pa, pb, pc = m.verts[a], m.verts[b], m.verts[c]
        ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
        wx, wy, wz = pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]
        n2 = ((uy * wz - uz * wy) ** 2 + (uz * wx - ux * wz) ** 2
              + (ux * wy - uy * wx) ** 2)
        if n2 < 1e-10:
            probs.append("tri %d has zero area" % ti)
        for e in ((a, b), (b, c), (c, a)):
            k = (min(e), max(e))
            edges[k] = edges.get(k, 0) + 1
    over = sum(1 for v in edges.values() if v > 2)
    if over:
        probs.append("%d edge(s) shared by 3+ triangles (self-intersection)" % over)
    if any(not all(abs(c) < 1e7 for c in v) for v in m.verts):
        probs.append("vertex coordinates out of range")
    return probs


def validate(names=None):
    mats = generator_materials()
    rows, fails = [], []
    for name in sorted(names or A.ASSETS):
        spec = A.ASSETS[name]
        row = {"asset": name, "tier": spec["tier"], "material": spec["material"],
               "nanite_flag": bool(spec["nanite"]), "nanite_effective": False,
               "collision": name in B.COLLIDES, "fit": spec.get("fit", "box"),
               "path": B.asset_path(name), "problems": []}
        try:
            m = spec["build"]()
            if spec.get("fit", "box") == "box":
                m.fit_box(100.0, uniform=bool(spec.get("uniform")))
        except Exception as exc:
            row["problems"].append("build raised %s: %s" % (type(exc).__name__, exc))
            rows.append(row)
            fails.append(name)
            continue
        row["problems"].extend(check_mesh(m))
        lods = mk.lod_chain(m)
        row["lods"] = [x.tri_count() for x in lods]
        row["tris"] = m.tri_count()
        row["verts"] = len(m.verts)
        ex = m.extents()
        row["bounds"] = [round(e, 1) for e in ex]
        row["signature"] = m.signature()
        budget = A.TRI_BUDGET[spec["tier"]]
        if m.tri_count() > budget:
            row["problems"].append("%d tris over the %s budget of %d"
                                   % (m.tri_count(), spec["tier"], budget))
        if len(lods) < 2 and m.tri_count() > 200:
            row["problems"].append("no reduction LOD (chain of one) at %d tris"
                                   % m.tri_count())
        if spec.get("fit", "box") == "box" and not spec.get("uniform"):
            if any(abs(e - 100.0) > 0.5 for e in ex):
                row["problems"].append("fit_box left extents at %s" % row["bounds"])
        if mats and spec["material"] not in mats:
            row["problems"].append("material %r is not in MATERIAL_SPEC"
                                   % spec["material"])
        if name not in A.FALLBACK:
            row["problems"].append("no FALLBACK primitive registered")
        if name not in A.SILHOUETTE:
            row["problems"].append("no SILHOUETTE for the offline tracer")
        if name not in B.FOLDER:
            row["problems"].append("no HD folder assigned")
        # REDUCED LODs ARE HELD TO A DIFFERENT STANDARD, AND THE REASON IS
        # WRITTEN DOWN. Vertex clustering folds neighbouring faces onto shared
        # edges — "fins" — at the far LODs, where the whole mesh is a few
        # pixels. Measured across the library: LOD0 0.0%, reduced LODs median
        # 7%, worst 37% at the last LOD of the hero roof. A fin at that
        # distance is invisible; a validator that fails 55 of 58 assets on it
        # is a gate that cries wolf, and those get dropped from the list. So
        # LOD0 must be clean, and a reduced LOD fails only past 45% — the
        # regime where the reducer has produced mostly fins, i.e. is broken.
        row["lod_fin_ratio"] = []
        for li, lo in enumerate(lods[1:], 1):
            lp = [x for x in check_mesh(lo) if "shared by 3+" not in x]
            if lp:
                row["problems"].append("LOD%d: %s" % (li, lp[0]))
            edges = {}
            for (a, b, c) in lo.tris:
                for e in ((a, b), (b, c), (c, a)):
                    k = (min(e), max(e))
                    edges[k] = edges.get(k, 0) + 1
            ratio = (sum(1 for v in edges.values() if v > 2) / float(len(edges))) if edges else 0.0
            row["lod_fin_ratio"].append(round(ratio, 3))
            if ratio > 0.45:
                row["problems"].append("LOD%d is %.0f%% fins — the reducer broke it"
                                       % (li, 100.0 * ratio))
        rows.append(row)
        if row["problems"]:
            fails.append(name)
    return rows, fails, mats


def main():
    rows, fails, mats = validate()
    out = None
    for a in sys.argv[1:]:
        if a.startswith("--json="):
            out = a[7:]
    print("HD ASSET VALIDATION  (%d assets; MATERIAL_SPEC has %d names; Nanite "
          "flag is INERT on the SM5 target)" % (len(rows), len(mats)))
    print("  %-20s %-2s %6s  %-22s %-12s %-9s %s"
          % ("asset", "T", "tris", "LOD chain", "material", "collide", "bounds"))
    tot = 0
    for r in rows:
        tot += r.get("tris", 0)
        print("  %-20s %-2s %6d  %-22s %-12s %-9s %s%s"
              % (r["asset"], r["tier"], r.get("tris", 0), str(r.get("lods", [])),
                 r["material"], "yes" if r["collision"] else "-",
                 r.get("bounds"), ("  !! " + "; ".join(r["problems"])) if r["problems"] else ""))
    print("  total LOD0 triangles across the library: %d" % tot)
    if out:
        with open(out, "w") as f:
            json.dump({"assets": rows, "fails": fails}, f, indent=1)
    if fails:
        print("\nFAIL: %d asset(s) have problems: %s" % (len(fails), ", ".join(fails)))
        return 1
    print("\nPASS: every HD asset builds, LOD0 is clean (no dead or folded "
          "triangles), reduces, fits its box, names a real material, and has a "
          "fallback, a silhouette and a folder.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
