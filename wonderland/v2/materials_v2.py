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

import os

import v2_config as C

#: name -> (family, base tint, metallic, roughness, rough_vary, specular, emissive, emissive_strength)
INSTANCES = {
    "MI_V2_IvoryStone": ("plaster", (0.72, 0.62, 0.64), 0.0, 0.55, 0.45, 0.35, None, 0.0),
    "MI_V2_Stone":      ("ashlar",  (0.44, 0.39, 0.37), 0.0, 0.85, 0.80, 0.30, None, 0.0),
    "MI_V2_Cobble":     ("cobble",  (0.34, 0.24, 0.21), 0.0, 0.78, 0.90, 0.28, None, 0.0),
    "MI_V2_CobbleHero": ("cobble",  (0.40, 0.29, 0.26), 0.0, 0.72, 0.90, 0.30, None, 0.0),
    "MI_V2_Moss":       ("sward",   (0.10, 0.16, 0.07), 0.0, 0.80, 0.60, 0.20, None, 0.0),
    "MI_V2_Gold":       ("metal",   (1.00, 0.72, 0.36), 0.92, 0.32, 0.35, 0.60, None, 0.0),
    "MI_V2_RoofPink":   ("roof",    (0.72, 0.42, 0.47), 0.0, 0.62, 0.60, 0.30, None, 0.0),
    "MI_V2_RoofRose":   ("roof",    (0.58, 0.34, 0.39), 0.0, 0.64, 0.60, 0.30, None, 0.0),
    "MI_V2_RoofLilac":  ("roof",    (0.56, 0.46, 0.72), 0.0, 0.62, 0.60, 0.30, None, 0.0),
    "MI_V2_RoofBlue":   ("roof",    (0.34, 0.46, 0.80), 0.0, 0.62, 0.60, 0.30, None, 0.0),
    "MI_V2_Bark":       ("bark",    (0.20, 0.12, 0.09), 0.0, 0.88, 1.00, 0.20, None, 0.0),
    "MI_V2_Ceramic":    ("glaze",   (0.92, 0.88, 0.86), 0.0, 0.18, 0.15, 0.55, None, 0.0),
    "MI_V2_MushRed":    ("cap",     (0.56, 0.14, 0.15), 0.0, 0.48, 0.50, 0.40, None, 0.0),
    "MI_V2_MushPurple": ("cap",     (0.36, 0.18, 0.58), 0.0, 0.50, 0.50, 0.40, None, 0.0),
    "MI_V2_MushCream":  ("cap",     (0.90, 0.80, 0.66), 0.0, 0.52, 0.50, 0.40, None, 0.0),
    "MI_V2_MushStem":   ("glaze",   (0.90, 0.82, 0.70), 0.0, 0.62, 0.40, 0.30, None, 0.0),
    "MI_V2_Spot":       ("glaze",   (0.98, 0.94, 0.88), 0.0, 0.50, 0.30, 0.35, None, 0.0),
    # foliage family (M_V2_Foliage)
    "MI_V2_LeafDark":   ("leaf",    (0.05, 0.10, 0.05), 0.0, 0.70, 0.60, 0.15, None, 0.0),
    "MI_V2_LeafMid":    ("leaf",    (0.09, 0.17, 0.08), 0.0, 0.66, 0.60, 0.15, None, 0.0),
    "MI_V2_LeafLight":  ("leaf",    (0.14, 0.24, 0.11), 0.0, 0.62, 0.60, 0.15, None, 0.0),
    "MI_V2_RosePink":   ("petal",   (0.96, 0.42, 0.62), 0.0, 0.58, 0.40, 0.25, None, 0.0),
    "MI_V2_RoseRed":    ("petal",   (0.74, 0.12, 0.26), 0.0, 0.58, 0.40, 0.25, None, 0.0),
    "MI_V2_PetalPink":  ("petal",   (0.94, 0.48, 0.70), 0.0, 0.60, 0.40, 0.25, None, 0.0),
    "MI_V2_PetalViolet": ("petal",  (0.54, 0.30, 0.86), 0.0, 0.60, 0.40, 0.25, None, 0.0),
    # portal family (M_V2_Portal)
    "MI_V2_PortalRunes": ("runes",  (0.66, 0.36, 1.00), 0.0, 0.40, 0.0, 0.2, (0.66, 0.36, 1.00), 1.0),
    "MI_V2_PortalGlow":  ("runes",  (0.72, 0.42, 1.00), 0.0, 0.40, 0.0, 0.2, (0.72, 0.42, 1.00), 1.4),
}
FOLIAGE = ("MI_V2_LeafDark", "MI_V2_LeafMid", "MI_V2_LeafLight", "MI_V2_RosePink",
           "MI_V2_RoseRed", "MI_V2_PetalPink", "MI_V2_PetalViolet")
PORTAL = ("MI_V2_PortalRunes", "MI_V2_PortalGlow")

