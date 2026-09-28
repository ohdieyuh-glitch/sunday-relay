# WHAT DO THE FIVE SKINS ACTUALLY LOOK LIKE, STANDING, FROM ONE CAMERA?
#
# FOUNDER, P0 item 3: "OBSERVE RELAY OG IN PIE and make every active skin copy its exact idle stance... They
# still stand/walk weird."
#
# THREE CAUSES ARE ELIMINATED AND NONE IS FOUND, which is why this job exists. Measured:
#   - the pose is copied FIELD FOR FIELD, 23 fields, standing, walking and through a Mission Contract
#   - the costume root offset is IDENTICAL across skins, spread in z of 0.0
#   - the authored foot plane is IDENTICAL across the files the runtime actually loads, 3.720 for all five
#
# So the numbers say they should stand alike, and the founder says they do not. When the measurements and
# the person disagree, the person is looking at the rendered thing and the measurements are looking at
# whatever I pointed them at -- and their own instruction is the method: OBSERVE IT.
#
# ONE CAMERA, ONE SPOT, ONE POSE, FIVE SKINS. The Dog is never moved and the camera is never re-posed between
# skins, so anything that differs between the frames is the skin. That is the entire design; there is no
# metric here to be wrong about.
#
# AIMED AT THE FEET, NOT THE CHEST, and that is deliberate. Two earlier attempts at this question failed on
# framing: at 260 uu the legs were out of frame entirely, and at 900 uu with the camera on the mid-body the
# HUD's nav strip was drawn directly across the feet with two AI Companions standing either side. Looking at
# the ANKLES puts them near the middle of the frame, well clear of the strip along the bottom.
#
# THE COMPANIONS ARE SENT AWAY FIRST if they can be, since they stood beside the Dog in every previous
# attempt and a figure that wanders into shot is indistinguishable from a skin that stands oddly.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "stance_look")
SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
DISTANCE = 520.0
# Aimed at the ankles so the feet sit near frame centre, clear of the HUD strip along the bottom.
LOOK_AT_Z = 15.0
EYE_Z = 95.0
FOV = 38.0


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".png", ".jpg")):
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

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if ui is None or dog is None:
        RESULT["status"] = "VOID: no UI subsystem or no pawn"
        return

    # ---- SEND THE COMPANIONS AWAY, so nothing else is standing in the shot.
    hidden = 0
    for actor in unreal.GameplayStatics.get_all_actors_of_class(
            world, unreal.WonderlandCompanionEmbodiment):
        try:
            if actor.get_attach_parent_actor() != dog:
                actor.set_actor_hidden_in_game(True)
                hidden += 1
        except Exception:                                           # noqa: BLE001
            pass
    for cls in ("WonderlandSubAgentCub",):
        try:
            for actor in unreal.GameplayStatics.get_all_actors_of_class(
                    world, getattr(unreal, cls)):
                actor.set_actor_hidden_in_game(True)
                hidden += 1
        except Exception:                                           # noqa: BLE001
            pass
    RESULT["bystanders_hidden"] = hidden
    yield 2.0

    stood_at = dog.get_actor_location()
    yaw = dog.get_actor_rotation().yaw
    RESULT["stood_at"] = [round(stood_at.x, 1), round(stood_at.y, 1), round(stood_at.z, 1)]

    def look():
        eye = unreal.Vector(stood_at.x + math.cos(math.radians(yaw)) * DISTANCE,
                            stood_at.y + math.sin(math.radians(yaw)) * DISTANCE,
                            stood_at.z + EYE_Z)
        L.pose_camera(world, eye,
                      unreal.Vector(stood_at.x, stood_at.y, stood_at.z + LOOK_AT_Z), FOV)

    shots = {}
    RESULT["captures"] = shots
    for skin in SKINS:
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:140]
            continue
        yield 6.0
        look()
        yield 1.5
        live = ues.get_game_world()
        if live is None:
            continue
        unreal.GameplayStatics.set_game_paused(live, True)
        yield 0.3
        path = os.path.join(ROOT, "%s.png" % skin)
        try:
            if L.capture_game_viewport(path):
                shots[skin] = os.path.basename(path)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["%s/shot" % skin] = str(err)[:140]
        unreal.GameplayStatics.set_game_paused(live, False)
        L.release_camera(live)
        yield 0.5
        emit("K_%s" % skin, "INFO", skin, {"capture": shots.get(skin)})

    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 3.0
    RESULT["worn_after_restore"] = str(dog.get_worn_skin_id())
    record("K_SKIN", "Relay OG was put back on the Dog, and it went back",
           "relay_og" in RESULT["worn_after_restore"].lower(), worn=RESULT["worn_after_restore"])

    ended = dog.get_actor_location()
    drift = max(abs(ended.x - stood_at.x), abs(ended.y - stood_at.y), abs(ended.z - stood_at.z))
    RESULT["dog_drift_uu"] = round(drift, 2)
    record("K00", "the Dog stood in one place for every skin",
           drift < 2.0, drift_uu=RESULT["dog_drift_uu"], ceiling=2.0,
           note="THE CONTROL. The whole design is that nothing moves between frames, so a Dog that wandered "
                "turns a stance comparison into a comparison of two positions.")

    record("K01", "every skin was photographed from the one camera",
           len(shots) == len(SKINS), captured=sorted(shots), wanted=sorted(SKINS),
           where=ROOT)

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
