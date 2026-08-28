"""THE CANONICAL RELAY DOG IN UNREAL — built from the web model's numbers.

Runs inside the UE 5.8 editor commandlet (see diag/dog_studio.sh). It builds:

  1. per-joint static meshes, boxes merged INSIDE each joint's local frame
     exactly as the web `dog-mesh.ts` does, so a joint rotates its part about
     the canonical pivot — /Game/WonderlandV2/Characters/RelayDog/SM_RelayDog_<joint>_<surface>
  2. three material instances on the V2 masters — MI_RelayDog_Ivory / _Visor / _Eye —
     with the web canon's colour/roughness/metalness and the eye's restrained emissive
  3. BP_RelayDog: a Character blueprint whose capsule carries a rigid component
     hierarchy Body → {Head, ArmLeft, ArmRight, LegLeft, LegRight, Tail} — each a
     SceneComponent pivot holding StaticMeshComponents. Articulation is a
     TRANSFORM per joint, never a deformation: the block construction cannot melt.
     (If the Blueprint subobject API refuses in this build, the same hierarchy is
     assembled from attached actors in the level and the log says FALLBACK.)
  4. WL_V2_RelayDogStudio: a CLASSIC (non World Partition) presentation map —
     neutral grey floor + backdrop, sky atmosphere, one sun, one sky light — with
     ONE Dog at the origin facing +X and four locked cameras tagged HeroCam0..3:
     FRONT, THREE-QUARTER, SIDE, REAR.

Every measured proportion is logged as `DOG PART <joint>_<surface> extents=… size=…`
so `verify_dog_canon.py --log` can prove the built meshes ARE the canon.
No Dog is placed in the Golden Arrival map. Nothing here touches V1.
"""
import os
import sys

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dog_canon as D   # noqa: E402
import gs               # noqa: E402

CONTENT_ROOT = "/Game/WonderlandV2"
DOG_FOLDER = CONTENT_ROOT + "/Characters/RelayDog"
MASTER_FOLDER = CONTENT_ROOT + "/Materials/Master"
STUDIO_MAP = CONTENT_ROOT + "/Maps/WL_V2_RelayDogStudio"
BP_NAME = "BP_RelayDog"

#: THE ONE CHOSEN NUMBER: how many centimetres one HEAD_WIDTH is. 60 makes the
#: Dog 2.9025 × 60 = 174 cm tall — a third-person character at human scale on
#: Wonderland's 4.4 m paths. Every other dimension follows from the canon.
W_UU = float(os.environ.get("WLV2_DOG_HEAD_WIDTH_UU", "60"))
#: Studio lighting: a moderate sun so the ivory reads as ivory, and an emissive
#: for the eyes that reads as lit gold beside it, not as a torch. Calibrated on
#: the first capture; both are logged.
SUN_LUX = float(os.environ.get("WLV2_DOG_SUN_LUX", "2500"))
EYE_EMISSIVE = float(os.environ.get("WLV2_DOG_EYE_EMISSIVE", "600"))


def LOG(msg):
    unreal.log_warning("DOG " + msg)


def vec(t):
    return unreal.Vector(float(t[0]), float(t[1]), float(t[2]))


def rot(pitch, yaw, roll=0.0):
    r = unreal.Rotator()
    r.set_editor_property("pitch", float(pitch))
    r.set_editor_property("yaw", float(yaw))
    r.set_editor_property("roll", float(roll))
    return r


def lin(hex_colour, a=1.0):
    r, g, b = D.srgb_to_linear(hex_colour)
    return unreal.LinearColor(r, g, b, a)


