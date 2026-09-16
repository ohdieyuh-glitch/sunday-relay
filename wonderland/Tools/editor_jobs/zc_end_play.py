# Stop a PIE session that a previous job left running. A few seconds, no captures, no state touched.
#
# It exists because a job that errors or stalls mid-run does NOT end its own play session, and every job
# after it then waits on "the editor is free" until it times out. One stuck run costs the whole queue.
L = unreal.WonderlandUiTestLibrary


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["was_playing"] = ues.get_game_world() is not None
    unreal.log_warning("WLENDPLAY was_playing=%s" % RESULT["was_playing"])
    if RESULT["was_playing"]:
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 120)
    L.set_background_throttle_suspended(False)
    RESULT["status"] = "done"
    unreal.log_warning("WLENDPLAY done")
