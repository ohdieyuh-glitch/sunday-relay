# DOES A DRESSED DOG ACTUALLY STAND AND WALK LIKE THE CANON BODY?
#
# FOUNDER, repeatedly, most recently 2026-09-25: "Relay OG is still the exact animation authority. Every
# active mascot skin must copy Relay OG behavior: standing pose, idle, walk, run, start/stop, turns, jump,
# fall, landing, body bounce, ground contact. They still stand weird and walk weird. Fix the actual cause --
# skeleton, AnimBP, retarget, root pose, montage, notifies, transitions, callbacks. Do not hide this with
# cosmetic offsets."
#
# WHY THE EXISTING PROOF CANNOT SETTLE THIS, which is the whole reason this file exists.
#
# zc_skin_parity reads dog.get_canonical_worn_pose() and skin.get_worn_pose() and compares them field for
# field. It passes 9/9 and it is honest about what it measures -- but what it measures is the DRESSED POSE
# AGAINST ITSELF. It confirms that the value the Dog sent is the value the costume received. It cannot say
# anything at all about whether that value is what the Dog's OWN BODY is using, because the canon body never
# enters the comparison.
#
# So a divergence between the canon body's root and the pose handed to the costume is invisible to it, by
# construction. That is exactly the shape of a bug that would leave every proof green while the founder keeps
# saying they stand and walk wrong.
#
# WHAT THIS MEASURES INSTEAD: the real transforms. The canon body's own pivots -- Body, Pivot_head,
# Pivot_legLeft -- against the costume's -- Part_body, Part_head, Part_leg_l -- sampled on the same frames
# while the Dog idles, walks and stops.
#
# MEAN-REMOVED, because the two rigs do not share a rest pose: the canon body's Body sits at its own rest
# height and the costume's Part_body at its own. Subtracting each channel's own mean compares the MOTION,
# which is what "walks like" means, rather than the offset, which is just where each rig was built.
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_stance")

#: canon pivot name -> costume pivot name.
#:
#: THE BODY PAIR WAS WRONG IN THE FIRST VERSION and it produced a frightening-looking result: the canon Body
#: bobbing 4.894 uu against a costume body that never moved at all. The costume's body does not carry the
#: bob. Every skin declares `part root - 0 0 0 spine 0.850`, and the Spine motion is where WornPose.BobUU is
#: applied, so the bob lives on Part_root; `part body root ... none` is a child that never moves relative to
#: it. Comparing Body against Part_body was comparing the bob against a part defined to be still.
PAIRS = (("Body", "Part_root"), ("Pivot_head", "Part_head"), ("Pivot_legLeft", "Part_leg_l"))

SAMPLES, INTERVAL = 90, 0.05


def mean(xs):
    return sum(xs) / float(len(xs)) if xs else 0.0


def corr(a, b):
    if len(a) != len(b) or len(a) < 3:
        return 0.0
    ma, mb = mean(a), mean(b)
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    if va <= 1e-9 or vb <= 1e-9:
        return 0.0
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


def swing(xs):
    return (max(xs) - min(xs)) if xs else 0.0


def find(actor, name):
    """By PREFIX, because the costume's pivots are created through MakeUniqueObjectName and come out as
    Part_body_0, Part_head_0 and so on. An exact match found none of them and reported the costume as having
    no rig at all."""
    exact = None
    prefixed = None
    for comp in actor.get_components_by_class(unreal.SceneComponent):
        got = str(comp.get_name())
        if got == name:
            exact = comp
        elif prefixed is None and got.startswith(name + "_"):
            prefixed = comp
    return exact if exact is not None else prefixed


