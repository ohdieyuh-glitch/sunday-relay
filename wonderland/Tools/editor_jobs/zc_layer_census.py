# WHICH AUTHORED LAYERS ARE ACTUALLY STANDING IN THE LEVEL?
#
# The Christmas treatment named in P2 item 13 exists on disk as XM01 (228 instances) and XM02 (264), and
# there is no apply record for either in the channel's done folder. That is not proof of absence -- done
# records rotate, and these could have been applied in an earlier session. The level itself is the only
# thing that can settle it.
#
# Every authored pass is applied into a folder Wonderland/Authored/<PASS>_<Name> and tagged WL_PASS_<id>, so
# the folders present in the world ARE the list of what has been applied.
CONCURRENT = True

import unreal


def job():
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = ues.get_game_world() or ues.get_editor_world()
    RESULT["world"] = "game" if ues.get_game_world() is not None else "editor"

    folders = {}
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            path = str(actor.get_folder_path())
        except Exception:
            continue
        if not path or "Authored" not in path:
            continue
        leaf = path.rsplit("/", 1)[-1]
        row = folders.setdefault(leaf, {"actors": 0, "instances": 0})
        row["actors"] += 1
        for comp in actor.get_components_by_class(unreal.InstancedStaticMeshComponent):
            try:
                row["instances"] += int(comp.get_instance_count())
            except Exception:
                pass
    RESULT["authored_layers"] = dict(sorted(folders.items()))
    RESULT["layer_count"] = len(folders)
    RESULT["christmas_present"] = sorted(k for k in folders if k.upper().startswith("XM"))
    RESULT["status"] = "counted"
    RESULT["log"] = "%d authored layers; christmas=%s" % (len(folders), RESULT["christmas_present"])
    yield 0.1
