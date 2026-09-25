# WHAT IS IN THE BASELINE WORLD THAT WAS NOT THERE BEFORE?
#
# zc_avatar_cost's baseline -- no avatars at all -- went from 31.86 ms to 47.88 on a fresh editor, with the
# render thread nearly doubling (17.51 -> 32.29). Something added during the look pass is costing every
# frame with nothing spawned. Rather than guess which change, the world is counted.
CONCURRENT = False

L = unreal.WonderlandUiTestLibrary


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 1.0

    counts = {}
    for label, cls in (("brain_sculptures", unreal.WonderlandBrainSculpture),
                       ("companions", unreal.WonderlandCompanionEmbodiment),
                       ("dogs", unreal.RelayDogCharacter),
                       ("point_lights", unreal.PointLight),
                       ("directional_lights", unreal.DirectionalLight)):
        try:
            counts[label] = len(unreal.GameplayStatics.get_all_actors_of_class(world, cls))
        except Exception as err:
            counts[label] = "ERR %s" % str(err)[:50]
    RESULT["actors"] = counts

    # Every light COMPONENT in the world, including ones parented to actors of other classes -- which is how
    # the brain's two lamps would show up if a sculpture were somehow still alive.
    lights = []
    total_ism = 0
    total_instances = 0
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            label = str(actor.get_actor_label())
        except Exception:
            label = str(actor.get_name())
        for comp in actor.get_components_by_class(unreal.LightComponent):
            try:
                lights.append({"actor": label[:40], "comp": str(comp.get_name())[:28],
                               "intensity": round(float(comp.get_editor_property("intensity")), 0),
                               "visible": bool(comp.is_visible())})
            except Exception:
                continue
        for comp in actor.get_components_by_class(unreal.InstancedStaticMeshComponent):
            total_ism += 1
            try:
                total_instances += int(comp.get_instance_count())
            except Exception:
                pass
    RESULT["light_components"] = lights[:24]
    RESULT["light_count"] = len(lights)
    RESULT["ism_components"] = total_ism
    RESULT["ism_instances"] = total_instances
    RESULT["status"] = "counted"
    RESULT["log"] = "lights=%d ism=%d instances=%d" % (len(lights), total_ism, total_instances)

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
