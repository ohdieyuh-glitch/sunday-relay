# PIE probe: WHERE THE BOOK, THE HANDS AND THE COMPANIONS ACTUALLY ARE while the Dog reads.
#
# The book is authored in the left forearm's local frame, and which way that frame faces once the arm is posed for
# reading cannot be read off the source: the covers' roll signs, the arm's side sign and the pose all compose. A
# turning page built on a guess would turn the wrong way, or inside the covers. So this measures, in world space:
# the forearms, every book and page instance, the right hand's sweep over one page-turn cycle, the companions'
# bounds, and the camera rig -- and photographs the Dog from four sides.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "book_probe")


def vec(v):
    return [round(v.x, 1), round(v.y, 1), round(v.z, 1)]


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
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
        live = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()]
        mission = live[0]
        L.focus_game_viewport()

        def component(prefix):
            for c in pawn.get_components_by_class(unreal.SceneComponent):
                if c.get_name().startswith(prefix):
                    return c
            return None

        def frame_of(c):
            if c is None:
                return None
            return {"at": vec(c.get_world_location()), "fwd": vec(c.get_forward_vector() * 100.0),
                    "right": vec(c.get_right_vector() * 100.0), "up": vec(c.get_up_vector() * 100.0),
                    "rot": [round(c.get_world_rotation().pitch, 1), round(c.get_world_rotation().yaw, 1), round(c.get_world_rotation().roll, 1)]}

        def instances(c):
            out = []
            if c is None:
                return out
            for i in range(c.get_instance_count()):
                got = c.get_instance_transform(i, True)
                t = got[1] if isinstance(got, tuple) else got
                r = t.rotation.rotator()
                out.append({"at": vec(t.translation), "scale": vec(t.scale3d),
                            "rot": [round(r.pitch, 1), round(r.yaw, 1), round(r.roll, 1)]})
            return out

        mission.stop_fixture()
        mission.set_joined_in(True, True)
        mission.set_beat_by_id("researching")
        yield 3.0

        fore_l = component("Pivot_forearmLeft")
        fore_r = component("Pivot_forearmRight")
        book = component("MissionBook")
        pages = component("MissionBookPages")
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        cam = pawn.get_component_by_class(unreal.CameraComponent)
        RESULT["actor"] = {"at": vec(pawn.get_actor_location()), "yaw": round(pawn.get_actor_rotation().yaw, 1),
                           "fwd": vec(pawn.get_actor_forward_vector() * 100.0), "right": vec(pawn.get_actor_right_vector() * 100.0)}
        RESULT["forearm_left"] = frame_of(fore_l)
        RESULT["forearm_right"] = frame_of(fore_r)
        RESULT["book_visible"] = bool(book.is_visible()) if book is not None else None
        RESULT["book"] = instances(book)
        RESULT["pages"] = instances(pages)
        RESULT["contract"] = vec(mission.get_orb_location()) if mission.is_orb_in_world() else None
        if boom is not None:
            RESULT["boom"] = {"arm": float(boom.target_arm_length), "socket": vec(boom.socket_offset),
                              "target": vec(boom.target_offset), "at": vec(boom.get_world_location())}
        if cam is not None:
            RESULT["camera"] = {"at": vec(cam.get_world_location()), "fov": float(cam.field_of_view)}

        # The right hand over two page-turn cycles (the turn repeats every 1/0.32 s), relative to the book's middle.
        sweep = []
        for step in range(64):
            if fore_r is not None and pages is not None and pages.get_instance_count() > 1:
                a = instances(pages)
                mid = [(a[0]["at"][k] + a[1]["at"][k]) * 0.5 for k in range(3)]
                hand = fore_r.get_world_location()
                sweep.append({"t": round(float(unreal.GameplayStatics.get_time_seconds(world)), 2),
                              "hand_minus_book": [round(hand.x - mid[0], 1), round(hand.y - mid[1], 1), round(hand.z - mid[2], 1)],
                              "actor_yaw": round(pawn.get_actor_rotation().yaw, 1)})
            yield 0.1
        RESULT["sweep"] = sweep
        RESULT["pages_later"] = instances(pages)
        RESULT["forearm_left_later"] = frame_of(fore_l)
        RESULT["actor_later"] = {"at": vec(pawn.get_actor_location()), "yaw": round(pawn.get_actor_rotation().yaw, 1)}

        bodies = []
        for body in unreal.ObjectIterator(unreal.WonderlandCompanionEmbodiment):
            try:
                if body.get_world() != world:
                    continue
                origin, extent = body.get_actor_bounds(False)
                bodies.append({"name": body.get_name(), "at": vec(body.get_actor_location()),
                               "bounds_origin": vec(origin), "bounds_extent": vec(extent)})
            except Exception as exc:
                bodies.append({"error": str(exc)})
        RESULT["companions"] = bodies

        # Four sides, at the arm the game ships with.
        shots = {}
        mission.stop_fixture()
        mission.set_beat_by_id("researching")
        yield 2.0
        for tag, dyaw in (("behind", 0.0), ("left", 90.0), ("front", 180.0), ("right", -90.0)):
            yaw = pawn.get_actor_rotation().yaw + dyaw
            controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-12.0, yaw=yaw))
            yield 0.35
            for k in range(2):
                path = os.path.join(SHOTS, "book_%s_%d.png" % (tag, k))
                ok = L.capture_game_viewport(path)
                shots["%s_%d" % (tag, k)] = path if ok else None
                yield 0.45
        RESULT["shots"] = shots
        RESULT["status"] = "done"
    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLBOOKPROBE could not end play: %s" % exc)
