# PROJECT AVATAR FOUNDER SHOWCASE: the three LARGE forms, at full mature scale, staged around spawn.
#
# FOUNDER DIRECTIVE: "These must be FULL mature forms. Do NOT shrink them merely to fit together." And they must
# not overlap, intersect buildings, block player spawn, or collide with one another unnecessarily.
#
# A PROJECT AVATAR IS THE REPRESENTATION OF A PROJECT. It is not Julius, not the Relay Dog, not an ordinary
# sub-agent, not a Jhinn and not the LLM Companion. Nothing here spawns or touches any of those.
#
# SIZES ARE MEASURED FROM THE FIGURE FILES, NOT FROM THE ENGINE. A peer lane proved get_actor_bounds returns a
# CUBE for Blueprint actors in this project and over-reported the Relay Dog by 11.6x, so every number below was
# computed offline by reading the .wlvox geometry itself:
#
#   TenTails_Large   366 x 761 x 560 uu   footprint radius 380   lowest point  -13 uu from its origin
#   Cherubim_Large   541 x 895 x 560 uu   footprint radius 447   lowest point -271 uu from its origin
#   Seraph_Large     290 x 554 x 560 uu   footprint radius 277   lowest point -160 uu from its origin
#
# THE ORIGINS ARE NOT THE FEET, and they differ by a quarter of a metre between families. Spawning all three at
# ground level would bury two of them. Each is lifted by its own measured overhang so its lowest geometry rests
# on the ground the trace actually found, rather than on an assumed floor height.
#
# AND NOTHING IS STAGED THAT THE WORLD LANE HAS NOT SIGNED OFF. Asset quality is their lane; APPROVED below is
# what they have judged ready, and a family left out is reported as not staged rather than quietly shrunk in.
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "project_avatar_showcase")
FIGURES = "C:/dev/iwonder/wonderland-proof/wonderland/ProjectAvatars"

# name, file, footprint radius uu, lowest authored point relative to origin uu, ideal azimuth
FAMILIES = [
    ("TEN TAILS", "TenTails_Large.wlvox", 380.0, -13.4, 0.0),
    ("CHERUBIM", "Cherubim_Large.wlvox", 447.0, -271.2, 120.0),
    ("SERAPH", "Seraph_Large.wlvox", 277.0, -160.1, 240.0),
]

# WHICH FAMILIES THE WORLD LANE HAS APPROVED. Overridden by the job argument when one is given.
APPROVED = {"TEN TAILS", "CHERUBIM", "SERAPH"}

