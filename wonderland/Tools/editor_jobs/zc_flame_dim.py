# HOW FAR DO THE FLAMES HAVE TO COME DOWN BEFORE THE MASCOT UNDER THEM CAN BE SEEN?
#
# FOUNDER, 2026-09-27, second pass: "The current mascot flames are still somewhat too intense/excessive. DIM
# THEM DOWN. Do NOT remove them. Do NOT redesign them. Do NOT destroy the approved ghostfire quality." And the
# acceptance list is not about the fire at all -- it is about everything the fire is currently standing on top
# of: the body readable, the eyes readable, the skull and chest details readable, the flame colour still
# visible, the silhouette not overwhelmed, bloom not swallowing what is next to the figure, the C.A.R.D still
# readable, and the flames still feeling supernatural.
#
# THE ARITHMETIC SAYS THE FIRST DIM COULD NOT POSSIBLY HAVE BEEN ENOUGH, which is why this is a sweep and not
# another guess. Skeleton Flame's ghost embers are authored at 2,800 and 4,800. On the fire master that becomes
# sqrt(strength) * FireGain 60 * Dim, so at the current Dim of 0.40 the surface is driven to about 1,270 and
# 1,663. In this scene a material strength of 1.0 renders at luma 0.039, so white pins somewhere near 25. The
# flame is running fifty to sixty-six times past clipping. At the old clamp floor of 0.05 it would still have
# been six times past it.
#
# A SURFACE SIXTY TIMES OVER WHITE IS NOT A BRIGHT FLAME, IT IS A WHITE SHAPE -- and every single thing the
# founder reported is what that looks like. The eyes cannot clear a face that is already pinned. The chest
# skull cannot read as cyan when it is pinned. The silhouette cannot be seen when the fire around it and the
# body behind it are the same white. Bloom eats the neighbourhood because bloom is fed by what is over the
# threshold, and all of it is.
#
# WHAT THIS SWEEPS, AND WHY IT IS THIS KNOB. wl.Look.FlameDim scales flame BRIGHTNESS only -- shape, flicker,
# taper, sway and falloff are untouched, so the fire keeps moving and keeps reading as fire instead of becoming
# a dimmer card. The founder was explicit that the fix must not be "make the flame smaller if brightness is
# the actual problem", and brightness is demonstrably the actual problem.
#
# AND IT IS BOUNDED FROM BELOW BY THE FOUNDER'S OWN EARLIER RULING. zc_flames_back asserts the plume above the
# shoulders reads above 0.25 luma against both a sunlit lawn and a dark plaza, from the video where the founder
# said "these are the flames I need back". That floor is carried here unchanged. The gentlest setting that
# satisfies every clause is what is wanted -- anything harsher is taking away fire that was asked for.
#
# THE C.A.R.D IS NOT PROBED HERE, deliberately. Its readability is a ceiling on flame bloom and this job only
# ever moves bloom DOWN, so a probe built on a guessed screen rectangle would add a number without adding an
# answer. zc_card_readable already photographs the card with the bright skins beside it and is re-run after.
# THE PLUME IS READ AT +100 uu, NOT +175. The ear fire on Skeleton Flame tops out at figure z 33-39, which at
# 3.24 uu a unit is 107-126 uu above the feet; at +175 the band was reading SKY above the fire, and the sweep
# of 2026-09-27 14:28 reported the plume dark (0.17-0.22) at every setting while the head under it was
# pinned white. The founder video floor of 0.25 is now measured where the fire actually is.
CONCURRENT = True

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "flame_dim")

# The two skins the founder named, and they are the only two with fire: the flame surface is built from parts
# tagged `twinkle`, which Arden Infernal and Skeleton Flame have and the rest of the lineup does not.
SKINS = (
    # skin id, which colour axis its fire burns in, and the human name for the report
    ("skeleton_flame", "blue", "ghostfire, white-cyan"),
    ("arden_infernal", "red", "ember mane, red-orange"),
)
# Current first, then progressively dimmer. 0.015 lands the ghost ember near 48 and the pale near 62 -- a
# couple of times over white rather than sixty, which is what a white-hot core with coloured edges looks like.
DIMS = (0.40, 0.16, 0.06, 0.02)
HOURS = (("day", 12.0), ("night", 22.5))
# The founder asked for front, side and back. The sweep measures front only -- the eyes and the chest skull are
# only on the front, and sweeping three angles costs three times the runtime for no extra answer -- and the
# chosen setting is then photographed from all three.
SWEEP_VIEW = 0.0
VIEWS = (("front", 0.0), ("side", 90.0), ("back", 180.0))

