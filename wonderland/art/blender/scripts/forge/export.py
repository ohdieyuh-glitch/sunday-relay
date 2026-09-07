"""Writing the files, and measuring what was written.

Nothing in this file decides what a module looks like. It takes the objects a
family builder emitted, writes GLB and FBX, and MEASURES the result. The
measurements are what reach the manifest: no dimension in
`wonderland-blender-kit.json` is a number a builder claimed about itself.

TWO FORMATS, FOR TWO DIFFERENT REASONS.

GLB is the format this repository's Unreal side already imports --
`wonderland/marble/import-marble-world.py: import_glb()` drives an
`AssetImportTask` with `InterchangeGenericAssetsPipeline` and turns Nanite on.
Sending the kit through a path that already works is worth more than sending it
through the path a tutorial would pick. glTF is metres and Y-up by
specification, so a GLB needs no scale argument and cannot be misread.

FBX is written as well because a static-mesh kit is what FBX is for, and
because the Unreal FBX importer exposes per-asset options (collision from
UCX_, LOD groups, lightmap UVs) that the glTF path does not. `units.py`
records the measurement that makes this FBX unambiguous about its own scale.
"""

import json
import os
import struct
import zlib

import bpy

from . import units as U


# --------------------------------------------------------------------------
# measurement
# --------------------------------------------------------------------------


def measure(obj):
    """Everything the manifest and the validator want to know about one mesh.

    All of it read off the evaluated mesh data, in the module's authoring
    space (metres, footing at z = 0), then converted once.
    """
    me = obj.data
    if not me.vertices:
        return None
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    tris = sum(max(0, len(p.vertices) - 2) for p in me.polygons)
    uu = U.m_to_uu

    # a face whose area is under a square millimetre contributes nothing but a
    # draw cost and a normal the renderer cannot trust
    degenerate = sum(1 for p in me.polygons if p.area < 1e-6)
    # a vertex on no face survives export as a stray point
    used = set()
    for p in me.polygons:
        used.update(p.vertices)
    loose = len(me.vertices) - len(used)

    return {
        "verts": len(me.vertices),
        "faces": len(me.polygons),
        "tris": tris,
        "degenerate_faces": degenerate,
        "loose_verts": loose,
        "materials": [m.name for m in me.materials],
        "material_slots": len(me.materials),
        "uv_layers": [uvl.name for uvl in me.uv_layers],
        "bbox_min_uu": [round(uu(min(xs)), 2), round(uu(min(ys)), 2), round(uu(min(zs)), 2)],
        "bbox_max_uu": [round(uu(max(xs)), 2), round(uu(max(ys)), 2), round(uu(max(zs)), 2)],
        "size_uu": [round(uu(max(xs) - min(xs)), 2),
                    round(uu(max(ys) - min(ys)), 2),
                    round(uu(max(zs) - min(zs)), 2)],
        "height_m": round(max(zs) - min(zs), 4),
        "base_z_uu": round(uu(min(zs)), 3),
    }


