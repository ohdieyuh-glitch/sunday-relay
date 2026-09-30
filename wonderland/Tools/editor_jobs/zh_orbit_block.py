# G1d -- THE CIRCLE ROUND THE CONTRACT MUST NOT JAM ON THE PLAZA (Second Wonderland's zs_04, 2026-09-30).
#
# In 5 of 17 Scenario-D deployments at castle_approach the Dog's circle ran into one obstacle near (505, 6925) and pinned it
# there, turning on the spot out of the Contract camera's shot, for RESEARCH, IMPLEMENTATION and REVIEW -- any skin. The
# staging probe clears the Dog's start; the circle sweeps ~9 m round a Contract 3.4 m out. This starts deployments from
# spots chosen so the circle crosses that obstacle, and measures the Dog's walk per act (Relay OG, no costume: the fault is
# not a skin's).
#   B1  (the old build must FAIL this to prove the instrument) in every run, during the circling acts, no 10 s window in
#       which the Dog makes < 60 uu of headway -- the stall detector Second uses;
#   B2  each run's circling path per act is at least 40% of the free reference run's (the Dog keeps performing, in shot).
# Globals: STARTS (list of [x, y, yaw]), PACE. PIE-owning: CONCURRENT is False. Saves nothing.
CONCURRENT = False
import math
import os

