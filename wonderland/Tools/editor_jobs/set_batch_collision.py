# Editor job: turn collision on (or off) for generator instanced batches, by kind, reversibly.
#
# WHY (BR01, beta-readiness 2026-09-17). The founder's beta bar is that the world must FUNCTION. collision_audit.py
# counted it: 14,852 single architecture ACTORS block movement, but 691 architecture BATCHES holding 14,557
# instances, and 458 ground batches holding 29,909, are set to NoCollision. That is most of the city's buildings and
# most of its raised paving: a beta player would walk through walls and stand on the world slab 15 cm below the
# pavement they can see.
#
# A WonderlandInstancedBatch carries one `collides` flag for all its instances, so this works batch by batch, by the
# kind of thing the batch draws. Foliage is deliberately left alone -- a player should walk through a flower bed.
# Every change records the batch's prior flag; REVERT puts them back. SAVE = False previews in the loaded level.
# Globals: KINDS (which kinds to change), VALUE (True/False), RECORD, REVERT, SAVE, MAX_INSTANCES.
import json
import os

KINDS = tuple(globals().get("KINDS", ("architecture", "ground")))
VALUE = globals().get("VALUE", True)
RECORD = globals().get("RECORD")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", False)
# A batch of thousands of tiny instances (grass, kerb trim) costs more in physics bodies than it returns in
# walkability, so a ceiling keeps this to the things a player actually stands on or bumps into.
MAX_INSTANCES = globals().get("MAX_INSTANCES", 4000)
ARCH = ("castle", "facade", "tower", "hall", "house", "gatehouse", "cloister", "arcade", "wall", "gate", "bridge",
        "stair", "step", "pavilion", "screen", "column", "balustrade", "pier", "plinth")
GROUND = ("terrace_platform", "plaza_slab", "path_flag", "cobble", "kerb", "garden_lawn", "ground", "medallion")
FOLIAGE = ("tree", "canopy", "shrub", "hedge", "topiary", "rose", "flower", "lavender", "blossom", "grass", "ivy",
           "vine", "mushroom", "leaf", "petal", "tuft")


def kind_of(name):
    low = name.lower()
    for words, kind in ((GROUND, "ground"), (FOLIAGE, "foliage"), (ARCH, "architecture")):
        if any(w in low for w in words):
            return kind
    return "other"


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    world = ues.get_editor_world()
    record = json.load(open(RECORD)) if (RECORD and os.path.exists(RECORD)) else {}
    changed, skipped = 0, {}
    instances = 0
    n = 0
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        n += 1
        if n % 400 == 0:
            yield None
        mesh = b.get_editor_property("mesh")
        if mesh is None:
            continue
        name = b.get_name()
        kind = kind_of(mesh.get_name())
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        count = ism.get_instance_count() if ism else 0
        if REVERT:
            if name not in record:
                continue
            b.set_editor_property("collides", record[name]["before"])
            changed += 1
            instances += count
            continue
        if kind not in KINDS:
            skipped[kind] = skipped.get(kind, 0) + 1
            continue
        if count > MAX_INSTANCES:
            skipped["over_%d_instances" % MAX_INSTANCES] = skipped.get("over_%d_instances" % MAX_INSTANCES, 0) + 1
            continue
        before = bool(b.get_editor_property("collides"))
        if before == bool(VALUE):
            skipped["already"] = skipped.get("already", 0) + 1
            continue
        record.setdefault(name, {"label": b.get_actor_label(), "mesh": mesh.get_name(), "kind": kind,
                                 "instances": count, "before": before})
        b.set_editor_property("collides", bool(VALUE))
        changed += 1
        instances += count
    if RECORD and not REVERT:
        os.makedirs(os.path.dirname(RECORD), exist_ok=True)
        with open(RECORD, "w", newline="\n") as f:
            json.dump(record, f, indent=1)
    RESULT["batches_changed"] = changed
    RESULT["instances_affected"] = instances
    RESULT["skipped"] = skipped
    yield 1.0
    if SAVE:
        RESULT["saved"] = bool(unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level())
    RESULT["status"] = "done"
