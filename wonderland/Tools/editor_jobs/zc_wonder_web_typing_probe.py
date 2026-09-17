# PIE probe: does typing reach a Wonder Web window's text box, now that windows are ordinary Slate widgets?
import os

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
        ui = L.get_ui(world)
        L.focus_game_viewport()
        unreal.SystemLibrary.execute_console_command(world, "wl.WonderWeb.Open creation")
        yield 2.0
        RESULT["click_terminal"] = bool(ui.simulate_wonder_web_window_click("creation", "terminal"))
        yield 0.3
        ui.simulate_wonder_web_typing("help", False)
        yield 0.3
        RESULT["after_chars"] = str(ui.describe_wonder_web())
        ui.simulate_wonder_web_typing("", True)
        yield 0.5
        RESULT["after_enter"] = str(ui.describe_wonder_web())
        unreal.SystemLibrary.execute_console_command(world, "wl.WonderWeb.Close")
        yield 1.0
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLTYPEPROBE could not end play: %s" % exc)
