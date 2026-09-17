# Editor job, READ-ONLY and CONCURRENT: every generator instanced batch -- what it draws, in what material, and where.
#
# WHY (PS01, 2026-09-17). A WonderlandInstancedBatch draws all its instances with ONE material, so a batch is the unit
# a restyling pass can work in. To swap a batch's material reversibly, apply_batch_material.py wants the material it
# holds right now; nothing reported that. This does: object name (what the swap addresses), label, mesh, material and
# material path, instance count, and the centre and extent of the instances, so a design can choose batches by
# district and by size instead of by guesswork.
# Globals: MESHES (mesh-name fragments; empty for all), OUT.
import json

CONCURRENT = True
MESHES = tuple(globals().get("MESHES", ()))
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/batch_census.json")


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    rows = []
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        mesh = b.get_editor_property("mesh")
        if mesh is None:
            continue
        name = mesh.get_name()
        if MESHES and not any(w in name for w in MESHES):
            continue
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        n = ism.get_instance_count() if ism else 0
        xs, ys, zs = [], [], []
        for i in range(0, n, max(1, n // 64)):
            t = ism.get_instance_transform(i, True)
            xs.append(t.translation.x)
            ys.append(t.translation.y)
            zs.append(t.translation.z)
        mat = b.get_editor_property("material")
        rows.append({"name": b.get_name(), "label": b.get_actor_label(), "mesh": name,
                     "material": mat.get_name() if mat else None,
                     "material_path": str(b.get_editor_property("material_path")),
                     "instances": n,
                     "x": round(sum(xs) / len(xs), 1) if xs else 0.0,
                     "y": round(sum(ys) / len(ys), 1) if ys else 0.0,
                     "z": round(sum(zs) / len(zs), 1) if zs else 0.0,
                     "spread": round(max(max(xs) - min(xs), max(ys) - min(ys)), 1) if xs else 0.0})
        yield None
    with open(OUT, "w", newline="\n") as f:
        json.dump(rows, f)
    RESULT["batches"] = len(rows)
    RESULT["instances"] = sum(r["instances"] for r in rows)
    RESULT["status"] = "done"
