# MASCOT HEIGHT RULE (founder, 2026-09-30, HARD): every Relay Dog skin's BODY stands exactly Relay OG's height.
#
# FOUNDER: "ALL mascot skins must be the same overall height as the canonical Relay OG mascot skin ... The underlying
# character height, capsule height, root scale, skeletal scale, and visible standing height must match Relay OG ...
# Accessories/VFX may visually extend beyond Relay OG, but the actual mascot body must remain Relay OG height ... Measure
# them against Relay OG and normalize them through one consistent skin-sizing system."
#
# MEASURED, NOT EYEBALLED. Per skin, on the same flat paving, facing the same way:
#   the Dog: actor Z, capsule half-height, actor scale, the camera's height -- identical by construction (one pawn),
#            and checked, with the Dog's Z before and after each switch;
#   Relay OG's canon body: its soles and the top of its head (the Pivot_head subtree), and the top of all its body meshes;
#   the costume: its soles, and every part mesh's world top, so the base body's head is told apart from horns and fire.
# MODE "measure" records only; MODE "verify" also judges S1..S6 (see the end).
# Globals: MODE, SPOT. PIE-owning: CONCURRENT is False. Saves nothing; restores the persisted skin.
CONCURRENT = False
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
GS = unreal.GameplayStatics
MODE = globals().get("MODE", "measure")
SPOT = globals().get("SPOT", [0.0, 44000.0, 12.0])
SKINS = ["relay_og", "celestial_light", "skeleton_flame", "jack_flame", "baal"]
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zh", "skin_heights_%s" % MODE)


