# PIE probe: A FILM CAMERA THAT SHOWS THE RESEARCH. Filmed from high behind the Dog, its own head hid the open book and
# the turning page, the Dog sat on the Julius terminal's top edge and the companions left the top of the frame. This plays
# Scenario D through the founder's path, slows the world during research, and photographs the Dog from a few framings
# -- arm, socket height, pitch, and how far round from behind the camera swings -- each three times as the Dog walks on.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
QUIET = unreal.PropertyAccessChangeNotifyMode.NEVER
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "camera_test")
WAIT_BEAT = globals().get("WAIT_BEAT") or "researching"
PLAN = globals().get("PLAN")
# (tag, arm, socket y, socket z, pitch, yaw offset from behind the Dog toward the Contract)
FRAMINGS = globals().get("FRAMINGS") or [
    ("now", 440.0, 55.0, 135.0, -14.0, 0.0),
    ("low_behind", 380.0, 40.0, 60.0, -8.0, 0.0),
    ("low_q35", 360.0, 40.0, 60.0, -6.0, 35.0),
    ("low_q55", 320.0, 30.0, 50.0, -6.0, 55.0),
    ("wide_q25", 460.0, 0.0, 40.0, -4.0, 25.0),
    ("low_qm40", 340.0, -40.0, 55.0, -8.0, -40.0),
]


def job():
    os.makedirs(SHOTS, exist_ok=True)
    for old in os.listdir(SHOTS):
        os.remove(os.path.join(SHOTS, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    shots = []
    RESULT["shots"] = shots
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
        ui = next(u for u in unreal.ObjectIterator(unreal.WonderlandUiSubsystem) if u.get_world() == world)
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        L.focus_game_viewport()
        unreal.SystemLibrary.execute_console_command(world, "wl.Mission.Site castle_approach")
        mission.play_scenario("D", 10.0)
        yield (lambda: mission.is_fixture_running(), 180)
        if not ui.is_live_terminal_open():
            ui.toggle_live_terminal()
        # PLAN: [(beat to wait for, [(tag, arm, socket y, socket z, pitch, yaw offset, [console commands]), ...]), ...]
        plan = PLAN or [(WAIT_BEAT, [tuple(f) + ([],) for f in FRAMINGS])]
        for beat, framings in plan:
            unreal.SystemLibrary.execute_console_command(world, "slomo 1")
            yield (lambda: str(mission.get_beat_id()) == beat, 400)
            yield 3.0
            unreal.SystemLibrary.execute_console_command(world, "slomo 0.2")
            for tag, arm, sy, sz, pitch, offset, commands in framings:
                for command in commands:
                    unreal.SystemLibrary.execute_console_command(world, command)
                boom.set_editor_property("target_arm_length", arm, QUIET)
                boom.set_editor_property("socket_offset", unreal.Vector(0.0, sy, sz), QUIET)
                for n in range(3):
                    dog_at = pawn.get_actor_location()
                    orb_at = mission.get_orb_location()
                    mid = unreal.Vector((dog_at.x + orb_at.x) * 0.5, (dog_at.y + orb_at.y) * 0.5, dog_at.z)
                    yaw = unreal.MathLibrary.find_look_at_rotation(dog_at, mid).yaw + offset
                    controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=pitch, yaw=yaw))
                    yield 0.6
                    path = os.path.join(SHOTS, "%s_%d.jpg" % (tag, n))
                    ok = H.capture_viewport_jpeg(path, 1600, 88)
                    leaf = next((c for c in pawn.get_components_by_class(unreal.SceneComponent)
                                 if c.get_name().startswith("MissionBookTurningPage")), None)
                    shots.append({"tag": tag, "n": n, "ok": bool(ok), "beat": str(mission.get_beat_id()),
                                  "turning": bool(leaf.is_visible()) if leaf else None})
                    yield 1.2
        unreal.SystemLibrary.execute_console_command(world, "slomo 1")
        RESULT["status"] = "done"
    finally:
        try:
            unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "slomo 1")
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLCAMTEST could not end play: %s" % exc)
