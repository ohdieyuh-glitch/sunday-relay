#!/usr/bin/env python3
"""Fail loudly on an invalid asset.

    python3 scripts/validate_assets.py [--json PATH] [--quiet]

Every check here exists because something went wrong, either in this session
or in this repository's ledger. None of them is a style rule.

  EXPORT AGREES         the GLB and FBX on disk are re-read and their own
                        numbers compared against the measured geometry. The
                        FBX is checked BOTH ways -- as centimetres and through
                        its UnitScaleFactor -- because the whole point of the
                        export recipe in `units.py` is that the two agree.
  ONE MATERIAL SLOT     `meshkit`'s stated constraint: the world draws through
                        WonderlandInstancedBatch, one MaterialPath per batch,
                        so a second slot renders slot 0 everywhere.
  MATERIAL EXISTS       the assigned MI_V2_* name is parsed out of the real
                        `wonderland/v2/materials_v2.py`. A manifest naming a
                        material the world does not have is a broken handoff
                        that would only surface in the editor.
  FOOTING AT z = 0      the kit's origin rule. `WL_Bridge_Sky` was authored at
                        its intended 26 m and broke it.
  SOCKETS ON THE LADDER a join radius off the ladder cannot be spelled.
  SOCKET REACHES MESH   a foot or body must have geometry AT its top socket,
                        at that radius. The belfry stage declared a socket
                        4.4 m above where its masonry stopped, and the render
                        showed a spire floating over a hole.
  TERMINABLE RUNGS      every rung a body can leave you on has at least one
                        crown or spire that fits it. Making the machicolated
                        stage a body left the XL rung with no terminator and
                        the first spelling test drew a tower with an open top.
  NO COINCIDENT FACES   two coplanar faces at the same place render as noise
                        or as solid black. `tower_base_terraced` laid a full
                        disc on each terrace top and every terrace went black.
  GEOMETRY IS SANE      no degenerate faces, no loose vertices, no zero
                        normals, no inverted closed shells (signed volume).
  DETERMINISTIC         the same module built twice is byte-identical. meshkit
                        requires this of the V2 kernel for the same reason:
                        a manifest of measured numbers is worthless if a
                        rebuild moves them.

Exit 0 only if every asset passes. Exit 1 lists what failed.
"""

import argparse
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy                                          # noqa: E402

from forge import export as X                       # noqa: E402
from forge import kit as K                          # noqa: E402
from forge import mesh as M                         # noqa: E402
from forge import units as U                        # noqa: E402
from forge.families import (civic, details, hero, roofscape,         # noqa: E402
                            thresholds, towers, walls)

ROOT = os.path.normpath(os.path.join(HERE, ".."))
REPO = os.path.normpath(os.path.join(ROOT, "..", "..", ".."))
MANIFEST = os.path.join(ROOT, "manifests", "wonderland-blender-kit.json")
MATERIALS_V2 = os.path.join(REPO, "wonderland", "v2", "materials_v2.py")

FAMILIES = (("towers", towers), ("thresholds", thresholds), ("civic", civic),
            ("walls", walls), ("roofscape", roofscape),
            ("details", details), ("hero", hero))

TOL_M = 0.02            # 2 cm: tighter than any authored feature, looser than fp


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def world_materials():
    """The MI_V2_* names that actually exist in the V2 material table."""
    if not os.path.exists(MATERIALS_V2):
        return None
    src = open(MATERIALS_V2, encoding="utf-8").read()
    return set(re.findall(r'"(MI_V2_[A-Za-z0-9_]+)"\s*:', src))


def mesh_hash(obj):
    """A stable digest of a mesh's vertices and faces, for the rebuild check."""
    h = hashlib.sha256()
    me = obj.data
    for v in me.vertices:
        h.update(b"%.6f|%.6f|%.6f;" % (v.co.x, v.co.y, v.co.z))
    for p in me.polygons:
        h.update(b"f" + b",".join(b"%d" % i for i in p.vertices) + b";")
    return h.hexdigest()


