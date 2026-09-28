# DOES THE PYTHON GO ALL THE WAY ROUND, AND DOES ITS BODY FOLLOW ITS HEAD?
#
# FOUNDER, P0 item 2: the python must "slither believably in 3D, moving front/behind/above/below with body
# follow-through. No simple orbit/spin."
#
# WHAT IS ALREADY SETTLED, AND WHAT IS NOT. zc_brain_sculpture answers the orbit half thoroughly -- the
# bearing rate varies (S03), the radius varies (S04), the route leaves a single plane (S05), no segment ever
# enters the brain (S06). Those together rule out a circle and a spin.
#
# They do not reach two of the founder's own words.
#
#   "FRONT/BEHIND/ABOVE/BELOW" is a claim about COVERAGE. A route can vary its bearing and its radius and
#   still never pass behind the brain, or never go under it. S05 proves the path is not flat; it does not
#   prove the path visits every side.
#
#   "BODY FOLLOW-THROUGH" is a claim about the BODY, and only the HEAD was exposed. A rigid body swung
#   around on a stick would satisfy every existing check -- the head would travel, the bearing would vary,
#   the plane would change -- while the body moved as one piece. Follow-through means each segment arrives
#   where the one ahead of it has already been, a little later, and that can only be measured segment by
#   segment.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "snake_follow")

#: 24 s at 10 Hz. The python's circuit is slow on purpose, and a shorter window can miss a whole side of the
#: brain and report it as never visited.
# LONG ENOUGH TO CHARACTERISE THE ROUTE RATHER THAN ONE DRAW OF IT.
#
# 240 x 0.1 was 24 seconds, and the route's slowest yaw driver has a period of 54.8 seconds -- so the old
# window watched under half of one cycle of the thing it was judging and then reported a coverage fraction
# as though it were a property of the animal. Simulated over forty separate 24-second looks at the published
# steering maths, "behind" ranges from 0.000 to well over a third depending only on WHEN you looked. A clause
# that answers differently on identical code is not measuring the code.
#
# AND Elapsed IS NOT WALL TIME: the sculpture clamps DeltaSeconds to 0.25 and spends it in 1/120 substeps, so
# a loaded PIE session -- which is exactly what a capture run is -- advances the animal slower than the clock
# this loop counts on. The window has to be long enough to survive that, which is why the progression control
# below exists rather than a longer timer alone.
SAMPLES, INTERVAL = 600, 0.15

