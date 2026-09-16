# Editor job, READ-ONLY and CONCURRENT: the city's buildings as ORIENTED BOXES a facade pass can put things against.
#
# A shopfront has to sit flush on a wall, not on the pavement and not in the air. The walls are generator castle
# halls, facade panels and towers, almost all of them batch instances with no editor collision, so a trace cannot
# find them. Their geometry can: every instance's transform and its mesh's local bounds give a box in world space,
# and a box's four vertical faces are where the walls are. This reports each box as centre, yaw, half-extents in its
# own frame, and bottom and top z -- nothing else is needed to find the face of a building that fronts a street.
# Globals: WORDS (mesh-name fragments), OUT (json path).
import json
import math

CONCURRENT = True
WORDS = tuple(globals().get("WORDS", ("castle_hall", "facade_panel", "castle_tower_square", "castle_arcade",
                                      "house", "cloister", "gatehouse")))
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/building_census.json")


def box(label, mesh, loc, yaw, scale):
    bb = mesh.get_bounding_box()
    th = math.radians(yaw)
    cx = (bb.max.x + bb.min.x) * 0.5 * scale.x
    cy = (bb.max.y + bb.min.y) * 0.5 * scale.y
    return {"label": label, "mesh": mesh.get_name(),
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
        if mesh is None or not any(w in mesh.get_name().lower() for w in WORDS):
            continue
        rows.append(box(a.get_actor_label(), mesh, a.get_actor_location(), a.get_actor_rotation().yaw, a.get_actor_scale3d()))
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        mesh = b.get_editor_property("mesh")
        if mesh is None or not any(w in mesh.get_name().lower() for w in WORDS):
            continue
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        if ism is None:
            continue
        for i in range(ism.get_instance_count()):
            t = ism.get_instance_transform(i, True)
            rows.append(box("%s#%d" % (b.get_name(), i), mesh, t.translation, t.rotation.rotator().yaw, t.scale3d))
        yield None
    with open(OUT, "w", newline="\n") as f:
        json.dump(rows, f)
    RESULT["count"] = len(rows)
    RESULT["status"] = "done"
