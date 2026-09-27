# CAN LOCAL EXPOSURE CLOSE zc_exposure E01 WITHOUT OPENING E04? A SWEEP, NOT A SETTING.
#
# WHAT E01 AND E04 SAY TOGETHER. Measured on current HEAD at noon, from the player's own eye:
#
#     clipped (>=250 on a channel)   7.14%   against a 2% bar        E01 FAIL
#     near-clipped (>=240)           8.63%
#     CRUSHED BLACK (<=10)          40.48%   against a 12% bar       E04 already failing
#     mean 51.6   median 15.7   p95 255.0
#
# That is not an exposure offset being wrong. A frame whose median is 15.7 and whose p95 is pinned at 255
# is a frame with more dynamic range than the tonemapper is being asked to fit: half of it is in the mud
# and a twentieth of it is destroyed, AT THE SAME TIME. Moving EV down fixes the 7% and worsens the 40%;
# moving it up does the reverse. E04 exists precisely to catch "fix glare by underexposing", and it is
# already red, so the global knob has nowhere to go. Nothing in Config sets Local Exposure, which is the
# UE5 feature built for exactly this shape.
#
# AND EV100 IS NOT A FREE KNOB HERE ANYWAY. DefaultEngine.ini pins r.EyeAdaptation.CachedLightingPreExposure
# = 13.5 to match the map's unbound PostProcessVolume, and records that when the two disagreed UE 5.8 warned
# that Lumen's cached lighting and the sky capture were being clipped. Moving exposure has a second
# consequence written down next to it. Local exposure moves neither.
#
# WHY THIS SWEEPS RATHER THAN SETS. This project has already learned the expensive version of this lesson:
# thirteen stops of exposure were swept on the wardrobe and changed the picture almost not at all, because
# the thing that was wrong was the lamps. A value chosen from what the feature is supposed to do, applied
# once and declared a fix, is the same mistake. So this reads what is there, sweeps the axis, and reports
# the curve -- and it SAVES NOTHING. Every change lands on the PIE copy of the volume and dies with PIE.
#
# THE INSTRUMENT IS CHECKED BEFORE IT IS BELIEVED. Two guards, both learned here:
#   * the properties are ENUMERATED, not assumed. Local exposure was renamed across UE versions and this
#     project's memory is full of "failed to find property" on names that looked right.
#   * L00 requires the sweep to MOVE the numbers. A render target that returns the same frame for every
#     setting is a broken capture, and it would otherwise read as "local exposure does nothing here".
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "local_exposure")

RT_W, RT_H = 480, 270
GRID_X, GRID_Y = 24, 14

#: (highlight_contrast, shadow_contrast). 1.0 / 1.0 is "local exposure off" and is the control.
#: Lower highlight contrast compresses the top; lower shadow contrast lifts the bottom.
SWEEP = ((1.0, 1.0), (0.8, 1.0), (0.6, 1.0), (0.8, 0.8), (0.6, 0.8), (0.6, 0.6), (0.4, 0.6))

PROPS = ("local_exposure_highlight_contrast_scale", "local_exposure_shadow_contrast_scale",
         "local_exposure_detail_strength", "local_exposure_blurred_luminance_blend",
         "local_exposure_middle_grey_bias", "local_exposure_method")


def read_frame(world, rt):
    # THE WORLD IS PASSED IN. This is module level; live() lives inside job(), so calling it here is a
    # runtime NameError that ast.parse cannot see.
    out = []
    for gy in range(GRID_Y):
        for gx in range(GRID_X):
            x = int((gx + 0.5) * RT_W / GRID_X)
            y = int((gy + 0.5) * RT_H / GRID_Y)
            c = unreal.RenderingLibrary.read_render_target_pixel(world, rt, x, y)
            out.append((int(c.r), int(c.g), int(c.b)))
    return out


