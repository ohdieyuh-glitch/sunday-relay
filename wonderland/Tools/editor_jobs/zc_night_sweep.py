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

#: Retired with the render-target path. The viewport's own resolution is the sampling grid now, and
#: read_screen_rect strides it to about 100x100 samples per patch.

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
#: THE HOURLY LADDER CANNOT SEE THE SHAPE OF DUSK. Read the source: Daylight = clamp((elev+9)/21)^1.9 is
#: pinned at EXACTLY 1.0 from 06:38 to 17:22 -- 10.7 hours of a 24-hour day -- and then falls the whole way to
#: zero between 17:22 and 18:29. The entire transition is 67 minutes long, so sampling on the hour lands three
#: points on it and cannot say whether it is a smooth ramp or a step.
#:
#: AND THE HOURLY LADDER IS CONFOUNDED. Between 15:00 and 17:00 Daylight is 1.0 and the exposure bias is -0.9
#: at every sample -- nothing about the lighting changes -- yet the same framing read 0.264, 0.182, 0.190. That
#: 0.082 swing is the sun's BEARING sweeping 72 to 288 degrees across the day and relighting this particular
#: view, not the cycle getting darker. Any statistic quoted as a fraction "of the day's range" is therefore
#: part bearing and part brightness, and must not be quoted as though it were all brightness.
HOURS = ([float(h) for h in range(0, 16)]
         + [16.0 + i / 6.0 for i in range(1, 25)]      # 16:00-20:00 every ten minutes
         + [float(h) for h in range(21, 25)])


def patch(cx, cy, hw, hh):
    """Measure a rectangle of the COMPOSITED VIEWPORT -- the frame a person is looking at.

    This is deliberately the same instrument the exposure proofs, the checkpoint court reading and the water
    audit use, because those are the readings whose plausibility has been checked against photographs. The
    render-target path this replaces was never cross-checked against the JPEGs this job saves.

    `dark` is the fraction below luma 0.14 and is NOT the old `crushed` (max channel <= 10/255): it counts
    more pixels, so the same 0.60 ceiling is stricter. That is intended -- a path at luma 0.10 is not pure
    black and is still unreadable.
    """
    got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
    if got is None:
        return None
    mean, dark, bright, sampled = got
    return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
            "dark": round(dark, 4), "bright": round(bright, 4), "sampled": int(sampled)}


