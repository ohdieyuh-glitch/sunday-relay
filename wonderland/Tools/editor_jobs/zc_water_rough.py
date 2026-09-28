# ROUGHEN THE WATER SO ITS REFLECTION BREAKS UP.
#
# The Julius lane, from a player-height frame in the plaza: the fountain after my reflection change reads as
# "a glowing HOOP around the Dog... thick, uniformly pale grey-blue... no sky or scene detail reflected in
# it". That is what a MIRROR does at a grazing angle: it returns the sky, and the sky is a large uniform pale
# thing. Roughness on this master is 0.035, which is glass. With reflections off it never mattered; turning
# them on made the glass visible.
#
# THE PREVIOUS ATTEMPT FAILED HONESTLY AND THAT IS WHY THIS EXISTS. It called
# MaterialEditingLibrary.set_material_default_scalar_parameter_value, which does not exist on this engine, and
# its readback clause caught it: values unchanged, applied {} , D02 red. The getter has no setter twin here.
# A scalar's default lives on the MaterialExpressionScalarParameter NODE, which is where the builder set it in
# the first place, so that is what this edits.
#
# NO PIE. It edits and saves an asset.
import unreal

MASTER = "/Game/Wonderland/Materials/M_WL_RealWater.M_WL_RealWater"
# Glass is 0.02-0.05. Still water at a distance sits nearer 0.10 and the ripple normals do the rest; past
# about 0.2 it stops reading as water and starts reading as wet stone.
WANT = {"Roughness": 0.10, "RippleStrength": 0.55}


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    master = unreal.load_asset(MASTER)
    record("G00", "the water master loads", master is not None)
    if master is None:
        RESULT["status"] = "VOID: no master"
        return

    def read():
        out = {}
        for k in WANT:
            try:
                out[k] = round(float(unreal.MaterialEditingLibrary
                                     .get_material_default_scalar_parameter_value(master, unreal.Name(k))), 4)
            except Exception:                                       # noqa: BLE001
                out[k] = None
        return out

    before = read()
    RESULT["before"] = before

    touched = {}
    try:
        for expr in unreal.MaterialEditingLibrary.get_material_expressions(master):
            if not isinstance(expr, unreal.MaterialExpressionScalarParameter):
                continue
            name = str(expr.get_editor_property("parameter_name"))
            if name in WANT:
                expr.set_editor_property("default_value", float(WANT[name]))
                touched[name] = WANT[name]
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["walk"] = str(err)[:160]
    RESULT["nodes_touched"] = touched

    try:
        unreal.MaterialEditingLibrary.recompile_material(master)
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["recompile"] = str(err)[:160]
    yield 1.0
    saved = False
    try:
        saved = bool(unreal.EditorAssetLibrary.save_asset(MASTER, only_if_is_dirty=False))
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["save"] = str(err)[:160]
    RESULT["saved"] = saved
    yield 1.0

    after = read()
    RESULT["after"] = after
    record("G01", "the roughness and ripple are changed on the asset, read back off it",
           all(after.get(k) is not None and abs(after[k] - v) < 0.005 for k, v in WANT.items()),
           before=before, after=after, wanted=WANT, nodes_touched=touched, saved=saved,
           note="THE READBACK IS THE RESULT. The previous attempt's setter did not exist and its own "
                "readback clause is what caught it -- the call raised, the values never moved, and nothing "
                "would have told me otherwise.")

    RESULT["status"] = "measured"
    yield 0.5
