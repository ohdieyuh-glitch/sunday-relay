"""The V2 material language — new masters under /Game/WonderlandV2/Materials.

Nothing here references a V1 material. The texture sets come from V1's
synthesiser (`infra/build/gen-textures.py`, engineering) imported under the V2
root; the graphs are new and deliberately small:

    M_V2_Surface   base colour map x tint, normal map, roughness map x scalar
                   with a per-instance roughness variation, metallic scalar,
                   specular scalar, optional emissive (portal only)
    M_V2_Foliage   two-sided, subsurface-tinted, same maps, darker default
    M_V2_Portal    unlit-ish emissive runes: colour x strength, masked by the
                   rune map's alpha so the glow IS the runes
    M_V2_SkyDome   unlit, "is sky" (excluded from fog/aerial perspective),
                   equirectangular panorama, masked below the horizon so our
                   own ground shows

The per-instance values were measured from the reference by pixel population
(see the table in `hd/HD-PIPELINE.md`): cream-pink walls 1:0.86:0.94, warm
cobble 1:0.68:0.64, gold 1:0.70:0.38, cap red with G == B, near-black foliage.
"""

import json
import math
import os

import v2_config as C

#: name -> (family, base tint, metallic, roughness, rough_vary, specular, emissive, emissive_strength)
INSTANCES = {
    # ---- stone: cream and pale grey, warm variation, never white -------------
    "MI_V2_IvoryStone": ("plaster", (0.74, 0.70, 0.62), 0.0, 0.58, 0.50, 0.32, None, 0.0),
    "MI_V2_Stone":      ("ashlar",  (0.50, 0.46, 0.41), 0.0, 0.82, 0.80, 0.30, None, 0.0),
    "MI_V2_PlazaCream": ("plaza",   (0.70, 0.66, 0.57), 0.0, 0.74, 0.85, 0.30, None, 0.0),
    "MI_V2_PlazaGrey":  ("plaza",   (0.54, 0.55, 0.51), 0.0, 0.76, 0.85, 0.30, None, 0.0),
    # PASS 01: a warmer cream so the running bond carries three tints in a
    # blotch, and a cream kerb a hair darker than the slabs.
    "MI_V2_PlazaWarm":  ("plaza",   (0.72, 0.65, 0.52), 0.0, 0.74, 0.85, 0.30, None, 0.0),
    "MI_V2_Kerb":       ("plaza",   (0.64, 0.60, 0.52), 0.0, 0.70, 0.75, 0.30, None, 0.0),
    # the central path in the founder's view is PALE grey-blue stone, a step
    # cooler and a touch darker than the cream plaza -- not a dark road
    # PASS 01b: the reference path is a warm dark grey-brown. The `pathstone`
    # sheet is a whole tile of bright faces AND dark mortar, and a single flag
    # mesh shows only the faces, so the mean-corrected tint rendered pale; the
    # near-uniform plaza sheet delivers the tint as the flag's actual albedo.
    "MI_V2_PathStone":  ("plaza",   (0.30, 0.28, 0.25), 0.0, 0.80, 0.85, 0.30, None, 0.0),
    "MI_V2_Cobble":     ("cobble",  (0.36, 0.30, 0.26), 0.0, 0.78, 0.90, 0.28, None, 0.0),
    "MI_V2_CobbleHero": ("cobble",  (0.33, 0.31, 0.28), 0.0, 0.74, 0.90, 0.30, None, 0.0),
    "MI_V2_Moss":       ("sward",   (0.12, 0.20, 0.08), 0.0, 0.82, 0.60, 0.20, None, 0.0),
    "MI_V2_Lawn":       ("sward",   (0.17, 0.30, 0.10), 0.0, 0.86, 0.60, 0.20, None, 0.0),
    "MI_V2_Soil":       ("sward",   (0.20, 0.15, 0.10), 0.0, 0.90, 0.50, 0.15, None, 0.0),
    # ---- gold: metallic, restrained, aged in the recesses ---------------------
    "MI_V2_Gold":       ("metal",   (0.92, 0.70, 0.36), 0.90, 0.42, 0.45, 0.60, None, 0.0),
    # ---- roofs: muted pink, some dark navy caps, gold finials -----------------
    "MI_V2_RoofPink":   ("roof",    (0.64, 0.40, 0.42), 0.0, 0.64, 0.60, 0.30, None, 0.0),
    "MI_V2_RoofRose":   ("roof",    (0.56, 0.34, 0.37), 0.0, 0.66, 0.60, 0.30, None, 0.0),
    "MI_V2_RoofLilac":  ("roof",    (0.52, 0.44, 0.62), 0.0, 0.64, 0.60, 0.30, None, 0.0),
    "MI_V2_RoofBlue":   ("roof",    (0.28, 0.36, 0.62), 0.0, 0.62, 0.60, 0.30, None, 0.0),
    "MI_V2_RoofNavy":   ("roof",    (0.10, 0.12, 0.24), 0.0, 0.60, 0.60, 0.34, None, 0.0),
    "MI_V2_Bark":       ("bark",    (0.24, 0.16, 0.11), 0.0, 0.86, 1.00, 0.20, None, 0.0),
    "MI_V2_Ceramic":    ("glaze",   (0.90, 0.87, 0.82), 0.0, 0.22, 0.20, 0.55, None, 0.0),
    # ---- mushrooms: muted terracotta-pink, purple, cream --------------------
    "MI_V2_MushRed":    ("cap",     (0.58, 0.24, 0.20), 0.0, 0.54, 0.50, 0.38, None, 0.0),
    "MI_V2_MushTerracotta": ("cap", (0.60, 0.30, 0.24), 0.0, 0.56, 0.50, 0.38, None, 0.0),
    "MI_V2_MushPurple": ("cap",     (0.38, 0.22, 0.52), 0.0, 0.54, 0.50, 0.38, None, 0.0),
    "MI_V2_MushCream":  ("cap",     (0.86, 0.78, 0.64), 0.0, 0.56, 0.50, 0.38, None, 0.0),
    "MI_V2_MushStem":   ("glaze",   (0.84, 0.76, 0.64), 0.0, 0.66, 0.40, 0.30, None, 0.0),
    "MI_V2_Spot":       ("glaze",   (0.95, 0.92, 0.86), 0.0, 0.54, 0.30, 0.35, None, 0.0),
    # ---- foliage (M_V2_Foliage): readable greens, not near-black ---------------
    "MI_V2_LeafDark":   ("leaf",    (0.08, 0.16, 0.07), 0.0, 0.70, 0.60, 0.15, None, 0.0),
    "MI_V2_LeafMid":    ("leaf",    (0.14, 0.26, 0.10), 0.0, 0.66, 0.60, 0.15, None, 0.0),
    "MI_V2_LeafLight":  ("leaf",    (0.22, 0.36, 0.14), 0.0, 0.62, 0.60, 0.15, None, 0.0),
    "MI_V2_RosePink":   ("petal",   (0.88, 0.40, 0.56), 0.0, 0.60, 0.40, 0.25, None, 0.0),
    "MI_V2_RoseRed":    ("petal",   (0.70, 0.14, 0.24), 0.0, 0.60, 0.40, 0.25, None, 0.0),
    "MI_V2_PetalPink":  ("petal",   (0.90, 0.52, 0.68), 0.0, 0.62, 0.40, 0.25, None, 0.0),
    "MI_V2_PetalViolet": ("petal",  (0.50, 0.32, 0.78), 0.0, 0.62, 0.40, 0.25, None, 0.0),
    "MI_V2_PetalBlue":  ("petal",   (0.42, 0.50, 0.86), 0.0, 0.62, 0.40, 0.25, None, 0.0),
    # PASS 02: the reference beds are pink / rose / lavender / white masses.
    "MI_V2_PetalWhite": ("petal",   (0.92, 0.90, 0.84), 0.0, 0.62, 0.40, 0.25, None, 0.0),
    "MI_V2_PetalRose":  ("petal",   (0.84, 0.36, 0.48), 0.0, 0.62, 0.40, 0.25, None, 0.0),
    "MI_V2_Lavender":   ("petal",   (0.60, 0.48, 0.86), 0.0, 0.64, 0.40, 0.25, None, 0.0),
    "MI_V2_LeafGrey":   ("leaf",    (0.30, 0.38, 0.26), 0.0, 0.70, 0.60, 0.15, None, 0.0),
    # ---- portal (M_V2_Portal): restrained -------------------------------------
    "MI_V2_PortalRunes": ("runes",  (0.62, 0.40, 0.92), 0.0, 0.40, 0.0, 0.2, (0.62, 0.40, 0.92), 1.0),
    "MI_V2_PortalGlow":  ("runes",  (0.68, 0.46, 0.94), 0.0, 0.40, 0.0, 0.2, (0.68, 0.46, 0.94), 1.2),
}
FOLIAGE = ("MI_V2_LeafDark", "MI_V2_LeafMid", "MI_V2_LeafLight", "MI_V2_RosePink",
           "MI_V2_RoseRed", "MI_V2_PetalPink", "MI_V2_PetalViolet", "MI_V2_PetalBlue",
           "MI_V2_PetalWhite", "MI_V2_PetalRose", "MI_V2_Lavender", "MI_V2_LeafGrey")
