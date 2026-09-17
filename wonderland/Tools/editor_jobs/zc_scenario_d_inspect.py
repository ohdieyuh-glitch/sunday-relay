# PIE probe: SCENARIO D, INSPECTED THE WAY THE FOUNDER WILL LOOK AT IT (founder correction, 2026-09-16 evening).
#
# Plays Scenario D through the founder's own command path (wl.Mission.Scenario D) and, at chosen moments of each stage,
# freezes the world and photographs it: from the mission camera at three angles round the Mission Contract, and close
# from the Relay Dog's front quarter and over its shoulder. It also drives a REAL left-button drag through Slate on the
# world and on the terminal, and records every frame's telemetry: the stage the strip shows, the act the Dog performs,
# the hands against the book, the crown of the Contract, the camera, and all four Julius terminal sections.
#
# Nothing here passes or fails the build on numbers alone: the stills are what get looked at.
import json
import math
import os
import time

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "scenario_d_inspect")
PACE = float(globals().get("PACE") or 10.0)
SITE = globals().get("SITE") or "castle_approach"
SECTIONS = ["JULIUS 3.3", "PROMPT ARCHITECT", "CODING AGENT", "INDEPENDENT REVIEWER"]
# When to photograph each stage: seconds after the Dog began performing it.
MOMENTS = globals().get("MOMENTS") or {
    "PREPARATION": [1.8, 6.0],
    "RESEARCH": [4.0, 21.0],
    "IMPLEMENTATION": [5.0, 30.0],
    "REVIEW": [4.0],
    "REPAIR": [2.0, 6.5, 12.5],
    "VERIFICATION": [3.0, 16.0],
}


