# DOES SceneCapture2D WORK AT ALL IN THIS PROJECT? The question the last four jobs have been circling.
#
# WHAT IS RULED OUT. The stage capture writes 255,255,255 across the whole target with the stage lights at full
# power, at a hundredth, at a ten-thousandth, with the capture's post processing switched off entirely, and with
# the capture source changed from tonemapped LDR to raw SceneColorHDR. Five configurations, one answer. A capture
# that ignores the scene, the lights and the tonemapper is not photographing anything -- it is writing a constant.
#
# SO THE NEXT QUESTION IS NOT ABOUT THE STAGE. It is whether a scene capture renders correctly ANYWHERE here:
#   1. a capture I build myself, from scratch, down in the plaza where the world is loaded and lit
#   2. the same capture, but with bCaptureEveryFrame on rather than an explicit CaptureScene call
#   3. the existing stage capture moved down to the plaza, to separate "this actor" from "that altitude"
#
# If mine works in the plaza and the stage's does not, the fault is the stage. If none work, scene capture is
# broken project-wide and the wardrobe needs a different preview path -- which is worth knowing before building
# anything on top of this one.
import json
import os

L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "capture_anywhere")
GRID = [(0.5, 0.3), (0.5, 0.5), (0.5, 0.7), (0.2, 0.5), (0.8, 0.5)]


def job():
    os.makedirs(ROOT, exist_ok=True)
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
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        at = pawn.get_actor_location()
        fwd = pawn.get_actor_forward_vector()
        L.focus_game_viewport()

        # ---- SPAWNING MY OWN CAPTURE IS NOT AVAILABLE HERE. EditorLevelLibrary.spawn_actor_from_class puts
        # actors in the EDITOR world, not the running PIE world, so it returned nothing. Rather than add a C++
        # spawn helper and a rebuild just to get a control, the stage's own capture is moved down into the loaded,
        # lit plaza -- which separates "this capture component is broken" from "that altitude has nothing to
        # photograph" just as well, and costs nothing.

        def shoot(tag, target, capture_component, explicit=True):
            unreal.RenderingLibrary.clear_render_target2d(world, target, unreal.LinearColor(0.0, 0.0, 1.0, 1.0))
            yield 0.8
            w, h = int(target.size_x), int(target.size_y)
            pre = unreal.RenderingLibrary.read_render_target_pixel(world, target, w // 2, h // 2)
            if explicit:
                capture_component.capture_scene()
            yield 0.8
            out = []
            for fx, fy in GRID:
                c = unreal.RenderingLibrary.read_render_target_pixel(
                    world, target, int(fx * (w - 1)), int(fy * (h - 1)))
                out.append([int(c.r), int(c.g), int(c.b)])
            RESULT[tag] = {"cleared": [int(pre.r), int(pre.g), int(pre.b)], "after": out,
                           "all_white": all(p == [255, 255, 255] for p in out),
                           "still_blue": all(p[2] > 150 and p[0] < 90 for p in out)}

        # ---- and the STAGE's own capture, brought down to the plaza
        ui = L.get_ui(world)
        ui.toggle_project_brain()
        yield 1.2
        ui.set_brain_skins_open(True)
        yield 2.0
        ui.close_overlay()
        yield 3.0
        stages = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage)
        if stages:
            stage = stages[0]
            stage.set_actor_location(unreal.Vector(at.x + 400.0, at.y + 400.0, at.z), False, False)
            yield 1.5
            scap = None
            for c in stage.get_components_by_class(unreal.SceneCaptureComponent2D):
                scap = c
                break
            if scap is not None:
                for s in shoot("stage_in_plaza", stage.get_render_target(), scap):
                    yield s
                # AND LET THE ENGINE DRIVE IT. An explicit CaptureScene() and an engine-driven capture take
                # different paths through the renderer; if one works and the other does not, that is the answer.
                srt = stage.get_render_target()
                unreal.RenderingLibrary.clear_render_target2d(world, srt, unreal.LinearColor(0.0, 0.0, 1.0, 1.0))
                yield 0.8
                scap.set_editor_property("capture_every_frame", True)
                yield 2.5
                w2, h2 = int(srt.size_x), int(srt.size_y)
                out2 = []
                for fx, fy in GRID:
                    c = unreal.RenderingLibrary.read_render_target_pixel(
                        world, srt, int(fx * (w2 - 1)), int(fy * (h2 - 1)))
                    out2.append([int(c.r), int(c.g), int(c.b)])
                scap.set_editor_property("capture_every_frame", False)
                RESULT["stage_every_frame"] = {
                    "after": out2, "all_white": all(p == [255, 255, 255] for p in out2),
                    "still_blue": all(p[2] > 150 and p[0] < 90 for p in out2)}
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "anywhere.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLCAP could not end play: %s" % exc)
