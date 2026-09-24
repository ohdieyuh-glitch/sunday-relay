# WHAT DO THE TERMINALS ACTUALLY LOOK LIKE, AND DOES TYPING INTO ONE DO ANYTHING?
#
# FOUNDER: "THE JULIUS LIVE TERMINAL DOES NOT EVEN HAVE THE + BUTTON AT THE TOP. THE AI COMPANION TERMINALS
# APPEAR TO HAVE REVERTED TO HOW THEY LOOKED YESTERDAY."
#
# The + is added to the tab strip unconditionally in RebuildTaskTabs, and the strip is built during Construct,
# so structurally it is always there -- which means either it is drawn and too faint to find, or something
# above it is covering it. Neither can be settled by reading the code, so this PHOTOGRAPHS the terminal and
# counts what the runtime says is on screen.
#
# And it types into a companion terminal, because "the terminals look wrong" and "the terminals do nothing" are
# different complaints and the founder has made both.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "terminals")


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

    # ---------------------------------------------------------------- the terminal, with a contract in it
    tasks.clear_all_tasks_for_development()
    yield 0.4
    tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
    yield 1.0

    # CTRL+T CANNOT BE TESTED FROM HERE, and a False below is NOT a defect.
    #
    # It is bound with legacy PlayerInputComponent->BindKey(FInputChord(T, ctrl)), and legacy BindKey bindings
    # do not receive Slate's synthetic key events. Proven by the parallel case rather than assumed: SpaceBar is
    # bound the same way, zc_skin_parity's synthetic press produced an airborne peak of 0.0, and calling Jump()
    # directly rose the Dog 89.6 uu. Movement reaches the pawn because it is an axis, which is a different path.
    # So this records the reading and says what it means; the chord has to be confirmed by a hand on a keyboard.
    L.press_key("T", True)
    yield 2.0
    facts["ctrl_t_opened_it"] = bool(ui.is_live_terminal_open())
    facts["ctrl_t_note"] = ("legacy BindKey chords do not receive synthetic keys; False here is a harness limit, "
                            "not a defect -- SpaceBar/Jump behaves identically")
    if not ui.is_live_terminal_open():
        ui.toggle_live_terminal()
        yield 1.6
    facts["live_terminal_open"] = bool(ui.is_live_terminal_open())
    facts["terminal_rows"] = int(ui.get_terminal_row_count())
    facts["contracts"] = len(tasks.get_task_list())
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_julius_terminal.jpg"), 1900, 94)

    # THE + IS PRESSED THROUGH THE SAME PATH THE BUTTON USES. If this makes a tab, the control works and the
    # complaint is that it cannot be SEEN; if it does not, the control itself is broken.
    before = len(tasks.get_task_list())
    ui.press_add_task()
    yield 1.4
    after = len(tasks.get_task_list())
    facts["tabs_before_plus"] = before
    facts["tabs_after_plus"] = after
    facts["plus_made_a_tab"] = after > before
    H.capture_viewport_jpeg(os.path.join(ROOT, "02_after_plus.jpg"), 1900, 94)

    # ---------------------------------------------------------------- the companion terminals
    facts["companion_0_title"] = str(ui.get_companion_terminal_title(0))
    facts["companion_1_title"] = str(ui.get_companion_terminal_title(1))
    facts["companion_0_lines_before"] = int(ui.get_companion_terminal_line_count(0))
    H.capture_viewport_jpeg(os.path.join(ROOT, "03_companions.jpg"), 1900, 94)

    # TYPE INTO ONE, through the real focus and the real keyboard, and see whether the panel answers at all.
    focused = bool(ui.focus_companion_terminal(0))
    yield 0.6
    L.type_text("What is Wonderland?")
    yield 0.8
    facts["companion_0_focused"] = focused
    facts["companion_0_input_text"] = str(ui.get_companion_terminal_input_text(0))
    H.capture_viewport_jpeg(os.path.join(ROOT, "04_companion_typed.jpg"), 1900, 94)

    L.press_key("Enter", False)
    yield 2.5
    facts["companion_0_lines_after"] = int(ui.get_companion_terminal_line_count(0))
    facts["companion_0_answered"] = facts["companion_0_lines_after"] > facts["companion_0_lines_before"]
    H.capture_viewport_jpeg(os.path.join(ROOT, "05_companion_sent.jpg"), 1900, 94)

    L.press_key("Escape", False)
    yield 1.0
    RESULT["status"] = "measured; the verdict on how it LOOKS is the photographs"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
