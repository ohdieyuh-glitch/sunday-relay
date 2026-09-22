"""THE PROJECT AVATARS, BUILT IN UNREAL -- Ten Tails, Cherubim and Seraph, at SMALL, MEDIUM and LARGE.

Runs inside the UE 5.8 editor (the world lane's channel job build_avatars.py calls build_all()). For each of the
nine bodies it builds:

  1. MI_Avatar_<Family>_<Surface> on M_V2_Surface -- one material set per FAMILY, shared by all three of its
     stages, because a Ten Tails does not change colour as it grows. Textures are pinned to white/flat with
     TexScale 0, the same way the Dog's own materials are, since the V2 masters sample through world-projected
     UVs and a tiled texture would streak down every vertical face of a creature this shape.
  2. SM_Avatar_<Family>_<Stage>_<joint>_<surface> -- one mesh per joint per surface, merged in THE JOINT'S OWN
     frame so a rig rotating that joint rotates its geometry about the right pivot. (The builder passes the name
     WITHOUT the SM_ prefix, because gs.save_static_mesh adds it.)
  3. BP_Avatar_<Family>_<Stage> -- an AActor whose hierarchy is Root -> Pivot_<joint> (nested exactly as the
     canon's parents() says) -> Mesh_<joint>_<surface>, plus every VFX_* socket as a named SceneComponent.

SCALE IS APPLIED ONCE, HERE. Each canon is authored in its own units; this file measures the finished body,
computes the single factor that puts it at project_avatar_figures.py's TARGET_METRES for that stage, and bakes
it into the geometry. Nothing downstream has to scale anything, which is the founder's requirement that a LARGE
avatar "retain intended mature size" and not need shrinking to fit a showcase: the asset IS 5.60 m.

COLLISION, STATED ONCE. Every mesh is saved collision=False. Nine creatures made of 11 to 76 separate convex
pieces would otherwise cost 11 to 76 collision primitives EACH, on actors that move, for no gain -- a walking
creature is blocked by one capsule, not by its own eyelashes. The report this file writes carries a measured
capsule (radius and half-height) per stage so Internal Development can set one on the actor they spawn. What
collides in this world is decided by the runtime lane and by the world lane's own batch passes, never here.

NOTHING HERE MOVES ANYTHING. Gait, hover, growth, spawning, multiplayer and Brain integration are Internal
Development's. This file delivers bodies, pivots, sockets, materials and measurements.
"""
import json
import os
import sys

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import avatar_common as A      # noqa: E402
import cherubim_canon          # noqa: E402
import dog_canon as D          # noqa: E402
import gs                      # noqa: E402
import seraph_canon            # noqa: E402
import ten_tails_canon         # noqa: E402

CONTENT_ROOT = "/Game/WonderlandV2"
AVATAR_FOLDER = CONTENT_ROOT + "/Characters/Avatars"
MASTER_FOLDER = CONTENT_ROOT + "/Materials/Master"

FAMILIES = {"TenTails": ten_tails_canon, "Cherubim": cherubim_canon, "Seraph": seraph_canon}
STAGE_TITLE = {"small": "Small", "medium": "Medium", "large": "Large"}


def LOG(msg):
    unreal.log_warning("AVATAR " + str(msg))


def lin(hex_colour, a=1.0):
    r, g, b = D.srgb_to_linear(hex_colour)
    return unreal.LinearColor(r, g, b, a)


