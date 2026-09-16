# PIE probe: A CAMERA WRITE WITHOUT NOTIFICATION LEAVES THE DOG WHOLE. zc_book_bisect showed a notified socket_offset write
# re-parenting the book to the capsule and freezing the joints. This makes the same writes with
# PropertyAccessChangeNotifyMode.NEVER and checks the camera really moved, the book stays on the Body and the joints move.
import os

L = unreal.WonderlandUiTestLibrary
QUIET = unreal.PropertyAccessChangeNotifyMode.NEVER
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "quiet_check")


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    steps = []
    RESULT["steps"] = steps
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        mission = next(m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.get_world() == world)
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        cam = pawn.get_component_by_class(unreal.CameraComponent)
        mission.stop_fixture()
        mission.set_beat_by_id("researching")
        yield 3.0

        def measure(tag):
            at = pawn.get_actor_location()
            by = {c.get_name(): c for c in pawn.get_components_by_class(unreal.SceneComponent)}
            root = by.get("MissionBookRoot_0")
            steps.append({"step": tag,
                          "camera_distance": round((cam.get_world_location() - at).length(), 1),
                          "book_parent": root.get_attach_parent().get_name() if root and root.get_attach_parent() else None,
                          "book_z": round(root.get_world_location().z - at.z, 1) if root else None,
                          "head_z": round(by["Pivot_head"].get_world_location().z - at.z, 2),
                          "arm_l_rot": str(by["Pivot_armLeft"].get_editor_property("relative_rotation"))})

        measure("reading")
        yield 0.5
        measure("reading_again")
        boom.set_editor_property("socket_offset", unreal.Vector(0.0, 0.0, 70.0), QUIET)
        boom.set_editor_property("target_arm_length", 320.0, QUIET)
        controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-10.0, yaw=pawn.get_actor_rotation().yaw + 230.0))
        yield 1.5
        measure("quiet_close")
        L.capture_game_viewport(os.path.join(SHOTS, "quiet_close.png"))
        yield 0.5
        measure("quiet_close_again")
        boom.set_editor_property("target_arm_length", 440.0, QUIET)
        boom.set_editor_property("socket_offset", unreal.Vector(0.0, 55.0, 135.0), QUIET)
        controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-14.0, yaw=pawn.get_actor_rotation().yaw + 220.0))
        yield 1.5
        measure("quiet_play")
        L.capture_game_viewport(os.path.join(SHOTS, "quiet_play.png"))
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLQUIET could not end play: %s" % exc)
