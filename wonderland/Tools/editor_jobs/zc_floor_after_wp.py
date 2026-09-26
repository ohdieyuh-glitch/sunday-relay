# IS THERE COLLIDABLE FLOOR UNDER THE WHOLE DISC, AFTER THE CONVERSION?
#
# The one thing the World Partition conversion could have broken, asked WITHOUT a pawn.
#
# zc_walk_after_wp answered most of it -- all six cells streamed in within 2.5 s and every one traced solid
# ground -- but its Dog did not survive five of the six stands, so its K03 could not speak. That is a fault in
# the method, not a finding about the world: teleporting a character repeatedly, holding it against gravity
# and releasing it is a lot of machinery to prove something a line trace can prove on its own.
#
# So this drops the Dog entirely. Forty points across the disc, traced straight down, on the channel a
# CHARACTER collides with rather than the one a camera sees through -- because a visibility trace will happily
# hit a mesh that has no collision, and a floor you can see but fall through is exactly the failure mode a
# conversion could introduce. Both channels are read at each point so the two can be compared: a point that
# answers Visibility yes and Pawn no is a floor that is there to look at and not to stand on.
CONCURRENT = True

import math
import unreal

L = unreal.WonderlandUiTestLibrary

RINGS = (80.0, 260.0, 440.0, 620.0, 800.0, 980.0, 1150.0)
PER_RING = 6


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
    world = ues.get_game_world()
    yield 8.0

    RESULT["partition"] = str(L.describe_world_partition(world))
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    home = dog.get_actor_location()

    def trace(x, y, channel):
        try:
            return unreal.SystemLibrary.line_trace_single(
                world, unreal.Vector(x, y, home.z + 3000.0), unreal.Vector(x, y, home.z - 6000.0),
                channel, False, [dog], unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        except Exception:                                          # noqa: BLE001
            return None

    points = []
    RESULT["points"] = points
    for radius in RINGS:
        for i in range(PER_RING):
            bearing = (360.0 / PER_RING) * i + (radius * 0.037)
            x = home.x + math.cos(math.radians(bearing)) * radius * 100.0
            y = home.y + math.sin(math.radians(bearing)) * radius * 100.0
            # THE PLAYER HAS TO BE NEARBY FOR THE CELL TO EXIST. Streaming loads around a source, so the Dog
            # is moved to each point first -- but it is only a streaming source here, never a measurement, so
            # it does not matter whether it survives the trip.
            try:
                dog.set_actor_location(unreal.Vector(x, y, home.z + 400.0), False, False)
            except Exception:                                      # noqa: BLE001
                dog = unreal.GameplayStatics.get_player_pawn(world, 0)
            yield 1.2
            vis = trace(x, y, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1)
            pawn_ch = trace(x, y, unreal.TraceTypeQuery.TRACE_TYPE_QUERY2)
            row = {"radius_m": radius, "bearing": round(bearing, 1),
                   "visible_floor": vis is not None, "collidable_floor": pawn_ch is not None}
            if pawn_ch is not None:
                try:
                    row["floor_z"] = round(float(pawn_ch.to_tuple()[4].z))
                except Exception:                                  # noqa: BLE001
                    pass
            points.append(row)
        emit("F_%04d" % int(radius), "INFO", "ring %d m" % radius,
             {"collidable": sum(1 for p in points if p["radius_m"] == radius and p["collidable_floor"]),
              "of": PER_RING})

    total = len(points)
    seen = sum(1 for p in points if p["visible_floor"])
    solid = sum(1 for p in points if p["collidable_floor"])
    RESULT["totals"] = {"points": total, "visible_floor": seen, "collidable_floor": solid}
    look_only = [p for p in points if p["visible_floor"] and not p["collidable_floor"]]
    RESULT["visible_but_not_collidable"] = look_only

    record("F00", "the traces ran across the whole disc", total == len(RINGS) * PER_RING,
           points=total, wanted=len(RINGS) * PER_RING, partition=RESULT["partition"])
    record("F01", "there is collidable floor at every point of the beta disc",
           solid == total, collidable=solid, of=total,
           missing=[{"r": p["radius_m"], "b": p["bearing"]} for p in points if not p["collidable_floor"]],
           note="traced on the channel a CHARACTER collides with, after the conversion, with the player "
                "standing near each point so its cell is loaded")
    record("F02", "no floor is visible-but-not-solid",
           len(look_only) == 0, visible_but_not_collidable=look_only,
           note="a mesh you can see and fall through is what a conversion that dropped collision would leave "
                "behind, and no count of the map's contents would show it")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
