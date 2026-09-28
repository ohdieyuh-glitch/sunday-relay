# WHAT IS THE OTHER 79 MILLISECONDS? AND CAN THE AVATAR STOP CASTING SHADOWS INSTEAD?
#
# FOUNDER, P0 item 5: "Cached spawn improved about 509 ms to 73 ms but still hitches. Test 0/1/5/10 avatars
# and OPTIMIZE REMAINING SPAWN/RENDER COST."
#
# WHERE THIS STANDS, from zzAN1_avatar on a sound instrument:
#
#     0 avatars   frame  64.69 ms   render  60.26   game 33.22
#     1 avatar    frame 175.61 ms   render 172.58   game 22.89
#     5 avatars   frame 169.29 ms   render 164.93   game 28.21
#
# THE FIRST AVATAR COSTS ABOUT 110 MS AND FURTHER ONES COST LITTLE -- five leave the frame where one did,
# and coming back down to one reads 174.45 against the ascending 175.61, so it is a standing cost of
# presence rather than a one-time build. It is entirely the RENDER thread; the game thread never leaves
# 22.9 to 33.2, empty world included. Virtual shadow maps are 31 ms of it. SOMETHING ELSE CARRIES 79.
#
# SO THIS LADDER IS ABOUT THE REMAINDER, and one of its rungs is a candidate FIX rather than a probe:
#
#   vsm_off          the known 31 ms, repeated here so this run has its own copy rather than quoting another
#   lumen_off        a Project Avatar is a few tens of thousands of emissive boxes, which is exactly the
#                    kind of thing that makes a global illumination pass expensive
#   shadows_off      all shadow casting, to bound how much of the remainder is shadows of any kind
#   avatar_no_shadow THE FIX CANDIDATE. Not a global quality knob -- it turns shadow casting off on the
#                    AVATAR'S OWN components and leaves the rest of the world casting normally. If most of
#                    the 79 ms is the avatar's own shadows, this recovers it at a cost the founder can
#                    actually look at, and it ships as a property rather than as a scalability setting that
#                    would degrade the whole scene.
#
# EVERY RUNG READS ITS KNOB BACK, because r.DistanceFields is recorded in this tree as REFUSING the value it
# was given -- read back 1.0 after being set to 0 -- which voided a rung of the previous run. A ladder whose
# knob refuses is a ladder that measures one rung repeatedly and looks exactly like a term that does not
# matter, which is a mistake this tree has now made with three separate cvars in one evening.
#
# AND THE FRAME READINGS ARE RAW, NOT THE SMOOTHED FIELD. FStatUnitData keeps two parallel sets and the
# filtered one is a running average -- 0.9 old plus 0.1 new -- so it cannot show a hitch, which is the word
# in the founder's sentence. GetRawFrameCostMs reads the raw side.
#
# `stat unit` IS ISSUED ONCE. It is a TOGGLE bound to ToggleStatUnit, and loops in this tree that re-issued
# it "to keep it alive" were switching the instrument off half the time.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import os
import time
import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
SL = unreal.SystemLibrary

