# CAN THE FOUNDER SEE WONDERLAND AT MIDNIGHT, AND IS IT STILL NIGHT?
#
# FOUNDER, 2026-09-25: "NIGHT MODE IS TOO DARK ... Run the full day cycle and inspect the darkest night state.
# It must still read as NIGHT, but the player must be able to see: the Relay Dog / mascot, the ground around the
# player, paths, architecture silhouettes, the Project Avatars / AI Companions, navigation landmarks, HUD/UI.
# Do not simply wash the world in flat brightness ... Verify the full transition morning -> afternoon -> evening
# -> full night -> morning with no broken or jarring exposure jumps."
#
# BOTH HALVES ARE ASSERTED HERE, and they pull against each other on purpose: a build that passes "readable" by
# lifting the exposure will fail "still night", and a build that passes "still night" by going black will fail
# "readable". Only a night that is actually LIT can pass both.
#
# TWO INSTRUMENT FAULTS FOUND AND FIXED IN THE FIRST RUN, recorded because both of them produced confident
# wrong numbers and either would have sent the lighting the wrong way:
#
#   THE CAMERA WAS INSIDE A BUILDING. Posed 420 uu behind the Dog at head height, it framed an interior wall,
#   and midnight came back at 0.031 whole-screen luma -- "the world is gone". Photographed from the same spot
#   at the same hour with the moon swept from 0 to 200,000 lux, the world was plainly there the whole time.
#   The camera is now placed high and back and AIMED BY PROJECTION, so the Dog is where the proof says it is.
#
#   THE HUD WAS BEING MEASURED AS IF IT WERE THE WORLD. A full-screen read includes the agent panel, the
#   minimap and the dock, which are lit by Slate and do not care what hour it is -- so the darkest reading in
#   the whole day had a floor under it that came from the UI. Every rectangle below is world only.
CONCURRENT = True

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "night_readable")
#: A whole day, close-sampled through dusk and dawn where the transition actually happens.
HOURS = [9.5, 12.0, 15.0, 16.5, 17.5, 18.0, 18.5, 19.0, 19.5, 20.5,
         22.0, 0.0, 2.0, 4.0, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.5]
