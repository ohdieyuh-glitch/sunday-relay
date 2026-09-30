# G1c -- ON THE SCENARIO PATH, DO THE SKINS' HANDS STAY ON THE CANON'S (AND SO ON THE PROPS)?
#
# Second Wonderland's zs_04 (2026-09-30, b331617f): on the founder's own mission path (wl.Mission.Scenario, the Contract
# staged 340 uu out), IMPLEMENTATION and REPAIR held every alternate skin's hands 8-22 uu off the canon's hands at full act
# weight, while the scheduler path (zg_12 / zh_14) read 0.05 uu. The brush and scraper hang from the canon forearm, so the
# tool floated off the paw. The fix keeps each act's hand goal inside the worn arm's reach as well as the canon's.
#
# Per skin: stand at the site, `wl.Mission.Scenario B <PACE>`, and sample every 0.1 s: the act performed, its weight, and
# the costume hand against the canon hand on both sides. Judged per act, over the samples at weight >= 0.98:
#   H1  p95 hand gap <= 1.5 uu in every act (the G1 proof's own standard is 0.06 uu on the scheduler path)
#   H2  every act of Relay OG's sequence was actually reached at full weight (so H1 is not vacuous)
#   P1  (Second Wonderland's ask) every VISIBLE canon prop (MissionBrush / Scraper / Book / Lens ...) is as close to the
#       costume's paw as it is to the canon hand it hangs from: p95 of (prop->paw - prop->canon hand) <= 2 uu
#   O1  Relay OG's canon hand paths, per act, in the Dog's own frame, are recorded (compared across builds offline)
#   F   a close frame per act per skin, looking at the working hand, to see it still reads as working the Contract
# Globals: SKINS, PACE, LIMIT. PIE-owning: CONCURRENT is False. Saves nothing; restores the persisted skin.
CONCURRENT = False
import math
import os

