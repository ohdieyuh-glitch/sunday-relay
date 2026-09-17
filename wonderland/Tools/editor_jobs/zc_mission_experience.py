# PIE job: THE FULL SIMULATED MISSION EXPERIENCE, filmed (founder, 2026-09-16).
#
# The Relay Dog performing every stage around the floating Mission Contract, the Julius Live Terminal narrating the
# Julius-shaped events, and -- when /join in is simulated -- the LLM Companion and the Jhinn flying about the Contract,
# sending their contributions into it, each narrating its own part on its own terminal. Four participation scenarios,
# each a full deterministic lifecycle: A Julius only, B + LLM Companion, C + Jhinn, D + both. D is filmed first because
# it is the one the founder asked to see above all.
#
# A FILM, NOT STILLS. Every tick is written as a JPEG (UWonderlandHudTestLibrary.CaptureViewportJpeg) under half-speed
# world time -- the fixture now runs on the world's clock, so slowing the world slows the story with it -- and beside
# every frame the job records what the world and every terminal said at that instant. The film is assembled offline.
#
# SYNCHRONISATION IS MEASURED FROM THAT RECORD, not assumed: a joined companion's flight and its terminal's narration
# must both name the beat the world is in, on every frame.
#
# NO PROVIDER IS CALLED. DEVELOPMENT PREVIEW · SIMULATED JULIUS EXECUTION throughout.
import json
import math
import os
import time

L = unreal.WonderlandUiTestLibrary
# CAMERA WRITES SEND NO CHANGE NOTIFICATION. A notified property write on the play pawn in PIE re-runs its construction
# (measured 2026-09-16, zc_book_bisect): the Blueprint joints are rebuilt, the Dog keeps posing the old ones, and its book is
# re-parented from the Body to the capsule -- over its head or on the floor in the film, never in the game.
QUIET = unreal.PropertyAccessChangeNotifyMode.NEVER
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "mission_experience")
SCENARIOS = globals().get("SCENARIOS") or ["D", "A", "B", "C"]
# TEN WORLD SECONDS AN EVENT: long enough for the Julius terminal's stream to write every component's work for that
# event at a readable pace (WonderlandRoleLineHoldSeconds x wl.Julius.StreamPace), so the world never moves on while
# the terminal is mid-sentence.
PACE = float(globals().get("PACE") or 10.0)         # world seconds per mission event
SLOMO = float(globals().get("SLOMO") or 0.5)        # world time dilation to start from
# A STEADY FILM WHATEVER THE EDITOR MANAGES. The world is slowed afresh every tick so that each captured frame
# advances the same world time, 1/FILM_FPS of a second: the second film ran at 1.3 editor frames a second on a laptop
# on battery, and under a fixed slow motion that was a slideshow. Slower editor, longer capture, same film.
FILM_FPS = float(globals().get("FILM_FPS") or 20.0)
# None films the mini-map exactly as the build draws it. The first film forced the fan path, which hid the fact that
# the default path still drew a white disc.
MINIMAP_MODE = globals().get("MINIMAP_MODE")
# 1600 wide: the Julius terminal's section lines stay readable in the film; native would double the size on disk.
FRAME_WIDTH = int(globals().get("FRAME_WIDTH") or 1600)
# THE FILM CAMERA. The stock arm (anything longer slides into Wonderland's collision-free scenery -- see
# zc_joint_proof J15) turned toward the MIDPOINT of the Dog and the Contract, so the camera stands outside the
# Dog's circle and sees it side-on as it walks round, with the Contract and the companions above it in frame.
# Straight behind the Dog, the first film saw a white back, no book, and only the companions' feet at the top edge.
CAMERA_ARM = 440.0
# TWO FRAMINGS, blended (zc_camera_test, 2026-09-16). Filmed from high behind at one distance, the Dog's head hid its open
# book and the turning page, the Dog stood on the Julius terminal's top edge and the companions left the top of the frame.
# While the Dog reads the camera is close and low behind it, looking over its shoulder at the pages; while the companions
# work it is wider, so their orbit, pulses and beams and the Contract stay in shot. (arm, socket y, socket z, pitch)
READ_FRAMING = tuple(globals().get("READ_FRAMING") or (380.0, 40.0, 60.0, -8.0))
WORK_FRAMING = tuple(globals().get("WORK_FRAMING") or (560.0, 40.0, 80.0, -6.0))
FRAMING_BLEND = float(globals().get("FRAMING_BLEND") or 0.06)
CAMERA_PITCH = float(globals().get("CAMERA_PITCH") or -12.0)
AIM_DROP_UU = float(globals().get("AIM_DROP_UU") or 0.0)
ROLE_NAMES = ["julius", "architect", "coder", "reviewer"]
SECTIONS = ["PROMPT ARCHITECT", "CODING AGENT", "JULIUS 3.3", "INDEPENDENT REVIEWER"]
# VERIFICATION IS SHOT FROM THE SIDE: from straight behind, the Dog's head stands between the camera and its own beam.
VERIFY_YAW_OFFSET = float(globals().get("VERIFY_YAW_OFFSET") or 40.0)
# WHILE THE COMPANIONS WORK, from a little to one side (zc_camera_test): straight behind, the Contract stood exactly behind
# the Dog's head and read as a hat; 25 degrees round, it stands beside the Dog with the Jhinn's beam going into it.
WORK_YAW_OFFSET = float(globals().get("WORK_YAW_OFFSET") or -25.0)
# Console settings for the film, e.g. a tuning value the next build makes the default.
EXTRA_COMMANDS = list(globals().get("EXTRA_COMMANDS") or [])
# The simulation site the founder's command travels to (wl.Mission.Site). None keeps the build's own default.
SITE = globals().get("SITE")
DOG_ACT = {
    "mission_start": "MISSION START", "researching": "PLANNING", "prompt_architect": "PLANNING", "guidance": "PLANNING",
    "coding_agent": "IMPLEMENTING", "verifying": "VERIFYING", "independent_reviewer": "REVIEW",
    "review_challenge": "REVIEW", "repair_required": "REPAIR", "repairing": "REPAIR",
}

