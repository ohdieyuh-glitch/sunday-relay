# SKELETON V2: THE SKULL ON THE CHEST IN THE BODY'S OWN GREY, ITS EYES WHITE AND SEPARATE -- AND THE FACE AS IT WAS.
#
# FOUNDER, 2026-09-28, with two photographs of the close front view, and then the deciding note:
#   "The skull/head must be the SAME charcoal/dark-gray color as the gray body portion of this exact mascot skin ...
#    Eyes remain WHITE and glowing. Do NOT make the skull emissive. Do NOT let eye bloom turn the skull white ...
#    verify it IN THE ACTUAL GAME VIEW under the same lighting shown in the founder screenshots. Required visual
#    proof: 1. close front view; 2. normal gameplay-distance view; 3. side/angled view."
#   "NO keep the face of the mascot skin of the skeleton mascot skin grey just make the skeleton on the chest gray
#    as well."
#
# THE PHOTOGRAPHS' LIGHTING is the dusk run of zc_skull_flame_proof: the same 150 uu front pose at wl.Sky.Hour 18.
# That frame is taken again here, then noon and night, then the 3/4 and side views and gameplay distance.
#
# FOUND BY WHAT THINGS ARE, NOT BY WHAT THEY ARE CALLED. The costume's instanced components are classified by their
# material's own parameters and by where their instances stand: the head eyes and the chest eyes are the two
# TWO-instance glow components (the higher pair is the head); the skull's dark features are the `void` instances
# around the chest eyes; the grey is every instance of the `bone` coat (read off BaseColor). The full table is
# published so the classification can be checked against the capture.
#
# THE GATES ARE RELATIVE. The chest skull's surface against the body's own grey in the same frame (same material,
# same light); eye cores against the gap between them; white pixels on the skull outside its two eyes.
#
# NOT CONCURRENT: this job owns PIE. Every knob it moves is read first and put back.
CONCURRENT = False

import math
import os
import sys
import time
import unreal

L = unreal.WonderlandUiTestLibrary
TOOLS = os.path.dirname(CHANNEL)
PROJECT = os.path.dirname(TOOLS)
ROOT = os.path.join(TOOLS, "captures", "zc", "skull_head_0928")
SKIN_FILE = os.path.join(PROJECT, "Saved", "Wonderland", "RelaySkin.txt")
VOID = (0.030, 0.040, 0.060)
VISOR = (0.045, 0.042, 0.050)
BONE = (0.898, 0.871, 0.800)
HOURS = (("dusk", 18.0), ("noon", 12.0), ("night", 23.6))


