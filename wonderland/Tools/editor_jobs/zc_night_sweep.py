# HOW BRIGHT SHOULD NIGHT BE, AND WHERE DOES THE LIGHT COME FROM? A SWEEP OVER THE FOUNDER'S OWN PLACES.
#
# FOUNDER, 2026-09-27: "Night is still too dark. Brighten it somewhat; do not turn night into daytime ...
# Do not solve this with one giant global brightness increase -- balance moon/night sky + skylight/ambient
# + exposure + city practicals + architectural lights ... Verify at city, major path, plaza, territory
# entrance, water, architecture, and with a mascot/companion nearby ... Do not certify these through
# parameter values alone."
#
# So this is a sweep, photographed, at seven places the founder named, and it saves nothing: every knob is a
# console variable on the PIE copy and dies with PIE. What it produces is the curve -- which combination of
# moon, sky light and practicals makes the most of those seven places READABLE while every one of them is
# still NIGHT -- and the pictures that go with each point on it.
#
# THE TWO GATES, both borrowed from proofs that already exist so the numbers sit beside theirs:
#   READABLE   crushed-black fraction <= 0.60 and luma >= 0.06     (zc_night_readable's ceiling was 0.72; the
#                                                                  founder says that was still too dark)
#   STILL NIGHT luma <= 0.38 x that place's own NOON luma           (zc_night_readable N02, unchanged: a
#                                                                  night that clears this is a night)
# A combination scores by how many places it makes readable; a combination that makes any place stop being
# night is disqualified whatever it scores. That is "brighten it somewhat" as arithmetic.
#
# AND THE CYCLE. The founder asked for MORNING -> AFTERNOON -> EVENING -> NIGHT -> MORNING with no jarring
# brightness jumps. Twenty-five hourly reads at the arrival, and the largest hour-to-hour change in mean
# luminance is reported as the jump. Nothing here decides what "jarring" is; it reports the number and the
# hour it happens at.
#
# THE INSTRUMENT IS CHECKED BEFORE IT IS BELIEVED: N00 fails if the sweep does not move the readings, and
# the practicals subsystem is asked to describe itself so "practicals off" and "practicals absent" cannot be
# confused.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "night_sweep")

RT_W, RT_H = 480, 270
GRID_X, GRID_Y = 24, 14

#: The founder's seven, as places in this world: (label, eye, look-at). Eyes 2.6 m up, 12-20 m back, the
#: way a player sees a place rather than a drone. Coordinates from the travel registry's anchors and the
#: checkpoint proof points.
PLACES = (
    ("city_arrival",        (0.0, -3800.0, 260.0),        (0.0, 800.0, 60.0)),
    ("major_path_march",    (-4000.0, 58000.0, 260.0),    (0.0, 62500.0, 20.0)),
    ("plaza_clock_quarter", (12000.0, 700.0, 260.0),      (13400.0, 1900.0, 40.0)),
    ("entrance_tartarus",   (44000.0, -21500.0, 260.0),   (46177.0, -22619.0, 60.0)),
    ("water_gardens",       (-3300.0, -9600.0, 320.0),    (-4849.0, -11480.0, 480.0)),
    ("architecture_noctis", (-49500.0, -31000.0, 260.0),  (-52000.0, -32500.0, 400.0)),
    ("mascot_at_spawn",     (-320.0, -1900.0, 200.0),     (0.0, -1460.0, 90.0)),
)

#: (moon gain, night sky, practical gain). The first row is the world as it stands.
SWEEP = (
    (0.050, 7.0, 0.0),
    (0.050, 7.0, 1.0),
    (0.050, 10.0, 1.0),
    (0.080, 7.0, 1.0),
    (0.080, 10.0, 1.0),
    (0.080, 10.0, 1.6),
    (0.120, 10.0, 1.0),
    (0.120, 14.0, 1.0),
    (0.080, 14.0, 1.6),
)
HOURS = [float(h) for h in range(0, 25)]


def read_frame(world, rt):
    out = []
    for gy in range(GRID_Y):
        for gx in range(GRID_X):
            c = unreal.RenderingLibrary.read_render_target_pixel(
                world, rt, int((gx + 0.5) * RT_W / GRID_X), int((gy + 0.5) * RT_H / GRID_Y))
            out.append((int(c.r), int(c.g), int(c.b)))
    return out


