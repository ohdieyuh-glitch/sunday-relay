# WHAT IS IN THE STAGE'S OWN RENDER TARGET RIGHT NOW?
#
# The wardrobe has two possible preview architectures and it is currently using the worse one.
#
# THE ONE IT USES: the preview square is a HOLE in the Slate panel, and the mascot is teleported out of the
# stage to a spot on the ray through that hole, scaled down to about a third, and photographed by the
# PLAYER'S camera along with whatever else is behind it. That is why this square has, over successive
# sessions, shown the Project Brain chamber, the garden, a staircase, the Dog's back, and now near-blackness.
# Everything in the world is a candidate to appear in it.
#
# THE ONE IT HAS AND DOES NOT USE: AWonderlandSkinStage already owns a SceneCaptureComponent2D writing to a
# render target, and that component is configured exactly the way the founder is now asking for --
# PRM_UseShowOnlyList with only the body and the stage in the list, so the world and the brain CANNOT appear;
# its own 34 degree lens; atmosphere, fog and motion blur off; and manual exposure pinned with min and max
# equal so it cannot drift. The panel even builds a Slate brush from it. It just never paints it.
#
# It was abandoned because it "wrote pure white in this build under ten configurations" -- and the comment
# above ApplyPreviewExposure says why that was and that it was fixed: the show-only list filters PRIMITIVES,
# not the sky, so a capture a kilometre up was photographing the atmosphere.
#
# So before rewiring anything: export the render target to a PNG and look at it. If it holds a clean mascot,
# the entire fix is to paint the brush the panel already has.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "preview_target")
SKINS = ("relay_og", "skeleton_flame", "arden_infernal", "apollo", "celestial_light")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

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
    yield 3.0

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
    record("V00", "the wardrobe's stage actor is in the world", stage is not None)
    if stage is None:
        RESULT["status"] = "FAIL"
        return

    target = None
    try:
        target = stage.get_render_target()
    except Exception as err:                                       # noqa: BLE001
        RESULT["target_error"] = str(err)[:160]
    RESULT["render_target"] = None if target is None else str(target.get_name())
    record("V01", "the stage owns a render target", target is not None,
           target=RESULT["render_target"])
    if target is None:
        RESULT["status"] = "FAIL: no render target"
        return

    try:
        RESULT["target_size"] = [int(target.size_x), int(target.size_y)]
    except Exception:                                              # noqa: BLE001
        pass

    saved = []
    RESULT["exported"] = saved
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        # The stage captures on its own cadence while the wardrobe is open; a moment guarantees a fresh frame.
        yield 1.5
        try:
            unreal.RenderingLibrary.export_render_target(world, target, ROOT, "%s.png" % skin)
            saved.append(skin)
        except Exception as err:                                   # noqa: BLE001
            RESULT.setdefault("export_errors", {})[skin] = str(err)[:160]
        emit("V_%s" % skin, "INFO", "exported %s" % skin, {"ok": skin in saved})

    record("V02", "the render target exported for every skin", len(saved) == len(SKINS),
           exported=saved, errors=RESULT.get("export_errors"),
           note="the verdict is the five PNGs. If they hold a clean, well-lit, well-framed mascot then the "
                "wardrobe's whole fault is that the panel draws a hole instead of painting this.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured; the verdict is the exported targets"
    yield 1.0