def coincident_faces(obj, tol=3):
    """Count faces sharing a centroid cell with a near-parallel neighbour.

    Hashed on the rounded centroid rather than compared pairwise, so a 13,000
    face hero costs one pass instead of 85 million comparisons. Two faces whose
    centres agree to a millimetre and whose normals are parallel are in the
    same plane at the same place, and one of them is going to flicker.

    THE NORMALS MUST POINT THE SAME WAY, not merely be parallel, and getting
    that wrong is instructive. Widening the area tolerance from 1% to 35% --
    to catch a 3.40 m wall top under a 3.60 m string course, which z-fights
    exactly as badly as two identical faces -- made the check report 58 assets.
    It was right about the wall and wrong about everything else: two boxes
    STACKED on each other share a face centre at their interface too, and
    those two faces point in OPPOSITE directions. They are interior faces of a
    union. They are hidden, they cannot flicker, and a kit assembled by
    stacking has thousands of them.

    So `dot > 0.9999` rather than `abs(dot) ~ 1`. Two faces at the same place
    pointing the SAME way are both visible and one of them is going to
    shimmer; two pointing at each other are just a join.

    WHAT THIS DOES NOT CATCH, stated so nobody trusts it further than it goes:
    two faces that are coplanar and same-facing but only PARTLY overlap, with
    different centres and different areas. `WL_Wall_Postern_Gate` had exactly
    that -- a flanking wall running 0.90 m past the gate block put their two
    outer faces in one plane over that strip -- and this check saw nothing.
    Catching it properly needs polygon intersection per plane, and the cheap
    approximations (bucket by plane, compare bounding boxes) produce false
    positives on the kit's own arch bands, which are deliberately coplanar with
    the wall they stand in.

    The thing that DOES find it costs one render: put the module against a
    bright magenta world. A hole shows magenta; two fighting surfaces show
    black with a moire in them. `build_assets.py` renders every family by
    default for this reason.
    """
    me = obj.data
    buckets = {}
    hits = 0
    for p in me.polygons:
        c = p.center
        key = (round(c.x, tol), round(c.y, tol), round(c.z, tol))
        n = p.normal
        for other_n, other_area in buckets.get(key, ()):
            if n.dot(other_n) > 0.9999 and \
               abs(p.area - other_area) < 0.35 * max(p.area, other_area, 1e-9):
                hits += 1
                break
        buckets.setdefault(key, []).append((n.copy(), p.area))
    return hits


def geometry_reaches(obj_list, z_m, radius_m, tol=TOL_M):
    """Is there geometry at height `z_m`, out at `radius_m`?

    The socket-floats check. Samples vertices within `tol` of the plane and
    asks whether any of them is within 12% of the socket radius -- 12% because
    a shaft may finish on a chamfer or a small set-back and still be a sound
    join, while a 4 m hole is not.
    """
    for obj in obj_list:
        for v in obj.data.vertices:
            if abs(v.co.z - z_m) > tol:
                continue
            r = (v.co.x ** 2 + v.co.y ** 2) ** 0.5
            if abs(r - radius_m) <= max(0.12 * radius_m, 0.05):
                return True
    return False


# --------------------------------------------------------------------------
# the checks
# --------------------------------------------------------------------------


