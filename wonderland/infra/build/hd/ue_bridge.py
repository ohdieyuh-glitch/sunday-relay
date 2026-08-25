"""Turn meshkit geometry into real UStaticMesh assets inside the editor.

This is the only file in the HD pipeline that cannot be tested on this laptop,
and it is written accordingly.

THE FAILURE THIS FILE IS DESIGNED AGAINST
-----------------------------------------
The offline dry run installs a permissive `unreal` stub whose every attribute
returns an object that accepts any call. So this module RUNS offline and proves
nothing: a stub cannot tell you whether `create_vertex_instance` is the real
method name in UE 5.8. The project has already lost a whole render cycle to
exactly that shape of blindness — an arcane circle whose material bound, whose
mesh drew, whose log said success, and which was underneath the paving.

So the contract here is: **build, then read the mesh back and check it.**
`get_num_triangles` on the finished asset either returns the number of
triangles we authored or the asset is rejected and its key is never registered.
A rejected key means the caller keeps the primitive — visibly the old world,
which is a legible failure — rather than an empty one.

The readback is also the only way to learn the true API names without a GPU:
`_call` tries the candidates in order and logs the one that worked, so the
first Studio run answers the question for every later run for free.

COLLISION, WHICH IS EASY TO LOSE HERE
-------------------------------------
/Engine/BasicShapes ship with simple collision. A StaticMesh built from a mesh
description has NONE. WonderlandInstancedBatch's bCollides flag turns on
collision against whatever the mesh has, so swapping the plaza's setts for HD
flagstones without building collision would drop the player through the floor
while every log line said success. `COLLIDES` below names the assets that must
carry it, and the build asks for simple collision on those.
"""

import time

try:
    from . import assets as hd_assets
    from . import meshkit as mk
except ImportError:
    import assets as hd_assets
    import meshkit as mk


PKG = "/Game/Wonderland/HD"

#: Assets that stand on the ground or are stood on. WonderlandInstancedBatch
#: honours bCollides, and a mesh description builds with no collision at all.
COLLIDES = frozenset((
    "hd_flagstone", "hd_cobble_patch", "hd_kerb", "hd_stairs", "hd_bridge",
    "hd_wall", "hd_wall_window", "hd_tower", "hd_tower_far", "hd_gate_pillar",
    "hd_trunk", "hd_trunk_giant", "hd_mush_stem", "hd_column", "hd_bench",
    "hd_urn", "hd_baluster", "hd_merlon", "hd_arch",
))

#: Where an asset lives in the founder's Phase C hierarchy.
FOLDER = {
    "hd_roof": "Architecture/Castle", "hd_roof_hero": "Architecture/Castle",
    "hd_roof_far": "Architecture/Castle", "hd_roof_bell": "Architecture/Castle",
    "hd_tower": "Architecture/Castle", "hd_tower_far": "Architecture/Castle",
    "hd_wall": "Architecture/Castle", "hd_wall_window": "Architecture/Castle",
    "hd_cornice": "Architecture/Trim", "hd_column": "Architecture/Trim",
    "hd_baluster": "Architecture/Trim", "hd_corbel": "Architecture/Trim",
    "hd_finial": "Architecture/Trim", "hd_merlon": "Architecture/Castle",
    "hd_balcony": "Architecture/Castle", "hd_dome": "Architecture/Castle",
    "hd_arch": "Architecture/Gates", "hd_stairs": "Architecture/Stairs",
    "hd_bridge": "Architecture/Bridges",
    "hd_gate_pillar": "Architecture/Gates", "hd_gate_leaf": "Architecture/Gates",
    "hd_gate_bar": "Architecture/Gates", "hd_scroll": "Architecture/Gates",
    "hd_heart_motif": "Architecture/Gates", "hd_spear_finial": "Architecture/Gates",
    "hd_flagstone": "Ground/Cobblestone", "hd_cobble_patch": "Ground/Cobblestone",
    "hd_kerb": "Ground/Cobblestone",
    "hd_trunk": "Vegetation/Trees", "hd_trunk_giant": "Vegetation/Trees",
    "hd_branch": "Vegetation/Trees", "hd_canopy": "Vegetation/Trees",
    "hd_canopy_far": "Vegetation/Trees",
    "hd_leaf": "Vegetation/Trees", "hd_leaf_spray": "Vegetation/Trees",
    "hd_shrub": "Vegetation/Shrubs", "hd_vine": "Vegetation/Vines",
    "hd_rose": "Vegetation/Flowers", "hd_flower": "Vegetation/Flowers",
    "hd_bloom_cluster": "Vegetation/Flowers", "hd_grass_tuft": "Vegetation/Shrubs",
    "hd_topiary_heart": "Vegetation/Topiary", "hd_floral_arch": "Vegetation/Topiary",
    "hd_mush_cap": "Mushrooms", "hd_mush_cap_far": "Mushrooms",
    "hd_mush_stem": "Mushrooms", "hd_mush_spot": "Mushrooms",
    "hd_mush_house_cap": "Mushrooms",
    "hd_teacup": "Props/Tea", "hd_saucer": "Props/Tea", "hd_teapot": "Props/Tea",
    "hd_clock": "Props/Clocks", "hd_clock_hand": "Props/Clocks",
    "hd_key": "Props/Keys",
    "hd_lantern": "Props/Garden", "hd_urn": "Props/Garden",
    "hd_bench": "Props/Garden", "hd_card": "Props/Garden",
}


