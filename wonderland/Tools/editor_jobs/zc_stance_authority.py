# DOES EVERY SKIN STAND THE WAY RELAY OG STANDS?
#
# FOUNDER, P0 item 3: "Observe Relay OG in PIE and make every active skin copy its exact idle stance, walk,
# run, stop, turns, jump, fall, landing, body bounce, and ground contact. They still stand/walk weird: fix the
# skeleton/AnimBP/retarget/root-pose cause, not cosmetic offsets ... One canonical Relay Dog behavior stack;
# skins are cosmetic."
#
# THE PLUMBING FOR THIS ALREADY EXISTS AND NOBODY HAS CHECKED WHETHER IT ARRIVES. RelayDogCharacter builds an
# FWonderlandWornPose every frame and publishes it as LastWornPose; AWonderlandCompanionEmbodiment has
# WearCanonicalPose, a bGaitDrivenExternally flag, and joint writers for shoulder, hip, knee and head. So the
# architecture is exactly what the founder asked for. What has never been measured is whether a costume's LEGS
# end up where Relay OG's legs are.
#
# AND THE FOUNDER HAS RULED OUT THE EASY ANSWER. "Fix the cause, not cosmetic offsets" also means do not PROVE
# it from the cause: reading GetWornPose() back and finding it valid says the pose was handed over, not that
# the figure adopted it. This measures the rendered silhouette.
#
# HOW: each skin is photographed from the SIDE, paused at the same moment of the same gait, and the LOWER
# THIRD of the figure -- the legs -- is reduced to a silhouette profile: for each column, how far down the
# figure's material reaches. Two skins standing identically have the same profile. A skin whose legs are
# straight while Relay OG's are bent has a different one.
#
# THE LOWER THIRD, AND ONLY THE LOWER THIRD, because costumes differ above it BY DESIGN. Apollo has a crown,
# Arden a plume, Skeleton Flame ghostfire over the shoulders. Comparing whole silhouettes would report the
# ornament the founder approved as a stance fault. Legs carry almost no ornament on any of these skins, which
# is why they are the part that can be compared.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import hashlib
import math
import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "stance_authority")
REPO = os.path.dirname(os.path.dirname(CHANNEL))

SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
# Side-on, from a distance that puts the whole figure in frame with room under its feet.
DISTANCE = 420.0
FOV = 38.0
# NO BAND CONSTANTS ANY MORE. Two fractions of the FRAME used to say where the legs were; they said it about
# a blue and white checkered object that was not the Dog. The figure's box is now measured per capture by
# differencing against the same frame with it hidden, and the legs are the lower third OF THAT BOX.
# A column belongs to the figure when it is this far from the background. Measured against the frame's own
# corner, so it needs no assumption about what the world behind the Dog looks like.
FIGURE_DELTA = 0.10
# Two profiles agree when no column differs by more than this fraction of the leg band's height.
PROFILE_TOLERANCE = 0.12


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    sys.path.insert(0, os.path.join(REPO, "Tools"))
    from night_figure import read                                   # noqa: WPS433

    RESULT["tests"] = []
    RESULT["framing"] = {"distance_uu": DISTANCE, "fov_deg": FOV, "legs": "lower third of the MEASURED box",
                         "note": "the legs only: costumes differ above the waist by design, so a whole "
                                 "silhouette would report approved ornament as a stance fault. The box comes "
                                 "from differencing against the same frame with the figure hidden, so nothing "
                                 "here assumes where the figure landed."}

    def record(tid, name, ok, **detail):
        RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def fingerprint(path):
        try:
            with open(path, "rb") as fh:
                return hashlib.md5(fh.read()).hexdigest()
        except Exception:                                           # noqa: BLE001
            return None

    def pixels(path):
        w, h, chan, px = read(path)
        return w, h, chan, px

    def figure_box(shot, empty):
        """Where the FIGURE is on screen, found by differencing against the same frame with the Dog hidden.

        THE FIRST VERSION ASSUMED A BAND AND MEASURED SCENERY. It took rows 0.52 to 0.86 of the frame on the
        theory that a figure framed from 420 uu would have its legs there, guarded that with "is something in
        the band", and passed -- on a blue and white checkered object that was not the Dog. The contact sheet
        showed it instantly and no clause could have: "something is here" is not "the subject is here".

        Differencing removes every assumption about framing, distance, field of view and figure height. What
        changes between a frame with the Dog and the same frame without it IS the Dog, wherever it turned out
        to be, and whatever size it turned out to be.
        """
        sw, sh, sc, sp = shot
        ew, eh, ec, ep = empty
        if (sw, sh) != (ew, eh):
            return None
        lo_x, hi_x, lo_y, hi_y, hits = sw, -1, sh, -1, 0
        for y in range(0, sh, 2):
            rs, re_ = y * sw * sc, y * sw * ec
            for x in range(0, sw, 2):
                i, j = rs + x * sc, re_ + x * ec
                d = (abs(sp[i] - ep[j]) + abs(sp[i + 1] - ep[j + 1]) + abs(sp[i + 2] - ep[j + 2])) / 765.0
                if d >= FIGURE_DELTA:
                    hits += 1
                    if x < lo_x: lo_x = x
                    if x > hi_x: hi_x = x
                    if y < lo_y: lo_y = y
                    if y > hi_y: hi_y = y
        if hits < 200 or hi_x <= lo_x or hi_y <= lo_y:
            return None
        return {"box": [lo_x, lo_y, hi_x, hi_y], "changed_cells": hits,
                "width_fraction": round((hi_x - lo_x) / float(sw), 4),
                "height_fraction": round((hi_y - lo_y) / float(sh), 4)}

    def leg_profile(shot, empty, box):
        """For each column of the figure's OWN lower third, how far down it reaches.

        Every bound is a fraction of the figure's measured box, so the reading does not change if the camera
        or the figure's size does.
        """
        sw, sh, sc, sp = shot
        ew, eh, ec, ep = empty
        bx0, by0, bx1, by1 = box["box"]
        bh = max(by1 - by0, 1)
        y0 = by0 + int(bh * 0.66)
        y1 = by1
        span = max(y1 - y0, 1)
        prof, filled = [], 0
        for x in range(bx0, bx1 + 1):
            deepest = None
            for y in range(y0, y1 + 1):
                i, j = (y * sw + x) * sc, (y * ew + x) * ec
                d = (abs(sp[i] - ep[j]) + abs(sp[i + 1] - ep[j + 1]) + abs(sp[i + 2] - ep[j + 2])) / 765.0
                if d >= FIGURE_DELTA:
                    deepest = y
            if deepest is None:
                prof.append(0.0)
            else:
                prof.append(round((deepest - y0) / float(span), 4))
                filled += 1
        # ---- AND WHERE THE FEET ARE, which is the only part of this a robe cannot hide.
        #
        # THE PROFILE ALONE COMPARES COSTUME WIDTH, NOT STANCE. Run against the four costumes it returned mean
        # differences of 0.69 to 0.79 of the band and a worst column of exactly 1.0 for every one of them --
        # which is not "stands slightly differently", it is two almost unrelated shapes. The reason is that
        # 0.0 in a profile means BOTH "the figure does not reach here" and "the figure reaches the very top",
        # so a narrow-legged Relay OG against a robed Arden Infernal compares as a total mismatch. The
        # difference measured was drapery.
        #
        # FEET ARE A STANCE. Two figures standing the same put their ground contacts the same distance apart
        # and the same distance either side of centre, whatever is draped over the legs above them. So the
        # lowest row the figure reaches is the ground, the columns within a few pixels of it are the feet, and
        # what is reported is their spread and their offset -- each as a fraction of the figure's own HEIGHT,
        # because height is set by the body and width is set by ornament.
        ground = None
        for x in range(bx0, bx1 + 1):
            for y in range(y1, y0 - 1, -1):
                i, j = (y * sw + x) * sc, (y * ew + x) * ec
                d = (abs(sp[i] - ep[j]) + abs(sp[i + 1] - ep[j + 1]) + abs(sp[i + 2] - ep[j + 2])) / 765.0
                if d >= FIGURE_DELTA:
                    if ground is None or y > ground:
                        ground = y
                    break
        feet = []
        if ground is not None:
            near = max(int((by1 - by0) * 0.04), 2)
            for x in range(bx0, bx1 + 1):
                for y in range(y1, max(ground - near, y0) - 1, -1):
                    i, j = (y * sw + x) * sc, (y * ew + x) * ec
                    d = (abs(sp[i] - ep[j]) + abs(sp[i + 1] - ep[j + 1]) + abs(sp[i + 2] - ep[j + 2])) / 765.0
                    if d >= FIGURE_DELTA:
                        feet.append(x)
                        break
        stance = None
        if len(feet) >= 2:
            bh_all = max(by1 - by0, 1)
            centre = (bx0 + bx1) * 0.5
            stance = {
                "ground_row": ground,
                "foot_columns": len(feet),
                # spread and offset in units of the figure's own height, so a bigger figure reads the same
                "spread_over_height": round((max(feet) - min(feet)) / float(bh_all), 4),
                "centre_offset_over_height": round(((min(feet) + max(feet)) * 0.5 - centre) / float(bh_all), 4),
            }
        return {"columns": len(prof), "filled": filled, "rows": [y0, y1], "profile": prof,
                "stance": stance,
                "usable": filled >= max(len(prof) * 0.25, 8) and stance is not None}

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0

    # The clock is stopped so the light cannot move between skins: a shadow that shifts changes the silhouette
    # as surely as a leg does. See Tools/editor_jobs/README.md.
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")
    yield 1.0
    try:
        frozen = float(unreal.SystemLibrary.get_console_variable_float_value("wl.Sky.DayMinutes"))
    except Exception:                                               # noqa: BLE001
        frozen = None
    record("T_CLOCK", "the day clock is stopped so the light is the same for every skin",
           frozen is not None and abs(frozen) < 1e-3, day_minutes=frozen)
    if frozen is None or abs(frozen) >= 1e-3:
        RESULT["status"] = "VOID: the light would move between skins"
        return

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if dog is None or ui is None:
        RESULT["status"] = "VOID: no pawn or no UI subsystem"
        return

    def look_side():
        """Side-on at the figure's middle, from its own left, so the legs are seen in profile."""
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw + 90.0
        mid = here.z + 60.0
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * DISTANCE,
                            here.y + math.sin(math.radians(yaw)) * DISTANCE, mid + 20.0)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, mid), FOV)

    readings = {}
    RESULT["readings"] = readings
    for skin in SKINS:
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:140]
            continue
        # THE FIGURE HAS TO BE BUILT AND THE GAIT HAS TO HAVE SETTLED. A costume is rebuilt on wear and its
        # joints are written on the following ticks, so a capture taken too early photographs the rest pose --
        # which would make every skin agree with every other and pass this job for the wrong reason.
        yield 7.0
        live = ues.get_game_world()
        if live is None or unreal.GameplayStatics.get_player_pawn(live, 0) is None:
            record("T_DEAD_%s" % skin, "the world was alive for this reading", False)
            continue
        look_side()
        yield 1.5
        # PAUSED, so every skin is photographed at the same moment of the same idle cycle. Without this the
        # comparison is between two different instants of a breathing figure.
        unreal.GameplayStatics.set_game_paused(live, True)
        yield 0.3
        name = "stance_%s.png" % skin
        path = os.path.join(ROOT, name)
        empty_name = "stance_%s_nofigure.png" % skin
        empty_path = os.path.join(ROOT, empty_name)
        try:
            shot = L.capture_game_viewport(path)
            if not shot:
                raise RuntimeError("capture_game_viewport returned falsy: the editor is probably not foreground")
            RESULT.setdefault("capture_hashes", {})[name] = fingerprint(path)

            # ---- AND THE SAME FRAME WITH THE FIGURE HIDDEN, which is what makes the reading attributable.
            #
            # The camera does not move between these two. Everything that differs between them is the Dog and
            # its costume, so the figure's position and size on screen are MEASURED rather than assumed -- and
            # the first version of this job assumed, and profiled a blue and white checkered object that was
            # not the Dog.
            hidden = []
            for actor in unreal.GameplayStatics.get_all_actors_of_class(live, unreal.Actor):
                if actor == dog or actor.get_attach_parent_actor() == dog:
                    actor.set_actor_hidden_in_game(True)
                    hidden.append(actor)
            yield 0.4
            got_empty = L.capture_game_viewport(empty_path)
            for actor in hidden:
                try:
                    actor.set_actor_hidden_in_game(False)
                except Exception:                                   # noqa: BLE001
                    pass
            if not got_empty:
                raise RuntimeError("the control capture returned falsy")
            RESULT.setdefault("capture_hashes", {})[empty_name] = fingerprint(empty_path)

            shot_px, empty_px = pixels(path), pixels(empty_path)
            box = figure_box(shot_px, empty_px)
            RESULT.setdefault("figure_box", {})[skin] = box
            if box is None:
                readings[skin] = None
                record("T_SEEN_%s" % skin, "the figure was visible in the frame", False,
                       note="nothing changed between the frame and the same frame with the Dog hidden, so "
                            "either the camera is not looking at the Dog or the Dog did not hide. Either way "
                            "there is nothing here to measure and a band would have measured the world.")
            else:
                readings[skin] = leg_profile(shot_px, empty_px, box)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:160]
        unreal.GameplayStatics.set_game_paused(live, False)
        L.release_camera(live)
        yield 0.3
        emit("T_%s" % skin, "INFO", skin,
             {k: v for k, v in (readings.get(skin) or {}).items() if k != "profile"})

    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass

    RESULT["captures_dir"] = ROOT
    # THE FIGURE FRAMES ONLY. This clause counted the control captures too and failed, correctly reporting a
    # duplicate -- but the duplicate was two CONTROL frames of the same world from the same camera with the
    # figure hidden, which SHOULD be identical and says nothing about whether the costume restaged. A clause
    # that fails on its own control is as useless as one that passes on nothing.
    prints = [v for k, v in (RESULT.get("capture_hashes") or {}).items()
              if v and not k.endswith("_nofigure.png")]
    record("T00", "each skin is a different picture",
           len(prints) == len(SKINS) and len(set(prints)) == len(prints),
           figure_frames=len(prints), distinct=len(set(prints)),
           controls_excluded=True,
           note="five skins photographed from one camera is exactly the shape that yields identical frames if "
                "the costume did not restage, and identical frames would pass a stance comparison perfectly.")

    usable = [s for s in SKINS if (readings.get(s) or {}).get("usable")]
    record("T01", "the figure was found on screen for every skin, and its legs measured",
           len(usable) == len(SKINS), usable=sorted(usable),
           figure_box={s: (RESULT.get("figure_box") or {}).get(s) for s in SKINS},
           filled={s: (readings.get(s) or {}).get("filled") for s in SKINS},
           note="an empty profile compares equal to another empty profile, so a job that cannot see the "
                "figure would report perfect agreement between two pictures of nothing. The box is found by "
                "differencing against the same frame with the Dog hidden, so this cannot pass on scenery.")

    # ---- AND NO TWO SKINS MAY PROFILE IDENTICALLY, which is the tell I saw and did not follow.
    #
    # The first run returned worst_column 0.3587 for Celestial Light and 0.3587 for Skeleton Flame -- equal to
    # four decimals, across two costumes with different legs. That cannot happen if the profiles are of the
    # costumes; it happens when they are of the same piece of scenery. I noticed the coincidence, called it
    # suspicious, and went on to report the comparison anyway.
    #
    # Costumes differ in the legs by a little even when their STANCE matches, so identical profiles mean the
    # measurement is not of the costume. This is the distinct-captures guard applied to the REGION rather than
    # to the frame, which is where it was needed.
    sigs = {s: tuple((readings.get(s) or {}).get("profile") or []) for s in SKINS}
    twins = sorted({"%s==%s" % (a, b) for i, a in enumerate(SKINS) for b in SKINS[i + 1:]
                    if sigs.get(a) and sigs[a] == sigs.get(b)})
    record("T01b", "no two skins produced the identical profile",
           not twins, identical_pairs=twins or None,
           note="two different costumes cannot have byte-identical leg profiles. If they do, the profile is "
                "of something that is not the costume.")
    if twins:
        RESULT["status"] = "VOID: two skins profiled identically, so the profile is not of the costume"
        return
    if len(usable) < len(SKINS):
        RESULT["status"] = "VOID: at least one skin's legs were not in the band, so no comparison is valid"
        return

    # ---- RELAY OG IS THE AUTHORITY, so every other skin is compared to IT and not to an average.
    # ---- RESAMPLED TO A COMMON LENGTH, because every figure's box is a different width.
    #
    # The first run of the differencing version compared raw column lists and returned null for all four
    # skins: Relay OG's box is 684 pixels wide and Celestial Light's is 900, so the lists could not be zipped.
    # The comparison silently became "no comparison", and the clause below reported all four skins as
    # standing differently on the strength of four nulls.
    #
    # THE CENTRAL HALF OF THE BOX, then resampled. A box's WIDTH is set by ornament -- Celestial Light's wings
    # make it half again as wide as Relay OG's -- so normalising across the whole box would squeeze one
    # figure's legs against another's. The legs sit near the centre on every one of these skins.
    SAMPLES = 64

    def resampled(reading):
        prof = (reading or {}).get("profile") or []
        if len(prof) < 8:
            return None
        lo = int(len(prof) * 0.25)
        hi = int(len(prof) * 0.75)
        core = prof[lo:hi]
        if len(core) < 8:
            return None
        out = []
        for k in range(SAMPLES):
            idx = int(k * (len(core) - 1) / float(SAMPLES - 1))
            out.append(core[idx])
        return out

    base = resampled(readings.get("relay_og"))
    base_stance = (readings.get("relay_og") or {}).get("stance")
    RESULT["resampled_to"] = SAMPLES
    RESULT["stance"] = {s: (readings.get(s) or {}).get("stance") for s in SKINS}
    diffs = {}
    for skin in SKINS:
        if skin == "relay_og":
            continue
        other = resampled(readings.get(skin))
        mine = (readings.get(skin) or {}).get("stance")
        if base is None or other is None or base_stance is None or mine is None:
            diffs[skin] = None
            continue
        row = {
            # THE VERDICT TURNS ON THESE TWO. Both are in units of the figure's own height.
            "spread_delta": round(abs(mine["spread_over_height"] - base_stance["spread_over_height"]), 4),
            "offset_delta": round(abs(mine["centre_offset_over_height"]
                                      - base_stance["centre_offset_over_height"]), 4),
            # and the silhouette difference, REPORTED and not judged: it is mostly drapery.
            "silhouette_worst_column": round(max(abs(a - b) for a, b in zip(base, other)), 4),
            "silhouette_mean_column": round(sum(abs(a - b) for a, b in zip(base, other)) / float(len(base)), 4),
        }
        diffs[skin] = row
    RESULT["vs_relay_og"] = diffs
    # A COMPARISON THAT COULD NOT BE MADE IS NOT A DIFFERENCE. The previous run folded "null" into the same
    # list as "differs", so four failed comparisons were reported as four skins standing wrongly -- which is
    # the founder being told a defect exists on the strength of an instrument that produced nothing.
    uncompared = sorted(k for k, v in diffs.items() if v is None)
    off = sorted(k for k, v in diffs.items() if v is not None
                 and (v["spread_delta"] > PROFILE_TOLERANCE or v["offset_delta"] > PROFILE_TOLERANCE))
    RESULT["skins_that_stand_differently"] = off or None
    RESULT["skins_not_compared"] = uncompared or None
    if uncompared:
        record("T02", "every skin's legs sit where Relay OG's legs sit", False,
               vs_relay_og=diffs, could_not_compare=uncompared,
               note="VOID rather than a verdict: these skins produced no comparable profile, and reporting "
                    "that as 'stands differently' would hand the founder a defect that has not been measured.")
        RESULT["status"] = "VOID: at least one skin could not be compared"
        return
    record("T02", "every skin's legs sit where Relay OG's legs sit",
           not off, vs_relay_og=diffs, tolerance=PROFILE_TOLERANCE, differing=off or None,
           stance=RESULT.get("stance"),
           note="the founder's item 3 is that one canonical behaviour stack drives every skin and the skins "
                "are cosmetic. The plumbing exists -- the Dog publishes a worn pose and the costume has joint "
                "writers for it -- and this is the first reading of whether it ARRIVES. Judged on where the "
                "FEET land, in units of the figure's own height, because a robe hides the legs and not the "
                "ground contact; the silhouette difference is reported beside it and is mostly drapery. "
                "Measured on the render rather than by reading the pose back, because the founder ruled out "
                "proving a stance from the value that was handed over.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
