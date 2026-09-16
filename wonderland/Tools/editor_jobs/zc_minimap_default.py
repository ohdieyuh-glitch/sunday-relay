# PIE job: THE MINI-MAP AS THE BUILD DRAWS IT. No draw-mode override, no debug view -- one frame of the HUD at the
# default settings, with the disc's rectangle, so the white-disc fix is judged on what a player would see.
import json
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 6.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
        L.focus_game_viewport()
        yield 2.0
        RESULT["draw_mode"] = unreal.SystemLibrary.get_console_variable_int_value("wl.MiniMap.DrawMode")
        RESULT["rects"] = str(ui.describe_hud_rects())
        RESULT["drew_photograph"] = bool(ui.did_mini_map_draw_photograph())
        RESULT["capture_count"] = int(ui.get_mini_map_capture_count())
        path = os.path.join(SHOTS, "zc_minimap_default.png")
        ok = L.capture_game_viewport(path)
        RESULT["shot"] = path if ok else None
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLMINIMAPDEFAULT could not end play: %s" % exc)
