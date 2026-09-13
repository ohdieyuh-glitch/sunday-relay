# Editor job: apply (or revert) a material look -- wonderland/WorldDesign/Look/mat*.json -- to
# material-instance vector parameters and save those assets. Refuses to write over values that are
# not the recorded "before" (or "after" when reverting). Back the .uasset files up before running.
import json

SPEC = globals().get("SPEC")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", True)
MEL = unreal.MaterialEditingLibrary


def job():
    yield 0.1
    with open(SPEC, encoding="utf-8") as f:
        spec = json.load(f)["materials"]
    source, target = ("after", "before") if REVERT else ("before", "after")
    loaded = {}
    mismatches = []
    for name, params in spec.items():
        mi = unreal.load_asset("/Game/WonderlandV2/Materials/Instances/%s.%s" % (name, name))
        if mi is None:
            mismatches.append("%s did not load" % name)
            continue
        loaded[name] = mi
        for pname, values in params.items():
            v = MEL.get_material_instance_vector_parameter_value(mi, pname)
            want = values[source]
            if max(abs(v.r - want[0]), abs(v.g - want[1]), abs(v.b - want[2])) > 1e-3:
                mismatches.append("%s.%s is %s, expected %s" % (name, pname, [round(v.r, 4), round(v.g, 4), round(v.b, 4)], want[:3]))
    if mismatches:
        RESULT["status"] = "error"
        RESULT["error"] = "; ".join(mismatches)
        return
    saved = []
    for name, params in spec.items():
        mi = loaded[name]
        for pname, values in params.items():
            t = values[target]
            MEL.set_material_instance_vector_parameter_value(mi, pname, unreal.LinearColor(t[0], t[1], t[2], t[3] if len(t) > 3 else 1.0))
        MEL.update_material_instance(mi)
        if SAVE:
            saved.append([name, bool(unreal.EditorAssetLibrary.save_loaded_asset(mi, False))])
    RESULT["applied"] = target
    RESULT["saved"] = saved
    RESULT["status"] = "done"
