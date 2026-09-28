# DOES EVERY SKIN COPY RELAY OG THROUGH RUN, STOP, TURN, JUMP, FALL AND LANDING?
#
# FOUNDER, P0 item 3: "make every active skin copy its exact idle stance, WALK, RUN, STOP, TURNS, JUMP, FALL,
# LANDING, body bounce, and ground contact."
#
# THIS IS THE GAP ITS OWN PREDECESSOR NAMES. zc_pose_authority ends with the sentence "it does not cover
# walk, run, stop, turns, jump, fall or landing as performances", and zc_pose_mission covers the Mission
# Contract lifecycle. Between them, idle and walking and the mission are measured -- and six of the founder's
# eight words are not. I have been reporting item 3 against two thirds of the sentence.
#
# WHAT IS ALREADY ELIMINATED, so this is aimed at what is left: the pose is copied field for field while
# standing and walking; the costume root offset is identical across skins (z spread 0.0); the authored foot
# plane is identical (3.720 in every file the runtime loads); standing ground contact is observed consistent
# from one camera; and the visible silhouette does follow the gait -- the drapery skins move MORE than Relay
# OG, not less, so the gliding hypothesis is dead. Five causes, none found.
#
# AIRBORNE IS WHERE A COSTUME IS MOST LIKELY TO COME ADRIFT, which is why this is worth a run rather than an
# assumption. Standing and walking hold the figure against the ground with continuous contact; a jump takes
# that away, and any term that is integrated, damped, or driven on the costume's own clock rather than
# copied from the Dog has a free half-second to diverge and then to land wrong.
#
# THE CONTROL COMES FIRST AND IT IS THE ONE THIS TREE KEEPS NEEDING. If the Dog does not actually leave the
# ground, "jump", "fall" and "landing" are three more samples of standing still, and every field agrees
# perfectly -- which is exactly how an earlier pose run passed every comparison it made. So S_AIR requires
# the movement component to report falling, and the run VOIDS if it never does.
#
# WHAT THIS DOES NOT CLAIM: whether each performance LOOKS right is the founder's. This says whether the
# costume is driven by the same numbers as the canon body in each state.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import unreal

L = unreal.WonderlandUiTestLibrary

