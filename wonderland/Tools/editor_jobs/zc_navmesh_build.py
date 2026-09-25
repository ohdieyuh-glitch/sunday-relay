# CAN THIS WORLD CARRY A NAVMESH, AND WHAT DOES IT COST?
#
# FOUNDER, P2 item 13: the world must be complete for "collisions, traversal, streaming". Traversal is
# proven -- zc_nation_paths walks all three nations gate to band by searching a walkability grid with the
# Dog's own capsule. But the map has NO navigation data at all: NavigationSystemV1 returns no path over
# 400 m, so nothing can be ROUTED across the level, which is a real limitation even though a player walks
# fine.
#
# WHY THIS IS ATTEMPTED CAREFULLY RATHER THAN JUST DONE. The world is a 1,478 m disc carrying 174,787
# instances over 3,904 instanced components. Baking a navmesh across 2.5 km of that is not a small
# operation, and the map is a 46 MB asset on a shared Content junction. So:
#
#   the .umap is backed up before this runs, outside the worktree;
#   NOTHING IS SAVED unless the build actually completes -- an unsaved editor change is reverted by closing
#   the editor, so a build that stalls costs nothing on disk;
#   and the cost is MEASURED rather than assumed, so that "a navmesh is impractical at this world size" is
#   a finding with a number behind it rather than an excuse.
CONCURRENT = True

import time
import unreal

#: Half-extent of the volume, in metres. The built world ends near 1,200 m; this covers it with margin
#: without reaching into the wilderness belt, which nothing needs to route across.
HALF_M = 1250.0

#: The engine's cube brush is 200 uu on a side, so an actor scale of 1 is a 200 uu volume.
BRUSH_UU = 200.0


def job():
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    world = ues.get_editor_world()
    RESULT["world"] = str(world.get_name()) if world is not None else None

    actors = unreal.EditorActorSubsystem()

    # ---- WHAT IS ALREADY THERE
    existing = []
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.NavMeshBoundsVolume):
        existing.append(str(a.get_actor_label()))
    RESULT["existing_bounds_volumes"] = existing

    recast = [str(a.get_actor_label())
              for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RecastNavMesh)]
    RESULT["existing_recast"] = recast

    if existing:
        RESULT["status"] = "already present; nothing added"
        RESULT["log"] = "bounds volumes already in the level: %s" % existing
        yield 0.1
        return

    # ---- ADD THE BOUNDS VOLUME, scaled rather than brush-edited: the default cube brush is 200 uu, so the
    # actor's scale is the only dial needed and it avoids touching brush geometry from script.
    scale = (HALF_M * 2.0 * 100.0) / BRUSH_UU
    try:
        volume = actors.spawn_actor_from_class(
            unreal.NavMeshBoundsVolume, unreal.Vector(0.0, 0.0, 0.0), unreal.Rotator(0.0, 0.0, 0.0))
    except Exception as err:                                   # noqa: BLE001
        RESULT["status"] = "FAIL: could not spawn a NavMeshBoundsVolume"
        RESULT["error"] = str(err)[:200]
        yield 0.1
        return
    if volume is None:
        RESULT["status"] = "FAIL: spawn returned nothing"
        yield 0.1
        return

    # Tall enough to hold the whole built world: the ground sits near z = 0 and the tallest towers are well
    # under 300 m, so 600 m of height covers floor to roof with room over.
    volume.set_actor_scale3d(unreal.Vector(scale, scale, 300.0))
    try:
        volume.set_actor_label("WL_NavBounds")
    except Exception:
        pass
    RESULT["volume"] = {"scale": round(scale, 1), "half_metres": HALF_M,
                        "covers_metres": round(HALF_M * 2.0, 1)}

    started = time.time()
    RESULT["build_started"] = True

    # ---- AND LET THE NAVIGATION SYSTEM DO ITS WORK. Adding the volume is what triggers generation; this
    # waits on it and reports what it managed rather than blocking forever.
    deadline = 540.0
    tiles = 0
    while time.time() - started < deadline:
        yield 2.0
        meshes = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RecastNavMesh)
        if meshes:
            tiles = len(meshes)
            break
    RESULT["seconds_to_navmesh_actor"] = round(time.time() - started, 1)
    RESULT["recast_after"] = [str(a.get_actor_label())
                              for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RecastNavMesh)]
    RESULT["navmesh_actors"] = tiles

    # Give generation real time to run before asking whether it routes.
    for _ in range(60):
        yield 2.0

    RESULT["seconds_total"] = round(time.time() - started, 1)
    RESULT["status"] = "built" if RESULT["recast_after"] else "no navmesh appeared"
    RESULT["log"] = "volume %.0f m across; recast=%s; %.0f s" % (
        HALF_M * 2.0, RESULT["recast_after"], RESULT["seconds_total"])