def normals_report(obj):
    """Whether each closed shell in the mesh is wound outward.

    THE FIRST VERSION OF THIS WAS WRONG AND IS WORTH RECORDING. It compared
    every face normal against the WHOLE MESH's centroid and called a face
    inward if the dot product was negative. On a compact object that is a fair
    approximation; on a 118 m tower it is nonsense, because the centroid sits
    at mid-height and every correctly-wound horizontal face below it scores
    negative. It reported `WL_Hero_GreatSpire` at 45% inward-facing and the
    mesh was fine.

    The correct test is the divergence theorem, per connected shell: for a
    closed surface, the signed volume

        V = 1/6 * sum over triangles of  v0 . (v1 x v2)

    is POSITIVE when the winding is outward and negative when it is inverted,
    whatever the shape or where it sits. So this splits the mesh into connected
    components, takes each one's signed volume, and reports the shells whose
    sign is wrong along with how many faces they carry.

    Open shells -- a lathe built with `cap_top=False`, a swept rib -- have no
    enclosed volume and their sign is not meaningful, so a shell whose volume
    is small against its own surface area is reported as `open` and excluded
    from the verdict rather than counted as a failure. A kit assembled from
    unioned shells would otherwise fail its own check on every module.
    """
    me = obj.data
    if not me.polygons:
        return {"faces": 0, "shells": 0, "inverted_shells": 0,
                "inverted_faces": 0, "open_shells": 0, "zero_normal_faces": 0}

    zero = sum(1 for p in me.polygons if p.normal.length < 1e-6)

    # union-find over faces sharing an edge
    parent = list(range(len(me.polygons)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    edge_face = {}
    for pi, poly in enumerate(me.polygons):
        vs = list(poly.vertices)
        for i in range(len(vs)):
            key = (min(vs[i], vs[(i + 1) % len(vs)]),
                   max(vs[i], vs[(i + 1) % len(vs)]))
            if key in edge_face:
                ra, rb = find(edge_face[key]), find(pi)
                if ra != rb:
                    parent[ra] = rb
            else:
                edge_face[key] = pi

    shells = {}
    for pi in range(len(me.polygons)):
        shells.setdefault(find(pi), []).append(pi)

    verts = me.vertices
    inverted_shells = 0
    inverted_faces = 0
    open_shells = 0
    for faces in shells.values():
        vol = 0.0
        area = 0.0
        for pi in faces:
            poly = me.polygons[pi]
            vs = list(poly.vertices)
            area += poly.area
            a = verts[vs[0]].co
            for k in range(1, len(vs) - 1):
                b, c = verts[vs[k]].co, verts[vs[k + 1]].co
                vol += a.dot(b.cross(c)) / 6.0
        # a shell is CLOSED enough to trust when its volume is large against
        # the cube of its own scale; area^1.5 is that scale, and the constant
        # is loose because the test only has to separate "a solid" from "a
        # ribbon".
        if abs(vol) < 0.02 * (area ** 1.5):
            open_shells += 1
            continue
        if vol < 0.0:
            inverted_shells += 1
            inverted_faces += len(faces)

    return {
        "faces": len(me.polygons),
        "shells": len(shells),
        "inverted_shells": inverted_shells,
        "inverted_faces": inverted_faces,
        "open_shells": open_shells,
        "zero_normal_faces": zero,
    }


# --------------------------------------------------------------------------
# writing
# --------------------------------------------------------------------------


def _select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def write_glb(objs, path):
    """glTF binary, metres, Y-up. The format `import_glb` already takes."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    _select_only(objs)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, **U.GLTF_EXPORT)
    return path


def write_fbx(objs, path):
    """FBX in centimetres with UnitScaleFactor 1 -- see `units.py`.

    The x100 is applied INTO the vertex data on a temporary duplicate, so the
    authored objects stay in metres and the GLB written from them is unaffected
    however the two calls are ordered.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    dupes = []
    for o in objs:
        d = o.copy()
        d.data = o.data.copy()
        bpy.context.scene.collection.objects.link(d)
        dupes.append(d)
    _select_only(dupes)
    for d in dupes:
        d.scale = (U.UU_PER_METRE, U.UU_PER_METRE, U.UU_PER_METRE)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = U.FBX_SCENE_UNIT_SCALE
    kw = dict(U.FBX_EXPORT)
    kw["object_types"] = set(kw["object_types"])
    _select_only(dupes)
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, **kw)

    bpy.context.scene.unit_settings.scale_length = 1.0
    for d in dupes:
        me = d.data
        bpy.data.objects.remove(d, do_unlink=True)
        bpy.data.meshes.remove(me, do_unlink=True)
    return path


# --------------------------------------------------------------------------
# reading the files back -- the part that makes the claim checkable
# --------------------------------------------------------------------------


def read_fbx_scale(path):
    """Decode a binary FBX's UnitScaleFactor and its raw vertex Z range.

    This exists so `validate_assets.py` can assert the two-readings-agree
    property on every file, on every build, rather than on the one probe box
    that established it. Returns None if the file is not a binary FBX this
    reader understands -- the validator treats that as a failure, not a pass.
    """
    try:
        with open(path, "rb") as fh:
            d = fh.read()
    except OSError:
        return None
    if not d.startswith(b"Kaydara FBX Binary"):
        return None
    i = d.find(b"UnitScaleFactor")
    if i < 0:
        return None
    k = d.find(b"D", i)
    if k < 0:
        return None
    usf = struct.unpack("<d", d[k + 1:k + 9])[0]

    lo, hi = None, None
    pos = 0
    while True:
        i = d.find(b"Vertices", pos)
        if i < 0:
            break
        pos = i + 8
        j = d.find(b"d", i)
        if j < 0 or j - i > 64:
            continue
        try:
            n, enc, clen = struct.unpack("<III", d[j + 1:j + 13])
            raw = d[j + 13:j + 13 + clen]
            if enc == 1:
                raw = zlib.decompress(raw)
            if n == 0 or len(raw) < n * 8:
                continue
            vals = struct.unpack("<%dd" % n, raw[:n * 8])
        except (struct.error, zlib.error):
            continue
        zs = vals[2::3]
        if not zs:
            continue
        lo = min(zs) if lo is None else min(lo, min(zs))
        hi = max(zs) if hi is None else max(hi, max(zs))
    if lo is None:
        return None
    return {"unit_scale_factor": usf, "stored_z_min": lo, "stored_z_max": hi}


def read_glb(path):
    """The GLB's own JSON chunk: accessor extents and material names."""
    try:
        with open(path, "rb") as fh:
            d = fh.read()
    except OSError:
        return None
    if d[:4] != b"glTF":
        return None
    jlen = struct.unpack("<I", d[12:16])[0]
    doc = json.loads(d[20:20 + jlen])
    lo = [None, None, None]
    hi = [None, None, None]
    for acc in doc.get("accessors", []):
        mn, mx = acc.get("min"), acc.get("max")
        if not mn or len(mn) != 3:
            continue
        for a in range(3):
            lo[a] = mn[a] if lo[a] is None else min(lo[a], mn[a])
            hi[a] = mx[a] if hi[a] is None else max(hi[a], mx[a])
    return {
        "materials": [m.get("name") for m in doc.get("materials", [])],
        "meshes": len(doc.get("meshes", [])),
        "min_yup": lo,
        "max_yup": hi,
        "bytes": len(d),
    }
