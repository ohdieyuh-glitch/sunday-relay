# Editor job, READ-ONLY and CONCURRENT: what in this world can a player actually stand on or bump into?
#
# WHY (beta-readiness, 2026-09-17). The founder's beta bar is that the world must FUNCTION: walkable, no falling
# through, no walking through walls. Two earlier probes hinted at trouble -- wall_contact_probe hit a wall at 31 of
# 5,944 points, and ground_census notes that collision-less batch instances are "not ground a player stands on
# anyway". Before building more, this counts it exactly: every instanced batch and static mesh actor, its collision
# setting, its profile, and how many instances hide behind each answer.
#
# It reports by KIND, because the answer should differ: architecture and ground must collide, foliage and trim
# must not, and anything else is a judgement call.
# Globals: OUT.
import json

CONCURRENT = True
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/collision_audit.json")
ARCH = ("castle", "facade", "tower", "hall", "house", "gatehouse", "cloister", "arcade", "wall", "gate", "bridge",
        "stair", "step", "pavilion", "screen", "column", "balustrade", "pier", "plinth")
GROUND = ("terrace_platform", "plaza_slab", "path_flag", "cobble", "kerb", "garden_lawn", "ground", "medallion",
          "Cube")
FOLIAGE = ("tree", "canopy", "shrub", "hedge", "topiary", "rose", "flower", "lavender", "blossom", "grass", "ivy",
           "vine", "mushroom", "leaf", "petal", "tuft")


def kind_of(name):
    low = name.lower()
    for words, kind in ((GROUND, "ground"), (FOLIAGE, "foliage"), (ARCH, "architecture")):
        if any(w.lower() in low for w in words):
            return kind
    return "other"


def _collision(comp):
    """A primitive's collision answers to METHODS, not to get_editor_property: the first cut of this audit asked for
    the properties, got "?" for all 19,819 rows, and proved nothing (2026-09-17)."""
    try:
        enabled = str(comp.get_collision_enabled()).split(".")[-1]
    except Exception:
        try:
            enabled = str(comp.get_editor_property("body_instance").get_editor_property("collision_enabled")).split(".")[-1]
        except Exception:
            enabled = "?"
    try:
        profile = str(comp.get_collision_profile_name())
    except Exception:
        profile = "?"
    return enabled, profile


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    rows = []
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        mesh = b.get_editor_property("mesh")
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        if mesh is None or ism is None:
            continue
        enabled, profile = _collision(ism)
        rows.append({"actor": b.get_name(), "label": b.get_actor_label(), "mesh": mesh.get_name(),
                     "kind": kind_of(mesh.get_name()), "instances": ism.get_instance_count(),
                     "collision": enabled, "profile": profile, "type": "batch",
                     "has_simple": mesh.get_num_sections(0) is not None})
        yield None
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None:
            continue
        enabled, profile = _collision(smc)
        rows.append({"actor": a.get_name(), "label": a.get_actor_label(), "mesh": mesh.get_name(),
                     "kind": kind_of(mesh.get_name()), "instances": 1,
                     "collision": enabled, "profile": profile, "type": "actor"})
    with open(OUT, "w", newline="\n") as f:
        json.dump(rows, f)
    summary = {}
    for r in rows:
        key = (r["kind"], r["collision"])
        s = summary.setdefault("%s / %s" % key, {"actors": 0, "instances": 0})
        s["actors"] += 1
        s["instances"] += r["instances"]
    RESULT["summary"] = summary
    RESULT["rows"] = len(rows)
    RESULT["status"] = "done"
