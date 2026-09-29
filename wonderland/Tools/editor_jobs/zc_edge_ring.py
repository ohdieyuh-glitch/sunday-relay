# THE WORLD'S EDGE, SEALED FOR THE PLAYER ONLY (EDGE01).
#
# CORE's decision on JUJU's JQ-F01 (2026-09-29): "option (a) + the forest wall." The only floor is V2_GroundSlab, a
# 3,000 m SQUARE, so it reaches just 1,500 m on the axes. Walking out past the wild ring along 0/90/180/270 degrees
# was walking off the world. The constraints, CORE's:
#   1. radius ~1,485 m: outside the playable disc (1,480) and inside the slab everywhere (1,500 on the axes);
#   2. INVISIBLE in game and blocks the PAWN only -- no camera or visibility blocking, nothing in a capture;
#   3. World Partition: segments short enough to stream with real bounds (<= 200 m), spatially loaded, NOT always
#      loaded;
#   4. continuous, with no gap wider than the Dog's capsule, including at the joins;
#   5. proof: a SELF-POWERED walk outward along 0 and 90 degrees that stops at the ring.
#
# HOW. One StaticMeshActor per segment: the engine cube scaled to a wall 1 m thick, 12 m tall (from z -14), and as
# long as the chord of its arc plus an overlap, so neighbouring segments cross at the joins and leave no gap.
#   * hidden in game, cast no shadow, no distance field -- nothing to see;
#   * collision: every channel IGNORE except Pawn BLOCK -- the Dog's capsule stops, and the camera, visibility and
#     weapon traces pass through;
#   * spatially loaded, like everything else in the partitioned world.
# Tagged WL_AUTHORED + WL_PASS_EDGE01 like an applied layer, so the ring is removable and re-applicable as a unit, and
# the save gate can count it.
#
# Globals: SAVE (default False; window saves go through the gated save), REMOVE_ONLY, RADIUS_CM, SEGMENTS.
import math

SAVE = globals().get("SAVE", False)
REMOVE_ONLY = globals().get("REMOVE_ONLY", False)
RADIUS_CM = globals().get("RADIUS_CM", 148500.0)
SEGMENTS = globals().get("SEGMENTS", 48)
PASS = "EDGE01"
MAP = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2"
CUBE = "/Engine/BasicShapes/Cube.Cube"
THICK_CM, HEIGHT_CM, BASE_Z, OVERLAP_CM = 100.0, 1200.0, -14.0, 400.0


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    world = ues.get_editor_world()
    tag = unreal.Name("WL_PASS_" + PASS)
    removed = 0
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        if tag in actor.tags:
            eas.destroy_actor(actor)
            removed += 1
    RESULT["removed"] = removed
    if REMOVE_ONLY:
        RESULT["status"] = "removed"
        return
    cube = unreal.load_asset(CUBE)
    if cube is None:
        raise RuntimeError("engine cube did not load: " + CUBE)
    step = 2.0 * math.pi / SEGMENTS
    chord = 2.0 * RADIUS_CM * math.sin(step * 0.5)
    made, lengths = 0, []
    for i in range(SEGMENTS):
        a = step * (i + 0.5)
        mid_r = RADIUS_CM * math.cos(step * 0.5)             # the chord's midpoint lies inside the circle
        loc = unreal.Vector(math.cos(a) * mid_r, math.sin(a) * mid_r, BASE_Z + HEIGHT_CM * 0.5)
        yaw = math.degrees(a) + 90.0                          # the wall runs along the ring (tangent)
        actor = eas.spawn_actor_from_class(unreal.StaticMeshActor, loc, unreal.Rotator(roll=0.0, pitch=0.0, yaw=yaw))
        smc = actor.static_mesh_component
        smc.set_static_mesh(cube)
        length = chord + OVERLAP_CM
        lengths.append(length)
        actor.set_actor_scale3d(unreal.Vector(length / 100.0, THICK_CM / 100.0, HEIGHT_CM / 100.0))
        # PAWN ONLY. Query-only collision (no physics body to wake), every channel ignored, Pawn blocked.
        smc.set_collision_enabled(unreal.CollisionEnabled.QUERY_ONLY)
        smc.set_collision_object_type(unreal.CollisionChannel.ECC_WORLD_STATIC)
        smc.set_collision_response_to_all_channels(unreal.CollisionResponseType.ECR_IGNORE)
        smc.set_collision_response_to_channel(unreal.CollisionChannel.ECC_PAWN, unreal.CollisionResponseType.ECR_BLOCK)
        smc.set_editor_property("cast_shadow", False)
        smc.set_editor_property("affect_distance_field_lighting", False)
        smc.set_editor_property("hidden_in_game", True)
        actor.set_actor_hidden_in_game(True)
        actor.set_actor_label("%s_Segment_%02d" % (PASS, i))
        actor.set_folder_path("Wonderland/Authored/%s_WorldEdge" % PASS)
        actor.tags = [unreal.Name("WL_AUTHORED"), tag, unreal.Name("WL_WORLD_EDGE")]
        made += 1
        if i % 8 == 7:
            yield 0.0
    RESULT["segments"] = made
    RESULT["segment_length_m"] = round(sum(lengths) / len(lengths) / 100.0, 1)
    RESULT["chord_midpoint_radius_m"] = round(RADIUS_CM * math.cos(step * 0.5) / 100.0, 1)
    if SAVE:
        RESULT["saved"] = bool(unreal.EditorLoadingAndSavingUtils.save_map(world, MAP))
    RESULT["status"] = "done"
