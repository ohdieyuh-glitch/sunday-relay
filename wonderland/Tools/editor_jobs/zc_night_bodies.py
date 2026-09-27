# CAN YOU SEE THE MASCOT AT NIGHT, OR ONLY ITS EYES?
#
# FOUNDER, 2026-09-27, NIGHTTIME LIGHTING CORRECTION, section D: "Do not compensate for bad world lighting by
# blowing out mascot emissives. All mascot eyes still need their intended visible glow, but the environment
# itself must provide enough illumination for the BODY to remain readable ... Characters should look like
# illuminated subjects standing in a nighttime world -- not glowing objects floating in blackness."
#
# Those are two requirements pulling opposite ways, and a single frame luma cannot tell them apart: a figure
# that is one blazing eye in a black void and a figure standing in readable moonlight can average to the same
# number. So this measures them SEPARATELY, on the same frame, at deepest night:
#
#   THE BODY      every pixel of the figure that is NOT one of its own lights. If most of it is crushed to
#                 black the character is not readable, whatever the eyes are doing.
#   THE LIGHTS    the brightest cells, which is where the eyes and any ghostfire are. Reported so that
#                 "the body got brighter" can never be satisfied by the eyes getting brighter.
#   THE GROUND    a band under the figure's feet, because the founder's complaint is equally that the
#                 ground beside a character goes unreadable.
#
# WHAT THIS JOB IS NOT. It does not change any lighting, world or mascot. It is the figure-side reading the
# world lane asked for -- a number that is not an emissive -- so that a night lighting decision can be made
# against "is the character lit" rather than against "is the character visible", which a lamp for a face is
# not. The verdict on the founder's requirement is their screenshots against these captures, not the clauses.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import io
import json
import math
import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "night_bodies")
# CHANNEL is <repo>/wonderland/Tools/_channel, so the repo's wonderland root is two levels up.
REPO = os.path.dirname(os.path.dirname(CHANNEL))
SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
# Deepest night first, because that is the founder's complaint; noon as each figure's own control, because a
# body reading is only meaningful against what the same body does in daylight.
# THREE HOURS, NOT TWO, AND THE THIRD IS THE ONE NOBODY LOOKED AT.
#
# The world lane laddered twilight and found the world is DARKER AT SIX IN THE EVENING THAN AT FULL NIGHT:
# 18:00 luma about a third of 19:00's, ground at 0.009, recovering an hour later. At 18:00 the sun's elevation
# is exactly zero, so the daylight curve has fallen to 0.2 while the nightfall curve is still exactly 0 -- the
# day rig has left and the night rig has not arrived, which means no moon, no shadow lift, no local exposure
# and only part of the exposure bias. A two-rung trough between two working configurations.
#
# This job sampled 23.6 and 12.0, so its 97-per-cent-crushed reading is NOT confounded by that trough, which
# was the first thing worth checking. But it also means the instrument cannot see the worst moment of the day
# for the very thing it measures, and the founder's section G asks for the whole transition verified. Two
# points of a curve is the same error as one draw from an unchecked distribution.
HOURS = (("night", 23.6), ("dusk", 18.0), ("noon", 12.0))
STEP = 2
# A surface at or under this is crushed: no usable form or material information left in it. 0.14 of full white
# is the same floor the world lane's night sweep uses, so the two lanes' "dark" mean the same thing.
DARK = 0.14 * 255.0
# At or over this a cell is one of the figure's own lights rather than its body.
LIGHT = 0.72 * 255.0


def read(path):
    sys.path.insert(0, os.path.dirname(CHANNEL))
    from occupancy import read_png                                  # noqa: WPS433
    return read_png(path)


def figure_stats(path, box):
    """Body, light and ground readings inside a frame whose figure is known to be in `box`.

    box is (x0, y0, x1, y1) in fractions of the frame. Everything outside it is world, not figure.
    """
    w, h, chan, px = read(path)
    x0, y0, x1, y1 = (int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h))
    body = []
    lights = 0
    seen = 0
    for y in range(y0, min(y1, h), STEP):
        row = y * w * chan
        for x in range(x0, min(x1, w), STEP):
            i = row + x * chan
            lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
            seen += 1
            if lum >= LIGHT:
                lights += 1
            else:
                body.append(lum)
    # the ground band: the strip under the figure's box, across its width
    gy0, gy1 = min(y1, h - 1), min(int(y1 + (y1 - y0) * 0.16), h)
    ground = []
    for y in range(gy0, gy1, STEP):
        row = y * w * chan
        for x in range(x0, min(x1, w), STEP):
            i = row + x * chan
            ground.append(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])

    def frac_dark(vals):
        return round(sum(1 for v in vals if v < DARK) / float(max(len(vals), 1)), 4)

    def mean(vals):
        return round(sum(vals) / float(max(len(vals), 1)) / 255.0, 4)

    return {"body_mean": mean(body), "body_dark_fraction": frac_dark(body),
            "light_fraction": round(lights / float(max(seen, 1)), 4),
            "ground_mean": mean(ground), "ground_dark_fraction": frac_dark(ground),
            "cells": seen}


