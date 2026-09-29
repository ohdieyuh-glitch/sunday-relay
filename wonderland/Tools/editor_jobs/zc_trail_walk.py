# SELF-POWERED WALK OF A SIDECAR ROUTE: can the Dog walk a garden walk / wood trail end to end on its own feet?
#
# Proof class SELF-POWERED (founder rule 2026-09-29: every walk proof is SELF-POWERED / TELEPORT / MIXED). The Dog
# is placed ONCE, at the route's first point. From there it is DRIVEN: each tick it is turned toward the next
# waypoint and given forced movement input, as zc_nation_walk does (AddMovementInput with bForce -- without force
# the input is dropped, WonderlandDemoFlow.cpp:640). No teleport after the start. If it stops gaining ground for
# STUCK seconds, the job records where and what is in front of it, and abandons that route. It does not skip ahead.
#
# Routes are the sidecars the generators write (<id>_walk.json: "walk" is a world polyline every ~5 m). Globals:
#   ROUTES  [path, ...]   the sidecars to walk, in order
#   EVERY   waypoint thinning (2 -> ~10 m)
# Reports per route: arrived, fraction of waypoints, metres walked, seconds, stuck point + blocker, whether the
# Dog was destroyed, the streaming state at the stuck point, and the lowest floor z seen (a fall shows up there).
# PIE-owning: CONCURRENT is False. Restores wl.Sky.DayMinutes on every exit.
CONCURRENT = False
import json
import math

L = unreal.WonderlandUiTestLibrary
ROUTES = globals().get("ROUTES", [])
EVERY = globals().get("EVERY", 2)
ARRIVE = 180.0
STUCK = 6.0
TICK = 0.05
SPEED_GUESS = 100.0           # cm/s: a deliberately slow guess, so a slow editor never fails a route on time;
                              # the STUCK test (no 20 cm gain in 6 game-seconds) is what fails a blocked one
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    found = unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes")
    RESULT["day_minutes_found"] = found
    RESULT["status"] = "running"
    RESULT["proof_class"] = "SELF-POWERED (one placement at each route's start)"
    # A backgrounded, CPU-throttled editor ticks a few frames a second, and forced input moves the Dog ~20 cm/s
    # (JUJU's arc, 2026-09-29: 156 uu in 8 s). Unthrottled for the job, restored after it.
    perf = None
    try:
        perf = unreal.get_default_object(unreal.EditorPerformanceSettings)
        RESULT["throttle_found"] = bool(perf.get_editor_property("throttle_cpu_when_not_foreground"))
        perf.set_editor_property("throttle_cpu_when_not_foreground", False)
    except Exception as exc:                                           # noqa: BLE001
        RESULT["throttle_error"] = repr(exc)[:120]
    try:
        yield from _walk_all(ues, les)
    finally:
        if perf is not None and "throttle_found" in RESULT:
            perf.set_editor_property("throttle_cpu_when_not_foreground", RESULT["throttle_found"])
        unreal.SystemLibrary.execute_console_command(ues.get_editor_world(), "wl.Sky.DayMinutes %s" % found)
        RESULT["day_minutes_restored"] = unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes")
        if ues.get_game_world() is not None:
            les.editor_request_end_play()


