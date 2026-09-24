# WHY IS THE SKIN PREVIEW PANEL BLANK WHITE? Measured, not reasoned about.
#
# FOUNDER: "the large WHITE preview area on the left is blank" and "when I click different mascot skins, nothing
# visibly changes."
#
# WHAT THE CODE ALREADY HAS, which is why this is a probe and not a rewrite: AWonderlandSkinStage exists, owns a
# SceneCaptureComponent2D and a UTextureRenderTarget2D, spawns a standing body, dresses it from the skin registry
# and has an idle look-around. The architecture the founder asked for is built. Something in it is not running.
#
# THE TELL THAT NARROWS IT. The panel draws "LIVE PREVIEW UNAVAILABLE" when the brush is null, and the founder is
# NOT seeing that text -- so the brush is bound and the render target itself is what is blank. That points at the
# capture rather than the wiring, and the capture is deliberately lazy: bCaptureEveryFrame is false and CaptureScene
# only runs while MarkWanted() has been called recently by whoever is painting. If that paint callback never fires,
# the target is never written and Slate draws an untouched texture.
#
# SO THIS COUNTS FRAMES. A frame count that does not move is the whole answer.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_preview_probe")


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
        if not ui:
            RESULT["status"] = "failed"
            RESULT["why"] = "no ui subsystem"
            return
        L.focus_game_viewport()

        # ---- open the wardrobe the way a founder does
        ui.toggle_project_brain()
        yield 1.5
        RESULT["brain_open"] = bool(ui.is_project_brain_open())
        ui.set_brain_skins_open(True)
        yield 2.0
        RESULT["skins_open"] = bool(ui.is_brain_skins_open())
        H.capture_viewport_jpeg(os.path.join(ROOT, "1_panel_open.jpg"), 1900, 95)

        # ---- is there a stage at all, and is it alive?
        stages = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage)
        RESULT["stage_count"] = len(stages)
        if not stages:
            RESULT["status"] = "done"
            RESULT["diagnosis"] = "no AWonderlandSkinStage exists: the panel was built before the stage"
            return
        stage = stages[0]
        at = stage.get_actor_location()
        RESULT["stage_at"] = [round(at.x), round(at.y), round(at.z)]
        RESULT["stage_last_error"] = str(stage.get_last_error())
        RESULT["stage_shown_skin"] = str(stage.get_shown_skin_id())
        rt = stage.get_render_target()
        RESULT["render_target"] = None if rt is None else {
            "name": str(rt.get_name()), "w": int(rt.size_x), "h": int(rt.size_y)}
        body = stage.get_body()
        RESULT["body_exists"] = body is not None
        if body is not None:
            RESULT["body_height_uu"] = round(float(body.get_figure_height_uu()), 1)
            RESULT["body_at"] = [round(v) for v in
                                 (body.get_actor_location().x, body.get_actor_location().y,
                                  body.get_actor_location().z)]

        # ---- THE DECIDING MEASUREMENT: does the frame counter move while the panel is open?
        first = int(stage.get_frame_count())
        RESULT["capturing_flag"] = bool(stage.is_capturing())
        yield 2.5
        second = int(stage.get_frame_count())
        yield 2.5
        third = int(stage.get_frame_count())
        RESULT["frames"] = [first, second, third]
        RESULT["frames_advancing"] = third > first
        RESULT["frames_per_sample"] = third - second

        # ---- and if it is NOT capturing, ask it directly and see whether it then can
        if not RESULT["frames_advancing"]:
            stage.mark_wanted()
            yield 1.5
            forced = int(stage.get_frame_count())
            stage.mark_wanted()
            yield 1.5
            forced2 = int(stage.get_frame_count())
            RESULT["forced_frames"] = [forced, forced2]
            RESULT["captures_when_asked"] = forced2 > third
            RESULT["diagnosis"] = ("the stage captures when asked but nothing is asking: the paint callback that "
                                   "calls MarkWanted() is not firing"
                                   if forced2 > third else
                                   "the stage does not capture even when asked: the capture itself is failing")
        else:
            RESULT["diagnosis"] = "the stage IS capturing; the blankness is in what it captures, not whether it runs"

        # ---- WHAT IS ACTUALLY IN THE PICTURE. Exported so it can be looked at rather than guessed at.
        if rt is not None:
            try:
                stage.mark_wanted()
                yield 1.0
                unreal.RenderingLibrary.export_render_target(world, rt, ROOT, "render_target.png")
                RESULT["render_target_exported"] = os.path.exists(os.path.join(ROOT, "render_target.png"))
            except Exception as exc:
                RESULT["render_target_export_error"] = str(exc)

        # ---- do the cards actually change the worn skin?
        registry_ids = ["relay_og", "arden_infernal", "apollo", "skeleton_flame",
                        "hagoromo", "celestial_light", "bee"]
        switched = []
        for skin in registry_ids:
            ok = bool(ui.wear_relay_skin(skin))
            yield 1.2
            stage.mark_wanted()
            yield 0.8
            switched.append({"skin": skin, "accepted": ok,
                             "stage_now": str(stage.get_shown_skin_id()),
                             "frames": int(stage.get_frame_count()),
                             "error": str(stage.get_last_error())})
            H.capture_viewport_jpeg(os.path.join(ROOT, "skin_%s.jpg" % skin), 1900, 94)
        RESULT["switching"] = switched
        RESULT["all_skins_accepted"] = all(s["accepted"] for s in switched)
        RESULT["stage_followed_every_skin"] = all(
            s["stage_now"].lower().endswith(s["skin"]) or s["skin"] in s["stage_now"].lower() for s in switched)

        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "probe.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items() if k != "steps"}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLSKINPROBE could not end play: %s" % exc)
