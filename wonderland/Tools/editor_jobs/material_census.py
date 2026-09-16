# Editor job, READ-ONLY and CONCURRENT: what a place is MADE OF, by visible surface.
#
# For each point in POINTS, every static-mesh actor and every batch instance whose origin lies within RADIUS, grouped
# by (mesh, material) and weighted by the area its bounds present -- so a wall that fills the view outranks a hundred
# pebbles. This is the question a world-wide material pass needs answered before it touches anything: which few
# materials actually ARE the grey city, and which meshes carry them.
# Globals: POINTS [(label, x, y)], RADIUS (uu), OUT (json path).
import json
import math

CONCURRENT = True
MAP_OBJECT = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2.WL_V2_GoldenArrival_WP2"
POINTS = globals().get("POINTS", [])
RADIUS = globals().get("RADIUS", 2600.0)
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/material_census.json")


def job():
    world = unreal.find_object(None, MAP_OBJECT)
    GS = unreal.GameplayStatics
    totals = {}
    per_point = {label: {} for (label, _, _) in POINTS}

    def add(label, key, area):
        per_point[label][key] = per_point[label].get(key, 0.0) + area
        totals[key] = totals.get(key, 0.0) + area

    def near(x, y):
        return [label for (label, px, py) in POINTS if (x - px) ** 2 + (y - py) ** 2 <= RADIUS * RADIUS]

    n = 0
    for a in GS.get_all_actors_of_class(world, unreal.StaticMeshActor):
        n += 1
        if n % 1500 == 0:
            yield None
        o = a.get_actor_location()
        labels = near(o.x, o.y)
        if not labels:
            continue
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None:
            continue
        _, ext = a.get_actor_bounds(False)
        # the two largest faces of the bounds: what a walker actually sees of it
        dims = sorted([ext.x * 2.0, ext.y * 2.0, ext.z * 2.0], reverse=True)
        area = dims[0] * dims[1] / 10000.0
        mats = [m.get_name() if m else "None" for m in smc.get_materials()] or ["None"]
        for m in mats:
            for label in labels:
                add(label, "%s|%s" % (mesh.get_name(), m), area / len(mats))

    for b in GS.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        n += 1
        if n % 150 == 0:
            yield None
        mesh = b.get_editor_property("mesh")
        mat = b.get_editor_property("material")
        if mesh is None:
            continue
        ism = b.get_component_by_class(unreal.InstancedStaticMeshComponent)
        if ism is None:
            continue
        bb = mesh.get_bounding_box()
        size = bb.max - bb.min
        count = ism.get_instance_count()
        for i in range(count):
            t = ism.get_instance_transform(i, True)
            loc = t.translation
            labels = near(loc.x, loc.y)
            if not labels:
                continue
            s = t.scale3d
            dims = sorted([abs(size.x * s.x), abs(size.y * s.y), abs(size.z * s.z)], reverse=True)
            area = dims[0] * dims[1] / 10000.0
            key = "%s|%s" % (mesh.get_name(), mat.get_name() if mat else "None")
            for label in labels:
                add(label, key, area)

    top = sorted(totals.items(), key=lambda kv: -kv[1])[:60]
    RESULT["top"] = [[k, round(v, 1)] for k, v in top]
    RESULT["per_point"] = {label: [[k, round(v, 1)] for k, v in sorted(d.items(), key=lambda kv: -kv[1])[:14]]
                           for label, d in per_point.items()}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(RESULT, f, indent=1)
    RESULT["status"] = "done"