def judge(frame):
    if not frame:
        return None
    n = float(len(frame))
    lum = sorted(0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] for p in frame)
    return {"luma": round(sum(lum) / n / 255.0, 4),
            "crushed": round(sum(1 for p in frame if max(p) <= 10) / n, 4),
            "clipped": round(sum(1 for p in frame if max(p) >= 250) / n, 4),
            "median": round(lum[len(lum) // 2] / 255.0, 4)}


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
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 5.0
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)

    # Are the practicals there at all? Asked, not assumed.
    practicals = None
    try:
        sub = world.get_subsystem(unreal.WonderlandPracticalLightsSubsystem)
        practicals = str(sub.describe_practicals()) if sub is not None else "no subsystem"
    except Exception as err:                                          # noqa: BLE001
        practicals = "unreadable: %s" % str(err)[:80]
    RESULT["practicals"] = practicals

    rt = unreal.RenderingLibrary.create_render_target2d(world, RT_W, RT_H, unreal.TextureRenderTargetFormat.RTF_RGBA8)
    cap = H.spawn_scene_capture(world, unreal.Vector(0, 0, 500), unreal.Rotator(0, 0, 0), rt)
    if cap is None:
        RESULT["status"] = "error"
        RESULT["error"] = "no scene capture"
        return
    cap.get_editor_property("capture_component2d").set_editor_property("capture_every_frame", True)

    def cvar(name, value):
        unreal.SystemLibrary.execute_console_command(world, "%s %s" % (name, value))

    def look(label, eye, at):
        """Park the player beside the place so its cell streams, then aim the capture at it."""
        try:
            dog.set_actor_location(unreal.Vector(eye[0], eye[1], eye[2] + 60.0), False, False)
        except Exception:                                             # noqa: BLE001
            pass
        yaw = math.degrees(math.atan2(at[1] - eye[1], at[0] - eye[0]))
        dist = math.hypot(at[0] - eye[0], at[1] - eye[1])
        pitch = math.degrees(math.atan2(at[2] - eye[2], dist))
        cap.set_actor_location_and_rotation(unreal.Vector(*eye), unreal.Rotator(pitch, yaw, 0.0), False, False)

    # ---- NOON, for the "still night" reference at each place.
    cvar("wl.Sky.Hour", 12)
    noon = {}
    for label, eye, at in PLACES:
        look(label, eye, at)
        yield 3.0
        noon[label] = judge(read_frame(world, rt))
    RESULT["noon"] = noon

    # ---- THE SWEEP, at midnight.
    cvar("wl.Sky.Hour", 0)
    yield 3.0
    sweep = []
    RESULT["sweep"] = sweep
    for moon, sky, gain in SWEEP:
        cvar("wl.Sky.MoonGain", moon)
        cvar("wl.Sky.NightSky", sky)
        cvar("wl.Look.PracticalGain", gain)
        yield 2.5
        key = "moon%.3f_sky%.0f_prac%.1f" % (moon, sky, gain)
        row = {"key": key, "moon": moon, "sky": sky, "practicals": gain, "places": {}}
        for label, eye, at in PLACES:
            look(label, eye, at)
            yield 2.0
            r = judge(read_frame(world, rt))
            row["places"][label] = r
            try:
                H.capture_viewport_jpeg(os.path.join(ROOT, "%s__%s.jpg" % (key, label)), 1200, 85)
            except Exception:                                         # noqa: BLE001
                pass
        readable = [p for p, r in row["places"].items() if r and r["crushed"] <= 0.60 and r["luma"] >= 0.06]
        still_night = [p for p, r in row["places"].items()
                       if r and noon.get(p) and r["luma"] <= 0.38 * max(noon[p]["luma"], 1e-6)]
        row["readable"] = readable
        row["still_night"] = still_night
        row["score"] = len(readable) if len(still_night) == len(PLACES) else -1
        sweep.append(row)
        emit("S_%s" % key, "INFO", key, {"readable": len(readable), "still_night": len(still_night),
                                         "worst_crushed": max((r["crushed"] for r in row["places"].values() if r), default=None)})

    # put the world back as it was found
    cvar("wl.Sky.MoonGain", SWEEP[0][0])
    cvar("wl.Sky.NightSky", SWEEP[0][1])
    cvar("wl.Look.PracticalGain", 1.0)

    # ---- THE CYCLE, at the arrival, hour by hour.
    label, eye, at = PLACES[0]
    look(label, eye, at)
    ladder = []
    for hour in HOURS:
        cvar("wl.Sky.Hour", hour)
        yield 2.0
        r = judge(read_frame(world, rt))
        ladder.append({"hour": hour, "luma": r["luma"] if r else None, "crushed": r["crushed"] if r else None})
    RESULT["ladder"] = ladder
    jumps = [(abs(ladder[i]["luma"] - ladder[i - 1]["luma"]), ladder[i]["hour"])
             for i in range(1, len(ladder)) if ladder[i]["luma"] is not None and ladder[i - 1]["luma"] is not None]
    worst_jump = max(jumps) if jumps else (None, None)

    # ---- THE GATES
    lumas = [r["luma"] for row in sweep for r in row["places"].values() if r]
    record("N00", "the sweep moved the picture -- the instrument is responding",
           lumas and (max(lumas) - min(lumas)) > 0.02, luma_range=[min(lumas), max(lumas)] if lumas else None,
           practicals=practicals)
    baseline = sweep[0] if sweep else None
    record("N01", "the world as it stands is NOT readable at every one of the founder's seven places -- i.e. "
                  "the complaint reproduces before anything is changed",
           baseline is not None and len(baseline["readable"]) < len(PLACES),
           baseline_readable=baseline["readable"] if baseline else None,
           baseline_crushed={p: r["crushed"] for p, r in (baseline["places"].items() if baseline else [])},
           note="if this is green the sweep is measuring somewhere the founder was not looking")
    best = max((row for row in sweep if row["score"] >= 0), key=lambda r: (r["score"], -r["practicals"]), default=None)
    RESULT["best"] = best["key"] if best else None
    record("N02", "some combination makes every place readable while every place is still night",
           best is not None and best["score"] == len(PLACES),
           best=best["key"] if best else None, best_readable=best["readable"] if best else None,
           ranked=[(r["key"], r["score"]) for r in sorted(sweep, key=lambda r: -r["score"])[:5]],
           note="a combination that stops any place being night is disqualified whatever else it lights")
    record("N03", "no hour-to-hour step in the cycle exceeds a quarter of the day's range",
           worst_jump[0] is not None and worst_jump[0] <= 0.25 * (max(l["luma"] for l in ladder) - min(l["luma"] for l in ladder) + 1e-6),
           worst_jump_luma=worst_jump[0], at_hour=worst_jump[1],
           day_range=[min(l["luma"] for l in ladder), max(l["luma"] for l in ladder)] if ladder else None)
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