def _walk_all(ues, les):
    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    L.focus_game_viewport()

    def world():
        return ues.get_game_world()

    def pawn():
        w = world()
        if w is None:
            return None
        try:
            p = unreal.GameplayStatics.get_player_pawn(w, 0)
            if p is not None:
                p.get_actor_location()
            return p
        except Exception:                                              # noqa: BLE001
            return None

    unreal.SystemLibrary.execute_console_command(world(), "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world(), "wl.Sky.Hour 11.0")

    def ahead(dog, heading, dist=160.0):
        try:
            loc = dog.get_actor_location()
            h = math.radians(heading)
            hit = unreal.SystemLibrary.line_trace_single(
                world(), unreal.Vector(loc.x, loc.y, loc.z + 30.0),
                unreal.Vector(loc.x + math.cos(h) * dist, loc.y + math.sin(h) * dist, loc.z + 30.0),
                PAWN, False, [dog], unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED,
                unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                return None
            t = hit.to_tuple()
            return t[9].get_actor_label() if t[9] is not None else "?"
        except Exception:                                              # noqa: BLE001
            return None

    def floor(x, y, top):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                world(), unreal.Vector(x, y, top), unreal.Vector(x, y, top - 4000.0), PAWN, False,
                [p for p in (pawn(),) if p is not None], unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            return None if hit is None else float(hit.to_tuple()[4].z)
        except Exception:                                              # noqa: BLE001
            return None

    routes = []
    for path in ROUTES:
        side = json.load(open(path, encoding="utf-8"))
        pts = side["walk"][::EVERY]
        if side["walk"] and pts[-1] != side["walk"][-1]:
            pts.append(side["walk"][-1])
        row = {"route": path.replace("\\", "/").split("/")[-1], "pass": side.get("pass"), "waypoints": len(pts)}
        routes.append(row)
        RESULT["routes"] = routes
        if len(pts) < 2:
            row["error"] = "no walk"
            continue
        # THE ONE PLACEMENT: over the first point, settled on the ground with streaming complete
        dog = pawn()
        if dog is None:
            row["error"] = "no pawn at start"
            continue
        x0, y0 = pts[0]
        dog.character_movement.disable_movement()
        dog.set_actor_location(unreal.Vector(x0, y0, 2500.0), False, True)
        unreal.SystemLibrary.execute_console_command(world(), "FlushLevelStreaming")
        t0 = 0.0
        while t0 < 20.0:
            yield 0.25
            t0 += 0.25
            try:
                if L.is_world_partition_streaming_complete(world()):
                    break
            except Exception:                                          # noqa: BLE001
                break
        z = floor(x0, y0, 2000.0)
        dog.set_actor_location(unreal.Vector(x0, y0, (z if z is not None else 0.0) + 120.0), False, True)
        dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
        yield 1.0
        # THE WALK
        length = sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
        budget = length / SPEED_GUESS + 120.0
        wp, elapsed, walked, best_d, since_gain = 1, 0.0, 0.0, None, 0.0
        last = None
        low_z = None
        frames = 0
        g_start = unreal.GameplayStatics.get_time_seconds(world())
        g_prev = g_start
        import time as _t
        w_start = _t.time()
        while wp < len(pts) and elapsed < budget:
            # the clock is GAME time: a slow editor walks slowly, it does not get stuck
            g_now = unreal.GameplayStatics.get_time_seconds(world()) if world() is not None else g_prev
            dt = max(0.0, g_now - g_prev)
            g_prev = g_now
            elapsed = g_now - g_start
            frames += 1
            dog = pawn()
            if dog is None:
                row["dog_destroyed"] = True
                row["at_waypoint"] = wp
                break
            loc = dog.get_actor_location()
            low_z = loc.z if low_z is None else min(low_z, loc.z)
            if last is not None:
                walked += math.hypot(loc.x - last[0], loc.y - last[1])
            last = (loc.x, loc.y)
            tx, ty = pts[wp]
            dx, dy = tx - loc.x, ty - loc.y
            d = math.hypot(dx, dy)
            if d <= ARRIVE:
                wp += 1
                best_d, since_gain = None, 0.0
                continue
            if best_d is None or d < best_d - 20.0:
                best_d, since_gain = d, 0.0
            else:
                since_gain += dt
                if since_gain >= STUCK:
                    heading = math.degrees(math.atan2(dy, dx))
                    row["stuck"] = {"at": [round(loc.x), round(loc.y), round(loc.z)], "waypoint": wp,
                                    "radius_m": round(math.hypot(loc.x, loc.y) / 100, 1),
                                    "blocked_by": ahead(dog, heading)}
                    try:
                        row["stuck"]["streaming_complete"] = bool(L.is_world_partition_streaming_complete(world()))
                    except Exception:                                  # noqa: BLE001
                        pass
                    break
            try:
                heading = math.degrees(math.atan2(dy, dx))
                ctrl = dog.get_controller()
                if ctrl is not None:
                    ctrl.set_control_rotation(unreal.Rotator(0.0, heading, 0.0))
                dog.add_movement_input(unreal.Vector(dx / d, dy / d, 0.0), 1.0, True)
            except Exception as err:                                   # noqa: BLE001
                row["error"] = "movement input failed: %s" % str(err)[:80]
                break
            # EVERY FRAME. Input is consumed once per movement tick; yielding 0.05 s dropped most frames' input and
            # walked the Dog at ~1.2 m/s (zzW107, VOID: HT356 timed out at 89% with no stuck point).
            yield None
        row["arrived"] = wp >= len(pts)
        wall = _t.time() - w_start
        row["wall_seconds"] = round(wall, 1)
        row["game_seconds"] = round(elapsed, 1)
        row["fps_seen"] = round(frames / wall, 1) if wall > 0 else None
        row["mean_speed_cm_s"] = round(walked / elapsed, 1) if elapsed > 0 else None
        row["waypoints_reached"] = min(wp, len(pts))
        row["fraction"] = round(min(wp, len(pts)) / float(len(pts)), 3)
        row["walked_m"] = round(walked / 100.0, 1)
        row["route_m"] = round(length / 100.0, 1)
        row["seconds"] = round(elapsed, 1)
        row["low_z"] = None if low_z is None else round(low_z, 1)
        if not row["arrived"] and "stuck" not in row and not row.get("dog_destroyed") and "error" not in row:
            row["timed_out"] = True
        emit(row["route"], "ARRIVED" if row["arrived"] else "NOT ARRIVED", row.get("fraction"))
        yield 0.0
    RESULT["status"] = "walked"
    RESULT["all_arrived"] = all(r.get("arrived") for r in routes)
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
