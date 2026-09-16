# PIE job: proof of the Mission Contract Orb -- the founder's seventeen states on the ground at the Dog's
# feet, the chakra progression that resets per task, and the binding from each drawn state to a Julius one.
#
# It checks four things a screenshot cannot: that the orb is actually ON THE GROUND rather than floating on
# the Carry-On; that every beat resolves to a real EWonderlandJuliusState and names the events that will
# drive it in Phase 4; that the chakra folds the way a task walks (holding through a handoff, falling back
# through a repair); and what the orb costs to draw. Then it photographs all seventeen.
#
# Rules kept: zc_ prefix, no saves, no map edits, never Escape unless a panel is open, and it ends its own PIE.
import os
import time

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary

# The founder's order, as a task actually walks it: forward through the roles, a challenge, a repair that
# sends the work back, then verification and a finish.
WALK = [
    ("idle", 0),
    ("mission_start", 1),
    ("researching", 2),
    ("handoff", 2),
    ("prompt_architect", 3),
    ("coding_agent", 4),
    ("independent_reviewer", 5),
    ("waiting_checkpoint", 5),
    ("guidance", 5),
    ("review_challenge", 5),
    ("repair_required", 4),
    ("repairing", 4),
    ("verifying", 6),
    ("approval_continue", 6),
    ("complete_verified", 7),
]

# Every beat that is a real state. Filmed one at a time, in the order a task walks them.
GALLERY = [b for b, _ in WALK] + ["block", "error"]

