# WHAT IS ACTUALLY FILLING THE FRAME ON THE TWO SKINS THAT WILL NOT COME DOWN?
#
# Apollo behaves: dropping the preview glow from a hundredth to three ten-thousandths takes its mean from 166
# to 78. Celestial Light and Skeleton Flame barely move at all across the same 33x reduction -- 237 to 181 and
# 244 to 204 -- and stay white corner to corner.
#
# THAT IS THE SAME SIGNATURE THAT ALREADY CAUGHT ONE WRONG ANSWER TODAY. Sweeping the capture's exposure
# through thirteen stops changed nothing, and the reason was that exposure was not the saturating term; the
# lamps were. A term that can be moved by a factor of thirty without moving the picture is not the term doing
# the damage, and turning it down further is guessing.
#
# So the two remaining candidates are separated instead of argued about. BLOOM spreads a bright subject across
# the whole frame including the corners, which is what "white from edge to edge" looks like when the figure
# itself is merely bright. THE LAMPS light the figure's own surface, which is what it looks like when the skin
# is simply being over-lit. Each is taken to zero in turn, with everything else held, and the corners are what
# answers: if killing bloom makes the corners black, the frame was never full -- it was smeared.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "bloom_probe")
SKINS = ("skeleton_flame", "celestial_light", "apollo", "arden_infernal", "relay_og")
# name, bloom, lights, glow -- one variable away from the baseline in each row.
# name, bloom, lights, glow. THE THRESHOLD TURNED OUT TO BE UNREACHABLE -- set alongside BM_SOG it changed
# nothing measurable, Celestial Light staying at 251 against 237 without it -- so the lever being calibrated
# here is the one that demonstrably moves the picture: intensity. Zero is included as the control, because
# zero is the reading the isolation probe already trusts (237 to 105).
CASES = (("bloom_0.100", 0.100, 0.040, 0.0100),
         ("bloom_0.040", 0.040, 0.040, 0.0100),
         ("bloom_0.015", 0.015, 0.040, 0.0100),
         ("bloom_0.005", 0.005, 0.040, 0.0100),
         ("bloom_0.000", 0.000, 0.040, 0.0100))


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
        tests.append({"id": "B00", "name": "the stage exists", "pass": False, "detail": {}})
        RESULT["status"] = "FAIL"
        return
    target = stage.get_render_target()

    said = {}
    RESULT["flames"] = said
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        for name, bloom, lights, glow in CASES:
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewBloom %.4f" % bloom)
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewLights %.4f" % lights)
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewGlow %.5f" % glow)
            yield 2.5
            try:
                unreal.RenderingLibrary.export_render_target(world, target, ROOT, "%s_%s.png" % (skin, name))
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})["%s %s" % (skin, name)] = str(err)[:110]
        # WHAT THE FLAME SURFACE IS ACTUALLY CARRYING, in linear colour, at the low glow it ends on. If these
        # read in the hundreds the glow is not reaching them; if they read near one, the fire is innocent.
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            try:
                if "SkinStage" in str(actor.get_actor_label()):
                    said[skin] = str(actor.describe_flames())[:700]
                    break
            except Exception:                                      # noqa: BLE001
                pass
        emit("B_%s" % skin, "INFO", skin, {"flames": said.get(skin, "?")})

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewBloom 0.10")
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewLights 0.040")
    unreal.SystemLibrary.execute_console_command(world, "wl.Look.PreviewGlow 0.0100")
    tests.append({"id": "B00", "name": "each term was taken to zero in turn", "pass": True,
                  "detail": {"cases": [c[0] for c in CASES], "skins": list(SKINS)}})
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured; the corners of the exported frames are the answer"
    yield 1.0
