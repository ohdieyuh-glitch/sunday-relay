# PIE job: why the mini-map disc draws white. The raw photograph drawn as a plain square image (wl.MiniMap.DebugRaw)
# is a correct, detailed top-down picture of the garden -- so the capture works and the DISC's draw path does not.
# This takes one frame per draw mode (wl.MiniMap.DrawMode 0-5), each changing one thing, so the frames and
# Tools/minimap_pixels.py can say which path renders the render target and which renders white.
import os

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary
MODES = {0: "rounded_ignorealpha_drawtint", 1: "square_image", 2: "rounded_alpha_brushtint",
         3: "rounded_ignorealpha_brushtint", 4: "fan_proxy_uv", 5: "no_photo"}


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
        unreal.SystemLibrary.execute_console_command(world, "wl.MiniMap.DebugRaw 1")
        yield 1.5
        shots["raw_reference"] = os.path.join(SHOTS, "zc_minimap_look_raw.png")
        L.capture_game_viewport(shots["raw_reference"])
        unreal.SystemLibrary.execute_console_command(world, "wl.MiniMap.DebugRaw 0")
        for mode, name in sorted(MODES.items()):
            unreal.SystemLibrary.execute_console_command(world, "wl.MiniMap.DrawMode %d" % mode)
            yield 1.5
            path = os.path.join(SHOTS, "zc_minimap_mode%d_%s.png" % (mode, name))
            L.capture_game_viewport(path)
            shots["mode%d_%s" % (mode, name)] = path
        unreal.SystemLibrary.execute_console_command(world, "wl.MiniMap.DrawMode 0")
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
