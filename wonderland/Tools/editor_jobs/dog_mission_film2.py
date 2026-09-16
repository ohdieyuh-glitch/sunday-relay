# PIE job: film one continuous mission with a CAMERA THIS JOB OWNS.
#
#   none -> mission_start -> planning -> implementing -> verifying -> complete, handoff injected mid-implementation.
#
# WHY NOT THE PLAY CAMERA. Three passes were lost to it. It hangs on a spring arm meant for playing: with its
# collision test on it collapses onto the Dog's own shoulder whenever the orbit passes a wall, and with it off the
# camera sinks through the ground and photographs flat teal. Aiming the arm directly fixed some frames and not
# others. A film needs a camera that is not attached to the subject at all.
#
# HOW THIS ONE WORKS. PIE DUPLICATES THE EDITOR WORLD, so a SceneCapture2D placed in the level BEFORE play starts
# exists inside the running game. The job places one, finds its copy in PIE, flies it frame by frame, and reads its
# render target to PNG -- the same path offscreen_shots.py uses for the world, now pointed at a running mission.
# Nothing is attached to the Dog and nothing touches the player's camera, so what the founder plays is unchanged.
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "dogfilm2")
FIXTURE = globals().get("FIXTURE", "full_lifecycle")
SAMPLES = globals().get("SAMPLES", 24)
EVERY = globals().get("EVERY", 1.5)
WIDTH, HEIGHT = 1600, 900
# The crane: how far back along the contract->dog line, how far to the side, how high above the Dog's feet.
BACK = globals().get("BACK", 300.0)
SIDE = globals().get("SIDE", 330.0)
UP = globals().get("UP", 210.0)
EV100 = globals().get("EV100", 13.5)
# Tighter than a scene shot: the subject is a POSE, so the Dog has to fill the frame, not the plaza.
FOV = globals().get("FOV", 42.0)


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    RESULT["frames"] = []

    yield (lambda: ues.get_game_world() is None, 1800)

    # Placed in the EDITOR world, NOT transient, so play duplicates it into the game.
    editor_world = ues.get_editor_world()
    rt = unreal.RenderingLibrary.create_render_target2d(editor_world, WIDTH, HEIGHT,
                                                        unreal.TextureRenderTargetFormat.RTF_RGBA8_SRGB)
    rig = eas.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector(0.0, 0.0, 500.0), unreal.Rotator(0.0, 0.0, 0.0))
    rig.set_actor_label("WL_DogFilmRig")
    comp = rig.capture_component2d
    comp.set_editor_property("texture_target", rt)
    comp.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
    comp.set_editor_property("fov_angle", FOV)
    pp = comp.get_editor_property("post_process_settings")
    # THE EXACT SET offscreen_shots.py proved. Manual exposure or a histogram has nothing to settle on in one
    # frame and the shot comes out white; and the physical camera exposure MUST be turned off as well, or the
    # bias lands on top of it and every frame is black. Leaving that one line out cost a whole PIE pass.
    for prop, value in (("override_auto_exposure_method", True),
                        ("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL),
                        ("override_auto_exposure_apply_physical_camera_exposure", True),
                        ("auto_exposure_apply_physical_camera_exposure", False),
                        ("override_auto_exposure_bias", True),
                        ("auto_exposure_bias", -EV100)):
        pp.set_editor_property(prop, value)
    comp.set_editor_property("post_process_settings", pp)
    comp.set_editor_property("post_process_blend_weight", 1.0)

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
        play_rig = None
        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.SceneCapture2D):
            play_rig = a
        if dog is None or play_rig is None:
            RESULT["status"] = "error"
            RESULT["error"] = "dog=%s rig=%s" % (dog is not None, play_rig is not None)
            return
        play_comp = play_rig.capture_component2d
        play_comp.set_editor_property("texture_target", rt)
        play_comp.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
        play_comp.set_editor_property("fov_angle", FOV)
        ppp = play_comp.get_editor_property("post_process_settings")
        for prop, value in (("override_auto_exposure_method", True),
                            ("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL),
                            ("override_auto_exposure_apply_physical_camera_exposure", True),
                            ("auto_exposure_apply_physical_camera_exposure", False),
                            ("override_auto_exposure_bias", True),
                            ("auto_exposure_bias", -EV100)):
            ppp.set_editor_property(prop, value)
        play_comp.set_editor_property("post_process_settings", ppp)
        play_comp.set_editor_property("post_process_blend_weight", 1.0)

        run("wl.Mission.Run %s" % FIXTURE)
        handoff_at = int(SAMPLES * 0.55)

        for i in range(SAMPLES):
            yield EVERY
            orb = actor_like("MissionOrb")
            d = dog.get_actor_location()
            row = {"i": i, "t": round(i * EVERY, 1), "dog": [round(d.x, 1), round(d.y, 1), round(d.z, 1)]}
            # Look at the point between the Dog and the contract, from off to one side and above.
            target = d
            if orb is not None:
                o = orb.get_actor_location()
                row["contract"] = [round(o.x, 1), round(o.y, 1), round(o.z, 1)]
                row["range_uu"] = round(((o.x - d.x) ** 2 + (o.y - d.y) ** 2) ** 0.5, 1)
                target = unreal.Vector(d.x * 0.68 + o.x * 0.32, d.y * 0.68 + o.y * 0.32, d.z + 70.0)
                axis = unreal.MathLibrary.find_look_at_rotation(o, d)
                fwd = unreal.Rotator(0.0, axis.yaw, 0.0).get_forward_vector()
                right = unreal.Rotator(0.0, axis.yaw, 0.0).get_right_vector()
                eye = unreal.Vector(d.x + fwd.x * BACK + right.x * SIDE,
                                    d.y + fwd.y * BACK + right.y * SIDE,
                                    d.z + UP)
            else:
                eye = unreal.Vector(d.x - 520.0, d.y + 470.0, d.z + 330.0)
            play_rig.set_actor_location_and_rotation(eye, unreal.MathLibrary.find_look_at_rotation(eye, target), False, False)
            if i == handoff_at:
                run("wl.Mission.Beat handoff")
                row["injected"] = "handoff"
            play_comp.call_method("CaptureScene")
            path = os.path.join(SHOTS, "m_%02d.png" % i)
            unreal.RenderingLibrary.export_render_target(world, rt, SHOTS, "m_%02d.png" % i)
            row["shot"] = path if os.path.exists(path) else None
            RESULT["frames"].append(row)
            unreal.log_warning("WLDOGFILM2 %s" % row)

        run("wl.Mission.Stop")
        yield 2.0
    finally:
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 120)
        # The rig is a capture tool, not world content: it never survives the job that placed it.
        try:
            eas.destroy_actor(rig)
        except Exception as exc:
            unreal.log_warning("WLDOGFILM2 could not remove the rig: %s" % exc)
    RESULT["status"] = "done"
