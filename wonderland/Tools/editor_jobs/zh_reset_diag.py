# G1b DIAGNOSTIC -- after a mid-act reset, is an alternate skin's costume STUCK, or only in another phase of its idle?
#
# zh_19b (2026-09-30) failed R1/R3 on all four alternate skins on one criterion only: some costume part was 4.5-11.8 deg
# from a single snapshot taken before the contract. The canon was clean (weight 0, lift 0, no act) and Relay OG's own
# "0.0" was vacuous (no costume parts). A single snapshot cannot tell a stuck joint from an idle sway caught at another
# phase. This measures it the way the G1 proof does -- costume against canon IN THE SAME FRAME -- plus an idle envelope:
#   IDLE   6 s at rest: hand and sole gaps (costume vs canon, per side) and every costume part's rotation range;
#   RESET  a contract driven to IMPLEMENTATION, then wl.Tasks.Reset: the same, sampled for 8 s after;
#   STOP   the founder's path: wl.Mission.Scenario B until an act is on, then wl.Mission.Stop: the same.
# A part is STUCK if, from 3 s after the interruption, it stays outside its own idle range by more than 2 degrees; the costume
# is OFF THE CANON if a hand or sole gap stays above its idle maximum + 1 uu.
# Globals: SKINS. PIE-owning: CONCURRENT is False. Saves nothing; restores the persisted skin.
CONCURRENT = False
import math
import os

L = unreal.WonderlandUiTestLibrary
GS = unreal.GameplayStatics
SKINS = globals().get("SKINS", ["celestial_light", "skeleton_flame", "jack_flame", "baal"])


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
    travel = next(c for c in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if c.get_world() == world)
    persisted = None
    try:
        persisted = open(os.path.join(unreal.Paths.project_saved_dir(), "Wonderland", "RelaySkin.txt")).read().strip()
    except Exception:                                                  # noqa: BLE001
        pass
    travel.request_travel("castle_approach")
    w = 0.0
    yield 0.5
    while travel.is_travelling() and w < 95.0:
        yield 0.25
        w += 0.25
    yield 3.0

    def cmd(text):
        unreal.SystemLibrary.execute_console_command(world, text)

    def sample():
        dog = dog_of()
        c = dog.get_costume()
        out = {"gaps": {}, "parts": {}}
        if c is None:
            return out
        for side in (1.0, -1.0):
            ch, kh = c.get_hand_world(side), dog.get_canon_hand_world(side)
            cs, ks = c.get_sole_world(side), dog.get_canon_sole_world(side)
            out["gaps"]["hand%+d" % side] = math.dist((ch.x, ch.y, ch.z), (kh.x, kh.y, kh.z))
            out["gaps"]["sole%+d" % side] = math.dist((cs.x, cs.y, cs.z), (ks.x, ks.y, ks.z))
        for comp in c.get_components_by_class(unreal.SceneComponent):
            name = comp.get_name()
            if name.startswith("Part_"):
                r = comp.get_editor_property("relative_rotation")
                out["parts"][name] = (r.roll, r.pitch, r.yaw)
        return out

    def run_window(seconds):
        rows = []
        g0 = GS.get_time_seconds(world)
        while GS.get_time_seconds(world) - g0 < seconds:
            s = sample()
            s["t"] = GS.get_time_seconds(world) - g0
            rows.append(s)
            yield 0.1
        return rows

    def envelope(rows):
        env = {}
        for r in rows:
            for name, rot in r["parts"].items():
                lo, hi = env.get(name, (list(rot), list(rot)))
                env[name] = ([min(a, b) for a, b in zip(lo, rot)], [max(a, b) for a, b in zip(hi, rot)])
        return env

    def excess(rot, lo, hi):
        worst = 0.0
        for v, a, b in zip(rot, lo, hi):
            if v < a:
                worst = max(worst, a - v)
            elif v > b:
                worst = max(worst, v - b)
        return worst

    def judge(idle, after, label):
        env = envelope(idle)
        gap_max = {}
        for r in idle:
            for k, v in r["gaps"].items():
                gap_max[k] = max(gap_max.get(k, 0.0), v)
        late = [r for r in after if r["t"] >= 3.0]
        stuck = {}
        for r in late:
            for name, rot in r["parts"].items():
                if name in env:
                    e = excess(rot, env[name][0], env[name][1])
                    stuck[name] = min(stuck.get(name, 1e9), e)   # stuck = outside the idle range for the WHOLE late window
        stuck = {k: round(v, 2) for k, v in stuck.items() if v > 2.0}
        late_gap = {}
        for r in late:
            for k, v in r["gaps"].items():
                late_gap[k] = max(late_gap.get(k, 0.0), v)
        off = {k: [round(gap_max.get(k, 0.0), 2), round(v, 2)] for k, v in late_gap.items() if v > gap_max.get(k, 0.0) + 1.0}
        # the biggest single-snapshot difference, the zh_19b way, for comparison
        idle_swing = 0.0
        for name, (lo, hi) in env.items():
            idle_swing = max(idle_swing, max(b - a for a, b in zip(lo, hi)))
        return {"label": label, "stuck_parts": stuck, "off_canon": off, "idle_gap_max": {k: round(v, 2) for k, v in gap_max.items()},
                "late_gap_max": {k: round(v, 2) for k, v in late_gap.items()}, "idle_swing_deg": round(idle_swing, 2),
                "ok": not stuck and not off}

    results = []
    RESULT["results"] = results
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 2.5
        tasks.clear_all_tasks_for_development()
        yield 1.5
        idle = yield from run_window(6.0)
        # ---- RESET mid-act
        tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
        yield 1.5
        cmd("wl.Tasks.Scheduler 0 IMPLEMENTATION")
        yield 3.5
        cmd("wl.Tasks.Reset")
        after = yield from run_window(8.0)
        res = judge(idle, after, "contract reset")
        res["skin"] = skin
        results.append(res)
        emit(skin, "RESET", "OK" if res["ok"] else "STUCK", res["stuck_parts"], res["off_canon"], "idle swing", res["idle_swing_deg"])
        # ---- STOP mid-act (fixture)
        tasks.clear_all_tasks_for_development()
        yield 1.0
        cmd("wl.Mission.Scenario B")
        w = 0.0
        while w < 60.0:
            yield 0.5
            w += 0.5
            if float(dog_of().get_canonical_worn_pose().mission_weight) >= 0.5:
                break
        yield 1.0
        cmd("wl.Mission.Stop")
        after = yield from run_window(8.0)
        res = judge(idle, after, "fixture stop")
        res["skin"] = skin
        results.append(res)
        emit(skin, "STOP", "OK" if res["ok"] else "STUCK", res["stuck_parts"], res["off_canon"], "idle swing", res["idle_swing_deg"])
        tasks.clear_all_tasks_for_development()
        yield 1.5
    if persisted:
        ui.wear_relay_skin(persisted)
        yield 1.5
    RESULT["all_ok"] = all(r["ok"] for r in results)
    RESULT["status"] = "measured"
