# G1 QUALIFICATION -- THE MISSION CONTRACT SEQUENCE ON ALL FIVE SKINS, MEASURED IN PLAY (founder correction, 2026-09-29).
#
# FOUNDER: "The animation problem I am describing is specifically the MISSION CONTRACT ANIMATION SEQUENCES ... Test the
# complete Mission Contract sequence independently with all five ... PROVE THE FULL MISSION CONTRACT SEQUENCE IN THE
# ACTUAL SIMULATION. Also test multiple consecutive Mission Contract deployments."
#
# Relay OG is the reference and runs first. Every skin then runs the whole lifecycle -- PREPARATION, RESEARCH,
# IMPLEMENTATION, VERIFICATION, REVIEW, REPAIR, COMPLETED -- DEPLOYMENTS times in a row, driven through wl.Tasks.Scheduler
# (the only path that advances a contract without Julius; see zc_mission_parity). The canon body keeps being posed under
# every costume, so each skin is measured against Relay OG's own joints IN THE SAME FRAME:
#   ACT       the act the Dog performs in each stage is the act Relay OG performs there;
#   HANDS     each costume hand is where the canon hand is -- on the book, the brush, the lens, aimed at the Contract --
#             once the act is fully on (a target past the costume arm's reach: the arm points at it, shortfall reported);
#   PROPS     a visible prop sits as close to the costume's hand as it does to the canon's;
#   BODY      the costume root carries exactly the canon body's lift, lean and roll (VERIFICATION's 9-degree fly lean too);
#   HEAD      the costume head turns and bows exactly as the canon head;
#   FEET      while the legs walk (no crossed or trailing pose), each costume sole is on the canon sole;
#   AURA      a floating ornament rides the lifted body once, not twice (Celestial Light's aura);
#   SANITY    no joint leaves the body;
#   DONE      COMPLETED settles: the act weight returns to 0, the lift to 0, and the next deployment starts clean.
# Globals: SKINS, DEPLOYMENTS. PIE-owning: CONCURRENT is False. Saves nothing; restores the persisted skin.
CONCURRENT = False
import json
import math
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
GS = unreal.GameplayStatics
SKINS = globals().get("SKINS", ["relay_og", "celestial_light", "skeleton_flame", "jack_flame", "baal"])
DEPLOYMENTS = int(globals().get("DEPLOYMENTS", 2))
STAGES = ["PREPARATION", "RESEARCH", "IMPLEMENTATION", "VERIFICATION", "REVIEW", "REPAIR", "COMPLETED"]
WINDOW = {"REPAIR": 10.0, "COMPLETED": 6.0}
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zg", "mission_contract")
HAND_TOL = 3.0
FOOT_TOL = 3.0
BODY_TOL = 1.0
ROT_TOL = 0.5


def pct(values, p):
    s = sorted(v for v in values if v is not None)
    return s[min(len(s) - 1, int(round((len(s) - 1) * p)))] if s else None


def dist(a, b):
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)


def is_zero(v):
    return abs(v.x) < 1e-3 and abs(v.y) < 1e-3 and abs(v.z) < 1e-3


