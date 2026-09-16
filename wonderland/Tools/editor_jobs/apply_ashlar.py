# Editor job: MQ05 -- the generator's castle walls laid in coursed ashlar, reversibly.
#
# THE GAP (corridor captures pl02a / ga03c, 2026-09-15; founder: "stone should read as stone"). The castle halls,
# facade panels, arcades and towers either side of the Heart Garden draw with MI_V2_Marble{Pale,Blush,Cool,Shade},
# MI_V2_Ceramic and MI_V2_IvoryStone -- the ivory HD set, a soft-mottled sandstone with no joints -- so at walking
# distance a 10 m hall is one smudged plaster slab.
#
# WHAT THIS JOB DOES.
#   1. imports T_HD_ashlar_{a,n,r} (hd_textures.py `ashlar`: 50 cm courses laid at TexScale 0.0025, chamfered joints,
#      per-block tone) into /Game/WonderlandV2/Textures/HD;
#   2. builds MI_V2_Ashlar<Name> on M_V2_SurfaceHD for each wall instance, its BaseColor from the instance it replaces
#      (x TINT_GAIN when that instance is still on the V2 master), no detail normal (a second sample at 4x would lay
#      12 cm courses over the 50 cm ones);
#   3. points ONLY the castle meshes' batches at them (Material + MaterialPath). Kerbs, benches, balustrades, urns,
#      tea cups and every kit module keep their materials. Every change is written to RECORD with its before;
#      REVERT = True restores it.
# Globals: TEX_DIR, REVERT, RECORD, FORCE (rebuild the instances), MESHES (which meshes take the coursing).
import json
import os

TEX_DIR = globals().get("TEX_DIR", r"C:/dev/iwonder/recovery/textures_hd")
REVERT = globals().get("REVERT", False)
FORCE = globals().get("FORCE", False)
RECORD = globals().get("RECORD", r"C:/dev/iwonder/recovery/evidence/2026-09-15-MQ05/ashlar_record.json")
TEX_DEST = "/Game/WonderlandV2/Textures/HD"
INST = "/Game/WonderlandV2/Materials/Instances"
MASTER = "/Game/WonderlandV2/Materials/M_V2_SurfaceHD.M_V2_SurfaceHD"
TINT_GAIN = 0.92 / 0.72
# MQ05b (2026-09-15): the garden and retaining walls along the corridor are the same smooth ivory (survey sv2, the
# arrival apron's wall), so they take the coursing too. Turned pieces (balustrades, urns, columns) never do.
MESHES = globals().get("MESHES", ("SM_castle_hall", "SM_facade_panel", "SM_castle_arcade", "SM_castle_tower",
                                  "SM_castle_tower_slender", "SM_castle_tower_octagon", "SM_castle_tower_square",
                                  "SM_garden_wall", "SM_retaining_wall", "SM_castle_bridge"))
CASTLE = MESHES
WALLS = ("MI_V2_MarblePale", "MI_V2_MarbleBlush", "MI_V2_MarbleCool", "MI_V2_MarbleShade", "MI_V2_Ceramic", "MI_V2_IvoryStone")
ASHLAR = {"TexScale": 0.0025, "NormalStrength": 1.0, "DetailStrength": 0.0, "InstVary": 0.05, "InstWarm": 0.02,
          "InstRoughVary": 0.08, "MacroScale": 0.00016, "MacroVary": 0.07, "RoughVary": 0.8, "Metallic": 0.0, "Specular": 0.4}


def _textures(log):
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    out = {}
    for suffix in ("a", "n", "r"):
        stem = "T_HD_ashlar_" + suffix
        if FORCE or not eal.does_asset_exist(TEX_DEST + "/" + stem):
            t = unreal.AssetImportTask()
            t.set_editor_property("filename", os.path.join(TEX_DIR, stem + ".png"))
            t.set_editor_property("destination_path", TEX_DEST)
            t.set_editor_property("destination_name", stem)
            t.set_editor_property("automated", True)
            t.set_editor_property("save", False)
            t.set_editor_property("replace_existing", True)
            tools.import_asset_tasks([t])
        tex = unreal.load_asset(TEX_DEST + "/" + stem)
        if tex is None:
            log.append("texture did not import: " + stem)
            continue
        if suffix == "n":
            tex.set_editor_property("srgb", False)
            tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        elif suffix == "r":
            tex.set_editor_property("srgb", False)
            tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_GRAYSCALE)
        else:
            tex.set_editor_property("srgb", True)
        eal.save_asset(TEX_DEST + "/" + stem, only_if_is_dirty=False)
        out[suffix] = tex
    return out