# ------------------------------------------------------------------ materials
def build_materials(family, mod):
    """One material set per family. Rebuilt every run: an instance is cheap (no shader compile -- only a MASTER
    costs the 1,871 seconds this project measured once and never wants to pay again)."""
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    surface = eal.load_asset(MASTER_FOLDER + "/M_V2_Surface")
    if surface is None:
        raise RuntimeError("M_V2_Surface missing under " + MASTER_FOLDER)
    white = eal.load_asset("/Engine/EngineResources/WhiteSquareTexture")
    flat_normal = eal.load_asset("/Engine/EngineMaterials/DefaultNormal")
    folder = "%s/%s" % (AVATAR_FOLDER, family)
    out = {}
    for surf in sorted(mod.MATERIALS):
        name = "MI_Avatar_%s_%s" % (family, "".join(w.capitalize() for w in surf.split("_")))
        path = folder + "/" + name
        if eal.does_asset_exist(path):
            eal.delete_asset(path)
        mi = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            name, folder, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        if mi is None:
            raise RuntimeError("material instance %s was not created" % name)
        try:
            mel.set_material_instance_parent(mi, surface)
        except Exception:
            mi.set_editor_property("parent", surface)
        spec = mod.MATERIALS[surf]
        for pname, tex in (("Albedo", white), ("RoughnessMap", white), ("Normal", flat_normal)):
            if tex is not None:
                mel.set_material_instance_texture_parameter_value(mi, pname, tex)
        mel.set_material_instance_scalar_parameter_value(mi, "TexScale", 0.0)
        mel.set_material_instance_vector_parameter_value(mi, "BaseColor", lin(spec["color"]))
        mel.set_material_instance_scalar_parameter_value(mi, "Roughness", float(spec["roughness"]))
        mel.set_material_instance_scalar_parameter_value(mi, "RoughVary", 0.0)
        mel.set_material_instance_scalar_parameter_value(mi, "Metallic", float(spec["metalness"]))
        mel.set_material_instance_scalar_parameter_value(mi, "Specular", 0.35 if spec["metalness"] > 0.5 else 0.5)
        if spec.get("emissive"):
            # SCENE UNITS, not the 0-10 an artist expects. Measured against this world's EV100 13.5 daylight:
            # an emissive of 2.2 renders BLACK and anything meant to read as light lives near 55,000-62,000.
            mel.set_material_instance_vector_parameter_value(mi, "Emissive", lin(spec["color"]))
            mel.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", float(spec["emissive"]))
        eal.save_asset(path, only_if_is_dirty=False)
        out[surf] = mi
    LOG("MATERIALS %s -> %d instances" % (family, len(out)))
    return out


# ------------------------------------------------------------------ geometry
def _emit(m, kind, payload, pivot, k):
    """Add one canon part to the mesh under construction, expressed in its joint's local frame, converted from
    the web frame to Unreal's, and scaled by k. Rotations pass through untouched: a canon `rot` is already an
    Unreal Rotator (see avatar_common's frame note), which is precisely why it does not need converting here."""
    def local(p):
        return (p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2])

    if kind == "box":
        c, size, rot, chamfer = payload
        c_ue, d_ue = A.to_unreal(local(c), size, k)
        m.box(d_ue[0], d_ue[1], d_ue[2], at=c_ue, rot=rot,
              chamfer=(chamfer * k) if chamfer else None)
    elif kind == "sphere":
        c, r, steps = payload
        m.sphere(r * k, at=A.to_unreal(local(c), (0, 0, 0), k)[0], steps=steps)
    elif kind == "cone":
        c, r0, r1, h, rot, steps = payload
        m.cone(r0 * k, r1 * k, h * k, at=A.to_unreal(local(c), (0, 0, 0), k)[0], rot=rot, steps=steps)
    elif kind == "torus":
        c, R, tb, rot, major, minor = payload
        m.torus(R * k, tb * k, at=A.to_unreal(local(c), (0, 0, 0), k)[0], rot=rot, major=major, minor=minor)
    elif kind == "tube":
        path, radii, sides = payload
        pts = [A.to_unreal(local(p), (0, 0, 0), k)[0] for p in path]
        m.tube(pts, [r * k for r in radii], sides=sides)
    else:
        raise RuntimeError("unknown part kind: " + str(kind))


