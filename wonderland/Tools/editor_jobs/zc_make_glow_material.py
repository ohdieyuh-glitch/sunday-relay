# GIVE THE GLOWING PARTS A MATERIAL THAT SURVIVES PACKAGING.
#
# MEASURED, 2026-09-25, in the first packaged build Wonderland has ever had. Every voxel body -- the Relay
# Dog's skins, the companions, the Project Avatars -- parents its glowing parts to
# /Engine/EngineDebugMaterials/LevelColorationUnlitMaterial. That is an engine DEBUG material: it exists in the
# editor and is not cooked into a packaged build. The packaged log said so fourteen times:
#
#   LogWonderlandCompanion: Warning: WLCOMPANION material parent
#     /Engine/EngineDebugMaterials/LevelColorationUnlitMaterial did not load; drawing that material lit instead
#
# So in a shipped build Arden Infernal's fire, Skeleton Flame's fire and Celestial Light's glow would all draw
# LIT rather than glowing -- the founder's P0 item, wrong in the only build a player would ever run, and
# invisible to every proof because PIE loads editor content happily.
#
# The other three parents package fine (BasicShapeMaterial, M_WLMaster, EmissiveMeshMaterial), so only this one
# is replaced, and it is replaced with a material this project OWNS rather than another engine asset that might
# also turn out to be editor-only.
#
# PARAMETER NAMES ARE NOT A FREE CHOICE. The runtime already sets Color, EmissiveColor, BaseColor and
# EmissiveStrength defensively by name, so this exposes the names that code already writes -- otherwise the
# material would package correctly and still be the wrong colour.
import unreal

MASTER = "/Game/Wonderland/Materials/M_WL_VoxelGlow"


def job():
    RESULT["status"] = "running"
    lib = unreal.MaterialEditingLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()

    # Rebuilt every run: a half-wired material left behind by a failed attempt is worse than none, because a
    # "skip if it exists" guard would then treat the broken one as finished.
    if unreal.EditorAssetLibrary.does_asset_exist(MASTER):
        unreal.EditorAssetLibrary.delete_asset(MASTER)
        RESULT["replaced_existing"] = True

    mat = tools.create_asset("M_WL_VoxelGlow", "/Game/Wonderland/Materials",
                             unreal.Material, unreal.MaterialFactoryNew())
    if mat is None:
        RESULT["status"] = "FAIL: could not create the material"
        yield 0.1
        return

    # UNLIT is the whole point: a glowing part must not take the scene's light, which is exactly what went
    # wrong when the debug parent failed to load and the engine fell back to a lit material.
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    mat.set_editor_property("two_sided", False)

    made = []

    def node(cls, x, y):
        n = lib.create_material_expression(mat, cls, x, y)
        made.append(cls.__name__ if hasattr(cls, "__name__") else str(cls))
        return n

    colour = node(unreal.MaterialExpressionVectorParameter, -600, 0)
    colour.set_editor_property("parameter_name", "Color")
    colour.set_editor_property("default_value", unreal.LinearColor(1.0, 0.78, 0.16, 1.0))

    strength = node(unreal.MaterialExpressionScalarParameter, -600, 180)
    strength.set_editor_property("parameter_name", "EmissiveStrength")
    strength.set_editor_property("default_value", 1.0)

    lit = node(unreal.MaterialExpressionMultiply, -320, 60)
    lib.connect_material_expressions(colour, "", lit, "A")
    lib.connect_material_expressions(strength, "", lit, "B")
    lib.connect_material_property(lit, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)

    # An unlit material ignores base colour, but the runtime sets it by name on every glow MID and a parameter
    # that does not exist is a silent no-op rather than an error -- so it is exposed and left unconnected,
    # which keeps that code honest instead of quietly doing nothing.
    base = node(unreal.MaterialExpressionVectorParameter, -600, 340)
    base.set_editor_property("parameter_name", "BaseColor")
    base.set_editor_property("default_value", unreal.LinearColor(1.0, 0.78, 0.16, 1.0))

    emissive = node(unreal.MaterialExpressionVectorParameter, -600, 500)
    emissive.set_editor_property("parameter_name", "EmissiveColor")
    emissive.set_editor_property("default_value", unreal.LinearColor(1.0, 0.78, 0.16, 1.0))

    lib.recompile_material(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)

    reread = unreal.load_asset(MASTER)
    RESULT["asset"] = MASTER
    RESULT["nodes"] = made
    RESULT["exists"] = reread is not None
    RESULT["shading_model"] = str(reread.get_editor_property("shading_model")) if reread else "?"
    RESULT["status"] = "built" if reread is not None else "FAIL: it did not survive the save"
    yield 0.1
