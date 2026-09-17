# PIE proof: WONDER WEB LIVE — THE REAL INTERNET INSIDE WONDERLAND.
#
# FOUNDER DIRECTION (2026-09-17): "make sure when it comes to the wonder web soon it should not be a simulation should be
# real."
#
# Nothing here is drawn from a projection. A real browser renders each page on this machine inside the Julius Connect
# runtime; Wonderland draws its frames, and every click, scroll and keystroke in this job is a real Slate event, hit
# tested in the window and forwarded to that browser. The proof is the stills: a real encyclopaedia article, scrolled;
# a real search, typed into the site's own box and submitted; and the founder's own example -- Instagram -- showing what
# a real browser with no account actually sees, which is Instagram's own sign-in page.
#
# A host that is not on the allowlist is refused, and the still shows the page did not change.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wonder_web_live")


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
        browse = next(b for b in unreal.ObjectIterator(unreal.WonderlandWonderWebBrowseSubsystem) if b.get_world() == world)
        live = next(b for b in unreal.ObjectIterator(unreal.WonderlandWonderWebLiveSubsystem) if b.get_world() == world)
        L.focus_game_viewport()

        def console(cmd):
            unreal.SystemLibrary.execute_console_command(world, cmd)

        def field(describe, name):
            for part in str(describe).split(" "):
                if part.startswith(name + "="):
                    return part[len(name) + 1:]
            return None

        def shot(label, note=""):
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, 1600, 92)
            steps.append({
                "step": label, "note": note, "file": path,
                "live": str(live.describe_live()), "browse": str(browse.describe_browse()),
            })

        # ---- the window, and real mode on
        console("wl.WonderWeb.Open browser")
        yield 2.0
        ui.expand_wonder_web_window("browser")
        yield 1.5
        console("wl.WonderWeb.Real 1")
        yield 0.5

        # ---- 1. A REAL ENCYCLOPAEDIA ARTICLE, fetched by a real browser
        console("wl.WonderWeb.Go https://en.wikipedia.org/wiki/Design_system")
        yield 12.0
        RESULT["frames_after_first_page"] = int(field(live.describe_live(), "frames") or 0)
        shot("01_real_article", "live=%s" % live.describe_live())

        # ---- 2. TYPED INTO THE SITE'S OWN SEARCH BOX, and submitted
        # The click is a real Slate click at a point of the page; focus then follows it, as it does in any browser. It
        # comes before any scrolling, because a page scrolled down no longer has its search box where it was.
        RESULT["clicked_search"] = bool(ui.simulate_wonder_web_window_click("browser", "page:466,35"))
        yield 1.5
        shot("02_clicked_search_box", "clicked=%s" % RESULT["clicked_search"])
        ui.simulate_wonder_web_window_type("wonderland")
        yield 3.0
        shot("03_typed_into_the_site", "typed into the page's own field")
        ui.simulate_wonder_web_window_key("Enter")
        yield 12.0
        shot("04_the_site_answered", "live=%s" % live.describe_live())

        # ---- 3. SCROLLED WITH A REAL WHEEL EVENT, routed through the window to the page
        for _ in range(3):
            ui.simulate_wonder_web_window_scroll("browser", "at:760,560", -3.0)
            yield 1.2
        yield 2.0
        shot("05_scrolled", "three real wheel events at the page")

        # ---- 4. A HOST THAT IS NOT ALLOWED: refused, and nothing is fetched
        before = field(live.describe_live(), "live_url")
        console("wl.WonderWeb.Go https://news.ycombinator.com/")
        yield 3.0
        RESULT["refused_kept_page"] = (field(live.describe_live(), "live_url") == before)
        shot("06_host_refused", "still on %s" % field(live.describe_live(), "live_url"))

        # ---- 5. THE FOUNDER'S OWN EXAMPLE: the real Instagram, as a browser with no account sees it
        console("wl.WonderWeb.Go https://www.instagram.com/")
        yield 14.0
        shot("07_real_instagram", "live=%s" % live.describe_live())

        # ---- 6. REAL MODE OFF: the sample pages again, and the label says so
        console("wl.WonderWeb.Real 0")
        yield 2.5
        shot("08_simulated_again", "label=%s" % field(browse.describe_browse(), "label"))
        RESULT["final_live"] = str(live.describe_live())
        RESULT["final_browse"] = str(browse.describe_browse())
        console("wl.WonderWeb.Close")
        yield 1.2
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
            unreal.log_warning("WLLIVEWEB could not end play: %s" % exc)
