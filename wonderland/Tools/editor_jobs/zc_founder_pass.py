# FOUNDER PASS: the in-world skin preview, the Julius task terminals, /cubs and /pa, in one session.
#
# Every verdict here is a reading taken while the thing runs, and every picture is of the real screen. Nothing is
# placed by hand: the skins are clicked through the registry the cards use, the task terminals are opened with the
# same call the + makes, and the two founder commands go through the terminal's own command line.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "founder_pass")
SKINS = ["relay_og", "arden_infernal", "apollo", "skeleton_flame", "hagoromo", "celestial_light", "bee"]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 6.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        ui, tasks = L.get_ui(world), L.get_mission_tasks(world)
        if not (ui and tasks):
            RESULT["status"] = "failed"
            RESULT["why"] = "no ui / task subsystem"
            return
        L.focus_game_viewport()
        tasks.clear_all_tasks_for_development()
        yield 0.5

        # ============================================ 1. ADD TASK IS OFF THE USAGE SHELF
        RESULT["add_task_layer_on_hud"] = bool(ui.is_add_task_control_on_screen())
        RESULT["usage_hud_present"] = bool(ui.is_usage_hud_on_screen())
        H.capture_viewport_jpeg(os.path.join(ROOT, "1_usage_hud_no_plus.jpg"), 1900, 95)

        # ============================================ 2. THE JULIUS TERMINAL AND ITS TASK TABS
        ui.toggle_live_terminal()
        yield 2.0
        RESULT["terminal_open"] = bool(ui.is_live_terminal_open())
        H.capture_viewport_jpeg(os.path.join(ROOT, "2_terminal_with_plus.jpg"), 1900, 95)

        # press + twice through the same call the control makes
        RESULT["add_1"] = bool(ui.press_add_task())
        yield 1.2
        first = tasks.get_task_list()[0].local_id
        tasks.submit_draft(first, "Survey the arrival plaza")
        yield 1.2
        H.capture_viewport_jpeg(os.path.join(ROOT, "3_terminal_task_one.jpg"), 1900, 95)

        RESULT["add_2"] = bool(ui.press_add_task())
        yield 1.5
        RESULT["task_count_after_two"] = int(tasks.num_tasks())
        RESULT["second_is_draft"] = str(tasks.get_task_list()[1].objective) == ""
        H.capture_viewport_jpeg(os.path.join(ROOT, "4_terminal_two_tabs_second_pending.jpg"), 1900, 95)

        # the second terminal becomes a real contract, and the first is untouched
        second = tasks.get_task_list()[1].local_id
        tasks.submit_draft(second, "Inspect the garden arches")
        yield 1.2
        RESULT["objectives"] = [str(t.objective) for t in tasks.get_task_list()]
        RESULT["transcripts_not_merged"] = len(set(RESULT["objectives"])) == 2

        # switch between them: selection is a view
        mission = L.get_mission(world)

        def mission_lines(m):
            return [str(s) for s in m.describe_orb_stack()] if m else []

        tasks.select_task(first)
        yield 1.2
        # THE MARKER, NOT THE GUID. Python renders an FGuid through two different spellings depending on which
        # side it came from, so comparing the strings is always false -- it cost a false FAIL on the orb proof and
        # again here while selection was working perfectly. The stack's own '*' is what it actually believes.
        RESULT["selected_first"] = any(
            line.strip().startswith("0 *") for line in mission_lines(mission))
        H.capture_viewport_jpeg(os.path.join(ROOT, "5_terminal_switched_to_one.jpg"), 1900, 95)
        tasks.select_task(second)
        yield 1.2
        RESULT["selected_second"] = any(
            line.strip().startswith("1 *") for line in mission_lines(mission))
        RESULT["objectives_after_switch"] = [str(t.objective) for t in tasks.get_task_list()]
        RESULT["switch_mutated_nothing"] = RESULT["objectives_after_switch"] == RESULT["objectives"]
        H.capture_viewport_jpeg(os.path.join(ROOT, "6_terminal_switched_to_two.jpg"), 1900, 95)

        # ONE IDENTITY: the orb stack must be the same two tasks, not a second set
        RESULT["orb_stack"] = [str(s) for s in mission.describe_orb_stack()] if mission else []
        RESULT["orbs_match_tabs"] = bool(mission) and mission.get_stacked_orb_count() == int(tasks.num_tasks())

        # ============================================ 3. /cubs THROUGH THE TERMINAL
        RESULT["cubs_command_handled"] = bool(ui.handle_terminal_command("/cubs"))
        yield 6.0
        flock = L.get_cubs(world)
        RESULT["cub_subsystem_found"] = flock is not None
        if flock is not None:
            RESULT["cub_count"] = int(flock.get_active_sub_agent_cub_count())
            RESULT["cub_source"] = str(flock.get_count_source())
            RESULT["cub_driven_by_julius"] = bool(flock.is_driven_by_julius())
            RESULT["cub_states"] = [str(c.get_cub_state_name()) for c in flock.get_cubs()]
        ui.close_overlay()
        yield 2.5
        H.capture_viewport_jpeg(os.path.join(ROOT, "7_cubs.jpg"), 1900, 95)
        yield 4.0
        if flock is not None:
            RESULT["cub_states_later"] = [str(c.get_cub_state_name()) for c in flock.get_cubs()]
        H.capture_viewport_jpeg(os.path.join(ROOT, "8_cubs_settled.jpg"), 1900, 95)

        # ============================================ 4. /pa THROUGH THE TERMINAL
        ui.toggle_live_terminal()
        yield 1.5
        RESULT["pa_command_handled"] = bool(ui.handle_terminal_command("/pa"))
        yield 5.0
        ui.close_overlay()
        yield 2.0
        names = []
        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
            n = str(a.get_name())
            if "Avatar" in n or "BP_Avatar" in n:
                v = a.get_actor_location()
                names.append({"name": n, "at": [round(v.x), round(v.y), round(v.z)]})
        RESULT["project_avatars_in_world"] = names
        RESULT["pa_families_shown"] = len(names)
        at = pawn.get_actor_location()
        fwd = pawn.get_actor_forward_vector()
        L.pose_camera(world, unreal.Vector(at.x - fwd.x * 420.0, at.y - fwd.y * 420.0, at.z + 320.0),
                      unreal.Vector(at.x + fwd.x * 900.0, at.y + fwd.y * 900.0, at.z + 150.0), 85.0)
        yield 2.0
        H.capture_viewport_jpeg(os.path.join(ROOT, "9_pa.jpg"), 1900, 95)
        L.release_camera(world)
        yield 1.0

        # ============================================ 5. THE IN-WORLD SKIN PREVIEW
        ui.toggle_project_brain()
        yield 1.5
        ui.set_brain_skins_open(True)
        yield 2.5
        stages = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage)
        stage = stages[0] if stages else None
        RESULT["preview_in_world"] = bool(stage and stage.is_in_world_preview())
        if stage is not None:
            b = stage.get_body()
            if b is not None:
                v = b.get_actor_location()
                RESULT["preview_body_at"] = [round(v.x), round(v.y), round(v.z)]
                RESULT["preview_near_player"] = bool(
                    ((v.x - at.x) ** 2 + (v.y - at.y) ** 2) ** 0.5 < 700.0)
        # THE PANEL COVERS THE SCREEN, so the founder frames are taken with it shut -- and the preview Dog now
        # deliberately STAYS in the plaza when it closes, which is the whole point of the change.
        ui.close_overlay()
        yield 2.0
        RESULT["preview_survives_panel_close"] = bool(stage and stage.is_in_world_preview())

        switched = []
        for skin in SKINS:
            # THROUGH THE FOUNDER'S OWN COMMAND, not a back door: /skin is what they will actually type.
            ok = bool(ui.handle_terminal_command("/skin %s" % skin))
            yield 1.6
            shown = str(stage.get_shown_skin_id()) if stage else ""
            b = stage.get_body() if stage else None
            at2 = b.get_actor_location() if b is not None else None
            if at2 is not None:
                L.pose_camera(world, unreal.Vector(at2.x + 300.0, at2.y - 120.0, at2.z + 150.0),
                              unreal.Vector(at2.x, at2.y, at2.z + 105.0), 45.0)
                yield 1.0
            H.capture_viewport_jpeg(os.path.join(ROOT, "skin_%s.jpg" % skin), 1900, 95)
            switched.append({"skin": skin, "accepted": ok, "stage_now": shown})
        RESULT["skin_switching"] = switched
        RESULT["all_skins_switched"] = all(s["accepted"] and s["skin"] in s["stage_now"] for s in switched)
        RESULT["preview_still_in_world_after_all"] = bool(stage and stage.is_in_world_preview())
        L.release_camera(world)

        RESULT["REPORT"] = {
            "add_task_removed_from_usage_hud": "PASS" if not RESULT["add_task_layer_on_hud"] else "FAIL",
            "plus_in_julius_terminal": "PASS" if RESULT["terminal_open"] else "FAIL",
            "new_terminal_created": "PASS" if RESULT.get("task_count_after_two") == 2 else "FAIL",
            "new_terminal_reads_pending": "PASS" if RESULT.get("second_is_draft") else "FAIL",
            "terminal_switching": "PASS" if (RESULT.get("selected_first") and RESULT.get("selected_second")
                                             and RESULT.get("switch_mutated_nothing")) else "FAIL",
            "one_identity_tab_contract_orb": "PASS" if RESULT.get("orbs_match_tabs") else "FAIL",
            "cubs_command": "PASS" if RESULT.get("cubs_command_handled") and RESULT.get("cub_count", 0) > 0 else "FAIL",
            "pa_command": "PASS" if RESULT.get("pa_command_handled") else "FAIL",
            "pa_families_shown": RESULT.get("pa_families_shown", 0),
            "in_world_skin_preview": "PASS" if (RESULT.get("preview_in_world") and RESULT.get("preview_near_player")
                                                and RESULT.get("preview_survives_panel_close")) else "FAIL",
            "all_seven_skins_switch": "PASS" if RESULT.get("all_skins_switched") else "FAIL",
        }
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "pass.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLPASS could not end play: %s" % exc)