# (name, [(cvar, value), ...], touches_the_avatar_directly)
RUNGS = (
    ("baseline", (), False),
    ("vsm_off", (("r.Shadow.Virtual.Enable", 0),), False),
    ("lumen_off", (("r.Lumen.DiffuseIndirect.Allow", 0),), False),
    ("shadows_off", (("r.ShadowQuality", 0),), False),
    ("avatar_no_shadow", (), "shadow"),
    # THE RUNG THE FIRST RUN EARNED. Global Lumen off saved 164.89 ms of a 203.22 ms frame -- it is the
    # dominant cost and shadows are not: vsm_off was 21.53, all shadows off saved NOTHING (-4.86), and
    # turning the avatar's own shadow casting off saved 4.33. My fix candidate was wrong and its clause said
    # so. A Project Avatar is tens of thousands of emissive boxes, which is exactly what makes a global
    # illumination pass expensive.
    #
    # So this takes the AVATAR out of Lumen instead of taking Lumen out of the world: per-component
    # properties, so the scene keeps its global illumination and only the avatar stops contributing to it.
    # That ships as a property on the figure rather than as a scalability setting that would flatten
    # everything the founder has approved.
    ("avatar_out_of_lumen", (), "lumen"),
)
SAMPLES = 26
SETTLE_BUDGET_S = 120.0
SETTLE_TOLERANCE = 0.12
FROZEN_LIMIT = 8


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def cvar(name):
        try:
            return round(float(SL.get_console_variable_float_value(name)), 4)
        except Exception:                                           # noqa: BLE001
            return None

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
    yield 6.0

    # ---- ISSUED ONCE. `stat unit` is a TOGGLE (FEngineStatToggle -> ToggleStatUnit); re-issuing it in a
    # loop turns the overlay off, and FStatUnitData only advances while the overlay DRAWS.
    SL.execute_console_command(world, "stat unit")
    yield 3.0

    seen_frames = []

    def read_frame():
        """Raw frame cost plus the engine frame number, so a frozen overlay is visible rather than silent."""
        try:
            got = H.get_raw_frame_cost_ms()
            n = int(H.get_engine_frame_number())
        except Exception:                                           # noqa: BLE001
            return None
        if got is None:
            return None
        frame, game, render, gpu = (float(got[0]), float(got[1]), float(got[2]), float(got[3]))
        return (frame, game, render, gpu, n)

    # ---- SETTLE BEFORE THE FIRST RUNG, because it is what every other rung is compared against and it has
    # always been the earliest and least settled reading. A fixed wait is a guess about when the world has
    # arrived; this waits for three reads to agree and VOIDS if they never do.
    settle, started = [], time.time()
    while time.time() - started < SETTLE_BUDGET_S:
        row = read_frame()
        if row is not None:
            settle.append(row[0])
            if len(settle) >= 3:
                win = settle[-3:]
                lo, hi = min(win), max(win)
                if lo > 0.0 and (hi - lo) / lo < SETTLE_TOLERANCE:
                    break
        yield 0.1
    settled = len(settle) >= 3 and (max(settle[-3:]) - min(settle[-3:])) / max(min(settle[-3:]), 0.01) \
        < SETTLE_TOLERANCE
    RESULT["warm_up"] = {"reads": len(settle), "last_three": [round(v, 2) for v in settle[-3:]],
                         "seconds": round(time.time() - started, 1), "settled": bool(settled)}
    record("A_WARM", "the world settled before the first rung was taken", bool(settled), **RESULT["warm_up"])
    if not settled:
        RESULT["status"] = "VOID: the world never settled, so the baseline would poison the ladder"
        return

    # ---- SPAWN THE ONE AVATAR, THE WAY THE LADDER JOB DOES.
    #
    # THERE IS NO AWonderlandProjectAvatar CLASS to search for -- a first version looked for one and found
    # nothing. What `/pa` puts in the world are plain figure actors, tracked privately on the UI subsystem,
    # so the reliable route is to spawn one here with the same call the ladder uses and hold the handle.
    avatar_dir = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "ProjectAvatars")
    files = []
    if os.path.isdir(avatar_dir):
        files = [os.path.join(avatar_dir, n) for n in sorted(os.listdir(avatar_dir))
                 if n.lower().endswith(".wlvox")]
    record("A00a", "there is a Project Avatar figure on disk to spawn", bool(files),
           found=len(files), where=avatar_dir)
    if not files:
        RESULT["status"] = "VOID: no Project Avatar figures to spawn"
        return

    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    base = pawn.get_actor_location()
    spot = unreal.Vector(base.x + 420.0, base.y, base.z)
    avatars = []
    body = L.spawn_figure_actor(world, spot, files[0], "WL_CauseAvatar_0")
    if body is not None:
        avatars.append(body)
    yield 4.0
    RESULT["avatars_present"] = len(avatars)
    record("A00", "one Project Avatar stands in the world to measure",
           len(avatars) >= 1, avatars=len(avatars), figure=os.path.basename(files[0]),
           note="the 110 ms is the cost of the FIRST one, so a world with none in it has nothing to say.")
    if not avatars:
        RESULT["status"] = "VOID: could not spawn a Project Avatar"
        return

    def set_avatar_shadows(on):
        touched = 0
        for a in avatars:
            for comp in a.get_components_by_class(unreal.PrimitiveComponent):
                try:
                    comp.set_cast_shadow(on)
                    touched += 1
                except Exception:                                   # noqa: BLE001
                    pass
        return touched

    def set_avatar_in_lumen(on):
        """Whether the avatar CONTRIBUTES to global illumination, leaving the rest of the world untouched."""
        touched = 0
        for a in avatars:
            for comp in a.get_components_by_class(unreal.PrimitiveComponent):
                for prop in ("affect_dynamic_indirect_lighting", "affect_distance_field_lighting"):
                    try:
                        comp.set_editor_property(prop, on)
                        touched += 1
                    except Exception:                               # noqa: BLE001
                        pass
        return touched

    def measure(tag):
        rows, frozen, last_n = [], 0, None
        while len(rows) < SAMPLES:
            row = read_frame()
            if row is None:
                yield 0.1
                continue
            if last_n is not None and row[4] == last_n:
                frozen += 1
                if frozen > FROZEN_LIMIT:
                    break
            else:
                frozen = 0
                rows.append(row)
            last_n = row[4]
            yield 0.12
        return rows

    def median(vs):
        s = sorted(vs)
        n = len(s)
        return round((s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])), 2) if n else None

    ladder = {}
    RESULT["ladder"] = ladder
    touched_components = 0
    for name, knobs, touches_avatar in RUNGS:
        for k, v in knobs:
            SL.execute_console_command(world, "%s %d" % (k, v))
        if touches_avatar == "shadow":
            touched_components = set_avatar_shadows(False)
        elif touches_avatar == "lumen":
            touched_components = set_avatar_in_lumen(False)
        yield 4.0
        back = {k: cvar(k) for k, _ in knobs}
        rows = []
        gen = measure(name)
        try:
            while True:
                nxt = next(gen)
                yield nxt
        except StopIteration as done:
            rows = done.value or []
        ladder[name] = {
            "asked": {k: v for k, v in knobs}, "read_back": back,
            "touched_avatar_components": touched_components if touches_avatar else None,
            "frames": len(rows),
            "frame_ms": median([r[0] for r in rows]),
            "game_ms": median([r[1] for r in rows]),
            "render_ms": median([r[2] for r in rows]),
            "gpu_ms": median([r[3] for r in rows]),
        }
        emit("A_%s" % name, "INFO", name, ladder[name])
        # put the knobs back before the next rung so the rungs do not accumulate
        for k, _ in knobs:
            SL.execute_console_command(world, "%s -1" % k if k == "r.ShadowQuality" else "%s 1" % k)
        if touches_avatar == "shadow":
            set_avatar_shadows(True)
        elif touches_avatar == "lumen":
            set_avatar_in_lumen(True)
        yield 2.0

    refused = []
    for name, knobs, _t in RUNGS:
        row = ladder.get(name) or {}
        for k, v in knobs:
            got = (row.get("read_back") or {}).get(k)
            if got is None or abs(got - v) > 0.001:
                refused.append("%s/%s asked %s read %s" % (name, k, v, got))
    RESULT["rungs_that_did_not_take"] = refused or None
    record("A01", "every rung's knob took the value it was given", not refused, refused=refused or None,
           note="r.DistanceFields refused its value in the previous run -- read back 1.0 after being set to "
                "0 -- and voided that rung. A ladder whose knob refuses measures one rung repeatedly and "
                "looks exactly like a term that does not matter.")

    thin = [n for n, row in ladder.items() if (row.get("frames") or 0) < SAMPLES // 2]
    record("A02", "every rung collected enough distinct frames to have a median",
           not thin, frames={n: (row.get("frames")) for n, row in ladder.items()}, thin=thin or None,
           note="frames are accepted only when the engine frame number ADVANCES, so a stalled overlay "
                "shows up as a thin rung instead of as a suspiciously steady reading.")

    base = (ladder.get("baseline") or {}).get("frame_ms")
    saved = {}
    for name, row in ladder.items():
        if name == "baseline" or base is None or row.get("frame_ms") is None:
            continue
        saved[name] = round(base - row["frame_ms"], 2)
    RESULT["milliseconds_saved_vs_baseline"] = saved
    emit("A03", "INFO", "what each rung is worth, in frame milliseconds", {"baseline_frame_ms": base,
                                                                           "saved": saved})

    record("A04", "shadows are NOT where the avatar's cost is",
           (saved.get("shadows_off") or 0.0) < 15.0 and (saved.get("avatar_no_shadow") or 0.0) < 15.0,
           saved_ms=saved, baseline_frame_ms=base,
           note="STATED AS THE NEGATIVE IT IS. The first run measured all shadows off at -4.86 ms and the "
                "avatar's own shadow casting at 4.33, against Lumen's 164.89. Shadows were my hypothesis "
                "and they are not the answer; recording that is worth more than quietly dropping the rung.")

    fix = saved.get("avatar_out_of_lumen")
    record("A05", "taking the AVATAR out of global illumination recovers most of what global Lumen off does",
           fix is not None and fix >= 60.0, saved_ms=fix, floor_ms=60.0,
           global_lumen_off_saved=saved.get("lumen_off"), baseline_frame_ms=base, all_rungs=saved,
           note="THE CANDIDATE FIX. Global Lumen off is 164.89 ms but flattens everything the founder has "
                "approved about this world's lighting. This turns off only the AVATAR'S contribution to it, "
                "per component, so the scene keeps its global illumination. If it recovers most of the "
                "164.89 it ships as a property on the figure; if it recovers little, the cost is in the "
                "avatar being LIT by Lumen rather than contributing to it, which is a different fix.")

    # ---- TAKE THE AVATAR BACK OUT. A figure left standing is a standing 110 ms on every later run in this
    # session, and on every other lane's.
    removed = 0
    for a in avatars:
        try:
            a.destroy_actor()
            removed += 1
        except Exception:                                           # noqa: BLE001
            pass
    RESULT["avatars_removed"] = removed
    record("A_CLEAN", "the avatar this job spawned was taken back out",
           removed == len(avatars), spawned=len(avatars), removed=removed,
           note="it costs 110 ms of frame while it stands there, so leaving one behind would quietly tax "
                "every later measurement in this session and in every other lane's.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