def check_asset(spec, objs, mats_available):
    """Return a list of failure strings for one built module."""
    bad = []
    aid = spec.asset_id

    zs, all_objs = [], list(objs.values())
    for obj in all_objs:
        zs += [v.co.z for v in obj.data.vertices]
    if not zs:
        return ["%s: emitted no geometry" % aid]
    base_z, height = min(zs), max(zs) - min(zs)

    K.apply_measured_terminals(spec, height)

    if abs(base_z) > TOL_M:
        bad.append("%s: footing is at z = %.3f m, not 0 (the kit's origin rule)"
                   % (aid, base_z))

    for key, obj in sorted(objs.items()):
        me = obj.data
        if len(me.materials) != 1:
            bad.append("%s/%s: %d material slots; the batch renderer takes one"
                       % (aid, key, len(me.materials)))
        name = K.unreal_material(key)
        if mats_available is not None and name not in mats_available:
            bad.append("%s/%s: material %s is not in materials_v2.py"
                       % (aid, key, name))
        if not me.uv_layers:
            bad.append("%s/%s: no UV layer" % (aid, key))

        meta = X.measure(obj)
        if meta["degenerate_faces"]:
            bad.append("%s/%s: %d degenerate face(s)" % (aid, key, meta["degenerate_faces"]))
        if meta["loose_verts"]:
            bad.append("%s/%s: %d loose vertex/vertices" % (aid, key, meta["loose_verts"]))
        if meta["tris"] == 0:
            bad.append("%s/%s: zero triangles" % (aid, key))

        nrm = X.normals_report(obj)
        if nrm["zero_normal_faces"]:
            bad.append("%s/%s: %d face(s) with a zero normal"
                       % (aid, key, nrm["zero_normal_faces"]))
        if nrm["inverted_shells"]:
            bad.append("%s/%s: %d closed shell(s) wound inside-out (%d faces)"
                       % (aid, key, nrm["inverted_shells"], nrm["inverted_faces"]))

        dupes = coincident_faces(obj)
        if dupes:
            bad.append("%s/%s: %d coincident coplanar face(s) -- they render "
                       "as black or as noise" % (aid, key, dupes))

        # ---- the exported files must agree with the mesh -------------------
        glb = os.path.join(ROOT, "exports", "glb", obj.name + ".glb")
        fbx = os.path.join(ROOT, "exports", "fbx", obj.name + ".fbx")
        if not os.path.exists(glb):
            bad.append("%s/%s: no GLB at %s" % (aid, key, glb))
        else:
            g = X.read_glb(glb)
            if g is None:
                bad.append("%s/%s: GLB is unreadable" % (aid, key))
            else:
                # glTF is Y-up: the authored Z becomes Y
                gh = g["max_yup"][1] - g["min_yup"][1]
                mh = meta["size_uu"][2] / U.UU_PER_METRE
                if abs(gh - mh) > TOL_M:
                    bad.append("%s/%s: GLB height %.3f m != mesh %.3f m"
                               % (aid, key, gh, mh))
                if name not in (g["materials"] or []):
                    bad.append("%s/%s: GLB does not carry material %s"
                               % (aid, key, name))
        if not os.path.exists(fbx):
            bad.append("%s/%s: no FBX at %s" % (aid, key, fbx))
        else:
            fx = X.read_fbx_scale(fbx)
            if fx is None:
                bad.append("%s/%s: FBX is unreadable as binary FBX" % (aid, key))
            else:
                stored = fx["stored_z_max"] - fx["stored_z_min"]
                want_uu = meta["size_uu"][2]
                if abs(stored - want_uu) > U.m_to_uu(TOL_M):
                    bad.append("%s/%s: FBX stores %.1f uu of height, mesh is %.1f uu"
                               % (aid, key, stored, want_uu))
                # the two-readings-agree property from units.py
                via_usf = stored * fx["unit_scale_factor"] / U.UU_PER_METRE
                as_cm = stored / U.UU_PER_METRE
                if abs(via_usf - as_cm) > TOL_M:
                    bad.append("%s/%s: FBX is ambiguous -- UnitScaleFactor %g "
                               "reads %.3f m, raw centimetres read %.3f m"
                               % (aid, key, fx["unit_scale_factor"], via_usf, as_cm))

    # ---- sockets -----------------------------------------------------------
    for sock in spec.sockets:
        if sock.kind in ("tower",) or (sock.kind == "crown" and sock.radius > 1e-9):
            if K.rung_of(sock.radius) is None:
                bad.append("%s: socket %r radius %.3f m is off the ladder %s"
                           % (aid, sock.name, sock.radius, sorted(K.LADDER)))
        if sock.z < -TOL_M or sock.z > height + TOL_M:
            bad.append("%s: socket %r sits at z = %.2f m, outside the module "
                       "(0 .. %.2f m)" % (aid, sock.name, sock.z, height))

    # THE STACK INVARIANT APPLIES TO STACK MODULES, and membership is decided
    # by the SOCKET, not by the role name. A tower body joins the module below
    # it through a `tower`-kind bottom socket; a house sits on the ground
    # through a `ground` one. Both are legitimately "body" -- a house is a
    # building mass -- and only the first owes anyone a top socket. Keying the
    # rule on the role name instead would have forced houses to invent a join
    # nothing will ever use.
    top = spec.socket("top")
    bottom = spec.socket("bottom")
    in_stack = (spec.role == "foot"
                or (bottom is not None and bottom.kind == "tower"))
    if in_stack:
        if top is None:
            bad.append("%s: a %s in the stack grammar must publish a top socket"
                       % (aid, spec.role))
        else:
            if abs(top.z - height) > TOL_M:
                bad.append("%s: top socket at %.2f m but the geometry ends at "
                           "%.2f m -- the join would float"
                           % (aid, top.z, height))
            if not geometry_reaches(all_objs, top.z, top.radius):
                bad.append("%s: no geometry at the top socket (z = %.2f m, "
                           "r = %.2f m) -- nothing for the next module to sit on"
                           % (aid, top.z, top.radius))

    if spec.tri_budget:
        tris = sum(X.measure(o)["tris"] for o in all_objs)
        if tris > spec.tri_budget:
            bad.append("%s: %d triangles over its %d budget"
                       % (aid, tris, spec.tri_budget))
    return bad


