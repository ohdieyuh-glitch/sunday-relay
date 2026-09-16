# PIE probe: IS THE DOG'S VERIFICATION BEAM LIT? The third film showed a verifying Dog facing the Contract with no
# beam at all, while the act log said VERIFYING with the Contract present. This reads the beam component itself --
# visibility, where it is, how it is scaled -- with and without the terminal open, and photographs both.
import json
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")


def vec(v):
    return [round(v.x, 1), round(v.y, 1), round(v.z, 1)]


def job():
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
        ui = L.get_ui(world)
        mission = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()][0]
        L.focus_game_viewport()
        beams = [c for c in pawn.get_components_by_class(unreal.SceneComponent) if "Beam" in c.get_name()]
        RESULT["beam_components"] = [c.get_name() for c in beams]

        def read(tag):
            out = {"dog": str(mission.get_dog_performing_label()), "contract": bool(mission.is_orb_in_world()),
                   "beat": str(mission.get_beat_id())}
            for c in beams:
                out[c.get_name()] = {"visible": bool(c.is_visible()), "hidden_in_game": bool(c.hidden_in_game),
                                     "at": vec(c.get_world_location()), "scale": [round(x, 3) for x in (c.get_world_scale().x, c.get_world_scale().y, c.get_world_scale().z)]}
            RESULT[tag] = out
            unreal.log_warning("WLBEAMCHECK %s %s" % (tag, json.dumps(out)))

        mission.stop_fixture()
        mission.set_joined_in(False, False)
        mission.set_beat_by_id("verifying")
        for step in range(6):
            yield 0.5
            read("plain_%d" % step)
        # AIMED AT THE WORK: from beside and behind the Dog, across it toward the Contract, so the beam is in the frame.
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        look = unreal.MathLibrary.find_look_at_rotation(pawn.get_actor_location(), mission.get_orb_location())
        controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-10.0, yaw=look.yaw + 35.0))
        yield 1.0
        L.capture_game_viewport(os.path.join(SHOTS, "zc_beam_check_plain.png"))

        if not ui.is_live_terminal_open():
            ui.toggle_live_terminal()
        mission.set_beat_by_id("independent_reviewer")
        yield 1.5
        mission.set_beat_by_id("verifying")
        for step in range(4):
            yield 0.5
            read("terminal_%d" % step)
        L.capture_game_viewport(os.path.join(SHOTS, "zc_beam_check_terminal.png"))
        ui.close_overlay()
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLBEAMCHECK could not end play: %s" % exc)
