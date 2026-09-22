# PIE VISUAL PROOF: the founder's Multi-Task Mission Contract orb checkpoint.
#
# FOUNDER DIRECTIVE (2026-09-22): stage exactly RED (bottom, a real submitted contract), GRAY (an empty draft slot
# above it), RED (a second submitted contract above that), all three visible at once, with the token-usage + control
# in frame -- and "Run the interaction rather than manually placing three decorative orbs."
#
# SO NOTHING HERE PLACES AN ORB. Every orb in these pictures exists because the + was pressed and a task was entered,
# through the same calls the control makes. Three orbs posed by hand would photograph identically and prove nothing,
# which is exactly why the founder asked for the interaction.
#
# AND THE VERDICTS ARE READINGS, NOT PICTURES. The stack's own description says which orb is GRAY and which is RED;
# the task set says which objective belongs to which contract; the running count says how many Julius is actually
# executing. The screenshots are for the founder's eye, and the numbers are what decides PASS or FAIL.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "orb_visual_proof")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    shots = []
    RESULT["shots"] = shots
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 6.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        player = controller.get_local_player() if controller else None
        ui = L.get_ui(world)
        tasks = player.get_subsystem(unreal.WonderlandMissionTaskSubsystem) if player else None
        mission = player.get_subsystem(unreal.WonderlandMissionSubsystem) if player else None
        if not (ui and tasks and mission):
            RESULT["status"] = "failed"
            RESULT["why"] = "no ui / task / mission subsystem"
            return
        L.focus_game_viewport()

        def shot(name, note):
            path = os.path.join(ROOT, "%d_%s.jpg" % (len(shots) + 1, name))
            H.capture_viewport_jpeg(path, 1900, 95)
            shots.append({"shot": len(shots) + 1, "name": name, "note": note, "file": path})
            return path

        def stack():
            return [str(line) for line in mission.describe_orb_stack()]

        def colours():
            # The colour word out of the stack's own description, bottom to top. This is the founder's RED/GRAY/RED.
            out = []
            for line in stack()[1:]:
                out.append("GRAY" if "GRAY" in line else ("RED" if "RED" in line else "?"))
            return out

        def frame_the_stack(extra_back=0.0):
            # ONE CAMERA RULE FOR EVERY SHOT: far enough back to hold the whole stack, close enough that the terminal
            # and the token usage stay readable. The founder asked that the camera not be so wide the HUD is lost.
            at = pawn.get_actor_location()
            fwd = pawn.get_actor_forward_vector()
            right = pawn.get_actor_right_vector()
            tall = float(mission.get_stack_height_uu())
            # Stand off to the side and slightly above the middle of the stack, looking at it.
            eye = unreal.Vector(
                at.x + fwd.x * 120.0 - right.x * (760.0 + extra_back),
                at.y + fwd.y * 120.0 - right.y * (760.0 + extra_back),
                at.z + 210.0 + tall * 0.45,
            )
            look = unreal.Vector(at.x + fwd.x * 340.0, at.y + fwd.y * 340.0, at.z + 90.0 + tall * 0.5)
            L.pose_camera(world, eye, look, 58.0)

        # ============================================================ SHOT 1: token usage and the +
        RESULT["plus_on_screen"] = bool(ui.is_add_task_control_on_screen())
        frame_the_stack()
        yield 1.5
        shot("token_usage_and_plus", "the token usage HUD with the + control beside it")

        # ============================================================ the first contract (RED, bottom)
        # Pressing + is how a slot is made; there is no other way in, here or in the product.
        ui.press_add_task()
        yield 1.0
        first_id = tasks.get_tasks()[0].local_id
        RESULT["first_submitted"] = bool(tasks.submit_draft(first_id, "Survey the arrival plaza and report its condition"))
        yield 2.0
        RESULT["after_first"] = stack()
        RESULT["colours_after_first"] = colours()

        # ============================================================ SHOT 2: RED with a GRAY draft above it
        ui.press_add_task()
        yield 2.0
        draft_id = tasks.get_tasks()[1].local_id
        RESULT["draft_is_gray"] = colours() == ["RED", "GRAY"]
        RESULT["draft_has_no_contract_id"] = str(tasks.get_tasks()[1].contract_id) == ""
        RESULT["after_draft"] = stack()
        frame_the_stack()
        yield 1.5
        shot("red_then_gray_above", "one RED Mission Contract, one GRAY empty draft slot above it")

        # ============================================================ the second contract, ABOVE the draft
        # The draft is deliberately LEFT EMPTY, so the third slot is the one that gets a task -- which is what puts
        # GRAY in the middle of the founder's RED / GRAY / RED.
        ui.press_add_task()
        yield 1.0
        third_id = tasks.get_tasks()[2].local_id
        RESULT["second_submitted"] = bool(tasks.submit_draft(third_id, "Inspect the garden arches for clearance"))
        yield 2.5
        RESULT["colours_final"] = colours()
        RESULT["red_gray_red"] = colours() == ["RED", "GRAY", "RED"]
        RESULT["final_stack"] = stack()
        RESULT["stack_height_uu"] = round(float(mission.get_stack_height_uu()), 1)

        # ============================================================ SHOT 3: RED / GRAY / RED
        frame_the_stack()
        yield 2.0
        shot("red_gray_red", "three Mission Contract orbs: RED, GRAY, RED, bottom to top")

        # ---- the gray one is still gray, and still has no backend identity
        RESULT["draft_still_gray"] = colours()[1] == "GRAY"
        RESULT["draft_still_no_contract"] = str(tasks.get_tasks()[1].contract_id) == ""
        RESULT["objectives"] = [str(t.objective) for t in tasks.get_tasks()]
        # THREE SLOTS, TWO OBJECTIVES, NEVER ONE MIXED PROMPT.
        filled = [o for o in RESULT["objectives"] if o]
        RESULT["identities_isolated"] = len(filled) == 2 and len(set(filled)) == 2

        # ============================================================ SHOT 4: selecting the other red contract
        before = list(RESULT["objectives"])
        RESULT["selected_first"] = bool(tasks.select_task(first_id))
        yield 2.0
        RESULT["objectives_after_switch"] = [str(t.objective) for t in tasks.get_tasks()]
        # SELECTION IS A VIEW: nothing any task holds may change because a different one was looked at.
        RESULT["switch_mutated_nothing"] = RESULT["objectives_after_switch"] == before
        RESULT["selected_is_first"] = str(tasks.get_selected()) == str(first_id)
        RESULT["stack_after_switch"] = stack()
        frame_the_stack()
        yield 1.5
        shot("selected_first_contract", "the first RED contract selected: its orb is the full-sized one")

        # ---- no fake concurrency: three slots, two contracts, and Julius running none of them
        RESULT["running_count"] = int(tasks.get_running_count())
        RESULT["no_fake_concurrency"] = int(tasks.get_running_count()) == 0
        RESULT["tokens_unreported"] = int(tasks.get_total_tokens()) < 0
        RESULT["task_status"] = [str(line) for line in tasks.describe_tasks()]

        # ============================================================ SHOT 5: clearance with the stack up
        staging = mission.probe_clearance_now()
        RESULT["clearance_fit"] = str(mission.get_last_staging_fit_name())
        RESULT["clearance_headroom_uu"] = round(float(staging.chosen.clear_height_uu), 1)
        RESULT["clearance_radius_uu"] = round(float(staging.chosen.clear_radius_uu), 1)
        RESULT["clearance_places_measured"] = int(staging.candidates_tried)
        RESULT["clearance_notes"] = [str(n) for n in staging.notes]
        # A MISSION IS NEVER REFUSED FOR WANT OF ROOM: the probe answers with a presentation, never with a no.
        RESULT["mission_never_refused"] = RESULT["clearance_fit"] in ("FULL", "COMPACT", "COMPACT IN PLACE")
        frame_the_stack(extra_back=120.0)
        yield 1.5
        shot("clearance_with_stack", "the probe measured the whole stack's envelope, not one orb: %s" % RESULT["clearance_fit"])

        L.release_camera(world)
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "shots.json"), "w", encoding="utf-8") as fh:
            json.dump(shots, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLORB could not end play: %s" % exc)
