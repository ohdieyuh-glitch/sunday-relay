# PIE job: Phase 3B -- a deterministic Julius-shaped mission, driving the real Mission Contract.
#
# It proves two different kinds of thing, and keeps them apart on purpose:
#
#   ARITHMETIC, with nothing drawn. Each fixture is replayed through the fold and its beat sequence, chakra
#   sequence and per-event verdicts are compared against what this file says they must be. A renderer bug
#   cannot make these pass and a table mistake cannot hide behind one.
#
#   THE WORLD, filmed. One fixture is played live, and the crystal is photographed as it manifests at red,
#   climbs, falls back through a repair, reaches violet, and is dismissed -- with nothing typed by hand.
#
# It also proves the founder's new canon directly: standing in Wonderland with no task running, THERE IS NO
# CONTRACT. The first check would fail if the old always-present orb came back.
#
# Rules kept: zc_ prefix, no saves, no map edits, never Escape unless a panel is open, and it ends its own PIE.
import os
import time

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary

# The fold is arithmetic, so it can be written down. These are the chakra steps after each event.
EXPECTED = {
    # contract, research, architect, coding, a checkpoint, review, REPAIR BACK TO 4, re-review, violet
    "full_lifecycle": "1,1,2,2,2,3,3,3,4,4,4,4,4,5,5,4,4,5,6,6,7,7",
    # blocked at blue, and the three events after it change nothing
    "blocked": "1,3,4,5,5,5,5,5",
    # one mission to violet, then a NEW contract back at red
    "two_missions": "1,3,4,5,6,7,1,3",
    # only alpha's events move alpha
    "crossed": "1,1,3,3,3,4,4,5",
}

# How many events each fixture must refuse, and why. A fixture that stopped refusing would be a rule lost.
EXPECTED_REFUSED_AFTER_ENDING = {"blocked": 3}
EXPECTED_FOREIGN = {"crossed": 4}

