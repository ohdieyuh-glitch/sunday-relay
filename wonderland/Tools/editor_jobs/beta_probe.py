# PIE job: private-beta gate probe -- runtime completeness, frame time, and lighting variants in one PIE session.
#
# 1. RUNTIME COMPLETENESS (gate 4). WL_V2_GoldenArrival_WP2 is a single persistent level (world_audit.py: no
#    World Partition object), so PIE should hold every authored actor the editor holds. Counted per pass.
# 2. FRAME TIME (gate 10). The editor behind another window throttles PIE to ~3 fps, and that throttle cannot be
#    lifted from Python, so every sample records whether the editor held the foreground; only those samples are
#    measurements. Each pose is settled (Lumen and shader compiles), then frames are counted over SECONDS. These
#    are PIE-in-editor numbers: the editor's own UI costs are included, so a packaged game runs faster, not slower.
# 3. LIGHTING VARIANTS (gate 6). The world has four directional lights: the sun and three unshadowed fills
#    (world_audit.py). Unshadowed directional light reaches every surface facing it -- under arches, inside
#    canopies, the shadow side of towers -- which flattens form. Variants are applied to the PIE copy only and
#    captured; nothing is saved.
# Never starts or ends the founder's PIE: it waits until no PIE is running.
import os
import time

CONCURRENT = False
SECONDS = globals().get("SECONDS", 8.0)
SETTLE = globals().get("SETTLE", 5.0)
TAG = globals().get("TAG", "beta")
SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "beta")
PASSES = ["GA01", "GA02", "GA03", "GA04", "GA05", "GA06", "GA07", "SKY01", "SKY02", "SKY03", "SKY04", "SKY05"]
EDITOR_COUNTS = globals().get("EDITOR_COUNTS", {})
PERF_POSES = [("PlayerSpawn", None), ("HeroCam_GoldenArrivalBible", None),
              ("ArrivalEye", (0.0, -1460.0, 180.0, 0.0, 90.0, 90.0)),
              ("PathGround", (0.0, 1150.0, 175.0, -6.0, 90.0, 85.0)),
              ("ClockPlaza", (0.0, 5000.0, 175.0, 11.0, 90.0, 90.0)),
              ("PlazaHigh", (0.0, -1200.0, 1500.0, 8.0, 90.0, 85.0)),
              ("CityLeft", (0.0, -150.0, 262.0, 6.0, 40.0, 90.0)),
              ("CityRight", (0.0, -150.0, 262.0, 6.0, 140.0, 90.0))]
LIGHT_POSES = ["HeroCam_GoldenArrivalBible", "PathGround", "ClockPlaza", "FlankLeftCam08"]
FILLS = ("V2_CanopyFill", "V2_CanopyFill2", "V2_GroundBounce")
VARIANTS = globals().get("VARIANTS", [
    {"id": "v0_control"},
    {"id": "v1_fills_half", "fills": 0.5},
    {"id": "v2_fills_off", "fills": 0.0},
    {"id": "v3_fills_off_sky2p8", "fills": 0.0, "skylight": 2.8},
])


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    os.makedirs(SHOTS, exist_ok=True)
    try:
        yield from _probe(ues, les)
    finally:
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
    RESULT["status"] = "done"


