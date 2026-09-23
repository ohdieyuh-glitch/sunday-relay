# THE FOUNDER-VISIBLE PASS: orbs, tabs, the real Dog wearing the skin, the wardrobe window. Photographed.
#
# FOUNDER: "Do not judge these features by registry state, hidden actors, Python assertions ... Judge them by what
# the USER ACTUALLY SEES IN WONDERLAND." So every verdict below has a frame beside it, and the readings are only
# there to say what the frame should contain.
#
# 1. A SESSION WITH SAVED CONTRACTS, then a RESTART: ZERO orbs and ZERO tabs at spawn, the contracts still on
#    record and listed by /tasks as closed. This is the regression the founder respawned into.
# 2. + -> a gray orb appears. Submit -> red. X on a draft -> gone. X on a contract -> tab and orb gone, record
#    kept. /tasks open -> back. Completed -> orb gone, tab kept.
# 3. The wardrobe: the panel opens a WINDOW and the camera frames the founder's own Relay Dog inside it. Each
#    click re-dresses THAT Dog. Frames for Relay OG, Apollo, Arden, Skeleton Flame, Hagoromo, Celestial Light, Bee.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "visible_pass")
SKINS = ["relay_og", "apollo", "arden_infernal", "skeleton_flame", "hagoromo", "celestial_light", "bee"]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    shots = []

    def shot(name, note):
        path = os.path.join(ROOT, "%02d_%s.jpg" % (len(shots) + 1, name))
        H.capture_viewport_jpeg(path, 1900, 95)
        shots.append({"n": len(shots) + 1, "name": name, "note": note})

    def begin():
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0

    def orbs(world):
        return len(unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb))

    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)

        # ================================================= SESSION ONE: leave two contracts on disk
        for step in begin():
            yield step
        world = ues.get_game_world()
        ui, tasks = L.get_ui(world), L.get_mission_tasks(world)
        L.focus_game_viewport()
        tasks.clear_all_tasks_for_development()
        yield 0.5
        ui.press_add_task()
        yield 0.6
        tasks.submit_draft(tasks.get_task_list()[0].local_id, "Survey the arrival plaza")
        yield 0.6
        ui.press_add_task()
        yield 0.6
        tasks.submit_draft(tasks.get_task_list()[1].local_id, "Inspect the garden arches")
        yield 1.5
        RESULT["s1_orbs_with_two_open"] = orbs(world)
        RESULT["s1_saved"] = bool(unreal.WonderlandMissionTaskSubsystem.has_saved_contracts())
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        yield 3.0

        # ================================================= SESSION TWO: the respawn the founder complained about
        for step in begin():
            yield step
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        ui, tasks, mission = L.get_ui(world), L.get_mission_tasks(world), L.get_mission(world)
        L.focus_game_viewport()
        yield 2.0
        RESULT["spawn_orbs"] = orbs(world)
        RESULT["spawn_records"] = int(tasks.num_tasks())
        RESULT["spawn_workspace"] = int(tasks.get_workspace_count())
        RESULT["spawn_records_closed"] = [bool(t.workspace) for t in tasks.get_task_list()]
        at = pawn.get_actor_location()
        fwd = pawn.get_actor_forward_vector()
        L.pose_camera(world, unreal.Vector(at.x - fwd.x * 420.0, at.y - fwd.y * 420.0, at.z + 260.0),
                      unreal.Vector(at.x + fwd.x * 120.0, at.y + fwd.y * 120.0, at.z + 90.0), 70.0)
        yield 1.2
        shot("spawn_no_orbs", "respawn with two contracts on disk: no orbs, no tabs")
        L.release_camera(world)
        ui.toggle_live_terminal()
        yield 1.2
        shot("spawn_terminal_no_tabs", "the terminal after respawn: no task tabs, the record reachable by /tasks")
        ui.handle_terminal_command("/tasks")
        yield 1.0
        shot("spawn_tasks_listed_closed", "/tasks lists both contracts as closed")

        # ================================================= ACTIVATION -> ORB
        ui.press_add_task()
        yield 1.5
        RESULT["plus_orbs"] = orbs(world)
        RESULT["plus_is_gray"] = any("GRAY" in str(s) for s in mission.describe_orb_stack())
        ui.close_overlay()
        yield 0.8
        L.pose_camera(world, unreal.Vector(at.x - fwd.x * 420.0, at.y - fwd.y * 420.0, at.z + 260.0),
                      unreal.Vector(at.x + fwd.x * 120.0, at.y + fwd.y * 120.0, at.z + 90.0), 70.0)
        yield 1.0
        shot("plus_gray_orb_appears", "press +: one gray orb manifests")
        L.release_camera(world)
        draft_id = tasks.get_task_list()[-1].local_id
        tasks.submit_draft(draft_id, "Photograph the clock")
        yield 1.5
        RESULT["submit_orbs"] = orbs(world)

        # ---- X on a draft: gone, nothing left
        ui.toggle_live_terminal()
        yield 0.8
        ui.press_add_task()
        yield 1.0
        before = int(tasks.num_tasks())
        RESULT["x_draft"] = bool(tasks.close_from_workspace(tasks.get_selected()))
        yield 1.0
        RESULT["x_draft_records_after"] = int(tasks.num_tasks())
        RESULT["x_draft_discarded"] = RESULT["x_draft_records_after"] == before - 1
        shot("x_visible_left_of_plus", "the strip: tabs, then [X][+]")

        # ---- X on a contract: tab and orb gone, record kept
        open_before = int(tasks.get_workspace_count())
        orbs_before = orbs(world)
        selected = tasks.get_selected()
        RESULT["x_contract"] = bool(tasks.close_from_workspace(selected))
        yield 1.5
        RESULT["x_contract_records_after"] = int(tasks.num_tasks())
        RESULT["x_contract_workspace_after"] = int(tasks.get_workspace_count())
        RESULT["x_contract_orbs_after"] = orbs(world)
        RESULT["x_contract_truth_kept"] = RESULT["x_contract_records_after"] == RESULT["spawn_records"] + 1
        RESULT["x_contract_tab_and_orb_gone"] = (RESULT["x_contract_workspace_after"] == open_before - 1
                                                 and RESULT["x_contract_orbs_after"] == orbs_before - 1)
        shot("x_closed_contract_tab_gone", "after X on the contract: its tab is gone, the closed count says so")
        ui.handle_terminal_command("/tasks")
        yield 1.0
        shot("tasks_after_close", "/tasks: the closed contract is still on record")
        # ---- and back
        rows = tasks.get_task_list()
        idx = next((i for i, t in enumerate(rows) if not bool(t.workspace) and str(t.objective) == "Photograph the clock"), None)
        if idx is not None:
            ui.handle_terminal_command("/tasks open %d" % (idx + 1))
            yield 1.5
            RESULT["reopen_workspace"] = int(tasks.get_workspace_count())
            RESULT["reopen_orbs"] = orbs(world)
            RESULT["reopened"] = RESULT["reopen_workspace"] == open_before and RESULT["reopen_orbs"] == orbs_before
        shot("tasks_reopened", "/tasks open: the tab and its orb return")

        # ---- completed: orb gone, tab kept
        rows = tasks.get_task_list()
        tgt = next((t for t in rows if bool(t.workspace) and str(t.objective) == "Photograph the clock"), None)
        if tgt is not None:
            tasks.adopt_contract_id(tgt.local_id, "contract-clock")
            tasks.apply_scheduler_state("contract-clock", unreal.WonderlandTaskState.COMPLETED, -1, 0)
            yield 1.5
            RESULT["completed_orbs"] = orbs(world)
            RESULT["completed_workspace"] = int(tasks.get_workspace_count())
            RESULT["completed_orb_gone_tab_kept"] = (RESULT["completed_orbs"] == orbs_before - 1
                                                     and RESULT["completed_workspace"] == open_before)
        shot("completed_tab_kept", "a completed contract keeps its tab; its orb is gone")
        ui.close_overlay()
        yield 1.0

        # ================================================= THE WARDROBE: the founder's own Dog, in the window
        ui.toggle_project_brain()
        yield 1.2
        ui.set_brain_skins_open(True)
        yield 2.2
        RESULT["wardrobe_open"] = bool(ui.is_brain_skins_open())
        worn = []
        for skin in SKINS:
            ui.wear_relay_skin(skin)
            yield 2.0
            row = {"skin": skin,
                   "dog_wears": str(pawn.get_worn_skin_id()) if hasattr(pawn, "get_worn_skin_id") else "?",
                   "costume": bool(pawn.is_wearing_costume()) if hasattr(pawn, "is_wearing_costume") else None}
            worn.append(row)
            shot("wardrobe_%s" % skin, "the wardrobe with %s selected: the Dog in the window wears it" % skin.upper())
        RESULT["worn"] = worn
        RESULT["dog_changed_every_time"] = all(r["dog_wears"] == r["skin"] for r in worn)
        RESULT["og_is_canon_body"] = any(r["skin"] == "relay_og" and r["costume"] is False for r in worn)
        RESULT["others_are_costumes"] = all(r["costume"] for r in worn if r["skin"] != "relay_og")
        ui.wear_relay_skin("apollo")
        yield 1.5
        ui.close_overlay()
        yield 1.5
        L.pose_camera(world, unreal.Vector(at.x + fwd.x * 360.0 + 140.0, at.y + fwd.y * 360.0, at.z + 130.0),
                      unreal.Vector(at.x, at.y, at.z + 90.0), 42.0)
        yield 1.2
        shot("in_world_apollo_after_close", "wardrobe closed: the Dog the founder walks is still Apollo")
        L.release_camera(world)
        ui.wear_relay_skin("relay_og")
        yield 1.0

        RESULT["REPORT"] = {
            "orbs_idle_no_task_state": "PASS" if RESULT["spawn_orbs"] == 0 and RESULT["spawn_workspace"] == 0 else "FAIL",
            "orbs_task_activation_spawn": "PASS" if RESULT["plus_orbs"] == 1 and RESULT["plus_is_gray"] else "FAIL",
            "orbs_close_disappearance": "PASS" if RESULT.get("x_contract_tab_and_orb_gone") else "FAIL",
            "orbs_completion_disappearance": "PASS" if RESULT.get("completed_orb_gone_tab_kept") else "FAIL",
            "orbs_persistence_intact": "PASS" if (RESULT["spawn_records"] == 2 and RESULT.get("x_contract_truth_kept")) else "FAIL",
            "tabs_x_present": "PASS" if RESULT.get("x_draft") is not None else "FAIL",
            "tabs_x_closes_selected": "PASS" if RESULT.get("x_contract_tab_and_orb_gone") else "FAIL",
            "tabs_x_discards_draft": "PASS" if RESULT.get("x_draft_discarded") else "FAIL",
            "tabs_truth_preserved": "PASS" if RESULT.get("x_contract_truth_kept") and RESULT.get("reopened") else "FAIL",
            "skins_click_changes_visible_dog": "PASS" if (RESULT["dog_changed_every_time"] and RESULT["others_are_costumes"]
                                                          and RESULT["og_is_canon_body"]) else "FAIL",
            # NOT A VERDICT, BECAUSE THIS JOB CANNOT SEE. This line used to read
            #   "skins_dead_white_preview_gone": "PASS" if RESULT["wardrobe_open"] else "FAIL"
            # which asserts only that the panel OPENED -- it never looked at one pixel of the window. It reported
            # PASS while the window was a dead navy rectangle with no Dog in it, under a caption saying the Dog was
            # live in the world. A flag that never reached the rendering path must not speak for the rendering
            # path, so this states what it actually knows and leaves the verdict to the photograph.
            "skins_preview_window_verdict": "SEE wardrobe_*.jpg -- judged by eye, not asserted here",
            "skins_wardrobe_opened": "PASS" if RESULT["wardrobe_open"] else "FAIL",
        }
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "visible.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        with open(os.path.join(ROOT, "shots.json"), "w", encoding="utf-8") as fh:
            json.dump(shots, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLVISIBLE could not end play: %s" % exc)