def job():
    sys.path.insert(0, TOOLS)
    from night_figure import read                                    # noqa: WPS433

    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".png", ".jpg")):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    SL = unreal.SystemLibrary
    minutes_before = SL.get_console_variable_float_value("wl.Sky.DayMinutes")
    try:
        with open(SKIN_FILE, encoding="utf-8") as fh:
            skin_before = fh.read().strip() or "relay_og"
    except OSError:
        skin_before = "relay_og"
    RESULT["restore"] = {"wl.Sky.DayMinutes": minutes_before, "skin": skin_before}

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    L.focus_game_viewport()
    yield 6.0

    def alive():
        w = ues.get_game_world()
        if w is None:
            return None, None
        p = unreal.GameplayStatics.get_player_pawn(w, 0)
        return (w, p) if p is not None else (None, None)

    world, dog = alive()
    if world is None:
        RESULT["status"] = "VOID: no play world or pawn"
        return
    SL.execute_console_command(world, "wl.Sky.DayMinutes 0")
    ui = L.get_ui(world)
    # through relay_og first, so the costume is BUILT AGAIN from the file on disk (the figure cache is keyed by
    # the file's timestamp, and wearing the skin already worn does nothing)
    ui.wear_relay_skin("relay_og")
    yield 3.0
    ui.wear_relay_skin("skeleton_flame")
    yield 8.0

    def restore():
        w = ues.get_game_world()
        try:
            SL.execute_console_command(w, "wl.Sky.DayMinutes %g" % minutes_before)
            if w is not None:
                L.release_camera(w)
                u = L.get_ui(w)
                if u is not None:
                    u.wear_relay_skin(skin_before)
        except Exception as err:                                     # noqa: BLE001
            RESULT["restore_error"] = str(err)[:200]

    def worn_costume(w, pawn):
        for actor in unreal.GameplayStatics.get_all_actors_of_class(w, unreal.WonderlandCompanionEmbodiment):
            if actor.get_attach_parent_actor() == pawn:
                return actor
        return None

    def vec_param(mat, name):
        for fn in ("k2_get_vector_parameter_value", "get_vector_parameter_value"):
            try:
                return getattr(mat, fn)(name)
            except Exception:                                        # noqa: BLE001
                continue
        return None

    def near(col, ref, tol=0.012):
        return col is not None and abs(col.r - ref[0]) < tol and abs(col.g - ref[1]) < tol and abs(col.b - ref[2]) < tol

    def instances(comp):
        out = []
        for i in range(comp.get_instance_count()):
            t = comp.get_instance_transform(i, True)
            if isinstance(t, tuple):
                t = t[-1]
            out.append(t.translation)
        return out

    def anatomy(fig):
        table = []
        glow_pairs = []
        charcoal = []
        visor = []
        bone = []
        for c in fig.get_components_by_class(unreal.InstancedStaticMeshComponent):
            mat = c.get_material(0)
            col = vec_param(mat, "Color") if mat else None
            base = vec_param(mat, "BaseColor") if mat else None
            pts = instances(c)
            n = len(pts)
            zs = [p.z for p in pts]
            table.append({"n": n, "mat": mat.get_name() if mat else None,
                          "color": [round(col.r, 3), round(col.g, 3), round(col.b, 3)] if col else None,
                          "base": [round(base.r, 3), round(base.g, 3), round(base.b, 3)] if base else None,
                          "z": [round(min(zs), 1), round(max(zs), 1)] if zs else None})
            if n == 0:
                continue
            mname = mat.get_name() if mat else ""
            # THE HEAD'S EYE HALOS ARE ALSO A TWO-INSTANCE CYAN COMPONENT, and the first run of this job took them for
            # the chest skull's eyes (aim read head_z == chest_z). Halos are additive and carry the scene scale in
            # their Color (~10,000); eyes are glow at the eye level (~5-20). Exclude by both.
            is_halo = "Halo" in mname or "Additive" in mname or (col is not None and max(col.r, col.g, col.b) > 100.0)
            if col is not None and not is_halo and n == 2 and col.g > col.r * 1.6 and col.b > col.r * 1.6 \
                    and max(col.r, col.g, col.b) > 1.0:
                glow_pairs.append(pts)
            elif col is not None and near(col, VOID):
                charcoal.extend(pts)
            elif col is not None and near(col, VISOR):
                visor.extend(pts)
            elif base is not None and near(base, BONE, 0.03):
                bone.extend(pts)
        glow_pairs.sort(key=lambda ps: -(ps[0].z + ps[1].z))
        found = {"table": table}
        if len(glow_pairs) >= 2:
            found["head_eyes"], found["chest_eyes"] = glow_pairs[0], glow_pairs[1]
            head_z = (found["head_eyes"][0].z + found["head_eyes"][1].z) * 0.5
            chest_z = (found["chest_eyes"][0].z + found["chest_eyes"][1].z) * 0.5
            split = (head_z + chest_z) * 0.5
            ce = found["chest_eyes"]
            mid = unreal.Vector((ce[0].x + ce[1].x) * 0.5, (ce[0].y + ce[1].y) * 0.5, chest_z)

            def dist(p):
                return math.sqrt((p.x - mid.x) ** 2 + (p.y - mid.y) ** 2 + (p.z - mid.z) ** 2)

            # the skull's own dark features: the void instances right around its eyes
            found["skull_features"] = [p for p in charcoal if p.z <= split and dist(p) < 30.0]
            found["body_bone"] = [p for p in bone if p.z <= split and dist(p) < 70.0]
            found["face_bone"] = [p for p in bone if p.z > split]
            found["visor"] = visor
        return found

    def project(w, pos):
        pc = unreal.GameplayStatics.get_player_controller(w, 0)
        r = unreal.GameplayStatics.project_world_to_screen(pc, pos, False)
        if isinstance(r, tuple):
            if len(r) >= 2 and isinstance(r[0], bool):
                return r[1] if r[0] else None
            return r[0]
        return r

    def pix(img, x, y):
        w, h, chan, px = img
        if not (0 <= x < w and 0 <= y < h):
            return None
        i = (int(y) * w + int(x)) * chan
        return (px[i] / 255.0, px[i + 1] / 255.0, px[i + 2] / 255.0)

    def luma(c):
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

    def measure(w, path, found):
        img = read(path)
        vw = unreal.WidgetLayoutLibrary.get_viewport_size(w)
        sx, sy = img[0] / max(vw.x, 1.0), img[1] / max(vw.y, 1.0)

        def at(p):
            s = project(w, p)
            return None if s is None else (s.x * sx, s.y * sy)

        out = {}

        def eye_reads(pts):
            eyes = [at(p) for p in pts]
            if len(eyes) != 2 or not all(eyes):
                return None, None
            reads = []
            for e in eyes:
                vals = [pix(img, e[0] + dx, e[1] + dy) for dx in range(-3, 4) for dy in range(-3, 4)]
                vals = [v for v in vals if v]
                reads.append({"luma": round(sum(luma(v) for v in vals) / len(vals), 4),
                              "min_channel": round(min(min(v) for v in vals), 3)})
            gx, gy = (eyes[0][0] + eyes[1][0]) * 0.5, (eyes[0][1] + eyes[1][1]) * 0.5
            gap = [pix(img, gx + dx, gy + dy) for dx in range(-1, 2) for dy in range(-3, 4)]
            gap = [v for v in gap if v]
            return eyes, {"eyes": reads, "px": [[round(e[0]), round(e[1])] for e in eyes],
                          "gap_luma": round(sum(luma(v) for v in gap) / len(gap), 4) if gap else None}

        chest_eyes, out["chest_eyes"] = eye_reads(found.get("chest_eyes", []))
        _, out["head_eyes"] = eye_reads(found.get("head_eyes", []))
        if not chest_eyes:
            return out
        core = max(abs(chest_eyes[0][0] - chest_eyes[1][0]) * 0.5 * 0.55, 4.0)

        def outside_cores(x, y):
            return all(abs(x - e[0]) > core or abs(y - e[1]) > core for e in chest_eyes)

        # the chest skull's screen box: its dark features and its eyes, grown by a third
        feats = [at(p) for p in found.get("skull_features", [])] + list(chest_eyes)
        feats = [s for s in feats if s]
        fx0, fx1 = min(s[0] for s in feats), max(s[0] for s in feats)
        fy0, fy1 = min(s[1] for s in feats), max(s[1] for s in feats)
        gw, gh = (fx1 - fx0) * 0.33, (fy1 - fy0) * 0.33
        box = (fx0 - gw, fy0 - gh, fx1 + gw, fy1 + gh)
        out["skull_box_px"] = [round(v) for v in box]

        def inside(s):
            return box[0] <= s[0] <= box[2] and box[1] <= s[1] <= box[3]

        def stats(vals):
            vals.sort()
            return {"n": len(vals), "p50": round(vals[len(vals) // 2], 4), "p90": round(vals[int(len(vals) * 0.9)], 4)} if vals else None

        skull, body = [], []
        for p in found.get("body_bone", []):
            s = at(p)
            if s is None:
                continue
            v = pix(img, s[0], s[1])
            if v is None:
                continue
            if inside(s):
                if outside_cores(s[0], s[1]):
                    skull.append(luma(v))
            else:
                body.append(luma(v))
        out["skull_surface"] = stats(skull)
        out["body_grey"] = stats(body)
        face = []
        for p in found.get("face_bone", []):
            s = at(p)
            v = pix(img, s[0], s[1]) if s else None
            if v:
                face.append(luma(v))
        out["face_grey"] = stats(face)
        # "no large white panels" on the skull: white pixels inside its box, outside its two eye cores
        bright = total = 0
        for y in range(max(int(box[1]), 0), min(int(box[3]), img[1] - 1), 2):
            for x in range(max(int(box[0]), 0), min(int(box[2]), img[0] - 1), 2):
                if not outside_cores(x, y):
                    continue
                v = pix(img, x, y)
                if v is None:
                    continue
                total += 1
                if luma(v) > 0.80 and min(v) > 0.62:
                    bright += 1
        out["white_on_skull"] = round(bright / max(total, 1), 4)
        out["white_samples"] = total
        return out

    def shoot(name):
        path = os.path.join(ROOT, name + ".png")
        got = L.capture_game_viewport(path)
        ok = bool(got[0]) if isinstance(got, tuple) and isinstance(got[0], bool) else bool(got)
        return path if ok and os.path.isfile(path) else None

    def pose(w, pawn, distance, turn, rise, look_z, fov=40.0):
        here = pawn.get_actor_location()
        yaw = pawn.get_actor_rotation().yaw + turn
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * distance,
                            here.y + math.sin(math.radians(yaw)) * distance, here.z + look_z + rise)
        L.pose_camera(w, eye, unreal.Vector(here.x, here.y, here.z + look_z), fov)

    world, dog = alive()
    fig = worn_costume(world, dog) if world else None
    found = anatomy(fig) if fig else {}
    RESULT["component_table"] = found.get("table")
    RESULT["anatomy_counts"] = {k: len(v) for k, v in found.items() if k != "table"}
    record("A00", "the worn costume is the corrected figure: both eye pairs, the chest skull's dark features, the grey coat",
           all(k in found for k in ("head_eyes", "chest_eyes")) and 5 <= len(found.get("skull_features", [])) <= 20
           and len(found.get("body_bone", [])) >= 100 and len(found.get("face_bone", [])) >= 200
           and found["head_eyes"][0].z - found["chest_eyes"][0].z > 10.0,
           counts=RESULT["anatomy_counts"],
           note="skull_features are the chest skull's void sockets, nose and teeth (7 in the figure); the grey is the "
                "`bone` coat's instances -- the chest skull's cranium and jaw are among the body's now.")
    if "head_eyes" not in found:
        restore()
        les.editor_request_end_play()
        RESULT["status"] = "VOID: anatomy not found -- see component_table"
        return
    here = dog.get_actor_location()
    head_z = (found["head_eyes"][0].z + found["head_eyes"][1].z) * 0.5 - here.z
    chest_z = (found["chest_eyes"][0].z + found["chest_eyes"][1].z) * 0.5 - here.z
    face_mid = (head_z + chest_z) * 0.5
    RESULT["aim"] = {"head_z": round(head_z, 1), "chest_z": round(chest_z, 1)}

    per = {}
    RESULT["measures"] = per
    views = []
    RESULT["views"] = views
    for hour_label, hour in HOURS:
        world, dog = alive()
        if world is None:
            record("DEAD_%s" % hour_label, "the play world was alive at %s" % hour_label, False)
            break
        SL.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
        SL.execute_console_command(world, "wl.Look.PracticalReload")
        yield 4.0
        shots = (("front_close_founder_frame", 150.0, 0.0, 6.0, face_mid, True),
                 ("front_chest", 190.0, 0.0, 4.0, chest_z + 4.0, True),
                 ("front_full", 330.0, 0.0, 20.0, -5.0, True),
                 ("three_quarter", 240.0, 40.0, 8.0, chest_z + 8.0, False),
                 ("side", 240.0, 90.0, 8.0, chest_z + 8.0, False),
                 ("front_gameplay_distance", 900.0, 0.0, 60.0, -5.0, False))
        for label, dist, turn, rise, look_z, do_measure in shots:
            world, dog = alive()
            if world is None:
                break
            pose(world, dog, dist, turn, rise, look_z)
            yield 1.4
            unreal.GameplayStatics.set_game_paused(world, True)
            yield 0.4
            now = anatomy(worn_costume(world, dog)) if do_measure else found
            path = shoot("skel_v2_head_%s_%s" % (hour_label, label))
            row = {"hour": hour_label, "view": label, "file": os.path.basename(path) if path else None}
            if path and do_measure:
                row["measure"] = measure(world, path, now)
                per["%s/%s" % (hour_label, label)] = row["measure"]
            unreal.GameplayStatics.set_game_paused(world, False)
            views.append(row)
            emit("VIEW", row)
        world, dog = alive()
        if world is not None:
            L.release_camera(world)
            yield 1.5
            path = shoot("skel_v2_head_%s_gameplay_camera" % hour_label)
            views.append({"hour": hour_label, "view": "gameplay_camera", "file": os.path.basename(path) if path else None})

    for key, m in per.items():
        sk, bd, ce = m.get("skull_surface") or {}, m.get("body_grey") or {}, m.get("chest_eyes") or {}
        record("H1 %s" % key, "%s: the chest skull is the body's own grey (its surface within 0.10 of the body plates around it)" % key,
               sk.get("p50") is not None and bd.get("p50") is not None and abs(sk["p50"] - bd["p50"]) <= 0.10,
               skull=sk, body=bd, face=m.get("face_grey"), box=m.get("skull_box_px"))
        ey = ce.get("eyes") or []
        eye_l = min(e["luma"] for e in ey) if len(ey) == 2 else None
        record("H2 %s" % key, "%s: the chest skull's two eyes are white and lit, and the gap between them is not" % key,
               eye_l is not None and eye_l >= 0.70 and min(e["min_channel"] for e in ey) >= 0.55
               and ce.get("gap_luma") is not None and ce["gap_luma"] <= 0.5 * eye_l,
               eyes=ey, gap=ce.get("gap_luma"), px=ce.get("px"))
        record("H3 %s" % key, "%s: the skull itself does not glow (its brightest decile no brighter than the body's)" % key,
               sk.get("p90") is not None and bd.get("p90") is not None and sk["p90"] <= bd["p90"] + 0.12, skull=sk, body=bd)
        record("H4 %s" % key, "%s: no white panels on the skull (under 3%% of its box is white outside its two eyes)" % key,
               m.get("white_on_skull") is not None and m["white_on_skull"] <= 0.03,
               white=m.get("white_on_skull"), samples=m.get("white_samples"), box=m.get("skull_box_px"))

    restore()
    yield 3.0
    record("K99", "the day clock and the worn skin are back as found",
           abs(SL.get_console_variable_float_value("wl.Sky.DayMinutes") - minutes_before) < 1e-3,
           day_minutes=SL.get_console_variable_float_value("wl.Sky.DayMinutes"), skin=skin_before)
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 120)
    RESULT["status"] = "measured" if all(t["pass"] for t in tests) else "FAIL"
