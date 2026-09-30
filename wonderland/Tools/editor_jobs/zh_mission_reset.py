# G1b -- MISSION CONTRACT RESETS ON EVERY SKIN (founder, 2026-09-30: "Repeat deployments and resets").
#
# zg_mission_contract_proof runs deploy -> COMPLETED -> deploy; this interrupts. Per skin, with Relay OG first as the
# reference:
#   R1  CONTRACT RESET MID-ACT: a contract is driven to IMPLEMENTATION (the act fully on), then every slot is closed
#       (wl.Tasks.Reset). Within 3 s the Dog is back at rest: mission weight <= 0.02, lift <= 1 uu, no act performed, and
#       every costume part within 3 degrees of where it stood before the contract.
#   R2  REDEPLOY AFTER THE RESET: a new contract performs the same acts in PREPARATION and VERIFICATION as Relay OG did,
#       with the act on (weight >= 0.5), and COMPLETED settles again.
#   R3  FIXTURE STOP MID-ACT (the founder's own path): wl.Mission.Scenario B at the site, wait for an act, wl.Mission.Stop;
#       within 3 s the Dog is back at rest as in R1.
# Globals: SKINS. PIE-owning: CONCURRENT is False. Saves nothing; restores the persisted skin.
CONCURRENT = False
import math
import os

L = unreal.WonderlandUiTestLibrary
GS = unreal.GameplayStatics
SKINS = globals().get("SKINS", ["relay_og", "celestial_light", "skeleton_flame", "jack_flame", "baal"])


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
    RESULT["persisted_skin_at_start"] = persisted
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name)

    def cmd(text):
        unreal.SystemLibrary.execute_console_command(world, text)

    def parts_now():
        costume = dog_of().get_costume()
        if costume is None:
            return {}
        out = {}
        for c in costume.get_components_by_class(unreal.SceneComponent):
            if c.get_name().startswith("Part_"):
                r = c.get_editor_property("relative_rotation")
                out[c.get_name()] = (r.roll, r.pitch, r.yaw)
        return out

    def worst_turn(a, b):
        worst = 0.0
        for k, ra in a.items():
            rb = b.get(k)
            if rb is None:
                continue
            for x, y in zip(ra, rb):
                d = abs((x - y + 180.0) % 360.0 - 180.0)
                worst = max(worst, d)
        return worst

    def rest_state():
        pose = dog_of().get_canonical_worn_pose()
        return {"weight": round(float(pose.mission_weight), 3), "lift": round(float(pose.lift_uu), 2),
                "act": str(mission.get_dog_performing_label())}

    def at_rest(state):
        return state["weight"] <= 0.02 and state["lift"] <= 1.0 and state["act"].upper() in ("NONE", "")

    # stand at the Mission Contract's own site so Scenario B needs no travel
    travel.request_travel("castle_approach")
    w = 0.0
    yield 0.5
    while travel.is_travelling() and w < 95.0:
        yield 0.25
        w += 0.25
    yield 3.0

    reference = {}
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 2.5
        tasks.clear_all_tasks_for_development()
        yield 1.0
        rest0 = parts_now()
        row = {"skin": skin, "worn": str(dog_of().get_worn_skin_id())}
        # ---- R1: contract reset mid-act
        tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
        yield 1.5
        cmd("wl.Tasks.Scheduler 0 IMPLEMENTATION")
        yield 3.5
        row["mid_act"] = rest_state()
        cmd("wl.Tasks.Reset")
        yield 3.0
        row["after_reset"] = rest_state()
        row["after_reset_turn_deg"] = round(worst_turn(rest0, parts_now()), 2)
        r1 = row["mid_act"]["weight"] >= 0.5 and at_rest(row["after_reset"]) and row["after_reset_turn_deg"] <= 3.0
        record("R1_%s" % skin, "%s: a contract reset mid-act returns the Dog to rest" % skin, r1,
               mid=row["mid_act"], after=row["after_reset"], turn=row["after_reset_turn_deg"])
        # ---- R2: redeploy after the reset
        tasks.clear_all_tasks_for_development()
        yield 0.8
        tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
        yield 1.5
        acts = {}
        for stage in ("PREPARATION", "VERIFICATION"):
            cmd("wl.Tasks.Scheduler 0 %s" % stage)
            yield 3.0
            acts[stage] = rest_state()
        cmd("wl.Tasks.Scheduler 0 COMPLETED")
        yield 6.0
        row["redeploy"] = acts
        row["after_completed"] = rest_state()
        if skin == "relay_og":
            reference = {k: v["act"] for k, v in acts.items()}
        same = all(acts[k]["act"] == reference.get(k) and acts[k]["weight"] >= 0.5 for k in acts)
        record("R2_%s" % skin, "%s: redeployed after the reset, performs Relay OG's acts and settles" % skin,
               same and at_rest(row["after_completed"]), acts={k: v["act"] for k, v in acts.items()}, reference=reference,
               after=row["after_completed"])
        # ---- R3: the founder's path -- a fixture, stopped mid-act
        tasks.clear_all_tasks_for_development()
        yield 1.0
        cmd("wl.Mission.Scenario B")
        w = 0.0
        while w < 60.0:
            yield 0.5
            w += 0.5
            if rest_state()["weight"] >= 0.5:
                break
        row["fixture_mid"] = rest_state()
        row["fixture_seconds_to_act"] = w
        cmd("wl.Mission.Stop")
        yield 3.0
        row["fixture_after_stop"] = rest_state()
        row["fixture_turn_deg"] = round(worst_turn(rest0, parts_now()), 2)
        record("R3_%s" % skin, "%s: the fixture stopped mid-act returns the Dog to rest" % skin,
               row["fixture_mid"]["weight"] >= 0.5 and at_rest(row["fixture_after_stop"]) and row["fixture_turn_deg"] <= 3.0,
               mid=row["fixture_mid"], after=row["fixture_after_stop"], turn=row["fixture_turn_deg"])
        tasks.clear_all_tasks_for_development()
        yield 1.5
        RESULT.setdefault("rows", []).append(row)
    if persisted:
        ui.wear_relay_skin(persisted)
        yield 1.5
    RESULT["all_pass"] = all(x["pass"] for x in tests)
    RESULT["status"] = "measured"
