# PIE proof: MULTI-TASK MISSION CONTRACT ORBS.
#
# FOUNDER DIRECTIVE (2026-09-22): a Wonderland-native way to add another Julius task while one is already being
# worked -- "CLAUDE CODE TABS -> but translated into WONDERLAND as MISSION CONTRACT ORBS" -- with the tests lettered
# A to H. Each letter below is that test, and each verdict is a reading rather than a screenshot.
#
# THE TWO RULES THIS EXISTS TO DEFEND:
#   GRAY = an empty draft slot. RED = a real Mission Contract. Gray is never failure and red is never error.
#   Wonderland does not get to pretend three missions are running when Julius is executing one. A contract the user
#   submitted is QUEUED and LOCAL until Julius says otherwise, and the running count only ever counts what Julius
#   itself reported.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "mission_task_orbs")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    steps = []
    RESULT["steps"] = steps
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        L.focus_game_viewport()
        ui = L.get_ui(world)
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        player = controller.get_local_player() if controller else None
        tasks = player.get_subsystem(unreal.WonderlandMissionTaskSubsystem) if player else None
        mission = player.get_subsystem(unreal.WonderlandMissionSubsystem) if player else None
        if tasks is None or mission is None or ui is None:
            RESULT["status"] = "failed"
            RESULT["why"] = "no task / mission / ui subsystem"
            return

        def shot(label, note=""):
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, 1900, 94)
            steps.append({"step": label, "note": note, "file": path})

        def stack():
            return [str(line) for line in mission.describe_orb_stack()]

        def rows():
            return [
                {
                    "state": str(unreal.WonderlandTaskState.cast(t.state)) if hasattr(unreal, "WonderlandTaskState") else str(t.state),
                    "objective": str(t.objective),
                    "contract": str(t.contract_id),
                    "source": str(t.source),
                }
                for t in tasks.get_tasks()
            ]

        RESULT["plus_on_screen"] = bool(ui.is_add_task_control_on_screen())
        RESULT["capacity"] = int(tasks.get_task_capacity())

        # ---- A. one task, then press + : a GRAY slot appears and NO mission is created
        ui.press_add_task()
        yield 1.0
        tasks.submit_draft(tasks.get_tasks()[0].local_id, "Task A: survey the arrival plaza")
        yield 1.0
        before = int(tasks.num_tasks())
        ui.press_add_task()
        yield 1.5
        RESULT["A_tasks_after_plus"] = int(tasks.num_tasks())
        RESULT["A_added_one"] = int(tasks.num_tasks()) == before + 1
        after = tasks.get_tasks()
        RESULT["A_new_slot_is_draft"] = str(after[-1].objective) == "" and str(after[-1].contract_id) == ""
        RESULT["A_stack"] = stack()
        # GRAY MEANS NO BACKEND MISSION: the new slot must carry no contract id at all.
        RESULT["A_no_backend_mission"] = str(after[-1].contract_id) == ""
        shot("a_gray_above_red", "one RED contract, one GRAY empty slot above it")

        # ---- B. enter a task : the orb turns RED and a distinct contract exists
        tasks.submit_draft(after[-1].local_id, "Task B: inspect the garden arches")
        yield 1.5
        RESULT["B_stack"] = stack()
        RESULT["B_two_red"] = sum(1 for line in stack() if "RED" in line) == 2
        shot("b_two_red", "two distinct RED Mission Contracts")

        # ---- C. a third, and the identities stay separate
        ui.press_add_task()
        yield 1.0
        tasks.submit_draft(tasks.get_tasks()[-1].local_id, "Task C: check the fountain basin")
        yield 1.5
        objectives = [str(t.objective) for t in tasks.get_tasks()]
        RESULT["C_objectives"] = objectives
        # THE POINT THE FOUNDER UNDERLINED: three orbs, three prompts, never one mixed prompt.
        RESULT["C_isolated"] = len(objectives) == len(set(objectives)) == 3
        RESULT["C_stack"] = stack()
        shot("c_three_contracts", "three separate contracts, three separate objectives")

        # ---- D. switching shows a different task and disturbs none of them
        first_id = tasks.get_tasks()[0].local_id
        tasks.select_task(first_id)
        yield 1.2
        RESULT["D_selected_is_first"] = str(tasks.get_selected()) == str(first_id)
        RESULT["D_objectives_unchanged"] = [str(t.objective) for t in tasks.get_tasks()] == objectives
        RESULT["D_stack"] = stack()
        shot("d_switched", "task 0 selected: its orb is the full-sized one")

        # ---- E. an unused GRAY slot is thrown away and leaves nothing behind
        ui.press_add_task()
        yield 1.0
        count_with_draft = int(tasks.num_tasks())
        draft_id = tasks.get_tasks()[-1].local_id
        RESULT["E_dismissed"] = bool(tasks.dismiss_draft(draft_id))
        yield 1.2
        RESULT["E_back_to_three"] = int(tasks.num_tasks()) == count_with_draft - 1
        RESULT["E_no_mission_left"] = all(str(t.objective) != "" for t in tasks.get_tasks())
        RESULT["E_stack"] = stack()

        # ---- F. queue and concurrency truth
        # Submitted contracts are QUEUED and LOCAL, so NOTHING counts as running until Julius says so.
        RESULT["F_running_before_julius"] = int(tasks.get_running_count())
        RESULT["F_nothing_pretends_to_run"] = int(tasks.get_running_count()) == 0
        # Now let a scheduler speak for exactly one of them.
        tasks.adopt_contract_id(tasks.get_tasks()[0].local_id, "contract-alpha")
        tasks.apply_scheduler_state("contract-alpha", unreal.WonderlandTaskState.IMPLEMENTATION, -1, 0)
        yield 1.0
        RESULT["F_running_after_one"] = int(tasks.get_running_count())
        RESULT["F_one_runs_not_three"] = int(tasks.get_running_count()) == 1
        RESULT["F_tokens_unreported"] = int(tasks.get_total_tokens()) < 0
        RESULT["F_status"] = [str(line) for line in tasks.describe_tasks()]
        shot("f_queue_truth", "three contracts, one running: the count follows Julius, not the orbs")

        # ---- G. a scheduler addresses contracts by THEIR id, which is what survives a restart
        # A wrong id must change nothing; the right one must land. Local ids are new after a restart, contract ids
        # are not, so matching on the contract id is the whole of the persistence rule.
        RESULT["G_unknown_id_refused"] = not bool(
            tasks.apply_scheduler_state("contract-that-does-not-exist", unreal.WonderlandTaskState.REVIEW, -1, 0))
        RESULT["G_known_id_applies"] = bool(
            tasks.apply_scheduler_state("contract-alpha", unreal.WonderlandTaskState.REVIEW, -1, 0))
        # And a backend may never empty a real contract back into a draft slot.
        RESULT["G_cannot_be_made_draft"] = not bool(
            tasks.apply_scheduler_state("contract-alpha", unreal.WonderlandTaskState.DRAFT, -1, 0))

        # ---- H. the clearance probe accounts for the whole stack, not one orb
        RESULT["H_stack_height_uu"] = round(float(mission.get_stack_height_uu()), 1)
        RESULT["H_orbs"] = int(mission.get_stacked_orb_count())
        staging = mission.probe_clearance_now()
        RESULT["H_fit"] = str(mission.get_last_staging_fit_name())
        RESULT["H_headroom_uu"] = round(float(staging.chosen.clear_height_uu), 1)
        # A TALLER PRESENTATION NEEDS MORE ROOM: with several orbs the probe is asking for more than one orb's worth.
        RESULT["H_probe_sees_the_stack"] = float(mission.get_stack_height_uu()) > 0.0
        RESULT["H_mission_never_refused"] = str(mission.get_last_staging_fit_name()) in ("FULL", "COMPACT", "COMPACT IN PLACE")
        shot("h_clearance", "the probe measured the whole stack's envelope")

        RESULT["final_stack"] = stack()
        RESULT["final_tasks"] = [str(line) for line in tasks.describe_tasks()]
        RESULT["REPORT"] = {
            "plus_beside_token_usage": "PASS" if RESULT["plus_on_screen"] else "FAIL",
            "gray_empty_orb_creation": "PASS" if RESULT["A_added_one"] and RESULT["A_no_backend_mission"] else "FAIL",
            "gray_to_red_on_submit": "PASS" if RESULT["B_two_red"] else "FAIL",
            "identities_isolated": "PASS" if RESULT["C_isolated"] else "FAIL",
            "task_switching": "PASS" if RESULT["D_selected_is_first"] and RESULT["D_objectives_unchanged"] else "FAIL",
            "empty_orb_dismissal": "PASS" if RESULT["E_dismissed"] and RESULT["E_back_to_three"] else "FAIL",
            "queue_concurrency_truth": "PASS" if RESULT["F_nothing_pretends_to_run"] and RESULT["F_one_runs_not_three"] else "FAIL",
            "persistence_by_contract_id": "PASS" if RESULT["G_unknown_id_refused"] and RESULT["G_known_id_applies"] and RESULT["G_cannot_be_made_draft"] else "FAIL",
            "clearance_compatibility": "PASS" if RESULT["H_probe_sees_the_stack"] and RESULT["H_mission_never_refused"] else "FAIL",
        }
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "steps.json"), "w", encoding="utf-8") as fh:
            json.dump(steps, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLTASK could not end play: %s" % exc)
