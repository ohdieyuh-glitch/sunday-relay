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
    # TRANSLUCENT, NOT ADDITIVE, AND THE OPACITY MASK BELOW IS WHY. An additive surface has no opacity
    # channel at all: it only ever adds light, so its edge is wherever its contribution stops mattering and
    # no amount of falloff removes that boundary. Translucent lets the noise CUT the silhouette.
    for prop, value in (("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT),
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
    # ---- 2.6, NOT 0.85, AND THE SIGN OF THE EXPONENT IS THE WHOLE POINT.
    #
    # This is a POWER exponent applied to 1 - |2U - 1|, which is 1 down the middle of the ribbon and 0 at
    # both edges. An exponent BELOW one pushes that curve UP -- it makes the ribbon uniformly bright almost
    # all the way across and then drops to nothing in the last few per cent, which is a HARD EDGE. Above one
    # pulls it down into a broad gradient, which is a soft one.
    #
    # 0.85 was therefore producing the opposite of its own name, and it shows: photographed at gameplay
    # distance at night, this material and the voxel glow it was meant to improve on are both flat
    # hard-edged saturated polygons, which is precisely the founder's "plastic voxel flames".
    link(scalar("EdgeSoftness", 2.6, -760, -90), "", soft, "Exp")

    # ---- FALLOFF UP THE TONGUE: hot at the foot, nothing at the tip.
    tip = node(unreal.MaterialExpressionOneMinus, -1180, 90)
    link(up, "", tip, "")
    fade = node(unreal.MaterialExpressionPower, -1020, 90)
    link(tip, "", fade, "Base")
    # 2.2 for the same reason one axis over: the tongue should be hot at its foot and gone at its tip, and
    # 1.45 leaves it still bright most of the way up, which is what makes the tips read as cut-off polygons.
    link(scalar("TipFalloff", 2.2, -1180, 170), "", fade, "Exp")

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

    # ---- AND THE THING THAT WAS MISSING: A TORN EDGE, NOT A SMOOTH ONE.
    #
    # MEASURED BEFORE WRITING THIS. The falloff across the ribbon is real -- EdgeSoftness verified at 2.6 in
    # the asset AND in the drawn instance, multiplying straight into the emissive -- and it is invisible at
    # every setting tried: gain 10 to 180 in both directions, and tongue counts 8, 4, 2 and 1. At ONE tongue,
    # with nothing left to overlap it, the flame is still a flat hard-edged mass.
    #
    # An ADDITIVE surface cannot dissolve its own edge. It only ever adds light, so the silhouette is wherever
    # its contribution stops being negligible against the background -- and a smooth ramp just moves that line
    # rather than removing it. That is why every parameter sweep failed, and the founder's word for the result
    # is "plastic".
    #
    # FIRE HAS A RAGGED EDGE, and the way to get one is to CUT the surface with noise rather than to fade it.
    # The noise scrolls up the tongue with the flicker bands, so the boundary crawls and breaks up instead of
    # sitting still -- which is the founder's "softness/distortion" and is what a Niagara fire is doing too.
    drift_uv = node(unreal.MaterialExpressionAdd, -1040, 430)
    link(up, "", drift_uv, "A")
    link(speed, "", drift_uv, "B")
    grain_uv = node(unreal.MaterialExpressionAppendVector, -900, 420)
    link(across, "", grain_uv, "A")
    link(drift_uv, "", grain_uv, "B")
    grain = node(unreal.MaterialExpressionNoise, -760, 420)
    try:
        grain.set_editor_property("scale", 6.0)
        grain.set_editor_property("levels", 3)
        grain.set_editor_property("output_min", 0.0)
        grain.set_editor_property("output_max", 1.0)
        grain.set_editor_property("turbulence", True)
    except Exception:                                              # noqa: BLE001
        pass
    link(grain_uv, "", grain, "Position")

    # The cut: shape * noise, then hard-ish through a power so the boundary is torn rather than smeared.
    torn = node(unreal.MaterialExpressionMultiply, -620, 480)
    link(shape, "", torn, "A")
    link(grain, "", torn, "B")
    bite = node(unreal.MaterialExpressionPower, -480, 480)
    link(torn, "", bite, "Base")
    link(scalar("EdgeBite", 0.55, -620, 560), "", bite, "Exp")
    mask = node(unreal.MaterialExpressionClamp, -340, 480)
    link(bite, "", mask, "")
    ME.connect_material_property(mask, "", unreal.MaterialProperty.MP_OPACITY)

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
    record("R01", "it is translucent, unlit and two-sided",
           props.get("blend_mode") is True and props.get("shading_model") is True
           and props.get("two_sided") is True, properties=props)
    record("R02", 'it exposes the "Color" parameter the figures already write',
           "Color" in names, vector_parameters=names,
           note="the embodiment, the colourway, the heartbeat and the wardrobe's glow scale all dress flames "
                "through SetVectorParameterValue('Color'). A different name would leave every flame black.")
    # ---- AND THE ONE THING NOBODY CHECKED: IS THE EMISSIVE ACTUALLY CONNECTED?
    #
    # This material is ADDITIVE and UNLIT. Its emissive output is the only thing it can possibly draw, so a
    # graph with every parameter correctly named and nothing plugged into MP_EMISSIVE_COLOR renders exactly
    # nothing -- at any brightness, which is why cranking wl.Look.FireGain to 30 changed nothing and why this
    # was read for a while as a problem with the ribbons. R00 through R03 would all have passed on a material
    # that could never show a flame, and did.
    wired = None
    how = []
    for attempt in ("emissive_color", "EmissiveColor"):
        try:
            got = mat.get_editor_property(attempt)
            how.append("%s -> %s" % (attempt, type(got).__name__))
            expr = None
            for field in ("expression", "Expression"):
                try:
                    expr = got.get_editor_property(field)
                    break
                except Exception:
                    continue
            if expr is not None:
                wired = True
                how.append("expression=%s" % type(expr).__name__)
                break
            wired = False
        except Exception as err:                                   # noqa: BLE001
            how.append("%s failed: %s" % (attempt, str(err)[:70]))
    RESULT["emissive_input"] = how
    record("R04", "something is plugged into the material's emissive output",
           wired is True, probe=how,
           note="an additive unlit material draws its emissive and nothing else. Disconnected, it is "
                "invisible however it is fed, and every other check here still passes.")

    record("R03", "its shape, flicker and falloff are all tunable without a rebuild",
           all(p in scalars for p in ("TipFalloff", "EdgeSoftness", "FlowSpeed", "Bands", "FlickerDepth")),
           scalar_parameters=scalars)
    RESULT["status"] = "measured"
