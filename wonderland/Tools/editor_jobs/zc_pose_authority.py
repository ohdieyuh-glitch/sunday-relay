# DOES EVERY SKIN RECEIVE THE SAME POSE RELAY OG IS DRIVEN BY?
#
# FOUNDER, P0 item 3: "One canonical Relay Dog behavior stack; skins are cosmetic ... fix the
# skeleton/AnimBP/retarget/root-pose cause, not cosmetic offsets."
#
# THIS IS THE QUESTION THE ENGINE CAN ANSWER EXACTLY, AND I SPENT SIX HOURS NOT ASKING IT.
#
# zc_stance_authority and zc_stance_preview tried to answer item 3 from PIXELS, across seven versions. The
# last one works and its finding is that the question is unanswerable that way: every costume changes what
# touches the ground, so a robe's hem is not a foot and a winged figure's widest point is not its stance. No
# silhouette measure separates "stands differently" from "is dressed differently".
#
# MEANWHILE THE DOG PUBLISHES THE POSE. RelayDogCharacter::GetCanonicalWornPose is BlueprintPure and returns
# the FWonderlandWornPose it built this frame -- stride phase, gait weight, speed, bob, sway, lift, body and
# head angles, hip and knee angles, airborne weight, stillness. AWonderlandCompanionEmbodiment::GetWornPose
# returns what the costume is wearing, and IsGaitDrivenExternally says whether it is being driven at all.
#
# So "is one canonical stack driving every skin" is a field-by-field comparison of two structs, not a
# photograph. I ruled that out on the first pass by reading the founder's "fix the cause, not cosmetic
# offsets" as forbidding me to READ the pose. It forbids FIXING the problem with offsets. Those are different
# sentences and the difference cost the evening.
#
# WHAT STILL NEEDS THE FOUNDER'S EYE, so this is not offered as the whole of item 3: whether the canonical
# pose LOOKS right is theirs, and so is walk, run, stop, turns, jump, fall and landing as performances. This
# answers one precise thing -- whether each skin is driven by the same numbers -- which is the part that was
# never checked and the part the word "canonical" is about.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
# Every float on the pose that describes the BODY's motion. Named explicitly rather than reflected, so a field
# added later is a deliberate decision to compare it and not a silent change of what this job tests.
FIELDS = (
    "stride_phase", "gait_weight", "speed_uu", "bob_uu", "sway_uu", "lift_uu",
    "body_pitch_deg", "body_yaw_deg", "body_roll_deg",
    "head_pitch_deg", "head_yaw_deg", "tail_pitch_deg", "tail_yaw_deg",
    "airborne_weight", "stillness",
    "hip_left_deg", "hip_right_deg", "knee_left_deg", "knee_right_deg",
    "shoulder_left_deg", "shoulder_right_deg", "elbow_left_deg", "elbow_right_deg",
)
# Read this many frames apart so a single instant cannot be mistaken for agreement, and so a pose that is
# never updated shows up as a frozen one.
SAMPLES = 6
# Degrees, or uu, or a 0-1 weight: the same small tolerance for all of them, because the claim is that the
# costume wears the SAME numbers rather than similar ones.
EQUAL = 0.001


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    RESULT["tests"] = []
    RESULT["fields_compared"] = list(FIELDS)

    def record(tid, name, ok, **detail):
        RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

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

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if dog is None or ui is None:
        RESULT["status"] = "VOID: no pawn or no UI subsystem"
        return

    if not hasattr(dog, "get_canonical_worn_pose"):
        RESULT["status"] = "VOID: this build does not publish the canonical worn pose"
        record("W00", "the Dog publishes its canonical worn pose", False)
        return
    record("W00", "the Dog publishes its canonical worn pose", True)

    def costume():
        """THE COSTUME IS THE EMBODIMENT ATTACHED TO THE DOG, not any embodiment.

        The AI Companions are the same class and carry the same eleven materials under every skin, so a probe
        that matched by class picked one of them and reported the Dog's clothes from a floating companion.
        That happened earlier today in the eye halo probe; matching on the attachment parent is the fix.
        """
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            if actor.get_attach_parent_actor() == dog:
                return actor
        return None

    def read_pose(obj, getter):
        try:
            pose = getattr(obj, getter)()
        except Exception as err:                                    # noqa: BLE001
            return None, str(err)[:120]
        row = {}
        for f in FIELDS:
            try:
                row[f] = round(float(pose.get_editor_property(f)), 4)
            except Exception:                                       # noqa: BLE001
                row[f] = None
        try:
            row["b_valid"] = bool(pose.get_editor_property("b_valid"))
        except Exception:                                           # noqa: BLE001
            row["b_valid"] = None
        return row, None

    readings = {}
    RESULT["readings"] = readings
    for skin in SKINS:
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:140]
            continue
        yield 6.0
        worn = costume()
        entry = {"has_costume": worn is not None}
        if worn is not None:
            try:
                entry["gait_driven_externally"] = bool(worn.is_gait_driven_externally())
            except Exception as err:                                # noqa: BLE001
                entry["gait_driven_externally"] = None
                entry["gait_flag_error"] = str(err)[:120]

        # ---- SAMPLED OVER FRAMES, PAIRED. Each sample reads the Dog and the costume in the same tick, so a
        # difference cannot be the two being read at different moments of a moving gait.
        pairs = []
        for _ in range(SAMPLES):
            dog_pose, dog_err = read_pose(dog, "get_canonical_worn_pose")
            worn_pose, worn_err = (read_pose(worn, "get_worn_pose") if worn is not None else (None, "no costume"))
            pairs.append({"dog": dog_pose, "worn": worn_pose, "dog_error": dog_err, "worn_error": worn_err})
            yield 0.2
        entry["samples"] = pairs
        readings[skin] = entry
        emit("W_%s" % skin, "INFO", skin,
             {"has_costume": entry["has_costume"],
              "gait_driven_externally": entry.get("gait_driven_externally"),
              "first_dog": (pairs[0] or {}).get("dog"),
              "first_worn": (pairs[0] or {}).get("worn")})

    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass

    # ---- RELAY OG HAS NO COSTUME AND THAT IS NOT A FAILURE. It IS the canonical body, so the comparison is
    # only meaningful for the four skins that dress it.
    dressed = [s for s in SKINS if (readings.get(s) or {}).get("has_costume")]
    RESULT["dressed_skins"] = sorted(dressed)
    record("W01", "every costume skin produced a costume attached to the Dog",
           len(dressed) == len(SKINS) - 1, dressed=sorted(dressed), wanted=len(SKINS) - 1,
           note="Relay OG is the canonical body and wears no costume, so four of five is the right answer. "
                "The costume is matched on its attachment parent, because the AI Companions are the same "
                "class and a class match picks one of them.")

    # ---- THE DOG'S OWN POSE MUST MOVE, or every comparison below is between two frozen structs.
    moved = {}
    for skin in SKINS:
        seq = [(p.get("dog") or {}).get("stride_phase") for p in (readings.get(skin) or {}).get("samples", [])]
        seq = [v for v in seq if isinstance(v, float)]
        moved[skin] = round(max(seq) - min(seq), 4) if len(seq) > 1 else None
    RESULT["dog_stride_movement"] = moved
    any_move = any(isinstance(v, float) and v > 0.0 for v in moved.values())
    record("W02", "the Dog's own pose changes between samples",
           any_move, stride_phase_spread=moved,
           note="a pose that never moves compares equal to anything, so this is the positive control: if the "
                "canonical stack is not running, every clause below would pass on two frozen structs.")

    # ---- AND THE COMPARISON. Field by field, in the same tick.
    diffs = {}
    for skin in dressed:
        worst = {}
        for pair in (readings.get(skin) or {}).get("samples", []):
            d, w = pair.get("dog"), pair.get("worn")
            if not d or not w:
                continue
            for f in FIELDS:
                a, b = d.get(f), w.get(f)
                if not isinstance(a, float) or not isinstance(b, float):
                    continue
                gap = abs(a - b)
                if gap > worst.get(f, -1.0):
                    worst[f] = round(gap, 4)
        off = sorted(f for f, v in worst.items() if v > EQUAL)
        diffs[skin] = {"worst_by_field": worst, "fields_that_differ": off or None,
                       "gait_driven_externally": (readings.get(skin) or {}).get("gait_driven_externally")}
    RESULT["vs_canonical"] = diffs
    not_driven = sorted(s for s in dressed
                        if (readings.get(s) or {}).get("gait_driven_externally") is not True)
    RESULT["skins_not_driven_externally"] = not_driven or None
    record("W03", "every costume reports that its gait is driven from outside",
           not not_driven, not_driven=not_driven or None,
           note="the flag says the costume has handed its gait to the canonical stack. A costume computing "
                "its own gait is the item 3 defect in its plainest form, whatever the numbers then agree on.")

    differing = sorted(s for s, v in diffs.items() if v.get("fields_that_differ"))
    RESULT["skins_wearing_a_different_pose"] = differing or None
    record("W04", "every costume wears the pose the Dog published, field for field",
           bool(diffs) and not differing, vs_canonical=diffs, tolerance=EQUAL,
           differing=differing or None,
           note="the founder's 'one canonical Relay Dog behavior stack; skins are cosmetic' as an exact "
                "question. This does not say the canonical pose LOOKS right, which is theirs to judge, and "
                "it does not cover walk, run, stop, turns, jump, fall or landing as performances.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
