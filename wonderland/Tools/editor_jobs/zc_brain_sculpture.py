# PIE job: THE LIVING PROJECT BRAIN AND ITS PYTHON, judged by what the founder sees and by what the motion
# measures -- never by the fact that an actor spawned.
#
# FOUNDER (2026-09-23): "Create a 3D BRAIN that feels alive and active ... continuous subtle organic movement."
# And: "DO NOT make the snake simply rotate around the brain on a generic circular orbit. I do NOT want brain +
# snake mesh + constant RotateAroundActor(). That will look artificial."
#
# SO THE ORBIT CLAIM IS MEASURED, not asserted. A circular orbit visits every bearing at a CONSTANT rate and holds
# a CONSTANT radius, so both spreads collapse to nearly zero. A wandering route does not. This reads the bearing
# rate spread the actor keeps, and independently samples the head's own radius and height over several seconds.
#
# AND THE ANTI-CLIPPING CLAIM IS MEASURED TOO: the closest any segment came to the brain's centre, every sample,
# against the floor the body is supposed to respect.
#
# Rules kept: zc_ prefix, no saves, no map edits, never Escape unless a panel is open, ends its own PIE.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "brain_sculpture")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["captures"] = []
    RESULT["status"] = "running"
    shots = []

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def shot(name, note):
        path = os.path.join(ROOT, "%02d_%s.jpg" % (len(shots) + 1, name))
        H.capture_viewport_jpeg(path, 1900, 95)
        shots.append({"n": len(shots) + 1, "name": name, "note": note})
        RESULT["captures"].append(path)

    def sculptures(world):
        return unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandBrainSculpture)

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 0.4

    # NOTHING BEFORE THE PANEL. A brain floating in the plaza with no panel open is the exit bug, seen early.
    RESULT["sculptures_before_open"] = len(sculptures(world))
    record("S00", "no brain sculpture exists before the panel is opened",
           RESULT["sculptures_before_open"] == 0, count=RESULT["sculptures_before_open"])

    # ---------------------------------------------------------------- B opens it
    #
    # WAITED FOR, NOT SLEPT THROUGH. This read a flat 2.0 s and failed on 2026-09-24 with count=0 -- and the
    # cause was in this line, not in the brain. The panel takes ~1.7 s to open on a loaded editor, and the
    # framing timer needs a few PAINTED frames before the window has a rect at all (the run logged
    # "WLBRAINRECT: no rect -- whole=0.0x0.0" for its whole 0.3 s of life). So the sleep was measuring the
    # editor's frame rate, not the feature. The bound stays hard -- six seconds and it has still failed -- and
    # the time taken is recorded, so a brain that stages slowly shows up as a number instead of hiding inside
    # a pass.
    L.press_key("B", False)
    waited = 0.0
    while waited < 6.0 and len(sculptures(world)) != 1:
        yield 0.25
        waited += 0.25
    found = sculptures(world)
    RESULT["sculptures_open"] = len(found)
    RESULT["seconds_to_stage"] = round(waited, 2)
    record("S01", "opening Project Brain makes exactly one living brain", len(found) == 1,
           count=len(found), seconds_to_stage=round(waited, 2))
    if len(found) != 1:
        RESULT["status"] = "FAIL: the sculpture did not stage; nothing below could be measured"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    art = found[0]
    radius = float(art.get_editor_property("brain_radius_uu"))
    RESULT["brain_radius_uu"] = radius
    shot("brain_open", "Project Brain open; the living brain framed in the brain window")

    # ---------------------------------------------------------------- watch it for a while
    # Sampled over seconds, not frames: breathing and the route are slow on purpose, and a pair of adjacent frames
    # would report a living thing as a still one.
    heads, radii, heights, breaths, closest, body = [], [], [], [], [], []
    for step in range(30):
        yield 0.35
        head = art.get_snake_head_location()
        heads.append([head.x, head.y, head.z])
        radii.append(float(art.get_head_radius_uu()))
        heights.append(float(head.z))
        breaths.append(float(art.get_breath()))
        closest.append(float(art.get_closest_segment_radius_uu()))
        body.append(float(art.get_body_length_uu()))
        if step in (0, 9, 19, 29):
            shot("watching_%02d" % step, "the same brain %0.1f s later" % (step * 0.35))

    RESULT["head_samples"] = heads
    RESULT["head_radius_min"] = min(radii)
    RESULT["head_radius_max"] = max(radii)
    RESULT["head_z_min"] = min(heights)
    RESULT["head_z_max"] = max(heights)
    RESULT["closest_segment_uu"] = min(closest)
    RESULT["breath_min"] = min(breaths)
    RESULT["breath_max"] = max(breaths)
    RESULT["bearing_rate_spread_deg"] = float(art.get_bearing_rate_spread_deg())
    RESULT["body_length_min"] = min(body)
    RESULT["body_length_max"] = max(body)
    RESULT["body_length_swing_ratio"] = (max(body) / min(body)) if min(body) > 0.01 else 999.0

    # ---- IT MOVES AT ALL
    travel = max(
        max(abs(a[i] - b[i]) for i in range(3))
        for a in heads for b in heads
    )
    RESULT["head_travel_uu"] = travel
    record("S02", "the python's head actually travels", travel > radius * 0.5,
           travel_uu=round(travel, 1), need_uu=round(radius * 0.5, 1))

    # ---- AND NOT ON AN ORBIT. Three independent readings, because any one of them alone could be argued with.
    # THE THRESHOLD IS MEASURED, NOT GUESSED. The first draft of this proof asked for >20 deg/s, and a faithful
    # offline port of the head maths (scratchpad/brain_motion_sim2.py) showed the worst eight-second window across
    # six runs at 10.2 deg/s -- so that proof would have failed the build at random. A real circular orbit reads
    # ~0. Five sits below everything the real route produces and far above anything an orbit could.
    spread = RESULT["bearing_rate_spread_deg"]
    record("S03", "the bearing rate is not constant, so the route is not a circular orbit", spread > 5.0,
           spread_deg_per_s=round(spread, 2), a_circular_orbit_would_be="~0", worst_simulated=10.2)
    radius_swing = RESULT["head_radius_max"] - RESULT["head_radius_min"]
    record("S04", "the head's distance from the brain changes, which an orbit's never does",
           radius_swing > radius * 0.06, swing_uu=round(radius_swing, 1), need_uu=round(radius * 0.06, 1))
    height_swing = RESULT["head_z_max"] - RESULT["head_z_min"]
    record("S05", "the route is not confined to one plane", height_swing > radius * 0.10,
           swing_uu=round(height_swing, 1), need_uu=round(radius * 0.10, 1))

    # ---- AND IT NEVER GOES THROUGH THE BRAIN. Offline the closest approach measured 151.6 uu against this 135.6
    # ---- floor, because the head is held outside by construction rather than by the clamp; a reading that sits
    # ---- exactly ON the floor would mean the clamp is steering again and should be treated as a regression.
    floor = radius * 1.50
    record("S06", "no segment ever entered the brain mass", RESULT["closest_segment_uu"] >= floor - 1.0,
           closest_uu=round(RESULT["closest_segment_uu"], 1), floor_uu=round(floor, 1),
           expected_uu=round(radius * 1.52, 1))

    # ---- AND THE BRAIN ITSELF IS ALIVE
    record("S07", "the brain breathes rather than sitting still",
           (RESULT["breath_max"] - RESULT["breath_min"]) > 0.25,
           breath_min=round(RESULT["breath_min"], 3), breath_max=round(RESULT["breath_max"], 3))

    # ---- AND IT IS AN ANIMAL, NOT A CONCERTINA.
    #
    # THE REGRESSION THIS CATCHES, because it was the real defect and not a hypothetical one. Lagging each segment
    # by a fixed TIME ties the body's length to the head's speed: simulated, that gave a python swinging between
    # 29 and 390 uu, a 13x concertina. Spacing by DISTANCE measured 617-647 uu in steady state, a 1.04x swing.
    # Anything above 1.25 here means the body has gone back to being measured in seconds.
    record("S08", "the python holds its length instead of inflating and collapsing",
           RESULT["body_length_swing_ratio"] < 1.25,
           min_uu=round(RESULT["body_length_min"], 1), max_uu=round(RESULT["body_length_max"], 1),
           swing_ratio=round(RESULT["body_length_swing_ratio"], 3), simulated_steady="1.04")

    # ---- and it is the length it was built to be, from the very first frame the founder could see it.
    # READ FROM THE ACTOR, not restated here: spacing and segment count are both editable properties, and a
    # proof that hardcodes what they were on the day it was written starts failing for the wrong reason the
    # first time somebody tunes them.
    spacing = float(art.get_editor_property("segment_spacing_uu"))
    segments = int(art.get_editor_property("snake_segments"))
    want = spacing * (segments - 1)
    RESULT["built_for_uu"] = want
    record("S08b", "the python is full length immediately, not growing into it",
           RESULT["body_length_min"] > want * 0.80,
           first_uu=round(body[0], 1), min_uu=round(RESULT["body_length_min"], 1),
           built_for_uu=round(want, 1), spacing_uu=spacing, segments=segments)

    # ---------------------------------------------------------------- THE EXIT: it must all go away
    L.press_key("Escape", False)
    yield 1.5
    left = len(sculptures(world))
    RESULT["sculptures_after_close"] = left
    record("S09", "closing the panel takes the brain away with it", left == 0, count=left)
    shot("after_close", "panel closed; the plaza has no brain left standing in it")

    # ---------------------------------------------------------------- and it comes back a second time
    L.press_key("B", False)
    waited = 0.0
    while waited < 6.0 and len(sculptures(world)) != 1:
        yield 0.25
        waited += 0.25
    RESULT["seconds_to_restage"] = round(waited, 2)
    again = len(sculptures(world))
    RESULT["sculptures_reopen"] = again
    record("S10", "reopening stages exactly one brain again, not a second one", again == 1, count=again)
    shot("reopened", "reopened; one brain, not two")
    L.press_key("Escape", False)
    yield 1.0

    RESULT["shots"] = shots
    RESULT["status"] = "measured; the verdict on how it LOOKS is the photographs"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