def stage_geometry(mod, stage):
    """Everything the builder needs for one body, already levelled to the deck and already scaled.

    Returns (groups, pivots_ue, sockets_ue, measure) where groups is {(joint, surface): [parts]} in the canon's
    own units and `k` in measure is the factor applied on the way into the engine.
    """
    raw = mod.parts(stage)
    dy = A.deck_offset(raw)
    parts = A.lift(raw, dy)
    k = A.fit_scale(parts, A.TARGET_METRES[stage])
    lo, hi = A.extents(parts)
    piv = {j: (p[0], p[1] + dy, p[2]) for j, p in mod.pivots(stage).items()}
    groups = {}
    for name, joint, surface, kind, payload in parts:
        groups.setdefault((joint, surface), []).append((name, kind, payload))
    socks = [(n, j, (p[0], p[1] + dy, p[2])) for (n, j, p) in mod.sockets(stage)]
    # Each family declares its own capsule around its CORE MASS. Deriving one from the mesh bounds would put a
    # 1.5 m radius on a Ten Tails whose body is a metre wide, because its bounds are mostly tail.
    cap_r, cap_half, cap_cy = mod.collision_capsule(stage)
    radius_cm = cap_r * k
    half_cm = cap_half * k
    measure = {
        "k": k,
        "units_bounds": {"min": [round(v, 2) for v in lo], "max": [round(v, 2) for v in hi]},
        "metres": {"height": round((hi[1] - lo[1]) * k / 100.0, 3),
                   "width": round((hi[0] - lo[0]) * k / 100.0, 3),
                   "depth": round((hi[2] - lo[2]) * k / 100.0, 3)},
        "target_metres": A.TARGET_METRES[stage],
        "capsule_recommendation_cm": {"radius": round(radius_cm, 1), "half_height": round(half_cm, 1),
                                      "centre_z": round((cap_cy + dy) * k, 1)},
        "parts": len(parts),
        "groups": len(groups),
        "tri_estimate": A.tri_estimate(parts),
        "eyes": mod.eye_count(stage),
        "joints": len(mod.joints(stage)),
        "sockets": len(socks),
    }
    return groups, piv, socks, measure


#: Collect garbage every this many meshes. MEASURED: the first full run built all 343 meshes in nine
#: uninterrupted steps, and over Ten Tails MEDIUM the channel heartbeat did not tick for three and a half
#: minutes while the editor's private footprint grew to 19.5 GB against a 55 GB commit limit -- every
#: UDynamicMesh from every mesh in a stage stayed live, because nothing between them gave the engine a chance
#: to reclaim one. The build still completed; it was the headroom, not the speed, that was being spent.
GC_EVERY = 12


def build_stage_meshes(ctx, family, stage, mod):
    """A GENERATOR. It yields between meshes so the channel keeps breathing and the engine can reclaim the
    dynamic meshes already written; the caller drives it and takes the result from `.value` on StopIteration,
    or simply uses the returned tuple via the run_stage_meshes helper below."""
    eal = unreal.EditorAssetLibrary
    groups, piv, socks, measure = stage_geometry(mod, stage)
    folder = "%s/%s/%s" % (AVATAR_FOLDER, family, STAGE_TITLE[stage])
    built, rows, tris = {}, [], 0
    for i, (joint, surface) in enumerate(sorted(groups)):
        parts = groups[(joint, surface)]
        # gs.save_static_mesh prepends "SM_" itself. Passing a key that already starts with it gave
        # every mesh in the first two rounds a name like SM_SM_Avatar_Cherubim_Small_core_eye.
        key = "Avatar_%s_%s_%s_%s" % (family, STAGE_TITLE[stage], joint, surface)
        m = ctx.mesh(key)
        pivot = piv.get(joint, (0.0, 0.0, 0.0))
        for _name, kind, payload in parts:
            _emit(m, kind, payload, pivot, measure["k"])
        # collision=False is the contract above, not an oversight. nanite=False because these are small animated
        # props whose components move every frame -- Nanite is for the static world, and this project's Cub
        # family already settled that call.
        path = m.to_asset(folder, key, nanite=False, collision=False, lods=True)
        if path is None or not eal.does_asset_exist(path):
            raise RuntimeError("static mesh %s was not saved" % key)
        n = m.tri_count() if hasattr(m, "tri_count") else None
        if n:
            tris += n
        rows.append({"joint": joint, "surface": surface, "parts": len(parts), "tris": n, "asset": path})
        built[(joint, surface)] = eal.load_asset(path)
        del m
        if (i + 1) % GC_EVERY == 0:
            try:
                unreal.SystemLibrary.collect_garbage()
            except Exception as exc:
                LOG("collect_garbage: %s" % exc)
        yield None
    measure["tri_actual"] = tris or None
    LOG("MESHES %s/%s -> %d meshes, %s tris" % (family, stage, len(built), tris or "?"))
    return built, rows, piv, socks, measure


