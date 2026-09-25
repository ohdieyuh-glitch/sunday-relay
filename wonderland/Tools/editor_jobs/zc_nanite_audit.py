# THE LEDGER'S SINGLE MOST VALUABLE UNKNOWN: DOES NANITE COVER THE GARDEN?
#
# WORLD_BETA_LEDGER row I, BLOCKING: "The world places 114,637,683 triangles, and 99.2% of them sit on
# single-LOD meshes... vegetation is 89.3% of every triangle in Wonderland (102.3 M -- the three flower runs
# alone are 67.9%)... All single-LOD, all in Golden Arrival, all in the first thing a player sees. Whether
# Nanite covers them is unverified and is now the single most valuable unknown in this ledger."
#
# So this asks every static mesh in the project what it is: triangles, LOD count, and whether Nanite is on.
# Nothing is changed here -- this is the measurement that decides what to change.
import unreal


def job():
    RESULT["status"] = "running"
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    sub = None
    try:
        sub = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    except Exception as bad:
        RESULT["subsystem_note"] = str(bad)[:140]
    rows = []
    total_tris = 0
    nanite_on = 0
    single_lod = 0
    checked = 0

    for hit in reg.get_assets_by_class(unreal.TopLevelAssetPath("/Script/Engine", "StaticMesh"), True):
        path = str(hit.package_name) + "." + str(hit.asset_name)
        mesh = unreal.load_asset(path)
        if mesh is None:
            continue
        checked += 1
        tris, lods = -1, -1
        if sub is not None:
            try:
                tris = int(sub.get_number_triangles(mesh, 0))
            except Exception:
                pass
            try:
                lods = int(sub.get_lod_count(mesh))
            except Exception:
                pass
        if tris < 0:
            # Last resort: the render data knows, and needs no editor subsystem at all.
            try:
                tris = int(mesh.get_num_triangles(0))
            except Exception:
                tris = -1
        if lods < 0:
            try:
                lods = int(mesh.get_num_lods())
            except Exception:
                lods = -1
        nanite = None
        try:
            settings = mesh.get_editor_property("nanite_settings")
            nanite = bool(settings.get_editor_property("enabled"))
        except Exception:
            pass
        if tris > 0:
            total_tris += tris
        if nanite:
            nanite_on += 1
        if lods == 1:
            single_lod += 1
        rows.append({"name": str(hit.asset_name), "path": path, "triangles": tris,
                     "lods": lods, "nanite": nanite})

    rows.sort(key=lambda r: -(r["triangles"] if r["triangles"] > 0 else 0))
    RESULT["meshes_checked"] = checked
    RESULT["nanite_enabled_count"] = nanite_on
    RESULT["single_lod_count"] = single_lod
    RESULT["heaviest"] = rows[:25]
    # Anything big enough that a single LOD is a real cost, and not already covered.
    RESULT["candidates"] = [r for r in rows if r["triangles"] >= 1500 and not r["nanite"]][:80]
    RESULT["candidate_count"] = len([r for r in rows if r["triangles"] >= 1500 and not r["nanite"]])
    RESULT["status"] = "audited"
    yield 0.1
