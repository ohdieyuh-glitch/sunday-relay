# IS THE SKULL BLACK, DO THE LEGS GLOW, AND ARE THE FEET STILL BLUE?
#
# FOUNDER, SKELETON FLAME MASCOT: "The SKULL/FACE AREA that is black is supposed to STAY BLACK ... The EYES
# inside that black skull area need to visibly GLOW ... the BLACK PARTS ON THE LEGS need to visibly GLOW.
# Preserve their black identity while giving them the intended luminous/glowing behavior ... The FEET should
# NOT be blue. The feet should use the same neutral color family as the non-blue portions of the mascot -- the
# existing GRAY/BLACK body colorway ... Judge completion from the ACTUAL RENDERED MASCOT, not material values
# or test variables."
#
# THAT LAST SENTENCE IS WHY THIS JOB EXISTS RATHER THAN A DIFF. The three corrections are two material swaps
# and one new material, and every one of them is trivially verifiable in the generator source -- which is
# exactly the kind of proof the founder has ruled out. A material named "ash" can still render blue if it is
# lit by a blue light, a material named "voidglow" can still look black if its strength is too low to survive
# the exposure, and a skull can go grey because something else nearby got brighter.
#
# SO EACH CLAUSE MEASURES THE PIXELS IN ONE REGION OF THE FIGURE:
#
#   THE FEET       is blue DOMINANT there? A neutral gray or black has its three channels close together; the
#                  spectral materials are (0.22, 0.70, 1.00) and (0.72, 0.94, 1.00), so blue leads red by a
#                  wide margin. This asks the ratio rather than the colour, because the exposure moves the
#                  absolute values all day and the ratio between channels is what "blue" means.
#   THE LEGS       do they hold their light when the world goes dark? A LIT black falls with the sun; an
#                  emissive black does not. So the test is the leg band's night reading against its own noon
#                  reading, which needs no threshold for "glowing" -- only that it not behave like the
#                  surfaces around it.
#   THE SKULL      is it still the darkest thing on the figure? Asked relatively, so a night that got brighter
#                  cannot fail it and a recolour cannot pass it.
#
# THE REGIONS ARE FRACTIONS OF THE FIGURE'S BOX AND ARE THE WEAKEST PART OF THIS JOB. They are stated here so
# a reader can check them against the capture rather than trusting them, and every clause publishes the region
# it measured.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import os
import sys
import time
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skeleton_parts")
REPO = os.path.dirname(os.path.dirname(CHANNEL))

HOURS = (("day", 12.0), ("dusk", 18.0), ("night", 23.6))
# The founder's list: front, side, rear, at a close view and at normal gameplay distance.
FACES = (("front", 0.0), ("side", 90.0), ("rear", 180.0))
VIEWS = (("close", 260.0), ("gameplay", 900.0))

