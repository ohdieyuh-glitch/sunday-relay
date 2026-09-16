# Read-only job: is there room to stand a structure here? Reads <channel>/site_points.json:
#   {"sites": [[id, x, y, half_x, half_y, half_z, z_centre], ...]}
# and reports, per site, the ground under its centre and every actor whose bounds overlap that box.
#
# Authored batches build collision only at runtime, so an editor-world test sees generator content -- which is
# exactly what a new structure has to fit between. Authored actors of this session's own passes are reported by
# label so the caller can ignore its own paving.
import json
import os

CONCURRENT = True


def job():
    with open(os.path.join(CHANNEL, "site_points.json"), encoding="utf-8") as f:
        sites = json.load(f)["sites"]
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    channel = unreal.TraceTypeQuery.TRACE_TYPE_QUERY1
    out = {}
    for i, (sid, x, y, hx, hy, hz, zc) in enumerate(sites):
        ret = unreal.SystemLibrary.line_trace_multi(world, unreal.Vector(x, y, 4000.0), unreal.Vector(x, y, -3000.0),
                                                    channel, True, [], unreal.DrawDebugTrace.NONE, True)
        hits = ret[1] if isinstance(ret, tuple) else ret
        ground = None
        for h in (hits or []):
            t = h.to_tuple()
            vs = [v for v in t if isinstance(v, unreal.Vector)]
            if len(vs) > 3 and vs[3].z >= 0.6:
                ground = round(vs[0].z, 1)
                break
        box = unreal.SystemLibrary.box_overlap_actors(world, unreal.Vector(x, y, zc), unreal.Vector(hx, hy, hz),
                                                      [], unreal.Actor, [])
        labels = sorted({a.get_actor_label() for a in ((box[1] if isinstance(box, tuple) else box) or [])})
        out[sid] = {"ground": ground, "blockers": labels[:12], "n": len(labels)}
        if i % 40 == 0:
            yield 0.0
    RESULT["sites"] = out
    RESULT["status"] = "done"
