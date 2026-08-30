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
    # PASS 08 (2026-08-30): THE STONE COMES DOWN AND SPREADS OUT. Measured
    # on HeroCam0 against the founder reference over the same mid-frame
    # walking surface: ours p50 luma 212 against 162 (the founder's "~1.3x
    # brighter", confirmed at 1.31x in sRGB) and -- the larger finding -- a
    # p10..p90 tonal span of 44 against 119. The plaza is not merely bright,
    # it is UNIFORM: 2.7x less tonal range than the reference, which is what
    # makes fitted masonry read as one poured sheet. Nothing clips (0.01% of
    # the frame above sRGB 240), so this is albedo and spread, not exposure.
    # The four tints below span 0.24..0.56 where the old three spanned
    # 0.54..0.72, and the light budget (v2_config PASS 08) supplies the
    # shading that the albedo cannot.
    "MI_V2_IvoryStone": ("plaster", (0.56, 0.51, 0.43), 0.0, 0.58, 0.50, 0.32, None, 0.0),
    "MI_V2_Stone":      ("ashlar",  (0.44, 0.40, 0.34), 0.0, 0.82, 0.80, 0.30, None, 0.0),
    "MI_V2_PlazaCream": ("plaza",   (0.50, 0.47, 0.40), 0.0, 0.74, 0.85, 0.30, None, 0.0),
    "MI_V2_PlazaGrey":  ("plaza",   (0.40, 0.39, 0.35), 0.0, 0.76, 0.85, 0.30, None, 0.0),
    # PASS 01: a warmer cream so the running bond carries three tints in a
    # blotch, and a cream kerb a hair darker than the slabs.
    "MI_V2_PlazaWarm":  ("plaza",   (0.56, 0.48, 0.35), 0.0, 0.74, 0.85, 0.30, None, 0.0),
    # PASS 08: a fourth, DARK stone. Three tints inside 0.18 of each other
    # cannot make a course read as separate stones however good the bond is;
    # the reference's paving has stones two stops apart sitting side by side.
    "MI_V2_PlazaShade": ("plaza",   (0.30, 0.28, 0.24), 0.0, 0.78, 0.85, 0.30, None, 0.0),
    "MI_V2_Kerb":       ("plaza",   (0.46, 0.42, 0.35), 0.0, 0.70, 0.75, 0.30, None, 0.0),
    # the central path in the founder's view is PALE grey-blue stone, a step
    # cooler and a touch darker than the cream plaza -- not a dark road
    # PASS 01b: the reference path is a warm dark grey-brown. The `pathstone`
    # sheet is a whole tile of bright faces AND dark mortar, and a single flag
    # mesh shows only the faces, so the mean-corrected tint rendered pale; the
    # near-uniform plaza sheet delivers the tint as the flag's actual albedo.
    "MI_V2_PathStone":  ("plaza",   (0.31, 0.28, 0.23), 0.0, 0.80, 0.85, 0.30, None, 0.0),
    # PASS 08: two companions so the way is laid stone by stone rather than
    # poured. Kept close to the base -- the path reads as ONE pavement with
    # varied stones, not as three pavements.
    "MI_V2_PathWarm":   ("plaza",   (0.38, 0.33, 0.26), 0.0, 0.79, 0.85, 0.30, None, 0.0),
    "MI_V2_PathPale":   ("plaza",   (0.45, 0.41, 0.34), 0.0, 0.81, 0.85, 0.30, None, 0.0),
    "MI_V2_Cobble":     ("cobble",  (0.36, 0.30, 0.26), 0.0, 0.78, 0.90, 0.28, None, 0.0),
    "MI_V2_CobbleHero": ("cobble",  (0.33, 0.31, 0.28), 0.0, 0.74, 0.90, 0.30, None, 0.0),
    # PASS 08: THE GROUND STOPS BEING A GREEN SCREEN. Whole-frame palette
    # against the founder reference: the green arc holds 25.3% of our frame
    # and 4.8% of the reference's -- 5.2x. Most of that is one actor, the
    # 1.2 km moss cube that stands in for terrain, and a saturated blue-green
    # at (0.12, 0.20, 0.08) is what makes an elevated camera read the district
    # as a model sitting on a lawn. Real sunlit meadow is YELLOW-green and far
    # less saturated; these keep their relative order (moss darker, lawn
    # lighter) and move to a warm, natural range. This does not fill the empty
    # ground -- that is authored content and its own pass -- it stops the
    # emptiness being the loudest colour in the frame.
    # PASS 08b: PASS 08 traded a green void for a BROWN one. On SkylineCam06
    # the green arc fell 45.5% -> 19.3%, which is the intended direction, but
    # it moved into the warm arc (2.1% -> 27.0%) and the ground read as barren
    # dirt rather than meadow -- worse, not better, for that camera. The
    # desaturation was right; taking the green out from under a warm sun and a
    # warm grade at the same time was not. Green restored, saturation kept low.
    "MI_V2_Moss":       ("sward",   (0.13, 0.18, 0.10), 0.0, 0.82, 0.60, 0.20, None, 0.0),
    "MI_V2_Lawn":       ("sward",   (0.18, 0.25, 0.12), 0.0, 0.86, 0.60, 0.20, None, 0.0),
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
    # Still fountain water. Low roughness so it takes the sky and the towers
    # rather than glowing, a pale green-blue that belongs to the pastel palette,
    # and specular high enough to read as a surface at a walking distance --
    # Wonderland's water should look like a mirror in a garden, not a pool.
    "MI_V2_Water":      ("glaze",   (0.36, 0.52, 0.55), 0.0, 0.06, 0.02, 0.85, None, 0.0),
    # ---- mushrooms: muted terracotta-pink, purple, cream --------------------
    "MI_V2_MushRed":    ("cap",     (0.58, 0.24, 0.20), 0.0, 0.54, 0.50, 0.38, None, 0.0),
    "MI_V2_MushTerracotta": ("cap", (0.60, 0.30, 0.24), 0.0, 0.56, 0.50, 0.38, None, 0.0),
    "MI_V2_MushPurple": ("cap",     (0.38, 0.22, 0.52), 0.0, 0.54, 0.50, 0.38, None, 0.0),
    "MI_V2_MushCream":  ("cap",     (0.86, 0.78, 0.64), 0.0, 0.56, 0.50, 0.38, None, 0.0),
    "MI_V2_MushStem":   ("glaze",   (0.84, 0.76, 0.64), 0.0, 0.66, 0.40, 0.30, None, 0.0),
    "MI_V2_Spot":       ("glaze",   (0.95, 0.92, 0.86), 0.0, 0.54, 0.30, 0.35, None, 0.0),
    # ---- foliage (M_V2_Foliage): readable greens, not near-black ---------------
    # LIFTED. 0.08 green is a leaf in deep shade, not a leaf -- and with the
    # district now several times more planted than when these were set, that
    # albedo is what turns massed foliage into the near-black wall the founder
    # is seeing on the right. Real sunlit leaves sit nearer 0.18-0.30 in
    # green. Raised in step so the three tones keep their order and the
    # canopies stay distinguishable from the hedges.
    "MI_V2_LeafDark":   ("leaf",    (0.11, 0.21, 0.09), 0.0, 0.70, 0.60, 0.15, None, 0.0),
    "MI_V2_LeafMid":    ("leaf",    (0.18, 0.32, 0.13), 0.0, 0.66, 0.60, 0.15, None, 0.0),
    "MI_V2_LeafLight":  ("leaf",    (0.27, 0.42, 0.17), 0.0, 0.62, 0.60, 0.15, None, 0.0),
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
    # ---- clouds (PASS 08): lit geometry, not a painted sky ------------------
    # High albedo, fully rough, no specular -- a cumulus must not glint. The
    # emissive is the multiple scattering a surface material cannot do: without
    # it a lit sphere reads as a marshmallow, bright side and dead side. It is
    # CONSTANT (the founder's no-global-pulse rule) and safe against the
    # emissive-area trap because this world's exposure is pinned, so more
    # emissive area cannot re-meter the frame.
    # PASS 08b: whiter, and less self-lit. The first clouds read grey and flat.
    # Grey because at 2.6-13.5 km the height fog blends them toward its pale
    # inscattering; flat because a constant emissive lifts the shaded side
    # toward the lit one, which is the opposite of what gives a cumulus its
    # form. Albedo up so the sun does more of the work and the fog has
    # something brighter to wash, emissive down so the shaded side stays a
    # shaded side.
    "MI_V2_Cloud":      ("cloud",   (0.96, 0.96, 0.97), 0.0, 1.00, 0.0, 0.02, (0.60, 0.64, 0.75), 1300.0),
    "MI_V2_CloudVeil":  ("cloud",   (0.90, 0.91, 0.95), 0.0, 1.00, 0.0, 0.02, (0.56, 0.60, 0.72), 950.0),
    # ---- portal (M_V2_Portal): restrained -------------------------------------
    "MI_V2_PortalRunes": ("runes",  (0.62, 0.40, 0.92), 0.0, 0.40, 0.0, 0.2, (0.62, 0.40, 0.92), 1.0),
    "MI_V2_PortalGlow":  ("runes",  (0.68, 0.46, 0.94), 0.0, 0.40, 0.0, 0.2, (0.68, 0.46, 0.94), 1.2),
}
FOLIAGE = ("MI_V2_LeafDark", "MI_V2_LeafMid", "MI_V2_LeafLight", "MI_V2_RosePink",
           "MI_V2_RoseRed", "MI_V2_PetalPink", "MI_V2_PetalViolet", "MI_V2_PetalBlue",
           "MI_V2_PetalWhite", "MI_V2_PetalRose", "MI_V2_Lavender", "MI_V2_LeafGrey")