PORTAL = ("MI_V2_PortalRunes", "MI_V2_PortalGlow")

#: texture family -> (albedo, normal, roughness) file stems from textures_v2.py.
#: These are NEUTRAL detail maps (linear mean ~0.92 per channel): the tint sets
#: the colour, the texture sets the structure. The shared V1 set is not used —
#: its albedos carry their own colour (ashlar mean 0.39/0.34/0.24, roof
#: 0.51/0.11/0.16) and tinting on top of that turns cream into brown.
FAMILY_FILES = {
    "plaza": ("T_V2_plaza_a", "T_V2_plaza_n", "T_V2_plaza_r"),
    "pathstone": ("T_V2_pathstone_a", "T_V2_pathstone_n", "T_V2_pathstone_r"),
    "cobble": ("T_V2_cobble_a", "T_V2_cobble_n", "T_V2_cobble_r"),
    "ashlar": ("T_V2_ashlar_a", "T_V2_ashlar_n", "T_V2_ashlar_r"),
    "plaster": ("T_V2_plaster_a", "T_V2_plaster_n", "T_V2_plaster_r"),
    "sward": ("T_V2_sward_a", "T_V2_sward_n", "T_V2_sward_r"),
    "bark": ("T_V2_bark_a", "T_V2_bark_n", "T_V2_bark_r"),
    "roof": ("T_V2_roof_a", "T_V2_roof_n", "T_V2_roof_r"),
    "metal": ("T_V2_metal_a", "T_V2_metal_n", "T_V2_metal_r"),
    "glaze": ("T_V2_glaze_a", "T_V2_glaze_n", "T_V2_glaze_r"),
    "cap": ("T_V2_cap_a", "T_V2_cap_n", "T_V2_cap_r"),
    "petal": ("T_V2_petal_a", "T_V2_petal_n", "T_V2_petal_r"),
    "leaf": ("T_V2_leafcard_a", "T_V2_leafcard_n", None),
    "runes": ("T_V2_runes_a", "T_V2_runes_n", "T_V2_runes_r"),
}
#: 1/uu per tile. plaza: 2 slabs of 130 uu per 1024 px tile -> 1/260;
#: pathstone: ~3 flags of 90 uu per 512 px tile -> 1/270.
TEX_SCALE = {"plaza": 0.0038, "pathstone": 0.0037, "cobble": 0.0034, "ashlar": 0.0026,
             "plaster": 0.0050, "sward": 0.0090, "bark": 0.0070, "roof": 0.0070,
             "metal": 0.0090, "glaze": 0.0060, "cap": 0.0060, "petal": 0.0100,
             "leaf": 0.0080, "runes": 0.0010}


