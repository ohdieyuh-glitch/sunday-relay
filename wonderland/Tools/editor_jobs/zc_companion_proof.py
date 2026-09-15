# PIE job: proof of the companion preview -- the two embodiments beside the Relay Dog, the three-meter usage
# HUD and the companion terminals -- checked through the real subsystems and captured from the game viewport
# (WonderlandUiTestLibrary.capture_game_viewport reads back the Slate layer, so the HUD and panels are in the
# image, not just the world).
#
# Rules this job keeps, from editor_jobs/README.md: it waits until nobody is playing, never saves, never edits
# the map, never sends Escape (panels are closed through the UI subsystem), and ends the PIE it started.
#
# FIGURE_DIR points the embodiments at a figure directory for this run (wl.Companion.FigureDir), so figures
# can be iterated in a worktree without touching the project's own copy. Empty uses the project setting.
import math
import os
import time

FIGURE_DIR = "C:/dev/iwonder/wonderland-companions/wonderland/Companions"
# The same figures with ivory and gold on the V1 rim master instead of the plain lit shape material.
RIM_DIR = "C:/Users/Kaisi/AppData/Local/Temp/claude/C--Users-Kaisi/92e62278-8c7b-402e-8938-bd7e61b380ed/scratchpad/shell_rim"
TAG = "zc"
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", TAG)
L = unreal.WonderlandUiTestLibrary


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["captures"] = []

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def shot(name):
        path = os.path.join(SHOTS, name)
        ok = L.capture_game_viewport(path)
        good = ok is True or (isinstance(ok, tuple) and ok and ok[0])
        if good:
            RESULT["captures"].append(path)
        return path if good else None

    def console(command, world=None):
        unreal.SystemLibrary.execute_console_command(world, command)
        emit("console", command)

    # ------------------------------------------------------------------ wait for a free editor, then play
    if ues.get_game_world() is not None:
        emit("waiting for the current PIE session to end")
    yield (lambda: ues.get_game_world() is None, 1800)
    if FIGURE_DIR:
        console("wl.Companion.FigureDir " + FIGURE_DIR)
    # The editor's own background-throttle hook, for this session only (nothing is written to settings). It does not
    # make background frame rates comparable with foreground ones -- see WonderlandUiTestLibrary.h -- but it keeps
    # the viewport drawing while the captures are taken.
    RESULT["throttle_hook"] = bool(L.set_background_throttle_suspended(True))
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 6.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    ui = L.get_ui(world)
    subsystems = [c for c in unreal.ObjectIterator(unreal.WonderlandCompanionSubsystem)]
    companions = next((c for c in subsystems if c.get_world() == world), None) or next((c for c in subsystems if c.get_embodiment_count() > 0), None)
    RESULT["pawn_class"] = pawn.get_class().get_name()
    L.focus_game_viewport()
    yield 0.5

    # ------------------------------------------------------------------ the embodiments
    bodies = [companions.get_embodiment(i) for i in range(2)] if companions else []
    info = []
    for body in bodies:
        if body is None:
            info.append(None)
            continue
        info.append({"name": str(body.get_editor_property("display_name")), "class": str(body.get_editor_property("class_label")),
                     "boxes": body.get_box_count(), "parts": body.get_part_count(), "error": str(body.get_last_error()),
                     "figure": str(body.get_figure_path())})
    RESULT["embodiments"] = info
    record("C01", "two companion embodiments exist and both figures built",
           companions is not None and companions.get_embodiment_count() == 2 and all(i and i["boxes"] > 0 and not i["error"] for i in info),
           count=companions.get_embodiment_count() if companions else None, embodiments=info)

    def side_of(body):
        # Position of a body in the pawn's yaw frame: +X ahead of the Dog, +Y to its right.
        p, b = pawn.get_actor_location(), body.get_actor_location()
        yaw = math.radians(pawn.get_actor_rotation().yaw)
        dx, dy = b.x - p.x, b.y - p.y
        return (dx * math.cos(yaw) + dy * math.sin(yaw), -dx * math.sin(yaw) + dy * math.cos(yaw), b.z - p.z)

    yield 2.5  # idle long enough for both to turn and look back at the camera
    frames = [side_of(b) if b else None for b in bodies]
    RESULT["frames"] = frames
    record("C02", "the LLM Companion floats on the Dog's left and the Jhinn AI Agent on its right, both beside it",
           len(frames) == 2 and all(frames) and frames[0][1] < -60.0 and frames[1][1] > 60.0 and all(math.hypot(f[0], f[1]) < 320.0 for f in frames),
           frames=frames)

    # ------------------------------------------------------------------ HUD and panels
    record("C03", "usage HUD on screen once", ui.is_usage_hud_on_screen() and ui.get_usage_hud_creations() == 1,
           creations=ui.get_usage_hud_creations())
    titles = [str(ui.get_companion_terminal_title(i)) for i in range(ui.get_companion_terminal_count())]
    # The three consoles are one instrument (founder, 2026-09-15): mounted at attach, shown only with Ctrl+T.
    record("C04", "the companion terminals are mounted and hidden until the Julius terminal is up",
           ui.get_companion_terminal_count() == 2 and titles == ["GPT 6 Astra", "Claude Code Fable 5"]
           and not ui.are_companion_terminals_on_screen(),
           titles=titles, on_screen=ui.are_companion_terminals_on_screen())
    shot("zc_01_gameplay_behind.png")

    # ------------------------------------------------------------------ the portrait: camera in front of the Dog
    rot = pawn.get_actor_rotation()
    controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-6.0, yaw=rot.yaw + 180.0))
    yield 2.5
    shot("zc_02_front_portrait.png")
    # A closer portrait on a shorter boom, restored afterwards. Read through the property the Dog class exposes;
    # a pawn without a boom simply skips this shot.
    boom, arm = None, None
    try:
        boom = pawn.get_editor_property("camera_boom")
        arm = boom.get_editor_property("target_arm_length")
        boom.set_editor_property("target_arm_length", max(arm * 0.62, 220.0))
        yield 1.5
        shot("zc_02b_front_close.png")
    except Exception as error:
        emit("close portrait skipped:", error)
    RESULT["boom_arm_length"] = arm
    # A wide front shot: the Dog and both companions framed between the two panels.
    if boom is not None and arm is not None:
        boom.set_editor_property("target_arm_length", arm * 1.35)
        controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-12.0, yaw=rot.yaw + 180.0))
        yield 1.5
        shot("zc_02c_front_wide.png")
        boom.set_editor_property("target_arm_length", max(arm * 0.62, 220.0))
        controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-6.0, yaw=rot.yaw + 180.0))
        yield 1.0

    # ------------------------------------------------------------------ all three terminals
    L.focus_game_viewport()
    L.set_key_held("LeftControl", True)
    yield 0.12
    L.set_key_held("T", True)
    yield 0.12
    L.set_key_held("T", False)
    yield 0.08
    L.set_key_held("LeftControl", False)
    yield 0.6
    record("C05", "Ctrl+T opens the Julius terminal with the companion terminals still on screen",
           ui.is_live_terminal_open() and ui.are_companion_terminals_on_screen(),
           terminal=ui.is_live_terminal_open(), companions=ui.are_companion_terminals_on_screen())
    shot("zc_03_all_terminals.png")

    focused = ui.focus_companion_terminal(0)
    yield 0.2
    L.type_text("hello astra")
    yield 0.3
    typed = str(ui.get_companion_terminal_input_text(0))
    L.press_key("Enter", False)
    yield 0.4
    lines = ui.get_companion_terminal_line_count(0)
    record("C06", "a line typed into GPT 6 Astra's terminal is recorded as yours and marked not sent",
           focused and typed == "hello astra" and lines == 2 and str(ui.get_companion_terminal_input_text(0)) == "",
           focused=focused, typed=typed, lines=lines)
    shot("zc_04_companion_line_not_sent.png")
    ui.close_overlay()
    yield 0.6
    record("C06b", "closing the Julius terminal takes both companion terminals with it",
           not ui.is_live_terminal_open() and not ui.are_companion_terminals_on_screen() and ui.get_companion_terminal_count() == 2,
           terminal=ui.is_live_terminal_open(), companions=ui.are_companion_terminals_on_screen(),
           capture=shot("zc_04b_terminals_gone.png"))
    if boom is not None and arm is not None:
        boom.set_editor_property("target_arm_length", arm)

    # ------------------------------------------------------------------ following
    controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-10.0, yaw=rot.yaw))
    yield 1.0
    L.focus_game_viewport()
    p0 = pawn.get_actor_location()
    L.set_key_held("W", True)
    yield 1.6
    walk = shot("zc_05_following_walk.png")
    yield 0.6
    L.set_key_held("W", False)
    yield 1.2
    moved = (pawn.get_actor_location() - p0).length()
    after = [side_of(b) if b else None for b in bodies]
    record("C07", "after a walk both companions are still beside the Dog",
           moved > 100.0 and len(after) == 2 and all(after) and all(math.hypot(f[0], f[1]) < 360.0 for f in after),
           moved_cm=round(moved, 1), frames=after, capture=walk)
    yield 2.0
    shot("zc_06_after_walk_idle.png")

    # ------------------------------------------------------------------ where they float, seen from the play camera
    # Three follow offsets side by side from behind the Dog, so the placement is chosen from what a player sees.
    controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-10.0, yaw=pawn.get_actor_rotation().yaw))
    RESULT["offset_trials"] = []
    for label, llm_offset, agent_offset in (("current", (-40.0, -135.0), (-40.0, 140.0)),
                                            ("ahead", (30.0, -150.0), (30.0, 150.0)),
                                            ("ahead_wide", (60.0, -170.0), (60.0, 170.0))):
        for body, (ox, oy) in zip(bodies, (llm_offset, agent_offset)):
            if body:
                body.set_editor_property("follow_offset", unreal.Vector(ox, oy, 0.0))
                body.snap_to_target()
        yield 2.5
        RESULT["offset_trials"].append({"label": label, "capture": shot("zc_07_offset_%s.png" % label)})
    for body, (ox, oy) in zip(bodies, ((-40.0, -135.0), (-40.0, 140.0))):
        if body:
            body.set_editor_property("follow_offset", unreal.Vector(ox, oy, 0.0))
            body.snap_to_target()
    yield 1.0

    # ------------------------------------------------------------------ shell material A/B, close and in front
    if RIM_DIR and os.path.isdir(RIM_DIR):
        controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-6.0, yaw=pawn.get_actor_rotation().yaw + 180.0))
        if boom is not None and arm is not None:
            boom.set_editor_property("target_arm_length", max(arm * 0.62, 220.0))
        for label, directory in (("rim", RIM_DIR), ("lit", FIGURE_DIR)):
            unreal.SystemLibrary.execute_console_command(world, "wl.Companion.FigureDir " + directory)
            unreal.SystemLibrary.execute_console_command(world, "wl.Companion.Reload")
            yield 3.0
            RESULT.setdefault("shell_ab", []).append({"label": label, "capture": shot("zc_08_shell_%s.png" % label)})
        if boom is not None and arm is not None:
            boom.set_editor_property("target_arm_length", arm)
        controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-10.0, yaw=pawn.get_actor_rotation().yaw))
        yield 1.5

    # ------------------------------------------------------------------ what the two embodiments cost (gate item 10)
    # A/B on the same view: both bodies shown and ticking, then hidden with tick off, three times each, so drift in
    # the world's own frame rate averages out. Frame rates are only comparable with the editor in the foreground
    # (editor_jobs/README.md); the foreground state is not visible to a job, so the numbers say what they are.
    live = [b for b in bodies if b]
    components = [len(b.get_components_by_class(unreal.InstancedStaticMeshComponent)) for b in live]
    samples = {"visible": [], "hidden": []}
    for rep_index in range(3):
        for state in ("visible", "hidden"):
            for b in live:
                b.set_actor_hidden_in_game(state == "hidden")
                b.set_actor_tick_enabled(state == "visible")
            yield 1.5
            f0, t0 = unreal.SystemLibrary.get_frame_count(), time.time()
            yield 4.0
            samples[state].append((unreal.SystemLibrary.get_frame_count() - f0) / (time.time() - t0))
    for b in live:
        b.set_actor_hidden_in_game(False)
        b.set_actor_tick_enabled(True)
    fps_visible = sum(samples["visible"]) / max(len(samples["visible"]), 1)
    fps_hidden = sum(samples["hidden"]) / max(len(samples["hidden"]), 1)
    ms_visible = 1000.0 / fps_visible if fps_visible > 0 else None
    ms_hidden = 1000.0 / fps_hidden if fps_hidden > 0 else None
    RESULT["perf"] = {"fps_visible": round(fps_visible, 2), "fps_hidden": round(fps_hidden, 2),
                      "ms_visible": None if ms_visible is None else round(ms_visible, 2), "ms_hidden": None if ms_hidden is None else round(ms_hidden, 2),
                      "cost_ms": None if (ms_visible is None or ms_hidden is None) else round(ms_visible - ms_hidden, 2),
                      "samples": samples, "instanced_components": components, "boxes": [b.get_box_count() for b in live]}
    record("P01", "the two embodiments cost under 10% of the frame (A/B, visible vs hidden)",
           fps_hidden > 0 and fps_visible >= 0.9 * fps_hidden, **RESULT["perf"])

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    L.set_background_throttle_suspended(False)
    RESULT["passed"] = sum(1 for t in tests if t["pass"])
    RESULT["failed"] = [t["id"] for t in tests if not t["pass"]]
    RESULT["status"] = "done"
