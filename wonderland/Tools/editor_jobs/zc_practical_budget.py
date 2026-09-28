# THE POOL IS PROBABLY LIMITED BY RADIUS, NOT BY COUNT -- AND THIS READS BOTH BACK INSTEAD OF ASSUMING.
#
# zzU5 swept wl.Look.PracticalCount at 48 / 96 / 144 / 192 at the densest spot in the world and the pool
# rebuilt correctly to each size -- 48, 96, 144, 192 spawned actors, counted. The number actually LIT was
# 31, 30, 30, 32. Flat. Four times the budget bought nothing.
#
# WHY, almost certainly: Assign() builds its candidate list by DISTANCE FIRST --
#
#     if (D2 > Radius2) { continue; }        then rank the survivors, then Lit = Min(Near, Pool)
#
# -- so wl.Look.PracticalRadius decides how many lights are even eligible, and the count only decides how
# many of THOSE get lit. If Near is about 31, no value of the count can light a 32nd lamp.
#
# AND THE ARITHMETIC FITTED BEAUTIFULLY AND WAS WRONG, WHICH IS WHY THE READBACK EXISTS. Counting the
# manifest by distance from that spot gives 30 candidates at radius 4,211, 184 at 12,000 and 286 at
# 24,000 -- so "the running radius is about 4,200 rather than the declared 12,000" explained the 31
# exactly, and I nearly reported it. B_READBACK then measured it: count 48, RADIUS 12000.0, gain 1.0.
# Precisely the source defaults. The inference was false and the only reason it never became a finding is
# that a cvar's value is something to READ, not to derive from a downstream count.
#
# So the 31 remains unexplained by the radius, and the real defect turned out to be in the instrument:
# zzW2's radius-24000 rung settled on three identical reads of 127 and then reported 192 once asked again
# after an unrelated wait. The assignment PAUSES on its way up. Every flat lit-count in this job's history
# is suspect for that reason, including the 31s, and B_SETTLED now reads the count either side of an
# independent wait rather than trusting consecutive samples.
#
# THE SWEEP IS TWO LADDERS SO THE TWO KNOBS CANNOT BE CONFUSED:
#   rungs 1-3 hold the radius and raise the count   -- if lit stays flat, count is not the constraint
#   rungs 3-6 hold the count high and raise radius  -- if lit tracks radius, that is the lever
#
# AND THE FIRST RUNG NOW WARMS UP. zzU5 voided honestly on B_NOISE at 0.4113 because its first rung read
# 0.4932 while rungs two to four agreed at 0.2370 / 0.2334 / 0.2346. The settle fell through its 24 reads
# without ever finding three in agreement -- the world was still arriving after BeginPlay plus a 192-light
# rebuild -- and, correctly, trimmed nothing and let the gate void the run. A warm-up before the ladder
# starts costs seconds and stops spending a whole run on it.
#
# Cost comes from the RAW accessor deduplicated by engine frame number, with stat unit issued and
# re-issued, because a budget question is a question about the TAIL. zzU5's first pass reported every cost
# cell as None: I went hunting a raw tail without turning the counter on. With it on, the same rungs showed
# 205.87 ms and 168.38 ms worst frames against medians near 23 -- spikes the filtered field cannot show.
#
# Saves nothing. Restores count, radius and gain to what it FOUND them at, not to what the source defaults
# say, and reloads behind the restore.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "practical_budget")

#: The densest neighbourhood in the manifest -- 184 lights within 12,000 uu. Chosen by counting, not by eye.
SPOT = (-65943.0, -38753.0)
#: (count, radius). First three raise the count at a fixed radius; last three raise the radius at a fixed
#: count. 256 is the compiled ceiling on the pool, so 192 leaves headroom rather than testing a wall.
RUNGS = ((48, None), (96, None), (192, None),
         (192, 12000.0), (192, 24000.0), (192, 36000.0))
