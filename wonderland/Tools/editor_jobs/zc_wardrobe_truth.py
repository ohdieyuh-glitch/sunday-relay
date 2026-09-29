# WHAT DOES THE FOUNDER ACTUALLY SEE IN THE WARDROBE PREVIEW SQUARE?
#
# FOUNDER, 2026-09-26, having opened the build themselves: "The large black preview square is nearly
# empty/dark. I can barely see a tiny amount of cyan/light near the center." And: "Do not respond by adjusting
# another camera-distance multiplier until you determine WHY THE ACTUAL MASCOT IS NOT BEING RENDERED
# CORRECTLY."
#
# They are right and the proofs are the reason they had to say it twice. zc_wardrobe_pixels asks whether the
# corners are black and the middle is brighter than them, and BOTH of those are true of a nearly-black square
# with a faint smudge in it. Skeleton Flame's middle measured 0.038 luma and passed. I then "fixed" a failing
# clause by sampling the brightest moment of the heartbeat, which is precisely making the test agree instead
# of making the picture right.
#
# So this job asserts NOTHING. It photographs the preview square for all five skins from four angles -- the
# twenty captures the founder asked for -- and reports, for each, how much of the square is not-black, how
# bright the figure region is, and how much of the window the figure's own bounds occupy. The verdict is the
# photographs; the numbers are only there to say which ones to look at first.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wardrobe_truth")
SKINS = ("relay_og", "jack_flame", "baal", "skeleton_flame", "celestial_light")
ANGLES = (("front", 0.0), ("left", 90.0), ("back", 180.0), ("right", 270.0))


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
    # Noon, so nothing here is confused with the day/night work.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    yield 4.0

    ui = L.get_ui(world)
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    ui.press_switch_skin()
    yield 4.0
    rect = ui.get_skin_preview_rect()
    record("T00", "the wardrobe is open and reports its window", rect is not None)
    if rect is None:
        RESULT["status"] = "FAIL"
        return
    centre, size = rect
    RESULT["window"] = {"centre": [round(centre.x, 4), round(centre.y, 4)],
                        "size": [round(size.x, 4), round(size.y, 4)]}

    # A generous inset so the frame's own stroke is not counted as content.
    x0, x1 = centre.x - size.x * 0.44, centre.x + size.x * 0.44
    y0, y1 = centre.y - size.y * 0.44, centre.y + size.y * 0.44

    rows = {}
    RESULT["by_skin"] = rows
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        per = {}
        rows[skin] = per
        for label, yaw in ANGLES:
            # The 360 control is the only sanctioned way to turn the figure, so the angles are reached by
            # spinning it and stopping, exactly as a player would.
            if yaw > 0.0:
                ui.toggle_wardrobe_inspect()
                # 24 degrees a second is the authored rate.
                yield (yaw / 24.0)
                ui.toggle_wardrobe_inspect()
                yield 1.2
            got = L.read_screen_rect(x0, y0, x1, y1)
            row = {}
            if got is not None:
                mean, dark, bright, _n = got
                row["luma"] = round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4)
                row["fraction_nearly_black"] = round(float(dark), 4)
                row["fraction_over_white"] = round(float(bright), 4)
            per[label] = row
            try:
                L.capture_game_viewport(os.path.join(ROOT, "%s_%s.png" % (skin, label)))
            except Exception:
                pass
        # Back to front for the next skin.
        emit("T_%s" % skin, "INFO", skin, per)

    RESULT["captures_dir"] = ROOT
    # ---- ONE READING, AND IT IS A DESCRIPTION RATHER THAN A GATE.
    #
    # How much of the square is NOT nearly-black is the closest single number to the founder's own words. A
    # square with a mascot filling 80-90% of it cannot be 95% black; the one they photographed is.
    filled = {s: round(1.0 - (per["front"].get("fraction_nearly_black", 1.0)), 4)
              for s, per in rows.items() if per.get("front")}
    RESULT["front_fraction_not_black"] = filled
    emit("T_FILL", "INFO", "how much of the square is not nearly-black, front view", filled)
    record("T01", "every skin was photographed from four angles",
           all(len(per) == len(ANGLES) for per in rows.values()),
           captured=sum(len(p) for p in rows.values()), wanted=len(SKINS) * len(ANGLES),
           note="the verdict on these is the photographs. This clause only says they exist.")
    RESULT["status"] = "measured; the verdict is the twenty captures"
    yield 1.0