# ----------------------------------------------------------------- materials
def build_materials():
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    surface = eal.load_asset(MASTER_FOLDER + "/M_V2_Surface")
    portal = eal.load_asset(MASTER_FOLDER + "/M_V2_Portal")
    if surface is None or portal is None:
        raise RuntimeError("V2 masters missing (%s) -- run the V2 build first" % MASTER_FOLDER)
    white = eal.load_asset("/Engine/EngineResources/WhiteSquareTexture")
    flat_normal = eal.load_asset("/Engine/EngineMaterials/DefaultNormal")
    out = {}
    for surf, name, master in (("ivory", "MI_RelayDog_Ivory", surface), ("visor", "MI_RelayDog_Visor", surface),
                               ("eye", "MI_RelayDog_Eye", portal)):
        spec = D.MATERIALS[surf]
        path = DOG_FOLDER + "/" + name
        if eal.does_asset_exist(path):
            eal.delete_asset(path)
        # 5.8's Python has no MaterialEditingLibrary.create_material_instance_asset
        # (measured 2026-08-28); the asset-tools factory route is what works here.
        mi = mel.create_material_instance_asset(name, DOG_FOLDER, master) if hasattr(mel, "create_material_instance_asset") \
            else unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, DOG_FOLDER, unreal.MaterialInstanceConstant,
                                                                          unreal.MaterialInstanceConstantFactoryNew())
        if mi is None:
            raise RuntimeError("material instance %s was not created" % name)
        try:
            mel.set_material_instance_parent(mi, master)
        except Exception:
            mi.set_editor_property("parent", master)
        # FLAT canon colour: the masters multiply the albedo TEXTURE by the tint,
        # so the texture is white and the tint carries the exact web colour. The
        # masters sample every texture through WORLD-XY-projected UVs scaled by
        # TexScale; the first studio capture (2026-08-28) showed the master's
        # plaster NORMAL still streaking every vertical face, so the flat normal
        # is READ BACK after assignment and TexScale is 0 -- a constant UV makes
        # every sample one texel, i.e. flat, whatever texture is bound.
        for pname, tex in (("Albedo", white), ("RoughnessMap", white), ("Normal", flat_normal)):
            if tex is None:
                LOG("MATERIAL %s: no engine texture for %s -- relying on TexScale 0" % (name, pname))
                continue
            mel.set_material_instance_texture_parameter_value(mi, pname, tex)
            try:
                got = mel.get_material_instance_texture_parameter_value(mi, pname)
                LOG("MATERIAL %s: %s -> %s" % (name, pname, got.get_name() if got is not None else "NONE"))
            except Exception as exc:
                LOG("MATERIAL %s: %s read-back failed (%s)" % (name, pname, exc))
        mel.set_material_instance_scalar_parameter_value(mi, "TexScale", 0.0)
        mel.set_material_instance_vector_parameter_value(mi, "BaseColor", lin(spec["color"]))
        mel.set_material_instance_scalar_parameter_value(mi, "Roughness", float(spec["roughness"]))
        mel.set_material_instance_scalar_parameter_value(mi, "RoughVary", 0.0)
        mel.set_material_instance_scalar_parameter_value(mi, "Metallic", float(spec["metalness"]))
        mel.set_material_instance_scalar_parameter_value(mi, "Specular", 0.5 if surf != "visor" else 0.2)
        if spec["emissive"] is not None:
            hex_e, intensity = spec["emissive"]
            mel.set_material_instance_vector_parameter_value(mi, "Emissive", lin(hex_e))
            mel.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", float(intensity) * EYE_EMISSIVE)
        try:
            mel.recompile_material(mi)
        except Exception as exc:
            LOG("recompile %s: %s" % (name, exc))
        eal.save_asset(path, only_if_is_dirty=False)
        out[surf] = mi
        LOG("MATERIAL %s colour=%s rough=%.2f metal=%.2f emissive=%s" % (
            name, spec["color"], spec["roughness"], spec["metalness"],
            ("%s x %.1f" % (spec["emissive"][0], spec["emissive"][1] * EYE_EMISSIVE)) if spec["emissive"] else "none"))
    return out


# -------------------------------------------------------------------- meshes
def build_meshes(ctx):
    """One static mesh per (joint, surface), in the joint's local frame."""
    eal = unreal.EditorAssetLibrary
    built = {}
    parts = D.parts(W_UU)
    for (joint, surface), boxes in parts.items():
        key = "RelayDog_%s_%s" % (joint, surface)
        m = ctx.mesh(key)
        for name, centre, dims in boxes:
            m.box(dims[0], dims[1], dims[2], at=centre)
        path = m.to_asset(DOG_FOLDER, key, nanite=False, collision=False, lods=False)
        lo, hi = D.extents(boxes)
        LOG("PART %s_%s extents=%.2f,%.2f,%.2f size=%.2f,%.2f,%.2f boxes=%d tris=%s asset=%s" % (
            joint, surface, lo[0], lo[1], lo[2], hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], len(boxes),
            m.tri_count() if hasattr(m, "tri_count") else "?", path))
        if path is None or not eal.does_asset_exist(path):
            raise RuntimeError("static mesh %s was not saved" % key)
        built[(joint, surface)] = eal.load_asset(path)
    return built


