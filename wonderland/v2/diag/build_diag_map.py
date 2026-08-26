"""P0 BLACK-SCREEN ISOLATION -- TEST 1 map. TEMPORARY, REMOVABLE, NOT ART.

Builds /Game/WonderlandV2/Diag/WL_V2_RenderDiagnostic: a classic (non
partitioned) level with ONE CameraActor tagged HeroCam0/arrival_hero_view at
the origin looking +Y, ONE engine cube scaled 20x (20 m) 6 m in front of it,
wearing an UNLIT emissive magenta material built here, plus a white unlit
sphere off to the left. No World Partition, no Data Layers, no lights needed
(unlit), no Wonderland assets. Cooked beside the V2 map and booted by name.

    WL_GENERATOR=wonderland/v2/diag/build_diag_map.py bash v2-build.sh
"""
import unreal

MAP = "/Game/WonderlandV2/Diag/WL_V2_RenderDiagnostic"
PKG = "/Game/WonderlandV2/Diag"


def log(msg):
    unreal.log_warning("DIAG " + msg)


def rot(pitch, yaw, roll=0.0):
    """unreal.Rotator's POSITIONAL order is (roll, pitch, yaw) -- the first
    diagnostic camera looked straight up because of it. Always by property."""
    r = unreal.Rotator()
    r.set_editor_property("pitch", float(pitch))
    r.set_editor_property("yaw", float(yaw))
    r.set_editor_property("roll", float(roll))
    return r


def unlit(name, rgb):
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    path = PKG + "/" + name
    if eal.does_asset_exist(path):
        # reuse: recreating the material means a fresh shadermap and ~8 min of
        # shader compile per run, which is most of a diagnostic's cost
        return eal.load_asset(path)
    m = tools.create_asset(name, PKG, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    c = mel.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -300, 0)
    c.set_editor_property("constant", unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1.0))
    mel.connect_material_property(c, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    return m


def main():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    eal = unreal.EditorAssetLibrary
    if eal.does_asset_exist(MAP):
        eal.delete_asset(MAP)
    ok = les.new_level(MAP, False)          # CLASSIC level: actors live in the .umap
    log("new_level(%s, partitioned=False) -> %s" % (MAP, ok))
    magenta = unlit("M_DiagUnlitMagenta", (1.0, 0.0, 1.0))
    white = unlit("M_DiagUnlitWhite", (1.0, 1.0, 1.0))
    cube = eal.load_asset("/Engine/BasicShapes/Cube")
    sphere = eal.load_asset("/Engine/BasicShapes/Sphere")
    a = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0.0, 600.0, 200.0), rot(0, 0))
    a.static_mesh_component.set_static_mesh(cube)
    a.set_actor_scale3d(unreal.Vector(20.0, 4.0, 20.0))
    a.static_mesh_component.set_material(0, magenta)
    a.set_actor_label("DIAG_MagentaCube")
    b = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(900.0, 900.0, 200.0), rot(0, 0))
    b.static_mesh_component.set_static_mesh(sphere)
    b.set_actor_scale3d(unreal.Vector(6.0, 6.0, 6.0))
    b.static_mesh_component.set_material(0, white)
    b.set_actor_label("DIAG_WhiteSphere")
    cam = actors.spawn_actor_from_class(unreal.CameraActor, unreal.Vector(0.0, 0.0, 200.0), rot(0.0, 90.0))
    cam.set_actor_label("DIAG_Camera")
    cam.set_editor_property("tags", [unreal.Name("HeroCam0"), unreal.Name("arrival_hero_view"), unreal.Name("DIAG")])
    try:
        cam.get_camera_component().set_editor_property("field_of_view", 90.0)
    except Exception as exc:
        log("fov not set (%s)" % exc)
    # a directional light too, so a LIT object would also show if unlit somehow failed
    sun = actors.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 1000), rot(-50, 0))
    sun.set_actor_label("DIAG_Sun")
    saved = les.save_current_level()
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    n = len(actors.get_all_level_actors())
    log("saved=%s actors=%d camera at (0,0,200) yaw 90; cube 20m wide at (0,600,200); sphere at (900,900,200)" % (saved, n))
    log("SUMMARY map=%s classic saved=%s actors=%d" % (MAP, saved, n))


main()
