# Editor job, READ-ONLY and CONCURRENT: the full palette of buildable meshes, with real sizes.
#
# WHY. Building a district means choosing modules, and choosing them from memory is how IC01 first failed -- the
# apply refused with "asset did not load" because the paths were guessed. The old mesh_bounds_v2.json holds only
# ten meshes, a fraction of what the kit actually imported. This walks the asset registry instead, so the list is
# whatever is really there today.
#
# Reports each mesh's bounding size in centimetres, triangle count at LOD0, LOD count, material slots and whether
# it has collision geometry -- the four things that decide whether a module can carry a building, a floor or a
# detail, and what it will cost.
# Globals: ROOTS (content paths to walk), OUT.
import json

CONCURRENT = True
ROOTS = tuple(globals().get("ROOTS", ("/Game/WonderlandV2",)))
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/mesh_inventory.json")


def job():
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    rows = []
    seen = set()
    for root in ROOTS:
        assets = ar.get_assets_by_path(unreal.Name(root), recursive=True)
        for data in assets:
            path = str(data.package_name)
            if path in seen:
                continue
            seen.add(path)
            if str(data.asset_class_path.asset_name) != "StaticMesh":
                continue
            mesh = unreal.EditorAssetLibrary.load_asset(path)
            if mesh is None:
                continue
            try:
                mn, mx = mesh.get_bounds().box_extent, mesh.get_bounds().origin
                extent = mesh.get_bounds().box_extent
                size = [round(extent.x * 2, 1), round(extent.y * 2, 1), round(extent.z * 2, 1)]
            except Exception:
                size = None
            try:
                tris = mesh.get_num_triangles(0)
            except Exception:
                tris = None
            try:
                lods = mesh.get_num_lods()
            except Exception:
                lods = None
            try:
                slots = len(mesh.static_materials)
            except Exception:
                slots = None
            try:
                collision = mesh.get_num_sections(0) is not None and (
                    mesh.get_editor_property("body_setup") is not None)
            except Exception:
                collision = None
            rows.append({"name": path.rsplit("/", 1)[-1], "path": path,
                         "folder": path.rsplit("/", 1)[0].replace("/Game/WonderlandV2/", ""),
                         "size_cm": size, "tris": tris, "lods": lods, "slots": slots, "collision": collision})
            if len(rows) % 60 == 0:
                yield None
    rows.sort(key=lambda r: (r["folder"], r["name"]))
    with open(OUT, "w", newline="\n") as f:
        json.dump(rows, f, indent=1)
    folders = {}
    for r in rows:
        folders[r["folder"]] = folders.get(r["folder"], 0) + 1
    RESULT["meshes"] = len(rows)
    RESULT["folders"] = dict(sorted(folders.items()))
    RESULT["status"] = "done"
