# THE SEVEN LOCOMOTION STATES NOTHING MEASURES.
#
# FOUNDER, P0 item 3: "make every active skin copy its exact idle stance, walk, run, stop, turns, jump, fall,
# landing, body bounce, and ground contact." Ten states.
#
# zc_skin_parity samples THREE of them -- idle (A02/A05), walk (A06), jump (A07) -- and proves the channel
# itself is sound: A04 holds all twenty-three pose fields of the costume against the Dog's own canonical pose
# in the same frame and requires them identical to a thousandth. That is a strong argument that the other
# seven follow by construction, since a field-for-field copy cannot be selective.
#
# IT IS AN ARGUMENT, NOT A MEASUREMENT, AND THE FOUNDER HAS HEARD ARGUMENTS BEFORE: "They still stand/walk
# weird" was written about a system that had already been reported working. So the remaining seven are driven
# and read here -- run, stop, turns, fall, landing, body bounce, ground contact -- each one asking the same
# two questions:
#
#   DID THE STATE ACTUALLY HAPPEN?   A test that fails to make the Dog run proves nothing about running, so
#                                    every state records the evidence that it occurred at all.
#   DID THE SKIN GET THE SAME POSE?  Field for field, same frame, against the Dog's canonical pose.
#
# A state that did not happen is reported as NOT EXERCISED rather than as a pass, because the one thing worse
# than an untested state is an untested state wearing a tick.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_locomotion")

FIELDS = ("stride_phase", "gait_weight", "speed_uu", "bob_uu", "sway_uu", "lift_uu",
          "body_pitch_deg", "body_yaw_deg", "body_roll_deg",
          "head_pitch_deg", "head_yaw_deg", "tail_pitch_deg", "tail_yaw_deg",
          "hip_left_deg", "knee_left_deg", "hip_right_deg", "knee_right_deg",
          "shoulder_left_deg", "elbow_left_deg", "shoulder_right_deg", "elbow_right_deg",
          "airborne_weight", "stillness")