def _scale(actor):
    for name in ("figure_scale", "FigureScale"):
        try:
            return actor.get_editor_property(name)
        except Exception:                                              # noqa: BLE001
            continue
    return -1.0


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
    RESULT["mode"] = MODE
    RESULT["dll_mtime"] = os.path.getmtime(os.path.join(unreal.Paths.project_dir(), "Binaries", "Win64", "UnrealEditor-Wonderland.dll"))
    L.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 90.0:
        yield 1.0
        t += 1.0
    world = ues.get_game_world()
    dog_of = lambda: GS.get_player_pawn(ues.get_game_world(), 0)
    t = 0.0
    while dog_of() is None and t < 30.0:
        yield 0.5
        t += 0.5
    if dog_of() is None:
        RESULT["status"] = "BLOCKED: no pawn"
        return
    yield 3.0
    L.focus_game_viewport()
    ui = L.get_ui(world)
    persisted = None
    try:
        persisted = open(os.path.join(unreal.Paths.project_saved_dir(), "Wonderland", "RelaySkin.txt")).read().strip()
    except Exception:                                                  # noqa: BLE001
        pass
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    # stand on the flat causeway, streamed, facing +Y
    dog = dog_of()
    dog.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], 2500.0), False, True)
    unreal.SystemLibrary.execute_console_command(world, "FlushLevelStreaming")
    w = 0.0
    while w < 30.0 and not L.is_world_partition_streaming_complete(world):
        yield 0.5
        w += 0.5
    dog = dog_of()
    dog.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], SPOT[2] + 120.0), False, True)
    dog.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0), False)
    yield 2.5

    def under(comp, ancestor):
        c = comp
        while c is not None:
            if c == ancestor:
                return True
            c = c.get_attach_parent()
        return False

    def top_bottom(comps):
        top, bottom = -1e9, 1e9
        for c in comps:
            o, e, _r = unreal.SystemLibrary.get_component_bounds(c)
            top = max(top, o.z + e.z)
            bottom = min(bottom, o.z - e.z)
        return top, bottom

    def measure(skin):
        dog = dog_of()
        loc = dog.get_actor_location()
        cap = dog.capsule_component
        half = cap.get_scaled_capsule_half_height()
        cam = GS.get_player_camera_manager(world, 0)
        cam_loc = cam.get_camera_location() if cam is not None else loc
        m = {"skin": skin, "worn": str(dog.get_worn_skin_id()), "dog_z": round(loc.z, 2), "capsule_half": round(half, 2),
             "capsule_radius": round(cap.get_scaled_capsule_radius(), 2), "actor_scale": [round(v, 3) for v in (dog.get_actor_scale3d().x, dog.get_actor_scale3d().y, dog.get_actor_scale3d().z)],
             "camera_z_over_dog": round(cam_loc.z - loc.z, 2), "ground_z": round(loc.z - half, 2)}
        # Relay OG's canon body (present, hidden or not, under every skin)
        head_pivot = None
        body_meshes = []
        for c in dog.get_components_by_class(unreal.StaticMeshComponent):
            name = c.get_name()
            if name.startswith("Mission") or c.component_has_tag("WL_Prop"):
                continue
            body_meshes.append(c)
        for c in dog.get_components_by_class(unreal.SceneComponent):
            if c.get_name() == "Pivot_head":
                head_pivot = c
        head_meshes = [c for c in body_meshes if head_pivot is not None and under(c, head_pivot)]
        ht, hb = top_bottom(head_meshes) if head_meshes else (None, None)
        bt, bb = top_bottom(body_meshes) if body_meshes else (None, None)
        soles = [dog.get_canon_sole_world(s) for s in (1.0, -1.0)]
        m["canon_body_height_uu"] = round(dog.get_canon_body_height_uu(), 2) if hasattr(dog, "get_canon_body_height_uu") else None
        m["canon"] = {"head_top_z": None if ht is None else round(ht, 2), "body_top_z": None if bt is None else round(bt, 2),
                      "body_bottom_z": None if bb is None else round(bb, 2), "sole_z": round(min(s.z for s in soles), 2),
                      "head_meshes": len(head_meshes), "body_meshes": len(body_meshes)}
        costume = dog.get_costume()
        if costume is not None:
            parts = {}
            for c in costume.get_components_by_class(unreal.InstancedStaticMeshComponent):
                if c.get_instance_count() <= 0:
                    continue
                o, e, _r = unreal.SystemLibrary.get_component_bounds(c)
                parts[c.get_name()] = [round(o.z - e.z, 2), round(o.z + e.z, 2)]
            fb = costume.get_framing_body_bounds()
            csoles = [costume.get_sole_world(s) for s in (1.0, -1.0)]
            body_h = costume.get_body_height_uu() if hasattr(costume, "get_body_height_uu") else 0.0
            body_lo = costume.get_body_lowest_uu() if hasattr(costume, "get_body_lowest_uu") else 0.0
            cz = costume.get_actor_location().z
            collides = [c.get_name() for c in costume.get_components_by_class(unreal.PrimitiveComponent)
                        if str(c.get_collision_enabled()) not in ("CollisionEnabled.NO_COLLISION", "ECollisionEnabled.NO_COLLISION")
                        and "NO_COLLISION" not in str(c.get_collision_enabled())]
            m["costume_body"] = {"height_uu": round(body_h, 2), "lowest_uu": round(body_lo, 2), "top_z": round(cz + body_lo + body_h, 2),
                                 "figure_scale": round(float(_scale(costume)), 4), "colliding_components": collides[:5]}
            m["costume"] = {"actor_z": round(costume.get_actor_location().z, 2),
                            "actor_scale": [round(v, 3) for v in (costume.get_actor_scale3d().x, costume.get_actor_scale3d().y, costume.get_actor_scale3d().z)],
                            "figure_height_uu": round(costume.get_figure_height_uu(), 2), "figure_lowest_uu": round(costume.get_figure_lowest_uu(), 2),
                            "framing_min_z": round(fb.min.z, 2), "framing_max_z": round(fb.max.z, 2),
                            "sole_z": round(min(s.z for s in csoles), 2), "parts": parts}
        return m

    rows = []
    RESULT["rows"] = rows
    for skin in SKINS:
        before = dog_of().get_actor_location().z
        ui.wear_relay_skin(skin)
        yield 0.1
        after_switch = dog_of().get_actor_location().z
        yield 2.5
        m = measure(skin)
        m["switch_dz"] = round(after_switch - before, 3)
        rows.append(m)
        # a side view of each skin on the same spot, same camera, for the lineup sheet
        dog = dog_of()
        at = dog.get_actor_location()
        L.pose_camera(world, unreal.Vector(at.x + 420.0, at.y, at.z + 10.0), unreal.Vector(at.x, at.y, at.z + 10.0), 40.0)
        yield 0.8
        H.capture_viewport_jpeg(os.path.join(ROOT, "%s_side.jpg" % skin), 1280, 90)
        L.release_camera(world)
        yield 0.5
    with open(os.path.join(ROOT, "heights.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1)
    if MODE == "verify":
        # ---- S6: THE MISSION CONTRACT STARTS AND ENDS AT THE SAME HEIGHT, AND LIFTS THE SAME, UNDER EVERY SKIN
        tasks = L.get_mission_tasks(world)
        mc = {}
        for skin in SKINS:
            ui.wear_relay_skin(skin)
            yield 2.0
            tasks.clear_all_tasks_for_development()
            yield 1.0
            d = dog_of()
            start = d.get_actor_location().z
            tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
            yield 1.5
            lifts = {}
            for stage in ("PREPARATION", "VERIFICATION"):
                unreal.SystemLibrary.execute_console_command(world, "wl.Tasks.Scheduler 0 %s" % stage)
                yield 3.0
                # THE MEDITATION HOVERS (the lift breathes several uu), so one instant is a phase, not a height: the lift is
                # read at 10 Hz for 3 s and compared as a mean -- the first run compared single instants and "failed" a
                # value that is the canon's own, identical under every skin, caught at different points of its breath.
                samples = []
                for _ in range(30):
                    samples.append(float(dog_of().get_canonical_worn_pose().lift_uu))
                    yield 0.1
                lifts[stage] = round(sum(samples) / len(samples), 1)
                lifts[stage + "_range"] = [round(min(samples), 1), round(max(samples), 1)]
            unreal.SystemLibrary.execute_console_command(world, "wl.Tasks.Scheduler 0 COMPLETED")
            yield 7.0
            end = dog_of().get_actor_location().z
            mc[skin] = {"start_z": round(start, 2), "end_z": round(end, 2), "lift": lifts}
            tasks.clear_all_tasks_for_development()
            yield 1.0
        RESULT["mission_heights"] = mc
        # ---- S7: THE WARDROBE FRAMES EVERY SKIN THE SAME (Relay OG's body, the same camera)
        framing = {}
        if not ui.is_project_brain_open():
            ui.toggle_project_brain()
        yield 1.5
        ui.press_switch_skin()
        yield 2.0
        stage_actor = next((s for s in unreal.ObjectIterator(unreal.WonderlandSkinStage) if s.get_world() == world), None)
        if stage_actor is not None:
            for skin in SKINS:
                stage_actor.show_skin(skin)
                yield 1.2
                note = str(stage_actor.describe_framing())
                body = stage_actor.get_body()
                vals = dict(kv.split("=", 1) for kv in note.split() if "=" in kv)
                framing[skin] = {"bodyTall": vals.get("bodyTall"), "distance": vals.get("distance"),
                                 "body_height_uu": round(body.get_body_height_uu(), 2) if body is not None and hasattr(body, "get_body_height_uu") else None}
                L.capture_game_viewport(os.path.join(ROOT, "wardrobe_%s.png" % skin))
        if ui.is_project_brain_open():
            ui.toggle_project_brain()
        yield 1.0
        RESULT["wardrobe_framing"] = framing
        # ---- THE JUDGEMENTS
        og = rows[0]
        ref_h = og.get("canon_body_height_uu")
        skins = rows[1:]
        record("S1", "feet on Relay OG's ground plane: every costume's soles within 1 uu of the canon soles",
               all(abs(r["costume"]["sole_z"] - r["canon"]["sole_z"]) <= 1.0 for r in skins),
               soles={r["skin"]: [r["costume"]["sole_z"], r["canon"]["sole_z"]] for r in skins})
        record("S2", "body height = Relay OG's measured height (within 0.5 uu), and the drawn body top level with OG's head top (within 3 uu, same frame)",
               ref_h is not None and all(abs(r["costume_body"]["height_uu"] - ref_h) <= 0.5 for r in skins)
               and all(abs(r["costume"]["framing_max_z"] - r["canon"]["head_top_z"]) <= 3.0 for r in skins),
               relay_og=ref_h, bodies={r["skin"]: r["costume_body"]["height_uu"] for r in skins},
               tops={r["skin"]: [r["costume"]["framing_max_z"], r["canon"]["head_top_z"]] for r in skins},
               scales={r["skin"]: r["costume_body"]["figure_scale"] for r in skins})
        record("S3", "no camera, capsule or scale shift: identical under every skin",
               len({(r["capsule_half"], r["capsule_radius"], tuple(r["actor_scale"]), r["camera_z_over_dog"]) for r in rows}) == 1,
               per={r["skin"]: [r["capsule_half"], r["capsule_radius"], r["camera_z_over_dog"]] for r in rows})
        record("S4", "switching skins never moves the player vertically (every switch 0 uu)",
               all(abs(r["switch_dz"]) <= 0.01 for r in rows), dz={r["skin"]: r["switch_dz"] for r in rows})
        record("S5", "no costume collides, so movement and collision height are Relay OG's capsule alone",
               all(not r["costume_body"]["colliding_components"] for r in skins),
               colliding={r["skin"]: r["costume_body"]["colliding_components"] for r in skins})
        base = mc.get("relay_og", {})
        record("S6", "the Mission Contract starts and ends at the same height and lifts the same under every skin",
               base and all(abs(v["start_z"] - base["start_z"]) <= 0.5 and abs(v["end_z"] - base["end_z"]) <= 0.5
                            and all(abs(v["lift"][k] - base["lift"][k]) <= 1.5 for k in ("PREPARATION", "VERIFICATION")) for v in mc.values()),
               heights=mc)
        dists = {k: v["distance"] for k, v in framing.items()}
        tall = {k: v["bodyTall"] for k, v in framing.items()}
        record("S7", "the Wardrobe frames every skin identically, on Relay OG's body height",
               len(framing) == len(SKINS) and len(set(dists.values())) == 1 and len(set(tall.values())) == 1,
               distance=dists, bodyTall=tall)
        RESULT["all_pass"] = all(x["pass"] for x in tests)
    if persisted:
        ui.wear_relay_skin(persisted)
        yield 1.5
    RESULT["status"] = "measured"
