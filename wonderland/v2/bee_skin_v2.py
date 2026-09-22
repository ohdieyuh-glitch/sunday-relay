"""THE BEE RELAY DOG, BUILT IN UNREAL -- a skin on the canonical Dog's own rig.

Builds from bee_canon, which imports dog_canon and never alters a canonical box. The result is a
second Blueprint that stands in the same silhouette, hangs on the same pivots and is driven by the
same ARelayDogCharacter as the plain Relay Dog -- so a skin costs the animation lane nothing.

  * MI_RelayDogBee_{Ivory,Visor,Eye,Amber,Gold,Carapace} on the V2 masters, and MI_RelayDogBee_Wing
    on M_V2_Ghost (the translucent unlit master built for the Sub-Agent Cub Ghost -- the wings and
    the Cubs are the only translucent things in this project, and they share one master).
  * SM_RelayDogBee_<joint>_<surface>, boxes merged in each joint's local frame. The honeycomb cells
    are six-sided prisms, not a texture: the V2 masters sample through world-projected UVs, which is
    why the Dog's own materials run at TexScale 0, and a honeycomb texture would streak down every
    vertical face.
  * BP_RelayDogBee, parented to ARelayDogCharacter exactly as BP_RelayDog is, with Pivot_<joint>
    named identically so the C++ locomotion finds every joint it expects.

THE EYE RUNS HOTTER HERE by founder request ("warm luminous eye treatment"), and that is the only
canon value this skin changes.
"""
import os
import sys

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import bee_canon as B   # noqa: E402
import dog_canon as D   # noqa: E402
import gs               # noqa: E402

CONTENT_ROOT = "/Game/WonderlandV2"
BEE_FOLDER = CONTENT_ROOT + "/Characters/RelayDogBee"
MASTER_FOLDER = CONTENT_ROOT + "/Materials/Master"
GHOST_MASTER = MASTER_FOLDER + "/M_V2_Ghost"
BP_NAME = "BP_RelayDogBee"
#: The Dog's own head width. A skin never changes scale.
W_UU = float(os.environ.get("WLV2_DOG_HEAD_WIDTH_UU", "60"))
EYE_EMISSIVE = 600.0


def LOG(msg):
    unreal.log_warning("BEE " + str(msg))


def lin(hex_colour, a=1.0):
    r, g, b = D.srgb_to_linear(hex_colour)
    return unreal.LinearColor(r, g, b, a)


def build_materials():
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    surface = eal.load_asset(MASTER_FOLDER + "/M_V2_Surface")
    portal = eal.load_asset(MASTER_FOLDER + "/M_V2_Portal")
    ghost = eal.load_asset(GHOST_MASTER)
    if surface is None or portal is None:
        raise RuntimeError("V2 masters missing under " + MASTER_FOLDER)
    if ghost is None:
        raise RuntimeError("M_V2_Ghost missing -- build the Sub-Agent Cub Ghost family first")
    white = eal.load_asset("/Engine/EngineResources/WhiteSquareTexture")
    flat_normal = eal.load_asset("/Engine/EngineMaterials/DefaultNormal")
    out = {}
    for surf in B.SURFACES:
        name = "MI_RelayDogBee_" + surf.capitalize()
        path = BEE_FOLDER + "/" + name
        master = ghost if surf in B.TRANSLUCENT else (portal if surf == "eye" else surface)
        if eal.does_asset_exist(path):
            eal.delete_asset(path)
        mi = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
            name, BEE_FOLDER, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        if mi is None:
            raise RuntimeError("material instance %s was not created" % name)
        try:
            mel.set_material_instance_parent(mi, master)
        except Exception:
            mi.set_editor_property("parent", master)
        spec = B.MATERIALS[surf]
        if surf in B.TRANSLUCENT:
            mel.set_material_instance_vector_parameter_value(mi, "GhostCore", lin(spec["core"]))
            mel.set_material_instance_vector_parameter_value(mi, "GhostRim", lin(spec["rim"]))
            for pname, val in (("GhostOpacity", spec["opacity"]), ("RimPower", spec["rim_power"]),
                               ("GhostBrightness", spec["brightness"]),
                               ("FadeFloor", 1.0 - spec["fade_strength"]), ("FadeRange", 0.9 * W_UU)):
                mel.set_material_instance_scalar_parameter_value(mi, pname, float(val))
        else:
            for pname, tex in (("Albedo", white), ("RoughnessMap", white), ("Normal", flat_normal)):
                if tex is not None:
                    mel.set_material_instance_texture_parameter_value(mi, pname, tex)
            mel.set_material_instance_scalar_parameter_value(mi, "TexScale", 0.0)
            mel.set_material_instance_vector_parameter_value(mi, "BaseColor", lin(spec["color"]))
            mel.set_material_instance_scalar_parameter_value(mi, "Roughness", float(spec["roughness"]))
            mel.set_material_instance_scalar_parameter_value(mi, "RoughVary", 0.0)
            mel.set_material_instance_scalar_parameter_value(mi, "Metallic", float(spec["metalness"]))
            mel.set_material_instance_scalar_parameter_value(mi, "Specular", 0.2 if surf in ("visor", "carapace") else 0.5)
            if spec.get("emissive"):
                hex_e, intensity = spec["emissive"]
                mel.set_material_instance_vector_parameter_value(mi, "Emissive", lin(hex_e))
                mel.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", float(intensity) * EYE_EMISSIVE)
        eal.save_asset(path, only_if_is_dirty=False)
        out[surf] = mi
        LOG("MATERIAL %s parent=%s" % (name, master.get_name()))
    return out


