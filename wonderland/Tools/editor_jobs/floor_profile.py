# PIE job: the exact floor height along a line, measured where batch collision is REAL.
#
# WHY (2026-09-22). Editor-world line traces do not see WonderlandInstancedBatch collision -- spawn_audit reported
# the world slab under every point of the Icarus district while PIE had the Dog standing on paving 115 cm higher.
# So a floor profile has to be taken inside PIE. This starts play, traces straight down at a series of points
# along a line, and reports the surface height and the mesh that owns it at each one.
#
# It exists because the march/district seam walk stops at a step the Dog cannot climb, and "there is a step" is
# not a measurement. UE's default max step height is 45 cm; anything taller is a wall, and the profile says
# exactly where the rise is and how big it is.
# Globals: LINE ([x0,y0,x1,y1]), SAMPLES, Z_TOP, Z_BOTTOM, OUT.
import json
import os

LINE = globals().get("LINE", [0.0, 63000.0, 0.0, 64800.0])
SAMPLES = int(globals().get("SAMPLES", 60))
Z_TOP = float(globals().get("Z_TOP", 900.0))
Z_BOTTOM = float(globals().get("Z_BOTTOM", -800.0))
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/floor_profile.json")


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield 4.0
    world = ues.get_game_world()
    try:
        x0, y0, x1, y1 = LINE
        rows = []
        for i in range(SAMPLES + 1):
            t = i / float(SAMPLES)
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            hit = unreal.SystemLibrary.line_trace_single(
                world, unreal.Vector(x, y, Z_TOP), unreal.Vector(x, y, Z_BOTTOM),
                unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, True, [], unreal.DrawDebugTrace.NONE, True)
            z, mesh = None, None
            if hit:
                tup = hit.to_tuple()
                if tup[0]:
                    z = round(tup[4].z, 1)
                    comp = tup[10]
                    if comp is not None:
                        sm = getattr(comp, "static_mesh", None)
                        mesh = sm.get_name() if sm else comp.get_class().get_name()
            rows.append({"x": round(x, 1), "y": round(y, 1), "z": z, "mesh": mesh})
            if i % 10 == 0:
                yield None
        with open(OUT, "w", newline="\n") as f:
            json.dump(rows, f, indent=1)
        # the interesting part is not the heights but the RISES between them
        steps = []
        for a, b in zip(rows, rows[1:]):
            if a["z"] is None or b["z"] is None:
                steps.append({"from": a["y"], "to": b["y"], "rise": None,
                              "note": "NO FLOOR" if b["z"] is None else "floor returns"})
            elif abs(b["z"] - a["z"]) >= 20.0:
                steps.append({"from": a["y"], "to": b["y"], "rise": round(b["z"] - a["z"], 1),
                              "from_mesh": a["mesh"], "to_mesh": b["mesh"]})
        RESULT["samples"] = len(rows)
        RESULT["no_floor"] = [r["y"] for r in rows if r["z"] is None][:12]
        RESULT["steps_over_20cm"] = steps[:16]
        RESULT["z_range"] = [min((r["z"] for r in rows if r["z"] is not None), default=None),
                             max((r["z"] for r in rows if r["z"] is not None), default=None)]
        RESULT["status"] = "done"
    finally:
        les.editor_request_end_play()
