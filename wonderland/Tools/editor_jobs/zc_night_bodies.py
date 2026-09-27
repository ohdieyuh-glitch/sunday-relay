# CAN YOU SEE THE MASCOT AT NIGHT, OR ONLY ITS EYES?
#
# FOUNDER, 2026-09-27, NIGHTTIME LIGHTING CORRECTION, section D: "Do not compensate for bad world lighting by
# blowing out mascot emissives. All mascot eyes still need their intended visible glow, but the environment
# itself must provide enough illumination for the BODY to remain readable ... Characters should look like
# illuminated subjects standing in a nighttime world -- not glowing objects floating in blackness."
#
# Those are two requirements pulling opposite ways, and a single frame luma cannot tell them apart: a figure
# that is one blazing eye in a black void and a figure standing in readable moonlight can average to the same
# number. So this measures them SEPARATELY, on the same frame, at deepest night:
#
#   THE BODY      every pixel of the figure that is NOT one of its own lights. If most of it is crushed to
#                 black the character is not readable, whatever the eyes are doing.
#   THE LIGHTS    the brightest cells, which is where the eyes and any ghostfire are. Reported so that
#                 "the body got brighter" can never be satisfied by the eyes getting brighter.
#   THE GROUND    a band under the figure's feet, because the founder's complaint is equally that the
#                 ground beside a character goes unreadable.
#
# WHAT THIS JOB IS NOT. It does not change any lighting, world or mascot. It is the figure-side reading the
# world lane asked for -- a number that is not an emissive -- so that a night lighting decision can be made
# against "is the character lit" rather than against "is the character visible", which a lamp for a face is
# not. The verdict on the founder's requirement is their screenshots against these captures, not the clauses.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import io
import json
import math
import os
import sys
import time
import unreal

L = unreal.WonderlandUiTestLibrary

# ---- EVERY RUN GETS ITS OWN FOLDER, BECAUSE THE LAST ONE DESTROYED ITS PREDECESSOR IN SILENCE.
#
# This job wrote night_body_<skin>_<hour>.png into one directory, so the second run overwrote the first. I
# found it by measuring what I believed was the morning's photograph and getting the afternoon's numbers: I
# had a before and an after, and the after had eaten the before while I was still quoting it.
#
# THE RESULT FILE SURVIVES AND THE PICTURE DOES NOT, which is the worse half. The founder's standard is that
# the rendered result is the acceptance test, and a before/after the founder can look at is the deliverable.
# JSON numbers with no surviving image behind them are the thing this project keeps promising not to produce.
#
# So captures land under a per-run folder named from the job's own name and the clock, and `latest` is a plain
# copy rather than a link so a reader with no symlink support still finds the newest.
RUN_TAG = "%s_%s" % (__name__, time.strftime("%H%M%S"))
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "night_bodies", RUN_TAG)
# CHANNEL is <repo>/wonderland/Tools/_channel, so the repo's wonderland root is two levels up.
REPO = os.path.dirname(os.path.dirname(CHANNEL))
SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
# Deepest night first, because that is the founder's complaint; noon as each figure's own control, because a
# body reading is only meaningful against what the same body does in daylight.
# THREE HOURS, NOT TWO, AND THE THIRD IS THE ONE NOBODY LOOKED AT.
#
# The world lane laddered twilight and found the world is DARKER AT SIX IN THE EVENING THAN AT FULL NIGHT:
# 18:00 luma about a third of 19:00's, ground at 0.009, recovering an hour later. At 18:00 the sun's elevation
# is exactly zero, so the daylight curve has fallen to 0.2 while the nightfall curve is still exactly 0 -- the
# day rig has left and the night rig has not arrived, which means no moon, no shadow lift, no local exposure
# and only part of the exposure bias. A two-rung trough between two working configurations.
#
# This job sampled 23.6 and 12.0, so its 97-per-cent-crushed reading is NOT confounded by that trough, which
# was the first thing worth checking. But it also means the instrument cannot see the worst moment of the day
# for the very thing it measures, and the founder's section G asks for the whole transition verified. Two
# points of a curve is the same error as one draw from an unchecked distribution.
HOURS = (("night", 23.6), ("dusk", 18.0), ("noon", 12.0))
STEP = 2
# A surface at or under this is crushed: no usable form or material information left in it. 0.14 of full white
# is the same floor the world lane's night sweep uses, so the two lanes' "dark" mean the same thing.
DARK = 0.14 * 255.0
# At or over this a cell has lost its surface upward rather than downward: no form information left in it
# either. A luminous skin is allowed to be bright; it is not allowed to be a flat white cut-out.
BLOWN = 0.97 * 255.0
# At or over this a cell is one of the figure's own lights rather than its body.
LIGHT = 0.72 * 255.0



