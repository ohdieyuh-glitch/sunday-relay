# DOES THE PRACTICAL POOL ACTUALLY CLIP? Asked of the engine's own ActiveCount, not inferred from actors.
#
# THE QUESTION IS NARROWER THAN THE ONE BOTH LANES HAVE BEEN ANSWERING. "184 lights compete for 48, so
# 136 are dark" is two claims welded together. The POPULATION claim is measured and true: 184 manifest
# lights lie within 12,000 uu of the densest Noctis spot, median neighbourhood 110, and 1,078 of 1,464
# sit in a neighbourhood larger than the budget. The CLIPPING claim -- that the cap is what leaves them
# dark -- has never been measured, and the instrument that seemed to show it was broken.
#
# The pool clips here if and only if BOTH hold at convergence:
#     ActiveCount == Pool.Num()          the cap is the binding limit, not the candidate population
#     candidates in radius > Pool.Num()  there were more lamps it could have lit
# Neither alone says anything. ActiveCount below the pool means the RADIUS ran out of candidates first.
#
# WHY THIS JOB EXISTS RATHER THAN A THIRD ATTEMPT AT THE OLD ONE:
#
#   ActiveCount IS AUTHORITATIVE AND WAS UNREACHABLE, AND NOT FOR THE REASON I FIRST GAVE.
#   DescribePracticals() has always published "defined=N active=K pool=M night=... count=... radius=...".
#   I diagnosed the cause as the subsystem being UCLASS() without BlueprintType, said so with enough
#   confidence that another lane relayed it onward as a settled fix, added the specifier at d9317674 --
#   and the read still failed. Enumerating the binding rather than guessing at it (zc_subsystem_probe)
#   gave the real answer: UE 5.8's Python has NO world-subsystem getter of any kind. Only
#   get_editor_subsystem and get_engine_subsystem exist, World has no get_subsystem, and
#   SubsystemBlueprintLibrary is not in the binding. Visibility was never what was missing.
#
#   The route that works is a BlueprintFunctionLibrary static, which this tree already used elsewhere and
#   documented in a comment before I went looking for a fourth API name. H.describe_practical_lights
#   landed at 71114aab.
#
#   What the missing instrument cost: every earlier run COUNTED SPAWNED ACTORS and inferred, which
#   produced "31 lit of a pool of 48" and from there "the radius must really be about 4,200" -- fitting
#   the data beautifully and false, since the readback says 12,000. This job reads the engine's own
#   answer and keeps the actor count only as a cross-check, reporting BOTH when they disagree.
#
#   AND A PLATEAU IS NOT CONVERGENCE. The previous run settled on three identical reads of 127 active
#   lights half a second apart and then reported 192 when asked again after an unrelated wait: the
#   assignment PAUSES on its way up. Consecutive reads cannot distinguish that, because consecutive reads
#   share the same moment. Convergence here means five equal reads a second apart AND still equal after a
#   further three-second wait that does nothing else.
#
# Saves nothing. Restores count and radius to what it FOUND. Changes no lighting the founder has approved:
# every rung ends with the found values restored and a reload behind them.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "practical_active")
MANIFEST = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "WorldDesign", "Look",
                        "practical_lights.json")

