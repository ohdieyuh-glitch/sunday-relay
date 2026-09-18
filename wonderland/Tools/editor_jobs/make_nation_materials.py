# Editor job: build a nation's own material instances from the families the world already generates.
#
# WHY (2026-09-17, the three-nations canon). CANON/nations.json lists, per nation, which materials exist today and
# which must still be made. Icarus can start from the city's pale family, but its accent metal is SILVER where the
# core uses gold, and nothing silver existed. A nation's identity has to be real material, not a tint applied at
# placement time, or every later pass has to remember to tint.
#
# Each entry copies an existing instance's parameters (so it inherits the tuning that instance has already earned --
# MQ06's gold roughness, for one) and then overrides what makes it the nation's own.
# Globals: PLAN {new instance name: {"from": source instance, "scalars": {...}, "vectors": {...}}}, FORCE, SAVE.
import json

PLAN = globals().get("PLAN", {})
FORCE = globals().get("FORCE", False)
SAVE = globals().get("SAVE", True)
INST = "/Game/WonderlandV2/Materials/Instances"


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    made = {}
    for name, spec in PLAN.items():
        path = INST + "/" + name
        if eal.does_asset_exist(path) and not FORCE:
            made[name] = "exists"
            continue
        src = unreal.load_asset("%s/%s.%s" % (INST, spec["from"], spec["from"]))
        if src is None:
            made[name] = "source missing: " + spec["from"]
            continue
        if eal.does_asset_exist(path):
            eal.delete_asset(path)
        mi = tools.create_asset(name, INST, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, src.get_editor_property("parent"))
        for p in mel.get_scalar_parameter_names(src):
            mel.set_material_instance_scalar_parameter_value(mi, p, mel.get_material_instance_scalar_parameter_value(src, p))
        for p in mel.get_vector_parameter_names(src):
            mel.set_material_instance_vector_parameter_value(mi, p, mel.get_material_instance_vector_parameter_value(src, p))
        for p in mel.get_texture_parameter_names(src):
            t = mel.get_material_instance_texture_parameter_value(src, p)
            if t is not None:
                mel.set_material_instance_texture_parameter_value(mi, p, t)
        for k, v in spec.get("scalars", {}).items():
            mel.set_material_instance_scalar_parameter_value(mi, k, float(v))
        for k, v in spec.get("vectors", {}).items():
            mel.set_material_instance_vector_parameter_value(mi, k, unreal.LinearColor(*(list(v) + [1.0] * (4 - len(v)))))
        mel.update_material_instance(mi)
        if SAVE:
            eal.save_asset(path, only_if_is_dirty=False)
        made[name] = "made from " + spec["from"]
        yield 0.2
    RESULT["made"] = made
    RESULT["status"] = "done"
