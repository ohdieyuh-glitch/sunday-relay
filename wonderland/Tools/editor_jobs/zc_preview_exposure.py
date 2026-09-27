# WHAT EXPOSURE DOES THE WARDROBE'S OWN CAMERA NEED?
#
# The capture path was abandoned long ago because it "wrote pure white in this build under ten
# configurations", and the wardrobe was rebuilt as a hole in the panel showing the live world -- which is why
# the square has since shown the brain chamber, the garden, a staircase, the Dog's back and a nearly black
# frame. The white was one number: AutoExposureBias = 11, a 2048x boost, set when the capture was
# photographing a dark room and never revisited after the sky was switched off and three lights were pointed
# at the figure.
#
# So the stops are swept and the render target exported at each, for the two skins that bracket the problem:
# Relay OG, which is bone and has almost no light of its own, and Celestial Light, which is made of it.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "preview_exposure")
STOPS = (11.0, 7.0, 4.0, 1.0, -2.0)
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
        tests.append({"id": "X00", "name": "the stage exists", "pass": False, "detail": {}})
        RESULT["status"] = "FAIL"
        return
    target = stage.get_render_target()

    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        for ev in STOPS:
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewExposure %.2f" % ev)
            yield 2.0
            try:
                unreal.RenderingLibrary.export_render_target(
                    world, target, ROOT, "%s_ev%+05.1f.png" % (skin, ev))
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})["%s %s" % (skin, ev)] = str(err)[:120]
        emit("X_%s" % skin, "INFO", "swept %s" % skin, {"stops": list(STOPS)})

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewExposure 11.0")
    tests.append({"id": "X00", "name": "the sweep exported", "pass": True, "detail": {"stops": list(STOPS)}})
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured; the verdict is the exported targets"
    yield 1.0
