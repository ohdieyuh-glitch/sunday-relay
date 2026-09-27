# THE FIRST TIME WONDERLAND <-> JULIUS CROSSES INTO THE ENGINE.
#
# Founder acceptance, 2026-09-27: run Wonderland PIE, authenticate the native client, attach to a REAL zero-spend
# Julius run, and show that the world holds THAT run -- READY in Julius, Queued on the Mission Contract -- then lose
# the link and recover the SAME durable run, then restart play and recover it again, with no false completion, no
# duplicate execution and no provider called.
#
# WHAT RUNS OUTSIDE THE EDITOR. scripts/wonderland-julius-pie-acceptance.mjs (the integration lane's orchestrator)
# starts the production bridge against an ISOLATED PostgreSQL -- never the inherited DATABASE_URL, which points at
# Julius's live store -- creates the run, signs a test player in, and answers this job's requests for pairing codes.
# A pairing code lives 120 s and PIE can take longer than that to start, so the code is minted ON REQUEST: this job
# writes `ready-<n>.flag` into the handshake directory once play is up, and the orchestrator answers with
# `code-<n>.txt`.
#
# WHAT THIS JUDGES. Only what the WORLD holds. The adopted run comes from UWonderlandJuliusSubsystem's own cursor
# (GetAdoptedRunId), not from what the transport was asked to follow -- otherwise "the world shows run X" would be the
# request compared with itself.
#
# CHANNEL RULES (Wonderland Core's): CONCURRENT = False because this begins and ends play; nothing here creates or
# saves an asset, so nothing is attempted while PIE runs.
import json
import os
import time

CONCURRENT = False