def vec(v):
    return [round(v.x, 1), round(v.y, 1), round(v.z, 1)]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    samples = []
    stills = []
    RESULT["stills"] = stills
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 4.0
        world = ues.get_game_world()
        dog = unreal.GameplayStatics.get_player_pawn(world, 0)
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        mission = next(m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.get_world() == world)
        ui = L.get_ui(world)
        L.focus_game_viewport()

        def console(cmd):
            unreal.SystemLibrary.execute_console_command(world, cmd)

        for cmd in ("t.MaxFPS 0", "Slate.bAllowThrottling 0", "r.VSync 0"):
            console(cmd)
        console("wl.Mission.Site %s" % SITE)
        started = mission.play_scenario("D", PACE)
        RESULT["started"] = bool(started)
        yield (lambda: mission.is_fixture_running(), 240)

        def sample():
            orbs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb)
            orb = orbs[0] if orbs else None
            s = {
                "t": round(float(unreal.GameplayStatics.get_time_seconds(world)), 2),
                "strip": str(mission.get_beat_label()),
                "beat": str(mission.get_beat_id()),
                "event": str(mission.get_last_event_type()),
                "presented": str(mission.get_presented_event_type()),
                "withheld": int(mission.get_withheld_handoffs()),
                "dog": str(mission.get_dog_performing_label()),
                "pose": str(dog.describe_mission_pose()),
                "beam": str(dog.describe_mission_beam()),
                "cam_w": round(dog.get_mission_camera_weight(), 2),
                "cam": [round(dog.get_mission_camera_rotation().pitch, 1), round(dog.get_mission_camera_rotation().yaw, 1)],
                "dog_at": vec(dog.get_actor_location()),
                "dog_yaw": round(dog.get_actor_rotation().yaw, 1),
                "hands": [vec(dog.get_hand_location(True)), vec(dog.get_hand_location(False))],
                "book": [vec(dog.get_book_point(i)) for i in range(3)],
                "orb": vec(orb.get_actor_location()) if orb else None,
                "crown": round(orb.get_crown_scale(), 2) if orb else None,
                "repair": int(orb.get_repair_stage()) if orb else None,
                "manifest": round(orb.get_manifest(), 2) if orb else None,
                "focus": str(ui.get_julius_focus_section()),
                "roles": [str(ui.get_julius_role_status(r)) for r in range(4)],
                "lines": [int(ui.get_julius_section_line_count(sec)) for sec in SECTIONS],
                "typed": [int(ui.get_julius_role_typed_characters(r)) for r in range(4)],
                "companions": [vec(mission.get_companion_location(c)) for c in (0, 1)],
                "flights": [str(mission.get_companion_flight(c)) for c in (0, 1)],
            }
            return s

        stage_started = {}
        shot_done = set()
        drag_done = False
        last_sample = 0.0
        ended_at = None
        base_yaw = None
        while True:
            now = time.time()
            if now - last_sample > 0.2:
                last_sample = now
                s = sample()
                samples.append(s)
                t = s["t"]
                act = s["dog"]
                if act not in stage_started and act in MOMENTS:
                    stage_started[act] = t
                if base_yaw is None and s["cam_w"] > 0.99:
                    base_yaw = s["cam"][1]
                # ---- the photographs
                for act_name, moments in MOMENTS.items():
                    if act_name != act or act_name not in stage_started:
                        continue
                    for m in moments:
                        key = "%s@%s" % (act_name, m)
                        if key in shot_done or t - stage_started[act_name] < m:
                            continue
                        shot_done.add(key)
                        console("slomo 0.02")
                        yield 0.3
                        tag = "%s_%04.1f" % (act_name.lower(), m)
                        entry = {"key": key, "t": t, "files": [], "sample": sample()}
                        # THE SHOT AS THE PLAYER SEES IT: the continuous mission camera, untouched.
                        path = os.path.join(ROOT, "%s_auto.jpg" % tag)
                        H.capture_viewport_jpeg(path, 1600, 90)
                        entry["files"].append(path)
                        # CLOSER, on the same Contract-anchored camera, to read the hands and the props.
                        console("wl.MissionCam.Arm 320")
                        console("slomo 0.6")
                        yield 0.9
                        console("slomo 0.02")
                        yield 0.2
                        path = os.path.join(ROOT, "%s_close.jpg" % tag)
                        H.capture_viewport_jpeg(path, 1600, 90)
                        entry["files"].append(path)
                        console("wl.MissionCam.Arm 540")
                        console("slomo 0.6")
                        yield 0.9
                        stills.append(entry)
                        console("slomo 1")
                        last_sample = 0.0
                # ---- the founder's left-drag, once, during research
                if not drag_done and "VERIFICATION@16.0" in shot_done:
                    drag_done = True
                    rect = dog.get_game_viewport_screen_rect()
                    x, y, w, h = rect.x, rect.y, rect.z, rect.w
                    world_pt = (x + w * 0.5, y + h * 0.30)
                    terminal_pt = (x + w * 0.5, y + h * 0.84)
                    drag = {"rect": [x, y, w, h],
                            "press_world": str(dog.describe_mission_camera_press(*world_pt)),
                            "press_terminal": str(dog.describe_mission_camera_press(*terminal_pt))}
                    before = dog.get_mission_camera_rotation()
                    dog_yaw_before = dog.get_actor_rotation().yaw
                    dog.simulate_mission_camera_drag(world_pt[0], world_pt[1], world_pt[0] + 260.0, world_pt[1] + 40.0, 14)
                    after = dog.get_mission_camera_rotation()
                    drag["world_drag"] = {"yaw_before": round(before.yaw, 1), "yaw_after": round(after.yaw, 1),
                                          "pitch_before": round(before.pitch, 1), "pitch_after": round(after.pitch, 1),
                                          "drags": int(dog.get_mission_camera_drag_count()),
                                          "dog_yaw_before": round(dog_yaw_before, 1), "dog_yaw_after": round(dog.get_actor_rotation().yaw, 1)}
                    before = dog.get_mission_camera_rotation()
                    dog.simulate_mission_camera_drag(terminal_pt[0], terminal_pt[1], terminal_pt[0] + 260.0, terminal_pt[1], 14)
                    after = dog.get_mission_camera_rotation()
                    drag["terminal_drag"] = {"yaw_before": round(before.yaw, 1), "yaw_after": round(after.yaw, 1),
                                             "ui_presses": int(dog.get_mission_camera_presses_left_to_ui())}
                    RESULT["drag"] = drag
                    yield 1.0
                    path = os.path.join(ROOT, "after_drag.jpg")
                    H.capture_viewport_jpeg(path, 1600, 90)
                    drag["file"] = path
                if not mission.is_fixture_running():
                    if ended_at is None:
                        ended_at = time.time()
                    elif time.time() - ended_at > 5.0:
                        break
            yield 0.0

        path = os.path.join(ROOT, "after_completion.jpg")
        H.capture_viewport_jpeg(path, 1600, 90)
        RESULT["after_completion"] = path
        RESULT["final"] = sample()
        with open(os.path.join(ROOT, "samples.json"), "w", encoding="utf-8") as fh:
            json.dump(samples, fh)
        RESULT["samples"] = len(samples)
        RESULT["strip_labels"] = sorted({s["strip"] for s in samples})
        RESULT["dog_acts"] = sorted({s["dog"] for s in samples})
        RESULT["withheld"] = max((s["withheld"] for s in samples), default=0)
        RESULT["status"] = "done"
    finally:
        try:
            unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "slomo 1")
            unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "wl.MissionCam.Enabled 1")
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLDINSPECT could not end play: %s" % exc)
