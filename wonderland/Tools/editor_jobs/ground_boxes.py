# Editor job, READ-ONLY and CONCURRENT: every ground surface wearing one of the named MATERIALS, as an oriented box.
#
# WHY (GT01, 2026-09-17). lawn_census.py reports the garden-lawn batches, but the ground census over the gameplay
# cameras says the surface a player actually sees most is `Cube|MI_V2_Moss` -- ground actors that are not in that
# census at all. A fringe built from the lawn batches alone therefore left the Hamlet, the Tea Terrace, the Water
# Garden and the south lawns bare. This finds ground by its MATERIAL, whatever mesh or actor carries it.
#
# Each row is the same oriented box building_census.py reports (centre, yaw, half-extents in its own frame, z range)
# plus the material and the mesh, so a placement pass can ask "what is the ground here, and how high is its top?".
# Globals: MATERIALS (material instance names), MAX_SLOTS (slots to read per component), OUT.
import json
import math

CONCURRENT = True
MATERIALS = tuple(globals().get("MATERIALS", ("MI_V2_Lawn", "MI_V2_Meadow", "MI_V2_Moss")))
MAX_SLOTS = globals().get("MAX_SLOTS", 4)
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/ground_boxes.json")


def _materials(comp):
    out = []
    for m in (comp.get_materials() or [])[:MAX_SLOTS]:
        if m is not None:
            out.append(m.get_name())
    return out


def _box(label, mesh, mat, loc, yaw, scale):
    bb = mesh.get_bounding_box()
    th = math.radians(yaw)
    cx = (bb.max.x + bb.min.x) * 0.5 * scale.x
    cy = (bb.max.y + bb.min.y) * 0.5 * scale.y
    return {"label": label, "mesh": mesh.get_name(), "mat": mat,
            "x": round(loc.x + cx * math.cos(th) - cy * math.sin(th), 1),
            "y": round(loc.y + cx * math.sin(th) + cy * math.cos(th), 1),
            "yaw": round(yaw, 2),
            "hx": round((bb.max.x - bb.min.x) * 0.5 * abs(scale.x), 1),
            "hy": round((bb.max.y - bb.min.y) * 0.5 * abs(scale.y), 1),
            "zmin": round(loc.z + bb.min.z * scale.z, 1), "zmax": round(loc.z + bb.max.z * scale.z, 1)}


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    rows = []
    n = 0
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
        n += 1
        if n % 2000 == 0:
            yield None
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None:
            continue
        for mat in _materials(smc):
            if mat in MATERIALS:
                rows.append(_box(a.get_actor_label(), mesh, mat, a.get_actor_location(),
                                 a.get_actor_rotation().yaw, a.get_actor_scale3d()))
                break
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        mesh = b.get_editor_property("mesh")
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        if mesh is None or ism is None:
            continue
        mats = [m for m in _materials(ism) if m in MATERIALS]
        if not mats:
            continue
        for i in range(ism.get_instance_count()):
            t = ism.get_instance_transform(i, True)
            rows.append(_box("%s#%d" % (b.get_name(), i), mesh, mats[0], t.translation,
                             t.rotation.rotator().yaw, t.scale3d))
        yield None
    with open(OUT, "w", newline="\n") as f:
        json.dump(rows, f)
    RESULT["count"] = len(rows)
    RESULT["by_material"] = {m: sum(1 for r in rows if r["mat"] == m) for m in MATERIALS}
    RESULT["by_mesh"] = {k: sum(1 for r in rows if r["mesh"] == k) for k in sorted({r["mesh"] for r in rows})}
    RESULT["status"] = "done"
