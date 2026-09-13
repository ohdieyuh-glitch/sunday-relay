# Editor job: every CameraActor in the map, and the Marble scaffold's placement, so a reference
# capture suite can be chosen from the world's own cameras rather than invented ones.
def job():
    yield 0.2
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    cams = []
    scaffold = None
    for a in eas.get_all_level_actors():
        if isinstance(a, unreal.CameraActor):
            loc = a.get_actor_location()
            rot = a.get_actor_rotation()
            comp = a.get_editor_property("camera_component")
            cams.append({"label": a.get_actor_label(), "folder": str(a.get_folder_path()),
                         "loc": [round(loc.x), round(loc.y), round(loc.z)],
                         "rot": [round(rot.pitch, 1), round(rot.yaw, 1), round(rot.roll, 1)],
                         "fov": comp.get_editor_property("field_of_view") if comp else None,
                         "tags": [str(t) for t in a.tags]})
        elif a.get_actor_label() == "V2_MarbleWorld_Scaffold":
            smc = a.get_component_by_class(unreal.StaticMeshComponent)
            scaffold = {"loc": a.get_actor_location().to_tuple(), "rot": a.get_actor_rotation().to_tuple(),
                        "scale": a.get_actor_scale3d().to_tuple(), "visible": smc.get_editor_property("visible") if smc else None,
                        "hidden_in_game": a.get_editor_property("hidden")}
    cams.sort(key=lambda c: c["label"])
    RESULT["cameras"] = cams
    RESULT["scaffold"] = scaffold
    RESULT["status"] = "done"
    emit("cameras", len(cams))