#: texture family -> (albedo, normal, roughness) file stems from gen-textures.py
FAMILY_FILES = {
    "cobble": ("T_cobble_a", "T_cobble_n", "T_cobble_r"),
    "ashlar": ("T_ashlar_a", "T_ashlar_n", "T_ashlar_r"),
    "plaster": ("T_plaster_a", "T_plaster_n", "T_plaster_r"),
    "sward": ("T_sward_a", "T_sward_n", "T_sward_r"),
    "bark": ("T_bark_a", "T_bark_n", "T_bark_r"),
    "roof": ("T_roof_a", "T_roof_n", "T_roof_r"),
    "metal": ("T_metal_a", "T_metal_n", "T_metal_r"),
    "glaze": ("T_glaze_a", "T_glaze_n", "T_glaze_r"),
    "cap": ("T_cap_a", "T_cap_n", "T_cap_r"),
    "petal": ("T_petal_a", "T_petal_n", "T_petal_r"),
    "leaf": ("T_leafcard_a", "T_leafcard_n", None),
    "runes": ("T_runes_a", "T_runes_n", "T_runes_r"),
}
TEX_SCALE = {"cobble": 0.0034, "ashlar": 0.0026, "plaster": 0.0050, "sward": 0.0090,
             "bark": 0.0070, "roof": 0.0070, "metal": 0.0090, "glaze": 0.0060,
             "cap": 0.0060, "petal": 0.0100, "leaf": 0.0080, "runes": 0.0010}


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


def _master(unreal, log, name, kind):
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

    def tex_param(pname, y, sampler):
        e = mel.create_material_expression(m, unreal.MaterialExpressionTextureSampleParameter2D, -700, y)
        e.set_editor_property("parameter_name", pname)
        try:
            e.set_editor_property("sampler_type", getattr(unreal.MaterialSamplerType, sampler))
        except Exception:
            pass
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
        # equirectangular lookup from the view direction of the pixel
        tc0 = mel.create_material_expression(m, unreal.MaterialExpressionTextureCoordinate, -1300, -200)
        # v' = lerp(v, 1 - v, FlipV): which way up the equirect maps onto the
        # sphere's UVs differs between the two mesh backends, and the founder
        # must not pay a rebuild to find out -- it is a scalar on the instance.
        flip = param(unreal.MaterialExpressionScalarParameter, "FlipV", -420, 0.0, -1300)
        um = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, -1100, -260)
        um.set_editor_property("r", True)
        um.set_editor_property("g", False)
        mel.connect_material_expressions(tc0, "", um, "")
        vm = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, -1100, -160)
        vm.set_editor_property("r", False)
        vm.set_editor_property("g", True)
        mel.connect_material_expressions(tc0, "", vm, "")
        om = mel.create_material_expression(m, unreal.MaterialExpressionOneMinus, -1000, -120)
        mel.connect_material_expressions(vm, "", om, "")
        vl = mel.create_material_expression(m, unreal.MaterialExpressionLinearInterpolate, -900, -160)
        mel.connect_material_expressions(vm, "", vl, "A")
        mel.connect_material_expressions(om, "", vl, "B")
        mel.connect_material_expressions(flip, "", vl, "Alpha")
        tc = mel.create_material_expression(m, unreal.MaterialExpressionAppendVector, -800, -200)
        mel.connect_material_expressions(um, "", tc, "A")
        mel.connect_material_expressions(vl, "", tc, "B")
        pano = tex_param("Panorama", -200, "SAMPLERTYPE_COLOR")
        mel.connect_material_expressions(tc, "", pano, "UVs")
        gain = param(unreal.MaterialExpressionScalarParameter, "SkyGain", 200, 1.0, -420)
        pm = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -240, -100)
        mel.connect_material_expressions(pano, "", pm, "A")
        mel.connect_material_expressions(gain, "", pm, "B")
        mel.connect_material_property(pm, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
        # mask below the horizon: v > HorizonV -> clip. The dome's UVs put v=0.5
        # at the horizon; a soft band of 0.03 above it fades the near objects
        # the panorama holds at ground level.
        hz = param(unreal.MaterialExpressionScalarParameter, "HorizonV", 440, 0.505, -700)
        sub = mel.create_material_expression(m, unreal.MaterialExpressionSubtract, -420, 400)
        mel.connect_material_expressions(hz, "", sub, "A")
        mel.connect_material_expressions(vl, "", sub, "B")
        k = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -420, 500)
        k.set_editor_property("r", 60.0)
        sm = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -240, 420)
        mel.connect_material_expressions(sub, "", sm, "A")
        mel.connect_material_expressions(k, "", sm, "B")
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
            masters[kind] = _master(unreal, log, name, kind)
        except Exception as exc:
            log("V2 MATERIAL master %s FAILED: %s" % (name, exc))
    out = {}
    pkg = C.FOLDERS["mat_instances"]
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
            mel.set_material_instance_vector_parameter_value(mi, "BaseColor", unreal.LinearColor(tint[0], tint[1], tint[2], 1))
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
            mi = mel.create_material_instance_asset(name, pkg, masters["sky"])
            if "T_V2_SkyPano" in texs:
                mel.set_material_instance_texture_parameter_value(mi, "Panorama", texs["T_V2_SkyPano"])
            mel.set_material_instance_scalar_parameter_value(mi, "SkyGain", float(C.LOOK["skyGain"]))
            mel.set_material_instance_scalar_parameter_value(mi, "FlipV", float(C.LOOK["skyFlipV"]))
            eal.save_asset(path, only_if_is_dirty=False)
            out[name] = mi
        except Exception as exc:
            log("V2 MATERIAL MI_V2_SkyPano FAILED: %s" % exc)
    log("V2 MATERIALS: %d masters, %d instances" % (len(masters), len(out)))
    return out