def job():
    os.makedirs(ROOT, exist_ok=True)
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
    yield 8.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if dog is None or ui is None:
        RESULT["status"] = "FAIL: no Dog"
        return

    # ---- THE WORLD'S EXPOSURE, RECORDED AND NOT TOUCHED. If a later run of this job disagrees with this one,
    # ---- the first question is whether somebody moved the exposure between them.
    pinned = []
    RESULT["exposure"] = pinned
    try:
        for vol in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.PostProcessVolume):
            s = vol.settings
            pinned.append({"volume": vol.get_actor_label(),
                           "min_ev100": float(s.get_editor_property("auto_exposure_min_brightness")),
                           "max_ev100": float(s.get_editor_property("auto_exposure_max_brightness")),
                           "bias": float(s.get_editor_property("auto_exposure_bias"))})
    except Exception as err:                                        # noqa: BLE001
        RESULT["exposure_error"] = str(err)[:160]

    # A WHOLE FIGURE, FROM A PLAYER'S DISTANCE. Not a face close-up: the founder's sentence is about the BODY
    # standing in the world, so the shot has to contain the body, its feet and the ground they are on.
    def stand_off(distance=520.0, height=110.0, fov=45.0):
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * distance,
                            here.y + math.sin(math.radians(yaw)) * distance, here.z + height)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + 60.0), fov)

    # ---- WHERE THE FIGURE WAS STANDING, AND HOW FAR THE NEAREST LAMP WAS.
    #
    # THIS READING WAS UNATTRIBUTABLE AND I DID NOT NOTICE FOR A WHOLE RUN. The camera is posed relative to
    # the dog, the dog stands wherever it spawned, and the result recorded neither. So "the body is 97 per
    # cent black at night" was a true sentence about an unknown place. A figure two metres from a street lamp
    # and a figure in an unlit field are the same measurement with opposite meanings, and the founder's
    # requirement -- readable from any major path -- is about the second one.
    #
    # The distance to the nearest practical is read from the same manifest the lights subsystem loads, so a
    # good reading cannot silently be a reading taken under a lamp.
    def nearest_practical(at):
        try:
            spec = json.load(io.open(os.path.join(REPO, "WorldDesign", "Look", "practical_lights.json"),
                                     encoding="utf-8"))
        except Exception as err:                                    # noqa: BLE001
            return {"error": str(err)[:120]}
        best = None
        count = 0
        for row in (spec if isinstance(spec, list) else spec.get("lights", [])):
            try:
                x, y, z = float(row["x"]), float(row["y"]), float(row["z"])
            except Exception:                                       # noqa: BLE001
                continue
            count += 1
            d = math.sqrt((x - at.x) ** 2 + (y - at.y) ** 2 + (z - at.z) ** 2)
            if best is None or d < best:
                best = d
        return {"lights_in_manifest": count,
                "nearest_uu": round(best, 1) if best is not None else None,
                "nearest_m": round(best / 100.0, 1) if best is not None else None}

    where = dog.get_actor_location()
    RESULT["stood_at"] = {"x": round(where.x, 1), "y": round(where.y, 1), "z": round(where.z, 1),
                          "practicals": nearest_practical(where),
                          "note": "the reading below describes THIS place. A body that reads well within a "
                                  "lamp's radius has not shown that the world lights bodies."}

    # the figure's share of the frame at that framing, measured once rather than assumed
    BOX = (0.40, 0.22, 0.60, 0.82)
    RESULT["framing"] = {"distance_uu": 520.0, "fov": 45.0, "figure_box_fraction": BOX,
                         "note": "body cells are everything in the box under the light threshold; the ground "
                                 "band is the strip immediately below it"}

    readings = {}
    RESULT["readings"] = readings
    shots = []
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        for label, hour in HOURS:
            unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
            # AND THE PRACTICAL POOL REBUILT, because BuildPool runs only from Reload and OnWorldBeginPlay.
            # Setting wl.Look.PracticalCount alone leaves the pool at its previous size while the cvar reads
            # back correctly -- a knob that reports success and does nothing, which is the same trap as a
            # cvar that is not recognised at all, wearing a readback that passes.
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.PracticalReload")
            yield 4.0
            # A DEAD WORLD READS AS DATA. Re-acquire and assert rather than trusting the handle from before
            # the hour change; a torn-down PIE returns black frames that pass for a night measurement.
            live = ues.get_game_world()
            pawn = unreal.GameplayStatics.get_player_pawn(live, 0) if live is not None else None
            if live is None or pawn is None:
                record("B_DEAD_%s_%s" % (skin, label), "the world was alive for this reading", False,
                       skin=skin, hour=label)
                continue
            stand_off()
            yield 1.5
            unreal.GameplayStatics.set_game_paused(live, True)
            yield 0.3
            name = "night_body_%s_%s.png" % (skin, label)
            path = os.path.join(ROOT, name)
            try:
                L.capture_game_viewport(path)
                shots.append(name)
                readings["%s/%s" % (skin, label)] = figure_stats(path, BOX)
            except Exception as err:                                # noqa: BLE001
                RESULT.setdefault("errors", {})["%s/%s" % (skin, label)] = str(err)[:140]
            unreal.GameplayStatics.set_game_paused(live, False)
            L.release_camera(live)
            yield 0.3
        emit("B_%s" % skin, "INFO", "%s body at night and noon" % skin,
             {k: v for k, v in readings.items() if k.startswith(skin + "/")})

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")
    ui.wear_relay_skin("relay_og")

    night = {s: readings.get("%s/night" % s) for s in SKINS}
    noon = {s: readings.get("%s/noon" % s) for s in SKINS}
    record("B00", "every skin was photographed at deepest night and at noon",
           all(night.get(s) and noon.get(s) for s in SKINS), taken=len(shots), where=ROOT)

    # ---- THE FOUNDER'S SENTENCE, AS TWO READINGS THAT CANNOT SATISFY EACH OTHER.
    crushed = {s: (night[s] or {}).get("body_dark_fraction") for s in SKINS}
    record("B01", "at night the BODY is not mostly crushed to black",
           all(isinstance(v, float) and v <= 0.60 for v in crushed.values()),
           body_dark_fraction=crushed, floor=DARK / 255.0, ceiling=0.60,
           note="the body is every cell of the figure that is not one of its own lights. This is the reading "
                "the founder's 'illuminated subject, not a glowing object in blackness' actually asks for, "
                "and raising eye glow cannot move it.")

    lit = {s: (night[s] or {}).get("body_mean") for s in SKINS}
    record("B02", "and it carries enough light to read a surface",
           all(isinstance(v, float) and v >= 0.10 for v in lit.values()), body_mean=lit, floor=0.10)

    glow = {s: (night[s] or {}).get("light_fraction") for s in SKINS}
    record("B03", "the figure is not merely a pair of lights in a void",
           all(isinstance(v, float) and v <= 0.18 for v in glow.values()), light_fraction=glow, ceiling=0.18,
           note="high here with B01 also failing is exactly the failure the founder named: eyes blazing, "
                "body gone. It is reported whether or not it passes, so the two can never be traded.")

    ground = {s: (night[s] or {}).get("ground_dark_fraction") for s in SKINS}
    record("B04", "the ground the character stands on is readable too",
           all(isinstance(v, float) and v <= 0.65 for v in ground.values()),
           ground_dark_fraction=ground, ceiling=0.65,
           note="world lighting, not mascot lighting -- reported here because a character reads against the "
                "surface under it and the founder asked for both.")

    fall = {}
    for s in SKINS:
        a, b = (noon[s] or {}).get("body_mean"), (night[s] or {}).get("body_mean")
        fall[s] = None if not (a and b) else round(b / a, 3)
    record("B05", "night still looks like night: the body is clearly darker than it is at noon",
           all(isinstance(v, float) and v <= 0.75 for v in fall.values()), night_over_noon=fall, ceiling=0.75,
           note="the guard against fixing this by turning night into day. B01 and this one must pass together.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
