# WHAT DESTROYS THE DOG 40 METRES INTO ICARUS? Standing still against walking, at the same place.
#
# THE FAULT (zzT4_nation_walk, current binary, harness faults already fixed by the other lane):
#     ICARUS   the DOG went away at waypoint 6 after 40.6 m, 11.2 s
#     NOCTIS   the DOG went away at waypoint 11 after 83.1 m
#     "the world is still up and the DOG is gone -- destroyed, not stuck"
# Not a fall: last_z 75.2 against a real floor of -14.0 is 89.2 uu up, which is the capsule half-height.
# The Dog was standing correctly. `fell` was False. The pawn is simply destroyed.
#
# AND THE PLACEMENT IS NOT THE CAUSE EITHER. The walk already streams the start in before standing on
# it -- moves the Dog close, polls the floor until it answers, then stands it -- and ICARUS reported
# start_stream_wait_s 1.0 and a start_error_m of 0.0. The Dog survived being placed and walked six
# waypoints before it went.
#
# THE QUESTION THIS JOB ANSWERS, and it is the one that splits every hypothesis in half:
# DOES IT HAVE TO WALK?
#
#   STILL  placed at the gate exactly as the walk places it, then left standing for as long as the
#          walk survived, times three. No input at all.
#   WALK   placed identically, then driven the same way the walk drives it.
#
# If STILL dies too, movement is irrelevant and the cause is the teleport, the streaming state around
# it, or simply time -- and every "it walked into something" hypothesis is dead, including the World
# Partition cell-unload guess, which would not need the Dog to move.
# If only WALK dies, the Dog is walking into something that destroys it, and the sampler below says
# where and what was under and ahead of it at the time.
#
# THE SAMPLER RUNS AT 0.1 s AND KEEPS THE LAST 40 SAMPLES, so the moment of loss is recorded rather
# than inferred: position, velocity, movement mode, whether a floor trace answers below and ahead, and
# the distance to the nearest streamed ground. A pawn that vanishes between two samples 100 ms apart
# is a different event from one that drifts, sinks, or stops.
#
# Changes no lighting and no knob. Ends play. Saves nothing.
import json
import math
import os

CONCURRENT = False

L = unreal.WonderlandUiTestLibrary
ROUTES = r"C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign/Nations/nation_routes.json"
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "dog_vanish")

