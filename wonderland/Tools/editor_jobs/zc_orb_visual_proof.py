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
import math
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
        # THE TEST LIBRARY HANDS OVER BOTH. This build's Python has no route to a LocalPlayerSubsystem of its own --
        # PlayerController.Player is protected, LocalPlayer has no get_subsystem, and SubsystemBlueprintLibrary is
        # not reflected -- so the library does it in C++, the same way it already does for the UI subsystem.
        ui = L.get_ui(world)
        tasks = L.get_mission_tasks(world)
        mission = L.get_mission(world)
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

        def orb_spots():
            # WHERE THE ORBS ACTUALLY ARE. Guessing the camera from the Dog's transform put the stack behind the
            # bottom navigation twice; the orbs know where they are, so ask them.
            out = []
            for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb):
                v = a.get_actor_location()
                out.append((round(v.x, 1), round(v.y, 1), round(v.z, 1)))
            return sorted(out, key=lambda p: p[2])

        def frame_the_stack(extra_back=0.0):
            spots = orb_spots()
            if spots:
                # Frame the orbs themselves: centre on the middle of the stack and stand back by its own height,
                # so three orbs fill the frame whatever the Dog happens to be standing next to.
                cx = sum(s[0] for s in spots) / len(spots)
                cy = sum(s[1] for s in spots) / len(spots)
                lo = min(s[2] for s in spots)
                hi = max(s[2] for s in spots)
                cz = (lo + hi) * 0.5
                span = max(hi - lo, 120.0)
                # THE CAMERA NO LONGER STANDS BEHIND THE PLAYER, because that is exactly where the companions
                # stand. See below.
                fwd2 = pawn.get_actor_forward_vector()
                # THE CAPTURE IS ABOUT 2.1:1, so the vertical field is far narrower than the horizontal one and a
                # distance chosen from the horizontal FOV crops the stack. This is solved from the VERTICAL field:
                # stand back far enough that the stack fills roughly two thirds of the frame's height.
                # CLOSE ENOUGH TO JUDGE A COLOUR, which is a stricter requirement than fitting the stack in frame:
                # at 723 uu the three orbs were plainly three orbs and still too small to tell gray from red.
                # RE-SOLVED FOR A TOUCHING STACK. The step is now one orb tall rather than nearly two, so three
                # orbs stand 168 uu from tip to tip instead of 266 and the old distance framed them too tight.
                back = span * 1.9 + 250.0 + extra_back

                # AZIMUTH 315, CHOSEN BY SURVEY RATHER THAN BY TASTE.
                #
                # Standing behind the player put the LLM Companion's embodiment across the right third of the hero
                # frame -- not a false picture, since the companion genuinely lives there, but a bad photograph of
                # a good result. A ring of eight azimuths was traced and scored for how far the nearest figure sits
                # off the lens axis: 45 degrees put one 1.4 degrees off axis, 90 put one at 4.4, and 315 is the
                # clearest open view at 33.5 with the garden planters behind the stack, which is the background
                # that separates a pale stone from a red one best.
                #
                # NOTHING IS HIDDEN TO ACHIEVE IT. No actor is destroyed, made invisible or moved; the camera is.
                rad = math.radians(315.0)
                eye = unreal.Vector(cx + math.cos(rad) * back, cy + math.sin(rad) * back, cz + span * 0.15)
                centre = unreal.Vector(cx, cy, cz)
                # AND IT IS CHECKED EVERY TIME. A surveyed angle is clear for where the orbs were when it was
                # surveyed; the orbs follow the player. If anything solid comes between, fall back to the camera
                # that is always known to be clear rather than film the inside of a wall.
                blocked = unreal.SystemLibrary.line_trace_single(
                    world, eye, centre, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [],
                    unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
                RESULT.setdefault("camera_blocked_falls_back", []).append(bool(blocked))
                if not blocked:
                    L.pose_camera(world, eye, centre, 52.0)
                    return
                L.pose_camera(
                    world,
                    unreal.Vector(cx - fwd2.x * back, cy - fwd2.y * back, cz + span * 0.30),
                    centre,
                    62.0)
                return
            _frame_from_pawn(extra_back)

        def _frame_from_pawn(extra_back=0.0):
            # ONE CAMERA RULE FOR EVERY SHOT: far enough back to hold the whole stack, close enough that the terminal
            # and the token usage stay readable. The founder asked that the camera not be so wide the HUD is lost.
            at = pawn.get_actor_location()
            fwd = pawn.get_actor_forward_vector()
            right = pawn.get_actor_right_vector()
            tall = float(mission.get_stack_height_uu())
            # OVER THE DOG'S SHOULDER, not out to the side. A side camera 760 uu away landed inside a wall in the
            # first filmed attempt and photographed stone; the ground BEHIND the player is ground they have just
            # stood on, so it is the one direction known to be clear.
            # CLOSE ENOUGH TO JUDGE THE ORBS. At 560 uu back the stack was a few pixels tall and the founder could
            # not have told gray from red, let alone judged spacing. The orbs stand ahead of the Dog, so the camera
            # frames THEM rather than the Dog, from just behind and a little above the middle of the stack.
            back = 210.0 + extra_back
            eye = unreal.Vector(
                at.x - fwd.x * back,
                at.y - fwd.y * back,
                at.z + 150.0 + tall * 0.55,
            )
            look = unreal.Vector(at.x + fwd.x * 340.0, at.y + fwd.y * 340.0, at.z + 110.0 + tall * 0.5)
            L.pose_camera(world, eye, look, 70.0)

        # WHO ELSE IS STANDING IN THIS WORLD. Two lanes have been guessing from a JPEG about three figures in the
        # arrival plaza; a list with coordinates ends that.
        census = {}
        for cls in ("WonderlandCompanionEmbodiment", "WonderlandSkinStage", "WonderlandSubAgentCub",
                    "RelayDogCharacter"):
            kind = getattr(unreal, cls, None)
            census[cls] = "class not reflected" if kind is None else [
                {"name": str(a.get_name()),
                 "at": [round(a.get_actor_location().x), round(a.get_actor_location().y),
                        round(a.get_actor_location().z)]}
                for a in unreal.GameplayStatics.get_all_actors_of_class(world, kind)]
        RESULT["plaza_census"] = census

        # ============================================================ SHOT 1: token usage and the +
        RESULT["plus_on_screen"] = bool(ui.is_add_task_control_on_screen())
        frame_the_stack()
        yield 1.5
        shot("token_usage_and_plus", "the token usage HUD with the + control beside it")

        # ============================================================ the first contract (RED, bottom)
        # Pressing + is how a slot is made; there is no other way in, here or in the product.
        ui.press_add_task()
        yield 1.0
        first_id = tasks.get_task_list()[0].local_id
        RESULT["first_submitted"] = bool(tasks.submit_draft(first_id, "Survey the arrival plaza and report its condition"))
        yield 2.0
        RESULT["after_first"] = stack()
        RESULT["colours_after_first"] = colours()

        # ============================================================ SHOT 2: RED with a GRAY draft above it
        ui.press_add_task()
        yield 2.0
        draft_id = tasks.get_task_list()[1].local_id
        RESULT["draft_is_gray"] = colours() == ["RED", "GRAY"]
        RESULT["draft_has_no_contract_id"] = str(tasks.get_task_list()[1].contract_id) == ""
        RESULT["after_draft"] = stack()
        frame_the_stack()
        yield 1.5
        shot("red_then_gray_above", "one RED Mission Contract, one GRAY empty draft slot above it")

        # ============================================================ the second contract, ABOVE the draft
        # The draft is deliberately LEFT EMPTY, so the third slot is the one that gets a task -- which is what puts
        # GRAY in the middle of the founder's RED / GRAY / RED.
        ui.press_add_task()
        yield 1.0
        third_id = tasks.get_task_list()[2].local_id
        RESULT["second_submitted"] = bool(tasks.submit_draft(third_id, "Inspect the garden arches for clearance"))
        yield 2.5
        RESULT["colours_final"] = colours()
        RESULT["red_gray_red"] = colours() == ["RED", "GRAY", "RED"]
        RESULT["final_stack"] = stack()
        RESULT["stack_height_uu"] = round(float(mission.get_stack_height_uu()), 1)
        RESULT["orb_world_spots"] = orb_spots()
        # THREE ORBS ABOVE ONE ANOTHER SHARE A GROUND POSITION. A spread here is a stack that is not stacked.
        if RESULT["orb_world_spots"]:
            xs = [s[0] for s in RESULT["orb_world_spots"]]
            ys = [s[1] for s in RESULT["orb_world_spots"]]
            RESULT["orb_ground_spread_uu"] = round(max(max(xs) - min(xs), max(ys) - min(ys)), 1)
            RESULT["orbs_vertically_aligned"] = RESULT["orb_ground_spread_uu"] < 40.0
            # TOUCHING, WHICH THE FOUNDER ASKED FOR IN SO MANY WORDS. A Mission Contract crystal reaches
            # CrystalHalfHeightUU = 28 uu above and below its origin, so a 56 uu step puts one orb's point on the
            # next one's point. Measured from where the orbs actually are, not from the constant that placed them.
            zs = sorted(s[2] for s in RESULT["orb_world_spots"])
            steps = [round(b - a, 1) for a, b in zip(zs, zs[1:])]
            RESULT["orb_steps_uu"] = steps
            RESULT["orb_height_uu"] = 56.0
            RESULT["orbs_touching"] = bool(steps) and all(abs(s - 56.0) <= 6.0 for s in steps)

        # ============================================================ SHOT 3: RED / GRAY / RED
        frame_the_stack()
        yield 2.0
        shot("red_gray_red", "three Mission Contract orbs: RED, GRAY, RED, bottom to top")

        # ---- the gray one is still gray, and still has no backend identity
        RESULT["draft_still_gray"] = colours()[1] == "GRAY"
        RESULT["draft_still_no_contract"] = str(tasks.get_task_list()[1].contract_id) == ""
        RESULT["objectives"] = [str(t.objective) for t in tasks.get_task_list()]
        # THREE SLOTS, TWO OBJECTIVES, NEVER ONE MIXED PROMPT.
        filled = [o for o in RESULT["objectives"] if o]
        RESULT["identities_isolated"] = len(filled) == 2 and len(set(filled)) == 2

        # ============================================================ SHOTS 4 and 5: each RED contract in turn
        before = list(RESULT["objectives"])
        RESULT["selected_first"] = bool(tasks.select_task(first_id))
        yield 2.0
        RESULT["selected_is_first"] = any(line.strip().startswith("0 *") for line in stack())
        RESULT["stack_with_first_selected"] = stack()
        frame_the_stack()
        yield 1.5
        shot("first_red_selected", "the BOTTOM red contract selected: its orb is the full-sized one")

        RESULT["selected_second"] = bool(tasks.select_task(third_id))
        yield 2.0
        RESULT["selected_is_second"] = any(line.strip().startswith("2 *") for line in stack())
        RESULT["stack_with_second_selected"] = stack()
        frame_the_stack()
        yield 1.5
        shot("second_red_selected", "the TOP red contract selected: the context followed the selection")

        RESULT["objectives_after_switch"] = [str(t.objective) for t in tasks.get_task_list()]
        # SELECTION IS A VIEW: nothing any task holds may change because a different one was looked at.
        RESULT["switch_mutated_nothing"] = RESULT["objectives_after_switch"] == before
        # AND THE TWO SELECTIONS MUST ACTUALLY DIFFER, or "switching" proved nothing.
        RESULT["selection_actually_changed"] = RESULT["stack_with_first_selected"] != RESULT["stack_with_second_selected"]

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
