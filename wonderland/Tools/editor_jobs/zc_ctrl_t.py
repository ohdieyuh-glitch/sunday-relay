# IS CTRL+T BROKEN, OR IS THE HARNESS?
#
# zc_eight_hour_demo recorded ctrl_t_opened_it=false while live_terminal_open=true -- the Julius Live Terminal
# opened, but not by the chord the founder actually uses. That is either a beta blocker on the primary Julius
# gesture or an artefact of how this harness injects a modifier, and the two look identical in the result.
#
# THE DIFFERENCE THAT MAKES IT TESTABLE. B is bound plainly (UiInput->BindKey(EKeys::B, ...)) and works through
# the harness. Ctrl+T is bound as an FInputChord on the Dog's PlayerInputComponent, and a chord only matches if
# the modifier is DOWN in the player input's own key state when T arrives. PressKey(T, bControl=true) sends a
# LeftControl Slate event and then T; SetKeyHeld holds the key down across calls. If the held version opens it
# and the chord version does not, the binding is fine and the injection is at fault -- which is a note in a
# proof, not a change to working product code.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "ctrl_t")


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 4.0
    L.focus_game_viewport()
    yield 0.5
    # The UI SUBSYSTEM instance, not the static test library: is_live_terminal_open and toggle_live_terminal
    # live on the subsystem, which is what L.get_ui hands back.
    ui = L.get_ui(ues.get_game_world())

    def shut():
        if ui.is_live_terminal_open():
            ui.toggle_live_terminal()
        return 0.8

    yield shut()
    RESULT["closed_to_start"] = not bool(ui.is_live_terminal_open())

    # ---- 1. THE CHORD, exactly as the demo sends it.
    L.press_key("T", True)
    yield 1.6
    by_chord = bool(ui.is_live_terminal_open())
    RESULT["opened_by_press_key_chord"] = by_chord
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_after_chord.jpg"), 1500, 88)
    yield shut()

    # ---- 2. THE MODIFIER HELD DOWN ACROSS THE PRESS, which is what a hand does.
    L.set_key_held("LeftControl", True)
    yield 0.3
    L.press_key("T", False)
    yield 0.3
    L.set_key_held("LeftControl", False)
    yield 1.6
    by_held = bool(ui.is_live_terminal_open())
    RESULT["opened_by_held_modifier"] = by_held
    H.capture_viewport_jpeg(os.path.join(ROOT, "02_after_held.jpg"), 1500, 88)
    yield shut()

    # ---- 3. AND PLAIN T, which must do NOTHING. The chord exists precisely so that a participant walking with
    # ---- a hand near T does not summon the terminal, so a plain T that opens it would be its own defect.
    L.press_key("T", False)
    yield 1.4
    by_plain = bool(ui.is_live_terminal_open())
    RESULT["opened_by_plain_t"] = by_plain
    yield shut()

    # ---- 4. The direct call, to prove the surface itself is fine either way.
    ui.toggle_live_terminal()
    yield 1.2
    RESULT["opened_by_direct_toggle"] = bool(ui.is_live_terminal_open())
    H.capture_viewport_jpeg(os.path.join(ROOT, "03_direct.jpg"), 1500, 88)
    yield shut()

    record("C01", "the terminal surface opens when asked directly, so the panel itself is sound",
           RESULT["opened_by_direct_toggle"])
    record("C02", "plain T does NOT open the terminal, so the chord is doing its job",
           not by_plain, opened=by_plain)
    record("C03", "Ctrl+T opens the Julius Live Terminal by at least one faithful injection",
           by_chord or by_held, by_press_key_chord=by_chord, by_held_modifier=by_held)

    RESULT["verdict"] = (
        "Ctrl+T works; PressKey's chord injection is the weaker path"
        if (by_held and not by_chord) else
        "Ctrl+T works through the harness" if by_chord else
        "NEITHER injection opened it -- the binding needs looking at, not the harness")
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
