# THE NAVMESH ACTOR IN THE LEVEL IS THE ONE THAT DECIDES, NOT THE INI DEFAULT.
#
# RuntimeGeneration=Dynamic went into DefaultEngine.ini and changed nothing, which makes sense: the level now
# carries a saved RecastNavMesh-Default actor, created before that line existed, and an ini default applies
# to newly created data rather than to an actor already serialised into the map.
#
# So this reads what the actor is actually set to, says so, sets it, and saves -- and only then asks whether
# a route appears. Reading it first matters: if it already says Dynamic then RuntimeGeneration was never the
# reason and the next guess would have been built on a wrong premise.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import time
import unreal

L = unreal.WonderlandUiTestLibrary

PROBE_M = 400.0


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

    world = ues.get_editor_world()
    meshes = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RecastNavMesh)
    RESULT["recast_in_level"] = [str(m.get_actor_label()) for m in meshes]

    before, after = [], []
    for m in meshes:
        try:
            before.append(str(m.get_editor_property("runtime_generation")))
        except Exception as err:                                   # noqa: BLE001
            before.append("read failed: %s" % str(err)[:80])
    RESULT["runtime_generation_before"] = before

    for m in meshes:
        # The enum is RuntimeGenerationType, not ERuntimeGenerationType -- and naming it inside a getattr
        # default does not save you, because the missing attribute is evaluated before the default is used.
        candidates = []
        enum = getattr(unreal, "RuntimeGenerationType", None)
        if enum is not None:
            candidates.append(getattr(enum, "DYNAMIC", None))
        candidates.extend(["DYNAMIC", 2])
        for value in candidates:
            if value is None:
                continue
            try:
                m.set_editor_property("runtime_generation", value)
                break
            except Exception:
                continue
        try:
            after.append(str(m.get_editor_property("runtime_generation")))
        except Exception as err:                                   # noqa: BLE001
            after.append("read failed: %s" % str(err)[:80])
    RESULT["runtime_generation_after"] = after

    record("R00", "the level's navmesh is set to generate at runtime",
           any("DYNAMIC" in str(v).upper() for v in after) if after else False,
           before=before, after=after,
           note="an ini default does not reach an actor already serialised into the map")

    if meshes:
        yield 2.0
        try:
            les.save_current_level()
        except Exception as err:                                   # noqa: BLE001
            RESULT["save_error"] = str(err)[:200]
        yield 3.0

    # ---- AND NOW ASK AGAIN.
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    gw = ues.get_game_world()
    L.focus_game_viewport()

    dogs = unreal.GameplayStatics.get_all_actors_of_class(gw, unreal.RelayDogCharacter)
    dog = dogs[0] if dogs else unreal.GameplayStatics.get_player_pawn(gw, 0)

    # Sampled over time so the answer says WHEN a surface appeared rather than only whether it did.
    marks = {}
    started = time.time()
    found_at = None
    for wait in (10, 25, 40, 60, 90):
        while time.time() - started < wait:
            yield 2.0
        here = dog.get_actor_location()
        r = None
        try:
            r = unreal.NavigationSystemV1.get_random_reachable_point_in_radius(gw, here, 3000.0)
        except Exception:
            r = None
        marks["after_%ds" % wait] = None if r is None else [round(float(r.x), 1), round(float(r.y), 1)]
        emit("R01_%ds" % wait, "INFO", "reachable point", {"at": marks["after_%ds" % wait]})
        if r is not None and found_at is None:
            found_at = wait
            break
    RESULT["reachable_over_time"] = marks
    RESULT["surface_after_seconds"] = found_at
    record("R01", "a navigable surface exists under the Dog",
           found_at is not None, appeared_after_seconds=found_at, samples=marks,
           note="get_random_reachable_point_in_radius, which succeeds only where tiles are actually built")

    here = dog.get_actor_location()
    RESULT["from"] = [round(float(here.x), 1), round(float(here.y), 1)]
    reached, attempts = 0, []
    for degrees in (0.0, 60.0, 120.0, 180.0, 240.0, 300.0):
        rad = math.radians(degrees)
        goal = unreal.Vector(float(here.x) + math.cos(rad) * PROBE_M * 100.0,
                             float(here.y) + math.sin(rad) * PROBE_M * 100.0,
                             float(here.z))
        try:
            path = unreal.NavigationSystemV1.find_path_to_location_synchronously(gw, here, goal, dog)
        except Exception as err:                                   # noqa: BLE001
            attempts.append({"bearing": degrees, "error": str(err)[:100]})
            continue
        pts = 0
        if path is not None:
            try:
                pts = len(path.path_points)
            except Exception:
                pts = 0
        attempts.append({"bearing": degrees, "points": pts})
        if pts >= 2:
            reached += 1
        yield 0.5
    RESULT["routes"] = attempts
    RESULT["routes_found"] = reached
    record("R02", "the engine can route across this level over %.0f m" % PROBE_M,
           reached >= 1, found=reached, of=len(attempts), attempts=attempts)

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
