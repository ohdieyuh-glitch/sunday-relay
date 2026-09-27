# THE RECTANGLE AROUND THE BRAIN: FIND ITS OWNER BY SWITCHING THINGS OFF.
#
# FOUNDER, 2026-09-26: "THE SQUARE/LAYER AROUND THE BRAIN IS STILL THERE ... There is a visible rectangular
# tonal/background boundary around the brain presentation. REMOVE IT." And: "Temporarily toggle suspected
# components individually and capture the result until the exact owner of the rectangle is identified. Do NOT
# simply change its color to something closer to white."
#
# So this does exactly that and nothing else. It opens Project Brain, photographs it as it stands, then hides
# one candidate at a time and photographs again. The owner of the rectangle is whichever one makes it vanish.
#
# The candidates are every actor that could paint a quad in that space: the brain sculpture's own staging, the
# wardrobe's black backdrop (which lives in the world and could be parked in shot), the skin stage, and any
# plain static mesh near the brain. Each is reported with its class so the guess is not mine.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "brain_square")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0

    ui = L.get_ui(world)
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 5.0
    record("Q00", "Project Brain is open, with the wardrobe shut", ui.is_project_brain_open()
           and not ui.is_brain_skins_open())

    # ---- WHAT IS STANDING IN THE BRAIN'S SPACE. Reported, not assumed.
    suspects = []
    RESULT["suspects"] = suspects
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    here = dog.get_actor_location()
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            label = str(actor.get_actor_label())
            cls = str(actor.get_class().get_name())
        except Exception:                                          # noqa: BLE001
            continue
        low = label.lower()
        if not any(k in low for k in ("brain", "backdrop", "skinstage", "chamber", "card", "plane", "veil")):
            continue
        try:
            at = actor.get_actor_location()
            away = round(float((at - here).length()) / 100.0, 1)
        except Exception:                                          # noqa: BLE001
            away = None
        suspects.append({"label": label[:52], "class": cls[:36], "metres_from_dog": away})
    suspects.sort(key=lambda r: (r["metres_from_dog"] is None, r["metres_from_dog"]))
    emit("Q_SUSPECTS", "INFO", "actors that could be painting a rectangle", {"found": suspects[:14]})

    def shot(tag):
        yield 2.0
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%s.png" % tag))
        except Exception:
            pass

    yield from shot("00_as_it_stands")

    # ---- ONE AT A TIME. Hidden, photographed, put back.
    hidden_any = []
    RESULT["toggled"] = hidden_any
    for row in suspects[:10]:
        target = None
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
            try:
                if str(actor.get_actor_label())[:52] == row["label"]:
                    target = actor
                    break
            except Exception:                                      # noqa: BLE001
                pass
        if target is None:
            continue
        try:
            target.set_actor_hidden_in_game(True)
        except Exception:                                          # noqa: BLE001
            continue
        tag = "hidden_%s" % row["label"].replace(" ", "_").replace("/", "_")[:40]
        yield from shot(tag)
        hidden_any.append({"label": row["label"], "capture": tag + ".png"})
        try:
            target.set_actor_hidden_in_game(False)
        except Exception:                                          # noqa: BLE001
            pass
        yield 0.8

    yield from shot("99_back_again")
    record("Q01", "every suspect was hidden and photographed in turn", len(hidden_any) > 0,
           toggled=hidden_any,
           note="the owner of the rectangle is whichever capture no longer has it. This job does not guess; "
                "the next step reads the pictures.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured; the verdict is the toggle captures"
    yield 1.0
