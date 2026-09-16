# Read-only job: for each point in <channel>/probe_points.json, report EVERY editor-world hit (no normal filter) and
# every actor whose bounds overlap a standing capsule there. Answers two questions the floor probe cannot:
#   - "no floor found" -- is there really no ground, or did the filter drop it?
#   - "does this walk run through a building?" -- a floor slab is flat, so a floor-only census walks straight into one.
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
        rows = []
        for h in (hits or []):
            t = h.to_tuple()
            vectors = [v for v in t if isinstance(v, unreal.Vector)]
            actor = next((v for v in t if isinstance(v, unreal.Actor)), None)
            rows.append([round(vectors[0].z, 1), round(vectors[3].z, 2) if len(vectors) > 3 else None,
                         actor.get_actor_label() if actor else ""])
        # anything standing here: a 120 uu radius capsule from the lawn to 3 m up
        blockers = []
        box = unreal.SystemLibrary.box_overlap_actors(world, unreal.Vector(x, y, 130.0), unreal.Vector(120.0, 120.0, 150.0),
                                                      [], unreal.Actor, [])
        for a in (box[1] if isinstance(box, tuple) else box) or []:
            blockers.append(a.get_actor_label())
        out[pid] = {"hits": rows, "blockers": sorted(set(blockers))[:8]}
        if i % 40 == 0:
            yield 0.0
    RESULT["points"] = out
    RESULT["status"] = "done"