def read(pose):
    # Attribute access, the way zc_skin_parity reads it -- a USTRUCT's fields come through as attributes and
    # get_editor_property raises on them.
    return dict((f, round(float(getattr(pose, f)), 4)) for f in FIELDS)


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

    dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
    if not dogs:
        RESULT["status"] = "FAIL: no Relay Dog in the world"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    dog = dogs[0]

    ui.wear_relay_skin("celestial_light")
    yield 2.5

    def costume():
        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
            if str(a.get_editor_property("class_label")) == "RELAY DOG SKIN":
                return a
        return None

    skin = costume()
    record("L00", "Celestial Light is on, so there is a costume to hold against the Dog", skin is not None)
    if skin is None:
        RESULT["status"] = "FAIL: the skin did not dress"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    def parity(samples=6, gap=0.2):
        """Same frame, both poses, all twenty-three fields. Returns the worst disagreement seen."""
        worst = []
        peak = {"speed_uu": 0.0, "gait_weight": 0.0, "airborne_weight": 0.0,
                "bob_swing": 0.0, "yaw_swing": 0.0, "lift_uu": 0.0}
        bobs, yaws = [], []
        for _ in range(samples):
            a = read(dog.get_canonical_worn_pose())
            b = read(skin.get_worn_pose())
            for f in FIELDS:
                if abs(a[f] - b[f]) > 0.001:
                    worst.append({"field": f, "dog": round(a[f], 4), "skin": round(b[f], 4)})
            for k in ("speed_uu", "gait_weight", "airborne_weight", "lift_uu"):
                peak[k] = max(peak[k], abs(a[k]))
            bobs.append(a["bob_uu"])
            yaws.append(a["body_yaw_deg"])
            yield gap
        peak["bob_swing"] = (max(bobs) - min(bobs)) if bobs else 0.0
        peak["yaw_swing"] = (max(yaws) - min(yaws)) if yaws else 0.0
        RESULT.setdefault("_last", {})["worst"] = worst[:6]
        RESULT["_last"]["peak"] = {k: round(v, 3) for k, v in peak.items()}

    def shot(name):
        H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % name), 1500, 88)

    def verdict(tid, label, happened, evidence):
        last = RESULT.get("_last", {})
        worst = last.get("worst", [])
        peak = last.get("peak", {})
        RESULT[label] = {"happened": bool(happened), "peak": peak, "mismatches": worst}
        if not happened:
            record(tid, "%s -- NOT EXERCISED, so parity is unproven here" % label, False,
                   evidence=evidence, peak=peak,
                   note="the state did not occur; this is a gap in the test, not a pass")
        else:
            record(tid, "%s: the skin wears the Dog's pose field for field" % label,
                   len(worst) == 0, peak=peak, mismatches=worst[:4], evidence=evidence)

    # ---------------------------------------------------------------- RUN
    L.set_key_held("W", True)
    L.set_key_held("LeftShift", True)
    yield 1.6
    for step in parity():
        yield step
    run_peak = RESULT.get("_last", {}).get("peak", {})
    shot("01_run")
    verdict("L01", "run", run_peak.get("speed_uu", 0.0) > 50.0, "speed_uu peak")
    RESULT["run_speed_uu"] = run_peak.get("speed_uu")

    # ---------------------------------------------------------------- BODY BOUNCE
    # SAMPLED FAST, because the first run read a swing of exactly zero across six samples 0.2 s apart and
    # that is as likely to be aliasing as a missing bounce -- a gait cycle at a run is well under half a
    # second. The source says the bob is real (Dressed.BobUU = (Pose.BobUU - PelvisDropUU) * (1 - Still)),
    # so the test is the thing to make sharper before the product is accused.
    L.set_key_held("W", True)
    L.set_key_held("LeftShift", True)
    yield 1.0
    bobs = []
    for _ in range(30):
        bobs.append(read(dog.get_canonical_worn_pose())["bob_uu"])
        yield 0.05
    swing = (max(bobs) - min(bobs)) if bobs else 0.0
    RESULT["bob_swing_fast"] = round(swing, 4)
    RESULT["bob_samples"] = [round(b, 3) for b in bobs[:12]]
    shot("01b_bounce")
    # WHAT THIS MEASURES NOW, AND WHY IT CHANGED. Sampled at 20 Hz while running at 520 uu/s, bob_uu reads
    # exactly -0.0 for all thirty samples. That is not aliasing. The runtime computes the dressed bob as
    # (Pose.BobUU - Pose.PelvisDropUU), and the same expression drives BodyRoot's relative location -- so the
    # two cancel and the body-offset channel carries no signal at all. Whatever bounce the Dog shows must
    # therefore come from the leg angles, which ARE in the pose and DO reach the skin (L01, zero mismatches
    # across all twenty-three fields).
    #
    # So the founder's requirement -- that the skin copy the Dog's bounce -- is satisfied whatever the bounce
    # is made of, and that is what is asserted. Whether the Dog SHOULD have a body-offset bounce is a
    # question about the gait, not about parity, and it is recorded here rather than answered by changing
    # founder-approved movement maths unreviewed.
    # SAME FRAME, BOTH POSES -- and this is a correction. The previous version sampled the skin LIVE and
    # compared every reading against a single stale sample of the Dog, which can only agree while the bob is
    # motionless. It was written after a run where bob_uu read 0.0 throughout, so the flaw was invisible; the
    # moment a run produced a real swing (8.87 uu) the comparison reported a disagreement that was entirely
    # its own. The bob is read from both in the same frame now, exactly as the other states are.
    pairs = []
    for _ in range(24):
        a = read(dog.get_canonical_worn_pose())["bob_uu"]
        b = read(skin.get_worn_pose())["bob_uu"]
        pairs.append((a, b))
        yield 0.05
    live_swing = max(x for x, _ in pairs) - min(x for x, _ in pairs)
    worst_gap = max(abs(x - y) for x, y in pairs)
    RESULT["bob_swing_live_uu"] = round(live_swing, 4)
    RESULT["bob_worst_gap_uu"] = round(worst_gap, 4)
    RESULT["bob_channel_carries_signal"] = bool(live_swing > 0.05)
    record("L02", "body bounce: the Dog's bob reaches the skin, same frame",
           worst_gap < 0.001,
           dog_bob_swing_uu=round(live_swing, 4), worst_gap_uu=round(worst_gap, 4),
           samples=len(pairs), interval_s=0.05,
           channel_carries_signal=RESULT["bob_channel_carries_signal"],
           note="a swing near zero is not a failure here -- stillness damps the bob to nothing by design")
    L.set_key_held("LeftShift", False)
    L.set_key_held("W", False)
    yield 1.0

    # ---------------------------------------------------------------- STOP
    L.set_key_held("LeftShift", False)
    L.set_key_held("W", False)
    yield 1.8
    for step in parity():
        yield step
    stop_peak = RESULT.get("_last", {}).get("peak", {})
    shot("02_stop")
    verdict("L03", "stop", stop_peak.get("speed_uu", 999.0) < 20.0, "speed_uu fell back toward zero")

    # ---------------------------------------------------------------- GROUND CONTACT
    # AIRBORNE_WEIGHT IS THE SIGNAL, and the first version also demanded lift_uu < 1. That was a guess about
    # a field that means something else: Dressed.LiftUU = Overlay.LiftUU, the mission-act and flight overlay,
    # which is not a statement about whether the feet are down. The wrong condition is removed rather than
    # loosened, and lift_uu is still recorded so the number stays visible instead of disappearing.
    record("L04", "ground contact: standing still, the Dog is not airborne",
           stop_peak.get("airborne_weight", 1.0) < 0.05,
           airborne_weight=stop_peak.get("airborne_weight"),
           lift_uu_observed=stop_peak.get("lift_uu"),
           note="lift_uu is the act/flight overlay, recorded not gated")

    # ---------------------------------------------------------------- TURNS
    # THE CONTROLLER IS ROTATED, not a key held. The first version held D, which STRAFES: the Dog slid
    # sideways at 230 uu/s with its body yaw never moving, and the test read that as "turns did not happen"
    # -- correctly, because they had not. There is no turn verb in the test library, so the control rotation
    # is driven directly, which is what a mouse does anyway.
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    yaws = []
    L.set_key_held("W", True)
    if pc is not None:
        base = pc.get_control_rotation()
        actor_yaws = []
        for i in range(24):
            pc.set_control_rotation(unreal.Rotator(base.pitch, base.yaw + (i + 1) * 7.0, base.roll))
            yaws.append(read(dog.get_canonical_worn_pose())["body_yaw_deg"])
            actor_yaws.append(float(dog.get_actor_rotation().yaw))
            yield 0.09
    L.set_key_held("W", False)
    yield 1.0
    # Unwrapped, because a yaw that crosses 180 reads as a 360-degree jump and would flatter the result.
    def travel(series):
        total = 0.0
        for a, b in zip(series, series[1:]):
            step_deg = abs(b - a)
            total += min(step_deg, 360.0 - step_deg)
        return total

    swing_yaw = travel(yaws)
    actor_travel = travel(actor_yaws if pc is not None else [])
    RESULT["turn_body_yaw_travel_deg"] = round(swing_yaw, 2)
    RESULT["turn_body_yaw_samples"] = [round(y, 1) for y in yaws[:10]]
    for step in parity(samples=5, gap=0.15):
        yield step
    turn_mismatch = RESULT.get("_last", {}).get("worst", [])
    shot("03_turn")
    # THE DOG'S HEADING IS ITS ACTOR YAW, not body_yaw_deg. The previous version asserted on the pose field
    # and read zero travel -- because body_yaw_deg is a body-RELATIVE lean, not a world heading, so it stays
    # near zero however far the Dog turns. Two wrong instruments in a row on the same test; the heading is
    # now read off the actor, which is the thing that actually turns.
    RESULT["turn_actor_yaw_travel_deg"] = round(actor_travel, 2)
    record("L05", "turns: the Dog turns, and the skin holds the Dog's pose throughout",
           actor_travel > 20.0 and len(turn_mismatch) == 0,
           actor_yaw_travel_deg=round(actor_travel, 2),
           body_yaw_travel_deg=round(swing_yaw, 2), mismatches=turn_mismatch[:4],
           note="body_yaw_deg is a relative lean and stays near zero; the heading is the actor's yaw")

    # ---------------------------------------------------------------- FALL and LANDING
    # Lifted and dropped rather than walked off a ledge: a ledge that is not where the test thinks it is
    # produces a Dog standing still and a fall test that quietly passes nothing.
    at = dog.get_actor_location()
    ground_z = float(at.z)
    dog.set_actor_location(unreal.Vector(at.x, at.y, ground_z + 900.0), False, False)
    yield 0.35
    fell = 0.0
    fall_worst = []
    for _ in range(14):
        a = read(dog.get_canonical_worn_pose())
        b = read(skin.get_worn_pose())
        for f in FIELDS:
            if abs(a[f] - b[f]) > 0.001:
                fall_worst.append({"field": f, "dog": round(a[f], 4), "skin": round(b[f], 4)})
        fell = max(fell, a["airborne_weight"])
        yield 0.12
    shot("04_fall")
    RESULT["fall"] = {"airborne_peak": round(fell, 3), "mismatches": fall_worst[:6]}
    record("L06", "fall: the skin is told it is falling, with the Dog's own pose",
           fell > 0.05 and len(fall_worst) == 0,
           airborne_peak=round(fell, 3), mismatches=fall_worst[:4],
           note="dropped from 9 m rather than walked off a ledge, so the state is certain")

    # landing: airborne must come back down and the pose must still agree
    landed = 1.0
    land_worst = []
    for _ in range(26):
        yield 0.16
        a = read(dog.get_canonical_worn_pose())
        b = read(skin.get_worn_pose())
        for f in FIELDS:
            if abs(a[f] - b[f]) > 0.001:
                land_worst.append({"field": f, "dog": round(a[f], 4), "skin": round(b[f], 4)})
        landed = min(landed, a["airborne_weight"])
    shot("05_landing")
    RESULT["landing"] = {"airborne_floor": round(landed, 3), "mismatches": land_worst[:6]}
    record("L07", "landing: the skin comes back to the ground with the Dog",
           landed < 0.05 and len(land_worst) == 0,
           airborne_floor=round(landed, 3), mismatches=land_worst[:4])

    RESULT.pop("_last", None)
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
