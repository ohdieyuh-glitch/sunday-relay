# PIE probe: the founder's retry path. Does a command that can do nothing SAY so, and does wl.Julius.Playtest set the
# whole slice up from one line?
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "playtest_check")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
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

        def console(cmd):
            unreal.SystemLibrary.execute_console_command(world, cmd)

        def space(name):
            for part in str(ui.describe_wonder_web_workspace()).split(" "):
                if part.startswith(name + "="):
                    return part[len(name) + 1:]
            return None

        console("wl.Julius.Connect.Reset")
        yield 1.5
        # The founder's exact command, full stop and all, with nothing connected and no window open.
        console("wl.Julius.Connect.Revoke dev-figma.")
        yield 0.6
        H.capture_viewport_jpeg(os.path.join(ROOT, "01_revoke_says_why.jpg"), 1400, 92)
        # One line for the whole slice.
        console("wl.Julius.Playtest")
        yield (lambda: space("prompt") not in (None, "-"), 25)
        yield 1.0
        RESULT["after_playtest"] = str(ui.describe_wonder_web_workspace())
        H.capture_viewport_jpeg(os.path.join(ROOT, "02_playtest.jpg"), 1400, 92)
        RESULT["approve_clicked"] = bool(ui.simulate_wonder_web_window_click("connections", "approve"))
        yield (lambda: space("dev_figma") == "CONNECTED", 12)
        yield 1.2
        H.capture_viewport_jpeg(os.path.join(ROOT, "03_connected.jpg"), 1400, 92)
        RESULT["final"] = str(ui.describe_wonder_web_workspace())
        console("wl.Julius.Connect.Reset")
        yield 1.0
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLPLAYCHECK could not end play: %s" % exc)
