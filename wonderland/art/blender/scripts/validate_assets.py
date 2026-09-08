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
from mathutils import Vector                        # noqa: E402

from forge import export as X                       # noqa: E402
from forge import kit as K                          # noqa: E402
from forge import mesh as M                         # noqa: E402
from forge import units as U                        # noqa: E402
from forge.registry import EXEMPT_GROUPS, group_names           # noqa: E402
from forge.registry import groups as GROUPS                     # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, ".."))
REPO = os.path.normpath(os.path.join(ROOT, "..", "..", ".."))
MANIFEST = os.path.join(ROOT, "manifests", "wonderland-blender-kit.json")
MATERIALS_V2 = os.path.join(REPO, "wonderland", "v2", "materials_v2.py")

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


def coincident_faces(objs, tol=3):
    """Coplanar, same-facing faces at the same place, ACROSS THE WHOLE MODULE.

    Hashed on the rounded centroid rather than compared pairwise, so a 13,000
    face hero costs one pass instead of 85 million comparisons. Two faces whose
    centres agree to a millimetre and whose normals point the same way are in
    the same plane at the same place, and one of them is going to flicker.

    IT TAKES EVERY PART AT ONCE, and that is the second thing this check got
    wrong. It first ran per object, once for each material part -- which is
    exactly the wrong grouping, because the renderer does not care which mesh a
    face came from. The kit's own house style put a darker wearing course on
    top of every walk, deck and plinth, in its own part because a part is one
    material; where that course topped out FLUSH with the stone under it, two
    up-facing faces sat in one plane in two different objects and the surface
    rendered solid black. `WL_Market_Arcade_Insert` had two of them, a metre
    apart, and the per-object check passed it. The fix in the geometry is the
    one `elements.landing` already documents -- drop the slab and let the
    course fill the recess -- and the fix in the check is this argument.

    THE NORMALS MUST POINT THE SAME WAY, not merely be parallel, and getting
    that wrong is instructive too. Widening the area tolerance from 1% to 35%
    -- to catch a 3.40 m wall top under a 3.60 m string course, which z-fights
    exactly as badly as two identical faces -- made the check report 58 assets.
    It was right about the wall and wrong about everything else: two boxes
    STACKED on each other share a face centre at their interface, and those two
    faces point in OPPOSITE directions. They are interior faces of a union.
    They are hidden, they cannot flicker, and a kit assembled by stacking has
    thousands of them.

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
    black with a moire in them. `build_assets.py --surface-check` renders every
    family that way for this reason.

    Returns a list of `(key_a, key_b, (x, y, z))`, so a report can say WHERE.
    """
    buckets = {}
    hits = []
    for key, obj in sorted(objs.items()):
        for p in obj.data.polygons:
            c = obj.matrix_world @ p.center
            cell = (round(c.x, tol), round(c.y, tol), round(c.z, tol))
            n = (obj.matrix_world.to_3x3() @ p.normal).normalized()
            for other_key, other_n, other_area in buckets.get(cell, ()):
                if n.dot(other_n) > 0.9999 and \
                   abs(p.area - other_area) < 0.35 * max(p.area, other_area, 1e-9):
                    hits.append((other_key, key, (c.x, c.y, c.z)))
                    break
            buckets.setdefault(cell, []).append((key, n, p.area))
    return hits


def _point_in_poly(pt, poly):
    """Even-odd test, in the plane's own 2D basis."""
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            t = (y - y0) / (y1 - y0)
            if x < x0 + t * (x1 - x0):
                inside = not inside
    return inside


def _plane_basis(n):
    a = Vector((0.0, 0.0, 1.0)) if abs(n.z) < 0.9 else Vector((1.0, 0.0, 0.0))
    u = n.cross(a).normalized()
    return u, n.cross(u).normalized()