# ----------------------------------------------------------------- blueprint
def build_blueprint(meshes, mats):
    """BP_RelayDog (Character): Capsule → Body(SceneComponent at ground) → joint
    pivots → StaticMeshComponents. Returns the generated class or None."""
    eal = unreal.EditorAssetLibrary
    path = DOG_FOLDER + "/" + BP_NAME
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    factory = unreal.BlueprintFactory()
    factory.set_editor_property("parent_class", unreal.Character)
    bp = unreal.AssetToolsHelpers.get_asset_tools().create_asset(BP_NAME, DOG_FOLDER, None, factory)
    if bp is None:
        LOG("BLUEPRINT create_asset returned None")
        return None
    sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    handles = sds.k2_gather_subobject_data_for_blueprint(context=bp)
    if not handles:
        LOG("BLUEPRINT no subobject handles")
        return None
    root = handles[0]
    lib = unreal.SubobjectDataBlueprintFunctionLibrary

    def add(parent, cls, name):
        params = unreal.AddNewSubobjectParams(parent_handle=parent, new_class=cls, blueprint_context=bp)
        handle, why = sds.add_new_subobject(params)
        # A SubobjectDataHandle exposes no is_valid() to Python (measured 2026-08-28);
        # the data record behind it is what says whether the add took.
        data = sds.k2_find_subobject_data_from_handle(handle)
        valid = False
        try:
            valid = bool(lib.is_valid(data))
        except Exception:
            valid = data is not None
        if not valid:
            raise RuntimeError("add_new_subobject %s: %s" % (name, why))
        sds.rename_subobject(handle, unreal.Text(name))
        obj = lib.get_object(data)
        if obj is None:
            raise RuntimeError("subobject %s has no template object" % name)
        return handle, obj

    half_height = D.height() * W_UU / 2.0
    radius = 0.565 * W_UU + 2.0   # the hands' outer edge, the widest thing below the head
    body_h, body = add(root, unreal.SceneComponent, "Body")
    body.set_editor_property("relative_location", vec((0, 0, -half_height)))   # ground at the capsule's foot
    pivots = D.pivots_unreal(W_UU)
    for joint in D.JOINTS:
        if joint == "root":
            parent_h = body_h
        else:
            parent_h, pivot_obj = add(body_h, unreal.SceneComponent, "Pivot_" + joint)
            pivot_obj.set_editor_property("relative_location", vec(pivots[joint]))
        for surface in D.SURFACES:
            sm = meshes.get((joint, surface))
            if sm is None:
                continue
            _, comp = add(parent_h, unreal.StaticMeshComponent, "Mesh_%s_%s" % (joint, surface))
            comp.set_editor_property("static_mesh", sm)
            comp.set_material(0, mats[surface])
            comp.set_editor_property("relative_location", vec((0, 0, 0)))
            try:
                comp.set_collision_profile_name("NoCollision")   # the capsule is the collider
            except Exception:
                pass
    unreal.BlueprintEditorLibrary.compile_blueprint(bp)
    cls = bp.generated_class()
    try:
        cdo = unreal.get_default_object(cls)
        cdo.capsule_component.set_capsule_size(float(radius), float(half_height))
    except Exception as exc:
        LOG("capsule size not set on the CDO (%s)" % exc)
    eal.save_asset(path, only_if_is_dirty=False)
    LOG("BLUEPRINT %s parent=Character capsule r=%.1f hh=%.1f joints=%d" % (path, radius, half_height, len(D.JOINTS)))
    return cls