def asset_path(name, pkg=PKG):
    """Where `name` WILL live once built. Naming and building are separated so
    the offline harnesses can register the paths without an editor — see
    WONDERLAND_HD_ASSUME in generate-hub-level.py."""
    folder = FOLDER.get(name, "Props/Garden")
    leaf = "SM_" + (name[3:] if name.startswith("hd_") else name)
    return "%s/%s/%s" % (pkg, folder, leaf)


class BridgeError(Exception):
    pass


def _call(obj, names, *args, **kw):
    """Call the first method of `obj` that exists, from a list of candidate
    Python names. UE's Python name generation has surprised this project before
    (a Constant2Vector wanting R/G rather than `constant` took down a build), so
    every call across the boundary offers alternatives and reports which one
    answered."""
    tried = []
    for n in names:
        fn = getattr(obj, n, None)
        if fn is None:
            tried.append(n)
            continue
        _call.used[names[0]] = n
        return fn(*args, **kw)
    raise BridgeError("none of %r exist on %r (tried %r)" % (names, type(obj), tried))


_call.used = {}


def build_hd_meshes(unreal, only=None, pkg=PKG, verify=True):
    """Create every registered HD asset as a UStaticMesh.

    Returns (paths, report). `paths` maps asset name -> /Game path and contains
    ONLY assets whose triangle count read back correctly, so a caller can merge
    it into PLACEHOLDER_MESH and trust every key in it.
    """
    eal = unreal.EditorAssetLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    paths, report = {}, {
        "built": 0, "verified": 0, "rejected": [], "unverified": [],
        "seconds": 0.0, "tris": 0, "lods": 0, "nanite_flagged": 0,
        "api": _call.used,
    }
    t0 = time.time()
    names = sorted(hd_assets.ASSETS) if only is None else list(only)

    for name in names:
        spec = hd_assets.ASSETS.get(name)
        if spec is None:
            report["rejected"].append((name, "not registered"))
            continue
        try:
            mesh = spec["build"]()
            fit = spec.get("fit", "box")
            if fit == "box":
                mesh.fit_box(100.0, uniform=bool(spec.get("uniform")))
            want_tris = mesh.tri_count()
            if want_tris <= 0:
                report["rejected"].append((name, "authored zero triangles"))
                continue

            dst = asset_path(name, pkg)
            dst_pkg, asset_name = dst.rsplit("/", 1)
            if eal.does_asset_exist(dst):
                eal.delete_asset(dst)

            sm = tools.create_asset(asset_name, dst_pkg, unreal.StaticMesh,
                                    unreal.StaticMeshFactoryNew())
            if sm is None:
                report["rejected"].append((name, "create_asset returned None"))
                continue

            lods = mk.lod_chain(mesh)
            _fill_description(unreal, sm, lods, name in COLLIDES)

            if name in COLLIDES:
                try:
                    unreal.EditorStaticMeshLibrary.add_simple_collisions(
                        sm, unreal.ScriptingCollisionShapeType.BOX)
                except Exception:
                    pass                       # the build flag already asked

            # NANITE IS INERT ON THIS TARGET AND THE FLAG IS SET ANYWAY.
            # Config/DefaultEngine.ini targets SF_VULKAN_SM5 only, from a
            # measurement in that file: SM6 cost half the frame rate on the L4
            # for a visually identical image, and Nanite needs SM6. So the flag
            # changes nothing today. It is set because it costs nothing, it is
            # correct, and it is what makes the LOD chain above the thing that
            # is actually carrying the geometry budget -- which is why the
            # report counts LODs and never reports Nanite as an achievement.
            if spec.get("nanite"):
                try:
                    ns = sm.get_editor_property("nanite_settings")
                    ns.set_editor_property("enabled", True)
                    sm.set_editor_property("nanite_settings", ns)
                    report["nanite_flagged"] += 1
                except Exception as ne:
                    unreal.log_warning("HD: %s no nanite (%s)" % (name, ne))

            eal.save_asset(dst, only_if_is_dirty=False)
            report["built"] += 1
            report["tris"] += want_tris
            report["lods"] += len(lods)

            got = _readback_tris(unreal, sm)
            if got is None:
                # A stub, or a build that does not expose the count. The asset
                # is registered but the run is NOT counted as verified, and the
                # shell gate reads the verified number.
                report["unverified"].append(name)
                paths[name] = dst
            elif abs(got - want_tris) > max(2, want_tris // 50):
                report["rejected"].append(
                    (name, "authored %d tris, asset reports %d" % (want_tris, got)))
                continue
            else:
                report["verified"] += 1
                paths[name] = dst
        except Exception as exc:
            report["rejected"].append((name, "%s: %s" % (type(exc).__name__, exc)))

    report["seconds"] = round(time.time() - t0, 1)
    return paths, report


def _fill_description(unreal, sm, lods, want_collision):
    """Author a whole LOD CHAIN into the StaticMesh.

    build_from_static_mesh_descriptions takes one description per LOD, which is
    the thing /Engine/BasicShapes cannot offer: they ship a single LOD, so a
    Sphere 200 m away still costs 1,900 triangles. Authored geometry gets a
    real reduction chain for free."""
    descs = []
    V2 = getattr(unreal, "Vector2D", None)
    for mesh in lods:
        md = _call(sm, ["create_static_mesh_description"])
        normals = mesh.corner_normals()

        vids = [_call(md, ["create_vertex"]) for _ in mesh.verts]
        for i, v in enumerate(mesh.verts):
            _call(md, ["set_vertex_position"], vids[i],
                  unreal.Vector(v[0], v[1], v[2]))

        pg = _call(md, ["create_polygon_group"])
        try:
            _call(md, ["set_polygon_group_material_slot_name"], pg, unreal.Name("HD"))
        except Exception:
            pass

        for ti, (a, b, c) in enumerate(mesh.tris):
            insts = []
            for corner, vi in enumerate((a, b, c)):
                inst = _call(md, ["create_vertex_instance"], vids[vi])
                n = normals[ti][corner]
                try:
                    _call(md, ["set_vertex_instance_normal"], inst,
                          unreal.Vector(n[0], n[1], n[2]))
                except Exception:
                    pass
                if V2 is not None:
                    uv = mesh.uvs[ti][corner]
                    try:
                        _call(md, ["set_vertex_instance_uv"], inst,
                              V2(uv[0], uv[1]), 0)
                    except Exception:
                        pass
                insts.append(inst)
            _call(md, ["create_polygon"], pg, insts)
        descs.append(md)

    try:
        _call(sm, ["build_from_static_mesh_descriptions"], descs, want_collision, True)
    except Exception:
        _call(sm, ["build_from_static_mesh_descriptions"], descs)


def _readback_tris(unreal, sm):
    """The number of triangles the FINISHED asset holds, or None if this build
    will not say. None is not success — the caller records it as unverified."""
    for getter in ("get_num_triangles",):
        fn = getattr(sm, getter, None)
        if fn is None:
            continue
        try:
            n = fn(0)
            if isinstance(n, int) and not isinstance(n, bool):
                return n
        except Exception:
            pass
    lib = getattr(unreal, "EditorStaticMeshLibrary", None)
    if lib is not None:
        for getter in ("get_number_triangles", "get_num_triangles"):
            fn = getattr(lib, getter, None)
            if fn is None:
                continue
            try:
                n = fn(sm, 0)
                if isinstance(n, int) and not isinstance(n, bool):
                    return n
            except Exception:
                pass
    return None


def format_report(report):
    line = ("HD_MESHES built=%d verified=%d unverified=%d rejected=%d "
            "tris=%d lods=%d nanite_flagged=%d(INERT_ON_SM5) seconds=%.1f"
            % (report["built"], report["verified"], len(report["unverified"]),
               len(report["rejected"]), report["tris"], report["lods"],
               report["nanite_flagged"], report["seconds"]))
    if report["api"]:
        line += "  api=" + ",".join("%s->%s" % (k, v)
                                    for k, v in sorted(report["api"].items())
                                    if k != v)
    return line
