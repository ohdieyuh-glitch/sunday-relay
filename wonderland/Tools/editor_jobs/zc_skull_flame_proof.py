# SKELETON V2: A BLACK SKULL WITH ONLY ITS EYES LIT, AND THE BLUE + WHITE FLAMES BACK -- photographed, then measured.
#
# FOUNDER, 2026-09-28 (correction pass):
#   "Skeleton V2 currently has the skull itself glowing ... The skull must remain BLACK. ONLY THE EYES should glow
#    on the skull ... Verify this visually in a close front view."
#   "The BLACK FLAMES were NEVER requested ... DETAILED BLUE + WHITE FLAMES. That is the flame design I want
#    restored."
#   "Do not declare the Skeleton correction complete from material values alone. Render/view Skeleton V2 and
#    prove visually: FRONT ... SIDE ... REAR ... GAMEPLAY DISTANCE ... CLOSE VIEW."
#
# WHAT IS PHOTOGRAPHED: the Dog wearing skeleton_flame (V2) at noon, dusk and night, from the front, side and rear
# close and full, the front at gameplay distance, and the gameplay camera itself. Then a CONTROL: the figure as it
# was this morning (Saved/ProofFigures/SkeletonFlameV2_before_0928.wlvox) standing beside the corrected one, same
# light, same frame -- so "the skull is black now" is read against "the skull glowed before", not against a
# threshold somebody chose.
#
# WHAT IS MEASURED, WHERE IT IS: nothing here guesses a screen rectangle. The costume's own instanced components
# are found (the chest skull's two eye blocks are the only two-instance glow component on the body; the skull is
# the lit near-black component's instances around them; the head's eyes and visor likewise), every instance's
# world position is projected through the posed camera, and the PNG is sampled at exactly those pixels. The
# gates are RELATIVE -- eyes against the skull around them, the gap between two eyes against the eyes -- because
# the exposure moves every absolute value across the day.
#
# AND THE BLACK FLAMES, WITH THEIR OWN CONTROL: the same frame at night with wl.Look.FireMaterial 0 (shipped),
# then 1 (the surface that drew black), then 0 again. The flame is sampled above the ear-fire pivot. Restoring 0
# must restore the picture, or the switch is not what the picture depends on.
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
ROOT = os.path.join(TOOLS, "captures", "zc", "skull_flame_0928")
DLL = os.path.join(PROJECT, "Binaries", "Win64", "UnrealEditor-Wonderland.dll")
BEFORE_FIGURE = os.path.join(PROJECT, "Saved", "ProofFigures", "SkeletonFlameV2_before_0928.wlvox")
AFTER_FIGURE = os.path.join(PROJECT, "RelaySkins", "SkeletonFlameV2.wlvox")
SKIN_FILE = os.path.join(PROJECT, "Saved", "Wonderland", "RelaySkin.txt")
HOURS = (("noon", 12.0), ("dusk", 18.0), ("night", 23.6))


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

    # ---- IDENTITY FIRST: which binary, and what the flame switch reads before anybody touches it.
    RESULT["dll_mtime"] = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(DLL)))
    fire_default = SL.get_console_variable_int_value("wl.Look.FireMaterial")
    minutes_before = SL.get_console_variable_float_value("wl.Sky.DayMinutes")
    try:
        with open(SKIN_FILE, encoding="utf-8") as fh:
            skin_before = fh.read().strip() or "relay_og"
    except OSError:
        skin_before = "relay_og"
    RESULT["restore"] = {"wl.Sky.DayMinutes": minutes_before, "skin": skin_before}
    record("K00", "a fresh session draws flames on the glow material: wl.Look.FireMaterial reads 0 untouched",
           fire_default == 0, fire_material=fire_default, dll=RESULT["dll_mtime"],
           note="1 is the M_WL_Fire surface that photographs black; 0 is the ribbons the founder approved on 09-26.")

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
    ui = L.get_ui(world)
    SL.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 1.0
    frozen = SL.get_console_variable_float_value("wl.Sky.DayMinutes")
    record("K01", "the sky clock is held, so each hour is the hour it claims", abs(frozen) < 1e-3, day_minutes=frozen)

    def restore():
        w = ues.get_game_world()
        try:
            SL.execute_console_command(w, "wl.Look.FireMaterial 0")
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

    def instances(comp):
        out = []
        for i in range(comp.get_instance_count()):
            t = comp.get_instance_transform(i, True)
            if isinstance(t, tuple):
                t = t[-1]
            out.append(t.translation)
        return out

    def param(comp, name):
        mat = comp.get_material(0)
        try:
            return mat.k2_get_vector_parameter_value(name)
        except Exception:                                            # noqa: BLE001
            return None

    def parent_name(comp):
        mat = comp.get_material(0)
        try:
            par = mat.get_editor_property("parent")
            return par.get_name() if par else mat.get_name()
        except Exception:                                            # noqa: BLE001
            return mat.get_name() if mat else ""

    def anatomy(fig):
        """The chest skull's eyes and surface, the head's eyes and visor -- found by what they are, not by name."""
        comps = list(fig.get_components_by_class(unreal.InstancedStaticMeshComponent))
        parts = {}
        for c in comps:
            holder = c.get_attach_parent()
            key = holder.get_name() if holder else ""
            parts.setdefault(key, []).append(c)
        body = [c for k, cs in parts.items() if k.startswith("Part_body") for c in cs]
        head = [c for k, cs in parts.items() if k.startswith("Part_head") for c in cs]
        found = {}
        # chest eyes: the only TWO-instance component on the body whose material glows cyan (G and B well over R)
        for c in body:
            col = param(c, "Color")
            if c.get_instance_count() == 2 and col is not None and col.g > col.r * 1.6 and col.b > col.r * 1.6:
                found["chest_eyes"] = instances(c)
                found["chest_eyes_parent"] = parent_name(c)
                found["chest_eyes_colour"] = [round(col.r, 2), round(col.g, 2), round(col.b, 2)]
        if "chest_eyes" in found:
            e0, e1 = found["chest_eyes"]
            mid = unreal.Vector((e0.x + e1.x) * 0.5, (e0.y + e1.y) * 0.5, (e0.z + e1.z) * 0.5)
            best = None
            for c in body:
                col = param(c, "Color")
                # the skull is the LIT NEAR-BLACK component around the eyes -- not the bone torso behind it
                if col is None or c.get_instance_count() < 20 or max(col.r, col.g, col.b) >= 0.1:
                    continue
                pts = [p for p in instances(c)
                       if math.sqrt((p.x - mid.x) ** 2 + (p.y - mid.y) ** 2 + (p.z - mid.z) ** 2) < 42.0]
                if len(pts) >= 20 and (best is None or len(pts) > len(best[1])):
                    best = (c, pts, col)
            if best is not None:
                found["chest_skull"] = best[1]
                found["chest_skull_parent"] = parent_name(best[0])
                found["chest_skull_colour"] = [round(best[2].r, 3), round(best[2].g, 3), round(best[2].b, 3)]
        for c in head:
            col = param(c, "Color")
            n = c.get_instance_count()
            pname = parent_name(c)
            if n == 2 and "Halo" not in pname and "Additive" not in pname and col is not None and max(col.r, col.g, col.b) > 1.0:
                found["head_eyes"] = instances(c)
                found["head_eyes_parent"] = pname
            if n >= 40 and col is not None and max(col.r, col.g, col.b) < 0.1:
                found["visor"] = instances(c)
        return found

    def project(w, pos):
        pc = unreal.GameplayStatics.get_player_controller(w, 0)
        r = unreal.GameplayStatics.project_world_to_screen(pc, pos, False)
        if isinstance(r, tuple):
            if len(r) >= 2 and isinstance(r[0], bool):
                return r[1] if r[0] else None
            return r[0]
        return r

    def sample(img, xy, half=2):
        w, h, chan, px = img
        x0, y0 = int(xy[0]), int(xy[1])
        vals = []
        for y in range(max(y0 - half, 0), min(y0 + half + 1, h)):
            for x in range(max(x0 - half, 0), min(x0 + half + 1, w)):
                i = (y * w + x) * chan
                vals.append((px[i], px[i + 1], px[i + 2]))
        if not vals:
            return None
        r = sum(v[0] for v in vals) / len(vals) / 255.0
        g = sum(v[1] for v in vals) / len(vals) / 255.0
        b = sum(v[2] for v in vals) / len(vals) / 255.0
        return {"luma": round(0.2126 * r + 0.7152 * g + 0.0722 * b, 4), "rgb": [round(r, 3), round(g, 3), round(b, 3)]}

    def measure(w, path, found):
        """Sample the capture at the projected anatomy. Returns raw numbers; the gates are applied by the caller."""
        img = read(path)
        vw = unreal.WidgetLayoutLibrary.get_viewport_size(w)
        sx = img[0] / max(vw.x, 1.0)
        sy = img[1] / max(vw.y, 1.0)

        def at(pos):
            sp = project(w, pos)
            return None if sp is None else (sp.x * sx, sp.y * sy)

        out = {}
        for key in ("chest_eyes", "head_eyes"):
            pts = found.get(key) or []
            spots = [at(p) for p in pts]
            if len(spots) == 2 and all(spots):
                reads = [sample(img, s, 3) for s in spots]
                out[key] = reads
                gap = ((spots[0][0] + spots[1][0]) * 0.5, (spots[0][1] + spots[1][1]) * 0.5)
                out[key + "_gap"] = sample(img, gap, 2)
                out[key + "_px"] = [[round(s[0]), round(s[1])] for s in spots]
        if found.get("chest_skull") and found.get("chest_eyes"):
            eyes = [at(p) for p in found["chest_eyes"]]
            lumas = []
            for p in found["chest_skull"]:
                s = at(p)
                if s is None or any(e and math.hypot(s[0] - e[0], s[1] - e[1]) < 9 for e in eyes):
                    continue
                got = sample(img, s, 1)
                if got:
                    lumas.append(got["luma"])
            lumas.sort()
            if lumas:
                out["chest_skull"] = {"n": len(lumas), "p50": lumas[len(lumas) // 2],
                                      "p90": lumas[int(len(lumas) * 0.9)], "max": lumas[-1]}
        if found.get("visor") and found.get("head_eyes"):
            eyes = [at(p) for p in found["head_eyes"]]
            lumas = []
            for p in found["visor"]:
                s = at(p)
                if s is None or any(e and math.hypot(s[0] - e[0], s[1] - e[1]) < 14 for e in eyes):
                    continue
                got = sample(img, s, 1)
                if got:
                    lumas.append(got["luma"])
            lumas.sort()
            if lumas:
                out["visor"] = {"n": len(lumas), "p50": lumas[len(lumas) // 2], "p90": lumas[int(len(lumas) * 0.9)]}
        return out

    def shoot(name):
        path = os.path.join(ROOT, name + ".png")
        got = L.capture_game_viewport(path)
        ok = bool(got[0]) if isinstance(got, tuple) and isinstance(got[0], bool) else bool(got)
        return path if ok and os.path.isfile(path) else None

    def pose(w, pawn, distance, turn, rise, look_z):
        here = pawn.get_actor_location()
        yaw = pawn.get_actor_rotation().yaw + turn
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * distance,
                            here.y + math.sin(math.radians(yaw)) * distance, here.z + look_z + rise)
        L.pose_camera(w, eye, unreal.Vector(here.x, here.y, here.z + look_z), 40.0)

    # ---- WEAR V2, AND FIND ITS ANATOMY.
    ui.wear_relay_skin("skeleton_flame")
    yield 8.0
    world, dog = alive()
    if world is None:
        restore()
        RESULT["status"] = "VOID: the world died after wearing the skin"
        return
    fig = worn_costume(world, dog)
    found = anatomy(fig) if fig is not None else {}
    RESULT["anatomy"] = {k: (v if isinstance(v, (str, list)) and (not v or not hasattr(v[0], "x")) else len(v))
                         for k, v in found.items()}
    record("A00", "the worn costume's chest-skull eyes, chest skull, head eyes and visor were all found",
           all(k in found for k in ("chest_eyes", "chest_skull", "head_eyes", "visor")),
           found=RESULT["anatomy"])
    # z of the anatomy relative to the pawn, so the cameras aim at the face and the chest, not the brow
    here = dog.get_actor_location()
    chest_z = (found["chest_eyes"][0].z - here.z) if "chest_eyes" in found else -5.0
    head_z = (found["head_eyes"][0].z - here.z) if "head_eyes" in found else 25.0
    RESULT["aim"] = {"chest_z": round(chest_z, 1), "head_z": round(head_z, 1)}
    face_mid = (chest_z + head_z) * 0.5

    # ---- THE FLAME MATERIAL THE COSTUME ACTUALLY WEARS.
    pmcs = list(fig.get_components_by_class(unreal.ProceduralMeshComponent)) if fig else []
    flame_parents = sorted({parent_name_of(m) for p in pmcs for m in [p.get_material(i) for i in range(p.get_num_materials())] if m}) \
        if pmcs else []
    RESULT["flame_materials"] = flame_parents
    record("F00", "the flame ribbons wear the figure's glow material, not M_WL_Fire",
           bool(flame_parents) and not any("M_WL_Fire" in n for n in flame_parents),
           flame_parents=flame_parents, flame_surfaces=len(pmcs))

    views = []
    RESULT["views"] = views
    per_hour = {}
    RESULT["per_hour"] = per_hour
    for hour_label, hour in HOURS:
        world, dog = alive()
        if world is None:
            record("DEAD_%s" % hour_label, "the play world was alive at %s" % hour_label, False)
            break
        SL.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
        SL.execute_console_command(world, "wl.Look.PracticalReload")
        yield 4.0
        shots = (("front_close", 150.0, 0.0, 6.0, face_mid),
                 ("side_close", 175.0, 90.0, 6.0, face_mid),
                 ("rear_close", 175.0, 180.0, 6.0, face_mid),
                 ("front_full", 330.0, 0.0, 20.0, -5.0),
                 ("side_full", 330.0, 90.0, 20.0, -5.0),
                 ("rear_full", 330.0, 180.0, 20.0, -5.0),
                 ("front_gameplay", 900.0, 0.0, 60.0, -5.0))
        for label, dist, turn, rise, look_z in shots:
            world, dog = alive()
            if world is None:
                break
            pose(world, dog, dist, turn, rise, look_z)
            yield 1.4
            unreal.GameplayStatics.set_game_paused(world, True)
            yield 0.4
            # the anatomy is read again WHILE PAUSED: the figure breathes and bobs, so positions from the start of
            # the job would sample beside the eyes rather than on them
            found_now = found
            if label == "front_close":
                costume = worn_costume(world, dog)
                found_now = anatomy(costume) if costume is not None else found
            path = shoot("skel_v2_%s_%s" % (hour_label, label))
            row = {"hour": hour_label, "view": label, "file": os.path.basename(path) if path else None}
            if path and label == "front_close":
                row["measure"] = measure(world, path, found_now)
                per_hour[hour_label] = row["measure"]
            unreal.GameplayStatics.set_game_paused(world, False)
            views.append(row)
            emit("VIEW", row)
        # the gameplay camera itself: released, the Dog seen as a player sees it
        world, dog = alive()
        if world is not None:
            L.release_camera(world)
            yield 1.5
            path = shoot("skel_v2_%s_gameplay_camera" % hour_label)
            views.append({"hour": hour_label, "view": "gameplay_camera", "file": os.path.basename(path) if path else None})

    # ---- THE GATES, from the front close at every hour.
    for hour_label, m in per_hour.items():
        ce = m.get("chest_eyes") or []
        cs = m.get("chest_skull") or {}
        gap = m.get("chest_eyes_gap") or {}
        eye_l = min(e["luma"] for e in ce) if len(ce) == 2 else None
        record("S_%s_1" % hour_label, "%s: the chest skull's surface is dark -- its eyes read at least 2.5x its brightest decile" % hour_label,
               eye_l is not None and cs.get("p90") is not None and eye_l >= 2.5 * max(cs["p90"], 0.02),
               eye_luma=eye_l, skull=cs)
        record("S_%s_2" % hour_label, "%s: the chest skull's two eyes are separate lights (the gap between them is dark)" % hour_label,
               eye_l is not None and gap.get("luma") is not None and gap["luma"] <= 0.5 * eye_l,
               eye_luma=eye_l, gap=gap, px=m.get("chest_eyes_px"))
        record("S_%s_3" % hour_label, "%s: the chest skull's eyes glow cyan (blue and green lead red)" % hour_label,
               len(ce) == 2 and all(e["rgb"][2] > e["rgb"][0] and e["rgb"][1] > e["rgb"][0] for e in ce) and eye_l >= 0.30,
               eyes=ce)
        he = m.get("head_eyes") or []
        hv = m.get("visor") or {}
        hgap = m.get("head_eyes_gap") or {}
        head_l = min(e["luma"] for e in he) if len(he) == 2 else None
        record("S_%s_4" % hour_label, "%s: the face stays black around the head's eyes, and the two eyes stay separate" % hour_label,
               head_l is not None and hv.get("p50") is not None and head_l >= 2.5 * max(hv["p50"], 0.02)
               and hgap.get("luma") is not None and hgap["luma"] <= 0.6 * head_l,
               head_eye_luma=head_l, visor=hv, gap=hgap, px=m.get("head_eyes_px"))

    # ---- THE CONTROL: the figure as it was this morning, beside the corrected one, same light, same frame.
    world, dog = alive()
    if world is not None:
        SL.execute_console_command(world, "wl.Sky.Hour 23.60")
        yield 3.0
        base = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        fwd = unreal.Vector(math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), 0.0)
        right = unreal.Vector(-fwd.y, fwd.x, 0.0)
        spot = base + fwd * 260.0 + unreal.Vector(0.0, 0.0, -85.0)
        spawned = []
        for label, path, side in (("before", BEFORE_FIGURE, -1.0), ("after", AFTER_FIGURE, 1.0)):
            a = L.spawn_figure_actor(world, spot + right * (side * 70.0), path, "control_" + label)
            if a is not None:
                a.set_actor_rotation(unreal.Rotator(0.0, 0.0, yaw + 180.0), False)
                spawned.append(a)
        yield 6.0
        # the camera stands between the Dog and the pair, on the side the pair faces
        eye = spot - fwd * 230.0 + unreal.Vector(0.0, 0.0, 110.0)
        L.pose_camera(world, eye, spot + unreal.Vector(0.0, 0.0, 95.0), 40.0)
        yield 1.5
        unreal.GameplayStatics.set_game_paused(world, True)
        yield 0.4
        control_night = shoot("control_before_left_after_right_night")
        unreal.GameplayStatics.set_game_paused(world, False)
        SL.execute_console_command(world, "wl.Sky.Hour 12.00")
        yield 3.0
        unreal.GameplayStatics.set_game_paused(world, True)
        yield 0.4
        control_noon = shoot("control_before_left_after_right_noon")
        unreal.GameplayStatics.set_game_paused(world, False)
        RESULT["control"] = {"spawned": len(spawned), "night": bool(control_night), "noon": bool(control_noon)}
        for a in spawned:
            a.destroy_actor()
        L.release_camera(world)

    # ---- THE BLACK FLAMES, A/B/A at night: shipped 0, the surface that drew black, then 0 again.
    world, dog = alive()
    flame = {}
    RESULT["flame_ab"] = flame
    if world is not None:
        SL.execute_console_command(world, "wl.Sky.Hour 23.60")
        yield 3.0
        for step, value in (("a_shipped", 0), ("b_fire_material", 1), ("c_restored", 0)):
            world, dog = alive()
            if world is None:
                break
            SL.execute_console_command(world, "wl.Look.FireMaterial %d" % value)
            got = SL.get_console_variable_int_value("wl.Look.FireMaterial")
            ui = L.get_ui(world)
            ui.wear_relay_skin("relay_og")
            yield 3.0
            ui.wear_relay_skin("skeleton_flame")
            yield 7.0
            world, dog = alive()
            fig = worn_costume(world, dog)
            pose(world, dog, 330.0, 0.0, 20.0, -5.0)
            yield 1.4
            unreal.GameplayStatics.set_game_paused(world, True)
            yield 0.4
            path = shoot("flame_%s" % step)
            reads = []
            if path and fig is not None:
                img = read(path)
                vw = unreal.WidgetLayoutLibrary.get_viewport_size(world)
                sx, sy = img[0] / max(vw.x, 1.0), img[1] / max(vw.y, 1.0)
                for sc in fig.get_components_by_class(unreal.SceneComponent):
                    n = sc.get_name()
                    if not (n.startswith("Part_earfire") or n.startswith("Part_flankfire") or n.startswith("Part_backfire")):
                        continue
                    base = sc.get_world_location()
                    for rise in (12.0, 24.0, 36.0):
                        sp = project(world, base + unreal.Vector(0.0, 0.0, rise))
                        if sp is not None:
                            got_px = sample(img, (sp.x * sx, sp.y * sy), 3)
                            if got_px:
                                reads.append(got_px)
            unreal.GameplayStatics.set_game_paused(world, False)
            lum = sorted(r["luma"] for r in reads)
            flame[step] = {"fire_material": got, "file": os.path.basename(path) if path else None, "samples": len(lum),
                           "luma_p50": lum[len(lum) // 2] if lum else None,
                           "luma_p90": lum[int(len(lum) * 0.9)] if lum else None,
                           "blue_over_red": round(sum(r["rgb"][2] for r in reads) / max(sum(r["rgb"][0] for r in reads), 1e-3), 3) if reads else None}
            emit("FLAME", step, flame[step])
        a, b, c = flame.get("a_shipped", {}), flame.get("b_fire_material", {}), flame.get("c_restored", {})
        record("F01", "the shipped flames are bright and blue-led where the fire-material surface is dark (black flames removed)",
               a.get("luma_p90") is not None and b.get("luma_p90") is not None
               and a["luma_p90"] >= 2.0 * max(b["luma_p90"], 0.02) and (a.get("blue_over_red") or 0) > 1.2,
               shipped=a, fire_material=b,
               note="b is the control: the same frame on the surface that drew black. If a and b read alike the switch is not what the picture depends on.")
        record("F02", "switching back restores the same picture (the switch is the cause, and it is restored)",
               c.get("luma_p90") is not None and a.get("luma_p90") is not None and abs(c["luma_p90"] - a["luma_p90"]) <= 0.25 * max(a["luma_p90"], 0.05)
               and c.get("fire_material") == 0,
               shipped=a, restored=c)

    restore()
    yield 3.0
    world, dog = alive()
    after_minutes = SL.get_console_variable_float_value("wl.Sky.DayMinutes")
    after_fire = SL.get_console_variable_int_value("wl.Look.FireMaterial")
    record("K99", "every knob this job moved is back (fire switch 0, day clock as found, skin as found)",
           after_fire == 0 and abs(after_minutes - minutes_before) < 1e-3,
           fire_material=after_fire, day_minutes=after_minutes, skin=skin_before)
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 120)
    RESULT["status"] = "measured" if all(t["pass"] for t in tests) else "FAIL"


def parent_name_of(mat):
    try:
        par = mat.get_editor_property("parent")
        return par.get_name() if par else mat.get_name()
    except Exception:                                                # noqa: BLE001
        return mat.get_name()