def _probe(ues, les):
    SL = unreal.SystemLibrary
    GS = unreal.GameplayStatics
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: GS.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 6.0
    world = ues.get_game_world()
    pc = GS.get_player_controller(world, 0)
    pawn = GS.get_player_pawn(world, 0)
    cvars = {}
    for name in ("t.MaxFPS", "r.VSync", "r.ScreenPercentage", "r.Lumen.HardwareRayTracing", "r.Shadow.Virtual.Enable"):
        try:
            cvars[name] = SL.get_console_variable_float_value(name)
        except Exception as exc:
            cvars[name] = repr(exc)[:80]
    RESULT["cvars"] = cvars
    try:
        vp = unreal.WidgetLayoutLibrary.get_viewport_size(world)
        RESULT["viewport"] = [round(vp.x), round(vp.y)]
    except Exception as exc:
        RESULT["viewport"] = repr(exc)[:80]

    # 1. runtime completeness
    actors = GS.get_all_actors_of_class(world, unreal.Actor)
    counts = {p: 0 for p in PASSES}
    for a in actors:
        for t in a.tags:
            s = str(t)
            if s.startswith("WL_PASS_") and s[8:] in counts:
                counts[s[8:]] += 1
    RESULT["pie_actors"] = len(actors)
    RESULT["pie_pass_counts"] = counts
    if EDITOR_COUNTS:
        RESULT["pass_count_mismatch"] = {p: [EDITOR_COUNTS.get(p), counts[p]] for p in PASSES if EDITOR_COUNTS.get(p) != counts[p]}
    yield None

    cams = {a.get_actor_label(): a for a in GS.get_all_actors_of_class(world, unreal.CameraActor)}
    rover = cams["SkylineCam06"]
    comp = rover.get_editor_property("camera_component")
    comp.set_editor_property("constrain_aspect_ratio", False)

    def view(name, pose):
        if name == "PlayerSpawn":
            pc.set_view_target_with_blend(pawn, 0.0)
        elif pose is None:
            pc.set_view_target_with_blend(cams[name], 0.0)
        else:
            x, y, z, pitch, yaw, fov = pose
            rover.set_actor_location_and_rotation(unreal.Vector(x, y, z), unreal.Rotator(roll=0.0, pitch=pitch, yaw=yaw), False, True)
            comp.set_editor_property("field_of_view", fov)
            pc.set_view_target_with_blend(rover, 0.0)

    # 2. frame time, twice round the poses: the first round includes shader/PSO compiles and Lumen convergence
    perf = []
    for rnd in (1, 2):
        for name, pose in PERF_POSES:
            view(name, pose)
            yield SETTLE
            fg0 = _editor_foreground()
            f0, t0 = SL.get_frame_count(), time.time()
            yield SECONDS
            frames, secs = SL.get_frame_count() - f0, time.time() - t0
            perf.append({"round": rnd, "pose": name, "fps": round(frames / secs, 1), "ms": round(1000.0 * secs / max(frames, 1), 1),
                         "foreground": bool(fg0 and _editor_foreground())})
        emit("perf round %d" % rnd)
    RESULT["perf"] = perf

    # 3. lighting variants
    for hud in unreal.ObjectIterator(unreal.WonderlandUsageHudWidget):
        if hud.get_world() == world:
            hud.set_visibility(unreal.SlateVisibility.HIDDEN)
    pawn.set_actor_hidden_in_game(True)
    lights = {a.get_actor_label(): a for a in GS.get_all_actors_of_class(world, unreal.DirectionalLight)}
    base_fill = {n: lights[n].light_component.get_editor_property("intensity") for n in FILLS if n in lights}
    skylight = GS.get_all_actors_of_class(world, unreal.SkyLight)[0]
    base_sky = skylight.light_component.get_editor_property("intensity")
    RESULT["light_base"] = {"fills": base_fill, "skylight": base_sky}
    poses = dict(PERF_POSES)
    shots = []
    for v in VARIANTS:
        for n, i in base_fill.items():
            lights[n].light_component.set_intensity(i * v.get("fills", 1.0))
        skylight.light_component.set_intensity(v.get("skylight", base_sky))
        skylight.light_component.recapture_sky()
        for name in LIGHT_POSES:
            view(name, poses.get(name))
            yield 4.0
            path = os.path.join(SHOTS, "%s__%s__%s.png" % (name, TAG, v["id"]))
            shots.append({"pose": name, "variant": v["id"], "ok": bool(unreal.WonderlandUiTestLibrary.capture_game_viewport(path)), "path": path})
        emit(v["id"])
    RESULT["shots"] = shots
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)


def _editor_foreground():
    """Whether this editor owns the foreground window. Behind another window the editor throttles PIE
    (EditorPerformanceSettings.bThrottleCPUWhenNotForeground is neither Python-visible nor settable with
    `set` in the editor), so a frame rate is only a measurement when this is True."""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        pid = ctypes.c_ulong(0)
        user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), ctypes.byref(pid))
        return pid.value == os.getpid()
    except Exception:
        return None