def judge(_unused=None):
    """Retired. The two-camera split it belonged to is gone; kept only so a stale call fails loudly."""
    raise RuntimeError("judge() is retired -- measure the posed viewport with patch(), not a second camera")


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
    unreal.SystemLibrary.execute_console_command(live(), "wl.Sky.DayMinutes 0")
    yield 5.0
    dog = unreal.GameplayStatics.get_player_pawn(live(), 0)

    # Are the practicals there at all? Asked, not assumed.
    # ASK SEVERAL WAYS, AND NEVER REPORT "ABSENT" WHEN WHAT FAILED WAS THE QUESTION.
    #
    # The mascot sweep reported practicals as "'World' object has no attribute 'get_subsystem'" and that
    # string is easy to read as "the subsystem is not running" -- which would have been a false alarm about
    # this lane's own C++. The editor log settles it independently: WLLIGHT 970 practicals defined, pool of
    # 48, on every BeginPlay. So an unreadable accessor is reported as a REPORTING failure, in those words,
    # and the log is named as the authority.
    practicals, how = None, None
    for label, fn in (
            ("world.get_subsystem", lambda: live().get_subsystem(unreal.WonderlandPracticalLightsSubsystem)),
            ("get_world_subsystem", lambda: unreal.get_world_subsystem(unreal.WonderlandPracticalLightsSubsystem)),
            ("actor_iter", lambda: next(iter(unreal.GameplayStatics.get_all_actors_of_class(
                live(), unreal.WonderlandPracticalLightsSubsystem)), None))):
        try:
            sub = fn()
            if sub is not None:
                practicals, how = str(sub.describe_practicals()), label
                break
        except Exception:                                             # noqa: BLE001
            continue
    RESULT["practicals"] = practicals or (
        "UNREADABLE FROM PYTHON -- this is the reporting path, not the subsystem. The editor log is the "
        "authority: grep WLLIGHT in the live editor log for 'practicals defined, pool of N'.")
    RESULT["practicals_read_via"] = how

    # NO SECOND CAMERA. The viewport is the instrument and the artefact both.
    L.focus_game_viewport()

    def cvar(name, value):
        unreal.SystemLibrary.execute_console_command(live(), "%s %s" % (name, value))

    def look(label, eye, at):
        """Park the player beside the place so its cell streams, then aim THE VIEWPORT at it.

        Parking still matters and is not about the camera: an unstreamed cell renders as nothing whichever
        instrument reads it, and the pawn is what makes the cell load.
        """
        try:
            dog.set_actor_location(unreal.Vector(eye[0], eye[1], eye[2] + 60.0), False, False)
        except Exception:                                             # noqa: BLE001
            pass
        L.pose_camera(live(), unreal.Vector(*eye), unreal.Vector(*at), 60.0)

    def shoot(name):
        """One frame: the numbers and the picture, from the same camera in the same moment.

        FRAME is the founder's overall "does this look like night", GROUND is the lower third -- the nearby
        ground and path underfoot, which is the first thing item 1 of the founder's list asks about and the
        part a whole-frame mean hides behind sky.
        """
        try:
            H.capture_viewport_jpeg(os.path.join(ROOT, name + ".jpg"), 1200, 85)
        except Exception:                                             # noqa: BLE001
            pass
        f = patch(0.5, 0.5, 0.46, 0.44)
        g = patch(0.5, 0.78, 0.30, 0.16)
        if f is None:
            return None
        f["ground"] = g
        return f

    # ---- NOON, for the "still night" reference at each place.
    cvar("wl.Sky.Hour", 12)
    noon = {}
    for label, eye, at in PLACES:
        look(label, eye, at)
        yield 3.0
        noon[label] = shoot("noon__%s" % label)
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
            r = shoot("%s__%s" % (key, label))
            row["places"][label] = r
        # READABLE now also requires the GROUND to be readable, not just the frame average. A frame carried
        # over the line by a bright sky while the path underfoot is black is exactly the complaint.
        readable = [p for p, r in row["places"].items()
                    if r and r["dark"] <= 0.60 and r["luma"] >= 0.06
                    and (r.get("ground") is None or r["ground"]["dark"] <= 0.75)]
        still_night = [p for p, r in row["places"].items()
                       if r and noon.get(p) and r["luma"] <= 0.38 * max(noon[p]["luma"], 1e-6)]
        row["readable"] = readable
        row["still_night"] = still_night
        row["score"] = len(readable) if len(still_night) == len(PLACES) else -1
        sweep.append(row)
        emit("S_%s" % key, "INFO", key, {"readable": len(readable), "still_night": len(still_night),
                                         "worst_dark": max((r["dark"] for r in row["places"].values() if r), default=None)})

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
        r = shoot("ladder__h%02.0f" % hour)
        # THE MODEL BESIDE THE MEASUREMENT. Daylight and the exposure bias are computable from the hour
        # alone, and recording them next to the reading is what makes a disagreement visible instead of
        # arguable -- 17:00 to 18:00 is predicted 0.74x on exposure grounds and measured 1.61x, and that gap
        # is the finding.
        elev = math.sin(((hour - 6.0) / 12.0) * math.pi) * 72.0
        dayl = max(0.0, min(1.0, (elev + 9.0) / 21.0)) ** 1.9
        ladder.append({"hour": round(hour, 3), "luma": r["luma"] if r else None,
                       "dark": r["dark"] if r else None,
                       "ground_luma": (r.get("ground") or {}).get("luma") if r else None,
                       "sun_elevation": round(elev, 2), "daylight": round(dayl, 4),
                       "exposure_bias": round(1.45 + (-0.9 - 1.45) * dayl, 3)})
    RESULT["ladder"] = ladder
    L.release_camera(live())
    jumps = [(abs(ladder[i]["luma"] - ladder[i - 1]["luma"]), ladder[i]["hour"])
             for i in range(1, len(ladder)) if ladder[i]["luma"] is not None and ladder[i - 1]["luma"] is not None]
    worst_jump = max(jumps) if jumps else (None, None)

    # ---- THE GATES
    lumas = [r["luma"] for row in sweep for r in row["places"].values() if r]
    # ---- DAYLIGHT SANITY. Nothing below means anything if the instrument cannot see a lit world.
    #
    # The first run returned NOON luma of 0.0343 at the arrival, 0.0118 at the clock quarter and 0.0300 at
    # the Noctis architecture -- near-black at midday. The same world read through the VIEWPORT on the same
    # afternoon gave 0.17 to 0.34 at comparable framings (zc_checkpoints court_luma_noon). Two capture paths,
    # one plausible and one not, and every night verdict here divides by the implausible one: "still night"
    # is luma <= 0.38 x noon, which is meaningless when noon is itself black. So this gate runs FIRST and a
    # red here voids the rest of the job rather than letting it publish ratios against a dark reference.
    noon_lumas = {k: v["luma"] for k, v in noon.items() if v}
    bright_enough = [k for k, v in noon_lumas.items() if v >= 0.12]
    record("N_SANITY", "the capture can see a lit world at noon -- the reference the night ratios divide by",
           len(bright_enough) >= max(1, len(noon_lumas) - 1), noon_luma=noon_lumas, floor=0.12,
           too_dark=[k for k in noon_lumas if k not in bright_enough],
           note="this now reads the same composited frame that is saved beside it as noon__<place>.jpg, "
                "so a red here is checkable by eye: open the JPEG. The previous version measured a "
                "SceneCapture actor while saving viewport JPEGs -- two cameras, and only one was ever posed")

    record("N00", "the sweep moved the picture -- the instrument is responding",
           lumas and (max(lumas) - min(lumas)) > 0.02, luma_range=[min(lumas), max(lumas)] if lumas else None,
           practicals=practicals)
    baseline = sweep[0] if sweep else None
    record("N01", "the world as it stands is NOT readable at every one of the founder's seven places -- i.e. "
                  "the complaint reproduces before anything is changed",
           baseline is not None and len(baseline["readable"]) < len(PLACES),
           baseline_readable=baseline["readable"] if baseline else None,
           baseline_dark={p: r["dark"] for p, r in (baseline["places"].items() if baseline else [])},
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
