# PIE job: TUNE THE READING POSE BY EYE, without a rebuild.
#
# The reading pose's numbers are console variables (wl.Dog.Read.*, RelayDogCharacter.cpp). This sets the ones given
# in SETTINGS, puts the Dog in the reading stage beside a Mission Contract, slows the world, and photographs one page
# turn from three places -- the Dog's right side up close, its front, and the play camera's distance -- recording
# where the Dog is on screen so the frames can be cropped to it. Nothing is asserted: this job exists to be looked at.
#
#   SETTINGS = {"wl.Dog.Read.BookFwd": 30, ...}   TAG = "try1"
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
SETTINGS = globals().get("SETTINGS") or {}
TAG = globals().get("TAG") or "base"
SLOMO = float(globals().get("SLOMO") or 0.2)
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "read_tune", TAG)
VIEW_W, VIEW_H = 1903.0, 927.0


def job():
    os.makedirs(SHOTS, exist_ok=True)
    for old in os.listdir(SHOTS):
        if old.endswith(".jpg"):
            os.remove(os.path.join(SHOTS, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    RESULT["settings"] = SETTINGS
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
        L.focus_game_viewport()
        for cmd in ("t.MaxFPS 0", "Slate.bAllowThrottling 0", "r.VSync 0"):
            unreal.SystemLibrary.execute_console_command(world, cmd)
        for name, value in SETTINGS.items():
            unreal.SystemLibrary.execute_console_command(world, "%s %s" % (name, value))
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        arm_was = float(boom.target_arm_length) if boom is not None else None

        mission.stop_fixture()
        # JOINED, so the companions circle the Contract instead of following at the Dog's shoulders, where they stand
        # exactly between a side camera and the book.
        mission.set_joined_in(True, True)
        mission.set_beat_by_id("researching")
        yield 2.5
        unreal.SystemLibrary.execute_console_command(world, "slomo %.3f" % SLOMO)

        hz = float(SETTINGS.get("wl.Dog.Read.TurnHz", 0.32))
        frames = []

        def screen(at):
            try:
                got = unreal.GameplayStatics.project_world_to_screen(controller, at, False)
                if isinstance(got, tuple):
                    got = got[1] if len(got) > 1 else got[0]
                return [round(float(got.x) / VIEW_W, 4), round(float(got.y) / VIEW_H, 4)]
            except Exception:
                return None

        # One view at a time, each through one whole turn cycle, eight frames a cycle.
        # CLOSE VIEWS LOOK AT THE CHEST: the game rig's socket offset lifts the camera 135 uu over the Dog's head, which
        # at a close arm put the book below the frame. Bearings are where the CAMERA stands, relative to the Dog's
        # facing; the companions follow behind, so front and front-quarter views keep them out of the way.
        socket_was = boom.socket_offset if boom is not None else None
        for view, bearing, pitch, arm, socket in (("side_right", 90.0, -14.0, 210.0, (0.0, 0.0, 10.0)),
                                                  ("front_right", 50.0, -16.0, 200.0, (0.0, 0.0, 10.0)),
                                                  ("front", 0.0, -16.0, 200.0, (0.0, 0.0, 10.0)),
                                                  ("side_left", -90.0, -14.0, 210.0, (0.0, 0.0, 10.0))):
            dyaw = bearing + 180.0
            if boom is not None:
                boom.set_editor_property("target_arm_length", arm)
                boom.set_editor_property("socket_offset", unreal.Vector(*socket) if socket is not None else socket_was)
            # Start the view just before a turn begins.
            yield (lambda: (float(unreal.GameplayStatics.get_time_seconds(world)) * hz) % 1.0 > 0.9, 60)
            # Sixteen frames across the turn and a little either side of it: cycle 0.9 round to 0.45. The waits are
            # real seconds, and the world runs at SLOMO.
            wait = (0.55 / max(hz, 0.05) / SLOMO) / 12.0
            for step in range(12):
                yaw = pawn.get_actor_rotation().yaw + dyaw
                controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=pitch, yaw=yaw))
                yield wait
                t = float(unreal.GameplayStatics.get_time_seconds(world))
                path = os.path.join(SHOTS, "%s_%02d.jpg" % (view, step))
                ok = H.capture_viewport_jpeg(path, 1280, 90)
                frames.append({"view": view, "step": step, "t": round(t, 3), "cycle": round((t * hz) % 1.0, 3),
                               "ok": bool(ok), "path": path,
                               "dog_screen": screen(pawn.get_actor_location()),
                               "dog_head_screen": screen(pawn.get_actor_location() + unreal.Vector(0.0, 0.0, 90.0))})
        RESULT["frames"] = frames
        if boom is not None and arm_was is not None:
            boom.set_editor_property("target_arm_length", arm_was)
            boom.set_editor_property("socket_offset", socket_was)
        RESULT["status"] = "done"
    finally:
        try:
            if ues.get_game_world() is not None:
                unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "slomo 1")
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLREADTUNE could not end play: %s" % exc)
