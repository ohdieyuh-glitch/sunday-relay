# A REAL FIRE MATERIAL, BECAUSE THE RIBBONS ARE ALREADY THE RIGHT SHAPE AND THE WRONG SURFACE.
#
# FOUNDER, P0 item 4: "Arden Infernal and Skeleton Flame need believable animated Unreal fire, not plastic
# voxel flames ... flicker, emissive falloff, softness/distortion, proper attachment."
#
# THE GEOMETRY HALF IS ALREADY DONE. AWonderlandCompanionEmbodiment::RebuildFlames stopped emitting stacked
# cubes some time ago: every part a figure tags `twinkle` now emits five crossed, tapered ribbons that lick
# upward on a three-octave flicker and taper to nothing at the tip, rebuilt every frame. What has been missing
# is the SURFACE. Those ribbons are painted in the figure's own glow material -- opaque, unlit, flat colour --
# so a beautifully shaped tongue of flame is drawn as a hard-edged coloured card. That is the "plastic".
#
# Everything this material needs is already in the mesh: RebuildFlames writes UVs with V running 0 at the foot
# of each tongue to 1 at its tip, and U running across the ribbon. So:
#
#   FALLOFF     hot at the foot, gone at the tip           (1 - V) shaped
#   SOFTNESS    no hard edge down either side of a ribbon  1 - |2U - 1|, shaped
#   FLICKER     structure moving up through the flame      a band that scrolls in V on Time
#   DISTORTION  the bands lean as they climb               the band is skewed by U
#
# NO TEXTURE LOOKUP AND NO NOISE NODE. Both cost more than this needs and neither would survive on the tier
# of machine Wonderland has to hold 60 fps on; sines of the interpolated UVs give moving internal structure
# for a handful of instructions.
#
# THE PARAMETER IS CALLED "Color" ON PURPOSE. The embodiment dresses every flame instance through
# SetVectorParameterValue("Color"), and so do the colourway, the heartbeat and the wardrobe's glow scale. A
# parameter by any other name would leave every flame black and look like a different bug entirely.
CONCURRENT = True

import unreal

