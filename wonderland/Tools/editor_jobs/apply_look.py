# Editor job: apply (or revert) a LOOK layer -- wonderland/WorldDesign/Look/<look>.json -- to the
# world's own lighting actors, and save. Every value it writes has a recorded "before"; the job
# refuses to apply over values that are not the recorded "before" (someone changed them since),
# and REVERT = True writes the "before" values back.
import json

SPEC = globals().get("SPEC")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", True)
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"


def _close(a, b):
    return abs(float(a) - float(b)) < 1e-3


def job():
    yield 0.1
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        raise RuntimeError("PIE is running; looks apply to the editor world only")
    with open(SPEC, encoding="utf-8") as f:
        spec = json.load(f)["settings"]
    source, target = ("after", "before") if REVERT else ("before", "after")
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    actors = eas.get_all_level_actors()
    ppv = next(a for a in actors if isinstance(a, unreal.PostProcessVolume) and a.get_editor_property("unbound"))
    sun = next(a for a in actors if isinstance(a, unreal.DirectionalLight) and a.get_actor_label() == spec["sun"]["label"])
    skylight = next(a for a in actors if isinstance(a, unreal.SkyLight))
    atmosphere = next(a for a in actors if isinstance(a, unreal.SkyAtmosphere)).get_component_by_class(unreal.SkyAtmosphereComponent)

    # Refuse to write over values nobody recorded.
    mismatches = []
    rot = sun.get_actor_rotation()
    s_from = spec["sun"][source]
    if not _close(rot.pitch, s_from["pitch"]):
        mismatches.append("sun pitch %.2f, expected %.2f" % (rot.pitch, s_from["pitch"]))
    if not _close(sun.light_component.get_editor_property("temperature"), s_from["temperature"]):
        mismatches.append("sun temperature")
    if not _close(sun.light_component.get_editor_property("intensity"), s_from["intensity"]):
        mismatches.append("sun intensity")
    if not _close(skylight.light_component.get_editor_property("intensity"), spec["sky_light"][source]["intensity"]):
        mismatches.append("sky light intensity")
    lum = atmosphere.get_editor_property("sky_luminance_factor")
    want = spec["sky_atmosphere"][source]["sky_luminance_factor"]
    if not (_close(lum.r, want[0]) and _close(lum.g, want[1]) and _close(lum.b, want[2])):
        mismatches.append("sky luminance factor %s" % (lum.to_tuple(),))
    if mismatches:
        RESULT["status"] = "error"
        RESULT["error"] = "current values are not the recorded '%s': %s" % (source, "; ".join(mismatches))
        return

    pp = spec["post_process"][target]
    settings = ppv.get_editor_property("settings")
    settings.set_editor_property("override_color_saturation", pp.get("override_color_saturation", False))
    v = pp.get("color_saturation", 1.0)
    settings.set_editor_property("color_saturation", unreal.Vector4(v, v, v, 1.0))
    settings.set_editor_property("override_color_contrast", pp.get("override_color_contrast", False))
    v = pp.get("color_contrast", 1.0)
    settings.set_editor_property("color_contrast", unreal.Vector4(v, v, v, 1.0))
    settings.set_editor_property("override_white_temp", pp.get("override_white_temp", False))
    settings.set_editor_property("white_temp", pp.get("white_temp", 6500.0))
    ppv.set_editor_property("settings", settings)

    s_to = spec["sun"][target]
    sun.set_actor_rotation(unreal.Rotator(roll=rot.roll, pitch=s_to["pitch"], yaw=rot.yaw), False)
    sun.light_component.set_editor_property("temperature", s_to["temperature"])
    sun.light_component.set_editor_property("intensity", s_to["intensity"])
    skylight.light_component.set_editor_property("intensity", spec["sky_light"][target]["intensity"])
    lum_to = spec["sky_atmosphere"][target]["sky_luminance_factor"]
    atmosphere.set_editor_property("sky_luminance_factor", unreal.LinearColor(lum_to[0], lum_to[1], lum_to[2], 1.0))

    RESULT["applied"] = target
    yield 0.3
    if SAVE:
        RESULT["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(ues.get_editor_world(), MAP))
    RESULT["status"] = "done"
