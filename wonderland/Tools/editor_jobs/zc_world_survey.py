# WHAT IS THE WORLD ACTUALLY MADE OF?
#
# Before a day cycle, a shadow pass or a water pass can be written, the level has to be asked what it already
# has: which light is the sun, whether there is a sky atmosphere to tint, whether exposure is on a post process
# volume, what the water is made of, and how the shadows are currently set. Guessing any of these and writing
# against the guess is how three cycles were lost on the brain window.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "world_survey")


def job():
    os.makedirs(ROOT, exist_ok=True)
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
    yield 5.0
    world = ues.get_game_world()

    def count(cls, label):
        try:
            found = unreal.GameplayStatics.get_all_actors_of_class(world, cls)
        except Exception as bad:
            RESULT["error_" + label] = str(bad)[:120]
            return []
        return found

    sky = {}
    RESULT["sky"] = sky

    suns = count(unreal.DirectionalLight, "directional")
    sky["directional_lights"] = len(suns)
    sky["sun_names"] = [a.get_name() for a in suns][:6]
    if suns:
        first = suns[0]
        rot = first.get_actor_rotation()
        sky["sun_rotation"] = [round(rot.pitch, 1), round(rot.yaw, 1), round(rot.roll, 1)]
        sky["sun_mobility_movable"] = True
        comp = first.get_component_by_class(unreal.DirectionalLightComponent)
        if comp is not None:
            for prop in ("intensity", "light_color", "dynamic_shadow_distance_movable_light",
                         "num_dynamic_shadow_cascades", "cascade_distribution_exponent",
                         "shadow_bias", "shadow_slope_bias", "contact_shadow_length"):
                try:
                    sky["sun_" + prop] = str(comp.get_editor_property(prop))
                except Exception:
                    pass

    sky["sky_atmospheres"] = len(count(unreal.SkyAtmosphere, "atmos"))
    sky["sky_lights"] = len(count(unreal.SkyLight, "skylight"))
    sky["exponential_fog"] = len(count(unreal.ExponentialHeightFog, "fog"))
    sky["post_process_volumes"] = len(count(unreal.PostProcessVolume, "ppv"))
    try:
        sky["volumetric_clouds"] = len(count(unreal.VolumetricCloud, "clouds"))
    except Exception:
        sky["volumetric_clouds"] = "class not present"

    # ---------------------------------------------------------------- water, and what it is made of
    water = {}
    RESULT["water"] = water
    watery = []
    for a in count(unreal.StaticMeshActor, "meshes"):
        name = a.get_name().lower()
        label = ""
        try:
            label = str(a.get_actor_label()).lower()
        except Exception:
            pass
        if any(w in name or w in label for w in ("water", "pond", "stream", "fountain", "river", "pool", "lake")):
            comp = a.static_mesh_component
            mats = []
            if comp is not None:
                for slot in range(comp.get_num_materials()):
                    m = comp.get_material(slot)
                    mats.append(m.get_name() if m is not None else "none")
            watery.append({"name": a.get_name(), "label": label, "materials": mats})
    water["count"] = len(watery)
    water["actors"] = watery[:12]

    RESULT["total_actors"] = len(count(unreal.Actor, "all"))
    H.capture_viewport_jpeg(os.path.join(ROOT, "world.jpg"), 1700, 92)
    RESULT["status"] = "surveyed"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
