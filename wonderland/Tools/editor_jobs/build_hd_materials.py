# Editor job: MQ01 -- import the HD texture sets and build the HD surface master and its instances.
#
# Nothing existing is changed: the master is new (/Game/WonderlandV2/Materials/M_V2_SurfaceHD), the textures are new
# (/Game/WonderlandV2/Textures/HD) and every instance is a NEW asset named MI_V2HD_<name>, a copy of the V2 instance's
# values on the HD master with the HD maps. A PIE job (hd_material_ab.py) swaps them onto the PIE copy of the world for
# comparison; persisting a winner is a separate, reviewed step.
#
# THE HD MASTER, beyond M_V2_Surface (world triplanar, BaseColor x albedo, roughness map with RoughVary):
#   NormalStrength / DetailScale / DetailStrength  the base normal can be pushed or calmed, and a second sample of the
#                                                  same normal map at DetailScale x the frequency adds fine relief
#   InstVary / InstWarm / InstRoughVary            every object -- every INSTANCE of a batch, since ObjectPositionWS is
#                                                  per instance -- gets its own brightness, warmth and roughness from a
#                                                  hash of its position: paving laid stone by stone
#   Macro / MacroScale / MacroVary                 a low-frequency world map (~60 m) breaks repetition in albedo and
#                                                  roughness across a plaza or a wall
# Globals: TEX_DIR (the generated PNGs), FORCE (rebuild the master and instances).
import json
import os

TEX_DIR = globals().get("TEX_DIR", r"C:/dev/iwonder/recovery/textures_hd")
FORCE = globals().get("FORCE", False)
TEX_DEST = "/Game/WonderlandV2/Textures/HD"
MAT_DEST = "/Game/WonderlandV2/Materials"
INST_DEST = "/Game/WonderlandV2/Materials/Instances"
MASTER = "M_V2_SurfaceHD"
# the V2 albedos were neutralised to a linear mean of ~0.92; the HD set to 0.72 (hd_textures.json), so tints scale up
TINT_GAIN = 0.92 / 0.72

# V2 instance -> (HD family, HD overrides). Everything not overridden is copied from the V2 instance.
PLAN = {
    "MI_V2_PlazaCream": ("limestone", {"TexScale": 0.0025}),
    "MI_V2_PlazaWarm": ("limestone", {"TexScale": 0.0025}),
    "MI_V2_PlazaGrey": ("limestone", {"TexScale": 0.0025}),
    "MI_V2_PlazaShade": ("limestone", {"TexScale": 0.0025}),
    "MI_V2_PathStone": ("limestone", {"TexScale": 0.0025}),
    "MI_V2_PathWarm": ("limestone", {"TexScale": 0.0025}),
    "MI_V2_PathPale": ("limestone", {"TexScale": 0.0025}),
    "MI_V2_Kerb": ("limestone", {"TexScale": 0.003}),
    "MI_V2_MarbleBlush": ("ivory", {"TexScale": 0.004}),
    "MI_V2_MarbleCool": ("ivory", {"TexScale": 0.004}),
    "MI_V2_Cobble": ("cobble", {"TexScale": 0.0018, "NormalStrength": 1.2}),
    "MI_V2_CobbleHero": ("cobble", {"TexScale": 0.0018, "NormalStrength": 1.2}),
    "MI_V2_IvoryStone": ("ivory", {"TexScale": 0.004}),
    "MI_V2_MarblePale": ("ivory", {"TexScale": 0.004}),
    "MI_V2_Stone": ("limestone", {"TexScale": 0.003}),
    "MI_V2_Gold": ("gold", {"TexScale": 0.006, "Roughness": 1.0, "RoughVary": 1.0, "Metallic": 1.0, "Specular": 0.5,
                            "NormalStrength": 0.6, "DetailStrength": 0.1, "InstVary": 0.03, "InstWarm": 0.015, "MacroVary": 0.02}),
    "MI_V2_GoldAged": ("gold", {"TexScale": 0.006, "Roughness": 1.3, "RoughVary": 1.0, "Metallic": 0.9, "Specular": 0.5,
                                "NormalStrength": 0.8, "DetailStrength": 0.1, "InstVary": 0.04, "InstWarm": 0.02}),
    "MI_V2_RoofRose": ("roof", {"TexScale": 0.004}),
    "MI_V2_RoofLilac": ("roof", {"TexScale": 0.004}),
    "MI_V2_RoofPink": ("roof", {"TexScale": 0.004}),
    "MI_V2_RoofBlue": ("roof", {"TexScale": 0.004}),
    "MI_V2_RoofNavy": ("roof", {"TexScale": 0.004}),
}
HD_DEFAULTS = {"NormalStrength": 1.0, "DetailScale": 4.0, "DetailStrength": 0.35, "InstVary": 0.08, "InstWarm": 0.03,
               "InstRoughVary": 0.10, "MacroScale": 0.00016, "MacroVary": 0.07}


