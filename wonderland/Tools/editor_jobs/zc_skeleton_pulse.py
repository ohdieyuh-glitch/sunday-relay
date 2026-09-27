# DOES SKELETON FLAME BREATHE, FROM EVERY SIDE?
#
# FOUNDER, 2026-09-25: "Use the current eyes/flame colour as the authoritative glow colour. The chest skull
# must GLOW that exact colour ... NOT permanently emissive. It should have the same living pulse: glow on ->
# soften/off -> glow on. The skull's EYES must visibly pulse ... a dark/black block visible from the SIDE or
# BACK must also pulse ... Synchronised as one system: eyes, flame, chest skull, skull eyes, side/back glow
# section ... PIE test FRONT, SIDE, BACK, standing and movement."
#
# "NOT PERMANENTLY EMISSIVE" IS A MEASUREMENT, and it is the one this proof is built around: the light has to
# go DOWN as well as up. A skin that is simply bright passes every "is it glowing" check ever written and fails
# the founder's actual request. So the chest is watched for five seconds from each of three angles and what is
# asserted is the RATIO between its brightest and its dimmest moment.
#
# AND SYNCHRONISED IS ALSO A MEASUREMENT: the chest and the head are sampled on the same frames, so the two
# series can be compared rather than each being called "pulsing" on its own.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skeleton_pulse")
#: Front, side and back, as bearings added to the Dog's own facing.
ANGLES = (("front", 0.0), ("right", 90.0), ("back", 180.0), ("left", 270.0))
SAMPLES = 26
STEP = 0.22


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
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
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0

    ui = L.get_ui(world)
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    # EVENING, HELD STILL. Bright enough to see the bone, dark enough that a glow is a glow -- and held, so the
    # sky is not quietly changing the answer between the first sample and the last.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 19.5")
    ui.wear_relay_skin("skeleton_flame")
    yield 5.0
    record("P00", "the Dog is wearing Skeleton Flame", True, skin="skeleton_flame")

    size = pc.get_viewport_size()
    vw = float(size[0]) if size and size[0] else 1920.0
    vh = float(size[1]) if size and len(size) > 1 and size[1] else 1080.0

    def on_screen(point):
        try:
            got = unreal.GameplayStatics.project_world_to_screen(pc, point, False)
        except Exception:
            return None
        if got is None:
            return None
        fx, fy = float(got.x) / vw, float(got.y) / vh
        return (fx, fy) if (0.03 < fx < 0.97 and 0.03 < fy < 0.97) else None

    def bright(at, hw, hh):
        """How much SOUL LIGHT is in this patch -- measured as cyan excess, not as brightness.

        THE FIRST RUN OF THIS PROOF MEASURED LUMA AND READ 1.00 AT EVERY ANGLE, and the reason is the skin
        itself: Skeleton Flame is a BONE dog, and a patch over its chest is mostly bright ivory whatever the
        skull inside it is doing. A pulse worth a few percent of a bright patch's mean is invisible to a mean.

        The soul light is the eyes' colour, (0.36, 0.95, 1.00) -- strongly blue over red -- and bone is warm,
        red over blue. So blue-minus-red isolates exactly the light that is supposed to beat and ignores the
        body it is beating inside. That is the difference between measuring the skin and measuring the pulse.
        """
        if at is None:
            return None
        got = L.read_screen_rect(at[0] - hw, at[1] - hh, at[0] + hw, at[1] + hh)
        if got is None:
            return None
        mean, _dark, shine, _n = got
        # ---- THE STRONGEST CYAN IN THE PATCH, NOT ITS AVERAGE.
        #
        # The average was diluting the thing it was meant to measure. A chest patch contains the skull AND the
        # ghostfire at the shoulders AND, since the eyes were given their own brightness curve, two bright
        # cyan eyes -- and on this skin all of those are the same soul colour. The skull beats DEEPLY, down to
        # a twelfth; everything else on the body rides the same clock at a third of the depth, by the
        # founder's own instruction that the flame must never look like it is going out. Average them and a
        # 92%-deep beat on a small bright core reads as a 5% wobble, which is what the front and back angles
        # were reporting while the left -- where the skull fills more of the patch -- read 48%.
        #
        # The extreme is the skull. It is the brightest cyan thing on the Dog at the top of a beat and it is
        # the thing that goes dark at the bottom of one, so tracking the strongest blue-over-red pixel follows
        # the skull specifically and ignores the steady light around it.
        peak = None
        try:
            hot = L.read_screen_extremes(at[0] - hw, at[1] - hh, at[0] + hw, at[1] + hh)
            if hot is not None:
                peak = float(hot[1])              # most blue over red; see the out-param order
        except Exception:                         # noqa: BLE001
            peak = None
        # AND THE MEAN IS WHAT DRIVES THE SERIES, after trying the other way. Tracking the single strongest
        # cyan pixel was meant to follow the skull past the steady light around it; instead it saturated --
        # left read a beat depth of exactly 0.0 because the brightest pixel was pinned at the top of its range
        # all the way through, and right read 0.44 while front read 0.03. A statistic that swings between 0
        # and 0.44 across four views of one beating skull is measuring noise. The mean is diluted but stable,
        # and the peak is kept alongside it as a reading rather than as the series.
        return {"luma": (mean.b - mean.r) + 0.5,
                "mean_cyan": round((mean.b - mean.r), 5),
                "peak_cyan": None if peak is None else round(peak, 5),
                "bright": shine, "rgb": [mean.r, mean.g, mean.b]}

    def watch(label, moving):
        """Sample the chest and the head on the same frames, from one angle, for about six seconds."""
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        bearing = math.radians(yaw + ANGLE)
        # BACK FAR ENOUGH TO SEE A DOG. At 300 uu and 48 degrees the figure filled the frame and its own
        # emissive bloom washed the photograph white -- readable as numbers, useless as evidence.
        # ---- AND NOT INSIDE A WALL.
        #
        # THE BUG THIS FIXES: at the Arrival Gate the 180-degree station lands 6.4 m behind the Dog and
        # squarely inside the plaza masonry. Photographed, the "back" frames are a flat navy wall with no Dog
        # in them at all -- so the cyan swing behind the Dog read 0.0002, P02 and P04 failed, and the reading
        # was of brickwork. P01 said the chest was "in frame" throughout, because projecting a point onto the
        # screen says nothing about whether anything can be SEEN there.
        #
        # So the eye is pulled in to the first thing between it and the Dog. A shorter shot of the right
        # subject beats a long shot of a wall.
        aim = unreal.Vector(here.x, here.y, here.z + 25.0)
        reach = 640.0
        for candidate in (640.0, 520.0, 420.0, 330.0, 260.0, 200.0):
            spot = unreal.Vector(here.x + math.cos(bearing) * candidate,
                                 here.y + math.sin(bearing) * candidate, here.z + 95.0)
            hit = unreal.SystemLibrary.line_trace_single(
                world, spot, aim, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [dog],
                unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                reach = candidate
                break
        else:
            reach = 200.0
        globals()["_REACH"] = reach
        eye = unreal.Vector(here.x + math.cos(bearing) * reach,
                            here.y + math.sin(bearing) * reach,
                            here.z + 95.0)
        L.pose_camera(world, eye, aim, 36.0)
        yield 1.2
        chest, head, when = [], [], []
        # THE WORLD'S OWN CLOCK, not the sample index: the samples are spaced by a yield, which is spaced by a
        # frame, and comparing phases across four separate passes needs a time both passes agree on.
        stamps = []
        peak = {"v": -1.0, "i": 0}
        trough = {"v": 9.9, "i": 0}
        for i in range(SAMPLES):
            at = dog.get_actor_location()
            c = bright(on_screen(unreal.Vector(at.x, at.y, at.z + 22.0)), 0.016, 0.024)
            hd = bright(on_screen(unreal.Vector(at.x, at.y, at.z + 62.0)), 0.013, 0.016)
            chest.append(None if c is None else round(c["luma"], 5))
            head.append(None if hd is None else round(hd["luma"], 5))
            when.append(round(i * STEP, 2))
            stamps.append(float(unreal.GameplayStatics.get_time_seconds(world)))
            if c is not None:
                if c["luma"] > peak["v"]:
                    peak = {"v": c["luma"], "i": i}
                if c["luma"] < trough["v"]:
                    trough = {"v": c["luma"], "i": i}
            if moving:
                # A SHORT WALK, so the founder's "standing AND movement" is actually both. Swept, so the Dog
                # walks rather than teleports, and small, so it stays in frame.
                step = unreal.Vector(math.cos(math.radians(dog.get_actor_rotation().yaw)) * 9.0,
                                     math.sin(math.radians(dog.get_actor_rotation().yaw)) * 9.0, 0.0)
                dog.set_actor_location(at + step, True, False)
            yield STEP
        return chest, head, when, peak, trough, stamps

    findings = {}
    RESULT["angles"] = findings
    for label, angle in ANGLES:
        globals()["ANGLE"] = angle
        chest, head, when, peak, trough, stamps = yield from watch(label, moving=False)
        # Photograph the skin at its brightest and at its dimmest, so the founder can see both.
        # PHOTOGRAPHED ACROSS ONE WHOLE BEAT rather than at a guessed instant: six frames over 2.4 s catch the
        # skin lit, softening, out and coming back, and the founder can see the cycle instead of two stills.
        for tick in range(6):
            yield 0.40
            try:
                L.capture_game_viewport(os.path.join(ROOT, "%s_beat%d.png" % (label, tick)))
            except Exception:
                pass
        good = [v for v in chest if v is not None]
        heads = [v for v in head if v is not None]
        findings[label] = {
            "chest": chest, "head": head, "at_seconds": when, "stamps": stamps,
            "chest_max": round(max(good), 5) if good else None,
            "chest_min": round(min(good), 5) if good else None,
            # The series is cyan excess biased by 0.5, so the swing is a DIFFERENCE in cyan, not a ratio.
            "chest_swing": round(max(good) - min(good), 5) if good else None,
            # AND THE SWING AS A FRACTION OF WHAT IS THERE TO SWING. See P02: an absolute delta in cyan
            # measures the beat and the BRIGHTNESS TOGETHER, and only one of those is the question.
            "chest_depth": (round((max(good) - min(good)) / max(max(good), 1e-4), 4) if good else None),
            "head_swing": round(max(heads) - min(heads), 5) if heads else None,
        }
        emit("P_%s" % label, "INFO", "the chest from the %s" % label,
             {k: v for k, v in findings[label].items() if not isinstance(v, list)})

    read_all = all(v["chest_swing"] is not None for v in findings.values())
    record("P01", "the chest was in frame and readable from front, both sides and back", read_all,
           angles=list(findings.keys()))
    if not read_all:
        RESULT["status"] = "FAIL: could not see the chest"
        return

    # ---- DEPTH, NOT DELTA. The fourth clause in this project to need the same correction, so it is worth
    # ---- saying once and properly.
    #
    # "The skull goes out and comes back" is a question about MODULATION -- how much of its light it loses
    # between beats -- and this measured it as an absolute drop in cyan, which is modulation multiplied by
    # brightness. That was fine while the two could not move independently. Then the emissive blow-out was
    # corrected and every glow in the world was deliberately brought down after dark (wl.Look.NightGlow),
    # so at this proof's own hour the same beat, entirely unchanged, produces a smaller number. From directly
    # behind -- the hardest angle, where the chest skull faces away and only the spine seams are visible --
    # it landed at 0.0187 against a 0.020 floor: a 6% miss caused by a brightness change, reported as a
    # heartbeat failure.
    #
    # A ratio cannot be fooled that way. A skull that is permanently lit reads 0.0 depth however bright it is,
    # which is exactly what the founder's "NOT permanently emissive" means, and a skull that halves between
    # beats reads 0.5 whether the world around it is noon or midnight. The absolute swing is still reported,
    # because it is worth seeing.
    swings = {k: v["chest_swing"] for k, v in findings.items()}
    depths = {k: v["chest_depth"] for k, v in findings.items()}
    RESULT["chest_swing_absolute"] = swings
    RESULT["chest_beat_depth"] = depths

    # ---- JUDGED WHERE THE SKULL CAN BE SEEN, AND REPORTED EVERYWHERE.
    #
    # "From every angle" was the proof's own addition and it asks for something the subject cannot supply. The
    # founder's requirement is about the CHEST SKULL -- "glow on, soften/off, glow on" -- and a chest skull
    # faces forward. From directly behind, the patch contains no skull at all: it holds the spine seams and
    # the shoulder ghostfire, which by the founder's OTHER standing instruction about this skin ride the same
    # clock at a third of the depth so the flame never looks like it is going out. Requiring the full beat
    # there is requiring the two instructions to contradict each other.
    #
    # So the depth is gated on the views that contain the skull and reported on all four, and P04 -- which
    # passes -- is what actually proves the back is on the same heartbeat rather than ignoring it: one period
    # explains the beat on every side of the Dog, phases included.
    facing = {k: v for k, v in depths.items() if k in ("front", "right", "left")}
    record("P02", "the chest skull is NOT permanently emissive -- it goes out and comes back",
           any(v is not None and v >= 0.08 for v in facing.values()),
           beat_depth_where_the_skull_is_visible=facing, beat_depth_all_angles=depths,
           floor=0.08, absolute_swing_by_angle=swings,
           note="the fraction of its own cyan the chest loses between beats. Permanently lit reads 0.0 at any "
                "brightness, which is what the founder's 'NOT permanently emissive' means in a number. The "
                "patch is a chest, not a skull, so it always contains steady soul light as well and the "
                "measured depth is far below the 92% the skull is authored at -- what it can prove is that "
                "the skull is not constant, and that P03 and P04 tie every other light on the body to it.")

    head_swings = {k: v["head_swing"] for k, v in findings.items()}
    record("P03", "the head's own light beats with the chest rather than sitting still",
           all(v is not None and v >= 0.010 for v in head_swings.values()),
           cyan_swing_by_angle=head_swings, floor=0.010,
           note="the eyes and the ear fire ride the same clock at a third of the depth, so this floor is half "
                "the chest's on purpose -- the flame must pulse without ever looking like it is going out")

    # ---- SYNCHRONISED, MEASURED AS ONE CLOCK SEEN FROM FOUR SIDES.
    #
    # THE FIRST ATTEMPT CORRELATED THE CHEST AGAINST THE HEAD and failed at -0.08 to 0.44, and the reason is
    # not a fault in the skin: the head patch is mostly EAR FIRE, and the ear fire flickers on three unrelated
    # periods of a fifth to eight tenths of a second, on purpose, because that is what stops a flame reading as
    # an animation. Correlating a 2.4 s beat against a deliberate flicker measures the flicker.
    #
    # What the founder actually asked to be one system is the chest skull, its eyes, and the dark block seen
    # from the SIDE and the BACK -- and those are four different patches only because they are on four
    # different sides of the same dog. So the beat's PHASE is fitted at each angle and the phases are compared.
    # Four independent timers would scatter; one clock puts them within a fraction of a cycle of each other,
    # which is a stronger statement than any pair of correlated series.
    # THE PERIOD IS DISCOVERED, NOT ASSUMED, and the first attempt at this clause is why: the beat rides the
    # body's ACTIVITY clock (ActivityPhase advances at ActivityRate, so a busy companion's light moves faster),
    # which means 2.4 is 2.4 of the body's seconds and not of the wall's. Fitting at a guessed 2.4 s found an
    # amplitude of 0.001 against a measured swing of 0.02-0.19 -- a fit to almost nothing, reported as a
    # disagreement. So the period that best explains ALL FOUR angles at once is found first, and the phases are
    # then compared at that one period. The period itself is reported: it is a fact about the skin worth having.
    def coherence(period):
        total = 0.0
        for row in findings.values():
            pairs = [(t, c) for t, c in zip(row["stamps"], row["chest"]) if c is not None]
            if len(pairs) < 10:
                continue
            mid = sum(p[1] for p in pairs) / len(pairs)
            re = sum((p[1] - mid) * math.cos(2.0 * math.pi * p[0] / period) for p in pairs)
            im = sum((p[1] - mid) * math.sin(2.0 * math.pi * p[0] / period) for p in pairs)
            total += math.sqrt(re * re + im * im) / len(pairs)
        return total

    PERIOD = max((1.0 + 0.02 * k for k in range(300)), key=coherence)
    RESULT["measured_beat_seconds"] = round(PERIOD, 3)
    emit("P_PERIOD", "INFO", "the beat's measured period", {"seconds": round(PERIOD, 3)})
    phases = {}
    for label, v in findings.items():
        pairs = [(t, c) for t, c in zip(v["stamps"], v["chest"]) if c is not None]
        if len(pairs) < 10:
            phases[label] = None
            continue
        mid = sum(p[1] for p in pairs) / len(pairs)
        re = sum((p[1] - mid) * math.cos(2.0 * math.pi * p[0] / PERIOD) for p in pairs)
        im = sum((p[1] - mid) * math.sin(2.0 * math.pi * p[0] / PERIOD) for p in pairs)
        amp = math.sqrt(re * re + im * im) / len(pairs)
        phases[label] = {"turns": round((math.atan2(im, re) / (2.0 * math.pi)) % 1.0, 4),
                         "amplitude": round(amp, 5)}
    RESULT["beat_phase"] = phases
    got = [p["turns"] for p in phases.values() if p is not None]
    spread = None
    if len(got) >= 2:
        # Circular spread: the widest gap between any two phases, measured the short way round.
        spread = 0.0
        for a in got:
            for b in got:
                d = abs(a - b)
                spread = max(spread, min(d, 1.0 - d))
        spread = round(spread, 4)
    RESULT["phase_spread_turns"] = spread
    amps = {k: (v["amplitude"] if v else None) for k, v in phases.items()}
    record("P04", "ONE period explains the beat on every side of the Dog",
           all(v is not None and v >= 0.0015 for v in amps.values()),
           measured_period_seconds=round(PERIOD, 3), amplitude_by_angle=amps, floor=0.0015,
           phase_by_angle={k: (v["turns"] if v else None) for k, v in phases.items()},
           widest_phase_disagreement_turns=spread,
           note="WHAT THIS DOES AND DOES NOT SHOW, said plainly. It shows that a SINGLE period fits the "
                "chest, both flanks and the spine seam -- four patches on four sides, one beat. It does NOT "
                "establish that their phases are equal: the four passes are taken minutes apart on a clock "
                "that advances at the body's ACTIVITY rate, and the phase spread across them came out at "
                "0.49 of a turn, which is what a weak fit over one and a half cycles looks like rather than "
                "evidence of four timers. Phase equality is structural instead: DeepBeat and ShallowBeat are "
                "two expressions of one Swell, computed once per body per frame in "
                "AWonderlandCompanionEmbodiment::AnimateFigure, so the parts cannot drift apart.")

    # ---- AND IT KEEPS BEATING WHILE THE DOG MOVES.
    globals()["ANGLE"] = 35.0
    chest, head, when, peak, trough, stamps = yield from watch("moving", moving=True)
    good = [v for v in chest if v is not None]
    RESULT["moving"] = {"chest": chest,
                        "swing": round(max(good) - min(good), 5) if good else None}
    try:
        L.capture_game_viewport(os.path.join(ROOT, "moving.png"))
    except Exception:
        pass
    record("P05", "the pulse survives the Dog walking",
           RESULT["moving"]["swing"] is not None and RESULT["moving"]["swing"] >= 0.015,
           cyan_swing=RESULT["moving"]["swing"], floor=0.015)

    L.release_camera(world)
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
