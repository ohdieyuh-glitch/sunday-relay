# THE SAME PARITY QUESTION, ASKED OF EVERY ALTERNATE SKIN.
#
# FOUNDER: "prove only Relay OG vs Celestial Light first... only then scale to Apollo/Arden/Skeleton."
#
# So this is zc_skin_parity's measurement widened, and it runs only because the pair already passed. For each
# skin it asks the two things that were actually broken: does it wear the Dog's canonical pose field for field,
# and does a Mission Contract act reach it -- because a skin that idles correctly but goes rigid the moment a
# contract starts is the exact failure the founder reported.
#
# Per skin, not as one verdict: "the alternates fail" could be one skin or four, and a single pass/fail hides
# which. A skin whose figure will not even load is recorded as that, rather than as an animation failure.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_parity_all")
# ---- RELAY OG WAS MISSING, AND IT IS THE SKIN EVERY SESSION STARTS ON.
#
# This list held four skins and the lineup is five. Relay OG -- the default mascot, the one the founder sees
# first every single time -- was never enumerated, so S04's "failing=[]" was vacuous for exactly the skin most
# likely to be looked at. A proof that silently covers less than it claims is worse than one that fails.
#
# EXPECTED is therefore declared separately and asserted against what was actually walked, so dropping a skin
# from the list becomes a FAILING TEST rather than a smaller green.
EXPECTED_ACTIVE_SKINS = ["relay_og", "celestial_light", "baal", "jack_flame", "skeleton_flame_v1", "skeleton_flame"]
SKINS = list(EXPECTED_ACTIVE_SKINS)
FIELDS = ("stride_phase", "gait_weight", "speed_uu", "bob_uu", "sway_uu", "lift_uu",
          "body_pitch_deg", "body_yaw_deg", "body_roll_deg",
          "head_pitch_deg", "head_yaw_deg", "tail_pitch_deg", "tail_yaw_deg",
          "hip_left_deg", "knee_left_deg", "hip_right_deg", "knee_right_deg",
          "shoulder_left_deg", "elbow_left_deg", "shoulder_right_deg", "elbow_right_deg",
          "airborne_weight", "stillness")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    rows = []
    RESULT["skins"] = rows
    RESULT["status"] = "running"

    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    ui = L.get_ui(world)
    L.focus_game_viewport()
    yield 0.5

    dogs = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.RelayDogCharacter)
    if not dogs:
        RESULT["status"] = "FAIL: no Relay Dog in the world"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return
    dog = dogs[0]

    def costume():
        for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment):
            if str(a.get_editor_property("class_label")) == "RELAY DOG SKIN":
                return a
        return None

    def read(pose):
        return dict((f, round(float(getattr(pose, f)), 4)) for f in FIELDS)

    for n, skin_id in enumerate(SKINS):
        # WAITED FOR, NOT ASSUMED. A fixed 2.2 s was enough on one run and not on the next: Apollo and
        # Arden came back "not dressed" because their figures were still being built when the probe
        # looked, and two unmeasured skins turned the gate red for a fault that does not exist. The
        # costume is waited for by condition, and the PREVIOUS skin's costume does not count as this one.
        before = costume()
        try:
            before_name = before.get_name() if before is not None else None
        except Exception:                                      # noqa: BLE001
            before_name = None
        worn = bool(ui.wear_relay_skin(skin_id))

        def dressed_anew():
            now = costume()
            try:
                return now is not None and now.get_name() != before_name
            except Exception:                                  # noqa: BLE001
                return False
        try:
            yield (dressed_anew, 15)
        except TimeoutError:
            pass
        yield 1.0
        skin = costume()
        # ---- RELAY OG HAS NO COSTUME ACTOR, BECAUSE IT *IS* THE CANONICAL BODY.
        #
        # costume() looks for the showcase figure labelled "RELAY DOG SKIN". That actor is built only for
        # a skin worn OVER the Dog; the default skin IS the Dog, so it does not exist and never will.
        # Adding relay_og to the lineup therefore turned a vacuous 4/4 into a misleading 1/5, with three
        # clauses reporting None for it and S04 naming the healthiest skin in the game as failing.
        #
        # Asking whether the authority "matches the pose it was handed" is asking whether it agrees with
        # itself, so that half is not asserted for it. What CAN be asserted honestly is that the authority
        # is present and that it MOVES: the canonical pose has to be readable, standing and walking have
        # to differ, and a Mission Contract act has to reach it. That is a real clause, not an exemption --
        # if the default body goes rigid then every skin worn over it goes rigid too, and this is the only
        # place in the suite that would catch it.
        authority = skin is None and skin_id == "relay_og"
        row = {"skin": skin_id, "worn": worn, "dressed": skin is not None,
               "is_the_authority": authority,
               "boxes": int(skin.get_box_count()) if skin is not None else 0}
        if skin is None and not authority:
            row["verdict"] = "FAIL: the figure did not load -- this is not an animation fault"
            rows.append(row)
            emit(skin_id, "FAIL", "figure did not load", row)
            continue

        def worn_pose(_skin=skin):
            return read(_skin.get_worn_pose()) if _skin is not None else read(dog.get_canonical_worn_pose())

        # ---- field for field, standing and then walking, so both halves of the pose are covered
        mismatches = []
        phase_pose = {}
        for phase, held in (("standing", False), ("walking", True)):
            L.set_key_held("W", held)
            yield 1.4
            for _ in range(6):
                yield 0.25
                a = read(dog.get_canonical_worn_pose())
                b = worn_pose()
                phase_pose[phase] = b
                if not authority:
                    for f in FIELDS:
                        if abs(a[f] - b[f]) > 0.001:
                            mismatches.append({"phase": phase, "field": f, "dog": a[f], "skin": b[f]})
        L.set_key_held("W", False)
        yield 1.0
        row["field_mismatches"] = len(mismatches)
        row["first_mismatches"] = mismatches[:5]
        # SAID OUT LOUD RATHER THAN IMPLIED BY A ZERO. "0 mismatches" and "there is nothing to compare
        # against" are different facts and a reader cannot tell them apart from the number alone. A
        # recorded n/a is evidence; a null is an absence every reader has to re-derive, and a zero is a
        # claim that was never tested.
        row["costume_parity"] = ("n/a -- this skin IS the canonical body, there is no costume over it"
                                 if authority else "compared field for field")

        # ---- AND DID ANYTHING MOVE AT ALL BETWEEN THE TWO PHASES?
        #
        # Zero mismatches is satisfied just as well by a skin faithfully copying a FROZEN Dog, so parity
        # on its own cannot tell a working rig from a dead one. Recorded per skin and asserted for all.
        moved = sorted(f for f in FIELDS
                       if "standing" in phase_pose and "walking" in phase_pose
                       and abs(phase_pose["standing"][f] - phase_pose["walking"][f]) > 0.001)
        row["fields_that_changed_when_walking"] = moved[:8]
        row["moves_when_walking"] = len(moved) > 0

        # ---- and a real act must reach it
        lift, still = 0.0, 0.0
        unreal.SystemLibrary.execute_console_command(world, "wl.Dog.Act prepare")
        for _ in range(20):
            yield 0.3
            p = worn_pose()
            lift = max(lift, p["lift_uu"])
            still = max(still, p["stillness"])
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_%s.jpg" % (n + 1, skin_id)), 1700, 92)
        unreal.SystemLibrary.execute_console_command(world, "wl.Dog.Act none")
        yield 1.2

        row["act_lift_uu"] = round(lift, 2)
        row["act_stillness"] = round(still, 3)
        row["wears_the_pose"] = len(mismatches) == 0
        row["performs_the_act"] = lift > 5.0
        ok = row["wears_the_pose"] and row["performs_the_act"] and row["moves_when_walking"]
        # REFERENCE rather than PASS: the authority is held to presence, motion and the act, and is not
        # scored on a parity comparison it cannot meaningfully fail. Spelt differently so no reader can
        # mistake it for a skin that was checked field for field.
        row["verdict"] = ("REFERENCE" if authority else "PASS") if ok else "FAIL"
        rows.append(row)
        emit(skin_id, row["verdict"], "wears the canonical pose and performs the act", row)

    ui.wear_relay_skin("relay_og")
    yield 1.5
    # ---- FAILING AND UNMEASURED ARE KEPT APART.
    #
    # S04 named relay_og as failing on the strength of three NULLS. Converting an absent measurement into
    # a failure is the same error as converting one into a pass; it just points the other way, and it had
    # planted a false blocker on the default mascot -- the skin the founder sees first every session.
    #
    # A skin that produced no reading is listed as UNMEASURED, which is a statement about the proof. A
    # skin that produced a reading and failed it is listed as FAILING, which is a statement about the
    # product. The gate is red for either, because an unmeasured skin is not a certified one -- but the
    # two are never merged into one word again.
    GOOD = ("PASS", "REFERENCE")
    RESULT["unmeasured"] = [r["skin"] for r in rows
                            if r.get("field_mismatches") is None or r.get("wears_the_pose") is None]
    RESULT["failing"] = [r["skin"] for r in rows
                         if r.get("verdict") not in GOOD and r["skin"] not in RESULT["unmeasured"]]
    RESULT["all_pass"] = bool(rows) and not RESULT["failing"] and not RESULT["unmeasured"]

    # ---- AND SAY SO AS A CHECK. This job worked out a verdict, wrote it into the result as `all_pass`, and
    # recorded no tests -- so it has been reported as "measured" and counted as judged by capture, while the
    # answer sat in the file. A verdict nobody asserts is not a verdict.
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    record("S01", "every active skin goes on and is dressed",
           bool(rows) and all(r.get("worn") and r.get("dressed") for r in rows),
           skins=[r["skin"] for r in rows])
    record("S02", "no skin mismatches the pose it was handed, on any field",
           all(int(r.get("field_mismatches", 1)) == 0 for r in rows),
           mismatches={r["skin"]: ("n/a" if r.get("is_the_authority") else r.get("field_mismatches"))
                       for r in rows},
           note="the authority reads n/a, not 0. It has no costume to be compared against, and a zero "
                "there would be a claim that was never tested.")
    record("S03", "every skin wears the pose AND performs the act",
           bool(rows) and all(r.get("wears_the_pose") and r.get("performs_the_act") for r in rows),
           wears={r["skin"]: r.get("wears_the_pose") for r in rows},
           performs={r["skin"]: r.get("performs_the_act") for r in rows})
    record("S05", "the rig is moving, so parity is not agreement between two frozen figures",
           bool(rows) and all(r.get("moves_when_walking") for r in rows),
           moves={r["skin"]: r.get("moves_when_walking") for r in rows},
           changed={r["skin"]: r.get("fields_that_changed_when_walking") for r in rows},
           note="zero mismatches is satisfied just as well by a skin copying a dead Dog, so the parity "
                "clauses above mean nothing without this one.")
    record("S04", "and none of them is failing, and none of them went unmeasured",
           RESULT["all_pass"], failing=RESULT["failing"], unmeasured=RESULT["unmeasured"],
           note="two lists, not one. FAILING is a statement about the product; UNMEASURED is a statement "
                "about this proof. Either turns the gate red, and merging them once planted a false "
                "blocker on the default mascot.")

    # ---- COVERAGE IS ITSELF A CLAUSE. See EXPECTED_ACTIVE_SKINS.
    # Taken from the rows that were actually WALKED. This read RESULT["by_skin"] -- a key this job has
    # never written -- and fell back to the SKINS constant, so the coverage clause compared the list
    # against itself and could not fail. A coverage assertion that cannot fail is the thing it exists to
    # prevent.
    walked = sorted({r["skin"] for r in rows})
    missing = [k for k in EXPECTED_ACTIVE_SKINS if k not in walked]
    extra = [k for k in walked if k not in EXPECTED_ACTIVE_SKINS]
    tests.append({"id": "S00", "name": "every active skin was actually tested, none silently dropped",
                  "pass": len(missing) == 0 and len(extra) == 0,
                  "detail": {"expected": EXPECTED_ACTIVE_SKINS, "tested": walked,
                             "missing": missing, "unexpected": extra,
                             "note": "Relay OG was absent from this list until 2026-09-27, so every clause "
                                     "reported a clean result for a lineup that did not include the default "
                                     "mascot. Coverage is asserted here so that cannot recur quietly."}})

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
