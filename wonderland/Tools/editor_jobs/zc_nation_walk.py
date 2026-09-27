# CAN THE DOG WALK EACH NATION'S AVENUE, GATE TO BAND, UNDER ITS OWN POWER?
#
# THE RULING (QA-8): "proven by ACTUAL MOVEMENT through it. Not teleport samples, not grounding samples,
# not static navmesh points, not camera evidence." So this is none of those. The Dog is stood at the gate
# end of the route the corridor search found and the avenue was laid on, and then it is DRIVEN: every tick
# it is turned toward the next waypoint and given forward movement input, the way WonderlandDemoFlow drives
# it for the films -- AddMovementInput with bForce, because without force the input is silently dropped
# (WonderlandDemoFlow.cpp:640). It walks, or it does not.
#
# WHAT COUNTS AS WALKING. A waypoint is reached when the Dog's own position is within ARRIVE of it. If the
# Dog has not gained ground on the current waypoint for STUCK seconds it is stuck, and the job records WHERE
# and what was in front of it, then abandons that nation rather than teleporting past the problem -- a
# teleport is exactly the evidence the ruling excludes. The gate is that all three Dogs arrive at the far
# end, and the number that matters when one does not is the radius it reached.
#
# NOT A NAVMESH. The founder retired the continent-scale baked navmesh in favour of local invoker
# generation; nothing here consults a navmesh at all. The route is the geometry's own, from the specs, and
# the walk is the character's own locomotion over the collision that is actually there.
import json
import math
import os

import unreal

L = unreal.WonderlandUiTestLibrary
ROUTES = r"C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign/Nations/nation_routes.json"
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "nation_walk")

