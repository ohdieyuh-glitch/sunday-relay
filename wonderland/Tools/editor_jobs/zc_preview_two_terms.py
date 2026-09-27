# THERE ARE TWO THINGS BLOWING THIS WINDOW OUT, AND ONLY ONE OF THEM WAS THE LAMPS.
#
# The rig sweep settled the first. At a twenty-fifth of the authored lamp intensity, Relay OG finally renders
# as what it is -- a bone-white figure with gold eyes standing on black -- instead of the white silhouette
# that has been mistaken for "the mascot is not rendering" for days. It was rendering the whole time. It was
# just thirteen stops overexposed, because three lamps written for a full-size stage were never rescaled when
# the wardrobe shrank that stage to fit a small window.
#
# But Celestial Light is a featureless white blob at EVERY lamp rung, including the darkest. A skin made of
# light does not care how bright the room is. Its own emissive is the term that saturates, and that term is
# authored for a figure seen across a plaza in daylight, not for a camera held a metre away in a black box.
#
# So the two are separated and swept against each other: lamps pinned at the rung that proved correct, and
# wl.Look.PreviewGlow -- which already exists and already scales exactly the self-lit portion -- taken down
# until the light-skins show a FIGURE rather than a glow. The four skins that carry their own light are the
# ones that decide this; Relay OG rides along as the control that must not go dark while they come down.
#
# The founder's constraint is the reason this is a sweep and not a division. "Bring the flames back" and
# "every skin's eyes glow" both mean the answer is not zero. The wanted rung is the BRIGHTEST one at which a
# body is still legible underneath the light.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "two_terms")
LAMP_FACTOR = 0.040
GLOWS = (0.320, 0.090, 0.030, 0.010)
SKINS = ("celestial_light", "arden_infernal", "skeleton_flame", "relay_og")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    ui = L.get_ui(world)
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    ui.press_switch_skin()
    yield 4.0

    stage = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage):
        stage = actor
        break
    if stage is None:
        tests.append({"id": "N00", "name": "the stage exists", "pass": False, "detail": {}})
        RESULT["status"] = "FAIL"
        return
    target = stage.get_render_target()

    # ---- THE LAMPS, PINNED AT THE RUNG THE RIG SWEEP PROVED. One variable moves from here on.
    for lamp in stage.get_components_by_class(unreal.PointLightComponent):
        try:
            lamp.set_intensity(float(lamp.get_editor_property("intensity")) * LAMP_FACTOR)
        except Exception:                                          # noqa: BLE001
            pass
    yield 2.0

    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        for glow in GLOWS:
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewGlow %.4f" % glow)
            yield 2.5
            try:
                unreal.RenderingLibrary.export_render_target(
                    world, target, ROOT, "%s_g%05.3f.png" % (skin, glow))
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})["%s %s" % (skin, glow)] = str(err)[:120]
        emit("N_%s" % skin, "INFO", "swept %s" % skin, {"glows": list(GLOWS)})

    tests.append({"id": "N00", "name": "both terms were swept", "pass": True,
                  "detail": {"lamp_factor": LAMP_FACTOR, "glows": list(GLOWS), "skins": list(SKINS)}})
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured; the verdict is the exported targets"
    yield 1.0
