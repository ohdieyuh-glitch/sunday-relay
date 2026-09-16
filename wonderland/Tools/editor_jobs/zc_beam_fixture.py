# PIE probe: THE BEAM UNDER THE RUNNING FIXTURE. Set by hand the verifying Dog's beam is lit; in the filmed fixture run
# it was off on every verifying frame. This runs the fixture twice at a quick pace -- once at normal speed, once with
# the film's per-tick slow motion -- and samples the beam and the mission state every tick through verification.
import json
import os
import time

L = unreal.WonderlandUiTestLibrary


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
        mission = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()][0]
        beam = [c for c in pawn.get_components_by_class(unreal.SceneComponent) if c.get_name().startswith("VerificationBeam")][0]
        L.focus_game_viewport()

        ui = L.get_ui(world)
        RUNS = globals().get("RUNS") or [["normal", False, "A", False], ["slowed", True, "A", False]]
        H = unreal.WonderlandHudTestLibrary
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        arm_was = float(boom.target_arm_length)
        for spec in RUNS:
            run, slow, letter, terminal = spec[:4]
            extra = spec[4] if len(spec) > 4 else ""
            boom.set_editor_property("target_arm_length", 440.0 if extra == "arm" else arm_was)
            mission.stop_fixture()
            mission.set_joined_in(False, False)
            mission.set_beat_by_id("idle")
            yield 1.0
            if terminal and not ui.is_live_terminal_open():
                ui.toggle_live_terminal()
            if not terminal and ui.is_live_terminal_open():
                ui.close_overlay()
            yield 0.5
            mission.run_scenario(letter, 1.2)
            samples = []
            last = time.time()
            for _ in range(3000):
                yield 0.0
                if slow:
                    now = time.time()
                    dt = max(now - last, 0.005)
                    last = now
                    unreal.SystemLibrary.execute_console_command(world, "slomo %.4f" % max(0.01, min(1.0, (1.0 / 15.0) / dt)))
                if extra == "slomo_const":
                    unreal.SystemLibrary.execute_console_command(world, "slomo 0.3")
                if extra == "slomo_capture":
                    H.capture_viewport_jpeg(os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "beamfx_last.jpg"), 1280, 80)
                if extra == "capture":
                    H.capture_viewport_jpeg(os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "beamfx_last.jpg"), 1280, 80)
                if extra == "rotate":
                    controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-12.0, yaw=pawn.get_actor_rotation().yaw))
                beat = str(mission.get_beat_id())
                if beat in ("verifying", "complete_verified", "independent_reviewer"):
                    samples.append([round(float(unreal.GameplayStatics.get_time_seconds(world)), 2), beat,
                                    str(mission.get_dog_performing_label()), bool(beam.is_visible()),
                                    round(beam.get_world_scale().y, 3), bool(mission.is_orb_in_world())])
                if not mission.is_fixture_running() and not mission.is_orb_in_world() and len(samples) > 5:
                    break
            unreal.SystemLibrary.execute_console_command(world, "slomo 1")
            boom.set_editor_property("target_arm_length", arm_was)
            RESULT[run] = samples
            RESULT[run + "_summary"] = {
                "verifying": sum(1 for s in samples if s[1] == "verifying"),
                "verifying_beam_on": sum(1 for s in samples if s[1] == "verifying" and s[3]),
            }
            unreal.log_warning("WLBEAMFIXTURE %s %s" % (run, json.dumps(RESULT[run + "_summary"])))
        RESULT["status"] = "done"
    finally:
        try:
            unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "slomo 1")
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLBEAMFIXTURE could not end play: %s" % exc)
