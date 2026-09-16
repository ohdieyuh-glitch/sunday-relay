# PIE job: hold VERIFYING and photograph the beam from the angles that matter, with my own camera.
#
# WHY A SWEEP AND NOT ANOTHER JOINT RUN. The beam has been diagnosed wrong four times -- too thin, wrong camera,
# occluded by the Jhinn, wrong colour -- and every one of those looked like evidence at the time. A counter that
# says VISIBLE while the frame shows a navy slab has already misled us both. So this makes the FRAMES the judge:
# one PIE session, the beat held, the camera swept across and along the beam, and a human look at the result.
#
# ACROSS AND ALONG, deliberately. The play camera stands behind a Dog that is facing the contract, so it sees the
# beam end-on, which is the hardest case and the one that has been failing. Seeing it side-on too separates "the
# beam is wrong" from "the beam cannot be seen from there".
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "beam")
WIDTH, HEIGHT = 1500, 850
EV100 = globals().get("EV100", 13.5)
FOV = globals().get("FOV", 58.0)
# (label, degrees off the Dog->contract line, distance from the midpoint, height above the Dog)
ANGLES = globals().get("ANGLES", [
    ("across", 90.0, 620.0, 210.0),
    ("across_low", 90.0, 520.0, 90.0),
    ("quarter", 135.0, 640.0, 230.0),
    ("behind", 178.0, 700.0, 240.0),      # the play camera's own case: almost straight down the barrel
    ("above", 90.0, 560.0, 620.0),
])


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    RESULT["shots"] = []

    yield (lambda: ues.get_game_world() is None, 1800)
    editor_world = ues.get_editor_world()
    rt = unreal.RenderingLibrary.create_render_target2d(editor_world, WIDTH, HEIGHT,
                                                        unreal.TextureRenderTargetFormat.RTF_RGBA8_SRGB)
    rig = eas.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector(0.0, 0.0, 500.0), unreal.Rotator(0.0, 0.0, 0.0))
    rig.set_actor_label("WL_BeamRig")

    def dress(comp):
        comp.set_editor_property("texture_target", rt)
        comp.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
        comp.set_editor_property("fov_angle", FOV)
        pp = comp.get_editor_property("post_process_settings")
        for prop, value in (("override_auto_exposure_method", True),
                            ("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL),
                            ("override_auto_exposure_apply_physical_camera_exposure", True),
                            ("auto_exposure_apply_physical_camera_exposure", False),
                            ("override_auto_exposure_bias", True),
                            ("auto_exposure_bias", -EV100)):
            pp.set_editor_property(prop, value)
        comp.set_editor_property("post_process_settings", pp)
        comp.set_editor_property("post_process_blend_weight", 1.0)

    dress(rig.capture_component2d)
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
        dress(play_rig.capture_component2d)

        # A real mission, so a real contract is manifested and anchored, then the beat is HELD at verifying.
        run("wl.Mission.Run full_lifecycle")
        yield 3.0
        run("wl.Mission.Beat verifying")
        yield 2.5

        orb = actor_like("MissionOrb")
        if orb is None:
            RESULT["status"] = "error"
            RESULT["error"] = "no Mission Contract manifested"
            return

        import math
        for (label, off_deg, dist, up) in ANGLES:
            # HOLD IT PROPERLY. The fixture keeps stepping underneath, and at 1.2 s between the command and
            # the shutter it had already moved on -- which is why the first sweep caught the beam in one
            # frame of five and looked like an intermittent beam rather than an intermittent BEAT. Stop the
            # fixture, then set the beat, then shoot immediately.
            run("wl.Mission.Stop")
            run("wl.Mission.Beat verifying")
            yield 0.9
            d = dog.get_actor_location()
            o = orb.get_actor_location()
            mid = unreal.Vector((d.x + o.x) * 0.5, (d.y + o.y) * 0.5, (d.z + o.z) * 0.5 + 20.0)
            axis = unreal.MathLibrary.find_look_at_rotation(d, o).yaw
            th = math.radians(axis + off_deg)
            eye = unreal.Vector(mid.x + math.cos(th) * dist, mid.y + math.sin(th) * dist, d.z + up)
            play_rig.set_actor_location_and_rotation(eye, unreal.MathLibrary.find_look_at_rotation(eye, mid), False, False)
            play_rig.capture_component2d.call_method("CaptureScene")
            name = "beam_%s.png" % label
            unreal.RenderingLibrary.export_render_target(world, rt, SHOTS, name)
            path = os.path.join(SHOTS, name)
            RESULT["shots"].append({"angle": label, "off_deg": off_deg,
                                    "range_uu": round(math.hypot(o.x - d.x, o.y - d.y), 1),
                                    "shot": path if os.path.exists(path) else None})
            unreal.log_warning("WLBEAM %s off=%s" % (label, off_deg))

        run("wl.Mission.Stop")
        yield 1.5
    finally:
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 120)
        try:
            eas.destroy_actor(rig)
        except Exception as exc:
            unreal.log_warning("WLBEAM could not remove the rig: %s" % exc)
    RESULT["status"] = "done"
