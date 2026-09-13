# WONDERLAND — prove the first-runtime slice resolves, without entering PIE.
#
# "The map exists" is the weakest claim worth making about a startup path. What
# has to be true for the founder's first PIE to spawn a Dog is a CHAIN, and
# every link of it can be checked from a commandlet:
#
#   1. /Game/Wonderland/Maps/WonderlandHub exists and loads.
#   2. It holds the actors the slice needs, PlayerStart among them.
#   3. Its World Settings carry NO GameMode override — so the global default is
#      genuinely the authority, not a coincidence.
#   4. The engine's RESOLVED GameMapsSettings (not the ini text — the values UE
#      actually parsed) point EditorStartupMap and GameDefaultMap at that map.
#   5. GlobalDefaultGameMode resolves to a real class: AWonderlandHubGameMode.
#   6. That class's DefaultPawnClass CDO is AWonderlandDogPawn.
#
# Link 6 is the one that matters most and the one nobody checks: the C++
# constructor sets DefaultPawnClass, but a Blueprint subclass, a stale DLL or a
# renamed class would all break it silently and the failure would not appear
# until a founder pressed Play and got a DefaultPawn instead of the Dog.
#
# Reads only. Places nothing, saves nothing.
#
# RUN IT WITH: wonderland/Tools/verify-hub-map.ps1

import unreal

MAP_PACKAGE = "/Game/Wonderland/Maps/WonderlandHub"
GAME_MODE_PATH = "/Script/Wonderland.WonderlandHubGameMode"
EXPECTED_PAWN = "WonderlandDogPawn"

REQUIRED_ACTORS = [
    "WonderlandHub_PlayerStart",
    "WonderlandHub_Sun",
    "WonderlandHub_SkyLight",
    "WonderlandHub_SkyAtmosphere",
    "WonderlandHub_Floor",
]

failures = []


def log(message):
    unreal.log("[verify] " + message)


def path_text(value):
    """A SoftObjectPath/SoftClassPath as its path STRING.

    `str()` on one of these yields `<Struct 'SoftObjectPath' (0x...) {}>` — an
    empty-looking repr, because FSoftObjectPath's members are custom-serialised
    rather than UPROPERTYs, so Python sees no fields to print. Reading that repr
    as the value is how a correctly configured project gets reported as
    unconfigured. `export_text()` is the accessor that returns the path.
    """
    if value is None:
        return "None"
    try:
        return value.export_text()
    except Exception as error:  # noqa: BLE001
        return "<unreadable: {0}>".format(error)


def check(ok, message):
    if ok:
        log("PASS  " + message)
    else:
        unreal.log_error("[verify] FAIL  " + message)
        failures.append(message)
    return ok


def main():
    level_editor = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    # 1. the map ----------------------------------------------------------
    if not check(
        unreal.EditorAssetLibrary.does_asset_exist(MAP_PACKAGE),
        "map asset exists: " + MAP_PACKAGE,
    ):
        raise SystemExit(1)

    check(level_editor.load_level(MAP_PACKAGE), "map loads: " + MAP_PACKAGE)

    # 2. the actors -------------------------------------------------------
    labels = []
    for actor in actors.get_all_level_actors():
        try:
            labels.append(actor.get_actor_label())
        except Exception:  # noqa: BLE001
            pass

    for required in REQUIRED_ACTORS:
        check(required in labels, "actor present: " + required)

    player_starts = [a for a in actors.get_all_level_actors() if isinstance(a, unreal.PlayerStart)]
    check(len(player_starts) == 1, "exactly one PlayerStart (found {0})".format(len(player_starts)))

    # 3. no second authority for the GameMode -----------------------------
    # WorldSettings is NOT in get_all_level_actors() — it is the level's own
    # settings object, not a placed actor — so scanning that list for one finds
    # nothing and an "override is None" test built on it passes vacuously,
    # whatever the map actually says.
    editor_world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    world_settings = unreal.GameplayStatics.get_all_actors_of_class(editor_world, unreal.WorldSettings)
    if check(len(world_settings) == 1, "World Settings found (got {0})".format(len(world_settings))):
        override = world_settings[0].get_editor_property("default_game_mode")
        check(
            override is None,
            "World Settings GameMode override is None (got {0})".format(override),
        )

    # 4. the engine's resolved map settings -------------------------------
    settings = unreal.get_default_object(unreal.GameMapsSettings)
    startup = path_text(settings.get_editor_property("editor_startup_map"))
    default_map = path_text(settings.get_editor_property("game_default_map"))
    check(MAP_PACKAGE in startup, "EditorStartupMap resolves to the hub (got {0})".format(startup))
    check(MAP_PACKAGE in default_map, "GameDefaultMap resolves to the hub (got {0})".format(default_map))

    # 5. the GameMode class -----------------------------------------------
    configured_mode = path_text(settings.get_editor_property("global_default_game_mode"))
    check(
        "WonderlandHubGameMode" in configured_mode,
        "GlobalDefaultGameMode is the hub mode (got {0})".format(configured_mode),
    )

    game_mode_class = unreal.load_class(None, GAME_MODE_PATH)
    if not check(game_mode_class is not None, "GameMode class loads: " + GAME_MODE_PATH):
        raise SystemExit(1)

    # 6. THE LINK THAT MATTERS: the mode's default pawn IS the Dog ---------
    cdo = unreal.get_default_object(game_mode_class)
    pawn_class = cdo.get_editor_property("default_pawn_class")
    pawn_name = pawn_class.get_name() if pawn_class is not None else "None"
    check(
        pawn_class is not None and EXPECTED_PAWN in pawn_name,
        "DefaultPawnClass is the Relay Dog (got {0})".format(pawn_name),
    )

    # --- verdict ---------------------------------------------------------
    if failures:
        unreal.log_error("[verify] {0} CHECK(S) FAILED".format(len(failures)))
        for failure in failures:
            unreal.log_error("[verify]   - " + failure)
        raise SystemExit(1)

    log("ALL CHECKS PASSED — map loads, PlayerStart placed, and the startup")
    log("chain resolves: EditorStartupMap -> WonderlandHub, GlobalDefaultGameMode")
    log("-> AWonderlandHubGameMode, DefaultPawnClass -> AWonderlandDogPawn.")


main()
