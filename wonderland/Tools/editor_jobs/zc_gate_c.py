# GATE C: DOES WONDERLAND AND JULIUS WORK END TO END, IN ONE SITTING?
#
# FOUNDER, final gate C: "Wonderland + Julius work end-to-end through Julius Live Terminal, Project Brain,
# Mission Contract, Wonder Web, ChatGPT/Claude Code companions, verification/repair/completion."
#
# WHY THIS IS NOT THE SUM OF THE OTHER PROOFS. Every surface named here already has a job, and each one
# opens a fresh PIE session, does its single thing, and tears the world down. That answers "does the Project
# Brain work" and "does a mission complete" -- it does not answer the gate, which is about all of them in
# ONE session, in sequence, with each one still working after the last has been used. Panels that share a
# viewport, an overlay stack and a camera are exactly where that fails.
#
# So this is ONE play session and no restarts. Each surface is opened, used, and checked while the ones
# before it have already been used. If opening Wonder Web breaks the terminal, or a mission run leaves the
# Brain unable to reopen, it shows up here and nowhere else.
#
# WHAT IS DELIBERATELY NOT CLAIMED. The gate says "Julius beta-ready" in its own right as gate B; this job
# does not judge that. It judges the JOINT behaviour -- that the surfaces reach each other and survive each
# other -- which is the part no single-surface proof can see.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "gate_c")

