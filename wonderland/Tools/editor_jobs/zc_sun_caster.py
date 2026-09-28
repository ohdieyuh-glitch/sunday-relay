# CAN THE SUN STOP CASTING AT NIGHT WITHOUT MOVING THE APPROVED NIGHT?
#
# FOUNDER, item 11: "Fix glitching shadows: flicker, bias, leaking, unstable shadows, CONFLICTING LIGHTS."
#
# THE DEFECT IS MEASURED AND REAL. The world lane's caster census: from about 18:40 to dawn, Wonderland has
# TWO directional shadow casters -- V2_Sun and WL_Moon -- so every object throws two directional shadows all
# night. The day cycle writes only the MOON's cast_shadows; the sun's comes from the map and is never
# cleared. The comment at the moon's caster site asserts "the world never has two directional shadow casters
# at once", which is true in the direction it was tested and false for the state that ships.
#
# AND THE OBVIOUS FIX IS ALREADY KNOWN TO BE HARMFUL, which is why this job is an experiment rather than a
# patch. From that same comment, verbatim: "The first version of this gate also switched the SUN off as a
# caster whenever the moon took over, which is the symmetrical-looking thing to do and was wrong: measured
# across the whole cycle, dusk went from 0.103 to 0.191 and the entire night lifted by half again. The sun is
# the ATMOSPHERE light -- Lumen and the SkyAtmosphere are both wired to it -- and taking its shadows away
# changes how the world is lit globally, not just what it casts."
#
# The approved night is on the founder's preserved list. "The entire night lifted by half again" is precisely
# the change they forbade, so bCastShadows=false is not available however tidy it looks.
#
# SO THE QUESTION IS NARROWER: is there a knob that stops the sun's SHADOWS specifically while leaving it as
# the atmosphere light? A directional light has more than one, and they are not equivalent -- cascaded shadow
# distance, shadow amount, and the cast flags are different mechanisms with different reach into Lumen.
#
# ENUMERATED, NOT GUESSED. Every candidate is asked for by name and the ones this engine does not have are
# reported as absent rather than silently skipped -- a getter returning 0.0 for a property that does not
# exist is how I nearly built a water fix on a parameter belonging to a different material tonight.
#
# THE GATE IS THE FOUNDER'S OWN NIGHT. Ground luma 0.108 at 23:00, at the plaza vantage the world lane
# measured -- (-64, -5700), yaw 90, eye height 160. That is the only vantage they trust in that area; their
# earlier dusk corpus was shot from a camera inside a bush, so the older spot is not reused here.
#
# A KNOB ONLY PASSES IF IT DOES BOTH: drops the caster count to one AND leaves that ground reading where it
# is. Either alone is not a fix -- one leaves the defect, the other breaks the approved night.
#
# NOTHING IS LEFT CHANGED. Every knob is restored after its own measurement, and the run reports what it
# found rather than shipping anything.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import unreal

L = unreal.WonderlandUiTestLibrary
SL = unreal.SystemLibrary

NIGHT_HOUR = 23.0
# The world lane's trusted plaza vantage. Eye height 160, looking along yaw 90 at the paving.
EYE = (-64.0, -5700.0, 160.0)
YAW = 90.0
APPROVED_GROUND_LUMA = 0.108
TOLERANCE = 0.010          # the same 0.010 their own ground gate holds

# Candidates, narrowest first. Only the ones this engine exposes are tried.
CANDIDATES = (
    ("dynamic_shadow_distance_movable_light", 0.0),
    ("shadow_amount", 0.0),
    ("cast_dynamic_shadows", False),
)


