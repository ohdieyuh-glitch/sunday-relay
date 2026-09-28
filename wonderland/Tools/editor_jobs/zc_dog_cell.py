# THE DOG LANDS, STANDS, AND IS THEN DESTROYED. Is it going down with its own home cell?
#
# THE TRACK (zc_dog_killz), sampled at 20 Hz from the moment of placement:
#     t=0.00  z=912.0  MOVE_WALKING   placed 900 uu above the ICARUS gate
#     t=0.05  z=912.0  MOVE_FALLING
#     t=0.95  z= 75.2  MOVE_WALKING   LANDED -- floor -14 plus the 89.2 capsule half-height
#     t=1.20  z= 75.2  MOVE_WALKING   still standing, motionless
#     t=1.25  DESTROYED, world still up
#
# So every explanation offered so far is wrong, mine included. Not KillZ: it landed. Not falling
# through unloaded world: the ground was there and it stood on it. Not CatchIfTheGroundIsMissing being
# too slow: the rescue was never needed. Not walking: it had no input and had not moved.
#
# It lands on valid ground, stands for three hundred milliseconds, and is destroyed. z=75.2 is exactly
# what the original nation walk reported as "last seen", so this is the same event the walk hit after
# six waypoints -- the walk simply took longer to arrive at it.
#
# WHAT THAT LEAVES. Three hundred milliseconds of standing still is about one World Partition
# streaming update. The Dog is the streaming source; when it teleports 60 km it stops being a source
# where it was, and the cells there unload. If the DOG'S OWN ACTOR belongs to one of those cells --
# because it is placed in the level rather than spawned at runtime, and is marked spatially loaded --
# then unloading its home cell destroys it. It would go down with the ground it left, not the ground
# it arrived on, which is exactly why nothing about the destination has ever explained it.
#
# THIS JOB READS THE PROPERTY AND TESTS THE PREDICTION.
#
#   C_PROPS   is_spatially_loaded and the actor's package/level, read directly off the Dog.
#   C_NEAR    a SHORT teleport, well inside the cell the Dog is already in and streaming. If the
#             mechanism is "its home cell unloaded behind it", a move that does not leave that cell
#             must survive. This is the control that separates "teleporting is fatal" from
#             "teleporting FAR is fatal", and without it distance is only correlated.
#   C_FAR     the ICARUS placement again, to show the fault still reproduces in this same session
#             rather than comparing a near hop against a remembered far one.
#
# If NEAR survives and FAR dies, the distance is the mechanism and the fix is to stop the Dog being
# unloadable -- not spatially loaded, or spawned at runtime -- rather than anything about nations.
# If BOTH die, teleporting the Dog at all is fatal and the nations are incidental.
# If BOTH survive, the fault needs a state this session has not got into, and nothing here is evidence.
#
# Changes nothing. Ends play.
import json
import math
import os

CONCURRENT = False

L = unreal.WonderlandUiTestLibrary
ROUTES = r"C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign/Nations/nation_routes.json"

