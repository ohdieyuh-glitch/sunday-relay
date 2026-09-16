# PIE probe: THE BOOK'S HEIGHT, MEASURED AND PHOTOGRAPHED IN THE SAME MOMENT. Separate tuning runs disagreed with the
# measurements, so this sets each candidate wl.Dog.Read.BookUp inside one play session and, for each, records where the
# book, the hands and the head are against the capsule centre and photographs the Dog from the front quarter.
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "book_height")
HEIGHTS = globals().get("HEIGHTS") or [-13, -5, -25]


def vec(v):
    return [round(v.x, 1), round(v.y, 1), round(v.z, 1)]


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    rows = []
    RESULT["rows"] = rows
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
        mission = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()][0]
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        arm_was, socket_was = float(boom.target_arm_length), boom.socket_offset
        boom.set_editor_property("target_arm_length", 320.0, unreal.PropertyAccessChangeNotifyMode.NEVER)
        boom.set_editor_property("socket_offset", unreal.Vector(0.0, 0.0, 70.0), unreal.PropertyAccessChangeNotifyMode.NEVER)
        mission.stop_fixture()
        # Reading where it stands: the fixture is not running, so the Dog does not orbit away from the camera.
        mission.set_beat_by_id("researching")
        yield 2.0
        for height in HEIGHTS:
            unreal.SystemLibrary.execute_console_command(world, "wl.Dog.Read.BookUp %s" % height)
            controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-10.0, yaw=pawn.get_actor_rotation().yaw + 180.0 + 40.0))
            yield 1.2
            comps = {c.get_name(): c for c in pawn.get_components_by_class(unreal.SceneComponent)}
            at = pawn.get_actor_location()
            root = next((c for n, c in comps.items() if n.startswith("MissionBookRoot")), None)
            head = comps.get("Pivot_head")
            row = {"height": height,
                   "book_minus_head_z": round(root.get_world_location().z - head.get_world_location().z, 1) if root and head else None, "cvar": unreal.SystemLibrary.get_console_variable_float_value("wl.Dog.Read.BookUp"),
                   "book_root_z": round(root.get_world_location().z - at.z, 1) if root else None,
                   "head_z": round(comps["Pivot_head"].get_world_location().z - at.z, 1) if "Pivot_head" in comps else None,
                   "forearm_l_z": round(comps["Pivot_forearmLeft"].get_world_location().z - at.z, 1) if "Pivot_forearmLeft" in comps else None,
                   "shot": os.path.join(SHOTS, "book_up_%s.png" % str(height).replace("-", "m"))}
            L.capture_game_viewport(row["shot"])
            # And at the play camera's distance, the whole Dog.
            boom.set_editor_property("target_arm_length", 440.0, unreal.PropertyAccessChangeNotifyMode.NEVER)
            boom.set_editor_property("socket_offset", socket_was, unreal.PropertyAccessChangeNotifyMode.NEVER)
            controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-14.0, yaw=pawn.get_actor_rotation().yaw + 180.0 + 60.0))
            yield 1.0
            row["play_shot"] = row["shot"].replace(".png", "_play.png")
            L.capture_game_viewport(row["play_shot"])
            boom.set_editor_property("target_arm_length", 320.0, unreal.PropertyAccessChangeNotifyMode.NEVER)
            boom.set_editor_property("socket_offset", unreal.Vector(0.0, 0.0, 70.0), unreal.PropertyAccessChangeNotifyMode.NEVER)
            rows.append(row)
        boom.set_editor_property("target_arm_length", arm_was, unreal.PropertyAccessChangeNotifyMode.NEVER)
        boom.set_editor_property("socket_offset", socket_was, unreal.PropertyAccessChangeNotifyMode.NEVER)
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLBOOKHEIGHT could not end play: %s" % exc)
