# Read-only job: every floor under a list of XY points, traced in the EDITOR world (no PIE).
# Reads <channel>/probe_points.json: {"points": [[id, x, y], ...]}.
#
# Why an editor trace and not probe_ground.py: authored batches (WonderlandInstancedBatch) only build collision at
# runtime, so an editor trace passes straight through authored paving and reports the GENERATOR ground underneath --
# which is exactly the question "does this authored walk float above its district's ground?". PIE is not needed, so
# this costs no extra memory and cannot be caught by the founder playing.
import json
import os

CONCURRENT = True


def job():
    with open(os.path.join(CHANNEL, "probe_points.json"), encoding="utf-8") as f:
        points = json.load(f)["points"]
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    channel = unreal.TraceTypeQuery.TRACE_TYPE_QUERY1
    out = {}
    for i, (pid, x, y) in enumerate(points):
        ret = unreal.SystemLibrary.line_trace_multi(world, unreal.Vector(x, y, 4000.0), unreal.Vector(x, y, -3000.0),
                                                   channel, True, [], unreal.DrawDebugTrace.NONE, True)
        hits = ret[1] if isinstance(ret, tuple) else ret
        floors = []
        for h in (hits or []):
            t = h.to_tuple()
            vectors = [v for v in t if isinstance(v, unreal.Vector)]
            actor = next((v for v in t if isinstance(v, unreal.Actor)), None)
            if len(vectors) < 4 or vectors[3].z < 0.6:
                continue
            floors.append([round(vectors[0].z, 1), actor.get_actor_label() if actor else ""])
        out[pid] = floors
        if i % 60 == 0:
            yield 0.0
    RESULT["points"] = out
    RESULT["status"] = "done"
