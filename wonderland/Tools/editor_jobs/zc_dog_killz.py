# WHY IS THE DOG DESTROYED WHEN IT IS MOVED TO A NATION? Read KillZ, then watch it fall.
#
# WHAT zc_dog_vanish FOUND, and it is a bigger finding than the walk's: BOTH arms died with "the Dog
# did not survive being moved to the start cell". Not after 40.6 m of walking -- at PLACEMENT, before
# a step. So movement is irrelevant, and every "it walked into something" hypothesis is dead along
# with the World Partition cell-unload guess, which needed the Dog to be somewhere it had walked to.
#
# The walk survived placement and lost the Dog six waypoints later; this job's run, on a freshly
# launched editor, lost it during placement. Same destruction, different distance into the sequence --
# which is what a streaming race looks like, not a location-specific hazard.
#
# THE MECHANISM THIS TESTS. RelayDogCharacter::CatchIfTheGroundIsMissing exists for exactly this: a
# Dog standing over a cell that has not streamed in falls through nothing and is destroyed. It waits
# one second of falling-with-nothing-below before returning the Dog to its last good standing, and its
# comment justifies that as "far shorter than the drop to KillZ from a normal height".
#
# A placement 900 uu above an unloaded floor is not a normal height. One second of free fall at
# gravity 1.0 is 490 uu, so the rescue cannot fire until the Dog has dropped from 912 to 422. If this
# map's KillZ sits above 422, the Dog is destroyed BEFORE its own safety net runs, every time, and the
# net has never been able to work for a move of this kind.
#
# So: read KillZ directly rather than infer it, then place the Dog exactly as the walk does and sample
# at 20 Hz through the fall. The result is a profile -- z against time, movement mode, whether the
# rescue fired, and the z it was last seen at -- against a KillZ that is known rather than assumed.
#
# WHAT WOULD FALSIFY WHAT.
#   Dog crosses KillZ before 1.0 s of falling  -> the threshold is the bug and the fix is arithmetic.
#   Dog is destroyed while still above KillZ   -> something else destroys it and KillZ is innocent.
#   Rescue fires and the Dog survives          -> placement is not the fault in THIS state, and the
#                                                 walk's later loss is a different event again.
#
# Changes nothing. Ends play.
import json
import math
import os

CONCURRENT = False

L = unreal.WonderlandUiTestLibrary
ROUTES = r"C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign/Nations/nation_routes.json"

