# G1 QUALIFICATION -- FIVE-SKIN LOCOMOTION, MEASURED IN PLAY (founder regression, 2026-09-29).
#
# FOUNDER: "For each skin independently: SPAWN -> idle -> walk forward -> walk backward -> strafe left -> strafe right
# -> rotate -> sustained forward movement -> stop -> resume -> skin switch where supported ... Do not call this fixed
# from an asset inspection alone. PROVE IT IN SIMULATION."
#
# WHY THE EARLIER PROOFS PASSED A BROKEN WALK. zc_skin_parity / zc_skin_locomotion compared the 23 pose NUMBERS the
# Dog handed down with the 23 numbers the costume received -- identical -- and never looked at what the costume's
# JOINTS did with them. Every shin and forearm was being driven by the right knee (see FWonderlandWornPose). So this
# proof reads the joints and the feet themselves, against the canon body that keeps being posed under the costume:
#   FEET      the costume's sole on each side against the canon sole on the same side, every frame (world uu);
#   PHASE     the costume's +Y hip against the canon's +Y hip over the walk (correlation), and -Y likewise;
#   KNEES     never hyperextended (a costume shin's pitch is <= 0, folding back like the canon's);
#   LIMBS     hips and shoulders actually swing while walking (not frozen), and settle when stopped;
#   BODY      every joint within reach of the capsule (no transform explosion), the costume on the capsule's sole;
#   TRAVEL    the Dog covers the distance its walk speed says it should (so the body is not sliding or stuck).
# Relay OG is the canon body itself: TRAVEL and its own hips are measured, and it is the reference the rest match.
# Globals: SKINS, SPOT (x, y, z on open straight paving), FORWARD_YAW. PIE-owning: CONCURRENT is False. Saves nothing.
CONCURRENT = False
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
GS = unreal.GameplayStatics
SKINS = globals().get("SKINS", ["relay_og", "celestial_light", "skeleton_flame", "jack_flame", "baal"])
SPOT = globals().get("SPOT", [0.0, 44000.0, 12.0])      # the Icarus causeway: straight paving, 14 m wide, along +Y
FORWARD_YAW = globals().get("FORWARD_YAW", 90.0)
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "g1_locomotion")


def pearson(a, b):
    n = min(len(a), len(b))
    if n < 8:
        return None
    a, b = a[:n], b[:n]
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va < 1e-6 or vb < 1e-6:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