# Bands down the figure, as fractions of the frame the figure fills. Published with every reading.
REGIONS = {
    # the head is the top of the figure; the skull plate and face sit in its lower half
    "skull": (0.40, 0.23, 0.60, 0.33),
    # the shins, above the feet
    "legs": (0.40, 0.64, 0.60, 0.74),
    # the feet, at the bottom of the figure's box
    "feet": (0.40, 0.76, 0.60, 0.84),
    # the chest, as the figure's own reference for "the rest of the body"
    "torso": (0.40, 0.42, 0.60, 0.55),
}
STEP = 2
# Blue is DOMINANT when it leads red by this much. The spectral materials lead by 4.5x and 1.4x; a neutral
# gray leads by about 1.0. 1.25 sits clear of both.
BLUE_LEADS = 1.25


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    sys.path.insert(0, os.path.join(REPO, "Tools"))
    from night_figure import read                                   # noqa: WPS433

    RESULT["tests"] = []
    RESULT["regions"] = REGIONS

    def record(tid, name, ok, **detail):
        RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def region_stats(path, box):
        """Mean channels and luma inside a box, as fractions of full white."""
        w, h, chan, px = read(path)
        x0, y0, x1, y1 = int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)
        r = g = b = 0.0
        n = 0
        for y in range(y0, min(y1, h), STEP):
            row = y * w * chan
            for x in range(x0, min(x1, w), STEP):
                i = row + x * chan
                r += px[i]
                g += px[i + 1]
                b += px[i + 2]
                n += 1
        if not n:
            return None
        r, g, b = r / n / 255.0, g / n / 255.0, b / n / 255.0
        return {"r": round(r, 4), "g": round(g, 4), "b": round(b, 4),
                "luma": round(0.2126 * r + 0.7152 * g + 0.0722 * b, 4),
                "blue_over_red": round(b / max(r, 1e-6), 3),
                "cells": n}

    if ues.get_game_world() is None:
        les.editor_play_simulate()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    if dog is None:
        RESULT["status"] = "VOID: no pawn"
        return

    # THE SKIN IS WORN THROUGH THE UI SUBSYSTEM, NOT THE TEST LIBRARY. zc_eye_split's first run errored on all
    # five skins with "WonderlandUiTestLibrary has no attribute wear_relay_skin", because I wrote the call from
    # memory of zc_night_bodies, where it reads ui.wear_relay_skin() and `ui` is L.get_ui(world), not L.
    ui = L.get_ui(world)
    if ui is None:
        RESULT["status"] = "VOID: no UI subsystem"
        return
    try:
        ui.wear_relay_skin("skeleton_flame")
    except Exception as err:                                        # noqa: BLE001
        RESULT["status"] = "VOID: could not wear skeleton_flame: %s" % str(err)[:120]
        return
    yield 8.0

    def look(distance, turn):
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw + turn
        mid_z = here.z + 70.0
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * distance,
                            here.y + math.sin(math.radians(yaw)) * distance, mid_z + 30.0)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, mid_z), 42.0)

    readings = {}
    RESULT["readings"] = readings
    shots = []
    for hour_label, hour in HOURS:
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.PracticalReload")
        yield 4.0
        for face_label, turn in FACES:
            for view_label, distance in VIEWS:
                live = ues.get_game_world()
                if live is None or unreal.GameplayStatics.get_player_pawn(live, 0) is None:
                    record("S_DEAD_%s_%s_%s" % (hour_label, face_label, view_label),
                           "the world was alive for this reading", False)
                    continue
                look(distance, turn)
                yield 1.2
                unreal.GameplayStatics.set_game_paused(live, True)
                yield 0.3
                key = "%s/%s/%s" % (hour_label, face_label, view_label)
                name = "skel_%s_%s_%s.png" % (hour_label, face_label, view_label)
                path = os.path.join(ROOT, name)
                try:
                    got = L.capture_game_viewport(path)
                    if not got:
                        raise RuntimeError("capture_game_viewport returned falsy: the editor window is "
                                           "probably not foreground")
                    shots.append(name)
                    readings[key] = {part: region_stats(path, box) for part, box in REGIONS.items()}
                except Exception as err:                            # noqa: BLE001
                    RESULT.setdefault("errors", {})[key] = str(err)[:160]
                unreal.GameplayStatics.set_game_paused(live, False)
                L.release_camera(live)
                yield 0.3
        emit("S_%s" % hour_label, "INFO", "skeleton flame at %s" % hour_label,
             {k: v for k, v in readings.items() if k.startswith(hour_label + "/")})

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")
    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass

    RESULT["captures_dir"] = ROOT
    record("S00", "the mascot was photographed from every side at every hour",
           len(shots) >= len(HOURS) * len(FACES) * len(VIEWS), taken=len(shots),
           wanted=len(HOURS) * len(FACES) * len(VIEWS), where=ROOT)

    def part(key, name, field):
        return ((readings.get(key) or {}).get(name) or {}).get(field)

    # ---- THE FEET ARE NOT BLUE. Front and side at both distances, every hour.
    feet = {}
    for hour_label, _ in HOURS:
        for face_label, _t in FACES:
            for view_label, _d in VIEWS:
                k = "%s/%s/%s" % (hour_label, face_label, view_label)
                v = part(k, "feet", "blue_over_red")
                if v is not None:
                    feet[k] = v
    RESULT["feet_blue_over_red"] = feet
    worst_feet = max(feet.values()) if feet else None
    record("S01", "the feet are not blue",
           bool(feet) and all(v <= BLUE_LEADS for v in feet.values()),
           blue_over_red=feet, worst=worst_feet, ceiling=BLUE_LEADS,
           note="blue over red in the foot band. The two spectral materials the feet were made of lead red by "
                "4.5x and 1.4x; ash and void lead by about 1.0. Measured as a RATIO because the exposure moves "
                "every absolute value across the day and 'blue' is a relationship between channels.")

    # ---- THE BLACK LEG PARTS GLOW: they keep their light when the world does not.
    legs = {}
    for face_label, _t in FACES:
        for view_label, _d in VIEWS:
            day = part("day/%s/%s" % (face_label, view_label), "legs", "luma")
            night = part("night/%s/%s" % (face_label, view_label), "legs", "luma")
            torso_day = part("day/%s/%s" % (face_label, view_label), "torso", "luma")
            torso_night = part("night/%s/%s" % (face_label, view_label), "torso", "luma")
            if None in (day, night, torso_day, torso_night) or day <= 0 or torso_day <= 0:
                continue
            legs["%s/%s" % (face_label, view_label)] = {
                "legs_night_over_day": round(night / day, 3),
                "torso_night_over_day": round(torso_night / torso_day, 3),
                # AN EMISSIVE SURFACE HOLDS MORE OF ITS DAYLIGHT VALUE THAN A LIT ONE BESIDE IT. The torso is
                # the figure's own control, so no absolute threshold for "glowing" has to be invented and a
                # night that is generally brighter cannot pass this on its own.
                "legs_hold_better_than_torso": round((night / day) / (torso_night / torso_day), 3),
            }
    RESULT["legs_glow"] = legs
    holds = [v["legs_hold_better_than_torso"] for v in legs.values()]
    record("S02", "the black leg parts hold their light at night better than the lit body does",
           bool(holds) and all(v >= 1.10 for v in holds),
           legs_glow=legs, floor=1.10,
           note="the leg band's night-over-day, divided by the torso's. Above 1.0 means the legs lose less of "
                "their daylight brightness than the lit surfaces beside them, which is what an emissive black "
                "does and a LIT black cannot. The seam was `void`, lit, and fell with the sun.")

    # ---- THE SKULL STAYS BLACK: still the darkest region on the figure.
    skull = {}
    for hour_label, _ in HOURS:
        for face_label, _t in FACES:
            k = "%s/%s/close" % (hour_label, face_label)
            s = part(k, "skull", "luma")
            t = part(k, "torso", "luma")
            if s is None or t is None or t <= 0:
                continue
            skull[k] = {"skull_luma": s, "torso_luma": t, "skull_over_torso": round(s / t, 3)}
    RESULT["skull_black"] = skull
    ratios = [v["skull_over_torso"] for v in skull.values()]
    record("S03", "the skull area is still clearly darker than the body around it",
           bool(ratios) and all(v <= 0.75 for v in ratios),
           skull_black=skull, ceiling=0.75,
           note="asked against the figure's own torso rather than against a fixed level, so a brighter night "
                "cannot fail it and a recolour toward the body cannot pass it. The founder's instruction is "
                "that this area stays black while other black areas start to glow.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
