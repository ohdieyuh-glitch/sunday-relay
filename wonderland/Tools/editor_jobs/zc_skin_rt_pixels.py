# WHAT IS ACTUALLY IN THE PREVIEW TARGET? Read pixel by pixel, because the export path lies.
#
# A CORRECTION TO MY OWN EVIDENCE. I exported this render target and concluded from a white PNG that the capture
# was producing white. Then I cleared the target to PURE RED and exported it again -- and the PNG was still white.
# So export_render_target is not telling the truth about this target's contents, and every conclusion I drew from
# it is void, including the exposure diagnosis I rebuilt the editor for.
#
# read_render_target_pixel goes through a different path and returns numbers rather than an image, so it can be
# checked against a known value: the target is cleared to a colour this job chooses, read back, and only believed
# if it reads back as that colour.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_rt_pixels")
GRID = [(0.5, 0.12), (0.5, 0.3), (0.5, 0.5), (0.5, 0.7), (0.5, 0.9),
        (0.2, 0.5), (0.8, 0.5), (0.08, 0.08), (0.92, 0.92)]


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

        # THE STAGE DOES NOT EXIST UNTIL THE WARDROBE IS OPENED. It is spawned lazily the first time the Project
        # Brain panel is built, so looking for it first finds nothing -- which is what the previous run of this job
        # reported, and it was my ordering rather than a missing stage.
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
        rt = stage.get_render_target()
        w, h = int(rt.size_x), int(rt.size_y)

        def sample(tag):
            out = []
            for fx, fy in GRID:
                x, y = int(fx * (w - 1)), int(fy * (h - 1))
                try:
                    c = unreal.RenderingLibrary.read_render_target_pixel(world, rt, x, y)
                    out.append([x, y, int(c.r), int(c.g), int(c.b)])
                except Exception as exc:
                    out.append([x, y, "err", str(exc)[:40], ""])
            RESULT[tag] = out
            return out

        # ---- CALIBRATE THE INSTRUMENT FIRST. Clear to a colour nothing else could produce and read it back.
        unreal.RenderingLibrary.clear_render_target2d(world, rt, unreal.LinearColor(1.0, 0.0, 0.0, 1.0))
        yield 1.0
        red = sample("read_after_clear_red")
        RESULT["pixel_read_is_trustworthy"] = any(
            isinstance(p[2], int) and p[2] > 150 and p[3] < 90 and p[4] < 90 for p in red)

        # ---- now the real question
        before = int(stage.get_frame_count())
        for _ in range(8):
            stage.mark_wanted()
            yield 0.3
        RESULT["frames_delta"] = int(stage.get_frame_count()) - before
        sample("read_after_capture")

        # ---- AND LOOK AT THE ROOM ITSELF, with the overlay shut so the camera is not photographing the panel.
        # The previous attempt posed the camera with Project Brain still open and produced a picture of the UI.
        ui.close_overlay()
        yield 1.5
        body = stage.get_body()
        if body is not None:
            at = body.get_actor_location()
            RESULT["body_at"] = [round(at.x, 1), round(at.y, 1), round(at.z, 1)]
            L.pose_camera(world, unreal.Vector(at.x + 430.0, at.y - 70.0, at.z + 130.0),
                          unreal.Vector(at.x, at.y, at.z + 95.0), 40.0)
            yield 2.5
            H.capture_viewport_jpeg(os.path.join(ROOT, "stage_room.jpg"), 1900, 95)
            # wider, to see whether the backdrop and plinth are there at all
            L.pose_camera(world, unreal.Vector(at.x + 900.0, at.y - 420.0, at.z + 320.0),
                          unreal.Vector(at.x, at.y, at.z + 95.0), 60.0)
            yield 2.0
            H.capture_viewport_jpeg(os.path.join(ROOT, "stage_room_wide.jpg"), 1900, 95)
        L.release_camera(world)
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "pixels.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLRTPX could not end play: %s" % exc)
