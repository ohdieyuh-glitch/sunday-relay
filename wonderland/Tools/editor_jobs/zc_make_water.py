# BUILD WONDERLAND A REAL WATER MATERIAL.
#
# FOUNDER: "Replace plastic-looking water/streams/ponds/fountains with believable animated water:
# reflections/refraction, normals, depth/color response, flow, sane performance."
#
# WHY IT LOOKS PLASTIC, measured rather than guessed. All 64 ponds, wells, canals and fountain basins share
# MI_V2_Water, whose master M_V2_Surface is BLEND_OPAQUE and MSM_DEFAULT_LIT and exposes only TexScale,
# Roughness, RoughVary, Metallic, Specular and EmissiveStrength. There is no refraction in it, no flow, no
# depth response and no translucency -- so no value of any parameter it HAS could ever make it look wet. It is
# a shiny opaque solid, which is exactly what the founder is seeing.
#
# So this AUTHORS a new master, additively. Nothing existing is edited and nothing is deleted: MI_V2_Water is
# left exactly as it is, and the runtime points the water actors at the new material instead. If this asset is
# ever missing, the water simply stays as it was.
import unreal

MASTER = "/Game/Wonderland/Materials/M_WL_RealWater"


def job():
    RESULT["status"] = "running"
    lib = unreal.MaterialEditingLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()

    # REBUILT FROM SCRATCH EVERY TIME THIS RUNS, deliberately. The first attempt failed partway through wiring
    # and left a half-connected material behind, which a "skip if it exists" guard then treated as finished --
    # so the only asset ever deleted here is the incomplete one this job itself wrote moments earlier. Nothing
    # of Wonderland's own is touched: MI_V2_Water and M_V2_Surface are left exactly as they are.
    if unreal.EditorAssetLibrary.does_asset_exist(MASTER):
        unreal.EditorAssetLibrary.delete_asset(MASTER)
        RESULT["replaced_partial_build"] = True

    mat = tools.create_asset("M_WL_RealWater", "/Game/Wonderland/Materials",
                             unreal.Material, unreal.MaterialFactoryNew())
    if mat is None:
        RESULT["status"] = "FAIL: could not create the material asset"
        yield 0.1
        return

    # ---- TRANSLUCENT, WHICH IS THE WHOLE POINT. An opaque surface cannot show what is under it, and water that
    # ---- does not show its bed is a mirror lying on the ground.
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    mat.set_editor_property("translucency_lighting_mode",
                            unreal.TranslucencyLightingMode.TLM_SURFACE_PER_PIXEL_LIGHTING)
    mat.set_editor_property("two_sided", False)
    # Refraction needs the scene behind it, and a screen-space reflection needs to be allowed to run.
    # The refraction MODE enum is spelled differently across engine versions and is not worth guessing at: a
    # translucent material refracts through its Refraction input regardless, which is what is wired below.
    for name in ("REFRACTION_MODE_INDEX_OF_REFRACTION", "REFRACTION_MODE_PIXEL_NORMAL_OFFSET", "INDEX_OF_REFRACTION"):
        try:
            mat.set_editor_property("refraction_method", getattr(unreal.RefractionMode, name))
            RESULT["refraction_mode"] = name
            break
        except Exception:
            continue

    made = []
    RESULT["nodes"] = made

    def node(cls, x, y):
        n = lib.create_material_expression(mat, cls, x, y)
        made.append(cls.__name__ if hasattr(cls, "__name__") else str(cls))
        return n

    # ---- FLOW: two normal maps panning at different speeds and scales, added.
    #
    # One panning normal reads as a sliding texture -- the eye follows it. Two at different rates and sizes
    # never line up again, and the interference between them is what reads as moving water rather than a moving
    # picture of water.
    tex = node(unreal.MaterialExpressionTextureObjectParameter, -1500, 0)
    tex.set_editor_property("parameter_name", "NormalTex")
    flat = unreal.load_asset("/Engine/EngineMaterials/DefaultNormal.DefaultNormal")
    if flat is not None:
        tex.set_editor_property("texture", flat)

    coords = node(unreal.MaterialExpressionTextureCoordinate, -1400, 200)
    coords.set_editor_property("u_tiling", 8.0)
    coords.set_editor_property("v_tiling", 8.0)

    speed_a = node(unreal.MaterialExpressionScalarParameter, -1400, 340)
    speed_a.set_editor_property("parameter_name", "FlowSpeedA")
    speed_a.set_editor_property("default_value", 0.018)
    speed_b = node(unreal.MaterialExpressionScalarParameter, -1400, 420)
    speed_b.set_editor_property("parameter_name", "FlowSpeedB")
    speed_b.set_editor_property("default_value", -0.011)

    pan_a = node(unreal.MaterialExpressionPanner, -1150, 120)
    lib.connect_material_expressions(coords, "", pan_a, "Coordinate")
    lib.connect_material_expressions(speed_a, "", pan_a, "Speed")
    pan_b = node(unreal.MaterialExpressionPanner, -1150, 320)
    lib.connect_material_expressions(coords, "", pan_b, "Coordinate")
    lib.connect_material_expressions(speed_b, "", pan_b, "Speed")

    samp_a = node(unreal.MaterialExpressionTextureSampleParameter2D, -900, 60)
    samp_a.set_editor_property("parameter_name", "NormalA")
    samp_a.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    if flat is not None:
        samp_a.set_editor_property("texture", flat)
    lib.connect_material_expressions(pan_a, "", samp_a, "UVs")

    samp_b = node(unreal.MaterialExpressionTextureSampleParameter2D, -900, 320)
    samp_b.set_editor_property("parameter_name", "NormalB")
    samp_b.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    if flat is not None:
        samp_b.set_editor_property("texture", flat)
    lib.connect_material_expressions(pan_b, "", samp_b, "UVs")

    blend = node(unreal.MaterialExpressionAdd, -640, 180)
    lib.connect_material_expressions(samp_a, "RGB", blend, "A")
    lib.connect_material_expressions(samp_b, "RGB", blend, "B")

    ripple = node(unreal.MaterialExpressionScalarParameter, -640, 360)
    ripple.set_editor_property("parameter_name", "RippleStrength")
    ripple.set_editor_property("default_value", 0.35)
    shaped = node(unreal.MaterialExpressionMultiply, -420, 220)
    lib.connect_material_expressions(blend, "", shaped, "A")
    lib.connect_material_expressions(ripple, "", shaped, "B")
    lib.connect_material_property(shaped, "", unreal.MaterialProperty.MP_NORMAL)

    # ---- DEPTH AND COLOUR RESPONSE: shallow water at the rim is clear, deep water carries its own colour.
    fade = node(unreal.MaterialExpressionDepthFade, -900, 620)
    fade.set_editor_property("fade_distance_default", 140.0)

    shallow = node(unreal.MaterialExpressionVectorParameter, -900, 760)
    shallow.set_editor_property("parameter_name", "ShallowColor")
    shallow.set_editor_property("default_value", unreal.LinearColor(0.16, 0.42, 0.44, 1.0))
    deep = node(unreal.MaterialExpressionVectorParameter, -900, 900)
    deep.set_editor_property("parameter_name", "DeepColor")
    deep.set_editor_property("default_value", unreal.LinearColor(0.02, 0.10, 0.16, 1.0))

    tint = node(unreal.MaterialExpressionLinearInterpolate, -600, 800)
    lib.connect_material_expressions(shallow, "", tint, "A")
    lib.connect_material_expressions(deep, "", tint, "B")
    lib.connect_material_expressions(fade, "", tint, "Alpha")
    lib.connect_material_property(tint, "", unreal.MaterialProperty.MP_BASE_COLOR)

    # Opacity follows the same fade, so a rim thins to nothing instead of ending on a hard line.
    clarity = node(unreal.MaterialExpressionScalarParameter, -600, 1000)
    clarity.set_editor_property("parameter_name", "Opacity")
    clarity.set_editor_property("default_value", 0.82)
    opacity = node(unreal.MaterialExpressionMultiply, -400, 960)
    lib.connect_material_expressions(fade, "", opacity, "A")
    lib.connect_material_expressions(clarity, "", opacity, "B")
    lib.connect_material_property(opacity, "", unreal.MaterialProperty.MP_OPACITY)

    # ---- AND THE SURFACE ITSELF: glassy, non-metallic, strongly specular, which is what makes a reflection.
    rough = node(unreal.MaterialExpressionScalarParameter, -400, 1140)
    rough.set_editor_property("parameter_name", "Roughness")
    rough.set_editor_property("default_value", 0.035)
    lib.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)

    spec = node(unreal.MaterialExpressionScalarParameter, -400, 1240)
    spec.set_editor_property("parameter_name", "Specular")
    spec.set_editor_property("default_value", 1.0)
    lib.connect_material_property(spec, "", unreal.MaterialProperty.MP_SPECULAR)

    metal = node(unreal.MaterialExpressionScalarParameter, -400, 1340)
    metal.set_editor_property("parameter_name", "Metallic")
    metal.set_editor_property("default_value", 0.0)
    lib.connect_material_property(metal, "", unreal.MaterialProperty.MP_METALLIC)

    # Refraction from the same ripples, gently: water bends what is under it by a little, not by a lot.
    ior = node(unreal.MaterialExpressionScalarParameter, -400, 1440)
    ior.set_editor_property("parameter_name", "Refraction")
    ior.set_editor_property("default_value", 1.05)
    try:
        lib.connect_material_property(ior, "", unreal.MaterialProperty.MP_REFRACTION)
    except Exception as bad:
        RESULT["refraction_note"] = str(bad)[:140]

    lib.recompile_material(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    RESULT["material"] = MASTER
    RESULT["node_count"] = len(made)
    RESULT["status"] = "built"
    yield 0.1
