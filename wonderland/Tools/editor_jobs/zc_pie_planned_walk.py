# PIE-PLANNED WALK (CORE 2026-09-29): plan a route on PLAY-WORLD collision, then walk it SELF-POWERED.
#
# WHY: census footprints are far too big to route through Golden Arrival (an arch's box covers its opening), and
# editor-world traces do not see WonderlandInstancedBatch collision at all (it is built in play). So the plan is made
# INSIDE PIE: for each consecutive pair of targets, a local 1 m grid is sampled -- a floor trace per cell and a
# Pawn-profile capsule test above it -- and a breadth-first search finds a way that never steps up more than
# STEP_UP_CM between neighbouring cells. Then the Dog is placed ONCE at the first target and DRIVEN along the planned
# waypoints with forced input (zc_trail_walk's walker): proof class SELF-POWERED. A pair with no planned way is
# reported with its box, which is itself evidence of a real blockage.
# Globals: LEGS = [{"id": str, "points": [[x, y], ...]}, ...]
CONCURRENT = False
import json
import math
from collections import deque

L = unreal.WonderlandUiTestLibrary
LEGS = globals().get("LEGS", [])
CELL = globals().get("CELL", 50.0)
MARGIN = 1500.0
RADIUS, HALF = 36.0, 87.0          # BP_RelayDog_C's capsule, measured in PIE (zc2E_11): 35.9 / 87.1
STEP_UP_CM = globals().get("STEP_UP_CM", 45.0)
# PLANNING IS ONLY ROUTE-FINDING; THE WALK IS THE PROOF. The Dog's MaxStepHeight is 30 cm, but a flight of 20 cm
# risers on 30 cm treads rises 40+ cm between 1 m cells: the first planner (1 m, 30 cm) could not see up any stair.
# Cells are 0.5 m and a rise of 45 cm between neighbours is allowed; a ledge the Dog cannot climb still stops the
# self-powered walk, and that stop is the verdict.
ARRIVE = 150.0
STUCK = 6.0
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    found = unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes")
    RESULT["status"] = "running"
    RESULT["proof_class"] = "SELF-POWERED (one placement per leg; route planned on play-world collision)"
    unreal.WonderlandUiTestLibrary.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        unreal.SystemLibrary.execute_console_command(ues.get_editor_world(), "wl.Sky.DayMinutes %s" % found)
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 60.0:
        yield 1.0
        t += 1.0
    world = lambda: ues.get_game_world()
    pawn = lambda: unreal.GameplayStatics.get_player_pawn(world(), 0) if world() is not None else None
    t = 0.0
    while pawn() is None and t < 30.0:
        yield 0.5
        t += 0.5
    if pawn() is None:
        RESULT["status"] = "BLOCKED: no pawn"
        return
    unreal.SystemLibrary.execute_console_command(world(), "wl.Sky.DayMinutes 0")
    dog0 = pawn()

    def floor(x, y):
        hit = unreal.SystemLibrary.line_trace_single(world(), unreal.Vector(x, y, 2500.0), unreal.Vector(x, y, -600.0),
                                                     PAWN, False, [p for p in (pawn(),) if p], unreal.DrawDebugTrace.NONE,
                                                     True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        return None if hit is None else float(hit.to_tuple()[4].z)

    def blocked(x, y, z):
        c = unreal.Vector(x, y, z + HALF + 4.0)
        hit = unreal.SystemLibrary.capsule_trace_single_by_profile(world(), c, unreal.Vector(x, y, z + HALF + 5.0),
                                                                  RADIUS, HALF, "Pawn", False, [p for p in (pawn(),) if p],
                                                                  unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED,
                                                                  unreal.LinearColor.GREEN, 0.0)
        if hit is None:
            return None
        t_ = hit.to_tuple()
        return t_[9].get_actor_label() if t_[9] is not None else "?"

    legs_out = []
    RESULT["legs"] = legs_out
    for leg in LEGS:
        pts = [tuple(p) for p in leg["points"]]
        rec = {"id": leg["id"], "targets": len(pts), "planned_pairs": 0, "unplanned": []}
        legs_out.append(rec)
        route = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            x0, x1 = min(a[0], b[0]) - MARGIN, max(a[0], b[0]) + MARGIN
            y0, y1 = min(a[1], b[1]) - MARGIN, max(a[1], b[1]) + MARGIN
            nx, ny = int((x1 - x0) / CELL) + 1, int((y1 - y0) / CELL) + 1
            fz, free = {}, {}

            def cell_ok(i, j):
                if (i, j) not in free:
                    x, y = x0 + i * CELL, y0 + j * CELL
                    z = floor(x, y)
                    fz[(i, j)] = z
                    free[(i, j)] = (z is not None) and (blocked(x, y, z) is None)
                return free[(i, j)]
            s = (int(round((a[0] - x0) / CELL)), int(round((a[1] - y0) / CELL)))
            g = (int(round((b[0] - x0) / CELL)), int(round((b[1] - y0) / CELL)))
            prev, q, n = {s: None}, deque([s]), 0
            cell_ok(*s)
            while q:
                c = q.popleft()
                if c == g:
                    break
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    nb = (c[0] + di, c[1] + dj)
                    if nb in prev or not (0 <= nb[0] < nx and 0 <= nb[1] < ny):
                        continue
                    if not cell_ok(*nb) and nb != g:
                        continue
                    za, zb = fz.get(c), fz.get(nb)
                    if za is not None and zb is not None and zb - za > STEP_UP_CM:
                        continue
                    prev[nb] = c
                    q.append(nb)
                n += 1
                if n % 400 == 0:
                    yield 0.0
            if g in prev:
                path, c = [], g
                while c is not None:
                    path.append((x0 + c[0] * CELL, y0 + c[1] * CELL))
                    c = prev[c]
                path.reverse()
                for p in path[1:]:
                    if math.hypot(p[0] - route[-1][0], p[1] - route[-1][1]) >= 300.0:
                        route.append(p)
                route.append(b)
                rec["planned_pairs"] += 1
            else:
                rec["unplanned"].append({"from": [round(a[0]), round(a[1])], "to": [round(b[0]), round(b[1])],
                                         "cells_tested": len(free), "free": sum(1 for v in free.values() if v)})
                route.append(b)
            yield 0.0
        rec["route_points"] = len(route)
        # the walk: ONE placement at the first target, then forced input along the planned route
        dog = pawn()
        dog.character_movement.disable_movement()
        z0 = floor(*route[0])
        dog.set_actor_location(unreal.Vector(route[0][0], route[0][1], (z0 if z0 is not None else 0.0) + 120.0), False, True)
        dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
        yield 1.0
        wp, best, since, walked, last = 1, None, 0.0, 0.0, None
        g_prev = unreal.GameplayStatics.get_time_seconds(world())
        g_start = g_prev
        budget = sum(math.hypot(route[k][0] - route[k - 1][0], route[k][1] - route[k - 1][1]) for k in range(1, len(route))) / 100.0 + 120.0
        while wp < len(route):
            dog = pawn()
            if dog is None:
                rec["dog_destroyed"] = True
                break
            g_now = unreal.GameplayStatics.get_time_seconds(world())
            dt, g_prev = max(0.0, g_now - g_prev), g_now
            if g_now - g_start > budget:
                rec["timed_out"] = True
                break
            loc = dog.get_actor_location()
            if last is not None:
                walked += math.hypot(loc.x - last[0], loc.y - last[1])
            last = (loc.x, loc.y)
            tx, ty = route[wp]
            dx, dy = tx - loc.x, ty - loc.y
            d = math.hypot(dx, dy)
            if d <= ARRIVE:
                wp, best, since = wp + 1, None, 0.0
                continue
            if best is None or d < best - 20.0:
                best, since = d, 0.0
            else:
                since += dt
                if since >= STUCK:
                    rec["stuck"] = {"at": [round(loc.x), round(loc.y), round(loc.z)], "waypoint": wp,
                                    "blocked_by": blocked(loc.x + dx / d * 60.0, loc.y + dy / d * 60.0, loc.z - HALF - 30.0)}
                    break
            ctrl = dog.get_controller()
            if ctrl is not None:
                ctrl.set_control_rotation(unreal.Rotator(0.0, math.degrees(math.atan2(dy, dx)), 0.0))
            dog.add_movement_input(unreal.Vector(dx / d, dy / d, 0.0), 1.0, True)
            yield 0.0
        rec["arrived"] = wp >= len(route)
        rec["waypoints_reached"] = wp
        rec["walked_m"] = round(walked / 100.0, 1)
        emit("LEG", leg["id"], "ARRIVED" if rec["arrived"] else "NOT ARRIVED", rec["planned_pairs"], len(rec["unplanned"]))
    RESULT["all_arrived"] = all(r.get("arrived") for r in legs_out)
    RESULT["status"] = "walked"