NATION = "ICARUS"
EVERY = 4
ARRIVE = 180.0
TICK = 0.1
KEEP = 40
#: The walk lost ICARUS after 11.2 s. Three times that standing still is a generous test of "does it
#: need to move", and still short enough to leave room for the walking arm in one PIE session.
STILL_SECONDS = 40.0
WALK_SECONDS = 40.0
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests
    os.makedirs(ROOT, exist_ok=True)

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

    def floor_at(x, y, from_z):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                live(), unreal.Vector(x, y, from_z), unreal.Vector(x, y, from_z - 20000.0),
                PAWN, False, [], unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                return None
            return round(float(hit.to_tuple()[4].z), 1)
        except Exception:                                              # noqa: BLE001
            return None

    # ---- THE ROUTE, read from the same file the walk uses.
    try:
        with open(ROUTES, "r") as fh:
            routes = json.load(fh)
    except Exception as exc:                                           # noqa: BLE001
        bail("could not read %s: %s" % (ROUTES, exc))
        return
    entry = (routes.get("nations") or routes).get(NATION)
    if not entry:
        bail("no %s in the routes file" % NATION)
        return
    cells = entry.get("cells") or entry.get("waypoints") or entry.get("points") or []
    pts = [cells[i] for i in range(0, len(cells), EVERY)] if cells else []
    if len(pts) < 8:
        bail("%s has only %d thinned waypoints; expected the avenue" % (NATION, len(pts)))
        return
    start = entry.get("start") or (pts[0] if isinstance(pts[0], dict) else None)
    if not isinstance(start, dict) or "x" not in start:
        bail("could not find a start with x/y/floor for %s" % NATION)
        return
    RESULT["route"] = {"nation": NATION, "thinned_waypoints": len(pts), "start": start}

    def xy(p):
        if isinstance(p, dict):
            return float(p.get("x")), float(p.get("y"))
        return float(p[0]), float(p[1])

    def stand_at_gate():
        """Exactly the walk's own placement: move close, wait for the floor, then stand."""
        d = pawn()
        if d is None:
            yield (None, "no pawn before placement")
            return
        try:
            d.set_actor_location(
                unreal.Vector(start["x"], start["y"], start["floor"] + 900.0), False, True)
        except Exception:                                              # noqa: BLE001
            pass
        z0, waited = None, 0.0
        while z0 is None and waited < 20.0:
            yield 1.0
            waited += 1.0
            z0 = floor_at(start["x"], start["y"], start["floor"] + 600.0)
        z0 = start["floor"] if z0 is None else z0
        d = pawn()
        if d is None:
            yield (None, "the Dog did not survive being moved to the start cell")
            return
        try:
            d.set_actor_location(unreal.Vector(start["x"], start["y"], z0 + 100.0), False, True)
        except Exception:                                              # noqa: BLE001
            yield (None, "could not stand at the start")
            return
        yield 3.0
        yield ((z0, waited), None)

    def sample(d):
        loc = d.get_actor_location()
        mv = None
        try:
            comp = d.get_component_by_class(unreal.CharacterMovementComponent)
            if comp is not None:
                mv = {"mode": str(comp.get_editor_property("movement_mode")),
                      "falling": bool(d.get_movement_component().is_falling())
                      if hasattr(d, "get_movement_component") else None}
        except Exception:                                              # noqa: BLE001
            mv = None
        below = floor_at(loc.x, loc.y, loc.z + 200.0)
        return {"t": None, "x": round(loc.x, 1), "y": round(loc.y, 1), "z": round(loc.z, 1),
                "floor_below": below,
                "height_above_floor": (round(loc.z - below, 1) if below is not None else None),
                "move": mv}

    def run_arm(label, walk, seconds):
        """Place, then either stand still or drive. Returns the arm's row."""
        row = {"arm": label, "walking": walk, "seconds_asked": seconds}
        placed, err = None, None
        for step in stand_at_gate():
            if isinstance(step, tuple):
                placed, err = step
            else:
                yield step
        if err:
            row["outcome"] = "never started: " + err
            yield row
            return
        row["stream_wait_s"], row["start_floor_z"] = (placed[1], placed[0]) if placed else (None, None)

        ring, t, wp = [], 0.0, 1
        gone_at = None
        while t < seconds:
            d = pawn()
            if d is None:
                gone_at = t
                break
            s = sample(d)
            s["t"] = round(t, 2)
            s["waypoint_target"] = wp
            ring.append(s)
            if len(ring) > KEEP:
                ring.pop(0)
            if walk and wp < len(pts):
                tx, ty = xy(pts[wp])
                loc = d.get_actor_location()
                dx, dy = tx - loc.x, ty - loc.y
                if math.hypot(dx, dy) <= ARRIVE:
                    wp += 1
                else:
                    try:
                        yaw = math.degrees(math.atan2(dy, dx))
                        d.set_actor_rotation(unreal.Rotator(0.0, yaw, 0.0), False)
                        d.add_movement_input(unreal.Vector(dx, dy, 0.0).normal(), 1.0, False)
                    except Exception:                                  # noqa: BLE001
                        pass
            yield TICK
            t += TICK

        row["last_samples"] = ring[-12:]
        row["waypoints_reached"] = wp - 1
        if gone_at is None:
            last = ring[-1] if ring else None
            row["outcome"] = "SURVIVED"
            row["seconds_survived"] = round(t, 2)
            row["ended_at"] = last
            if walk and last:
                row["travelled_m"] = round(
                    math.hypot(last["x"] - start["x"], last["y"] - start["y"]) / 100.0, 1)
        else:
            row["outcome"] = "DOG DESTROYED"
            row["seconds_before_loss"] = round(gone_at, 2)
            row["world_still_up"] = live() is not None
            last = ring[-1] if ring else None
            row["last_seen"] = last
            if last:
                row["travelled_m"] = round(
                    math.hypot(last["x"] - start["x"], last["y"] - start["y"]) / 100.0, 1)
        yield row

    arms = {}
    RESULT["arms"] = arms
    for label, walk, secs in (("still", False, STILL_SECONDS), ("walk", True, WALK_SECONDS)):
        if live() is not None:
            les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 600)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 300)
        yield (lambda: pawn() is not None, 180)
        # RE-ARMED PER ARM. A PIE restart drops focus and throttle suspension, and the other lane's
        # walk measured window focus rather than distance for exactly this reason.
        L.set_background_throttle_suspended(True)
        L.focus_game_viewport()
        yield 2.0
        out = None
        for step in run_arm(label, walk, secs):
            if isinstance(step, dict):
                out = step
            else:
                yield step
        arms[label] = out

    still, walked = arms.get("still"), arms.get("walk")
    ok_pop = still is not None and walked is not None
    record("V_RAN", "both arms ran from the same placement, so they are comparable",
           ok_pop and still.get("outcome") != "never started"
           and walked.get("outcome") != "never started",
           still=(still or {}).get("outcome"), walk=(walked or {}).get("outcome"),
           still_stream_wait=(still or {}).get("stream_wait_s"),
           walk_stream_wait=(walked or {}).get("stream_wait_s"))
    if not ok_pop:
        bail("one of the arms did not produce a row")
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    record("V_REPRO", "the walking arm reproduces the fault, so this job is looking at the real thing",
           walked.get("outcome") == "DOG DESTROYED",
           walk_outcome=walked.get("outcome"),
           seconds=walked.get("seconds_before_loss"), travelled_m=walked.get("travelled_m"),
           waypoints=walked.get("waypoints_reached"), last_seen=walked.get("last_seen"),
           note="RED here does not clear the fault -- it means it did not reproduce in this session, "
                "and the still arm below is then the only reading worth anything")

    record("V_NEEDS_MOVEMENT", "the Dog survives standing still where walking kills it -- movement is "
                               "necessary, so the cause is something it walks INTO",
           still.get("outcome") == "SURVIVED" and walked.get("outcome") == "DOG DESTROYED",
           still_outcome=still.get("outcome"),
           still_seconds=still.get("seconds_survived") or still.get("seconds_before_loss"),
           walk_outcome=walked.get("outcome"), walk_seconds=walked.get("seconds_before_loss"),
           still_row=still, walk_row=walked,
           note="GREEN: movement is required, so every explanation that does not need the Dog to move "
                "is dead -- including a World Partition cell unload around a teleported pawn, which "
                "would take it standing still. RED with BOTH destroyed: movement is irrelevant and the "
                "cause is the placement, the streaming state around it, or elapsed time, and the walk "
                "distance in every earlier report was a coincidence of how long each nation took")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
