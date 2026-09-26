# HOW MUCH FIRE SHOULD A FIGURE KEEP IN THE WARDROBE WINDOW?
#
# THE BUG, PHOTOGRAPHED: with the wardrobe open on ARDEN INFERNAL the preview square is a single orange mass
# with no dog in it, and the brightest CORNER of the window reads 0.98 -- brighter than the middle, because
# the fire has filled the frame and spilled past the figure. Celestial Light is the same at 0.74.
#
# WHY 0.10 STOPPED WORKING. It was measured against photographs and was right then. Two things moved under it:
# the founder asked for a close-up preview, so the figure went from filling part of the square to filling 88%
# of it, and the flames were restored on the legacy path at wl.Look.FireGain 2.3. Neither change was wrong;
# the stale literal beside them was.
#
# SO IT IS SWEPT, THROUGH THE BUTTON THE FOUNDER PRESSES, and judged on the same two readings the wardrobe
# proof judges: the CORNERS of the window must be the black backdrop, and the MIDDLE must be brighter than
# them, which together say "a figure is standing on a dark stage" rather than "the window is full of light".
# Every rung is also captured, because a number that says the corners are dark cannot say the dog is a dog.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "preview_glow")
SKINS = ("arden_infernal", "celestial_light", "skeleton_flame", "relay_og")
VALUES = (0.10, 0.045, 0.022, 0.010)


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
        record("P00", "the UI subsystem is reachable", False)
        RESULT["status"] = "FAIL"
        return

    # ---- MIDDAY, so the day cycle's night correction is not also in play. One variable at a time.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    yield 4.0

    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    pressed = ui.press_switch_skin()
    yield 4.0
    record("P00", "the wardrobe opened from the founder's own button",
           bool(pressed) and ui.is_brain_skins_open() and ui.is_project_brain_open(),
           pressed=bool(pressed), skins_open=ui.is_brain_skins_open(), brain=ui.is_project_brain_open())

    rect = ui.get_skin_preview_rect()
    if rect is None:
        record("P01", "the preview window reports where it is", False)
        RESULT["status"] = "FAIL: no preview rect"
        return
    centre, size = rect
    record("P01", "the preview window reports where it is", True,
           centre=[round(centre.x, 4), round(centre.y, 4)], size=[round(size.x, 4), round(size.y, 4)])

    inset = 0.12
    min_x = centre.x - size.x * (0.5 - inset)
    max_x = centre.x + size.x * (0.5 - inset)
    min_y = centre.y - size.y * (0.5 - inset)
    max_y = centre.y + size.y * (0.5 - inset)

    def patch(cx, cy, hw, hh):
        got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if got is None:
            return None
        mean, dark, bright, sampled = got
        return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
                "bright": round(bright, 4)}

    def look():
        """The four corners of the window and its middle, as the wardrobe proof reads them."""
        hw = size.x * 0.07
        hh = size.y * 0.07
        corners = {
            "tl": patch(min_x + hw, min_y + hh, hw, hh),
            "tr": patch(max_x - hw, min_y + hh, hw, hh),
            "bl": patch(min_x + hw, max_y - hh, hw, hh),
            "br": patch(max_x - hw, max_y - hh, hw, hh)}
        middle = patch(centre.x, centre.y, size.x * 0.16, size.y * 0.22)
        if middle is None or any(c is None for c in corners.values()):
            return None
        worst = max(c["luma"] for c in corners.values())
        return {"brightest_corner": round(worst, 4),
                "middle": middle["luma"],
                "middle_over_corner": round(middle["luma"] - worst, 4),
                "middle_blown": middle["bright"]}

    rows = {}
    RESULT["by_skin"] = rows
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        per = {}
        rows[skin] = per
        for keep in VALUES:
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewGlow %.4f" % keep)
            # The stage re-applies it on tick while the wardrobe is open, so a moment is enough.
            yield 2.0
            got = look()
            per["%.3f" % keep] = got
            try:
                L.capture_game_viewport(os.path.join(ROOT, "%s_%.3f.png" % (skin, keep)))
            except Exception:
                pass
        emit("P_%s" % skin, "INFO", skin, per)

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewGlow 0.100")

    read = [v for per in rows.values() for v in per.values() if v is not None]
    record("P02", "every rung was read for every skin", len(read) == len(SKINS) * len(VALUES),
           read=len(read), wanted=len(SKINS) * len(VALUES))
    if len(read) != len(SKINS) * len(VALUES):
        RESULT["status"] = "FAIL: the sweep was not measured"
        return

    # ---- WHICH RUNGS SATISFY THE WARDROBE PROOF'S OWN TWO CONDITIONS, for EVERY skin at once.
    good = []
    for keep in VALUES:
        key = "%.3f" % keep
        corners_dark = all(rows[s][key]["brightest_corner"] < 0.25 for s in rows)
        figure_reads = all(rows[s][key]["middle_over_corner"] > 0.03 for s in rows)
        if corners_dark and figure_reads:
            good.append(keep)
    RESULT["rungs_passing_both"] = good
    RESULT["table"] = {s: {k: {"corner": v["brightest_corner"], "middle": v["middle"],
                               "over": v["middle_over_corner"]}
                           for k, v in per.items()} for s, per in rows.items()}
    emit("P_TABLE", "INFO", "corner / middle by skin and setting", RESULT["table"])

    record("P03", "there is one preview glow that works for every skin",
           len(good) > 0, passing=good, table=RESULT["table"],
           corner_ceiling=0.25, middle_floor=0.03,
           note="the wardrobe proof's W11 and W12 conditions, applied to every skin at once: the corners of "
                "the window must be the black backdrop, and the middle must out-read them")
    if good:
        # The BRIGHTEST rung that works, so the fire is kept as far as it can be.
        RESULT["recommended"] = max(good)
        emit("P_BEST", "INFO", "the brightest setting that still works everywhere",
             {"preview_glow": max(good)})

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
