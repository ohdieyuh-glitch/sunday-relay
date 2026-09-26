# DO PROJECT AVATARS ACTUALLY SCALE INSIDE ONE SERVER AVATAR?
#
# FOUNDER, P0 item 5, the clause the tier test never reached: "Project Avatars must scale inside one Server
# Avatar."
#
# WHAT WAS ALREADY KNOWN AND WHAT WAS ASSUMED. zc_avatar_cost measures 0, 1, 5 and 10, and finds the peak at
# ONE and the cost falling to ten -- the first avatar pays for instancing the rest reuse. From that I have
# been saying the tenth avatar's cost is "bounded". That is a claim about a curve read from four points, the
# last of which is ten, and "bounded" is exactly the kind of word that sounds measured while resting on an
# extrapolation. If the cost turns back up at twenty, everything said about scaling is wrong.
#
# So this walks the count up past where anyone has looked: 10, 20, 30, 40. If the per-avatar cost keeps
# falling, or even holds flat, the crowd tier is real. If it turns up, the founder needs to know the ceiling
# before beta rather than after.
#
# THE STRUCTURE IS THE POINT, not a single number: every avatar is spawned inside ONE Server Avatar's world
# and counted against the same baseline, which is the arrangement the founder asked about.
CONCURRENT = True

import os
import time
import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary

AVATARS = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "ProjectAvatars")

#: Counts to stand up, cumulatively. Past 10 is the part nothing has measured.
TIERS = (10, 20, 30, 40)

