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
    # THIS VIEW IS INSIDE FOLIAGE and the JPEG says so plainly: dark green leaf geometry filling the frame at
    # close range, at NOON. It is why this place read 0.0596 luma with 97% of the frame below the darkness
    # threshold at midday, and it is not a lighting gap. Three inferences of mine from layer files -- empty
    # ground, architecture 11.5 km away, not drawn at range -- were all wrong, and a trace could never have
    # settled it because foliage carries no collision. Vegetation is 89% of this world's triangles, so a
    # viewpoint that lands inside it reads as "the region is black" on every luma gate ever written.
    # Moved out and up to stand clear of the canopy and look at the district the name promises.
    ("architecture_noctis", (-59440.0, -32983.0, 900.0),  (-62323.0, -34372.0, 700.0)),
    ("mascot_at_spawn",     (-320.0, -1900.0, 200.0),     (0.0, -1460.0, 90.0)),
)

#: (moon gain, night sky, practical gain). The first row is the world as it stands.
#: (MoonGain, NightSky, PracticalGain, NightFill).
#:
#: NIGHTFILL WAS NEVER SWEPT AND THAT WEAKENS MY OWN HEADLINE. I reported that "no moon/sky/practical
#: combination makes the founder's seven places readable while keeping them night" -- true, and it swept
#: THREE levers while holding the fourth constant at its shipped 0.26. NightFill is the floor under the
#: three fill lights, and it is the knob that most directly lifts a surface no moon is striking, which is
#: exactly the failure that reading described.
#:
#: IT ALSO MATTERS FOR COST, WHICH IS WHY IT IS IN NOW RATHER THAN LATER. The night readability currently
#: comes from local exposure, and local exposure is a bilateral decomposition on the RENDER THREAD -- a pass
#: whose price at night nobody has measured. NightFill buys brightness from lights that are already being
#: rendered, with no extra pass. If the lift turns out expensive, this is the alternative, and it should be
#: measured before it is needed rather than guessed at under pressure.
SWEEP = (
    # the shipped floor, across the moon/sky/practical range as before
    (0.050, 7.0, 0.0, 0.26),
    (0.050, 7.0, 1.0, 0.26),
    (0.080, 7.0, 1.0, 0.26),
    (0.080, 10.0, 1.0, 0.26),
    (0.120, 10.0, 1.0, 0.26),
    (0.120, 14.0, 1.0, 0.26),
    # then the fill itself, at a fixed and modest moon/sky/practical, which is the comparison that matters
    (0.050, 7.0, 1.0, 0.45),
    (0.050, 7.0, 1.0, 0.70),
    (0.050, 7.0, 1.0, 1.00),
    (0.080, 10.0, 1.0, 0.45),
    (0.080, 10.0, 1.0, 0.70),
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

    def what_is_drawn(eye, at):
        """Trace along the view and report the surfaces actually there, with their distances.

        WHY THIS EXISTS. architecture_noctis reads 97% of its frame below luma 0.14 AT NOON, and I have twice
        now guessed wrong about why from the layer files alone -- first that the view was aimed at empty
        ground, then that the architecture was 11.5 km away. Neither is true: an offline cone count puts 2,700
        architecture instances in that view with the nearest at 53 m and the bulk between 100 and 200 m. So
        the district is there and at an ordinary viewing distance, and the question of whether it is DRAWN is
        not answerable from a JSON file. A trace can answer it, and until it does the cause is unestablished.
        """
        out = []
        dx, dy, dz = at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]
        n = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
        for reach in (5000.0, 10000.0, 16000.0, 24000.0):
            a = unreal.Vector(*eye)
            b = unreal.Vector(eye[0] + dx / n * reach, eye[1] + dy / n * reach, eye[2] + dz / n * reach)
            try:
                hit = unreal.SystemLibrary.line_trace_single(
                    live(), a, b, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [],
                    unreal.DrawDebugTrace.NONE, True,
                    unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            except Exception as err:                                  # noqa: BLE001
                out.append({"reach_uu": reach, "error": str(err)[:80]})
                continue
            if hit is None:
                out.append({"reach_uu": reach, "hit": None})
                continue
            # HitResult has no named attributes in this engine's Python: to_tuple indices only.
            t = hit.to_tuple()
            mesh = None
            try:
                comp = t[10] if len(t) > 10 else None
                sm = comp.get_editor_property("static_mesh") if comp is not None else None
                mesh = str(sm.get_name()) if sm is not None else None
            except Exception:                                         # noqa: BLE001
                pass
            out.append({"reach_uu": reach,
                        "distance_uu": round(float(t[3]), 1) if len(t) > 3 else None,
                        "mesh": mesh})
        return out

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
    drawn = {}
    for label, eye, at in PLACES:
        look(label, eye, at)
        yield 3.0
        noon[label] = shoot("noon__%s" % label)
        # WHAT IS ACTUALLY IN FRONT OF THE CAMERA, at the hour where a dark reading is least explicable.
        drawn[label] = what_is_drawn(eye, at)
    RESULT["noon"] = noon
    RESULT["noon_surfaces"] = drawn

    # ---- THE SWEEP, at midnight.
    cvar("wl.Sky.Hour", 0)
    # THE SKY TAKES LONGER TO ARRIVE THAN THE CAMERA DOES, and three seconds is not enough after a jump
    # from noon. PROVED BY THE RUN ITSELF: the first three places of the first combination read 0.7159,
    # 0.5485 and 0.5311, and the SAME three places in the very next combination read 0.1308, 0.1157 and
    # 0.1153 -- while places four to seven were identical across both (0.1328/0.1256, 0.1549/0.1538,
    # 0.1124/0.1123). The sweep was photographing the tail of the sunset for its first three readings and
    # calling it midnight.
    #
    # Nothing about that is visible in a single combination; it only shows when the same place is compared
    # across two, in measurement order. A settle long enough to cross the whole 67-minute dusk transition,
    # then one throwaway framing so the exposure has somewhere to land before anything is recorded.
    # WAIT ON THE THING, NOT ON A DURATION. A longer timer is the weaker fix and picks a number nobody can
    # defend; the other lane waits on a ground trace for streaming rather than on seconds, and the same
    # applies to a sky. Read one framing repeatedly and go when it STOPS MOVING, with the timer only as a
    # backstop. That adapts to a slow machine instead of being wrong on one.
    settled_after, prev = None, None
    if PLACES:
        look(*PLACES[0])
        for attempt in range(20):
            yield 1.5
            now = patch(0.5, 0.5, 0.46, 0.44)
            if now is None:
                continue
            if prev is not None and abs(now["luma"] - prev["luma"]) < 0.004:
                settled_after = round(1.5 * (attempt + 1), 1)
                break
            prev = now
    RESULT["sky_settled_after_s"] = settled_after
    RESULT["sky_settle_note"] = (
        "the sweep's first three readings were the sky still travelling from noon: 0.7159, 0.5485, 0.5311, "
        "against 0.1308, 0.1157, 0.1153 for the same three places one combination later. This waits for two "
        "consecutive framings within 0.004 luma before any reading is recorded, and reports how long that "
        "took. A null here means it never settled inside 30 s and every night number below is suspect.")
    yield 2.0
    sweep = []
    RESULT["sweep"] = sweep
    for moon, sky, gain, fill in SWEEP:
        cvar("wl.Sky.MoonGain", moon)
        cvar("wl.Sky.NightSky", sky)
        cvar("wl.Look.PracticalGain", gain)
        cvar("wl.Sky.NightFill", fill)
        yield 2.5
        key = "moon%.3f_sky%.0f_prac%.1f_fill%.2f" % (moon, sky, gain, fill)
        row = {"key": key, "moon": moon, "sky": sky, "practicals": gain, "fill": fill, "places": {}}
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
    cvar("wl.Sky.NightFill", 0.26)          # the shipped floor, restored like every other knob

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
    # THE DENOMINATOR MUST INCLUDE THE FAILURES. This filtered the Nones out and then measured against what
    # was left, so on the run that exposed it FOUR OF SEVEN noon captures returned nothing, three survived
    # the filter, and the gate passed on 3 >= max(1, 3-1). It passed by excluding its own failures from the
    # count. A capture that returned nothing is not a place that was bright.
    missing = sorted(k for k, v in noon.items() if not v or v.get("luma") is None)
    noon_lumas = {k: v["luma"] for k, v in noon.items() if v and v.get("luma") is not None}
    bright_enough = [k for k, v in noon_lumas.items() if v >= 0.12]
    record("N_SANITY", "the capture can see a lit world at noon -- the reference the night ratios divide by",
           len(bright_enough) >= max(1, len(PLACES) - 1) and not missing,
           noon_luma=noon_lumas, floor=0.12, captures_returned_nothing=missing,
           measured=len(noon_lumas), of_places=len(PLACES),
           too_dark=[k for k in noon_lumas if k not in bright_enough],
           note="this now reads the same composited frame that is saved beside it as noon__<place>.jpg, "
                "so a red here is checkable by eye: open the JPEG. The previous version measured a "
                "SceneCapture actor while saving viewport JPEGs -- two cameras, and only one was ever posed")

    # ---- WHAT THE OTHER LANE IS OWED, AS A RED GATE RATHER THAN MY INTENTION.
    #
    # Core's eyes are tuned against EyeGlowDay 24, EyeGlowNight 8 and the pinned EV100 of 14.2, and they asked
    # that a change to dusk not move any of the three. My own brief says to hold world exposure constant for
    # the same reason. Both of those are intentions, and an intention is worth less than a test -- so this
    # reads all three at the END of the run and fails if any moved. wl.Look.NightShadowLift is deliberately
    # NOT in this list: it is local exposure, it lifts shadows without touching the exposure the eyes are
    # tuned against, and it is exactly 1.0 (a no-op) by day.
    held = {}
    try:
        for v in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.PostProcessVolume.static_class()):
            st = v.get_editor_property("settings")
            held["ev100_min"] = round(float(st.get_editor_property("auto_exposure_min_brightness")), 3)
            held["ev100_max"] = round(float(st.get_editor_property("auto_exposure_max_brightness")), 3)
            break
    except Exception as err:                                          # noqa: BLE001
        held["error"] = str(err)[:90]
    for cv, key in (("wl.Look.EyeGlowDay", "eye_day"), ("wl.Look.EyeGlowNight", "eye_night")):
        try:
            held[key] = round(float(unreal.SystemLibrary.get_console_variable_float_value(cv)), 3)
        except Exception:                                             # noqa: BLE001
            held[key] = None
    want = {"ev100_min": 14.2, "ev100_max": 14.2, "eye_day": 24.0, "eye_night": 8.0}
    drifted = [k for k, v in want.items()
               if held.get(k) is not None and abs(float(held[k]) - v) > 0.05]
    RESULT["held"] = held
    record("N_HOLD", "the pinned exposure and the other lane's eye levels came out of this run unchanged",
           not drifted and held.get("ev100_min") is not None,
           found=held, expected=want, drifted=drifted,
           note="a promise that a change did not move something else is worth less than a test of it. A red "
                "with ev100_min null is the reporting path rather than the world -- check found for an error")

    # ---- THE THOUSAND, CHECKED ON THE WORLD'S OWN EMISSIVE SURFACES.
    #
    # This bug class has now cost this project three separate hunts: the GLOW_SCALE 4000 -> 6 re-baseline that
    # turned all gameplay glow black, an EmissiveStrength pin that appeared not to take because the material
    # instance had no such parameter, and RestColourFor writing a figure's additive Color without the x1000 the
    # material cannot supply itself. All three are the same shape -- an emissive authored against a white of
    # 1.0 when Wonderland's rendered white is near 25,000 -- and all three were invisible from the numbers,
    # because 18 is a perfectly reasonable-looking emissive.
    #
    # The world's own lanterns are the surface in MY lane that would fail this way, so it is worth one reading
    # rather than an assumption. World materials take Emissive x EmissiveStrength, which is the safe pattern;
    # the failure mode to catch is a lamp whose product lands near 1 instead of near the scene's white.
    lamps = []
    try:
        try:
            batches = unreal.GameplayStatics.get_all_actors_of_class(
                live(), unreal.WonderlandInstancedBatch.static_class())
        except Exception:                                             # noqa: BLE001
            # No tag to fall back on: WonderlandInstancedBatch.cpp sets no ComponentTags and there is no
            # "WL_Batch" tag anywhere, which is why the first version of this gate read zero lamps and went
            # red about the world when it was reading nothing at all.
            batches = unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.Actor.static_class())
        for act in batches:
            for comp in act.get_components_by_class(unreal.InstancedStaticMeshComponent):
                nm = str(comp.get_name()).lower()
                if "lantern" not in nm and "lamp" not in nm:
                    continue
                for slot in range(comp.get_num_materials()):
                    m = comp.get_material(slot)
                    if m is None:
                        continue
                    row = {"component": str(comp.get_name())[:44], "material": str(m.get_name())[:40]}
                    for pname, key in (("Emissive", "emissive"), ("EmissiveStrength", "strength")):
                        try:
                            if key == "strength":
                                row[key] = round(float(m.get_scalar_parameter_value(pname)), 2)
                            else:
                                c = m.get_vector_parameter_value(pname)
                                row[key] = [round(c.r, 4), round(c.g, 4), round(c.b, 4)]
                        except Exception:                             # noqa: BLE001
                            row[key] = None
                    e, st = row.get("emissive"), row.get("strength")
                    if isinstance(e, list) and st:
                        row["rendered_peak"] = round(max(e) * st, 1)
                    lamps.append(row)
                    if len(lamps) >= 12:
                        raise StopIteration
    except StopIteration:
        pass
    except Exception as err:                                          # noqa: BLE001
        lamps.append({"error": str(err)[:110]})
    RESULT["lamp_materials"] = lamps
    peaks = [r["rendered_peak"] for r in lamps if r.get("rendered_peak")]
    record("N_SCALE", "the world's lit surfaces carry the scene's thousand -- an emissive judged against a "
                      "white of 1.0 is three orders of magnitude too dark",
           bool(peaks) and min(peaks) >= 100.0,
           lamp_rendered_peaks=peaks, floor=100.0, lamps_read=len(lamps),
           note="Wonderland's white is near 25,000 scene units at the pinned EV100 of 14.2. World materials "
                "take Emissive x EmissiveStrength and the strength supplies the thousand, so the product is "
                "what matters and a peak near 1 is the failure. A red here with zero lamps read is the "
                "reporting path, not the world -- check lamp_materials for the error before believing it")

    # A PLACE THAT IS DARK AT NOON IS NOT A NIGHT PROBLEM, and this separates the two reasons it can happen.
    # AND THIS ONE WENT GREEN REPORTING noon_luma: null -- no data at all, and a pass. A gate that measured
    # nothing has not found nothing; it has found out nothing.
    dark_at_noon = [k for k, v in noon.items() if v and v.get("dark", 0) > 0.85]
    noon_complete = not missing
    record("N_NOON_DARK", "no place is already dark at MIDDAY -- a night gate cannot speak for a place that "
                          "is unlit in daylight",
           not dark_at_noon and noon_complete, dark_at_noon=dark_at_noon,
           captures_returned_nothing=missing,
           nothing_to_judge=(None if noon_complete else
                             "%d of %d noon captures returned nothing; this gate is not evidence"
                             % (len(missing), len(PLACES))),
           noon_dark={k: (v or {}).get("dark") for k, v in noon.items()},
           surfaces_in_front={k: drawn.get(k) for k in dark_at_noon},
           note="architecture_noctis read 0.9691 dark at noon. An offline cone count puts 2,700 architecture "
                "instances in that view, nearest at 53 m and the bulk between 100 and 200 m, so 'nothing "
                "there' is ruled out and the cause is NOT established. surfaces_in_front is the "
                "discriminator: a trace that finds nothing means the district is not being drawn at that "
                "range, and a trace that finds it means it is drawn and dark")

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
    # A None IN THE LADDER CRASHED THIS. Any rung whose capture failed carries luma None, and
    # max(l["luma"] for l in ladder) then raises TypeError: '>' not supported between NoneType and float --
    # which is what ended zzQ1 at line 481 AFTER every measurement had been taken. The gates that had
    # already run were published; the last one and the tidy-up were not.
    lad = [l["luma"] for l in ladder if l.get("luma") is not None]
    span = (max(lad) - min(lad)) if lad else None
    record("N03", "no hour-to-hour step in the cycle exceeds a quarter of the day's range",
           worst_jump[0] is not None and span is not None and worst_jump[0] <= 0.25 * (span + 1e-6),
           worst_jump_luma=worst_jump[0], at_hour=worst_jump[1],
           day_range=[min(lad), max(lad)] if lad else None,
           rungs_measured=len(lad), rungs_total=len(ladder))
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
