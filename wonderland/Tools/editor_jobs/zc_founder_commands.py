# PIE probe: THE FOUNDER'S PLAYTEST COMMANDS, TYPED EXACTLY AS WRITTEN IN THE HANDOFF.
#
# Runs the console lines themselves (not the subsystem calls behind them) -- `wl.Mission.Scenario D`, the same line again
# to restart, and `wl.Mission.Stop` -- and records what the founder would see after each: the stage strip, whether the
# Julius live terminal opened by itself, whether the mouse cursor is showing (a left-drag needs one), where the Dog was
# taken, and whether the mission camera took the Contract and handed back to the Dog.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "founder_commands")


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    steps = []
    RESULT["steps"] = steps
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 4.0
        world = ues.get_game_world()
        dog = unreal.GameplayStatics.get_player_pawn(world, 0)
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        mission = next(m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.get_world() == world)
        ui = L.get_ui(world)
        L.focus_game_viewport()

        def note(label):
            at = dog.get_actor_location()
            entry = {
                "step": label,
                "strip": str(mission.get_beat_label()),
                "running": bool(mission.is_fixture_running()),
                "terminal_open": bool(ui.is_live_terminal_open()),
                "cursor": bool(controller.get_editor_property("show_mouse_cursor")),
                "camera_weight": round(dog.get_mission_camera_weight(), 2),
                "dog_at": [round(at.x), round(at.y), round(at.z)],
            }
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, 1280, 85)
            entry["file"] = path
            steps.append(entry)

        note("before")
        unreal.SystemLibrary.execute_console_command(world, "wl.Mission.Scenario D")
        yield 25.0
        note("scenario_d_25s")
        unreal.SystemLibrary.execute_console_command(world, "wl.Mission.Scenario D")
        yield 3.0
        note("scenario_d_again_3s")
        unreal.SystemLibrary.execute_console_command(world, "wl.Mission.Stop")
        yield 4.0
        note("stop_4s")
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLFOUNDERCMD could not end play: %s" % exc)
