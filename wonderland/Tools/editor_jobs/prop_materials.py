# Editor job, READ-ONLY and CONCURRENT: which material does each of these prop meshes actually wear in this world?
#
# WHY (GC01, 2026-09-17). A layer batch must name its material, and a planting pass places meshes the world already
# uses -- shrubs, hedges, topiary, flower beds. Guessing "the green one" is how a pass ends up with the wrong leaf:
# this reports, per mesh, every material the existing instances carry and how many wear it, so a design can copy what
# is already there.
# Globals: MESHES (mesh names), MAX_SLOTS, OUT.
import json

CONCURRENT = True
MESHES = tuple(globals().get("MESHES", ()))
MAX_SLOTS = globals().get("MAX_SLOTS", 4)
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/prop_materials.json")


def _count(out, mesh_name, comp, n):
    slots = out.setdefault(mesh_name, {})
    for i, m in enumerate((comp.get_materials() or [])[:MAX_SLOTS]):
        if m is None:
            continue
        slot = slots.setdefault(str(i), {})
        slot[m.get_name()] = slot.get(m.get_name(), 0) + n


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    out = {}
    n = 0
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
        n += 1
        if n % 2000 == 0:
            yield None
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is not None and (not MESHES or mesh.get_name() in MESHES):
            _count(out, mesh.get_name(), smc, 1)
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        mesh = b.get_editor_property("mesh")
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        if mesh is None or ism is None:
            continue
        if MESHES and mesh.get_name() not in MESHES:
            continue
        _count(out, mesh.get_name(), ism, ism.get_instance_count())
        yield None
    with open(OUT, "w", newline="\n") as f:
        json.dump(out, f, indent=1)
    RESULT["meshes"] = len(out)
    RESULT["missing"] = [m for m in MESHES if m not in out]
    RESULT["status"] = "done"
