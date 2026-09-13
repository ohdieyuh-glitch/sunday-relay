# WONDERLAND — author the hub map, reproducibly.
#
# WHY THIS EXISTS. `/Game/Wonderland/Maps/WonderlandHub` is named by
# DefaultEngine.ini (EditorStartupMap, GameDefaultMap), by DefaultGame.ini
# (MapsToCook) and by UNREAL_SESSION_CHECKLIST.md step 6 — and until now no
# .umap stood there, so the editor opened into an Untitled level and the
# Content Drawer showed nothing. A .umap is a binary editor-authored format;
# the honest way to produce one outside the editor UI is to have the editor
# produce it, from a script that can be read and re-run. That is this file.
#
# WHAT IT CREATES, AND WHY EACH ACTOR IS NOT DECORATION. The hub's art
# direction (docs/relay/WONDERLAND.md §4) is deferred design work and none of
# it is invented here. What is placed is only what a first PIE session needs in
# order to distinguish "this works" from "this is broken":
#
#   PlayerStart      The transform AWonderlandHubGameMode spawns the Dog at.
#                    Without one, UE spawns at the origin and logs a warning,
#                    so the architecture's own spawn point would be a fallback.
#   DirectionalLight With no light the scene is black, and a working spawn
#                    looks exactly like a failed one.
#   SkyLight         Ambient fill. Without it every surface facing away from
#                    the sun is pure black.
#   SkyAtmosphere    Gives the directional light a sky to read against; a UE5
#                    scene without one reads as broken lighting.
#   Floor            One engine cube, scaled. The ground plane the camera
#                    resolves against, and the surface the movement component
#                    (deferred, step 8) will eventually need.
#
# WHAT IT DELIBERATELY DOES NOT DO:
#   - It sets NO GameMode override in World Settings. `GlobalDefaultGameMode`
#     in DefaultEngine.ini is the single authority for which mode runs, and a
#     second copy in the map would agree until the day it did not. The check at
#     the end ASSERTS the override is still None.
#   - It creates no Blueprint subclass of AWonderlandDogPawn, no Input assets
#     and no Dog mesh. Those are checklist steps 7-9 and are deferred in
#     docs/relay/WONDERLAND.md §11; assigning a stand-in mesh would fabricate
#     the Dog's identity, which the proportions contract forbids.
#
# IDEMPOTENT BY ACTOR, NOT BY FILE. An earlier revision skipped everything when
# the .umap existed, which is wrong in exactly the case that matters: a run that
# created the level and then failed leaves a map that EXISTS and is EMPTY. Each
# actor is keyed by label, looked up, and placed only if absent — so re-running
# repairs a partial map instead of blessing it.
#
# RUN IT WITH: wonderland/Tools/author-hub-map.ps1

import unreal

MAP_PACKAGE = "/Game/Wonderland/Maps/WonderlandHub"
# Package path, not the `Cube.Cube` object path: load_asset resolves both, but
# the object path logs a deprecation warning on every run.
FLOOR_MESH = "/Engine/BasicShapes/Cube"

# Cube is 100uu per side at scale 1, so (40, 40, 1) is 4000x4000x100uu. Sunk
# half its depth so the walking surface is exactly z=0 and the PlayerStart
# height below is measured from the ground rather than from a guess.
FLOOR_SCALE = unreal.Vector(40.0, 40.0, 1.0)
FLOOR_LOCATION = unreal.Vector(0.0, 0.0, -50.0)

# Default PlayerStart capsule is 96uu half-height; 100 clears the floor.
PLAYER_START_LOCATION = unreal.Vector(0.0, 0.0, 100.0)

ZERO = unreal.Rotator(0.0, 0.0, 0.0)

placed = []
found = []


def log(message):
    unreal.log("[wonderland] " + message)


def fail(message):
    unreal.log_error("[wonderland] " + message)
    raise SystemExit(1)


def try_set(obj, name, value):
    """Optional property write. A renamed engine property must not lose the map."""
    if obj is None:
        log("optional property '{0}' skipped: no component".format(name))
        return False
    try:
        obj.set_editor_property(name, value)
        return True
    except Exception as error:  # noqa: BLE001 - reported, never fatal
        log("optional property '{0}' not set: {1}".format(name, error))
        return False


def component(actor, component_class):
    """Component lookup by CLASS. The per-actor accessor names differ between
    actor types and between engine versions (ADirectionalLight has no
    `directional_light_component`); the class lookup is the same everywhere."""
    try:
        return actor.get_component_by_class(component_class)
    except Exception as error:  # noqa: BLE001
        log("component lookup failed for {0}: {1}".format(component_class, error))
        return None


def existing_by_label(actors):
    index = {}
    for actor in actors.get_all_level_actors():
        try:
            index[actor.get_actor_label()] = actor
        except Exception:  # noqa: BLE001 - an actor without a label is not ours
            pass
    return index


def ensure(index, actors, label, spawn):
    """Place `label` if it is not already in the level. Returns the actor."""
    if label in index:
        found.append(label)
        log("present: " + label)
        return index[label]
    actor = spawn()
    if actor is None:
        fail("could not spawn " + label)
    actor.set_actor_label(label)
    placed.append(label)
    log("placed: " + label)
    return actor


