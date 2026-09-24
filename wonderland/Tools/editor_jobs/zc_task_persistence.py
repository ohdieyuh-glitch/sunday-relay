# PIE PROOF: MISSION CONTRACTS SURVIVE A RESTART, AND A DRAFT DOES NOT.
#
# FOUNDER'S EIGHT CHECKS, in the founder's own order and wording:
#   P1  submit a real Mission Contract, restart, the contract returns
#   P2  create a GRAY draft, restart, the draft does NOT return
#   P3  multiple submitted contracts survive with SEPARATE identities
#   P4  a previously IMPLEMENTATION contract restores unconfirmed/local, NOT falsely live
#   P5  GetRunningCount() is zero until Julius reports
#   P6  scheduler state arriving after restart reconnects through the backend contract id
#   P7  objectives / evidence / token state do not LEAK between restored contracts
#   P8  the development reset removes test state deliberately and logs that it is a development reset
#
# THIS IS A REAL RESTART. PIE is ended and begun again, so the LocalPlayer subsystem is torn down and
# re-Initialized exactly as it would be on a fresh launch. Restoring from memory would prove nothing at all.
#
# AND P4 IS THE ONE THAT MATTERS. If persistence could manufacture a running mission out of a file, every other
# guarantee in this feature would be worth nothing -- the whole point of the colour rule and the running count is
# that Wonderland never claims more than a backend has actually said.
import json
import os

L = unreal.WonderlandUiTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "task_persistence")

