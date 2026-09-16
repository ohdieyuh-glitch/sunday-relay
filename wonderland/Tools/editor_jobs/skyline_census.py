# Editor job, READ-ONLY and CONCURRENT: what the SKYLINE is made of.
#
# Every static-mesh actor and batch instance whose top is above MIN_TOP (the skyline band), grouped by
# (mesh, material) and weighted by the area it presents to a distant viewer -- height times width, not footprint,
# because a tower is seen from the side. Answers: which few materials colour the skyline, and how many pieces there are.
# Globals: MIN_TOP (uu), OUT (json path).
import json

CONCURRENT = True
MIN_TOP = globals().get("MIN_TOP", 2000.0)
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/skyline_census.json")


def job():
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    GS = unreal.GameplayStatics
    area, count = {}, {}

    def add(key, a):
        area[key] = area.get(key, 0.0) + a
        count[key] = count.get(key, 0) + 1

    n = 0
    for a in GS.get_all_actors_of_class(world, unreal.StaticMeshActor):
        n += 1
        if n % 2000 == 0:
            yield None
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None:
            continue
        o, e = a.get_actor_bounds(False)
        if o.z + e.z < MIN_TOP:
            continue
        side = 2.0 * max(e.x, e.y) * 2.0 * e.z / 10000.0
        mats = [m.get_name() for m in smc.get_materials() if m] or ["None"]
        for m in mats:
            add("%s|%s" % (mesh.get_name(), m), side / len(mats))
    for b in GS.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        mesh = b.get_editor_property("mesh")
        mat = b.get_editor_property("material")
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        if mesh is None or ism is None:
            continue
        bb = mesh.get_bounding_box()
        key = "%s|%s" % (mesh.get_name(), mat.get_name() if mat else "None")
        for i in range(ism.get_instance_count()):
            t = ism.get_instance_transform(i, True)
            s = t.scale3d
            top = t.translation.z + bb.max.z * s.z
            if top < MIN_TOP:
                continue
            w = max((bb.max.x - bb.min.x) * abs(s.x), (bb.max.y - bb.min.y) * abs(s.y))
            h = (bb.max.z - bb.min.z) * abs(s.z)
            add(key, w * h / 10000.0)
        yield None
    total = sum(area.values()) or 1.0
    rows = sorted(area.items(), key=lambda kv: -kv[1])
    RESULT["total_m2"] = round(total)
    RESULT["top"] = [[k, round(v), count[k], round(100.0 * v / total, 1)] for k, v in rows[:40]]
    by_mat = {}
    for k, v in area.items():
        m = k.split("|")[1]
        by_mat[m] = by_mat.get(m, 0.0) + v
    RESULT["materials"] = [[m, round(v), round(100.0 * v / total, 1)] for m, v in sorted(by_mat.items(), key=lambda kv: -kv[1])[:25]]
    with open(OUT, "w", newline="\n") as f:
        json.dump(RESULT, f, indent=1)
    RESULT["status"] = "done"
