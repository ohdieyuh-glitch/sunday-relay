# CAN ANYTHING BE ROUTED ACROSS THIS LEVEL YET?
#
# FOUNDER, P2 item 13: the world must be complete for "collisions, traversal, streaming".
#
# WHAT WAS TRUE BEFORE THIS. Wonderland had NO navigation data whatsoever. Not a sparse one, not a stale one
# -- none: the project shipped without a single navigation setting in DefaultEngine.ini and without a
# NavMeshBoundsVolume in the level, so NavigationSystemV1 returned nothing over 400 m and no actor could be
# routed anywhere. zc_nation_paths had to build a walkability grid and search it with the Dog's own capsule
# to answer whether the nations were even traversable, because the engine's own navigation could not be asked.
#
# WHY THIS IS AN INVOKER AND NOT A BAKE. The world is a 1,478 m disc carrying 174,787 instances over 3,904
# instanced components, and the map is a 46 MB asset on a shared Content junction. A full bake across 2.5 km
# of that is a long, heavy, all-or-nothing operation. An invoker generates only the tiles near the player and
# discards them behind, so the cost is set by the Dog's radius rather than by the size of the world.
#
# The Dog carries a UNavigationInvokerComponent at 6,000/7,500 uu, and DefaultEngine.ini sets
# bGenerateNavigationOnlyAroundNavigationInvokers with the Recast agent sized to the Dog's own capsule.
# What remains is the bounds volume, which is a map edit -- so the .umap is backed up outside the worktree
# first, and this job is the thing that proves the result rather than assuming it.
CONCURRENT = True

import math
import time
import unreal

L = unreal.WonderlandUiTestLibrary

#: Half-extent in metres. The built world ends near 1,200 m.
HALF_M = 1250.0
BRUSH_UU = 200.0