def _import_textures(log):
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    tasks = []
    for fn in sorted(os.listdir(TEX_DIR)):
        if not fn.endswith(".png"):
            continue
        stem = fn[:-4]
        if eal.does_asset_exist(TEX_DEST + "/" + stem) and not FORCE:
            continue
        t = unreal.AssetImportTask()
        t.set_editor_property("filename", os.path.join(TEX_DIR, fn))
        t.set_editor_property("destination_path", TEX_DEST)
        t.set_editor_property("destination_name", stem)
        t.set_editor_property("automated", True)
        t.set_editor_property("save", False)
        t.set_editor_property("replace_existing", True)
        tasks.append((stem, t))
    if tasks:
        tools.import_asset_tasks([t for _, t in tasks])
    out = {}
    for fn in sorted(os.listdir(TEX_DIR)):
        if not fn.endswith(".png"):
            continue
        stem = fn[:-4]
        tex = unreal.load_asset(TEX_DEST + "/" + stem)
        if tex is None:
            log.append("texture did not import: " + stem)
            continue
        if stem.endswith("_n"):
            tex.set_editor_property("srgb", False)
            tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        elif stem.endswith("_r"):
            tex.set_editor_property("srgb", False)
            tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_GRAYSCALE)
        elif stem == "T_HD_macro":
            tex.set_editor_property("srgb", False)
            tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
        else:
            tex.set_editor_property("srgb", True)
        eal.save_asset(TEX_DEST + "/" + stem, only_if_is_dirty=False)
        out[stem] = tex
    return out


