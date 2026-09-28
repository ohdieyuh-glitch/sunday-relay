# CAN THE DOG WALK EACH NATION'S AVENUE, GATE TO BAND, UNDER ITS OWN POWER?
#
# THE RULING (QA-8): "proven by ACTUAL MOVEMENT through it. Not teleport samples, not grounding samples,
# not static navmesh points, not camera evidence." So this is none of those. The Dog is stood at the gate
# end of the route the corridor search found and the avenue was laid on, and then it is DRIVEN: every tick
# it is turned toward the next waypoint and given forward movement input, the way WonderlandDemoFlow drives
# it for the films -- AddMovementInput with bForce, because without force the input is silently dropped
# (WonderlandDemoFlow.cpp:640). It walks, or it does not.
#
# WHAT COUNTS AS WALKING. A waypoint is reached when the Dog's own position is within ARRIVE of it. If the
# Dog has not gained ground on the current waypoint for STUCK seconds it is stuck, and the job records WHERE
# and what was in front of it, then abandons that nation rather than teleporting past the problem -- a
# teleport is exactly the evidence the ruling excludes. The gate is that all three Dogs arrive at the far
# end, and the number that matters when one does not is the radius it reached.
#
# NOT A NAVMESH. The founder retired the continent-scale baked navmesh in favour of local invoker
# generation; nothing here consults a navmesh at all. The route is the geometry's own, from the specs, and
# the walk is the character's own locomotion over the collision that is actually there.
import json
import math
import os

import unreal

L = unreal.WonderlandUiTestLibrary
ROUTES = r"C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign/Nations/nation_routes.json"
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "nation_walk")

EVERY = 4            # every 4th 2 m cell -> 8 m waypoints, the same thinning the avenue was laid on
ARRIVE = 180.0       # within 1.8 m is "there"; the Dog's capsule is 0.72 m wide
STUCK = 6.0          # seconds without gaining 20 cm on the waypoint
TICK = 0.05
MAX_SECONDS = 240.0  # ~480 m at a walk is ~100 s; this is generous, not open-ended
PAWN = unreal.TraceTypeQuery.TRACE_TYPE_QUERY2


