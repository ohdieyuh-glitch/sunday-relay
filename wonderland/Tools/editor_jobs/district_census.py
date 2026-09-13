# Editor job, READ-ONLY and CONCURRENT: what stands around each travel destination, for arrival-court design.
#
# For every centre within RADIUS: SOLIDS (anything that is not walked ground: label, mesh, x, y, horizontal radius,
# zmin, zmax -- mesh bounds x instance scale, as obstacles.py) and GROUND (the walked surfaces a design must keep
# open: paths, plazas, cobbles, kerbs, terraces -- mesh, x, y, horizontal radius, ztop). Batch instances count
# one row each. One pass over the level. Reads the editor world through the map object, never PIE.
# Globals: CENTRES [[id, x, y], ...], RADIUS (uu), OUT (json path).
import json
import math

CONCURRENT = True
MAP_OBJECT = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2.WL_V2_GoldenArrival_WP2"
CENTRES = globals().get("CENTRES", [])
RADIUS = globals().get("RADIUS", 6500.0)
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/district_census.json")
GROUND = ("path_flag", "plaza_slab", "cobble_slab", "kerb", "terrace_platform", "groundslab", "path_", "plaza_", "paving",
          "flagstone", "step", "stair")
IGNORE = ("garden_lawn", "cube", "marbleworld", "portal", "sky", "cloud", "ground_flowers", "ground_blooms", "grass")


def _near(x, y):
    out = []
    for cid, cx, cy in CENTRES:
        if abs(x - cx) <= RADIUS and abs(y - cy) <= RADIUS:
            out.append(cid)
    return out


def job():
    world = unreal.find_object(None, MAP_OBJECT)
    GS = unreal.GameplayStatics
    data = {cid: {"centre": [cx, cy], "solids": [], "ground": []} for cid, cx, cy in CENTRES}
    cache = {}
    n = 0

    def classify(name):
        low = name.lower()
        if any(w in low for w in IGNORE):
            return None
        return "ground" if any(w in low for w in GROUND) else "solids"

    for a in GS.get_all_actors_of_class(world, unreal.StaticMeshActor):
        n += 1
        if n % 2000 == 0:
            yield None
        smc = a.static_mesh_component
        mesh = smc.static_mesh if smc else None
        if mesh is None:
            continue
        kind = classify(mesh.get_name())
        if kind is None:
            continue
        o, e = a.get_actor_bounds(False)
        for cid in _near(o.x, o.y):
            r = round(math.hypot(e.x, e.y))
            if kind == "solids":
                data[cid]["solids"].append([a.get_actor_label(), mesh.get_name(), round(o.x), round(o.y), r, round(o.z - e.z), round(o.z + e.z)])
            else:
                data[cid]["ground"].append([mesh.get_name(), round(o.x), round(o.y), r, round(o.z + e.z)])
    for b in GS.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        n += 1
        if n % 100 == 0:
            yield None
        mesh = b.get_editor_property("mesh")
        if mesh is None:
            continue
        kind = classify(mesh.get_name())
        if kind is None:
            continue
        key = mesh.get_path_name()
        if key not in cache:
            bb = mesh.get_bounds()
            cache[key] = (bb.origin, bb.box_extent)
        origin, ext = cache[key]
        tr = list(b.get_editor_property("transforms"))
        tf = b.get_actor_transform()
        label = str(b.get_editor_property("batch_name"))
        for i in range(0, len(tr) - 8, 9):
            p = tf.transform_location(unreal.Vector(tr[i], tr[i + 1], tr[i + 2]))
            ids = _near(p.x, p.y)
            if not ids:
                continue
            sx, sy, sz = abs(tr[i + 6]), abs(tr[i + 7]), abs(tr[i + 8])
            r = round(math.hypot(ext.x * sx, ext.y * sy))
            for cid in ids:
                if kind == "solids":
                    data[cid]["solids"].append([label, mesh.get_name(), round(p.x), round(p.y), r,
                                                round(p.z + (origin.z - ext.z) * sz), round(p.z + (origin.z + ext.z) * sz)])
                else:
                    data[cid]["ground"].append([mesh.get_name(), round(p.x), round(p.y), r, round(p.z + (origin.z + ext.z) * sz)])
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"radius": RADIUS, "columns": {"solids": ["label", "mesh", "x", "y", "r", "zmin", "zmax"],
                                                 "ground": ["mesh", "x", "y", "r", "ztop"]}, "destinations": data}, f)
    RESULT.update({"counts": {cid: [len(v["solids"]), len(v["ground"])] for cid, v in data.items()}, "status": "done"})