STAGE_FLIGHT = {
    "mission_start": "GATHER", "researching": "RESEARCH ORBIT", "prompt_architect": "RESEARCH ORBIT",
    "guidance": "RESEARCH ORBIT", "coding_agent": "SUPPORT ORBIT", "approval_continue": "SUPPORT ORBIT",
    "independent_reviewer": "CALM ORBIT", "review_challenge": "CALM ORBIT", "repair_required": "ASSIST ORBIT",
    "repairing": "ASSIST ORBIT", "verifying": "CLEAR THE SIGHT-LINE", "waiting_checkpoint": "GATHER",
    "block": "GATHER", "complete_verified": "FOLLOW",
}
CONTRIBUTING = {"RESEARCH ORBIT", "SUPPORT ORBIT", "CALM ORBIT", "ASSIST ORBIT"}


def vec3(v):
    return [round(v.x, 1), round(v.y, 1), round(v.z, 1)]


def job():
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["scenarios"] = {}

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        unreal.log_warning("WLEXPERIENCE %s %s %s" % (tid, "PASS" if ok else "FAIL", json.dumps(detail)[:600]))
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def console(world, cmd):
        unreal.SystemLibrary.execute_console_command(world, cmd)

    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 5.0
        world = ues.get_game_world()
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        controller = unreal.GameplayStatics.get_player_controller(world, 0)
        ui = L.get_ui(world)
        live = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()]
        mission = live[0] if live else None
        cmds = ["t.MaxFPS 0", "Slate.bAllowThrottling 0", "r.VSync 0"] + EXTRA_COMMANDS
        RESULT["extra_commands"] = EXTRA_COMMANDS
        if MINIMAP_MODE is not None:
            cmds.append("wl.MiniMap.DrawMode %d" % int(MINIMAP_MODE))
        for cmd in cmds:
            console(world, cmd)
        RESULT["minimap_draw_mode"] = MINIMAP_MODE if MINIMAP_MODE is not None else "build default"
        scene = list(pawn.get_components_by_class(unreal.SceneComponent))
        beam = next((c for c in scene if c.get_name().startswith("VerificationBeam")), None)
        book = next((c for c in scene if c.get_name() == "MissionBook" or c.get_name().startswith("MissionBook_")), None)
        leaf = next((c for c in scene if c.get_name().startswith("MissionBookTurningPage")), None)
        boom = pawn.get_component_by_class(unreal.SpringArmComponent)
        arm_was = float(boom.target_arm_length) if boom is not None else None
        socket_was = boom.socket_offset if boom is not None else None
        RESULT["camera"] = {"read_framing": READ_FRAMING, "work_framing": WORK_FRAMING, "blend": FRAMING_BLEND,
                            "arm_was": arm_was}
        L.focus_game_viewport()
        yield 1.0

        for letter in SCENARIOS:
            folder = os.path.join(ROOT, letter)
            os.makedirs(folder, exist_ok=True)
            for old in os.listdir(folder):
                if old.endswith(".jpg"):
                    os.remove(os.path.join(folder, old))

            # ---------------------------------------------------------------- set the stage
            mission.stop_fixture()
            mission.set_joined_in(False, False)
            mission.set_beat_by_id("idle")
            yield 1.5
            if not ui.is_live_terminal_open():
                ui.toggle_live_terminal()
            yield 1.0
            if SITE:
                console(world, "wl.Mission.Site %s" % SITE)
            RESULT["site_id"] = SITE or "build default"
            # THE FOUNDER'S OWN PATH (wl.Mission.Scenario): to the simulation site, then the mission, then the terminal.
            started = mission.play_scenario(letter, PACE)
            yield (lambda: mission.is_fixture_running(), 180)
            if not ui.is_live_terminal_open():
                ui.toggle_live_terminal()
            RESULT.setdefault("site", {})[letter] = vec3(pawn.get_actor_location())
            console(world, "slomo %.3f" % SLOMO)
            last_tick = time.time()
            yaw = controller.get_control_rotation().yaw
            framing = list(WORK_FRAMING)
            aim = None
            frames = []
            index = 0
            finished_at = None
            while index < 6000:
                # A FOLLOWING CAMERA THAT KEEPS THE WORK IN SHOT: turned gently toward the middle of the Dog and the
                # Contract, so both -- and the companions circling above -- stay in frame as the Dog walks its ring.
                dog_at = pawn.get_actor_location()
                if mission.is_orb_in_world():
                    orb_at = mission.get_orb_location()
                    mid = unreal.Vector((dog_at.x + orb_at.x) * 0.5, (dog_at.y + orb_at.y) * 0.5, dog_at.z - AIM_DROP_UU)
                    aim = mid if aim is None else unreal.Vector(aim.x + (mid.x - aim.x) * 0.08, aim.y + (mid.y - aim.y) * 0.08, mid.z)
                if aim is not None and math.hypot(aim.x - dog_at.x, aim.y - dog_at.y) > 20.0:
                    want = unreal.MathLibrary.find_look_at_rotation(dog_at, aim).yaw
                    if str(mission.get_beat_id()) == "verifying":
                        want += VERIFY_YAW_OFFSET
                    elif book is None or not book.is_visible():
                        want += WORK_YAW_OFFSET
                    delta = (want - yaw + 180.0) % 360.0 - 180.0
                    yaw += delta * 0.08
                target = READ_FRAMING if (book is not None and book.is_visible()) else WORK_FRAMING
                framing = [a + (b - a) * FRAMING_BLEND for a, b in zip(framing, target)]
                if boom is not None:
                    boom.set_editor_property("target_arm_length", framing[0], QUIET)
                    boom.set_editor_property("socket_offset", unreal.Vector(0.0, framing[1], framing[2]), QUIET)
                controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=framing[3], yaw=yaw))

                path = os.path.join(folder, "f_%05d.jpg" % index)
                ok = H.capture_viewport_jpeg(path, FRAME_WIDTH, 86)
                sample = {
                    "i": index, "ok": bool(ok),
                    "t": round(float(unreal.GameplayStatics.get_time_seconds(world)), 3),
                    "beat": str(mission.get_beat_id()), "event": str(mission.get_last_event_type()),
                    "chakra": "%s %d" % (mission.get_chakra_name(), mission.get_chakra_step()),
                    "dog": str(mission.get_dog_performing_label()),
                    "contract": bool(mission.is_orb_in_world()),
                    "running": bool(mission.is_fixture_running()),
                    "progress": mission.get_fixture_progress(),
                    "dog_beam": bool(beam.is_visible()) if beam is not None else None,
                    "dog_beam_scale": round(beam.get_world_scale().y, 3) if beam is not None else None,
                    "dog_beam_name": beam.get_name() if beam is not None else None,
                    "pawn_name": pawn.get_name(),
                    "terminal_open": bool(ui.is_live_terminal_open()),
                    "role_event": str(ui.get_julius_role_event()),
                    "roles": [{"status": str(ui.get_julius_role_status(r)), "written": int(ui.get_julius_role_written_count(r)),
                               "pending": int(ui.get_julius_role_pending(r)),
                               "kind": str(ui.get_julius_role_latest_kind(r)), "line": str(ui.get_julius_role_latest_line(r))[:80]}
                              for r in range(4)],
                    "book": bool(book.is_visible()) if book is not None else None,
                    "page_turning": bool(leaf.is_visible()) if leaf is not None else None,
                    "dog_z": round(pawn.get_actor_location().z, 1),
                    "julius": {"simulated": bool(ui.is_julius_terminal_simulated()),
                               "event": str(ui.get_julius_narrated_event()),
                               "headline": str(ui.get_julius_latest_headline()),
                               "sections": {s: str(ui.get_julius_section_state(s)) for s in
                                            ("PROMPT ARCHITECT", "CODING AGENT", "JULIUS 3.3", "INDEPENDENT REVIEWER")}},
                    "pawn": [round(pawn.get_actor_location().x, 1), round(pawn.get_actor_location().y, 1)],
                    "orb": None, "companions": [],
                }
                if sample["beat"] == "verifying":
                    # WHICH BEAM: the one found at the start, or the one on whatever pawn is playing now.
                    live_pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
                    fresh = [c for c in live_pawn.get_components_by_class(unreal.SceneComponent) if c.get_name().startswith("VerificationBeam")]
                    sample["live_pawn"] = live_pawn.get_name()
                    sample["fresh_beams"] = [[c.get_name(), bool(c.is_visible()), round(c.get_world_scale().y, 3)] for c in fresh]
                    try:
                        sample["beam_note"] = str(live_pawn.describe_mission_beam())
                    except Exception as exc:
                        sample["beam_note"] = "unavailable: %s" % exc
                if sample["contract"]:
                    o = mission.get_orb_location()
                    sample["orb"] = [round(o.x, 1), round(o.y, 1), round(o.z, 1)]
                for c in (0, 1):
                    loc = mission.get_companion_location(c)
                    sample["companions"].append({
                        "joined": bool(mission.is_companion_joined(c)),
                        "flight": str(mission.get_companion_flight(c)),
                        "flight_beat": str(mission.get_companion_flight_beat(c)),
                        "beam": bool(mission.is_companion_beam_on(c)),
                        "pulses": mission.get_companion_pulses_in_flight_for(c),
                        "at": [round(loc.x, 1), round(loc.y, 1), round(loc.z, 1)],
                        "status": str(ui.get_companion_terminal_status(c)),
                        "activity": str(ui.get_companion_terminal_activity(c)),
                        "narrated_beat": str(ui.get_companion_terminal_narrated_beat(c)),
                    })
                frames.append(sample)
                index += 1
                # NO FRAMES, NO FILM: a minimized editor window fails every capture silently, and the loop would race
                # through the whole mission writing nothing. Stop and say so.
                if index == 30 and not any(f["ok"] for f in frames):
                    RESULT["error"] = "the first 30 captures all failed -- is the Unreal editor window minimized?"
                    unreal.log_warning("WLEXPERIENCE %s" % RESULT["error"])
                    break
                yield 0.0
                now = time.time()
                real_dt = max(now - last_tick, 0.005)
                last_tick = now
                console(world, "slomo %.4f" % max(0.01, min(1.0, (1.0 / FILM_FPS) / real_dt)))
                if not sample["running"] and not sample["contract"] and index > 20:
                    if finished_at is None:
                        finished_at = sample["t"]
                    elif sample["t"] - finished_at > 2.5:
                        break
            console(world, "slomo 1")
            ui.close_overlay()
            yield 1.0

            with open(os.path.join(folder, "frames.json"), "w", encoding="utf-8") as fh:
                json.dump(frames, fh)
            RESULT["scenarios"][letter] = judge(letter, frames, started, record)
            yield 0.5

        if boom is not None and arm_was is not None:
            boom.set_editor_property("target_arm_length", arm_was, QUIET)
            boom.set_editor_property("socket_offset", socket_was, QUIET)
        RESULT["passed"] = sum(1 for t in tests if t["pass"])
        RESULT["failed"] = [t["id"] for t in tests if not t["pass"]]
        RESULT["status"] = "done"
    finally:
        try:
            if ues.get_game_world() is not None:
                unreal.SystemLibrary.execute_console_command(ues.get_game_world(), "slomo 1")
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLEXPERIENCE could not end play: %s" % exc)


