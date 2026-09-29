# WHAT DOES A TREE COST NOW? Nanite, LOD0 triangles and LOD count for every vegetation mesh the world plants.
#
# Dubel Forest (DF01, 2026-09-23) capped itself at 620 trees because "SM_canopy_large alone is 31,264 triangles
# with one LOD", and wrote that full woodland across the outer ring "is gated on vegetation LODs". The next day
# the ledger records Nanite enabled on 137 Wonderland meshes. Whether the tree meshes were among them decides
# whether the 170 ha wild ring can be woodland or must be meadow and mushroom wood -- so it is read here, not
# remembered. Read-only; CONCURRENT.
CONCURRENT = True

MESHES = [
    "/Game/WonderlandV2/Vegetation/Trees/SM_tree_slender_trunk.SM_tree_slender_trunk",
    "/Game/WonderlandV2/Vegetation/Trees/SM_tree_mature_trunk.SM_tree_mature_trunk",
    "/Game/WonderlandV2/Vegetation/Trees/SM_canopy_medium.SM_canopy_medium",
    "/Game/WonderlandV2/Vegetation/Trees/SM_canopy_large.SM_canopy_large",
    "/Game/WonderlandV2/Vegetation/Shrubs/SM_shrub_flowering.SM_shrub_flowering",
    "/Game/WonderlandV2/Vegetation/Shrubs/SM_hedge_block.SM_hedge_block",
    "/Game/WonderlandV2/Vegetation/Roses/SM_rose_bush.SM_rose_bush",
    "/Game/WonderlandV2/Vegetation/Topiary/SM_topiary_ball.SM_topiary_ball",
    "/Game/WonderlandV2/Vegetation/Topiary/SM_topiary_spiral.SM_topiary_spiral",
    "/Game/WonderlandV2/Vegetation/Topiary/SM_topiary_cone_plain.SM_topiary_cone_plain",
    "/Game/WonderlandV2/Props/Garden/SM_waymarker_lamp.SM_waymarker_lamp",
    "/Game/WonderlandV2/Kit/mushrooms/WL_Mushroom_Tall_mush_cap.WL_Mushroom_Tall_mush_cap",
    "/Game/WonderlandV2/Kit/mushrooms/WL_Mushroom_Tall_mush_gill.WL_Mushroom_Tall_mush_gill",
    "/Game/WonderlandV2/Kit/mushrooms/WL_Mushroom_Tall_mush_spot.WL_Mushroom_Tall_mush_spot",
    "/Game/WonderlandV2/Kit/mushrooms/WL_Mushroom_Tall_mush_stem.WL_Mushroom_Tall_mush_stem",
    "/Game/WonderlandV2/Kit/mushrooms/WL_Mushroom_Toadstool_mush_cap.WL_Mushroom_Toadstool_mush_cap",
    "/Game/WonderlandV2/Kit/mushrooms/WL_Mushroom_Toadstool_mush_gill.WL_Mushroom_Toadstool_mush_gill",
    "/Game/WonderlandV2/Kit/mushrooms/WL_Mushroom_Toadstool_mush_spot.WL_Mushroom_Toadstool_mush_spot",
    "/Game/WonderlandV2/Kit/mushrooms/WL_Mushroom_Toadstool_mush_stem.WL_Mushroom_Toadstool_mush_stem",
    "/Game/WonderlandV2/Kit/flowers/WL_Flower_Rose_Run_leaf.WL_Flower_Rose_Run_leaf",
    "/Game/WonderlandV2/Kit/flowers/WL_Flower_Rose_Run_petal.WL_Flower_Rose_Run_petal",
    "/Game/WonderlandV2/Kit/gardens/WL_Garden_Grass_Tuft_leaf.WL_Garden_Grass_Tuft_leaf",
]


def job():
    RESULT["status"] = "running"
    rows = []
    for p in MESHES:
        m = unreal.load_asset(p)
        if m is None:
            rows.append({"mesh": p.split(".")[-1], "loaded": False})
            continue
        row = {"mesh": m.get_name(), "loaded": True}
        try:
            ns = m.get_editor_property("nanite_settings")
            row["nanite"] = bool(ns.get_editor_property("enabled"))
        except Exception as exc:                                       # noqa: BLE001
            row["nanite"] = "unreadable: %r" % exc
        try:
            row["lods"] = int(m.get_num_lods())
        except Exception:                                              # noqa: BLE001
            row["lods"] = None
        try:
            row["lod0_triangles"] = int(unreal.EditorStaticMeshLibrary.get_number_triangles(m, 0)) \
                if hasattr(unreal, "EditorStaticMeshLibrary") else int(m.get_num_triangles(0))
        except Exception:                                              # noqa: BLE001
            try:
                row["lod0_triangles"] = int(m.get_num_triangles(0))
            except Exception as exc:                                   # noqa: BLE001
                row["lod0_triangles"] = "unreadable: %r" % exc
        rows.append(row)
        yield 0.0
    RESULT["meshes"] = rows
    RESULT["status"] = "read"
