# Editor job: import the Blender forge kit into this project from the forge's own plan
# (wonderland/art/unreal/import-plan.json on the local/wonderland-blender-forge worktree).
#
# WHY NOT THE FORGE'S IMPORTER AS-IS. Its first real run (2026-09-13) created material instances
# named after the FBX slots next to every mesh (Kit/towers/MI_V2_IvoryStone, a duplicate of the
# world's instance), built Nanite on meshes that asked for none, and ran as one blocking call over
# 313 meshes that the editor stopping cut short. This job keeps the forge's decisions (destinations,
# Nanite, collision, the V2 material per part) and changes only how they execute.
#
# MEASURED ENGINE BEHAVIOUR (UE 5.8.2, AssetTools.cpp ImportAssetTasks):
#   - task.options is honoured by Interchange ONLY as an InterchangePipelineStackOverride. A bare
#     InterchangeGenericAssetsPipeline goes to ConvertImportData, finds no converter, and the project's
#     default stack imports with its own settings -- every option silently ignored.
#   - The override replaces the default stack, so the pipeline starts from the settings of
#     /Interchange/Pipelines/DefaultAssetsPipeline that differ from a fresh object (weighted normals,
#     no geometry caches); otherwise the same FBX builds with different normals (3336 vs 1987 verts).
#   - EditorAssetLibrary refuses every call while Play-In-Editor runs ("The Editor is currently in a
#     play mode"): does_asset_exist answers False for assets that exist. The job waits PIE out.
#
# So: materials are never imported and slot 0 is bound to the world's own MI_V2_* instance; the
# plan's Nanite flag is enforced after import as well; a part that asked for collision but has no
# simple shapes collides complex-as-simple, so arches and arcades stay walkable; one part per tick,
# skipping parts already correct, so a stopped run resumes; everything is read back from the engine.
# Globals: PLAN (path), RESULT_PATH (path), FORCE (re-import existing), LIMIT (max parts this run),
# ONLY (asset paths to limit the run to).
import json
import os

PLAN = globals().get("PLAN", r"C:/dev/iwonder/wonderland-blender-forge/wonderland/art/unreal/import-plan.json")
RESULT_PATH = globals().get("RESULT_PATH", r"C:/dev/iwonder/recovery/evidence/kit-import-result.json")
FORCE = globals().get("FORCE", False)
LIMIT = globals().get("LIMIT", 100000)
ONLY = set(globals().get("ONLY", ()))   # asset paths; when set, every other part is left alone
EAL = unreal.EditorAssetLibrary


def _options(nanite, collision):
    pipeline = unreal.InterchangeGenericAssetsPipeline()
    # Match the project's default assets pipeline where it differs from a fresh object.
    pipeline.get_editor_property("common_meshes_properties").set_editor_property("compute_weighted_normals", True)
    material = pipeline.get_editor_property("material_pipeline")
    material.set_editor_property("import_materials", False)
    mesh = pipeline.get_editor_property("mesh_pipeline")
    mesh.set_editor_property("import_geometry_caches", False)
    mesh.set_editor_property("build_nanite", bool(nanite))
    mesh.set_editor_property("collision", bool(collision))
    if collision:
        mesh.set_editor_property("force_collision_primitive_generation", True)
    stack = unreal.InterchangePipelineStackOverride()
    stack.add_pipeline(pipeline)
    return stack


def _editor_idle():
    return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_game_world() is None


def _enforce(asset_path, asset):
    """Make the mesh match the plan's Nanite and collision requests. Returns what changed."""
    sm = EAL.load_asset(asset_path)
    if sm is None:
        return ["not loaded"]
    changed = []
    ns = sm.get_editor_property("nanite_settings")
    if bool(ns.enabled) != bool(asset["nanite_requested"]):
        ns.enabled = bool(asset["nanite_requested"])
        sm.set_editor_property("nanite_settings", ns)
        changed.append("nanite=%s" % ns.enabled)
    if asset["collision_requested"]:
        sms = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
        body = sm.get_editor_property("body_setup")
        complex_as_simple = unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE
        if body is not None and int(sms.get_simple_collision_count(sm)) == 0 and \
                body.get_editor_property("collision_trace_flag") != complex_as_simple:
            body.set_editor_property("collision_trace_flag", complex_as_simple)
            changed.append("complex-as-simple")
    if changed:
        EAL.save_asset(asset_path, only_if_is_dirty=False)
    return changed


