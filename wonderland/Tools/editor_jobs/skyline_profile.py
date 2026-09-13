# Editor job: the SKYLINE PROFILE seen from one eye point -- for every degree of azimuth, the highest
# elevation angle any existing non-ground piece reaches, and how far away that piece stands.
#
# Skyline work places tall things where the horizon is LOW. Guessing from a render hides the one
# number that matters (is this gap 2 degrees of sky or 12?), and a render cannot say which of two
# overlapping towers is nearer. Bounds overestimate a silhouette (a cone's box is a block), so the
# profile is an upper bound on what is really there: a gap it reports is a real gap.
#
# READ-ONLY, AND SAFE DURING PLAY-IN-EDITOR. EditorActorSubsystem refuses every call while PIE runs,
# so the editor world is found by its object path and read through GameplayStatics.
#
# Globals: EYE (x, y, z), FROM_CAMERA (actor label, overrides EYE and records its yaw/FOV),
# MIN_DIST (ignore pieces nearer than this, uu), OUT (json path).
import json
import math

CONCURRENT = True

EYE = globals().get("EYE", (0.0, -150.0, 262.0))
FROM_CAMERA = globals().get("FROM_CAMERA", "HeroCam_GoldenArrivalBible")
MIN_DIST = globals().get("MIN_DIST", 3000.0)
MAP_OBJECT = "/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2.WL_V2_GoldenArrival_WP2"
OUT = globals().get("OUT")
GROUNDISH = ("path_flag", "plaza_slab", "cobble_slab", "kerb", "terrace_platform", "garden_lawn", "groundslab", "marbleworld", "portal", "skydome", "sky_sphere", "cloud")


def job():
    yield 0.1
    world = unreal.find_object(None, MAP_OBJECT)
    if world is None:
        raise RuntimeError("the map is not loaded in this editor: " + MAP_OBJECT)
    GS = unreal.GameplayStatics
    actors = []
    for cls in (unreal.StaticMeshActor, unreal.WonderlandInstancedBatch, unreal.CameraActor):
        actors.extend(GS.get_all_actors_of_class(world, cls))
    eye = unreal.Vector(*EYE)
    if FROM_CAMERA:
        cam = next((a for a in actors if a.get_actor_label() == FROM_CAMERA), None)
        if cam is not None:
            eye = cam.get_actor_location()
            RESULT["camera"] = {"label": FROM_CAMERA, "loc": eye.to_tuple(), "rot": cam.get_actor_rotation().to_tuple()}
            comp = cam.get_component_by_class(unreal.CameraComponent)
            if comp is not None:
                RESULT["camera"]["fov"] = comp.get_editor_property("field_of_view")
    best = [[-90.0, None, None] for _ in range(360)]   # elevation deg, distance uu, label
    cache = {}

    def mesh_box(mesh):
        key = mesh.get_path_name()
        if key not in cache:
            b = mesh.get_bounds()
            cache[key] = (b.origin, b.box_extent)
        return cache[key]

    def splat(cx, cy, radius, top, label):
        dx, dy = cx - eye.x, cy - eye.y
        dist = math.hypot(dx, dy)
        if dist < MIN_DIST or dist < radius + 1.0:
            return
        elev = math.degrees(math.atan2(top - eye.z, dist))
        az = math.degrees(math.atan2(dy, dx))
        half = math.degrees(math.asin(min(1.0, radius / dist)))
        for d in range(int(math.floor(az - half)), int(math.ceil(az + half)) + 1):
            cell = best[d % 360]
            if elev > cell[0]:
                cell[0], cell[1], cell[2] = elev, dist, label

    pieces = 0
    for n, a in enumerate(actors):
        if n % 1500 == 1499:
            yield None      # spread the read over frames: the founder may be playing
        if isinstance(a, unreal.StaticMeshActor):
            smc = a.static_mesh_component
            mesh = smc.static_mesh if smc else None
            if mesh is None or any(w in (mesh.get_name() + a.get_actor_label()).lower() for w in GROUNDISH):
                continue
            o, e = a.get_actor_bounds(False)
            splat(o.x, o.y, math.hypot(e.x, e.y) * 0.72, o.z + e.z, a.get_actor_label())
            pieces += 1
        elif isinstance(a, unreal.WonderlandInstancedBatch):
            mesh = a.get_editor_property("mesh")
            if mesh is None or any(w in mesh.get_name().lower() for w in GROUNDISH):
                continue
            origin, ext = mesh_box(mesh)
            tr = list(a.get_editor_property("transforms"))
            tf = a.get_actor_transform()
            label = str(a.get_editor_property("batch_name")) or a.get_actor_label()
            for i in range(0, len(tr) - 8, 9):
                p = tf.transform_location(unreal.Vector(tr[i], tr[i + 1], tr[i + 2]))
                sx, sy, sz = tr[i + 6], tr[i + 7], tr[i + 8]
                top = p.z + (origin.z + ext.z) * sz
                splat(p.x, p.y, math.hypot(ext.x * sx, ext.y * sy) * 0.72, top, label)
                pieces += 1
    RESULT["pieces"] = pieces
    RESULT["eye"] = eye.to_tuple()
    RESULT["profile"] = [[d, round(c[0], 2), None if c[1] is None else round(c[1]), c[2]] for d, c in enumerate(best)]
    if OUT:
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(RESULT, f, indent=1, default=str)
    RESULT["status"] = "done"
