# PIE job: try look/lighting variants on the PIE copy of the world and capture each from the same
# cameras. Nothing is saved; the editor world keeps its settings. The winner is then persisted by a
# separate, reviewed edit.
import os

CAMERAS = globals().get("CAMERAS", ["HeroCam_GoldenArrivalBible", "FlankLeftCam08"])
TAG = globals().get("TAG", "grade")
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "grade")
VARIANTS = globals().get("VARIANTS", [
    {"id": "v0_baseline"},
    {"id": "v1_sat112_con105", "saturation": 1.12, "contrast": 1.05},
    {"id": "v2_v1_wt6000", "saturation": 1.12, "contrast": 1.05, "white_temp": 6000.0},
    {"id": "v3_v1_wt7200", "saturation": 1.12, "contrast": 1.05, "white_temp": 7200.0},
    {"id": "v4_v1_sun45_5000K", "saturation": 1.12, "contrast": 1.05, "sun_pitch": -45.0, "sun_temp": 5000.0},
    {"id": "v5_v4_deepsky", "saturation": 1.12, "contrast": 1.05, "sun_pitch": -45.0, "sun_temp": 5000.0, "sky_luminance": [0.82, 0.9, 1.08]},
])


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 4.0
    world = ues.get_game_world()
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    unreal.GameplayStatics.get_player_pawn(world, 0).set_actor_hidden_in_game(True)
    for hud in unreal.ObjectIterator(unreal.WonderlandUsageHudWidget):
        if hud.get_world() == world:
            hud.set_visibility(unreal.SlateVisibility.HIDDEN)
    cams = {a.get_actor_label(): a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor)}
    ppv = next(a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.PostProcessVolume) if a.get_editor_property("unbound"))
    sun = next(a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.DirectionalLight) if a.get_actor_label() == "V2_Sun")
    skylight = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.SkyLight)[0]
    sky = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.SkyAtmosphere)[0]
    atmosphere = sky.get_component_by_class(unreal.SkyAtmosphereComponent)

    base_settings = ppv.get_editor_property("settings")
    base_rot = sun.get_actor_rotation()
    base_temp = sun.light_component.get_editor_property("temperature")
    base_lum = atmosphere.get_editor_property("sky_luminance_factor")
    base_sky_intensity = skylight.light_component.get_editor_property("intensity")
    base_sun_intensity = sun.light_component.get_editor_property("intensity")
    RESULT["baseline"] = {"sun_rot": base_rot.to_tuple(), "sun_temp": base_temp, "sky_luminance": base_lum.to_tuple()}

    shots = []
    for variant in VARIANTS:
        settings = ppv.get_editor_property("settings")
        settings.set_editor_property("override_color_saturation", "saturation" in variant)
        settings.set_editor_property("color_saturation", unreal.Vector4(variant.get("saturation", 1.0), variant.get("saturation", 1.0), variant.get("saturation", 1.0), 1.0))
        settings.set_editor_property("override_color_contrast", "contrast" in variant)
        settings.set_editor_property("color_contrast", unreal.Vector4(variant.get("contrast", 1.0), variant.get("contrast", 1.0), variant.get("contrast", 1.0), 1.0))
        settings.set_editor_property("override_white_temp", "white_temp" in variant)
        settings.set_editor_property("white_temp", variant.get("white_temp", 6500.0))
        ppv.set_editor_property("settings", settings)
        sun.set_actor_rotation(unreal.Rotator(roll=base_rot.roll, pitch=variant.get("sun_pitch", base_rot.pitch), yaw=base_rot.yaw), False)
        sun.light_component.set_temperature(variant.get("sun_temp", base_temp))
        lum = variant.get("sky_luminance")
        atmosphere.set_sky_luminance_factor(unreal.LinearColor(*lum, 1.0) if lum else base_lum)
        skylight.light_component.set_intensity(variant.get("skylight", base_sky_intensity))
        sun.light_component.set_intensity(variant.get("sun_intensity", base_sun_intensity))
        skylight.light_component.recapture_sky()
        for name in CAMERAS:
            pc.set_view_target_with_blend(cams[name], 0.0)
            yield 3.0
            path = os.path.join(SHOTS, "%s__%s__%s.png" % (name, TAG, variant["id"]))
            unreal.WonderlandUiTestLibrary.capture_game_viewport(path)
            shots.append(path)
        emit(variant["id"])
    ppv.set_editor_property("settings", base_settings)
    RESULT["shots"] = shots
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"