PORTAL = ("MI_V2_PortalRunes", "MI_V2_PortalGlow")
#: Instances whose EmissiveStrength is ABSOLUTE. Every emissive instance used
#: to be multiplied by LOOK["portalGlow"], which is the portal's own dial:
#: anything else that ever needed emissive would have had its brightness
#: silently tied to a rune disc. The portal keeps the scale it was tuned with;
#: these carry their own value.
EMISSIVE_ABSOLUTE = ("MI_V2_Cloud", "MI_V2_CloudVeil")

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
    # PASS 05e (2026-08-28): the leaf family carried T_V2_leafcard_a -- ONE
    # leaf on a transparent surround, made for masked leaf CARDS. Every V2
    # leaf is a solid extruded blade (assets_v2._leaf_blade) whose UVs are the
    # world XY projection, and the foliage master has no opacity mask, so each
    # blade sampled a random patch of the card: inside the leaf, the tint
    # (divided by the card's leaf-only mean, hence lime); in the surround,
    # BLACK. That is the "black leaves beside bright leaves" of every canopy
    # and hedge since PASS 02, which four lighting hypotheses (scene-capture
    # sky light, upward bounce, distance-field exclusion, Lumen skylight
    # leaking) could not move because it was never lighting. The blades now
    # carry the engine's flat maps: the tint IS the albedo, uniform roughness,
    # no mean correction (corrected_tint finds no "leaf" family in the means).
    "leaf": (None, None, None),
    # PASS 08: clouds carry no detail map. A tiled stone or leaf texture on a
    # 300 m cumulus reads as a pattern painted on the sky.
    "cloud": (None, None, None),
    "runes": ("T_V2_runes_a", "T_V2_runes_n", "T_V2_runes_r"),
}
#: Engine maps pinned onto instances whose family carries no texture of that
#: kind, so they do not inherit the MASTER's defaults (the plaster maps).
#: Candidates in order; the first that loads is used. The 5.8 image holds
#: EngineMaterials/DefaultNormal.uasset and FlatNormal.uasset on disk, yet
#: load_asset returned None for DefaultNormal in the commandlet (PASS 05e's
#: first chain), so a V2 map of the right kind is the last resort.
PLAIN_MAPS = {"Albedo": ("/Engine/EngineResources/WhiteSquareTexture",),
              "Normal": ("/Engine/EngineMaterials/FlatNormal", "/Engine/EngineMaterials/DefaultNormal",
                         "/Engine/EngineMaterials/T_Default_Normal"),
              "RoughnessMap": ("/Engine/EngineResources/WhiteSquareTexture",)}
