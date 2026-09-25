# TURN NANITE ON FOR WONDERLAND'S OWN HEAVY MESHES.
#
# WORLD_BETA_LEDGER row I, BLOCKING: 114,637,683 triangles, 99.2% of them on single-LOD meshes, vegetation
# 89.3% of every triangle -- "whether Nanite covers them is unverified and is now the single most valuable
# unknown in this ledger." Audited: 1,187 static meshes, 109 already Nanite, 1,110 single-LOD, and 187 meshes
# at 1,500+ triangles with Nanite off.
#
# ONLY WONDERLAND'S OWN. The heaviest meshes in that list are the engine's -- EditorShaderBall,
# S_Preview_LS_256x256, SM_MatPreviewMesh_01 -- which are editor furniture that never renders in the game and
# must not be touched. This changes assets under /Game/Wonderland and /Game/WonderlandV2 and nothing else.
#
# REVERSIBLE. Nanite is one boolean per mesh; zc_nanite_revert.py puts back exactly the list this wrote.
import json
import os

MINE = ("/Game/Wonderland", "/Game/WonderlandV2")
FLOOR = 1500
LEDGER = os.path.join(os.path.dirname(CHANNEL), "nanite_enabled.json")


def job():
    RESULT["status"] = "running"
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    sub = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    changed, skipped, failed = [], 0, []
    small = 0
    unreadable = 0
    already = 0

    for hit in reg.get_assets_by_class(unreal.TopLevelAssetPath("/Script/Engine", "StaticMesh"), True):
        package = str(hit.package_name)
        if not package.startswith(MINE):
            continue
        mesh = unreal.load_asset(package + "." + str(hit.asset_name))
        if mesh is None:
            continue
        # THE SAME FALLBACK CHAIN THE AUDIT USED. The first version called only the subsystem and mapped any
        # failure to -1, which then read as "too small" -- so a silent API failure looked exactly like a mesh
        # not worth touching, and all 960 were skipped for a reason that was never true.
        tris = -1
        try:
            tris = int(sub.get_number_triangles(mesh, 0))
        except Exception:
            pass
        if tris < 0:
            try:
                tris = int(mesh.get_num_triangles(0))
            except Exception:
                tris = -1
        if tris < 0:
            unreadable += 1
            continue
        if tris < FLOOR:
            small += 1
            continue
        try:
            settings = mesh.get_editor_property("nanite_settings")
            if bool(settings.get_editor_property("enabled")):
                already += 1
                continue
            settings.set_editor_property("enabled", True)
            mesh.set_editor_property("nanite_settings", settings)
            unreal.EditorAssetLibrary.save_loaded_asset(mesh)
            changed.append({"name": str(hit.asset_name), "package": package, "triangles": tris})
        except Exception as bad:
            failed.append({"name": str(hit.asset_name), "why": str(bad)[:140]})

    RESULT["enabled_count"] = len(changed)
    RESULT["triangles_covered"] = sum(c["triangles"] for c in changed)
    RESULT["skipped_too_small"] = small
    RESULT["skipped_already_nanite"] = already
    RESULT["skipped_unreadable"] = unreadable
    RESULT["failed"] = failed[:10]
    RESULT["heaviest_changed"] = sorted(changed, key=lambda c: -c["triangles"])[:15]
    try:
        with open(LEDGER, "w", encoding="utf-8") as out:
            json.dump(changed, out, indent=1)
        RESULT["ledger"] = LEDGER
    except Exception as bad:
        RESULT["ledger_error"] = str(bad)[:140]
    RESULT["status"] = "applied"
    yield 0.1