PACKAGE = "/Game/Wonderland/Materials"
NAME = "M_WL_Fire"
PATH = PACKAGE + "/" + NAME
ME = unreal.MaterialEditingLibrary


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
        record("R00", "the project has its own fire material", False, path=PATH)
        RESULT["status"] = "FAIL"
        return
    RESULT["created"] = made

    # A clean slate every run, so re-running this is idempotent rather than additive.
    try:
        ME.delete_all_material_expressions(mat)
    except Exception:
        pass
    yield 0.3

    props = {}
    for prop, value in (("blend_mode", unreal.BlendMode.BLEND_ADDITIVE),
                        ("shading_model", unreal.MaterialShadingModel.MSM_UNLIT),
                        # BOTH SIDES. A tongue of flame seen from behind must not vanish, and the ribbons are
                        # single sheets -- the geometry already duplicates its triangles for this, and the
                        # material has to agree or half of them are culled anyway.
                        ("two_sided", True),
                        # Flames never occlude and never receive; writing depth would make a ribbon cut a hole
                        # in the fire behind it, which is the other half of what reads as plastic.
                        ("used_with_instanced_static_meshes", True),
                        ("used_with_static_lighting", False)):
        try:
            mat.set_editor_property(prop, value)
            props[prop] = True
        except Exception as err:                                   # noqa: BLE001
            props[prop] = str(err)[:90]
    RESULT["properties"] = props
    yield 0.3

    def node(kind, x, y):
        return ME.create_material_expression(mat, kind, x, y)

    def scalar(name, value, x, y):
        n = node(unreal.MaterialExpressionScalarParameter, x, y)
        n.set_editor_property("parameter_name", name)
        n.set_editor_property("default_value", value)
        return n

    def const(value, x, y):
        n = node(unreal.MaterialExpressionConstant, x, y)
        n.set_editor_property("r", value)
        return n

    def link(a, ao, b, bi):
        ME.connect_material_expressions(a, ao, b, bi)

    # ---- THE COORDINATES THE RIBBONS ALREADY CARRY.
    uv = node(unreal.MaterialExpressionTextureCoordinate, -1500, 0)
    across = node(unreal.MaterialExpressionComponentMask, -1330, -120)
    across.set_editor_property("r", True)
    across.set_editor_property("g", False)
    up = node(unreal.MaterialExpressionComponentMask, -1330, 60)
    up.set_editor_property("r", False)
    up.set_editor_property("g", True)
    link(uv, "", across, "")
    link(uv, "", up, "")

    # ---- SOFTNESS ACROSS THE RIBBON: 1 - |2U - 1|, then shaped, so there is no edge to see.
    two_u = node(unreal.MaterialExpressionMultiply, -1180, -160)
    link(across, "", two_u, "A")
    link(const(2.0, -1330, -220), "", two_u, "B")
    centred = node(unreal.MaterialExpressionSubtract, -1040, -160)
    link(two_u, "", centred, "A")
    link(const(1.0, -1180, -230), "", centred, "B")
    away = node(unreal.MaterialExpressionAbs, -900, -160)
    link(centred, "", away, "")
    edge = node(unreal.MaterialExpressionOneMinus, -760, -160)
    link(away, "", edge, "")
    soft = node(unreal.MaterialExpressionPower, -620, -160)
    link(edge, "", soft, "Base")
    link(scalar("EdgeSoftness", 0.85, -760, -90), "", soft, "Exp")

    # ---- FALLOFF UP THE TONGUE: hot at the foot, nothing at the tip.
    tip = node(unreal.MaterialExpressionOneMinus, -1180, 90)
    link(up, "", tip, "")
    fade = node(unreal.MaterialExpressionPower, -1020, 90)
    link(tip, "", fade, "Base")
    link(scalar("TipFalloff", 1.45, -1180, 170), "", fade, "Exp")

    # ---- FLICKER: bands that scroll up through the flame, leaning as they climb.
    time = node(unreal.MaterialExpressionTime, -1500, 320)
    speed = node(unreal.MaterialExpressionMultiply, -1330, 320)
    link(time, "", speed, "A")
    link(scalar("FlowSpeed", 1.35, -1500, 400), "", speed, "B")
    bands = node(unreal.MaterialExpressionMultiply, -1330, 220)
    link(up, "", bands, "A")
    link(scalar("Bands", 3.2, -1500, 240), "", bands, "B")
    skew = node(unreal.MaterialExpressionMultiply, -1330, 140)
    link(across, "", skew, "A")
    link(scalar("Lean", 0.9, -1500, 150), "", skew, "B")
    leaning = node(unreal.MaterialExpressionAdd, -1180, 200)
    link(bands, "", leaning, "A")
    link(skew, "", leaning, "B")
    rolling = node(unreal.MaterialExpressionSubtract, -1040, 260)
    link(leaning, "", rolling, "A")
    link(speed, "", rolling, "B")
    wave = node(unreal.MaterialExpressionSine, -900, 260)
    link(rolling, "", wave, "")
    # Half a band of swing about a bright mean: structure, not strobing.
    half = node(unreal.MaterialExpressionMultiply, -760, 260)
    link(wave, "", half, "A")
    link(scalar("FlickerDepth", 0.32, -900, 340), "", half, "B")
    flicker = node(unreal.MaterialExpressionAdd, -620, 260)
    link(half, "", flicker, "A")
    link(const(0.78, -760, 330), "", flicker, "B")

    # ---- AND ALL OF IT OVER THE FIGURE'S OWN COLOUR.
    colour = node(unreal.MaterialExpressionVectorParameter, -620, -20)
    colour.set_editor_property("parameter_name", "Color")
    colour.set_editor_property("default_value", unreal.LinearColor(1.0, 0.45, 0.12, 1.0))

    shape = node(unreal.MaterialExpressionMultiply, -440, 60)
    link(soft, "", shape, "A")
    link(fade, "", shape, "B")
    lit = node(unreal.MaterialExpressionMultiply, -300, 140)
    link(shape, "", lit, "A")
    link(flicker, "", lit, "B")
    out = node(unreal.MaterialExpressionMultiply, -150, 40)
    link(colour, "", out, "A")
    link(lit, "", out, "B")
    ME.connect_material_property(out, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    yield 0.4

    ME.recompile_material(mat)
    unreal.EditorAssetLibrary.save_asset(PATH)
    yield 1.0

    names = []
    scalars = []
    try:
        names = [str(n) for n in ME.get_vector_parameter_names(mat)]
        scalars = [str(n) for n in ME.get_scalar_parameter_names(mat)]
    except Exception:
        pass
    RESULT["vector_parameters"] = names
    RESULT["scalar_parameters"] = scalars
    record("R00", "the project has its own fire material", True, path=PATH, created=made)
    record("R01", "it is additive, unlit and two-sided",
           props.get("blend_mode") is True and props.get("shading_model") is True
           and props.get("two_sided") is True, properties=props)
    record("R02", 'it exposes the "Color" parameter the figures already write',
           "Color" in names, vector_parameters=names,
           note="the embodiment, the colourway, the heartbeat and the wardrobe's glow scale all dress flames "
                "through SetVectorParameterValue('Color'). A different name would leave every flame black.")
    record("R03", "its shape, flicker and falloff are all tunable without a rebuild",
           all(p in scalars for p in ("TipFalloff", "EdgeSoftness", "FlowSpeed", "Bands", "FlickerDepth")),
           scalar_parameters=scalars)
    RESULT["status"] = "measured"
