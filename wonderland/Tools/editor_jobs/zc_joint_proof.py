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

# SLOW ENOUGH TO SEE A CIRCLE. At 1.1 s an event the planning stage lasts about a second and a half, in
# which the Dog sweeps 40 degrees -- an arc, not a circle, and no fault of the animation. A real planning
# stage lasts minutes; the fixture's pace is a filming artifact, so the film slows down rather than the walk
# speeding up. J02 asserts the RATE for that reason, which is the part that does not depend on the pace.
PACE = 3.0          # seconds per mission event
SAMPLE = 0.25       # seconds between samples
CAPTURE_EVERY = 3   # capture every Nth sample. A 3.4 MB PNG is not free and the film is long now.
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

    # EVERY PATH ENDS PLAY, including the ones that throw.
    #
    # A job that errors or stalls does NOT end its own PIE session, and every job queued behind it then
    # waits on "the editor is free" until it times out. That has now cost this project three stalls and
    # about an hour between two sessions -- a bug recurs, but a stranded session takes the whole queue with
    # it, which is a structural fault and not a bug at all.
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
        live = [m for m in unreal.ObjectIterator(unreal.WonderlandMissionSubsystem) if m.is_mission_strip_on_screen()]
        mission = live[0] if live else None
        for cmd in ("t.MaxFPS 0", "Slate.bAllowThrottling 0", "r.VSync 0"):
            unreal.SystemLibrary.execute_console_command(world, cmd)
        yield 0.5

        # ---------------------------------------------------------------- the components the renderer uses
        # BY PREFIX, NOT BY NAME. Both lanes build these with MakeUniqueObjectName, so the component that
        # actually exists is "VerificationBeam_0" and an exact match finds nothing -- which is what made the
        # first run report no beam and no props on a Dog that was visibly carrying them.
        scene = list(pawn.get_components_by_class(unreal.SceneComponent))
        RESULT["component_names"] = sorted(c.get_name() for c in scene)

        def part(prefix, exact=False):
            for c in scene:
                name = c.get_name()
                if name == prefix or (not exact and name.startswith(prefix)):
                    return c
            return None

        beam = part("VerificationBeam")
        body = part("Body", exact=True)
        book = part("MissionBook")
        brush = part("MissionBrush")
        lens = part("MissionLensRim")
        RESULT["components"] = {"beam": beam is not None, "body": body is not None,
                                "book": book is not None, "brush": brush is not None,
                                "lens": lens is not None}

        companions = list(unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandCompanionEmbodiment))
        RESULT["companion_count"] = len(companions)
        say("components %s" % RESULT["components"])
        record("J00", "the Dog carries the props and the beam the animation lane built",
               mission is not None and all(RESULT["components"].values()), **RESULT["components"])

        record("J01", "nothing is running, so there is no Mission Contract and no grounded presentation",
               mission is not None and not mission.is_orb_in_world() and mission.get_contracts_manifested() == 0,
               contract=mission.is_orb_in_world() if mission else None,
               capture=shot("zc_joint_00_empty.png"))

        def companion_clearance(from_at, to_at, bodies):
            """Perpendicular distance, uu, from each companion to the Dog->Contract line, in plan.

            The founder asked that the companions CLEAR the sight-line, and clear is a distance from a line --
            so it is measured as one. The film that found the fault had a companion sitting on it.
            """
            ax, ay = float(from_at.x), float(from_at.y)
            bx, by = float(to_at.x), float(to_at.y)
            dx, dy = bx - ax, by - ay
            span = math.hypot(dx, dy)
            if span < 1.0:
                return []
            out = []
            for c in bodies:
                p = c.get_actor_location()
                # |cross| / |d| is the distance from a point to the infinite line through a and b.
                out.append(round(abs(dx * (ay - float(p.y)) - (ax - float(p.x)) * dy) / span, 1))
            return out

        # ---------------------------------------------------------------- film it
        say("running full_lifecycle at %.2f s/event" % PACE)
        mission.start_fixture("full_lifecycle", PACE)
        frames = []
        index = 0
        tail = 5   # keep filming a little past the ending, so J07 has more than one sample to judge
        # LONG ENOUGH FOR THE WHOLE FIXTURE AND NO LONGER. 22 events at 3 s is 66 s, plus the ending hold and
        # the tail; 150 s leaves room without letting a stalled run sit here until the channel gives up on it.
        deadline = time.time() + 150.0
        while time.time() < deadline:
            yield SAMPLE
            here = mission.is_orb_in_world()
            at = mission.get_orb_location()

            # POINT THE CAMERA WHERE A PLAYER WOULD LOOK.
            #
            # The Dog's BODY turns to face the contract -- that is what planted_facing_contract does -- but the
            # spring-arm camera follows the CONTROL rotation, which belongs to the player and which nobody in a
            # scripted run ever sets. So the first films showed the Dog's back and an empty garden while a
            # perfectly aimed beam ran off-screen behind it: the beam's endpoint matched the anchor to the
            # centimetre and nothing was in frame.
            #
            # This is the camera, not the content. A person watching their own mission would be looking at it.
            if here and controller is not None:
                pawn_now = pawn.get_actor_location()
                look = unreal.MathLibrary.find_look_at_rotation(pawn_now, at)
                # A little above the line so the Dog sits in the lower third rather than masking the crystal.
                controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=look.pitch - 8.0, yaw=look.yaw))
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

            # WHERE IT ACTUALLY LANDS ON SCREEN. Diagnosing "I cannot see it" by eye costs a PIE session per
            # guess; the projected position says whether the thing is off-frame, behind the camera, or simply
            # small, and those are three different faults with three different fixes.
            crystal_px = None
            if here and controller is not None:
                try:
                    got = unreal.GameplayStatics.project_world_to_screen(controller, at, False)
                    if isinstance(got, tuple):
                        got = got[1] if len(got) > 1 else got[0]
                    crystal_px = [round(float(got.x), 1), round(float(got.y), 1)]
                except Exception as exc:
                    RESULT.setdefault("project_error", str(exc))

            frames.append({
                "i": index,
                "crystal_px": crystal_px,
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
                "lens": bool(lens.is_visible()) if lens is not None else False,
                "formation": str(mission.get_companion_formation()),
                "pulses_sent": mission.get_companion_pulses_sent(),
                "pulses_flying": mission.get_companion_pulses_in_flight(),
                # HOW FAR EACH COMPANION SITS OFF THE BEAM'S LINE. The founder asked that they clear the
                # sight-line; "clear" is a distance from a line, so it is measured as one rather than eyeballed.
                "companion_off_line": companion_clearance(pawn_at, at, companions) if here else None,
                "capture": shot("zc_joint_%03d.png" % index) if index % CAPTURE_EVERY == 0 else None,
            })
            index += 1
            if not mission.is_fixture_running() and not here:
                tail -= 1
                if tail <= 0:
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
        if circle.get("samples", 0) > 2:
            seconds = max((len(plan) - 1) * SAMPLE, 0.01)
            circle["seconds"] = round(seconds, 2)
            circle["sweep_rate_deg_s"] = round(circle.get("swept_deg", 0.0) / seconds, 1)
            circle["full_circle_seconds"] = round(360.0 / max(circle["sweep_rate_deg_s"], 0.01), 1)
        # THE RATE IS THE PART THAT DOES NOT DEPEND ON THE FIXTURE'S PACE. A stage of any realistic length
        # reads as going round something if the Dog would complete a circle in under about twenty seconds; the
        # radius spread says whether it is a circle or a wander that happens to average out.
        record("J02", "the Dog circles the contract while reading, rather than shuffling beside it",
               circle.get("full_circle_seconds", 9e9) <= 20.0
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

        # ---------------------------------------------------------------- review is not painting
        # THE FOUNDER'S DECISION, CHECKED AS A PROP RATHER THAN AS A LABEL. It is not enough that review asks
        # for a different act; the brush has to be GONE, because a Dog still holding it is still painting as
        # far as anybody watching is concerned.
        review = [f for f in frames if f["beat"] in ("independent_reviewer", "review_challenge")]
        brush_in_review = [f["i"] for f in review if f["brush"]]
        lens_in_review = [f for f in review if f["lens"]]
        record("J11", "review puts the brush away and takes up the lens",
               len(review) > 0 and not brush_in_review and len(lens_in_review) >= max(1, int(len(review) * 0.8)),
               review_samples=len(review), still_holding_brush=brush_in_review,
               lens_up=len(lens_in_review))

        # ---------------------------------------------------------------- repair is corrective
        repair = [f for f in frames if f["beat"] in ("repair_required", "repairing")]
        repair_acts = sorted({f["performing"] for f in repair})
        record("J12", "repair performs its own corrective act rather than more implementation",
               len(repair) > 0 and repair_acts == ["REPAIR"],
               repair_samples=len(repair), performing=repair_acts,
               brush_back=sum(1 for f in repair if f["brush"]))

        # ---------------------------------------------------------------- the companions clear the beam
        # MEASURED AS A DISTANCE FROM THE LINE, because that is what "clear the sight-line" means. The film that
        # found this fault had a companion ON the line; anything under about a body's width is still in the way.
        verify_frames = [f for f in frames if f["beat"] == "verifying" and f.get("companion_off_line")]
        worst = None
        if verify_frames:
            worst = min(min(f["companion_off_line"]) for f in verify_frames)
        RESULT["sight_line"] = {"samples": len(verify_frames), "closest_companion_uu": worst,
                                "formation": sorted({f["formation"] for f in verify_frames})}
        record("J13", "the companions clear the line between the Dog and the Contract while verifying",
               worst is not None and worst >= 120.0, **RESULT["sight_line"])

        # ---------------------------------------------------------------- the companions assist the study
        study = [f for f in frames if f["beat"] in ("researching", "prompt_architect", "guidance")]
        orbiting = [f for f in study if f["formation"] == "RESEARCH ORBIT"]
        sent_first = min([f["pulses_sent"] for f in study] or [0])
        sent_last = max([f["pulses_sent"] for f in study] or [0])
        flew = [f for f in study if f["pulses_flying"] > 0]
        RESULT["study"] = {"samples": len(study), "orbiting": len(orbiting),
                           "pulses_over_the_stage": sent_last - sent_first,
                           "samples_with_a_pulse_in_flight": len(flew)}
        record("J14", "the companions orbit the Contract during study and send pulses into it",
               len(orbiting) >= max(1, int(len(study) * 0.8))
               and (sent_last - sent_first) >= 2 and len(flew) >= 2, **RESULT["study"])

        # ---------------------------------------------------------------- a portrait of the beam
        # THE PLAYER'S CAMERA SITS BEHIND THE DOG, and VERIFYING plants the Dog facing the contract -- so the
        # only view the third person rig can offer of the beam is down its own axis, past the Dog, and (as this
        # run found) straight through the Jhinn, which follows the Dog and lands on that sight-line.
        #
        # Rather than guess an angle and spend a PIE session per guess, hold the state and sweep the camera:
        # same moment, same beam, several pitches, and the frames say which one a person could read. Nothing is
        # hidden and nothing is posed -- this is where a player would put their own camera.
        mission.stop_fixture()
        mission.set_beat_by_id("mission_start")
        yield 0.4
        mission.set_beat_by_id("verifying")
        yield 1.4
        portrait = []
        pawn_now = pawn.get_actor_location()
        contract_at = mission.get_orb_location()
        look = unreal.MathLibrary.find_look_at_rotation(pawn_now, contract_at)
        for name, dyaw, pitch in (("level", 0.0, look.pitch - 6.0),
                                  ("down20", 0.0, -20.0),
                                  ("down35", 0.0, -35.0),
                                  ("off25_down20", 25.0, -20.0),
                                  ("off45_down25", 45.0, -25.0)):
            controller.set_control_rotation(unreal.Rotator(roll=0.0, pitch=pitch, yaw=look.yaw + dyaw))
            yield 0.7
            at2 = mission.get_orb_location()
            px = None
            try:
                got = unreal.GameplayStatics.project_world_to_screen(controller, at2, False)
                if isinstance(got, tuple):
                    got = got[1] if len(got) > 1 else got[0]
                px = [round(float(got.x), 1), round(float(got.y), 1)]
            except Exception:
                pass
            portrait.append({"name": name, "yaw_offset": dyaw, "pitch": round(pitch, 1),
                             "crystal_px": px, "beam_on": bool(beam.is_visible()) if beam else False,
                             "capture": shot("zc_joint_beam_%s.png" % name)})
        RESULT["portrait"] = portrait
        record("J10", "the beam can be framed from the player's own camera",
               all(p["beam_on"] for p in portrait) and any(p["crystal_px"] for p in portrait),
               angles=[p["name"] for p in portrait])
        mission.set_beat_by_id("idle")
        yield 0.6

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

        RESULT["passed"] = sum(1 for t in tests if t["pass"])
        RESULT["failed"] = [t["id"] for t in tests if not t["pass"]]
        RESULT["status"] = "done"

    finally:
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
            unreal.log_warning("WLJOINT play ended")
        except Exception as exc:
            unreal.log_warning("WLJOINT could not end play: %s" % exc)
