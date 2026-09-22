# Editor job, READ-ONLY and CONCURRENT: is it safe to arrive in this world, and is there room to stand?
#
# WHY (beta-readiness, 2026-09-17). A beta player's first second is a spawn. The founder's list asks for spawn
# safety, interaction and camera clearances and "no trapped areas" -- all of which start with: where does a player
# appear, is there ground under that point, is there headroom above it, and is anything solid overlapping them.
#
# For every PlayerStart (and any extra POINTS given), this traces:
#   down  from +400 cm  -- what ground is under the spawn, and how far it falls to reach it;
#   up    from the head -- headroom, so nobody spawns inside a floor above;
#   out   in eight directions at chest height -- the clear radius a body and its camera need.
# Sizes default to Wonderland's own player capsule (88 cm half height, 42 cm radius) plus a camera boom allowance.
# Globals: POINTS (extra [name, x, y, z] to test), CAPSULE_HALF, CAPSULE_RADIUS, BOOM, OUT.
import json
import math

CONCURRENT = True
POINTS = globals().get("POINTS", [])
CAPSULE_HALF = globals().get("CAPSULE_HALF", 88.0)
CAPSULE_RADIUS = globals().get("CAPSULE_RADIUS", 42.0)
BOOM = globals().get("BOOM", 350.0)
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/spawn_audit.json")


def _hit(world, a, b, complex_trace=True):
    hit = unreal.SystemLibrary.line_trace_single(world, a, b, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, complex_trace,
                                                 [], unreal.DrawDebugTrace.NONE, True)
    if not hit:
        return None
    t = hit.to_tuple()
    if not t[0]:
        return None
    comp = t[10]
    mesh = comp.static_mesh.get_name() if isinstance(comp, unreal.StaticMeshComponent) and comp.static_mesh else (
        comp.get_class().get_name() if comp else None)
    return {"z": round(t[4].z, 1), "x": round(t[4].x, 1), "y": round(t[4].y, 1), "mesh": mesh,
            "dist": round(t[3], 1)}


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    points = []
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.PlayerStart):
        loc = a.get_actor_location()
        points.append([a.get_actor_label(), loc.x, loc.y, loc.z])
    points += [list(p) for p in POINTS]
    rows = []
    for (name, x, y, z) in points:
        v = unreal.Vector
        ground = _hit(world, v(x, y, z + 400.0), v(x, y, z - 2000.0))
        floor_z = ground["z"] if ground else None
        stand = (floor_z if floor_z is not None else z) + CAPSULE_HALF
        head = _hit(world, v(x, y, stand), v(x, y, stand + BOOM))
        clear = {}
        for k in range(8):
            ang = math.radians(45.0 * k)
            dx, dy = math.cos(ang), math.sin(ang)
            h = _hit(world, v(x, y, stand), v(x + dx * 600.0, y + dy * 600.0, stand))
            clear["%d" % int(math.degrees(ang))] = h["dist"] if h else 600.0
        near = min(clear.values())
        rows.append({"name": name, "at": [round(x), round(y), round(z)],
                     "ground": ground, "drop_cm": None if floor_z is None else round(z - floor_z, 1),
                     "headroom_cm": round(head["dist"], 1) if head else BOOM,
                     "clear_min_cm": round(near, 1), "clear": clear,
                     "verdict": ("NO GROUND" if ground is None else
                                 "FALLS %d cm" % round(z - floor_z) if z - floor_z > 200.0 else
                                 "TIGHT (%d cm)" % round(near) if near < CAPSULE_RADIUS + 20.0 else
                                 "LOW (%d cm)" % round(head["dist"]) if head and head["dist"] < CAPSULE_HALF else
                                 "ok")})
        yield None
    with open(OUT, "w", newline="\n") as f:
        json.dump(rows, f, indent=1)
    RESULT["points"] = len(rows)
    RESULT["not_ok"] = [r["name"] for r in rows if r["verdict"] != "ok"]
    RESULT["rows"] = rows[:12]
    RESULT["status"] = "done"