def coplanar_overlaps(objs, min_area=0.04, up_from=0.985, ang=0.002, off=0.003):
    """Two SEPARATE surfaces lying in one plane, facing one way, OVERLAPPING.

    This is the check `coincident_faces` says it cannot do, and the reason it
    is worth doing anyway is that the defect is not rare: it is what the kit's
    own house style produces by accident. A darker wearing course laid on a
    walk, a deck or a coping, topping out FLUSH with the stone under it, puts
    two up-facing surfaces in one plane. Their centres differ, their areas
    differ, and `coincident_faces` is blind to them -- so `WL_Bridge_Arc`
    shipped with both deck approaches solid black, and nothing said so.

    WHY BLACK RATHER THAN A FLICKER, which is worth knowing because it is the
    signature to look for. In a rasteriser coincident faces shimmer. In Cycles
    they go black: a ray lands on one surface and the shadow ray it sends
    towards the sun immediately hits the other one, a hair away, so the surface
    shadows itself completely. Every solid-black panel in this kit's history --
    terrace tops, landings, postern bands, wearing courses -- is this.

    HOW IT AVOIDS THE FALSE POSITIVES that stopped the cheap versions:

      * faces are bucketed by QUANTISED PLANE (normal and offset), so only
        genuinely coplanar, genuinely same-facing faces are ever compared
      * within a plane, faces sharing a vertex are unioned into ONE surface, so
        a triangulated slab top is one patch rather than fifty overlapping ones
      * overlap is tested by POINT IN POLYGON, not by bounding box. A bounding
        box says a lathe's annular top overlaps anything inside its own hole,
        which reported 32 phantoms on one conical roof alone
      * only UP-FACING surfaces are reported. A pair of down-facing faces at
        the bottom of a stack is coincident too, and is buried in the solid,
        unlit, and cannot show. Restricting to a normal within 10 degrees of
        straight up took the kit from 448 hits to 52, and the ones sampled were
        all real -- two of them visible in renders already committed.

    So it does not claim to find every coplanar pair. It finds the ones that
    are going to be looked at, which is the useful half. The magenta pass in
    `build_assets.py --surface-check` remains the catch-all.

    Returns a list of `(keys_a, keys_b, overlap_m2, (x, y, z))`.
    """
    planes = {}
    for key, obj in sorted(objs.items()):
        mw, mn = obj.matrix_world, obj.matrix_world.to_3x3()
        for poly in obj.data.polygons:
            n = mn @ poly.normal
            if n.length < 1e-9:
                continue
            n = n.normalized()
            if n.z < up_from:
                continue
            c = mw @ poly.center
            pk = (round(n.x / ang), round(n.y / ang), round(n.z / ang),
                  round(n.dot(c) / off))
            vs = [tuple(round(v, 4) for v in (mw @ obj.data.vertices[i].co))
                  for i in poly.vertices]
            planes.setdefault(pk, []).append((key, vs, poly.area, n))

    out = []
    for _pk, faces in planes.items():
        if len(faces) < 2:
            continue
        parent = list(range(len(faces)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        seen = {}
        for i, (_k, vs, _a, _n) in enumerate(faces):
            for v in vs:
                j = seen.setdefault(v, i)
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[ri] = rj
        groups = {}
        for i, (k, vs, a, _n) in enumerate(faces):
            groups.setdefault(find(i), []).append((k, vs, a))
        if len(groups) < 2:
            continue
        n0 = faces[0][3]
        u, w = _plane_basis(n0)
        # THE PLANE'S OWN OFFSET, or the reported point loses its height: u and
        # w span the plane, so `u*cx + w*cy` alone puts every up-facing hit at
        # z = 0 and the report names a place nobody can find.
        d0 = n0.dot(Vector(faces[0][1][0]))
        flat = []
        for mem in groups.values():
            keys, polys, area = set(), [], 0.0
            for (k, vs, a) in mem:
                keys.add(k)
                area += a
                polys.append([(Vector(v).dot(u), Vector(v).dot(w)) for v in vs])
            flat.append((sorted(keys), polys, area))
        for i in range(len(flat)):
            for j in range(i + 1, len(flat)):
                ka, pa, aa = flat[i]
                kb, pb, ab = flat[j]
                small, big = (pa, pb) if aa <= ab else (pb, pa)
                shared, where = 0.0, None
                for face in small:
                    cx = sum(q[0] for q in face) / len(face)
                    cy = sum(q[1] for q in face) / len(face)
                    if any(_point_in_poly((cx, cy), g) for g in big):
                        xs = [q[0] for q in face]
                        ys = [q[1] for q in face]
                        shared += (max(xs) - min(xs)) * (max(ys) - min(ys))
                        where = u * cx + w * cy + n0 * d0
                if shared >= min_area and where is not None:
                    out.append(("+".join(ka), "+".join(kb), shared,
                                (where.x, where.y, where.z)))
    return out


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

    K.apply_measured_terminals(spec, base_z + height)

    # z = 0 is the GROUND DATUM. A module may be cut into it only as far as it
    # declares, and the declaration is checked against the measurement -- so
    # this is stricter than "nothing below zero", not looser. See
    # `kit.ModuleSpec.excavates`.
    dig = getattr(spec, "excavates", 0.0)
    mounts = getattr(spec, "mounts", None)
    if mounts:
        # A MOUNTED MODULE IS CARRIED BY A FACE, NOT BY THE GROUND. It may
        # float, but it may not sink, and it has to publish the flat face it
        # is carried on -- otherwise "mounts" is just a way of switching the
        # footing rule off. See `kit.ModuleSpec.mounts`.
        if base_z < -TOL_M:
            bad.append("%s: mounts on %s but has geometry at z = %.3f m, below "
                       "the ground datum" % (aid, mounts, base_z))
        if not any(sk.kind == "bridge_end" for sk in spec.sockets):
            bad.append("%s: mounts on %s but publishes no bridge_end socket, so "
                       "nothing says which face carries it" % (aid, mounts))
    elif abs(base_z + dig) > TOL_M:
        if dig:
            bad.append("%s: declares excavates=%.3f m but its lowest geometry "
                       "is at z = %.3f m" % (aid, dig, base_z))
        else:
            bad.append("%s: footing is at z = %.3f m, not 0, and it declares no "
                       "excavation (the kit's ground-datum rule)" % (aid, base_z))

    # ONE PASS OVER EVERY PART. See `coincident_faces`: the renderer does not
    # care which mesh a face came from, so neither may this.
    for (ka, kb, at) in coincident_faces(objs):
        bad.append("%s: %s and %s put a face in the same plane at "
                   "(%.2f, %.2f, %.2f) facing the same way -- it renders black"
                   % (aid, ka, kb, at[0], at[1], at[2]))

    for (ka, kb, m2, at) in coplanar_overlaps(objs):
        bad.append("%s: %s and %s share %.2f m2 of one up-facing plane at "
                   "(%.2f, %.2f, %.2f) -- coincident surfaces shadow each "
                   "other and render solid black"
                   % (aid, ka, kb, m2, at[0], at[1], at[2]))

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
        if meta is None:
            bad.append("%s/%s: the mesh has no vertices at all" % (aid, key))
            continue
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
        # A SOCKET LIVES IN THE MODULE'S OWN SPACE, whose origin is the ground
        # datum. So the legal band runs from the datum (or the module's own
        # floor, if it is cut in below it) to the highest vertex -- a mounted
        # module publishes a socket AT the datum it does not itself reach, and
        # that is the point of it.
        z_lo, z_hi = min(0.0, base_z) - TOL_M, base_z + height + TOL_M
        if not (z_lo <= sock.z <= z_hi):
            bad.append("%s: socket %r sits at z = %.2f m, outside the module "
                       "(%.2f .. %.2f m)"
                       % (aid, sock.name, sock.z, z_lo + TOL_M, z_hi - TOL_M))

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


def check_coverage(discovered, manifest_path=MANIFEST):
    """EVERY exportable asset in the manifest must have been validated.

    THIS IS THE CHECK THE 55-vs-44 SCARE ASKED FOR. The scare itself was a
    stale sentence in the handoff -- the report said `checked 55, failures 0`
    while the document still said 44, written when the kit had 44 -- so no
    asset had ever escaped validation. But the failure it DESCRIBED was real
    and one edit away: `build_assets.py` and `validate_assets.py` each carried
    their own hand-written family list, and adding a family to the builder
    alone would have exported, manifested and shipped assets nothing checked.

    Two things now stand in the way. The lists became one (`forge/registry.py`),
    and this compares the set of asset ids the validator actually built against
    the set the manifest actually contains, naming the difference either way.
    A stale manifest fails as loudly as a missed family, which is right: both
    mean the thing shipped is not the thing checked.

    Returns failure strings; empty when coverage is exact.
    """
    bad = []
    if not os.path.exists(manifest_path):
        return ["no manifest at %s -- run build_assets.py before validating"
                % os.path.relpath(manifest_path, ROOT)]
    with open(manifest_path, encoding="utf-8") as fh:
        man = json.load(fh)

    listed = {a["asset_id"]: a for a in man.get("assets", [])}
    exempt = set(EXEMPT_GROUPS)
    expected = {aid for aid, a in listed.items()
                if a.get("family_group") not in exempt}

    missing = sorted(expected - set(discovered))
    extra = sorted(set(discovered) - set(listed))
    for aid in missing:
        bad.append("coverage: %s is in the manifest and was NOT validated "
                   "(family_group %r)" % (aid, listed[aid].get("family_group")))
    for aid in extra:
        bad.append("coverage: %s was validated and is NOT in the manifest -- "
                   "the manifest is stale; re-run build_assets.py" % aid)

    if man.get("counts", {}).get("assets") != len(listed):
        bad.append("coverage: manifest counts.assets is %r but it lists %d "
                   "assets" % (man.get("counts", {}).get("assets"), len(listed)))

    # every manifest part must name an export that exists on disk
    for aid, a in sorted(listed.items()):
        if a.get("family_group") in exempt:
            continue
        for key, part in sorted(a.get("parts", {}).items()):
            for fmt in ("glb", "fbx"):
                rel = part.get(fmt)
                if not rel:
                    bad.append("coverage: %s/%s has no %s path in the manifest"
                               % (aid, key, fmt.upper()))
                elif not os.path.exists(os.path.join(ROOT, rel)):
                    bad.append("coverage: %s/%s names %s but the file is not "
                               "there" % (aid, key, rel))
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

    # A VARIANT'S SOCKETS ARE A SUBSET OF ITS BASE'S, at the same places.
    #
    # This is what makes a weathered module safe to substitute into a spelled
    # stack: `age` and `overgrowth` are not allowed to move a join at all, and
    # `damage` may only DROP the sockets it destroyed. Without the rule the
    # variants would be a second kit that merely resembles the first, and a
    # generator would have to know which was which.
    by_id = {s.asset_id: s for s in specs}
    for s in specs:
        base_id = s.params.get("variant_of")
        if not base_id:
            continue
        base = by_id.get(base_id)
        if base is None:
            bad.append("%s: says it is a variant of %s, which is not in the kit"
                       % (s.asset_id, base_id))
            continue
        destroyed = set(s.params.get("sockets_destroyed") or ())
        for sock in s.sockets:
            b = base.socket(sock.name)
            if b is None:
                bad.append("%s: publishes socket %r, which its base %s does not"
                           % (s.asset_id, sock.name, base_id))
            elif abs(b.z - sock.z) > TOL_M or abs(b.radius - sock.radius) > TOL_M:
                bad.append("%s: socket %r moved from (z %.3f, r %.3f) to "
                           "(z %.3f, r %.3f) -- a variant may drop a join, "
                           "never move one"
                           % (s.asset_id, sock.name, b.z, b.radius,
                              sock.z, sock.radius))
        missing = {b.name for b in base.sockets} - {x.name for x in s.sockets}
        unexplained = missing - destroyed
        if unexplained:
            bad.append("%s: lost socket(s) %s without saying they were "
                       "destroyed" % (s.asset_id, ", ".join(sorted(unexplained))))
        if destroyed and not s.params.get("damage"):
            bad.append("%s: claims destroyed sockets but declares no damage"
                       % s.asset_id)

    # every foot must be able to carry at least one body
    for s in specs:
        if s.role != "foot":
            continue
        if not any(K.compatible(s, b) for b in specs if b.role != "foot"):
            bad.append("%s: nothing in the kit fits on this foot" % s.asset_id)
    return bad


# --------------------------------------------------------------------------


def self_test():
    """Prove the coverage check bites, in the style of `gauntlet-check.py`.

    A check nobody has watched fail is a check nobody should trust. This one
    exists because a documentation line said 44 while the report said 55, and
    the whole point of the fix is that such a gap can no longer be silent -- so
    the gap is manufactured here, four ways, and the check has to catch all of
    them.
    """
    import tempfile

    def manifest(assets, count=None):
        d = {"counts": {"assets": len(assets) if count is None else count},
             "assets": [{"asset_id": a, "family_group": "towers", "parts": {}}
                        for a in assets]}
        fh = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(d, fh)
        fh.close()
        return fh.name

    ok = manifest(["A", "B"])
    assert not check_coverage(["A", "B"], ok), "an exact match must pass"

    bad = check_coverage(["A"], manifest(["A", "B"]))
    assert any("B is in the manifest and was NOT validated" in b for b in bad), \
        "a family present in the manifest but not discovered must fail"

    bad = check_coverage(["A", "B", "C"], manifest(["A", "B"]))
    assert any("C was validated and is NOT in the manifest" in b for b in bad), \
        "a stale manifest must fail"

    bad = check_coverage(["A", "B"], manifest(["A", "B"], count=44))
    assert any("counts.assets is 44" in b for b in bad), \
        "a counts field disagreeing with the asset list must fail -- this is "\
        "the exact shape of the 55-vs-44 report"

    bad = check_coverage([], "/nonexistent/manifest.json")
    assert any("no manifest" in b for b in bad), "a missing manifest must fail"

    print("coverage self-test OK -- the check bites on all five cases")

    # ---- and the surface checks, on geometry built for the purpose ---------
    from forge import mesh as MK

    def two_slabs(dz_a, dz_b, inset, offset=0.0):
        """Two boxes whose tops differ by `dz_b - dz_a`, the smaller inset."""
        MK.clear_scene()
        f = MK.Forge()
        a = f.part("stone")
        b = f.part("stone_dark")
        a.box(4.0, 4.0, 1.0 + dz_a, at=(0.0, 0.0, 0.0), centre_z=False)
        b.box(4.0 - inset, 4.0 - inset, 0.2 + dz_b, at=(offset, 0.0, 0.8),
              centre_z=False)
        return f.emit("SelfTest")

    flush = two_slabs(0.0, 0.0, 1.2)          # both top out at 1.00
    hits = coplanar_overlaps(flush)
    assert hits, "a course laid flush with the slab under it must fail"
    assert hits[0][2] > 5.0, "and the reported area must be the real overlap"

    proud = two_slabs(0.0, 0.015, 1.2)        # the course stands 15 mm proud
    assert not coplanar_overlaps(proud), \
        "a course standing proud of its slab must pass -- this is what "\
        "elements.wear_course builds"

    same = two_slabs(0.0, 0.0, 0.0)           # identical footprints
    assert coincident_faces(same), \
        "two identical faces in one place must fail the centroid check too"

    apart = two_slabs(0.0, 0.0, 1.2, offset=6.0)   # same plane, 3 m away
    assert not coplanar_overlaps(apart), \
        "two coplanar surfaces that do not overlap must pass"

    MK.clear_scene()
    print("surface self-test OK -- flush fails, proud passes, disjoint passes")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=os.path.join(ROOT, "validation",
                                                   "VALIDATION_REPORT.json"))
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--self-test", action="store_true",
                    help="prove the coverage check bites, then exit")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    mats = world_materials()
    if mats is None:
        print("NOTE: materials_v2.py not found at %s; the material-exists "
              "check is skipped and the report says so." % MATERIALS_V2)

    failures, checked, per_asset = [], 0, {}
    hashes = {}
    specs = []

    for group, group_builders in GROUPS():
        for builder in group_builders:
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
    cov_bad = check_coverage([s.asset_id for s in specs])
    for line in kit_bad + cov_bad:
        print("  FAIL (kit) %s" % line)
    failures += kit_bad + cov_bad

    report = {
        "checked_assets": checked,
        "failures": len(failures),
        "material_check": "skipped (materials_v2.py not found)" if mats is None
                          else "%d MI_V2_* names parsed from materials_v2.py" % len(mats),
        "per_asset": per_asset,
        "kit_level": kit_bad,
        "coverage": cov_bad,
        "coverage_rule": ("every asset in the manifest is discovered by the "
                          "validator and reported; exempt groups: %s"
                          % (", ".join(EXEMPT_GROUPS) or "none")),
        "families": list(group_names()),
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
