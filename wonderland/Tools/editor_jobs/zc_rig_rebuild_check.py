# PIE probe: THE DOG SURVIVES THE EDITOR REBUILDING ITS JOINTS (42443f7e). A notified property write on the play pawn
# re-runs its construction; before the fix the book went to the capsule and the joints froze (zc_book_bisect). This makes
# that write on purpose while the Dog reads, then checks the book is back on a Body, the head keeps moving, and the log
# says "WLDOG rig rebuilt" once -- not every frame. It photographs the Dog before and after.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
QUIET = unreal.PropertyAccessChangeNotifyMode.NEVER
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "rig_rebuild")


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
        yield 4.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        mission = next(m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.get_world() == world)
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        L.focus_game_viewport()
        mission.stop_fixture()
        mission.set_beat_by_id("researching")
        yield 3.0

        def measure(tag, shoot=True):
            at = pawn.get_actor_location()
            by = {c.get_name(): c for c in pawn.get_components_by_class(unreal.SceneComponent)}
            root = by.get("MissionBookRoot_0")
            parent = root.get_attach_parent() if root else None
            row = {"step": tag,
                   "book_parent": parent.get_name() if parent else None,
                   "book_z": round(root.get_world_location().z - at.z, 1) if root else None,
                   "head_z": round(by["Pivot_head"].get_world_location().z - at.z, 2) if "Pivot_head" in by else None,
                   "arm_l_pitch": round(by["Pivot_armLeft"].get_editor_property("relative_rotation").pitch, 1) if "Pivot_armLeft" in by else None}
            if shoot:
                controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-8.0, yaw=pawn.get_actor_rotation().yaw))
                row["shot"] = os.path.join(SHOTS, "%s.jpg" % tag)
            steps.append(row)
            return row

        boom.set_editor_property("target_arm_length", 380.0, QUIET)
        boom.set_editor_property("socket_offset", unreal.Vector(0.0, 40.0, 60.0), QUIET)
        row = measure("before")
        yield 0.8
        H.capture_viewport_jpeg(row["shot"], 1600, 88)
        # THE WRITE THAT REBUILDS THE DOG: notified, and a changed value.
        boom.set_editor_property("socket_offset", unreal.Vector(0.0, 41.0, 60.0))
        yield 0.3
        measure("rebuilt_0_3s", False)
        yield 1.0
        measure("rebuilt_1_3s", False)
        yield 0.5
        measure("rebuilt_1_8s", False)
        yield 3.0
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        row = measure("rebuilt_4_8s")
        yield 0.8
        H.capture_viewport_jpeg(row["shot"], 1600, 88)
        # And a second rebuild: said once more, not once per frame.
        boom.set_editor_property("target_arm_length", 381.0)
        yield 2.0
        row = measure("rebuilt_twice")
        yield 0.8
        H.capture_viewport_jpeg(row["shot"], 1600, 88)
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLRIGCHECK could not end play: %s" % exc)