L = unreal.WonderlandUiTestLibrary
GS = unreal.GameplayStatics
SKINS = globals().get("SKINS", ["relay_og", "celestial_light", "skeleton_flame", "jack_flame", "baal"])
PACE = float(globals().get("PACE", 5.0))
LIMIT = float(globals().get("LIMIT", 170.0))
TAG = globals().get("TAG", "run")
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zh", "scenario_hands_%s" % TAG)


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    RESULT["status"] = "running"
    os.makedirs(ROOT, exist_ok=True)
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
    yield 4.0
    L.focus_game_viewport()
    ui = L.get_ui(world)
    tasks = L.get_mission_tasks(world)
    mission = L.get_mission(world)
    travel = next(c for c in unreal.ObjectIterator(unreal.WonderlandTravelSubsystem) if c.get_world() == world)
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

    def cmd(text):
        unreal.SystemLibrary.execute_console_command(world, text)

    travel.request_travel("castle_approach")
    w = 0.0
    yield 0.5
    while travel.is_travelling() and w < 95.0:
        yield 0.25
        w += 0.25
    yield 3.0

    reference_acts = None
    runs = []
    RESULT["runs"] = runs
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 2.5
        tasks.clear_all_tasks_for_development()
        yield 1.0
        cmd("wl.Mission.Scenario B %.1f" % PACE)
        per_act = {}
        g0 = GS.get_time_seconds(world)
        seen_running = False
        while GS.get_time_seconds(world) - g0 < LIMIT:
            dog = dog_of()
            pose = dog.get_canonical_worn_pose()
            weight = float(pose.mission_weight)
            act = str(mission.get_dog_performing_label()).upper()
            if weight >= 0.5:
                seen_running = True
            costume = dog.get_costume()
            if weight >= 0.98 and act not in ("", "NONE"):
                row = per_act.setdefault(act, {"gaps": [], "n": 0, "prop": [], "local": [], "shot": False})
                row["n"] += 1
                xf = dog.get_actor_transform()
                hands_k = {side: dog.get_canon_hand_world(side) for side in (1.0, -1.0)}
                hands_c = {side: costume.get_hand_world(side) for side in (1.0, -1.0)} if costume is not None else {}
                # O1: the canon hands in the Dog's own frame (Relay OG's paths are compared across builds)
                lk = [xf.inverse_transform_location(hands_k[s]) for s in (1.0, -1.0)]
                row["local"].append([round(v, 2) for p in lk for v in (p.x, p.y, p.z)])
                if costume is not None:
                    for side in (1.0, -1.0):
                        ch, kh = hands_c[side], hands_k[side]
                        if not (abs(ch.x) + abs(ch.y) + abs(ch.z) < 1e-3 or abs(kh.x) + abs(kh.y) + abs(kh.z) < 1e-3):
                            row["gaps"].append(math.dist((ch.x, ch.y, ch.z), (kh.x, kh.y, kh.z)))
                    # P1: each visible canon prop, to the costume paw against to the canon hand (the nearer side of each)
                    # measured to the prop's BOUNDS, not its origin: a component origin sits back toward the elbow, so a
                    # paw falling short moved CLOSER to it and the first cut of this check read 0.0 on the failing build.
                    for comp in dog.get_components_by_class(unreal.PrimitiveComponent):
                        name = comp.get_name()
                        if not name.startswith("Mission") or not comp.is_visible():
                            continue
                        b_origin, b_extent, _r = unreal.SystemLibrary.get_component_bounds(comp)
                        def to_box(h):
                            dx = max(abs(h.x - b_origin.x) - b_extent.x, 0.0)
                            dy = max(abs(h.y - b_origin.y) - b_extent.y, 0.0)
                            dz = max(abs(h.z - b_origin.z) - b_extent.z, 0.0)
                            return math.sqrt(dx * dx + dy * dy + dz * dz)
                        to_paw = min(to_box(h) for h in hands_c.values())
                        to_canon = min(to_box(h) for h in hands_k.values())
                        if to_canon <= 2.0:       # a prop the canon hand is actually holding
                            row["prop"].append((name, to_paw - to_canon, to_paw, to_canon))
                # F: one close frame per act, looking at the working hand from the side, the Contract beyond. The camera is
                # posed on one sample and the frame taken 0.5 s later, once the view has actually moved.
                now = GS.get_time_seconds(world)
                if row.get("posed_at") is not None and now - row["posed_at"] >= 0.5 and not row["shot"]:
                    H.capture_viewport_jpeg(os.path.join(ROOT, "%s_%s.jpg" % (skin, act.lower())), 1280, 88)
                    L.release_camera(world)
                    row["shot"] = True
                elif row.get("posed_at") is None and row["n"] >= 12:
                    target = hands_c.get(-1.0) if costume is not None else hands_k[-1.0]
                    fwd = dog.get_actor_forward_vector()
                    right = dog.get_actor_right_vector()
                    eye = unreal.Vector(target.x - fwd.x * 90.0 - right.x * 260.0, target.y - fwd.y * 90.0 - right.y * 260.0, target.z + 60.0)
                    L.pose_camera(world, eye, unreal.Vector(target.x + fwd.x * 120.0, target.y + fwd.y * 120.0, target.z), 50.0)
                    row["posed_at"] = now
            # the fixture ends by itself; stop sampling once it has run and gone quiet
            if seen_running and weight <= 0.01 and act in ("", "NONE") and GS.get_time_seconds(world) - g0 > 30.0:
                break
            yield 0.1
        L.release_camera(world)
        cmd("wl.Mission.Stop")
        yield 3.0
        summary = {}
        for act, row in per_act.items():
            g = sorted(row["gaps"])
            extra = sorted(x[1] for x in row["prop"])
            props = sorted({x[0] for x in row["prop"]})
            local = row["local"]
            med = [round(sorted(col)[len(col) // 2], 2) for col in zip(*local)] if local else []
            summary[act] = {"samples": row["n"], "gap_p95": round(g[int(len(g) * 0.95)] if g else 0.0, 2),
                            "gap_median": round(g[len(g) // 2] if g else 0.0, 2), "gap_max": round(g[-1] if g else 0.0, 2),
                            "props": props, "prop_extra_p95": round(extra[int(len(extra) * 0.95)] if extra else 0.0, 2),
                            "prop_to_paw_median": round(sorted(x[2] for x in row["prop"])[len(row["prop"]) // 2], 2) if row["prop"] else None,
                            "canon_hands_local_median": med}
        runs.append({"skin": skin, "acts": summary})
        if skin == "relay_og":
            reference_acts = sorted(summary.keys())
            continue
        bad = {a: s["gap_p95"] for a, s in summary.items() if s["gap_p95"] > 1.5}
        record("H1_%s" % skin, "%s: costume hands on the canon hands in every act at full weight (p95 <= 1.5 uu)" % skin,
               not bad, bad=bad, acts={a: s["gap_p95"] for a, s in summary.items()})
        missing = [a for a in (reference_acts or []) if a not in summary]
        pbad = {a: s["prop_extra_p95"] for a, s in summary.items() if s["props"] and s["prop_extra_p95"] > 2.0}
        # P1 IS INFORMATION, NOT A VERDICT: on the failing build it read 0.0 whether measured to a prop's origin (which sits
        # toward the elbow) or to its world bounds (a 35-40 uu brush's box contains a paw 10 uu short). A held prop's grip IS
        # the canon hand, so prop-to-paw is exactly H1's hand gap -- H1 is the verdict (zh_31 / zh_33: 10.2 / 11.1 uu, FAIL).
        RESULT.setdefault("p1_information", {})[skin] = {"bad": pbad,
            "props": {a: [s["props"], s["prop_extra_p95"], s["prop_to_paw_median"]] for a, s in summary.items() if s["props"]}}
        record("H2_%s" % skin, "%s: every act Relay OG reached was reached at full weight (H1 is not vacuous)" % skin,
               not missing, missing=missing, reached=sorted(summary.keys()))
        tasks.clear_all_tasks_for_development()
        yield 1.0
    if persisted:
        ui.wear_relay_skin(persisted)
        yield 1.5
    RESULT["reference_acts"] = reference_acts
    RESULT["all_pass"] = all(x["pass"] for x in tests)
    RESULT["status"] = "measured"
