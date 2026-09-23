# /cubs: THE WHOLE PRESENTATION, SAMPLED WHILE IT PLAYS.
#
# FOUNDER: "type /cubs -> Relay Dog pauses -> ascends -> body becomes luminous white -> Cub Ghosts emerge one by
# one -> Cubs separate -> Dog returns to normal -> stationary Dog = SWIRL -> moving Dog = FLIGHT."
#
# THE EARLIER CHECK SAMPLED AFTER THE SEQUENCE HAD FINISHED and saw five IDLE cubs, which is the END of the
# ascension and says nothing about whether it played. This samples every 0.35 s from the moment the command is
# typed and records the primary Dog's lift and luminance and each cub's emergence and state as they change, so
# "one by one" and "luminous" are readings with timestamps rather than a claim.
#
# THESE ARE ORDINARY SUB-AGENTS, USER-SUMMONED. The count source is read back and must say so: a summon is not a
# Julius report, and nothing here touches /MAS.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "cubs_sequence")


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
        ui, flock = L.get_ui(world), L.get_cubs(world)
        if not (ui and flock):
            RESULT["status"] = "failed"
            RESULT["why"] = "no ui / cub subsystem"
            return
        L.focus_game_viewport()
        # a camera that watches the Dog from behind and above, and stays put so the lift is visible as a lift
        at = pawn.get_actor_location()
        fwd = pawn.get_actor_forward_vector()
        # Close and low enough that a 60 uu lift is a lift and not a pixel: three metres back, at head height.
        L.pose_camera(world, unreal.Vector(at.x - fwd.x * 330.0 + 90.0, at.y - fwd.y * 330.0, at.z + 150.0),
                      unreal.Vector(at.x, at.y, at.z + 120.0), 62.0)
        yield 1.0
        H.capture_viewport_jpeg(os.path.join(ROOT, "0_before.jpg"), 1900, 95)

        # ---- TYPE IT, through the terminal, and start the clock
        ui.toggle_live_terminal()
        yield 0.8
        RESULT["command_handled"] = bool(ui.handle_terminal_command("/cubs"))
        ui.close_overlay()
        samples = []
        t = 0.0
        peak_lift, peak_lum = 0.0, 0.0
        first_seen = {}
        # TIMED TO THE MEASUREMENTS. The first run shot "luminous" at 1.4 s and "emerging" at 2.8 s, when the
        # samples put luminance at 1.0 from 3.15 s and the first cub at 3.5 s -- two identical frames of a Dog
        # standing still, under captions the numbers had already earned. The indices now follow the numbers.
        shots = {5: "1_ascending", 9: "2_luminous", 12: "3_emerging", 15: "4_emerged", 21: "5_settled"}
        for i in range(24):
            cubs = flock.get_cubs()
            row = {
                "t": round(t, 2),
                "ascending": bool(flock.is_ascending()),
                "lift": round(float(flock.get_primary_lift_uu()), 1),
                "lum": round(float(flock.get_primary_luminance()), 3),
                "emergence": [round(float(c.get_emergence()), 2) for c in cubs],
                "states": [str(c.get_cub_state_name()) for c in cubs],
            }
            peak_lift = max(peak_lift, row["lift"])
            peak_lum = max(peak_lum, row["lum"])
            for k, e in enumerate(row["emergence"]):
                if e > 0.05 and k not in first_seen:
                    first_seen[k] = round(t, 2)
            samples.append(row)
            if i in shots:
                H.capture_viewport_jpeg(os.path.join(ROOT, shots[i] + ".jpg"), 1900, 95)
            yield 0.35
            t += 0.35
        RESULT["samples"] = samples
        RESULT["count"] = int(flock.get_active_sub_agent_cub_count())
        RESULT["source"] = str(flock.get_count_source())
        RESULT["driven_by_julius"] = bool(flock.is_driven_by_julius())
        RESULT["peak_lift_uu"] = peak_lift
        RESULT["peak_luminance"] = peak_lum
        RESULT["first_emergence_t"] = [first_seen.get(k) for k in range(RESULT["count"])]
        # ONE BY ONE: each cub's first movement comes after the previous one's, never together.
        times = [v for v in RESULT["first_emergence_t"] if v is not None]
        RESULT["one_by_one"] = len(times) == RESULT["count"] and all(b > a for a, b in zip(times, times[1:]))
        RESULT["ascension_seen"] = any(s["ascending"] for s in samples) and peak_lift > 20.0
        RESULT["luminous_seen"] = peak_lum > 0.6
        RESULT["dog_returned"] = (not samples[-1]["ascending"]) and samples[-1]["lift"] < 3.0 and samples[-1]["lum"] < 0.05
        RESULT["all_emerged"] = all(e >= 0.99 for e in samples[-1]["emergence"]) and len(samples[-1]["emergence"]) > 0

        # ---- SWIRL: the Dog stands still; the cubs orbit it low, with a low flight blend and a small station error
        yield 2.5
        cubs = flock.get_cubs()
        RESULT["swirl_blend"] = [round(float(c.get_flight_blend()), 2) for c in cubs]
        RESULT["swirl_station_err"] = [round(float(c.get_station_error_uu()), 1) for c in cubs]
        RESULT["swirl_height"] = [round(float(c.get_actor_location().z - pawn.get_actor_location().z), 1) for c in cubs]
        RESULT["swirl"] = bool(cubs) and max(RESULT["swirl_blend"]) < 0.35 and max(RESULT["swirl_station_err"]) < 120.0
        H.capture_viewport_jpeg(os.path.join(ROOT, "6_swirl.jpg"), 1900, 95)

        # ---- FLIGHT: the Dog walks; the cubs lift into the dome overhead. Forced input, because an overlay that
        # ---- was open a moment ago leaves move input ignored otherwise (the film trap from 2026-09-16).
        L.release_camera(world)
        yield 0.3
        # STEPPED, NOT PUSHED. A movement input is consumed the frame it is given, and this job can only speak
        # once every few frames, so twelve pushes moved the Dog fourteen centimetres. The flock measures the Dog's
        # speed from its POSITION each tick (Dist2D / DeltaTime, threshold 55 uu/s), so walking it forward in small
        # steps is exactly what the flock would see from a player holding W.
        start = pawn.get_actor_location()
        for k in range(34):
            step = 9.0 * (k + 1)
            pawn.set_actor_location(unreal.Vector(start.x + fwd.x * step, start.y + fwd.y * step, start.z), False, False)
            yield 0.08
        cubs = flock.get_cubs()
        RESULT["flight_blend"] = [round(float(c.get_flight_blend()), 2) for c in cubs]
        RESULT["flight_height"] = [round(float(c.get_actor_location().z - pawn.get_actor_location().z), 1) for c in cubs]
        RESULT["flight"] = bool(cubs) and min(RESULT["flight_blend"]) > 0.65
        at2 = pawn.get_actor_location()
        RESULT["dog_moved_uu"] = round(((at2.x - at.x) ** 2 + (at2.y - at.y) ** 2) ** 0.5, 1)
        fwd2 = pawn.get_actor_forward_vector()
        L.pose_camera(world, unreal.Vector(at2.x - fwd2.x * 520.0, at2.y - fwd2.y * 520.0, at2.z + 300.0),
                      unreal.Vector(at2.x + fwd2.x * 60.0, at2.y + fwd2.y * 60.0, at2.z + 130.0), 70.0)
        yield 0.6
        H.capture_viewport_jpeg(os.path.join(ROOT, "7_flight.jpg"), 1900, 95)

        # ---- and /cubs off: they RETURN and MERGE, they do not vanish
        ui.toggle_live_terminal()
        yield 0.6
        ui.handle_terminal_command("/cubs off")
        ui.close_overlay()
        leaving = []
        for i in range(12):
            # BY CLASS, NOT BY FLOCK. Shrink() moves a departing cub out of the flock's list the instant it is
            # told to go, so GetCubs() cannot see RETURNING or MERGING -- the first run read an empty list and
            # called the transition missing while it was playing. Every cub actor in the world is asked instead.
            leaving.append([str(c.get_cub_state_name())
                            for c in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSubAgentCub)])
            if i == 3:
                H.capture_viewport_jpeg(os.path.join(ROOT, "8_returning.jpg"), 1900, 95)
            yield 0.4
        RESULT["leaving_states"] = leaving
        RESULT["returned_or_merged"] = any(any(s in ("RETURNING", "MERGING") for s in row) for row in leaving)
        RESULT["count_after_off"] = int(flock.get_active_sub_agent_cub_count())
        L.release_camera(world)

        RESULT["REPORT"] = {
            "command": "PASS" if RESULT["command_handled"] and RESULT["count"] > 0 else "FAIL",
            "count": RESULT["count"],
            "source_is_user_summoned_not_julius": "PASS" if ("USER_SUMMONED" in RESULT["source"].upper() and not RESULT["driven_by_julius"]) else "FAIL",
            "ascension": "PASS" if RESULT["ascension_seen"] else "FAIL",
            "luminous_white": "PASS" if RESULT["luminous_seen"] else "FAIL",
            "emerge_one_by_one": "PASS" if RESULT["one_by_one"] and RESULT["all_emerged"] else "FAIL",
            "dog_returns_to_normal": "PASS" if RESULT["dog_returned"] else "FAIL",
            "swirl_when_still": "PASS" if RESULT["swirl"] else "FAIL",
            "flight_when_moving": "PASS" if RESULT["flight"] else "FAIL",
            "return_merge_on_off": "PASS" if RESULT["returned_or_merged"] else "FAIL",
        }
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "cubs.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLCUBSEQ could not end play: %s" % exc)
