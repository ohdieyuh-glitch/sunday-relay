# Editor job: build the city's PLASTER -- import the stucco texture set and create its material instances.
#
# WHY (PS01, 2026-09-17, founder material-realism phase, "plaster"). Every wall in Wonderland is coursed ashlar
# marble: the visible-material census lists AshlarMarblePale, Blush, Cool, Shade and Ceramic and nothing else for
# walls. BOARD_2's material palette names CREAM STUCCO beside pale stone, and a plastered wall is not an ashlar wall
# with the joints turned off -- it is a different scale of relief. hd_textures.stucco generates the set (sand tooth
# over trowel undulation, limewash cloudiness, a few open pores; no cracks, no grime).
#
# WHAT THIS MAKES. Three instances of M_V2_SurfaceHD -- MI_V2_StuccoCream, MI_V2_StuccoBlush, MI_V2_StuccoShade --
# each taking its tint from the ashlar instance it stands beside in the palette (Pale, Blush, Shade), so plaster
# joins the city's colours instead of introducing new ones. Cream is warmed a little; that is the only invention.
# TexScale 0.004 lays the set at 2.5 m: plaster has no features to repeat, so a long tile hides the tiling and keeps
# the sand fine.
# Globals: FORCE (rebuild instances that exist), SAVE.
import json
import os

FORCE = globals().get("FORCE", False)
SAVE = globals().get("SAVE", True)
TEX_DIR = globals().get("TEX_DIR", r"C:/dev/iwonder/recovery/textures_hd")
TEX_DEST = "/Game/WonderlandV2/Textures/HD"
INST = "/Game/WonderlandV2/Materials/Instances"
MASTER = "/Game/WonderlandV2/Materials/M_V2_SurfaceHD.M_V2_SurfaceHD"
FILES = ("T_HD_stucco_a.png", "T_HD_stucco_n.png", "T_HD_stucco_r.png")
# new instance -> (the ashlar instance whose tint it takes, extra warmth on that tint)
PLAN = {"MI_V2_StuccoCream": ("MI_V2_AshlarMarblePale", 1.03),
        "MI_V2_StuccoBlush": ("MI_V2_AshlarMarbleBlush", 1.0),
        "MI_V2_StuccoShade": ("MI_V2_AshlarMarbleShade", 1.0)}
VALUES = {"TexScale": 0.004, "NormalStrength": 1.0, "DetailScale": 4.0, "DetailStrength": 0.25,
          "InstVary": 0.05, "InstWarm": 0.025, "InstRoughVary": 0.08, "MacroScale": 0.00016, "MacroVary": 0.06}


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    log = []

    tasks = []
    for fn in FILES:
        stem = fn[:-4]
        if eal.does_asset_exist(TEX_DEST + "/" + stem) and not FORCE:
            continue
        t = unreal.AssetImportTask()
        t.set_editor_property("filename", os.path.join(TEX_DIR, fn))
        t.set_editor_property("destination_path", TEX_DEST)
        t.set_editor_property("automated", True)
        t.set_editor_property("replace_existing", True)
        t.set_editor_property("save", True)
        tasks.append(t)
    if tasks:
        tools.import_asset_tasks(tasks)
    yield 0.5
    texs = {}
    for fn in FILES:
        stem = fn[:-4]
        tex = unreal.load_asset("%s/%s.%s" % (TEX_DEST, stem, stem))
        if tex is None:
            RESULT["status"] = "error"
            RESULT["error"] = "texture did not import: " + stem
            return
        # the normal map must be a normal map, and the roughness must not be sRGB
        if stem.endswith("_n"):
            tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
            tex.set_editor_property("srgb", False)
        elif stem.endswith("_r"):
            tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
            tex.set_editor_property("srgb", False)
        eal.save_asset("%s/%s" % (TEX_DEST, stem), only_if_is_dirty=False)
        texs[stem] = tex
    macro = unreal.load_asset("%s/T_HD_macro.T_HD_macro" % TEX_DEST)
    master = unreal.load_asset(MASTER)
    if master is None:
        RESULT["status"] = "error"
        RESULT["error"] = "M_V2_SurfaceHD not found"
        return

    made = {}
    for name, (src_name, warm) in PLAN.items():
        path = INST + "/" + name
        if eal.does_asset_exist(path):
            if not FORCE:
                made[name] = "exists"
                continue
            eal.delete_asset(path)
        src = unreal.load_asset("%s/%s.%s" % (INST, src_name, src_name))
        mi = tools.create_asset(name, INST, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, master)
        for k, v in VALUES.items():
            mel.set_material_instance_scalar_parameter_value(mi, k, float(v))
        if src is not None:
            c = mel.get_material_instance_vector_parameter_value(src, "BaseColor")
            mel.set_material_instance_vector_parameter_value(
                mi, "BaseColor", unreal.LinearColor(c.r * warm, c.g * (1.0 + (warm - 1.0) * 0.6), c.b, 1.0))
            log.append("%s takes its tint from %s" % (name, src_name))
        for slot, suffix in (("Albedo", "a"), ("Normal", "n"), ("RoughnessMap", "r")):
            mel.set_material_instance_texture_parameter_value(mi, slot, texs["T_HD_stucco_" + suffix])
        if macro is not None:
            mel.set_material_instance_texture_parameter_value(mi, "Macro", macro)
        mel.update_material_instance(mi)
        if SAVE:
            eal.save_asset(path, only_if_is_dirty=False)
        made[name] = "made"
        yield 0.2
    RESULT["made"] = made
    RESULT["log"] = log
    RESULT["status"] = "done"
