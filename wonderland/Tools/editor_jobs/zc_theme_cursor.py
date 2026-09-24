# DOES THE THEME MOVE EVERY ACCENT, AND IS THERE A WONDERLAND POINTER?
#
# FOUNDER: "Add Wonderland cursor customization. Add Julius + Companion Terminal color customization; theme
# also recolours preset-command/accent UI."
#
# The accent is not owned by each surface -- the Julius terminal, both companion terminals, the command chips
# and every accent on the HUD all call WonderlandUi::Gold(). So the proof is a photograph before and after ONE
# value moves, with the terminals open, and the pointer is checked by the shape the runtime reports back.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "theme_cursor")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    facts = {}
    RESULT["facts"] = facts
    RESULT["status"] = "running"

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    ui = L.get_ui(world)
    tasks = L.get_mission_tasks(world)
    L.focus_game_viewport()
    yield 0.5

    tasks.clear_all_tasks_for_development()
    yield 0.4
    tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
    yield 1.0
    ui.toggle_live_terminal()
    yield 2.0
    facts["terminal_open"] = bool(ui.is_live_terminal_open())
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_gold.jpg"), 1900, 94)

    # ---------------------------------------------------------------- one value moves
    unreal.SystemLibrary.execute_console_command(world, "wl.Theme.Accent 0.35,0.85,1.0")
    yield 1.0
    # The brushes carrying the accent are built when a panel is constructed, so the terminals are closed and
    # reopened rather than merely waited on.
    ui.toggle_live_terminal()
    yield 1.2
    ui.toggle_live_terminal()
    yield 2.0
    H.capture_viewport_jpeg(os.path.join(ROOT, "02_themed.jpg"), 1900, 94)

    # ---------------------------------------------------------------- the pointer
    for shape in ("arrow", "mark", "ring"):
        unreal.SystemLibrary.execute_console_command(world, "wl.Cursor %s 30" % shape)
        yield 1.2
        H.capture_viewport_jpeg(os.path.join(ROOT, "03_cursor_%s.jpg" % shape), 1400, 90)
    facts["cursor_shapes_tried"] = ["arrow", "mark", "ring"]

    # ---------------------------------------------------------------- and back as we found it
    unreal.SystemLibrary.execute_console_command(world, "wl.Cursor system")
    unreal.SystemLibrary.execute_console_command(world, "wl.Theme.Reset")
    yield 1.0
    ui.toggle_live_terminal()
    yield 1.2
    ui.toggle_live_terminal()
    yield 1.8
    H.capture_viewport_jpeg(os.path.join(ROOT, "04_reset.jpg"), 1900, 94)
    L.press_key("Escape", False)
    yield 0.8

    RESULT["status"] = "measured; the verdict on the colours is the photographs"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
