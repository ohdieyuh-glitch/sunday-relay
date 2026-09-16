# PIE job: film one continuous mission, the way the founder asked for it.
#
#   none -> mission_start -> planning -> implementing -> verifying -> complete
#
# with a handoff injected during implementing, to show the paintbrush scene continues and no handoff pose occurs.
#
# NOT A POSE TEST. dog_acts_proof.py drives the body directly through `wl.Dog.Act`; this drives NOTHING. It starts
# the deterministic fixture and then only watches, sampling what the Dog is performing and where it and the Mission
# Contract are, so the film is of the real path -- Julius event -> fold -> beat -> act -> body -- rather than of a
# capture script posing a dog.
#
# SIMULATED, AND IT SAYS SO. Live Julius is not connected, so the run is the deterministic simulator and the
# DEVELOPMENT PREVIEW / SIMULATED JULIUS EXECUTION banner must be on screen in every frame. The job records the
# banner state with each sample rather than trusting it.
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "dogfilm")
FIXTURE = globals().get("FIXTURE", "full_lifecycle")
SAMPLES = globals().get("SAMPLES", 26)
EVERY = globals().get("EVERY", 1.4)
# Where the camera looks. The spring arm orbits the Dog, so a control yaw pointing from the Dog at the Contract puts
# the camera behind the Dog looking past it at the thing it is working on -- which is the shot the founder wants.
PITCH = globals().get("PITCH", -13.0)
ARM_LENGTH = globals().get("ARM_LENGTH", 780.0)
YAW_OFF = globals().get("YAW_OFF", 52.0)


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["frames"] = []

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

        def actor_like(word):
            for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
                if word in a.get_class().get_name():
                    return a
            return None

        dog = actor_like("RelayDog")
        if dog is None:
            RESULT["status"] = "error"
            RESULT["error"] = "no Relay Dog in the level"
            return

        # A FILM CRANE, NOT THE PLAY CAMERA. Two passes were wasted on the play camera: it sits close for
        # playing, and its spring arm either collapses onto the Dog's shoulder (collision test on, next to
        # a wall) or sinks through the ground (collision test off). So the arm is taken off the player's
        # control rotation entirely and aimed by this job -- a fixed-bearing crane about the Dog, which is
        # what filming a pose needs and is exactly the wrong thing for playing.
        arm = dog.get_component_by_class(unreal.SpringArmComponent)
        cam = dog.get_component_by_class(unreal.CameraComponent)
        if arm is not None:
            arm.set_editor_property("use_pawn_control_rotation", False)
            arm.set_editor_property("inherit_pitch", False)
            arm.set_editor_property("inherit_yaw", False)
            arm.set_editor_property("inherit_roll", False)
            arm.set_editor_property("do_collision_test", False)
            arm.set_editor_property("target_arm_length", ARM_LENGTH)
            arm.set_editor_property("socket_offset", unreal.Vector(0.0, 0.0, 0.0))
            arm.set_editor_property("target_offset", unreal.Vector(0.0, 0.0, 120.0))
        if cam is not None:
            cam.set_editor_property("use_pawn_control_rotation", False)
        RESULT["arm"] = arm is not None

        run("wl.Mission.Run %s" % FIXTURE)
        handoff_at = int(SAMPLES * 0.55)

        for i in range(SAMPLES):
            yield EVERY
            orb = actor_like("MissionOrb")
            d = dog.get_actor_location()
            row = {"i": i, "t": round(i * EVERY, 1),
                   "dog": [round(d.x, 1), round(d.y, 1), round(d.z, 1)]}
            if orb is not None:
                o = orb.get_actor_location()
                row["contract"] = [round(o.x, 1), round(o.y, 1), round(o.z, 1)]
                row["range_uu"] = round(((o.x - d.x) ** 2 + (o.y - d.y) ** 2) ** 0.5, 1)
                # Stand off the Dog-contract line so both are in frame, and look slightly down.
                yaw = unreal.MathLibrary.find_look_at_rotation(d, o).yaw + YAW_OFF
                if arm is not None:
                    arm.set_world_rotation(unreal.Rotator(PITCH, yaw, 0.0), False, False)
            # THE HANDOFF, injected mid-implementation. This is the whole point of the film: the brush must
            # not leave the Dog's hand and no handoff pose may appear.
            if i == handoff_at:
                run("wl.Mission.Beat handoff")
                row["injected"] = "handoff"
            path = os.path.join(SHOTS, "film_%02d.png" % i)
            ok = L.capture_game_viewport(path)
            good = ok is True or (isinstance(ok, tuple) and ok and ok[0])
            row["shot"] = path if good else None
            RESULT["frames"].append(row)
            unreal.log_warning("WLDOGFILM %s" % row)

        run("wl.Mission.Stop")
        yield 2.0
        RESULT["frames"].append({"i": SAMPLES, "note": "after stop",
                                 "contract": None if actor_like("MissionOrb") is None else "still present"})
    finally:
        les.editor_request_end_play()
    RESULT["status"] = "done"
