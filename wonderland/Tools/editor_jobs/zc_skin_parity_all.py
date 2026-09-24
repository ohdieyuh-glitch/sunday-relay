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
SKINS = ["celestial_light", "apollo", "arden_infernal", "skeleton_flame"]
FIELDS = ("stride_phase", "gait_weight", "speed_uu", "bob_uu", "sway_uu", "lift_uu",
          "body_pitch_deg", "body_yaw_deg", "body_roll_deg",
          "head_pitch_deg", "head_yaw_deg", "tail_pitch_deg", "tail_yaw_deg",
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
        worn = bool(ui.wear_relay_skin(skin_id))
        yield 2.2
        skin = costume()
        row = {"skin": skin_id, "worn": worn, "dressed": skin is not None,
               "boxes": int(skin.get_box_count()) if skin is not None else 0}
        if skin is None:
            row["verdict"] = "FAIL: the figure did not load -- this is not an animation fault"
            rows.append(row)
            emit(skin_id, "FAIL", "figure did not load", row)
            continue

        # ---- field for field, standing and then walking, so both halves of the pose are covered
        mismatches = []
        for phase, held in (("standing", False), ("walking", True)):
            L.set_key_held("W", held)
            yield 1.4
            for _ in range(6):
                yield 0.25
                a = read(dog.get_canonical_worn_pose())
                b = read(skin.get_worn_pose())
                for f in FIELDS:
                    if abs(a[f] - b[f]) > 0.001:
                        mismatches.append({"phase": phase, "field": f, "dog": a[f], "skin": b[f]})
        L.set_key_held("W", False)
        yield 1.0
        row["field_mismatches"] = len(mismatches)
        row["first_mismatches"] = mismatches[:5]

        # ---- and a real act must reach it
        lift, still = 0.0, 0.0
        unreal.SystemLibrary.execute_console_command(world, "wl.Dog.Act prepare")
        for _ in range(20):
            yield 0.3
            p = read(skin.get_worn_pose())
            lift = max(lift, p["lift_uu"])
            still = max(still, p["stillness"])
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_%s.jpg" % (n + 1, skin_id)), 1700, 92)
        unreal.SystemLibrary.execute_console_command(world, "wl.Dog.Act none")
        yield 1.2

        row["act_lift_uu"] = round(lift, 2)
        row["act_stillness"] = round(still, 3)
        row["wears_the_pose"] = len(mismatches) == 0
        row["performs_the_act"] = lift > 5.0
        row["verdict"] = "PASS" if (row["wears_the_pose"] and row["performs_the_act"]) else "FAIL"
        rows.append(row)
        emit(skin_id, row["verdict"], "wears the canonical pose and performs the act", row)

    ui.wear_relay_skin("relay_og")
    yield 1.5
    RESULT["all_pass"] = all(r.get("verdict") == "PASS" for r in rows)
    RESULT["failing"] = [r["skin"] for r in rows if r.get("verdict") != "PASS"]
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
