# PIE probe: WONDER WEB LOADING THE REAL PAGE (founder direction, 2026-09-17: "soon it should not be a simulation should
# be real").
#
# Real mode on, inside the same Wonderland shell: a Wikipedia article, a search page, the founder's own example
# (instagram.com, whose public page is what an unauthenticated browser sees), and a plain page. Then a host that is NOT
# on the allowlist, to show it is refused and nothing is fetched, and finally back to the sample pages -- where the label
# says SIMULATED again.
#
# Nothing is signed into: no account, no credential, no typing into anyone's site.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wonder_web_real")


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
        L.focus_game_viewport()

        def console(cmd):
            unreal.SystemLibrary.execute_console_command(world, cmd)

        def web(name):
            for part in str(browse.describe_browse()).split(" "):
                if part.startswith(name + "="):
                    return part[len(name) + 1:]
            return None

        def shot(label, note="", wide=1600):
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, wide, 92)
            steps.append({"step": label, "note": note, "file": path, "browse": str(browse.describe_browse())})

        # ---- the sample pages first, so the two labels can be compared
        console("wl.WonderWeb.Open browser")
        yield 2.0
        ui.expand_wonder_web_window("browser")
        yield 1.2
        shot("01_simulated_label", "real=%s label=%s" % (web("real"), web("label")))

        # ---- real mode on
        console("wl.WonderWeb.Real 1")
        yield 0.5
        console("wl.WonderWeb.Go https://en.wikipedia.org/wiki/Design_system")
        yield 6.0
        shot("02_real_wikipedia", "real_url=%s label=%s" % (web("real_url"), web("label")))
        console("wl.WonderWeb.Go https://html.duckduckgo.com/html/?q=pixel+canvas+palette+tokens")
        yield 6.0
        shot("03_real_search", "real_url=%s" % web("real_url"))
        # The founder's example: the public page of the real site, not an account.
        console("wl.WonderWeb.Go https://www.instagram.com/")
        yield 8.0
        shot("04_real_instagram", "real_url=%s" % web("real_url"))
        console("wl.WonderWeb.Go https://example.com/")
        yield 5.0
        shot("05_real_example", "real_url=%s" % web("real_url"))

        # ---- a host that is not allowed: refused, and nothing is fetched
        before = web("real_url")
        console("wl.WonderWeb.Go https://news.ycombinator.com/")
        yield 2.0
        RESULT["refused_kept_page"] = (web("real_url") == before)
        shot("06_host_refused", "still on %s" % web("real_url"))

        # ---- tab switching in real mode loads each tab's own real page; the mailbox has none and says so
        for tab, label in (("docs", "07_tab_docs_real"), ("social", "08_tab_social_real"), ("mail", "09_tab_mail_no_real")):
            ui.simulate_wonder_web_window_click("browser", "tab:%s" % tab)
            yield 6.0
            shot(label, "real_url=%s label=%s" % (web("real_url"), web("label")))

        # ---- back to the sample pages
        console("wl.WonderWeb.Real 0")
        yield 2.0
        shot("10_simulated_again", "real=%s label=%s" % (web("real"), web("label")))
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
            unreal.log_warning("WLREALWEB could not end play: %s" % exc)
