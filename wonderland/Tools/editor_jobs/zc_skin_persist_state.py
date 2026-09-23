# bAlwaysPersistRenderingState: the known UE cause that matches this symptom exactly.
#
# WHAT A ONE-SHOT SCENE CAPTURE DOES WITHOUT IT. With bCaptureEveryFrame off, the capture keeps no rendering state
# between calls, so every CaptureScene starts with an empty temporal history -- no TSR history, no eye-adaptation
# history. Features that need a previous frame have none, and the documented result is a frame that comes out
# uniformly white or black regardless of what is in front of the camera.
#
# THAT IS THE SYMPTOM, PRECISELY. White everywhere, unchanged by the stage lights at a ten-thousandth of power,
# unchanged with the post chain disabled, unchanged in raw HDR, and unchanged down in the fully lit plaza. Seven
# configurations that all ignore the scene are not seven lighting problems; they are one frame that never rendered.
#
# Tested with the format change alongside it, since an 8-bit SRGB target is the other thing a capture is commonly
# blamed for -- so that if persisting the state alone fixes it, that is known rather than assumed.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_persist_state")
GRID = [(0.5, 0.2), (0.5, 0.45), (0.5, 0.62), (0.5, 0.85), (0.15, 0.5), (0.85, 0.5)]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
        L.focus_game_viewport()
        ui.toggle_project_brain()
        yield 1.5
        ui.set_brain_skins_open(True)
        yield 2.0
        stages = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage)
        if not stages:
            RESULT["status"] = "failed"
            RESULT["why"] = "no skin stage"
            return
        stage = stages[0]
        ui.wear_relay_skin("arden_infernal")
        yield 1.5
        ui.close_overlay()
        yield 3.5

        rt = stage.get_render_target()
        w, h = int(rt.size_x), int(rt.size_y)
        cap = None
        for c in stage.get_components_by_class(unreal.SceneCaptureComponent2D):
            cap = c
            break
        if cap is None:
            RESULT["status"] = "failed"
            RESULT["why"] = "no capture component"
            return

        def shoot(tag, warm=1):
            unreal.RenderingLibrary.clear_render_target2d(world, rt, unreal.LinearColor(0.0, 0.0, 1.0, 1.0))
            yield 0.8
            pre = unreal.RenderingLibrary.read_render_target_pixel(world, rt, w // 2, h // 2)
            # SEVERAL FRAMES, because a temporal history has to be built before the frame that uses it is good.
            for _ in range(warm):
                cap.capture_scene()
                yield 0.25
            yield 0.5
            out = []
            for fx, fy in GRID:
                c = unreal.RenderingLibrary.read_render_target_pixel(
                    world, rt, int(fx * (w - 1)), int(fy * (h - 1)))
                out.append([int(c.r), int(c.g), int(c.b)])
            white = all(p == [255, 255, 255] for p in out)
            varied = len({tuple(p) for p in out}) > 1
            RESULT[tag] = {"cleared": [int(pre.r), int(pre.g), int(pre.b)], "after": out,
                           "all_white": white, "has_detail": varied}

        RESULT["persist_before"] = bool(cap.get_editor_property("always_persist_rendering_state"))
        for s in shoot("before_persist", warm=1):
            yield s

        # ---- THE FIX UNDER TEST
        cap.set_editor_property("always_persist_rendering_state", True)
        yield 0.5
        for s in shoot("persist_one_frame", warm=1):
            yield s
        for s in shoot("persist_warmed_6", warm=6):
            yield s

        # ---- and with a float target, in case 8-bit SRGB is a second, separate problem
        try:
            newrt = unreal.RenderingLibrary.create_render_target2d(
                world, 640, 800, unreal.TextureRenderTargetFormat.RTF_RGBA16F)
            cap.set_editor_property("texture_target", newrt)
            yield 0.6
            unreal.RenderingLibrary.clear_render_target2d(world, newrt, unreal.LinearColor(0.0, 0.0, 1.0, 1.0))
            yield 0.6
            for _ in range(6):
                cap.capture_scene()
                yield 0.25
            out = []
            for fx, fy in GRID:
                c = unreal.RenderingLibrary.read_render_target_pixel(
                    world, newrt, int(fx * (639)), int(fy * (799)))
                out.append([int(c.r), int(c.g), int(c.b)])
            RESULT["float_target"] = {"after": out,
                                      "all_white": all(p == [255, 255, 255] for p in out),
                                      "has_detail": len({tuple(p) for p in out}) > 1}
            cap.set_editor_property("texture_target", rt)
        except Exception as exc:
            RESULT["float_target_error"] = str(exc)

        # ---- and finally, the panel itself, which is the only judgement that counts
        ui.toggle_project_brain()
        yield 1.5
        ui.set_brain_skins_open(True)
        yield 3.0
        H.capture_viewport_jpeg(os.path.join(ROOT, "panel_after_fix.jpg"), 1900, 95)
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "persist.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLPERSIST2 could not end play: %s" % exc)