def texture_means(log=None):
    """Achieved linear means per family from textures_v2.json, or {} if the
    set was not generated (then tints are used as-is and the log says so)."""
    p = os.path.join(C.TEXTURE_DIR, "textures_v2.json")
    try:
        with open(p) as fh:
            meta = json.load(fh)
    except (OSError, ValueError):
        if log:
            log("V2 TEXTURES: no textures_v2.json in %s -- tints applied without mean correction" % C.TEXTURE_DIR)
        return {}
    if meta.get("fast") and log:
        log("V2 TEXTURES: WARNING the set in %s was generated --fast (quarter size)" % C.TEXTURE_DIR)
    return {fam: rec["mean"] for fam, rec in meta.get("families", {}).items() if rec.get("neutral", True)}


def corrected_tint(fam, tint, means, log=None, name=""):
    """tint / texture mean, so texture*tint averages to the measured albedo.
    Clamped at 1.0 per channel with a log line, because a tint the texture
    cannot reach is a fact the render will show."""
    m = means.get("leafcard" if fam == "leaf" else fam)
    if not m:
        return tint
    out = []
    clipped = False
    for c in range(3):
        v = tint[c] / m[c] if m[c] > 1e-6 else tint[c]
        if v > 1.0:
            clipped = True
            v = 1.0
        out.append(v)
    if clipped and log:
        log("V2 MATERIAL %s: tint %s exceeds the texture's reach after mean correction; clamped" % (name, tuple(round(t, 2) for t in tint)))
    return tuple(out)


def import_textures(unreal, log):
    """Import the synthesised PBR sets (and the Marble panorama) under the V2 root."""
    texs = {}
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    dest = C.FOLDERS["textures"]
    wanted = set()
    for fam, stems in FAMILY_FILES.items():
        for s in stems:
            if s:
                wanted.add(s)
    files = []
    for stem in sorted(wanted):
        for ext in (".png", ".tga", ".jpg"):
            p = os.path.join(C.TEXTURE_DIR, stem + ext)
            if os.path.exists(p):
                files.append((stem, p))
                break
    if C.MARBLE_PANO and os.path.exists(C.MARBLE_PANO):
        files.append(("T_V2_SkyPano", C.MARBLE_PANO))
    tasks = []
    for stem, p in files:
        t = unreal.AssetImportTask()
        t.set_editor_property("filename", p)
        t.set_editor_property("destination_path", dest)
        t.set_editor_property("destination_name", stem)
        t.set_editor_property("automated", True)
        t.set_editor_property("save", True)
        t.set_editor_property("replace_existing", True)
        tasks.append((stem, t))
    if tasks:
        try:
            tools.import_asset_tasks([t for _, t in tasks])
        except Exception as exc:
            log("V2 TEXTURES: import_asset_tasks failed (%s)" % exc)
    for stem, _ in tasks:
        path = dest + "/" + stem
        tex = eal.load_asset(path) if eal.does_asset_exist(path) else None
        if tex is None:
            continue
        try:
            if stem.endswith("_n"):
                tex.set_editor_property("srgb", False)
                tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
            elif stem.endswith("_r") or stem.endswith("_m"):
                tex.set_editor_property("srgb", False)
                tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_GRAYSCALE)
            else:
                tex.set_editor_property("srgb", True)
            eal.save_asset(path, only_if_is_dirty=False)
        except Exception:
            pass
        texs[stem] = tex
    log("V2 TEXTURES: %d imported from %s (%d files found)%s"
        % (len(texs), C.TEXTURE_DIR, len(files), "" if C.MARBLE_PANO else "; NO Marble panorama"))
    return texs


