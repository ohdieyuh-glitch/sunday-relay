# Editor job, READ-ONLY and CONCURRENT: what the GROUND a player sees is made of.
#
# For each camera, a fan of downward traces over the ground in front of it (to FAN_DEPTH, FAN_DEG either side, a sample
# every STEP) records the mesh, material and height it hits. Counts are ground AREA in view by (mesh, material), which
# is what a ground-material pass needs: which few materials ARE the streets, plazas, paths and lawns, and on which
# meshes (a 9 m terrace slab and a small paver need different fixes). Editor-world traces see generator collision only;
# collision-less batch instances (kerbs, trims) are not ground a player stands on anyway.
# Globals: CAMS [(label, x, y, yaw)], FAN_DEPTH, FAN_DEG, STEP, OUT.
import json
import math

CONCURRENT = True
CAMS = globals().get("CAMS", [])
FAN_DEPTH = globals().get("FAN_DEPTH", 4000.0)
FAN_DEG = globals().get("FAN_DEG", 40.0)
STEP = globals().get("STEP", 200.0)
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/ground_census.json")


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    world = ues.get_editor_world()
    out, totals = {}, {}
    for (label, cx, cy, yaw) in CAMS:
        counts = {}
        d = STEP
        while d <= FAN_DEPTH:
            half = math.radians(FAN_DEG)
            n = max(1, int(2 * d * math.tan(half) / STEP))
            for k in range(-n, n + 1):
                a = math.radians(yaw) + half * k / n
                x, y = cx + math.cos(a) * d, cy + math.sin(a) * d
                hit = unreal.SystemLibrary.line_trace_single(world, unreal.Vector(x, y, 3000.0), unreal.Vector(x, y, -800.0),
                                                            unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [],
                                                            unreal.DrawDebugTrace.NONE, True)
                key = "none"
                if hit:
                    t = hit.to_tuple()
                    comp = t[10]
                    if t[4].z > 900.0:
                        key = "above 9 m (roof/canopy)"
                    elif isinstance(comp, unreal.StaticMeshComponent) and comp.static_mesh:
                        mats = comp.get_materials()
                        key = "%s|%s" % (comp.static_mesh.get_name(), mats[0].get_name() if mats and mats[0] else None)
                    else:
                        key = comp.get_class().get_name() if comp else "none"
                counts[key] = counts.get(key, 0) + 1
                totals[key] = totals.get(key, 0) + 1
            d += STEP
            yield None
        out[label] = sorted(counts.items(), key=lambda kv: -kv[1])[:10]
    RESULT["per_camera"] = out
    RESULT["totals"] = sorted(totals.items(), key=lambda kv: -kv[1])[:25]
    with open(OUT, "w", newline="\n") as f:
        json.dump(RESULT, f, indent=1)
    RESULT["status"] = "done"
