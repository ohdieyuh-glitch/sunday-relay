# REACH THE DOG THROUGH ITS OWN EXTERNAL PACKAGE, and set the one property that saves it.
#
# WHY THE EDITOR WORLD COULD NOT SEE IT. zc_dog_always_loaded found ZERO RelayDog actors and correctly
# refused to save. That is not evidence the Dog is spawned at runtime: World Partition loads only the
# cells the editor has loaded, and get_all_level_actors sees loaded actors only.
#
# THE MAP IS PARTITIONED, measured on disk just now rather than taken from the record:
#     WL_V2_GoldenArrival_WP2   umap 14,014 bytes   external actors 21,543   PARTITIONED
# and it is both EditorStartupMap and GameDefaultMap, so it is the map PIE opens.
#
# A STALE READING NEARLY KILLED A CORRECT HYPOTHESIS. zc_wp_probe, run 2026-09-25, recorded this same
# map as an unpartitioned 46 MB monolith with 0 external actors -- true when it was written, and false
# now: the conversion landed after it. I had the hypothesis dead for a minute on the strength of a
# three-day-old result. The rule I keep writing about verifying that a named thing still exists
# applies to my own earlier job results, not only to the engine's API.
#
# THE ACTOR IS PLACED, and a binary grep finds BP_RelayDog in exactly one external package under the
# live map. Each external actor package holds ONE actor, so it can be loaded directly without asking
# World Partition to stream a region in.
#
# THE SAME GUARDS AS BEFORE, because this writes to a shared, untracked map:
#   - verify the loaded object IS a RelayDog, because a grep match can be a REFERENCE from some other
#     actor rather than the actor itself
#   - read the property before and after and refuse to save unless it actually changed
#   - save only that one package, never the level
import os

# NOT CONCURRENT: it ends PIE so the editor is quiet while a package is written.
CONCURRENT = False

PKG = "/Game/__ExternalActors__/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2/0/S3/3D8WDZHUYCVMR4IULTFEMC"
PROP = "is_spatially_loaded"


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def bail(why):
        RESULT["status"] = "voided: " + why
        emit("VOID", "FAIL", why, {})

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 600)

    exists = False
    try:
        exists = bool(unreal.EditorAssetLibrary.does_asset_exist(PKG))
    except Exception:                                                  # noqa: BLE001
        exists = False
    record("L_EXISTS", "the Dog's external actor package exists at the path the grep found",
           exists, package=PKG)
    if not exists:
        bail("no asset at %s" % PKG)
        return

    obj = None
    try:
        obj = unreal.EditorAssetLibrary.load_asset(PKG)
    except Exception as exc:                                           # noqa: BLE001
        bail("load_asset raised %s: %s" % (type(exc).__name__, exc))
        return
    cls = None
    try:
        cls = str(obj.get_class().get_name()) if obj is not None else None
    except Exception:                                                  # noqa: BLE001
        cls = None
    RESULT["loaded"] = {"package": PKG, "class": cls,
                        "name": (str(obj.get_name()) if obj is not None else None)}
    # A GREP MATCH CAN BE A REFERENCE. If this package merely MENTIONS BP_RelayDog because something
    # else in it points at the Dog, then editing it would change the wrong actor entirely.
    is_dog = bool(cls and "RelayDog" in cls)
    record("L_IS_THE_DOG", "the loaded object is a RelayDog and not something that merely references one",
           is_dog, loaded_class=cls, package=PKG,
           note="the package was found by a binary grep for BP_RelayDog, and a match can be a "
                "reference rather than the actor -- editing on that basis would change the wrong actor")
    if not is_dog:
        bail("the package at %s loaded as %s, not a RelayDog" % (PKG, cls))
        return

    before = None
    try:
        before = bool(obj.get_editor_property(PROP))
    except Exception as exc:                                           # noqa: BLE001
        bail("could not read %s: %s" % (PROP, exc))
        return
    RESULT["before"] = before
    record("L_WAS_LOADABLE", "the Dog is spatially loaded, which is the fault",
           before is True, is_spatially_loaded=before)
    if before is not True:
        RESULT["status"] = "measured"
        RESULT["note"] = "already not spatially loaded; nothing changed"
        return

    try:
        obj.set_editor_property(PROP, False)
    except Exception as exc:                                           # noqa: BLE001
        bail("could not set %s: %s" % (PROP, exc))
        return
    after = None
    try:
        after = bool(obj.get_editor_property(PROP))
    except Exception:                                                  # noqa: BLE001
        after = None
    RESULT["after"] = after
    record("L_CHANGED", "the property changed on the actor before anything was written",
           before is True and after is False, before=before, after=after)
    if after is not False:
        bail("the property did not change; nothing saved")
        return

    saved, how = False, None
    try:
        saved = bool(unreal.EditorAssetLibrary.save_asset(PKG, only_if_is_dirty=False))
        how = "EditorAssetLibrary.save_asset"
    except Exception as exc:                                           # noqa: BLE001
        how = "save_asset raised %s: %s" % (type(exc).__name__, exc)
    RESULT["saved"] = {"ok": saved, "how": how}
    record("L_SAVED", "the single external actor package was written",
           saved, how=how, package=PKG,
           note="only this package is saved -- not the level, and nothing else in the map is touched")

    yield 2.0
    again = None
    try:
        again = bool(unreal.EditorAssetLibrary.load_asset(PKG).get_editor_property(PROP))
    except Exception:                                                  # noqa: BLE001
        again = None
    RESULT["after_save"] = again
    record("L_HELD", "the property still reads False after the save", again is False, value=again)

    RESULT["status"] = "measured"
    RESULT["what_changed"] = {
        "package": PKG, "property": PROP, "from": before, "to": after,
        "why": "a level-placed spatially-loaded pawn is destroyed with its home cell when it "
               "teleports out of it; the player pawn must always be loaded",
        "verify_with": "zc_dog_cell on a fresh PIE -- its far arm must now SURVIVE"}
