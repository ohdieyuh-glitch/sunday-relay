"""P0 TEST A' -- pixels from the EDITOR, no cook, no game launch, no viewport.

Runs inside UnrealEditor-Cmd (-run=pythonscript -AllowCommandletRendering
-RenderOffscreen): builds the diagnostic scene in a fresh classic level, then
renders it with a SceneCaptureComponent2D into a TextureRenderTarget2D and
exports the target to a PNG (RenderingLibrary.export_render_target). This is a
render-target READBACK -- a different pixel path from the packaged game's
backbuffer capture. Result is binary: magenta pixels, or black.

    WL_GENERATOR=wonderland/v2/diag/editor_capture_diag.py WL_GENERATOR_EXTRA="-AllowCommandletRendering -RenderOffscreen" ...
"""
import os
import unreal

OUT_DIR = os.environ.get("WLV2_DIAG_OUT", "/teamspace/studios/this_studio/wonderland/proof/diag")
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
    ok = les.new_level(MAP, False)
    log("new_level(%s, classic) -> %s" % (MAP, ok))
    world = unreal.EditorLevelLibrary.get_editor_world()
    log("world=%s map=%s" % (world.get_name(), world.get_path_name()))
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
    sun = actors.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 1000), rot(-50, 0))
    sun.set_actor_label("DIAG_Sun")
    # camera/object proof: the cube centre is 6 m straight ahead (+Y) of a camera looking +Y
    cl, ol = cam.get_actor_location(), a.get_actor_location()
    fwd = cam.get_actor_forward_vector()
    d = ol - cl
    dist = d.length()
    dot = (d.x * fwd.x + d.y * fwd.y + d.z * fwd.z) / max(dist, 1e-6)
    log("CAMERA loc=%s rot=%s fwd=%s | CUBE loc=%s dist=%.0f dot(fwd)=%.3f" % (cl, cam.get_actor_rotation(), fwd, ol, dist, dot))
    # a fresh level has no filename: save_current_level refuses ("Use
    # EditorLoadingAndSavingUtils"); save_map(world, path) names and writes it
    world = unreal.EditorLevelLibrary.get_editor_world()
    saved = unreal.EditorLoadingAndSavingUtils.save_map(world, MAP)
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    log("saved=%s via save_map (before the capture, so a crash after it cannot lose the map)" % saved)
    # ---- the render-target readback (no viewport, no game) ----
    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)
    W, H = 640, 360
    # world-context object: a live actor in the world (passing the World object
    # itself failed to nativize after the save)
    ctx = cam
    rt = unreal.RenderingLibrary.create_render_target2d(ctx, W, H, unreal.TextureRenderTargetFormat.RTF_RGBA8, unreal.LinearColor(0, 0, 0, 1), False)
    cap = actors.spawn_actor_from_class(unreal.SceneCapture2D, cl, cam.get_actor_rotation())
    comp = cap.get_editor_property("capture_component2d")
    comp.set_editor_property("texture_target", rt)
    comp.set_editor_property("fov_angle", 90.0)
    for src in ("SCS_FINAL_COLOR_LDR", "SCS_SCENE_COLOR_HDR"):
        try:
            comp.set_editor_property("capture_source", getattr(unreal.SceneCaptureSource, src))
            break
        except Exception:
            continue
    comp.set_editor_property("capture_every_frame", False)
    try:
        comp.capture_scene()
        comp.capture_scene()
    except Exception as exc:
        log("capture_scene failed (%s)" % exc)
    name = "diag_editor_rt_%dx%d.png" % (W, H)
    try:
        unreal.RenderingLibrary.export_render_target(ctx, rt, OUT_DIR, name)
        p = os.path.join(OUT_DIR, name)
        log("EXPORTED %s (%s bytes)" % (p, os.path.getsize(p) if os.path.exists(p) else "MISSING"))
    except Exception as exc:
        log("export_render_target failed (%s)" % exc)
    # (AutomationLibrary.take_high_res_screenshot SEGFAULTS in the commandlet: null viewport. Not used.)
    log("SUMMARY map=%s classic saved=%s" % (MAP, saved))


main()
