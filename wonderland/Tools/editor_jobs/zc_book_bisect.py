# PIE probe: WHICH STEP LIFTS THE BOOK OVER THE DOG'S HEAD? In one play session the book sat at the chest (-6 against the
# capsule centre, parent Body); in another, which also moved the camera arm and set wl.Dog.Read.BookUp from the console,
# it stood 74 uu over the head joint and the Dog was not even in its reading pose. This takes those steps one at a time
# in one session, and after each records the book's parent and place, the body and head, and a photograph.
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "book_bisect")


def vec(v):
    return [round(v.x, 1), round(v.y, 1), round(v.z, 1)]


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
        missions = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem)]
        RESULT["mission_subsystems"] = [[m.get_full_name(), bool(m.is_mission_strip_on_screen()),
                                         (m.get_world().get_name() if m.get_world() else None)] for m in missions]
        mission = next(m for m in missions if m.get_world() == world)
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)

        def measure(tag):
            at = pawn.get_actor_location()
            comps = pawn.get_components_by_class(unreal.SceneComponent)
            by = {c.get_name(): c for c in comps}
            roots = [c for c in comps if c.get_name().startswith("MissionBook")]
            row = {"step": tag, "beat": str(mission.get_beat_id()),
                   "body_rel_z": round(by["Body"].get_editor_property("relative_location").z, 1) if "Body" in by else None,
                   "head_z": round(by["Pivot_head"].get_world_location().z - at.z, 1) if "Pivot_head" in by else None,
                   "forearm_l_z": round(by["Pivot_forearmLeft"].get_world_location().z - at.z, 1) if "Pivot_forearmLeft" in by else None,
                   "book": [{"name": c.get_name(), "parent": (c.get_attach_parent().get_name() if c.get_attach_parent() else None),
                             "rel": vec(c.get_editor_property("relative_location")),
                             "world_z": round(c.get_world_location().z - at.z, 1), "visible": bool(c.is_visible())} for c in roots],
                   "beam_note": str(pawn.describe_mission_beam())}
            controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-12.0, yaw=pawn.get_actor_rotation().yaw + 180.0 + 50.0))
            row["shot"] = os.path.join(SHOTS, "%02d_%s.png" % (len(steps), tag))
            steps.append(row)
            return row

        yield 0.2
        L.capture_game_viewport(measure("fresh")["shot"])
        mission.stop_fixture()
        mission.set_beat_by_id("researching")
        yield 3.0
        measure("reading_3s")
        yield 0.6
        L.capture_game_viewport(steps[-1]["shot"])
        boom.set_editor_property("socket_offset", unreal.Vector(0.0, 0.0, 70.0))
        yield 1.2
        measure("socket_offset_set")
        yield 0.6
        L.capture_game_viewport(steps[-1]["shot"])
        unreal.SystemLibrary.execute_console_command(world, "wl.Dog.Read.BookUp -13")
        yield 1.2
        measure("console_bookup")
        yield 0.6
        L.capture_game_viewport(steps[-1]["shot"])
        boom.set_editor_property("target_arm_length", 320.0)
        yield 1.2
        measure("arm_set")
        yield 0.6
        L.capture_game_viewport(steps[-1]["shot"])
        yield 8.0
        measure("reading_later")
        yield 0.6
        L.capture_game_viewport(steps[-1]["shot"])
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLBOOKBISECT could not end play: %s" % exc)
