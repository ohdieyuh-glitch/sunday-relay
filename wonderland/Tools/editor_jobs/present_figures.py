# Editor job: stage character Blueprints in the open map for a founder review, then take them away.
#
# WHY (2026-09-22, the Sub-Agent Cub Ghost review). An asset family is judged by looking at it, at real scale, in
# the real world's light -- not by a turntable in a vacuum. This spawns Blueprint figures at given places, tags every
# one of them, and can delete them again by that tag. NOTHING IS EVER SAVED here: the review actors exist only in the
# loaded editor world, so a capture can be taken and the map left exactly as it was.
#
# The figures carry a tag rather than a name prefix because a Blueprint actor's label is not a reliable handle -- the
# GT01 removal bug (2026-09-17) came from clearing by a spec file that had already been regenerated. A tag the job
# itself wrote is the one thing that cannot have moved.
# OVERRIDES lets one staged figure wear a different material from another. IT DOES NOT WORK ON BLUEPRINT ACTORS
# and the tool now says so out loud: a Blueprint re-runs its construction script after the spawn, which resets
# every per-instance material back to the template. On 2026-09-22 this silently invalidated a whole A/B round --
# three "brightness variants" and even a control wearing a different material all rendered identically, because
# all six were really drawing the Blueprint's own material. The job reports which components it touched, and that
# report was TRUE and still meaningless. To compare materials, change the asset the Blueprint references, or use
# plain StaticMeshActors. Kept for the latter.
# Globals: FIGURES [[bp_path, x, y, z, yaw, scale, label]], TAG, CLEAR (delete this tag and stop), OUT,
#          OVERRIDES {label: [[component_name_substring, material_path], ...]}.
import json

FIGURES = globals().get("FIGURES", [])
TAG = globals().get("TAG", "WL_REVIEW")
CLEAR = globals().get("CLEAR", False)
OVERRIDES = globals().get("OVERRIDES", {})
OUT = globals().get("OUT")


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    tag = unreal.Name(TAG)

    removed = 0
    for a in eas.get_all_level_actors():
        if tag in a.tags:
            eas.destroy_actor(a)
            removed += 1
    RESULT["removed"] = removed
    yield 0.3
    if CLEAR:
        RESULT["status"] = "done"
        return

    placed = []
    cache = {}
    for row in FIGURES:
        bp_path, x, y, z, yaw, scale, label = row
        if bp_path not in cache:
            asset = unreal.EditorAssetLibrary.load_asset(bp_path)
            if asset is None:
                raise RuntimeError("blueprint did not load: " + bp_path)
            cache[bp_path] = asset.generated_class() if hasattr(asset, "generated_class") else asset
        rot = unreal.Rotator()
        rot.set_editor_property("yaw", float(yaw))
        actor = eas.spawn_actor_from_class(cache[bp_path], unreal.Vector(float(x), float(y), float(z)), rot)
        if actor is None:
            raise RuntimeError("spawn failed for " + bp_path)
        actor.set_actor_scale3d(unreal.Vector(float(scale), float(scale), float(scale)))
        actor.set_actor_label(label)
        actor.set_editor_property("tags", [tag])
        actor.set_folder_path("Wonderland/Review/" + TAG)
        swapped = []
        for needle, mat_path in OVERRIDES.get(label, []):
            mat = unreal.EditorAssetLibrary.load_asset(mat_path)
            if mat is None:
                raise RuntimeError("override material did not load: " + mat_path)
            for comp in actor.get_components_by_class(unreal.StaticMeshComponent):
                if needle.lower() in comp.get_name().lower():
                    for i in range(comp.get_num_materials()):
                        comp.set_material(i, mat)
                    swapped.append(comp.get_name())
        origin, extent = actor.get_actor_bounds(False)
        placed.append({"label": label, "at": [round(x), round(y), round(z)], "yaw": yaw,
                       "bounds_origin": [round(origin.x, 1), round(origin.y, 1), round(origin.z, 1)],
                       "bounds_extent": [round(extent.x, 1), round(extent.y, 1), round(extent.z, 1)],
                       "height_cm": round(extent.z * 2, 1), "overrides": swapped})
        yield None
    if OUT:
        with open(OUT, "w", newline="\n") as f:
            json.dump(placed, f, indent=1)
    RESULT["placed"] = len(placed)
    RESULT["figures"] = placed[:14]
    RESULT["status"] = "done"