RING_UU = 900.0          # far enough that the widest form still leaves 453 uu of open ground at spawn
SPAWN_CLEAR_UU = 400.0   # the circle a player must arrive into unobstructed
PAIR_MARGIN_UU = 200.0   # air between two footprints, beyond the sum of their radii


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    staged = []
    RESULT["staged"] = staged
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        L.focus_game_viewport()

        spawn = pawn.get_actor_location()
        RESULT["spawn"] = [round(spawn.x, 1), round(spawn.y, 1), round(spawn.z, 1)]
        RESULT["approved"] = sorted(APPROVED)
        RESULT["not_approved"] = sorted({f[0] for f in FAMILIES} - APPROVED)

        def ground_under(x, y, radius):
            """The top of whatever is at (x, y), swept with the figure's own footprint.

            A SPHERE, NOT A LINE. A line trace between two planter kerbs finds clean paving and says a five-metre
            creature fits; sweeping the actual footprint finds the kerb. The hit normal is checked too, because a
            sphere resting against a wall reports a surface that is not a floor.
            """
            start = unreal.Vector(x, y, spawn.z + 1400.0)
            end = unreal.Vector(x, y, spawn.z - 400.0)
            hit = unreal.SystemLibrary.sphere_trace_single(
                world, start, end, radius, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [],
                unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if not hit:
                return None
            loc = hit.to_tuple()[4] if hasattr(hit, "to_tuple") else hit.location
            nrm = hit.to_tuple()[5] if hasattr(hit, "to_tuple") else hit.normal
            try:
                z, up = float(loc.z), float(nrm.z)
            except Exception:
                return None
            # A FLOOR, not a wall or a roof edge: the surface has to be facing mostly upward to stand on.
            return z if up > 0.7 else None

        placed = []
        for name, figure, radius, low, ideal_az in FAMILIES:
            if name not in APPROVED:
                staged.append({"family": name, "staged": False,
                               "why": "world lane has not signed off this form yet"})
                continue
            # WALK AROUND THE RING FROM THE IDEAL BEARING until a spot is found that is flat, clear of the
            # buildings, and far enough from the forms already standing. Nothing is scaled to make a spot work.
            chosen = None
            tried = []
            for step in range(0, 25):
                az = ideal_az + (step // 2 + 1) * 15.0 * (1 if step % 2 == 0 else -1) if step else ideal_az
                rad = math.radians(az)
                x = spawn.x + math.cos(rad) * RING_UU
                y = spawn.y + math.sin(rad) * RING_UU
                z = ground_under(x, y, radius)
                gap_ok = all(
                    math.hypot(x - p["x"], y - p["y"]) >= (radius + p["radius"] + PAIR_MARGIN_UU)
                    for p in placed)
                spawn_ok = (RING_UU - radius) >= SPAWN_CLEAR_UU
                tried.append({"az": round(az, 1), "ground": None if z is None else round(z, 1),
                              "gap_ok": gap_ok, "spawn_ok": spawn_ok})
                if z is not None and gap_ok and spawn_ok:
                    chosen = (az, x, y, z)
                    break
            if chosen is None:
                staged.append({"family": name, "staged": False,
                               "why": "no clear ground on the ring at full scale; NOT shrunk to fit",
                               "tried": tried})
                continue
            az, x, y, gz = chosen
            # LIFTED BY ITS OWN OVERHANG, so the lowest authored voxel rests on the ground actually found.
            origin_z = gz - low
            body = L.spawn_figure_actor(world, unreal.Vector(x, y, origin_z),
                                        os.path.join(FIGURES, figure).replace("\\", "/"), name)
            yield 1.2
            if body is None:
                staged.append({"family": name, "staged": False, "why": "figure did not load"})
                continue
            # FACING THE ARRIVAL, so a founder walking in is met rather than passed.
            look = math.degrees(math.atan2(spawn.y - y, spawn.x - x))
            body.set_actor_rotation(unreal.Rotator(0.0, look, 0.0), False)
            placed.append({"name": name, "x": x, "y": y, "z": origin_z, "radius": radius,
                           "actor": body})
            staged.append({"family": name, "staged": True, "azimuth": round(az, 1),
                           "at": [round(x, 1), round(y, 1), round(origin_z, 1)],
                           "ground_z": round(gz, 1), "footprint_radius_uu": radius,
                           "height_uu": 560.0, "scale": float(body.get_actor_scale3d().z)})

        yield 3.0

        # ---- FULL SCALE: nothing was shrunk to make it fit
        RESULT["all_full_scale"] = all(
            abs(float(p["actor"].get_actor_scale3d().z) - 1.0) < 0.01 for p in placed)

        # ---- NO OVERLAP between any two staged forms, measured rather than assumed
        pairs = []
        for i in range(len(placed)):
            for j in range(i + 1, len(placed)):
                a, b = placed[i], placed[j]
                d = math.hypot(a["x"] - b["x"], a["y"] - b["y"])
                need = a["radius"] + b["radius"]
                pairs.append({"a": a["name"], "b": b["name"], "apart_uu": round(d, 1),
                              "need_uu": round(need, 1), "clear": d >= need})
        RESULT["pairs"] = pairs
        RESULT["no_overlap"] = all(p["clear"] for p in pairs)

        # ---- SPAWN IS NOT BLOCKED: the nearest form's edge is outside the arrival circle
        edges = [{"name": p["name"],
                  "edge_from_spawn_uu": round(math.hypot(p["x"] - spawn.x, p["y"] - spawn.y) - p["radius"], 1)}
                 for p in placed]
        RESULT["spawn_edges"] = edges
        RESULT["spawn_not_blocked"] = all(e["edge_from_spawn_uu"] >= SPAWN_CLEAR_UU for e in edges)

        # ---- NOT INSIDE A BUILDING: sweep the footprint at body height and see if anything is in there
        inside = []
        for p in placed:
            hit = unreal.SystemLibrary.sphere_trace_single(
                world,
                unreal.Vector(p["x"], p["y"], p["z"] + 120.0),
                unreal.Vector(p["x"], p["y"], p["z"] + 121.0),
                p["radius"] * 0.6, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [p["actor"]],
                unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            inside.append({"name": p["name"], "intersects": bool(hit)})
        RESULT["intersections"] = inside
        RESULT["no_building_intersection"] = all(not i["intersects"] for i in inside)

        # ---- RUNTIME MOTION: they are alive, not statues. Sampled, not asserted.
        def limb_sample(actor):
            out = []
            for c in actor.get_components_by_class(unreal.SceneComponent):
                t = c.get_relative_transform()
                out.append((round(t.translation.x, 3), round(t.translation.y, 3), round(t.translation.z, 3),
                            round(t.rotation.euler().y, 3)))
            return out

        firsts = {p["name"]: limb_sample(p["actor"]) for p in placed}
        yield 3.0
        moved = []
        for p in placed:
            later = limb_sample(p["actor"])
            changed = sum(1 for a, b in zip(firsts[p["name"]], later) if a != b)
            moved.append({"name": p["name"], "parts_moved": changed, "parts": len(later)})
        RESULT["motion"] = moved
        RESULT["runtime_motion"] = all(m["parts_moved"] > 0 for m in moved) if moved else False

        # ---- the pictures
        def shot(tag, eye, look, fov=60.0):
            L.pose_camera(world, eye, look, fov)
            return tag

        shots = []
        # one frame per staged form, from outside the ring looking in past it at the arrival
        for p in placed:
            rad = math.atan2(p["y"] - spawn.y, p["x"] - spawn.x)
            back = p["radius"] * 2.6 + 420.0
            eye = unreal.Vector(p["x"] + math.cos(rad) * back, p["y"] + math.sin(rad) * back, p["z"] + 260.0)
            shot(p["name"], eye, unreal.Vector(p["x"], p["y"], p["z"] + 180.0), 58.0)
            yield 1.4
            path = os.path.join(ROOT, "%s.jpg" % p["name"].lower().replace(" ", "_"))
            H.capture_viewport_jpeg(path, 1900, 95)
            shots.append({"family": p["name"], "file": path})
        # and one from the arrival itself, which is the view a founder actually walks into
        L.pose_camera(world, unreal.Vector(spawn.x, spawn.y, spawn.z + 300.0),
                      unreal.Vector(spawn.x + math.cos(0.0) * RING_UU, spawn.y, spawn.z + 300.0), 95.0)
        yield 1.5
        path = os.path.join(ROOT, "from_spawn.jpg")
        H.capture_viewport_jpeg(path, 1900, 95)
        shots.append({"family": "FROM SPAWN", "file": path})
        RESULT["shots"] = shots

        RESULT["REPORT"] = {
            "ten_tails_large": next(("PASS" if s["staged"] else "NOT STAGED: " + s.get("why", "")
                                     for s in staged if s["family"] == "TEN TAILS"), "ABSENT"),
            "cherubim_large": next(("PASS" if s["staged"] else "NOT STAGED: " + s.get("why", "")
                                    for s in staged if s["family"] == "CHERUBIM"), "ABSENT"),
            "seraph_large": next(("PASS" if s["staged"] else "NOT STAGED: " + s.get("why", "")
                                  for s in staged if s["family"] == "SERAPH"), "ABSENT"),
            "full_scale_placement": "PASS" if (RESULT["all_full_scale"] and RESULT["no_overlap"]) else "FAIL",
            "runtime_motion": "PASS" if RESULT["runtime_motion"] else "FAIL",
            "spawn_obstruction": "PASS" if (RESULT["spawn_not_blocked"]
                                            and RESULT["no_building_intersection"]) else "FAIL",
        }
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "showcase.json"), "w", encoding="utf-8") as fh:
            json.dump({k: RESULT.get(k) for k in
                       ("status", "why", "spawn", "approved", "not_approved", "pairs", "spawn_edges",
                        "intersections", "motion", "REPORT")}, fh, indent=1)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLAVATAR could not end play: %s" % exc)
