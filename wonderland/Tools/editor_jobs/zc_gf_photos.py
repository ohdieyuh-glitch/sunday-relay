# THE OUTER-RING GARDENS, PHOTOGRAPHED WHERE THEY STAND: six GF03/04/05 flower beds from 9 m up, 22 m back.
#
# The founder asked for pictures of the world being added to, not audit maps. Same mechanism as zc_wp_views: the
# job poses the level-viewport camera and writes view_ready_<n>; a PrintWindow grabber outside photographs the
# editor window without taking focus and answers view_done_<n>. EDITOR WORLD ONLY: no play session, no map edit,
# no save; the camera is put back where it was. LABEL_SUFFIX names the round (before / after a re-apply).
CONCURRENT = False

import os
import unreal

LABEL_SUFFIX = globals().get("LABEL_SUFFIX", "")
VIEWS = (
    ("gf03_bed1", unreal.Vector(20831.0, -33504.0, 886.0), unreal.Vector(22525.0, -35030.0, -14.0)),
    ("gf03_bed2", unreal.Vector(29242.0, -25218.0, 886.0), unreal.Vector(31315.0, -26169.0, -14.0)),
    ("gf04_bed1", unreal.Vector(38637.0, -11396.0, 886.0), unreal.Vector(40917.0, -11408.0, -14.0)),
    ("gf04_bed2", unreal.Vector(39130.0, 5208.0, 886.0), unreal.Vector(41218.0, 6125.0, -14.0)),
    ("gf05_bed1", unreal.Vector(-39209.0, -654.0, 886.0), unreal.Vector(-41389.0, -1324.0, -14.0)),
    ("gf05_bed2", unreal.Vector(-42146.0, 10868.0, 886.0), unreal.Vector(-44425.0, 10805.0, -14.0)),
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
        label = label + LABEL_SUFFIX
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
