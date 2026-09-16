# PIE job: the Relay Dog and the Mission Contract, together, through one deterministic mission.
#
# THE FOUR QUESTIONS THE FOUNDER ASKED, each answered from state the RENDERER actually uses rather than
# from a state enum that only says what was intended:
#
#   1 RESEARCH CIRCLE   the Dog's world positions during PLANNING, as a radius about the anchor and a total
#                       swept angle. A circle sweeps; a shuffle does not, and no screenshot settles that.
#   2 FLOAT             the Body component's height during MISSION START against its own height when the
#                       Dog is standing. A lift measured against the Dog itself, not against a guess.
#   3 BEAM              the VerificationBeam component's world transform. Its X scale IS its length (the
#                       author sets Length/100), so the far end is computable -- and the check is whether
#                       that end LANDS ON the crystal, not whether an act says it should.
#   4 TRANSITION        dense frames across MISSION START -> PLANNING, with the exact sample the book first
#                       becomes visible and what the body was doing at the time.
#
# Rules kept: zc_ prefix, no saves, no map edits, never Escape unless a panel is open, and it ends its own PIE.
import math
import os
import time

SHOTS = os.path.join(os.path.dirname(CHANNEL), "captures", "zc")
L = unreal.WonderlandUiTestLibrary

PACE = 1.1          # seconds per mission event
SAMPLE = 0.25       # seconds between samples
CAPTURE_EVERY = 2   # capture every Nth sample
BEAM_TOLERANCE = 45.0   # uu the beam's end may miss the crystal's centre by and still be "landing on" it


