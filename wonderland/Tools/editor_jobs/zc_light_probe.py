# WHICH OF THE FOUR DIRECTIONAL LIGHTS IS THE SUN?
#
# Four of them in one level is the "conflicting lights" the founder named, but three might be a moon, a fill and
# a rim that somebody meant. Disabling them on a hunch is exactly the kind of guess that has cost cycles today,
# so each is asked what it is first.
L = unreal.WonderlandUiTestLibrary


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield 4.0
    world = ues.get_game_world()
    rows = []
    RESULT["lights"] = rows
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight):
        c = a.get_component_by_class(unreal.DirectionalLightComponent)
        row = {"name": a.get_name()}
        try:
            row["label"] = str(a.get_actor_label())
        except Exception:
            pass
        r = a.get_actor_rotation()
        row["rotation"] = [round(r.pitch, 1), round(r.yaw, 1), round(r.roll, 1)]
        row["hidden"] = bool(a.is_hidden_ed()) if hasattr(a, "is_hidden_ed") else None
        if c is not None:
            for prop in ("intensity", "visible", "cast_shadows", "cast_dynamic_shadows",
                         "atmosphere_sun_light", "atmosphere_sun_light_index",
                         "light_color", "cast_volumetric_shadow", "affects_world"):
                try:
                    row[prop] = str(c.get_editor_property(prop))
                except Exception:
                    pass
        rows.append(row)
    RESULT["status"] = "probed"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
