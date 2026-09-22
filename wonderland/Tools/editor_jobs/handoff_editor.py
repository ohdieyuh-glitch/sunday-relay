# Editor job: bring the world to a clean, saved, handed-over state.
#
# FOUNDER DIRECTIVE (2026-09-22): release a clean editor slot for Internal Development -- finish the active
# operation, save the map, confirm nothing dirty would be lost, then exit cleanly. This job does the middle three
# and reports what it found; quitting is a separate job, so the save can be READ and checked before the editor
# that produced it is gone.
#
# It removes review figures first. Staged review actors live only in the loaded world and are never meant to
# reach disk, but a save writes EVERY unsaved change in the map -- so saving with figures staged would bake nine
# avatars and three Relay Dogs into the Golden Arrival. That is the one way this handoff could silently damage
# the world, so it is closed here rather than relied on being closed upstream.
# Globals: CLEAR_TAGS, OUT.
import json

CLEAR_TAGS = globals().get("CLEAR_TAGS", ["WL_AVATAR_REVIEW", "WL_REVIEW"])
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/handoff.json")
CENSUS_TAGS = ("WL_AUTHORED", "WL_PASS_BC01", "WL_PASS_IC01", "WL_PASS_IC02", "WL_PASS_NC01",
               "WL_PASS_TR01", "WL_PASS_TQ01", "WL_PASS_NC02", "WL_PASS_TQ02")


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    # never save a map with play running
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    while ues.get_game_world() is not None:
        yield 3.0

    removed = {}
    for tag in CLEAR_TAGS:
        name = unreal.Name(tag)
        n = 0
        for a in eas.get_all_level_actors():
            if name in a.tags:
                eas.destroy_actor(a)
                n += 1
        if n:
            removed[tag] = n
    RESULT["review_actors_removed"] = removed
    yield 1.0

    before = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["dirty_before"] = before
    saved = les.save_current_level() if before else True
    yield 2.0
    after = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]

    census = dict.fromkeys(CENSUS_TAGS, 0)
    actors = eas.get_all_level_actors()
    for a in actors:
        for t in a.tags:
            s = str(t)
            if s in census:
                census[s] += 1

    out = {"review_actors_removed": removed, "dirty_before": before, "saved": bool(saved),
           "dirty_after": after, "total_actors": len(actors), "tag_census": census}
    with open(OUT, "w", newline="\n") as f:
        json.dump(out, f, indent=1)
    RESULT["saved"] = bool(saved)
    RESULT["dirty_after"] = after
    RESULT["total_actors"] = len(actors)
    RESULT["tag_census"] = census
    RESULT["status"] = "done" if not after else "still dirty"
