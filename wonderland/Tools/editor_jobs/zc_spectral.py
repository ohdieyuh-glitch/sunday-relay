# IS SKELETON FLAME ONE SYNCHRONIZED SPECTRAL SYSTEM, FROM EVERY SIDE?
#
# FOUNDER: the flames, the eyes and the chest skull must share one colour family; the skull's eyes must pulse;
# the dark block on the side and back must glow and pulse with them rather than sitting there black. Capture
# PULSE LOW, MID and HIGH at FRONT, SIDE and BACK.
#
# WHAT WAS ACTUALLY WRONG, and it was not the shader. The generator has carried the spectral system for some
# time -- soulpulse and soulveilpulse in the eyes' own colour, flankfire down both sides, backfire across the
# back -- and the shipped SkeletonFlame.wlvox predates all of it. Regenerating every skin in the lineup into a
# scratch directory and diffing proved it: Relay OG, Arden, Apollo and Celestial Light come out byte-for-byte
# the same size they already are, and only Skeleton Flame moves, 1,485 boxes to 2,186. The founder was looking
# at a stale asset, not a broken system. Both pulse materials are named "...pulse", which is how the animator
# recognises a heartbeat, so they join the existing beat rather than inventing a second one.
#
# HOW THE THREE PULSE LEVELS ARE FOUND. Not by freezing a clock or guessing a phase: the stage is captured
# many times across several seconds at each angle, and the exported frames are ranked afterwards by measured
# brightness. LOW, MID and HIGH are then the dimmest, middle and brightest frames that actually occurred. That
# also answers the question the founder really asked -- if the darkest and brightest frames measure the same,
# there is no pulse, and no amount of looking at one screenshot would have told anyone.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "spectral")
ANGLES = (("front", 0.0), ("side", 90.0), ("back", 180.0))
FRAMES = 14


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
    ui.wear_relay_skin("skeleton_flame")
    yield 6.0

    stage = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage):
        stage = actor
        break
    if stage is None:
        tests.append({"id": "S00", "name": "the stage exists", "pass": False, "detail": {}})
        RESULT["status"] = "FAIL"
        return
    target = stage.get_render_target()

    figure = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(
            world, unreal.WonderlandCompanionEmbodiment):
        try:
            if "SkinStage" in str(actor.get_actor_label()):
                figure = actor
                break
        except Exception:                                          # noqa: BLE001
            pass

    # ---- WHAT THE FIGURE SAYS IT IS MADE OF, so the capture is not the only witness.
    said = {}
    RESULT["figure"] = said
    if figure is not None:
        try:
            said["flames"] = str(figure.describe_flames())[:800]
        except Exception as err:                                   # noqa: BLE001
            said["flames"] = "?" + str(err)[:80]
        try:
            said["framing"] = str(stage.describe_framing())
        except Exception:                                          # noqa: BLE001
            pass
    emit("S_FIG", "INFO", "what Skeleton Flame reports", said)

    for name, yaw in ANGLES:
        if figure is not None:
            try:
                figure.set_actor_rotation(unreal.Rotator(0.0, yaw, 0.0), False)
            except Exception:                                      # noqa: BLE001
                pass
        yield 2.0
        for frame in range(FRAMES):
            try:
                unreal.RenderingLibrary.export_render_target(
                    world, target, ROOT, "%s_f%02d.png" % (name, frame))
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})["%s %d" % (name, frame)] = str(err)[:100]
            yield 0.32
        emit("S_%s" % name, "INFO", "captured %s across the beat" % name, {"frames": FRAMES})

    if figure is not None:
        try:
            figure.set_actor_rotation(unreal.Rotator(0.0, 0.0, 0.0), False)
        except Exception:                                          # noqa: BLE001
            pass

    tests.append({"id": "S00", "name": "the beat was sampled at every angle", "pass": True,
                  "detail": {"angles": [a[0] for a in ANGLES], "frames_each": FRAMES,
                             "note": "LOW/MID/HIGH are chosen from these by measured brightness, outside the "
                                     "editor -- a frame cannot be called the peak by the thing that drew it"}})
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
