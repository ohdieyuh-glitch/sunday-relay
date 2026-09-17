# PIE probe: THE FOUNDER'S JULIUS CONNECT + MULTI-WONDER-WEB SLICE (founder direction, 2026-09-17).
#
#  1 enter Wonderland            2 open Wonder Web A (running sample creation)   3 open Wonder Web B beside it, both visible
#  4 give Julius a task that needs the DEVELOPMENT design-tool connector      5 Julius finds the capability missing
#  6 B shows EXTERNAL CAPABILITY REQUIRED   7 the requested capabilities       8 CONNECT
#  9 the deterministic authorization runs  10 CONNECTED                       11 Julius resumes
# 12 an audit entry                       13 REVOKE                           14 Julius loses the capability at once
# 15 A keeps running throughout
#
# Everything B shows is read from the Julius Connect service (npm run julius-connect:dev); every button is a real Slate
# press and release at the place that control stands in the world. Every step is photographed and its workspace line
# recorded: the stills are what get looked at.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "julius_connect_proof")


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
    a_running = []
    RESULT["a_running"] = a_running
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
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

        def web(name):
            return fields(str(ui.describe_wonder_web())).get(name)

        def space(name):
            return fields(str(ui.describe_wonder_web_workspace())).get(name)

        def note_a():
            a_running.append([len(steps), web("frame"), web("running")])

        def shot(label, note=""):
            note_a()
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, 1600, 90)
            steps.append({"step": label, "note": note, "workspace": str(ui.describe_wonder_web_workspace()), "a": str(ui.describe_wonder_web()), "file": path})

        def click(window, control):
            ok = bool(ui.simulate_wonder_web_window_click(window, control))
            steps.append({"click": "%s/%s" % (window, control), "reached": ok, "workspace": str(ui.describe_wonder_web_workspace())})
            return ok

        # A clean development slate: no connection, no request, no task.
        console("wl.Julius.Connect.Reset")
        yield 1.5
        RESULT["link"] = space("link")
        shot("01_world", "Wonderland, before anything is open")

        # ---- 2: Wonder Web A, the sample creation, running
        console("wl.WonderWeb.Open creation")
        yield 1.6
        click("creation", "open-sample")
        yield (lambda: web("frame") == "running", 25)
        yield 0.8
        click("creation", "paint:2")
        for cell in (19, 20, 21, 35, 37, 51, 52, 53):
            click("creation", "cell:%d" % cell)
            yield 0.05
        yield 0.5
        shot("02_A_running", "painted=%s" % web("painted"))

        # ---- 3: Wonder Web B, opened from A's own menu, both visible
        click("creation", "menu")
        yield 1.4
        shot("03_A_and_B", "two windows tiled")

        # ---- 4-7: Julius is given the design task and finds the capability missing
        click("connections", "ask-task")
        yield (lambda: space("prompt") not in (None, "-"), 20)
        yield 1.0
        shot("04_B_external_capability_required", "prompt=%s task=%s dev_figma=%s" % (space("prompt"), space("task"), space("dev_figma")))
        ui.expand_wonder_web_window("connections")
        yield 0.9
        shot("05_B_expanded_prompt", "the requested and not-requested capabilities, readable")
        click("connections", "details")
        yield 0.8
        shot("06_B_view_details", "what Julius already did")
        click("connections", "details")
        yield 0.5
        ui.expand_wonder_web_window("connections")
        yield 0.9

        # ---- 8-10: CONNECT; the deterministic authorization runs; CONNECTED
        click("connections", "approve")
        yield (lambda: space("dev_figma") == "CONNECTING", 5)
        yield 0.2
        shot("07_connecting", "dev_figma=%s" % space("dev_figma"))
        yield (lambda: space("dev_figma") == "CONNECTED", 10)
        yield 0.6
        shot("08_connected", "dev_figma=%s scope=%s" % (space("dev_figma"), space("scope")))

        # ---- 11-12: Julius resumes and uses the capability; audited
        yield (lambda: space("task") == "EXECUTING" and int((space("step") or "0/0").split("/")[0]) >= 1, 15)
        yield 0.6
        shot("09_julius_resumed", "task=%s step=%s last_audit=%s" % (space("task"), space("step"), space("last_audit")))
        ui.expand_wonder_web_window("connections")
        yield 0.9
        shot("10_audit_expanded", "audit=%s" % space("audit"))
        ui.expand_wonder_web_window("connections")
        yield 0.9

        # ---- 13-14: REVOKE; Julius loses it at once
        click("connections", "revoke:dev-figma")
        yield (lambda: space("dev_figma") == "REVOKED", 5)
        yield 0.4
        shot("11_revoked", "dev_figma=%s scope=%s" % (space("dev_figma"), space("scope")))
        yield (lambda: space("task") == "BLOCKED", 8)
        click("connections", "test:dev-figma")
        yield 1.0
        shot("12_julius_refused", "task=%s blocked=%s last_audit=%s" % (space("task"), space("blocked"), space("last_audit")))
        RESULT["after_revoke"] = str(ui.describe_wonder_web_workspace())
        RESULT["hud_rects"] = str(ui.describe_hud_rects())

        # ---- the glass: how long changed text takes to settle on the masked glass
        ui.simulate_wonder_web_window_click("connections", "terminal")
        ui.simulate_wonder_web_typing("status", True)
        start = unreal.GameplayStatics.get_real_time_seconds(world)
        for at, label in ((0.2, "16_settle_0_2s"), (0.5, "17_settle_0_5s"), (1.0, "18_settle_1_0s")):
            while unreal.GameplayStatics.get_real_time_seconds(world) - start < at:
                yield 0.0
            shot(label, "terminal lines changed %.1f s ago" % at)
        RESULT["fps_hint"] = str(unreal.GameplayStatics.get_real_time_seconds(world) - start)

        # ---- the workspace itself: minimize A to its chip and restore it; A never stops
        click("creation", "minimize")
        yield 0.9
        shot("13_A_minimized", "A folded to its chip; B fills its tile")
        click("creation", "chip")
        yield 0.9
        shot("14_A_restored")

        # ---- 15: A kept running the whole time
        RESULT["a_kept_running"] = all(row[1] == "running" and row[2] == "1" for row in a_running[1:])
        console("wl.WonderWeb.Close")
        yield 1.4
        shot("15_back_to_world")
        RESULT["final"] = str(ui.describe_wonder_web_workspace())
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "steps.json"), "w", encoding="utf-8") as fh:
            json.dump(steps, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLCONNECTPROOF could not end play: %s" % exc)
