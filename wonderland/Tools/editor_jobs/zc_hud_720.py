# PIE job: the HUD at 1280x720 (founder, 2026-09-16) -- the wallet over the mini-map, the strip, the usage HUD, the
# mission strip and, with the terminal suite up, the companion consoles, all in a 1280x720 window.
#
# WHY A WINDOW AND NOT A SUM. With the engine's default DPI rule (shortest side, 1080 = 1.0) a 1280x720 window lays out
# in 1920x1080 Slate units -- narrower than the development viewport's 2216x1080 -- so the columns close in on each
# other. Arithmetic says they still clear; the founder asked for it proven in Unreal, so it is laid out for real and
# every rectangle is read back from Slate. The session is opened with its OWN copy of the play settings
# (UWonderlandHudTestLibrary.RequestPlayInNewWindow): nobody's saved settings change.
import os

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        unreal.log_warning("WLHUD720 %s %s %s" % (tid, "PASS" if ok else "FAIL", detail))
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def rects(ui):
        out = {}
        for line in str(ui.describe_hud_rects()).splitlines():
            parts = line.split()
            if len(parts) == 6:
                out[parts[0]] = (float(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]), parts[5] == "1")
        return out

    def overlaps(table):
        shown = [(n, r) for n, r in table.items() if n != "viewport" and r[4] and r[2] > 0 and r[3] > 0]
        hits = []
        for i in range(len(shown)):
            for j in range(i + 1, len(shown)):
                (na, a), (nb, b) = shown[i], shown[j]
                if a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]:
                    hits.append([na, nb])
        view = table.get("viewport")
        outside = [n for n, r in shown if view and (r[0] < -0.5 or r[1] < -0.5 or r[0] + r[2] > view[2] + 0.5 or r[1] + r[3] > view[3] + 0.5)]
        return [n for n, _ in shown], hits, outside

    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        requested = H.request_play_in_new_window(1280, 720)
        RESULT["requested"] = bool(requested)
        if not requested:
            record("R00", "a 1280x720 play window could be requested", False)
            RESULT["status"] = "done"
            return
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
        L.focus_game_viewport()
        yield 2.0

        play_shot = os.path.join(SHOTS, "zc_hud_720_play.png")
        ok = L.capture_game_viewport(play_shot)
        size = [ok[1], ok[2]] if isinstance(ok, tuple) and len(ok) >= 3 else None
        table = rects(ui)
        names, hits, outside = overlaps(table)
        view = table.get("viewport")
        RESULT["play"] = {"capture": play_shot, "capture_px": size, "viewport_units": list(view[:2 + 2]) if view else None,
                          "pieces": names, "overlaps": hits, "outside": outside, "rects": {n: list(r[:4]) for n, r in table.items()}}
        record("R01", "the play window really is 1280x720",
               size is not None and abs(size[0] - 1280) <= 2 and abs(size[1] - 720) <= 2, capture_px=size)
        record("R02", "at 1280x720 in play: wallet, mini-map, strip, usage HUD and mission strip all on screen and none touching",
               set(["wallet", "mini_map", "nav_bar", "usage_hud", "mission_strip"]).issubset(set(names)) and not hits and not outside,
               **{k: v for k, v in RESULT["play"].items() if k != "rects"})
        w, m = table.get("wallet"), table.get("mini_map")
        record("R03", "at 1280x720 the mini-map still sits under the wallet",
               bool(w and m and m[1] >= w[1] + w[3]), wallet=list(w[:4]) if w else None, mini_map=list(m[:4]) if m else None)

        ui.toggle_live_terminal()
        yield 1.2
        term_shot = os.path.join(SHOTS, "zc_hud_720_terminal.png")
        L.capture_game_viewport(term_shot)
        table = rects(ui)
        names, hits, outside = overlaps(table)
        RESULT["terminal"] = {"capture": term_shot, "pieces": names, "overlaps": hits, "outside": outside,
                              "rects": {n: list(r[:4]) for n, r in table.items()}}
        record("R04", "at 1280x720 with the terminal suite up: wallet and mini-map clear of the companion consoles",
               "wallet" in names and "mini_map" in names and "companion_right" in names and not hits and not outside,
               **{k: v for k, v in RESULT["terminal"].items() if k != "rects"})
        ui.close_overlay()
        yield 0.5
        RESULT["passed"] = sum(1 for t in tests if t["pass"])
        RESULT["failed"] = [t["id"] for t in tests if not t["pass"]]
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLHUD720 could not end play: %s" % exc)
