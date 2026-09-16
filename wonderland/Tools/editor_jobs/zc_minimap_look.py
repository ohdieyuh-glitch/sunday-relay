# PIE job: one look at the mini-map after the white-disc fix -- a frame per photograph source, and the HUD rects so
# the disc can be located in the frame and judged by Tools/minimap_pixels.py rather than by "drawn".
import os

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
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
        shots = {}
        for source, name in ((0, "base"), (1, "lit")):
            unreal.SystemLibrary.execute_console_command(world, "wl.MiniMap.Source %d" % source)
            yield 2.5
            path = os.path.join(SHOTS, "zc_minimap_look_%s.png" % name)
            L.capture_game_viewport(path)
            shots[name] = path
        unreal.SystemLibrary.execute_console_command(world, "wl.MiniMap.Source 0")
        RESULT["shots"] = shots
        RESULT["rects"] = str(ui.describe_hud_rects())
        RESULT["region"] = str(ui.get_mini_map_region_line())
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLMINIMAPLOOK could not end play: %s" % exc)
