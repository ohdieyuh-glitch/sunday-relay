# Editor job, READ-ONLY and CONCURRENT: every generator piece standing inside a court footprint, in trim-spec rows.
#
# For arrival courts (arrival_court.py): lists batch instances (exact stored floats, object name + index) and plain
# StaticMeshActors (index null, location/rotation/scale) whose centre lies within RADIUS of (X, Y) and that rise above
# the floor band -- everything a court would stand inside or around. Walked ground (lawn, terrace platforms, plaza
# slabs, path flags, cobbles) is reported separately as `ground`, never as a trim candidate. Authored layers
# (WL_PASS_* tags) are skipped.
# Globals: X, Y, RADIUS, OUT (json path).
import json

CONCURRENT = True
X = globals().get("X", 0.0)
Y = globals().get("Y", 0.0)
RADIUS = globals().get("RADIUS", 800.0)
OUT = globals().get("OUT")
GROUND_WORDS = ("lawn", "terrace_platform", "plaza_slab", "path_flag", "cobble", "GroundSlab", "MarbleWorld", "kerb_stone")


def job():
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    props, ground = [], []
    for a in eas.get_all_level_actors():
        if any(str(t).startswith("WL_PASS_") for t in a.tags):
            continue
        is_batch = isinstance(a, unreal.WonderlandInstancedBatch)
        if is_batch:
            mesh = a.get_editor_property("mesh")
            if mesh is None:
                continue
            b = mesh.get_bounds()
            tr = list(a.get_editor_property("transforms"))
            for i in range(len(tr) // 9):
                x, y, z = tr[i * 9], tr[i * 9 + 1], tr[i * 9 + 2]
                if (x - X) ** 2 + (y - Y) ** 2 > RADIUS ** 2 or z < -5000:
                    continue
                sx, sy, sz = tr[i * 9 + 6], tr[i * 9 + 7], tr[i * 9 + 8]
                row = {"name": a.get_name(), "label": a.get_actor_label(), "mesh": mesh.get_name(), "index": i,
                       "transform": [round(v, 4) for v in tr[i * 9:(i + 1) * 9]], "x": round(x), "y": round(y),
                       "radius": round(max(b.box_extent.x * abs(sx), b.box_extent.y * abs(sy))),
                       "zmin": round(z + (b.origin.z - b.box_extent.z) * sz), "zmax": round(z + (b.origin.z + b.box_extent.z) * sz)}
                (ground if any(w in mesh.get_name() for w in GROUND_WORDS) else props).append(row)
        elif isinstance(a, unreal.StaticMeshActor):
            c = a.static_mesh_component
            if c is None or c.static_mesh is None:
                continue
            l, r, s = a.get_actor_location(), a.get_actor_rotation(), a.get_actor_scale3d()
            if (l.x - X) ** 2 + (l.y - Y) ** 2 > RADIUS ** 2:
                continue
            b = c.static_mesh.get_bounds()
            row = {"name": a.get_name(), "label": a.get_actor_label(), "mesh": c.static_mesh.get_name(), "index": None,
                   "transform": [round(v, 4) for v in (l.x, l.y, l.z, r.pitch, r.yaw, r.roll, s.x, s.y, s.z)],
                   "x": round(l.x), "y": round(l.y), "radius": round(max(b.box_extent.x * abs(s.x), b.box_extent.y * abs(s.y))),
                   "zmin": round(l.z + (b.origin.z - b.box_extent.z) * s.z), "zmax": round(l.z + (b.origin.z + b.box_extent.z) * s.z)}
            (ground if any(w in row["mesh"] for w in GROUND_WORDS) else props).append(row)
    RESULT["props"] = len(props)
    RESULT["ground"] = len(ground)
    if OUT:
        with open(OUT, "w") as f:
            json.dump({"x": X, "y": Y, "radius": RADIUS, "props": props, "ground": ground}, f, indent=1)
    RESULT["status"] = "done"
    yield 0.0
