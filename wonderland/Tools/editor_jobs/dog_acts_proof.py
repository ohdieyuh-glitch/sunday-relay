# PIE job: photograph the Relay Dog's four mission performances, one at a time.
#
# WHY THIS EXISTS SEPARATELY FROM THE MISSION PROOF. The body and the meaning are built by two sessions. This job
# drives the BODY alone through `wl.Dog.Act`, so a wrong pose is told apart from a wrong beat->act mapping: if the
# float looks like meditation here, it is my arithmetic; if it looks right here and wrong under
# `wl.Mission.Run full_lifecycle`, it is the mapping.
#
# A REAL CONTRACT, NEVER A FAKE ONE. The orbit, the facing and the beam all need somewhere to point, so the job
# starts an actual mission run to manifest and anchor a real Mission Contract and then poses the Dog against it.
# It does not spawn a stand-in: a contract that existed because a capture wanted one would be exactly the thing
# the founder's canon forbids.
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "dogacts")
ACTS = globals().get("ACTS", ["none", "float", "book", "paint", "beam"])
SETTLE = globals().get("SETTLE", 2.6)
# Where the camera stands to watch, relative to the Dog: back, right and a little up, so the contract (which anchors
# forward and right of the Dog) is in frame with it rather than behind the camera.
CAM_BACK = globals().get("CAM_BACK", 620.0)
CAM_RIGHT = globals().get("CAM_RIGHT", 430.0)
CAM_UP = globals().get("CAM_UP", 250.0)


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["shots"] = []
    RESULT["acts"] = []

    # Never start a second PIE under the founder's.
    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    try:
        yield (lambda: ues.get_game_world() is not None, 240)
        world = ues.get_game_world()
        yield (lambda: unreal.GameplayStatics.get_player_pawn(world, 0) is not None, 120)
        yield 2.0

        def run(cmd):
            unreal.SystemLibrary.execute_console_command(world, cmd)

        # A real mission, so a real contract is manifested and anchored.
        run("wl.Mission.Run full_lifecycle")
        yield 3.0

        def find_dog():
            for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
                if "RelayDog" in a.get_class().get_name():
                    return a
            return None

        def find_contract():
            for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
                if "MissionOrb" in a.get_class().get_name():
                    return a
            return None

        for act in ACTS:
            run("wl.Dog.Act %s" % act)
            yield SETTLE
            dog = find_dog()
            orb = find_contract()
            row = {"act": act, "dog": None, "contract": None}
            if dog is not None:
                d = dog.get_actor_location()
                row["dog"] = [round(d.x, 1), round(d.y, 1), round(d.z, 1)]
                # Put the camera where it can see both.
                yaw = dog.get_actor_rotation().yaw
                fwd = unreal.Rotator(0.0, yaw, 0.0).get_forward_vector()
                right = unreal.Rotator(0.0, yaw, 0.0).get_right_vector()
                eye = unreal.Vector(d.x - fwd.x * CAM_BACK + right.x * CAM_RIGHT,
                                    d.y - fwd.y * CAM_BACK + right.y * CAM_RIGHT,
                                    d.z + CAM_UP)
                look = unreal.Vector(d.x, d.y, d.z + 40.0)
                pc = unreal.GameplayStatics.get_player_controller(world, 0)
                if pc is not None:
                    face = unreal.MathLibrary.find_look_at_rotation(eye, look)
                    pc.set_control_rotation(face)
            if orb is not None:
                o = orb.get_actor_location()
                row["contract"] = [round(o.x, 1), round(o.y, 1), round(o.z, 1)]
                if row["dog"] is not None:
                    row["range_uu"] = round(((o.x - row["dog"][0]) ** 2 + (o.y - row["dog"][1]) ** 2) ** 0.5, 1)
            path = os.path.join(SHOTS, "dogact_%s.png" % act)
            ok = L.capture_game_viewport(path)
            good = ok is True or (isinstance(ok, tuple) and ok and ok[0])
            row["shot"] = path if good else None
            RESULT["shots"].append(row["shot"])
            RESULT["acts"].append(row)
            unreal.log_warning("WLDOGACT %s dog=%s contract=%s shot=%s" % (act, row["dog"], row["contract"], bool(good)))

        run("wl.Mission.Stop")
        yield 1.0
    finally:
        # ALWAYS end play, even on an exception: a job that leaves PIE running blocks every job behind it.
        les.editor_request_end_play()
    RESULT["status"] = "done"
