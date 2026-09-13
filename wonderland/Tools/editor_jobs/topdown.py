# PIE job: orthographic top-down plans of the corridor, for placement planning.
# A PIE copy of an existing camera is repositioned; nothing in the editor world changes.
import os

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "topdown")
TAG = globals().get("PASS_TAG", "baseline")
# (name, centre x, centre y, ortho width). Camera yaw 0: screen right = +Y (toward the castle), screen up = +X.
PLANS = [("arrival_path", 0.0, 2500.0, 9500.0), ("castle_approach", 0.0, 11500.0, 9500.0), ("arrival_close", 0.0, 1200.0, 4200.0)]


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
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    pawn.set_actor_hidden_in_game(True)
    for hud in unreal.ObjectIterator(unreal.WonderlandUsageHudWidget):
        if hud.get_world() == world:
            hud.set_visibility(unreal.SlateVisibility.HIDDEN)
    cam = next(a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor) if a.get_actor_label() == "SkylineCam06")
    comp = cam.get_editor_property("camera_component")
    comp.set_editor_property("constrain_aspect_ratio", False)
    comp.set_editor_property("projection_mode", unreal.CameraProjectionMode.ORTHOGRAPHIC)
    shots = []
    for (name, cx, cy, width) in PLANS:
        comp.set_editor_property("ortho_width", width)
        cam.set_actor_location_and_rotation(unreal.Vector(cx, cy, 30000.0), unreal.Rotator(roll=0.0, pitch=-90.0, yaw=0.0), False, True)
        pc.set_view_target_with_blend(cam, 0.0)
        yield 3.0
        path = os.path.join(SHOTS, "%s__%s.png" % (name, TAG))
        ok = unreal.WonderlandUiTestLibrary.capture_game_viewport(path)
        size = None
        if isinstance(ok, tuple):
            size = [ok[1], ok[2]] if len(ok) >= 3 else None
        shots.append({"plan": name, "centre": [cx, cy], "ortho_width": width, "path": path, "result": str(ok)})
        emit(name, str(ok))
    RESULT["shots"] = shots
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"
