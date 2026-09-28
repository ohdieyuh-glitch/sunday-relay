# IS THE CHRISTMAS TREATMENT ACTUALLY IN THE WORLD?
#
# FOUNDER, item 13: "Complete architecture, floors, roads, gardens, forests, transitions, materials,
# CHRISTMAS TREATMENT, lighting, sky, collisions, traversal, streaming, empty areas, polish."
#
# XM01 and XM02 are authored -- swags and lanterns over the three principal avenues, and a third of the second
# band's glass lit amber -- and each has a spec declaring the batches it lays down. What no job has ever asked
# is whether any of it is IN THE LEVEL. An authored pass with a written spec and no instances placed looks
# exactly like a finished one from the repository, which is the same gap that had item 4 reported as done
# while the material sat behind a console variable defaulting to off.
#
# THE SPEC NAMES THE BATCHES, so this does not guess. It reads the declared batch ids out of the two JSON
# specs and looks for a WonderlandInstancedBatch carrying each one, then counts the instances actually in it.
# A batch that exists with zero instances is as absent as one that does not exist, and is reported separately
# because the two mean different things to whoever fixes it.
#
# NO CLAIM ABOUT HOW IT LOOKS. Whether the season reads well is the founder's; this says whether it is there.
CONCURRENT = False

import json
import os
import unreal

L = unreal.WonderlandUiTestLibrary
SPECS = (r"C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign/Districts/xm01_christmas_lights.json",
         r"C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign/Districts/xm02_christmas_windows.json")


def job():
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    wanted = {}
    for path in SPECS:
        try:
            with open(path, encoding="utf-8") as f:
                spec = json.load(f)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[os.path.basename(path)] = str(err)[:140]
            continue
        for b in (spec.get("batches") or []):
            bid = str(b.get("id"))
            if bid and bid != "None":
                wanted[bid] = os.path.basename(path)
    RESULT["batches_the_specs_declare"] = sorted(wanted)
    record("X00", "the two Christmas specs declare batches to look for",
           bool(wanted), count=len(wanted), batches=sorted(wanted)[:14])
    if not wanted:
        RESULT["status"] = "VOID: the specs declare nothing"
        return

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    yield 6.0
    world = ues.get_game_world()

    present = {}
    labels = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            label = str(actor.get_actor_label())
        except Exception:                                           # noqa: BLE001
            continue
        if "XM0" not in label and "Christmas" not in label:
            continue
        labels.append(label)
        n = 0
        try:
            for comp in actor.get_components_by_class(unreal.InstancedStaticMeshComponent):
                n += int(comp.get_instance_count())
        except Exception:                                           # noqa: BLE001
            pass
        for bid in wanted:
            if bid in label:
                present[bid] = present.get(bid, 0) + n
    RESULT["christmas_actors_in_the_level"] = sorted(set(labels))[:24]
    RESULT["instances_per_declared_batch"] = present

    missing = sorted(b for b in wanted if b not in present)
    empty = sorted(b for b, n in present.items() if n == 0)
    RESULT["declared_but_absent"] = missing or None
    RESULT["present_but_empty"] = empty or None
    total = sum(present.values())
    RESULT["total_christmas_instances"] = total

    record("X01", "every batch the Christmas specs declare exists in the level",
           not missing, declared=len(wanted), found=len(present), missing=missing or None,
           note="an authored pass with a written spec and no instances placed reads as finished from the "
                "repository. That is the gap that had item 4 reported done while its material sat behind a "
                "console variable defaulting to off.")

    record("X02", "the Christmas batches actually carry instances, not just names",
           bool(present) and not empty, total_instances=total, empty_batches=empty or None,
           per_batch=dict(sorted(present.items())[:14]),
           note="a batch with zero instances is as absent as one that does not exist, and is reported "
                "separately because the two mean different things to whoever fixes it.")

    RESULT["status"] = "measured"
    yield 1.5
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
