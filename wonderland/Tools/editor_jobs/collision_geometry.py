# Editor job, READ-ONLY and CONCURRENT: what SHAPE is a mesh's collision, and can a player walk through its hole?
#
# WHY (IC02 walk, 2026-09-22). The Icarus district walk failed six legs of eight. The Dog reached the arrival court
# and the proving court -- both open paving -- but stuck at the ceremonial gate's passage, under the ceremonial
# arch, on the dome stairs and in the tower court. Every one of those is a place where the ARCHITECTURE HAS A HOLE
# IN IT that a player is supposed to walk through.
#
# A gatehouse with an 8 m passage only has an 8 m passage if its collision knows about it. If the mesh carries one
# simple box, the passage is solid and the building is a wall with a picture of a door on it. That is invisible in
# a screenshot and fatal to traversal, so this reports, per mesh: how many simple primitives it has and of what
# kind, whether complex collision is used as simple, and the collision complexity flag.
#
# Reports the meshes actually placed in the world, so the answer is about this map rather than about the kit.
# Globals: NAMES (substrings to report; empty = every mesh in use), OUT.
import json

CONCURRENT = True
NAMES = tuple(globals().get("NAMES", ()))
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/collision_geometry.json")


def describe(mesh):
    row = {"tris": None, "boxes": 0, "spheres": 0, "capsules": 0, "convex": 0, "complexity": "?",
           "simple_total": 0}
    try:
        row["tris"] = mesh.get_num_triangles(0)
    except Exception:
        pass
    try:
        bs = mesh.get_editor_property("body_setup")
    except Exception:
        bs = None
    if bs is None:
        row["complexity"] = "NO BODY SETUP"
        return row
    try:
        row["complexity"] = str(bs.get_editor_property("collision_trace_flag")).split(".")[-1]
    except Exception:
        pass
    try:
        agg = bs.get_editor_property("agg_geom")
        for key, field in (("boxes", "box_elems"), ("spheres", "sphere_elems"),
                           ("capsules", "sphyl_elems"), ("convex", "convex_elems")):
            try:
                row[key] = len(agg.get_editor_property(field))
            except Exception:
                row[key] = 0
    except Exception:
        pass
    row["simple_total"] = row["boxes"] + row["spheres"] + row["capsules"] + row["convex"]
    return row


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    used = {}
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        mesh = b.get_editor_property("mesh")
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        if mesh is None or ism is None:
            continue
        name = mesh.get_name()
        if NAMES and not any(n.lower() in name.lower() for n in NAMES):
            continue
        rec = used.setdefault(name, {"mesh": mesh, "instances": 0, "colliding_batches": 0, "batches": 0})
        rec["instances"] += ism.get_instance_count()
        rec["batches"] += 1
        if bool(b.get_editor_property("collides")):
            rec["colliding_batches"] += 1
        yield None

    rows = []
    for name, rec in used.items():
        row = describe(rec["mesh"])
        row.update({"name": name, "instances": rec["instances"], "batches": rec["batches"],
                    "colliding_batches": rec["colliding_batches"]})
        rows.append(row)
        yield None
    rows.sort(key=lambda r: -r["instances"])
    with open(OUT, "w", newline="\n") as f:
        json.dump(rows, f, indent=1)

    # The dangerous shape: a mesh a player must pass THROUGH that carries one simple box.
    suspects = [r for r in rows if r["colliding_batches"] and r["simple_total"] <= 1
                and r["complexity"] not in ("CTF_UseComplexAsSimple",)]
    RESULT["meshes"] = len(rows)
    RESULT["one_box_and_colliding"] = [{k: r[k] for k in ("name", "simple_total", "complexity", "instances")}
                                       for r in suspects[:25]]
    RESULT["complexity_counts"] = {}
    for r in rows:
        RESULT["complexity_counts"][r["complexity"]] = RESULT["complexity_counts"].get(r["complexity"], 0) + 1
    RESULT["status"] = "done"
