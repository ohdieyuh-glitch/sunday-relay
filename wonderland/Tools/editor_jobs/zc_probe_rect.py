# WHAT DO THE TWO NEW BINDINGS ACTUALLY RETURN? Asked rather than assumed.
CONCURRENT = True

import unreal

L = unreal.WonderlandUiTestLibrary


def job():
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = ues.get_game_world() or ues.get_editor_world()
    ui = L.get_ui(world) if world is not None else None
    RESULT["ui"] = ui is not None
    RESULT["help_rect"] = str(getattr(type(ui), "get_skin_preview_rect", None).__doc__)[:600] if ui is not None else None
    RESULT["help_read"] = str(L.read_screen_rect.__doc__)[:600]
    try:
        got = ui.get_skin_preview_rect() if ui is not None else None
        RESULT["rect_returned"] = [str(x) for x in got] if isinstance(got, tuple) else str(got)
    except Exception as err:                                           # noqa: BLE001
        RESULT["rect_error"] = str(err)[:300]
    try:
        out = L.read_screen_rect(0.4, 0.4, 0.6, 0.6)
        RESULT["read_returned"] = [str(x) for x in out] if isinstance(out, tuple) else str(out)
    except Exception as err:                                           # noqa: BLE001
        RESULT["read_error"] = str(err)[:300]
    RESULT["status"] = "measured"
    yield 0.2
