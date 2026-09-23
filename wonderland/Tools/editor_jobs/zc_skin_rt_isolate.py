# IS THE RENDER TARGET WHITE, OR IS THE WAY I AM LOOKING AT IT WHITE?
#
# The exposure sweep came back IDENTICAL at EV 5 and EV 15. Exposure cannot be the cause of something that does not
# change when exposure changes by a factor of a thousand, so the previous diagnosis was wrong and this stops
# guessing and isolates the two possibilities against each other.
#
#   A. CLEAR THE TARGET RED AND EXPORT IT, with no capture in between. Red means the target and the export path
#      both work, and whatever writes white afterwards is the capture.
#   B. THEN CAPTURE AND EXPORT AGAIN. White means the capture is writing white. Still red means the capture is not
#      writing at all and the frame counter is counting calls that render nothing.
#
# One of those two answers is the bug, and neither of them is a guess.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_rt_isolate")


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
        yield 1.2
        ui.set_brain_skins_open(True)
        yield 2.0

        stages = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage)
        if not stages:
            RESULT["status"] = "failed"
            RESULT["why"] = "no skin stage"
            return
        stage = stages[0]
        rt = stage.get_render_target()
        RESULT["rt"] = {"w": int(rt.size_x), "h": int(rt.size_y)}

        # ---- A. red, with no capture
        unreal.RenderingLibrary.clear_render_target2d(world, rt, unreal.LinearColor(1.0, 0.0, 0.0, 1.0))
        yield 1.0
        unreal.RenderingLibrary.export_render_target(world, rt, ROOT, "a_cleared_red.png")
        RESULT["a_exported"] = os.path.exists(os.path.join(ROOT, "a_cleared_red.png"))

        # ---- B. now let the stage capture over it
        before = int(stage.get_frame_count())
        for _ in range(6):
            stage.mark_wanted()
            yield 0.3
        RESULT["frames_delta"] = int(stage.get_frame_count()) - before
        unreal.RenderingLibrary.export_render_target(world, rt, ROOT, "b_after_capture.png")
        RESULT["b_exported"] = os.path.exists(os.path.join(ROOT, "b_after_capture.png"))

        # ---- C. WHAT THE CAMERA CAN EVEN SEE. Put the world's own camera where the capture stands and photograph
        # the viewport from there: if the stage room is genuinely empty or unlit, the viewport shows that plainly
        # and the problem is the room, not the capture.
        body = stage.get_body()
        cap_at = None
        for c in stage.get_components_by_class(unreal.SceneCaptureComponent2D):
            v = c.get_world_location()
            cap_at = [round(v.x, 1), round(v.y, 1), round(v.z, 1)]
            look = body.get_actor_location() if body is not None else stage.get_actor_location()
            L.pose_camera(world, v, unreal.Vector(look.x, look.y, look.z + 100.0), 34.0)
            break
        RESULT["capture_at"] = cap_at
        yield 2.0
        H.capture_viewport_jpeg(os.path.join(ROOT, "c_from_capture_eye.jpg"), 1900, 95)

        # ---- D. and what the body actually is, close up
        if body is not None:
            at = body.get_actor_location()
            RESULT["body_at"] = [round(at.x, 1), round(at.y, 1), round(at.z, 1)]
            RESULT["body_height"] = round(float(body.get_figure_height_uu()), 1)
            RESULT["body_components"] = len(body.get_components_by_class(unreal.InstancedStaticMeshComponent))
            L.pose_camera(world, unreal.Vector(at.x + 420.0, at.y - 60.0, at.z + 120.0),
                          unreal.Vector(at.x, at.y, at.z + 100.0), 40.0)
            yield 2.0
            H.capture_viewport_jpeg(os.path.join(ROOT, "d_body_closeup.jpg"), 1900, 95)
        L.release_camera(world)
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "isolate.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLRT could not end play: %s" % exc)