def run_stage_meshes(ctx, family, stage, mod):
    """Drive build_stage_meshes to completion without yielding -- for a caller that is not itself a generator.
    A channel job should iterate the generator directly instead, so the editor stays responsive."""
    gen = build_stage_meshes(ctx, family, stage, mod)
    try:
        while True:
            next(gen)
    except StopIteration as stop:
        return stop.value


# ------------------------------------------------------------------ blueprint
def build_stage_blueprint(family, stage, mod, meshes, mats, piv, socks, k):
    eal = unreal.EditorAssetLibrary
    folder = "%s/%s/%s" % (AVATAR_FOLDER, family, STAGE_TITLE[stage])
    bp_name = "BP_Avatar_%s_%s" % (family, STAGE_TITLE[stage])
    path = folder + "/" + bp_name
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    factory = unreal.BlueprintFactory()
    # AActor, not ACharacter: an avatar's movement belongs to Internal Development's own class, and a Character
    # would force a movement component and a collision capsule onto an asset that is deliberately collision-free.
    factory.set_editor_property("parent_class", unreal.Actor)
    bp = unreal.AssetToolsHelpers.get_asset_tools().create_asset(bp_name, folder, None, factory)
    if bp is None:
        raise RuntimeError("blueprint %s was not created" % bp_name)
    sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    lib = unreal.SubobjectDataBlueprintFunctionLibrary
    handles = sds.k2_gather_subobject_data_for_blueprint(context=bp)
    if not handles:
        raise RuntimeError("no subobject handles for " + bp_name)

    def add(parent, cls, name):
        params = unreal.AddNewSubobjectParams(parent_handle=parent, new_class=cls, blueprint_context=bp)
        handle, why = sds.add_new_subobject(params)
        data = sds.k2_find_subobject_data_from_handle(handle)
        ok = False
        try:
            ok = bool(lib.is_valid(data))
        except Exception:
            ok = data is not None
        if not ok:
            raise RuntimeError("add_new_subobject %s: %s" % (name, why))
        sds.rename_subobject(handle, unreal.Text(name))
        obj = lib.get_object(data)
        if obj is None:
            raise RuntimeError("subobject %s has no template" % name)
        return handle, obj

    root_h, _root = add(handles[0], unreal.SceneComponent, "Body")
    parents = mod.parents(stage)
    joint_h = {"root": root_h}
    made = {"pivots": 0, "meshes": 0, "sockets": 0}

    # joints in dependency order, so a child never precedes its parent
    order, pending = [], list(mod.joints(stage))
    guard = 0
    while pending and guard < 10000:
        guard += 1
        j = pending.pop(0)
        par = parents.get(j)
        if j == "root":
            continue
        if par == "root" or par in joint_h or par in order:
            order.append(j)
        else:
            pending.append(j)
    if pending:
        raise RuntimeError("unresolved joint parents: %s" % pending[:6])

    for joint in order:
        par = parents.get(joint) or "root"
        parent_h = joint_h[par]
        _h, obj = add(parent_h, unreal.SceneComponent, "Pivot_" + joint)
        joint_h[joint] = _h
        ppos = A.to_unreal(piv[joint], (0, 0, 0), k)[0]
        qpos = A.to_unreal(piv.get(par, (0.0, 0.0, 0.0)), (0, 0, 0), k)[0]
        obj.set_editor_property("relative_location",
                                unreal.Vector(ppos[0] - qpos[0], ppos[1] - qpos[1], ppos[2] - qpos[2]))
        made["pivots"] += 1

    for (joint, surface), sm in sorted(meshes.items()):
        _h, obj = add(joint_h[joint], unreal.StaticMeshComponent, "Mesh_%s_%s" % (joint, surface))
        obj.set_editor_property("static_mesh", sm)
        obj.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
        obj.set_editor_property("cast_shadow", surface not in ("eye", "core", "ember"))
        mi = mats.get(surface)
        if mi is not None:
            obj.set_material(0, mi)
        made["meshes"] += 1

    for name, joint, pos in socks:
        host = joint_h.get(joint, root_h)
        _h, obj = add(host, unreal.SceneComponent, name)
        spos = A.to_unreal(pos, (0, 0, 0), k)[0]
        jpos = A.to_unreal(piv.get(joint, (0.0, 0.0, 0.0)), (0, 0, 0), k)[0]
        obj.set_editor_property("relative_location",
                                unreal.Vector(spos[0] - jpos[0], spos[1] - jpos[1], spos[2] - jpos[2]))
        made["sockets"] += 1

    unreal.EditorAssetLibrary.save_loaded_asset(bp, only_if_is_dirty=False)
    LOG("BLUEPRINT %s pivots=%d meshes=%d sockets=%d" % (bp_name, made["pivots"], made["meshes"], made["sockets"]))
    return path, made


