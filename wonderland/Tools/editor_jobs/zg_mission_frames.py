# FILM (read-only): EVERY SKIN THROUGH ONE WHOLE MISSION CONTRACT, FRAMED ON THE BODY AND ON THE HANDS.
#
# The visual half of zg_mission_contract_proof (which measures; this photographs). For each skin the Dog wears it, a
# fresh contract is submitted and driven through every stage with wl.Tasks.Scheduler, and at each stage, once the act
# is on, two frames are taken with a camera aimed at the Dog's own capsule plus the performance's lift -- so a flying
# Dog stays in frame -- one wide on the whole figure and the Contract, one close on the upper body where the hands meet
# the book, the brush, the lens and the scraper. Jack Flame also gets a close frame on its head at every stage.
# Globals: SKINS. PIE-owning: CONCURRENT is False. Saves nothing; restores the persisted skin.
CONCURRENT = False
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
GS = unreal.GameplayStatics
SKINS = globals().get("SKINS", ["relay_og", "celestial_light", "skeleton_flame", "jack_flame", "baal"])
STAGES = ["PREPARATION", "RESEARCH", "IMPLEMENTATION", "VERIFICATION", "REVIEW", "REPAIR", "COMPLETED"]
SETTLE = {"REPAIR": 5.5, "COMPLETED": 4.0}
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zg", "mission_frames")


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    L.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        try:
            world = ues.get_game_world()
            if world is not None:
                L.release_camera(world)
        except Exception:
            pass
        with open(os.path.join(ROOT, "frames.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 120.0:
        yield 1.0
        t += 1.0
    world = ues.get_game_world()
    dog_of = lambda: GS.get_player_pawn(ues.get_game_world(), 0)
    t = 0.0
    while dog_of() is None and t < 30.0:
        yield 0.5
        t += 0.5
    if dog_of() is None:
        RESULT["status"] = "BLOCKED: no pawn"
        return
    yield 4.0
    L.focus_game_viewport()
    ui = L.get_ui(world)
    tasks = L.get_mission_tasks(world)
    mission = L.get_mission(world)
    persisted = None
    try:
        persisted = open(os.path.join(unreal.Paths.project_saved_dir(), "Wonderland", "RelaySkin.txt")).read().strip()
    except Exception:
        pass
    RESULT["persisted_skin_at_start"] = persisted

    def aim(target, bearing, dist_uu, lift, fov):
        dog = dog_of()
        yaw = math.radians(float(dog.get_actor_rotation().yaw) + bearing)
        eye = unreal.Vector(target.x + math.cos(yaw) * dist_uu, target.y + math.sin(yaw) * dist_uu, target.z + lift)
        L.pose_camera(world, eye, target, fov)

    shots = []
    RESULT["shots"] = shots
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 2.5
        tasks.clear_all_tasks_for_development()
        yield 0.8
        tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
        yield 1.5
        for n, stage in enumerate(STAGES):
            unreal.SystemLibrary.execute_console_command(world, "wl.Tasks.Scheduler 0 %s" % stage)
            yield SETTLE.get(stage, 3.5)
            dog = dog_of()
            pose = dog.get_canonical_worn_pose()
            lift = float(pose.lift_uu)
            base = dog.get_actor_location()
            half = dog.capsule_component.get_scaled_capsule_half_height()
            sole = base.z - half
            act = str(mission.get_dog_performing_label())
            # wide: the whole figure and the Contract beside it
            aim(unreal.Vector(base.x, base.y, sole + 80.0 + lift), 35.0, 560.0, 60.0, 55.0)
            yield 0.5
            name = "%s_%d_%s_wide.jpg" % (skin, n + 1, stage.lower())
            H.capture_viewport_jpeg(os.path.join(ROOT, name), 1600, 90)
            shots.append({"skin": skin, "stage": stage, "act": act, "lift_uu": round(lift, 1), "frame": name})
            # close: the upper body, where the hands meet the props
            aim(unreal.Vector(base.x, base.y, sole + 95.0 + lift), 28.0, 250.0, 25.0, 50.0)
            yield 0.5
            name = "%s_%d_%s_hands.jpg" % (skin, n + 1, stage.lower())
            H.capture_viewport_jpeg(os.path.join(ROOT, name), 1600, 90)
            shots.append({"skin": skin, "stage": stage, "act": act, "frame": name})
            if skin == "jack_flame":
                costume = dog.get_costume()
                head = None
                if costume is not None:
                    for c in costume.get_components_by_class(unreal.SceneComponent):
                        if c.get_name().startswith("Part_head"):
                            head = c
                            break
                if head is not None:
                    hp = head.get_world_location()
                    aim(unreal.Vector(hp.x, hp.y, hp.z + 16.0), 30.0, 330.0, 14.0, 40.0)
                    yield 0.5
                    name = "%s_%d_%s_head.jpg" % (skin, n + 1, stage.lower())
                    H.capture_viewport_jpeg(os.path.join(ROOT, name), 1600, 90)
                    shots.append({"skin": skin, "stage": stage, "act": act, "frame": name})
            L.release_camera(world)
            yield 0.3
        yield 2.0
    if persisted:
        ui.wear_relay_skin(persisted)
        yield 1.5
    RESULT["restored_skin"] = persisted
    RESULT["status"] = "filmed"
