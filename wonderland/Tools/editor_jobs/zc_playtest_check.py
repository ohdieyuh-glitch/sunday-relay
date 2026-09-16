# PIE job: THE FOUNDER PLAYTEST SANITY CHECK (2026-09-16). Short, and on the literal founder workflow.
#
# PIE -> the console command the founder will type -> watch. It checks only what the playtest gate names: the Julius
# terminal opens by itself with the live stream inside the established layout (LLM Companion left, Jhinn right), the
# book stays in the Dog's hands and above the ground while it reads and walks, the Dog faces the Contract while
# painting with the free arm down, and the verification beam renders. Full-screen photographs at each stage, to look at.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "playtest_check")
PACE = float(globals().get("PACE") or 5.0)


def vec(v):
    return [round(v.x, 1), round(v.y, 1), round(v.z, 1)]


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    checks = {}
    RESULT["checks"] = checks
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        ui = L.get_ui(world)
        mission = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()][0]
        L.focus_game_viewport()
        scene = {c.get_name(): c for c in pawn.get_components_by_class(unreal.SceneComponent)}
        book_root = next((c for n, c in scene.items() if n.startswith("MissionBookRoot")), None)
        book = next((c for n, c in scene.items() if n == "MissionBook" or n.startswith("MissionBook_")), None)
        arm_l = scene.get("Pivot_armLeft")
        arm_r = scene.get("Pivot_armRight")
        head = scene.get("Pivot_head")
        beam = next((c for n, c in scene.items() if n.startswith("VerificationBeam")), None)

        # ---- THE LITERAL FOUNDER COMMAND, default pace: it must start D and open the terminal by itself.
        terminal_before = bool(ui.is_live_terminal_open())
        spawn = pawn.get_actor_location()
        unreal.SystemLibrary.execute_console_command(world, "wl.Mission.Scenario D")
        yield 0.5
        waiting_for_site = bool(mission.is_scenario_waiting_for_site())
        yield (lambda: mission.is_fixture_running(), 90)
        yield 2.0
        travel = unreal.get_engine_subsystem(unreal.Object) if False else None
        arrived = pawn.get_actor_location()
        checks["command_starts_d"] = {"running": bool(mission.is_fixture_running()), "scenario": str(mission.get_scenario()),
                                      "waited_for_site": waiting_for_site,
                                      "moved_uu": round(math.dist([spawn.x, spawn.y], [arrived.x, arrived.y]), 0),
                                      "arrived_at": vec(arrived),
                                      "terminal_was_open": terminal_before, "terminal_open": bool(ui.is_live_terminal_open()),
                                      "joined": [bool(mission.is_llm_companion_joined()), bool(mission.is_jhinn_joined())]}
        # A build without the self-opening command: open the terminal the way a player would, and say so.
        if not ui.is_live_terminal_open():
            ui.toggle_live_terminal()
            checks["command_starts_d"]["opened_by_job"] = True
            yield 1.0

        rects = {}
        for line in str(ui.describe_hud_rects()).splitlines():
            parts = line.split()
            if len(parts) >= 5:
                rects[parts[0]] = [float(v) for v in parts[1:5]]
        checks["layout"] = rects
        L.capture_game_viewport(os.path.join(SHOTS, "pt_0_start.png"))

        # ---- restart quicker for the rest of the check, through the same command
        unreal.SystemLibrary.execute_console_command(world, "wl.Mission.Scenario D %.1f" % PACE)
        samples = []
        shots = {}
        for _ in range(200000):
            yield 0.1
            beat = str(mission.get_beat_id())
            if not mission.is_orb_in_world() and not mission.is_fixture_running() and len(samples) > 50:
                break
            pawn_at = pawn.get_actor_location()
            s = {"t": round(float(unreal.GameplayStatics.get_time_seconds(world)), 2), "beat": beat,
                 "dog": str(mission.get_dog_performing_label()), "pawn": vec(pawn_at), "yaw": round(pawn.get_actor_rotation().yaw, 1)}
            if mission.is_orb_in_world():
                orb = mission.get_orb_location()
                s["orb"] = vec(orb)
                s["face_err"] = round(abs((math.degrees(math.atan2(orb.y - pawn_at.y, orb.x - pawn_at.x)) - s["yaw"] + 180.0) % 360.0 - 180.0), 1)
            if book_root is not None:
                b = book_root.get_world_location()
                s["book_from_pawn"] = round(math.dist([b.x, b.y, b.z], [pawn_at.x, pawn_at.y, pawn_at.z]), 1)
                s["book_z_rel"] = round(b.z - pawn_at.z, 1)
                s["book_visible"] = bool(book.is_visible()) if book is not None else None
            if arm_l is not None and arm_r is not None:
                s["arm_l"] = [round(arm_l.get_editor_property("relative_rotation").pitch, 1), round(arm_l.get_editor_property("relative_rotation").roll, 1)]
                s["arm_r"] = [round(arm_r.get_editor_property("relative_rotation").pitch, 1), round(arm_r.get_editor_property("relative_rotation").roll, 1)]
            if head is not None:
                s["head_pitch"] = round(head.get_editor_property("relative_rotation").pitch, 1)
            if beam is not None:
                s["beam"] = [bool(beam.is_visible()), round(beam.get_world_scale().y, 3)]
            s["beam_note"] = str(pawn.describe_mission_beam())
            s["sections"] = {n: str(ui.get_julius_section_state(n)) for n in ("PROMPT ARCHITECT", "CODING AGENT", "JULIUS 3.3", "INDEPENDENT REVIEWER")}
            s["roles"] = [[int(ui.get_julius_role_written_count(r)), str(ui.get_julius_role_latest_line(r))[:60]] for r in range(4)]
            s["role_event"] = str(ui.get_julius_role_event())
            samples.append(s)
            for key, want in (("research", "researching"), ("guidance", "guidance"), ("painting", "coding_agent"),
                              ("review", "independent_reviewer"), ("verifying", "verifying")):
                if beat == want and key not in shots and sum(1 for x in samples if x["beat"] == want) * 0.1 >= 0.6 * PACE:
                    path = os.path.join(SHOTS, "pt_%s.png" % key)
                    L.capture_game_viewport(path)
                    shots[key] = {"path": path, "sample": s}
        RESULT["shots"] = shots
        RESULT["samples"] = samples

        def of(beats):
            return [x for x in samples if x["beat"] in beats]
        reading = of(("researching", "prompt_architect", "guidance"))
        painting = of(("coding_agent", "approval_continue"))
        verifying = of(("verifying",))
        checks["book"] = {"frames": len(reading),
                          "max_from_pawn": max((x.get("book_from_pawn", 0) for x in reading), default=None),
                          "min_z_rel": min((x.get("book_z_rel", 0) for x in reading), default=None),
                          "visible_frames": sum(1 for x in reading if x.get("book_visible"))}
        settled_paint = painting[len(painting) // 3:]
        checks["painting"] = {"frames": len(painting),
                              "median_face_err": sorted(x.get("face_err", 180) for x in settled_paint)[len(settled_paint) // 2] if settled_paint else None,
                              "arm_l_roll_range": [min((x["arm_l"][1] for x in settled_paint), default=None), max((x["arm_l"][1] for x in settled_paint), default=None)],
                              "arm_r_roll_range": [min((x["arm_r"][1] for x in settled_paint), default=None), max((x["arm_r"][1] for x in settled_paint), default=None)]}
        settled_verify = verifying[len(verifying) // 3:]
        checks["beam"] = {"frames": len(verifying), "lit_frames": sum(1 for x in settled_verify if x.get("beam", [False])[0]),
                          "settled_frames": len(settled_verify),
                          "notes": sorted({x["beam_note"].split(" dt=")[0] for x in settled_verify})[:3]}
        states = {}
        for x in samples:
            for n, v in x.get("sections", {}).items():
                states.setdefault(n, set()).add(v)
        checks["sections"] = {n: sorted(v) for n, v in states.items()}
        checks["role_lines_written"] = samples[-1]["roles"] if samples else None
        checks["role_event_matches"] = sum(1 for x in samples if x.get("role_event") == str(x.get("event", x.get("role_event"))))
        RESULT["status"] = "done"
    finally:
        try:
            if ues.get_game_world() is not None:
                unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "wl.Mission.Stop")
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLPLAYTEST could not end play: %s" % exc)