def job():
    os.makedirs(ROOT, exist_ok=True)
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
        RESULT["status"] = "FAIL: no Relay Dog"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    dog = dogs[0]

    ui.wear_relay_skin("celestial_light")
    yield 2.5
    costume = None
    for emb in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
        try:
            if emb.get_attach_parent_actor() == dog:
                costume = emb
        except Exception:
            continue
    if costume is None:
        record("N00", "the Dog is wearing a costume to compare against", False)
        RESULT["status"] = "measured"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    found = {}
    for canon_name, skin_name in PAIRS:
        found[canon_name] = find(dog, canon_name) is not None
        found[skin_name] = find(costume, skin_name) is not None
    RESULT["pivots_found"] = found
    record("N00", "both rigs expose the pivots this compares",
           all(found.values()), pivots=found,
           note="canon Body/Pivot_head/Pivot_legLeft against costume Part_body/Part_head/Part_leg_l")

    # ---- WALK. Driven forward so there is a gait to compare; the canon body and the costume are read on
    # the SAME frame, which is the only way a comparison of motion means anything.
    # THE DOG HAS TO ACTUALLY MOVE, and that is recorded rather than assumed: a flat reading from a Dog that
    # never walked would look exactly like a rig that never moves.
    # W ALONE DID NOT MOVE IT. The first run recorded peak speed 0.0 and every channel flat, which would
    # have read as a dead rig. zc_skin_locomotion reaches 520 uu/s by holding W AND LeftShift with the
    # viewport focused, so that is what is done here, and the speed is read from the Dog's own pose rather
    # than from get_velocity.
    L.focus_game_viewport()
    # ESTABLISH THE CONDITIONS RATHER THAN HOPE FOR THEM.
    #
    # This compares WALK channels, and ApplyMissionPose holds the legs in the meditate/fly pose whenever a
    # mission overlay is running -- so a mission left active by an earlier proof makes the comparison
    # meaningless. It used to be rare; after a session of running gate_c and the mission fixtures it became
    # every run: samples_performing 90 of 90, twice in a row, where the same proof read 0 earlier the same
    # day. Ambient state from a previous job is not something to measure around.
    unreal.SystemLibrary.execute_console_command(world, "wl.Mission.Reset")
    # wl.Mission.Reset alone did NOT clear it -- two runs still read samples_performing 90 of 90. The
    # overlay follows the Dog ACT (bWant = Current != None), which is a separate latch from the mission
    # fixtures, so the act is cleared explicitly too.
    unreal.SystemLibrary.execute_console_command(world, "wl.Dog.Act none")
    yield 2.5

    L.set_key_held("W", True)
    L.set_key_held("LeftShift", True)
    yield 1.2
    speeds = []
    overlay = []
    series = {}
    for canon_name, skin_name in PAIRS:
        series[canon_name] = {"canon_z": [], "canon_pitch": [], "skin_z": [], "skin_pitch": []}
    for _ in range(SAMPLES):
        for canon_name, skin_name in PAIRS:
            a, b = find(dog, canon_name), find(costume, skin_name)
            if a is None or b is None:
                continue
            at = a.get_relative_transform()
            bt = b.get_relative_transform()
            series[canon_name]["canon_z"].append(float(at.translation.z))
            series[canon_name]["skin_z"].append(float(bt.translation.z))
            series[canon_name]["canon_pitch"].append(float(at.rotation.rotator().pitch))
            series[canon_name]["skin_pitch"].append(float(bt.rotation.rotator().pitch))
        try:
            speeds.append(float(getattr(dog.get_canonical_worn_pose(), "speed_uu")))
        except Exception:
            pass
        # WAS THE DOG WALKING ON ITS OWN, OR PERFORMING? See N01.
        try:
            overlay.append(float(dog.get_mission_overlay_weight()))
        except Exception:
            pass
        yield INTERVAL
    L.set_key_held("W", False)
    L.set_key_held("LeftShift", False)
    yield 0.6
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_walking.jpg"), 1400, 90)

    readings = {}
    for canon_name, _ in PAIRS:
        s = series[canon_name]
        readings[canon_name] = {
            "canon_z_swing": round(swing(s["canon_z"]), 3),
            "skin_z_swing": round(swing(s["skin_z"]), 3),
            "z_correlation": round(corr(s["canon_z"], s["skin_z"]), 3),
            "canon_pitch_swing": round(swing(s["canon_pitch"]), 3),
            "skin_pitch_swing": round(swing(s["skin_pitch"]), 3),
            "pitch_correlation": round(corr(s["canon_pitch"], s["skin_pitch"]), 3),
        }
    RESULT["readings"] = readings
    RESULT["walk"] = {"peak_speed_uu": round(max(speeds), 1) if speeds else 0.0,
                      "mean_speed_uu": round(sum(speeds) / len(speeds), 1) if speeds else 0.0,
                      "samples": len(speeds)}
    RESULT["mission_overlay"] = {"peak_weight": round(max(overlay), 3) if overlay else 0.0,
                                 "samples_performing": sum(1 for v in overlay if v > 1e-4),
                                 "samples": len(overlay)}

    # ---- THE INSTRUMENT FIRST. If the canon body's own pivots never move, there is nothing to compare and
    # a correlation of 0 would be reported as a mismatch when it is really a dead probe. The canon body is
    # HIDDEN while a costume is worn, so whether it is still POSED is exactly the thing to check.
    # EVERY JUDGED CHANNEL MUST BE ALIVE -- AND THE DOG MUST HAVE BEEN WALKING ON ITS OWN.
    #
    # This asked `any(...)` and that was too weak. On one run in six the canon body's LEG pivot read a walk
    # swing of exactly 0.0000 while its Body and Head were posed normally. `any` was satisfied by the Body,
    # so the flat leg fell through to N02/N03 and was reported as the SKIN diverging from the authority, with
    # a swing ratio of 106,089,000.
    #
    # THE CANON BODY WAS NOT DEAD. IT WAS PERFORMING. ApplyMissionPose computes
    # `bPerforming = W > KINDA_SMALL_NUMBER && ...` from the mission stage overlay's weight, and while that
    # holds it writes the legs from the meditate/fly pose instead of the walk -- a HELD pose, whose walk
    # swing is correctly zero. The skin's channel is fed from the raw walk pose and kept swinging, so the two
    # genuinely disagreed for the length of that overlay, and the disagreement was the product working as
    # designed. Four consecutive runs afterwards read canon and skin identical to three decimals.
    #
    # So the Dog is now asked whether it was performing (GetMissionOverlayWeight, exposed for this), and a
    # window that caught an overlay is reported as an unfair window rather than as a skin that diverged --
    # the same guard S04 and Q03 carry for the pixel proofs.
    channels_for_life = {"Body": "z", "Pivot_head": "pitch", "Pivot_legLeft": "pitch"}
    asleep = {k: v["canon_%s_swing" % channels_for_life.get(k, "z")] for k, v in readings.items()
              if v["canon_%s_swing" % channels_for_life.get(k, "z")] <= 0.05}
    performing = sum(1 for v in overlay if v > 1e-4)
    canon_moves = (not asleep) and performing == 0
    walked = (RESULT.get("walk") or {}).get("peak_speed_uu", 0.0) > 50.0
    record("N01", "the canon body is still being posed, and the Dog actually walked",
           canon_moves and walked, readings=readings, walk=RESULT.get("walk"),
           canon_channels_asleep=asleep, samples_while_performing=performing,
           note="it is hidden, not stopped -- if this fails the comparison below is meaningless and the "
                "finding is that the authority stops running when it is dressed")

    if canon_moves:
        # EACH PIVOT IS JUDGED ON THE CHANNEL IT ACTUALLY USES. The body translates, so its bob is read on Z;
        # the head and the hip only ROTATE, and their Z never moves by design. The first version judged all
        # three on Z and reported the head and leg as 0.0 correlated -- a perfect score for a channel that
        # is defined to be still, reported as total failure.
        channels = {"Body": "z", "Pivot_head": "pitch", "Pivot_legLeft": "pitch"}
        corrs, ratios = {}, {}
        for k, v in readings.items():
            which = channels.get(k, "z")
            corrs[k] = v["%s_correlation" % which]
            base = max(v["canon_%s_swing" % which], 1e-6)
            ratios[k] = round(v["skin_%s_swing" % which] / base, 3)
        RESULT["judged_on"] = channels

        record("N02", "every joint moves the way the canon body's own joint moves",
               min(corrs.values()) > 0.9, by_pivot=corrs, channel=channels,
               note="mean-removed, same frames; the two rigs have different rest poses so only the MOTION is "
                    "compared")

        record("N03", "and by the same amount, not a damped or exaggerated copy",
               all(0.95 <= r <= 1.05 for r in ratios.values()),
               swing_ratios=ratios,
               note="skin swing divided by canon swing; 1.0 is a faithful copy. This is the check that "
                    "caught the spine scaling the authority by Part.A = 0.850")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
