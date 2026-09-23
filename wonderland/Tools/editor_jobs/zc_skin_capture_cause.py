# WHY DOES THE CAPTURE WRITE PURE WHITE? Three candidates, tested against each other in one session.
#
# ESTABLISHED, and this time properly: with the wardrobe shut and the stage asleep, a clear to red reads back red
# and a clear to green reads back green, so the instrument is sound. One MarkWanted then writes 255,255,255 across
# the whole target, twice. The capture is genuinely saturating.
#
# ESTABLISHED TOO: the room is right. Photographed by the main camera, the Dog stands correctly dressed and lit
# against its dark backdrop. So this is about how the capture renders, not about what is in front of it.
#
# THE THREE CANDIDATES:
#   A. RADIANCE. The stage lights run at 90,000 / 52,000 / 26,000 candela, chosen for the world's daylight
#      exposure. Through a capture with pinned manual exposure that may simply be thousands of times over white.
#   B. THE POST CHAIN. If the manual exposure override is not reaching the capture, the bias sweep would do
#      nothing -- which is exactly what a sweep from EV -10 to +2 did.
#   C. THE CAPTURE SOURCE. SCS_FinalColorLDR runs the whole tonemapper; SceneColorHDR does not, so if HDR comes
#      back sane and LDR does not, the fault is in the tonemapping and not the scene.
#
# Each is applied alone, over a known clear colour, and read back. Whichever changes the answer is the cause.
import json
import os

L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_capture_cause")
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
        # ASLEEP, so nothing captures except when this job asks.
        ui.close_overlay()
        yield 3.5

        rt = stage.get_render_target()
        w, h = int(rt.size_x), int(rt.size_y)
        cap = None
        for c in stage.get_components_by_class(unreal.SceneCaptureComponent2D):
            cap = c
            break
        lights = list(stage.get_components_by_class(unreal.PointLightComponent))
        RESULT["lights"] = [[str(l.get_name()), float(l.intensity)] for l in lights]

        def shoot(tag):
            unreal.RenderingLibrary.clear_render_target2d(world, rt, unreal.LinearColor(0.0, 0.0, 1.0, 1.0))
            yield 0.8
            pre = unreal.RenderingLibrary.read_render_target_pixel(world, rt, w // 2, h // 2)
            stage.mark_wanted()
            yield 0.7
            out = []
            for fx, fy in GRID:
                c = unreal.RenderingLibrary.read_render_target_pixel(
                    world, rt, int(fx * (w - 1)), int(fy * (h - 1)))
                out.append([int(c.r), int(c.g), int(c.b)])
            RESULT[tag] = {"cleared_to": [int(pre.r), int(pre.g), int(pre.b)], "after": out,
                           "all_white": all(p == [255, 255, 255] for p in out)}

        # ---- baseline, as it stands now
        for s in shoot("baseline"):
            yield s

        # ---- A. radiance: take the stage lights down by a factor of a hundred
        for l in lights:
            l.set_intensity(float(l.intensity) / 100.0)
        yield 0.6
        for s in shoot("a_lights_down_100x"):
            yield s

        # ---- ... and right down, in case a hundred is not enough
        for l in lights:
            l.set_intensity(float(l.intensity) / 100.0)
        yield 0.6
        for s in shoot("a_lights_down_10000x"):
            yield s
        # restore
        for l, row in zip(lights, RESULT["lights"]):
            l.set_intensity(float(row[1]))
        yield 0.6

        # ---- B. the post chain: turn the capture's own post processing off entirely
        if cap is not None:
            cap.set_editor_property("post_process_blend_weight", 0.0)
            yield 0.6
            for s in shoot("b_no_post"):
                yield s
            cap.set_editor_property("post_process_blend_weight", 1.0)
            yield 0.4

            # ---- C. the capture source: HDR instead of the tonemapped LDR
            try:
                cap.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_SCENE_COLOR_HDR)
                yield 0.6
                for s in shoot("c_scene_color_hdr"):
                    yield s
            except Exception as exc:
                RESULT["c_error"] = str(exc)
            try:
                cap.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
            except Exception:
                pass
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "cause.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLCAUSE could not end play: %s" % exc)