FILMED = "full_lifecycle"
PACE = 0.9          # seconds per event while filming
FRAMES_PER_EVENT = 2


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["captures"] = []

    def say(line):
        unreal.log_warning("WLMISSION3B %s" % line)

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        say("%s %s %s" % (tid, "PASS" if ok else "FAIL", detail))
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def shot(name):
        path = os.path.join(SHOTS, name)
        ok = L.capture_game_viewport(path)
        good = ok is True or (isinstance(ok, tuple) and ok and ok[0])
        if good:
            RESULT["captures"].append(path)
        return path if good else None

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    # PICK THE LIVE ONE. get_beat_count() is a constant on every instance, so it discriminates nothing --
    # and with the new canon there is no orb at rest to find either. The strip is the tell: it is mounted
    # only for the controller this subsystem actually attached to, so a subsystem left over from an earlier
    # PIE session does not have one. Driving a dead subsystem is why S08 saw 45 frames and zero events.
    live = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem)
            if m.is_mission_strip_on_screen()]
    mission = live[0] if live else next(
        (m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.get_beat_count() > 0), None)
    RESULT["subsystems_seen"] = len(list(unreal.ObjectIterator(unreal.WonderlandMissionSubsystem)))
    RESULT["subsystems_live"] = len(live)
    for cmd in ("t.MaxFPS 0", "Slate.bAllowThrottling 0", "r.VSync 0"):
        unreal.SystemLibrary.execute_console_command(world, cmd)
    yield 0.5
    say("pie up, mission=%s live=%d of %d" % (mission is not None, RESULT["subsystems_live"], RESULT["subsystems_seen"]))

    def to_screen(at):
        try:
            got = unreal.GameplayStatics.project_world_to_screen(controller, at, False)
        except Exception as exc:
            RESULT.setdefault("project_error", str(exc))
            return None
        if isinstance(got, tuple):
            got = got[1] if len(got) > 1 else got[0]
        try:
            return [float(got.x), float(got.y)]
        except AttributeError:
            return None

    # ---------------------------------------------------------------- the new canon
    # NO TASK, NO CONTRACT. This is the founder's 2026-09-16 rule stated as the first thing checked, so the
    # old always-present ground orb cannot come back without failing here.
    record("S00", "standing in Wonderland with nothing running, there is no Mission Contract",
           mission is not None and not mission.is_orb_in_world() and mission.get_contracts_manifested() == 0,
           contract=mission.is_orb_in_world() if mission else None,
           manifested=mission.get_contracts_manifested() if mission else None,
           capture=shot("zc_m3b_00_no_contract.png"))

    # ---------------------------------------------------------------- the fixtures exist
    ids = [str(mission.get_fixture_id_at(i)) for i in range(mission.get_fixture_count())] if mission else []
    RESULT["fixtures"] = ids
    record("S01", "the deterministic fixtures are present",
           set(EXPECTED).issubset(set(ids)), fixtures=ids)

    # ---------------------------------------------------------------- the arithmetic
    folds = {}
    wrong = []
    for name, expected in EXPECTED.items():
        got = str(mission.replay_chakra_steps(name))
        folds[name] = {"chakra": got, "beats": str(mission.replay_beats(name)),
                       "verdicts": str(mission.replay_verdicts(name)),
                       "summary": str(mission.replay_summary(name))}
        if got != expected:
            wrong.append({"fixture": name, "expected": expected, "got": got})
        say("%s -> %s" % (name, folds[name]["summary"]))
    RESULT["folds"] = folds
    record("S02", "every fixture folds to exactly the chakra sequence it must", not wrong, wrong=wrong)

    # ---------------------------------------------------------------- the repair goes backward
    lifecycle = folds.get("full_lifecycle", {}).get("chakra", "").split(",")
    fell_back = any(int(lifecycle[i]) < int(lifecycle[i - 1]) for i in range(1, len(lifecycle)))
    reached_violet = lifecycle and lifecycle[-1] == "7"
    record("S03", "a repair walks the progression back, and the mission still reaches violet",
           fell_back and reached_violet, sequence=",".join(lifecycle))

    # ---------------------------------------------------------------- a block freezes it
    blocked_refused = mission.get_fold_refused_after_ending() if mission else -1
    blocked_summary = folds.get("blocked", {}).get("summary", "")
    refused_ok = "refused_ended=%d" % EXPECTED_REFUSED_AFTER_ENDING["blocked"] in blocked_summary
    record("S04", "a block freezes progression and refuses everything that would advance it",
           refused_ok, expected=EXPECTED_REFUSED_AFTER_ENDING["blocked"], summary=blocked_summary)

    # ---------------------------------------------------------------- the next mission starts at red
    two = folds.get("two_missions", {}).get("chakra", "").split(",")
    restarted = len(two) >= 8 and two[5] == "7" and two[6] == "1"
    record("S05", "one mission reaches violet and the next begins at red",
           restarted, sequence=",".join(two))

    # ---------------------------------------------------------------- missions are isolated
    crossed_summary = folds.get("crossed", {}).get("summary", "")
    isolated = "foreign=%d" % EXPECTED_FOREIGN["crossed"] in crossed_summary
    record("S06", "an event for one Mission Contract cannot move another",
           isolated, expected=EXPECTED_FOREIGN["crossed"], summary=crossed_summary)

    # ---------------------------------------------------------------- the gaps stay declared
    gap_beats = ["idle", "approval_continue", "handoff"]
    gaps = {b: str(mission.get_beat_not_yet_emitted(b))[:80] for b in gap_beats} if mission else {}
    all_declared = all(gaps.get(b) for b in gap_beats)
    simulated_in_lifecycle = "simulated=" in folds.get("full_lifecycle", {}).get("summary", "")
    RESULT["declared_gaps"] = gaps
    record("S07", "the three states Julius cannot emit are still declared, and counted when shown",
           all_declared and simulated_in_lifecycle, gaps=list(gaps), summary=folds.get("full_lifecycle", {}).get("summary", ""))

    # ---------------------------------------------------------------- film it
    # NOTHING IS TYPED BY HAND FROM HERE. One console-free call starts the fixture, and every beat after
    # this point arrives because an event arrived.
    say("filming %s at %.2f s/event" % (FILMED, PACE))
    started = mission.start_fixture(FILMED, PACE)
    frames = []
    seen_steps = []
    manifested_at = None
    deadline = time.time() + 90.0
    index = 0
    while time.time() < deadline:
        yield PACE / float(FRAMES_PER_EVENT)
        step = mission.get_chakra_step()
        here = mission.is_orb_in_world()
        if here and manifested_at is None:
            manifested_at = mission.get_last_event_type()
        seen_steps.append(step)
        at = mission.get_orb_location()
        frames.append({"i": index, "beat": str(mission.get_beat_id()), "step": step,
                       "event": str(mission.get_last_event_type()), "contract": bool(here),
                       "screen": to_screen(at) if here else None,
                       "capture": shot("zc_m3b_%03d.png" % index)})
        index += 1
        if not mission.is_fixture_running() and not here:
            break
    RESULT["film"] = frames
    RESULT["first_contract_event"] = str(manifested_at)
    peak = max(seen_steps) if seen_steps else 0
    record("S08", "the fixture drove the whole thing with nothing typed by hand",
           started and peak == 7 and len(frames) > 10,
           started=started, frames=len(frames), peak_chakra=peak, first_event=str(manifested_at))

    # ---------------------------------------------------------------- and it went away again
    yield 1.0
    record("S09", "when the mission finished the contract was dismissed",
           not mission.is_orb_in_world() and mission.get_contracts_manifested() >= 1,
           contract=mission.is_orb_in_world(), manifested=mission.get_contracts_manifested(),
           capture=shot("zc_m3b_zz_dismissed.png"))

    # ---------------------------------------------------------------- what it costs
    # The simulator is a ticker reading a table, so this measures the contract AND the adapter together
    # against a world with neither.
    samples = {"running": [], "quiet": []}
    for _ in range(3):
        mission.start_fixture("full_lifecycle", 0.25)
        yield 1.2
        f0, t0 = unreal.SystemLibrary.get_frame_count(), time.time()
        yield 3.5
        samples["running"].append((unreal.SystemLibrary.get_frame_count() - f0) / (time.time() - t0))
        mission.stop_fixture()
        mission.set_beat_by_id("idle")
        yield 1.2
        f0, t0 = unreal.SystemLibrary.get_frame_count(), time.time()
        yield 3.5
        samples["quiet"].append((unreal.SystemLibrary.get_frame_count() - f0) / (time.time() - t0))
    fps_run = sum(samples["running"]) / max(len(samples["running"]), 1)
    fps_quiet = sum(samples["quiet"]) / max(len(samples["quiet"]), 1)
    ms_run = 1000.0 / fps_run if fps_run > 0 else None
    ms_quiet = 1000.0 / fps_quiet if fps_quiet > 0 else None
    RESULT["perf"] = {"fps_running": round(fps_run, 2), "fps_quiet": round(fps_quiet, 2),
                      "ms_running": None if ms_run is None else round(ms_run, 2),
                      "ms_quiet": None if ms_quiet is None else round(ms_quiet, 2),
                      "cost_ms": None if (ms_run is None or ms_quiet is None) else round(ms_run - ms_quiet, 2),
                      "throttled": fps_quiet < 10.0, "samples": samples}
    record("S10", "the contract and the simulator together cost under 10% of the frame",
           fps_quiet > 0 and fps_run >= 0.9 * fps_quiet, **RESULT["perf"])

    mission.stop_fixture()
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    L.set_background_throttle_suspended(False)
    RESULT["passed"] = sum(1 for t in tests if t["pass"])
    RESULT["failed"] = [t["id"] for t in tests if not t["pass"]]
    RESULT["status"] = "done"
