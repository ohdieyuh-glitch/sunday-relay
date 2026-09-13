# Editor job, READ-ONLY and CONCURRENT: every tall vegetation piece in a box, with enough identity to trim
# it reversibly -- by OBJECT NAME (unique in the level; batch labels repeat across districts), and for a batch
# instance by name + index + its exact transform.
# Globals: BOX (xmin, xmax, ymin, ymax), MIN_TOP (uu), OUT (json path).
import json
import math

CONCURRENT = True
MAP_OBJECT = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2.WL_V2_GoldenArrival_WP2"
BOX = globals().get("BOX", (-5000.0, 5000.0, -2500.0, 12000.0))
MIN_TOP = globals().get("MIN_TOP", 450.0)
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/vegetation_census.json")
# WORDS (mesh-name fragments) defaults to tall vegetation; a declutter census passes prop meshes instead.
WORDS = tuple(globals().get("WORDS", ("canopy", "tree", "blossom", "hedge_mass", "topiary", "vine_hanging", "bush", "shrub", "willow", "cypress")))


def job():
    world = unreal.find_object(None, MAP_OBJECT)
    GS = unreal.GameplayStatics
    rows = []
    cache = {}
    n = 0
    for a in GS.get_all_actors_of_class(world, unreal.StaticMeshActor):
        n += 1
        if n % 2000 == 0:
            yield None
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None or not any(w in mesh.get_name().lower() for w in WORDS):
            continue
        o, e = a.get_actor_bounds(False)
        if BOX[0] <= o.x <= BOX[1] and BOX[2] <= o.y <= BOX[3] and o.z + e.z >= MIN_TOP:
            rows.append({"kind": "actor", "name": a.get_name(), "label": a.get_actor_label(), "mesh": mesh.get_name(), "x": round(o.x), "y": round(o.y),
                         "radius": round(math.hypot(e.x, e.y) * 0.72), "zmin": round(o.z - e.z), "zmax": round(o.z + e.z),
                         "tags": [str(t) for t in a.tags]})
    for b in GS.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        n += 1
        if n % 100 == 0:
            yield None
        mesh = b.get_editor_property("mesh")
        if mesh is None or not any(w in mesh.get_name().lower() for w in WORDS):
            continue
        key = mesh.get_path_name()
        if key not in cache:
            bb = mesh.get_bounds()
            cache[key] = (bb.origin, bb.box_extent)
        origin, ext = cache[key]
        tr = list(b.get_editor_property("transforms"))
        tf = b.get_actor_transform()
        for i in range(0, len(tr) - 8, 9):
            p = tf.transform_location(unreal.Vector(tr[i], tr[i + 1], tr[i + 2]))
            sx, sy, sz = tr[i + 6], tr[i + 7], tr[i + 8]
            zmax = p.z + (origin.z + ext.z) * sz
            if BOX[0] <= p.x <= BOX[1] and BOX[2] <= p.y <= BOX[3] and zmax >= MIN_TOP:
                rows.append({"kind": "instance", "name": b.get_name(), "label": b.get_actor_label(), "batch": str(b.get_editor_property("batch_name")),
                             "mesh": mesh.get_name(), "index": i // 9, "transform": [round(v, 3) for v in tr[i:i + 9]],
                             "x": round(p.x), "y": round(p.y), "radius": round(math.hypot(ext.x * sx, ext.y * sy) * 0.72),
                             "zmin": round(p.z + (origin.z - ext.z) * sz), "zmax": round(zmax), "tags": [str(t) for t in b.tags]})
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"box": BOX, "rows": rows}, f, indent=0)
    RESULT.update({"rows": len(rows), "status": "done"})
