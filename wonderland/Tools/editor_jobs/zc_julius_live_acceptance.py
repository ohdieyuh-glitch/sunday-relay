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
# ONE DIRECTORY PER ATTEMPT (Wonderland Core, 2026-09-27: every run writing into one directory let the second eat the
# first run's before-pictures). Set to ROOT/attempt-<nonce> once the attempt is named; ROOT only until then.
SHOTS = {"dir": ROOT}
URL_CVAR = "wl.Julius.Bridge.Url"
DEAD_BRIDGE = "http://127.0.0.1:1"
PAIRING_ATTEMPTS = 3
# Every clause this job declares. A job stopped part-way -- an exception, the editor closing it -- has recorded only
# passes so far; without this list its status would read "all clauses pass" over clauses that never ran.
DECLARED = ["A01", "A01b", "A02", "A03", "A04", "A05", "A06", "A06b", "A06e", "A06f", "A06g", "A06h", "A06c", "A06d", "A07", "A08", "A09", "A10", "A10b", "A06k", "A06l", "A06i", "A06j", "A06m", "A06n", "A11"]


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

    def text(carrier):
        # An FWonderlandText as (known, value): unknown must stay distinguishable from empty.
        return bool(carrier.get_editor_property("bKnown")), carrier.get_editor_property("Value")

    def contract_view(world, mission):
        """WHAT THE MISSION CONTRACT HOLDS for this mission -- the player's task set, read the way its surface reads
        it. QUEUED ALONE PROVES NOTHING HERE: FollowJuliusRun creates a task in Queued before Julius has said anything
        (Wonderland Core, 2026-09-27), so the clause keys on Julius's own state being KNOWN on the task."""
        tasks = unreal.WonderlandUiTestLibrary.get_mission_tasks(world)
        rows = [t for t in (tasks.get_task_list() if tasks else []) if t.get_editor_property("ContractId") == mission]
        view = {"tasks_for_mission": len(rows)}
        if rows:
            row = rows[0]
            view.update({
                "source": getattr(row.get_editor_property("Source"), "name", str(row.get_editor_property("Source"))),
                "state": getattr(row.get_editor_property("State"), "name", str(row.get_editor_property("State"))),
                "run": text(row.get_editor_property("RunId")),
                "julius_state": text(row.get_editor_property("JuliusState")),
            })
        return view

    def shows_the_run(view, run):
        return (view["tasks_for_mission"] == 1 and view.get("source") == "JULIUS" and view.get("state") == "QUEUED"
                and view.get("run") == (True, run) and view.get("julius_state") == (True, "READY"))

    def capture_missions(world, name):
        # The Mission Contract VISIBLY, not only its data: open the Missions view, capture, and put it back as found.
        # WAITED ON STATE AND FRAMES, NOT SECONDS: the first half-minute of play runs at up to ~500 ms a frame (Core's
        # warm-up curve, 2026-09-27: 521, 123, 64, 48, 57 ms), so a fixed sleep would budget against the slowest part
        # of the session and could photograph the view before it has drawn.
        ui = unreal.WonderlandUiTestLibrary.get_ui(world)
        was_open = ui.is_missions_open()
        if not was_open:
            ui.toggle_missions()
        shown = yield from wait(lambda: ui.is_missions_open(), 10)
        first = unreal.SystemLibrary.get_frame_count()
        drawn = yield from wait(lambda: unreal.SystemLibrary.get_frame_count() >= first + 6, 30)
        H.capture_viewport_jpeg(os.path.join(SHOTS["dir"], name), 1900, 94)
        RESULT.setdefault("captures", {})[name] = {"missions_open": bool(shown), "frames_drawn": bool(drawn)}
        if not was_open:
            ui.toggle_missions()
            yield from wait(lambda: not ui.is_missions_open(), 10)

    def capture_terminal(world, name):
        # The Julius Live Terminal VISIBLY, by the same rule: opened, waited on state and frames, captured, put back.
        ui = unreal.WonderlandUiTestLibrary.get_ui(world)
        was_open = ui.is_live_terminal_open()
        if not was_open:
            ui.toggle_live_terminal()
        shown = yield from wait(lambda: ui.is_live_terminal_open(), 10)
        first = unreal.SystemLibrary.get_frame_count()
        drawn = yield from wait(lambda: unreal.SystemLibrary.get_frame_count() >= first + 6, 30)
        # THE TERMINAL GROWS TO FIT ITS ROWS, and it ANIMATES there. Attempt b4e24b8d29fc3433's 01c was taken with the
        # section state right and the newest sub-line clipped mid-growth. So the capture waits for the extension to hold
        # still for ten frames -- a predicate on the widget, not a number of seconds. A build without the accessor
        # captures after the frames alone, and says so.
        settled = None
        if hasattr(ui, "get_julius_terminal_extension"):
            seen = {"value": None, "since": unreal.SystemLibrary.get_frame_count()}

            def extension_settled():
                value = float(ui.get_julius_terminal_extension())
                frame = unreal.SystemLibrary.get_frame_count()
                if seen["value"] is None or abs(value - seen["value"]) > 0.05:
                    seen["value"], seen["since"] = value, frame
                    return False
                return frame - seen["since"] >= 10

            settled = yield from wait(extension_settled, 20)
        H.capture_viewport_jpeg(os.path.join(SHOTS["dir"], name), 1900, 94)
        RESULT.setdefault("captures", {})[name] = {"terminal_open": bool(shown), "frames_drawn": bool(drawn),
                                                   "extension_settled": "no accessor in this build" if settled is None else bool(settled)}
        if not was_open:
            ui.toggle_live_terminal()
            yield from wait(lambda: not ui.is_live_terminal_open(), 10)

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

    def pair(world, stream, label, project=None):
        # RETRYABLE: each attempt asks the orchestrator for a FRESH code at the moment it will be used. With a project,
        # the code is minted for THAT project, and "paired" means the client now reports that project -- a client that
        # was already paired reads is_paired() true before the new code is even redeemed.
        attempts = []
        for attempt in range(1, PAIRING_ATTEMPTS + 1):
            stem = "%s-%d" % (label, attempt)
            flag = os.path.join(HANDSHAKE, "ready-%s.flag" % stem)
            code_path = os.path.join(HANDSHAKE, "code-%s.txt" % stem)
            with open(flag, "w", encoding="utf-8") as handle:
                handle.write(json.dumps({"projectId": project}) if project else str(time.time()))
            if not (yield from wait(lambda: os.path.exists(code_path), 60)):
                attempts.append("attempt %d: no code arrived in 60 s" % attempt)
                continue
            with open(code_path, "r", encoding="utf-8") as handle:
                console(world, "wl.Julius.Pair %s" % handle.read().strip())
            done = (lambda: str(stream.get_paired_project_id()) == project) if project else (lambda: stream.is_paired())
            if (yield from wait(done, 30)):
                attempts.append("attempt %d: paired" % attempt)
                return True, attempts
            attempts.append("attempt %d: code refused or pairing did not complete in 30 s" % attempt)
        return False, attempts

    def ask_orchestrator(stem, payload, timeout=90):
        # One request to the orchestrator, answered through the same handshake directory as the pairing codes: what an
        # OPERATOR would do between two moves of the player -- write a profile, change a role, restart the bridge.
        request = os.path.join(HANDSHAKE, "act-%s.json" % stem)
        answer = os.path.join(HANDSHAKE, "done-%s.json" % stem)
        with open(request + ".tmp", "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        os.replace(request + ".tmp", request)
        if not (yield from wait(lambda: os.path.exists(answer), timeout)):
            return None
        with open(answer, "r", encoding="utf-8") as handle:
            return json.load(handle)

    def all_tasks(world):
        tasks = unreal.WonderlandUiTestLibrary.get_mission_tasks(world)
        return [str(t.get_editor_property("ContractId")) for t in (tasks.get_task_list() if tasks else [])]

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
        SHOTS["dir"] = os.path.join(ROOT, "attempt-%s" % (params.get("nonce") or "unnamed"))
        os.makedirs(SHOTS["dir"], exist_ok=True)
        RESULT["captures_dir"] = SHOTS["dir"]
        bridge, project, run, mission = params["bridge"], params["projectId"], params["runId"], params["missionId"]
        switch_run = params.get("switchRunId") or ""

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

        # DECISION 1: the bridge is CONFIGURATION, and the session only travels where it cannot be read on the way --
        # https anywhere, plain http only to this machine. Probed through the cvar while the transport is idle (no run
        # is followed yet, so nothing is sent to any of these). A refused address yields no bridge AND says why.
        if not hasattr(stream, "get_bridge_url"):
            record("A01b", "the bridge address is configuration, https-or-loopback only", False,
                   reason="NOT IN THIS BUILD: the transport has no GetBridgeUrl")
        else:
            probes = {}
            for probe in ("http://relay.example.com", "https://relay.example.invalid/", "http://localhost:8796",
                          "http://127.0.0.1:1", "ftp://relay.example.invalid"):
                set_url(world, probe)
                probes[probe] = {"used": str(stream.get_bridge_url()), "problem": str(stream.get_bridge_problem())}
            record("A01b", "the bridge address is configuration: https is used, loopback http is used, plain http to another "
                   "host and a non-http URL are REFUSED with a reason -- never silently used",
                   probes["http://relay.example.com"]["used"] == "" and "Refusing" in probes["http://relay.example.com"]["problem"]
                   and probes["https://relay.example.invalid/"]["used"] == "https://relay.example.invalid"
                   and probes["https://relay.example.invalid/"]["problem"] == ""
                   and probes["http://localhost:8796"]["used"] == "http://localhost:8796"
                   and probes["http://127.0.0.1:1"]["used"] == "http://127.0.0.1:1"
                   and probes["ftp://relay.example.invalid"]["used"] == "" and "Refusing" in probes["ftp://relay.example.invalid"]["problem"],
                   probes=probes)

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
        view = contract_view(world, mission)
        # A06b is the DATA layer: the player's task set. It passed on 2026-09-27 (attempt 07119e8af5b416dd) while the
        # captures showed the Missions panel saying "No mission is running" and the strip "UNOBSERVED" -- the visible
        # surfaces read UWonderlandMissionSubsystem, not the task set. So the clause names what it proves, and A06e
        # holds the VISIBLE surface to the founder's criterion.
        record("A06b", "the Mission Contract TASK SET holds the run: one Julius-sourced task for the mission, the same "
               "run id, Julius's own READY known on it, QUEUED (the data the surfaces should show)",
               shows_the_run(view, run), contract=view, on_contract=stream.describe().split("on-contract=")[-1].split(" |")[0])
        H.capture_viewport_jpeg(os.path.join(SHOTS["dir"], "01_following_the_real_run.jpg"), 1900, 94)
        yield from capture_missions(world, "01b_mission_contract_queued.jpg")
        # THE FOUNDER'S CRITERION IS VISIBLE: "the Mission Contract visibly shows QUEUED". The Missions panel shows a
        # mission exactly when the mission subsystem it reads holds a fold for one (SWonderlandMissionsPanel::
        # IsShowingMission -> IsOrbInWorld; its rows read GetFoldMissionId). This reads THAT, not the task set.
        missions = unreal.WonderlandUiTestLibrary.get_mission(world)
        fold = str(missions.get_fold_mission_id()) if missions else ""
        record("A06e", "the VISIBLE Missions panel shows this run's mission -- the surface the founder looks at reads "
               "the mission subsystem's fold, so the fold must be this mission",
               fold == mission, fold_mission=fold or "(none)", mission=mission,
               fixture_running=bool(missions.is_fixture_running()) if missions else None)
        # THE STRIP, the two halves together (founder, 2026-09-27: "If a real Julius run is being followed, the large
        # headline must NOT say UNOBSERVED"). Each half can be right while the pair reads as a contradiction -- the
        # second run's photo showed a correct JULIUS LIVE line under a headline still saying UNOBSERVED.
        headline = str(missions.get_headline_label()) if missions else ""
        banner = str(missions.get_provenance_banner()) if missions else ""
        record("A06f", "the STRIP agrees with the panel: its headline reads the followed run's state (QUEUED), never "
               "UNOBSERVED, while its provenance line names JULIUS LIVE, the run and Julius's READY",
               headline == "QUEUED" and "JULIUS LIVE" in banner and run in banner and "READY" in banner,
               headline=headline, banner=banner)
        # THE LIVE TERMINAL (founder, 2026-09-27: "Stop the terminal saying STANDBY / Not connected while a real run is
        # followed"). Its JULIUS 3.3 section reads the followed run's state; its banner line names the run exactly as the
        # strip does; nothing on it is marked simulated; and its rows are the follow -- read from the SECTION'S rows, not
        # its newest one, because the run's result arrives as a row of its own and may already be the newest. The
        # terminal is fed by a 5 Hz reading of the world, so the section is WAITED on, never assumed; then photographed.
        #
        # A BUILD THAT PREDATES THE WIRING cannot answer the new accessors, and a missing binding must be a FAILED CLAUSE
        # that says so -- not an AttributeError that ends the job and takes every later clause with it. The terminal is
        # photographed either way: in such a build it still says STANDBY, and the photograph should show exactly that.
        ui = unreal.WonderlandUiTestLibrary.get_ui(world)
        terminal_wired = hasattr(ui, "get_julius_terminal_banner")
        yield from wait(lambda: str(ui.get_julius_section_state("JULIUS 3.3")) == "QUEUED", 10)
        yield from capture_terminal(world, "01c_live_terminal_queued.jpg")
        section = str(ui.get_julius_section_state("JULIUS 3.3"))
        terminal_banner = str(ui.get_julius_terminal_banner()) if terminal_wired else "NOT IN THIS BUILD"
        rows = str(ui.describe_julius_section("JULIUS 3.3", 10))
        record("A06g", "the LIVE TERMINAL follows the run: JULIUS 3.3 reads QUEUED, never STANDBY; its banner names JULIUS "
               "LIVE, the run and READY; it is not marked simulated; its rows are the follow, with no 'Not connected'",
               terminal_wired and section == "QUEUED" and "JULIUS LIVE" in terminal_banner and run in terminal_banner
               and "READY" in terminal_banner and not ui.is_julius_terminal_simulated()
               and ("Julius: Following %s" % mission) in rows and "Not connected" not in rows,
               section=section, banner=terminal_banner, rows=rows, simulated=bool(ui.is_julius_terminal_simulated()),
               build_has_terminal_wiring=terminal_wired)

        # THE USER RESULT (founder decision 5), read by the world through the bridge after the hydration. The run is READY
        # and was never dispatched, so the result is Julius's answer for exactly that -- not final, NOTHING met (nothing
        # can be: an evidence criterion needs passed evidence and a completion criterion needs COMPLETED), nothing made,
        # no failure -- and for its OWNER an exact cost of nothing, complete. Tokens UNKNOWN. Then it is SHOWN: a Result
        # row in the terminal's JULIUS 3.3 section, photographed.
        if not hasattr(stream, "has_result"):
            record("A06h", "the run's USER RESULT reached the world and is shown", False,
                   reason="NOT IN THIS BUILD: the transport has no result reading (UWonderlandJuliusStreamSubsystem::HasResult)")
        else:
            got = yield from wait(lambda: stream.has_result(), 30)
            yield from wait(lambda: "Result: " in str(ui.describe_julius_section("JULIUS 3.3", 10)), 10)
            yield from capture_terminal(world, "01d_live_terminal_result.jpg")
            rows = str(ui.describe_julius_section("JULIUS 3.3", 10))
            record("A06h", "the run's USER RESULT reached the world and is shown: not final, 0 criteria met, nothing made, no "
                   "failure, the owner's exact cost of nothing, tokens UNKNOWN -- and a Result row in the terminal",
                   got and stream.get_result_julius_state() == "READY" and not stream.is_result_verified()
                   and stream.get_result_criteria_met() == 0 and stream.get_result_deliverable_count() == 0
                   and stream.get_result_failure_reason() == "" and stream.is_result_cost_visible()
                   and stream.get_result_cost_known_usd_micros() == 0 and stream.is_result_cost_complete()
                   and stream.get_result_tokens() == "UNKNOWN" and "Result: not final" in rows,
                   has_result=bool(got), result=str(stream.describe_result()), rows=rows,
                   criteria_total=stream.get_result_criteria_total(),
                   # WHERE IT BROKE, if it did: the transport's own line ends "result=<headline>", "result=not read
                   # yet", or "result=not read yet (N failed reads)" -- three different facts that has_result alone
                   # collapses into one False.
                   transport=str(stream.describe()).split(" | result=")[-1])

        # ------------------------------------------------------------- switch runs
        # Wonderland Core, 2026-09-27: the automatic clear on a run CHANGE had no gate. Two halves, because the
        # transport's own path would MASK a broken clear -- it resets the task's Julius carriers on every hydration:
        #   A06c  END TO END: follow a second run of the same mission -> still ONE task, now carrying the NEW run and
        #         Julius's READY for it.
        #   A06d  THE RULE ITSELF: wl.Julius.ContractFollow calls FollowJuliusRun alone (no reset, no report). The same
        #         run keeps what it knew -- the CONTROL, so "always clears" fails too -- and a different run forgets it.
        console(world, "wl.Julius.Follow %s %s" % (project, switch_run))
        switched = yield from wait(lambda: stream.get_adopted_run_id() == switch_run, 60)
        yield 2.0
        view = contract_view(world, mission)
        record("A06c", "a run SWITCH shows on the Mission Contract: still ONE task for the mission, now carrying the "
               "new run and Julius's READY for it",
               bool(switch_run) and switched and shows_the_run(view, switch_run),
               adopted=stream.get_adopted_run_id(), switch_run=switch_run, contract=view)
        console(world, "wl.Julius.ContractFollow %s %s" % (mission, switch_run))
        yield 0.5
        same = contract_view(world, mission)
        console(world, "wl.Julius.ContractFollow %s %s" % (mission, run))
        yield 0.5
        other = contract_view(world, mission)
        record("A06d", "the task set's OWN rule on a run change, without the transport's reset: re-following the same "
               "run keeps Julius's READY (control); a different run forgets it and carries only the new run id",
               same.get("run") == (True, switch_run) and same.get("julius_state") == (True, "READY")
               and other["tasks_for_mission"] == 1 and other.get("run") == (True, run)
               and other.get("julius_state", (None, None))[0] is False,
               same_run=same, different_run=other)

        # Back to the first run for the rest of the walk; the transport re-reads it, so the task is whole again.
        console(world, "wl.Julius.Follow %s %s" % (project, run))
        yield from wait(lambda: stream.get_adopted_run_id() == run, 60)
        yield 2.0

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
        view = contract_view(world, mission)
        record("A10b", "after the restart the Mission Contract shows the SAME run once -- no second task, Julius's READY "
               "known on it, QUEUED",
               shows_the_run(view, run), contract=view)
        H.capture_viewport_jpeg(os.path.join(SHOTS["dir"], "02_recovered_after_restart.jpg"), 1900, 94)
        yield from capture_missions(world, "02b_mission_contract_after_restart.jpg")
        RESULT["describe_after_restart"] = stream.describe()

        # ============================================================ CREATE FROM INSIDE WONDERLAND (priority 9)
        # The Unreal client creates a Julius mission as its paired OWNER -- four fields, nothing else; the bridge composes
        # the rest from the project's operator profile. In a FRESH project per attempt (B), so "no profile yet" is real:
        # the client is paired FOR B, which is also the proof that creation uses the pairing's project scope. Every
        # refusal must leave the world exactly as it was -- no task, no run, no QUEUED -- and say so on the terminal.
        create_project = params.get("createProjectId") or ""
        create_key = params.get("createKey") or ""
        CREATION_CLAUSES = ("A06k", "A06l", "A06i", "A06j", "A06m", "A06n")
        if not (hasattr(stream, "create_mission") and hasattr(stream, "get_paired_project_id")):
            for cid in CREATION_CLAUSES:
                record(cid, "creation from inside Wonderland", False,
                       reason="NOT IN THIS BUILD: the transport has no CreateMission / paired project")
        else:
            ui = unreal.WonderlandUiTestLibrary.get_ui(world)
            objective = "Acceptance probe: a mission the world created as its player. It is never driven."
            requirements = ["Exists only to prove creation from inside Wonderland."]
            constraints = ["Never dispatch. No provider may be called on its behalf."]

            def create(key, ids=("created-in-world",), texts=("The run exists durably in READY with dispatched false.",),
                       blocking=(True,)):
                before = stream.get_creation_generation()
                stream.create_mission(key, objective, requirements, constraints, list(ids), list(texts), list(blocking))
                answered = yield from wait(lambda: stream.get_creation_generation() > before, 60)
                return bool(answered)

            def refusal_holds(label, expect_status, expect_kinds, tasks_before, adopted_before):
                # THE WORLD DID NOT PRETEND: same tasks, same run, no wl- mission appeared, and the terminal said why.
                kind = str(stream.get_last_creation_refusal())
                status = stream.get_last_creation_status()
                shown = yield from wait(lambda: ("Create: Not created · %s" % kind) in str(ui.describe_julius_section("JULIUS 3.3", 20)), 10)
                tasks_now = all_tasks(world)
                return {
                    "holds": status in expect_status and kind in expect_kinds and tasks_now == tasks_before
                    and stream.get_adopted_run_id() == adopted_before and not str(stream.get_last_created_run_id())
                    and bool(shown),
                    "status": status, "refusal": kind, "tasks_unchanged": tasks_now == tasks_before,
                    "adopted_unchanged": stream.get_adopted_run_id() == adopted_before, "terminal_says_so": bool(shown),
                }

            # --- pair FOR project B. Following stops first, so the old run is kept as last known rather than re-read
            # with a session that belongs to another project.
            stream.stop()
            paired_b, attempts_b = yield from pair(world, stream, "create", create_project)
            RESULT["create_pairing"] = {"paired": bool(paired_b), "attempts": attempts_b,
                                        "paired_project": str(stream.get_paired_project_id())}
            tasks_before = all_tasks(world)
            adopted_before = str(stream.get_adopted_run_id())

            # A06k: NO PROFILE YET -- refused, and nothing pretends otherwise.
            answered = paired_b and (yield from create(create_key))
            check = (yield from refusal_holds("no-profile", (409,), ("execution_not_configured",), tasks_before, adopted_before)) if answered else {"holds": False}
            yield from capture_terminal(world, "03a_refused_no_profile.jpg")
            record("A06k", "REFUSED in-world when the project has no execution profile: 409 execution_not_configured -- no task, "
                   "no run, the world still on what it showed, and the terminal says why",
                   bool(create_project) and paired_b and answered and check["holds"], pairing=attempts_b, **check)

            # The operator writes B's profile, the way an operator does.
            profile_answer = yield from ask_orchestrator("profile-b", {"action": "profile", "projectId": create_project})
            RESULT["create_profile"] = profile_answer

            # A06l: MALFORMED INTENT -- no acceptance criterion at all.
            answered = yield from create("%s-malformed" % create_key, ids=(), texts=(), blocking=())
            check = (yield from refusal_holds("malformed", (400,), ("malformed_mission",), tasks_before, adopted_before)) if answered else {"holds": False}
            record("A06l", "REFUSED in-world when the intent is malformed (no acceptance criterion): 400 malformed_mission -- no task, "
                   "no run, the terminal says why",
                   profile_answer is not None and answered and check["holds"], profile=profile_answer, **check)

            # A06i: THE CREATION -- the same key the no-profile attempt used (it recorded nothing, so it is still free).
            answered = yield from create(create_key)
            created_run = str(stream.get_last_created_run_id())
            created_mission = str(stream.get_last_created_mission_id())
            followed = bool(created_run) and (yield from wait(lambda: stream.get_adopted_run_id() == created_run, 60))
            yield from wait(lambda: ("Create: Created %s" % created_mission) in str(ui.describe_julius_section("JULIUS 3.3", 20)), 15)
            view = contract_view(world, created_mission) if created_mission else {"tasks_for_mission": 0}
            missions = unreal.WonderlandUiTestLibrary.get_mission(world)
            yield from wait(lambda: str(missions.get_headline_label()) == "QUEUED" and created_run in str(missions.get_provenance_banner()), 15)
            yield from capture_terminal(world, "03b_world_created_mission.jpg")
            yield from capture_missions(world, "03c_mission_contract_created.jpg")
            rows = str(ui.describe_julius_section("JULIUS 3.3", 20))
            tasks_after_create = all_tasks(world)
            record("A06i", "the WORLD created a mission as its paired OWNER -- 201, the bridge's own mission and run ids -- and "
                   "follows exactly that run: ONE task on the Mission Contract, QUEUED over Julius's raw READY, the strip and the "
                   "terminal naming the same run",
                   answered and stream.get_last_creation_status() == 201 and created_mission.startswith("mission:wl-")
                   and bool(created_run) and followed and view["tasks_for_mission"] == 1 and view.get("state") == "QUEUED"
                   and view.get("julius_state") == (True, "READY") and view.get("run") == (True, created_run)
                   and ("Julius: Following %s" % created_mission) in rows and ("Create: Created %s" % created_mission) in rows
                   and str(missions.get_headline_label()) == "QUEUED" and created_run in str(missions.get_provenance_banner())
                   and "READY" in str(missions.get_provenance_banner()),
                   status=stream.get_last_creation_status(), refusal=str(stream.get_last_creation_refusal()),
                   created_run=created_run, created_mission=created_mission, objective=objective,
                   paired_project=str(stream.get_paired_project_id()),
                   followed=bool(followed), contract=view, rows=rows, headline=str(missions.get_headline_label()),
                   banner=str(missions.get_provenance_banner()))

            # A06j: THE RETRY -- the same key again is the SAME mission and run: no second task, no second follow.
            answered = yield from create(create_key)
            yield 2.0
            retry_view = contract_view(world, created_mission) if created_mission else {"tasks_for_mission": 0}
            tasks_after_retry = all_tasks(world)
            record("A06j", "a RETRY from Unreal with the same key returns the SAME mission and run: still one task, nothing new "
                   "followed",
                   answered and stream.get_last_creation_status() == 201 and str(stream.get_last_created_run_id()) == created_run
                   and str(stream.get_last_created_mission_id()) == created_mission and stream.get_adopted_run_id() == created_run
                   and retry_view["tasks_for_mission"] == 1 and tasks_after_retry == tasks_after_create,
                   status=stream.get_last_creation_status(), run=str(stream.get_last_created_run_id()),
                   tasks_before=len(tasks_after_create), tasks_after=len(tasks_after_retry), contract=retry_view)

            # A06m: NOT THE OWNER -- the operator makes the player a MEMBER of B; creation is refused, the world keeps the
            # mission it follows. Then the role is restored.
            role_answer = yield from ask_orchestrator("role-member", {"action": "role", "projectId": create_project, "role": "MEMBER"})
            answered = yield from create("%s-member" % create_key)
            check = (yield from refusal_holds("member", (403,), ("not_authorized",), tasks_after_create, created_run)) if answered else {"holds": False}
            restore_answer = yield from ask_orchestrator("role-owner", {"action": "role", "projectId": create_project, "role": "OWNER"})
            record("A06m", "REFUSED in-world for a non-owner (MEMBER): 403 not_authorized -- no task, and the world keeps the "
                   "mission it follows",
                   role_answer is not None and restore_answer is not None and answered and check["holds"], **check)

            # A06n: THE SESSION IS GONE -- the bridge restarts (sessions live in memory, so every one is revoked). Refused
            # 401 session_invalid by the bridge, or -- if the stream noticed first and forgot the session -- not_paired
            # before anything is sent. Either way: no task, no run, the terminal says pair again.
            restart_answer = yield from ask_orchestrator("restart-bridge", {"action": "restart-bridge"}, timeout=120)
            answered = yield from create("%s-session" % create_key)
            check = (yield from refusal_holds("session", (401, 0), ("session_invalid", "not_paired"), tasks_after_create, created_run)) if answered else {"holds": False}
            yield from capture_terminal(world, "03d_refused_session.jpg")
            record("A06n", "REFUSED in-world when the native session is no longer valid (the bridge restarted): session_invalid "
                   "or not_paired -- no task, no run, and the terminal says to pair again",
                   restart_answer is not None and bool(restart_answer.get("healthy")) and answered and check["holds"], **check)
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
