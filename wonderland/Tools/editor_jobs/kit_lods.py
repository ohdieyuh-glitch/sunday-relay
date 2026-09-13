# Editor job: give kit meshes that stand far away generated LODs, so a distant metropolis of hundreds of
# instances does not draw every triangle of every tower at a kilometre. Nanite meshes are skipped (Nanite
# does its own), and every mesh's LOD count before and after is recorded. Globals: MESHES (json path of
# package paths), LODS ([[percent_triangles, screen_size], ...]).
import json

MESHES = globals().get("MESHES")
LODS = globals().get("LODS", [[1.0, 1.0], [0.45, 0.30], [0.15, 0.08]])
EAL = unreal.EditorAssetLibrary


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    sms = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    paths = json.load(open(MESHES, encoding="utf-8"))
    options = unreal.StaticMeshReductionOptions()
    settings = []
    for pct, screen in LODS:
        s = unreal.StaticMeshReductionSettings()
        s.set_editor_property("percent_triangles", pct)
        s.set_editor_property("screen_size", screen)
        settings.append(s)
    options.set_editor_property("reduction_settings", settings)
    options.set_editor_property("auto_compute_lod_screen_size", False)
    done, skipped = [], []
    for p in paths:
        sm = EAL.load_asset(p)
        if sm is None:
            skipped.append([p, "not loaded"])
            continue
        if sm.get_editor_property("nanite_settings").enabled:
            skipped.append([p, "nanite"])
            continue
        before = sms.get_lod_count(sm)
        after = sms.set_lods(sm, options)
        EAL.save_asset(p, only_if_is_dirty=False)
        done.append([p.split("/")[-1], before, sms.get_lod_count(sm), [sms.get_number_verts(sm, i) for i in range(sms.get_lod_count(sm))]])
        yield None
    RESULT.update({"lodded": done, "skipped": skipped, "status": "done"})
