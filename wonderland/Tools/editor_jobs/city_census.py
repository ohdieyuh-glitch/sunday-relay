# Editor job, READ-ONLY and CONCURRENT: the city as skyline work needs it.
#   ground  every ground slab / quilt actor (extent tells where the world's ground ends)
#   blocks  castle halls, arcades, towers, domes, gatehouses and district towers between NEAR and FAR_BLOCKS
#           from the eye (a new spire may rise from inside one of these, never from a walkable street)
#   far     everything taller than 20 m beyond FAR (what already stands in the distant skyline)
# Globals: OUT (json path), EYE (x, y), NEAR, FAR_BLOCKS, FAR (uu).
import json
import math

CONCURRENT = True
MAP_OBJECT = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2.WL_V2_GoldenArrival_WP2"
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/city_census.json")
EYE = globals().get("EYE", (0.0, -150.0))
NEAR, FAR_BLOCKS, FAR = globals().get("NEAR", 6000.0), globals().get("FAR_BLOCKS", 40000.0), globals().get("FAR", 35000.0)
BLOCK_WORDS = ("castle_hall", "castle_arcade", "castle_tower", "tower_capped", "tower_district", "cloister", "gatehouse",
               "castle_dome", "spire_signature", "tower_clock")


def job():
    world = unreal.find_object(None, MAP_OBJECT)
    if world is None or not isinstance(world, unreal.World):
        raise RuntimeError("editor world not found at " + MAP_OBJECT)
    GS = unreal.GameplayStatics
    ground, blocks, far = [], [], []
    cache = {}
    n = 0

    def classify(label, name, x, y, radius, zmin, zmax, yaw, scale):
        d = math.hypot(x - EYE[0], y - EYE[1])
        row = [label, name, round(x), round(y), round(d), round(radius), round(zmin), round(zmax), round(yaw, 1), round(scale, 3)]
        if any(w in name for w in BLOCK_WORDS) and NEAR <= d <= FAR_BLOCKS:
            blocks.append(row)
        elif d > FAR and zmax > 2000:
            far.append(row)

    for a in GS.get_all_actors_of_class(world, unreal.StaticMeshActor):
        n += 1
        if n % 2000 == 0:
            yield None
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None:
            continue
        o, e = a.get_actor_bounds(False)
        label, name = a.get_actor_label(), mesh.get_name()
        if "groundslab" in label.lower() or "ground_quilt" in name.lower() or "quilt" in label.lower():
            ground.append([label, name, round(o.x), round(o.y), round(o.z + e.z), round(e.x), round(e.y)])
            continue
        classify(label, name, o.x, o.y, math.hypot(e.x, e.y) * 0.72, o.z - e.z, o.z + e.z, a.get_actor_rotation().yaw, a.get_actor_scale3d().x)
    for b in GS.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        n += 1
        if n % 100 == 0:
            yield None
        mesh = b.get_editor_property("mesh")
        if mesh is None:
            continue
        name, key = mesh.get_name(), mesh.get_path_name()
        if key not in cache:
            bb = mesh.get_bounds()
            cache[key] = (bb.origin, bb.box_extent)
        origin, ext = cache[key]
        tr = list(b.get_editor_property("transforms"))
        tf = b.get_actor_transform()
        label = str(b.get_editor_property("batch_name"))
        for i in range(0, len(tr) - 8, 9):
            p = tf.transform_location(unreal.Vector(tr[i], tr[i + 1], tr[i + 2]))
            sx, sy, sz = tr[i + 6], tr[i + 7], tr[i + 8]
            classify(label, name, p.x, p.y, math.hypot(ext.x * sx, ext.y * sy) * 0.72,
                     p.z + (origin.z - ext.z) * sz, p.z + (origin.z + ext.z) * sz, tr[i + 4], sx)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"eye": EYE, "columns": ["label", "mesh", "x", "y", "dist", "radius", "zmin", "zmax", "yaw", "scale"],
                   "ground": ground, "blocks": blocks, "far": far}, f)
    RESULT.update({"ground": len(ground), "blocks": len(blocks), "far": len(far), "status": "done"})
