# PIE job v2: arrival spots that are SAFE (the teleport's own landing rule), on WALKABLE ground
# (a plaza, path, lawn or terrace, never a hedge top or a wall), with a CLEAR third-person camera
# and a REAL VIEW along the canonical arrival facing. Visual clutter is judged from mesh bounds as
# well as collision, because foliage and many props have no collision and traces cannot see them.
import math
import os

CAPTURES = os.path.join(os.path.dirname(CHANNEL), "captures", "anchors_v2")
RINGS = [0.0, 150.0, 300.0, 500.0, 750.0, 1000.0, 1400.0, 1800.0]
ANGLES = 16
WALKABLE = ("slab", "plaza", "ground", "terrace", "platform", "path", "cobble", "paving", "floor", "grass",
            "lawn", "field", "fill", "road", "street", "tile", "step", "stair", "bridge", "deck", "court", "square", "walk")
RAISED_OK = ("terrace", "platform", "stair", "step", "bridge", "deck")
GROUNDISH = WALKABLE + ("kerb", "water", "pond", "flower", "petal", "moss", "clover", "rug", "shadow", "decal", "cloud", "sky")
CELL = 500.0


def _unwrap(ret):
    if isinstance(ret, tuple):
        if len(ret) >= 2 and isinstance(ret[0], bool):
            return ret[1] if ret[0] else None
        return ret[0] if ret else None
    return ret


