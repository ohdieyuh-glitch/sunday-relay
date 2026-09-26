# IS THE MOON ACTUALLY LIGHTING ANYTHING?
#
# zc_night_readable says midnight reads 0.031 whole-screen luma with the ground at 0.0039 -- which is what the
# night looked like BEFORE the moon was added. Either the moon is not there, or it is there and contributing
# nothing. This asks the world rather than the source: every directional light in the PIE world, what it is
# called, how bright it is, where it is pointing, whether it is visible and what mobility it has.
CONCURRENT = True

import unreal

L = unreal.WonderlandUiTestLibrary


def job():
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if ues.get_game_world() is None:
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 300)
        yield 6.0
    world = ues.get_game_world()

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 0.5
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 0.0")
    yield 3.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.State")
    yield 0.5

    lights = []
    RESULT["directional_lights"] = lights
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight):
        row = {"name": str(actor.get_name())}
        try:
            row["label"] = str(actor.get_actor_label())
        except Exception:
            pass
        rot = actor.get_actor_rotation()
        row["pitch"] = round(rot.pitch, 2)
        row["yaw"] = round(rot.yaw, 2)
        comp = actor.get_component_by_class(unreal.DirectionalLightComponent)
        if comp is not None:
            for prop, key in (("intensity", "intensity"), ("light_color", "color"),
                              ("cast_shadows", "cast_shadows"), ("affects_world", "affects_world"),
                              ("visible", "visible"), ("mobility", "mobility"),
                              ("atmosphere_sun_light", "atmosphere_sun")):
                try:
                    row[key] = str(comp.get_editor_property(prop))
                except Exception as err:                               # noqa: BLE001
                    row[key] = "?" + str(err)[:60]
            try:
                row["is_visible"] = bool(comp.is_visible())
            except Exception:
                pass
        lights.append(row)
        emit("M", "INFO", "directional light", row)

    skies = []
    RESULT["sky_lights"] = skies
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.SkyLight):
        row = {"name": str(actor.get_name())}
        comp = actor.get_component_by_class(unreal.SkyLightComponent)
        if comp is not None:
            for prop in ("intensity", "source_type", "mobility", "real_time_capture", "lower_hemisphere_is_black"):
                try:
                    row[prop] = str(comp.get_editor_property(prop))
                except Exception as err:                               # noqa: BLE001
                    row[prop] = "?" + str(err)[:50]
        skies.append(row)
        emit("S", "INFO", "sky light", row)

    RESULT["status"] = "measured"
    yield 0.2