L = unreal.WonderlandUiTestLibrary
GS = unreal.GameplayStatics
# the reference, then starts that put the Contract (340 ahead, 40 right) ~340 uu from the obstacle, so the circle crosses it
OBSTACLE = globals().get("OBSTACLE", [505.0, 6925.0])
STARTS = globals().get("STARTS") or [[0.0, 6000.0, 90.0], [305.0, 6345.0, 90.0], [429.0, 6265.0, 90.0], [225.0, 6469.0, 90.0], [205.0, 6585.0, 90.0]]
PACE = float(globals().get("PACE", 5.0))
CIRCLING = ("RESEARCH", "IMPLEMENTATION", "REVIEW")
STALL_ACTS = ("RESEARCH", "IMPLEMENTATION")   # REVIEW lingers at 0.34 pace and stands to inspect: not judged for stalls


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    RESULT["status"] = "running"
    RESULT["dll_mtime"] = os.path.getmtime(os.path.join(unreal.Paths.project_dir(), "Binaries", "Win64", "UnrealEditor-Wonderland.dll"))
    L.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 90.0:
        yield 1.0
        t += 1.0
    world = ues.get_game_world()
    dog_of = lambda: GS.get_player_pawn(ues.get_game_world(), 0)
    t = 0.0
    while dog_of() is None and t < 30.0:
        yield 0.5
        t += 0.5
    if dog_of() is None:
        RESULT["status"] = "BLOCKED: no pawn"
        return
    yield 4.0
    L.focus_game_viewport()
    ui = L.get_ui(world)
    tasks = L.get_mission_tasks(world)
    mission = L.get_mission(world)
    travel = next(c for c in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if c.get_world() == world)
    persisted = None
    try:
        persisted = open(os.path.join(unreal.Paths.project_saved_dir(), "Wonderland", "RelaySkin.txt")).read().strip()
    except Exception:                                                  # noqa: BLE001
        pass
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def cmd(text):
        unreal.SystemLibrary.execute_console_command(world, text)

    travel.request_travel("castle_approach")
    w = 0.0
    yield 0.5
    while travel.is_travelling() and w < 95.0:
        yield 0.25
        w += 0.25
    yield 3.0
    ui.wear_relay_skin("relay_og")
    yield 2.0
    has_detours = hasattr(dog_of(), "get_orbit_detour_count")
    RESULT["build_has_detours"] = has_detours
    runs = []
    RESULT["runs"] = runs
    for sx, sy, syaw in STARTS:
        tasks.clear_all_tasks_for_development()
        cmd("wl.Mission.Stop")
        yield 2.0
        dog = dog_of()
        z = dog.get_actor_location().z
        dog.set_actor_location(unreal.Vector(sx, sy, z + 20.0), False, True)
        dog.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=syaw), False)
        ctrl = dog.get_controller()
        if ctrl is not None:
            ctrl.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-8.0, yaw=syaw))
        yield 2.0
        d0 = dog_of().get_orbit_detour_count() if has_detours else None
        cmd("wl.Mission.Scenario B %.1f" % PACE)
        per_act = {}
        closest = 1e9
        g0 = GS.get_time_seconds(world)
        seen = False
        while GS.get_time_seconds(world) - g0 < 170.0:
            dog = dog_of()
            pose = dog.get_canonical_worn_pose()
            act = str(mission.get_dog_performing_label()).upper()
            weight = float(pose.mission_weight)
            loc = dog.get_actor_location()
            now = GS.get_time_seconds(world) - g0
            if weight >= 0.5:
                seen = True
            closest = min(closest, math.hypot(loc.x - OBSTACLE[0], loc.y - OBSTACLE[1]))
            if act in CIRCLING and weight >= 0.9:
                row = per_act.setdefault(act, {"path": 0.0, "last": None, "t": []})
                if row["last"] is not None:
                    row["path"] += math.hypot(loc.x - row["last"][0], loc.y - row["last"][1])
                row["last"] = (loc.x, loc.y)
                row["t"].append((now, loc.x, loc.y))
            if seen and weight <= 0.01 and act in ("", "NONE") and now > 30.0:
                break
            yield 0.1
        cmd("wl.Mission.Stop")
        yield 2.0
        summary = {}
        worst_window = None
        for act, row in per_act.items():
            if act not in STALL_ACTS:
                summary[act] = {"path_uu": round(row["path"]), "samples": len(row["t"]), "stall_windows": 0, "first_stall": None}
                continue
            # the stall detector: any 10 s window inside the act with < 60 uu of straight-line headway
            pts = row["t"]
            stalled = []
            j = 0
            for i in range(len(pts)):
                while j < len(pts) and pts[j][0] - pts[i][0] < 10.0:
                    j += 1
                if j < len(pts):
                    moved = max(math.hypot(p[1] - pts[i][1], p[2] - pts[i][2]) for p in pts[i:j + 1])
                    if moved < 60.0:
                        stalled.append((round(pts[i][0], 1), round(pts[i][1]), round(pts[i][2])))
            summary[act] = {"path_uu": round(row["path"]), "samples": len(pts), "stall_windows": len(stalled),
                            "first_stall": stalled[0] if stalled else None}
            if stalled and worst_window is None:
                worst_window = stalled[0]
        rec = {"start": [sx, sy, syaw], "acts": summary, "closest_to_obstacle_uu": round(closest),
               "detours": (dog_of().get_orbit_detour_count() - d0) if has_detours else None, "first_stall": worst_window}
        runs.append(rec)
        emit("RUN", [sx, sy], {a: (s["path_uu"], s["stall_windows"]) for a, s in summary.items()}, "detours", rec["detours"],
             "closest", rec["closest_to_obstacle_uu"])
    ref = runs[0]["acts"] if runs else {}
    stalls = [r["start"] for r in runs if any(s["stall_windows"] for s in r["acts"].values())]
    near = [r["start"] for r in runs if r["closest_to_obstacle_uu"] <= 120]
    RESULT["runs_reaching_obstacle"] = near
    record("B0", "the instrument drove at least one circle to the obstacle (else B1 proves nothing)", bool(near),
           closest={str(r["start"]): r["closest_to_obstacle_uu"] for r in runs})
    record("B1", "no RESEARCH / IMPLEMENTATION stall (a 10 s window with < 60 uu headway) from any start", not stalls, stalled_runs=stalls)
    short = []
    for r in runs[1:]:
        for act in CIRCLING:
            if act in ref and ref[act]["path_uu"] > 0 and r["acts"].get(act, {}).get("path_uu", 0) < 0.4 * ref[act]["path_uu"]:
                short.append([r["start"], act, r["acts"].get(act, {}).get("path_uu", 0), ref[act]["path_uu"]])
    record("B2", "every run circles at least 40% of the free run's path in each circling act", not short, short=short)
    if persisted:
        ui.wear_relay_skin(persisted)
        yield 1.5
    RESULT["all_pass"] = all(x["pass"] for x in tests)
    RESULT["status"] = "measured"