HANDSHAKE = r"C:\dev\iwonder\wonderland-julius-integration\generated\pie-acceptance"
H = unreal.WonderlandHudTestLibrary
L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "julius_live")
DEAD_BRIDGE = "http://127.0.0.1:1"


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    params_path = os.path.join(HANDSHAKE, "params.json")
    if not os.path.exists(params_path):
        record("A00", "the orchestrator prepared a run to attach to", False,
               reason="no params.json -- run scripts/wonderland-julius-pie-acceptance.mjs, which drops this job")
        RESULT["status"] = "FAIL: A00"
        return
    with open(params_path, "r", encoding="utf-8") as handle:
        params = json.load(handle)
    bridge, project, run, mission = params["bridge"], params["projectId"], params["runId"], params["missionId"]

    def world_now():
        return ues.get_game_world()

    def subsystems(world):
        game = unreal.GameplayStatics.get_game_instance(world)
        def owned(cls):
            found = [x for x in unreal.ObjectIterator(cls) if x.get_outer() == game]
            return found[0] if found else None
        return owned(unreal.WonderlandJuliusStreamSubsystem), owned(unreal.WonderlandJuliusSubsystem)

    def console(world, command):
        unreal.SystemLibrary.execute_console_command(world, command)

    # Compared to the ENUM, never to a string parsed out of str(enum): that format is not something to bet a verdict on.
    LIVE = unreal.WonderlandLinkState.LIVE
    STALE = unreal.WonderlandLinkState.STALE

    def link_state(julius):
        return julius.get_link_status().get_editor_property("State")

    def link_name(state):
        return getattr(state, "name", str(state))

    def terminal(julius):
        return bool(julius.get_embodiment().get_editor_property("bTerminal"))

    def pair(n):
        # Ask the orchestrator for a fresh code NOW, when it will be used at once.
        flag = os.path.join(HANDSHAKE, "ready-%d.flag" % n)
        code_path = os.path.join(HANDSHAKE, "code-%d.txt" % n)
        with open(flag, "w", encoding="utf-8") as handle:
            handle.write(str(time.time()))
        return code_path

    def start_play():
        yield (lambda: ues.get_game_world() is None, 600)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 3.0

    # ------------------------------------------------------------------ first play
    for step in start_play():
        yield step
    world = world_now()
    stream, julius = subsystems(world)
    record("A01", "the native transport exists on the PIE game instance, beside the Julius subsystem",
           stream is not None and julius is not None,
           stream=str(stream), julius=str(julius))
    if stream is None or julius is None:
        RESULT["status"] = "FAIL: the transport is not in this build -- merge and rebuild first"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    console(world, "wl.Julius.Bridge.Url %s" % bridge)
    code_path = pair(1)
    yield (lambda: os.path.exists(code_path), 60)
    with open(code_path, "r", encoding="utf-8") as handle:
        console(world, "wl.Julius.Pair %s" % handle.read().strip())
    yield (lambda: stream.is_paired(), 30)
    record("A02", "a signed-in player's code paired this desktop client", stream.is_paired())

    console(world, "wl.Julius.Follow %s %s" % (project, run))
    yield (lambda: stream.get_adopted_run_id() == run, 60)
    yield 2.0
    embodiment = julius.get_embodiment()
    mission_seen = embodiment.get_editor_property("MissionId")
    record("A03", "the world ADOPTED the same run Julius created -- same runId, same missionId",
           stream.get_adopted_run_id() == run
           and bool(mission_seen.get_editor_property("bKnown")) and mission_seen.get_editor_property("Value") == mission,
           adopted=stream.get_adopted_run_id(), created=run,
           mission_seen=mission_seen.get_editor_property("Value"), mission_created=mission)
    record("A04", "the world holds Julius's own state for it: READY",
           stream.get_julius_run_state() == "READY", julius_state=stream.get_julius_run_state())
    record("A05", "the Mission Contract state for it is QUEUED -- created, awaiting the driver, never running",
           stream.get_mission_contract_state() == "QUEUED", contract_state=stream.get_mission_contract_state())
    record("A06", "the link says Live, and nothing claims the run ended",
           link_state(julius) == LIVE and not terminal(julius),
           link=link_name(link_state(julius)), terminal=terminal(julius))
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_following_the_real_run.jpg"), 1900, 94)

    # ------------------------------------------------------------- lose the link
    console(world, "wl.Julius.Bridge.Url %s" % DEAD_BRIDGE)
    yield (lambda: link_state(julius) == STALE, 40)
    record("A07", "a dropped link reads STALE -- and the mission is untouched: same run, READY, not ended",
           link_state(julius) == STALE and stream.get_adopted_run_id() == run
           and stream.get_julius_run_state() == "READY" and not terminal(julius),
           link=link_name(link_state(julius)), adopted=stream.get_adopted_run_id(),
           julius_state=stream.get_julius_run_state(), terminal=terminal(julius))

    console(world, "wl.Julius.Bridge.Url %s" % bridge)
    yield (lambda: link_state(julius) == LIVE, 90)
    record("A08", "the link comes back and the world recovers the SAME durable run",
           link_state(julius) == LIVE and stream.get_adopted_run_id() == run
           and stream.get_julius_run_state() == "READY" and not terminal(julius),
           link=link_name(link_state(julius)), adopted=stream.get_adopted_run_id(), julius_state=stream.get_julius_run_state())

    # ------------------------------------------------------------ restart play
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
    for step in start_play():
        yield step
    world = world_now()
    stream, julius = subsystems(world)
    record("A09", "a fresh game carries nothing over: unpaired, and holding no run",
           stream is not None and not stream.is_paired() and stream.get_adopted_run_id() == "",
           paired=stream.is_paired() if stream else None, adopted=stream.get_adopted_run_id() if stream else None)

    console(world, "wl.Julius.Bridge.Url %s" % bridge)
    code_path = pair(2)
    yield (lambda: os.path.exists(code_path), 60)
    with open(code_path, "r", encoding="utf-8") as handle:
        console(world, "wl.Julius.Pair %s" % handle.read().strip())
    yield (lambda: stream.is_paired(), 30)
    console(world, "wl.Julius.Follow %s %s" % (project, run))
    yield (lambda: stream.get_adopted_run_id() == run, 60)
    yield 2.0
    record("A10", "after a restart the world recovers the SAME durable run from Julius -- READY, Queued, not ended",
           stream.get_adopted_run_id() == run and stream.get_julius_run_state() == "READY"
           and stream.get_mission_contract_state() == "QUEUED" and not terminal(julius),
           adopted=stream.get_adopted_run_id(), julius_state=stream.get_julius_run_state(),
           contract_state=stream.get_mission_contract_state(), terminal=terminal(julius))
    H.capture_viewport_jpeg(os.path.join(ROOT, "02_recovered_after_restart.jpg"), 1900, 94)
    RESULT["describe_after_restart"] = stream.describe()

    failing = [t["id"] for t in tests if not t["pass"]]
    RESULT["status"] = "all clauses pass" if not failing else "FAIL: " + ", ".join(failing)
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
