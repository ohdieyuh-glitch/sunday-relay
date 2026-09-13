# PIE job: every walkable-looking floor under a list of XY points (read from <channel>/probe_points.json:
# {"points": [[id, x, y], ...]}). Batches only have collision at runtime, so heights are probed in PIE.
import json
import os


def _unwrap(ret):
    if isinstance(ret, tuple):
        if len(ret) >= 2 and isinstance(ret[0], bool):
            return ret[1] if ret[0] else None
        return ret[0] if ret else None
    return ret


def job():
    with open(os.path.join(CHANNEL, "probe_points.json"), encoding="utf-8") as f:
        points = json.load(f)["points"]
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 3.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    channel = unreal.TraceTypeQuery.TRACE_TYPE_QUERY1
    out = {}
    for (pid, x, y) in points:
        floors = []
        top = 5000.0
        for _ in range(12):
            hit = _unwrap(unreal.SystemLibrary.line_trace_single(world, unreal.Vector(x, y, top), unreal.Vector(x, y, -3000.0),
                                                                channel, False, [pawn], unreal.DrawDebugTrace.NONE, True))
            if hit is None:
                break
            t = hit.to_tuple()
            vectors = [v for v in t if isinstance(v, unreal.Vector)]
            actor = next((v for v in t if isinstance(v, unreal.Actor)), None)
            comp = next((v for v in t if isinstance(v, unreal.PrimitiveComponent)), None)
            loc = vectors[0]
            normal = vectors[3] if len(vectors) > 3 else vectors[-1]
            label = actor.get_actor_label() if actor else ""
            if normal.z >= 0.6:
                floors.append([round(loc.z, 1), label, comp.get_name() if comp else ""])
            nxt = loc.z - 2.0
            top = nxt if nxt < top - 1.0 else top - 40.0
            if top < -2900.0:
                break
        out[pid] = {"x": x, "y": y, "floors": floors}
    RESULT["points"] = out
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"
