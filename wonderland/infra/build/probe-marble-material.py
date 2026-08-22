"""What did UE actually make of the Marble material?

The manifest warned about exactly one thing that would make a correctly placed,
correctly oriented, correctly scaled backdrop invisible: the export is
KHR_materials_unlit, its lighting is BAKED INTO the texture, and if the importer
drops that extension the mesh becomes LIT — so Wonderland's night lighting
renders a bright daylight photograph as near-black.

This asks the asset rather than guessing. Read-only.
"""
import unreal

ROOT = "/Game/Wonderland/Marble"
found = 0
for path in unreal.EditorAssetLibrary.list_assets(ROOT, recursive=True):
    obj = unreal.EditorAssetLibrary.load_asset(path)
    if obj is None:
        continue
    cls = type(obj).__name__
    if "Material" not in cls:
        continue
    found += 1
    unreal.log_warning("[probe] MATERIAL %s  class=%s" % (path, cls))
    parent = None
    try:
        parent = obj.get_editor_property("parent")
    except Exception as exc:
        unreal.log_warning("[probe]   no parent property: %s" % exc)
    unreal.log_warning("[probe]   parent=%s" % (parent.get_path_name() if parent else None))
    for prop in ("shading_model", "blend_mode", "two_sided"):
        try:
            unreal.log_warning("[probe]   %s=%s" % (prop, obj.get_editor_property(prop)))
        except Exception:
            pass
    try:
        ov = obj.get_editor_property("base_property_overrides")
        for prop in ("override_shading_model", "shading_model",
                     "override_two_sided", "two_sided",
                     "override_blend_mode", "blend_mode"):
            try:
                unreal.log_warning("[probe]   override.%s=%s" % (prop, ov.get_editor_property(prop)))
            except Exception:
                pass
    except Exception:
        pass
    # The parent chain is where an Unlit glTF master would show up.
    chain, node, depth = [], parent, 0
    while node is not None and depth < 6:
        chain.append(node.get_path_name())
        try:
            node = node.get_editor_property("parent")
        except Exception:
            node = None
        depth += 1
    unreal.log_warning("[probe]   parent chain: %s" % (" -> ".join(chain) or "(none)"))

unreal.log_warning("[probe] MARBLE_MATERIALS_FOUND=%d" % found)
