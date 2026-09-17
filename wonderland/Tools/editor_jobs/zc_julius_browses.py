# PIE proof: JULIUS BROWSES THE REAL WEB, THROUGH THE GATE.
#
# FOUNDER DIRECTION: "that's Julius's connection to search the Internet and execute with computer use"; and (2026-09-17)
# "it should not be a simulation should be real."
#
# What this shows, in order:
#   1. Julius is given a task that needs the open web. It cannot browse: the Connections window comes forward with the
#      request, showing web.read and web.search asked for -- and web.sign_in and web.purchase plainly NOT asked for.
#   2. The founder says CONNECT. Julius opens a real page in its own browser tab, reads it, and uses the site's own search
#      box. Wonder Web watches that tab, so what is on screen is the page Julius is actually on -- and the badge says so.
#   3. The founder revokes the connection mid-task. The very next step is refused and the run blocks, on screen.
#
# Nothing is signed into and nothing is bought. Every page Julius opens is on the runtime's allowlist.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "julius_browses")


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
                "live": str(live.describe_live()), "workspace": str(ui.describe_wonder_web_workspace()),
            })

        # The service must be up, or there is nothing to prove.
        RESULT["connect_at_start"] = str(ui.describe_wonder_web_workspace())

        # ---- the browser window, in real mode, watching whatever Julius does
        console("wl.WonderWeb.Open browser")
        yield 2.0
        ui.expand_wonder_web_window("browser")
        yield 1.5
        console("wl.WonderWeb.Real 1")
        yield 1.0
        shot("01_window_ready", "real mode on, nothing loaded yet")

        # ---- 1. JULIUS IS ASKED TO BROWSE, AND CANNOT YET
        console("wl.Julius.Task web-lookup")
        yield 6.0
        shot("02_asks_to_connect", "the request, with what is NOT asked for")

        # ---- 2. THE FOUNDER SAYS CONNECT, and Julius browses for real
        console("wl.Julius.Connect.Approve")
        yield 4.0
        shot("03_connected", "connect=%s" % ui.describe_wonder_web_workspace())
        # The Connections window came forward with the request; the browsing itself is the thing to watch, so bring the
        # browser window back in front for it.
        ui.expand_wonder_web_window("browser")
        yield 4.0
        yield 6.0
        shot("04_julius_opened_the_page", "live=%s" % live.describe_live())
        RESULT["julius_frames"] = int(field(live.describe_live(), "frames") or 0)
        RESULT["julius_following"] = field(live.describe_live(), "following")
        RESULT["julius_url"] = field(live.describe_live(), "live_url")
        yield 5.0
        shot("05_julius_read_and_searched", "live=%s" % live.describe_live())

        # ---- 3. REVOKED MID-TASK: the next step is refused and the run blocks.
        # Four real steps take about twenty seconds, so this lands while Julius is still working.
        console("wl.Julius.Connect.Revoke open-web")
        yield 8.0
        RESULT["after_revoke"] = str(ui.describe_wonder_web_workspace())
        shot("07_revoked_mid_task", "connect=%s" % ui.describe_wonder_web_workspace())

        console("wl.WonderWeb.Real 0")
        yield 2.0
        RESULT["final_live"] = str(live.describe_live())
        RESULT["final_connect"] = str(ui.describe_wonder_web_workspace())
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
            unreal.log_warning("WLJULIUSWEB could not end play: %s" % exc)
