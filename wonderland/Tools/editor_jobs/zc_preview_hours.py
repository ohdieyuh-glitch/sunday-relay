# DOES THE WARDROBE PREVIEW LOOK THE SAME AT EVERY HOUR?
#
# It should. The founder asked for the selected Relay Dog centred on black with no Wonderland scenery, and a
# showcase that is bright at noon and murky at midnight is showing the weather rather than the skin. The stage
# carries its own key, fill and rim lights for exactly this reason.
#
# ASKED BECAUSE A CAPTURE LOOKED WRONG. zc_wardrobe_pixels does not pin the hour, and the Relay OG preview it
# photographed was a dark grey dog on black with no visible status eyes -- much darker than the same skin in a
# run that had pinned noon. Either the stage lights are not reaching the figure, or the preview is inheriting
# the world's exposure, and the two have different fixes.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "preview_hours")
HOURS = (12.0, 19.0, 0.0)
SKINS = ("relay_og", "arden_infernal")


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
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")

    ui = L.get_ui(world)
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    ui.press_switch_skin()
    yield 4.0
    rect = ui.get_skin_preview_rect()
    if rect is None:
        record("H00", "the preview window reports where it is", False)
        RESULT["status"] = "FAIL"
        return
    centre, size = rect
    record("H00", "the preview window reports where it is", True)

    def middle():
        got = L.read_screen_rect(centre.x - size.x * 0.16, centre.y - size.y * 0.22,
                                 centre.x + size.x * 0.16, centre.y + size.y * 0.22)
        if got is None:
            return None
        m = got[0]
        return round(0.2126 * m.r + 0.7152 * m.g + 0.0722 * m.b, 4)

    rows = {}
    RESULT["preview_luma_by_hour"] = rows
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        per = {}
        rows[skin] = per
        for hour in HOURS:
            unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
            yield 5.0
            per["%04.1f" % hour] = middle()
            try:
                L.capture_game_viewport(os.path.join(ROOT, "%s_h%04.1f.png" % (skin, hour)))
            except Exception:
                pass
        emit("H_%s" % skin, "INFO", skin, per)

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")

    ok = True
    spread = {}
    for skin, per in rows.items():
        vals = [v for v in per.values() if v is not None]
        if len(vals) < len(HOURS):
            ok = False
            continue
        spread[skin] = round(max(vals) / max(min(vals), 1e-4), 2)
    RESULT["brightest_over_dimmest"] = spread
    record("H01", "every hour was read for every skin", ok and len(spread) == len(SKINS),
           luma=rows)
    record("H02", "the preview looks the same whatever the world's clock is doing",
           all(v <= 1.6 for v in spread.values()), brightest_over_dimmest=spread, ceiling=1.6,
           luma_by_hour=rows,
           note="the stage carries its own key, fill and rim lights so the wardrobe is a showcase and not a "
                "window. A preview that is much darker at midnight is inheriting the world instead.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 1.0
