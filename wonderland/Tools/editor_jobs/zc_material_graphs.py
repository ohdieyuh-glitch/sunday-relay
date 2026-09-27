# WHAT THE GLOW MATERIALS ACTUALLY COMPUTE, read off the assets, not inferred from renders.
#
# Three root causes in one afternoon lived in materials rather than in any number being set: an EmissiveColor
# of black behind a strength of 540; a strength term that made the figures' glow quadratic; and a pane that
# renders black at Color 18 on a material whose sibling needs 4000. Every one of those was found by rendering
# and guessing at the formula. This reads the formula: for each material, the expression graph feeding
# EmissiveColor and BaseColor, node by node, with every constant and parameter default -- so the next number
# anyone sets is set against what the material does with it.
#
# No PIE. Editor world only. Nothing is changed.
CONCURRENT = False

import unreal

MATERIALS = (
    "/Game/Wonderland/Materials/M_WL_VoxelGlow.M_WL_VoxelGlow",
    "/Game/Wonderland/Materials/M_WL_VoxelAdditive.M_WL_VoxelAdditive",
    "/Game/Wonderland/Materials/M_WL_Fire.M_WL_Fire",
    "/Game/Wonderland/Materials/M_V2_Portal.M_V2_Portal",
    "/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial",
    "/Engine/EngineMaterials/EmissiveMeshMaterial.EmissiveMeshMaterial",
)
MEL = unreal.MaterialEditingLibrary


def describe(expr, depth, seen):
    if expr is None:
        return "None"
    if depth > 8 or expr in seen:
        return "..."
    seen.add(expr)
    name = expr.get_class().get_name()
    detail = ""
    for prop in ("parameter_name", "default_value", "r", "g", "b", "a", "constant", "const_a", "const_b", "const_input",
                 "const_coordinate", "min_default", "max_default", "desc"):
        try:
            v = expr.get_editor_property(prop)
            if v is not None and v != "":
                detail += " %s=%s" % (prop, str(v)[:60])
        except Exception:                                          # noqa: BLE001
            pass
    out = "%s(%s)" % (name, detail.strip())
    try:
        inputs = MEL.get_inputs_for_material_expression(expr)
    except Exception:                                              # noqa: BLE001
        inputs = []
    kids = []
    for inp in inputs or []:
        try:
            got = MEL.get_input_node_for_material_expression(expr, inp)
        except Exception:                                          # noqa: BLE001
            got = None
        if got is not None:
            kids.append("%s<-%s" % (inp, describe(got, depth + 1, seen)))
    if kids:
        out += "[" + "; ".join(kids) + "]"
    return out


def job():
    RESULT["status"] = "running"
    graphs = {}
    RESULT["graphs"] = graphs
    for path in MATERIALS:
        mat = unreal.load_object(None, path)
        if mat is None:
            graphs[path] = "NOT FOUND"
            continue
        row = {"class": mat.get_class().get_name(), "blend": str(getattr(mat, "blend_mode", "?")),
               "shading": str(getattr(mat, "shading_model", "?"))}
        for prop_name, prop in (("emissive", unreal.MaterialProperty.MP_EMISSIVE_COLOR),
                                ("base", unreal.MaterialProperty.MP_BASE_COLOR),
                                ("opacity", unreal.MaterialProperty.MP_OPACITY)):
            try:
                node = MEL.get_material_property_input_node(mat, prop)
                row[prop_name] = describe(node, 0, set())
            except Exception as err:                               # noqa: BLE001
                row[prop_name] = "?" + str(err)[:80]
        graphs[path.rsplit(".", 1)[-1]] = row
        emit("G_" + path.rsplit(".", 1)[-1], "INFO", "graph", row)
        yield 0.0
    RESULT["status"] = "read"
    yield 0.2