def judge(letter, frames, started, record):
    joined_expected = {"A": (False, False), "B": (True, False), "C": (False, True), "D": (True, True)}[letter]
    mission_frames = [f for f in frames if f["contract"]]
    summary = {"frames": len(frames), "mission_frames": len(mission_frames),
               "captured": sum(1 for f in frames if f["ok"]),
               "beats_seen": sorted({f["beat"] for f in mission_frames})}

    record(letter + "01", "scenario %s ran a full lifecycle: contract appeared, reached the end, and despawned" % letter,
           started and mission_frames and frames[-1]["contract"] is False
           and any(f["beat"] == "complete_verified" for f in frames) and summary["captured"] == len(frames), **summary)

    # --- SYNC: flight beat and terminal narration both name the world's beat, every frame
    drift = []
    for f in mission_frames:
        for c, comp in enumerate(f["companions"]):
            if not joined_expected[c]:
                continue
            if comp["flight_beat"] != f["beat"] or comp["narrated_beat"] != f["beat"]:
                drift.append([f["i"], c, f["beat"], comp["flight_beat"], comp["narrated_beat"]])
    julius_drift = [f["i"] for f in mission_frames if f["event"] != "None" and f["julius"]["event"] != f["event"]]
    record(letter + "02", "terminals and world tell the same story on every frame",
           not drift and not julius_drift and all(f["julius"]["simulated"] for f in mission_frames),
           companion_drift=drift[:10], julius_drift=julius_drift[:10])

    # --- FLIGHTS by stage, joined and not
    wrong = []
    for f in mission_frames:
        want_joined = STAGE_FLIGHT.get(f["beat"])
        for c, comp in enumerate(f["companions"]):
            if joined_expected[c]:
                if f["beat"] == "handoff":
                    ok = comp["flight"] != "FOLLOW"
                else:
                    ok = want_joined is None or comp["flight"] == want_joined
            else:
                ok = comp["flight"] == ("CLEAR THE SIGHT-LINE" if f["beat"] == "verifying" else "FOLLOW")
            if not ok:
                wrong.append([f["i"], c, f["beat"], comp["flight"]])
    record(letter + "03", "each companion flies the stage's flight when joined, and follows when not",
           not wrong, wrong=wrong[:12])

    # --- CONTRIBUTIONS: pulses and the Jhinn's beam only when joined, and they really happen
    pulses = [sum(f["companions"][c]["pulses"] for f in mission_frames) for c in (0, 1)]
    beams = [sum(1 for f in mission_frames if f["companions"][c]["beam"]) for c in (0, 1)]
    jhinn_beam_stages = sorted({f["beat"] for f in mission_frames if f["companions"][1]["beam"]})
    contrib_ok = True
    for c in (0, 1):
        if joined_expected[c]:
            contrib_ok = contrib_ok and pulses[c] > 0
        else:
            contrib_ok = contrib_ok and pulses[c] == 0 and beams[c] == 0
    contrib_ok = contrib_ok and beams[0] == 0
    if joined_expected[1]:
        contrib_ok = contrib_ok and beams[1] > 0 and set(jhinn_beam_stages) <= {"coding_agent", "approval_continue", "repair_required", "repairing", "handoff"}
    record(letter + "04", "joined companions send contributions into the Contract; others send nothing",
           contrib_ok, pulse_frames=pulses, beam_frames=beams, jhinn_beam_stages=jhinn_beam_stages)

    # --- VERIFICATION: companions clear the Dog's line, the Dog's beam is on
    clear = []
    for f in mission_frames:
        if f["beat"] != "verifying" or not f["orb"]:
            continue
        ax, ay = f["pawn"]
        bx, by = f["orb"][0], f["orb"][1]
        span = math.hypot(bx - ax, by - ay) or 1.0
        for comp in f["companions"]:
            px, py = comp["at"][0], comp["at"][1]
            t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / (span * span)
            if 0.0 <= t <= 1.0:
                clear.append(abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / span)
    verify = [f for f in mission_frames if f["beat"] == "verifying"]
    settled = verify[len(verify) // 3:]
    record(letter + "05", "while verifying the Dog's beam is on and no companion stands on its line",
           verify and all(f["dog_beam"] for f in settled) and (not clear or min(clear[len(clear) // 3:] or clear) >= 110.0),
           verify_frames=len(verify), closest_to_line_uu=round(min(clear), 1) if clear else None)

    # --- COMPLETION: everyone back, contributions stopped, terminals waiting
    after = [f for f in frames if not f["contract"] and f["i"] > (mission_frames[-1]["i"] if mission_frames else 0)]
    tail = after[len(after) // 2:] if after else []
    record(letter + "06", "on completion contributions stop, companions return to follow, terminals go back to waiting",
           tail and all(all(comp["flight"] == "FOLLOW" and not comp["beam"] for comp in f["companions"]) for f in tail)
           and all(f["companions"][c]["status"] == "WAITING" for f in tail for c in (0, 1)) and all(f["dog"] == "NONE" for f in tail),
           frames_after=len(after))

    # --- COORDINATION: two joined companions never meet
    if all(joined_expected):
        gaps = []
        for f in mission_frames:
            a, b = f["companions"][0], f["companions"][1]
            if a["flight"] in CONTRIBUTING and b["flight"] in CONTRIBUTING:
                gaps.append(math.dist(a["at"], b["at"]))
        record(letter + "07", "the two joined companions keep apart as they orbit", gaps and min(gaps) >= 150.0,
               closest_uu=round(min(gaps), 1) if gaps else None, orbit_frames=len(gaps))

    # --- TERMINAL STATES: joined terminals active, unjoined waiting, Julius roles moved
    roles_seen = {s: sorted({f["julius"]["sections"][s] for f in mission_frames}) for s in ("PROMPT ARCHITECT", "CODING AGENT", "INDEPENDENT REVIEWER")}
    status_ok = all((f["companions"][c]["status"] in ("ACTIVE · JOINED", "JOINED · DONE")) == joined_expected[c]
                    for f in mission_frames[5:] for c in (0, 1))
    record(letter + "08", "joined terminals are active, the others wait, and every Julius terminal section moves through its work",
           status_ok and all(len(v) >= 3 for v in roles_seen.values()),
           roles_seen=roles_seen,
           activities=[sorted({f["companions"][c]["activity"] for f in mission_frames}) for c in (0, 1)])
    # --- THE DOG REALLY CIRCLES while it reads. The first film's Dog read on one spot for the whole mission: an
    # open terminal made the controller ignore move input, and the orbit's input was dropped with the player's.
    reading = [f for f in mission_frames if f["beat"] in ("researching", "prompt_architect", "guidance") and f["orb"]]
    swept = 0.0
    for a, b in zip(reading, reading[1:]):
        if b["i"] != a["i"] + 1:
            continue
        a1 = math.atan2(a["pawn"][1] - a["orb"][1], a["pawn"][0] - a["orb"][0])
        a2 = math.atan2(b["pawn"][1] - b["orb"][1], b["pawn"][0] - b["orb"][0])
        swept += abs((math.degrees(a2 - a1) + 180.0) % 360.0 - 180.0)
    record(letter + "09", "the Dog walks its circle round the Contract while it reads, and pages turn in its hands",
           swept >= 90.0 and sum(1 for f in reading if f.get("page_turning")) > 0
           and sum(1 for f in reading if f.get("page_turning") is False) > 0,
           swept_deg=round(swept, 1), reading_frames=len(reading),
           page_turning_frames=sum(1 for f in reading if f.get("page_turning")))

    # --- THE DOG PERFORMS THE WORLD'S STAGE: its act names the beat, allowing the half-second cross-fade.
    wrong_act = []
    last_beat, since = None, 0
    for f in mission_frames:
        since = since + 1 if f["beat"] == last_beat else 0
        last_beat = f["beat"]
        want = DOG_ACT.get(f["beat"])
        if want is not None and since > 8 and f["dog"] != want:
            wrong_act.append([f["i"], f["beat"], f["dog"]])
    record(letter + "10", "the Dog's performance is the stage the terminals name", not wrong_act, wrong=wrong_act[:10])

    # --- NOBODY MEETS: companions apart from each other on EVERY frame (transitions included), and a joined
    # companion never inside the Dog's space.
    pair_gaps, dog_gaps = [], []
    for f in frames:
        a, b = f["companions"][0], f["companions"][1]
        pair_gaps.append(math.dist(a["at"], b["at"]))
        for c, comp in enumerate(f["companions"]):
            if joined_expected[c] and f["contract"] and comp["flight"] in CONTRIBUTING and f.get("dog_z") is not None:
                dx = comp["at"][0] - f["pawn"][0]
                dy = comp["at"][1] - f["pawn"][1]
                # The figure origin is its lowest point; the Dog is about 180 uu tall about its capsule centre.
                if comp["at"][2] < f["dog_z"] + 120.0:
                    dog_gaps.append(math.hypot(dx, dy))
    record(letter + "11", "companions never come within 150 uu of each other, nor into the Dog's space",
           min(pair_gaps) >= 150.0 and (not dog_gaps or min(dog_gaps) >= 110.0),
           closest_pair_uu=round(min(pair_gaps), 1), closest_to_dog_uu=round(min(dog_gaps), 1) if dog_gaps else None)

    # --- A COMPANION THAT HAS NOT JOINED SAYS NOTHING, and after completion nobody contributes.
    silent = []
    for f in mission_frames:
        for c, comp in enumerate(f["companions"]):
            if not joined_expected[c] and (comp["status"] != "WAITING" or comp["pulses"] or comp["beam"]):
                silent.append([f["i"], c, comp["status"], comp["activity"][:40]])
    after_end = [f for f in frames if not f["contract"] and f["i"] > (mission_frames[-1]["i"] if mission_frames else 0)]
    lingering = [f["i"] for f in after_end[3:] if any(comp["pulses"] or comp["beam"] for comp in f["companions"])]
    record(letter + "12", "an unjoined companion's terminal stays waiting, and no light is given after completion",
           not silent and not lingering, unjoined_speaking=silent[:8], contributing_after_end=lingering[:8])
    # --- JULIUS AND ITS COMPONENTS, working in the terminal's own four sections, on the world's event.
    role_frames = [f for f in mission_frames if f.get("roles")]
    off_event = [[f["i"], f["event"], f["role_event"]] for f in role_frames
                 if f["event"] != "None" and f["role_event"] != f["event"]]
    record(letter + "13", "the Julius terminal is open all mission and its four sections work on the event the world is in",
           role_frames and all(f["terminal_open"] for f in role_frames) and not off_event,
           role_frames=len(role_frames), off_event=off_event[:10])

    written = {ROLE_NAMES[r]: (role_frames[-1]["roles"][r]["written"] if role_frames else 0) for r in range(4)}
    kinds = {ROLE_NAMES[r]: sorted({f["roles"][r]["kind"] for f in role_frames} - {""}) for r in range(4)}
    record(letter + "14", "Julius and all three components write real work: packets, diffs, tests, checks, findings",
           all(v >= 15 for v in written.values())
           and {"Preview"} <= set(kinds["architect"]) and {"DiffAdd", "Pass"} <= set(kinds["coder"])
           and {"CheckDone", "Finding"} <= set(kinds["reviewer"]),
           written=written, kinds=kinds)

    # How much each role still owed when the next event arrived (written at once): the pace must keep this small.
    owed = {ROLE_NAMES[r]: [] for r in range(4)}
    for a, b in zip(role_frames, role_frames[1:]):
        if b["role_event"] != a["role_event"]:
            for r in range(4):
                owed[ROLE_NAMES[r]].append(a["roles"][r]["pending"])
    worst = {k: max(v) if v else 0 for k, v in owed.items()}
    record(letter + "15", "every section keeps up with the world: little is left to write at once when the next event arrives",
           all(v <= 4 for v in worst.values()), max_owed=worst, pace=PACE)

    beam_notes = sorted({f.get("beam_note", "") for f in mission_frames if f["beat"] == "verifying"})
    summary["pulses"] = pulses
    summary["beams"] = beams
    summary["dog_swept_deg"] = round(swept, 1)
    summary["role_lines_written"] = written
    summary["beam_notes"] = beam_notes[:6]
    return summary