def job():
    os.makedirs(SHOTS, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests

    def say(line):
        unreal.log_warning("WLJOINT %s" % line)

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        say("%s %s %s" % (tid, "PASS" if ok else "FAIL", detail))
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def shot(name):
        path = os.path.join(SHOTS, name)
        ok = L.capture_game_viewport(path)
        return path if (ok is True or (isinstance(ok, tuple) and ok and ok[0])) else None

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
    controller = unreal.GameplayStatics.get_player_controller(world, 0)
    live = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()]
    mission = live[0] if live else None
    for cmd in ("t.MaxFPS 0", "Slate.bAllowThrottling 0", "r.VSync 0"):
        unreal.SystemLibrary.execute_console_command(world, cmd)
    yield 0.5

    # ---------------------------------------------------------------- the components the renderer uses
    parts = {}
    for comp in pawn.get_components_by_class(unreal.SceneComponent):
        parts[comp.get_name()] = comp
    beam = parts.get("VerificationBeam")
    body = parts.get("Body")
    book = parts.get("MissionBook")
    brush = parts.get("MissionBrush")
    RESULT["components"] = {"beam": beam is not None, "body": body is not None,
                            "book": book is not None, "brush": brush is not None}
    say("components %s" % RESULT["components"])
    record("J00", "the Dog carries the props and the beam the animation lane built",
           mission is not None and all(RESULT["components"].values()), **RESULT["components"])

    record("J01", "nothing is running, so there is no Mission Contract and no grounded presentation",
           mission is not None and not mission.is_orb_in_world() and mission.get_contracts_manifested() == 0,
           contract=mission.is_orb_in_world() if mission else None,
           capture=shot("zc_joint_00_empty.png"))

    # ---------------------------------------------------------------- film it
    say("running full_lifecycle at %.2f s/event" % PACE)
    mission.start_fixture("full_lifecycle", PACE)
    frames = []
    index = 0
    deadline = time.time() + 120.0
    while time.time() < deadline:
        yield SAMPLE
        here = mission.is_orb_in_world()
        at = mission.get_orb_location()
        anchor = mission.get_contract_anchor() if mission.is_contract_anchored() else None
        pawn_at = pawn.get_actor_location()

        # THE BEAM'S REAL GEOMETRY. X scale is Length/100 by construction, so the far end is exact.
        beam_on = bool(beam.is_visible()) if beam is not None else False
        beam_end = None
        beam_miss = None
        if beam_on:
            origin = beam.get_world_location()
            forward = beam.get_forward_vector()
            length = float(beam.get_world_scale().x) * 100.0
            beam_end = [origin.x + forward.x * length, origin.y + forward.y * length, origin.z + forward.z * length]
            if here:
                beam_miss = round(math.dist(beam_end, [at.x, at.y, at.z]), 1)

        frames.append({
            "i": index,
            "t": round(index * SAMPLE, 2),
            "beat": str(mission.get_beat_id()),
            "step": mission.get_chakra_step(),
            "asked": str(mission.get_dog_act_label()),
            "performing": str(mission.get_dog_performing_label()),
            "contract": bool(here),
            "anchor": [round(anchor.x, 2), round(anchor.y, 2), round(anchor.z, 2)] if anchor else None,
            "pawn": [round(pawn_at.x, 1), round(pawn_at.y, 1), round(pawn_at.z, 1)],
            "body_z": round(float(body.get_world_location().z), 1) if body is not None else None,
            "beam_on": beam_on,
            "beam_end": [round(v, 1) for v in beam_end] if beam_end else None,
            "beam_miss_uu": beam_miss,
            "book": bool(book.is_visible()) if book is not None else False,
            "brush": bool(brush.is_visible()) if brush is not None else False,
            "capture": shot("zc_joint_%03d.png" % index) if index % CAPTURE_EVERY == 0 else None,
        })
        index += 1
        if not mission.is_fixture_running() and not here:
            break
    RESULT["frames"] = frames
    say("filmed %d samples" % len(frames))

    def during(*beats):
        return [f for f in frames if f["beat"] in beats]

    # ---------------------------------------------------------------- 1 the research circle
    # A CIRCLE SWEEPS. Radius alone cannot tell a circle from a dog standing on a ring, so the angle the
    # Dog travels about the anchor is what decides it -- and the radius spread says whether it is a circle
    # or a wander that happens to average out.
    plan = [f for f in during("prompt_architect", "guidance") if f["anchor"]]
    circle = {"samples": len(plan)}
    if len(plan) > 2:
        ax, ay = plan[0]["anchor"][0], plan[0]["anchor"][1]
        radii, angles = [], []
        for f in plan:
            dx, dy = f["pawn"][0] - ax, f["pawn"][1] - ay
            radii.append(math.hypot(dx, dy))
            angles.append(math.degrees(math.atan2(dy, dx)))
        swept = 0.0
        for a, b in zip(angles, angles[1:]):
            d = (b - a + 180.0) % 360.0 - 180.0
            swept += d
        circle.update({"radius_mean_uu": round(sum(radii) / len(radii), 1),
                       "radius_min_uu": round(min(radii), 1), "radius_max_uu": round(max(radii), 1),
                       "radius_spread_uu": round(max(radii) - min(radii), 1),
                       "swept_deg": round(abs(swept), 1)})
    RESULT["circle"] = circle
    # 60 degrees over a planning stage is the least that reads as going round something rather than
    # shifting on the spot; a spread over half the radius is a wander, not a circle.
    record("J02", "the Dog circles the contract while reading, rather than shuffling beside it",
           circle.get("swept_deg", 0.0) >= 60.0
           and circle.get("radius_spread_uu", 9e9) <= circle.get("radius_mean_uu", 1.0) * 0.5,
           **circle)

    # ---------------------------------------------------------------- 2 the float
    # MEASURED AGAINST THE DOG'S OWN STANDING HEIGHT, so it means "left the ground" rather than "is at
    # some number I chose".
    floating = [f["body_z"] for f in during("mission_start") if f["body_z"] is not None]
    grounded = [f["body_z"] for f in during("prompt_architect", "coding_agent", "verifying") if f["body_z"] is not None]
    lift = None
    if floating and grounded:
        lift = round(max(floating) - (sum(grounded) / len(grounded)), 1)
    RESULT["float"] = {"lift_uu": lift, "float_samples": len(floating), "ground_samples": len(grounded),
                       "body_z_floating": round(max(floating), 1) if floating else None,
                       "body_z_standing": round(sum(grounded) / len(grounded), 1) if grounded else None}
    record("J03", "the float visibly clears the ground rather than hovering a few inches",
           lift is not None and lift >= 40.0, **RESULT["float"])

    # ---------------------------------------------------------------- 3 the beam lands on the crystal
    # THE RENDERED TRANSFORM, not the act. The component's X scale is its length by construction, so the
    # far end is exact and the only question is whether it reaches the crystal or passes through it.
    verify = during("verifying")
    lit = [f for f in verify if f["beam_on"]]
    misses = [f["beam_miss_uu"] for f in lit if f["beam_miss_uu"] is not None]
    RESULT["beam"] = {"verify_samples": len(verify), "beam_on": len(lit),
                      "miss_mean_uu": round(sum(misses) / len(misses), 1) if misses else None,
                      "miss_max_uu": round(max(misses), 1) if misses else None,
                      "tolerance_uu": BEAM_TOLERANCE,
                      "assertable": "UInstancedStaticMeshComponent 'VerificationBeam': is_visible(), "
                                    "world location, forward vector, and X scale x100 = exact length"}
    record("J04", "the rendered beam lands on the crystal, sustained for the whole of verification",
           len(verify) > 0 and len(lit) >= max(1, int(len(verify) * 0.8))
           and misses and max(misses) <= BEAM_TOLERANCE, **RESULT["beam"])

    # ---------------------------------------------------------------- 4 float into the book
    start_end = max([f["i"] for f in during("mission_start")] or [-1])
    first_book = min([f["i"] for f in frames if f["book"]] or [-1])
    gap = (first_book - start_end) if (first_book >= 0 and start_end >= 0) else None
    descent = None
    if start_end >= 0 and first_book > start_end:
        between = [f["body_z"] for f in frames[start_end:first_book + 1] if f["body_z"] is not None]
        if len(between) > 1:
            descent = round(between[0] - between[-1], 1)
    RESULT["transition"] = {"last_float_sample": start_end, "first_book_sample": first_book,
                            "samples_between": gap, "descended_uu": descent,
                            "seconds_between": round((gap or 0) * SAMPLE, 2)}
    record("J05", "the float descends into the reading rather than cutting to it",
           gap is not None and gap >= 1 and descent is not None and descent >= 30.0,
           **RESULT["transition"])

    # ---------------------------------------------------------------- the rest of the founder's list
    handoffs = [f for f in frames if f["beat"] == "handoff" and f["contract"]]
    inherited_ok = bool(handoffs) and all(f["performing"] != "NONE" for f in handoffs)
    record("J06", "a handoff keeps the performance it inherited",
           inherited_ok, handoffs=len(handoffs),
           performing=sorted({f["performing"] for f in handoffs}),
           props=sorted({"book" if f["book"] else ("brush" if f["brush"] else "none") for f in handoffs}))

    ended = [f for f in frames if not f["contract"] and f["i"] > 3]
    record("J07", "completion ends the performance even while the crystal is still fading",
           bool(ended) and all(f["performing"] in ("NONE", "NO DOG") and not f["beam_on"] for f in ended),
           samples_after=len(ended),
           performing=sorted({f["performing"] for f in ended}),
           beam_still_on=sum(1 for f in ended if f["beam_on"]))

    one_prop = [f for f in frames if f["book"] and f["brush"]]
    record("J08", "exactly one prop is ever in hand", not one_prop, both=len(one_prop))

    # ---------------------------------------------------------------- a mission during the fade
    # The crystal is still leaving when the next mission starts, which is the one moment a second could be
    # spawned beside it. The count is the proof.
    before = mission.get_contracts_manifested()
    mission.set_beat_by_id("mission_start")
    yield 0.35
    during_fade = mission.get_contracts_manifested()
    orbs = len(unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandMissionOrb))
    record("J09", "a mission beginning during the fade revives the crystal instead of spawning a second",
           orbs <= 1, contracts_before=before, contracts_after=during_fade, orbs_in_world=orbs,
           capture=shot("zc_joint_zz_refade.png"))
    mission.set_beat_by_id("idle")

    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 60)
    L.set_background_throttle_suspended(False)
    RESULT["passed"] = sum(1 for t in tests if t["pass"])
    RESULT["failed"] = [t["id"] for t in tests if not t["pass"]]
    RESULT["status"] = "done"
