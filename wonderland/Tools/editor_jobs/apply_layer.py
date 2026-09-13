# Editor job: apply one AUTHORED LAYER (wonderland/WorldDesign/**/<pass>.json) to the open map.
#
# A layer is additive and removable as a unit. Every actor it creates carries the tags
# WL_AUTHORED and WL_PASS_<id>, and applying a layer first deletes whatever that pass created
# before -- so re-applying after a design change is exact, and "remove pass" is one call with
# REMOVE_ONLY = True. A layer never edits or deletes generator actors.
#
# Set SPEC to the layer JSON before queueing (the copy step prepends it). SAVE=False to preview.
#
# THE FOUNDER MAY BE EDITING THIS MAP. A save writes every unsaved change in the map, not only this
# layer's, so a layer refuses to save when the map already had unsaved changes before it touched
# anything (MAP_WAS_DIRTY_OK = True overrides, e.g. after this session's own preview).
import json
import os

SPEC = globals().get("SPEC")
SAVE = globals().get("SAVE", True)
REMOVE_ONLY = globals().get("REMOVE_ONLY", False)
MAP_WAS_DIRTY_OK = globals().get("MAP_WAS_DIRTY_OK", False)
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"


def _load(path, cache):
    if path not in cache:
        asset = unreal.load_asset(path)
        if asset is None:
            raise RuntimeError("asset did not load: " + path)
        cache[path] = asset
    return cache[path]


def _material_path(name):
    return name if name.startswith("/") else "/Game/WonderlandV2/Materials/Instances/%s.%s" % (name, name)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        raise RuntimeError("PIE is running; layers apply to the editor world only")
    with open(SPEC, encoding="utf-8") as f:
        spec = json.load(f)
    dirty_before = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["map_dirty_before"] = dirty_before
    save = SAVE
    if SAVE and dirty_before and not MAP_WAS_DIRTY_OK:
        save = False
        RESULT["save_refused"] = "the map had unsaved changes before this layer: " + ", ".join(dirty_before)
    pass_tag = "WL_PASS_" + spec["pass"]
    folder = spec.get("folder", "Wonderland/Authored/" + spec["pass"])
    base_tags = [unreal.Name(t) for t in spec.get("tags", [])] + [unreal.Name("WL_AUTHORED"), unreal.Name(pass_tag)]
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    removed = 0
    for a in eas.get_all_level_actors():
        if unreal.Name(pass_tag) in a.tags:
            eas.destroy_actor(a)
            removed += 1
    RESULT["removed"] = removed
    yield 0.2
    if REMOVE_ONLY:
        if save:
            RESULT["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(ues.get_editor_world(), MAP))
        RESULT["status"] = "done"
        return

    cache = {}
    placed = 0
    for spec_actor in spec.get("actors", []):
        mesh = _load(spec_actor["mesh"], cache)
        loc = unreal.Vector(*spec_actor["loc"])
        pitch, yaw, roll = spec_actor.get("rot", [0.0, 0.0, 0.0])
        rot = unreal.Rotator(roll=roll, pitch=pitch, yaw=yaw)
        actor = eas.spawn_actor_from_class(unreal.StaticMeshActor, loc, rot)
        smc = actor.static_mesh_component
        # Movable: with no static lighting in this world a Static mesh has no lightmap and draws black.
        smc.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)
        smc.set_static_mesh(mesh)
        for index, material in enumerate(spec_actor.get("materials", [])):
            smc.set_material(index, _load(_material_path(material), cache))
        actor.set_actor_scale3d(unreal.Vector(*spec_actor.get("scale", [1.0, 1.0, 1.0])))
        smc.set_collision_profile_name("BlockAll" if spec_actor.get("collision", "block") == "block" else "NoCollision")
        smc.set_editor_property("cast_shadow", spec_actor.get("cast_shadow", True))
        if "affect_df" in spec_actor:
            smc.set_editor_property("affect_distance_field_lighting", spec_actor["affect_df"])
        actor.set_actor_label("%s_%s" % (spec["pass"], spec_actor["id"]))
        actor.set_folder_path(folder)
        actor.set_editor_property("tags", list(base_tags))
        placed += 1

    batches = 0
    instances = 0
    for spec_batch in spec.get("batches", []):
        rows = spec_batch["instances"]
        if not rows:
            continue
        mesh = _load(spec_batch["mesh"], cache)
        material = _load(_material_path(spec_batch["material"]), cache)
        batch = eas.spawn_actor_from_class(unreal.WonderlandInstancedBatch, unreal.Vector(0.0, 0.0, 0.0), unreal.Rotator(0.0, 0.0, 0.0))
        batch.set_editor_property("batch_name", "%s_%s" % (spec["pass"], spec_batch["id"]))
        batch.set_editor_property("mesh", mesh)
        batch.set_editor_property("mesh_path", mesh.get_path_name())
        batch.set_editor_property("material", material)
        batch.set_editor_property("material_path", material.get_path_name())
        batch.set_editor_property("cast_shadow", spec_batch.get("cast_shadow", True))
        batch.set_editor_property("collides", spec_batch.get("collides", False))
        batch.set_editor_property("affect_distance_field_lighting", spec_batch.get("affect_df", False))
        flat = []
        for row in rows:
            flat.extend(float(v) for v in row)
        batch.set_editor_property("transforms", flat)
        batch.set_actor_label("%s_%s" % (spec["pass"], spec_batch["id"]))
        batch.set_folder_path(folder)
        batch.set_editor_property("tags", list(base_tags))
        batches += 1
        instances += len(rows)

    # Floating props: AWonderlandHoverProp carries its own hover component (an instance cannot).
    hovers = 0
    for spec_hover in spec.get("hovers", []):
        mesh = _load(spec_hover["mesh"], cache)
        material = _load(_material_path(spec_hover["material"]), cache)
        pitch, yaw, roll = spec_hover.get("rot", [0.0, 0.0, 0.0])
        prop = eas.spawn_actor_from_class(unreal.WonderlandHoverProp, unreal.Vector(*spec_hover["loc"]), unreal.Rotator(roll=roll, pitch=pitch, yaw=yaw))
        prop.set_editor_property("mesh", mesh)
        prop.set_editor_property("mesh_path", mesh.get_path_name())
        prop.set_editor_property("material", material)
        prop.set_editor_property("material_path", material.get_path_name())
        prop.set_actor_scale3d(unreal.Vector(*spec_hover.get("scale", [1.0, 1.0, 1.0])))
        hover = prop.get_editor_property("hover")
        hover.set_editor_property("amplitude_uu", spec_hover.get("amp", 40.0))
        hover.set_editor_property("period_seconds", spec_hover.get("period", 8.0))
        hover.set_editor_property("sway_deg", spec_hover.get("sway", 4.0))
        hover.set_editor_property("phase", spec_hover.get("phase", -1.0))
        component = prop.get_editor_property("mesh_component")
        if component is not None:
            component.set_static_mesh(mesh)
            component.set_material(0, material)
            component.set_collision_profile_name("NoCollision")
        prop.set_actor_label("%s_%s" % (spec["pass"], spec_hover["id"]))
        prop.set_folder_path(folder)
        prop.set_editor_property("tags", list(base_tags))
        hovers += 1

    RESULT.update({"pass": spec["pass"], "actors": placed, "batches": batches, "instances": instances, "hovers": hovers})
    yield 0.5
    if save:
        RESULT["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(ues.get_editor_world(), MAP))
    RESULT["status"] = "done"
    emit("applied", spec["pass"], placed, "actors", batches, "batches", instances, "instances")
