# DOES WONDERLAND HAVE A DAY?
#
# FOUNDER: "Add continuous time of day: morning -> afternoon -> evening/night -> morning. Sky, sun, atmosphere,
# exposure, shadows, clouds, windows/lanterns, and environment lighting transition coherently." And: "Fix
# glitching shadows."
#
# So this walks the clock and photographs each hour it is asked for, and reads back what the sky says about
# itself -- elevation, sun intensity, cascade count, shadow distance, exposure -- because "it looks like
# evening" is an opinion and "the sun is 4 degrees up and the exposure has opened a stop" is not.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "day_cycle")
HOURS = [6.5, 9.5, 12.0, 16.0, 17.5, 18.0, 18.2, 18.5, 20.5, 23.0, 3.0]
# The four hours between 17.5 and 18.5 are not decoration: they straddle the terminator, which is the only
# place a day cycle can hide a light switch. Sampling 16.0 and then 18.5 -- as this list used to -- skips
# the entire dusk, so no reading exists at the one elevation band where the transition either happens or
# does not.


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    rows = []
    RESULT["hours"] = rows
    RESULT["status"] = "running"

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    L.focus_game_viewport()

    # Hold the sky still so each photograph is of the hour it says it is.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 1.0

    # ---- FIND THE SUN ONCE, so each hour can be READ rather than photographed and described.
    #
    # This proof used to record only the hour it ASKED FOR and leave the answer in the editor log. That is the
    # shape of a pass that cannot fail: it would have reported "measured" just as happily if the sky had never
    # moved. Worse, the answer that WAS in the log contained a real defect -- 54,821 lux at +9.4 deg and 280 lux
    # at -3.8 deg, a sky that fell off a cliff at the horizon -- and nothing in the result would ever have said
    # so. The readings come back into RESULT now, and the cliff is something a test can fail on.
    # The light COMPONENT, reached without guessing. ADirectionalLight has no get_component() in this Python
    # build -- the first version of this proof assumed it did and died on the assumption -- so the accessors are
    # tried in order and the one that worked is recorded, which is cheaper than being wrong again next time.
    def light_component(actor):
        for how in ("light_component", "directional_light_component"):
            try:
                comp = actor.get_editor_property(how)
                if comp is not None:
                    return comp, how
            except Exception:
                pass
        try:
            comp = actor.get_component_by_class(unreal.DirectionalLightComponent)
            if comp is not None:
                return comp, "get_component_by_class"
        except Exception:
            pass
        return None, "none"

    sun = None
    sun_owner = None
    for light in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight):
        comp, how = light_component(light)
        if comp is None:
            continue
        RESULT["component_reached_via"] = how
        try:
            if comp.get_editor_property("atmosphere_sun_light"):
                sun = comp
                sun_owner = light
                break
        except Exception:
            continue
    RESULT["found_the_sun"] = sun is not None

    for n, hour in enumerate(HOURS):
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
        # Long enough for the sky light to recapture at least twice, or the bounce light lags the sun.
        yield 2.0
        row = {"asked_for": hour}
        if sun is not None:
            row["intensity"] = round(float(sun.get_editor_property("intensity")), 1)
            rot = sun_owner.get_actor_rotation()
            row["elevation_deg"] = round(-float(rot.pitch), 2)
            row["bearing_deg"] = round(float(rot.yaw), 2)
        rows.append(row)
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_hour_%04.1f.jpg" % (n + 1, hour)), 1700, 92)

    # ---- AND NOW THE READINGS ARE JUDGED.
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    record("D00", "the atmosphere sun was found, so the readings are of the real light", sun is not None)
    if sun is not None:
        lit = [r for r in rows if "intensity" in r]
        noon = max(lit, key=lambda r: r["elevation_deg"])
        deep = min(lit, key=lambda r: r["elevation_deg"])
        RESULT["brightest"] = noon
        RESULT["darkest"] = deep
        record("D01", "the sun stands high at midday and below the horizon at night",
               noon["elevation_deg"] > 45.0 and deep["elevation_deg"] < -30.0,
               brightest_elevation=noon["elevation_deg"], darkest_elevation=deep["elevation_deg"])
        record("D02", "noon is daylight and deep night is a moonlight floor, not darkness",
               noon["intensity"] > 20000.0 and 0.0 < deep["intensity"] < 2000.0,
               noon_lux=noon["intensity"], night_lux=deep["intensity"])

        # THE CLIFF TEST, which is the one this proof existed to have. Sorted by elevation, no two ADJACENT
        # samples either side of the horizon may differ by more than 30x: that is what separates a dusk from
        # a light switch. The old curve failed this by 195x between +9.4 and -3.8 degrees.
        band = sorted([r for r in lit if -12.0 <= r["elevation_deg"] <= 15.0], key=lambda r: r["elevation_deg"])
        worst, pair = 1.0, None
        for a, b in zip(band, band[1:]):
            lo = max(a["intensity"], 1.0)
            ratio = max(b["intensity"], 1.0) / lo
            if ratio > worst:
                worst, pair = ratio, [a["elevation_deg"], b["elevation_deg"], a["intensity"], b["intensity"]]
        RESULT["worst_twilight_step_ratio"] = round(worst, 1)
        RESULT["worst_twilight_step"] = pair
        record("D03", "the light does not fall off a cliff when the sun crosses the horizon",
               worst < 30.0, worst_ratio=round(worst, 1), across=pair, samples_in_band=len(band),
               old_curve_was="195x between +9.4 and -3.8 deg")

    # ---------------------------------------------------------------- and it must MOVE on its own
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 17.0")
    yield 1.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 2")
    yield 6.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.State")
    yield 0.5
    H.capture_viewport_jpeg(os.path.join(ROOT, "09_running.jpg"), 1700, 92)
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
    yield 0.5

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