#: World only: outside the agent panel on the left, the minimap on the right and the dock at the bottom.
WORLD = (0.27, 0.13, 0.85, 0.85)
#: The hours that ARE night. The founder asked about "the darkest NIGHT state", and the darkest hour of the
#: whole day is sunrise -- a low warm sun throwing long shadows across most of the frame, which is a sunrise
#: doing its job and not a night failing at one. Judged here, named rather than found.
NIGHT = ["22.0", "00.0", "02.0", "04.0"]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    # THE CANONICAL BODY, BECAUSE THE SKIN IS NOT THE SUBJECT. The first run of this proof happened to leave
    # CELESTIAL LIGHT equipped -- a skin made of light -- and it lit its own paving: the "ground at midnight"
    # reading came back at 0.889, which is a photograph of the mascot's glow and says nothing about the night.
    ui = L.get_ui(world)
    if ui is not None:
        ui.wear_relay_skin("relay_og")
    yield 3.0

    where = dog.get_actor_location()
    yaw = dog.get_actor_rotation().yaw
    # HIGH AND BACK, LOOKING DOWN INTO THE PLAZA. Above the roofline of whatever the Dog is standing beside,
    # so the shot is the world and not the inside of a wall.
    eye = unreal.Vector(where.x - math.cos(math.radians(yaw)) * 700.0,
                        where.y - math.sin(math.radians(yaw)) * 700.0,
                        where.z + 420.0)
    look = unreal.Vector(where.x, where.y, where.z + 40.0)

    size = pc.get_viewport_size()
    vw = float(size[0]) if size and size[0] else 1920.0
    vh = float(size[1]) if size and len(size) > 1 and size[1] else 1080.0
    RESULT["viewport"] = [vw, vh]

    def on_screen(point):
        """Where a world point lands, as a fraction of the viewport, or None if it is off screen."""
        try:
            got = unreal.GameplayStatics.project_world_to_screen(pc, point, False)
        except Exception:
            return None
        if got is None:
            return None
        fx, fy = float(got.x) / vw, float(got.y) / vh
        if not (0.02 < fx < 0.98 and 0.02 < fy < 0.98):
            return None
        return (fx, fy)

    def patch(cx, cy, hw, hh):
        got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
        if got is None:
            return None
        mean, dark, bright, sampled = got
        return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 5),
                "dark": round(dark, 4), "bright": round(bright, 4), "samples": int(sampled)}

    day = {}
    RESULT["through_the_day"] = day
    for hour in HOURS:
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
        L.pose_camera(world, eye, look, 62.0)
        # The sky light is recaptured twice a second and Lumen needs a moment after a large lighting change.
        yield 4.0
        name = "%04.1f" % hour
        here = dog.get_actor_location()
        whole = patch((WORLD[0] + WORLD[2]) * 0.5, (WORLD[1] + WORLD[3]) * 0.5,
                      (WORLD[2] - WORLD[0]) * 0.5, (WORLD[3] - WORLD[1]) * 0.5)
        at_dog = on_screen(unreal.Vector(here.x, here.y, here.z + 30.0))
        ahead = on_screen(unreal.Vector(here.x + math.cos(math.radians(yaw)) * 220.0,
                                        here.y + math.sin(math.radians(yaw)) * 220.0,
                                        here.z - 80.0))
        mascot = patch(at_dog[0], at_dog[1], 0.024, 0.045) if at_dog else None
        ground = patch(ahead[0], ahead[1], 0.055, 0.035) if ahead else None
        # THE SKYLINE IS A FIXED BAND, not a projected point: a point 5 m above the Dog is off the top of a
        # shot posed above the Dog looking down, and the first run returned null for it at every hour.
        skyline = patch(0.56, 0.175, 0.28, 0.035)
        shot = os.path.join(ROOT, "h%s.png" % name.replace(".", "_"))
        try:
            L.capture_game_viewport(shot)
        except Exception:
            pass
        day[name] = {"whole": whole, "mascot": mascot, "ground": ground, "skyline": skyline,
                     "dog_at": at_dog, "ground_at": ahead, "capture": os.path.basename(shot)}
        emit("N_%s" % name, "INFO", "hour %s" % name,
             {"world": whole["luma"] if whole else None,
              "mascot": mascot["luma"] if mascot else None,
              "ground": ground["luma"] if ground else None,
              "crushed": whole["dark"] if whole else None})

    L.release_camera(world)
    read_all = all(r["whole"] for r in day.values())
    aimed = all(r["mascot"] and r["ground"] for r in day.values())
    record("N00", "every hour of the day was photographed and the world read", read_all, hours=list(day.keys()))
    record("N01", "the Dog and the ground in front of it were in frame at every hour", aimed,
           missed=[k for k, v in day.items() if not (v["mascot"] and v["ground"])],
           note="projected rather than assumed: the first version of this proof aimed at a wall and reported "
                "the world as black")
    if not (read_all and aimed):
        RESULT["status"] = "FAIL: the instrument could not see the world"
        return

    lumas = {k: v["whole"]["luma"] for k, v in day.items()}
    darkest = min(lumas, key=lambda k: lumas[k])
    brightest = max(lumas, key=lambda k: lumas[k])
    RESULT["darkest_hour"] = darkest
    RESULT["brightest_hour"] = brightest
    RESULT["world_luma_by_hour"] = lumas
    emit("N_SUM", "INFO", "the day, end to end", lumas)
    # THE NIGHT ITSELF, taken as the worst of the named night hours rather than the worst of the whole day.
    night_key = min((k for k in NIGHT if k in day), key=lambda k: lumas[k])
    night = day[night_key]
    RESULT["darkest_night_hour"] = night_key

    # ---- READABLE, each of the founder's named things read where it actually is.
    record("N02", "at the darkest hour the world is not crushed to black",
           night["whole"]["dark"] <= 0.72,
           darkest_night_hour=night_key, fraction_below_luma_0_14=night["whole"]["dark"], ceiling=0.72,
           world_luma=night["whole"]["luma"],
           note="dark is correct at night; a frame that is nearly all below 0.14 is not a night, it is a "
                "failure to light one")

    # VISIBLE MEANS TELLABLE APART, IN EITHER DIRECTION. The first version of this clause demanded the mascot
    # be BRIGHTER than its ground, which is one of the two ways of being visible and not the more common one:
    # a bone dog reads perfectly well as a pale silhouette against pale paving lit by its own lamp, and a dark
    # skin reads as a dark one. What would actually hide it is the two being the same.
    contrast = abs(night["mascot"]["luma"] - night["ground"]["luma"])
    record("N03", "the mascot can be told apart from the ground it stands on at the darkest hour",
           night["mascot"]["luma"] >= 0.025 and contrast >= 0.05,
           darkest_night_hour=night_key, mascot_luma=night["mascot"]["luma"],
           ground_luma=night["ground"]["luma"], contrast=round(contrast, 4), floor=0.05)

    record("N04", "the ground and paths around the player read at the darkest hour",
           night["ground"]["luma"] >= 0.015,
           darkest_night_hour=night_key, ground_luma=night["ground"]["luma"], floor=0.015)

    record("N05", "there is architecture standing against the sky at the darkest hour",
           night["skyline"] is not None and night["skyline"]["luma"] >= 0.010,
           darkest_night_hour=night_key,
           skyline_luma=night["skyline"]["luma"] if night["skyline"] else None, floor=0.010)

    # ---- AND STILL NIGHT. The clause that stops the fix being "turn the exposure up".
    ratio = night["whole"]["luma"] / max(lumas[brightest], 1e-6)
    RESULT["night_over_day"] = round(ratio, 4)
    record("N10", "night is still unmistakably night beside the brightest hour of the day",
           ratio <= 0.38,
           night_hour=night_key, brightest=brightest, night_luma=night["whole"]["luma"],
           day_luma=lumas[brightest], ratio=round(ratio, 4), ceiling=0.38,
           note="the founder asked for readable, not for a dimmer afternoon")

    # ---- NO JUMPS. A ratio rather than a difference, because a fixed difference would call the same real
    # ---- transition smooth at noon and jarring at midnight. Sampled at half-hours through dusk and dawn, so
    # ---- what this measures is the TRANSITION and not the coarseness of the sampling.
    order = ["%04.1f" % h for h in HOURS]
    steps = []
    for a, b in zip(order, order[1:]):
        la, lb = max(lumas[a], 1e-4), max(lumas[b], 1e-4)
        steps.append({"from": a, "to": b, "ratio": round(max(la, lb) / min(la, lb), 3)})
    RESULT["steps"] = steps
    worst = max(steps, key=lambda s: s["ratio"])
    record("N11", "the day changes smoothly -- no single step jumps the exposure",
           worst["ratio"] <= 2.6, worst_step=worst, ceiling=2.6, every_step=steps,
           note="sunrise and sunset are real changes; a SWITCH would show here as one step several times the "
                "size of its neighbours")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
