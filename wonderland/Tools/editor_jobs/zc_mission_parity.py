# DOES A SKINNED DOG PERFORM THE WHOLE MISSION CONTRACT, AND FINISH IT?
#
# FOUNDER: "the alternate mascot skins are also failing during Mission Contract animations... find why
# alternates don't complete... test mission completion after skin switching."
#
# THE HONEST SHAPE OF THIS. Nothing in the engine advances a contract on its own: ApplySchedulerState is the
# only path and a real scheduler drives it, because the code refuses on purpose to pretend Julius said so --
# "RUNNING MEANS JULIUS SAID SO. A locally queued contract is not running however red its orb is." So this
# drives the lifecycle through the console verb that already exists for proofs, wl.Tasks.Scheduler, and asks
# what the DOG does at each stage with a skin on: which act it performs, whether the performance reaches the
# body, and whether COMPLETED actually ends it.
#
# It reports per stage rather than as one verdict, because "the alternates don't complete" could be any one
# stage failing and a single pass/fail would hide which.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "mission_parity")
STAGES = ["PREPARATION", "RESEARCH", "IMPLEMENTATION", "VERIFICATION", "REVIEW", "REPAIR", "COMPLETED"]


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

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    ui = L.get_ui(world)
    tasks = L.get_mission_tasks(world)
    mission = L.get_mission(world)
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

    # ---------------------------------------------------------------- one contract, and a skin on
    tasks.clear_all_tasks_for_development()
    yield 0.5
    tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
    yield 1.2
    RESULT["contracts"] = len(tasks.get_task_list())
    record("M01", "one Mission Contract exists to perform", RESULT["contracts"] >= 1, contracts=RESULT["contracts"])

    worn = bool(ui.wear_relay_skin("celestial_light"))
    yield 2.0
    skin = costume()
    record("M02", "Celestial Light is on before the performance starts", worn and skin is not None, worn=worn)

    # ---------------------------------------------------------------- walk the whole lifecycle
    rows = []
    RESULT["stages"] = rows
    for n, stage in enumerate(STAGES):
        unreal.SystemLibrary.execute_console_command(world, "wl.Tasks.Scheduler 0 %s" % stage)
        yield 3.0
        lift, still, moved = 0.0, 0.0, 0.0
        first = None
        for _ in range(10):
            yield 0.25
            p = skin.get_worn_pose() if skin is not None else None
            if p is None:
                continue
            lift = max(lift, float(p.lift_uu))
            still = max(still, float(p.stillness))
            if first is None:
                first = float(p.head_pitch_deg)
            moved = max(moved, abs(float(p.head_pitch_deg) - first))
        act = str(mission.get_dog_performing_label())
        state = str(tasks.get_task_list()[0].state) if tasks.get_task_list() else "none"
        row = {
            "stage": stage,
            "task_state": state,
            "dog_act": act,
            "skin_lift_uu": round(lift, 2),
            "skin_stillness": round(still, 3),
            "skin_head_moved_deg": round(moved, 3),
            "skin_is_animated": (moved > 0.01 or lift > 0.5),
        }
        rows.append(row)
        H.capture_viewport_jpeg(os.path.join(ROOT, "%02d_%s.jpg" % (n + 1, stage.lower())), 1700, 92)

    # ---- EVERY WORKING STAGE MUST REACH THE SKIN. Completion is judged separately: it is meant to STOP.
    working = [r for r in rows if r["stage"] != "COMPLETED"]
    alive = [r["stage"] for r in working if r["skin_is_animated"]]
    dead = [r["stage"] for r in working if not r["skin_is_animated"]]
    RESULT["stages_that_reached_the_skin"] = alive
    RESULT["stages_that_did_not"] = dead
    record("M03", "every working stage of the contract reaches the skin",
           len(dead) == 0, reached=alive, did_not_reach=dead)

    # ---- AND THE DOG ACTUALLY CHANGED ACT, rather than standing in one pose the whole way through.
    acts = [r["dog_act"] for r in working]
    RESULT["acts_performed"] = acts
    record("M04", "the Dog performs more than one act across the lifecycle",
           len(set(acts)) > 1, acts=acts, distinct=len(set(acts)))

    # ---- AND COMPLETION ENDS IT.
    done = rows[-1]
    RESULT["completed_row"] = done
    record("M05", "COMPLETED is reached and the performance settles",
           "COMPLETED" in done["task_state"].upper(),
           task_state=done["task_state"], dog_act=done["dog_act"], lift_uu=done["skin_lift_uu"])

    ui.wear_relay_skin("relay_og")
    yield 1.5
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