def _build_master(texs, log):
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    eal = unreal.EditorAssetLibrary
    path = MAT_DEST + "/" + MASTER
    if eal.does_asset_exist(path):
        if not FORCE:
            return unreal.load_asset(path)
        eal.delete_asset(path)
    m = tools.create_asset(MASTER, MAT_DEST, unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property("used_with_instanced_static_meshes", True)

    def node(cls, x, y):
        return mel.create_material_expression(m, cls, x, y)

    def link(a, b, pin=""):
        mel.connect_material_expressions(a, "", b, pin)

    def scalar(name, default, y):
        e = node(unreal.MaterialExpressionScalarParameter, -2200, y)
        e.set_editor_property("parameter_name", name)
        e.set_editor_property("default_value", default)
        return e

    def const(v, x, y):
        e = node(unreal.MaterialExpressionConstant, x, y)
        e.set_editor_property("r", v)
        return e

    def op(cls, a, b, x, y):
        e = node(cls, x, y)
        link(a, e, "A")
        link(b, e, "B")
        return e

    def mask(src, r, g, b, x, y):
        e = node(unreal.MaterialExpressionComponentMask, x, y)
        e.set_editor_property("r", r)
        e.set_editor_property("g", g)
        e.set_editor_property("b", b)
        link(src, e)
        return e

    def tex_param(name, sampler, stem, x, y):
        e = node(unreal.MaterialExpressionTextureSampleParameter2D, x, y)
        e.set_editor_property("parameter_name", name)
        e.set_editor_property("texture", texs[stem])
        e.set_editor_property("sampler_type", getattr(unreal.MaterialSamplerType, sampler))
        return e

    # world uvw and triplanar weights (as M_V2_Surface, power 4)
    wpos = node(unreal.MaterialExpressionWorldPosition, -2600, 0)
    tex_scale = scalar("TexScale", 0.004, -40)
    uvw = op(unreal.MaterialExpressionMultiply, wpos, tex_scale, -2400, 0)
    det_scale = scalar("DetailScale", HD_DEFAULTS["DetailScale"], 60)
    uvw_d = op(unreal.MaterialExpressionMultiply, uvw, det_scale, -2400, 120)
    nrm_ws = node(unreal.MaterialExpressionVertexNormalWS, -2600, 300)
    absn = node(unreal.MaterialExpressionAbs, -2450, 300)
    link(nrm_ws, absn)
    pw = node(unreal.MaterialExpressionPower, -2300, 300)
    link(absn, pw, "Base")
    link(const(4.0, -2450, 380), pw, "Exp")
    ones = node(unreal.MaterialExpressionConstant3Vector, -2300, 420)
    ones.set_editor_property("constant", unreal.LinearColor(1, 1, 1, 1))
    wsum = op(unreal.MaterialExpressionDotProduct, pw, ones, -2150, 360)
    wn = op(unreal.MaterialExpressionDivide, pw, wsum, -2000, 320)
    wx, wy, wz = mask(wn, True, False, False, -1850, 280), mask(wn, False, True, False, -1850, 340), mask(wn, False, False, True, -1850, 400)

    def triplanar(name, sampler, stem, src_uvw, y):
        planes = ((mask(src_uvw, False, True, True, -1850, y), wx), (mask(src_uvw, True, False, True, -1850, y + 60), wy),
                  (mask(src_uvw, True, True, False, -1850, y + 120), wz))
        acc = None
        for k, (uv, w) in enumerate(planes):
            s = tex_param(name, sampler, stem, -1650, y + 60 * k)
            link(uv, s, "UVs")
            mul = op(unreal.MaterialExpressionMultiply, s, w, -1450, y + 60 * k)
            acc = mul if acc is None else op(unreal.MaterialExpressionAdd, acc, mul, -1300, y + 60 * k)
        return acc

    fam = "limestone"
    alb = triplanar("Albedo", "SAMPLERTYPE_COLOR", "T_HD_%s_a" % fam, uvw, -900)
    nb = triplanar("Normal", "SAMPLERTYPE_NORMAL", "T_HD_%s_n" % fam, uvw, -600)
    nd = triplanar("Normal", "SAMPLERTYPE_NORMAL", "T_HD_%s_n" % fam, uvw_d, -300)
    rmap = triplanar("RoughnessMap", "SAMPLERTYPE_LINEAR_GRAYSCALE", "T_HD_%s_r" % fam, uvw, 0)

    # normal: base xy * NormalStrength + detail xy * DetailStrength, base z, normalised
    n_str = scalar("NormalStrength", HD_DEFAULTS["NormalStrength"], 520)
    d_str = scalar("DetailStrength", HD_DEFAULTS["DetailStrength"], 580)
    nxy = op(unreal.MaterialExpressionMultiply, mask(nb, True, True, False, -1100, -600), n_str, -950, -600)
    dxy = op(unreal.MaterialExpressionMultiply, mask(nd, True, True, False, -1100, -300), d_str, -950, -300)
    sxy = op(unreal.MaterialExpressionAdd, nxy, dxy, -800, -450)
    app = node(unreal.MaterialExpressionAppendVector, -650, -450)
    link(sxy, app, "A")
    link(mask(nb, False, False, True, -800, -380), app, "B")
    nrm = node(unreal.MaterialExpressionNormalize, -500, -450)
    link(app, nrm)
    mel.connect_material_property(nrm, "", unreal.MaterialProperty.MP_NORMAL)

    # per-object / per-instance hash from ObjectPositionWS
    opos = node(unreal.MaterialExpressionObjectPositionWS, -2600, 700)
    p = op(unreal.MaterialExpressionMultiply, opos, const(0.00731, -2600, 780), -2450, 700)
    pf = node(unreal.MaterialExpressionFrac, -2300, 700)
    link(p, pf)
    k3 = node(unreal.MaterialExpressionConstant3Vector, -2300, 780)
    k3.set_editor_property("constant", unreal.LinearColor(127.1, 311.7, 74.7, 1))
    dot = op(unreal.MaterialExpressionDotProduct, pf, k3, -2150, 720)
    sn = node(unreal.MaterialExpressionSine, -2000, 720)
    sn.set_editor_property("period", 6.283185)
    link(dot, sn)
    h1 = node(unreal.MaterialExpressionFrac, -1700, 720)
    link(op(unreal.MaterialExpressionMultiply, sn, const(43758.5453, -2000, 800), -1850, 720), h1)
    h2 = node(unreal.MaterialExpressionFrac, -1700, 800)
    link(op(unreal.MaterialExpressionMultiply, h1, const(17.13, -1850, 860), -1850, 800), h2)
    half = const(0.5, -1700, 880)
    two = const(2.0, -1700, 940)
    one = const(1.0, -1700, 1000)

    def centred(h, amount, x, y):
        """1 + (h - 0.5) * 2 * amount"""
        c = op(unreal.MaterialExpressionSubtract, h, half, x, y)
        c = op(unreal.MaterialExpressionMultiply, c, two, x + 150, y)
        c = op(unreal.MaterialExpressionMultiply, c, amount, x + 300, y)
        return op(unreal.MaterialExpressionAdd, c, one, x + 450, y)

    inst_vary = scalar("InstVary", HD_DEFAULTS["InstVary"], 1060)
    inst_warm = scalar("InstWarm", HD_DEFAULTS["InstWarm"], 1120)
    inst_rough = scalar("InstRoughVary", HD_DEFAULTS["InstRoughVary"], 1180)
    bright = centred(h1, inst_vary, -1500, 1060)
    warm_c = centred(h2, inst_warm, -1500, 1120)              # 1 + w
    cool_c = op(unreal.MaterialExpressionSubtract, two, warm_c, -900, 1120)    # 1 - w
    rg = node(unreal.MaterialExpressionAppendVector, -750, 1100)
    link(warm_c, rg, "A")
    link(one, rg, "B")
    warmvec = node(unreal.MaterialExpressionAppendVector, -600, 1100)
    link(rg, warmvec, "A")
    link(cool_c, warmvec, "B")

    # macro variation (world XY, not triplanar: large-scale breakup only)
    macro_scale = scalar("MacroScale", HD_DEFAULTS["MacroScale"], 1300)
    muv = op(unreal.MaterialExpressionMultiply, mask(wpos, True, True, False, -2450, 1300), macro_scale, -2300, 1300)
    msmp = tex_param("Macro", "SAMPLERTYPE_MASKS", "T_HD_macro", -2100, 1300)
    link(muv, msmp, "UVs")
    macro_vary = scalar("MacroVary", HD_DEFAULTS["MacroVary"], 1400)
    m_alb = centred(mask(msmp, True, False, False, -1900, 1300), macro_vary, -1750, 1300)
    m_rgh = centred(mask(msmp, False, True, False, -1900, 1380), macro_vary, -1750, 1380)

    tint = node(unreal.MaterialExpressionVectorParameter, -1100, -1000)
    tint.set_editor_property("parameter_name", "BaseColor")
    tint.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
    base = op(unreal.MaterialExpressionMultiply, tint, alb, -950, -950)
    base = op(unreal.MaterialExpressionMultiply, base, bright, -800, -950)
    base = op(unreal.MaterialExpressionMultiply, base, warmvec, -650, -950)
    base = op(unreal.MaterialExpressionMultiply, base, m_alb, -500, -950)
    mel.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)

    rough = scalar("Roughness", 0.7, 100)
    vary = scalar("RoughVary", 0.5, 160)
    lerp = node(unreal.MaterialExpressionLinearInterpolate, -1100, 60)
    link(one, lerp, "A")
    link(rmap, lerp, "B")
    link(vary, lerp, "Alpha")
    r = op(unreal.MaterialExpressionMultiply, rough, lerp, -950, 60)
    r = op(unreal.MaterialExpressionMultiply, r, centred(h2, inst_rough, -1500, 1240), -800, 60)
    r = op(unreal.MaterialExpressionMultiply, r, m_rgh, -650, 60)
    mel.connect_material_property(r, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(scalar("Metallic", 0.0, 220), "", unreal.MaterialProperty.MP_METALLIC)
    mel.connect_material_property(scalar("Specular", 0.4, 280), "", unreal.MaterialProperty.MP_SPECULAR)
    emi = node(unreal.MaterialExpressionVectorParameter, -1100, 400)
    emi.set_editor_property("parameter_name", "Emissive")
    emi.set_editor_property("default_value", unreal.LinearColor(0, 0, 0, 1))
    e = op(unreal.MaterialExpressionMultiply, emi, scalar("EmissiveStrength", 0.0, 460), -950, 400)
    mel.connect_material_property(op(unreal.MaterialExpressionMultiply, e, alb, -800, 400), "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    return m


def _make_instances(master, texs, log):
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    eal = unreal.EditorAssetLibrary
    made = {}
    for v2, (fam, over) in PLAN.items():
        src = unreal.load_asset("%s/%s.%s" % (INST_DEST, v2, v2))
        if src is None:
            log.append("no V2 instance " + v2)
            continue
        name = v2.replace("MI_V2_", "MI_V2HD_")
        path = INST_DEST + "/" + name
        if eal.does_asset_exist(path):
            if not FORCE:
                made[v2] = name
                continue
            eal.delete_asset(path)
        mi = tools.create_asset(name, INST_DEST, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, master)
        values = {}
        for p in mel.get_scalar_parameter_names(src):
            values[str(p)] = mel.get_material_instance_scalar_parameter_value(src, p)
        values.update(HD_DEFAULTS)
        values.update(over)
        for k, v in values.items():
            mel.set_material_instance_scalar_parameter_value(mi, k, float(v))
        for p in mel.get_vector_parameter_names(src):
            c = mel.get_material_instance_vector_parameter_value(src, p)
            if str(p) == "BaseColor":
                c = unreal.LinearColor(c.r * TINT_GAIN, c.g * TINT_GAIN, c.b * TINT_GAIN, 1.0)
            mel.set_material_instance_vector_parameter_value(mi, p, c)
        for slot, suffix in (("Albedo", "a"), ("Normal", "n"), ("RoughnessMap", "r")):
            mel.set_material_instance_texture_parameter_value(mi, slot, texs["T_HD_%s_%s" % (fam, suffix)])
        mel.set_material_instance_texture_parameter_value(mi, "Macro", texs["T_HD_macro"])
        mel.update_material_instance(mi)
        eal.save_asset(path, only_if_is_dirty=False)
        made[v2] = name
    return made


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    log = []
    texs = _import_textures(log)
    RESULT["textures"] = sorted(texs)
    yield 1.0
    master = _build_master(texs, log)
    RESULT["master"] = master.get_path_name() if master else None
    yield 2.0
    RESULT["instances"] = _make_instances(master, texs, log)
    RESULT["log"] = log
    RESULT["status"] = "done"
