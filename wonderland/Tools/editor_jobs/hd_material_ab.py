# PIE job: MQ01 A/B -- the same poses captured with the V2 materials, then with the HD instances swapped onto the PIE
# copy of the world (every StaticMesh / instanced component slot whose material has an MI_V2HD_ twin). Nothing in the
# editor world or any asset changes; ending PIE discards the swap.
# Globals: POSES [(name, x, y, z, pitch, yaw, fov)], TAG, SETTLE, COMPILE_WAIT (seconds after the swap for shaders).
import os

POSES = globals().get("POSES", [])
TAG = globals().get("TAG", "hd")
SETTLE = globals().get("SETTLE", 3.0)
COMPILE_WAIT = globals().get("COMPILE_WAIT", 45.0)
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "hd")
INST = "/Game/WonderlandV2/Materials/Instances"


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    os.makedirs(SHOTS, exist_ok=True)
    GS = unreal.GameplayStatics
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: GS.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pc = GS.get_player_controller(world, 0)
    GS.get_player_pawn(world, 0).set_actor_hidden_in_game(True)
    for hud in unreal.ObjectIterator(unreal.WonderlandUsageHudWidget):
        if hud.get_world() == world:
            hud.set_visibility(unreal.SlateVisibility.HIDDEN)
    cams = {a.get_actor_label(): a for a in GS.get_all_actors_of_class(world, unreal.CameraActor)}
    rover = cams["SkylineCam06"]
    comp = rover.get_editor_property("camera_component")
    comp.set_editor_property("constrain_aspect_ratio", False)

    def shoot(state):
        for (name, x, y, z, pitch, yaw, fov) in POSES:
            rover.set_actor_location_and_rotation(unreal.Vector(x, y, z), unreal.Rotator(roll=0.0, pitch=pitch, yaw=yaw), False, True)
            comp.set_editor_property("field_of_view", fov)
            pc.set_view_target_with_blend(rover, 0.0)
            yield SETTLE
            unreal.WonderlandUiTestLibrary.capture_game_viewport(os.path.join(SHOTS, "%s__%s_%s.png" % (name, TAG, state)))

    yield from shoot("v2")

    twins = {}
    swapped = 0
    for actor in GS.get_all_actors_of_class(world, unreal.Actor):
        for c in actor.get_components_by_class(unreal.StaticMeshComponent):
            for i in range(c.get_num_materials()):
                m = c.get_material(i)
                if m is None:
                    continue
                name = m.get_name()
                if not name.startswith("MI_V2_"):
                    continue
                if name not in twins:
                    hd = name.replace("MI_V2_", "MI_V2HD_")
                    # EditorAssetLibrary refuses every call during PIE, so the twin is loaded directly
                    try:
                        twins[name] = unreal.load_object(None, "%s/%s.%s" % (INST, hd, hd))
                    except Exception:
                        twins[name] = None
                if twins[name] is not None:
                    c.set_material(i, twins[name])
                    swapped += 1
    RESULT["swapped_slots"] = swapped
    RESULT["twins"] = sorted(k for k, v in twins.items() if v is not None)
    yield COMPILE_WAIT
    yield from shoot("hd")
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"