def wipe(family=None):
    """Delete a family's folder, or the whole Avatars tree, before a rebuild.

    Everything under it is regenerated from the canons in one run, so nothing here is art that could not be
    remade -- which is the only condition under which this project deletes anything. It exists because a rename
    of the mesh keys leaves the previous names behind as orphans that no Blueprint references and nothing
    cleans up.
    """
    eal = unreal.EditorAssetLibrary
    target = "%s/%s" % (AVATAR_FOLDER, family) if family else AVATAR_FOLDER
    if eal.does_directory_exist(target):
        ok = eal.delete_directory(target)
        LOG("WIPE %s -> %s" % (target, ok))
        return bool(ok)
    return False


# ------------------------------------------------------------------ entry
def build_all(families=None, stages=None, out_json=None):
    ctx = gs.Context(unreal, LOG)
    LOG(ctx.caps.report())
    report = {"backend": ctx.backend, "caps": ctx.caps.report(), "families": {}}
    for family in (families or sorted(FAMILIES)):
        mod = FAMILIES[family]
        mats = build_materials(family, mod)
        fam_report = {"materials": sorted(mod.MATERIALS), "stages": {}}
        for stage in (stages or list(A.STAGES)):
            meshes, rows, piv, socks, measure = run_stage_meshes(ctx, family, stage, mod)
            bp_path, made = build_stage_blueprint(family, stage, mod, meshes, mats, piv, socks, measure["k"])
            measure.update({"blueprint": bp_path, "components": made,
                            "draw_calls_est": made["meshes"], "meshes": rows})
            fam_report["stages"][stage] = measure
            LOG("STAGE %s/%s  %.2f m tall, %d meshes, ~%d tris, capsule r=%.0f h=%.0f" % (
                family, stage, measure["metres"]["height"], made["meshes"],
                measure.get("tri_actual") or measure["tri_estimate"],
                measure["capsule_recommendation_cm"]["radius"],
                measure["capsule_recommendation_cm"]["half_height"]))
        report["families"][family] = fam_report
    if out_json:
        with open(out_json, "w", newline="\n") as f:
            json.dump(report, f, indent=1)
    return report
