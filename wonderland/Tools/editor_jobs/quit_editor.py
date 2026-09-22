# Editor job: shut the editor down cleanly, for a handoff.
#
# Run only AFTER handoff_editor.py has reported saved=True and dirty_after=[]. Quitting is deliberately not part
# of that job: a save you cannot read back before the process exits is a save you have not verified.
CONFIRM = globals().get("CONFIRM", False)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    while ues.get_game_world() is not None:
        yield 3.0
    dirty = [p.get_name() for p in unreal.EditorLoadingAndSavingUtils.get_dirty_map_packages()]
    RESULT["dirty_at_quit"] = dirty
    if dirty and not CONFIRM:
        RESULT["status"] = "refused: the map is dirty and CONFIRM was not set"
        return
    RESULT["status"] = "quitting"
    yield 0.5
    unreal.SystemLibrary.quit_editor()
