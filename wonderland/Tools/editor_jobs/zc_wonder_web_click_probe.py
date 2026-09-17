# PIE probe: where the Wonder Web workspace believes its controls are, against where they are drawn.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wonder_web_click_probe")


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
        unreal.SystemLibrary.execute_console_command(world, "wl.WonderWeb.Open creation")
        yield 2.0
        H.capture_viewport_jpeg(os.path.join(ROOT, "open.jpg"), 1600, 92)
        points = {}
        for control in ("open-sample", "close", "minimize", "maximize", "menu", "tab:0", "tab:1", "back", "terminal", "clear"):
            v = ui.get_wonder_web_window_control_on_screen("creation", control)
            points[control] = [round(v.x, 1), round(v.y, 1)]
        RESULT["points"] = points
        RESULT["hud"] = str(ui.describe_hud_rects())
        RESULT["web"] = str(ui.describe_wonder_web())
        RESULT["workspace"] = str(ui.describe_wonder_web_workspace())
        # The same click, twice, a second apart: does either reach the button?
        RESULT["click1"] = bool(ui.simulate_wonder_web_window_click("creation", "open-sample"))
        yield 1.0
        RESULT["frame_after_1"] = str(ui.describe_wonder_web())
        RESULT["click_tab1"] = bool(ui.simulate_wonder_web_window_click("creation", "tab:1"))
        yield 1.0
        RESULT["frame_after_tab"] = str(ui.describe_wonder_web())
        H.capture_viewport_jpeg(os.path.join(ROOT, "after.jpg"), 1600, 92)
        # Hypothesis: the retainer keeps the window's widgets out of the hit test. Without retained rendering, again.
        unreal.SystemLibrary.execute_console_command(world, "Slate.EnableRetainedRendering 0")
        unreal.SystemLibrary.execute_console_command(world, "wl.WonderWeb.Close")
        yield 1.2
        unreal.SystemLibrary.execute_console_command(world, "wl.WonderWeb.Open creation")
        yield 2.0
        RESULT["click_no_retainer"] = bool(ui.simulate_wonder_web_window_click("creation", "open-sample"))
        yield 1.0
        RESULT["frame_no_retainer"] = str(ui.describe_wonder_web())
        unreal.SystemLibrary.execute_console_command(world, "Slate.EnableRetainedRendering 1")
        unreal.SystemLibrary.execute_console_command(world, "wl.WonderWeb.Close")
        yield 1.0
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLCLICKPROBE could not end play: %s" % exc)
