# A PROJECT-OWNED ADDITIVE MATERIAL, BECAUSE THE ENGINE'S CANNOT BE USED HERE
#
# The figures' additive parts parent to /Engine/EngineMaterials/EmissiveMeshMaterial, and the engine says on
# every load:
#
#     LogMaterial: Material EmissiveMeshMaterial missing usage flag InstancedStaticMeshes!
#                  Default Material will be used in game.
#
# Which means the halos render as default grey in a packaged build. Moving those groups off the Nanite cube
# silenced the Nanite half of this and I checked only that half, reported "both warnings now count zero", and
# was wrong: the InstancedStaticMeshes flag is a separate usage flag with the same consequence, and the
# figures draw through instanced components whatever cube they use. The fix was incomplete and the
# verification was too narrow to notice.
#
# Usage flags cannot be set on engine content -- it is not ours to resave, and a flag set here would not
# travel with the project. So the project gets its own additive material: unlit, additive, flagged for
# instanced static meshes, with the same "Color" parameter name the existing code already writes.
CONCURRENT = True

import unreal

PACKAGE = "/Game/Wonderland/Materials"
NAME = "M_WL_VoxelAdditive"
PATH = PACKAGE + "/" + NAME


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    made = False
    if not unreal.EditorAssetLibrary.does_asset_exist(PATH):
        tools = unreal.AssetToolsHelpers.get_asset_tools()
        created = tools.create_asset(NAME, PACKAGE, unreal.Material, unreal.MaterialFactoryNew())
        made = created is not None
    mat = unreal.EditorAssetLibrary.load_asset(PATH)
    if mat is None:
        record("M00", "the project has its own additive material", False, path=PATH)
        RESULT["status"] = "FAIL"
        return
    RESULT["created"] = made

    # ---- WHAT MAKES IT USABLE WHERE THE ENGINE'S IS NOT
    set_ok = {}
    for prop, value in (("blend_mode", unreal.BlendMode.BLEND_ADDITIVE),
                        ("shading_model", unreal.MaterialShadingModel.MSM_UNLIT),
                        ("two_sided", False),
                        ("used_with_instanced_static_meshes", True),
                        ("used_with_static_lighting", False)):
        try:
            mat.set_editor_property(prop, value)
            set_ok[prop] = True
        except Exception as err:                                   # noqa: BLE001
            set_ok[prop] = str(err)[:90]
    RESULT["properties"] = set_ok
    yield 0.5

    # ---- THE COLOUR PARAMETER, named what the code already writes.
    #
    # WonderlandCompanionEmbodiment dresses every material instance through SetVectorParameterValue("Color"),
    # so a parameter by any other name would leave the halos black and look like a different bug entirely.
    existing = []
    try:
        existing = [str(n) for n in unreal.MaterialEditingLibrary.get_vector_parameter_names(mat)]
    except Exception:
        pass
    if "Color" not in existing:
        node = unreal.MaterialEditingLibrary.create_material_expression(
            mat, unreal.MaterialExpressionVectorParameter, -380, 0)
        node.set_editor_property("parameter_name", "Color")
        node.set_editor_property("default_value", unreal.LinearColor(1.0, 1.0, 1.0, 1.0))
        unreal.MaterialEditingLibrary.connect_material_property(
            node, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    yield 0.5

    try:
        unreal.MaterialEditingLibrary.recompile_material(mat)
    except Exception as err:                                       # noqa: BLE001
        RESULT["recompile_error"] = str(err)[:160]
    unreal.EditorAssetLibrary.save_asset(PATH)
    yield 1.0

    # ---- READ IT BACK, because setting a property and having it stick are different things.
    back = {}
    for prop in ("blend_mode", "shading_model", "used_with_instanced_static_meshes"):
        try:
            back[prop] = str(mat.get_editor_property(prop))
        except Exception as err:                                   # noqa: BLE001
            back[prop] = "unreadable: %s" % str(err)[:60]
    try:
        back["vector_parameters"] = [str(n) for n in unreal.MaterialEditingLibrary.get_vector_parameter_names(mat)]
    except Exception:
        back["vector_parameters"] = []
    RESULT["read_back"] = back

    record("M00", "the project has its own additive material", True, path=PATH, created=made)
    record("M01", "it is additive, unlit, and allowed on instanced static meshes",
           "ADDITIVE" in back.get("blend_mode", "").upper()
           and "UNLIT" in back.get("shading_model", "").upper()
           and back.get("used_with_instanced_static_meshes") in ("True", "true", True),
           read_back=back,
           note="the InstancedStaticMeshes flag is the one the engine material is missing, and it is why the "
                "halos were being replaced by the default material in game")
    record("M02", "and it carries the Color parameter the figures already write",
           "Color" in back.get("vector_parameters", []),
           parameters=back.get("vector_parameters"),
           note="the embodiment dresses every instance through SetVectorParameterValue('Color')")

    RESULT["status"] = "measured"