def judge(frame):
    """The SAME metric zc_exposure uses, so these numbers can be put beside its own."""
    if not frame:
        return None
    n = float(len(frame))
    lum = sorted(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] for p in frame)
    return {"samples": int(n),
            "clipped_pct": round(100.0 * sum(1 for p in frame if max(p) >= 250) / n, 2),
            "near_clipped_pct": round(100.0 * sum(1 for p in frame if max(p) >= 240) / n, 2),
            "crushed_black_pct": round(100.0 * sum(1 for p in frame if max(p) <= 10) / n, 2),
            "mean_luminance": round(sum(lum) / n, 1),
            "median_luminance": round(lum[len(lum) // 2], 1),
            "p95_luminance": round(lum[int(0.95 * (len(lum) - 1))], 1)}


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests
    os.makedirs(ROOT, exist_ok=True)

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()

    def live():
        """The world, re-fetched at every use -- never a reference captured once and held.

        A held reference goes stale across long jobs and the failure is silent for some APIs: pose_camera
        throws "Cannot nativize 'World' as 'Object'" (which killed this job on 2026-09-27), while
        get_all_actors_with_tag simply returns an empty list that reads like an empty world.
        """
        return ues.get_game_world()

    def alive():
        """The world AND the pawn, or None. Gate every reading on this.

        When PIE is torn down mid-job the reads do not fail -- they return a constant black frame, which is
        indistinguishable from a legitimately dark scene. Any job that records a number after this returns
        None is publishing the dark as data.
        """
        w = ues.get_game_world()
        if w is None:
            return None
        try:
            return w if unreal.GameplayStatics.get_player_pawn(w, 0) is not None else None
        except Exception:                                              # noqa: BLE001
            return None
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(live(), "wl.Sky.Hour 12")
    unreal.SystemLibrary.execute_console_command(live(), "wl.Sky.DayMinutes 0")
    yield 5.0

    # ---- WHICH PROPERTIES ACTUALLY EXIST, read off the object rather than remembered.
    volumes = unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.PostProcessVolume)
    ppv = None
    for v in volumes:
        if v.get_editor_property("unbound"):
            ppv = v
            break
    if ppv is None:
        RESULT["status"] = "error"
        RESULT["error"] = "no unbound PostProcessVolume in the PIE world"
        return
    settings = ppv.get_editor_property("settings")
    available, missing = {}, []
    for name in PROPS:
        try:
            available[name] = str(settings.get_editor_property(name))
        except Exception as err:                                      # noqa: BLE001
            missing.append("%s (%s)" % (name, str(err)[:60]))
    RESULT["local_exposure_properties"] = available
    RESULT["local_exposure_properties_missing"] = missing
    RESULT["auto_exposure"] = {
        "min": float(settings.get_editor_property("auto_exposure_min_brightness")),
        "max": float(settings.get_editor_property("auto_exposure_max_brightness")),
        "bias": float(settings.get_editor_property("auto_exposure_bias"))}

    record("L01", "UE's local exposure controls exist on this build's PostProcessSettings",
           "local_exposure_highlight_contrast_scale" in available
           and "local_exposure_shadow_contrast_scale" in available,
           found=sorted(available), not_found=missing,
           note="enumerated, not assumed -- these were renamed between UE versions and a guessed name "
                "raises rather than reporting that the feature is absent")
    if "local_exposure_highlight_contrast_scale" not in available:
        RESULT["status"] = "measured"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    # ---- THE CAPTURE INHERITS THE WORLD'S GRADE. An override would measure the override.
    rt = unreal.RenderingLibrary.create_render_target2d(
        live(), RT_W, RT_H, unreal.TextureRenderTargetFormat.RTF_RGBA8)
    mgr = unreal.GameplayStatics.get_player_camera_manager(live(), 0)
    eye, aim = mgr.get_camera_location(), mgr.get_camera_rotation()
    RESULT["player_eye"] = [round(float(eye.x)), round(float(eye.y)), round(float(eye.z)),
                            round(float(aim.pitch), 1), round(float(aim.yaw), 1)]
    cap = H.spawn_scene_capture(live(), eye, aim, rt)
    if cap is None:
        RESULT["status"] = "error"
        RESULT["error"] = "no scene capture could be spawned"
        return
    cap.get_editor_property("capture_component2d").set_editor_property("capture_every_frame", True)
    for _ in range(16):
        yield 0.1

    def set_local(hi, sh):
        s = ppv.get_editor_property("settings")
        s.set_editor_property("override_local_exposure_highlight_contrast_scale", True)
        s.set_editor_property("override_local_exposure_shadow_contrast_scale", True)
        s.set_editor_property("local_exposure_highlight_contrast_scale", float(hi))
        s.set_editor_property("local_exposure_shadow_contrast_scale", float(sh))
        ppv.set_editor_property("settings", s)

    curve = {}
    RESULT["sweep"] = curve
    for hi, sh in SWEEP:
        set_local(hi, sh)
        yield 2.5
        key = "hi%0.1f_sh%0.1f" % (hi, sh)
        curve[key] = judge(read_frame(live(), rt))
        try:
            H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % key), 1400, 90)
        except Exception:                                             # noqa: BLE001
            pass
        emit("S_%s" % key, "INFO", "highlight %.1f shadow %.1f" % (hi, sh),
             {k: curve[key][k] for k in ("clipped_pct", "crushed_black_pct", "median_luminance")})

    # put it back the way PIE found it, even though PIE is about to end
    set_local(1.0, 1.0)

    readings = [v for v in curve.values() if v]
    clip = [v["clipped_pct"] for v in readings]
    crush = [v["crushed_black_pct"] for v in readings]
    record("L00", "the sweep moved the picture -- the instrument is responding",
           len(readings) == len(SWEEP) and (max(clip) - min(clip) > 0.5 or max(crush) - min(crush) > 0.5),
           clipped_range=[min(clip), max(clip)] if clip else None,
           crushed_range=[min(crush), max(crush)] if crush else None, readings=len(readings),
           note="a render target that returns the same frame at every setting is a broken capture, and "
                "would otherwise read as 'local exposure does nothing in this world'")

    control = curve.get("hi1.0_sh1.0") or {}
    RESULT["control_local_exposure_off"] = control
    # The winner has to clear BOTH gates at once; that is the whole difficulty.
    good = {k: v for k, v in curve.items()
            if v and v["clipped_pct"] <= 2.0 and v["crushed_black_pct"] <= 12.0}
    best = None
    if good:
        best = min(good, key=lambda k: good[k]["clipped_pct"] + good[k]["crushed_black_pct"])
    else:
        # nothing clears both; report the one that gets closest, as a distance rather than a winner
        best = min((k for k, v in curve.items() if v),
                   key=lambda k: max(0.0, curve[k]["clipped_pct"] - 2.0)
                   + max(0.0, curve[k]["crushed_black_pct"] - 12.0), default=None)
    RESULT["best"] = best
    RESULT["best_reading"] = curve.get(best)
    record("L02", "some local-exposure setting clears E01 and E04 at the same time",
           bool(good), clears_both=sorted(good), best=best, best_reading=curve.get(best),
           control_off=control, e01_bar=2.0, e04_bar=12.0,
           note="if this is red the answer is not local exposure alone, and the next suspect is the "
                "content -- a sky or a material that is genuinely emitting past the top of the range")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
