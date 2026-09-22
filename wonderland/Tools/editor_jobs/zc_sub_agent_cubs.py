# PIE proof: RELAY DOG CUB GHOSTS — regular sub-agents, escorting the primary Dog, and not moving stiffly.
#
# FOUNDER, via the world lane (2026-09-22), verbatim: "The Cubs cannot move stiff they have to move smoothly just
# like the AI companions do and they can move around the relay dog like swirl around it's body that's OK that's only
# when a relay dog isn't moving." And earlier: "they need to be flying above the relay dog not around above."
#
# FOUR CLAIMS, AND A SCREENSHOT SETTLES NONE OF THEM:
#
#   1. WONDERLAND INVENTS NO CUBS. With nothing reported there are none. This is the founder's hardest rule about
#      them -- "Wonderland should not visually invent active sub-agents that do not exist" -- and it is checked
#      FIRST, before anything is reported, because a system that draws cubs by default fails it at rest.
#   2. THE COUNT COMES FROM THE REPORT, and is clamped by capacity rather than obeyed.
#   3. THE MODE FOLLOWS THE DOG. Standing, the cubs swirl around its body at body height. Walking, they hold a dome
#      ABOVE it. Both are measured as heights and radii relative to the Dog, not judged from a still.
#   4. IT IS NOT STIFF. Measured three ways: no two cubs share an orbit angle, the angular rate is not constant
#      within a single cub (a constant rate is exactly what reads mechanical), and the mode change is a cross-fade
#      rather than a jump.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "sub_agent_cubs")


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
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        L.focus_game_viewport()

        flock = world.get_subsystem(unreal.WonderlandSubAgentCubSubsystem)
        if flock is None:
            RESULT["status"] = "failed"
            RESULT["why"] = "no cub subsystem"
            return

        # THE PRIMARY RELAY DOG IS THE PLAYER'S OWN. Cubs escort the primary Compound AI Agent, and in Wonderland
        # that is the Dog the player is wearing -- not a stand-in placed for the photograph.
        dog_height = 180.0
        flock.set_primary_relay_dog(pawn, dog_height)
        yield 1.0

        def shot(label, note=""):
            path = os.path.join(ROOT, "%02d_%s.jpg" % (len(steps), label))
            H.capture_viewport_jpeg(path, 1900, 92)
            steps.append({"step": label, "note": note, "file": path})

        def read():
            cubs = flock.get_cubs()
            at = pawn.get_actor_location()
            rows = []
            for cub in cubs:
                if cub is None:
                    continue
                spot = cub.get_actor_location()
                rows.append(dict(
                    slot=int(cub.get_slot()),
                    state=str(cub.get_cub_state_name()),
                    blend=round(float(cub.get_flight_blend()), 3),
                    emerged=round(float(cub.get_emergence()), 3),
                    error=round(float(cub.get_station_error_uu()), 1),
                    # Where it is relative to the Dog: the two numbers the founder's rule is actually about.
                    angle=round(math.degrees(math.atan2(spot.y - at.y, spot.x - at.x)) % 360.0, 2),
                    radius=round(math.hypot(spot.x - at.x, spot.y - at.y), 1),
                    above=round(spot.z - at.z, 1),
                ))
            return rows

        # ---- 1. NOTHING REPORTED, NOTHING DRAWN.
        yield 2.0
        RESULT["cubs_before_any_report"] = int(flock.get_active_sub_agent_cub_count())
        RESULT["invents_no_cubs"] = RESULT["cubs_before_any_report"] == 0
        RESULT["max_cubs"] = int(flock.get_max_sub_agent_cub_count())
        shot("no_report", "before Julius has reported anything: there must be no cubs at all")

        # ---- 2. THE REPORT DECIDES, AND CAPACITY CLAMPS IT.
        flock.report_active_sub_agents(5)
        yield 1.0
        RESULT["cubs_after_reporting_5"] = int(flock.get_active_sub_agent_cub_count())
        flock.report_active_sub_agents(99)
        yield 1.0
        RESULT["cubs_after_reporting_99"] = int(flock.get_active_sub_agent_cub_count())
        RESULT["capacity_clamps"] = RESULT["cubs_after_reporting_99"] <= RESULT["max_cubs"]
        flock.report_active_sub_agents(5)
        yield 1.0

        # ---- THE ASCENSION. One at a time, never two.
        ascend = []
        for _ in range(26):
            ascend.append([row["emerged"] for row in read()])
            if len(ascend) in (4, 10, 18):
                shot("ascension_%d" % len(ascend), "the primary Dog lifts and glows; cubs emerge one by one")
            yield 0.25
        RESULT["ascension"] = ascend
        # ONE AT A TIME IS A MEASURABLE THING: at no moment should two cubs be part-way out together.
        RESULT["max_partly_emerged_at_once"] = max(
            sum(1 for value in frame if 0.02 < value < 0.98) for frame in ascend) if ascend else 0
        RESULT["cubs_emerge_one_by_one"] = RESULT["max_partly_emerged_at_once"] <= 1
        RESULT["all_emerged"] = all(value > 0.98 for value in ascend[-1]) if ascend else False

        # ---- 3a. THE DOG IS AT REST: the cubs swirl AROUND ITS BODY.
        L.pose_camera(world,
                      unreal.Vector(pawn.get_actor_location().x - 620.0, pawn.get_actor_location().y - 520.0,
                                    pawn.get_actor_location().z + 320.0),
                      unreal.Vector(pawn.get_actor_location().x, pawn.get_actor_location().y,
                                    pawn.get_actor_location().z + 120.0), 58.0)
        yield 1.0
        swirl = []
        for _ in range(14):
            swirl.append(read())
            yield 0.4
        shot("swirl", "the Dog is standing: the cubs orbit its body at body height")
        RESULT["swirl_sample"] = swirl[-1]
        RESULT["swirl_mean_height_uu"] = round(sum(r["above"] for r in swirl[-1]) / max(len(swirl[-1]), 1), 1)
        RESULT["swirl_mean_blend"] = round(sum(r["blend"] for r in swirl[-1]) / max(len(swirl[-1]), 1), 3)
        # AT REST THEY ARE AT BODY HEIGHT, not overhead. Above the Dog's own height would be the wrong mode.
        RESULT["swirls_around_the_body"] = RESULT["swirl_mean_height_uu"] < dog_height

        # NOT A CLOCK FACE: no two cubs at the same angle, and each cub's own rate varies over its orbit.
        angles = sorted(r["angle"] for r in swirl[-1])
        gaps = [angles[i + 1] - angles[i] for i in range(len(angles) - 1)]
        RESULT["angle_gaps"] = [round(g, 1) for g in gaps]
        RESULT["cubs_not_evenly_spaced"] = (max(gaps) - min(gaps)) > 4.0 if len(gaps) > 1 else False
        # The rate of one cub, sampled across the swirl. A constant rate is the definition of a mechanical orbit.
        first = [frame[0]["angle"] for frame in swirl if frame]
        rates = []
        for i in range(len(first) - 1):
            step = (first[i + 1] - first[i]) % 360.0
            rates.append(step if step < 180.0 else step - 360.0)
        RESULT["orbit_rates"] = [round(r, 2) for r in rates]
        if len(rates) > 2:
            mean = sum(rates) / len(rates)
            spread = max(rates) - min(rates)
            RESULT["orbit_rate_varies"] = abs(mean) > 0.01 and spread > abs(mean) * 0.15
        else:
            RESULT["orbit_rate_varies"] = False
        # AND NO CUB SITS EXACTLY ON ITS STATION. A zero error everywhere is a rig, not a flock.
        RESULT["station_errors"] = [r["error"] for r in swirl[-1]]
        RESULT["cubs_chase_rather_than_occupy"] = all(r["error"] > 0.5 for r in swirl[-1]) if swirl[-1] else False

        # ---- 3b. THE DOG MOVES: the cubs take to the dome ABOVE it.
        flight = []
        for _ in range(16):
            here = pawn.get_actor_location()
            forward = pawn.get_actor_forward_vector()
            pawn.set_actor_location(unreal.Vector(here.x + forward.x * 90.0, here.y + forward.y * 90.0, here.z), False, False)
            yield 0.3
            flight.append(read())
            if len(flight) == 10:
                shot("flight", "the Dog is walking: the cubs hold a dome above it, out of its way")
        RESULT["flight_sample"] = flight[-1]
        RESULT["flight_mean_height_uu"] = round(sum(r["above"] for r in flight[-1]) / max(len(flight[-1]), 1), 1)
        RESULT["flight_mean_blend"] = round(sum(r["blend"] for r in flight[-1]) / max(len(flight[-1]), 1), 3)
        RESULT["flies_above_when_moving"] = RESULT["flight_mean_height_uu"] > dog_height

        # ---- 4. THE MODE CHANGE IS A CROSS-FADE, not a jump. Every intermediate blend value proves it.
        blends = [round(sum(r["blend"] for r in frame) / max(len(frame), 1), 3) for frame in flight if frame]
        RESULT["blend_track"] = blends
        RESULT["mode_cross_fades"] = sum(1 for b in blends if 0.05 < b < 0.95) >= 2

        L.release_camera(world)
        for line in flock.describe_flock():
            steps.append({"step": "flock", "note": str(line), "file": ""})
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "steps.json"), "w", encoding="utf-8") as fh:
            json.dump(steps, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLCUB could not end play: %s" % exc)
