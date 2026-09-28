# DOES EVERY SKIN FOLLOW RELAY OG THROUGH A WHOLE MISSION, NOT JUST WHILE WALKING?
#
# FOUNDER, P0 item 3, the sentence after the gait one: "Same for Mission Contract: start, planning,
# implementing, verifying, completion, props, return to idle. One canonical Relay Dog behavior stack; skins
# are cosmetic."
#
# zc_pose_authority answered the first half: every costume wears the Dog's published pose field for field,
# standing and walking, with the Dog's stride phase demonstrably advancing. This asks the same question of the
# mission lifecycle, where the Dog performs acts rather than gaits and the pose is driven by a stage rather
# than by movement input.
#
# THE CONTROL IS THE SAME SHAPE AND IT IS THE REASON THIS JOB IS WORTH RUNNING. The first pose run passed
# every comparison while the Dog stood still, because a gait pose at rest is a constant and two frozen structs
# agree perfectly. Here the equivalent trap is a fixture that does not actually drive the Dog: if the act
# label never changes and the pose never moves, every skin "matches" and the run proves nothing. So M02
# requires the Dog's own ACT to change across the fixture, and M03 requires the pose to move with it.
#
# THE FIXTURE IS THE PROJECT'S OWN full_lifecycle, the same one zc_joint_proof and zc_mission3b_proof drive,
# so this measures the stages the founder listed rather than a sequence invented here.
#
# WHAT THIS DOES NOT CLAIM: whether each act LOOKS right is the founder's, and so is whether the stage
# sequence is the one they want. This answers whether the costume is driven by the same numbers as the canon
# body throughout, which is what "skins are cosmetic" means and what nobody had checked.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import os
import time
import unreal

L = unreal.WonderlandUiTestLibrary

