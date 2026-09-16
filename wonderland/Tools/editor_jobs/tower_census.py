# Editor job, READ-ONLY and CONCURRENT: every generator castle-tower piece, with what a recolour must preserve.
#
# SC03 recolours generator towers by sinking each instance (a recorded trim) and laying an authored copy at the EXACT
# same transform in a tinted batch. That is only safe if the copy draws and behaves identically apart from its
# material, so this records, per instance: the batch object name and index (the trim key), the full 9-float transform,
# the mesh path, the material, and the batch's collides / cast_shadow / affect_distance_field_lighting flags. A tower
# that blocked the pawn must still block it.
# Globals: WORDS (mesh-name fragments), OUT (json path).
import json

CONCURRENT = True
WORDS = tuple(globals().get("WORDS", ("castle_tower", "tower_capped", "tower_district", "spire_signature", "roof_cone",
                                      "roof_ogee", "roof_dome", "balcony_ring")))
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/tower_census.json")


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    rows = []
    skipped = {"authored": 0, "no_component": 0, "empty": 0, "error": 0}
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        mesh = b.get_editor_property("mesh")
        if mesh is None or not any(w in mesh.get_name().lower() for w in WORDS):
            continue
        tags = [str(t) for t in b.tags]
        if "WL_AUTHORED" in tags:
            skipped["authored"] += 1
            continue                       # generator content only; authored passes are recoloured at source
        mat = b.get_editor_property("material")
        # EVERY instanced component, not the first one: a batch in the editor world carries a transient EditorPreview
        # ISM alongside its runtime one, and whichever comes back first may be the empty one.
        comps = [c for c in b.get_components_by_class(unreal.InstancedStaticMeshComponent) if c.get_instance_count() > 0]
        if not comps:
            skipped["empty"] += 1
            continue
        ism = comps[0]
        flags = {"collides": bool(b.get_editor_property("collides")),
                 "cast_shadow": bool(b.get_editor_property("cast_shadow")),
                 "affect_df": bool(b.get_editor_property("affect_distance_field_lighting"))}
        bb = mesh.get_bounding_box()
        for i in range(ism.get_instance_count()):
            t = ism.get_instance_transform(i, True)
            loc, rot, s = t.translation, t.rotation.rotator(), t.scale3d
            rows.append({"name": b.get_name(), "label": b.get_actor_label(), "index": i,
                         "mesh": mesh.get_path_name(), "mesh_name": mesh.get_name(),
                         "material": mat.get_name() if mat else None,
                         "transform": [round(loc.x, 3), round(loc.y, 3), round(loc.z, 3), round(rot.pitch, 3),
                                       round(rot.yaw, 3), round(rot.roll, 3), round(s.x, 4), round(s.y, 4), round(s.z, 4)],
                         "top": round(loc.z + bb.max.z * s.z, 1), **flags})
        yield None
    with open(OUT, "w", newline="\n") as f:
        json.dump(rows, f)
    RESULT["count"] = len(rows)
    RESULT["skipped"] = skipped
    RESULT["status"] = "done"