def place_dog_fallback(actors, meshes, mats, at):
    """The same articulated hierarchy from attached actors, when no Blueprint could be made."""
    root = actors.spawn_actor_from_class(unreal.StaticMeshActor, vec(at), rot(0, 0))
    root.set_actor_label("RelayDog_Root")
    pivots = D.pivots_unreal(W_UU)
    made = 1
    for (joint, surface), sm in meshes.items():
        p = pivots[joint]
        a = actors.spawn_actor_from_class(unreal.StaticMeshActor, vec((at[0] + p[0], at[1] + p[1], at[2] + p[2])), rot(0, 0))
        a.static_mesh_component.set_static_mesh(sm)
        a.static_mesh_component.set_material(0, mats[surface])
        a.static_mesh_component.set_mobility(unreal.ComponentMobility.MOVABLE)
        a.set_actor_label("RelayDog_%s_%s" % (joint, surface))
        a.attach_to_actor(root, unreal.Name("None"), unreal.AttachmentRule.KEEP_WORLD, unreal.AttachmentRule.KEEP_WORLD,
                          unreal.AttachmentRule.KEEP_WORLD, False)
        made += 1
    return root, made


# -------------------------------------------------------------------- studio
CAMERAS = [
    # name, location, yaw (pitch -3), tag index. The Dog stands at the origin facing +X.
    ("DogCam_Front", (380.0, 0.0, 92.0), 180.0),
    ("DogCam_ThreeQuarter", (270.0, -270.0, 92.0), 135.0),
    ("DogCam_Side", (0.0, 380.0, 92.0), -90.0),
    ("DogCam_Rear", (-380.0, 0.0, 92.0), 0.0),
]


