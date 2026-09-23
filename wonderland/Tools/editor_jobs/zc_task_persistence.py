# PIE PROOF: MISSION CONTRACTS SURVIVE A RESTART, AND A DRAFT DOES NOT.
#
# FOUNDER DIRECTIVE, the persistence section: a contract's identity belongs to whoever is running it, so what has
# to survive a restart is the CONTRACT id rather than this session's handle on it -- which is why
# ApplySchedulerState matches on the contract id and not the local one.
#
# THIS IS A REAL RESTART, NOT A SIMULATED ONE. PIE is ended and begun again, so the LocalPlayer subsystem is torn
# down and re-Initialized exactly as it would be on a fresh launch. Restoring from memory would prove nothing.
#
# AND THE SHARP TEST IS P4. A contract saved while Julius reported IMPLEMENTATION must NOT come back claiming
# Julius is still working it -- nobody has said anything this session. If persistence could manufacture a running
# mission out of a file, every other guarantee in this feature would be worth nothing.
import json
import os

L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "task_persistence")


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        # ============================================================ SESSION ONE
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 4.0
        world = ues.get_game_world()
        ui, tasks = L.get_ui(world), L.get_mission_tasks(world)
        if not (ui and tasks):
            RESULT["status"] = "failed"
            RESULT["why"] = "no ui / task subsystem"
            return
        tasks.clear_all_tasks_for_development()
        yield 0.5

        # Two real contracts, one given a backend identity and a running state, plus an empty draft.
        ui.press_add_task()
        yield 0.6
        tasks.submit_draft(tasks.get_task_list()[0].local_id, "Contract one: survey the arrival plaza")
        yield 0.6
        ui.press_add_task()
        yield 0.6
        tasks.submit_draft(tasks.get_task_list()[1].local_id, "Contract two: inspect the garden arches")
        yield 0.6
        ui.press_add_task()                       # the DRAFT, left empty on purpose
        yield 1.0

        rows = tasks.get_task_list()
        tasks.adopt_contract_id(rows[0].local_id, "contract-alpha")
        tasks.apply_scheduler_state("contract-alpha", unreal.WonderlandTaskState.IMPLEMENTATION, -1, 0)
        yield 0.8
        tasks.select_task(tasks.get_task_list()[1].local_id)
        yield 1.0

        before = tasks.get_task_list()
        RESULT["before"] = [{"objective": str(t.objective), "contract": str(t.contract_id),
                             "state": str(t.state), "source": str(t.source), "local": str(t.local_id)}
                            for t in before]
        RESULT["before_running"] = int(tasks.get_running_count())
        RESULT["before_selected_objective"] = str(
            next((t.objective for t in before if str(t.local_id) == str(tasks.get_selected())), ""))
        RESULT["saved_file_exists"] = bool(unreal.WonderlandMissionTaskSubsystem.has_saved_contracts())

        # ============================================================ THE RESTART
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        yield 3.0
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 300)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 4.0

        world = ues.get_game_world()
        tasks2 = L.get_mission_tasks(world)
        if not tasks2:
            RESULT["status"] = "failed"
            RESULT["why"] = "no task subsystem after restart"
            return
        after = tasks2.get_task_list()
        RESULT["after"] = [{"objective": str(t.objective), "contract": str(t.contract_id),
                            "state": str(t.state), "source": str(t.source), "local": str(t.local_id),
                            "lifecycle_tail": str(t.lifecycle[-1]) if len(t.lifecycle) else ""}
                           for t in after]

        objs_before = [r["objective"] for r in RESULT["before"] if r["objective"]]
        objs_after = [str(t.objective) for t in after]

        # ---- P1/P2: the contracts came back, with their backend identities intact
        RESULT["P1_contracts_restored"] = objs_after == objs_before
        RESULT["P2_contract_id_survived"] = any(str(t.contract_id) == "contract-alpha" for t in after)

        # ---- P6: the DRAFT did not. An abandoned empty slot leaves no history.
        RESULT["P6_draft_not_restored"] = len(after) == len(objs_before) and all(str(t.objective) for t in after)

        # ---- P3: new handles for a new session, which is what the whole contract-id design rests on
        locals_before = {r["local"] for r in RESULT["before"]}
        RESULT["P3_local_ids_are_new"] = all(str(t.local_id) not in locals_before for t in after)

        # ---- P4: NOTHING runs on the strength of a file
        RESULT["after_running"] = int(tasks2.get_running_count())
        RESULT["P4_nothing_runs_from_disk"] = int(tasks2.get_running_count()) == 0
        RESULT["P4_sources_all_local"] = all("JULIUS" not in str(t.source).upper() for t in after)
        RESULT["P4_state_remembered"] = any("IMPLEMENTATION" in str(t.state).upper() for t in after)
        RESULT["P4_says_unconfirmed"] = any(
            "RESTORED" in (str(t.lifecycle[-1]).upper() if len(t.lifecycle) else "") for t in after)

        # ---- P5: and a scheduler can still find it by the only name that outlived the restart
        RESULT["P5_scheduler_reaches_it"] = bool(
            tasks2.apply_scheduler_state("contract-alpha", unreal.WonderlandTaskState.REVIEW, -1, 0))
        yield 0.5
        RESULT["P5_running_after_julius_spoke"] = int(tasks2.get_running_count())
        RESULT["P5_it_runs_only_once_told"] = int(tasks2.get_running_count()) == 1

        # ---- P7: and you came back to the task you left on
        sel = str(tasks2.get_selected())
        RESULT["after_selected_objective"] = str(
            next((t.objective for t in tasks2.get_task_list() if str(t.local_id) == sel), ""))
        RESULT["P7_selection_restored"] = (
            RESULT["after_selected_objective"] == RESULT["before_selected_objective"])

        # ---- P8: and it can be forgotten
        RESULT["P8_forgotten"] = bool(unreal.WonderlandMissionTaskSubsystem.forget_saved_contracts())
        RESULT["P8_file_gone"] = not bool(unreal.WonderlandMissionTaskSubsystem.has_saved_contracts())

        RESULT["task_status"] = [str(line) for line in tasks2.describe_tasks()]
        RESULT["REPORT"] = {
            "contracts_survive_restart": "PASS" if RESULT["P1_contracts_restored"] else "FAIL",
            "contract_id_is_what_survives": "PASS" if RESULT["P2_contract_id_survived"] else "FAIL",
            "local_ids_are_session_handles": "PASS" if RESULT["P3_local_ids_are_new"] else "FAIL",
            "no_running_mission_from_a_file": "PASS" if (
                RESULT["P4_nothing_runs_from_disk"] and RESULT["P4_sources_all_local"]
                and RESULT["P4_says_unconfirmed"]) else "FAIL",
            "scheduler_reaches_a_restored_contract": "PASS" if (
                RESULT["P5_scheduler_reaches_it"] and RESULT["P5_it_runs_only_once_told"]) else "FAIL",
            "abandoned_draft_leaves_no_history": "PASS" if RESULT["P6_draft_not_restored"] else "FAIL",
            "selection_restored": "PASS" if RESULT["P7_selection_restored"] else "FAIL",
            "saved_set_can_be_forgotten": "PASS" if (RESULT["P8_forgotten"] and RESULT["P8_file_gone"]) else "FAIL",
        }
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "persistence.json"), "w", encoding="utf-8") as fh:
            json.dump({k: RESULT.get(k) for k in
                       ("status", "why", "before", "after", "REPORT", "task_status")}, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLPERSIST could not end play: %s" % exc)