SKINS = ("celestial_light", "apollo", "arden_infernal", "skeleton_flame")
FIXTURE = "full_lifecycle"
# Fast enough that four skins fit in one run, slow enough that each stage is sampled several times.
PACE = 0.9
# Seconds to follow one skin's fixture before giving up on it.
BUDGET = 60.0
FIELDS = (
    "stride_phase", "gait_weight", "speed_uu", "bob_uu", "sway_uu", "lift_uu",
    "body_pitch_deg", "body_yaw_deg", "body_roll_deg",
    "head_pitch_deg", "head_yaw_deg", "tail_pitch_deg", "tail_yaw_deg",
    "airborne_weight", "stillness",
    "hip_left_deg", "hip_right_deg", "knee_left_deg", "knee_right_deg",
    "shoulder_left_deg", "shoulder_right_deg", "elbow_left_deg", "elbow_right_deg",
)
EQUAL = 0.001


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    RESULT["tests"] = []
    RESULT["fixture"] = FIXTURE

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

    # The mission subsystem is a LOCAL PLAYER subsystem and UE 5.8's Python binding has no world-subsystem
    # getter of any kind, so it is found by iterating objects and asking which one is actually on screen --
    # the same route zc_joint_proof uses.
    live = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem)
            if m.is_mission_strip_on_screen()]
    mission = live[0] if live else None
    record("M00", "the mission subsystem that is on screen was found",
           mission is not None, candidates=len(live),
           note="found by asking which instance is drawing rather than by taking the first: a stale "
                "subsystem from an earlier PIE session answers every call and drives nothing.")
    if mission is None:
        RESULT["status"] = "VOID: no mission subsystem on screen"
        return

    def costume():
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            if actor.get_attach_parent_actor() == dog:
                return actor
        return None

    def read_pose(obj, getter):
        try:
            pose = getattr(obj, getter)()
        except Exception:                                           # noqa: BLE001
            return None
        row = {}
        for f in FIELDS:
            try:
                row[f] = round(float(pose.get_editor_property(f)), 4)
            except Exception:                                       # noqa: BLE001
                row[f] = None
        return row

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
        if worn is None:
            readings[skin] = {"has_costume": False}
            continue

        try:
            started = bool(mission.start_fixture(FIXTURE, PACE))
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["%s/fixture" % skin] = str(err)[:140]
            started = False
        entry = {"has_costume": True, "fixture_started": started, "samples": [],
                 "acts": [], "beats": []}
        if started:
            deadline = time.time() + BUDGET
            while time.time() < deadline:
                try:
                    running = bool(mission.is_fixture_running())
                except Exception:                                   # noqa: BLE001
                    running = False
                act = beat = None
                try:
                    act = str(mission.get_dog_act_label())
                    beat = str(mission.get_beat_label())
                except Exception:                                   # noqa: BLE001
                    pass
                d, w = read_pose(dog, "get_canonical_worn_pose"), read_pose(worn, "get_worn_pose")
                entry["samples"].append({"dog": d, "worn": w, "act": act, "beat": beat})
                if act is not None and act not in entry["acts"]:
                    entry["acts"].append(act)
                if beat is not None and beat not in entry["beats"]:
                    entry["beats"].append(beat)
                if not running and len(entry["samples"]) > 4:
                    break
                yield 0.25
            try:
                mission.stop_fixture()
            except Exception:                                       # noqa: BLE001
                pass
            yield 1.0
        readings[skin] = entry
        emit("M_%s" % skin, "INFO", skin,
             {"samples": len(entry["samples"]), "acts": entry["acts"], "beats": entry["beats"]})

    # ---- PUT RELAY OG BACK, AND CHECK THAT IT WENT BACK. A costume left on the Dog reached another lane's
    # acceptance photographs tonight; see Tools/editor_jobs/README.md.
    try:
        ui.wear_relay_skin("relay_og")
    except Exception as err:                                        # noqa: BLE001
        RESULT.setdefault("errors", {})["restore"] = str(err)[:140]
    yield 3.0
    worn_back = None
    try:
        worn_back = str(dog.get_worn_skin_id())
    except Exception:                                               # noqa: BLE001
        worn_back = None
    RESULT["worn_after_restore"] = worn_back
    record("M_SKIN", "Relay OG was put back on the Dog, and it went back",
           worn_back is not None and "relay_og" in worn_back.lower(), worn_after_restore=worn_back)

    dressed = [s for s in SKINS if (readings.get(s) or {}).get("has_costume")]
    record("M01", "every skin produced a costume and started the fixture",
           len(dressed) == len(SKINS)
           and all((readings.get(s) or {}).get("fixture_started") for s in dressed),
           dressed=sorted(dressed),
           started={s: (readings.get(s) or {}).get("fixture_started") for s in SKINS})

    # ---- THE TWO CONTROLS. Without them a fixture that drives nothing passes every comparison below.
    acts = {s: (readings.get(s) or {}).get("acts") or [] for s in SKINS}
    RESULT["dog_acts_seen"] = acts
    record("M02", "the Dog performed more than one act across the fixture",
           bool(acts) and all(len(v) > 1 for v in acts.values() if v is not None),
           acts_seen=acts,
           note="THE CONTROL. A fixture that does not drive the Dog leaves one act for the whole run, and "
                "every skin then agrees with the canon body about a pose that never changed. The first pose "
                "run passed exactly that way on a Dog that was standing still.")

    moved = {}
    for s in SKINS:
        seq = [(p.get("dog") or {}).get("stride_phase") for p in (readings.get(s) or {}).get("samples", [])]
        seq = [v for v in seq if isinstance(v, float)]
        span = [(p.get("dog") or {}).get("body_pitch_deg") for p in (readings.get(s) or {}).get("samples", [])]
        span = [v for v in span if isinstance(v, float)]
        moved[s] = {"stride_spread": round(max(seq) - min(seq), 4) if len(seq) > 1 else None,
                    "body_pitch_spread": round(max(span) - min(span), 4) if len(span) > 1 else None}
    RESULT["canonical_pose_movement"] = moved
    record("M03", "the canonical pose actually moved during the mission",
           bool(moved) and all((v["stride_spread"] or 0.0) > 0.0 or (v["body_pitch_spread"] or 0.0) > 0.0
                               for v in moved.values()),
           movement=moved,
           note="the second control: the acts can change while the pose stays put, and a comparison of two "
                "unchanging structs is not a measurement.")

    # ---- AND THE COMPARISON, per skin, across every sample of the whole lifecycle.
    diffs = {}
    for s in dressed:
        worst, checked = {}, 0
        for p in (readings.get(s) or {}).get("samples", []):
            d, w = p.get("dog"), p.get("worn")
            if not d or not w:
                continue
            checked += 1
            for f in FIELDS:
                a, b = d.get(f), w.get(f)
                if not isinstance(a, float) or not isinstance(b, float):
                    continue
                gap = abs(a - b)
                if gap > worst.get(f, -1.0):
                    worst[f] = round(gap, 4)
        off = sorted(f for f, v in worst.items() if v > EQUAL)
        diffs[s] = {"samples_compared": checked, "worst_by_field": worst,
                    "fields_that_differ": off or None,
                    "acts": (readings.get(s) or {}).get("acts")}
    RESULT["vs_canonical"] = diffs
    differing = sorted(s for s, v in diffs.items() if v.get("fields_that_differ"))
    RESULT["skins_that_drift_during_a_mission"] = differing or None
    record("M04", "every costume wears the canonical pose through the whole mission",
           bool(diffs) and not differing and all(v["samples_compared"] > 8 for v in diffs.values()),
           vs_canonical=diffs, tolerance=EQUAL, differing=differing or None,
           note="the founder's 'same for Mission Contract: start, planning, implementing, verifying, "
                "completion, props, return to idle'. Whether each act LOOKS right is theirs to judge; this "
                "says whether the costume is driven by the same numbers as the canon body throughout.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
