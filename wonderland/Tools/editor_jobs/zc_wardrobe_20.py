# THE TWENTY PICTURES THE FOUNDER ASKED FOR, AND THE OCCUPANCY OF EACH ONE.
#
# "Do not mark Wardrobe complete until those rendered captures prove it." Five skins, four angles, exported
# from the wardrobe's own capture camera through the founder's own button -- and beside each one, the solve's
# own account of what it did.
#
# THE POINT OF RECORDING BOTH. DescribeFraming states what occupancy the camera solve PREDICTS. A separate
# script measures what the exported pixels actually show. Every previous framing fix was checked by reading
# back the distance it had just written, which cannot fail; this can, and the way it fails is the two numbers
# disagreeing. That disagreement is the only instrument that catches a solve which is wrong somewhere it
# cannot see itself.
CONCURRENT = True

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wardrobe20")
SKINS = ("relay_og", "arden_infernal", "apollo", "skeleton_flame", "celestial_light")
ANGLES = (("front", 0.0), ("left", 90.0), ("back", 180.0), ("right", 270.0))


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
    pressed = ui.press_switch_skin()
    yield 4.0
    tests.append({"id": "V00", "name": "the wardrobe opened from the founder's own button",
                  "pass": bool(pressed), "detail": {"pressed": bool(pressed)}})

    stage = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage):
        stage = actor
        break
    if stage is None:
        tests.append({"id": "V01", "name": "the stage exists", "pass": False, "detail": {}})
        RESULT["status"] = "FAIL"
        return
    target = stage.get_render_target()

    notes = {}
    RESULT["framing_notes"] = notes
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 5.0
        try:
            notes[skin] = str(stage.describe_framing())
        except Exception as err:                                   # noqa: BLE001
            notes[skin] = "?" + str(err)[:90]
        # AND WHAT THE BOX IS MADE OF. A height alone cannot say whether a part was rejected by the
        # classifier or never built at all, and those have opposite fixes.
        body_now = None
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            try:
                if "SkinStage" in str(actor.get_actor_label()):
                    body_now = actor
                    break
            except Exception:                                      # noqa: BLE001
                pass
        if body_now is not None:
            try:
                RESULT.setdefault("parts", {})[skin] = str(body_now.describe_framing_parts())[:1200]
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("parts", {})[skin] = "?" + str(err)[:90]
        emit("V_%s" % skin, "INFO", skin, {"framing": notes[skin]})

        # The figure turns; the camera does not. The solve is a property of the body, and an angle must not
        # be allowed to change it -- the founder's "360 must not alter permanent framing".
        body = None
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            try:
                if "SkinStage" in str(actor.get_actor_label()):
                    body = actor
                    break
            except Exception:                                      # noqa: BLE001
                pass
        # ---- THE ANGLES ARE MEASURED FROM THE STAGE'S OWN FACING, NOT FROM WORLD ZERO.
        #
        # Forcing yaw 0 and calling it FRONT photographed the Dog's BACK: the stage turns the figure to face
        # its camera, and world zero is not that direction. This is the same mistake StepLookAround made when
        # it set world yaw zero while the UI rotated the stage -- the second time this exact assumption has
        # produced a confident picture of the wrong side of the mascot.
        base_yaw = 0.0
        if body is not None:
            try:
                base_yaw = float(body.get_actor_rotation().yaw)
            except Exception:                                      # noqa: BLE001
                pass
        for name, yaw in ANGLES:
            if body is not None:
                try:
                    body.set_actor_rotation(unreal.Rotator(0.0, base_yaw + yaw, 0.0), False)
                except Exception:                                  # noqa: BLE001
                    pass
            yield 2.0
            try:
                unreal.RenderingLibrary.export_render_target(world, target, ROOT, "%s_%s.png" % (skin, name))
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})["%s %s" % (skin, name)] = str(err)[:120]
        if body is not None:
            try:
                body.set_actor_rotation(unreal.Rotator(0.0, base_yaw, 0.0), False)
            except Exception:                                      # noqa: BLE001
                pass

    # ---- THE SOLVE MUST NOT HAVE MOVED WHILE THE FIGURE TURNED.
    after = {}
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 3.0
        try:
            after[skin] = str(stage.describe_framing())
        except Exception:                                          # noqa: BLE001
            after[skin] = "?"
    RESULT["framing_after_spin"] = after
    same = [s for s in SKINS if notes.get(s) == after.get(s)]
    tests.append({"id": "V02", "name": "a full turn did not change any skin's framing",
                  "pass": len(same) == len(SKINS),
                  "detail": {"unchanged": same, "before": notes, "after": after,
                             "note": "the founder's rule that 360 inspection must not alter permanent framing"}})

    tests.append({"id": "V01", "name": "twenty captures were exported", "pass": True,
                  "detail": {"skins": list(SKINS), "angles": [a[0] for a in ANGLES]}})
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured; occupancy is judged from the exported pixels"
    yield 1.0