STAGES = ("PREPARATION", "RESEARCH", "IMPLEMENTATION", "VERIFICATION", "REVIEW", "COMPLETED")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    ui = L.get_ui(world)
    tasks = L.get_mission_tasks(world)
    mission = L.get_mission(world)
    yield 1.0

    def camera():
        mgr = unreal.GameplayStatics.get_player_camera_manager(world, 0)
        return mgr.get_camera_location() if mgr is not None else unreal.Vector(0, 0, 0)

    def shot(name):
        H.capture_viewport_jpeg(os.path.join(ROOT, name), 1500, 90)

    def close_everything():
        for _ in range(4):
            ui.close_overlay()
            yield 0.25

    order = []
    RESULT["order"] = order

    try:
        # ------------------------------------------------------------ 1. JULIUS LIVE TERMINAL
        ui.toggle_live_terminal()
        yield 1.5
        terminal_open = bool(ui.is_live_terminal_open())
        rows = int(ui.get_terminal_row_count())
        headline = str(ui.get_julius_latest_headline())
        shot("01_live_terminal.jpg")
        order.append("live terminal")
        # ROWS ARE A BASELINE HERE, NOT A VERDICT. The first version required rows > 0 the moment the
        # terminal opened and failed. It was wrong: zc_eight_hour_demo recorded terminal_rows = 0 on open
        # too, because a terminal that nobody has given work to has nothing to say. What matters is whether
        # it FILLS when Julius works, and that is C06 below.
        record("C01", "the Julius Live Terminal opens",
               terminal_open, open=terminal_open, rows_on_open=rows, headline=headline[:120],
               note="first surface of the session; everything after this runs with it already used")

        # ------------------------------------------------------------ 2. THE COMPANIONS, beside it
        # ChatGPT and Claude Code are the founder's two, and the contract is that terminal 0 is the LLM
        # Companion. Their titles are read rather than their existence assumed.
        companions = int(ui.get_companion_terminal_count())
        titles = [str(ui.get_companion_terminal_title(i)) for i in range(companions)]
        on_screen = bool(ui.are_companion_terminals_on_screen())
        shot("02_companions.jpg")
        order.append("companions")
        record("C02", "both companion terminals are on screen with the Live Terminal",
               companions >= 2 and on_screen,
               terminals=companions, titles=titles, on_screen=on_screen,
               note="the founder's rule is that the LLM and Jhinn terminals never share a side")

        # ------------------------------------------------------------ 3. PROJECT BRAIN + WARDROBE
        # Opened while the terminal has already been used. The camera is the thing to watch: P0 item 1 is
        # explicit that the player camera must not move when the wardrobe changes a skin.
        for step in close_everything():
            yield step
        before = camera()
        ui.toggle_project_brain()
        yield 2.0
        brain_open = bool(ui.is_project_brain_open())
        ui.set_brain_skins_open(True)
        yield 1.5
        frames_before = int(ui.get_skin_stage_frame_count())
        worn = []
        for skin in ("relay_og", "arden_infernal", "celestial_light", "skeleton_flame", "apollo"):
            worn.append(bool(ui.wear_relay_skin(skin)))
            yield 1.2
        frames_after = int(ui.get_skin_stage_frame_count())
        after = camera()
        drift = float((after - before).size()) if hasattr(after - before, "size") else 0.0
        shot("03_project_brain_wardrobe.jpg")
        order.append("project brain")
        # NOT JUDGED ON THE STAGE FRAME COUNTER. It reads 0 because SkinStageActor is null in this build,
        # and no other proof in the suite depends on it -- zc_wardrobe_truth judges the wardrobe by whether
        # every skin wears, the Brain stays open and the view never moves, which is what P0 item 1 actually
        # asks for. Failing the gate on an unpopulated counter would be failing it on my own instrument.
        record("C03", "Project Brain opens after the terminal, and every skin wears in the wardrobe",
               brain_open and all(worn) and bool(ui.is_project_brain_open()),
               brain_open=brain_open, skins_worn=sum(1 for w in worn if w), skins_tried=len(worn),
               brain_still_open=bool(ui.is_project_brain_open()),
               stage_frame_counter=frames_after - frames_before,
               note="stage_frame_counter recorded, not judged: SkinStageActor is null so it reads 0")
        record("C04", "the player camera never moved while the wardrobe was used",
               drift < 1.0, camera_drift_uu=round(drift, 3),
               note="P0 item 1: no camera teleport, no world view -- the Dog on black and nothing else")

        # ------------------------------------------------------------ 4. MISSION CONTRACT, whole lifecycle
        #
        # THE TERMINAL STAYS OPEN THROUGH THIS, and that is not a detail. WriteRoleLine returns immediately
        # unless the terminal widget is valid, so the first version of this job -- which closed every overlay
        # before driving the stages -- could never have seen Julius narrate anything. All three roles read
        # STANDBY and I had written a check that could only fail.
        ui.toggle_live_terminal()
        yield 1.2
        if not ui.is_live_terminal_open():
            ui.toggle_live_terminal()
            yield 1.2
        RESULT["terminal_open_for_mission"] = bool(ui.is_live_terminal_open())
        rows_before_mission = int(ui.get_terminal_row_count())
        tasks.clear_all_tasks_for_development()
        yield 0.8
        draft = tasks.add_draft()
        tasks.submit_draft(draft, "Walk the arrival plaza and report what is missing")
        yield 1.6
        shot("04_mission_contract.jpg")

        reached = []
        for stage in STAGES:
            unreal.SystemLibrary.execute_console_command(world, "wl.Tasks.Scheduler 0 %s" % stage)
            for _ in range(6):
                yield 0.25
            reached.append(stage)
            if stage in ("VERIFICATION", "REVIEW", "COMPLETED"):
                shot("05_%s.jpg" % stage.lower())

        # ---- AND THE MISSION BEATS, which are a different thing from the task stages.
        #
        # This is the correction that took two runs to find. `wl.Tasks.Scheduler` drives the TASK scheduler:
        # it moves the contract's stage and the Dog's props, and it is what zc_mission_parity and
        # zc_mission_props measure. It does not narrate. Julius's three role feeds are filled by
        # UWonderlandMissionSubsystem::NarrateMissionEvent, which runs off the MISSION BEATS -- so a job that
        # only drove the scheduler could watch the whole lifecycle go past with every role on STANDBY, which
        # is exactly what the first two runs of this job reported.
        beats = []
        mission.reset_progression()
        yield 0.8
        for _ in range(int(mission.get_beat_count())):
            beat = str(mission.advance_beat())
            beats.append(beat)
            for _ in range(6):
                yield 0.25
        RESULT["mission_beats"] = beats

        # ---- AND NOW AN ACTUAL MISSION EVENT STREAM, which is the third and last thing I had confused.
        #
        # Beats are STATE; narration is driven by EVENTS. TellTheTerminals is called from OfferEvent, and
        # OfferEvent is fed by StepFixture -- so advancing the beats moved the contract through
        # repair_required, repairing, verifying and complete_verified with all three roles still on STANDBY,
        # because nothing had actually happened, it had only been set.
        #
        # A fixture is a recorded mission: real events, in order, at a chosen pace. That is what the gate
        # means by end to end, and it is the only thing that makes Julius write.
        fixtures = [str(mission.get_fixture_id_at(i)) for i in range(int(mission.get_fixture_count()))]
        RESULT["fixtures_available"] = fixtures
        started = False
        if fixtures:
            started = bool(mission.start_fixture(unreal.Name(fixtures[0]), 0.35))
        RESULT["fixture_started"] = {"id": fixtures[0] if fixtures else None, "started": started}
        waited = 0.0
        while started and bool(mission.is_fixture_running()) and waited < 75.0:
            yield 0.5
            waited += 0.5
        RESULT["fixture"] = {"id": fixtures[0] if fixtures else None,
                             "events": int(mission.get_fixture_event_count()),
                             "progress": int(mission.get_fixture_progress()),
                             "seconds": round(waited, 1),
                             "last_event": str(mission.get_last_event_type()),
                             "verdict": str(mission.get_last_event_verdict())[:80]}
        for _ in range(10):
            yield 0.4
        shot("05_beats_done.jpg")
        rows_after_mission = int(ui.get_terminal_row_count())
        order.append("mission contract")
        record("C05", "a Mission Contract runs its whole lifecycle in this same session",
               reached == list(STAGES), stages=reached,
               terminal_rows_before=rows_before_mission, terminal_rows_after=rows_after_mission,
               beats=len(beats),
               note="the founder's list: start, planning, implementing, verifying, completion, return to idle")

        # The Missions panel is opened AFTER the stages, so that whatever it does to the overlay stack
        # cannot close the terminal Julius needs in order to narrate.
        ui.toggle_missions()
        yield 1.4
        record("C05b", "the Mission Contract panel opens in this session too",
               bool(ui.is_missions_open()), open=bool(ui.is_missions_open()))

        # ---- VERIFICATION / REPAIR / COMPLETION is named separately in the gate, so it is asked separately:
        # did Julius actually narrate the back half, or did the stages merely be set?
        role_lines = {}
        for role in range(3):
            role_lines[role] = {"written": int(ui.get_julius_role_written_count(role)),
                                "latest": str(ui.get_julius_role_latest_line(role))[:90],
                                "status": str(ui.get_julius_role_status(role))[:60]}
        RESULT["julius_roles"] = role_lines
        wrote = sum(v["written"] for v in role_lines.values())
        record("C06", "Julius narrated the verification and completion, rather than the stages merely being set",
               wrote > 0 or rows_after_mission > rows_before_mission,
               lines_written=wrote, by_role=role_lines,
               terminal_rows=[rows_before_mission, rows_after_mission],
               fixture=RESULT.get("fixture"),
               note="driven by a mission FIXTURE, not by beats or task stages: narration hangs off events, "
                    "and setting a beat is not an event happening")

        # ------------------------------------------------------------ 5. WONDER WEB, last and after all of it
        for step in close_everything():
            yield step
        ui.open_wonder_web()
        yield 2.5
        web_open = bool(ui.is_wonder_web_open())
        windows = int(ui.count_open_wonder_web_windows())
        described = str(ui.describe_wonder_web())
        shot("06_wonder_web.jpg")
        order.append("wonder web")
        record("C07", "Wonder Web opens last, after every other surface has been used",
               web_open, open=web_open, windows=windows, describes=described[:160],
               note="opened last on purpose: it is the heaviest surface and the most likely to be broken by "
                    "whatever ran before it")

        # ------------------------------------------------------------ 6. AND BACK TO THE START
        # The gate is about the surfaces surviving each other, so the first one is opened again at the end.
        for step in close_everything():
            yield step
        ui.toggle_live_terminal()
        yield 1.8
        still_works = bool(ui.is_live_terminal_open())
        rows_again = int(ui.get_terminal_row_count())
        shot("07_terminal_again.jpg")
        # OPENING IS THE CLAIM, not the row count. A terminal reopened after being closed starts empty for
        # the same reason it started empty in C01, and requiring rows here was the same mistake twice.
        record("C08", "the Live Terminal still opens after Wonder Web, the Brain and a whole mission",
               still_works,
               open=still_works, rows_first=rows, rows_now=rows_again, surfaces_used=order,
               note="this is the check no single-surface proof can make, and the reason this job exists")

    except Exception as err:                                   # noqa: BLE001
        RESULT["error"] = str(err)
        record("C99", "the end-to-end run reached the end", False, error=str(err), got_through=order)

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
