# PIE probe: THE SIMULATION RUN WITH WONDER WEB IN IT (founder direction, 2026-09-17).
#
# "I want the animation run to show that Julius is not just using internal Wonderland tools -- it can also work through
# Wonder Web and interact with real web-style pages inside Wonderland."
#
# So: the mission runs (Scenario D, the accepted sequence, untouched), and while it runs Julius works in Wonder Web --
# the creation in one window, the browser with five tabs in another. Julius is given the task that posts the canvas
# picture to the studio account; it cannot touch the site until the governed browser connection is authorized, so the
# Connections window comes forward and asks. The founder presses CONNECT, and then Julius opens the profile, types the
# caption and publishes it, on a page that looks like the ordinary web.
#
# Every tab is photographed, so "3-5 tabs, and the inside looks like the real internet" can be judged from the stills.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wonder_web_simulation")


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
        dog = unreal.GameplayStatics.get_player_pawn(world, 0)
        mission = next(m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.get_world() == world)
        browse = next(b for b in unreal.ObjectIterator(unreal.WonderlandWonderWebBrowseSubsystem) if b.get_world() == world)
        L.focus_game_viewport()

        def console(cmd):
            unreal.SystemLibrary.execute_console_command(world, cmd)

        def fields(text):
            out = {}
            for part in text.split(" "):
                if "=" in part:
                    key, value = part.split("=", 1)
                    out[key] = value
            return out

        def space(name):
            return fields(str(ui.describe_wonder_web_workspace())).get(name)

        def web(name):
            return fields(str(browse.describe_browse())).get(name)

        def shot(label, note=""):
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, 1600, 92)
            steps.append({
                "step": label, "note": note, "file": path,
                "mission": str(mission.get_beat_label()), "running": bool(mission.is_fixture_running()),
                "browse": str(browse.describe_browse()), "workspace": str(ui.describe_wonder_web_workspace()),
            })

        def click(window, control):
            ok = bool(ui.simulate_wonder_web_window_click(window, control))
            steps.append({"click": "%s/%s" % (window, control), "reached": ok, "browse": str(browse.describe_browse())})
            return ok

        RESULT["pages_loaded"] = web("loaded")
        RESULT["tab_count"] = web("tabs")
        console("wl.Julius.Connect.Reset")
        yield 1.2

        # ---- the mission, as it already runs
        console("wl.Mission.Scenario D")
        yield 14.0
        shot("01_mission_running", "the accepted mission sequence, untouched")

        # ---- Julius's surfaces: the creation, and the browser with its tabs
        console("wl.Julius.Playtest.Web")
        yield 2.5
        shot("02_creation_and_browser", "two Wonder Web windows: the creation and Julius's browser")

        # ---- the governed browser is not connected yet, so the site cannot be touched
        yield (lambda: space("prompt") not in (None, "-"), 25)
        yield 1.2
        shot("03_browser_needs_authorizing", "prompt=%s dev_social=%s" % (space("prompt"), space("dev_social")))
        ui.expand_wonder_web_window("connections")
        yield 1.0
        shot("04_what_julius_asks_for", "the governed browser, and the capabilities it asks for")
        ui.expand_wonder_web_window("connections")
        yield 1.0

        # ---- the founder authorizes it
        click("connections", "approve")
        # The request is satisfied once the connection is authorized: the prompt goes, and the task stops being blocked.
        yield (lambda: space("prompt") == "-", 15)
        yield (lambda: space("task") == "EXECUTING", 15)
        yield 1.0
        shot("05_connected", "task=%s step=%s" % (space("task"), space("step")))

        # ---- Julius works the page: opens the profile, types the caption, publishes
        yield (lambda: web("typing") == "1" or web("posted") == "1", 25)
        yield 0.8
        ui.expand_wonder_web_window("browser")
        yield 1.0
        shot("06_julius_typing_the_caption", "caption_len=%s julius=%s" % (web("caption_len"), web("julius")))
        yield (lambda: web("posted") == "1", 25)
        yield 1.2
        shot("07_julius_posted", "posted=%s" % web("posted"))

        # ---- every tab, so the pages can be judged
        for tab, label in (("search", "08_tab_search"), ("mail", "09_tab_mail"), ("docs", "10_tab_docs"), ("store", "11_tab_store"), ("social", "12_tab_social")):
            click("browser", "tab:%s" % tab)
            yield 1.0
            shot(label, "url=%s" % web("url"))
        ui.expand_wonder_web_window("browser")
        yield 1.0
        shot("13_workspace_with_mission", "the mission still running behind the windows")

        # A later mission beat, with the windows still up: Julius's own work and the mission at the same time.
        yield 12.0
        shot("13b_mission_beat_later", "the mission moved on while Wonder Web stayed up")
        RESULT["mission_still_running"] = bool(mission.is_fixture_running())
        RESULT["final_browse"] = str(browse.describe_browse())
        RESULT["final_workspace"] = str(ui.describe_wonder_web_workspace())
        console("wl.WonderWeb.Close")
        yield 1.4
        shot("14_back_to_the_mission", "Wonder Web closed; the mission is still on")
        console("wl.Mission.Stop")
        yield 1.0
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "steps.json"), "w", encoding="utf-8") as fh:
            json.dump(steps, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLWEBSIM could not end play: %s" % exc)