SKINS = ("celestial_light", "apollo", "arden_infernal", "skeleton_flame")
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

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if ui is None or dog is None:
        RESULT["status"] = "VOID: no UI subsystem or no pawn"
        return

    def costume():
        for actor in unreal.GameplayStatics.get_all_actors_of_class(
                world, unreal.WonderlandCompanionEmbodiment):
            if actor.get_attach_parent_actor() == dog:
                return actor
        return None

    def read(obj, getter):
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

    # ---- AIRBORNE COMES FROM THE POSE, NOT FROM THE MOVEMENT COMPONENT.
    #
    # A first version asked dog.get_character_movement() and could not reach it, so falling() answered False
    # for every sample and the run VOIDED -- correctly, rather than reporting four skins agreeing perfectly
    # about a Dog that never jumped.
    #
    # The canonical pose already publishes `airborne_weight`, which is the engine's own answer to the same
    # question and is the field the costume is supposed to be copying anyway. Reading it needs no accessor
    # that might not be exposed, and it is the quantity the comparison below is actually about.
    def airborne_now():
        row = read(dog, "get_canonical_worn_pose")
        v = (row or {}).get("airborne_weight")
        return isinstance(v, float) and v > 0.01

    readings = {}
    RESULT["readings"] = readings
    airborne_seen = {}

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
        rows = {}
        saw_air = False

        def sample(state, n=3):
            out = []
            for _ in range(n):
                d = read(dog, "get_canonical_worn_pose")
                w = read(worn, "get_worn_pose")
                out.append({"dog": d, "worn": w, "falling": airborne_now()})
                yield 0.09
            rows[state] = out

        forward = dog.get_actor_forward_vector()

        # RUN: input every frame, because a gait pose at rest is a constant and an earlier pose run passed
        # every comparison it made on a Dog that was standing still.
        for _ in range(14):
            dog.add_movement_input(forward, 1.0, False)
            yield 0.06
        yield from sample("run")

        # TURN while moving.
        right = dog.get_actor_right_vector()
        for _ in range(10):
            dog.add_movement_input(forward, 1.0, False)
            dog.add_movement_input(right, 0.8, False)
            yield 0.06
        yield from sample("turn")

        # STOP: no input, sampled while it decelerates.
        yield 0.12
        yield from sample("stop")

        # JUMP, then FALL, then LANDING.
        try:
            dog.jump()
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})["%s/jump" % skin] = str(err)[:140]
        yield 0.10
        yield from sample("jump")
        for _ in range(8):
            if airborne_now():
                saw_air = True
            yield 0.07
        yield from sample("fall")
        # wait for touchdown, then read the landing
        for _ in range(30):
            if airborne_now():
                saw_air = True
            else:
                break
            yield 0.07
        yield from sample("landing")

        airborne_seen[skin] = saw_air or any(
            s.get("falling") for st in rows.values() for s in st)
        readings[skin] = {"has_costume": True, "states": rows}
        emit("S_%s" % skin, "INFO", skin,
             {"states": sorted(rows), "airborne_seen": airborne_seen[skin]})

    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 3.0
    record("S_SKIN", "Relay OG was put back on the Dog",
           "relay_og" in str(dog.get_worn_skin_id()).lower(), worn=str(dog.get_worn_skin_id()))

    RESULT["airborne_seen"] = airborne_seen
    record("S_AIR", "the Dog actually left the ground, so jump/fall/landing are not three more idles",
           bool(airborne_seen) and all(airborne_seen.values()), airborne=airborne_seen,
           note="THE CONTROL. Without it a Dog that never jumped gives three extra samples of standing "
                "still, every field agrees perfectly, and the run reports a pass it did not earn.")
    if not airborne_seen or not all(airborne_seen.values()):
        RESULT["status"] = "VOID: the Dog never left the ground"
        return

    # ---- THE COMPARISON, per state, across every sample.
    drift = {}
    for skin, entry in readings.items():
        if not entry.get("has_costume"):
            continue
        for state, samples in (entry.get("states") or {}).items():
            worst = {}
            checked = 0
            for s in samples:
                d, w = s.get("dog"), s.get("worn")
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
            drift["%s/%s" % (skin, state)] = {"compared": checked, "fields_that_differ": off or None,
                                              "worst": max(worst.values()) if worst else None}
    RESULT["drift_by_state"] = drift
    bad = sorted(k for k, v in drift.items() if v.get("fields_that_differ"))
    RESULT["states_where_a_costume_drifts"] = bad or None

    record("S01", "every costume wears the canonical pose through run, turn, stop, jump, fall and landing",
           bool(drift) and not bad, drift_by_state=drift, tolerance=EQUAL, offenders=bad or None,
           note="the six words of the founder's sentence that zc_pose_authority says outright it does not "
                "cover. Whether each performance LOOKS right is theirs; this says whether the costume is "
                "driven by the same numbers as the canon body in each state.")

    # AND THE SECOND CONTROL: the pose must actually differ BETWEEN states, or these are six names for one
    # reading and the comparison above is one measurement repeated.
    spread = {}
    for skin, entry in readings.items():
        if not entry.get("has_costume"):
            continue
        per = {}
        for state, samples in (entry.get("states") or {}).items():
            vals = [(s.get("dog") or {}).get("airborne_weight") for s in samples]
            vals += [(s.get("dog") or {}).get("speed_uu") for s in samples]
            per[state] = [v for v in vals if isinstance(v, float)]
        flat = [v for vs in per.values() for v in vs]
        spread[skin] = round(max(flat) - min(flat), 3) if len(flat) > 1 else None
    RESULT["state_spread"] = spread
    record("S02", "the states are actually different from each other",
           bool(spread) and all((v or 0) > 1.0 for v in spread.values()), spread=spread, floor=1.0,
           note="THE SECOND CONTROL. Six labels over one unchanging pose would pass S01 perfectly, which is "
                "the shape of every vacuous pass this tree has produced.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