#: How far away to ask for a path.
#:
#: 400 m WAS THE WRONG QUESTION, and it failed for a reason that was mine rather than the level's. An invoker
#: generates tiles within its radius and discards them behind: at 6,000 uu that is 60 m, so a 400 m goal is a
#: request to route onto ground that deliberately has no mesh under it. Routing there was never what this
#: design promises, and reporting its absence as a defect would have been measuring the wrong thing.
#:
#: What invoker navigation does promise is a routable surface around the player that travels with them. So
#: the route is asked for INSIDE the radius, and the surface is then checked again after the Dog has walked,
#: which is the claim that actually matters.
PROBE_M = 40.0


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    actors = unreal.EditorActorSubsystem()

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)

    world = ues.get_editor_world()
    RESULT["world"] = str(world.get_name())

    # ---- THE BOUNDS VOLUME, added only if the level does not already carry one.
    existing = [str(a.get_actor_label())
                for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.NavMeshBoundsVolume)]
    RESULT["bounds_before"] = existing
    added = False
    if not existing:
        scale = (HALF_M * 2.0 * 100.0) / BRUSH_UU
        volume = actors.spawn_actor_from_class(
            unreal.NavMeshBoundsVolume, unreal.Vector(0.0, 0.0, 0.0), unreal.Rotator(0.0, 0.0, 0.0))
        if volume is None:
            record("V00", "a navigation bounds volume exists in the level", False,
                   note="spawn returned nothing")
            RESULT["status"] = "FAIL: could not spawn the bounds volume"
            return
        volume.set_actor_scale3d(unreal.Vector(scale, scale, 300.0))
        try:
            volume.set_actor_label("WL_NavBounds")
        except Exception:
            pass
        added = True
        RESULT["volume"] = {"scale": round(scale, 1), "covers_metres": round(HALF_M * 2.0, 1)}
        yield 2.0
        try:
            les.save_current_level()
        except Exception as err:                                   # noqa: BLE001
            RESULT["save_error"] = str(err)[:200]
        yield 3.0

    now = [str(a.get_actor_label())
           for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.NavMeshBoundsVolume)]
    RESULT["bounds_after"] = now
    RESULT["added_this_run"] = added
    record("V00", "the level carries a navigation bounds volume", len(now) > 0,
           volumes=now, added_this_run=added,
           note="the level shipped without one, which is why it had no navigation data at all")

    # ---- NOW ASK THE ENGINE, IN PIE, WHERE THE INVOKER ACTUALLY IS.
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    gw = ues.get_game_world()
    L.focus_game_viewport()

    dogs = unreal.GameplayStatics.get_all_actors_of_class(gw, unreal.RelayDogCharacter)
    dog = dogs[0] if dogs else unreal.GameplayStatics.get_player_pawn(gw, 0)
    RESULT["dog"] = str(dog.get_name()) if dog is not None else None

    # Generation around an invoker is not instant: give it real time before judging.
    started = time.time()
    built = None
    for _ in range(60):
        yield 2.0
        meshes = unreal.GameplayStatics.get_all_actors_of_class(gw, unreal.RecastNavMesh)
        if meshes:
            built = meshes
            break
    RESULT["seconds_to_navmesh"] = round(time.time() - started, 1)
    RESULT["recast_actors"] = [str(a.get_actor_label()) for a in (built or [])]
    record("V01", "a navigation mesh actually generates in play",
           bool(built), seconds=RESULT["seconds_to_navmesh"], actors=RESULT["recast_actors"],
           note="generated around the Dog's invoker rather than baked across the disc")

    # Let the tiles around the Dog settle before routing through them.
    yield 8.0

    here = dog.get_actor_location()
    RESULT["from"] = [round(float(here.x), 1), round(float(here.y), 1), round(float(here.z), 1)]

    # ---- THE THING THAT FAILED BEFORE: a path over 400 m.
    #
    # Asked in several directions, because one bearing can run into a building and a single "no path" would
    # say more about that building than about whether the level can be routed at all.
    reached, attempts = 0, []
    for degrees in (0.0, 60.0, 120.0, 180.0, 240.0, 300.0):
        rad = math.radians(degrees)
        goal = unreal.Vector(float(here.x) + math.cos(rad) * PROBE_M * 100.0,
                             float(here.y) + math.sin(rad) * PROBE_M * 100.0,
                             float(here.z))
        path = None
        try:
            path = unreal.NavigationSystemV1.find_path_to_location_synchronously(gw, here, goal, dog)
        except Exception as err:                                   # noqa: BLE001
            attempts.append({"bearing": degrees, "error": str(err)[:120]})
            continue
        ok = path is not None
        points = 0
        if ok:
            try:
                points = len(path.path_points)
            except Exception:
                points = 0
            ok = points >= 2
        attempts.append({"bearing": degrees, "path": bool(ok), "points": points})
        if ok:
            reached += 1
        yield 0.5
    RESULT["routes"] = attempts
    RESULT["routes_found"] = reached
    record("V02", "the engine can route through the level within the invoker's radius (%.0f m)" % PROBE_M,
           reached >= 1, found=reached, of=len(attempts), attempts=attempts,
           note="find_path_to_location_synchronously returned NOTHING anywhere before this, at any distance; "
                "asked on six bearings so one blocked direction cannot decide it")

    # ---- AND THE SURFACE TRAVELS WITH THE DOG, which is the whole bargain of an invoker: tiles are built
    # ahead and dropped behind, so navigation exists where the player is without existing everywhere.
    start_at = dog.get_actor_location()
    L.set_key_held("W", True)
    L.set_key_held("LeftShift", True)
    for _ in range(45):
        yield 0.2
    L.set_key_held("W", False)
    L.set_key_held("LeftShift", False)
    yield 3.0
    moved_to = dog.get_actor_location()
    # FVector::Size() is C++. The Python binding has no .size(), so the distance is computed here rather
    # than borrowed from an API that does not exist.
    walked = float(math.sqrt((moved_to.x - start_at.x) ** 2
                             + (moved_to.y - start_at.y) ** 2
                             + (moved_to.z - start_at.z) ** 2))
    still_navigable = None
    try:
        r = unreal.NavigationSystemV1.get_random_reachable_point_in_radius(gw, moved_to, 2500.0)
        still_navigable = None if r is None else [round(float(r.x), 1), round(float(r.y), 1)]
    except Exception:
        still_navigable = None
    RESULT["walked_uu"] = round(walked, 1)
    RESULT["navigable_after_walking"] = still_navigable
    record("V04", "the navigable surface follows the Dog as it walks",
           walked > 200.0 and still_navigable is not None,
           walked_uu=round(walked, 1), reachable_point_after=still_navigable,
           note="tiles built ahead and discarded behind: navigation where the player is, without paying for "
                "it across a 1,478 m disc")

    # ---- AND THE COST, because an invoker is only worth it if it is cheap.
    #
    # THIS CLAUSE CERTIFIED PERFORMANCE ON A DEAD CLOCK. It read the frame cost once and passed on
    # `frame < 0.0 or frame < 400.0`, which is two vacuous passes wearing one condition:
    #
    #   the read THREW           -> frame = -1.0 -> -1 < 0 -> PASS
    #   the overlay was not up   -> frame = 0.00 -> 0 < 400 -> PASS
    #
    # and the second is the one that was actually happening, because nothing in this job ever turned the
    # overlay on. FStatUnitData reports 0.00 when it is not drawing, so V03 has been reporting "the frame
    # cost stays sane" while measuring nothing at all. A ceiling that a zero satisfies is not a ceiling.
    #
    # So: the overlay is enabled, the clock is sampled rather than read once, zeros are discarded, and NO
    # LIVE READING IS A FAILURE rather than a pass. `stat unit` is a TOGGLE -- it is issued once here and
    # never on a timer, because re-issuing it turns the overlay back off and this session has already lost
    # a night-time measurement that way.
    unreal.SystemLibrary.execute_console_command(world, "stat unit")
    yield 2.0
    live = []
    started = time.time()
    while time.time() - started < 5.0:
        try:
            got = unreal.WonderlandHudTestLibrary.get_frame_cost_ms()
            if got is not None and float(got[0]) > 0.01:
                live.append(float(got[0]))
        except Exception:                                      # noqa: BLE001
            pass
        yield 0.0
    live.sort()
    frame = live[int(len(live) * 0.95)] if live else 0.0
    RESULT["frame_ms_with_nav"] = round(frame, 2)
    RESULT["frame_samples"] = len(live)
    record("V03", "the frame cost stays sane with navigation generating",
           len(live) > 0 and frame < 400.0,
           frame_ms=round(frame, 2), samples=len(live), ceiling_ms=400.0,
           note="the p95 of a live overlay, not a single read. Zero samples is a FAILING result: it "
                "means the clock was not running and the cost is unknown, which is exactly what this "
                "clause used to report as a pass. Generation is bounded by the invoker's radius, not by "
                "the size of the world.")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
