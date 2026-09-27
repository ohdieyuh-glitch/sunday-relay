# HOW MUCH SCREEN DOES A LUX OF MOONLIGHT BUY?
#
# The moon is in the world, 1,400 lux, pointing down, visible, movable, affecting the world -- and midnight
# photographs as a black rectangle. Either the light is inert or 1,400 is far too small a number in this scene.
# Guessing between those two by reading the source again is how the last three hours would go, so this measures
# it: the same shot at midnight with the moon set to a sweep of intensities, and the screen read each time.
#
# A FLAT LINE MEANS THE LIGHT IS INERT and the fix is structural. A RISING LINE MEANS THE NUMBER IS WRONG and
# the fix is the number -- and the sweep says which number.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "moon_sweep")
STEPS = [0.0, 1400.0, 7000.0, 20000.0, 70000.0, 200000.0]


def job():
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if ues.get_game_world() is None:
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 300)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
        yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 0.5
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 0.0")
    yield 3.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    where = dog.get_actor_location()
    yaw = dog.get_actor_rotation().yaw
    # OUT IN THE OPEN AND LOOKING DOWN AT THE DOG, high enough that the shot cannot be a wall: the last run
    # framed a building interior and half the reading was the inside of it.
    eye = unreal.Vector(where.x - math.cos(math.radians(yaw)) * 700.0,
                        where.y - math.sin(math.radians(yaw)) * 700.0,
                        where.z + 420.0)
    look = unreal.Vector(where.x, where.y, where.z + 40.0)

    moon = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight):
        try:
            if str(actor.get_actor_label()) == "WL_Moon":
                moon = actor
                break
        except Exception:
            pass
    RESULT["found_moon"] = moon is not None
    if moon is None:
        emit("X", "FAIL", "the moon actor is not in the world", {})
        RESULT["status"] = "FAIL"
        return
    comp = moon.get_component_by_class(unreal.DirectionalLightComponent)

    def read():
        got = L.read_screen_rect(0.06, 0.06, 0.94, 0.94)
        if got is None:
            return None
        mean, dark, bright, sampled = got
        return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 5),
                "dark": round(dark, 4), "bright": round(bright, 4)}

    sweep = {}
    RESULT["sweep"] = sweep
    for lux in STEPS:
        comp.set_editor_property("intensity", lux)
        L.pose_camera(world, eye, look, 62.0)
        yield 4.0
        row = read()
        sweep["%.0f" % lux] = row
        shot = os.path.join(ROOT, "moon_%07.0f.png" % lux)
        try:
            L.capture_game_viewport(shot)
        except Exception:
            pass
        emit("M_%.0f" % lux, "INFO", "moon at %.0f lux" % lux, row)

    # AND FOR COMPARISON, THE SAME SHOT AT NOON, so the night numbers have a scale to be read against.
    comp.set_editor_property("intensity", 1400.0)
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    L.pose_camera(world, eye, look, 62.0)
    yield 5.0
    RESULT["noon"] = read()
    shot = os.path.join(ROOT, "noon.png")
    try:
        L.capture_game_viewport(shot)
    except Exception:
        pass
    emit("M_NOON", "INFO", "the same shot at noon", RESULT["noon"])

    L.release_camera(world)
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 9.5")
    RESULT["status"] = "measured"
    yield 1.0
