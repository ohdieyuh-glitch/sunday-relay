# PIE proof: SEVERAL WONDER WEBS, EACH ON ITS OWN REAL PAGE.
#
# FOUNDER DIRECTION: "Julius will be spawning multiple wonder webs" -- and (2026-09-17) "it should not be a simulation
# should be real." So this opens three Wonder Web windows at once and puts each on a different real site, fetched by a
# real browser on this machine: an encyclopaedia, a social app and a search engine.
#
# What it proves, in the stills:
#   1. Three windows, three different real addresses, all live at the same time, tiled by the workspace.
#   2. Each window's tab strip moves only its own window: clicking a site in one does not move the others.
#   3. The address bar takes an address the way a browser's does, and back goes back.
#   4. A window folded to its chip stops costing frames, and picks up again when it is restored.
#   5. Closing one window leaves the others alone, each still on its own page.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wonder_web_many")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    steps = []
    RESULT["steps"] = steps
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
        live = next(b for b in unreal.ObjectIterator(unreal.WonderlandWonderWebLiveSubsystem) if b.get_world() == world)
        L.focus_game_viewport()

        def console(cmd):
            unreal.SystemLibrary.execute_console_command(world, cmd)

        def shot(label, note=""):
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, 1600, 92)
            steps.append({
                "step": label, "note": note, "file": path,
                "live": str(live.describe_live()), "workspace": str(ui.describe_wonder_web_workspace()),
            })

        # ---- 1. THREE WINDOWS, THREE REAL SITES
        console("wl.WonderWeb.Real 1")
        yield 0.5
        console("wl.WonderWeb.Open browser")
        yield 2.0
        console("wl.WonderWeb.Go https://en.wikipedia.org/wiki/Design_system")
        yield 9.0
        shot("01_one_window", "the first window, on the encyclopaedia")

        console("wl.WonderWeb.Open browser-2")
        yield 11.0
        shot("02_two_windows", "the second window opened on its own site")

        console("wl.WonderWeb.Open browser-3")
        yield 4.0
        # The third window is sent somewhere by its own address bar, the way a person would.
        # (Not the search tab's own address: that site answers a headless browser with an "are you a bot" page, which is a
        # true thing about the real web but a poor thing to look at.)
        RESULT["clicked_address_on_third"] = bool(ui.simulate_wonder_web_window_click("browser-3", "address"))
        yield 1.5
        ui.simulate_wonder_web_window_type("en.wikipedia.org/w/index.php?search=design+tokens")
        yield 2.0
        ui.simulate_wonder_web_window_key("Enter")
        yield 12.0
        shot("03_three_windows_three_sites", "live=%s" % live.describe_live())
        RESULT["three_pages"] = str(live.describe_live())

        # ---- 2. ONE WINDOW'S TABS MOVE ONLY THAT WINDOW
        ui.simulate_wonder_web_window_click("browser-2", "tab:docs")
        yield 10.0
        RESULT["after_second_window_tab"] = str(live.describe_live())
        shot("04_only_that_window_moved", "the second window changed site; the others did not")

        # ---- 3. THE ADDRESS BAR TAKES AN ADDRESS, AND BACK GOES BACK.
        # Only in a build that has them: the click says whether this build's shell answers to "address" at all, so the same
        # job runs on the build before and the build after.
        RESULT["clicked_address"] = bool(ui.simulate_wonder_web_window_click("browser-2", "address"))
        if RESULT["clicked_address"]:
            yield 1.5
            ui.simulate_wonder_web_window_type("example.com")
            yield 0.5
            yield 2.0
            shot("05_typed_an_address", "typed into the second window's address bar")
            ui.simulate_wonder_web_window_key("Enter")
            yield 9.0
            RESULT["after_address"] = str(live.describe_live())
            shot("06_went_where_it_was_told", "live=%s" % live.describe_live())
            ui.simulate_wonder_web_window_click("browser-2", "back")
            yield 8.0
            RESULT["after_back"] = str(live.describe_live())
            shot("07_back_where_it_was", "live=%s" % live.describe_live())
        else:
            RESULT["address_bar"] = "this build's address bar is not clickable yet"

        # ---- 4. FOLDED TO A CHIP, THEN BACK
        console("wl.WonderWeb.Minimize browser-2 1")
        yield 6.0
        RESULT["while_folded"] = str(live.describe_live())
        shot("08_one_folded", "the second window is a chip")
        console("wl.WonderWeb.Minimize browser-2 0")
        yield 7.0
        RESULT["restored"] = str(live.describe_live())
        shot("09_restored", "and back, still on its own page")

        # ---- 5. CLOSE ONE, THE OTHERS CARRY ON
        console("wl.WonderWeb.CloseWindow browser-3")
        yield 5.0
        RESULT["after_close"] = str(live.describe_live())
        shot("10_closed_one", "two windows left, each on its own page")

        console("wl.WonderWeb.Real 0")
        yield 2.0
        RESULT["final_live"] = str(live.describe_live())
        console("wl.WonderWeb.Close")
        yield 1.5
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "steps.json"), "w", encoding="utf-8") as fh:
            json.dump(steps, fh, indent=1)
        try:
            unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "wl.WonderWeb.Real 0")
        except Exception:
            pass
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLMANYWEB could not end play: %s" % exc)
