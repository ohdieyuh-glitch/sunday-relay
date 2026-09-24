# EXPOSURE SWEEP, JUDGED ON THE ONLY INSTRUMENT THAT HAS NOT LIED: a viewport screenshot of the open panel.
#
# TWO READBACK PATHS WERE CAUGHT LYING ABOUT THIS TARGET. export_render_target returned a white PNG for a target
# cleared to pure red; read_render_target_pixel returned (255,255,255) for the same target. Both were calibrated
# against a known clear colour and both failed the calibration, so every conclusion drawn from them is void --
# including my own earlier claim that the render target contained white. That was never established.
#
# WHAT IS ESTABLISHED: the panel's preview box photographs white in the viewport, before AND after the exposure
# change. That is what the founder sees and it is a real measurement.
#
# AND THE BIAS RANGE IS WRONG IN THE OBVIOUS DIRECTION. UE's AutoExposureBias is exposure COMPENSATION: positive
# is brighter. The first ladder ran 5 to 15, every value of which pushes a scene brighter -- so if the picture is
# blown out, the entire sweep was in the wrong direction and finding no difference between 5 and 15 is exactly
# what a saturated image looks like. This one sweeps negative.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_ev_viewport")
LADDER = [-10.0, -7.0, -4.0, -1.0, 2.0]


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
            RESULT["why"] = "no skin stage even with the wardrobe open"
            return
        stage = stages[0]
        # A skin with strong dark and bright areas, so an over- and an under-exposed frame look different.
        ui.wear_relay_skin("arden_infernal")
        yield 1.5

        rows = []
        for ev in LADDER:
            stage.set_editor_property("preview_exposure_ev", float(ev))
            stage.apply_preview_exposure()
            yield 0.5
            for _ in range(6):
                stage.mark_wanted()
                yield 0.3
            name = "ev_%s.jpg" % str(ev).replace("-", "m").replace(".0", "")
            H.capture_viewport_jpeg(os.path.join(ROOT, name), 1900, 95)
            rows.append({"ev": ev, "file": name, "frames": int(stage.get_frame_count())})
        RESULT["ladder"] = rows

        # ---- AND THE ROOM ITSELF, photographed in the world with the panel shut. If the stage room is empty or
        # unlit, no exposure value can rescue it and the fault is the room rather than the camera.
        ui.close_overlay()
        yield 1.5
        body = stage.get_body()
        if body is not None:
            at = body.get_actor_location()
            RESULT["body_at"] = [round(at.x, 1), round(at.y, 1), round(at.z, 1)]
            RESULT["body_parts"] = len(body.get_components_by_class(unreal.InstancedStaticMeshComponent))
            L.pose_camera(world, unreal.Vector(at.x + 430.0, at.y - 70.0, at.z + 130.0),
                          unreal.Vector(at.x, at.y, at.z + 95.0), 40.0)
            yield 2.5
            H.capture_viewport_jpeg(os.path.join(ROOT, "room_close.jpg"), 1900, 95)
            L.pose_camera(world, unreal.Vector(at.x + 950.0, at.y - 450.0, at.z + 340.0),
                          unreal.Vector(at.x, at.y, at.z + 95.0), 62.0)
            yield 2.0
            H.capture_viewport_jpeg(os.path.join(ROOT, "room_wide.jpg"), 1900, 95)
        L.release_camera(world)
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "ev.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLEV could not end play: %s" % exc)