def check_kit(specs):
    """Structural checks over the whole kit rather than one module."""
    bad = []
    ids = [s.asset_id for s in specs]
    for i in set(ids):
        if ids.count(i) > 1:
            bad.append("duplicate asset id %s" % i)

    # every rung a body can leave you on must have a terminator
    reachable = set()
    for s in specs:
        if s.role in ("foot", "body"):
            t = s.socket("top")
            if t is not None and t.kind == "tower":
                r = K.rung_of(t.radius)
                if r:
                    reachable.add(r)
    for rung in sorted(reachable):
        terms = [s for s in specs if s.role in ("crown", "needle")
                 and s.socket("bottom") is not None
                 and K.rung_of(s.socket("bottom").radius) == rung]
        if not terms:
            bad.append("rung %s: a body can leave a stack here and NO crown or "
                       "spire fits it -- that stack can never be finished" % rung)

    # every foot must be able to carry at least one body
    for s in specs:
        if s.role != "foot":
            continue
        if not any(K.compatible(s, b) for b in specs if b.role != "foot"):
            bad.append("%s: nothing in the kit fits on this foot" % s.asset_id)
    return bad


# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=os.path.join(ROOT, "validation",
                                                   "VALIDATION_REPORT.json"))
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    mats = world_materials()
    if mats is None:
        print("NOTE: materials_v2.py not found at %s; the material-exists "
              "check is skipped and the report says so." % MATERIALS_V2)

    failures, checked, per_asset = [], 0, {}
    hashes = {}
    specs = []

    for group, module in FAMILIES:
        for builder in module.BUILDERS:
            M.clear_scene()
            forge = M.Forge()
            spec = builder(forge)
            forge.parts = {}
            specs.append(spec)
            bad = check_asset(spec, spec.parts, mats)

            # determinism: rebuild in a clean scene and compare digests
            digest = {k: mesh_hash(o) for k, o in spec.parts.items()}
            M.clear_scene()
            f2 = M.Forge()
            spec2 = builder(f2)
            digest2 = {k: mesh_hash(o) for k, o in spec2.parts.items()}
            f2.parts = {}
            if digest != digest2:
                moved = sorted(k for k in digest if digest.get(k) != digest2.get(k))
                bad.append("%s: NOT deterministic -- rebuild changed part(s) %s"
                           % (spec.asset_id, ", ".join(moved)))
            hashes[spec.asset_id] = digest

            per_asset[spec.asset_id] = bad
            failures += bad
            checked += 1
            if bad and not args.quiet:
                for line in bad:
                    print("  FAIL %s" % line)
            elif not args.quiet:
                print("  ok   %s" % spec.asset_id)

    kit_bad = check_kit(specs)
    for line in kit_bad:
        print("  FAIL (kit) %s" % line)
    failures += kit_bad

    report = {
        "checked_assets": checked,
        "failures": len(failures),
        "material_check": "skipped (materials_v2.py not found)" if mats is None
                          else "%d MI_V2_* names parsed from materials_v2.py" % len(mats),
        "per_asset": per_asset,
        "kit_level": kit_bad,
        "mesh_hashes": hashes,
    }
    os.makedirs(os.path.dirname(args.json), exist_ok=True)
    with open(args.json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
        fh.write("\n")

    print("\n%d asset(s) checked, %d failure(s). Report -> %s"
          % (checked, len(failures), os.path.relpath(args.json, ROOT)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