#: How many frames of lag to search when matching a segment to the one ahead of it.
MAX_LAG = 10


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    yield 0.5

    ui.toggle_project_brain()
    yield 3.0
    sculpts = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandBrainSculpture)
    if not sculpts:
        record("Y00", "a living brain to watch", False, note="the panel opened but staged no sculpture")
        RESULT["status"] = "measured"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    sculpt = sculpts[0]
    segments = int(sculpt.get_snake_segment_count())
    record("Y00", "the python's body is readable segment by segment",
           segments >= 8, segments=segments,
           note="follow-through is a claim about the body; only the head was exposed before this")

    # ---- SAMPLE THE WHOLE BODY, in the brain's own frame so "above" and "behind" mean something.
    #
    # THESE ARE ALREADY RELATIVE TO THE BRAIN, despite the name. HeadWorld is assigned as
    # `HeadDir * HeadRadius` and GetHeadRadiusUU returns its Size(), so it is an offset from the brain's
    # centre, not a world position; SegmentSpot is filled the same way. The first version of this job
    # subtracted the actor's world location from both and corrupted the coverage reading -- it reported the
    # head in FRONT on all 240 samples and BEHIND on none, which is what a few hundred uu of constant shift
    # looks like. Y02 and Y03 survived it because a constant offset cancels inside distances and lags.
    head, body = [], [[] for _ in range(segments)]
    for _ in range(SAMPLES):
        h = sculpt.get_snake_head_location()
        head.append((float(h.x), float(h.y), float(h.z)))
        for i in range(segments):
            q = sculpt.get_snake_segment_location(i)
            body[i].append((float(q.x), float(q.y), float(q.z)))
        yield INTERVAL
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_slithering.jpg"), 1500, 90)

    # ---- FRONT, BEHIND, ABOVE, BELOW. Measured as a fraction of the head's own travel so a single stray
    # sample cannot claim a side: a side counts as visited only if the head spends real time there.
    # PER AXIS, NOT ONE SHARED REACH. The first version took a single reach as the larger of the horizontal
    # and vertical extents and applied it to both. A brain is wider than it is tall and the route follows
    # that shape, so a shared floor of 209 uu x 15% made the VERTICAL test far stricter than the horizontal
    # one -- it demanded the head climb 31 uu on an axis whose whole extent is a fraction of the other's,
    # and reported "above 8" as a failure. Each axis is now judged against its own reach, which is what
    # "above" and "behind" were always supposed to mean.
    reach_x = max(max(abs(p[0]) for p in head), 1.0)
    reach_z = max(max(abs(p[2]) for p in head), 1.0)
    floor_x, floor_z = reach_x * 0.15, reach_z * 0.15
    sides = {
        "front": sum(1 for p in head if p[0] > floor_x),
        "behind": sum(1 for p in head if p[0] < -floor_x),
        "above": sum(1 for p in head if p[2] > floor_z),
        "below": sum(1 for p in head if p[2] < -floor_z),
    }
    RESULT["sides"] = sides
    RESULT["head_reach_uu"] = {"x": round(reach_x, 1), "z": round(reach_z, 1)}

    # ---- THE CONTROL: DID THE ANIMAL ACTUALLY GO ANYWHERE WHILE WE WATCHED?
    #
    # Coverage is only a property of the route if the route was travelled. An animal that barely moved gives
    # the same front-heavy reading as one whose yaw never crosses to the back, and the two want opposite
    # fixes -- so without this the clause below cannot tell "the head does not go behind" from "the head was
    # in slow motion and we photographed a quarter of one breath". That distinction is not hypothetical here:
    # the sculpture's own clock is clamped per tick, so the harder the machine is working the less of the
    # route fits in this window.
    #
    # MEASURED AS ANGLE TURNED, NOT DISTANCE MOVED, because the radius springs in and out on its own and a
    # head bobbing on the spot covers distance without going anywhere. Two full turns is the floor: less than
    # that and no arrangement of the route could have shown every side, so the run is VOID rather than failed.
    turned = 0.0
    for a, b in zip(head, head[1:]):
        na = max((a[0] ** 2 + a[1] ** 2 + a[2] ** 2) ** 0.5, 1e-6)
        nb = max((b[0] ** 2 + b[1] ** 2 + b[2] ** 2) ** 0.5, 1e-6)
        dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb)
        turned += math.acos(max(-1.0, min(1.0, dot)))
    turns = turned / (2.0 * math.pi)
    RESULT["head_turns_observed"] = round(turns, 3)
    record("Y00", "the head travelled far enough around the brain for coverage to mean anything",
           turns >= 2.0, turns_observed=round(turns, 3), floor_turns=2.0,
           seconds_watched=round(SAMPLES * INTERVAL, 1),
           note="THE CONTROL. Angle turned, not distance moved: the radius springs in and out on its own, so "
                "a head bobbing on the spot covers distance without going anywhere. Below the floor the "
                "coverage reading below cannot distinguish a route that avoids the back from a route that "
                "was watched in slow motion, and those want opposite fixes.")
    if turns < 2.0:
        RESULT["status"] = ("VOID: the head turned %.2f times in %.0fs, too little for coverage to be read"
                            % (turns, SAMPLES * INTERVAL))
        return

    record("Y01", "the head goes in front, behind, above and below the brain",
           all(v >= SAMPLES * 0.04 for v in sides.values()),
           samples_on_each_side=sides, of=SAMPLES,
           counted_past_uu={"x": round(floor_x, 1), "z": round(floor_z, 1)},
           note="each axis judged against its OWN reach, so a route that is naturally wider than it is tall "
                "is not failed for it")

    # ---- FOLLOW-THROUGH. For each segment, find the lag at which it best matches the one AHEAD of it.
    # A body that follows has a positive lag; a rigid body swung on a stick matches at lag zero.
    def dist(a, b):
        return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)

    lags = []
    for i in range(1, segments):
        best_lag, best_mean = 0, None
        for lag in range(0, MAX_LAG + 1):
            pairs = [(body[i][t], body[i - 1][t - lag]) for t in range(lag, SAMPLES)]
            if len(pairs) < 20:
                continue
            mean = sum(dist(a, b) for a, b in pairs) / float(len(pairs))
            if best_mean is None or mean < best_mean:
                best_mean, best_lag = mean, lag
        lags.append(best_lag)
    lags_sorted = sorted(lags)
    median_lag = lags_sorted[len(lags_sorted) // 2] if lags_sorted else 0
    trailing = sum(1 for v in lags if v > 0)
    RESULT["follow_through"] = {"segments_compared": len(lags), "median_best_lag_frames": median_lag,
                                "segments_trailing": trailing,
                                "lag_seconds_at_median": round(median_lag * INTERVAL, 2)}
    record("Y02", "each segment arrives where the one ahead of it has already been",
           median_lag >= 1 and trailing >= max(1, int(len(lags) * 0.6)),
           median_best_lag_frames=median_lag, segments_trailing=trailing, of=len(lags),
           note="the lag at which a segment best matches the one ahead. A rigid body swung on a stick "
                "matches at lag 0 and would pass every existing check")

    # ---- AND THE BODY IS NOT A RING, which is the other way a 'follower' can cheat: every segment sitting
    # at a fixed offset on a circle also trails, without ever following the head anywhere new.
    head_travel = sum(dist(head[t], head[t - 1]) for t in range(1, SAMPLES))
    tail_travel = sum(dist(body[-1][t], body[-1][t - 1]) for t in range(1, SAMPLES))
    RESULT["travel"] = {"head_uu": round(head_travel, 1), "tail_uu": round(tail_travel, 1),
                        "ratio": round(tail_travel / max(head_travel, 1e-6), 3)}
    record("Y03", "the tail travels its own distance rather than being dragged rigidly",
           0.2 <= (tail_travel / max(head_travel, 1e-6)) <= 1.6,
           head_uu=round(head_travel, 1), tail_uu=round(tail_travel, 1),
           note="a rigid ring's tail travels exactly as far as its head; a real body's does not")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