#: Seconds of frames per tier. Long enough that one hitch cannot decide a tier.
SETTLE_S = 6.0
SAMPLE_S = 10.0


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

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
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    world = ues.get_game_world()
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(world, "stat unit")
    yield 10.0

    def measure(label):
        """Median frame over SAMPLE_S. The MEDIAN, because a hitch belongs to zc_avatar_hitch and a single
        stall must not decide what a tier costs."""
        seen = []
        started = time.time()
        while time.time() - started < SAMPLE_S:
            try:
                v = float(H.get_frame_cost_ms()[0])
                if v > 0.01:
                    seen.append(v)
            except Exception:
                pass
            if len(seen) % 20 == 0:
                unreal.SystemLibrary.execute_console_command(world, "stat unit")
            yield 0.0
        seen.sort()
        out = {"samples": len(seen),
               "median_ms": round(seen[len(seen) // 2], 2) if seen else 0.0,
               "worst_ms": round(seen[-1], 2) if seen else 0.0}
        RESULT[label] = out
        emit(label, "INFO", label, out)
        return out

    base = yield from measure("baseline")

    # THE CROWD TIER, NOT A MIXTURE. The first run of this job cycled every file in sorted order, so it stood
    # up Large, Medium and Small in rotation and averaged ~19,000 boxes an avatar. That measures "what does a
    # mixed crowd cost", which is not the founder's question. The tiers exist precisely so a crowd does not
    # have to be Large: Small is 24% of Large's boxes (23,180 against 95,594 across the three families). So
    # the crowd is built from Small, and the Large figures keep their place as the hero tier.
    all_files, files = [], []
    try:
        for name in sorted(os.listdir(AVATARS)):
            if name.lower().endswith(".wlvox"):
                all_files.append(os.path.join(AVATARS, name))
    except Exception as err:                                       # noqa: BLE001
        RESULT["avatars_error"] = str(err)[:160]
    files = [f for f in all_files if "_Small" in os.path.basename(f)] or all_files
    # TENTAILS IS EXCLUDED FROM THE CROWD, and the reason is a count rather than a preference.
    #
    # The cost here is per COMPONENT -- one instanced component is one draw batch -- not per voxel, which is
    # why the Small tier barely helped: it cuts boxes and not groups. Counting the groups in the crowd tier:
    #
    #     Cherubim_Small   5,885 boxes /  25 groups
    #     Seraph_Small     5,190 boxes /  25 groups
    #     TenTails_Small  12,105 boxes / 123 groups      <- five times the components
    #
    # TenTails_Small keeps 123 of its Large tier's 124 groups: its ten tails are 80 groups on their own. So a
    # crowd containing TenTails is mostly paying for TenTails. Measuring the two families whose crowd tier is
    # actually a crowd tier says whether the SYSTEM scales or whether one family does not, and those are very
    # different findings for the founder to act on.
    # TENTAILS IS BACK IN, through a crowd tier built for the job.
    #
    # It was excluded to find out whether the SYSTEM scaled or one family did not, and the answer was the
    # family: TenTails_Small keeps 123 of its Large tier's 124 groups because its ten tails each carry the
    # same eight materials. Tools/make_tentails_crowd.py folds the five sub-pixel ones into the three that
    # carry the figure -- 123 groups to 73, tails 80 to 30 -- with every box, every tail's own phase and
    # amplitude, and the silhouette unchanged. TenTails_Small itself is untouched.
    # Which TenTails the crowd uses, so the two can be compared in ONE session at one thermal state rather
    # than across runs an hour apart -- the confound that already cost me a false regression today.
    # READ FROM A FILE, NOT THE ENVIRONMENT. The job runs inside the editor, which inherited its environment
    # when it launched, so an `export` in the shell that submits the job never reaches here -- the first
    # attempt at this A/B silently measured the same tier twice and looked like a result.
    want = "Crowd"
    try:
        marker = os.path.join(os.path.dirname(CHANNEL), "tentails.txt")
        if os.path.exists(marker):
            with open(marker, "r") as handle:
                want = handle.read().strip() or "Crowd"
    except Exception:
        want = "Crowd"
    RESULT["tentails_tier"] = want
    crowd = [f for f in all_files if ("TenTails_" + want) in os.path.basename(f)]
    files = [f for f in files if "TenTails" not in os.path.basename(f)] + crowd
    RESULT["crowd_tier"] = [os.path.basename(f) for f in files]
    if not files:
        record("X00", "there are avatars to stand up", False, dir=AVATARS)
        RESULT["status"] = "FAIL"
        return

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    here = dog.get_actor_location()
    fwd = dog.get_actor_forward_vector()
    right = dog.get_actor_right_vector()

    rows = []
    RESULT["tiers"] = rows
    standing = 0
    for target in TIERS:
        while standing < target:
            # Spread them across a grid so this measures many avatars, not many avatars inside each other.
            col = standing % 8
            row = standing // 8
            where = here + fwd * (1400.0 + row * 420.0) + right * ((col - 3.5) * 380.0)
            try:
                L.spawn_figure_actor(world, where, files[standing % len(files)], "scale_%d" % standing)
            except Exception as err:                               # noqa: BLE001
                RESULT["spawn_error"] = str(err)[:160]
            standing += 1
            yield 0.05
        started = time.time()
        while time.time() - started < SETTLE_S:
            yield 0.1
        got = yield from measure("at_%d" % target)
        over = round(got["median_ms"] - base["median_ms"], 2)
        rows.append({"avatars": target, "median_ms": got["median_ms"], "over_baseline_ms": over,
                     "per_avatar_ms": round(over / float(target), 3)})
        emit("T_%d" % target, "INFO", "%d avatars" % target, rows[-1])

    RESULT["baseline_median_ms"] = base["median_ms"]

    record("X00", "every tier was actually measured",
           all(r["median_ms"] > 0.0 for r in rows) and base["median_ms"] > 0.0,
           baseline=base, tiers=rows)

    # ---- THE CLAIM ITSELF. Scaling means the cost of the Nth avatar does not grow as N grows.
    per = [r["per_avatar_ms"] for r in rows]
    worsens = per[-1] > per[0] * 1.35 if len(per) >= 2 else True
    record("X01", "the per-avatar cost does not grow as the crowd grows",
           not worsens, per_avatar_by_tier=per, tiers=rows,
           note="ten was the largest count anyone had measured; 'bounded' was an extrapolation from four "
                "points until this. A 35%% allowance because this machine's timings are noisy")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
