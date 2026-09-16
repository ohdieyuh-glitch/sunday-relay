import math

# WHERE THE BEAM ACTUALLY IS, as opposed to where its component says it is.
#
# J04 asserts the beam's endpoint lands on the crystal and it passes with a miss of 0.0 uu. The frames
# disagree with the feeling that gives: the rendered beam is a short pale bar sitting BESIDE the crystal at
# crystal height, with nothing joining it to the Dog forty feet below.
#
# Both can be true. J04 measures the COMPONENT -- world location, forward, X scale -- and the thing on
# screen is an INSTANCE inside that component, with its own transform. If the instance is not where the
# component is, every number can be right while the picture shows a floating bar.
#
# So this measures the rendered instance and nothing else, and says plainly how far its two ends are from
# the Dog and from the crystal. Thirty seconds, no fixture, no captures to read.
L = unreal.WonderlandUiTestLibrary


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)

    # PLAY, NOT SIMULATE. The first attempt used editor_play_simulate, which gives a pawn with none of the
    # Dog's components on it -- so the probe reported "no beam" about a beam that was plainly on screen.
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 4.0

    try:
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        live = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem)
                if m.is_mission_strip_on_screen()]
        mission = live[0] if live else None

        def angle_between(axis, to_at, from_at):
            """Angle, degrees, between a bar's axis and the line it is supposed to lie along."""
            dx = float(to_at.x) - float(from_at.x)
            dy = float(to_at.y) - float(from_at.y)
            dz = float(to_at.z) - float(from_at.z)
            span = (dx * dx + dy * dy + dz * dz) ** 0.5
            if span < 1.0:
                return None
            dot = (float(axis.x) * dx + float(axis.y) * dy + float(axis.z) * dz) / span
            deg = math.degrees(math.acos(max(-1.0, min(1.0, dot))))
            # The bar has no head or tail, so 170 degrees is 10 degrees of error, not 170.
            return round(min(deg, 180.0 - deg), 1)

        def near(a, b):
            return round(((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2) ** 0.5, 1)

        beam = None
        for c in pawn.get_components_by_class(unreal.SceneComponent):
            if c.get_name().startswith("VerificationBeam"):
                beam = c
                break
        RESULT["found_beam"] = beam is not None

        # Hold verification rather than chasing it through a fixture.
        mission.set_beat_by_id("mission_start")
        yield 0.5
        mission.set_beat_by_id("verifying")
        yield 1.6

        dog_at = pawn.get_actor_location()
        crystal_at = mission.get_orb_location()
        comp_at = beam.get_world_location()

        RESULT["dog"] = [round(dog_at.x, 1), round(dog_at.y, 1), round(dog_at.z, 1)]
        RESULT["crystal"] = [round(crystal_at.x, 1), round(crystal_at.y, 1), round(crystal_at.z, 1)]
        RESULT["dog_to_crystal_uu"] = near(dog_at, crystal_at)
        RESULT["component_at"] = [round(comp_at.x, 1), round(comp_at.y, 1), round(comp_at.z, 1)]
        RESULT["component_from_dog_uu"] = near(comp_at, dog_at)
        RESULT["component_from_crystal_uu"] = near(comp_at, crystal_at)

        # THE INSTANCES -- the only geometry the renderer actually draws.
        shown = []
        count = beam.get_instance_count() if hasattr(beam, "get_instance_count") else 0
        RESULT["instance_count"] = count
        for index in range(count):
            try:
                xf = beam.get_instance_transform(index, world_space=True)
            except Exception as exc:
                RESULT.setdefault("instance_error", str(exc))
                continue
            at = xf.translation
            scale = xf.scale3d
            rot = xf.rotation.rotator()
            # ALONG X, NOT Z. The first version of this probe assumed a Z-up cylinder and measured the ends
            # 8.9 uu apart, then reported that the beam does not reach either the Dog or the crystal -- a
            # defect that did not exist, in a lane that is not mine, which I came close to sending on.
            # The instance scale is [3.339, 0.178, 0.178]: the long axis is X.
            fwd = unreal.MathLibrary.get_forward_vector(rot)
            half = float(scale.x) * 50.0
            end_a = unreal.Vector(at.x + fwd.x * half, at.y + fwd.y * half, at.z + fwd.z * half)
            end_b = unreal.Vector(at.x - fwd.x * half, at.y - fwd.y * half, at.z - fwd.z * half)
            shown.append({
                "index": index,
                "at": [round(at.x, 1), round(at.y, 1), round(at.z, 1)],
                "scale": [round(scale.x, 3), round(scale.y, 3), round(scale.z, 3)],
            "length_uu": round(float(scale.x) * 100.0, 1),
            "thickness_uu": round(float(scale.y) * 100.0, 1),
                "centre_from_dog_uu": near(at, dog_at),
                "centre_from_crystal_uu": near(at, crystal_at),
                "centre_from_midpoint_uu": near(at, unreal.Vector(
                    (dog_at.x + crystal_at.x) * 0.5, (dog_at.y + crystal_at.y) * 0.5,
                    (dog_at.z + crystal_at.z) * 0.5)),
                "end_a_from_dog_uu": near(end_a, dog_at),
                "end_a_from_crystal_uu": near(end_a, crystal_at),
                "end_b_from_dog_uu": near(end_b, dog_at),
                "end_b_from_crystal_uu": near(end_b, crystal_at),
                "end_a": [round(end_a.x, 1), round(end_a.y, 1), round(end_a.z, 1)],
                "end_b": [round(end_b.x, 1), round(end_b.y, 1), round(end_b.z, 1)],
                # THE DECIDING NUMBER. A beam of the right LENGTH, centred in the right PLACE, can still
                # miss both ends by two hundred units if it is pointing the wrong way -- and that is exactly
                # what a bar lying across the scene near the crystal would look like from the play camera.
                "axis_vs_line_deg": angle_between(fwd, crystal_at, dog_at),
                # WHICH AXIS IS ACTUALLY THE LONG ONE. The scale says X, and X is 79.5 degrees off the line
                # it should lie along -- but a 79.5 that should be 0 and a 79.5 measured on the wrong axis
                # look identical in a result file, and only one of them is a defect in someone else's lane.
                # So all three are reported and the one that reads near zero identifies itself.
                "x_axis_vs_line_deg": angle_between(unreal.MathLibrary.get_forward_vector(rot), crystal_at, dog_at),
                "y_axis_vs_line_deg": angle_between(unreal.MathLibrary.get_right_vector(rot), crystal_at, dog_at),
                "z_axis_vs_line_deg": angle_between(unreal.MathLibrary.get_up_vector(rot), crystal_at, dog_at),
            })
        RESULT["instances"] = shown

        # THE VERDICT IN ONE LINE. A beam that joins the two reaches both ends; a bar parked at the crystal
        # reaches only one, however right its endpoint arithmetic looks.
        joins = False
        for inst in shown:
            reaches_dog = min(inst["end_a_from_dog_uu"], inst["end_b_from_dog_uu"])
            reaches_crystal = min(inst["end_a_from_crystal_uu"], inst["end_b_from_crystal_uu"])
            if reaches_dog <= 160.0 and reaches_crystal <= 160.0:
                joins = True
            inst["reaches_dog_uu"] = reaches_dog
            inst["reaches_crystal_uu"] = reaches_crystal
        RESULT["beam_joins_dog_to_crystal"] = joins

        # WHAT STANDS BETWEEN THE TWO. The Dog and the crystal are nearly the same height -- 101.7 and 121.0 --
        # so the beam runs almost flat across a garden full of raised planters, and the frames show its near
        # half missing rather than misplaced. Unlike the companions and the foliage, a planter is world
        # geometry with collision, so this is the one occlusion question a trace can honestly answer.
        RESULT["height_difference_uu"] = round(abs(float(crystal_at.z) - float(dog_at.z)), 1)
        chest = unreal.Vector(comp_at.x, comp_at.y, comp_at.z)
        try:
            got = unreal.SystemLibrary.line_trace_single(
                world, chest, crystal_at, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False,
                [pawn], unreal.DrawDebugTrace.NONE, True)
            RESULT["trace_returned"] = type(got).__name__
            if isinstance(got, tuple):
                RESULT["something_between_them"] = bool(got[0])
            elif isinstance(got, bool):
                RESULT["something_between_them"] = got
            else:
                RESULT["something_between_them"] = got is not None
        except Exception as exc:
            RESULT["trace_error"] = str(exc)

        # Aim at the bar's own centre and photograph it, so the picture and the numbers describe the same
        # instant. Reading a capture from one run against measurements from another is how a person ends up
        # certain about two different beams.
        if shown:
            centre = shown[0]["at"]
            look = unreal.MathLibrary.find_look_at_rotation(
                pawn.get_actor_location(), unreal.Vector(centre[0], centre[1], centre[2]))
            controller = unreal.GameplayStatics.get_player_controller(world, 0)
            controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-6.0, yaw=look.yaw))
            yield 0.8
            path = "C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/captures/zc/zc_beam_geom.png"
            L.capture_game_viewport(path)
            RESULT["capture"] = path

        mission.set_beat_by_id("idle")
        yield 0.5
        RESULT["status"] = "done"
        unreal.log_warning("WLBEAMGEOM joins=%s" % joins)

    finally:
        L.set_background_throttle_suspended(False)
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