def build_studio(meshes, mats, dog_cls):
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    eal = unreal.EditorAssetLibrary
    util = unreal.EditorLoadingAndSavingUtils
    mel = unreal.MaterialEditingLibrary
    if eal.does_asset_exist(STUDIO_MAP):
        eal.delete_asset(STUDIO_MAP)
    ok = les.new_level(STUDIO_MAP, False)
    LOG("STUDIO new_level(%s, is_partitioned_world=False) -> %s" % (STUDIO_MAP, ok))
    cube = eal.load_asset("/Engine/BasicShapes/Cube")
    # neutral grey, matte, on the surface master
    grey_path = DOG_FOLDER + "/MI_RelayDog_StudioGrey"
    if eal.does_asset_exist(grey_path):
        eal.delete_asset(grey_path)
    surface_master = eal.load_asset(MASTER_FOLDER + "/M_V2_Surface")
    grey = mel.create_material_instance_asset("MI_RelayDog_StudioGrey", DOG_FOLDER, surface_master) if hasattr(mel, "create_material_instance_asset") \
        else unreal.AssetToolsHelpers.get_asset_tools().create_asset("MI_RelayDog_StudioGrey", DOG_FOLDER, unreal.MaterialInstanceConstant,
                                                                      unreal.MaterialInstanceConstantFactoryNew())
    try:
        mel.set_material_instance_parent(grey, surface_master)
    except Exception:
        grey.set_editor_property("parent", surface_master)
    white = eal.load_asset("/Engine/EngineResources/WhiteSquareTexture")
    for pname, tex in (("Albedo", white), ("RoughnessMap", white), ("Normal", eal.load_asset("/Engine/EngineMaterials/DefaultNormal"))):
        if tex is not None:
            mel.set_material_instance_texture_parameter_value(grey, pname, tex)
    mel.set_material_instance_vector_parameter_value(grey, "BaseColor", unreal.LinearColor(0.18, 0.18, 0.18, 1))
    mel.set_material_instance_scalar_parameter_value(grey, "Roughness", 0.9)
    mel.set_material_instance_scalar_parameter_value(grey, "RoughVary", 0.0)
    mel.set_material_instance_scalar_parameter_value(grey, "Metallic", 0.0)
    mel.set_material_instance_scalar_parameter_value(grey, "TexScale", 0.0)
    try:
        mel.recompile_material(grey)
    except Exception:
        pass
    eal.save_asset(grey_path, only_if_is_dirty=False)
    # A backdrop wide enough that no studio camera sees past its edge (the
    # three-quarter camera looks 45 deg off axis at 3.8 m), and a second wall
    # on the side camera's far side so no view opens onto the horizon.
    for label, at, scale in (("Studio_Floor", (0, 0, -5), (60, 60, 0.1)), ("Studio_Backdrop", (-900, 0, 400), (0.2, 80, 8)),
                             ("Studio_SideWall", (0, -900, 400), (80, 0.2, 8))):
        a = actors.spawn_actor_from_class(unreal.StaticMeshActor, vec(at), rot(0, 0))
        a.static_mesh_component.set_static_mesh(cube)
        a.set_actor_scale3d(vec(scale))
        a.static_mesh_component.set_material(0, grey)
        a.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
        a.set_actor_label(label)
    # light: atmosphere + one sun + a sky light, nothing coloured
    try:
        atm = actors.spawn_actor_from_class(unreal.SkyAtmosphere, vec((0, 0, 0)), rot(0, 0))
        atm.set_actor_label("Studio_Atmosphere")
    except Exception as exc:
        LOG("no SkyAtmosphere (%s)" % exc)
    sun = actors.spawn_actor_from_class(unreal.DirectionalLight, vec((0, 0, 500)), rot(-42.0, 35.0))
    sun.set_actor_label("Studio_Sun")
    lc = sun.light_component
    lc.set_intensity(SUN_LUX)
    try:
        lc.set_editor_property("atmosphere_sun_light", True)
        lc.set_editor_property("use_temperature", True)
        lc.set_editor_property("temperature", 5800.0)
    except Exception as exc:
        LOG("sun props (%s)" % exc)
    sky = actors.spawn_actor_from_class(unreal.SkyLight, vec((0, 0, 400)), rot(0, 0))
    sky.set_actor_label("Studio_SkyLight")
    try:
        sky.light_component.set_editor_property("real_time_capture", True)
        sky.light_component.set_intensity(1.0)
    except Exception as exc:
        LOG("sky light props (%s)" % exc)
    # THE ONE DOG, at the origin, facing +X
    placed = "BLUEPRINT"
    if dog_cls is not None:
        dog = actors.spawn_actor_from_class(dog_cls, vec((0, 0, D.height() * W_UU / 2.0)), rot(0, 0))
        dog.set_actor_label("RelayDog_Canonical")
        try:
            dog.set_editor_property("tags", [unreal.Name("RELAY_DOG_CANONICAL"), unreal.Name("UNREAL_PRODUCTION")])
        except Exception:
            pass
    else:
        root, n = place_dog_fallback(actors, meshes, mats, (0, 0, 0))
        placed = "FALLBACK(%d actors)" % n
    for i, (label, at, yaw) in enumerate(CAMERAS):
        cam = actors.spawn_actor_from_class(unreal.CameraActor, vec(at), rot(-3.0, yaw))
        cam.set_actor_label(label)
        cam.set_editor_property("tags", [unreal.Name("HeroCam%d" % i), unreal.Name(label), unreal.Name("RELAY_DOG_STUDIO")])
        fov_set = False
        for getter in (lambda: cam.camera_component, lambda: cam.get_camera_component()):
            try:
                getter().set_editor_property("field_of_view", 55.0)
                fov_set = True
                break
            except Exception:
                continue
        if not fov_set:
            LOG("fov not set on %s -- the capture will use the engine default 90" % label)
    les.save_current_level()
    util.save_dirty_packages(True, True)
    cdir = str(unreal.Paths.project_content_dir())
    umap = os.path.join(cdir, "WonderlandV2", "Maps", "WL_V2_RelayDogStudio.umap")
    size = os.path.getsize(umap) if os.path.isfile(umap) else 0
    alls = actors.get_all_level_actors()
    LOG("STUDIO saved=%s bytes=%d actors=%d dog=%s cameras=%d sun=%.0flux eye_emissive=%.0f" % (
        size > 12000, size, len(alls), placed, len(CAMERAS), SUN_LUX, EYE_EMISSIVE))
    return size > 12000


def main():
    LOG("SCALE W_UU=%.1f height_uu=%.1f (web canon %.4f x W)" % (W_UU, D.height() * W_UU, D.height()))
    ctx = gs.Context(unreal, LOG)
    mats = build_materials()
    meshes = build_meshes(ctx)
    dog_cls = None
    try:
        dog_cls = build_blueprint(meshes, mats)
    except Exception as exc:
        LOG("BLUEPRINT FAILED (%s) -- the studio will assemble the Dog from attached actors" % exc)
    ok = build_studio(meshes, mats, dog_cls)
    LOG("SUMMARY meshes=%d materials=%d blueprint=%s studio=%s" % (len(meshes), len(mats), dog_cls is not None, ok))


main()