#: The densest neighbourhood in the manifest. If the cap binds anywhere it binds here.
SPOT = (-65943.0, -38753.0)
#: (count, radius or None to leave as found). Two legs so the knobs cannot be confused.
RUNGS = ((48, None), (96, None), (192, None), (192, 6000.0), (192, 24000.0))
HOUR = 23.00
AGREE = 0.010
CAM_UP, CAM_AHEAD, CAM_DROP, CAM_FOV = 900.0, (1400.0, -1400.0), -100.0, 70.0
GROUND_RECT = (0.5, 0.78, 0.30, 0.16)
FRAME_RECT = (0.5, 0.5, 0.46, 0.44)
PAWN_CH = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def patch(rect):
    cx, cy, hw, hh = rect
    got = L.read_screen_rect(cx - hw, cy - hh, cx + hw, cy + hh)
    if got is None:
        return None
    mean, dark, bright, sampled = got
    d, b = float(dark), float(bright)
    return {"luma": round(0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b, 4),
            "crushed": round(d, 4), "readable": round(max(0.0, 1.0 - d - b), 4)}


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
            return round(float(unreal.SystemLibrary.get_console_variable_float_value(name)), 3)
        except Exception:                                              # noqa: BLE001
            return None

    def describe():
        """The engine's own account: defined / active / pool / night / gain / count / radius."""
        # THROUGH THE TEST LIBRARY, because UE 5.8's Python has no world-subsystem getter of any kind:
        # only get_editor_subsystem and get_engine_subsystem exist, World has no get_subsystem, and
        # SubsystemBlueprintLibrary is not in the binding. Enumerated by zc_subsystem_probe after four
        # attempts at guessing the name. A BlueprintFunctionLibrary static IS reachable.
        try:
            line = str(H.describe_practical_lights(live()))
            if not line:
                return None
            out = {}
            for tok in line.split():
                if "=" in tok:
                    k, v = tok.split("=", 1)
                    try:
                        out[k] = float(v)
                    except ValueError:
                        out[k] = v
            return out or None
        except Exception:                                              # noqa: BLE001
            return None

    def actors_lit():
        """Cross-check only. The number this job REPORTS is the engine's active count."""
        try:
            lights = unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.PointLight)
        except Exception:                                              # noqa: BLE001
            return None, None
        total, lit = 0, 0
        for a in lights:
            if a is None:
                continue
            try:
                if not str(a.get_actor_label()).startswith("WL_Practical"):
                    continue
            except Exception:                                          # noqa: BLE001
                continue
            total += 1
            try:
                c = a.point_light_component
                if c is not None and c.is_visible():
                    lit += 1
            except Exception:                                          # noqa: BLE001
                pass
        return total, lit

    # ---- IS THE AUTHORITATIVE READ AVAILABLE AT ALL? Everything below is built on it.
    probe = describe()
    record("P_READ", "the engine's own practical report is readable, so active count is not inferred",
           probe is not None and "active" in probe and "pool" in probe,
           describe_practicals=probe,
           note="reads H.describe_practical_lights, added at 71114aab, because UE 5.8 Python has no "
                "world-subsystem getter at all -- enumerated, after BlueprintType was diagnosed as the "
                "cause and was not. Red here means the build predates that accessor, and the run voids "
                "rather than falling back to counting actors and inferring a radius again")
    if not (probe and "active" in probe and "pool" in probe):
        RESULT["status"] = "voided: the authoritative active count is not readable in this build"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    found = {"count": read_f("wl.Look.PracticalCount"), "radius": read_f("wl.Look.PracticalRadius"),
             "gain": read_f("wl.Look.PracticalGain")}
    RESULT["knobs_as_found"] = found
    RESULT["defined_in_manifest"] = probe.get("defined")

    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    gz = None
    try:
        hit = unreal.SystemLibrary.line_trace_single(
            live(), unreal.Vector(SPOT[0], SPOT[1], 20000.0), unreal.Vector(SPOT[0], SPOT[1], -5000.0),
            PAWN_CH, False, [p for p in (pawn,) if p is not None], unreal.DrawDebugTrace.NONE, True,
            unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
        if hit is not None:
            gz = float(hit.to_tuple()[4].z)
    except Exception:                                                  # noqa: BLE001
        gz = None
    if pawn is not None:
        pawn.set_actor_location(
            unreal.Vector(SPOT[0], SPOT[1], (gz + 120.0) if gz is not None else 200.0), False, True)
    yield 2.0
    command("FlushLevelStreaming")
    yield 3.0
    pawn = unreal.GameplayStatics.get_player_pawn(live(), 0)
    if pawn is None:
        RESULT["status"] = "voided: no pawn after the teleport"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    where = pawn.get_actor_location()
    off = round(math.hypot(where.x - SPOT[0], where.y - SPOT[1]), 1)
    RESULT["pawn_landed"] = [round(where.x, 1), round(where.y, 1), round(where.z, 1)]
    record("P_WHERE", "the pawn is at the densest spot, which is what selects the candidate set",
           off <= 500.0, asked=list(SPOT), landed=RESULT["pawn_landed"], offset_uu=off,
           note="Assign() takes its Eye from the PAWN. Measured anywhere else this is a different question")
    if off > 500.0:
        RESULT["status"] = "voided: the pawn did not reach the measurement spot"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    L.focus_game_viewport()
    cvar("wl.Sky.DayMinutes", 0)
    cvar("wl.Sky.Hour", "%.2f" % HOUR)
    L.pose_camera(live(), unreal.Vector(where.x, where.y, where.z + CAM_UP),
                  unreal.Vector(where.x + CAM_AHEAD[0], where.y + CAM_AHEAD[1], where.z + CAM_DROP),
                  CAM_FOV)
    yield 3.0

    # ---- HOW MANY MANIFEST LIGHTS ARE ACTUALLY IN RANGE, computed from the file against the radius the
    # engine reports, not against the declared default.
    def candidates_within(radius):
        try:
            rows = json.loads(open(MANIFEST, encoding="utf-8").read())["lights"]
        except Exception:                                              # noqa: BLE001
            return None
        r2 = radius * radius
        n = 0
        for r in rows:
            dx, dy = float(r["x"]) - where.x, float(r["y"]) - where.y
            if dx * dx + dy * dy <= r2:
                n += 1
        return n

    def converged(limit=40):
        """Five equal reads a second apart, THEN still equal after a further wait doing nothing else.

        A plateau satisfies any number of consecutive reads, because consecutive reads share the same
        moment: the previous run held 127 for three reads and then went to 192. The trailing wait is the
        only part of this that can tell a pause from an arrival.
        """
        run, prev = 0, None
        for _ in range(limit):
            yield 1.0
            d = describe()
            now = None if d is None else int(d.get("active", -1))
            if now is None or now < 0:
                run, prev = 0, None
                continue
            run = run + 1 if now == prev else 1
            prev = now
            if run >= 5:
                break
        globals()["_SETTLED_AT"] = prev

    rows = []
    RESULT["rungs"] = rows
    for count, radius in RUNGS:
        cvar("wl.Look.PracticalCount", "%d" % count)
        if radius is not None:
            cvar("wl.Look.PracticalRadius", "%.0f" % radius)
        command("wl.Look.PracticalReload")
        yield 2.0
        for step in converged():
            yield step
        first = globals().get("_SETTLED_AT")
        yield 3.0                                                      # an independent wait, doing nothing
        d2 = describe()
        second = None if d2 is None else int(d2.get("active", -1))
        stable = (first is not None and second is not None and first == second)
        a_total, a_lit = actors_lit()
        f1, g1 = patch(FRAME_RECT), patch(GROUND_RECT)
        yield 1.0
        f2, g2 = patch(FRAME_RECT), patch(GROUND_RECT)
        try:
            H.capture_viewport_jpeg(os.path.join(ROOT, "c%03d_r%05.0f.jpg"
                                                 % (count, (d2 or {}).get("radius", 0))), 1200, 85)
        except Exception:                                              # noqa: BLE001
            pass
        in_range = candidates_within(float((d2 or {}).get("radius", found["radius"] or 12000.0)))
        rows.append({
            "count_asked": count, "radius_asked": radius,
            "held": {"count": (d2 or {}).get("count"), "radius": (d2 or {}).get("radius"),
                     "gain": (d2 or {}).get("gain")},
            "active_first": first, "active_after_wait": second, "converged": stable,
            "pool": (d2 or {}).get("pool"), "defined": (d2 or {}).get("defined"),
            "actors_total": a_total, "actors_lit": a_lit,
            "manifest_in_radius": in_range,
            "luma": round(((f1 or {}).get("luma", 0.0) + (f2 or {}).get("luma", 0.0)) / 2.0, 4)
            if f1 and f2 else None,
            "spread": round(abs((f1 or {}).get("luma", 0.0) - (f2 or {}).get("luma", 0.0)), 4)
            if f1 and f2 else None,
            "ground_readable": round(((g1 or {}).get("readable", 0.0)
                                      + (g2 or {}).get("readable", 0.0)) / 2.0, 4) if g1 and g2 else None,
            "ground_crushed": round(((g1 or {}).get("crushed", 0.0)
                                     + (g2 or {}).get("crushed", 0.0)) / 2.0, 4) if g1 and g2 else None})

    cvar("wl.Look.PracticalCount", "%d" % int(found["count"] or 48))
    cvar("wl.Look.PracticalRadius", "%.0f" % (found["radius"] or 12000.0))
    command("wl.Look.PracticalReload")
    cvar("wl.Sky.Hour", 12)
    L.release_camera(live())

    good = [r for r in rows if r.get("active_after_wait") is not None]
    record("P_RUNGS", "every rung produced an authoritative active count",
           len(good) == len(RUNGS), measured=len(good), wanted=len(RUNGS))
    if len(good) != len(RUNGS):
        RESULT["status"] = "voided: a rung produced no active count"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    moving = [{"count": r["count_asked"], "radius": r["radius_asked"],
               "before": r["active_first"], "after": r["active_after_wait"]}
              for r in good if not r["converged"]]
    record("P_CONVERGED", "the active count is unchanged across an independent wait at every rung",
           len(moving) == 0, still_moving=moving,
           actives={("c%d_r%s" % (r["count_asked"], r["radius_asked"])): r["active_after_wait"]
                    for r in good},
           note="five equal reads is a plateau test and a plateau passes it: the previous run held 127 "
                "three times and then reported 192. Only a wait that does nothing else separates a pause "
                "from an arrival, and a rung that has not arrived cannot be compared with a budget")
    if moving:
        RESULT["status"] = "voided: the assignment had not converged"
        yield 2.0
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    disagree = [{"count": r["count_asked"], "engine_active": r["active_after_wait"],
                 "actors_visible": r["actors_lit"]}
                for r in good if r["actors_lit"] is not None
                and abs((r["actors_lit"] or 0) - (r["active_after_wait"] or 0)) > 2]
    record("P_AGREE", "counting the actors agrees with the engine's own active count",
           len(disagree) == 0, disagreements=disagree,
           note="INFORMATIONAL about the OLD instrument. Red means actor counting was never a reliable "
                "stand-in for ActiveCount, which would explain the 31s that started the radius theory. "
                "The numbers reported by this job are the engine's either way")

    # ---- THE QUESTION. Clipping needs BOTH halves and neither alone says anything.
    verdict = []
    for r in good:
        pool = int(r["pool"] or 0)
        active = int(r["active_after_wait"] or 0)
        inr = r["manifest_in_radius"]
        verdict.append({
            "count_asked": r["count_asked"], "radius_held": (r["held"] or {}).get("radius"),
            "pool": pool, "active": active, "in_radius": inr,
            "cap_is_binding": active >= pool > 0,
            "more_were_available": (inr is not None and inr > pool),
            "clips": bool(active >= pool > 0 and inr is not None and inr > pool)})
    RESULT["clipping"] = verdict
    clipped = [v for v in verdict if v["clips"]]
    record("P_CLIPS", "the pool clips at the shipped budget -- the cap, not the radius, is what limits it",
           any(v["clips"] for v in verdict if v["count_asked"] == 48),
           per_rung=verdict, clipping_rungs=[v["count_asked"] for v in clipped],
           note="clips means active == pool AND more manifest lights lie inside the radius the engine "
                "reports. Active BELOW pool means the radius ran out of candidates first and the budget "
                "is not the constraint. This gate is the claim itself: green proves clipping at 48, red "
                "disproves it, and either way it is measured rather than argued")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
