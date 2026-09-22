# READ-ONLY probe: why did the Cub's ghost plume render as a dark dithered cone instead of light?
#
# The first capture (cub01, 2026-09-22) showed the plume as a brown/grey 2x2 checkerboard -- the signature of
# DITHERED opacity, not of a translucent blend, and with no light coming out of it at all. Three things could do
# that and they need different fixes, so this asks rather than guesses:
#   1. blend_mode / shading_model did not stick on the master (set, saved, but read back as something else);
#   2. the emissive property has nothing connected, so an unlit material emits black;
#   3. the component is not using MI_RelayDogCub_Ghost at all.
# Globals: OUT.
import json

CONCURRENT = True
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/ghost_probe.json")
MASTER = "/Game/WonderlandV2/Materials/Master/M_V2_Ghost"
MI = "/Game/WonderlandV2/Characters/RelayDogCub/MI_RelayDogCub_Ghost"


def job():
    eal = unreal.EditorAssetLibrary
    mel = unreal.MaterialEditingLibrary
    out = {}

    m = eal.load_asset(MASTER)
    row = {"loaded": m is not None}
    if m is not None:
        for prop in ("blend_mode", "shading_model", "two_sided", "dithered_lod_transition",
                     "translucency_lighting_mode", "used_with_static_lighting"):
            try:
                row[prop] = str(m.get_editor_property(prop))
            except Exception as exc:
                row[prop] = "?(%s)" % exc
        for kind, fn in (("scalar", mel.get_scalar_parameter_names), ("vector", mel.get_vector_parameter_names)):
            try:
                row[kind] = sorted(str(n) for n in fn(m))
            except Exception as exc:
                row[kind] = "?(%s)" % exc
        # Does anything actually reach Emissive and Opacity? A parameter can exist in the graph and still be
        # connected to nothing, which is exactly what "unlit and black" looks like.
        for prop_name, prop in (("emissive", unreal.MaterialProperty.MP_EMISSIVE_COLOR),
                                ("opacity", unreal.MaterialProperty.MP_OPACITY)):
            try:
                exprs = mel.get_inputs_for_material_expression(m, None) if False else None
                row["connected_" + prop_name] = "unknown"
            except Exception:
                row["connected_" + prop_name] = "unknown"
        try:
            row["expressions"] = len(list(m.get_editor_property("expressions")))
        except Exception as exc:
            row["expressions"] = "?(%s)" % exc
    out["master"] = row

    mi = eal.load_asset(MI)
    mrow = {"loaded": mi is not None}
    if mi is not None:
        try:
            par = mi.get_editor_property("parent")
            mrow["parent"] = par.get_path_name() if par else None
        except Exception as exc:
            mrow["parent"] = "?(%s)" % exc
        for p in ("GhostOpacity", "GhostBrightness", "RimPower", "FadeFloor", "FadeRange"):
            try:
                mrow[p] = mel.get_material_instance_scalar_parameter_value(mi, p)
            except Exception as exc:
                mrow[p] = "?(%s)" % exc
        for p in ("GhostCore", "GhostRim"):
            try:
                c = mel.get_material_instance_vector_parameter_value(mi, p)
                mrow[p] = [round(c.r, 3), round(c.g, 3), round(c.b, 3)]
            except Exception as exc:
                mrow[p] = "?(%s)" % exc
    out["instance"] = mrow

    # What is actually ON the staged Cub in the world right now?
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    tag = unreal.Name("WL_CUBREVIEW")
    found = []
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        if tag not in a.tags or a.get_actor_label() != "CubHero":
            continue
        for comp in a.get_components_by_class(unreal.StaticMeshComponent):
            mats = []
            for i in range(comp.get_num_materials()):
                mm = comp.get_material(i)
                mats.append(mm.get_path_name() if mm else None)
            found.append({"component": comp.get_name(), "materials": mats,
                          "cast_shadow": bool(comp.get_editor_property("cast_shadow"))})
        break
    out["staged"] = found
    with open(OUT, "w", newline="\n") as f:
        json.dump(out, f, indent=1)
    RESULT["master"] = {k: v for k, v in out["master"].items() if k in
                        ("blend_mode", "shading_model", "two_sided", "expressions")}
    RESULT["instance"] = out["instance"]
    RESULT["ghost_components"] = [c for c in found if "ghost" in c["component"].lower()]
    RESULT["status"] = "done"
