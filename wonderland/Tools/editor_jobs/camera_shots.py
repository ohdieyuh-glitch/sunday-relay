# PIE job: authored-world captures from named world cameras, for before/after comparison.
# Globals the copy step may prepend: CAMERAS (list of CameraActor labels), TAG (file-name tag),
# HIDE_PAWN (default True), SETTLE (seconds per camera, default 2.5).
import os

CAMERAS = globals().get("CAMERAS", ["HeroCam_GoldenArrivalBible", "PlayerCam01", "PathCam02", "ReverseCam03"])
# Ad-hoc poses as (name, x, y, z, pitch, yaw, fov): a PIE copy of SkylineCam06 is moved to each.
POSES = globals().get("POSES", [])
TAG = globals().get("TAG", "shot")
HIDE_PAWN = globals().get("HIDE_PAWN", True)
SETTLE = globals().get("SETTLE", 2.5)
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "passes")


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 4.0
    world = ues.get_game_world()
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    if HIDE_PAWN:
        unreal.GameplayStatics.get_player_pawn(world, 0).set_actor_hidden_in_game(True)
    for hud in unreal.ObjectIterator(unreal.WonderlandUsageHudWidget):
        if hud.get_world() == world:
            hud.set_visibility(unreal.SlateVisibility.HIDDEN)
    cams = {a.get_actor_label(): a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor)}
    shots = []
    for name in CAMERAS:
        cam = cams.get(name)
        if cam is None:
            shots.append({"camera": name, "missing": True})
            continue
        pc.set_view_target_with_blend(cam, 0.0)
        yield SETTLE
        path = os.path.join(SHOTS, "%s__%s.png" % (name, TAG))
        ok = unreal.WonderlandUiTestLibrary.capture_game_viewport(path)
        shots.append({"camera": name, "path": path, "ok": bool(ok)})
    if POSES:
        rover = cams["SkylineCam06"]
        comp = rover.get_editor_property("camera_component")
        comp.set_editor_property("constrain_aspect_ratio", False)
        for (name, x, y, z, pitch, yaw, fov) in POSES:
            rover.set_actor_location_and_rotation(unreal.Vector(x, y, z), unreal.Rotator(roll=0.0, pitch=pitch, yaw=yaw), False, True)
            comp.set_editor_property("field_of_view", fov)
            pc.set_view_target_with_blend(rover, 0.0)
            yield SETTLE
            path = os.path.join(SHOTS, "%s__%s.png" % (name, TAG))
            ok = unreal.WonderlandUiTestLibrary.capture_game_viewport(path)
            shots.append({"camera": name, "path": path, "ok": bool(ok)})
    f0 = unreal.SystemLibrary.get_frame_count()
    import time
    t0 = time.time()
    yield 2.0
    RESULT["fps_last_camera"] = round((unreal.SystemLibrary.get_frame_count() - f0) / (time.time() - t0), 1)
    RESULT["shots"] = shots
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"
