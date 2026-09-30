# TRAVEL ARRIVAL PROBE (founder regression G3, 2026-09-29): validate candidate arrival points for the teleport registry
# with the travel system's OWN landing rule, and read back every placed anchor while the Dog stands in the core.
#
# For each candidate the Dog is held 25 m over it (movement off) until World Partition streaming there is complete --
# the Dog is the streaming source, so a probe taken from the core would test unloaded ground. Then:
#   probe_arrival(point)     the same capsule sweep and rejections a real travel uses (FindSafeSpot);
#   the floor under the stand, and the highest surface over it, named by actor -- so a stand on a roof, a canopy or a
#   hedge top shows up as exactly that, not as a pass.
# Globals: CANDIDATES = [{"id", "x", "y", "z", "yaw"}, ...]. PIE-owning: CONCURRENT is False. Saves nothing.
CONCURRENT = False
import math

L = unreal.WonderlandUiTestLibrary
GS = unreal.GameplayStatics
CANDIDATES = globals().get("CANDIDATES", [])
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def _unwrap(ret):
    if isinstance(ret, tuple):
        if len(ret) >= 2 and isinstance(ret[0], bool):
            return ret[1] if ret[0] else None
        return ret[0] if ret else None
    return ret


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    RESULT["status"] = "running"
    L.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 90.0:
        yield 1.0
        t += 1.0
    world = ues.get_game_world()
    pawn = lambda: GS.get_player_pawn(ues.get_game_world(), 0)
    t = 0.0
    while pawn() is None and t < 30.0:
        yield 0.5
        t += 0.5
    if pawn() is None:
        RESULT["status"] = "BLOCKED: no pawn"
        return
    yield 3.0
    travel = next(c for c in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if c.get_world() == world)
    anchors = []
    for a in GS.get_all_actors_of_class(world, unreal.WonderlandTravelAnchor):
        loc = a.get_actor_location()
        anchors.append({"id": str(a.get_editor_property("destination_id")), "at": [round(loc.x, 1), round(loc.y, 1), round(loc.z, 1)],
                        "yaw": round(a.get_actor_rotation().yaw, 2)})
    RESULT["anchors"] = anchors
    RESULT["offered_before"] = [str(d.get_editor_property("id")) for d in travel.get_offered_destinations()]

    def trace(x, y, top, bottom):
        hit = unreal.SystemLibrary.line_trace_single(world, unreal.Vector(x, y, top), unreal.Vector(x, y, bottom), PAWN, False,
                                                     [p for p in (pawn(),) if p], unreal.DrawDebugTrace.NONE, True,
                                                     unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        if hit is None:
            return None, None
        t_ = hit.to_tuple()
        return round(float(t_[4].z), 1), (t_[9].get_actor_label() if t_[9] is not None else "?")

    rows = []
    RESULT["candidates"] = rows
    for c in CANDIDATES:
        dog = pawn()
        dog.character_movement.disable_movement()
        dog.set_actor_location(unreal.Vector(c["x"], c["y"], 2500.0), False, True)
        unreal.SystemLibrary.execute_console_command(world, "FlushLevelStreaming")
        t, done = 0.0, False
        while t < 40.0:
            yield 0.5
            t += 0.5
            if L.is_world_partition_streaming_complete(world):
                done = True
                break
        yield 1.0
        stand = _unwrap(travel.probe_arrival(unreal.Vector(c["x"], c["y"], c["z"])))
        row = {"id": c["id"], "candidate": [c["x"], c["y"], c["z"]], "streaming_complete": done}
        if stand is None:
            row["stand"] = None
        else:
            row["stand"] = [round(stand.x, 1), round(stand.y, 1), round(stand.z, 1)]
            fz, flabel = trace(stand.x, stand.y, stand.z, stand.z - 400.0)
            oz, olabel = trace(stand.x, stand.y, stand.z + 3000.0, stand.z + 20.0)
            row["floor"] = [fz, flabel]
            row["overhead"] = [oz, olabel]
            row["moved_cm"] = round(math.hypot(stand.x - c["x"], stand.y - c["y"]), 1)
        rows.append(row)
        emit("PROBE", c["id"], row.get("stand"), row.get("floor"), row.get("overhead"))
        yield 0.0
    RESULT["status"] = "measured"