def _instances(texs, log):
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    eal = unreal.EditorAssetLibrary
    master = unreal.load_asset(MASTER)
    macro = unreal.load_asset(TEX_DEST + "/T_HD_macro")
    made = {}
    for src_name in WALLS:
        src = unreal.load_asset("%s/%s.%s" % (INST, src_name, src_name))
        if src is None:
            log.append("no instance " + src_name)
            continue
        name = src_name.replace("MI_V2_", "MI_V2_Ashlar")
        path = INST + "/" + name
        if eal.does_asset_exist(path) and not FORCE:
            made[src_name] = unreal.load_asset(path)
            continue
        if eal.does_asset_exist(path):
            mi = unreal.load_asset(path)
        else:
            mi = tools.create_asset(name, INST, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, master)
        on_hd = src.get_editor_property("parent") is not None and src.get_editor_property("parent").get_path_name() == MASTER
        rough = mel.get_material_instance_scalar_parameter_value(src, "Roughness")
        mel.set_material_instance_scalar_parameter_value(mi, "Roughness", float(rough if rough > 0.0 else 0.7))
        for k, v in ASHLAR.items():
            mel.set_material_instance_scalar_parameter_value(mi, k, float(v))
        c = mel.get_material_instance_vector_parameter_value(src, "BaseColor")
        g = 1.0 if on_hd else TINT_GAIN
        mel.set_material_instance_vector_parameter_value(mi, "BaseColor", unreal.LinearColor(c.r * g, c.g * g, c.b * g, 1.0))
        mel.set_material_instance_texture_parameter_value(mi, "Albedo", texs["a"])
        mel.set_material_instance_texture_parameter_value(mi, "Normal", texs["n"])
        mel.set_material_instance_texture_parameter_value(mi, "RoughnessMap", texs["r"])
        if macro is not None:
            mel.set_material_instance_texture_parameter_value(mi, "Macro", macro)
        mel.update_material_instance(mi)
        eal.save_asset(path, only_if_is_dirty=False)
        made[src_name] = mi
        log.append("%s <- %s (on_hd %s, base %s)" % (name, src_name, on_hd, [round(c.r * g, 3), round(c.g * g, 3), round(c.b * g, 3)]))
    return made


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    log = []
    RESULT["log_lines"] = log
    batches = [a for a in eas.get_all_level_actors() if isinstance(a, unreal.WonderlandInstancedBatch)]
    if REVERT:
        record = json.load(open(RECORD))
        by_name = {a.get_name(): a for a in batches}
        restored = 0
        for row in record["changes"]:
            a = by_name.get(row["name"])
            if a is None:
                log.append("missing " + row["name"])
                continue
            a.set_editor_property("material", unreal.load_asset(row["before_path"]))
            a.set_editor_property("material_path", row["before_path"])
            restored += 1
        RESULT["restored"] = restored
        RESULT["status"] = "done"
        return
    texs = _textures(log)
    yield 1.0
    made = _instances(texs, log)
    yield 1.0
    changes, loose = [], []
    for a in batches:
        mesh = a.get_editor_property("mesh")
        mat = a.get_editor_property("material")
        if mesh is None or mat is None or mesh.get_name() not in CASTLE or mat.get_name() not in made:
            continue
        new = made[mat.get_name()]
        changes.append({"name": a.get_name(), "label": a.get_actor_label(), "mesh": mesh.get_name(),
                        "instances": len(a.get_editor_property("transforms")) // 9,
                        "before": mat.get_name(), "before_path": mat.get_path_name(), "after_path": new.get_path_name()})
        a.set_editor_property("material", new)
        a.set_editor_property("material_path", new.get_path_name())
    for a in eas.get_all_level_actors():
        if isinstance(a, unreal.StaticMeshActor):
            c = a.static_mesh_component
            if c.static_mesh is not None and c.static_mesh.get_name() in CASTLE:
                loose.append([a.get_actor_label(), c.static_mesh.get_name()])
    os.makedirs(os.path.dirname(RECORD), exist_ok=True)
    if os.path.exists(RECORD):
        prior = json.load(open(RECORD))
        done = {r["name"] for r in prior["changes"]}
        changes = prior["changes"] + [c for c in changes if c["name"] not in done]
    with open(RECORD, "w") as f:
        json.dump({"pass": "MQ05", "changes": changes}, f, indent=1)
    RESULT["changed_batches"] = len(changes)
    RESULT["changed_instances"] = sum(c["instances"] for c in changes)
    RESULT["by_before"] = {w: sum(c["instances"] for c in changes if c["before"] == w) for w in WALLS}
    RESULT["loose_castle_actors"] = loose[:40]
    RESULT["status"] = "done"