def build_meshes(ctx):
    eal = unreal.EditorAssetLibrary
    built, report = {}, []
    for (joint, surface), parts in B.parts(W_UU).items():
        key = "RelayDogBee_%s_%s" % (joint, surface)
        m = ctx.mesh(key)
        for _name, centre, dims, rot, kind in parts:
            if kind == "hex":
                # Six-sided prism: a real honeycomb cell. dims here are (depth, width, height) in
                # Unreal axes; the cell's radius is the width and its thickness the depth.
                m.cylinder(dims[1] / 2.0, dims[0], at=centre, rot=rot, steps=6, capped=True)
            else:
                m.box(dims[0], dims[1], dims[2], at=centre, rot=rot)
        path = m.to_asset(BEE_FOLDER, key, nanite=False, collision=False, lods=True)
        if path is None or not eal.does_asset_exist(path):
            raise RuntimeError("static mesh %s was not saved" % key)
        tris = m.tri_count() if hasattr(m, "tri_count") else len(parts) * 12
        report.append({"joint": joint, "surface": surface, "parts": len(parts), "tris": tris, "asset": path})
        LOG("PART %s parts=%d tris=%s" % (key, len(parts), tris))
        built[(joint, surface)] = eal.load_asset(path)
    return built, report


def build_blueprint(meshes, mats):
    eal = unreal.EditorAssetLibrary
    path = BEE_FOLDER + "/" + BP_NAME
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    factory = unreal.BlueprintFactory()
    parent = unreal.load_class(None, "/Script/Wonderland.RelayDogCharacter")
    if parent is None:
        LOG("BLUEPRINT PARENT FAILED: ARelayDogCharacter did not load -- the Bee will be canonical and WILL NOT ANIMATE")
        parent = unreal.Character
    factory.set_editor_property("parent_class", parent)
    bp = unreal.AssetToolsHelpers.get_asset_tools().create_asset(BP_NAME, BEE_FOLDER, None, factory)
    if bp is None:
        raise RuntimeError("blueprint was not created")
    sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    lib = unreal.SubobjectDataBlueprintFunctionLibrary
    handles = sds.k2_gather_subobject_data_for_blueprint(context=bp)
    if not handles:
        raise RuntimeError("no subobject handles")

    def add(parent_handle, cls, name):
        params = unreal.AddNewSubobjectParams(parent_handle=parent_handle, new_class=cls, blueprint_context=bp)
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

    half_height = D.height() * W_UU / 2.0
    radius = 0.565 * W_UU + 2.0
    body_h, body = add(handles[0], unreal.SceneComponent, "Body")
    body.set_editor_property("relative_location", unreal.Vector(0, 0, -half_height))
    pivots = D.pivots_unreal(W_UU)
    joint_h = {"root": body_h}
    made = {"pivots": 0, "meshes": 0}
    for joint in D.JOINTS:
        if joint == "root":
            parent_h = body_h
        else:
            parent_joint = D.PARENTS[joint]
            base_h = joint_h.get(parent_joint)
            if base_h is None:
                raise RuntimeError("joint %s wants parent %s, not built yet" % (joint, parent_joint))
            parent_h, pivot_obj = add(base_h, unreal.SceneComponent, "Pivot_" + joint)
            here = pivots[joint]
            there = pivots.get(parent_joint, (0.0, 0.0, 0.0)) if parent_joint != "root" else (0.0, 0.0, 0.0)
            pivot_obj.set_editor_property("relative_location", unreal.Vector(
                here[0] - there[0], here[1] - there[1], here[2] - there[2]))
            joint_h[joint] = parent_h
            made["pivots"] += 1
        for surface in B.SURFACES:
            sm = meshes.get((joint, surface))
            if sm is None:
                continue
            _, comp = add(parent_h, unreal.StaticMeshComponent, "Mesh_%s_%s" % (joint, surface))
            comp.set_editor_property("static_mesh", sm)
            comp.set_material(0, mats[surface])
            comp.set_editor_property("relative_location", unreal.Vector(0, 0, 0))
            try:
                comp.set_collision_profile_name("NoCollision")   # the Character capsule is the collider
            except Exception:
                pass
            if surface in B.TRANSLUCENT:
                comp.set_editor_property("cast_shadow", False)
            made["meshes"] += 1
    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
    try:
        cdo = unreal.get_default_object(bp.generated_class())
        cdo.capsule_component.set_capsule_size(float(radius), float(half_height))
    except Exception as exc:
        LOG("capsule size not set on the CDO (%s)" % exc)
    eal.save_asset(path, only_if_is_dirty=False)
    LOG("BLUEPRINT %s pivots=%d meshes=%d parent=%s" % (path, made["pivots"], made["meshes"], parent.get_name()))
    return path, made