def _hit_fields(hit):
    t = hit.to_tuple()
    vectors = [x for x in t if isinstance(x, unreal.Vector)]
    actor = next((x for x in t if isinstance(x, unreal.Actor)), None)
    comp = next((x for x in t if isinstance(x, unreal.PrimitiveComponent)), None)
    blocking = t[0] if isinstance(t[0], bool) else True
    location = vectors[0] if vectors else None
    impact_normal = vectors[3] if len(vectors) > 3 else (vectors[2] if len(vectors) > 2 else None)
    return blocking, location, impact_normal, actor, comp


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    os.makedirs(CAPTURES, exist_ok=True)
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 4.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    travel = next((c for c in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if c.get_world() == world), None)
    capsule = pawn.get_component_by_class(unreal.CapsuleComponent)
    hh = capsule.get_scaled_capsule_half_height()
    arm = pawn.get_component_by_class(unreal.SpringArmComponent)
    if arm is not None:
        RESULT["spring_arm"] = {"length": arm.get_editor_property("target_arm_length"),
                                "socket_offset": arm.get_editor_property("socket_offset").to_tuple(),
                                "relative": arm.get_editor_property("relative_location").to_tuple()}

    # ---- clutter index from bounds: batch instances and plain mesh actors ----
    cells = {}

    def add_box(minx, maxx, miny, maxy, zmin, zmax, tag):
        for ix in range(int(math.floor(minx / CELL)), int(math.floor(maxx / CELL)) + 1):
            for iy in range(int(math.floor(miny / CELL)), int(math.floor(maxy / CELL)) + 1):
                cells.setdefault((ix, iy), []).append((minx, maxx, miny, maxy, zmin, zmax, tag))

    boxes = 0
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        tag = str(b.get_editor_property("batch_name")).lower()
        if any(w in tag for w in GROUNDISH):
            continue
        mesh = b.get_editor_property("mesh")
        if mesh is None:
            continue
        bounds = mesh.get_bounds()
        ext, org = bounds.box_extent, bounds.origin
        tf = b.get_actor_transform()
        tr = list(b.get_editor_property("transforms"))
        for i in range(0, len(tr) - 8, 9):
            sx, sy, sz = abs(tr[i + 6]), abs(tr[i + 7]), abs(tr[i + 8])
            half = math.hypot(ext.x * sx, ext.y * sy)
            if half < 35.0 and ext.z * sz < 60.0:
                continue  # small enough to neither block a view nor bury a camera
            c = tf.transform_location(unreal.Vector(tr[i], tr[i + 1], tr[i + 2]))
            cz = c.z + org.z * sz
            add_box(c.x - half, c.x + half, c.y - half, c.y + half, cz - ext.z * sz, cz + ext.z * sz, tag)
            boxes += 1
    for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
        tag = a.get_actor_label().lower()
        if any(w in tag for w in GROUNDISH):
            continue
        origin, extent = a.get_actor_bounds(False)
        if max(extent.x, extent.y) > 2500.0 or (max(extent.x, extent.y) < 35.0 and extent.z < 60.0):
            continue
        add_box(origin.x - extent.x, origin.x + extent.x, origin.y - extent.y, origin.y + extent.y,
                origin.z - extent.z, origin.z + extent.z, tag)
        boxes += 1
    RESULT["clutter_boxes"] = boxes

    def boxes_near(x, y):
        return cells.get((int(math.floor(x / CELL)), int(math.floor(y / CELL))), ())

    def point_hits(x, y, z, pad):
        n = 0
        for (minx, maxx, miny, maxy, zmin, zmax, tag) in boxes_near(x, y):
            if minx - pad <= x <= maxx + pad and miny - pad <= y <= maxy + pad and zmin - pad <= z <= zmax + pad:
                n += 1
        return n

    channel = unreal.TraceTypeQuery.TRACE_TYPE_QUERY1
    ignore = [pawn]

    def trace(a, b):
        hit = _unwrap(unreal.SystemLibrary.line_trace_single(world, a, b, channel, False, ignore, unreal.DrawDebugTrace.NONE, True))
        if hit is None:
            return None
        blocking, loc, normal, actor, comp = _hit_fields(hit)
        if not blocking or loc is None:
            return None
        return loc, normal, actor, comp

    def floors_at(x, y):
        found, top = [], 60000.0
        for _ in range(14):
            r = trace(unreal.Vector(x, y, top), unreal.Vector(x, y, -20000.0))
            if r is None:
                break
            loc, normal, actor, comp = r
            if normal is not None and normal.z >= 0.7:
                found.append((loc.z, actor.get_actor_label() if actor else "", comp.get_name() if comp else ""))
            nxt = loc.z - 2.0
            top = nxt if nxt < top - 1.0 else top - 50.0
            if top < -19000.0:
                break
        return found

    def free(origin, yaw_deg, limit, dz=0.0):
        rad = math.radians(yaw_deg)
        end = unreal.Vector(origin.x + math.cos(rad) * limit, origin.y + math.sin(rad) * limit, origin.z + dz)
        r = trace(origin, end)
        return limit if r is None else math.dist((r[0].x, r[0].y, r[0].z), (origin.x, origin.y, origin.z))

    settings = unreal.get_default_object(unreal.load_class(None, "/Script/Wonderland.WonderlandTravelSettings"))
    anchors = []
    for row in settings.get_editor_property("destinations"):
        rid = str(row.get_editor_property("id"))
        status = getattr(row.get_editor_property("status"), "name", "?")
        seed = row.get_editor_property("seed_xy")
        yaw = float(row.get_editor_property("arrival_yaw_deg"))
        fx, fy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        raw = []
        for ring in RINGS:
            for k in range(1 if ring == 0.0 else ANGLES):
                ang = 2.0 * math.pi * k / ANGLES
                x, y = seed.x + math.cos(ang) * ring, seed.y + math.sin(ang) * ring
                for (fz, label, comp_name) in floors_at(x, y):
                    words = (label + " " + comp_name).lower()
                    if not any(w in words for w in WALKABLE):
                        continue
                    raw.append((x, y, fz, label, comp_name, words, math.hypot(x - seed.x, y - seed.y)))
        entry = {"id": rid, "status": status, "seed": [seed.x, seed.y], "yaw": yaw, "walkable_floors": len(raw), "placed": False}
        if not raw:
            entry["reason"] = "no walkable floor within %d m of the seed" % int(RINGS[-1] / 100)
            anchors.append(entry)
            emit(rid, "NOT placed:", entry["reason"])
            continue
        lowest = min(r[2] for r in raw)
        scored = []
        for (x, y, fz, label, comp_name, words, d2d) in raw:
            if fz > lowest + 80.0 and not any(w in words for w in RAISED_OK):
                continue
            near = point_hits(x, y, fz + 120.0, 110.0)
            boom = sum(point_hits(x - fx * d, y - fy * d, fz + 170.0 + d * 0.15, 35.0) for d in (80.0, 160.0, 240.0, 320.0, 400.0))
            ahead = sum(point_hits(x + fx * d, y + fy * d, fz + 150.0, 25.0) for d in (150.0, 300.0, 450.0, 600.0, 800.0))
            if near > 0 or boom > 1:
                continue
            stand = _unwrap(travel.probe_arrival(unreal.Vector(x, y, fz)))
            if stand is None:
                continue
            ground = stand.z - hh - 4.0
            if abs(ground - fz) > 60.0:
                continue
            eye = unreal.Vector(stand.x, stand.y, ground + hh + 90.0)
            view = free(eye, yaw, 4000.0)
            boom_free = free(unreal.Vector(stand.x, stand.y, ground + hh + 60.0), yaw + 180.0, 450.0, 120.0)
            if view < 600.0 or boom_free < 300.0:
                continue
            chest = unreal.Vector(stand.x, stand.y, ground + hh + 40.0)
            open_dirs = sum(1 for d in range(8) if free(chest, d * 45.0, 500.0) >= 300.0)
            if open_dirs < 5:
                continue
            up = trace(chest, unreal.Vector(stand.x, stand.y, chest.z + 4000.0))
            cover = None if up is None else (up[0].z - chest.z) / 100.0
            score = min(view, 3000.0) / 60.0 + open_dirs * 3.0 - boom * 12.0 - ahead * 6.0 - d2d / 80.0 - (25.0 if (cover is not None and cover < 4.0) else 0.0)
            scored.append({"score": round(score, 1), "stand": [stand.x, stand.y, stand.z], "ground": ground, "floor": label,
                           "view": round(view), "boom_free": round(boom_free), "open8": open_dirs, "boom_hits": boom,
                           "ahead_hits": ahead, "cover_m": None if cover is None else round(cover, 1), "d2d": round(d2d)})
        scored.sort(key=lambda c: -c["score"])
        entry["qualified"] = len(scored)
        entry["top3"] = scored[:3]
        if scored:
            best = scored[0]
            entry.update({"placed": True, "location": [best["stand"][0], best["stand"][1], best["ground"]], "best": best})
        else:
            entry["reason"] = "walkable floors exist but none gives a clear camera and a real view along the arrival facing"
        anchors.append(entry)
        emit(rid, "placed" if entry["placed"] else "NOT placed", entry.get("reason", ""), "qualified", len(scored), "of", len(raw))
        if entry["placed"]:
            loc = entry["location"]
            pawn.set_actor_location_and_rotation(unreal.Vector(loc[0], loc[1], loc[2] + hh + 6.0), unreal.Rotator(roll=0.0, pitch=0.0, yaw=yaw), False, True)
            pc.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-6.0, yaw=yaw))
            yield 4.0
            shot = os.path.join(CAPTURES, "%02d_%s.png" % (len(anchors), rid))
            ok = unreal.WonderlandUiTestLibrary.capture_game_viewport(shot)
            entry["capture"] = shot if (ok is True or (isinstance(ok, tuple) and ok and ok[0])) else None

    RESULT["anchors"] = anchors
    RESULT["placed"] = sum(1 for a in anchors if a["placed"])
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    RESULT["status"] = "done"
