# THE CANDIDATE FIRE MATERIAL IS OFF FOR TWO DIFFERENT RECORDED REASONS. WHICH ONE IS TRUE?
#
# FOUNDER, P0 item 4: "Arden Infernal and Skeleton Flame need believable animated Unreal fire, not plastic
# voxel flames ... flicker, emissive falloff, softness/distortion, proper attachment."
#
# WHERE THIS STANDS, AND IT IS NOT WHERE EITHER COMMENT SAYS. wl.Look.FireMaterial is 0, so the ribbons draw
# on the figure's own glow material, and the shipped flame measures luma 1.000, blown fraction 1.000, swing
# 0.00024 over four seconds, and channel separation 0.0745. A flat, fully saturated white card with no
# movement and no heat colour -- which is the "plastic" the founder is pointing at, measured.
#
# AND THE PROJECT RECORDS TWO INCOMPATIBLE REASONS FOR THE SWITCH BEING OFF:
#
#   WonderlandCompanionEmbodiment.cpp   "the material's shaping takes exactly the prominence out of it that
#                                        the founder is pointing at ... it stays in the project, reachable"
#   zc_fire_look.py                     "it is off because it DREW NOTHING, and that is an open bug rather
#                                        than a finished feature"
#
# Those cannot both be true. One says the candidate works and is too subtle; the other says it does not draw.
# The fix for each is a different piece of work, and nobody can choose between them from the comments.
#
# SO THIS MEASURES BOTH SURFACES BACK TO BACK, on the same figure, at the same hour, from the same camera,
# and restores whatever it found. Four questions, each of which the two accounts answer differently:
#
#   DOES IT DRAW?     is there anything in the flame band at all on the candidate surface
#   IS IT DIMMER?     how its brightness compares with the shipped one
#   DOES IT MOVE?     swing over four seconds, which a saturated card cannot show
#   DOES IT KEEP ITS COLOUR?  channel separation, which goes to zero exactly when a flame washes to white
#
# NOTHING IS DECIDED HERE. The founder asked for the bright plume back on 2026-09-26 and got it; whether to
# trade prominence for believability is their call and not this job's. This exists so the call is made against
# two measurements instead of two comments that disagree.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import sys
import time
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "fire_two_surfaces")
SKINS = ("arden_infernal", "skeleton_flame")
# Which channel separation is that skin's own fire: Arden burns orange, the Skeleton burns cyan.
WANTS = {"arden_infernal": "red_over_blue", "skeleton_flame": "blue_over_red"}
SWING_SECONDS = 4.0


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    RESULT["tests"] = []

    def record(tid, name, ok, **detail):
        RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

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

    # The clock is stopped and the hour pinned, so the two surfaces are lit identically. See
    # Tools/editor_jobs/README.md: an hour is a request to a running simulation until the clock is stopped.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 23.60")
    yield 1.0
    try:
        frozen = float(unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes"))
    except Exception:                                               # noqa: BLE001
        frozen = None
    record("F_CLOCK", "the clock is stopped so both surfaces are lit the same",
           frozen is not None and abs(frozen) < 1e-3, day_minutes=frozen)
    if frozen is None or abs(frozen) >= 1e-3:
        RESULT["status"] = "VOID: the light would move between the two surfaces"
        return

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    if dog is None or ui is None or pc is None:
        RESULT["status"] = "VOID: no pawn, UI subsystem or controller"
        return

    def found():
        try:
            return int(unreal.SystemLibrary.get_console_variable_int_value("wl.Look.FireMaterial"))
        except Exception:                                           # noqa: BLE001
            return None

    was = found()
    RESULT["fire_material_as_found"] = was
    record("F_KNOB", "the fire material switch can be read back", was is not None, as_found=was,
           note="a switch that cannot be read cannot be restored, and this job must leave the founder's "
                "approved configuration exactly as it found it.")
    if was is None:
        RESULT["status"] = "VOID: cannot read wl.Look.FireMaterial, so it cannot be restored either"
        return

    vw, vh = 1920.0, 1080.0
    try:
        size = L.get_viewport_size()
        if size is not None:
            vw, vh = float(size[0]), float(size[1])
    except Exception:                                               # noqa: BLE001
        pass

    def flame_rect(z_above, half_h=0.055):
        """A band across the figure at a height above its feet, projected from the WORLD rather than guessed."""
        at = dog.get_actor_location()
        got = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(at.x, at.y, at.z + z_above), False)
        if got is None:
            return None
        cx, cy = float(got.x) / vw, float(got.y) / vh
        if not (0.05 < cx < 0.95 and 0.05 < cy < 0.95):
            return None
        return (cx - 0.075, cy - half_h, cx + 0.075, cy + half_h)

    def read_band(rect):
        if rect is None:
            return None
        got = L.read_screen_rect(rect[0], rect[1], rect[2], rect[3])
        if got is None:
            return None
        mean, dark, bright, n = got
        row = {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 5),
               "blown": round(float(bright), 4), "dark": round(float(dark), 4), "samples": int(n)}
        hot = L.read_screen_extremes(rect[0], rect[1], rect[2], rect[3])
        if hot is not None:
            row["blue_over_red"] = round(float(hot[1]), 4)
            row["red_over_blue"] = round(float(hot[2]), 4)
        return row

    def measure(skin):
        """Brightness, blow-out, heat colour and movement, for whichever surface is currently switched on."""
        rect = flame_rect(96.0)
        if rect is None:
            return None
        first = read_band(rect)
        if first is None:
            return None
        series = []
        started = time.time()
        while time.time() - started < SWING_SECONDS:
            got = read_band(rect)
            if got is not None:
                series.append(got["luma"])
            yield 0.1
        globals()["_BAND"] = dict(first)
        if series:
            globals()["_BAND"]["swing"] = round(max(series) - min(series), 5)
            globals()["_BAND"]["series_reads"] = len(series)
            globals()["_BAND"]["mean"] = round(sum(series) / len(series), 5)
        globals()["_BAND"]["separation"] = globals()["_BAND"].get(WANTS[skin])

    readings = {}
    RESULT["readings"] = readings
    for setting in (was, 1 - was if was in (0, 1) else 1):
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireMaterial %d" % setting)
        yield 1.0
        took = found()
        RESULT.setdefault("knob_readback", {})[str(setting)] = took
        if took != setting:
            # THE RUNG VOIDS, NOT THE WORLD. A switch that did not take leaves the previous surface drawing,
            # and publishing that as the other surface's reading is how a knob that does nothing gets credited.
            record("F_SET_%d" % setting, "wl.Look.FireMaterial took the value %d" % setting, False,
                   asked=setting, read=took)
            continue
        record("F_SET_%d" % setting, "wl.Look.FireMaterial took the value %d" % setting, True,
               asked=setting, read=took)
        for skin in SKINS:
            try:
                ui.wear_relay_skin(skin)
            except Exception as err:                                # noqa: BLE001
                RESULT.setdefault("errors", {})["%d/%s" % (setting, skin)] = str(err)[:140]
                continue
            # The flames are rebuilt on wear and on the ticks after it; a reading taken too early is of the
            # previous skin's fire on the previous surface.
            yield 7.0
            yield from measure(skin)
            readings["%d/%s" % (setting, skin)] = globals().get("_BAND")
            emit("F_%d_%s" % (setting, skin), "INFO", "surface %d, %s" % (setting, skin),
                 globals().get("_BAND"))

    # ---- RESTORED, and read back, before anything is concluded.
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FireMaterial %d" % was)
    yield 1.0
    back = found()
    RESULT["fire_material_restored_to"] = back
    record("F_RESTORE", "the founder's approved setting was put back", back == was,
           as_found=was, restored=back,
           note="this job changes a look the founder approved on 2026-09-26. Leaving it changed would make "
                "every later measurement in this session a reading of this job.")

    def get(setting, skin, key):
        return (readings.get("%d/%s" % (setting, skin)) or {}).get(key)

    # ---- THE FOUR QUESTIONS, reported rather than judged, except the one that is a plain contradiction.
    draws = {s: get(1, s, "luma") for s in SKINS}
    shipped = {s: get(0, s, "luma") for s in SKINS}
    RESULT["candidate_vs_shipped"] = {
        "luma_on_candidate": draws, "luma_on_shipped": shipped,
        "blown_on_candidate": {s: get(1, s, "blown") for s in SKINS},
        "blown_on_shipped": {s: get(0, s, "blown") for s in SKINS},
        "swing_on_candidate": {s: get(1, s, "swing") for s in SKINS},
        "swing_on_shipped": {s: get(0, s, "swing") for s in SKINS},
        "separation_on_candidate": {s: get(1, s, "separation") for s in SKINS},
        "separation_on_shipped": {s: get(0, s, "separation") for s in SKINS},
    }
    lit = [v for v in draws.values() if isinstance(v, float)]
    record("F01", "the candidate fire material draws something at all",
           bool(lit) and all(v > 0.02 for v in lit), luma_on_candidate=draws,
           floor=0.02,
           note="THIS IS THE CONTRADICTION. zc_fire_look records that the candidate is off because it DREW "
                "NOTHING; WonderlandCompanionEmbodiment records that it is off because it draws too softly. "
                "A pass here refutes the first account and a fail refutes the second, and the fix for each is "
                "a different piece of work.")


    # ---- PUT RELAY OG BACK, AND CHECK THAT IT WENT BACK.
    #
    # A COSTUME LEFT ON THE DOG REACHED ANOTHER LANE'S PHOTOGRAPHS. zc_stance_preview wore five skins and
    # restored none, so Celestial Light was standing in the world when the integration lane took its
    # acceptance captures nine minutes later -- a large teal crystal form in every frame of their attempt,
    # which they had to ask me about.
    #
    # It invalidated nothing of theirs, because their clauses read widget state. It would have reached the
    # founder in a screenshot as an unexplained object, which is worse than a wrong number.
    #
    # This is the rule every render-setting knob in this tree already follows -- a job that leaves a knob
    # changed makes every later measurement a reading of that job -- and the SKIN is the most visible piece of
    # state in the world, so it was the one place the rule was not applied. Verified with
    # dog.get_worn_skin_id(), because a restore that silently failed is the same as no restore.
    try:
        ui.wear_relay_skin("relay_og")
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["restore"] = str(err)[:140]
    yield 3.0
    worn_back = None
    try:
        worn_back = str(dog.get_worn_skin_id())
    except Exception:                                               # noqa: BLE001
        worn_back = None
    RESULT["worn_after_restore"] = worn_back
    record("F_SKIN", "Relay OG was put back on the Dog, and it went back",
           worn_back is not None and "relay_og" in worn_back.lower(),
           worn_after_restore=worn_back,
           note="a costume left on the Dog appears in every other lane's captures until someone notices.")
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
