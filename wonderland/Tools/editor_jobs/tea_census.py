# Editor job, READ-ONLY: every generator tea thing (cups, saucers, pots) as a plain StaticMeshActor, with what a
# replacement needs -- object name (the trim key), label, the nine-float transform, world bounds and materials.
# Waits for PIE to end: during play the editor world's actor queries come back empty.
# Globals: MESHES, OUT.
import json

MESHES = tuple(globals().get("MESHES", ("SM_tea_cup", "SM_tea_cup_small", "SM_tea_saucer", "SM_tea_pot")))
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/tea_census.json")


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    world = ues.get_editor_world()
    rows = []
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None or mesh.get_name() not in MESHES:
            continue
        if "WL_AUTHORED" in [str(t) for t in a.tags]:
            continue
        l, r, s = a.get_actor_location(), a.get_actor_rotation(), a.get_actor_scale3d()
        o, e = a.get_actor_bounds(False)
        rows.append({"name": a.get_name(), "label": a.get_actor_label(), "mesh": mesh.get_name(),
                     "transform": [round(l.x, 1), round(l.y, 1), round(l.z, 1), round(r.pitch, 2), round(r.yaw, 2),
                                   round(r.roll, 2), round(s.x, 4), round(s.y, 4), round(s.z, 4)],
                     "bmin": [round(o.x - e.x, 1), round(o.y - e.y, 1), round(o.z - e.z, 1)],
                     "bmax": [round(o.x + e.x, 1), round(o.y + e.y, 1), round(o.z + e.z, 1)],
                     "materials": [m.get_name() for m in smc.get_materials() if m]})
    with open(OUT, "w", newline="\n") as f:
        json.dump(rows, f, indent=1)
    RESULT["count"] = len(rows)
    RESULT["by_mesh"] = {m: sum(1 for r in rows if r["mesh"] == m) for m in MESHES}
    RESULT["status"] = "done"
