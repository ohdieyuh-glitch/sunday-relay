# ARDEN, CLOSE AND FROM THE FRONT: the chains, the pendants, the medallion, the demon arm and the tail.
#
# FOUNDER: "A feature that exists in the .wlvox but disappears visually in-engine is NOT solved." The portrait
# camera stands nine metres off at forty degrees, which is right for the silhouette and wrong for the chest --
# the halo and its fire cover the chains from there. So this stands the Dog with /skin and photographs the chest
# from straight ahead at three metres, then the demon side, then the tail from behind.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "arden_detail")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 6.0
        world = ues.get_game_world()
        ui = L.get_ui(world)
        L.focus_game_viewport()
        ui.handle_terminal_command("/skin arden_infernal")
        yield 3.0
        stages = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage)
        body = stages[0].get_body() if stages else None
        if body is None:
            RESULT["status"] = "failed"
            RESULT["why"] = "no preview body"
            return
        h = float(body.get_figure_height_uu())
        at = body.get_actor_location()
        fwd = body.get_actor_forward_vector()
        right = body.get_actor_right_vector()
        base = math.degrees(math.atan2(fwd.y, fwd.x))

        def shoot(name, bearing_deg, dist, look_z, fov, eye_z):
            rad = math.radians(base + bearing_deg)
            eye = unreal.Vector(at.x + math.cos(rad) * dist, at.y + math.sin(rad) * dist, at.z + eye_z)
            L.pose_camera(world, eye, unreal.Vector(at.x, at.y, at.z + look_z), fov)
            return name

        plan = [
            ("1_chest_front", 0.0, h * 1.25, h * 0.36, 34.0, h * 0.40),
            ("2_chest_front_offset", 25.0, h * 1.25, h * 0.36, 34.0, h * 0.40),
            ("3_demon_arm_side", -75.0, h * 1.35, h * 0.30, 38.0, h * 0.38),
            ("4_tail_rear", 165.0, h * 1.5, h * 0.42, 40.0, h * 0.55),
            ("5_halo_three_quarter", 40.0, h * 1.8, h * 0.62, 40.0, h * 0.72),
        ]
        shots = []
        for name, bearing, dist, look_z, fov, eye_z in plan:
            shoot(name, bearing, dist, look_z, fov, eye_z)
            yield 1.2
            H.capture_viewport_jpeg(os.path.join(ROOT, name + ".jpg"), 1900, 95)
            shots.append(name)
        RESULT["shots"] = shots
        L.release_camera(world)
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "detail.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLARDEN could not end play: %s" % exc)
