# Editor job, READ-ONLY and CONCURRENT: where do a wall's real face and the ground actually stand under a wall-base piece?
#
# WHY (WB01, 2026-09-17). Wall-base generators place against a building's census BOX face. Where a wall has a
# projecting cornice, pilaster or recessed ground storey, the box face is not the wall: the first WB01 preview showed
# a plinth course standing half a metre out from a recessed blue facade, reading as an empty trough. This job measures,
# per placed piece, the true wall face and the ground, so the generator can seat each piece on them or drop it.
#
# For each point [key, x, y, z, nx, ny] (a piece's back-centre on the box face, its street top, the outward normal):
#   - a COMPLEX horizontal trace at z + ZOFF from START in front of the box face to DEPTH behind it; `back` is how far
#     behind the box face the first hit lies (negative = in front of it), with the hit's mesh name;
#   - a complex downward trace at START in front of the box face from z + 100 to z - 150; `ground` is the hit height.
# Editor-world traces see collision; collision-less authored batches (kerbs, trims, the plinth itself) are invisible.
# Globals: POINTS_PATH (json list of points), OUT, START, DEPTH, ZOFF.
import json

CONCURRENT = True
POINTS_PATH = globals().get("POINTS_PATH")
OUT = globals().get("OUT")
START = globals().get("START", 20.0)
DEPTH = globals().get("DEPTH", 200.0)
ZOFF = globals().get("ZOFF", 25.0)


def _hit(world, a, b):
    hit = unreal.SystemLibrary.line_trace_single(world, a, b, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, True, [],
                                                unreal.DrawDebugTrace.NONE, True)
    if not hit:
        return None
    t = hit.to_tuple()
    if not t[0]:
        return None
    comp = t[10]
    mesh = comp.static_mesh.get_name() if isinstance(comp, unreal.StaticMeshComponent) and comp.static_mesh else (
        comp.get_class().get_name() if comp else None)
    return t[4], mesh


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    world = ues.get_editor_world()
    with open(POINTS_PATH, encoding="utf-8") as f:
        points = json.load(f)
    out = {}
    for i, (key, x, y, z, nx, ny) in enumerate(points):
        rec = {}
        sx, sy = x + nx * START, y + ny * START
        h = _hit(world, unreal.Vector(sx, sy, z + ZOFF), unreal.Vector(x - nx * DEPTH, y - ny * DEPTH, z + ZOFF))
        if h:
            loc, mesh = h
            rec["back"] = round((x - loc.x) * nx + (y - loc.y) * ny, 1)
            rec["mesh"] = mesh
        g = _hit(world, unreal.Vector(sx, sy, z + 100.0), unreal.Vector(sx, sy, z - 150.0))
        if g:
            rec["ground"] = round(g[0].z, 1)
            rec["ground_mesh"] = g[1]
        out[key] = rec
        if i % 200 == 0:
            yield None
    with open(OUT, "w", newline="\n") as f:
        json.dump(out, f)
    RESULT["points"] = len(points)
    RESULT["wall_hits"] = sum(1 for r in out.values() if "back" in r)
    RESULT["ground_hits"] = sum(1 for r in out.values() if "ground" in r)
    RESULT["status"] = "done"
