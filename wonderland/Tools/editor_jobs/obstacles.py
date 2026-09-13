# Editor job: every non-ground thing standing in a box, as a circle (centre, horizontal radius,
# z range), from mesh bounds x instance scale. Designs use it to keep new pieces out of old ones.
import math

BOX = globals().get("BOX", (-3000.0, 3000.0, 4200.0, 10000.0))
GROUNDISH = ("path_flag", "plaza_slab", "cobble_slab", "kerb", "terrace_platform", "garden_lawn", "groundslab", "cube", "marbleworld", "portal")


def job():
    yield 0.1
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    rows = []
    bounds_cache = {}

    def mesh_ext(mesh):
        key = mesh.get_path_name()
        if key not in bounds_cache:
            b = mesh.get_bounds()
            bounds_cache[key] = (b.origin, b.box_extent)
        return bounds_cache[key]

    for a in eas.get_all_level_actors():
        if isinstance(a, unreal.StaticMeshActor):
            smc = a.static_mesh_component
            mesh = smc.static_mesh if smc else None
            if mesh is None or any(w in (mesh.get_name() + a.get_actor_label()).lower() for w in GROUNDISH):
                continue
            o, e = a.get_actor_bounds(False)
            if BOX[0] <= o.x <= BOX[1] and BOX[2] <= o.y <= BOX[3]:
                rows.append([a.get_actor_label(), mesh.get_name(), round(o.x), round(o.y), round(math.hypot(e.x, e.y)), round(o.z - e.z), round(o.z + e.z)])
        elif isinstance(a, unreal.WonderlandInstancedBatch):
            mesh = a.get_editor_property("mesh")
            if mesh is None or any(w in mesh.get_name().lower() for w in GROUNDISH):
                continue
            origin, ext = mesh_ext(mesh)
            tr = list(a.get_editor_property("transforms"))
            tf = a.get_actor_transform()
            for i in range(0, len(tr) - 8, 9):
                p = tf.transform_location(unreal.Vector(tr[i], tr[i + 1], tr[i + 2]))
                if BOX[0] <= p.x <= BOX[1] and BOX[2] <= p.y <= BOX[3]:
                    sx, sy, sz = abs(tr[i + 6]), abs(tr[i + 7]), abs(tr[i + 8])
                    r = math.hypot(ext.x * sx, ext.y * sy)
                    rows.append([str(a.get_editor_property("batch_name")), mesh.get_name(), round(p.x), round(p.y), round(r),
                                 round(p.z + (origin.z - ext.z) * sz), round(p.z + (origin.z + ext.z) * sz)])
    RESULT["obstacles"] = rows
    RESULT["status"] = "done"
