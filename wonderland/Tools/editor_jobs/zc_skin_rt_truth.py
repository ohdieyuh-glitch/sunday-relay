# WHAT DOES THE CAPTURE ACTUALLY WRITE? Measured with the capture STOPPED, so the calibration survives.
#
# MY LAST TWO ATTEMPTS AT THIS WERE BOTH INVALID, in the same way. I cleared the target to red and read it back,
# and got white, and concluded the readback tools were broken. They were not. The wardrobe was OPEN both times, so
# the stage was capturing at about thirteen frames a second and simply overwrote my red clear before I read it.
# The calibration measured the capture, not the instrument.
#
# THE STAGE SLEEPS 0.75 s AFTER THE LAST MarkWanted. So this closes the wardrobe, waits past that, and only then
# clears and reads. If red reads back as red, the instrument is sound and every number after it means something.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_rt_truth")
GRID = [(0.5, 0.2), (0.5, 0.45), (0.5, 0.62), (0.5, 0.85), (0.15, 0.5), (0.85, 0.5)]


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
        rt = stage.get_render_target()
        w, h = int(rt.size_x), int(rt.size_y)

        def sample(tag):
            out = []
            for fx, fy in GRID:
                c = unreal.RenderingLibrary.read_render_target_pixel(
                    world, rt, int(fx * (w - 1)), int(fy * (h - 1)))
                out.append([int(c.r), int(c.g), int(c.b)])
            RESULT[tag] = out
            return out

        # ---- STOP THE CAPTURE. Close the wardrobe and wait past the stage's 0.75 s forget window.
        ui.close_overlay()
        yield 3.0
        RESULT["capturing_after_close"] = bool(stage.is_capturing())
        quiet_a = int(stage.get_frame_count())
        yield 2.0
        quiet_b = int(stage.get_frame_count())
        RESULT["frames_while_closed"] = quiet_b - quiet_a
        RESULT["capture_is_stopped"] = (quiet_b == quiet_a)

        # ---- NOW calibrate: clear to red, read red.
        unreal.RenderingLibrary.clear_render_target2d(world, rt, unreal.LinearColor(1.0, 0.0, 0.0, 1.0))
        yield 1.5
        red = sample("read_red")
        RESULT["instrument_sound"] = all(p[0] > 150 and p[1] < 90 and p[2] < 90 for p in red)

        # ---- and NOW one single capture, and read what it wrote
        stage.mark_wanted()
        yield 0.6
        RESULT["frames_after_one_wanted"] = int(stage.get_frame_count()) - quiet_b
        sample("read_after_capture")

        # ---- then clear to red again and capture again, to be sure the second reading is repeatable
        unreal.RenderingLibrary.clear_render_target2d(world, rt, unreal.LinearColor(0.0, 1.0, 0.0, 1.0))
        yield 1.0
        sample("read_green")
        stage.mark_wanted()
        yield 0.8
        sample("read_after_capture_2")
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "truth.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLRTT could not end play: %s" % exc)