# Two contracts, deliberately given DIFFERENT everything, so a leak between them is visible rather than plausible.
A_OBJECTIVE = "Contract one: survey the arrival plaza"
B_OBJECTIVE = "Contract two: inspect the garden arches"
A_TOKENS, A_EVIDENCE = 12345, 3
B_TOKENS, B_EVIDENCE = 678, 1
A_REFS = ["evidence/alpha-1.md", "evidence/alpha-2.png", "evidence/alpha-3.json"]
B_REFS = ["evidence/beta-1.md"]


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    S = unreal.WonderlandMissionTaskSubsystem
    try:
        # ================================================= SESSION ONE: build a set worth restoring
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
        # Start from a clean board so this measures a set it built, not one it inherited.
        tasks.clear_all_tasks_for_development()
        yield 0.5

        ui.press_add_task()
        yield 0.6
        tasks.submit_draft(tasks.get_task_list()[0].local_id, A_OBJECTIVE)
        yield 0.6
        ui.press_add_task()
        yield 0.6
        tasks.submit_draft(tasks.get_task_list()[1].local_id, B_OBJECTIVE)
        yield 0.6
        ui.press_add_task()                      # the GRAY DRAFT, left empty on purpose
        yield 1.0
        RESULT["before_slot_count"] = int(tasks.num_tasks())
        RESULT["before_has_draft"] = any(not str(t.objective) for t in tasks.get_task_list())

        # Two backend identities, two different live states, two different accounts.
        rows = tasks.get_task_list()
        tasks.adopt_contract_id(rows[0].local_id, "contract-alpha")
        tasks.adopt_contract_id(rows[1].local_id, "contract-beta")
        yield 0.4
        tasks.apply_scheduler_state("contract-alpha", unreal.WonderlandTaskState.IMPLEMENTATION, A_TOKENS, A_EVIDENCE)
        tasks.apply_scheduler_state("contract-beta", unreal.WonderlandTaskState.REVIEW, B_TOKENS, B_EVIDENCE)
        tasks.report_evidence("contract-alpha", A_REFS)
        tasks.report_evidence("contract-beta", B_REFS)
        yield 1.0
        tasks.select_task(tasks.get_task_list()[1].local_id)
        yield 1.0

        def snapshot(subsystem):
            out = []
            for t in subsystem.get_task_list():
                out.append({
                    "objective": str(t.objective),
                    "contract": str(t.contract_id),
                    "state": str(t.state).upper(),
                    "source": str(t.source).upper(),
                    "tokens": int(t.tokens_used),
                    "evidence_count": int(t.evidence_count),
                    "evidence_ids": [str(e) for e in t.evidence_ids],
                    "local": str(t.local_id),
                    "lifecycle_tail": str(t.lifecycle[-1]) if len(t.lifecycle) else "",
                })
            return out

        RESULT["before"] = snapshot(tasks)
        RESULT["before_running"] = int(tasks.get_running_count())
        RESULT["before_selected_objective"] = str(
            next((t.objective for t in tasks.get_task_list() if str(t.local_id) == str(tasks.get_selected())), ""))
        RESULT["saved_file_exists_before_restart"] = bool(S.has_saved_contracts())

        # ================================================= THE RESTART
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
        RESULT["after"] = snapshot(tasks2)
        after = RESULT["after"]
        by_contract = {r["contract"]: r for r in after}
        A = by_contract.get("contract-alpha")
        B = by_contract.get("contract-beta")

        # ---- P1: a real contract returns
        RESULT["P1_contract_returned"] = A is not None and A["objective"] == A_OBJECTIVE

        # ---- P2: the draft does not. An abandoned empty slot leaves no durable history.
        RESULT["P2_draft_did_not_return"] = len(after) == 2 and all(r["objective"] for r in after)

        # ---- P3: both survived, with identities that did not merge or swap
        RESULT["P3_both_survived"] = A is not None and B is not None
        RESULT["P3_identities_separate"] = bool(
            A and B
            and A["objective"] == A_OBJECTIVE and B["objective"] == B_OBJECTIVE
            and A["contract"] != B["contract"]
            and A["local"] != B["local"])
        # And the local handle is a SESSION handle: new every launch, which is why the contract id has to exist.
        locals_before = {r["local"] for r in RESULT["before"]}
        RESULT["P3_local_ids_are_new"] = all(r["local"] not in locals_before for r in after)

        # ---- P4: IMPLEMENTATION is remembered, but not as a live claim
        # SUBSTRING, NOT endswith. Python renders a reflected UENUM as "WonderlandTaskState.IMPLEMENTATION: 4>",
        # so the value ends in the enum's ordinal and a tail match can never be true. The first run of this proof
        # reported P4 FAIL on exactly that while the product was behaving correctly -- an assertion that cannot
        # pass is a worse defect than the one it was looking for, because it reads as a real failure.
        RESULT["P4_state_remembered"] = bool(A and "IMPLEMENTATION" in A["state"])
        RESULT["P4_source_is_local"] = bool(A and "JULIUS" not in A["source"])
        RESULT["P4_lifecycle_says_unconfirmed"] = bool(
            A and "RESTORED" in A["lifecycle_tail"].upper() and "UNCONFIRMED" in A["lifecycle_tail"].upper())
        RESULT["P4_restored_unconfirmed_not_live"] = bool(
            RESULT["P4_state_remembered"] and RESULT["P4_source_is_local"]
            and RESULT["P4_lifecycle_says_unconfirmed"])

        # ---- P5: nothing runs on the strength of a file
        RESULT["P5_running_before_julius"] = int(tasks2.get_running_count())
        RESULT["P5_zero_until_julius"] = int(tasks2.get_running_count()) == 0

        # ---- P6: a scheduler reconnects through the durable id, and creates no duplicate
        count_before_report = int(tasks2.num_tasks())
        RESULT["P6_scheduler_reconnected"] = bool(
            tasks2.apply_scheduler_state("contract-alpha", unreal.WonderlandTaskState.VERIFICATION, 20000, 4))
        yield 0.8
        RESULT["P6_no_duplicate_task"] = int(tasks2.num_tasks()) == count_before_report
        reconnected = next((r for r in snapshot(tasks2) if r["contract"] == "contract-alpha"), None)
        RESULT["P6_real_state_applied"] = bool(
            reconnected and "VERIFICATION" in reconnected["state"] and "JULIUS" in reconnected["source"])
        RESULT["P6_running_after_julius"] = int(tasks2.get_running_count())
        RESULT["P6_counts_only_once_told"] = int(tasks2.get_running_count()) == 1

        # ---- P7: nothing leaked between the two contracts across the restart
        RESULT["P7_objectives_did_not_leak"] = bool(
            A and B and A["objective"] == A_OBJECTIVE and B["objective"] == B_OBJECTIVE)
        RESULT["P7_tokens_did_not_leak"] = bool(
            A and B and A["tokens"] == A_TOKENS and B["tokens"] == B_TOKENS)
        RESULT["P7_evidence_counts_did_not_leak"] = bool(
            A and B and A["evidence_count"] == A_EVIDENCE and B["evidence_count"] == B_EVIDENCE)
        RESULT["P7_evidence_refs_did_not_leak"] = bool(
            A and B and A["evidence_ids"] == A_REFS and B["evidence_ids"] == B_REFS)
        RESULT["P7_no_leak"] = bool(
            RESULT["P7_objectives_did_not_leak"] and RESULT["P7_tokens_did_not_leak"]
            and RESULT["P7_evidence_counts_did_not_leak"] and RESULT["P7_evidence_refs_did_not_leak"])

        # ---- and the view came back where it was left
        sel = str(tasks2.get_selected())
        RESULT["after_selected_objective"] = str(
            next((t.objective for t in tasks2.get_task_list() if str(t.local_id) == sel), ""))
        RESULT["selection_restored"] = (
            RESULT["after_selected_objective"] == RESULT["before_selected_objective"])

        # ---- P8: the development reset is deliberate, complete, and says what it is
        # The log line itself is checked outside this job against the editor log, because a job asserting on its
        # own log output would be marking its own homework.
        RESULT["P8_closed"] = int(tasks2.clear_all_tasks_for_development())
        yield 0.6
        RESULT["P8_slots_empty"] = int(tasks2.num_tasks()) == 0
        RESULT["P8_file_gone"] = not bool(S.has_saved_contracts())
        RESULT["P8_reset_is_deliberate"] = bool(
            RESULT["P8_closed"] > 0 and RESULT["P8_slots_empty"] and RESULT["P8_file_gone"])

        RESULT["task_status_after_restart"] = [str(line) for line in tasks2.describe_tasks()]
        RESULT["REPORT"] = {
            "P1_contract_survives_restart": "PASS" if RESULT["P1_contract_returned"] else "FAIL",
            "P2_draft_leaves_no_history": "PASS" if RESULT["P2_draft_did_not_return"] else "FAIL",
            "P3_separate_identities_survive": "PASS" if (
                RESULT["P3_both_survived"] and RESULT["P3_identities_separate"]
                and RESULT["P3_local_ids_are_new"]) else "FAIL",
            "P4_implementation_restores_unconfirmed": "PASS" if RESULT["P4_restored_unconfirmed_not_live"] else "FAIL",
            "P5_running_count_zero_until_julius": "PASS" if RESULT["P5_zero_until_julius"] else "FAIL",
            "P6_reconnects_by_contract_id": "PASS" if (
                RESULT["P6_scheduler_reconnected"] and RESULT["P6_no_duplicate_task"]
                and RESULT["P6_real_state_applied"] and RESULT["P6_counts_only_once_told"]) else "FAIL",
            "P7_no_state_leak_between_contracts": "PASS" if RESULT["P7_no_leak"] else "FAIL",
            "P8_development_reset_is_deliberate": "PASS" if RESULT["P8_reset_is_deliberate"] else "FAIL",
        }
        RESULT["all_pass"] = all(v == "PASS" for v in RESULT["REPORT"].values())
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "persistence.json"), "w", encoding="utf-8") as fh:
            json.dump({k: RESULT.get(k) for k in
                       ("status", "why", "before", "after", "REPORT", "all_pass",
                        "task_status_after_restart")}, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLPERSIST could not end play: %s" % exc)
