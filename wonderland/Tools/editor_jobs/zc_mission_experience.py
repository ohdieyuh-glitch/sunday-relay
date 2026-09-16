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

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "mission_experience")
SCENARIOS = globals().get("SCENARIOS") or ["D", "A", "B", "C"]
PACE = float(globals().get("PACE") or 3.0)          # world seconds per mission event
SLOMO = float(globals().get("SLOMO") or 0.5)        # world time dilation while filming
MINIMAP_MODE = int(globals().get("MINIMAP_MODE") or 4)
FRAME_WIDTH = 1280

STAGE_FLIGHT = {
    "mission_start": "GATHER", "researching": "RESEARCH ORBIT", "prompt_architect": "RESEARCH ORBIT",
    "guidance": "RESEARCH ORBIT", "coding_agent": "SUPPORT ORBIT", "approval_continue": "SUPPORT ORBIT",
    "independent_reviewer": "CALM ORBIT", "review_challenge": "CALM ORBIT", "repair_required": "ASSIST ORBIT",
    "repairing": "ASSIST ORBIT", "verifying": "CLEAR THE SIGHT-LINE", "waiting_checkpoint": "GATHER",
    "block": "GATHER", "complete_verified": "FOLLOW",
}
CONTRIBUTING = {"RESEARCH ORBIT", "SUPPORT ORBIT", "CALM ORBIT", "ASSIST ORBIT"}


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
        for cmd in ("t.MaxFPS 0", "Slate.bAllowThrottling 0", "r.VSync 0", "wl.MiniMap.DrawMode %d" % MINIMAP_MODE):
            console(world, cmd)
        scene = list(pawn.get_components_by_class(unreal.SceneComponent))
        beam = next((c for c in scene if c.get_name().startswith("VerificationBeam")), None)
        book = next((c for c in scene if c.get_name().startswith("MissionBook")), None)
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
            console(world, "slomo %.3f" % SLOMO)
            started = mission.run_scenario(letter, PACE)
            yaw = controller.get_control_rotation().yaw
            frames = []
            index = 0
            finished_at = None
            while index < 6000:
                # A FOLLOWING CAMERA THAT KEEPS THE WORK IN SHOT: behind the Dog, turned gently toward the Contract.
                if mission.is_orb_in_world():
                    want = unreal.MathLibrary.find_look_at_rotation(pawn.get_actor_location(), mission.get_orb_location()).yaw
                    delta = (want - yaw + 180.0) % 360.0 - 180.0
                    yaw += delta * 0.06
                controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=-15.0, yaw=yaw))

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
                    "book": bool(book.is_visible()) if book is not None else None,
                    "julius": {"simulated": bool(ui.is_julius_terminal_simulated()),
                               "event": str(ui.get_julius_narrated_event()),
                               "headline": str(ui.get_julius_latest_headline()),
                               "sections": {s: str(ui.get_julius_section_state(s)) for s in
                                            ("PROMPT ARCHITECT", "CODING AGENT", "JULIUS 3.3", "INDEPENDENT REVIEWER")}},
                    "pawn": [round(pawn.get_actor_location().x, 1), round(pawn.get_actor_location().y, 1)],
                    "orb": None, "companions": [],
                }
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
                yield 0.0
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
    record(letter + "08", "joined terminals are active, the others wait, and the Julius roles progress",
           status_ok and all("ACTIVE" in v for v in roles_seen.values()),
           roles_seen=roles_seen,
           activities=[sorted({f["companions"][c]["activity"] for f in mission_frames}) for c in (0, 1)])
    summary["pulses"] = pulses
    summary["beams"] = beams
    return summary
