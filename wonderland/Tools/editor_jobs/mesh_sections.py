# Editor job, READ-ONLY and CONCURRENT: horizontal cross-sections of named static meshes, in their own local space.
#
# WHY (WB01, 2026-09-17). The generator walls are batch instances with no editor collision, so a trace cannot find a
# wall's real face (wall_contact_probe hit 31 of 5,944 points). building_census gives only each instance's BOX, and a
# box face is not the wall wherever a cornice, balcony or upper storey overhangs a recessed ground floor -- the first
# WB01 preview stood a plinth half a metre out from such a wall. The mesh itself knows: slice it with horizontal planes
# near its foot and the slice is the wall's true outline at that height. With an instance's box (building_census) the
# slice maps to world space, so a generator can seat a wall-base piece on the real face.
#
# For each mesh: its local bounding box and, for every height H in HEIGHTS (local units above the bounding box's
# min z), the list of segments [x1, y1, x2, y2] where the plane z = min.z + H cuts a LOD0 triangle.
# Globals: MESHES (mesh names), HEIGHTS, OUT.
import json

CONCURRENT = True
MESHES = globals().get("MESHES", ["SM_castle_hall", "SM_facade_panel", "SM_castle_tower_square"])
HEIGHTS = globals().get("HEIGHTS", [5.0, 15.0, 25.0, 35.0, 45.0, 60.0, 80.0, 100.0])
OUT = globals().get("OUT")


def _find_meshes(world, names):
    found = {}
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        m = b.get_editor_property("mesh")
        if m is not None and m.get_name() in names:
            found.setdefault(m.get_name(), m)
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
        smc = a.static_mesh_component
        m = smc.static_mesh if smc else None
        if m is not None and m.get_name() in names:
            found.setdefault(m.get_name(), m)
    return found


def _cut(p, q, h):
    t = (h - p.z) / (q.z - p.z)
    return (p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t)


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    meshes = _find_meshes(world, set(MESHES))
    out = {}
    for name in MESHES:
        mesh = meshes.get(name)
        if mesh is None:
            out[name] = {"error": "not found in the world"}
            continue
        bb = mesh.get_bounding_box()
        rec = {"bb": [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z], "levels": {}, "tris": 0}
        planes = [(h, bb.min.z + h) for h in HEIGHTS]
        segs = {h: [] for h in HEIGHTS}
        for s in range(mesh.get_num_sections(0)):
            ret = unreal.ProceduralMeshLibrary.get_section_from_static_mesh(mesh, 0, s)
            verts, tris = ret[0], ret[1]
            rec["tris"] += len(tris) // 3
            for i in range(0, len(tris) - 2, 3):
                a, b, c = verts[tris[i]], verts[tris[i + 1]], verts[tris[i + 2]]
                lo, hi = min(a.z, b.z, c.z), max(a.z, b.z, c.z)
                for (h, z) in planes:
                    if not (lo < z < hi):
                        continue
                    pts = []
                    for (p, q) in ((a, b), (b, c), (c, a)):
                        if (p.z < z) != (q.z < z):
                            pts.append(_cut(p, q, z))
                    if len(pts) == 2:
                        segs[h].append([round(pts[0][0], 1), round(pts[0][1], 1), round(pts[1][0], 1), round(pts[1][1], 1)])
                if i % 6000 == 0:
                    yield None
        rec["levels"] = {str(h): v for h, v in segs.items()}
        out[name] = rec
        RESULT[name] = {"tris": rec["tris"], "segments": {str(h): len(v) for h, v in segs.items()}}
    with open(OUT, "w", newline="\n") as f:
        json.dump(out, f)
    RESULT["status"] = "done"