NATION = "ICARUS"
PLACE_ABOVE = 900.0     # exactly what zc_nation_walk uses
TICK = 0.05
MAX_FALL_SECONDS = 25.0
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def bail(why):
        RESULT["status"] = "voided: " + why
        emit("VOID", "FAIL", why, {})

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)

    def live():
        return ues.get_game_world()

    def pawn():
        w = live()
        return None if w is None else unreal.GameplayStatics.get_player_pawn(w, 0)

    try:
        with open(ROUTES, "r") as fh:
            routes = json.load(fh)
        start = (routes.get("nations") or routes)[NATION]["points"][0]
    except Exception as exc:                                           # noqa: BLE001
        bail("could not read the route: %s" % exc)
        return

    if live() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: pawn() is not None, 180)
    L.set_background_throttle_suspended(True)
    L.focus_game_viewport()
    yield 3.0

    # ---- KILLZ, READ AND NOT INFERRED. The founder's rule, and the whole point of this job: the
    # ---- threshold that decides this is a number somebody can look up, so look it up.
    killz, killz_how = None, None
    try:
        ws = unreal.GameplayStatics.get_world_settings(live())
        killz = float(ws.get_editor_property("kill_z"))
        killz_how = "WorldSettings.kill_z"
    except Exception as exc:                                           # noqa: BLE001
        killz_how = "unreadable: %s" % exc
    RESULT["kill_z"] = {"value": killz, "read_from": killz_how}
    record("K_KILLZ", "KillZ can be read directly from the world settings",
           killz is not None, kill_z=killz, read_from=killz_how,
           note="if this is unreadable the rest of the job still measures the fall, but the verdict "
                "below becomes 'the Dog died at z=X' with nothing to compare X against")

    where_stood = None
    d = pawn()
    if d is None:
        bail("no pawn after begin play")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    stood = d.get_actor_location()
    where_stood = [round(stood.x, 1), round(stood.y, 1), round(stood.z, 1)]
    RESULT["spawned_at"] = where_stood

    # ---- PLACE EXACTLY AS THE WALK DOES, and watch.
    place_z = start["floor"] + PLACE_ABOVE
    RESULT["placement"] = {"x": start["x"], "y": start["y"], "z": place_z,
                           "route_floor": start["floor"],
                           "metres_from_spawn": round(
                               math.hypot(start["x"] - stood.x, start["y"] - stood.y) / 100.0, 1)}
    try:
        d.set_actor_location(unreal.Vector(start["x"], start["y"], place_z), False, True)
    except Exception as exc:                                           # noqa: BLE001
        bail("could not place the Dog: %s" % exc)
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    track, t, gone_at, rescued_at = [], 0.0, None, None
    first_fall_t, crossed_killz_at = None, None
    while t < MAX_FALL_SECONDS:
        d = pawn()
        if d is None:
            gone_at = round(t, 3)
            break
        loc = d.get_actor_location()
        falling = None
        mode = None
        try:
            mc = d.get_movement_component()
            if mc is not None:
                falling = bool(mc.is_falling())
        except Exception:                                              # noqa: BLE001
            falling = None
        try:
            comp = d.get_component_by_class(unreal.CharacterMovementComponent)
            if comp is not None:
                mode = str(comp.get_editor_property("movement_mode"))
        except Exception:                                              # noqa: BLE001
            mode = None
        row = {"t": round(t, 2), "z": round(loc.z, 1),
               "x": round(loc.x, 1), "y": round(loc.y, 1),
               "falling": falling, "mode": mode}
        track.append(row)
        if falling and first_fall_t is None:
            first_fall_t = t
        if killz is not None and loc.z <= killz and crossed_killz_at is None:
            crossed_killz_at = round(t, 3)
        # THE RESCUE RETURNS IT TO ITS LAST GOOD STANDING, which is 60 km away at the spawn. A jump
        # back toward where it started is the rescue firing, and is worth telling apart from a death.
        if rescued_at is None and len(track) > 1:
            back = math.hypot(loc.x - stood.x, loc.y - stood.y)
            if back < 5000.0:
                rescued_at = round(t, 3)
        yield TICK
        t += TICK

    RESULT["fall_track"] = track[:6] + (["..."] if len(track) > 12 else []) + track[-12:]
    RESULT["outcome"] = {
        "destroyed_at_s": gone_at, "rescued_at_s": rescued_at,
        "first_falling_at_s": (round(first_fall_t, 3) if first_fall_t is not None else None),
        "crossed_killz_at_s": crossed_killz_at,
        "last_seen": track[-1] if track else None,
        "samples": len(track), "world_still_up": live() is not None}

    record("K_REPRO", "placing the Dog at the nation gate destroys it, with the world still up",
           gone_at is not None and live() is not None,
           destroyed_at_s=gone_at, world_still_up=live() is not None,
           rescued_at_s=rescued_at, last_seen=track[-1] if track else None,
           note="RED means the Dog survived this placement, so the fault is intermittent and the "
                "state it needs has not been reproduced here -- not that it is fixed")

    # ---- THE ARITHMETIC THE CATCH IS BUILT ON, checked against what actually happened.
    fell_for = (None if (gone_at is None or first_fall_t is None) else round(gone_at - first_fall_t, 3))
    RESULT["catch_arithmetic"] = {
        "catch_threshold_s": 1.0,
        "seconds_of_falling_before_loss": fell_for,
        "placement_z": place_z, "kill_z": killz,
        "drop_available_uu": (round(place_z - killz, 1) if killz is not None else None),
        "free_fall_1s_uu": 490.0,
        "z_when_catch_would_fire": round(place_z - 490.0, 1)}
    beaten = (fell_for is not None and fell_for < 1.0)
    record("K_CATCH_TOO_SLOW", "the Dog is destroyed BEFORE CatchIfTheGroundIsMissing's one-second "
                               "threshold, so its own safety net cannot fire",
           beaten, seconds_of_falling_before_loss=fell_for, threshold_s=1.0,
           placement_z=place_z, kill_z=killz,
           z_after_one_second_of_fall=round(place_z - 490.0, 1),
           note="GREEN: the rescue is unreachable for a placement of this height and the fix is the "
                "threshold or the placement height, not the streaming. RED: the Dog survived longer "
                "than a second of falling, so the net had its chance and something else took the Dog")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
