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
# A code lives 120 s and play here takes 40-90 s to start (Wonderland Core, measured), so a code is minted ON REQUEST
# once play is up, and a failed pairing asks again rather than failing the acceptance for a reason that is not the
# transport's.
#
# WHAT THIS JUDGES. Only what the WORLD holds. The adopted run comes from UWonderlandJuliusSubsystem's own cursor
# (GetAdoptedRunId), not from what the transport was asked to follow -- otherwise "the world shows run X" would be the
# request compared with itself.
#
# CHANNEL RULES (Wonderland Core's review, 2026-09-27):
#   - CONCURRENT = False: this begins and ends play.
#   - Nothing here creates or saves an asset.
#   - Every wait is `yield (predicate, timeout)` through `wait()`, which CATCHES the TimeoutError the channel raises
#     into the generator at the deadline and turns it into a clean failing clause. Sub-steps run with `yield from` so
#     that error reaches the wait that is actually pending.
#   - The bridge URL cvar is RESTORED in `finally` -- and repaired on entry if an earlier run died pointing it at the
#     dead port -- so no later session on this editor inherits a broken link.
import json
import os
import time

CONCURRENT = False

HANDSHAKE = r"C:\dev\iwonder\wonderland-julius-integration\generated\pie-acceptance"
H = unreal.WonderlandHudTestLibrary
L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "julius_live")
URL_CVAR = "wl.Julius.Bridge.Url"
DEAD_BRIDGE = "http://127.0.0.1:1"
PAIRING_ATTEMPTS = 3
# Every clause this job declares. A job stopped part-way -- an exception, the editor closing it -- has recorded only
# passes so far; without this list its status would read "all clauses pass" over clauses that never ran.
DECLARED = ["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10", "A11"]


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"
    LIVE = unreal.WonderlandLinkState.LIVE
    STALE = unreal.WonderlandLinkState.STALE

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def wait(predicate, timeout):
        # The channel raises TimeoutError INTO the generator at the deadline; caught here, it is a False, not a crash.
        try:
            yield (predicate, timeout)
            return True
        except TimeoutError:
            return False

    def read_url_cvar():
        return unreal.SystemLibrary.get_console_variable_string_value(URL_CVAR)

    def console(world, command):
        unreal.SystemLibrary.execute_console_command(world, command)

    def set_url(world, value):
        # ALWAYS QUOTED. The engine console strips one pair of surrounding quotes and sets what is inside; a bare
        # `wl.Julius.Bridge.Url` with nothing after it only PRINTS the value -- so an unquoted empty restore would
        # silently leave the dead port in place (ConsoleManager.cpp, the CVar branch of ProcessUserConsoleInput).
        console(world, '%s "%s"' % (URL_CVAR, value))

    def link_state(julius):
        return julius.get_link_status().get_editor_property("State")

    def link_name(state):
        return getattr(state, "name", str(state))

    def terminal(julius):
        return bool(julius.get_embodiment().get_editor_property("bTerminal"))

    def subsystems(world):
        game = unreal.GameplayStatics.get_game_instance(world)
        def owned(cls):
            found = [x for x in unreal.ObjectIterator(cls) if x.get_outer() == game]
            return found[0] if found else None
        return owned(unreal.WonderlandJuliusStreamSubsystem), owned(unreal.WonderlandJuliusSubsystem)

    def start_play():
        if not (yield from wait(lambda: ues.get_game_world() is None, 600)):
            return False
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        if not (yield from wait(lambda: ues.get_game_world() is not None, 240)):
            return False
        if not (yield from wait(lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)):
            return False
        yield 3.0
        return True

    def pair(world, stream, label):
        # RETRYABLE: each attempt asks the orchestrator for a FRESH code at the moment it will be used.
        attempts = []
        for attempt in range(1, PAIRING_ATTEMPTS + 1):
            stem = "%s-%d" % (label, attempt)
            flag = os.path.join(HANDSHAKE, "ready-%s.flag" % stem)
            code_path = os.path.join(HANDSHAKE, "code-%s.txt" % stem)
            with open(flag, "w", encoding="utf-8") as handle:
                handle.write(str(time.time()))
            if not (yield from wait(lambda: os.path.exists(code_path), 60)):
                attempts.append("attempt %d: no code arrived in 60 s" % attempt)
                continue
            with open(code_path, "r", encoding="utf-8") as handle:
                console(world, "wl.Julius.Pair %s" % handle.read().strip())
            if (yield from wait(lambda: stream.is_paired(), 30)):
                attempts.append("attempt %d: paired" % attempt)
                return True, attempts
            attempts.append("attempt %d: code refused or pairing did not complete in 30 s" % attempt)
        return False, attempts

    def end_play_now():
        # Non-yielding on purpose: this also runs from `finally` while the generator may be closing.
        if ues.get_game_world() is not None:
            les.editor_request_end_play()

    # ------------------------------------------------------------------ entry repair
    original_url = read_url_cvar()
    RESULT["url_cvar_found"] = original_url
    if original_url.strip() == DEAD_BRIDGE:
        # An earlier run died between cutting the link and restoring it. Repair it NOW -- not only at the end -- so
        # even a run that stops at its first clause leaves this editor with a real setting, and what the end
        # restores is the empty default ("follows nothing, and says so"), never the dead port.
        original_url = ""
        set_url(ues.get_editor_world(), original_url)
        RESULT["url_cvar_repaired_on_entry"] = read_url_cvar() == original_url
    RESULT["url_cvar_before"] = original_url

    world = None
    try:
        params_path = os.path.join(HANDSHAKE, "params.json")
        if not os.path.exists(params_path):
            record("A00", "the orchestrator prepared a run to attach to", False,
                   reason="no params.json -- run scripts/wonderland-julius-pie-acceptance.mjs, which drops this job")
            return
        with open(params_path, "r", encoding="utf-8") as handle:
            params = json.load(handle)
        # Names this attempt: the orchestrator takes a result only if it carries its own nonce, because the channel
        # keeps earlier results and an earlier PASS must never be read as this run's.
        RESULT["acceptance_nonce"] = params.get("nonce")
        bridge, project, run, mission = params["bridge"], params["projectId"], params["runId"], params["missionId"]

        # ------------------------------------------------------------------ first play
        if not (yield from start_play()):
            record("A01", "play started", False, reason="PIE did not start within its budgets")
            return
        world = ues.get_game_world()
        stream, julius = subsystems(world)
        record("A01", "the native transport exists on the PIE game instance, beside the Julius subsystem",
               stream is not None and julius is not None, stream=str(stream), julius=str(julius))
        if stream is None or julius is None:
            return

        set_url(world, bridge)
        paired, attempts = yield from pair(world, stream, "first")
        record("A02", "a signed-in player's code paired this desktop client", paired, attempts=attempts)
        if not paired:
            return

        console(world, "wl.Julius.Follow %s %s" % (project, run))
        adopted = yield from wait(lambda: stream.get_adopted_run_id() == run, 60)
        yield 2.0
        mission_seen = julius.get_embodiment().get_editor_property("MissionId")
        record("A03", "the world ADOPTED the same run Julius created -- same runId, same missionId",
               adopted and stream.get_adopted_run_id() == run
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
        set_url(world, DEAD_BRIDGE)
        went_stale = yield from wait(lambda: link_state(julius) == STALE, 40)
        record("A07", "a dropped link reads STALE -- and the mission is untouched: same run, READY, not ended",
               went_stale and stream.get_adopted_run_id() == run
               and stream.get_julius_run_state() == "READY" and not terminal(julius),
               link=link_name(link_state(julius)), adopted=stream.get_adopted_run_id(),
               julius_state=stream.get_julius_run_state(), terminal=terminal(julius))

        set_url(world, bridge)
        recovered = yield from wait(lambda: link_state(julius) == LIVE, 90)
        record("A08", "the link comes back and the world recovers the SAME durable run",
               recovered and stream.get_adopted_run_id() == run
               and stream.get_julius_run_state() == "READY" and not terminal(julius),
               link=link_name(link_state(julius)), adopted=stream.get_adopted_run_id(),
               julius_state=stream.get_julius_run_state())

        # ------------------------------------------------------------ restart play
        end_play_now()
        if not (yield from wait(lambda: ues.get_game_world() is None, 300)):
            record("A09", "play ended for the restart", False, reason="PIE did not end within 300 s")
            return
        if not (yield from start_play()):
            record("A09", "play restarted", False, reason="PIE did not start again within its budgets")
            return
        world = ues.get_game_world()
        stream, julius = subsystems(world)
        record("A09", "a fresh game carries nothing over: unpaired, and holding no run",
               stream is not None and not stream.is_paired() and stream.get_adopted_run_id() == "",
               paired=stream.is_paired() if stream else None,
               adopted=stream.get_adopted_run_id() if stream else None)
        if stream is None or julius is None:
            return

        set_url(world, bridge)
        paired, attempts = yield from pair(world, stream, "restart")
        if paired:
            console(world, "wl.Julius.Follow %s %s" % (project, run))
            adopted = yield from wait(lambda: stream.get_adopted_run_id() == run, 60)
            yield 2.0
        else:
            adopted = False
        record("A10", "after a restart the world recovers the SAME durable run from Julius -- READY, Queued, not ended",
               paired and adopted and stream.get_adopted_run_id() == run and stream.get_julius_run_state() == "READY"
               and stream.get_mission_contract_state() == "QUEUED" and not terminal(julius),
               pairing=attempts, adopted=stream.get_adopted_run_id(), julius_state=stream.get_julius_run_state(),
               contract_state=stream.get_mission_contract_state(), terminal=terminal(julius))
        H.capture_viewport_jpeg(os.path.join(ROOT, "02_recovered_after_restart.jpg"), 1900, 94)
        RESULT["describe_after_restart"] = stream.describe()
    finally:
        # RESTORE THE LINK SETTING WHATEVER HAPPENED -- a failing clause, a TimeoutError, an exception, or the editor
        # closing the generator -- so no later session on this editor inherits the dead port. Non-yielding: a closing
        # generator cannot yield. The read-back is a clause, so "restored" is measured rather than assumed.
        set_url(ues.get_game_world() or ues.get_editor_world(), original_url)
        after = read_url_cvar()
        record("A11", "the editor's bridge URL is back to what it was before this job",
               after == original_url, before=original_url, after=after)
        end_play_now()
        ran = set(t["id"] for t in tests)
        missing = [c for c in DECLARED if c not in ran]
        record("A12", "the job ran to its end -- a clause that never ran is not a pass", not missing, missing=missing)
        failing = [t["id"] for t in tests if not t["pass"]]
        RESULT["status"] = "all clauses pass" if not failing else "FAIL: " + ", ".join(failing)