def _readback(asset_path, want_material):
    sm = EAL.load_asset(asset_path)
    if sm is None:
        return {"loaded": False}
    out = {"loaded": True}
    try:
        out["nanite"] = bool(sm.get_editor_property("nanite_settings").enabled)
    except Exception as exc:
        out["nanite"] = "unreadable: %s" % exc
    try:
        sms = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
        out["simple_collision"] = int(sms.get_simple_collision_count(sm))
    except Exception as exc:
        out["simple_collision"] = "unreadable: %s" % exc
    body = sm.get_editor_property("body_setup")
    out["trace_flag"] = getattr(body.get_editor_property("collision_trace_flag"), "name", None) if body else None
    mat = sm.get_material(0)
    out["slot0"] = mat.get_path_name().split(".")[0] if mat else None
    out["slot0_ok"] = out["slot0"] == want_material
    b = sm.get_bounds()
    out["extent"] = [round(v, 1) for v in b.box_extent.to_tuple()]
    return out


def job():
    with open(PLAN, encoding="utf-8") as f:
        plan = json.load(f)
    parts = [(asset, part) for asset in plan["assets"] for part in asset["parts"]]
    results = []
    RESULT["planned_parts"] = len(parts)
    done = skipped = failed = 0
    for (asset, part) in parts:
        if done >= LIMIT:
            break
        while not _editor_idle():
            RESULT["waiting_for_pie_to_end"] = True
            yield 5.0
        asset_path = part["asset_path"]
        if ONLY and asset_path not in ONLY:
            continue
        record = {"asset_id": asset["asset_id"], "part": part["part"], "asset_path": asset_path}
        existing = EAL.does_asset_exist(asset_path) and not FORCE
        if existing and _readback(asset_path, part["material_path"]).get("slot0_ok"):
            record["action"] = "exists"
            skipped += 1
        elif not os.path.exists(part["source"]):
            record["action"] = "source missing"
            failed += 1
        else:
            task = unreal.AssetImportTask()
            task.set_editor_property("filename", part["source"])
            task.set_editor_property("destination_path", part["destination_path"])
            task.set_editor_property("destination_name", part["destination_name"])
            task.set_editor_property("automated", True)
            task.set_editor_property("replace_existing", True)
            task.set_editor_property("save", True)
            task.set_editor_property("options", _options(asset["nanite_requested"], asset["collision_requested"]))
            unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
            imported = list(task.get_editor_property("imported_object_paths") or [])
            record["imported"] = imported
            if not imported:
                record["action"] = "engine returned nothing"
                failed += 1
            else:
                sm = EAL.load_asset(asset_path)
                mat = EAL.load_asset(part["material_path"])
                if sm is not None and mat is not None:
                    sm.set_material(0, mat)
                    EAL.save_asset(asset_path, only_if_is_dirty=False)
                record["action"] = "imported"
                done += 1
            emit("[kit]", record["action"], asset_path)
            yield None          # one import per tick: the editor stays responsive and a stop loses one part
        if EAL.does_asset_exist(asset_path):
            record["enforced"] = _enforce(asset_path, asset)
            if record["enforced"]:
                yield None
        results.append(record)

    while not _editor_idle():
        yield 5.0
    # Stray materials the first, default-options run created inside the kit folders.
    strays = []
    for path in EAL.list_assets("/Game/WonderlandV2/Kit", recursive=True, include_folder=False):
        data = EAL.find_asset_data(path)
        cls = str(data.asset_class_path.asset_name)
        if cls in ("MaterialInstanceConstant", "Material"):
            strays.append(path.split(".")[0])
    deleted = [p for p in strays if EAL.delete_asset(p)]
    yield 0.2

    # Read every part back from the engine, imported this run or before.
    readback_fail = []
    nanite_mismatch = []
    collision_missing = []
    for record in results:
        asset = next(a for a in plan["assets"] if a["asset_id"] == record["asset_id"])
        part = next(p for p in asset["parts"] if p["part"] == record["part"])
        rb = _readback(record["asset_path"], part["material_path"])
        record["readback"] = rb
        if not rb.get("loaded") or not rb.get("slot0_ok"):
            readback_fail.append(record["asset_path"])
        if rb.get("loaded") and rb.get("nanite") is not asset["nanite_requested"]:
            nanite_mismatch.append(record["asset_path"])
        if rb.get("loaded") and asset["collision_requested"] and not rb.get("simple_collision") and rb.get("trace_flag") != "CTF_USE_COMPLEX_AS_SIMPLE":
            collision_missing.append(record["asset_path"])
    summary = {"imported_this_run": done, "already_present": skipped, "failed": failed,
               "stray_materials_deleted": deleted, "readback_failures": readback_fail, "nanite_mismatches": nanite_mismatch,
               "collision_missing": collision_missing,
               "complete": done + skipped == (len(ONLY) if ONLY else len(parts)) and not (readback_fail or nanite_mismatch or collision_missing)}
    RESULT.update(summary)
    os.makedirs(os.path.dirname(RESULT_PATH), exist_ok=True)
    with open(RESULT_PATH, "w", encoding="utf-8") as f:
        json.dump({"schema": "wonderland-kit-import-task3/1", "engine": unreal.SystemLibrary.get_engine_version(),
                   "plan": PLAN, "summary": summary, "results": results}, f, indent=1)
    RESULT["status"] = "done"
