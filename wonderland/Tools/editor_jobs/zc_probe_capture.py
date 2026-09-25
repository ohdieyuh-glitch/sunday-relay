# WHY DOES THE SCENE CAPTURE READ FLAT?
#
# zc_shadows and zc_water both measured 0.0 change on both sides of their control. The guards caught it as
# an instrument failure rather than reporting a pass, which is right, but 0.0 has two very different causes
# and they need different fixes:
#
#   the render target is EMPTY          -- every pixel is black, the capture never wrote anything
#   the render target is NOT UPDATING   -- the pixels hold a real picture, and it is the same picture twice
#
# So this prints the actual pixel values rather than a difference. It also settles the other two unknowns in
# one pass: which path loads the water master, and what get_default_object actually hands back for the
# companion preview settings now that the class is BlueprintType.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    findings = {}
    RESULT["findings"] = findings

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 0.5

    # ---------------------------------------------------------------- the water master, by every path
    paths = {}
    for label, path in (
            ("package", "/Game/Wonderland/Materials/M_WL_RealWater"),
            ("object", "/Game/Wonderland/Materials/M_WL_RealWater.M_WL_RealWater"),
    ):
        try:
            asset = unreal.EditorAssetLibrary.load_asset(path)
            paths[label] = {"path": path, "loaded": asset is not None,
                            "class": str(asset.get_class().get_name()) if asset is not None else None,
                            "blend": str(asset.get_editor_property("blend_mode")) if asset is not None else None}
        except Exception as err:                               # noqa: BLE001
            paths[label] = {"path": path, "error": str(err)}
    findings["water_master"] = paths

    # ---------------------------------------------------------------- the settings object
    try:
        cls = unreal.load_class(None, "/Script/Wonderland.WonderlandCompanionPreviewSettings")
        cdo = unreal.get_default_object(cls)
        findings["settings"] = {"class": str(cls.get_name()), "python_type": type(cdo).__name__}
        try:
            findings["settings"]["compound_agent_name"] = str(cdo.get_editor_property("compound_agent_name"))
        except Exception as err:                               # noqa: BLE001
            findings["settings"]["property_error"] = str(err)
    except Exception as err:                                   # noqa: BLE001
        findings["settings"] = {"error": str(err)}

    # ---------------------------------------------------------------- the capture, pixel by pixel
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    where = pawn.get_actor_location()
    eye = unreal.Vector(where.x, where.y, where.z + 900.0)
    aim = unreal.Rotator(-35.0, 0.0, 0.0)
    try:
        rt = unreal.RenderingLibrary.create_render_target2d(
            world, 320, 180, unreal.TextureRenderTargetFormat.RTF_RGBA8)
        findings["render_target"] = {"made": rt is not None,
                                     "format": str(rt.get_editor_property("render_target_format"))}
        cap = H.spawn_scene_capture(world, eye, aim, rt)
        findings["capture_spawned"] = cap is not None
        comp = cap.get_editor_property("capture_component2d")
        findings["component"] = str(comp.get_name())
        findings["target_bound"] = comp.get_editor_property("texture_target") is not None

        def read_some():
            out = []
            for (x, y) in ((160, 90), (80, 45), (240, 135), (40, 150), (300, 30)):
                c = unreal.RenderingLibrary.read_render_target_pixel(world, rt, x, y)
                out.append([int(c.r), int(c.g), int(c.b), int(c.a)])
            return out

        # BEFORE ANY CAPTURE. Whatever the target holds when nothing has been drawn into it is the baseline
        # every later reading has to be told apart from.
        findings["pixels_before_capture"] = read_some()

        comp.capture_scene()
        # A FRAME TO LAND. The first version read immediately, which asks the GPU for a picture it may not
        # have finished writing.
        for _ in range(6):
            yield 0.1
        findings["pixels_after_capture"] = read_some()

        for _ in range(10):
            yield 0.1
        comp.capture_scene()
        for _ in range(6):
            yield 0.1
        findings["pixels_second_capture"] = read_some()

        # AND THE SAME QUESTION ASKED A DIFFERENT WAY, in case the readback is what is broken rather than
        # the capture: an on-disk export of the very same target.
        try:
            out_dir = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "probe_capture")
            os.makedirs(out_dir, exist_ok=True)
            unreal.RenderingLibrary.export_render_target(world, rt, out_dir, "probe_rt.png")
            png = os.path.join(out_dir, "probe_rt.png")
            findings["exported_png_bytes"] = os.path.getsize(png) if os.path.exists(png) else 0
        except Exception as err:                               # noqa: BLE001
            findings["export_error"] = str(err)

        cap.destroy_actor()
    except Exception as err:                                   # noqa: BLE001
        findings["capture_error"] = str(err)

    RESULT["status"] = "probed"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