# Ten frames over about 1.2 s. Fast enough to read a 2 Hz working pulse, long enough to see a slow one
# breathe; the 4 Hz error flash aliases at this rate and reads as a flicker, which is what it is.
FRAMES_PER_BEAT = 10
FRAME_SPACING = 0.12


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["captures"] = []

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def shot(name):
        path = os.path.join(SHOTS, name)
        ok = L.capture_game_viewport(path)
        good = ok is True or (isinstance(ok, tuple) and ok and ok[0])
        if good:
            RESULT["captures"].append(path)
        return path if good else None

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    mission = next((m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem)
                    if m.get_beat_count() > 0 and m.is_orb_in_world()), None)
    if mission is None:
        mission = next((m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem)
                        if m.get_beat_count() > 0), None)

    def to_screen(at):
        """ProjectWorldToScreen hands Python the position ALONE, not (bool, position) as the C++ reads."""
        try:
            got = unreal.GameplayStatics.project_world_to_screen(controller, at, False)
        except Exception as exc:
            RESULT.setdefault("project_error", str(exc))
            return None
        if isinstance(got, tuple):
            got = got[1] if len(got) > 1 else got[0]
        try:
            return [float(got.x), float(got.y)]
        except AttributeError:
            return None

    # An unfocused editor paces down to ~2.5 fps, which buries a small actor's cost in the sleep.
    for cmd in ("t.MaxFPS 0", "Slate.bAllowThrottling 0", "r.VSync 0"):
        unreal.SystemLibrary.execute_console_command(world, cmd)
    yield 0.5

    # ---------------------------------------------------------------- the subsystem
    record("M00", "the mission subsystem holds the founder's seventeen, and says it is a preview",
           mission is not None and mission.get_beat_count() == 18 and mission.is_development_preview()
           and mission.is_mission_strip_on_screen(),
           beats=mission.get_beat_count() if mission else 0,
           preview=mission.is_development_preview() if mission else None,
           strip=mission.is_mission_strip_on_screen() if mission else None)

    # ---------------------------------------------------------------- on the ground, at the Dog's feet
    # THE FOUNDER'S SHAPE, CHECKED AS GEOMETRY: small, on the floor, and beside the Dog rather than on it.
    orb_at = mission.get_orb_location() if mission else unreal.Vector()
    pawn_at = pawn.get_actor_location() if pawn else unreal.Vector()
    flat = ((orb_at.x - pawn_at.x) ** 2 + (orb_at.y - pawn_at.y) ** 2) ** 0.5
    below = pawn_at.z - orb_at.z
    RESULT["placement"] = {"orb": [orb_at.x, orb_at.y, orb_at.z], "pawn": [pawn_at.x, pawn_at.y, pawn_at.z],
                           "flat_uu": round(flat, 1), "below_pawn_uu": round(below, 1),
                           "boxes": mission.get_orb_box_count() if mission else 0}
    record("M01", "the orb is on the ground beside the Dog, not floating on the Carry-On",
           mission is not None and mission.is_orb_in_world() and mission.get_orb_box_count() > 0
           and flat < 140.0 and below > 20.0,
           **RESULT["placement"])

    # ---------------------------------------------------------------- every beat has a Julius future
    # A DRAWN STATE WITH NO RUNTIME STATE BEHIND IT IS A STATE THAT CANNOT BE WIRED UP. This is the check
    # that keeps Phase 3 honest about Phase 4.
    unbound = []
    silent = []
    declared_gaps = []
    bindings = {}
    for index in range(mission.get_beat_count() if mission else 0):
        beat = str(mission.get_beat_id_at(index))
        phase = mission.get_beat_phase(beat)
        events = mission.get_beat_events(beat).strip()
        gap = mission.get_beat_not_yet_emitted(beat).strip()
        bindings[beat] = {"phase": phase, "accent": mission.get_beat_accent(beat),
                          "events": events, "not_yet_emitted": gap}
        if not phase or phase == "Unknown":
            unbound.append(beat)
        # `unobserved` is the absence of a report, so no event drives it and that is not a gap.
        if beat == "unobserved":
            continue
        if events and gap:
            # Claiming both an event and a gap is a row that has not decided what it is.
            silent.append(beat + " (claims both)")
        elif not events and not gap:
            # A SILENT GAP is the failure: a drawn state with no event and no note saying so would be
            # wired up in Phase 4 to whatever event was nearest, which is how a visual starts lying.
            silent.append(beat)
        elif gap:
            declared_gaps.append(beat)
    RESULT["bindings"] = bindings
    RESULT["declared_gaps"] = declared_gaps
    record("M02", "every beat resolves to a real Julius phase, and names either its events or the gap",
           mission is not None and not unbound and not silent,
           unbound=unbound, silent=silent, declared_gaps=declared_gaps, bound=len(bindings))

    # ---------------------------------------------------------------- the fold, as a pure function
    # Checked WITHOUT touching the orb: the progression is arithmetic on the beat table, so a renderer
    # bug cannot make this pass and a table mistake cannot hide behind one.
    fold = []
    previous = 0
    for beat, expected in WALK:
        previous = mission.get_beat_chakra_step(beat, previous) if mission else -1
        fold.append({"beat": beat, "step": previous, "expected": expected})
    wrong = [f for f in fold if f["step"] != f["expected"]]
    RESULT["fold"] = fold
    record("M03", "the chakra folds: holds through a handoff, falls back through a repair, crowns at the end",
           mission is not None and not wrong, wrong=wrong,
           walked=[f["step"] for f in fold])

    # ---------------------------------------------------------------- it resets per task
    reset_from_crown = mission.get_beat_chakra_step("mission_start", 7) if mission else -1
    record("M04", "a new mission start drops the last task's colour back to root",
           reset_from_crown == 1, from_crown=reset_from_crown)

    # ---------------------------------------------------------------- which states want a person
    asks = {b: bool(mission.does_beat_ask_for_a_human(b)) for b in GALLERY} if mission else {}
    expected_asks = {"waiting_checkpoint", "block", "error"}
    record("M05", "only waiting, block and error ask for a person",
           mission is not None and {b for b, v in asks.items() if v} == expected_asks,
           asking=sorted(b for b, v in asks.items() if v))

    # ---------------------------------------------------------------- the gallery
    # A SEQUENCE PER STATE, NOT A STILL. Phase 3 is animation: a spin that reverses through a repair, a
    # pulse that races while coding and breathes while waiting, a block that stops dead. A contact sheet of
    # stills would show seventeen coloured orbs and prove none of it, so each state gets a short run of
    # frames that can be assembled into a loop afterwards.
    #
    # The orb's screen position travels with every frame, because the orb is small on purpose and a frame
    # of the whole garden shows a garden.
    gallery = []
    mission.reset_progression()
    for index, beat in enumerate(GALLERY):
        mission.set_beat_by_id(beat)
        # Let the motion ease in first (BeatBlendSeconds is 0.35), then sample.
        yield 0.75
        frames = []
        for frame in range(FRAMES_PER_BEAT):
            at = mission.get_orb_location()
            screen = to_screen(at)
            path = shot("zc_mission_%02d_%s_%02d.png" % (index + 1, beat, frame))
            frames.append({"capture": path, "screen": screen})
            yield FRAME_SPACING
        gallery.append({"beat": beat, "label": mission.get_beat_label(), "step": mission.get_chakra_step(),
                        "chakra": mission.get_chakra_name(), "frames": frames})
    RESULT["gallery"] = gallery
    RESULT["frame_spacing"] = FRAME_SPACING
    missed = [g["beat"] for g in gallery if not all(f["capture"] for f in g["frames"])]
    record("M06", "every state was filmed in play, not just photographed",
           len(gallery) == len(GALLERY) and not missed,
           states=len(gallery), frames_each=FRAMES_PER_BEAT, missed=missed)

    # ---------------------------------------------------------------- what it costs
    actor = next((a for a in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb)), None)
    samples = {"visible": [], "hidden": []}
    if actor is not None:
        for _ in range(3):
            for state in ("visible", "hidden"):
                actor.set_actor_hidden_in_game(state == "hidden")
                actor.set_actor_tick_enabled(state == "visible")
                yield 1.5
                f0, t0 = unreal.SystemLibrary.get_frame_count(), time.time()
                yield 4.0
                samples[state].append((unreal.SystemLibrary.get_frame_count() - f0) / (time.time() - t0))
        actor.set_actor_hidden_in_game(False)
        actor.set_actor_tick_enabled(True)
    fps_visible = sum(samples["visible"]) / max(len(samples["visible"]), 1)
    fps_hidden = sum(samples["hidden"]) / max(len(samples["hidden"]), 1)
    ms_visible = 1000.0 / fps_visible if fps_visible > 0 else None
    ms_hidden = 1000.0 / fps_hidden if fps_hidden > 0 else None
    RESULT["perf"] = {"fps_visible": round(fps_visible, 2), "fps_hidden": round(fps_hidden, 2),
                      "ms_visible": None if ms_visible is None else round(ms_visible, 2),
                      "ms_hidden": None if ms_hidden is None else round(ms_hidden, 2),
                      "cost_ms": None if (ms_visible is None or ms_hidden is None) else round(ms_visible - ms_hidden, 2),
                      "throttled": fps_hidden < 10.0, "samples": samples}
    record("M07", "the orb costs under 10% of the frame (A/B, visible vs hidden)",
           fps_hidden > 0 and fps_visible >= 0.9 * fps_hidden, **RESULT["perf"])

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    L.set_background_throttle_suspended(False)
    RESULT["passed"] = sum(1 for t in tests if t["pass"])
    RESULT["failed"] = [t["id"] for t in tests if not t["pass"]]
    RESULT["status"] = "done"