#: Deep night, on the flat part zzT3 measured (0.0053 drift across four and a half hours).
HOUR = 23.0
SPAN = 21.0
AGREE = 0.010
COST_SECONDS = 6.0
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def patch(cx, cy, hw, hh):
    got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
    if got is None:
        return None
    mean, dark, bright, sampled = got
    return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
            "dark": round(dark, 4),
            "tails": round(min(1.0, dark + bright), 4)}


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

    def live():
        return ues.get_game_world()

    def cvar(name, value):
        unreal.SystemLibrary.execute_console_command(live(), "%s %s" % (name, value))

    def command(text):
        unreal.SystemLibrary.execute_console_command(live(), text)

    def read_f(name):
        try:
            return round(float(unreal.SystemLibrary.get_console_variable_float_value(name)), 2)
        except Exception:                                  # noqa: BLE001
            return None

    def read_i(name):
        try:
            return int(unreal.SystemLibrary.get_console_variable_int_value(name))
        except Exception:                                  # noqa: BLE001
            v = read_f(name)
            return int(v) if v is not None else None

    def knobs():
        return {"count": read_i("wl.Look.PracticalCount"),
                "radius": read_f("wl.Look.PracticalRadius"),
                "gain": read_f("wl.Look.PracticalGain")}

    # ---- WHAT THE ENGINE IS ACTUALLY HOLDING, before anything is changed. zzU5 assumed the source
    # defaults and its whole reading of the result depended on a radius nobody had read.
    found = knobs()
    RESULT["knobs_as_found"] = found
    RESULT["source_defaults"] = {"count": 48, "radius": 12000.0, "gain": 1.0}

    world = live()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    ground_z = None
    try:
        hit = unreal.SystemLibrary.line_trace_single(
            world, unreal.Vector(SPOT[0], SPOT[1], 20000.0), unreal.Vector(SPOT[0], SPOT[1], -5000.0),
            PAWN_CH, False, [p for p in (pawn,) if p is not None], unreal.DrawDebugTrace.NONE, True,
            unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        if hit is not None:
            ground_z = float(hit.to_tuple()[4].z)
    except Exception as bad:                               # noqa: BLE001
        RESULT["ground_trace_error"] = str(bad)[:200]
    RESULT["ground_trace_z"] = ground_z
    pawn.set_actor_location(
        unreal.Vector(SPOT[0], SPOT[1], (ground_z + 120.0) if ground_z is not None else 200.0), False, True)
    yield 2.0

    # Re-fetched: a teleport can respawn the pawn, and the old reference then reads (0, 0, 0).
    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    if pawn is None:
        RESULT["status"] = "voided: there is no player pawn after the teleport"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    where = pawn.get_actor_location()
    off = round(((where.x - SPOT[0]) ** 2 + (where.y - SPOT[1]) ** 2) ** 0.5, 1)
    RESULT["pawn_landed"] = [round(where.x, 1), round(where.y, 1), round(where.z, 1)]
    record("B_WHERE", "the pawn is standing at the densest spot, which is what selects the pool",
           off <= 500.0, asked=list(SPOT), landed=RESULT["pawn_landed"], horizontal_offset_uu=off,
           ground_trace_z=ground_z,
           note="Assign() takes its Eye from the PAWN. If it did not arrive, the pool was chosen elsewhere")
    if off > 500.0:
        RESULT["status"] = "voided: the pawn did not reach the measurement spot"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.TwilightSpan", "%.1f" % SPAN)
    cvar("wl.Sky.Hour", "%.2f" % HOUR)
    eye = unreal.Vector(where.x, where.y, where.z + 60.0)
    at = unreal.Vector(where.x + 3000.0, where.y + 1200.0, where.z + 40.0)
    L.pose_camera(world, eye, at, 70.0)
    command("stat unit")
    RESULT["camera_eye"] = [round(eye.x, 1), round(eye.y, 1), round(eye.z, 1)]
    RESULT["camera_at"] = [round(at.x, 1), round(at.y, 1), round(at.z, 1)]

    def settled(limit=24):
        window = []
        for _ in range(limit):
            yield 1.0
            now = patch(0.5, 0.5, 0.46, 0.44)
            if now is None:
                continue
            window.append(now["luma"])
            if len(window) > 3:
                window.pop(0)
            if len(window) == 3 and (max(window) - min(window)) < 0.004:
                return

    # ---- WAIT FOR THE WORLD, THEN WARM UP. zzU5 spent its whole first rung arriving.
    #
    # The pawn has just crossed most of the map to a district the editor had not loaded, and this map is
    # partitioned, so cells keep arriving for seconds after the pawn is standing there. A luma settle
    # cannot see that: a half-streamed district holds perfectly still. FlushLevelStreaming blocks until
    # the load queue is empty; the settle after it is then measuring a world that is all present.
    unreal.SystemLibrary.execute_console_command(live(), "FlushLevelStreaming")
    yield 3.0
    for step in settled(60):
        yield step
    RESULT["warmed"] = True

    def pool_now():
        try:
            lights = unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.PointLight)
        except Exception:                                  # noqa: BLE001
            return None, None
        total, lit = 0, 0
        for a in lights:
            if a is None:
                continue
            try:
                name = str(a.get_actor_label())
            except Exception:                              # noqa: BLE001
                name = ""
            if name and not name.startswith("WL_Practical"):
                continue
            total += 1
            try:
                comp = a.point_light_component
                if comp is not None and comp.is_visible():
                    lit += 1
            except Exception:                              # noqa: BLE001
                pass
        return total, lit

    def raw_frame_ms():
        try:
            now = int(H.get_engine_frame_number())
        except Exception:                                  # noqa: BLE001
            now = None
        if now is not None and now == globals().get("_LAST_FRAME"):
            return None
        try:
            raw = H.get_raw_frame_cost_ms()
        except Exception:                                  # noqa: BLE001
            return None
        if raw is None or float(raw[0]) <= 0.01:
            return None
        globals()["_LAST_FRAME"] = now
        return float(raw[0])

    rows = []
    RESULT["budget"] = rows
    for count, radius in RUNGS:
        cvar("wl.Look.PracticalCount", "%d" % count)
        if radius is not None:
            cvar("wl.Look.PracticalRadius", "%.0f" % radius)
        command("wl.Look.PracticalReload")                 # the pool does not resize without this
        yield 2.0
        # wait for the assignment to stop moving, not just the picture
        seen = []
        for _ in range(40):
            yield 0.5
            _t, _l = pool_now()
            seen.append(_l)
            if len(seen) > 3:
                seen.pop(0)
            if len(seen) == 3 and len(set(seen)) == 1 and seen[0] is not None:
                break
        command("stat unit")
        for step in settled():
            yield step
        held = knobs()
        # ---- READ THE LIT COUNT EITHER SIDE OF AN INDEPENDENT WAIT, BECAUSE A PLATEAU IS NOT ARRIVAL.
        #
        # zzW2's radius-24000 rung settled on [127, 127, 127] -- three identical reads half a second
        # apart -- and then reported 192 when asked again after the luma settle. The assignment had
        # PAUSED at 127 on its way up, and three equal samples of something still moving is the
        # step-settle mistake in a third costume. Comparing before and after an independent wait catches
        # a plateau in a way that no number of consecutive reads can.
        lit_before = pool_now()[1]
        yield 2.0
        total, lit = pool_now()
        lit_stable = (lit_before == lit)
        a = patch(0.5, 0.5, 0.46, 0.44)
        g1 = patch(0.5, 0.78, 0.30, 0.16)
        frames = []
        spent = 0.0
        while spent < COST_SECONDS:
            v = raw_frame_ms()
            if v is not None:
                frames.append(v)
            yield 0.0
            spent += 0.01
        yield 1.0
        b = patch(0.5, 0.5, 0.46, 0.44)
        g2 = patch(0.5, 0.78, 0.30, 0.16)
        try:
            H.capture_viewport_jpeg(
                os.path.join(ROOT, "c%03d_r%05.0f.jpg" % (count, held.get("radius") or 0)), 1200, 85)
        except Exception:                                  # noqa: BLE001
            pass
        if a is None or b is None:
            rows.append({"count": count, "radius_asked": radius, "unmeasured": True})
            continue
        frames.sort()
        rows.append({
            "count_asked": count, "radius_asked": radius, "held": held,
            "pool_actors": total, "lit_actors": lit, "lit_settled_on": list(seen),
            "lit_before_wait": lit_before, "lit_stable": lit_stable,
            "luma": round((a["luma"] + b["luma"]) / 2.0, 4),
            "spread": round(abs(a["luma"] - b["luma"]), 4),
            "tails": round((a["tails"] + b["tails"]) / 2.0, 4),
            "ground_luma": round(((g1 or {}).get("luma", 0.0) + (g2 or {}).get("luma", 0.0)) / 2.0, 4)
            if g1 and g2 else None,
            "ground_dark": round(((g1 or {}).get("dark", 1.0) + (g2 or {}).get("dark", 1.0)) / 2.0, 4)
            if g1 and g2 else None,
            "raw_frames": len(frames),
            "raw_median_ms": round(frames[len(frames) // 2], 2) if frames else None,
            "raw_p95_ms": round(frames[min(len(frames) - 1, int(len(frames) * 0.95))], 2) if frames else None,
            "raw_worst_ms": round(frames[-1], 2) if frames else None})

    # ---- RESTORE WHAT WAS FOUND, not what the source defaults say.
    if found.get("count") is not None:
        cvar("wl.Look.PracticalCount", "%d" % found["count"])
    if found.get("radius") is not None:
        cvar("wl.Look.PracticalRadius", "%.0f" % found["radius"])
    command("wl.Look.PracticalReload")
    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    good = [r for r in rows if not r.get("unmeasured")]

    # ---- DID THE ENGINE TAKE WHAT IT WAS GIVEN? Everything below reads these two numbers.
    mismatch = []
    for r in good:
        h = r.get("held") or {}
        if h.get("count") != r["count_asked"]:
            mismatch.append({"rung": r["count_asked"], "asked_count": r["count_asked"], "held": h})
        elif r["radius_asked"] is not None and h.get("radius") is not None \
                and abs(h["radius"] - r["radius_asked"]) > 1.0:
            mismatch.append({"rung": r["count_asked"], "asked_radius": r["radius_asked"], "held": h})
    record("B_READBACK", "the engine is holding the count and radius this job asked for, read back per rung",
           len(mismatch) == 0 and len(good) == len(RUNGS),
           knobs_as_found=found, source_defaults=RESULT["source_defaults"],
           held_per_rung=[r.get("held") for r in good], mismatches=mismatch,
           note="zzU5 assumed the radius was the source default of 12000 and read 31 lights lit where 184 "
                "are in range. That inference may well be right and it is still an inference: a cvar's "
                "value is something to read, not to derive from a downstream count")
    if mismatch or len(good) != len(RUNGS):
        RESULT["status"] = "voided: the engine is not holding what was asked for"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    worst_spread = max((r["spread"] for r in good), default=None)
    record("B_NOISE", "each rung agrees with itself -- two reads of the same setting",
           worst_spread is not None and worst_spread <= AGREE,
           worst_spread=worst_spread, tolerance=AGREE,
           note="zzU5 failed this at 0.4113 on its first rung alone, while rungs two to four agreed to "
                "0.0036. A warm-up now runs before the ladder starts")
    if (worst_spread or 1.0) > AGREE:
        RESULT["status"] = "voided: the rungs do not agree with themselves"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    unstable = [{"count": r["count_asked"], "radius": r["radius_asked"],
                 "before": r.get("lit_before_wait"), "after": r.get("lit_actors")}
                for r in good if not r.get("lit_stable")]
    record("B_SETTLED", "the lit count is the same either side of an independent wait, so it had arrived",
           len(unstable) == 0, unstable_rungs=unstable,
           note="zzW2 settled on three identical reads of 127 and then reported 192. Three equal samples "
                "of something still moving is a plateau, not arrival, and no number of consecutive reads "
                "distinguishes them -- only a second look after an unrelated wait does")

    built = {r["count_asked"]: r["pool_actors"] for r in good}
    record("B_POOL", "the pool was actually rebuilt to each size asked for, counted from spawned actors",
           all(abs((r["pool_actors"] or -1) - r["count_asked"]) <= 2 for r in good),
           asked=[r["count_asked"] for r in good], counted=[r["pool_actors"] for r in good],
           note="BuildPool runs only from Reload and OnWorldBeginPlay, never from Tick")

    # ---- WHICH KNOB IS THE CONSTRAINT? The whole point of the job.
    count_leg = [r for r in good if r["radius_asked"] is None]
    radius_leg = [r for r in good if r["radius_asked"] is not None]
    lit_by_count = {r["count_asked"]: r["lit_actors"] for r in count_leg}
    lit_by_radius = {("%.0f" % r["radius_asked"]): r["lit_actors"] for r in radius_leg}
    count_moved = (max(lit_by_count.values()) - min(lit_by_count.values())) if lit_by_count else None
    radius_moved = (max(lit_by_radius.values()) - min(lit_by_radius.values())) if lit_by_radius else None
    record("B_CONSTRAINT", "raising the RADIUS lights more lamps and raising the COUNT alone does not",
           radius_moved is not None and count_moved is not None
           and radius_moved > 4 and count_moved <= 4,
           lit_by_count_at_fixed_radius=lit_by_count, lit_by_radius_at_count_192=lit_by_radius,
           count_leg_spread=count_moved, radius_leg_spread=radius_moved,
           note="Assign() filters by distance BEFORE it ranks, so the radius decides how many lamps are "
                "eligible at all and the count only decides how many of those are lit. Green means the "
                "budget conversation has been about the wrong knob")

    record("B_LIGHT", "more lit lamps actually make the district brighter",
           len(good) > 1 and (good[-1]["luma"] - good[0]["luma"]) > AGREE,
           luma_by_rung={("c%d_r%s" % (r["count_asked"], r["radius_asked"])): r["luma"] for r in good},
           ground_dark_by_rung={("c%d_r%s" % (r["count_asked"], r["radius_asked"])): r["ground_dark"]
                                for r in good},
           note="lighting more lamps is not the same as lighting the district, and the crushed ground "
                "fraction is the reading that answers the founder rather than the mean")

    record("B_COST", "the frame cost is reported from the RAW accessor, per frame, with the tail intact",
           all(r["raw_median_ms"] is not None and r["raw_frames"] >= 30 for r in good),
           by_rung={("c%d_r%s" % (r["count_asked"], r["radius_asked"])):
                    {"median": r["raw_median_ms"], "p95": r["raw_p95_ms"], "worst": r["raw_worst_ms"],
                     "frames": r["raw_frames"]} for r in good},
           note="INFORMATIONAL: publishes the curve rather than judging it, because affordable is a "
                "founder call. Red here means the frames could not be read at all")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
