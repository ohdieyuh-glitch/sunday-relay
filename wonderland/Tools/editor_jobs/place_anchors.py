# Editor job: place (or move) one AWonderlandTravelAnchor per placed search result, then save the map.
# SOURCE names the search result file in <channel>/done. Only this job mutates the editor world.
import json
import os

SOURCE = "anchors_search.json"
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        raise RuntimeError("PIE is running; anchors are placed in the editor world only")
    with open(os.path.join(CHANNEL, "done", SOURCE), encoding="utf-8") as f:
        data = json.load(f)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    existing = {}
    for actor in eas.get_all_level_actors():
        if isinstance(actor, unreal.WonderlandTravelAnchor):
            existing[str(actor.get_editor_property("destination_id"))] = actor
    placed, moved, removed = [], [], []
    wanted = set()
    for a in data["anchors"]:
        if not a.get("placed"):
            continue
        wanted.add(a["id"])
        loc = unreal.Vector(a["location"][0], a["location"][1], a["location"][2])
        rot = unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(a["yaw"]))
        actor = existing.get(a["id"])
        if actor is None:
            actor = eas.spawn_actor_from_class(unreal.WonderlandTravelAnchor, loc, rot)
            placed.append(a["id"])
        else:
            actor.set_actor_location_and_rotation(loc, rot, False, True)
            moved.append(a["id"])
        actor.set_editor_property("destination_id", a["id"])
        actor.set_actor_label("WL_TravelAnchor_" + a["id"])
        actor.set_folder_path("Wonderland/Travel")
    for rid, actor in existing.items():
        if rid not in wanted:
            eas.destroy_actor(actor)
            removed.append(rid)
    yield 0.5
    RESULT["placed"], RESULT["moved"], RESULT["removed"] = placed, moved, removed
    count = sum(1 for x in eas.get_all_level_actors() if isinstance(x, unreal.WonderlandTravelAnchor))
    RESULT["anchors_in_world"] = count
    world = ues.get_editor_world()
    RESULT["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(world, MAP))
    RESULT["status"] = "done" if RESULT["saved"] else "error"
    emit("anchors in world", count, "saved", RESULT["saved"])
