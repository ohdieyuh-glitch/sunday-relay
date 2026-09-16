# PIE probe: CAN THE EDITOR TAKE A FILM FRAME RIGHT NOW? The last film wrote no frames at all, silently. This asks for one
# frame at 1280 and one at 1600 wide, and a PNG of the game viewport, and reports each result.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield 5.0
        L.focus_game_viewport()
        yield 1.0
        RESULT["jpeg_1280"] = bool(H.capture_viewport_jpeg(os.path.join(SHOTS, "probe_1280.jpg"), 1280, 86))
        yield 0.5
        RESULT["jpeg_1600"] = bool(H.capture_viewport_jpeg(os.path.join(SHOTS, "probe_1600.jpg"), 1600, 86))
        yield 0.5
        RESULT["jpeg_native"] = bool(H.capture_viewport_jpeg(os.path.join(SHOTS, "probe_native.jpg"), 0, 86))
        yield 0.5
        ok = L.capture_game_viewport(os.path.join(SHOTS, "probe_png.png"))
        RESULT["png"] = str(ok)
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLCAPTUREPROBE could not end play: %s" % exc)