def job():
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
    L.focus_game_viewport()
    yield 6.0
    world = ues.get_game_world()

    # ---- STOP THE CLOCK BEFORE SETTING AN HOUR. wl.Sky.DayMinutes defaults to 24, so an hour set on a
    # running clock drifts out from under every reading taken after it.
    SL.execute_console_command(world, "wl.Sky.DayMinutes 0")
    SL.execute_console_command(world, "wl.Sky.Hour %0.2f" % NIGHT_HOUR)
    yield 4.0

    # ---- THE LIGHTS, AND WHICH OF THEM CAST.
    def census():
        out = []
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight):
            try:
                label = str(actor.get_actor_label())
            except Exception:                                       # noqa: BLE001
                label = str(actor.get_name())
            comp = None
            try:
                comp = actor.get_component_by_class(unreal.DirectionalLightComponent)
            except Exception:                                       # noqa: BLE001
                pass
            casts = None
            if comp is not None:
                try:
                    casts = bool(comp.get_editor_property("cast_shadows"))
                except Exception:                                   # noqa: BLE001
                    casts = None
            if casts:
                out.append(label)
        return sorted(out)

    def sun_component():
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight):
            try:
                if "sun" in str(actor.get_actor_label()).lower():
                    return actor.get_component_by_class(unreal.DirectionalLightComponent)
            except Exception:                                       # noqa: BLE001
                continue
        return None

    def ground_luma():
        """Mean luma of a paving patch at the world lane's trusted vantage."""
        L.pose_camera(world, unreal.Vector(*EYE),
                      unreal.Vector(EYE[0] + math.cos(math.radians(YAW)) * 600.0,
                                    EYE[1] + math.sin(math.radians(YAW)) * 600.0, EYE[2] - 120.0), 70.0)
        got = None
        try:
            got = L.read_screen_rect(0.30, 0.55, 0.70, 0.90)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["read"] = str(err)[:140]
        if not got:
            return None
        p = list(got)
        if p and isinstance(p[0], bool):
            if not p[0]:
                return None
            p = p[1:]
        mean = p[0]
        return round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 5)

    yield 2.0
    base_casters = census()
    yield 1.5
    base_luma = ground_luma()
    yield 1.0
    RESULT["at_2300_as_shipped"] = {"casters": base_casters, "ground_luma": base_luma}
    emit("C_BASE", "INFO", "the shipped night", RESULT["at_2300_as_shipped"])

    record("C00", "the two-caster defect reproduces at 23:00 on this build",
           len(base_casters) > 1, casters=base_casters,
           note="the world lane measured this from the actor list. Reproduced here before anything is "
                "changed, because a fix for a defect that is not present is a change with no reason.")

    record("C01", "the approved night reads as the world lane measured it",
           base_luma is not None and abs(base_luma - APPROVED_GROUND_LUMA) < 0.05,
           measured=base_luma, their_figure=APPROVED_GROUND_LUMA,
           note="THE GATE'S OWN CALIBRATION. If this vantage does not reproduce their number then the gate "
                "below is measuring something else and no verdict from it means anything.")

    sun = sun_component()
    record("C02", "the sun's light component was found", sun is not None)
    if sun is None or base_luma is None:
        RESULT["status"] = "VOID: no sun component or no baseline reading"
        return

    # ---- WHICH KNOBS THIS ENGINE ACTUALLY HAS.
    have = {}
    for name, _ in CANDIDATES:
        try:
            have[name] = sun.get_editor_property(name)
        except Exception:                                           # noqa: BLE001
            have[name] = None
    RESULT["knobs_this_engine_exposes"] = {k: (str(v) if v is not None else None) for k, v in have.items()}
    emit("C_KNOBS", "INFO", "shadow knobs on the sun", RESULT["knobs_this_engine_exposes"])

    trials = {}
    RESULT["trials"] = trials
    winner = None
    for name, value in CANDIDATES:
        if have.get(name) is None:
            trials[name] = {"absent_on_this_engine": True}
            continue
        was = have[name]
        try:
            sun.set_editor_property(name, value)
        except Exception as err:                                    # noqa: BLE001
            trials[name] = {"error": str(err)[:140]}
            continue
        yield 3.0
        casters = census()
        yield 1.0
        luma = ground_luma()
        yield 0.5
        drift = None if luma is None else round(luma - base_luma, 5)
        holds = luma is not None and abs(drift) <= TOLERANCE
        one_caster = len(casters) <= 1
        trials[name] = {"set_to": str(value), "casters": casters, "ground_luma": luma,
                        "night_drift": drift, "night_holds": holds, "single_caster": one_caster,
                        "fixes_it": bool(holds and one_caster)}
        emit("C_%s" % name, "INFO", name, trials[name])
        if holds and one_caster and winner is None:
            winner = name
        # PUT IT BACK before the next one, so no two knobs are ever on together.
        try:
            sun.set_editor_property(name, was)
        except Exception:                                           # noqa: BLE001
            pass
        yield 2.0

    RESULT["knob_that_fixes_it"] = winner
    record("C03", "a knob exists that stops the sun casting AND leaves the approved night where it is",
           winner is not None, winner=winner, trials=trials,
           approved=APPROVED_GROUND_LUMA, tolerance=TOLERANCE,
           note="BOTH OR IT IS NOT A FIX. Dropping the caster count while lifting the night is the change "
                "the founder forbade -- the first attempt at this took dusk from 0.103 to 0.191 and lifted "
                "the whole night by half. Holding the night while still casting twice leaves the defect.")

    # ---- LEAVE THE WORLD AS IT WAS FOUND, INCLUDING THE CLOCK.
    after = census()
    RESULT["casters_after_restore"] = after
    record("C_RESTORE", "every knob was put back and the night is casting as it was",
           after == base_casters, before=base_casters, after=after)
    SL.execute_console_command(world, "wl.Sky.DayMinutes 24")
    try:
        L.release_camera(world)
    except Exception:                                               # noqa: BLE001
        pass

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