PLAIN_FALLBACK = {"Albedo": None, "Normal": "T_V2_sward_n", "RoughnessMap": None}
#: 1/uu per tile. plaza: 2 slabs of 130 uu per 1024 px tile -> 1/260;
#: pathstone: ~3 flags of 90 uu per 512 px tile -> 1/270.
TEX_SCALE = {"plaza": 0.0038, "pathstone": 0.0037, "cobble": 0.0034, "ashlar": 0.0026,
             "plaster": 0.0050, "sward": 0.0090, "bark": 0.0070, "roof": 0.0070,
             "metal": 0.0090, "glaze": 0.0060, "cap": 0.0060, "petal": 0.0100,
             "leaf": 0.0080, "cloud": 0.0004, "runes": 0.0010}


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
    m = means.get(fam)
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


#: PASS 08: triplanar world projection on the surface master. WLV2_TRIPLANAR=0
#: restores the old world-XY projection for a comparison render.
TRIPLANAR = os.environ.get("WLV2_TRIPLANAR", "1") != "0"


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
        # THE VERTICAL SMEAR (PASS 08, 2026-08-30).
        #
        # This block used to mask WorldPosition to (X, Y) and feed that to
        # every sampler as the UV. On a floor that is correct and it is why
        # the plaza always looked like stone. On anything VERTICAL it is a
        # silent catastrophe: climb a column and X and Y do not change, so
        # the UV does not change, so the texture is sampled from one line and
        # smeared upward for the height of the surface. Every column, gate
        # pier, wall, tower, step riser and plinth in Wonderland was wearing
        # the same infinite vertical streak -- the corrugated look on
        # PlayerCam01's gate columns and ReverseCam03's plaza-side walls, and
        # the reason premium ivory stone read as ribbed plastic. The streaks
        # run on across separate objects at different depths because all of
        # them shared one world projection, which is the tell.
        #
        # The fix is triplanar: sample on all three world planes and blend by
        # the surface normal, so a wall is textured from XZ/YZ and a floor
        # from XY, at ONE consistent world scale (which is what the original
        # world projection was for and is kept). It costs three samples where
        # there was one, on the `surface` master only -- foliage and portal
        # instances carry flat maps, so blending them would be three samples
        # of the same white pixel.
        #
        # It is guarded. A master that fails to build renders every surface as
        # the engine's grey checker (2026-08-26 cost three cooks to that), so
        # any failure here falls back to the old XY projection and says so.
        wpos = mel.create_material_expression(m, unreal.MaterialExpressionWorldPosition, -1300, -100)
        scale = param(unreal.MaterialExpressionScalarParameter, "TexScale", -40, 0.005, -1150)
        uvw = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -1150, -180)
        mel.connect_material_expressions(wpos, "", uvw, "A")
        mel.connect_material_expressions(scale, "", uvw, "B")

        def _mask(src, r, g, b, x, y):
            e = mel.create_material_expression(m, unreal.MaterialExpressionComponentMask, x, y)
            e.set_editor_property("r", r)
            e.set_editor_property("g", g)
            e.set_editor_property("b", b)
            mel.connect_material_expressions(src, "", e, "")
            return e

        uv = _mask(uvw, True, True, False, -980, -80)          # XY: the floor plane
        tri = None
        if kind == "surface" and TRIPLANAR:
            try:
                uv_xz = _mask(uvw, True, False, True, -980, -20)
                uv_yz = _mask(uvw, False, True, True, -980, 40)
                nrm_ws = mel.create_material_expression(m, unreal.MaterialExpressionVertexNormalWS, -1300, 200)
                absn = mel.create_material_expression(m, unreal.MaterialExpressionAbs, -1150, 200)
                mel.connect_material_expressions(nrm_ws, "", absn, "")
                # Sharpen the blend so the seams between planes are narrow;
                # a linear blend by |n| leaves a wide mushy band on every
                # 45-degree chamfer, which this world has on every slab.
                pw = mel.create_material_expression(m, unreal.MaterialExpressionPower, -1020, 200)
                mel.connect_material_expressions(absn, "", pw, "Base")
                pexp = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -1150, 270)
                pexp.set_editor_property("r", 4.0)
                mel.connect_material_expressions(pexp, "", pw, "Exp")
                # normalise so the three weights sum to one at every angle
                ones = mel.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -1020, 300)
                ones.set_editor_property("constant", unreal.LinearColor(1.0, 1.0, 1.0, 1.0))
                dot = mel.create_material_expression(m, unreal.MaterialExpressionDotProduct, -880, 240)
                mel.connect_material_expressions(pw, "", dot, "A")
                mel.connect_material_expressions(ones, "", dot, "B")
                wn = mel.create_material_expression(m, unreal.MaterialExpressionDivide, -740, 220)
                mel.connect_material_expressions(pw, "", wn, "A")
                mel.connect_material_expressions(dot, "", wn, "B")
                tri = (uv_xz, uv_yz,
                       _mask(wn, True, False, False, -600, 180),     # weight for the X plane (YZ uv)
                       _mask(wn, False, True, False, -600, 240),     # weight for the Y plane (XZ uv)
                       _mask(wn, False, False, True, -600, 300))     # weight for the Z plane (XY uv)
            except Exception as exc:
                tri = None
                log("V2 MATERIAL %s: TRIPLANAR UNAVAILABLE (%s) -- falling back to the world XY "
                    "projection, which smears every vertical surface" % (name, exc))

        def sampled(pname, y, sampler, stem=None):
            """One texture, projected correctly. Returns the node to read."""
            if tri is None:
                e = tex_param(pname, y, sampler, stem)
                mel.connect_material_expressions(uv, "", e, "UVs")
                return e
            uv_xz, uv_yz, wx, wy, wz = tri
            acc = None
            for uvn, w, dy in ((uv_yz, wx, 0), (uv_xz, wy, 40), (uv, wz, 80)):
                sm = tex_param(pname, y + dy, sampler, stem)
                mel.connect_material_expressions(uvn, "", sm, "UVs")
                mul = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -520, y + dy)
                mel.connect_material_expressions(sm, "", mul, "A")
                mel.connect_material_expressions(w, "", mul, "B")
                if acc is None:
                    acc = mul
                else:
                    add = mel.create_material_expression(m, unreal.MaterialExpressionAdd, -440, y + dy)
                    mel.connect_material_expressions(acc, "", add, "A")
                    mel.connect_material_expressions(mul, "", add, "B")
                    acc = add
            return acc

        alb = sampled("Albedo", -260, "SAMPLERTYPE_COLOR")
        nrm = sampled("Normal", 120, "SAMPLERTYPE_NORMAL")
        rgh = sampled("RoughnessMap", 420, "SAMPLERTYPE_LINEAR_GRAYSCALE")
        log("V2 MATERIAL %s: %s projection" % (name, "TRIPLANAR (world, normal-blended)" if tri is not None
                                               else "world XY (vertical surfaces smear)"))
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
        # EMISSIVE IS NOT PORTAL-ONLY (PASS 08). These two parameters used to
        # be built only on the portal master, so any instance under `surface`
        # that carried an emissive value had it set on a parameter that did
        # not exist -- a silent no-op, not an error. PASS 08's clouds are the
        # first such instance: without this they would be lit spheres with a
        # bright side and a dead side, which is a marshmallow, not a cumulus.
        # The default is 0, and every existing surface instance carries
        # emissive None and never writes the parameter, so nothing else in the
        # world changes. The portal's two instances set theirs explicitly.
        emi = param(unreal.MaterialExpressionVectorParameter, "Emissive", 900,
                    unreal.LinearColor(0.66, 0.36, 1.0, 1), -420)
        es = param(unreal.MaterialExpressionScalarParameter, "EmissiveStrength", 1000, 0.0, -420)
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

        def refill(ea, halfper, width, fill0, y):
            # MIRROR-REPEAT AT 1:1 (PASS 04g): u' = fill0 + width * tri(ea),
            # tri = abs(frac(ea / (2 width)) * 2 - 1), a triangle wave of
            # period 2 * width. The span is neither stretched (04f mapped the
            # 0.082 span over a 0.21 band, a 2.5x stretch that smeared the far
            # castle across the left of V2_PASS_026) nor cut: each copy is
            # the mirror of its neighbour, so the seams are continuous.
            t = node(unreal.MaterialExpressionMultiply, -760, y)
            link(ea, "", t, "A")
            link(halfper, "", t, "B")
            f = node(unreal.MaterialExpressionFrac, -690, y)
            link(t, "", f, "")
            g = node(unreal.MaterialExpressionMultiply, -620, y)
            link(f, "", g, "A")
            link(const(-690, y + 60, 2.0), "", g, "B")
            h = node(unreal.MaterialExpressionAdd, -560, y)
            link(g, "", h, "A")
            link(const(-620, y + 60, -1.0), "", h, "B")
            a = node(unreal.MaterialExpressionAbs, -500, y)
            link(h, "", a, "")
            s = node(unreal.MaterialExpressionMultiply, -440, y)
            link(a, "", s, "A")
            link(width, "", s, "B")
            o = node(unreal.MaterialExpressionAdd, -380, y)
            link(s, "", o, "A")
            link(fill0, "", o, "B")
            return o
        na0 = param(unreal.MaterialExpressionScalarParameter, "NearA0", 600, 0.0, -1000)
        na1 = param(unreal.MaterialExpressionScalarParameter, "NearA1", 680, 0.0, -1000)
        nb0 = param(unreal.MaterialExpressionScalarParameter, "NearB0", 900, 0.0, -1000)
        nb1 = param(unreal.MaterialExpressionScalarParameter, "NearB1", 980, 0.0, -1000)
        band_a, ea_a = band(na0, na1, 600)
        band_b, ea_b = band(nb0, nb1, 900)
        fa0 = param(unreal.MaterialExpressionScalarParameter, "NearFillA0", 1200, 0.0, -1000)
        faw = param(unreal.MaterialExpressionScalarParameter, "NearWidthA", 1260, 1.0, -1000)
        fah = param(unreal.MaterialExpressionScalarParameter, "NearHalfPerA", 1320, 0.5, -1000)
        fb0 = param(unreal.MaterialExpressionScalarParameter, "NearFillB0", 1400, 0.0, -1000)
        fbw = param(unreal.MaterialExpressionScalarParameter, "NearWidthB", 1460, 1.0, -1000)
        fbh = param(unreal.MaterialExpressionScalarParameter, "NearHalfPerB", 1520, 0.5, -1000)
        base = sample(um, -200)
        fill_a = sample(refill(ea_a, fah, faw, fa0, 1200), 1200)
        fill_b = sample(refill(ea_b, fbh, fbw, fb0, 1440), 1440)
        c1 = node(unreal.MaterialExpressionLinearInterpolate, -300, -100)
        link(base, "", c1, "A")
        link(fill_a, "", c1, "B")
        link(band_a, "", c1, "Alpha")
        c2 = node(unreal.MaterialExpressionLinearInterpolate, -200, -100)
        link(c1, "", c2, "A")
        link(fill_b, "", c2, "B")
        link(band_b, "", c2, "Alpha")
        # PASS 06: HAZE INSTEAD OF ARCHITECTURE. Below HazeV0 the panorama's
        # colour blends into HazeColor (fully by HazeV1) and stays haze to
        # the true horizon, so no painted tower or mushroom reaches the
        # frame; the 3D city stands in front of a quiet gradient.
        hz0 = param(unreal.MaterialExpressionScalarParameter, "HazeV0", 1600, 0.30, -700)
        hz1 = param(unreal.MaterialExpressionScalarParameter, "HazeV1", 1680, 0.36, -700)
        hcol = param(unreal.MaterialExpressionVectorParameter, "HazeColor", 1760, unreal.LinearColor(0.56, 0.64, 0.80, 1), -700)
        hd = node(unreal.MaterialExpressionSubtract, -560, 1620)
        link(vl, "", hd, "A")
        link(hz0, "", hd, "B")
        hw = node(unreal.MaterialExpressionSubtract, -560, 1700)
        link(hz1, "", hw, "A")
        link(hz0, "", hw, "B")
        hq = node(unreal.MaterialExpressionDivide, -460, 1640)
        link(hd, "", hq, "A")
        link(hw, "", hq, "B")
        ha = node(unreal.MaterialExpressionSaturate, -380, 1640)
        link(hq, "", ha, "")
        c3 = node(unreal.MaterialExpressionLinearInterpolate, -200, 0)
        link(c2, "", c3, "A")
        link(hcol, "", c3, "B")
        link(ha, "", c3, "Alpha")
        gain = param(unreal.MaterialExpressionScalarParameter, "SkyGain", 200, 1.0, -420)
        pm = node(unreal.MaterialExpressionMultiply, -100, -100)
        link(c3, "", pm, "A")
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


