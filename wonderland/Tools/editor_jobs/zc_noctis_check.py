# IS NOCTIS'S SIGNATURE ACCENT ACTUALLY IN THE WORLD NOW?
#
# WORLD_BETA_LEDGER row F: "MI_V2_NoctisLuminous is canon, exists as an asset, and is used in ZERO instances
# across NC01-NC04." The generator now emits it and the layers have been applied and saved -- so this counts
# it in the LEVEL, which is the only place the claim can be settled.
def job():
    RESULT["status"] = "running"
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield 5.0
    world = ues.get_game_world()

    found = {}
    total = 0
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        for comp in a.get_components_by_class(unreal.InstancedStaticMeshComponent):
            m = comp.get_material(0)
            if m is None:
                continue
            name = m.get_name()
            if "Luminous" in name:
                n = int(comp.get_instance_count())
                found[a.get_name()] = found.get(a.get_name(), 0) + n
                total += n
    RESULT["luminous_instances_in_world"] = total
    RESULT["carriers"] = sorted(found.items(), key=lambda kv: -kv[1])[:10]
    RESULT["status"] = "counted"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