def main():
    level_editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    if unreal.EditorAssetLibrary.does_asset_exist(MAP_PACKAGE):
        log("level exists, opening it: " + MAP_PACKAGE)
        if not level_editor.load_level(MAP_PACKAGE):
            fail("load_level returned False for " + MAP_PACKAGE)
    else:
        log("creating empty level at " + MAP_PACKAGE)
        if not level_editor.new_level(MAP_PACKAGE):
            fail("new_level returned False for " + MAP_PACKAGE)

    index = existing_by_label(actors)

    # --- the spawn point the GameMode uses -------------------------------
    ensure(
        index, actors, "WonderlandHub_PlayerStart",
        lambda: actors.spawn_actor_from_class(
            unreal.PlayerStart, PLAYER_START_LOCATION, ZERO),
    )

    # --- enough light to tell working from broken ------------------------
    sun = ensure(
        index, actors, "WonderlandHub_Sun",
        lambda: actors.spawn_actor_from_class(
            unreal.DirectionalLight, unreal.Vector(0.0, 0.0, 1000.0),
            unreal.Rotator(-46.0, 0.0, 0.0)),
    )
    sun_component = component(sun, unreal.DirectionalLightComponent)
    try_set(sun_component, "atmosphere_sun_light", True)
    try_set(sun_component, "intensity", 6.0)

    sky_light = ensure(
        index, actors, "WonderlandHub_SkyLight",
        lambda: actors.spawn_actor_from_class(
            unreal.SkyLight, unreal.Vector(0.0, 0.0, 1000.0), ZERO),
    )
    sky_component = component(sky_light, unreal.SkyLightComponent)
    # Movable first: real-time capture is only meaningful on a light that is
    # allowed to change, and a Stationary SkyLight silently ignores it.
    try_set(sky_component, "mobility", unreal.ComponentMobility.MOVABLE)
    # Real-time capture so the SkyLight reads the SkyAtmosphere rather than a
    # cubemap that was never captured — the difference between ambient fill and
    # a flat black one.
    try_set(sky_component, "real_time_capture", True)

    ensure(
        index, actors, "WonderlandHub_SkyAtmosphere",
        lambda: actors.spawn_actor_from_class(unreal.SkyAtmosphere, unreal.Vector(0.0, 0.0, 0.0), ZERO),
    )

    # --- the ground ------------------------------------------------------
    floor_mesh = unreal.EditorAssetLibrary.load_asset(FLOOR_MESH)
    if floor_mesh is None:
        fail("could not load " + FLOOR_MESH)

    # SPAWNED FROM THE CLASS, then given its mesh. `spawn_actor_from_object`
    # reads nicer and is the obvious choice, but it routes through the asset
    # actor factory, which dereferences editor viewport/selection state that a
    # commandlet does not have: it crashes the process outright
    # (EXCEPTION_ACCESS_VIOLATION in UnrealEditor-EditorFramework.dll, observed
    # 2026-09-12). `spawn_actor_from_class` takes no such path.
    #
    # Assigning the mesh afterwards is safe here precisely because the actor is
    # fresh: UStaticMeshComponent::SetStaticMesh only refuses a Static
    # component that ALREADY has a mesh, and this one has none.
    floor = ensure(
        index, actors, "WonderlandHub_Floor",
        lambda: actors.spawn_actor_from_class(unreal.StaticMeshActor, FLOOR_LOCATION, ZERO),
    )
    floor_component = component(floor, unreal.StaticMeshComponent)
    if floor_component is None:
        fail("the floor actor has no StaticMeshComponent")
    if floor_component.get_editor_property("static_mesh") is None:
        floor_component.set_static_mesh(floor_mesh)
    if floor_component.get_editor_property("static_mesh") is None:
        fail("set_static_mesh left the floor without a mesh")
    floor.set_actor_scale3d(FLOOR_SCALE)
    log("floor mesh: " + FLOOR_MESH + ", 4000x4000uu, walking surface at z=0")

    # --- assert the authority boundary before saving ---------------------
    # WorldSettings is NOT in get_all_level_actors() — it is the level's own
    # settings object, not a placed actor. Scanning that list for one finds
    # nothing, and the assertion below would then pass without having read
    # anything at all.
    editor_world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    world_settings = unreal.GameplayStatics.get_all_actors_of_class(editor_world, unreal.WorldSettings)
    if len(world_settings) != 1:
        fail("expected exactly one WorldSettings, found {0}".format(len(world_settings)))
    override = world_settings[0].get_editor_property("default_game_mode")
    if override is not None:
        fail(
            "World Settings carries a GameMode override ({0}). "
            "GlobalDefaultGameMode in DefaultEngine.ini is the single authority.".format(override)
        )
    log("World Settings GameMode override: None (GlobalDefaultGameMode is authoritative)")

    # --- save ------------------------------------------------------------
    if not level_editor.save_current_level():
        fail("save_current_level returned False")

    if not unreal.EditorAssetLibrary.does_asset_exist(MAP_PACKAGE):
        fail("saved, but " + MAP_PACKAGE + " does not exist afterwards")

    log("placed this run : " + (", ".join(placed) if placed else "(nothing)"))
    log("already present : " + (", ".join(found) if found else "(nothing)"))
    log("SAVED " + MAP_PACKAGE)


main()
