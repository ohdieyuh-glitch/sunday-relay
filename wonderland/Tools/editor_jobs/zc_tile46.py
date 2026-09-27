# IS THERE A HOLE IN THE FLOOR AT 617 METRES, OR IS THE HARNESS STANDING IN A GAP?
#
# Tile [4, 6] is the one stand of twenty-three that the beta walk has never been able to measure, across every
# version of the hold logic tried today. The numbers are specific and they do not look like a harness fault:
#
#   centre (-58764, -18764) | 172 mesh actors in the tile | the tile's actors average z = 524
#   the entire column at that exact point, +/- 8000 uu, contains ONE surface, at z = -14
#
# So at the precise point the walk stands on, the nearest floor is 538 metres below the height at which that
# tile's own geometry sits. Every hold rule tried has failed there for a different reason -- the averaged
# height put the Dog inside masonry, the lowest hit put it under the terrain, and the hit nearest the tile's
# geometry could not help because there is no hit near the tile's geometry to choose.
#
# THAT IS NO LONGER A HARNESS QUESTION. Either the floor genuinely has a gap at that point, which is a beta
# defect and exactly what "no empty areas, walk-test every major region" exists to catch, or the tile's 172
# actors are clustered away from its centre and the centre is legitimately open ground far below. Those are
# different findings and the walk cannot tell them apart, because it only ever samples one point per tile.
#
# So this samples a grid ACROSS the tile rather than a single point at its middle. A gap shows as a few dead
# points in a field of good ones; a tile whose content sits off-centre shows as a consistent floor at one
# height with the centre simply being part of it.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import unreal

L = unreal.WonderlandUiTestLibrary

CENTRE = (-58764.0, -18764.0)
# The walk's tiles are 200 m; this samples a 5x5 grid across one of them.
STEP_UU = 5000.0
SPAN = 2


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

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)

    # ---- THE CELL HAS TO BE HERE BEFORE ANY OF THIS MEANS ANYTHING.
    #
    # World Partition only streams around a streaming source, so tracing into an unloaded cell reports "no
    # floor" for every point in it and would turn a perfectly good tile into a reported hole. The Dog is moved
    # to the tile and held well clear while the cell arrives.
    if dog is not None:
        try:
            dog.set_actor_location(unreal.Vector(CENTRE[0], CENTRE[1], 3000.0), False, False)
            mc = dog.character_movement
            if mc is not None:
                mc.set_movement_mode(unreal.MovementMode.MOVE_FLYING)
        except Exception:                                          # noqa: BLE001
            pass
    yield 14.0

    grid = []
    RESULT["grid"] = grid
    for ix in range(-SPAN, SPAN + 1):
        for iy in range(-SPAN, SPAN + 1):
            x = CENTRE[0] + ix * STEP_UU
            y = CENTRE[1] + iy * STEP_UU
            hits = []
            try:
                column = unreal.SystemLibrary.line_trace_multi(
                    world, unreal.Vector(x, y, 9000.0), unreal.Vector(x, y, -9000.0),
                    unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False, [dog] if dog else [],
                    unreal.DrawDebugTrace.NONE, True,
                    unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
                if column:
                    for one in column:
                        try:
                            hits.append(round(float(one.to_tuple()[4].z)))
                        except Exception:                          # noqa: BLE001
                            pass
            except Exception:                                      # noqa: BLE001
                pass
            grid.append({"offset": [ix, iy], "at": [round(x), round(y)],
                         "surfaces": sorted(set(hits)), "count": len(hits)})
        yield 0.2

    empty = [g for g in grid if g["count"] == 0]
    RESULT["points_with_no_surface"] = len(empty)
    RESULT["points"] = len(grid)
    tops = sorted({s for g in grid for s in g["surfaces"]})
    RESULT["distinct_surface_heights"] = tops[:40]
    emit("T_GRID", "INFO", "surfaces across the tile",
         {"points": len(grid), "with_no_surface": len(empty),
          "heights": RESULT["distinct_surface_heights"]})

    record("T00", "every sample point across the tile has a surface under it",
           len(empty) == 0, no_surface_at=[g["offset"] for g in empty], of=len(grid),
           note="a handful of dead points in a field of good ones is a GAP IN THE FLOOR and a beta defect. "
                "All points dead means the cell never arrived and this measured nothing. A consistent floor "
                "everywhere means the walk's single centre sample was simply unlucky.")

    highs = [max(g["surfaces"]) for g in grid if g["surfaces"]]
    if highs:
        RESULT["highest_surface_span"] = [min(highs), max(highs)]
        record("T01", "the tile's floor is at one broad height rather than scattered",
               (max(highs) - min(highs)) < 4000.0,
               span_uu=[min(highs), max(highs)], spread_uu=round(max(highs) - min(highs)),
               note="the walk expected this tile's floor near z=524 from its actors and found only z=-14 at "
                    "the exact centre. If the floor here really is 500 m up across the tile, the centre is a "
                    "hole; if it is at -14 everywhere, the actors sit on something the centre does not share.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