EVERY = 4            # every 4th 2 m cell -> 8 m waypoints, the same thinning the avenue was laid on
ARRIVE = 180.0       # within 1.8 m is "there"; the Dog's capsule is 0.72 m wide
STUCK = 6.0          # seconds without gaining 20 cm on the waypoint
TICK = 0.05
MAX_SECONDS = 240.0  # ~480 m at a walk is ~100 s; this is generous, not open-ended
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def job():
    RESULT["status"] = "running"
    tests, nations = [], {}
    RESULT["tests"], RESULT["nations"] = tests, nations
    os.makedirs(ROOT, exist_ok=True)

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    with open(ROUTES, encoding="utf-8") as f:
        routes = json.load(f)

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
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12")
    yield 5.0

    def pawn():
        return unreal.GameplayStatics.get_player_pawn(world, 0)

    def floor_at(x, y, top):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                world, unreal.Vector(x, y, top), unreal.Vector(x, y, top - 3000.0), PAWN, False,
                [p for p in (pawn(),) if p is not None], unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            return None if hit is None else float(hit.to_tuple()[4].z)
        except Exception:                                             # noqa: BLE001
            return None

    def what_is_ahead(dog, heading_deg, dist=150.0):
        """The first colliding thing in the Dog's way, by name, at chest height."""
        try:
            loc = dog.get_actor_location()
            h = math.radians(heading_deg)
            a = unreal.Vector(loc.x, loc.y, loc.z + 40.0)
            b = unreal.Vector(loc.x + math.cos(h) * dist, loc.y + math.sin(h) * dist, loc.z + 40.0)
            hit = unreal.SystemLibrary.line_trace_single(world, a, b, PAWN, False, [dog],
                                                         unreal.DrawDebugTrace.NONE, True,
                                                         unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                return None
            t = hit.to_tuple()
            actor = t[9] if len(t) > 9 else None
            return str(actor.get_actor_label()) if actor is not None else "something"
        except Exception:                                             # noqa: BLE001
            return None

    for nation, route in sorted(routes.items()):
        pts = route["points"][::EVERY]
        if pts[-1] is not route["points"][-1]:
            pts.append(route["points"][-1])
        start = pts[0]
        row = {"waypoints": len(pts), "route_m": None, "reached_m": None, "arrived": False, "stuck_at": None}
        nations[nation] = row
        dog = pawn()
        if dog is None:
            row["error"] = "no pawn"
            continue
        # STOOD AT THE GATE END, on the floor the search measured, and given a moment to settle.
        z0 = floor_at(start["x"], start["y"], start["floor"] + 600.0)
        z0 = start["floor"] if z0 is None else z0
        try:
            dog.set_actor_location(unreal.Vector(start["x"], start["y"], z0 + 100.0), False, True)
        except Exception:                                             # noqa: BLE001
            row["error"] = "could not stand at the start"
            continue
        yield 3.0
        dog = pawn()
        if dog is None:
            row["error"] = "the Dog did not survive standing at the start"
            continue
        loc = dog.get_actor_location()
        row["start_error_m"] = round(math.hypot(loc.x - start["x"], loc.y - start["y"]) / 100.0, 2)
        if row["start_error_m"] > 3.0:
            row["error"] = "the Dog is %.1f m from the start; the cell may not have loaded" % row["start_error_m"]
            continue

        total = sum(math.hypot(pts[i]["x"] - pts[i - 1]["x"], pts[i]["y"] - pts[i - 1]["y"]) for i in range(1, len(pts)))
        row["route_m"] = round(total / 100.0, 1)
        elapsed, wp = 0.0, 1
        best_d, since_gain = float("inf"), 0.0
        reached = 0.0
        while wp < len(pts) and elapsed < MAX_SECONDS:
            dog = pawn()
            if dog is None:
                row["error"] = "the Dog was destroyed mid-walk"
                break
            loc = dog.get_actor_location()
            reached = max(reached, math.hypot(loc.x, loc.y))
            tgt = pts[wp]
            dx, dy = tgt["x"] - loc.x, tgt["y"] - loc.y
            d = math.hypot(dx, dy)
            if d <= ARRIVE:
                wp += 1
                best_d, since_gain = float("inf"), 0.0
                continue
            if d < best_d - 20.0:
                best_d, since_gain = d, 0.0
            else:
                since_gain += TICK
            if since_gain >= STUCK:
                heading = math.degrees(math.atan2(dy, dx))
                row["stuck_at"] = {"radius_m": round(math.hypot(loc.x, loc.y) / 100.0, 1),
                                   "x": round(loc.x), "y": round(loc.y), "z": round(loc.z),
                                   "waypoint": wp, "ahead": what_is_ahead(dog, heading)}
                try:
                    L.capture_game_viewport(os.path.join(ROOT, "%s_stuck.png" % nation.lower()))
                except Exception:                                     # noqa: BLE001
                    pass
                break
            heading = math.degrees(math.atan2(dy, dx))
            try:
                dog.set_actor_rotation(unreal.Rotator(0.0, heading, 0.0), False)
                ctrl = dog.get_controller()
                if ctrl is not None:
                    ctrl.set_control_rotation(unreal.Rotator(0.0, heading, 0.0))
                dog.add_movement_input(unreal.Vector(dx / d, dy / d, 0.0), 1.0, True)
            except Exception as err:                                  # noqa: BLE001
                row["error"] = "movement input failed: %s" % str(err)[:80]
                break
            yield TICK
            elapsed += TICK
        row["reached_m"] = round(reached / 100.0, 1)
        row["seconds"] = round(elapsed, 1)
        row["arrived"] = wp >= len(pts)
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%s_end.png" % nation.lower()))
        except Exception:                                             # noqa: BLE001
            pass
        emit("W_%s" % nation, "PASS" if row["arrived"] else "FAIL", nation,
             {"reached_m": row["reached_m"], "route_m": row["route_m"], "seconds": row["seconds"],
              "stuck": row["stuck_at"], "error": row.get("error")})

    walked = {n: r.get("arrived", False) for n, r in nations.items()}
    record("W00", "every nation's walk started with the Dog standing at the gate end of its route",
           all("error" not in r or r.get("arrived") for r in nations.values()) and len(nations) == 3,
           starts={n: r.get("start_error_m") for n, r in nations.items()},
           errors={n: r.get("error") for n, r in nations.items() if r.get("error")})
    record("W01", "the Dog walked gate to band in every nation under its own locomotion",
           all(walked.values()) and len(walked) == 3, arrived=walked,
           reached_m={n: r.get("reached_m") for n, r in nations.items()},
           route_m={n: r.get("route_m") for n, r in nations.items()},
           stuck={n: r.get("stuck_at") for n, r in nations.items() if r.get("stuck_at")},
           note="AddMovementInput every tick with bForce, no teleports after the start, no navmesh; a stuck "
                "Dog stays stuck and the job records what was in front of it")
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