#: A TextureSampleParameter2D with NO texture fails to compile -- the whole
#: master fails and every instance under it renders as the engine's default
#: grey checker. That is exactly what the first visible V2 render showed.
#: Every texture parameter therefore gets a default of the right sampler type:
#: the V2 set when it is imported, engine textures otherwise.
_TEX_DEFAULTS = {
    "SAMPLERTYPE_COLOR": ("T_V2_plaster_a", "/Engine/EngineResources/WhiteSquareTexture"),
    "SAMPLERTYPE_NORMAL": ("T_V2_plaster_n", "/Engine/EngineMaterials/DefaultNormal"),
    "SAMPLERTYPE_LINEAR_GRAYSCALE": ("T_V2_plaster_r", "/Engine/EngineResources/WhiteSquareTexture"),
    "SAMPLERTYPE_MASKS": ("T_V2_leafcard_m", "/Engine/EngineResources/WhiteSquareTexture"),
}


def _master(unreal, log, name, kind, texs=None):
    """Build one master. kind: surface | foliage | portal | sky."""
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    eal = unreal.EditorAssetLibrary
    pkg = C.FOLDERS["mat_master"]
    path = pkg + "/" + name
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = tools.create_asset(name, pkg, unreal.Material, unreal.MaterialFactoryNew())
    if m is None:
        raise RuntimeError("could not create " + name)
    for prop in ("used_with_instanced_static_meshes", "b_used_with_instanced_static_meshes"):
        try:
            m.set_editor_property(prop, True)
            break
        except Exception:
            continue

    def param(cls, pname, y, default, x=-900):
        e = mel.create_material_expression(m, cls, x, y)
        e.set_editor_property("parameter_name", pname)
        e.set_editor_property("default_value", default)
        return e

    def tex_param(pname, y, sampler, stem=None):
        e = mel.create_material_expression(m, unreal.MaterialExpressionTextureSampleParameter2D, -700, y)
        e.set_editor_property("parameter_name", pname)
        try:
            e.set_editor_property("sampler_type", getattr(unreal.MaterialSamplerType, sampler))
        except Exception:
            pass
        # THE DEFAULT TEXTURE IS NOT OPTIONAL. The node is born holding
        # /Engine/EngineResources/DefaultTexture, a COLOUR texture, and the
        # compiler refuses it under a Normal or Grayscale sampler:
        #   "(Node TextureSampleParameter2D) Sampler type is Normal, should be
        #    Color for .../DefaultTexture"
        # -- the master fails, and every instance under it renders as the
        # engine's grey checker. set_editor_property alone did NOT stick here,
        # so the assignment is made both ways and READ BACK; if it still will
        # not take, the sampler drops to Color so the master at least compiles.
        want, fallback = _TEX_DEFAULTS.get(sampler, (None, "/Engine/EngineResources/WhiteSquareTexture"))
        tex = None
        for key in ((stem,) if stem else ()) + ((want,) if want else ()):
            if texs and key in texs:
                tex = texs[key]
                break
        if tex is None:
            try:
                tex = eal.load_asset(fallback)
            except Exception:
                tex = None
        got = None
        if tex is not None:
            for setter in (lambda: setattr(e, "texture", tex),
                           lambda: e.set_editor_property("texture", tex)):
                try:
                    setter()
                except Exception:
                    continue
                try:
                    got = e.get_editor_property("texture")
                except Exception:
                    got = None
                if got is not None and got.get_name() == tex.get_name():
                    break
            # assigning a texture can re-derive the sampler; re-assert it
            try:
                e.set_editor_property("sampler_type", getattr(unreal.MaterialSamplerType, sampler))
            except Exception:
                pass
        if got is None or (tex is not None and got.get_name() != tex.get_name()):
            log("V2 MATERIAL %s: %s keeps %s -- dropping its sampler to COLOR so the master compiles"
                % (name, pname, got.get_name() if got is not None else "no texture"))
            try:
                e.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
            except Exception:
                pass
        else:
            log("V2 MATERIAL %s: %s default texture %s (%s)" % (name, pname, got.get_name(), sampler))
        return e

    if kind in ("surface", "foliage", "portal"):
        # UVs: world-position-based scale so one sheet reads at one size on every mesh
        wpos = mel.create_material_expression(m, unreal.MaterialExpressionWorldPosition, -1300, -100)
        mask = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, -1150, -100)
        mask.set_editor_property("r", True)
        mask.set_editor_property("g", True)
        mask.set_editor_property("b", False)
        mel.connect_material_expressions(wpos, "", mask, "")
        scale = param(unreal.MaterialExpressionScalarParameter, "TexScale", -40, 0.005, -1150)
        uv = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -980, -80)
        mel.connect_material_expressions(mask, "", uv, "A")
        mel.connect_material_expressions(scale, "", uv, "B")
        alb = tex_param("Albedo", -260, "SAMPLERTYPE_COLOR")
        nrm = tex_param("Normal", 120, "SAMPLERTYPE_NORMAL")
        rgh = tex_param("RoughnessMap", 420, "SAMPLERTYPE_LINEAR_GRAYSCALE")
        for s in (alb, nrm, rgh):
            mel.connect_material_expressions(uv, "", s, "UVs")
        tint = param(unreal.MaterialExpressionVectorParameter, "BaseColor", -420, unreal.LinearColor(1, 1, 1, 1), -420)
        bmul = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -240, -300)
        mel.connect_material_expressions(tint, "", bmul, "A")
        mel.connect_material_expressions(alb, "", bmul, "B")
        mel.connect_material_property(bmul, "", unreal.MaterialProperty.MP_BASE_COLOR)
        mel.connect_material_property(nrm, "", unreal.MaterialProperty.MP_NORMAL)
        rough = param(unreal.MaterialExpressionScalarParameter, "Roughness", 480, 0.7, -420)
        vary = param(unreal.MaterialExpressionScalarParameter, "RoughVary", 560, 0.5, -420)
        # roughness = Roughness * lerp(1, map, RoughVary)
        one = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -420, 640)
        one.set_editor_property("r", 1.0)
        lerp = mel.create_material_expression(m, unreal.MaterialExpressionLinearInterpolate, -240, 520)
        mel.connect_material_expressions(one, "", lerp, "A")
        mel.connect_material_expressions(rgh, "", lerp, "B")
        mel.connect_material_expressions(vary, "", lerp, "Alpha")
        rmul = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -60, 500)
        mel.connect_material_expressions(rough, "", rmul, "A")
        mel.connect_material_expressions(lerp, "", rmul, "B")
        mel.connect_material_property(rmul, "", unreal.MaterialProperty.MP_ROUGHNESS)
        met = param(unreal.MaterialExpressionScalarParameter, "Metallic", 720, 0.0, -420)
        mel.connect_material_property(met, "", unreal.MaterialProperty.MP_METALLIC)
        spec = param(unreal.MaterialExpressionScalarParameter, "Specular", 800, 0.4, -420)
        mel.connect_material_property(spec, "", unreal.MaterialProperty.MP_SPECULAR)
        if kind == "portal":
            emi = param(unreal.MaterialExpressionVectorParameter, "Emissive", 900, unreal.LinearColor(0.66, 0.36, 1.0, 1), -420)
            es = param(unreal.MaterialExpressionScalarParameter, "EmissiveStrength", 1000, 1.0, -420)
            e1 = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -240, 920)
            mel.connect_material_expressions(emi, "", e1, "A")
            mel.connect_material_expressions(es, "", e1, "B")
            e2 = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -60, 940)
            mel.connect_material_expressions(e1, "", e2, "A")
            mel.connect_material_expressions(alb, "", e2, "B")
            mel.connect_material_property(e2, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
        if kind == "foliage":
            m.set_editor_property("two_sided", True)
            try:
                m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_TWO_SIDED_FOLIAGE)
                sss = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -60, 1100)
                sc = param(unreal.MaterialExpressionVectorParameter, "SubsurfaceTint", 1120,
                           unreal.LinearColor(0.35, 0.6, 0.2, 1), -420)
                mel.connect_material_expressions(sc, "", sss, "A")
                mel.connect_material_expressions(alb, "", sss, "B")
                mel.connect_material_property(sss, "", unreal.MaterialProperty.MP_SUBSURFACE_COLOR)
            except Exception as exc:
                log("V2 MATERIAL %s: no two-sided foliage model (%s)" % (name, exc))
    elif kind == "sky":
        try:
            m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
        except Exception:
            pass
        try:
            m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
        except Exception:
            pass
        for prop in ("is_sky", "b_is_sky"):
            try:
                m.set_editor_property(prop, True)
                break
            except Exception:
                continue
        m.set_editor_property("two_sided", True)
        # EQUIRECT FROM THE VIEW DIRECTION, NOT THE MESH UVs (PASS 04d,
        # 2026-08-28). The sphere's own lat-long UVs put the panorama on the
        # dome rotated, mirrored and compressed (V2_PASS_022 showed the giant
        # mushroom dead ahead at a third of its width); flipping V (PASS 04c)
        # only proved the vertical was already right by painting the ground
        # across the sky. So the lookup is computed per pixel from the world
        # direction camera -> dome: u from atan2(y, x), v from asin(z).
        # Orientation is then a matter of arithmetic, not of which backend
        # built the sphere:  +Y (HeroCam0's forward) faces panorama u = 0.5
        # when YawOffset = 90, and content right of the panorama's centre
        # lands on the viewer's right (UE is left-handed: facing +Y, right is
        # -X, atan2 = 180 deg, u = 0.75).
        def link(a, ao, b, bi):
            if not mel.connect_material_expressions(a, ao, b, bi):
                raise RuntimeError("sky graph: cannot connect %s.%s -> %s.%s"
                                   % (type(a).__name__, ao or "out", type(b).__name__, bi or "in"))

        def node(cls, x, y):
            return mel.create_material_expression(m, cls, x, y)

        def const(x, y, value):
            k = node(unreal.MaterialExpressionConstant, x, y)
            k.set_editor_property("r", float(value))
            return k

        wpos = node(unreal.MaterialExpressionWorldPosition, -2200, -300)
        cpos = node(unreal.MaterialExpressionCameraPositionWS, -2200, -180)
        dvec = node(unreal.MaterialExpressionSubtract, -2000, -260)
        link(wpos, "", dvec, "A")
        link(cpos, "", dvec, "B")
        dnrm = node(unreal.MaterialExpressionNormalize, -1850, -260)
        link(dvec, "", dnrm, "")
        dx = node(unreal.MaterialExpressionComponentMask, -1700, -360)
        dx.set_editor_property("r", True); dx.set_editor_property("g", False); dx.set_editor_property("b", False)
        dy = node(unreal.MaterialExpressionComponentMask, -1700, -260)
        dy.set_editor_property("r", False); dy.set_editor_property("g", True); dy.set_editor_property("b", False)
        dz = node(unreal.MaterialExpressionComponentMask, -1700, -160)
        dz.set_editor_property("r", False); dz.set_editor_property("g", False); dz.set_editor_property("b", True)
        for c_ in (dx, dy, dz):
            link(dnrm, "", c_, "")
        # u = frac(atan2(y, x) / 2pi + 0.5 - YawOffset / 360)
        theta = node(unreal.MaterialExpressionArctangent2, -1550, -320)
        link(dy, "", theta, "Y")
        link(dx, "", theta, "X")
        u0 = node(unreal.MaterialExpressionMultiply, -1400, -320)
        link(theta, "", u0, "A")
        link(const(-1550, -420, 1.0 / (2.0 * math.pi)), "", u0, "B")
        yaw = param(unreal.MaterialExpressionScalarParameter, "YawOffset", -520, 0.0, -1550)
        yawn = node(unreal.MaterialExpressionMultiply, -1400, -500)
        link(yaw, "", yawn, "A")
        link(const(-1550, -600, -1.0 / 360.0), "", yawn, "B")
        u1 = node(unreal.MaterialExpressionAdd, -1250, -320)
        link(u0, "", u1, "A")
        link(const(-1400, -240, 0.5), "", u1, "B")
        u2 = node(unreal.MaterialExpressionAdd, -1120, -320)
        link(u1, "", u2, "A")
        link(yawn, "", u2, "B")
        um = node(unreal.MaterialExpressionFrac, -1000, -320)
        link(u2, "", um, "")
        # v = 0.5 - asin(z) / pi  (0 at the zenith, 0.5 at the horizon)
        vz = node(unreal.MaterialExpressionArcsine, -1550, -160)
        link(dz, "", vz, "")
        v0 = node(unreal.MaterialExpressionMultiply, -1400, -160)
        link(vz, "", v0, "A")
        link(const(-1550, -60, -1.0 / math.pi), "", v0, "B")
        vm = node(unreal.MaterialExpressionAdd, -1250, -160)
        link(v0, "", vm, "A")
        link(const(-1400, -80, 0.5), "", vm, "B")
        # FlipV stays a scalar on the instance (default 0): v' = lerp(v, 1 - v, FlipV)
        flip = param(unreal.MaterialExpressionScalarParameter, "FlipV", 40, 0.0, -1300)
        om = node(unreal.MaterialExpressionOneMinus, -1100, -120)
        link(vm, "", om, "")
        vl = node(unreal.MaterialExpressionLinearInterpolate, -950, -160)
        link(vm, "", vl, "A")
        link(om, "", vl, "B")
        link(flip, "", vl, "Alpha")
        # THE PANORAMA'S NEAR OBJECTS. Its giant mushroom (u 0.245-0.435) and
        # its big tree (u 0.525-0.655) stand 10 m from the Marble camera and
        # reach 55 deg of elevation; projected to infinity they ghost the sky
        # behind our own mushroom and tree. Inside those two bands of azimuth
        # the panorama is sampled from the CLEAN SKY COLUMNS beside them: the
        # band [a0, a1] is mapped linearly onto the clean span [c0, c1] at the
        # SAME v (u' = (u - a0) * NearScale + NearFill0, no vertical stretch),
        # and the three samples are cross-faded by COLOUR over the 0.01-u band
        # edge. PASS 04d lerped the lookup COORDINATE instead (v -> v * 0.38):
        # across the band edge the lookup swept through the tower-ring rows
        # and painted a white column down the sky at u 0.525, and the 2.6x
        # vertical stretch smeared the zenith clouds into grey smudges
        # (V2_PASS_024). A colour cross-fade can only show what one of its
        # samples holds.
        def band(a0, a1, y):
            ea = node(unreal.MaterialExpressionSubtract, -800, y)
            link(um, "", ea, "A")
            link(a0, "", ea, "B")
            sa = node(unreal.MaterialExpressionMultiply, -700, y)
            link(ea, "", sa, "A")
            link(const(-800, y + 60, 100.0), "", sa, "B")
            ka = node(unreal.MaterialExpressionSaturate, -600, y)
            link(sa, "", ka, "")
            eb = node(unreal.MaterialExpressionSubtract, -800, y + 120)
            link(a1, "", eb, "A")
            link(um, "", eb, "B")
            sb = node(unreal.MaterialExpressionMultiply, -700, y + 120)
            link(eb, "", sb, "A")
            link(const(-800, y + 180, 100.0), "", sb, "B")
            kb = node(unreal.MaterialExpressionSaturate, -600, y + 120)
            link(sb, "", kb, "")
            box = node(unreal.MaterialExpressionMultiply, -500, y + 60)
            link(ka, "", box, "A")
            link(kb, "", box, "B")
            return box, ea

        def sample(u, y):
            t = node(unreal.MaterialExpressionAppendVector, -450, y)
            link(u, "", t, "A")
            link(vl, "", t, "B")
            p = tex_param("Panorama", y, "SAMPLERTYPE_COLOR")
            link(t, "", p, "UVs")
            return p

        def refill(ea, scale, fill0, y):
            # u' = (u - a0) * scale + fill0, wrapped
            sc = node(unreal.MaterialExpressionMultiply, -700, y)
            link(ea, "", sc, "A")
            link(scale, "", sc, "B")
            ad = node(unreal.MaterialExpressionAdd, -600, y)
            link(sc, "", ad, "A")
            link(fill0, "", ad, "B")
            fr = node(unreal.MaterialExpressionFrac, -520, y)
            link(ad, "", fr, "")
            return fr
        na0 = param(unreal.MaterialExpressionScalarParameter, "NearA0", 600, 0.0, -1000)
        na1 = param(unreal.MaterialExpressionScalarParameter, "NearA1", 680, 0.0, -1000)
        nb0 = param(unreal.MaterialExpressionScalarParameter, "NearB0", 900, 0.0, -1000)
        nb1 = param(unreal.MaterialExpressionScalarParameter, "NearB1", 980, 0.0, -1000)
        band_a, ea_a = band(na0, na1, 600)
        band_b, ea_b = band(nb0, nb1, 900)
        fa0 = param(unreal.MaterialExpressionScalarParameter, "NearFillA0", 1200, 0.0, -1000)
        fas = param(unreal.MaterialExpressionScalarParameter, "NearScaleA", 1280, 1.0, -1000)
        fb0 = param(unreal.MaterialExpressionScalarParameter, "NearFillB0", 1360, 0.0, -1000)
        fbs = param(unreal.MaterialExpressionScalarParameter, "NearScaleB", 1440, 1.0, -1000)
        base = sample(um, -200)
        fill_a = sample(refill(ea_a, fas, fa0, 1200), 1200)
        fill_b = sample(refill(ea_b, fbs, fb0, 1440), 1440)
        c1 = node(unreal.MaterialExpressionLinearInterpolate, -300, -100)
        link(base, "", c1, "A")
        link(fill_a, "", c1, "B")
        link(band_a, "", c1, "Alpha")
        c2 = node(unreal.MaterialExpressionLinearInterpolate, -200, -100)
        link(c1, "", c2, "A")
        link(fill_b, "", c2, "B")
        link(band_b, "", c2, "Alpha")
        gain = param(unreal.MaterialExpressionScalarParameter, "SkyGain", 200, 1.0, -420)
        pm = node(unreal.MaterialExpressionMultiply, -100, -100)
        link(c2, "", pm, "A")
        link(gain, "", pm, "B")
        mel.connect_material_property(pm, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
        # mask below the horizon on the TRUE elevation v: v > HorizonV -> clip
        hz = param(unreal.MaterialExpressionScalarParameter, "HorizonV", 440, 0.5, -700)
        sub = node(unreal.MaterialExpressionSubtract, -420, 400)
        link(hz, "", sub, "A")
        link(vl, "", sub, "B")
        sm = node(unreal.MaterialExpressionMultiply, -240, 420)
        link(sub, "", sm, "A")
        link(const(-420, 500, 60.0), "", sm, "B")
        mel.connect_material_property(sm, "", unreal.MaterialProperty.MP_OPACITY_MASK)
    mel.recompile_material(m)
    eal.save_asset(path, only_if_is_dirty=False)
    return m


def build_materials(unreal, log, texs):
    """Create the masters and every instance. Returns name -> instance."""
    mel = unreal.MaterialEditingLibrary
    eal = unreal.EditorAssetLibrary
    masters = {}
    for name, kind in (("M_V2_Surface", "surface"), ("M_V2_Foliage", "foliage"),
                       ("M_V2_Portal", "portal"), ("M_V2_SkyDome", "sky")):
        try:
            masters[kind] = _master(unreal, log, name, kind, texs)
        except Exception as exc:
            log("V2 MATERIAL master %s FAILED: %s" % (name, exc))
    out = {}
    pkg = C.FOLDERS["mat_instances"]
    # THE GREY WORLD (2026-08-26): the masters were created under -nullrhi, saved
    # with NO shadermap, and the cook logged "Failed to compile Material for
    # platform SF_VULKAN_SM5, Default Material will be used in game" -- every
    # surface in the approved foundation render was the engine's grey checker.
    # Compile them explicitly (and run the generator WITH rendering, not nullrhi).
    for _n, _m in list(masters.items()):
        try:
            mel.recompile_material(_m)
            log("V2 MATERIAL master %s compiled" % _n)
        except Exception as exc:
            log("V2 MATERIAL master %s COMPILE FAILED: %s" % (_n, exc))
    means = texture_means(log)
    for name, (fam, tint, met, rough, vary, spec, emi, es) in INSTANCES.items():
        kind = "portal" if name in PORTAL else ("foliage" if name in FOLIAGE else "surface")
        master = masters.get(kind) or masters.get("surface")
        if master is None:
            continue
        try:
            path = pkg + "/" + name
            if eal.does_asset_exist(path):
                eal.delete_asset(path)
            mi = mel.create_material_instance_asset(name, pkg, master) if hasattr(mel, "create_material_instance_asset") \
                else unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, pkg, unreal.MaterialInstanceConstant,
                                                                              unreal.MaterialInstanceConstantFactoryNew())
            if mi is None:
                continue
            try:
                mel.set_material_instance_parent(mi, master)
            except Exception:
                pass
            ct = corrected_tint(fam, tint, means, log, name)
            mel.set_material_instance_vector_parameter_value(mi, "BaseColor", unreal.LinearColor(ct[0], ct[1], ct[2], 1))
            mel.set_material_instance_scalar_parameter_value(mi, "Metallic", float(met))
            mel.set_material_instance_scalar_parameter_value(mi, "Roughness", float(rough))
            mel.set_material_instance_scalar_parameter_value(mi, "RoughVary", float(vary))
            mel.set_material_instance_scalar_parameter_value(mi, "Specular", float(spec))
            mel.set_material_instance_scalar_parameter_value(mi, "TexScale", float(TEX_SCALE.get(fam, 0.005)))
            if emi is not None:
                mel.set_material_instance_vector_parameter_value(mi, "Emissive", unreal.LinearColor(emi[0], emi[1], emi[2], 1))
                mel.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", float(es) * float(C.LOOK["portalGlow"]))
            stems = FAMILY_FILES.get(fam, (None, None, None))
            for pname, stem in (("Albedo", stems[0]), ("Normal", stems[1]), ("RoughnessMap", stems[2])):
                if stem and stem in texs:
                    mel.set_material_instance_texture_parameter_value(mi, pname, texs[stem])
            try:
                mel.recompile_material(mi)
            except Exception:
                pass
            eal.save_asset(path, only_if_is_dirty=False)
            out[name] = mi
        except Exception as exc:
            log("V2 MATERIAL instance %s FAILED: %s" % (name, exc))
    # the sky dome instance
    if "sky" in masters:
        try:
            name = "MI_V2_SkyPano"
            path = pkg + "/" + name
            if eal.does_asset_exist(path):
                eal.delete_asset(path)
            # 5.8's Python has no MaterialEditingLibrary.create_material_instance_asset
            # (measured 2026-08-28 -- this call is why the dome was skipped in
            # every classic-map render: the instance raised, the log said
            # "FAILED", and build_v2 saw no MI_V2_SkyPano).
            mi = mel.create_material_instance_asset(name, pkg, masters["sky"]) if hasattr(mel, "create_material_instance_asset") \
                else unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, pkg, unreal.MaterialInstanceConstant,
                                                                              unreal.MaterialInstanceConstantFactoryNew())
            if mi is None:
                raise RuntimeError("no material instance created")
            try:
                mel.set_material_instance_parent(mi, masters["sky"])
            except Exception:
                mi.set_editor_property("parent", masters["sky"])
            if "T_V2_SkyPano" in texs:
                mel.set_material_instance_texture_parameter_value(mi, "Panorama", texs["T_V2_SkyPano"])
            mel.set_material_instance_scalar_parameter_value(mi, "SkyGain", float(C.LOOK["skyGain"]))
            mel.set_material_instance_scalar_parameter_value(mi, "FlipV", float(C.LOOK["skyFlipV"]))
            mel.set_material_instance_scalar_parameter_value(mi, "HorizonV", float(C.LOOK["skyHorizonV"]))
            mel.set_material_instance_scalar_parameter_value(mi, "YawOffset", float(C.LOOK["skyYawOffset"]))
            (a0, a1), (b0, b1) = C.LOOK["skyNearBands"]
            (ca0, ca1), (cb0, cb1) = C.LOOK["skyNearFills"]
            if not (a1 > a0 and b1 > b0 and ca1 > ca0 and cb1 > cb0):
                raise RuntimeError("skyNearBands / skyNearFills must be increasing spans")
            for pname, val in (("NearA0", a0), ("NearA1", a1), ("NearB0", b0), ("NearB1", b1),
                               ("NearFillA0", ca0), ("NearScaleA", (ca1 - ca0) / (a1 - a0)),
                               ("NearFillB0", cb0), ("NearScaleB", (cb1 - cb0) / (b1 - b0))):
                mel.set_material_instance_scalar_parameter_value(mi, pname, float(val))
            log("V2 SKY: panorama u=0.5 faces yaw %.0f; horizon v %.4f; near bands %s refilled from u %s (same v, colour cross-fade)"
                % (C.LOOK["skyYawOffset"], C.LOOK["skyHorizonV"], C.LOOK["skyNearBands"], C.LOOK["skyNearFills"]))
            eal.save_asset(path, only_if_is_dirty=False)
            out[name] = mi
        except Exception as exc:
            log("V2 MATERIAL MI_V2_SkyPano FAILED: %s" % exc)
    if int(C.LOOK["skyDome"]) and "MI_V2_SkyPano" not in out:
        raise RuntimeError("skyDome=1 but MI_V2_SkyPano was not built -- see the V2 MATERIAL lines above")
    log("V2 MATERIALS: %d masters, %d instances" % (len(masters), len(out)))
    return out
