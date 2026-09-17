# PIE probe: THE FOUNDER'S WONDER WEB SLICE, PLAYED THROUGH THE REAL INPUT PATH (founder direction, 2026-09-17).
#
# PROJECT -> OPEN WONDER WEB -> the surface stands in the world -> the simulated creation builds and runs -> it is used
# (painted) -> the terminal takes a command -> a sample peer's tab is an observation that refuses input -> stop, a failed
# build, a rebuild -> close back to the world -> reopen and find it as it was left.
#
# Clicks are real Slate press/release events at the screen position where each control stands in the world, so they go
# through the input layer, the ray onto the glass and the widget interaction exactly as a mouse does. Every step is
# photographed; the stills are what get looked at, the describe lines are what get recorded.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wonder_web_proof")


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
        L.focus_game_viewport()

        def console(cmd):
            unreal.SystemLibrary.execute_console_command(world, cmd)

        def describe():
            return str(ui.describe_wonder_web())

        def field(name):
            for part in describe().split(" "):
                if part.startswith(name + "="):
                    return part[len(name) + 1:]
            return None

        def shot(label, note=""):
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, 1600, 90)
            steps.append({"step": label, "note": note, "describe": describe(), "file": path})

        def click(control):
            ok = bool(ui.simulate_wonder_web_click(control))
            steps.append({"click": control, "reached": ok, "describe": describe()})
            return ok

        shot("world_before")

        # ---- the project, and Wonder Web opened from it
        ui.toggle_project_brain()
        yield 1.0
        shot("project_brain", "the project, with OPEN WONDER WEB")
        console("wl.WonderWeb.Open")
        yield 1.6
        shot("wonder_web_idle", "opened: the screen stands in the world, the camera on it")

        # ---- the sample creation: opened with a click, built, running
        click("open-sample")
        yield 2.2
        shot("building")
        yield (lambda: field("frame") == "running", 20)
        yield 0.6
        shot("running")

        # ---- used: pick a colour, paint the grid
        click("paint:2")
        for cell in (19, 20, 21, 35, 37, 51, 52, 53, 70, 86):
            click("cell:%d" % cell)
            yield 0.05
        click("paint:1")
        for cell in (24, 25, 40, 41, 56, 57):
            click("cell:%d" % cell)
            yield 0.05
        yield 0.4
        shot("painted", "painted=%s" % field("painted"))

        # ---- the terminal
        click("terminal")
        yield 0.2
        ui.simulate_wonder_web_typing("help", True)
        yield 0.4
        ui.simulate_wonder_web_typing("status", True)
        yield 0.6
        shot("terminal_help")

        # ---- a sample peer: an observation, and it refuses input
        click("tab:1")
        yield 0.6
        lines_before = field("session_lines")
        ui.simulate_wonder_web_typing("stop", True)
        click("stop")
        yield 0.4
        RESULT["peer_refusal"] = {"session_lines_before": lines_before, "session_lines_after": field("session_lines"), "frame_after": field("frame"),
                                  "access": field("access"), "input": field("input")}
        shot("peer_kai", "observe only")
        click("tab:4")
        yield 0.5
        shot("peer_maya")

        # ---- back to MY VIEW: stop, a failed build, a rebuild
        click("tab:0")
        yield 0.4
        click("stop")
        yield 0.6
        shot("stopped")
        click("terminal")
        ui.simulate_wonder_web_typing("fail-sample", True)
        yield (lambda: field("frame") == "failed", 10)
        yield 0.5
        shot("failed")
        click("rebuild")
        yield 2.0
        shot("rebuilding")
        yield (lambda: field("frame") == "running", 20)
        yield 0.5
        shot("running_again")

        # ---- close, back to the world; reopen and find it as it was
        click("close")
        yield 1.4
        shot("closed_world", "back to the Dog")
        console("wl.WonderWeb.Open")
        yield 1.6
        shot("reopened", "still running, still painted")
        console("wl.WonderWeb.Close")
        yield 1.4
        shot("closed_again")
        RESULT["final"] = describe()
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "steps.json"), "w", encoding="utf-8") as fh:
            json.dump(steps, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLWEBPROOF could not end play: %s" % exc)
