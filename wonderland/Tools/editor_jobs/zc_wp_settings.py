# IS WORLD PARTITION STREAMING EVEN TURNED ON IN THIS LEVEL?
#
# zc_streaming found residency completely flat -- 21,083 actors at the centre, at 600 m and at 1,250 m, a
# spread of zero. Two explanations fit that, and they call for opposite responses:
#
#   the actors are not streamable (runtime-spawned, or flagged not spatially loaded), or
#   streaming is switched off on the level's World Partition, in which case nothing streams by design.
#
# The first is already ruled out: nothing in the project spawns AWonderlandInstancedBatch, so the batches are
# placed level actors, and nothing anywhere sets bIsSpatiallyLoaded, which defaults to true. That leaves the
# partition's own settings, which nobody has read.
#
# This reads them. If bEnableStreaming is false, the flat residency is a switch rather than a mystery -- and
# whether to flip it is a real decision with real consequences, not a bug to fix quietly, because a world
# that has never streamed has also never been tested while streaming.
CONCURRENT = True

import unreal

L = unreal.WonderlandUiTestLibrary


def job():
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = ues.get_editor_world()
    RESULT["world"] = str(world.get_name())

    found = {}
    RESULT["settings"] = found

    # The WorldPartition object hangs off the world; the accessor name has moved between versions, so try
    # the ones that exist rather than assuming.
    wp = None
    for getter in ("get_world_partition",):
        try:
            wp = getattr(unreal, "WorldPartitionBlueprintLibrary", None)
        except Exception:
            wp = None
    try:
        found["has_world_partition_library"] = wp is not None
    except Exception:
        pass

    # The settings live on the world's WorldSettings or the partition itself. Read whatever is reachable.
    try:
        ws = unreal.GameplayStatics.get_world_settings(world)
        found["world_settings"] = str(ws.get_name()) if ws is not None else None
        for prop in ("enable_world_partition", "bEnableWorldPartition", "instanced_foliage_grid_size"):
            try:
                found[prop] = str(ws.get_editor_property(prop))
            except Exception:
                pass
    except Exception as err:                                       # noqa: BLE001
        found["world_settings_error"] = str(err)[:140]

    # And the partition actor itself, if it is reachable as an object in the world.
    try:
        part = world.get_editor_property("world_partition")
        found["world_partition_object"] = str(part.get_name()) if part is not None else None
        for prop in ("enable_streaming", "bEnableStreaming", "runtime_hash", "streaming_policy"):
            try:
                found[prop] = str(part.get_editor_property(prop))[:120]
            except Exception:
                pass
    except Exception as err:                                       # noqa: BLE001
        found["world_partition_error"] = str(err)[:140]

    # Whatever the API gives, the .umap itself records it, and a grep is not subject to binding drift.
    emit("W01", "INFO", "what the level says about streaming", found)

    RESULT["status"] = "measured"
    yield 0.2