# Carried unchanged from zc_flames_back B01, which is the founder's own video ruling.
PLUME_FLOOR = 0.25
# A flame core SHOULD clip -- that is what white-hot looks like. A flame that is ENTIRELY clipped has no fire
# in it. Half the patch is the line between the two.
PLUME_CLIP_CEILING = 0.50
# Local contrast, same floor the rebuilt eye gate uses, so the two tables can be read side by side.
EYE_OVER_CHEEK_FLOOR = 0.05
# What the scene beside the figure is allowed to be lifted to after dark by the fire alone.
NIGHT_BLEED_CEILING = 0.35


def luma(c):
    return round(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 4)


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".png"):
            os.remove(os.path.join(ROOT, old))
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
    yield 2.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    ui = L.get_ui(world)
    if dog is None or pc is None or ui is None:
        record("D00", "there is a Dog to photograph", False)
        RESULT["status"] = "FAIL"
        return

    # TWO CAMERAS, BECAUSE ONE CANNOT SEE BOTH THINGS. zc_flames_back stood 330 uu off looking at +55
    # with a 50-degree lens and read the plume at +175: on a 16:9 frame that lens is about 29.5 degrees
    # tall, the half-height at 330 uu is 87 uu, and a point 120 uu above the look-at is off the top of the
    # picture. Every plume reading it ever made was empty, and its B00 was red for that reason alone.
    #
    # The WIDE pose stands back far enough to hold the plume and the feet in one frame; the captures are
    # taken from it. The CLOSE pose is the eye proof's own -- 300 uu, look-at +70, a 32-degree lens -- so
    # the eye and cheek patches here land on the same pixels zc_eyes_glow reads and the two tables can be
    # laid side by side. At 480 uu the head is under six per cent of the frame and a cheek patch beside
    # the eye would be reading sky.
    def aim(offset_deg, distance=480.0, height=95.0, fov=50.0):
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw + offset_deg
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * distance,
                            here.y + math.sin(math.radians(yaw)) * distance, here.z + height)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + height), fov)

    def aim_close(offset_deg):
        aim(offset_deg, 300.0, 70.0, 32.0)

    def patch(z_above, half_w, half_h, dx=0.0, colour_axis=None):
        """Read a rectangle of the frame at a height above the Dog, optionally shifted sideways ON SCREEN.

        The sideways shift is in screen fractions rather than world units on purpose: the cheek patch has to
        sit beside the eye at the SAME height whatever angle the camera is at, and a world offset rotates
        with the figure while a screen offset does not.
        """
        size = pc.get_viewport_size()
        if not size or size[0] <= 0:
            return None
        here = dog.get_actor_location()
        got = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(here.x, here.y, here.z + z_above), False)
        if got is None:
            return None
        cx, cy = float(got.x) / size[0] + dx, float(got.y) / size[1]
        if not (0.04 < cx < 0.96 and 0.04 < cy < 0.96):
            return None
        read = L.read_screen_rect(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        if read is None:
            return None
        out = {"luma": luma(read[0]), "clipped": round(float(read[2]), 4)}
        if colour_axis is not None:
            hot = L.read_screen_extremes(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
            if hot:
                out["colour"] = round(float(hot[1] if colour_axis == "blue" else hot[2]), 4)
        return out

    # ---- WHERE THE PATCHES SIT, MEASURED RATHER THAN GUESSED.
    #
    # These heights come from the skin file's own geometry, read against the height the eye proof has been
    # using successfully. Skeleton Flame's eye boxes are at figure z 19.14 and the eye proof reads them at
    # +62 uu, so the figure unit is about 3.24 uu. That conversion puts the chest skull -- soulpulse, the
    # 8,800-strength plate at figure z 13.0 to 15.6 -- at about +42 to +51 uu.
    #
    # AND IT SETTLES SOMETHING THAT HAS BEEN QUIETLY WRONG ALL DAY. The eye gate calls its reference patch at
    # +44 uu the "face". At 3.24 uu per figure unit that is figure z 13.6, which is not the face at all -- it
    # is the middle of the chest, directly on the glowing skull plate. So `eye_over_face` has been comparing
    # the eyes against an 8,800-strength glow rather than against bone, which is most of why Skeleton Flame
    # reads as having no eye separation. The cheek patch below is the honest reference: same height as the
    # eyes, one patch-width to the side, on bone.
    def measure_close(colour_axis):
        return {
            "eye": patch(62.0, 0.020, 0.012),
            "cheek": patch(62.0, 0.020, 0.012, dx=0.048),
            "chest": patch(46.0, 0.022, 0.016, colour_axis=colour_axis),
            "torso": patch(30.0, 0.026, 0.018),
            "beside": patch(46.0, 0.030, 0.030, dx=0.165),
        }

    def measure_wide(colour_axis):
        return {"plume": patch(100.0, 0.055, 0.075, colour_axis=colour_axis)}

    def row_from(m):
        row = {}
        for name, got in m.items():
            if got is None:
                continue
            row[name + "_luma"] = got["luma"]
            row[name + "_clipped"] = got["clipped"]
            if "colour" in got:
                row[name + "_colour"] = got["colour"]
        if m["eye"] is not None and m["cheek"] is not None:
            row["eye_over_cheek"] = round(m["eye"]["luma"] - m["cheek"]["luma"], 4)
        if m["torso"] is not None and m["beside"] is not None:
            row["silhouette"] = round(abs(m["torso"]["luma"] - m["beside"]["luma"]), 4)
        row["complete"] = all(v is not None for v in m.values())
        return row

    # ================================================================ STAGE ONE: THE SWEEP
    table = {}
    RESULT["by_dim"] = table
    for dim in DIMS:
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.FlameDim %.4f" % dim)
        per = {}
        table["%.3f" % dim] = per
        for skin_id, axis, _name in SKINS:
            # THE DIM IS READ WHEN THE FLAME MATERIAL IS BUILT, so the skin has to be re-worn after it moves.
            # The same trap as the glow knee: set the variable, forget the re-wear, and the sweep reports four
            # identical rows and looks like a knob that does nothing.
            ui.wear_relay_skin(skin_id)
            yield 5.0
            for hour_label, hour in HOURS:
                unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
                yield 3.5
                aim_close(SWEEP_VIEW)
                yield 1.6
                got = measure_close(axis)
                aim(SWEEP_VIEW)
                yield 1.6
                got.update(measure_wide(axis))
                row = row_from(got)
                per["%s %s" % (skin_id, hour_label)] = row
                try:
                    L.capture_game_viewport(
                        os.path.join(ROOT, "sweep_dim%.3f_%s_%s.png" % (dim, skin_id, hour_label)))
                except Exception:                                  # noqa: BLE001
                    pass
                L.release_camera(world)
                yield 0.4
        emit("D_%.3f" % dim, "INFO", "flame dim %.3f" % dim, per)

    read = [r for per in table.values() for r in per.values() if r.get("complete")]
    wanted = len(DIMS) * len(SKINS) * len(HOURS)
    record("D00", "every setting was read for both skins, day and night",
           len(read) == wanted, read=len(read), wanted=wanted,
           note="an incomplete row means a patch fell outside the frame and that setting cannot be judged.")
    if len(read) != wanted:
        RESULT["status"] = "FAIL: the sweep was not measured"
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.FlameDim 0.40")
        return

    # ---- WHICH SETTINGS SATISFY THE FOUNDER'S LIST, clause by clause and per setting rather than overall,
    # because "0.06 works" and "0.06 works except the plume goes dark at night" are different answers.
    verdicts = {}
    RESULT["clauses_by_dim"] = verdicts
    for dim in DIMS:
        key = "%.3f" % dim
        rows = table[key]
        night = [r for k, r in rows.items() if k.endswith("night")]
        clauses = {
            "flame_still_plainly_there": all(r.get("plume_luma", 0.0) > PLUME_FLOOR for r in rows.values()),
            "flame_not_a_clipped_sheet": all(
                r.get("plume_clipped", 1.0) < PLUME_CLIP_CEILING for r in rows.values()),
            "flame_colour_visible": all(r.get("plume_colour", 0.0) > 0.0 for r in rows.values()),
            "eyes_clear_the_cheek": all(
                r.get("eye_over_cheek", -1.0) > EYE_OVER_CHEEK_FLOOR for r in rows.values()),
            "chest_skull_not_pinned": all(r.get("chest_clipped", 1.0) < 0.90 for r in rows.values()),
            "chest_skull_keeps_its_colour": all(r.get("chest_colour", 0.0) > 0.0 for r in rows.values()),
            "silhouette_readable": all(r.get("silhouette", 0.0) > 0.02 for r in rows.values()),
            "bloom_not_swallowing_the_night": all(
                r.get("beside_luma", 1.0) < NIGHT_BLEED_CEILING for r in night),
        }
        clauses["all"] = all(clauses.values())
        verdicts[key] = clauses

    passing = [d for d in DIMS if verdicts["%.3f" % d]["all"]]
    RESULT["dims_passing"] = passing
    emit("D_CLAUSES", "INFO", "which clauses each setting satisfies", verdicts)

    record("D01", "the flame is still plainly there at the current setting",
           verdicts["%.3f" % DIMS[0]]["flame_still_plainly_there"],
           floor=PLUME_FLOOR, at=DIMS[0],
           note="the control. If this is red the instrument is wrong, not the fire -- 0.40 is what the "
                "founder is looking at when they call the flames too intense.")
    record("D02", "there is a setting where the fire reads as fire and the mascot under it reads as a mascot",
           len(passing) > 0, passing=passing, clauses=verdicts,
           note="the GENTLEST passing setting is wanted, not the dimmest. These skins ARE their fire and "
                "compressing past what the founder asked for takes away flame that was asked to stay.")
    if passing:
        RESULT["recommended"] = max(passing)
        emit("D_BEST", "INFO", "the gentlest setting that satisfies every clause",
             {"flame_dim": max(passing)})

    # ---- WHICH CLAUSE IS THE ONE HOLDING IT BACK, if none of them passes. Named so the next step is obvious
    # instead of being another sweep.
    if not passing:
        blocking = {}
        for name in verdicts["%.3f" % DIMS[0]]:
            if name == "all":
                continue
            blocking[name] = [d for d in DIMS if verdicts["%.3f" % d][name]]
        RESULT["which_settings_satisfy_each_clause"] = blocking
        emit("D_BLOCKING", "INFO", "settings satisfying each clause on its own", blocking)

    # ================================================================ STAGE TWO: BEFORE AND AFTER
    #
    # The founder asked for front, side and back, day and night, "compare BEFORE vs AFTER where possible", and
    # said in the same breath not to certify any of this on parameter values. So the picture pairs are the
    # deliverable and the table above is the reason a particular pair exists.
    chosen = RESULT.get("recommended") or min(DIMS)
    RESULT["compared"] = {"before": DIMS[0], "after": chosen}
    shots = []
    RESULT["captures"] = shots
    for label, dim in (("before", DIMS[0]), ("after", chosen)):
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.FlameDim %.4f" % dim)
        for skin_id, _axis, _name in SKINS:
            ui.wear_relay_skin(skin_id)
            yield 5.0
            for hour_label, hour in HOURS:
                unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
                yield 3.0
                for view_label, offset in VIEWS:
                    aim(offset)
                    yield 1.5
                    name = "%s_%s_%s_%s.png" % (label, skin_id, hour_label, view_label)
                    try:
                        L.capture_game_viewport(os.path.join(ROOT, name))
                        shots.append(name)
                    except Exception:                              # noqa: BLE001
                        pass
                    L.release_camera(world)
                    yield 0.3

    record("D03", "there is a before and an after picture from every angle the founder asked for",
           len(shots) == 2 * len(SKINS) * len(HOURS) * len(VIEWS),
           taken=len(shots), wanted=2 * len(SKINS) * len(HOURS) * len(VIEWS),
           before=DIMS[0], after=chosen, where=ROOT,
           note="front, side and back, day and night, both skins, at the current setting and the chosen one. "
                "The founder's eye is the verdict on these; the table is only how the pair was chosen.")

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.FlameDim 0.40")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