def rot_diff(a, b):
    def d(x, y):
        return abs((x - y + 180.0) % 360.0 - 180.0)
    return max(d(a.pitch, b.pitch), d(a.yaw, b.yaw), d(a.roll, b.roll))


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    RESULT["status"] = "running"
    L.set_background_throttle_suspended(True)
    try:
        yield from _run(ues, les)
    finally:
        try:
            world = ues.get_game_world()
            if world is not None:
                L.release_camera(world)
        except Exception:
            pass
        with open(os.path.join(ROOT, "mission_contract.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            while ues.get_game_world() is not None:
                yield 1.0


def _run(ues, les):
    if ues.get_game_world() is None:
        les.editor_request_begin_play()
    t = 0.0
    while ues.get_game_world() is None and t < 120.0:
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
    persisted = None
    try:
        persisted = open(os.path.join(unreal.Paths.project_saved_dir(), "Wonderland", "RelaySkin.txt")).read().strip()
    except Exception:
        pass
    RESULT["persisted_skin_at_start"] = persisted
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def comps(actor):
        out = {}
        for c in actor.get_components_by_class(unreal.SceneComponent):
            out[c.get_name()] = c
        return out

    def costume_parts(costume):
        names = [str(n) for n in costume.get_part_names()]
        out = {}
        for c in costume.get_components_by_class(unreal.SceneComponent):
            n = c.get_name()
            if not n.startswith("Part_"):
                continue
            key = n[5:]
            if key not in names:
                base, _, tail = key.rpartition("_")
                if tail.isdigit() and base in names:
                    key = base
            if key in names and key not in out:
                out[key] = c
        return out

    def arms_of(costume):
        """{side: (shoulder part name, upper length, forearm length)} from the costume's load-time classification."""
        out = {}
        for entry in str(costume.describe_limbs()).split(";"):
            entry = entry.strip()
            if "=" not in entry:
                continue
            name, rest = entry.split("=", 1)
            words = rest.split()
            if not words or not words[0].startswith("shoulder"):
                continue
            side = 1 if words[0].endswith("+Y") else (-1 if words[0].endswith("-Y") else 0)
            try:
                upper = float(words[words.index("thigh") + 1])
                lower = float(words[words.index("shin") + 1])
            except Exception:
                continue
            out[side] = (name.strip(), upper, lower)
        return out

    def rel_loc(c):
        return c.get_editor_property("relative_location")

    def rel_rot(c):
        return c.get_editor_property("relative_rotation")

    def frame(path, target, bearing=35.0, dist_uu=430.0, lift=70.0, fov=45.0):
        dog = dog_of()
        yaw = math.radians(float(dog.get_actor_rotation().yaw) + bearing)
        eye = unreal.Vector(target.x + math.cos(yaw) * dist_uu, target.y + math.sin(yaw) * dist_uu, target.z + lift)
        L.pose_camera(world, eye, target, fov)

    reference = {}
    runs = []
    RESULT["runs"] = runs
    for skin in SKINS:
        worn = bool(ui.wear_relay_skin(skin))
        yield 2.5
        dog = dog_of()
        canon = comps(dog)
        body = canon.get("Body")
        head_c = canon.get("Pivot_head")
        props = {n: c for n, c in canon.items() if n.startswith("Mission") and isinstance(c, unreal.PrimitiveComponent)}
        costume = dog.get_costume()
        is_og = skin == "relay_og"
        parts = costume_parts(costume) if costume is not None else {}
        arms = arms_of(costume) if costume is not None else {}
        height = float(costume.get_figure_height_uu()) if costume is not None else 0.0
        # THE CONSTANTS OF THE PAIR, read standing still before any act: the canon body's rest height over the costume
        # root's, and the aura's height over the costume root -- whatever an act does, these must not change.
        yield 1.0
        dz0 = aura0 = None
        if costume is not None and body is not None and "root" in parts:
            dz0 = rel_loc(body).z - rel_loc(parts["root"]).z
            if "aura" in parts:
                aura0 = parts["aura"].get_world_location().z - parts["root"].get_world_location().z
        skin_run = {"skin": skin, "worn": worn, "worn_id": str(dog.get_worn_skin_id()), "arms": {str(k): v for k, v in arms.items()},
                    "figure_height_uu": round(height, 1), "deployments": []}
        runs.append(skin_run)
        for dep in range(1, DEPLOYMENTS + 1):
            tasks.clear_all_tasks_for_development()
            yield 0.8
            tasks.submit_draft(tasks.add_draft(), "Survey the arrival plaza")
            yield 1.5
            dep_rec = {"deployment": dep, "contracts": len(tasks.get_task_list()), "stages": []}
            skin_run["deployments"].append(dep_rec)
            pre = dog_of().get_canonical_worn_pose()
            dep_rec["weight_before"] = round(float(pre.mission_weight), 3)
            dep_rec["act_before"] = str(mission.get_dog_performing_label())
            for n, stage in enumerate(STAGES):
                unreal.SystemLibrary.execute_console_command(world, "wl.Tasks.Scheduler 0 %s" % stage)
                yield 1.5
                window = WINDOW.get(stage, 5.0)
                g0 = GS.get_time_seconds(world)
                labels = []
                hand_err = {1: [], -1: []}
                reach_short = {1: [], -1: []}
                aim_err = {1: [], -1: []}
                prop_gap = []
                dz_err, root_rot, head_rot, sole_err, aura_err, far = [], [], [], [], [], []
                lift_max, pitch_max, weight_min = 0.0, 0.0, 1.0
                shot = False
                while GS.get_time_seconds(world) - g0 < window:
                    dog = dog_of()
                    costume = dog.get_costume()
                    pose = dog.get_canonical_worn_pose()
                    labels.append(str(mission.get_dog_performing_label()))
                    weight = float(pose.mission_weight)
                    weight_min = min(weight_min, weight)
                    lift_max = max(lift_max, float(pose.lift_uu))
                    if body is not None:
                        pitch_max = max(pitch_max, abs(float(rel_rot(body).pitch)))
                    if costume is not None and not is_og:
                        if weight >= 0.98:
                            for side in (1, -1):
                                ch = costume.get_hand_world(float(side))
                                kh = dog.get_canon_hand_world(float(side))
                                if is_zero(ch) or is_zero(kh) or side not in arms or arms[side][0] not in parts:
                                    continue
                                sh = parts[arms[side][0]].get_world_location()
                                reach = arms[side][1] + arms[side][2]
                                need = dist(sh, kh)
                                if need <= reach - 0.5:
                                    hand_err[side].append(dist(ch, kh))
                                else:
                                    reach_short[side].append(need - reach)
                                    a = unreal.Vector(ch.x - sh.x, ch.y - sh.y, ch.z - sh.z)
                                    b = unreal.Vector(kh.x - sh.x, kh.y - sh.y, kh.z - sh.z)
                                    la = math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
                                    lb = math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z)
                                    if la > 1e-3 and lb > 1e-3:
                                        cosv = max(-1.0, min(1.0, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb)))
                                        aim_err[side].append(math.degrees(math.acos(cosv)))
                            # PROPS: how far each visible prop is from the costume's nearest hand, against the canon's
                            hands_c = [h for h in (costume.get_hand_world(1.0), costume.get_hand_world(-1.0)) if not is_zero(h)]
                            hands_k = [h for h in (dog.get_canon_hand_world(1.0), dog.get_canon_hand_world(-1.0)) if not is_zero(h)]
                            for pname, pc in (props.items() if hands_c and hands_k else []):
                                if not pc.is_visible() or not (pname.startswith("MissionBook") or pname.startswith("MissionBrush")
                                                                or pname.startswith("MissionLens") or pname.startswith("MissionScraper")):
                                    continue
                                pl = pc.get_world_location()
                                gc = min(dist(pl, h) for h in hands_c)
                                gk = min(dist(pl, h) for h in hands_k)
                                prop_gap.append((pname, gc - gk))
                        if body is not None and "root" in parts and dz0 is not None:
                            dz_err.append(abs((rel_loc(body).z - rel_loc(parts["root"]).z) - dz0))
                            root_rot.append(rot_diff(rel_rot(body), rel_rot(parts["root"])))
                        if head_c is not None and "head" in parts:
                            head_rot.append(rot_diff(rel_rot(head_c), rel_rot(parts["head"])))
                        if float(pose.leg_perform_weight) < 0.005:
                            for side in (1, -1):
                                cs = costume.get_sole_world(float(side))
                                ks = dog.get_canon_sole_world(float(side))
                                if not is_zero(cs) and not is_zero(ks):
                                    sole_err.append(dist(cs, ks))
                        if aura0 is not None:
                            aura_err.append(abs((parts["aura"].get_world_location().z - parts["root"].get_world_location().z) - aura0))
                        cap = dog.get_actor_location()
                        far.append(max(dist(c.get_world_location(), cap) for c in parts.values()) if parts else 0.0)
                    if dep == 1 and not shot and GS.get_time_seconds(world) - g0 > window * 0.55:
                        target = body.get_world_location() if body is not None else dog.get_actor_location()
                        frame(None, target)
                        yield 0.6
                        H.capture_viewport_jpeg(os.path.join(ROOT, "%s_d%d_%d_%s.jpg" % (skin, dep, n + 1, stage.lower())), 1600, 90)
                        if skin == "jack_flame" and "head" in parts:
                            hp = parts["head"].get_world_location()
                            frame(None, unreal.Vector(hp.x, hp.y, hp.z + 16.0), bearing=30.0, dist_uu=330.0, lift=14.0, fov=40.0)
                            yield 0.6
                            H.capture_viewport_jpeg(os.path.join(ROOT, "%s_d%d_%d_%s_head.jpg" % (skin, dep, n + 1, stage.lower())), 1600, 90)
                        L.release_camera(world)
                        shot = True
                    yield 0.15
                counts = {}
                for lab in labels:
                    counts[lab] = counts.get(lab, 0) + 1
                dominant = max(counts, key=counts.get) if counts else "none"
                seq = [lab for i, lab in enumerate(labels) if i == 0 or labels[i - 1] != lab]
                state = str(tasks.get_task_list()[0].state) if tasks.get_task_list() else "none"
                row = {"stage": stage, "task_state": state, "act": dominant, "act_sequence": seq,
                       "weight_min": round(weight_min, 3), "lift_max_uu": round(lift_max, 1), "canon_body_pitch_max": round(pitch_max, 2)}
                if not is_og and costume is not None:
                    for side, key in ((1, "p"), (-1, "m")):
                        row["hand_err_p95_" + key] = None if not hand_err[side] else round(pct(hand_err[side], 0.95), 2)
                        row["hand_samples_" + key] = len(hand_err[side])
                        row["reach_short_max_" + key] = None if not reach_short[side] else round(max(reach_short[side]), 1)
                        row["reach_limited_samples_" + key] = len(reach_short[side])
                        row["aim_err_p95_" + key] = None if not aim_err[side] else round(pct(aim_err[side], 0.95), 2)
                    row["prop_gap_vs_canon_p95"] = None if not prop_gap else round(pct([abs(g) for _, g in prop_gap], 0.95), 2)
                    row["props_seen"] = sorted(set(p for p, _ in prop_gap))
                    row["body_dz_err_p95"] = None if not dz_err else round(pct(dz_err, 0.95), 3)
                    row["body_rot_err_p95"] = None if not root_rot else round(pct(root_rot, 0.95), 3)
                    row["head_rot_err_p95"] = None if not head_rot else round(pct(head_rot, 0.95), 3)
                    row["sole_err_p95"] = None if not sole_err else round(pct(sole_err, 0.95), 2)
                    row["sole_samples"] = len(sole_err)
                    row["aura_err_max"] = None if not aura_err else round(max(aura_err), 2)
                    row["farthest_joint_uu"] = None if not far else round(max(far), 1)
                dep_rec["stages"].append(row)
            # ---- COMPLETION SETTLES, and what the Dog is left doing
            yield 3.0
            post = dog_of().get_canonical_worn_pose()
            dep_rec["weight_after"] = round(float(post.mission_weight), 3)
            dep_rec["lift_after"] = round(float(post.lift_uu), 2)
            dep_rec["act_after"] = str(mission.get_dog_performing_label())
            dep_rec["movement_mode_after"] = str(dog_of().character_movement.movement_mode)
        if is_og:
            reference = {d["deployment"]: [r["act"] for r in d["stages"]] for d in skin_run["deployments"]}
            RESULT["reference_acts"] = reference

    # ================================================================== VERDICTS
    ref = RESULT.get("reference_acts", {}).get(1)
    verdicts = {}
    RESULT["verdicts"] = verdicts
    for run in runs:
        skin = run["skin"]
        fails = []
        for dep in run["deployments"]:
            acts = [r["act"] for r in dep["stages"]]
            if ref is not None and acts != ref:
                fails.append("d%d acts %s != Relay OG %s" % (dep["deployment"], acts, ref))
            if "COMPLETED" not in dep["stages"][-1]["task_state"].upper():
                fails.append("d%d did not reach COMPLETED (%s)" % (dep["deployment"], dep["stages"][-1]["task_state"]))
            if dep["weight_after"] > 0.02 or dep["lift_after"] > 1.0:
                fails.append("d%d did not settle (weight %.3f lift %.1f)" % (dep["deployment"], dep["weight_after"], dep["lift_after"]))
            if dep["deployment"] > 1 and dep["weight_before"] > 0.02:
                fails.append("d%d started with the last act still on (weight %.3f)" % (dep["deployment"], dep["weight_before"]))
            if skin == "relay_og":
                continue
            for r in dep["stages"]:
                tag = "d%d %s" % (dep["deployment"], r["stage"])
                for key in ("hand_err_p95_p", "hand_err_p95_m"):
                    if r.get(key) is not None and r[key] > HAND_TOL:
                        fails.append("%s %s %.2f uu" % (tag, key, r[key]))
                for key in ("aim_err_p95_p", "aim_err_p95_m"):
                    if r.get(key) is not None and r[key] > 6.0:
                        fails.append("%s %s %.1f deg" % (tag, key, r[key]))
                if r.get("prop_gap_vs_canon_p95") is not None and r["prop_gap_vs_canon_p95"] > HAND_TOL + 1.0:
                    fails.append("%s prop gap %.2f uu beyond the canon's" % (tag, r["prop_gap_vs_canon_p95"]))
                if r.get("body_dz_err_p95") is not None and r["body_dz_err_p95"] > BODY_TOL:
                    fails.append("%s body lift off the canon's by %.2f uu" % (tag, r["body_dz_err_p95"]))
                if r.get("body_rot_err_p95") is not None and r["body_rot_err_p95"] > ROT_TOL:
                    fails.append("%s body lean off the canon's by %.2f deg" % (tag, r["body_rot_err_p95"]))
                if r.get("head_rot_err_p95") is not None and r["head_rot_err_p95"] > ROT_TOL:
                    fails.append("%s head off the canon's by %.2f deg" % (tag, r["head_rot_err_p95"]))
                if r.get("sole_err_p95") is not None and r["sole_err_p95"] > FOOT_TOL:
                    fails.append("%s feet off the canon's by %.2f uu" % (tag, r["sole_err_p95"]))
                if r.get("aura_err_max") is not None and r["aura_err_max"] > 6.0:
                    fails.append("%s aura moved %.1f uu against the body" % (tag, r["aura_err_max"]))
                if r.get("farthest_joint_uu") is not None and run["figure_height_uu"] > 0 and r["farthest_joint_uu"] > 1.5 * run["figure_height_uu"] + 160.0:
                    fails.append("%s a joint left the body (%.0f uu)" % (tag, r["farthest_joint_uu"]))
        if len(run["deployments"]) > 1:
            a = [r["act"] for r in run["deployments"][0]["stages"]]
            b = [r["act"] for r in run["deployments"][1]["stages"]]
            if a != b:
                fails.append("deployment 2 acts %s differ from deployment 1 %s" % (b, a))
        verdicts[skin] = {"pass": not fails, "fails": fails}
        record("MC_" + skin, "%s performs the whole Mission Contract like Relay OG, %d deployments" % (skin, DEPLOYMENTS),
               not fails, fails=fails[:12])

    if persisted:
        ui.wear_relay_skin(persisted)
        yield 1.5
    RESULT["restored_skin"] = persisted
    RESULT["status"] = "measured"
