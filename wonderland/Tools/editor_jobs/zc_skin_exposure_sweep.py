# WHAT EXPOSURE MAKES THE WARDROBE MIRROR READABLE? Filmed, across the skins that stress it hardest.
#
# The preview was pure white because SCS_FinalColorLDR ran auto-exposure in a room a thousand metres up with almost
# nothing in it. Exposure is now manual and pinned; this finds the value.
#
# AND IT IS SWEPT AGAINST RELAY OG AND SKELETON FLAME TOGETHER, on purpose. The founder's rule is that the lighting
# has to work across white, black, gold, infernal and luminous skins at once -- "Do not use a pure white environment
# that causes white skins to disappear." A value tuned on one skin is a value that hides another.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_exposure_sweep")
LADDER = [5.0, 7.0, 9.0, 11.0, 13.0, 15.0]
PROBE_SKINS = ["relay_og", "skeleton_flame"]


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
        rows = []
        for ev in LADDER:
            stage.set_editor_property("preview_exposure_ev", float(ev))
            stage.apply_preview_exposure()
            for skin in PROBE_SKINS:
                ui.wear_relay_skin(skin)
                yield 1.0
                # a few frames so the capture is of the settled pose, not the frame the skin changed on
                for _ in range(4):
                    stage.mark_wanted()
                    yield 0.25
                name = "ev%02d_%s.png" % (int(ev), skin)
                try:
                    unreal.RenderingLibrary.export_render_target(world, stage.get_render_target(), ROOT, name)
                    rows.append({"ev": ev, "skin": skin, "file": name,
                                 "frames": int(stage.get_frame_count())})
                except Exception as exc:
                    rows.append({"ev": ev, "skin": skin, "error": str(exc)})
        RESULT["ladder"] = rows

        # ---- AND IS IT ALIVE? The founder wants head and arms moving while the Dog stays in one place.
        body = stage.get_body()
        if body is not None:
            def pose():
                out = []
                for c in body.get_components_by_class(unreal.SceneComponent):
                    t = c.get_relative_transform()
                    out.append((str(c.get_name()),
                                round(t.rotation.euler().x, 3), round(t.rotation.euler().y, 3),
                                round(t.rotation.euler().z, 3),
                                round(t.translation.z, 3)))
                return out

            a = pose()
            RESULT["body_at_before"] = [round(v, 2) for v in
                                        (body.get_actor_location().x, body.get_actor_location().y,
                                         body.get_actor_location().z)]
            yield 3.0
            b = pose()
            RESULT["body_at_after"] = [round(v, 2) for v in
                                       (body.get_actor_location().x, body.get_actor_location().y,
                                        body.get_actor_location().z)]
            moved = [x[0] for x, y in zip(a, b) if x != y]
            RESULT["parts_total"] = len(a)
            RESULT["parts_moved"] = len(moved)
            RESULT["parts_moved_names"] = moved[:24]
            # STAYS IN ONE PLACE is a founder requirement in its own right, not a side effect.
            RESULT["stayed_in_place"] = RESULT["body_at_before"] == RESULT["body_at_after"]
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "sweep.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLSKINEV could not end play: %s" % exc)