NEAR_UU = 1500.0        # a few metres: same cell, already streamed, no question of loading
PLACE_ABOVE = 900.0
TICK = 0.05
WATCH_SECONDS = 8.0
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
            far = json.load(fh)["ICARUS"]["points"][0]
    except Exception as exc:                                           # noqa: BLE001
        bail("could not read the ICARUS route: %s" % exc)
        return

    def watch(label, tx, ty, tz):
        """Place the Dog and watch for WATCH_SECONDS. Yields floats, then one dict."""
        d = pawn()
        if d is None:
            yield {"arm": label, "outcome": "no pawn before placement"}
            return
        before = d.get_actor_location()
        try:
            d.set_actor_location(unreal.Vector(tx, ty, tz), False, True)
        except Exception as exc:                                       # noqa: BLE001
            yield {"arm": label, "outcome": "could not place: %s" % exc}
            return
        track, t, gone = [], 0.0, None
        landed_at = None
        while t < WATCH_SECONDS:
            d = pawn()
            if d is None:
                gone = round(t, 3)
                break
            loc = d.get_actor_location()
            falling = None
            try:
                mc = d.get_movement_component()
                falling = None if mc is None else bool(mc.is_falling())
            except Exception:                                          # noqa: BLE001
                falling = None
            if falling is False and landed_at is None and t > 0.1:
                landed_at = round(t, 3)
            track.append({"t": round(t, 2), "z": round(loc.z, 1), "falling": falling})
            yield TICK
            t += TICK
        return_row = {
            "arm": label, "from": [round(before.x, 1), round(before.y, 1), round(before.z, 1)],
            "to": [round(tx, 1), round(ty, 1), round(tz, 1)],
            "distance_m": round(math.hypot(tx - before.x, ty - before.y) / 100.0, 1),
            "landed_at_s": landed_at, "destroyed_at_s": gone,
            "outcome": "DESTROYED" if gone is not None else "SURVIVED",
            "watched_s": round(t, 2), "world_still_up": live() is not None,
            "last": track[-1] if track else None,
            "seconds_standing_before_loss": (
                None if (gone is None or landed_at is None) else round(gone - landed_at, 3))}
        yield return_row

    arms = {}
    RESULT["arms"] = arms

    for label in ("near", "far"):
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

        d = pawn()
        if d is None:
            arms[label] = {"arm": label, "outcome": "no pawn after begin play"}
            continue

        # ---- READ THE PROPERTY, once, on the first arm.
        if "props" not in RESULT:
            props = {}
            for name in ("is_spatially_loaded", "actor_label", "folder_path"):
                try:
                    props[name] = str(d.get_editor_property(name))
                except Exception as exc:                               # noqa: BLE001
                    props[name] = "unreadable: %s" % type(exc).__name__
            try:
                props["class"] = str(d.get_class().get_name())
            except Exception:                                          # noqa: BLE001
                props["class"] = None
            try:
                props["package"] = str(d.get_outer().get_name())
            except Exception:                                          # noqa: BLE001
                props["package"] = None
            RESULT["props"] = props
            record("C_PROPS", "the Dog's spatial-loading state can be read off the actor",
                   props.get("is_spatially_loaded") not in (None, "")
                   and not str(props.get("is_spatially_loaded")).startswith("unreadable"),
                   **props)

        here = d.get_actor_location()
        if label == "near":
            tx, ty, tz = here.x + NEAR_UU, here.y, here.z + 200.0
        else:
            tx, ty, tz = far["x"], far["y"], far["floor"] + PLACE_ABOVE

        out = None
        for step in watch(label, tx, ty, tz):
            if isinstance(step, dict):
                out = step
            else:
                yield step
        arms[label] = out

    near, farr = arms.get("near"), arms.get("far")
    ok = near is not None and farr is not None
    record("C_RAN", "both a near hop and the far placement ran in this session",
           ok and near.get("outcome") in ("SURVIVED", "DESTROYED")
           and farr.get("outcome") in ("SURVIVED", "DESTROYED"),
           near=(near or {}).get("outcome"), far=(farr or {}).get("outcome"))
    if not ok:
        bail("an arm did not produce a row")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    record("C_FAR", "the far placement still destroys the Dog in this session",
           farr.get("outcome") == "DESTROYED",
           far=farr,
           note="RED means the fault did not reproduce here and the near arm proves nothing by "
                "surviving -- both would simply have survived")
    record("C_NEAR", "a hop that stays inside the streamed cell SURVIVES, so it is the distance and "
                     "not teleporting as such",
           near.get("outcome") == "SURVIVED" and farr.get("outcome") == "DESTROYED",
           near=near, far=farr, near_distance_m=(near or {}).get("distance_m"),
           far_distance_m=(farr or {}).get("distance_m"),
           note="GREEN: the Dog goes down with the cells it LEFT, not the ones it arrived in, and the "
                "fix is to stop the Dog being unloadable -- spatially-loaded off, or spawned at "
                "runtime -- rather than anything about nations or their ground. RED with both "
                "destroyed: teleporting the Dog at all is fatal and the nations are incidental")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
