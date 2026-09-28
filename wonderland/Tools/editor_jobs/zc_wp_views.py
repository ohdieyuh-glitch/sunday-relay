# THE LOADED WORLD, SEEN IN THE LEVEL VIEWPORT: the plaza and the three nation edges, after the editor regions load.
#
# Companion to zc_wp_regions. That job proves residency against disk (every actor descriptor a live object); this one
# puts the editor's own level-viewport camera over the world so the founder can SEE it -- the plaza from above and
# the far edge of each nation -- and so the "No Loaded Region(s)" banner's absence is photographed, not inferred.
#
# THE CAMERA IS POSED HERE; THE PHOTOGRAPH IS TAKEN OUTSIDE. HighResShot from a job never fired while the editor was
# not the foreground window (zc_wp_regions got four empty files), and the founder was using another window. So each
# pose writes view_ready_<n> into the channel and waits for view_done_<n>, which a PrintWindow grabber writes after
# photographing the editor window without taking focus.
#
# EDITOR WORLD ONLY: no play session, no map edit, no save. The camera is put back where it was.
CONCURRENT = False

import os
import unreal

VIEWS = (
    ("golden_arrival_overview", unreal.Vector(-14000.0, -14000.0, 9000.0), unreal.Vector(0.0, 0.0, 0.0)),
    ("icarus_north_edge", unreal.Vector(4300.0, 88000.0, 6500.0), unreal.Vector(4300.0, 104500.0, 1500.0)),
    ("noctis_southwest_edge", unreal.Vector(-78000.0, -40000.0, 6500.0), unreal.Vector(-92600.0, -48500.0, 1500.0)),
    ("tartarus_southeast_edge", unreal.Vector(80000.0, -42000.0, 6500.0), unreal.Vector(96300.0, -50600.0, 1500.0)),
    ("whole_world_high", unreal.Vector(0.0, -150000.0, 90000.0), unreal.Vector(0.0, 0.0, 0.0)),
)


def job():
    RESULT["status"] = "running"
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        RESULT["status"] = "VOID: a play session is running"
        return
    before = ues.get_level_viewport_camera_info()
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    # THE FIRST RUN PHOTOGRAPHED ONE STALE FRAME FIVE TIMES (identical md5 across five poses): an editor that is not
    # the foreground window sleeps between frames, so the viewport never redrew. Suspend that throttle for the run
    # and invalidate the viewport after each pose so every photograph is of the pose it names.
    unreal.WonderlandUiTestLibrary.set_background_throttle_suspended(True)
    shots_dir = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "Saved", "Screenshots", "WindowsEditor")
    shots = []
    RESULT["views"] = shots
    for n, (label, eye, target) in enumerate(VIEWS):
        rot = unreal.MathLibrary.find_look_at_rotation(eye, target)
        ues.set_level_viewport_camera_info(eye, rot)
        try:
            les.editor_invalidate_viewports()
        except Exception:                                           # noqa: BLE001
            pass
        yield 5.0
        t0 = __import__("time").time()
        unreal.SystemLibrary.execute_console_command(ues.get_editor_world(), "HighResShot 1600x900")
        yield 6.0
        try:
            fresh = [os.path.join(shots_dir, f) for f in os.listdir(shots_dir) if f.lower().endswith(".png")
                     and os.path.getmtime(os.path.join(shots_dir, f)) > t0]
        except OSError:
            fresh = []
        RESULT.setdefault("highres", {})[label] = max(fresh, key=os.path.getmtime) if fresh else None
        ready = os.path.join(CHANNEL, "view_ready_%d" % n)
        done = os.path.join(CHANNEL, "view_done_%d" % n)
        if os.path.exists(done):
            os.remove(done)
        with open(ready, "w") as fh:
            fh.write(label)
        got = [False]

        def taken():
            got[0] = os.path.exists(done)
            return got[0]

        try:
            yield (taken, 90.0)
        except TimeoutError:
            pass
        shots.append({"n": n, "label": label, "photographed": got[0]})
        emit("VIEW", n, label, got[0])
        # the grabber may still hold view_done open for a moment; a leftover file is harmless, a crash is not
        for f in (ready, done):
            try:
                if os.path.exists(f):
                    os.remove(f)
            except OSError:
                pass
    try:
        if before and len(before) >= 2:
            ues.set_level_viewport_camera_info(before[-2], before[-1])
    except Exception:                                               # noqa: BLE001
        pass
    RESULT["status"] = "measured" if all(s["photographed"] for s in shots) else "FAIL: a view was not photographed"