def pct(values, p):
    s = sorted(values)
    return s[min(len(s) - 1, int(round((len(s) - 1) * p)))] if s else None


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
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
    RESULT["persisted_skin_at_start"] = persisted

    def place():
        dog = dog_of()
        dog.character_movement.disable_movement()
        dog.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], 2500.0), False, True)
        unreal.SystemLibrary.execute_console_command(world, "FlushLevelStreaming")
        w = 0.0
        while w < 30.0:
            yield 0.5
            w += 0.5
            if L.is_world_partition_streaming_complete(world):
                break
        dog = dog_of()
        dog.set_actor_location(unreal.Vector(SPOT[0], SPOT[1], SPOT[2] + 120.0), False, True)
        dog.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=0.0, yaw=FORWARD_YAW), False)
        dog.character_movement.set_movement_mode(unreal.MovementMode.MOVE_WALKING)
        ctrl = dog.get_controller()
        if ctrl is not None:
            ctrl.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-10.0, yaw=FORWARD_YAW))
        yield 1.5

    def limbs(costume):
        """{('hip', +1): part name, ...} from the costume's own load-time classification."""
        out = {}
        for entry in str(costume.describe_limbs()).split(";"):
            entry = entry.strip()
            if "=" not in entry:
                continue
            name, rest = entry.split("=", 1)
            kind_side = rest.split(" ")[0]
            for kind in ("hip", "knee", "shoulder", "elbow"):
                if kind_side.startswith(kind):
                    side = kind_side[len(kind):]
                    out[(kind, 1 if side == "+Y" else (-1 if side == "-Y" else 0))] = name.strip()
        return out

    def run_skin(skin_id, switch_to=None):
        rec = {"skin": skin_id, "phases": {}, "checks": {}}
        ui.wear_relay_skin(skin_id)
        yield 2.5
        yield from place()
        dog = dog_of()
        costume = dog.get_costume()
        rec["worn"] = str(dog.get_worn_skin_id())
        rec["costume"] = None if costume is None else {"boxes": costume.get_box_count(), "figure": str(costume.get_figure_path()).split("/")[-1],
                                                       "limbs": str(costume.describe_limbs())}
        parts = limbs(costume) if costume is not None else {}
        speed_max = float(dog.character_movement.max_walk_speed)
        rec["max_walk_speed"] = speed_max
        samples = []
        phases = [("idle", None, 1.5), ("forward", 0.0, 3.0), ("backward", 180.0, 3.0), ("strafe_left", 90.0, 2.0),
                  ("strafe_right", -90.0, 2.0), ("rotate", "arc", 3.0), ("sustained", 0.0, 8.0), ("stop", None, 2.0),
                  ("resume", 0.0, 2.0)]
        if switch_to is not None:
            phases.append(("switch_walk", 0.0, 3.0))
        for name, rel, seconds in phases:
            dog = dog_of()
            start = dog.get_actor_location()
            g0 = GS.get_time_seconds(world)
            shot = False
            switched = False
            ph = {"start": [round(start.x), round(start.y)]}
            while GS.get_time_seconds(world) - g0 < seconds:
                dog = dog_of()
                if dog is None:
                    ph["dog_lost"] = True
                    break
                el = GS.get_time_seconds(world) - g0
                if rel is not None:
                    yaw = FORWARD_YAW + (180.0 * min(el / seconds, 1.0) if rel == "arc" else rel)
                    d = unreal.Vector(math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), 0.0)
                    dog.add_movement_input(d, 1.0, True)
                if name == "switch_walk" and not switched and el > 1.0:
                    ui.wear_relay_skin(switch_to)
                    switched = True
                    ph["switched_at"] = round(el, 2)
                if not shot and el > seconds * 0.5 and name in ("forward", "strafe_left", "sustained"):
                    H.capture_viewport_jpeg(os.path.join(ROOT, "%s_%s.jpg" % (skin_id, name)), 1280, 85)
                    shot = True
                c = dog.get_costume()
                loc = dog.get_actor_location()
                v = dog.get_velocity()
                s = {"phase": name, "t": round(el, 3), "x": loc.x, "y": loc.y, "z": loc.z,
                     "speed": math.hypot(v.x, v.y), "pitch": dog.get_actor_rotation().pitch, "roll": dog.get_actor_rotation().roll,
                     "mode": str(dog.character_movement.movement_mode)}
                pose = dog.get_canonical_worn_pose()
                s["canon_hip_p"] = pose.hip_plus_y.pitch
                s["canon_hip_m"] = pose.hip_minus_y.pitch
                if c is not None:
                    cp = limbs(c) if (name == "switch_walk" and switched) else parts
                    for side, key in ((1, "p"), (-1, "m")):
                        cs = c.get_sole_world(float(side))
                        ks = dog.get_canon_sole_world(float(side))
                        s["sole_err_" + key] = math.dist((cs.x, cs.y, cs.z), (ks.x, ks.y, ks.z)) if (cs.x or cs.y or cs.z) else None
                        if ("hip", side) in cp:
                            s["hip_" + key] = c.get_part_rotation(cp[("hip", side)]).pitch
                        if ("knee", side) in cp:
                            kr = c.get_part_rotation(cp[("knee", side)])
                            s["knee_" + key] = kr.pitch
                            # THE TRUE FOLD, from the quaternion: an Euler pitch pins at -90 and flips yaw/roll to 180 past
                            # it, which is why zg_16 read "min knee pitch -90.00" on every skin (zg_18: the fold peaks ~97
                            # degrees mid-swing, against the canon's own ~89 on the same stride -- a shorter shin, not a snap).
                            kq = kr.quaternion()
                            s["knee_fold_" + key] = math.degrees(2.0 * math.acos(max(-1.0, min(1.0, abs(kq.w)))))
                            ks = pose.shin_plus_y if side > 0 else pose.shin_minus_y
                            s["canon_knee_fold_" + key] = abs(ks.pitch)
                        if ("shoulder", side) in cp:
                            s["shoulder_" + key] = c.get_part_rotation(cp[("shoulder", side)]).pitch
                    cl = c.get_actor_location()
                    half = dog.capsule_component.get_scaled_capsule_half_height()
                    s["costume_offset"] = math.dist((cl.x, cl.y, cl.z), (loc.x, loc.y, loc.z - half))
                    s["costume_boxes"] = c.get_box_count()
                samples.append(s)
                yield 0.0
            end = dog_of().get_actor_location()
            ph["end"] = [round(end.x), round(end.y)]
            ph["moved_m"] = round(math.hypot(end.x - start.x, end.y - start.y) / 100.0, 2)
            if rel is not None and rel != "arc":
                yaw = math.radians(FORWARD_YAW + rel)
                ph["along_m"] = round(((end.x - start.x) * math.cos(yaw) + (end.y - start.y) * math.sin(yaw)) / 100.0, 2)
            rec["phases"][name] = ph
            emit("PHASE", skin_id, name, ph.get("moved_m"), ph.get("along_m"))
        # ---------------------------------------------------------------- the checks
        chk = rec["checks"]
        moving = [s for s in samples if s["phase"] in ("forward", "backward", "strafe_left", "strafe_right", "rotate", "sustained", "resume") and s["speed"] > 60.0]
        walking = [s for s in samples if s["phase"] in ("forward", "sustained", "resume") and s["speed"] > 120.0]
        P = rec["phases"]
        nominal = lambda secs: speed_max * secs / 100.0
        chk["forward_travel"] = {"pass": P["forward"].get("along_m", 0) >= 0.60 * nominal(3.0), "along_m": P["forward"].get("along_m"), "nominal_m": round(nominal(3.0), 2)}
        chk["backward_travel"] = {"pass": P["backward"].get("along_m", 0) >= 0.45 * nominal(3.0), "along_m": P["backward"].get("along_m")}
        chk["strafe_left_travel"] = {"pass": P["strafe_left"].get("along_m", 0) >= 0.40 * nominal(2.0), "along_m": P["strafe_left"].get("along_m")}
        chk["strafe_right_travel"] = {"pass": P["strafe_right"].get("along_m", 0) >= 0.40 * nominal(2.0), "along_m": P["strafe_right"].get("along_m")}
        chk["rotate_travel"] = {"pass": P["rotate"].get("moved_m", 0) >= 0.40 * nominal(3.0), "moved_m": P["rotate"].get("moved_m")}
        chk["sustained_travel"] = {"pass": P["sustained"].get("along_m", 0) >= 0.85 * nominal(8.0), "along_m": P["sustained"].get("along_m"), "nominal_m": round(nominal(8.0), 2)}
        stop_tail = [s for s in samples if s["phase"] == "stop" and s["t"] > 1.5]
        chk["stop"] = {"pass": bool(stop_tail) and max(s["speed"] for s in stop_tail) < 5.0,
                       "speed_end": round(max(s["speed"] for s in stop_tail), 2) if stop_tail else None}
        chk["resume_travel"] = {"pass": P["resume"].get("along_m", 0) >= 0.50 * nominal(2.0), "along_m": P["resume"].get("along_m")}
        chk["capsule_upright"] = {"pass": all(abs(s["pitch"]) < 1.0 and abs(s["roll"]) < 1.0 for s in samples),
                                  "max_tilt": round(max(max(abs(s["pitch"]), abs(s["roll"])) for s in samples), 3)}
        chk["always_on_foot"] = {"pass": all("WALKING" in s["mode"] or "FALLING" in s["mode"] for s in samples)
                                 and sum(1 for s in samples if "FALLING" in s["mode"]) <= 3,
                                 "falling_samples": sum(1 for s in samples if "FALLING" in s["mode"])}
        ch = [s["canon_hip_p"] for s in walking]
        chk["canon_hips_swing"] = {"pass": bool(ch) and (max(ch) - min(ch)) >= 10.0, "range_deg": round(max(ch) - min(ch), 1) if ch else None}
        if rec["costume"] is not None:
            errs = [s[k] for s in moving + [x for x in samples if x["phase"] in ("idle", "stop")] for k in ("sole_err_p", "sole_err_m") if s.get(k) is not None and s["phase"] != "switch_walk"]
            chk["feet_track_canon"] = {"pass": bool(errs) and pct(errs, 0.95) <= 3.0, "p95_uu": round(pct(errs, 0.95), 2) if errs else None,
                                       "max_uu": round(max(errs), 2) if errs else None, "n": len(errs)}
            knees = [s[k] for s in samples for k in ("knee_p", "knee_m") if s.get(k) is not None and s["phase"] != "switch_walk"]
            folds = [s[k] for s in samples for k in ("knee_fold_p", "knee_fold_m") if s.get(k) is not None and s["phase"] != "switch_walk"]
            canon_folds = [s[k] for s in samples for k in ("canon_knee_fold_p", "canon_knee_fold_m") if s.get(k) is not None and s["phase"] != "switch_walk"]
            chk["knees_never_hyperextend"] = {"pass": bool(knees) and max(knees) <= 1.0, "max_knee_pitch": round(max(knees), 2) if knees else None,
                                              "max_knee_fold_deg": round(max(folds), 1) if folds else None,
                                              "canon_max_knee_fold_deg": round(max(canon_folds), 1) if canon_folds else None}
            for key, canon in (("p", "canon_hip_p"), ("m", "canon_hip_m")):
                a = [s["hip_" + key] for s in walking if s.get("hip_" + key) is not None]
                b = [s[canon] for s in walking if s.get("hip_" + key) is not None]
                r = pearson(a, b)
                chk["hip_phase_%sY" % ("+" if key == "p" else "-")] = {"pass": r is not None and r >= 0.85, "correlation_with_canon_same_side": None if r is None else round(r, 3),
                                                                       "range_deg": round(max(a) - min(a), 1) if a else None}
            sh = [s["shoulder_p"] for s in walking if s.get("shoulder_p") is not None]
            chk["arms_swing"] = {"pass": bool(sh) and (max(sh) - min(sh)) >= 4.0, "range_deg": round(max(sh) - min(sh), 1) if sh else None}
            st = [s for s in samples if s["phase"] == "stop" and s["t"] > 1.5 and s.get("hip_p") is not None]
            chk["legs_settle_when_stopped"] = {"pass": bool(st) and max(max(abs(s["hip_p"]), abs(s.get("hip_m") or 0.0)) for s in st) < 8.0,
                                               "max_hip_deg": round(max(max(abs(s["hip_p"]), abs(s.get("hip_m") or 0.0)) for s in st), 2) if st else None}
            offs = [s["costume_offset"] for s in samples if s.get("costume_offset") is not None]
            chk["costume_on_capsule"] = {"pass": bool(offs) and max(offs) <= 2.0, "max_offset_uu": round(max(offs), 3) if offs else None}
            chk["no_transform_explosion"] = {"pass": bool(errs) and max(errs) < 60.0 and all(abs(s["z"]) < 1.0e5 for s in samples)}
        if switch_to is not None:
            sw = [s for s in samples if s["phase"] == "switch_walk" and s["t"] > P["switch_walk"].get("switched_at", 9) + 1.0]
            e2 = [s[k] for s in sw for k in ("sole_err_p", "sole_err_m") if s.get(k) is not None]
            dog = dog_of()
            # switching TO Relay OG takes the costume off: there is then no costume foot to hold against the canon
            feet_ok = (dog.get_costume() is None) if switch_to == "relay_og" else (bool(e2) and pct(e2, 0.95) <= 3.0)
            chk["skin_switch_while_walking"] = {"pass": str(dog.get_worn_skin_id()) == switch_to and feet_ok
                                                and P["switch_walk"].get("along_m", 0) >= 0.5 * nominal(3.0),
                                                "worn_after": str(dog.get_worn_skin_id()), "p95_uu_after": round(pct(e2, 0.95), 2) if e2 else None,
                                                "along_m": P["switch_walk"].get("along_m")}
        rec["pass"] = all(v.get("pass") for v in chk.values())
        rec["samples"] = len(samples)
        return rec

    results = []
    RESULT["skins"] = results
    for i, skin in enumerate(SKINS):
        nxt = SKINS[(i + 1) % len(SKINS)] if skin != "relay_og" else None
        rec = yield from run_skin(skin, switch_to=nxt)
        results.append(rec)
        emit("SKIN", skin, "PASS" if rec["pass"] else "FAIL", [k for k, v in rec["checks"].items() if not v.get("pass")])
    if persisted:
        ui.wear_relay_skin(persisted)
        yield 2.0
    RESULT["restored_skin"] = persisted
    RESULT["all_pass"] = all(r["pass"] for r in results)
    RESULT["status"] = "measured"