# THE MEASUREMENT LIVES IN Tools/night_figure.py NOW, because it has two callers: this job photographs five
# skins at one place and zc_night_bodies_world photographs the one skin with no glow geometry at five
# districts. Three copies of one sentence went stale together in three files today; two copies of a
# threshold would drift apart silently and both would keep publishing numbers. Verified identical on all
# thirteen keys against this job's own inline version before the inline version was removed.
sys.path.insert(0, os.path.dirname(CHANNEL))
from night_figure import figure_stats                              # noqa: E402,WPS433


def job():
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

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
    L.focus_game_viewport()
    yield 8.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if dog is None or ui is None:
        RESULT["status"] = "FAIL: no Dog"
        return

    # ---- THE WORLD'S EXPOSURE, RECORDED AND NOT TOUCHED. If a later run of this job disagrees with this one,
    # ---- the first question is whether somebody moved the exposure between them.
    pinned = []
    RESULT["exposure"] = pinned
    try:
        for vol in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.PostProcessVolume):
            s = vol.settings
            pinned.append({"volume": vol.get_actor_label(),
                           "min_ev100": float(s.get_editor_property("auto_exposure_min_brightness")),
                           "max_ev100": float(s.get_editor_property("auto_exposure_max_brightness")),
                           "bias": float(s.get_editor_property("auto_exposure_bias"))})
    except Exception as err:                                        # noqa: BLE001
        RESULT["exposure_error"] = str(err)[:160]

    # A WHOLE FIGURE, FROM A PLAYER'S DISTANCE. Not a face close-up: the founder's sentence is about the BODY
    # standing in the world, so the shot has to contain the body, its feet and the ground they are on.
    def stand_off(distance=520.0, height=110.0, fov=45.0):
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * distance,
                            here.y + math.sin(math.radians(yaw)) * distance, here.z + height)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + 60.0), fov)

    # ---- WHERE THE FIGURE WAS STANDING, AND HOW FAR THE NEAREST LAMP WAS.
    #
    # THIS READING WAS UNATTRIBUTABLE AND I DID NOT NOTICE FOR A WHOLE RUN. The camera is posed relative to
    # the dog, the dog stands wherever it spawned, and the result recorded neither. So "the body is 97 per
    # cent black at night" was a true sentence about an unknown place. A figure two metres from a street lamp
    # and a figure in an unlit field are the same measurement with opposite meanings, and the founder's
    # requirement -- readable from any major path -- is about the second one.
    #
    # The distance to the nearest practical is read from the same manifest the lights subsystem loads, so a
    # good reading cannot silently be a reading taken under a lamp.
    def nearest_practical(at):
        try:
            spec = json.load(io.open(os.path.join(REPO, "WorldDesign", "Look", "practical_lights.json"),
                                     encoding="utf-8"))
        except Exception as err:                                    # noqa: BLE001
            return {"error": str(err)[:120]}
        best = None
        count = 0
        for row in (spec if isinstance(spec, list) else spec.get("lights", [])):
            try:
                x, y, z = float(row["x"]), float(row["y"]), float(row["z"])
            except Exception:                                       # noqa: BLE001
                continue
            count += 1
            d = math.sqrt((x - at.x) ** 2 + (y - at.y) ** 2 + (z - at.z) ** 2)
            if best is None or d < best:
                best = d
        return {"lights_in_manifest": count,
                "nearest_uu": round(best, 1) if best is not None else None,
                "nearest_m": round(best / 100.0, 1) if best is not None else None}

    where = dog.get_actor_location()
    RESULT["stood_at"] = {"x": round(where.x, 1), "y": round(where.y, 1), "z": round(where.z, 1),
                          "practicals": nearest_practical(where),
                          "note": "the reading below describes THIS place. A body that reads well within a "
                                  "lamp's radius has not shown that the world lights bodies."}

    # the figure's share of the frame at that framing, measured once rather than assumed
    BOX = (0.40, 0.22, 0.60, 0.82)
    RESULT["framing"] = {"distance_uu": 520.0, "fov": 45.0, "figure_box_fraction": BOX,
                         "note": "body cells are everything in the box under the light threshold; the ground "
                                 "band is the strip immediately below it"}

    readings = {}
    RESULT["readings"] = readings
    shots = []
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        for label, hour in HOURS:
            unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
            # AND THE PRACTICAL POOL REBUILT, because BuildPool runs only from Reload and OnWorldBeginPlay.
            # Setting wl.Look.PracticalCount alone leaves the pool at its previous size while the cvar reads
            # back correctly -- a knob that reports success and does nothing, which is the same trap as a
            # cvar that is not recognised at all, wearing a readback that passes.
            unreal.SystemLibrary.execute_console_command(world, "wl.Look.PracticalReload")
            yield 4.0
            # A DEAD WORLD READS AS DATA. Re-acquire and assert rather than trusting the handle from before
            # the hour change; a torn-down PIE returns black frames that pass for a night measurement.
            live = ues.get_game_world()
            pawn = unreal.GameplayStatics.get_player_pawn(live, 0) if live is not None else None
            if live is None or pawn is None:
                record("B_DEAD_%s_%s" % (skin, label), "the world was alive for this reading", False,
                       skin=skin, hour=label)
                continue
            stand_off()
            yield 1.5
            unreal.GameplayStatics.set_game_paused(live, True)
            yield 0.3
            name = "night_body_%s_%s.png" % (skin, label)
            path = os.path.join(ROOT, name)
            try:
                L.capture_game_viewport(path)
                shots.append(name)
                readings["%s/%s" % (skin, label)] = figure_stats(path, BOX)
            except Exception as err:                                # noqa: BLE001
                RESULT.setdefault("errors", {})["%s/%s" % (skin, label)] = str(err)[:140]
            unreal.GameplayStatics.set_game_paused(live, False)
            L.release_camera(live)
            yield 0.3
        emit("B_%s" % skin, "INFO", "%s body at night and noon" % skin,
             {k: v for k, v in readings.items() if k.startswith(skin + "/")})

    # ---- THE CONTROL: THE SAME GROUND WITH NOBODY STANDING ON IT.
    #
    # THE LATERAL BAND IS NOT A CLEAN WORLD READING AND THE NUMBERS SAID SO BEFORE I DID. At deepest night the
    # beside-band's dark fraction came back 0.032 for Celestial Light and 0.680 for Apollo -- a twentyfold
    # difference in how dark the world is, at one place, at one hour, with only the costume changed. The world
    # does not vary by costume. The figure's own light is spilling into the band meant to measure the world,
    # and the two luminous skins spill most: Celestial Light has the brightest body of the five at night and
    # almost no light concentrated in its eyes, which is precisely the shape that lights its own surroundings.
    #
    # At dusk all five agree to within 0.024 and at noon to within 0.054, so the contamination is invisible
    # except at the one hour the whole job exists to measure.
    #
    # So the figure is HIDDEN and the same frame taken again. That band is the world, with nothing of the
    # mascot in it, and the difference between it and each skin's band is the spill -- which is a number worth
    # having on its own, because a mascot that lights the ground it stands on is not a mascot floating in
    # blackness, whatever its body reads.
    RESULT["world_control"] = {}
    for label, hour in HOURS:
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.PracticalReload")
        yield 4.0
        live = ues.get_game_world()
        if live is None or unreal.GameplayStatics.get_player_pawn(live, 0) is None:
            RESULT["world_control"][label] = {"error": "the world was not alive for the control"}
            continue
        hidden = []
        try:
            for actor in unreal.GameplayStatics.get_all_actors_of_class(live, unreal.Actor):
                # The pawn and anything parented to it: the costume is its own actor attached to the Dog.
                if actor == dog or actor.get_attach_parent_actor() == dog:
                    actor.set_actor_hidden_in_game(True)
                    hidden.append(actor)
        except Exception as err:                                    # noqa: BLE001
            RESULT["world_control"][label] = {"error": str(err)[:140]}
        stand_off()
        yield 1.5
        unreal.GameplayStatics.set_game_paused(live, True)
        yield 0.3
        name = "world_control_%s.png" % label
        path = os.path.join(ROOT, name)
        try:
            L.capture_game_viewport(path)
            shots.append(name)
            RESULT["world_control"][label] = figure_stats(path, BOX)
        except Exception as err:                                    # noqa: BLE001
            RESULT["world_control"][label] = {"error": str(err)[:140]}
        unreal.GameplayStatics.set_game_paused(live, False)
        L.release_camera(live)
        for actor in hidden:
            try:
                actor.set_actor_hidden_in_game(False)
            except Exception:                                       # noqa: BLE001
                pass
        yield 0.3
    emit("B_CONTROL", "INFO", "the same frames with no figure in them", RESULT["world_control"])

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")
    ui.wear_relay_skin("relay_og")

    night = {s: readings.get("%s/night" % s) for s in SKINS}
    noon = {s: readings.get("%s/noon" % s) for s in SKINS}
    record("B00", "every skin was photographed at deepest night and at noon",
           all(night.get(s) and noon.get(s) for s in SKINS), taken=len(shots), where=ROOT)

    # ---- THE FOUNDER'S SENTENCE, AS TWO READINGS THAT CANNOT SATISFY EACH OTHER.
    crushed = {s: (night[s] or {}).get("body_dark_fraction") for s in SKINS}
    record("B01", "at night the BODY is not mostly crushed to black",
           all(isinstance(v, float) and v <= 0.60 for v in crushed.values()),
           body_dark_fraction=crushed, floor=DARK / 255.0, ceiling=0.60,
           note="the body is every cell of the figure that is not one of its own lights. This is the reading "
                "the founder's 'illuminated subject, not a glowing object in blackness' actually asks for, "
                "and raising eye glow cannot move it.")

    lit = {s: (night[s] or {}).get("body_mean") for s in SKINS}
    record("B02", "and it carries enough light to read a surface",
           all(isinstance(v, float) and v >= 0.10 for v in lit.values()), body_mean=lit, floor=0.10)

    # JUDGED ON THE CLEAN INSTRUMENT, REPORTED FOR ALL, for the same reason B05 and B08 are. This clause
    # failed Apollo at 0.2279, Arden at 0.2538 and Skeleton Flame at 0.3151 -- which are 22, 45 and 83 per cent
    # glow geometry. A ceiling on "how much of the figure is its own light" cannot be applied to a skin that is
    # mostly its own light by design; on Relay OG, which has none, it means exactly what it says.
    glow = {s: (night[s] or {}).get("light_fraction") for s in SKINS}
    record("B03", "the figure is not merely a pair of lights in a void",
           isinstance(glow.get("relay_og"), float) and glow["relay_og"] <= 0.18,
           light_fraction=glow, judged_on="relay_og", ceiling=0.18,
           note="high here with B01 also failing is exactly the failure the founder named: eyes blazing, "
                "body gone. It is reported whether or not it passes, so the two can never be traded.")

    ground = {s: (night[s] or {}).get("ground_dark_fraction") for s in SKINS}
    # B04 NOW READS THE BAND BESIDE THE FIGURE, NOT THE ONE UNDER IT.
    #
    # Under the feet is the mascot's own contact shadow, and this clause spent a whole run reporting shadow
    # depth as world darkness -- 0.045 under Relay OG against the world lane's 0.197 on a plaza patch at the
    # same district and hour, four times apart, because their patch had nobody standing on it. A clause named
    # "is the ground readable" has to read ground that is not in shadow, or it is answering a different
    # question convincingly.
    # THE CONTROL FRAME IS THE WORLD READING. Each skin's own band is reported beside it as spill, because a
    # band measured next to a luminous figure answered twentyfold apart across costumes at one place.
    beside = {s: (night[s] or {}).get("beside_dark_fraction") for s in SKINS}
    control = (RESULT.get("world_control") or {}).get("night") or {}
    world_dark = control.get("beside_dark_fraction")
    spill = {}
    for s in SKINS:
        mine = (night[s] or {}).get("beside_mean")
        theirs = control.get("beside_mean")
        spill[s] = round(mine - theirs, 4) if (mine is not None and theirs is not None) else None
    RESULT["mascot_spill_on_ground"] = spill
    # EVERY HOUR, NOT JUST NIGHT. This clause read the night control and passed at 0.309 while the DUSK
    # control sat at 0.7891 in the same result file -- the worst hour in the day, measured, present, and not
    # looked at. A clause that judges the hour that happens to be in its variable name is a clause that will
    # miss whichever hour is actually broken.
    controls = {k: (v or {}).get("beside_dark_fraction") for k, v in (RESULT.get("world_control") or {}).items()}
    worst_hour = None
    for k, v in controls.items():
        if isinstance(v, float) and (worst_hour is None or v > controls[worst_hour]):
            worst_hour = k
    record("B04", "the ground beside the character is readable at every hour",
           bool(controls) and all(isinstance(v, float) and v <= 0.65 for v in controls.values()),
           world_beside_dark_by_hour=controls, worst_hour=worst_hour, ceiling=0.65,
           per_skin_beside_for_comparison=beside, under_feet_for_comparison=ground,
           mascot_spill_on_ground=spill,
           note="measured on the CONTROL frame, with the figure hidden, because the same band beside a figure "
                "reads 0.032 for one costume and 0.680 for another at one place and hour. The per-skin bands "
                "and the spill are reported beside it rather than gating: a mascot that lights the ground it "
                "stands on is not a mascot floating in blackness, whatever its own body reads.")

    # AND THE SHADOW ITSELF, WHICH IS NOW SEPARABLE AND HAS ITS OWN REQUIREMENT.
    #
    # The founder asked for shadows that stay deep AND readable, and that is two bounds rather than one: a
    # shadow that vanishes has flattened the contrast they said not to flatten, and one that crushes to black
    # is the hole they are complaining about. It could not be judged at all while the reading fused the shadow
    # with the surface it falls on.
    depth = {s: (night[s] or {}).get("shadow_depth") for s in SKINS}
    RESULT["shadow_depth"] = depth
    # AND A NEGATIVE DEPTH IS A READING, NOT AN ERROR. Skeleton Flame came back -0.4939 and Arden -0.0683:
    # the ground under those figures is BRIGHTER than the ground beside them, because at 83 and 45 per cent glow
    # geometry they are lighting the floor they stand on. That is the opposite of floating in blackness and it
    # should not be reported as a shadow failure. Judged on the skin that casts a shadow and nothing else.
    record("B06", "the mascot's own shadow is deep but not a hole",
           isinstance(depth.get("relay_og"), float) and 0.15 <= depth["relay_og"] <= 0.85,
           shadow_depth=depth, judged_on="relay_og", floor=0.15, ceiling=0.85,
           lights_its_own_ground={s: v for s, v in depth.items() if isinstance(v, float) and v < 0.0} or None,
           note="the fraction of the beside-ground's light that the figure's shadow removes. Under 0.15 is a "
                "mascot that does not appear to be standing on anything; over 0.85 is a black hole where its "
                "feet should be. Both are failures and one number cannot be raised to fix the other.")

    # AND WHETHER A FIGURE STILL HAS A SHAPE, which is the question the two luminous skins actually need.
    #
    # Arden Infernal builds 45 per cent of its geometry from glow materials and Skeleton Flame 83 per cent,
    # counted in relay_dog_skins.py. Skeleton Flame being a luminous ghost is the skin's identity, so asking it
    # to be DIMMER is a founder question and not something this job should assert. Asking it to still read as a
    # figure is not a founder question, and level cannot answer it: a body crushed flat to black and a body
    # blown flat to white are both formless and sit at opposite ends of every mean here.
    form = {s: (night[s] or {}).get("figure_form") for s in SKINS}
    blown = {s: (night[s] or {}).get("blown_fraction") for s in SKINS}
    RESULT["figure_form"] = form
    RESULT["blown_fraction"] = blown
    record("B07", "every figure still has a shape at night, bright or dark",
           all(isinstance(v, float) and v >= 0.06 for v in form.values())
           and all(isinstance(v, float) and v <= 0.12 for v in blown.values()),
           figure_form=form, form_floor=0.06, blown_fraction=blown, blown_ceiling=0.12,
           note="form is the standard deviation across the whole figure: surfaces differing from one another "
                "is what makes a figure read as one. This is the clause a luminous skin must pass; whether it "
                "should be luminous at all is the founder's call, not this job's.")

    fall = {}
    for s in SKINS:
        a, b = (noon[s] or {}).get("body_mean"), (night[s] or {}).get("body_mean")
        fall[s] = None if not (a and b) else round(b / a, 3)
    # THE TWO SKINS THAT FAIL THIS ARE FAILING IT BY DESIGN, and the clause says so rather than reading as a
    # bug report. Arden came back 1.360 -- brighter at night than at noon -- and it is a flame skin. A clause
    # that cannot tell a design from a defect should name the ones it cannot judge, so the reader does not
    # spend an hour looking for a lighting fault in a figure that is meant to burn.
    # ---- HOW MUCH OF EACH SKIN IS ITS OWN LIGHT, COUNTED RATHER THAN ASSUMED.
    #
    # I FIRST WROTE THIS AS A LIST OF TWO SKINS FROM MEMORY AND IT WAS WRONG. Celestial Light came back at
    # 1.132 night over noon -- brighter at night than at noon -- and I was ready to call it over-lit by the
    # night lift. Counting its geometry in relay_dog_skins.py instead: it is 72 per cent glow materials, the
    # second most luminous skin in the set. Not over-lit. Luminous, and I had guessed the list.
    #
    #   skeleton_flame   83%      celestial_light  72%      arden_infernal   45%
    #   apollo           22%      relay_og          0%
    #
    # RELAY OG IS THE ONLY CLEAN INSTRUMENT IN THE SET, and that is worth more than the list. It has NO glow
    # geometry at all, so every photon on its body came from the world. It is also the canonical mascot. Any
    # question of the form "does the world light the mascot" should be read off that row; the other four answer
    # it with their own light mixed in.
    #
    # AND THE BODY/LIGHT SPLIT DOES NOT SEPARATE THEM CLEANLY EITHER, which is why no threshold here is a fix.
    # Cells at or over 0.72 white are counted as lights and excluded from body_mean. Skeleton Flame's glow is
    # brighter than that, so its 83 per cent lands in the LIGHTS bucket and its body reads a low 0.589. Celestial
    # Light's starlight is dimmer than that, so its 72 per cent lands in the BODY bucket and reads 1.132. Same
    # design, opposite numbers, because of where each skin's glow falls relative to one constant.
    GLOW_SHARE = {"skeleton_flame": 0.83, "celestial_light": 0.72, "arden_infernal": 0.45,
                  "apollo": 0.22, "relay_og": 0.00}
    RESULT["glow_share_of_geometry"] = GLOW_SHARE
    RESULT["clean_instrument"] = {
        "skin": "relay_og",
        "why": "zero glow geometry, so its body is lit entirely by the world, and it is the canonical mascot.",
    }

    # THE RULE IS DERIVED, SO THERE IS NO EXCLUSION LIST AT ALL.
    #
    # A ratio ABOVE 1.0 means the figure is brighter at night than in daylight, which no amount of world
    # lighting can cause -- the figure is its own source, and whether that is wanted is a decision about the
    # skin rather than about the night. A ratio BETWEEN the ceiling and 1.0 is the founder's "do not solve this
    # by turning night into day", and that one is a lighting failure. So the two cases are told apart by the
    # arithmetic instead of by a list I remembered wrongly once already.
    self_lit = {s: v for s, v in fall.items() if isinstance(v, float) and v > 1.0}
    too_bright = {s: v for s, v in fall.items() if isinstance(v, float) and 0.75 < v <= 1.0}
    RESULT["self_illuminating_at_night"] = self_lit or None
    record("B05", "night still looks like night: the body is clearly darker than it is at noon",
           not too_bright,
           night_over_noon=fall, ceiling=0.75,
           night_is_too_bright=too_bright or None,
           self_illuminating_founder_call=self_lit or None,
           glow_share_of_geometry=GLOW_SHARE,
           canonical_row={"relay_og": fall.get("relay_og")},
           note="the guard against fixing this by turning night into day. Above 1.0 the figure is its own "
                "light source, which world lighting cannot cause and which is a founder question about the "
                "skin; between the ceiling and 1.0 the night is genuinely too bright. Only the second fails.")

    # ---- B08: HAS THE FIGURE BECOME A LIGHT SOURCE RELATIVE TO ITS WORLD?
    #
    # THE BOUND HERE IS DERIVED RATHER THAN CHOSEN, which is why this clause exists at all. Every other
    # threshold in this job is a judgement I made; this one falls out of the two curves.
    #
    # The eye glow itself DIMS at night: EyeGlowDay 24 to EyeGlowNight 8, a factor of three. The world at the
    # arrival dims far less -- the world lane measured noon luma 0.2685 against a flat night around 0.197,
    # about 1.36. So eye-over-world should FALL at night by roughly two, not rise. A figure whose eye-to-world
    # contrast is HIGHER at night than at noon has become more of a light source than it is in daylight, and
    # that is the founder's sentence stated as an inequality rather than as a number I picked.
    #
    # It also catches what no absolute reading in this job can. At 18:15 the eyes hold 21.1 of 24 while the
    # world reads 0.043: every absolute measure calls that figure dark, and the ratio calls it a pair of lights
    # in a void. The second description is the one the founder wrote down.
    ratio = {}
    for s in SKINS:
        n_r = (night[s] or {}).get("eye_over_world")
        d_r = (noon[s] or {}).get("eye_over_world")
        ratio[s] = {"night": n_r, "noon": d_r,
                    "night_over_noon": (round(n_r / d_r, 2) if (n_r and d_r) else None)}
    RESULT["eye_over_world"] = ratio
    # JUDGED ON THE CLEAN ROW, REPORTED FOR ALL. Relay OG has no glow geometry, so its eye-to-world ratio is
    # the only one in the set that is not partly a statement about how much light the costume brings with it.
    canon = ratio.get("relay_og", {}).get("night_over_noon")
    record("B08", "no figure is more of a light source at night than it is in daylight",
           isinstance(canon, float) and canon <= 1.0,
           eye_over_world=ratio, judged_on="relay_og", canonical_ratio=canon, ceiling=1.0,
           glow_share_of_geometry=GLOW_SHARE,
           derivation="eye glow dims 24 to 8 across the day-night crossover, a factor of three, while the "
                      "world at the arrival dims about 1.36. So this ratio should fall by roughly two at "
                      "night. A value above 1.0 means it rose instead, and the bound is the crossover's own "
                      "arithmetic rather than a threshold chosen here.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
