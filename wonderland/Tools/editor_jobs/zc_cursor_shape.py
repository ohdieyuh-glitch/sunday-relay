# IS WONDERLAND ACTUALLY DRAWING THE CURSOR THE SETTING CHOSE?
#
# FOUNDER, P1 item 8: "Add Wonderland cursor customization."
#
# Built, and evidenced only by photographs. A screenshot of a pointer cannot distinguish a cursor the
# setting chose from one that merely looks like it -- and there is a specific way this could be wrong that a
# photograph would never show: the shape is captured INTO the widget at Apply() time rather than bound live,
# so a setting that changed without a re-apply would read correctly in the settings and be stale on screen.
#
# So the viewport is asked two things at once: which shape the drawn widget was built from, and whether the
# viewport is drawing a Wonderland pointer AT ALL. The second matters most -- with software cursor widgets
# off, the machine's own arrow is showing whatever the settings say, and that is the failure a capture is
# least likely to reveal.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "cursor_shape")

SHAPES = ("arrow", "mark", "ring")


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
    yield 0.5

    def drawn():
        return (bool(H.is_drawing_wonderland_cursor(world)), str(H.get_drawn_cursor_shape()))

    shipped = drawn()
    RESULT["as_shipped"] = {"drawing_wonderland_cursor": shipped[0], "shape": shipped[1]}

    seen = {}
    for shape in SHAPES:
        unreal.SystemLibrary.execute_console_command(world, "wl.Cursor %s" % shape)
        yield 1.2
        got = drawn()
        seen[shape] = {"drawing": got[0], "shape": got[1]}
        H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % shape), 1500, 92)
    RESULT["by_shape"] = seen

    record("K00", "Wonderland is drawing its own pointer, not the machine's",
           all(v["drawing"] for v in seen.values()), by_shape=seen,
           note="software cursor widgets off means the system arrow is showing whatever the settings say")

    record("K01", "every shape the founder can choose is the shape actually drawn",
           all(v["shape"].lower() == k for k, v in seen.items()),
           asked=list(SHAPES), got={k: v["shape"] for k, v in seen.items()},
           note="read off the drawn widget, which is captured at Apply() time rather than bound live")

    # ---- AND THE SYSTEM POINTER IS STILL AVAILABLE, because handing the machine's own cursor back is a
    # choice the founder has and a state this must not have broken.
    unreal.SystemLibrary.execute_console_command(world, "wl.Cursor system")
    yield 1.2
    system = drawn()
    RESULT["system"] = {"drawing_wonderland_cursor": system[0], "shape": system[1]}
    record("K02", "choosing 'system' hands the machine's own pointer back",
           not system[0] and system[1].lower() == "system",
           state=RESULT["system"],
           note="drawn false here is CORRECT: it means Wonderland stopped drawing and the OS cursor returned")

    # ---- restore whatever shipped
    unreal.SystemLibrary.execute_console_command(world, "wl.Cursor %s" % shipped[1].lower())
    yield 1.0
    back = drawn()
    RESULT["restored"] = {"drawing_wonderland_cursor": back[0], "shape": back[1]}
    record("K03", "the project's own cursor comes back afterwards",
           back[1].lower() == shipped[1].lower(),
           shipped=shipped[1], restored=back[1],
           note="CursorShape is a saved Config property, so the fixture must not be left in it")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
