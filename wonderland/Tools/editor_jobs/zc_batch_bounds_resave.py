# REWRITE EVERY INSTANCED BATCH'S WORLD PARTITION DESCRIPTOR with the bounds its instances really cover.
#
# Until 2026-09-28 AWonderlandInstancedBatch reported a POINT AT THE ORIGIN as its streaming bounds (its instances
# live on an editor-only preview), so every spatially loaded batch sat in the one cell at the origin and the
# instanced world beyond the core did not exist in play. The C++ fix (GetStreamingBounds override) only reaches
# disk when each batch's package is saved again: this touches every batch and saves once.
#
# Refuses if PIE is running or if the map already has unsaved changes. Reads back descriptors for a sample after.
CONCURRENT = False
import unreal

MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"


def _box(b):
    return [[round(b.min.x), round(b.min.y), round(b.min.z)], [round(b.max.x), round(b.max.y), round(b.max.z)]]


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        RESULT["status"] = "refused: PIE is running"
        return
    dirty = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["dirty_before"] = dirty
    if dirty:
        RESULT["status"] = "refused: the map has unsaved changes"
        return
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    batches = [a for a in eas.get_all_level_actors() if a.get_class().get_name() == "WonderlandInstancedBatch"]
    RESULT["batches"] = len(batches)
    before = unreal.WorldPartitionBlueprintLibrary.get_actor_descs_for_actors(batches)
    RESULT["spatially_loaded_before"] = sum(1 for d in before if d.get_editor_property("is_spatially_loaded"))
    RESULT["zero_bounds_before"] = sum(1 for d in before if _box(d.get_editor_property("bounds")) == [[0, 0, 0], [0, 0, 0]])
    touched = 0
    for a in batches:
        if a.modify(True):
            touched += 1
    RESULT["touched"] = touched
    yield 1.0
    RESULT["dirty_after_touch"] = len(unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages())
    RESULT["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(ues.get_editor_world(), MAP))
    yield 2.0
    after = unreal.WorldPartitionBlueprintLibrary.get_actor_descs_for_actors(batches)
    zero_after = 0
    sample = []
    for a, d in zip(batches, after):
        box = _box(d.get_editor_property("bounds"))
        if box == [[0, 0, 0], [0, 0, 0]]:
            zero_after += 1
        if len(sample) < 12 and (len(sample) < 4 or a.get_actor_label()[:4] in ("GF03", "W270", "TQ03", "FR03", "IC02")):
            o, e = a.get_actor_bounds(False)
            sample.append({"label": a.get_actor_label()[:50], "desc": box,
                           "actor": [[round(o.x - e.x), round(o.y - e.y), round(o.z - e.z)],
                                     [round(o.x + e.x), round(o.y + e.y), round(o.z + e.z)]],
                           "spatial": d.get_editor_property("is_spatially_loaded")})
    RESULT["zero_bounds_after"] = zero_after
    RESULT["spatially_loaded_after"] = sum(1 for d in after if d.get_editor_property("is_spatially_loaded"))
    RESULT["sample"] = sample
    RESULT["dirty_end"] = len(unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages())
    RESULT["status"] = "done"
