# HOW MUCH LIGHT DOES A SHOEBOX-SIZED STAGE ACTUALLY NEED?
#
# Sweeping the capture's EXPOSURE from +11 stops to -2 -- thirteen stops, an eight-thousand-fold change --
# barely altered the exported picture. That is the tell: the exposure bias is not the term that is saturating
# it. The LIGHTS are. Three lamps at 90,000, 26,000 and 52,000 candelas sit about 1.3 m from a figure the size
# of a hand, which is on the order of fifty thousand lux -- full daylight, in a black room.
#
# Those numbers were written for a stage at full size. The wardrobe scales the whole rig down to bring the
# figure to the window, and nobody rescaled the lighting with it.
#
# So the lamps are swept by multiplier at runtime -- no rebuild, one session, same camera -- and the render
# target exported at each rung. Relay OG because it is plain bone with almost no light of its own, and
# Celestial Light because it is made of light and will be the first to blow.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "preview_rig")
FACTORS = (1.0, 0.12, 0.04, 0.012)
SKINS = ("relay_og", "celestial_light")


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
        tests.append({"id": "G00", "name": "the stage exists", "pass": False, "detail": {}})
        RESULT["status"] = "FAIL"
        return
    target = stage.get_render_target()

    lamps = list(stage.get_components_by_class(unreal.PointLightComponent))
    base = {}
    for lamp in lamps:
        try:
            base[str(lamp.get_name())] = float(lamp.get_editor_property("intensity"))
        except Exception:                                          # noqa: BLE001
            pass
    RESULT["authored_intensities"] = base
    emit("G_BASE", "INFO", "the lamps as authored", base)

    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        for factor in FACTORS:
            for lamp in lamps:
                try:
                    lamp.set_intensity(base.get(str(lamp.get_name()), 90000.0) * factor)
                except Exception:                                  # noqa: BLE001
                    pass
            yield 2.0
            try:
                unreal.RenderingLibrary.export_render_target(
                    world, target, ROOT, "%s_x%05.3f.png" % (skin, factor))
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})["%s %s" % (skin, factor)] = str(err)[:120]
        emit("G_%s" % skin, "INFO", "swept %s" % skin, {"factors": list(FACTORS)})

    for lamp in lamps:
        try:
            lamp.set_intensity(base.get(str(lamp.get_name()), 90000.0))
        except Exception:                                          # noqa: BLE001
            pass
    tests.append({"id": "G00", "name": "the rig sweep exported", "pass": True,
                  "detail": {"factors": list(FACTORS), "authored": base}})
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured; the verdict is the exported targets"
    yield 1.0
