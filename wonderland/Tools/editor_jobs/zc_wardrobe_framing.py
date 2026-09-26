# WHAT ARITHMETIC IS THE WARDROBE FRAMING ACTUALLY DOING, PER SKIN?
#
# Three fixes to this framing have now been attempted from the captures alone -- the bounds branch, the fill
# ceiling, and the sideways drift -- and each moved the measured corner by under 0.02 while ARDEN INFERNAL went
# on filling the window and hanging off its left edge. The numbers that decide the frame live inside one
# function and not one of them has ever been read.
#
# THE SUSPICION THIS IS BUILT TO TEST. The fit distance is solved from the figure's bounds, and then
# overridden: "Distance = min(FitDistance, DogAway * 0.55)", with the apparent size supposedly restored by
# scaling the figure by Distance/FitDistance. That compensation is clamped to [0.05, 1.0]. If a skin's honest
# fit distance is more than about eighteen times the player camera's own boom, the clamp bottoms out, the
# figure can no longer be shrunk enough to match how close it has been brought, and it fills the window --
# which is exactly, and only, what the widest skin in the set does.
#
# So this reads the solve for every skin and says whether the clamp is binding. It asserts nothing about what
# the fix should be; it puts the six numbers on the table.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wardrobe_framing")
SKINS = ("relay_og", "arden_infernal", "apollo", "skeleton_flame", "celestial_light")


def parse(note):
    """'k=v k=v' into a dict, with tuples left as text."""
    out = {}
    for piece in str(note).split(" "):
        if "=" in piece:
            k, v = piece.split("=", 1)
            try:
                out[k] = float(v)
            except ValueError:
                out[k] = v
    return out


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
    if ui is None:
        record("F00", "the UI subsystem is reachable", False)
        RESULT["status"] = "FAIL"
        return

    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    ui.press_switch_skin()
    yield 4.0
    record("F00", "the wardrobe is open through the founder's own button",
           ui.is_brain_skins_open() and ui.is_project_brain_open())

    solves = {}
    RESULT["solve"] = solves
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        note = ui.describe_wardrobe_framing()
        solves[skin] = parse(note)
        RESULT.setdefault("raw", {})[skin] = str(note)
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%s.png" % skin))
        except Exception:
            pass
        emit("F_%s" % skin, "INFO", skin, solves[skin])

    got = [s for s in solves.values() if s.get("fit")]
    record("F01", "the framing solve reported for every skin", len(got) == len(SKINS),
           read=len(got), wanted=len(SKINS), raw=RESULT.get("raw"))
    if len(got) != len(SKINS):
        RESULT["status"] = "FAIL: the solve did not report"
        return

    # ---- IS THE SCALE CLAMP BINDING? scale = distance/fit, clamped to a floor of 0.05.
    clamped = {}
    for skin, v in solves.items():
        want = v["distance"] / max(v["fit"], 1.0)
        clamped[skin] = {"fit": v["fit"], "dogAway": v.get("dogAway"), "distance": v["distance"],
                         "scale_wanted": round(want, 4), "scale_applied": v["scale"],
                         "clamp_binding": bool(want < 0.0501)}
    RESULT["scale_clamp"] = clamped
    emit("F_CLAMP", "INFO", "is the preview scale clamp bottoming out", clamped)

    record("F02", "the preview scale clamp is not bottoming out on any skin",
           not any(v["clamp_binding"] for v in clamped.values()), per_skin=clamped,
           note="scale is meant to cancel the fact that the figure is brought much closer than its honest fit "
                "distance. Clamped at 0.05 it stops cancelling, and the figure is then drawn at whatever size "
                "being that close makes it -- which is a window full of skin.")

    # ---- WHICH BOUNDS BRANCH RAN, and how far apart the two axes' demands are.
    axes = {s: {"fitTall": v["fitTall"], "fitWide": v["fitWide"], "bounds": v.get("bounds"),
                "binding": "wide" if v["fitWide"] > v["fitTall"] else "tall",
                "height": v["height"], "wide": v["wide"], "drift": v.get("drift")}
            for s, v in solves.items()}
    RESULT["axes"] = axes
    emit("F_AXES", "INFO", "which axis binds, and on which bounds", axes)

    record("F03", "every skin was framed on what it actually draws",
           all(v.get("bounds") == "drawn" for v in solves.values()),
           bounds_branch={s: v.get("bounds") for s, v in solves.items()},
           note="the declared envelope adds a reach factor to every glow group and over-counts a flame by "
                "design; falling back to it silently is how a skin ends up framed too small")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
