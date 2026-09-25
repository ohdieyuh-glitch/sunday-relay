# DOES CHANGING THE TERMINAL COLOUR ACTUALLY RECOLOUR THE TERMINALS?
#
# FOUNDER, P1 item 9: "Add Julius + Companion Terminal color customization; theme also recolours
# preset-command/accent UI. Claude Code and ChatGPT use the same clean Claude-Code-terminal sequence."
#
# THIS WAS BUILT AND ITS ONLY EVIDENCE WAS PHOTOGRAPHS, which is the one thing a colour claim cannot rest
# on: a screenshot of a gold terminal looks identical whether the theme drove that gold or whether the theme
# was set and silently ignored. The founder's own rule -- no fake passes on visual systems -- is exactly
# about this shape of claim.
#
# SO THE TERMINAL IS ASKED WHAT IT IS WEARING. GetCompanionTerminalAccent returns the value FollowTheme last
# wrote into the frame and rule brushes, not the value the settings hold. Then the theme is moved to a
# colour nothing in Wonderland ships, and the terminals must move with it.
#
# AND IT IS PUT BACK. The accent is a Config property; a proof that left its fixture in it would have
# recoloured the founder's terminals rather than tested them.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "theme_accent")

#: A colour Wonderland ships nowhere: a saturated green. Gold cannot be mistaken for it, and it cannot be
#: arrived at by accident from any default.
PROBE = (0.10, 0.85, 0.35)


def near(a, b, tol=0.02):
    return abs(a - b) <= tol


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    yield 0.5

    # The terminals only exist while the Live Terminal is open.
    ui.toggle_live_terminal()
    yield 2.0
    count = int(ui.get_companion_terminal_count())
    titles = [str(ui.get_companion_terminal_title(i)) for i in range(count)]

    def accents():
        out = []
        for i in range(count):
            c = ui.get_companion_terminal_accent(i)
            out.append((round(float(c.r), 3), round(float(c.g), 3), round(float(c.b), 3)))
        return out

    shipped = accents()
    RESULT["terminals"] = titles
    RESULT["accent_as_shipped"] = shipped
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_as_shipped.jpg"), 1600, 92)

    record("A00", "both companion terminals are up and report an accent",
           count >= 2 and len(shipped) == count and all(sum(c) > 0.01 for c in shipped),
           terminals=count, titles=titles, accents=shipped,
           note="read from the brush the terminal last painted, not from the settings")

    # ---------------------------------------------------------------- move the theme
    # ONE ARGUMENT, COMMA-SEPARATED. The command joins its args with no separator
    # (FString::Join(Args, TEXT(""))), so "0.1 0.85 0.35" would arrive as "0.10.850.35" and fail to parse.
    unreal.SystemLibrary.execute_console_command(
        world, "wl.Theme.Accent %.3f,%.3f,%.3f" % PROBE)
    # FollowTheme runs twice a second by design, so this needs more than a frame.
    yield 2.0
    moved = accents()
    RESULT["accent_when_themed"] = moved
    H.capture_viewport_jpeg(os.path.join(ROOT, "02_themed.jpg"), 1600, 92)

    # JUDGED ON MOVEMENT, NOT ON MATCHING MY LITERALS. Whether the command reads "0.1,0.85,0.35" as linear
    # floats or as something else is the command's business; what P1 item 9 claims is that setting the theme
    # RECOLOURS the terminals. So the test is that every terminal moved a long way from the gold it shipped
    # with -- which a theme that was set and ignored could not do.
    def apart(a, b):
        return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))

    shifts = [round(apart(m, s0), 3) for m, s0 in zip(moved, shipped)]
    record("A01", "setting the theme recolours every companion terminal",
           len(moved) == count and all(v > 0.2 for v in shifts),
           asked_for=[round(v, 3) for v in PROBE], got=moved, was=shipped, moved_by=shifts,
           note="judged on the accent MOVING from the shipped gold, so the check does not depend on how the "
                "console command parses its argument")

    record("A02", "both terminals take the SAME accent, as one theme rather than two",
           len(set(moved)) == 1 if moved else False, accents=moved,
           note="the founder's words: Claude Code and ChatGPT use the same clean sequence")

    # ---------------------------------------------------------------- and put it back
    unreal.SystemLibrary.execute_console_command(world, "wl.Theme.Reset")
    yield 2.0
    restored = accents()
    RESULT["accent_restored"] = restored
    H.capture_viewport_jpeg(os.path.join(ROOT, "03_restored.jpg"), 1600, 92)

    record("A03", "the project's own gold comes back afterwards",
           restored == shipped, shipped=shipped, restored=restored,
           note="the accent is a Config property; a job that left its fixture in it would have recoloured "
                "the founder's terminals rather than tested them")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
