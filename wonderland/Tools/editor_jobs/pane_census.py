# Editor job, READ-ONLY and CONCURRENT: every window pane in the world, as the facade passes need it.
#
# The city's windows are SM_glass_screen_panes StaticMeshActors (14.7k; WIN01). A window is the one place on a
# generator facade that says "a storey is here": a balcony belongs under one, an oriel replaces one. This records
# each pane's location, yaw, scale, material, and its world-space box, plus the mesh's local bounds once.
# Globals: WORDS (mesh-name fragments), OUT (json path).
import json

CONCURRENT = True
WORDS = tuple(globals().get("WORDS", ("glass_screen_panes",)))
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/pane_census.json")


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    rows, meshes = [], {}
    n = 0
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
        n += 1
        if n % 2000 == 0:
            yield None
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None or not any(w in mesh.get_name().lower() for w in WORDS):
            continue
        if mesh.get_name() not in meshes:
            bb = mesh.get_bounding_box()
            meshes[mesh.get_name()] = [round(bb.min.x, 1), round(bb.min.y, 1), round(bb.min.z, 1),
                                       round(bb.max.x, 1), round(bb.max.y, 1), round(bb.max.z, 1)]
        l, r, s = a.get_actor_location(), a.get_actor_rotation(), a.get_actor_scale3d()
        o, e = a.get_actor_bounds(False)
        mats = [m.get_name() for m in smc.get_materials() if m]
        rows.append({"label": a.get_actor_label(), "mesh": mesh.get_name(), "mat": mats[0] if mats else None,
                     "loc": [round(l.x, 1), round(l.y, 1), round(l.z, 1)],
                     "rot": [round(r.pitch, 2), round(r.yaw, 2), round(r.roll, 2)],
                     "scale": [round(s.x, 3), round(s.y, 3), round(s.z, 3)],
                     "bmin": [round(o.x - e.x, 1), round(o.y - e.y, 1), round(o.z - e.z, 1)],
                     "bmax": [round(o.x + e.x, 1), round(o.y + e.y, 1), round(o.z + e.z, 1)]})
    with open(OUT, "w", newline="\n") as f:
        json.dump({"meshes": meshes, "panes": rows}, f)
    RESULT["count"] = len(rows)
    RESULT["meshes"] = meshes
    RESULT["status"] = "done"
