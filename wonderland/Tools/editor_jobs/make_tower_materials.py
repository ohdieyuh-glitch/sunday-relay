INST = "/Game/WonderlandV2/Materials/Instances"
# Tints for the skyline towers (SC02). Pushed a little past MarbleBlush's saturation because the towers are 50-1,250 m
# out and the atmosphere desaturates them on the way to the eye.
TINTS = {"MI_V2_TowerCream": (1.00, 0.88, 0.66), "MI_V2_TowerBlush": (1.00, 0.72, 0.74), "MI_V2_TowerLavender": (0.84, 0.76, 1.00)}
TUNE = globals().get("TUNE", TINTS)
def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    eal, mel = unreal.EditorAssetLibrary, unreal.MaterialEditingLibrary
    out = {}
    for name, (r, g, b) in TUNE.items():
        path = "%s/%s" % (INST, name)
        if not eal.does_asset_exist(path):
            eal.duplicate_asset("%s/MI_V2_IvoryStone" % INST, path)
        mi = unreal.load_asset(path)
        mel.set_material_instance_vector_parameter_value(mi, "BaseColor", unreal.LinearColor(r, g, b, 1.0))
        mel.update_material_instance(mi)
        out[name] = eal.save_asset(path, only_if_is_dirty=False)
        yield 0.5
    RESULT["saved"] = out
    RESULT["status"] = "done"
