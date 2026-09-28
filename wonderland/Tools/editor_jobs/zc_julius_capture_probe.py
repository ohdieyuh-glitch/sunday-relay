# A DISPOSABLE CAPTURE PROBE (founder, 2026-09-28, before acceptance #5 is rerun).
#
# Attempt 844522424c7b2341 wrote no photographs: CaptureViewportJpeg returned false for every capture and nothing
# reached the disk. So before a full acceptance is spent, this proves ONE photograph can be produced by the SAME helper
# in the SAME conditions the acceptance uses -- PIE up, background throttle suspended, the game viewport focused -- and
# that the file lands on disk, fresh, with bytes in it. Nothing is created or saved; the directory is a throwaway.
#
# CHANNEL RULES: CONCURRENT = False (this begins and ends play); every wait goes through wait(), which turns the
# channel's TimeoutError into a False.
import os
import time

CONCURRENT = False

H = unreal.WonderlandHudTestLibrary
L = unreal.WonderlandUiTestLibrary
PROBE_ID = time.strftime("%Y%m%d-%H%M%S")
DIR = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "julius_live", "probe-%s" % PROBE_ID)


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["probe_id"] = PROBE_ID
    RESULT["dir"] = DIR
    RESULT["status"] = "running"
    OWN = {"play": False}  # whether the play now running is this probe's

    def wait(predicate, timeout):
        try:
            yield (predicate, timeout)
            return True
        except TimeoutError:
            return False

    try:
        # The output directory exists and takes a file.
        os.makedirs(DIR, exist_ok=True)
        marker = os.path.join(DIR, ".writable")
        with open(marker, "w", encoding="utf-8") as handle:
            handle.write("ok")
        RESULT["dir_writable"] = os.path.isfile(marker)
        os.remove(marker)

        # PIE, exactly as the acceptance starts it -- but only OUR play. A world still running after the wait belongs to
        # another session: photographing it records someone else's camera, and ending it tears down work this probe does
        # not own (2026-09-28 05:22: kaisi-1f's session, idle between their runs, was photographed and ended). Neither.
        idle = yield from wait(lambda: ues.get_game_world() is None, 600)
        RESULT["idle_before"] = bool(idle)
        if not idle:
            RESULT["status"] = "PIE BUSY: another session's play is running; nothing captured, nothing ended"
            return
        L.set_background_throttle_suspended(True)
        OWN["play"] = True
        les.editor_request_begin_play()
        world_up = yield from wait(lambda: ues.get_game_world() is not None, 240)
        pawn = world_up and (yield from wait(
            lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120))
        yield 3.0
        L.focus_game_viewport()
        yield 0.5

        # The viewport is actually drawing: frames advance.
        first = unreal.SystemLibrary.get_frame_count()
        drawing = yield from wait(lambda: unreal.SystemLibrary.get_frame_count() >= first + 30, 30)
        RESULT["frames_advanced"] = unreal.SystemLibrary.get_frame_count() - first

        # ONE photograph, judged by the file, not by the helper's word alone.
        path = os.path.join(DIR, "probe.jpg")
        L.focus_game_viewport()
        asked = time.time()
        written = bool(H.capture_viewport_jpeg(path, 1900, 94))
        exists = os.path.isfile(path)
        size = os.path.getsize(path) if exists else 0
        fresh = exists and os.path.getmtime(path) >= asked - 2.0
        RESULT.update({"world_up": bool(world_up), "pawn": bool(pawn), "viewport_drawing": bool(drawing),
                       "written": written, "exists": exists, "bytes": size, "fresh": fresh, "path": path})
        RESULT["status"] = "CAPTURE OK" if (written and exists and size > 0 and fresh) else "CAPTURE FAILED"
    except Exception as err:
        RESULT["status"] = "error"
        RESULT["error"] = repr(err)
    finally:
        if OWN["play"] and ues.get_game_world() is not None:
            les.editor_request_end_play()