#: PASS 09b: WLV2_REUSE_MATERIALS=1 loads the existing masters and instances
#: instead of recreating them. Every generate deletes and recreates all four
#: masters, which gives them fresh GUIDs, which invalidates their shadermaps,
#: which makes the editor recompile the lot -- measured at ~5 minutes of a
#: ~15-minute generate once the surface master became triplanar and its
#: permutations tripled. That is the right price when a tint or the master
#: graph changed and pure waste on a pass that only moved actors, which most
#: passes are. It is OPT-IN and it verifies: if any expected asset is missing
#: it falls back to a full rebuild and says so, because a half-loaded material
#: set is the grey world again.
REUSE_MATERIALS = os.environ.get("WLV2_REUSE_MATERIALS", "0") == "1"


def _load_existing(unreal, log):
    """Every master and instance from disk, or None if any is missing."""
    eal = unreal.EditorAssetLibrary
    pkg = C.FOLDERS["mat_instances"]
    mpkg = C.FOLDERS["mat_master"]
    out = {}
    for name in ("M_V2_Surface", "M_V2_Foliage", "M_V2_Portal", "M_V2_SkyDome"):
        if not eal.does_asset_exist(mpkg + "/" + name):
            log("V2 MATERIALS REUSE: %s missing -- rebuilding all" % name)
            return None
    for name in INSTANCES:
        path = pkg + "/" + name
        if not eal.does_asset_exist(path):
            log("V2 MATERIALS REUSE: %s missing -- rebuilding all" % name)
            return None
        mi = eal.load_asset(path)
        if mi is None:
            log("V2 MATERIALS REUSE: %s would not load -- rebuilding all" % name)
            return None
        out[name] = mi
    # MI_V2_SkyPano IS NOT IN `INSTANCES`. The full build creates it beside
    # them, which is why that path reports 47 instances against this one's 46
    # -- and it is the panorama dome's ONLY material. With skyDome=0 nothing
    # references it and the difference is cosmetic; with skyDome=1 a reused
    # set would have handed the dome no material at all, and the guard that
    # exists for exactly that ("skyDome=1 but MI_V2_SkyPano was not built")
    # lives further down the path this function short-circuits. So it is
    # checked here, where the short circuit is.
    sky = pkg + "/MI_V2_SkyPano"
    if eal.does_asset_exist(sky):
        mi = eal.load_asset(sky)
        if mi is not None:
            out["MI_V2_SkyPano"] = mi
    if int(C.LOOK["skyDome"]) and "MI_V2_SkyPano" not in out:
        log("V2 MATERIALS REUSE: skyDome=1 and MI_V2_SkyPano is not on disk -- rebuilding all")
        return None
    return out


