# Editor-world probe: what is loaded, and does the new batch preview draw?
def job():
    yield 1.0
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = ues.get_editor_world()
    RESULT["editor_world"] = world.get_path_name() if world else None
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actors = eas.get_all_level_actors()
    RESULT["actors"] = len(actors)
    batches = [a for a in actors if isinstance(a, unreal.WonderlandInstancedBatch)]
    RESULT["batches"] = len(batches)
    declared = 0
    preview = 0
    empty = []
    for b in batches:
        d = b.declared_instance_count()
        p = b.editor_preview_instance_count()
        declared += d
        preview += p
        if d > 0 and p != d and len(empty) < 10:
            empty.append([b.get_actor_label(), d, p])
    RESULT["declared_pieces"] = declared
    RESULT["preview_pieces"] = preview
    RESULT["preview_mismatch_examples"] = empty
    anchors = [a for a in actors if isinstance(a, unreal.WonderlandTravelAnchor)]
    RESULT["anchors"] = [[str(a.get_editor_property("destination_id")), a.get_actor_location().to_tuple()] for a in anchors]
    settings = unreal.get_default_object(unreal.load_class(None, "/Script/Wonderland.WonderlandTravelSettings"))
    rows = settings.get_editor_property("destinations")
    RESULT["registry_rows"] = len(rows)
    RESULT["registry_offered_status"] = sum(1 for r in rows if str(r.get_editor_property("status")).split(".")[-1].upper() in ("DEVELOPED", "AVAILABLE"))
    emit("probe complete")
