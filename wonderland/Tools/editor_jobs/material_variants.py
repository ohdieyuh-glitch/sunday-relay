# PIE job: try material-instance parameter variants live and capture each from the same poses.
# The instances are changed in memory for the capture and RESTORED to their starting values before
# the job ends; nothing is saved. A winner is persisted by apply_material_look.py.
# Globals: VARIANTS = [{"id": ..., "params": {"MI_Name": {"BaseColor": [r, g, b]}}}], CAMERAS, POSES, TAG.
import os

VARIANTS = globals().get("VARIANTS", [])
CAMERAS = globals().get("CAMERAS", ["HeroCam_GoldenArrivalBible"])
POSES = globals().get("POSES", [])
TAG = globals().get("TAG", "mat")
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "material")
MEL = unreal.MaterialEditingLibrary


def _mi(name):
    return unreal.load_asset("/Game/WonderlandV2/Materials/Instances/%s.%s" % (name, name))


def _read(mi, pname):
    v = MEL.get_material_instance_vector_parameter_value(mi, pname)
    return [v.r, v.g, v.b, v.a]


def _write(mi, pname, value):
    MEL.set_material_instance_vector_parameter_value(mi, pname, unreal.LinearColor(value[0], value[1], value[2], value[3] if len(value) > 3 else 1.0))
    MEL.update_material_instance(mi)


def job():
    os.makedirs(SHOTS, exist_ok=True)
    touched = {}
    for variant in VARIANTS:
        for mname, params in variant.get("params", {}).items():
            mi = _mi(mname)
            for pname in params:
                touched.setdefault((mname, pname), _read(mi, pname))
    RESULT["originals"] = {"%s.%s" % k: v for k, v in touched.items()}

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 4.0
    world = ues.get_game_world()
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    unreal.GameplayStatics.get_player_pawn(world, 0).set_actor_hidden_in_game(True)
    for hud in unreal.ObjectIterator(unreal.WonderlandUsageHudWidget):
        if hud.get_world() == world:
            hud.set_visibility(unreal.SlateVisibility.HIDDEN)
    cams = {a.get_actor_label(): a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.CameraActor)}
    rover = cams.get("SkylineCam06")
    shots = []
    try:
        for variant in VARIANTS:
            # Every touched parameter starts from its original, then the variant's values apply.
            for (mname, pname), original in touched.items():
                _write(_mi(mname), pname, original)
            for mname, params in variant.get("params", {}).items():
                mi = _mi(mname)
                for pname, value in params.items():
                    _write(mi, pname, value)
            views = [(name, cams[name], None) for name in CAMERAS if name in cams] + [(p[0], rover, p) for p in POSES]
            for (name, cam, pose) in views:
                if pose is not None:
                    comp = cam.get_editor_property("camera_component")
                    comp.set_editor_property("constrain_aspect_ratio", False)
                    comp.set_editor_property("field_of_view", pose[6])
                    cam.set_actor_location_and_rotation(unreal.Vector(pose[1], pose[2], pose[3]), unreal.Rotator(roll=0.0, pitch=pose[4], yaw=pose[5]), False, True)
                pc.set_view_target_with_blend(cam, 0.0)
                yield 2.5
                path = os.path.join(SHOTS, "%s__%s__%s.png" % (name, TAG, variant["id"]))
                unreal.WonderlandUiTestLibrary.capture_game_viewport(path)
                shots.append(path)
            emit(variant["id"])
    finally:
        for (mname, pname), original in touched.items():
            _write(_mi(mname), pname, original)
    RESULT["restored"] = True
    RESULT["shots"] = shots
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"