def build_materials(unreal, log, texs):
    """Create the masters and every instance. Returns name -> instance."""
    mel = unreal.MaterialEditingLibrary
    eal = unreal.EditorAssetLibrary
    if REUSE_MATERIALS:
        existing = _load_existing(unreal, log)
        if existing is not None:
            log("V2 MATERIALS: %d instances REUSED from disk (WLV2_REUSE_MATERIALS=1) -- "
                "no master rebuild, no shader recompile" % len(existing))
            return existing
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
                _scale = 1.0 if name in EMISSIVE_ABSOLUTE else float(C.LOOK["portalGlow"])
                mel.set_material_instance_scalar_parameter_value(mi, "EmissiveStrength", float(es) * _scale)
            stems = FAMILY_FILES.get(fam, (None, None, None))
            for pname, stem in (("Albedo", stems[0]), ("Normal", stems[1]), ("RoughnessMap", stems[2])):
                if stem and stem in texs:
                    mel.set_material_instance_texture_parameter_value(mi, pname, texs[stem])
                elif stem is None and fam == "leaf":
                    plain, used = None, None
                    for cand in PLAIN_MAPS[pname]:
                        try:
                            plain = eal.load_asset(cand)
                        except Exception:
                            plain = None
                        if plain is not None:
                            used = cand
                            break
                    if plain is None and PLAIN_FALLBACK.get(pname) in texs:
                        plain, used = texs[PLAIN_FALLBACK[pname]], PLAIN_FALLBACK[pname] + " (V2 fallback)"
                        log("V2 MATERIAL %s: no engine %s map loaded (%s); using %s"
                            % (name, pname, ", ".join(PLAIN_MAPS[pname]), used))
                    if plain is None:
                        raise RuntimeError("no %s map for %s: engine %s did not load and no V2 fallback"
                                           % (pname, name, ", ".join(PLAIN_MAPS[pname])))
                    mel.set_material_instance_texture_parameter_value(mi, pname, plain)
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
            mel.set_material_instance_scalar_parameter_value(mi, "HazeV0", float(C.LOOK["skyHazeV0"]))
            mel.set_material_instance_scalar_parameter_value(mi, "HazeV1", float(C.LOOK["skyHazeV1"]))
            hc = C.LOOK["skyHazeColor"]
            mel.set_material_instance_vector_parameter_value(mi, "HazeColor", unreal.LinearColor(hc[0], hc[1], hc[2], 1))
            (a0, a1), (b0, b1) = C.LOOK["skyNearBands"]
            (ca0, ca1), (cb0, cb1) = C.LOOK["skyNearFills"]
            if not (a1 > a0 and b1 > b0 and ca1 > ca0 and cb1 > cb0):
                raise RuntimeError("skyNearBands / skyNearFills must be increasing spans")
            for pname, val in (("NearA0", a0), ("NearA1", a1), ("NearB0", b0), ("NearB1", b1),
                               ("NearFillA0", ca0), ("NearWidthA", ca1 - ca0), ("NearHalfPerA", 0.5 / (ca1 - ca0)),
                               ("NearFillB0", cb0), ("NearWidthB", cb1 - cb0), ("NearHalfPerB", 0.5 / (cb1 - cb0))):
                mel.set_material_instance_scalar_parameter_value(mi, pname, float(val))
            log("V2 SKY: panorama u=0.5 faces yaw %.0f; horizon v %.4f; near bands %s refilled from u %s (mirror-repeated at 1:1, same v, colour cross-fade); haze from v %.2f to %.2f"
                % (C.LOOK["skyYawOffset"], C.LOOK["skyHorizonV"], C.LOOK["skyNearBands"], C.LOOK["skyNearFills"],
                   C.LOOK["skyHazeV0"], C.LOOK["skyHazeV1"]))
            eal.save_asset(path, only_if_is_dirty=False)
            out[name] = mi
        except Exception as exc:
            log("V2 MATERIAL MI_V2_SkyPano FAILED: %s" % exc)
    if int(C.LOOK["skyDome"]) and "MI_V2_SkyPano" not in out:
        raise RuntimeError("skyDome=1 but MI_V2_SkyPano was not built -- see the V2 MATERIAL lines above")
    # A FOLIAGE INSTANCE THAT FAILS IS A COOKED WORLD WITHOUT VEGETATION
    # MATERIALS (PASS 05e's first chain: four leaf instances failed on an
    # engine map path, the generate returned 0, and the package rendered its
    # canopies in the mesh default). Fail the generate instead.
    missing = [n for n in FOLIAGE if n not in out]
    if missing:
        raise RuntimeError("foliage instances not built: %s -- see the V2 MATERIAL lines above" % ", ".join(missing))
    log("V2 MATERIALS: %d masters, %d instances" % (len(masters), len(out)))
    return out
