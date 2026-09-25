# DOES THE NEW NAVMESH ACTUALLY ROUTE?
#
# A RecastNavMesh actor existing is not the same as a path being findable. Before the bounds volume was
# added, NavigationSystemV1 returned nothing over a 400 m span -- that was the finding. This asks the same
# question again, and on the routes that matter: each nation's gate to its band, the journeys
# zc_nation_paths had to build its own grid search to answer.
#
# IF THIS FAILS the volume is not worth keeping and the map is left unsaved, which reverts it for free.
import math

L = unreal.WonderlandUiTestLibrary

NATIONS = (("ICARUS", 90.0), ("NOCTIS", 210.0), ("TARTARUS", 330.0))
FROM_M, TO_M = 600.0, 1000.0

HIT_BLOCKING, HIT_LOCATION = 0, 4


def ground_z(world, x, y):
    for top in (400.0, 2500.0):
        hit = unreal.SystemLibrary.line_trace_single(
            world, unreal.Vector(x, y, top), unreal.Vector(x, y, -6000.0),
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [], unreal.DrawDebugTrace.NONE, True)
        if hit is None:
            continue
        try:
            t = hit.to_tuple()
        except Exception:
            continue
        if bool(t[HIT_BLOCKING]):
            return float(t[HIT_LOCATION].z)
    return None


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 8.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 2.0

    found = {}
    for nation, degrees in NATIONS:
        b = math.radians(degrees)
        ax, ay = math.cos(b) * FROM_M * 100.0, math.sin(b) * FROM_M * 100.0
        bx, by = math.cos(b) * TO_M * 100.0, math.sin(b) * TO_M * 100.0
        az, bz = ground_z(world, ax, ay), ground_z(world, bx, by)
        if az is None or bz is None:
            found[nation] = {"error": "no ground at one end"}
            continue
        start = unreal.Vector(ax, ay, az + 100.0)
        goal = unreal.Vector(bx, by, bz + 100.0)
        straight = math.hypot(bx - ax, by - ay)
        points = []
        try:
            nav = unreal.NavigationSystemV1.find_path_to_location_synchronously(world, start, goal)
            if nav is not None:
                points = list(nav.get_editor_property("path_points") or [])
        except Exception as err:                               # noqa: BLE001
            found[nation] = {"error": str(err)[:90]}
            continue
        walked = 0.0
        for u, v in zip(points, points[1:]):
            walked += math.hypot(float(v.x) - float(u.x), float(v.y) - float(u.y))
        found[nation] = {"points": len(points), "straight_uu": round(straight, 1),
                         "walked_uu": round(walked, 1),
                         "detour": round(walked / straight, 2) if straight > 0 and walked > 0 else None}
        yield 0.5
    RESULT["routes"] = found

    routed = [n for n, v in found.items() if v.get("points", 0) >= 2]
    record("V01", "the navmesh returns a real route for every nation",
           len(routed) == len(NATIONS), by_nation=found, routed=routed,
           note="before the bounds volume, this returned nothing at all over the same spans")

    sane = all(v.get("detour") is not None and v["detour"] < 2.5
               for v in found.values() if v.get("points", 0) >= 2)
    record("V02", "and the routes are sensible rather than absurd detours",
           sane and len(routed) == len(NATIONS), by_nation=found,
           note="walked distance over straight-line distance; a path that wanders the whole map would show "
                "here even though it technically 'routes'")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
