# CAPTURE (read-only): JACK FLAME'S HEAD FIRE, WORN BY THE DOG IN PLAY, from the founder's bearings.
#
# FOUNDER, 2026-09-30: a whole-head burn was asked for ("Verify the change IN SIMULATION from: front; left side; right
# side; rear/three-quarter"), built, photographed -- and cancelled the same night: "REVERT THE JACK FLAME HEAD CHANGE
# ... restore the original head treatment". The accepted head is what ships; this job is how any head change is
# photographed, and how the revert was checked against the "before" set.
#
# The same spot, facing, hours and camera placements for every set, so any two are a like-for-like comparison: TAG
# names the set ("before" / "after" / "reverted"). The Dog wears the skin through the wardrobe path (the one the
# player uses), stands still on the turnaround lawn, and each camera is aimed at the costume's own head joint, so a
# head that moved would move the frame with it. Night first (fire reads against the dark) then midday.
# Globals: TAG. PIE-owning: CONCURRENT is False. Saves nothing; restores the persisted skin.
CONCURRENT = False
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
GS = unreal.GameplayStatics
TAG = globals().get("TAG", "before")
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zg", "jack_head")
STAGE_AT = (-2600.0, -600.0)     # the turnaround lawn: clear on every bearing (zc_skin_turnaround)
FACING = 40.0
# name, bearing from the Dog's facing (camera on the Dog's right at +90), distance uu, eye lift uu, look lift uu, fov
VIEWS = [("front", 0.0, 330.0, 12.0, 16.0, 40.0),
         ("left", -90.0, 330.0, 12.0, 16.0, 40.0),
         ("right", 90.0, 330.0, 12.0, 16.0, 40.0),
         ("rear_three_quarter", 145.0, 330.0, 16.0, 16.0, 40.0),
         ("front_three_quarter", 35.0, 330.0, 12.0, 16.0, 40.0),
         ("wide_front", 20.0, 620.0, -30.0, -45.0, 40.0),
         ("wide_rear", 160.0, 620.0, -30.0, -45.0, 40.0)]
HOURS = [("night", 22.0), ("day", 12.0)]


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.startswith(TAG + "_") and old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    RESULT["tag"] = TAG
    L.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        try:
            world = ues.get_game_world()
            if world is not None:
                L.release_camera(world)
        except Exception as exc:
            unreal.log_warning("WLJACK release: %s" % exc)
        with open(os.path.join(ROOT, "%s.json" % TAG), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 120.0:
        yield 1.0
        t += 1.0
    world = ues.get_game_world()
    dog_of = lambda: GS.get_player_pawn(ues.get_game_world(), 0)
    t = 0.0
    while dog_of() is None and t < 30.0:
        yield 0.5
        t += 0.5
    if dog_of() is None:
        RESULT["status"] = "BLOCKED: no pawn"
        return
    yield 3.0
    L.focus_game_viewport()
    persisted = None
    try:
        persisted = open(os.path.join(unreal.Paths.project_saved_dir(), "Wonderland", "RelaySkin.txt")).read().strip()
    except Exception:
        pass
    RESULT["persisted_skin_at_start"] = persisted
    ui = L.get_ui(world)
    ui.wear_relay_skin("jack_flame")
    yield 2.5

    gx, gy = STAGE_AT
    hit = unreal.SystemLibrary.line_trace_single(
        world, unreal.Vector(gx, gy, 600.0), unreal.Vector(gx, gy, -300.0),
        unreal.TraceTypeQuery.TRACE_TYPE_QUERY2, False, [], unreal.DrawDebugTrace.NONE, True,
        unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
    gz = float(hit.to_tuple()[4].z) if hit and hasattr(hit, "to_tuple") else 15.0
    dog = dog_of()
    half = dog.capsule_component.get_scaled_capsule_half_height()
    dog.character_movement.disable_movement()
    dog.set_actor_location(unreal.Vector(gx, gy, gz + half + 20.0), False, True)
    # unreal.Rotator is (roll, pitch, yaw) positionally -- named here -- and the controller owns the pawn's yaw.
    dog.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=FACING), False)
    pc = GS.get_player_controller(world, 0)
    if pc is not None:
        pc.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-6.0, yaw=FACING))
    dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
    yield 3.0
    dog = dog_of()
    RESULT["dog_yaw"] = round(float(dog.get_actor_rotation().yaw), 1)
    costume = dog.get_costume()
    if costume is None:
        RESULT["status"] = "BLOCKED: the Dog is not wearing a costume"
        return
    head = None
    for c in costume.get_components_by_class(unreal.SceneComponent):
        if c.get_name().startswith("Part_head"):
            head = c
            break
    if head is None:
        RESULT["status"] = "BLOCKED: no head joint on the costume"
        return
    RESULT["figure"] = str(costume.get_figure_path())
    RESULT["ground_z"] = round(gz, 1)
    # THE COMPANIONS FLOAT 1.35 m OFF THE DOG'S LEFT (FollowOffset) and stood between the left-side camera and the head
    # in the first set. Hidden for these views only -- never the Dog's own costume -- and shown again below.
    hidden = []
    for other in unreal.ObjectIterator(unreal.WonderlandCompanionEmbodiment):
        try:
            if other.get_world() == world and other != costume:
                other.set_actor_hidden_in_game(True)
                hidden.append(other)
        except Exception as exc:
            unreal.log_warning("WLJACK hide: %s" % exc)
    RESULT["companions_hidden_for_views"] = len(hidden)
    shots = []
    # the bearings are taken from the way the Dog ACTUALLY faces, whatever set it
    face = math.radians(float(dog.get_actor_rotation().yaw))
    for hour_name, hour in HOURS:
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
        yield 2.5
        for name, bearing, dist, eye_lift, look_lift, fov in VIEWS:
            at = head.get_world_location()
            rad = face + math.radians(bearing)
            eye = unreal.Vector(at.x + math.cos(rad) * dist, at.y + math.sin(rad) * dist, at.z + eye_lift)
            L.pose_camera(world, eye, unreal.Vector(at.x, at.y, at.z + look_lift), fov)
            yield 1.3
            path = os.path.join(ROOT, "%s_%s_%s.jpg" % (TAG, hour_name, name))
            H.capture_viewport_jpeg(path, 1900, 95)
            shots.append(os.path.basename(path))
    RESULT["shots"] = shots
    for other in hidden:
        try:
            other.set_actor_hidden_in_game(False)
        except Exception:
            pass
    L.release_camera(world)
    dog = dog_of()
    dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
    if persisted:
        ui.wear_relay_skin(persisted)
        yield 1.5
    RESULT["restored_skin"] = persisted
    RESULT["status"] = "captured"