def job():
    RESULT["status"] = "running"
    tests, nations = [], {}
    RESULT["tests"], RESULT["nations"] = tests, nations
    os.makedirs(ROOT, exist_ok=True)

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    with open(ROUTES, encoding="utf-8") as f:
        routes = json.load(f)

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()

    def live():
        """The world, re-fetched at every use. A reference held across a long job goes stale, and the
        failure is silent for some calls: get_all_actors_* returns an empty list, pose_camera throws."""
        return ues.get_game_world()

    def alive():
        """World AND pawn, or None. A torn-down PIE keeps returning readings -- constant, and
        indistinguishable from a real measurement. A walk that keeps 'driving' a dead world reports the
        Dog as stuck when in fact there is no Dog."""
        w = ues.get_game_world()
        if w is None:
            return None
        try:
            return w if unreal.GameplayStatics.get_player_pawn(w, 0) is not None else None
        except Exception:                                              # noqa: BLE001
            return None

    def why_gone():
        """Which of the two things alive() checks actually went away.

        alive() collapses "the world ended" and "the Dog was destroyed" into one None, and the error message
        used to blame the world for both. They are opposite findings: a torn-down PIE is the harness and says
        nothing about the route, while a destroyed pawn part-way along an avenue is most likely a Dog that
        walked into an unstreamed cell, fell through and was killed by KillZ -- which IS the route.
        """
        w = ues.get_game_world()
        if w is None:
            return "world", "PIE was torn down -- the harness or a neighbouring job, not the route"
        try:
            if unreal.GameplayStatics.get_player_pawn(w, 0) is None:
                return "pawn", "the world is still up and the DOG is gone -- destroyed, not stuck"
        except Exception:                                              # noqa: BLE001
            return "pawn", "the pawn could not be read while the world was still up"
        return "neither", "both present when re-checked -- a transient miss"
    L.focus_game_viewport()
    unreal.SystemLibrary.execute_console_command(live(), "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(live(), "wl.Sky.Hour 12")
    yield 5.0

    def pawn():
        return unreal.GameplayStatics.get_player_pawn(live(), 0)

    def floor_at(x, y, top):
        try:
            hit = unreal.SystemLibrary.line_trace_single(
                live(), unreal.Vector(x, y, top), unreal.Vector(x, y, top - 3000.0), PAWN, False,
                [p for p in (pawn(),) if p is not None], unreal.DrawDebugTrace.NONE, True,
                unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            return None if hit is None else float(hit.to_tuple()[4].z)
        except Exception:                                             # noqa: BLE001
            return None

    def what_is_ahead(dog, heading_deg, dist=150.0):
        """The first colliding thing in the Dog's way, by name, at chest height."""
        try:
            loc = dog.get_actor_location()
            h = math.radians(heading_deg)
            a = unreal.Vector(loc.x, loc.y, loc.z + 40.0)
            b = unreal.Vector(loc.x + math.cos(h) * dist, loc.y + math.sin(h) * dist, loc.z + 40.0)
            hit = unreal.SystemLibrary.line_trace_single(live(), a, b, PAWN, False, [dog],
                                                         unreal.DrawDebugTrace.NONE, True,
                                                         unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
            if hit is None:
                return None
            t = hit.to_tuple()
            actor = t[9] if len(t) > 9 else None
            return str(actor.get_actor_label()) if actor is not None else "something"
        except Exception:                                             # noqa: BLE001
            return None

    for nation, route in sorted(routes.items()):
        # A FRESH PIE FOR EACH NATION, because the Dog does not come back.
        #
        # The first clean run told this plainly: ICARUS reported the harness could not drive the Dog, and
        # NOCTIS and TARTARUS then reported "no pawn" -- the Dog had been destroyed during ICARUS and never
        # respawned, which this project's ledger records as the documented behaviour after a teleport into
        # a cell that is not loaded. Two of the three nations were therefore not tested at all, and would
        # have been reported as traversal failures if the actuator gate had not withheld them.
        if ues.get_game_world() is not None:
            les.editor_request_end_play()
            yield (lambda: ues.get_game_world() is None, 600)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 300)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
        # ---- AND RE-ARM THE TWO THINGS A PIE RESTART DROPS. THIS IS WHY THIS HARNESS DID NOT REPEAT.
        #
        # Both of these are set ONCE at the top of the job, before the FIRST begin_play -- and this loop
        # ends play and begins it again for every nation. A fresh PIE session comes up with its viewport
        # unfocused and the editor free to throttle a background window, so from the second nation onward the
        # Dog was being driven at whatever reduced tick rate a throttled editor felt like giving it.
        #
        # THAT IS THE SPREAD W0C REFUSES TO ACCEPT. Four runs in one session measured ICARUS at 230, 0, 35.2
        # and 86.0 uu/s on the same route -- a spread equal to the character's entire walk speed -- and the
        # first nation of each run is the one that looked healthy. AddMovementInput accumulates per TICK, so
        # a throttled editor does not make the Dog walk badly, it makes it walk less far per second of wall
        # clock, and every distance and speed this job reports is then a measurement of the editor's window
        # focus rather than of the avenue.
        #
        # Re-armed per nation, so every nation is driven under the same conditions as the first.
        L.set_background_throttle_suspended(True)
        L.focus_game_viewport()
        yield 4.0
        unreal.SystemLibrary.execute_console_command(live(), "wl.Sky.DayMinutes 0")
        unreal.SystemLibrary.execute_console_command(live(), "wl.Sky.Hour 12")
        pts = route["points"][::EVERY]
        if pts[-1] is not route["points"][-1]:
            pts.append(route["points"][-1])
        start = pts[0]
        row = {"waypoints": len(pts), "route_m": None, "reached_m": None, "arrived": False, "stuck_at": None}
        nations[nation] = row
        dog = pawn()
        if dog is None:
            row["error"] = "no pawn"
            continue
        # STOOD AT THE GATE END, on the floor the search measured, and given a moment to settle.
        # STREAM THE START IN BEFORE STANDING ON IT. ICARUS came back 614.7 m from its own start point --
        # the Dog was placed into a cell that had not loaded, which the ledger records as fatal. The Dog is
        # moved close first to BE the streaming source, then the floor is polled until it answers, and only
        # then is it stood precisely.
        try:
            dog.set_actor_location(unreal.Vector(start["x"], start["y"], start["floor"] + 900.0), False, True)
        except Exception:                                             # noqa: BLE001
            pass
        z0, waited = None, 0.0
        while z0 is None and waited < 20.0:
            yield 1.0
            waited += 1.0
            z0 = floor_at(start["x"], start["y"], start["floor"] + 600.0)
        row["start_stream_wait_s"] = waited
        z0 = start["floor"] if z0 is None else z0
        dog = pawn()
        if dog is None:
            row["error"] = "the Dog did not survive being moved to the start cell"
            continue
        try:
            dog.set_actor_location(unreal.Vector(start["x"], start["y"], z0 + 100.0), False, True)
        except Exception:                                             # noqa: BLE001
            row["error"] = "could not stand at the start"
            continue
        yield 3.0
        dog = pawn()
        if dog is None:
            row["error"] = "the Dog did not survive standing at the start"
            continue
        loc = dog.get_actor_location()
        row["start_error_m"] = round(math.hypot(loc.x - start["x"], loc.y - start["y"]) / 100.0, 2)
        if row["start_error_m"] > 3.0:
            row["error"] = "the Dog is %.1f m from the start; the cell may not have loaded" % row["start_error_m"]
            continue

        total = sum(math.hypot(pts[i]["x"] - pts[i - 1]["x"], pts[i]["y"] - pts[i - 1]["y"]) for i in range(1, len(pts)))
        row["route_m"] = round(total / 100.0, 1)

        # ---- CAN THE HARNESS DRIVE THIS DOG AT ALL? Asked before the route is judged.
        #
        # The first run reported NOCTIS and TARTARUS "stuck at waypoint 1" with nothing in front of the Dog --
        # and a Dog that is stuck with a clear path ahead is not a blocked route, it is a Dog that never
        # moved. Those two readings were published as a traversal result and they were a harness result. So
        # the walk now proves its own actuator first: three seconds of input toward the second waypoint, with
        # displacement AND peak speed recorded. If the Dog does not move here, every route number below is
        # withheld rather than reported as a world fault.
        tgt0 = pts[1]
        start_loc = dog.get_actor_location()
        probe_speed = 0.0
        # WHAT STATE IS THE DOG IN? Recorded before the probe, because "it did not move" has several very
        # different causes and guessing between them costs an editor window each time: no controller, a
        # movement mode that ignores input, a paused world, or an overlay holding the body.
        why = {}
        try:
            mv = dog.character_movement
            why["movement_mode"] = str(mv.movement_mode)
            why["max_walk_speed"] = round(float(mv.max_walk_speed), 1)
            why["is_falling"] = bool(mv.is_falling())
            why["gravity_scale"] = round(float(mv.gravity_scale), 2)
        except Exception as err:                                      # noqa: BLE001
            why["movement_component"] = "unreadable: %s" % str(err)[:70]
        try:
            why["controller"] = str(dog.get_controller().get_name()) if dog.get_controller() else "NONE"
        except Exception:                                             # noqa: BLE001
            why["controller"] = "unreadable"
        try:
            why["game_paused"] = bool(unreal.GameplayStatics.is_game_paused(live()))
        except Exception:                                             # noqa: BLE001
            why["game_paused"] = "unreadable"
        row["dog_state"] = why
        # DRIVE UNTIL IT MOVES, NOT FOR THREE SECONDS, and record how long that took.
        #
        # This drove 60 iterations of yield 0.05 -- three seconds of WALL TIME, which is not a fixed amount
        # of walking. At the 31 ms frame it is 95.6 frames; during the render-thread regression it was 7.7,
        # and add_movement_input is consumed once per MOVEMENT TICK rather than once per call, so about 52
        # of the 60 calls were thrown away. zzQ2 finished at 13:44 and the regression was fixed at 13:53:
        # it ran inside it, and reported peak speed 0.0 on all three nations.
        #
        # THAT IS A CANDIDATE AND NOT A CONCLUSION, because zzP1 ran inside the same regression at 11:55 and
        # drove all three at 230. The other thing that changed between them is 162 lamp instances applied to
        # the editor world. I cannot separate the two from the data I have, so rather than guess a third
        # time the probe now reports what would distinguish them: how long until first movement, how many
        # samples saw a non-zero velocity, and the wall time it actually took.
        moved_after, nonzero = None, 0
        t = 0.0
        while t < 8.0:
            d = pawn()
            if d is None:
                break
            loc = d.get_actor_location()
            dx, dy = tgt0["x"] - loc.x, tgt0["y"] - loc.y
            n = math.hypot(dx, dy) or 1.0
            try:
                d.add_movement_input(unreal.Vector(dx / n, dy / n, 0.0), 1.0, True)
                v = d.get_velocity()
                sp = math.hypot(v.x, v.y)
                if sp > 1.0:
                    nonzero += 1
                    if moved_after is None:
                        moved_after = round(t, 2)
                probe_speed = max(probe_speed, sp)
            except Exception:                                         # noqa: BLE001
                break
            yield 0.05
            t += 0.05
            # enough evidence: it is walking and we know when it started
            if nonzero >= 12:
                break
        row["probe_seconds"] = round(t, 2)
        row["probe_moved_after_s"] = moved_after
        row["probe_samples_with_speed"] = nonzero
        d = pawn()
        moved = math.hypot(d.get_actor_location().x - start_loc.x,
                           d.get_actor_location().y - start_loc.y) if d is not None else 0.0
        def clearance_ring(loc, heading_deg, dog_actor):
            """Free distance in every direction at the placement point, and the name of what stops it.

            The offline corridor audit can say WHAT is near the start; only a trace can say whether it is
            close enough to hold a capsule. Reported per direction rather than as a single minimum, because
            the number that decides whether the Dog can start walking is the clearance along the heading it
            is about to walk -- a wall behind it is irrelevant and a minimum over a ring hides which is
            which.
            """
            out = {"rays": [], "ahead_uu": None, "min_uu": None, "blocker": None}
            REACH = 400.0
            worst = None
            for step in range(16):
                deg = step * 22.5
                h = math.radians(deg)
                a = unreal.Vector(loc.x, loc.y, loc.z + 40.0)
                b = unreal.Vector(loc.x + math.cos(h) * REACH,
                                  loc.y + math.sin(h) * REACH, loc.z + 40.0)
                dist, what = REACH, None
                try:
                    hit = unreal.SystemLibrary.line_trace_single(
                        live(), a, b, PAWN, False, [dog_actor],
                        unreal.DrawDebugTrace.NONE, True,
                        unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
                    if hit is not None:
                        t = hit.to_tuple()
                        # HitResult has no named attributes in this engine's Python -- to_tuple() indices
                        # only: 3 distance, 9 actor, 10 component.
                        dist = round(float(t[3]), 1) if len(t) > 3 else REACH
                        comp = t[10] if len(t) > 10 else None
                        actor = t[9] if len(t) > 9 else None
                        # THE COMPONENT, NOT THE ACTOR. This world is instanced, so an actor label names a
                        # WonderlandInstancedBatch holding thousands of meshes and identifies nothing.
                        try:
                            sm = comp.get_editor_property("static_mesh") if comp is not None else None
                            what = str(sm.get_name()) if sm is not None else None
                        except Exception:                                  # noqa: BLE001
                            what = None
                        if what is None and actor is not None:
                            try:
                                what = "actor:" + str(actor.get_actor_label())
                            except Exception:                              # noqa: BLE001
                                what = "something"
                except Exception:                                          # noqa: BLE001
                    pass
                out["rays"].append({"deg": deg, "free_uu": dist, "hit": what})
                if worst is None or dist < worst[0]:
                    worst = (dist, what, deg)
            # the ray closest to the way the Dog is about to walk
            best = min(out["rays"],
                       key=lambda r: abs(((r["deg"] - heading_deg + 180.0) % 360.0) - 180.0))
            out["ahead_uu"] = best["free_uu"]
            out["ahead_hit"] = best["hit"]
            if worst is not None:
                out["min_uu"], out["blocker"], out["blocker_deg"] = worst[0], worst[1], worst[2]
            return out
        row["probe_moved_uu"] = round(moved, 1)
        row["probe_peak_speed"] = round(probe_speed, 1)
        # PEAK SPEED IS WHAT TELLS "BLOCKED" FROM "NOT DRIVEN", and displacement alone cannot.
        #
        # The run that produced this distinction: ICARUS moved 0.0 uu at a PEAK SPEED OF 230 -- the
        # character's own max_walk_speed. A Dog at full velocity that does not advance is a Dog walking into
        # something. NOCTIS moved 227 uu at 230 and walked cleanly. TARTARUS moved 67.7 uu but only ever
        # reached 11.9, which is a Dog barely able to get going. Three different states that a displacement
        # threshold on its own reports identically as "the harness failed", which is what the previous
        # version said about all three -- and it was wrong about at least two of them.
        row["can_be_driven"] = moved > 100.0
        driving = probe_speed > 0.5 * float(row.get("dog_state", {}).get("max_walk_speed") or 230.0)
        row["input_reaching_character"] = driving
        if not row["can_be_driven"]:
            # THE RING FIRES FOR ANY PROBE THAT GOES NOWHERE, not only for one at full speed.
            #
            # It used to require `driving` -- peak above half max_walk_speed -- which is the "pressed
            # against a wall at full throttle" case. The run that exposed the gap: ICARUS peaked at 35.2 and
            # TARTARUS at 29.2, both with NET DISPLACEMENT 0.0 and only three or four samples showing any
            # speed at all. A Dog that twitches and gets nowhere is as geometric as one that strains at
            # full speed, and the ring -- which names what it hits off the component mesh -- is exactly what
            # would say so. Neither got one.
            row["blocked_at_start"] = bool(driving)
            # THE RING RUNS FOR ANY PROBE THAT GOT NOWHERE, at speed or not -- a Dog twitching to 35 uu/s
            # and covering nothing is as geometric as one straining at full throttle. But the MESSAGE must
            # still tell those apart, and my first attempt at widening this made "BLOCKED AT THE START:
            # reached 0.0 uu/s -- its own walk speed" print unconditionally, which is self-contradictory on
            # its face and told TARTARUS it was blocked at a standstill.
            try:
                d_now = unreal.GameplayStatics.get_player_pawn(live(), 0)
                if d_now is None:
                    # ABSENCE, NOT EMPTINESS. A null start_clearance read as "nothing in the way"; the pawn
                    # was simply gone by the time the ring ran, which is a different fact and a louder one.
                    row["start_clearance"] = {"unavailable": "the pawn was gone before the ring could run"}
                else:
                    row["start_clearance"] = clearance_ring(
                        d_now.get_actor_location(),
                        math.degrees(math.atan2(tgt0["y"] - start_loc.y, tgt0["x"] - start_loc.x)),
                        d_now)
            except Exception as err:                                   # noqa: BLE001
                row["start_clearance"] = {"error": str(err)[:120]}
            if driving:
                row["error"] = ("BLOCKED AT THE START: the Dog reached %.1f uu/s -- most of its own walk "
                                "speed -- and advanced %.1f uu. Input is arriving and the capsule cannot "
                                "move, which is geometry, not the harness." % (probe_speed, moved))
            else:
                row["error"] = ("the Dog never got going: %.1f uu at a peak of only %.1f uu/s. Route NOT "
                                "judged. The ring still ran, because a twitch that covers nothing can be "
                                "geometry too." % (moved, probe_speed))
            emit("W_%s" % nation, "WARN", "%s: actuator dead, route withheld" % nation,
                 {"moved_uu": row["probe_moved_uu"], "peak_speed": row["probe_peak_speed"]})
            continue

        elapsed, wp = 0.0, 1
        best_d, since_gain = float("inf"), 0.0
        travelled = 0.0
        prev = dog.get_actor_location()
        while wp < len(pts) and elapsed < MAX_SECONDS:
            if alive() is None:
                kind, reason = why_gone()
                row["gone"] = kind
                row["gone_reason"] = reason
                # THE LAST PLACE THE DOG WAS, which is what separates "it fell" from "it was deleted".
                # Every route here runs on the +12 shelf, so a last-known z far below that is a fall.
                row["last_z"] = round(prev.z, 1)
                row["floor_z"] = float(pts[min(wp, len(pts) - 1)].get("floor", 12.0))
                row["below_floor_uu"] = round(row["floor_z"] - prev.z, 1)
                row["fell"] = row["below_floor_uu"] > 200.0
                row["error"] = ("%s went away at waypoint %d after %.1f m -- %s. Last seen z=%.1f, %.1f uu "
                                "below this leg's floor of %.1f. Route NOT judged."
                                % ("the WORLD" if kind == "world" else "the DOG", wp, travelled / 100.0,
                                   reason, prev.z, row["below_floor_uu"], row["floor_z"]))
                break
            dog = pawn()
            if dog is None:
                row["error"] = "the Dog was destroyed mid-walk"
                break
            loc = dog.get_actor_location()
            # DISTANCE TRAVELLED ALONG THE ROUTE. The first version recorded hypot(loc.x, loc.y) -- the
            # radius from the world origin -- so a Dog standing still at a start point 600 m out reported
            # "reached 600.0 m" and looked like progress. It was the start radius, restated.
            travelled += math.hypot(loc.x - prev.x, loc.y - prev.y)
            prev = loc
            tgt = pts[wp]
            dx, dy = tgt["x"] - loc.x, tgt["y"] - loc.y
            d = math.hypot(dx, dy)
            if d <= ARRIVE:
                wp += 1
                best_d, since_gain = float("inf"), 0.0
                continue
            if d < best_d - 20.0:
                best_d, since_gain = d, 0.0
            else:
                since_gain += TICK
            if since_gain >= STUCK:
                heading = math.degrees(math.atan2(dy, dx))
                row["stuck_at"] = {"radius_m": round(math.hypot(loc.x, loc.y) / 100.0, 1),
                                   "x": round(loc.x), "y": round(loc.y), "z": round(loc.z),
                                   "waypoint": wp, "ahead": what_is_ahead(dog, heading)}
                try:
                    L.capture_game_viewport(os.path.join(ROOT, "%s_stuck.png" % nation.lower()))
                except Exception:                                     # noqa: BLE001
                    pass
                break
            heading = math.degrees(math.atan2(dy, dx))
            try:
                dog.set_actor_rotation(unreal.Rotator(0.0, heading, 0.0), False)
                ctrl = dog.get_controller()
                if ctrl is not None:
                    ctrl.set_control_rotation(unreal.Rotator(0.0, heading, 0.0))
                dog.add_movement_input(unreal.Vector(dx / d, dy / d, 0.0), 1.0, True)
            except Exception as err:                                  # noqa: BLE001
                row["error"] = "movement input failed: %s" % str(err)[:80]
                break
            yield TICK
            elapsed += TICK
        row["travelled_m"] = round(travelled / 100.0, 1)
        row["waypoints_reached"] = wp
        row["fraction_of_route"] = round(wp / float(len(pts)), 3)
        row["seconds"] = round(elapsed, 1)
        row["arrived"] = wp >= len(pts)
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%s_end.png" % nation.lower()))
        except Exception:                                             # noqa: BLE001
            pass
        emit("W_%s" % nation, "PASS" if row["arrived"] else "FAIL", nation,
             {"travelled_m": row.get("travelled_m"), "route_m": row["route_m"],
              "waypoints": "%s/%s" % (row.get("waypoints_reached"), len(pts)), "seconds": row["seconds"],
              "stuck": row["stuck_at"], "error": row.get("error")})

    walked = {n: r.get("arrived", False) for n, r in nations.items()}
    # THE HARNESS IS PROVEN BY ANY ONE NATION. If the Dog drove cleanly somewhere, the actuator works, and
    # a nation where it did not drive is a fact about that place rather than about this job.
    any_driven = any(r.get("input_reaching_character") for r in nations.values())
    blocked = [n for n, r in nations.items() if r.get("blocked_at_start")]
    record("W0A", "the harness can actually drive the Dog -- these are walks, not stationary readings",
           any_driven and len(nations) == 3,
           harness_proven_by=[n for n, r in nations.items() if r.get("input_reaching_character")],
           blocked_at_start=blocked,
           start_clearance={n: r.get("start_clearance") for n, r in nations.items()
                            if r.get("start_clearance")},
           moved_uu={n: r.get("probe_moved_uu") for n, r in nations.items()},
           dog_state={n: r.get("dog_state") for n, r in nations.items()},
           peak_speed={n: r.get("probe_peak_speed") for n, r in nations.items()},
           note="3 s of AddMovementInput toward the second waypoint before the route is judged. PEAK SPEED "
                "separates the cases and displacement alone cannot: full walk speed with no advance is "
                "BLOCKED GEOMETRY and is a finding about that place, while a peak near zero is the harness "
                "and withholds the route. The harness counts as proven by any one nation driving.")
    # ---- DOES THIS INSTRUMENT REPEAT AT ALL? The question that precedes every other one here.
    #
    # Across four runs in one session this job measured ICARUS at 230, 0, 35.2 and 86.0 uu/s on the same
    # route. Those are not properties of the ground. Every cause proposed from a single run -- blocked at
    # the start, the world going away, the Dog falling -- was built on one draw of a distribution nobody
    # had checked was one, and each died to the next run rather than to an argument.
    #
    # SO THE JOB REMEMBERS. Each run appends its peak speeds to a small history beside the results and the
    # gate measures the spread across every run recorded. It is red now and it CAN go green: when repeated
    # runs agree to within a tolerance, a single reading means something for the first time. A gate that
    # could never pass would just be noise nobody reads, which is the failure I spent today building
    # against elsewhere.
    HIST = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "walk_history.json")
    try:
        with open(HIST, "r", encoding="utf-8") as fh:
            history = json.load(fh)
    except Exception:                                                 # noqa: BLE001
        history = []
    history.append({"run": RESULT.get("name"),
                    "peaks": {n: r.get("probe_peak_speed") for n, r in nations.items()}})
    history = history[-12:]
    try:
        os.makedirs(os.path.dirname(HIST), exist_ok=True)
        with open(HIST, "w", encoding="utf-8") as fh:
            json.dump(history, fh, indent=1)
    except Exception:                                                 # noqa: BLE001
        pass

    spreads = {}
    for n in nations:
        vals = [h["peaks"].get(n) for h in history if isinstance(h.get("peaks"), dict)]
        vals = [v for v in vals if isinstance(v, (int, float))]
        spreads[n] = round(max(vals) - min(vals), 1) if len(vals) > 1 else None
    known = [v for v in spreads.values() if v is not None]
    record("W0C", "this harness repeats -- the same route measured across runs gives the same answer",
           bool(known) and max(known) <= 40.0,
           peak_spread_across_runs=spreads, runs_recorded=len(history), tolerance=40.0,
           note="four runs in one session measured ICARUS at 230, 0, 35.2 and 86.0 on the same route -- a "
                "spread equal to the character's entire walk speed. No route can be called walkable or "
                "blocked by an instrument that answers differently each time it is asked, so until this is "
                "green no single reading below is a fact about the ground. One run gives no spread and "
                "leaves this red rather than passing on an empty set")

    # WAS IT THE WORLD OR THE DOG. Three nations stopping between 4.5 and 19.4 m of a 485 m route is one
    # finding if PIE died three times and a completely different one if the Dog fell out of the world three
    # times. This gate refuses to let those share a row.
    gone = {n: r.get("gone") for n, r in nations.items() if r.get("gone")}
    fell = [n for n, r in nations.items() if r.get("fell")]
    # THIS GATE PASSED GREEN WHILE THE THING IT EXISTS TO DETECT HAPPENED, on the first run that could have
    # exercised it. TARTARUS's Dog "did not survive being moved to the start cell" -- a destroyed pawn, the
    # exact subject of this gate -- but it died BEFORE the walk loop, so it never reached the alive() check
    # that fills `gone`, `gone` stayed empty, and "no walk ended because the DOG disappeared" was true only
    # because no walk started. Written today, vacuous on its first real run.
    #
    # A pawn that dies at PLACEMENT is the same finding as one that dies at waypoint three: the Dog could not
    # survive being where the route says to be. And a gate with nothing to judge must not report success --
    # it has to say it had nothing to judge.
    died_placing = [n for n, r in nations.items()
                    if r.get("error") and "did not survive" in str(r.get("error"))]
    walked = [n for n, r in nations.items() if r.get("probe_moved_uu") is not None]
    record("W0B", "no walk ended because the DOG disappeared -- a pawn destroyed part-way along an avenue, or "
                  "on being placed at its start, is a streaming finding about that avenue not a harness failure",
           bool(walked) and not died_placing and not any(v == "pawn" for v in gone.values()),
           died_on_placement=died_placing, nations_that_got_a_pawn=walked,
           vacuous_if_empty=("NOTHING TO JUDGE: no nation produced a walk, so this gate is not evidence"
                             if not walked else None),
           gone=gone, fell_out_of_the_world=fell,
           last_z={n: r.get("last_z") for n, r in nations.items() if r.get("last_z") is not None},
           below_floor_uu={n: r.get("below_floor_uu") for n, r in nations.items()
                           if r.get("below_floor_uu") is not None},
           note="alive() collapses 'the world ended' and 'the Dog was destroyed' into one None, and the "
                "message used to blame the world for both. A torn-down PIE says nothing about the route; a "
                "Dog destroyed 5 m into a 485 m avenue is the route. last_z against the leg's own floor is "
                "the discriminator -- far below means it fell through unstreamed ground")

    record("W00", "every nation's walk started with the Dog standing at the gate end of its route",
           all("error" not in r or r.get("arrived") for r in nations.values()) and len(nations) == 3,
           starts={n: r.get("start_error_m") for n, r in nations.items()},
           errors={n: r.get("error") for n, r in nations.items() if r.get("error")})
    record("W01", "the Dog walked gate to band in every nation under its own locomotion",
           all(walked.values()) and len(walked) == 3, arrived=walked,
           travelled_m={n: r.get("travelled_m") for n, r in nations.items()},
           waypoints={n: "%s" % r.get("waypoints_reached") for n, r in nations.items()},
           route_m={n: r.get("route_m") for n, r in nations.items()},
           stuck={n: r.get("stuck_at") for n, r in nations.items() if r.get("stuck_at")},
           note="AddMovementInput every tick with bForce, no teleports after the start, no navmesh; a stuck "
                "Dog stays stuck and the job records what was in front of it")
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
