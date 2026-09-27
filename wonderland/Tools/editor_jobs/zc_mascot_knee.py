# THE MASCOT-SPECIFIC RESPONSE SWEEP: does shaping the response fix the mascot eye/blowout cluster?
#
# FOUNDER / QA, 2026-09-27: "zc_glow_sweep already proves the COMPANION can retain its glow without clipping
# by using a response knee ... This does NOT prove 220 is the correct mascot value. It proves the
# RESPONSE-SHAPING STRATEGY works elsewhere. Apply the principle to mascots ... Do not blindly copy the
# Companion's 220. Sweep an appropriate range against the actual mascot materials."
#
# WHAT READING THE ASSETS FIRST CHANGED ABOUT THIS EXPERIMENT. Two facts, both from 44625f33 and the code
# path, and both of which would have made a literal 220/400/700/1100/1800 sweep measure nothing:
#
#   1. THE KNEE IS INERT ON MASCOTS AT THE NEW SCALE. WonderlandTameGlow compresses only ABOVE the knee.
#      wl.Look.GlowKnee ships at 700; after the GLOW_SCALE 4000 -> 6 re-baseline the brightest emissive on
#      any skin is 48 and the brightest BODY glow is 13.2. Every knee in the old range is above every mascot
#      value, so all five would render identically. The live range at this scale is about 2 to 48, and that
#      is what is swept here -- with 700 kept as the shipped control.
#
#   2. THE KNEE CANNOT REACH THE EYES AT ALL, by construction rather than by calibration. The eye branch is
#      `Want = (Authored / Peak) * EyeGlowScale * GlowScale * HaloShare` -- normalised to unit peak, so the
#      authored strength is discarded and only the hue direction survives -- and WonderlandTameGlow is not in
#      that path (it is applied at the body/rim sites only). So "the eyes do not read as glowing" can never be
#      a knee problem. The eye axis is EyeGlowScale, and it is swept as its own axis here.
#
#   3. AND THAT AXIS HAD A CEILING NOBODY WAS MEASURING. wl.Look.EyeGlowDay ships at 18 while SetEyeGlow
#      clamped to [0.05, 12], so the daytime eye level was silently 12 and every "we raised the eye and
#      nothing happened" reading in the corpus was taken against a value that could not move. The build
#      under test raises that clamp to 30, so 18 is real for the first time. The sweep goes to 36 to
#      photograph the NEW ceiling: 30 and 36 must come back identical.
#
#   4. AND THE OBJECT ITSELF WAS WRONG, which is the finding that reframes this whole experiment. The
#      gameplay Relay Dog's eyes are the Blueprint's Mesh_head_eye wearing MI_RelayDog_Eye (parent
#      M_V2_Portal) at EmissiveStrength 540 times an EmissiveColor of PURE BLACK -- they have never emitted
#      anything. EyeGlowScale reached AWonderlandCompanionEmbodiment figures only, never the Dog the founder
#      actually looks at. So "the eyes do not glow" was never a level, a knee or a curve: it was a black
#      multiplier on a different mesh. The build under test drives the Dog's own eye panes from the same
#      day-cycle level. This sweep is now the verification of that fix, and the differential instrument is
#      the right one for it: isolation > 0 means the level reaches the eye a player SEES, which is exactly
#      the thing that has never been true.
#
# THE INSTRUMENT, AND WHY IT IS NOT THE OLD ONE. zc_eyes_glow reads an eye patch and a face patch and
# subtracts. That is defeated by exactly the skin it most needs to measure: Celestial Light's head stands
# inside its own halo, the patch saturates, and a saturated patch cannot say whether the eye is bright. This
# sweep measures DIFFERENTIALLY -- every skin and hour is captured once with the eye driven to its floor
# (0.05) and again at each level, and the eye's own contribution is the DIFFERENCE. Whatever surrounds the
# eye is in both frames and cancels. A saturated head no longer hides the answer; it just means the face term
# is large in both frames and subtracts out.
#
#   eye_gain   = eye_luma(level) - eye_luma(floor)      the eye's own added light
#   face_gain  = face_luma(level) - face_luma(floor)    what the level did to the cheek beside it
#   isolation  = eye_gain - face_gain                   the eye reaching the render AS an eye
#
# An isolation at or near zero means the level is not arriving at the rendered eye, which is the founder's
# "if its eye emission is not reaching the rendered eye correctly, a knee alone will not fix it" stated as a
# number. Hue is measured on the ADDED light (level minus floor), not on the lit pixel, so a pale face behind
# the eye cannot launder a grey eye into looking like it kept its colour.
#
# WORLD EXPOSURE IS HELD. The founder was explicit that night-world brightness is a separate requirement and
# that mixing them confounds the experiment. This job touches no sun, sky, moon, fog, exposure or practical
# light, and it asserts the post-process exposure is the same at the end as at the start (X00).
#
# AND IT PUTS EVERY CVAR BACK. The other lane's gates run behind this one on the same PIE, and a knee left at
# 8 would be read as a rebuild result. Restored: GlowKnee 700, EyeGlowDay 18, EyeGlowNight 5, FlameDim 0.40,
# NightGlow 0.20.
import math
import os

import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "mascot_knee")

#: The five active skins and the founder's three hours, spelled as zc_eyes_glow spells them so the numbers
#: sit beside the existing corpus. Dusk is the hard one: the sun is low and the exposure is still open.
#: THE EIGHT ACTIVE IDS as of 44d6ec1c. The founder ruled the three redone skins are V2 and the previous
#: designs stay in the world as V1, so `apollo` is the new design and `apollo_v1` the old one.
SKINS = globals().get("SKINS", ("relay_og", "celestial_light", "apollo_v1", "apollo",
                                "arden_infernal_v1", "arden_infernal",
                                "skeleton_flame_v1", "skeleton_flame"))
#: ONE HOUR PER RUN. The first attempt swept all three in a single PIE session and PIE was torn down 1m43s
#: in; the job then "measured" a dead world for two more minutes. Ten-minute PIE sessions on this box are not
#: reliable, so the hour is a parameter and the sweep is queued three times.
AXIS = globals().get("AXIS", "eye")          # "eye" or "knee"
HOUR = globals().get("HOUR", 12.0)
HOUR_LABEL = globals().get("HOUR_LABEL", "day")
HOURS = ((HOUR, HOUR_LABEL),)

#: The eye levels. 0.05 is SetEyeGlow's floor and is the differential baseline -- the eye as good as off.
#: 16 is ABOVE the clamp on purpose: it must come back identical to 12.
EYE_FLOOR = 0.05
#: RE-RANGED FOR THE BUILD THAT RAISES THE CLAMP 12 -> 30 AND DRIVES THE DOG'S OWN EYE PANES.
#: 0.05 is the differential baseline. 18 is the shipped EyeGlowDay, reachable for the first time in this
#: build. 30 is the new clamp. 36 is ABOVE it on purpose and must render identically to 30.
EYE_LEVELS = (0.05, 9.0, 18.0, 24.0, 30.0, 36.0)
#: SetEyeGlow's ceiling in the build under test. Was 12, which is why every "eye level" number in the
#: corpus before this build is really 12 whatever it says.
EYE_CLAMP = globals().get("EYE_CLAMP", 30.0)
EYE_ABOVE_CLAMP = 36.0

#: THE SHIPPED PAIR, sampled in addition to the swept levels and NOT the same measurement.
#:
#: The sweep pins EyeGlowDay and EyeGlowNight to the same value at every level, deliberately: that is what
#: isolates the level from the hour, because otherwise the day cycle lerps between the two by Nightfall and
#: dusk silently reads a blend. But it also means the sweep never tests what the founder actually gets. The
#: shipped configuration is a RATIO -- 18 by day, 8 at night -- so one extra reading per skin per hour is
#: taken with both left at their shipped values and the day cycle allowed to do its own interpolation.
#: That row, not any swept level, is the one that answers "does 8 at night clip, or read dim".
SHIPPED_DAY, SHIPPED_NIGHT = 24.0, 8.0
SHIPPED_LEVEL = -1.0          # the marker this row carries in the `level` column

#: The knee axis, at the scale the assets are actually authored at, with the shipped 700 as the control.
#: Body glow spans 3.3 to 13.2 across the five skins, so anything at or above 16 should be indistinguishable.
KNEES = (700.0, 64.0, 32.0, 16.0, 8.0, 4.0, 2.0)

#: The authored eye colour of each skin, read out of RelaySkins/*.wlvox at 44625f33. Hue retention is measured
#: against these rather than against whatever the renderer happens to produce, because "the established eye
#: hue is preserved" is a claim about the ART, not about the render agreeing with itself.
#: A V1 AND ITS V2 SHARE AN EYE, read from the eight .wlvox and verified identical: the eye is the Dog's
#: STATUS INDICATOR and is deliberately the same instrument on every costume, so the V1/V2 split is body art
#: only. That makes the pairs a free control -- any eye difference between apollo and apollo_v1 is the BODY
#: around the eye changing what the eye reads against, never the eye itself changing.
AUTHORED_EYE = {
    "relay_og":          (1.00, 0.72, 0.16),
    "celestial_light":   (0.62, 0.88, 1.00),
    "apollo":            (1.00, 0.86, 0.26),
    "apollo_v1":         (1.00, 0.86, 0.26),
    "arden_infernal":    (1.00, 0.58, 0.10),
    "arden_infernal_v1": (1.00, 0.58, 0.10),
    "skeleton_flame":    (0.36, 0.95, 1.00),
    "skeleton_flame_v1": (0.36, 0.95, 1.00),
}

#: The shipped defaults this job restores. Named here so the restore cannot drift from the docstring.
SHIPPED = (("wl.Look.GlowKnee", 700.0), ("wl.Look.EyeGlowDay", 24.0), ("wl.Look.EyeGlowNight", 8.0),
           ("wl.Look.FlameDim", 0.40), ("wl.Look.NightGlow", 0.20))

#: The head scan, centred on the projected head point: SCAN cells either side horizontally, SCAN_V
#: vertically. It is NOT square any more. At CELL_H 0.009 a +/-3 window reaches about 2.7% of screen height,
#: and zzM1's anchor was wrong by tens of uu -- far outside that. An eye outside the window cannot be found
#: however good the anchor becomes, so the vertical reach is doubled and the horizontal left alone, because
#: vertical is where the uncertainty is. More cells means more upward bias on the max, which is the specific
#: thing the same-level noise baseline already exists to control for.
SCAN = 3
SCAN_V = 6
CELL_W, CELL_H = 0.011, 0.009
#: A frame this dark is a camera inside the figure, not a dark world. Six of eight skins returned exactly
#: 0.0000 for eye AND face on the first real run; the premium skins are 2-3x the box count of relay_og and
#: the 300 uu camera was inside them.
BLACK_FRAME = 0.01
#: ONLY A FALLBACK NOW. This was the anchor for every patch in the job, inherited from zc_eyes_glow and
#: never verified; the eye mesh appears to sit far above it. Used only when no eye component can be found,
#: and the run records that it happened.
EYE_Z_FALLBACK = 62.0
#: And a costume is not the Dog. Costume figures are built to TARGET_METRES 1.55 against the canon Dog's
#: 1.74, putting their eyes roughly forty uu lower.
EYE_Z_COSTUME = 21.0
#: How far a floor->clamp peak must clear the same-level noise floor to count as a response. 2x is modest;
#: the point is to reject peaks that are merely the largest of 49 noisy cells.
NOISE_MARGIN = 2.0

#: The ceiling on the BRIGHT fraction of the head shot. Named for the founder's "no white clipping", but be
#: clear what the instrument is: read_screen_rect counts a pixel bright above LUMA 0.72 -- about 183/255, not
#: 250 -- and it cannot tell a saturated amber eye core from a blown white one. `white` on the eye patch is
#: what separates those. The ceiling is NOT relaxed on that argument until a run actually shows it failing a
#: coloured eye; the founder's rule is to fix the rendering, not the gate.
CLIP_CEILING = 0.06
CRUSH_CEILING = 0.60      # the guard against winning by making everything dark
ISOLATION_FLOOR = 0.02    # below this the level is not arriving at the rendered eye


def luma(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def job():
    RESULT["status"] = "running"
    tests, rows, knee_rows = [], [], []
    RESULT["tests"], RESULT["eye_axis"], RESULT["knee_axis"] = tests, rows, knee_rows
    os.makedirs(ROOT, exist_ok=True)

    def record_eye(tid, name, ok, **detail):
        """An eye-axis gate. Skipped entirely on a knee-axis run rather than failing on an empty table."""
        if AXIS != "eye":
            return
        record(tid, name, ok, **detail)

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
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    yield 5.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    ui = L.get_ui(world)
    RESULT["camera_failures"] = []

    def alive():
        """The world AND the pawn, or None. Every reading is gated on this.

        THE FAILURE THIS EXISTS FOR. The first run had PIE torn down underneath it at 15:08:02 and kept
        going until 15:09:56, emitting a constant 0.0187 -- the luma of a black viewport -- into 31 rows and
        nine gates, where it read as "the eye is dark on every skin". Two gates even passed. A proof that
        cannot tell "the world is gone" from "the eye is not glowing" is not a proof, and this one published
        a dead viewport as a mascot measurement. Nothing is recorded now unless both the world and the pawn
        answer, and the job ABORTS and says where it died rather than filling the table with the dark.
        """
        w = ues.get_game_world()
        if w is None:
            return None
        try:
            return w if unreal.GameplayStatics.get_player_pawn(w, 0) is not None else None
        except Exception:                                              # noqa: BLE001
            return None

    def live():
        """The world, re-fetched every time it is used.

        zc_water_audit died at its first pose_camera with "Cannot nativize 'World' as 'Object'" after holding
        a world reference across many yields. Whatever staled it, a reference captured once at the top of a
        job that runs for ten minutes is the thing that failed, so this one is never captured.
        """
        return ues.get_game_world()

    def cvar(name, value):
        w = live()
        if w is not None:
            unreal.SystemLibrary.execute_console_command(w, "%s %s" % (name, value))

    def pose(eye, aim, fov):
        """Aim the camera, and survive a failure instead of taking the whole sweep down with it."""
        try:
            L.pose_camera(live(), eye, aim, fov)
            return True
        except Exception as err:                                       # noqa: BLE001
            RESULT["camera_failures"].append(str(err)[:140])
            return False

    def exposure_now():
        """The world's own exposure, read so the experiment can prove it never moved."""
        out = []
        for v in unreal.GameplayStatics.get_all_actors_of_class(live(), unreal.PostProcessVolume):
            try:
                s = v.get_editor_property("settings")
                out.append((str(v.get_actor_label())[:28],
                            round(float(s.get_editor_property("auto_exposure_bias")), 4),
                            round(float(s.get_editor_property("auto_exposure_min_brightness")), 4),
                            round(float(s.get_editor_property("auto_exposure_max_brightness")), 4)))
            except Exception:                                          # noqa: BLE001
                pass
        return sorted(out)

    try:
        sub = live().get_subsystem(unreal.WonderlandPracticalLightsSubsystem)
        RESULT["practicals"] = str(sub.describe_practicals()) if sub is not None else "no subsystem"
    except Exception as err:                                           # noqa: BLE001
        RESULT["practicals"] = "unreadable: %s" % str(err)[:90]

    RESULT["died_at"] = None

    def dead(where):
        """Record the death and stop. Never returns data."""
        RESULT["died_at"] = where
        RESULT["status"] = "aborted"
        emit("ABORT", "FAIL", "the world went away during the sweep", {"at": where})

    exposure_before = exposure_now()
    RESULT["exposure_before"] = exposure_before

    def frame_head():
        """Stand the camera off the Dog's head, at zc_eyes_glow's proven reach and lens."""
        d = unreal.GameplayStatics.get_player_pawn(live(), 0)
        if d is None:
            return None
        here = d.get_actor_location()
        yaw = d.get_actor_rotation().yaw
        az = found.get("anchor_z", EYE_Z_FALLBACK)
        aim = unreal.Vector(here.x, here.y, here.z + az)
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 300.0,
                            here.y + math.sin(math.radians(yaw)) * 300.0, here.z + az + 8.0)
        pose(eye, aim, 32.0)
        return here

    def patch(here, z_above, half_w, half_h, dx=0.0, dy=0.0):
        try:
            got = unreal.GameplayStatics.project_world_to_screen(
                unreal.GameplayStatics.get_player_controller(live(), 0),
                unreal.Vector(here.x, here.y, here.z + z_above), False)
        except Exception:                                              # noqa: BLE001
            return None
        if got is None:
            return None
        size = unreal.GameplayStatics.get_player_controller(live(), 0).get_viewport_size()
        vw = float(size[0]) if size and size[0] else 1920.0
        vh = float(size[1]) if size and len(size) > 1 and size[1] else 1080.0
        cx, cy = float(got.x) / vw + dx, float(got.y) / vh + dy
        if not (0.02 < cx < 0.98 and 0.02 < cy < 0.98):
            return None
        r = L.read_screen_rect(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        if r is None:
            return None
        mean, dark, bright, sampled = r
        return {"rgb": [round(mean.r, 5), round(mean.g, 5), round(mean.b, 5)],
                "luma": round(luma((mean.r, mean.g, mean.b)), 5),
                "dark": round(dark, 4), "bright": round(bright, 4), "samples": int(sampled),
                # NEUTRALITY, so "bright" can be told from "white". 0.0 is fully saturated colour, 1.0 is
                # neutral. The founder forbids WHITE clipping and asks FOR a bright coloured core; the
                # bright fraction alone scores those two identically.
                "white": round(min(mean.r, mean.g, mean.b) / max(max(mean.r, mean.g, mean.b), 1e-6), 4)}

    def eye_anchor_z(skin):
        """Height of the eye above the pawn origin, read off the mesh BOUNDS and sanity-checked.

        The previous version returned a component world LOCATION -- its pivot -- while its own docstring
        claimed it used the bounds centre, because the getter loop broke after the first attempt and the
        bounds branch never once ran. It reported "mesh" and handed back 24.7 for all eight skins, which
        is one component found eight times on bodies of two different heights (1.74 m canon, 1.55 m
        costume), and well under the 62 independently known to be right for the Dog. Every face and eye
        patch in zzM1 was therefore aimed at a torso.
        """
        d = unreal.GameplayStatics.get_player_pawn(live(), 0)
        if d is None:
            return EYE_Z_FALLBACK, "fallback:no-pawn"
        base = d.get_actor_location().z

        # THE FIGURE'S OWN SIZE, so the plausibility test below needs no constant -- no single number can
        # be right for both a 1.74 m Dog and a 1.55 m costume, which is what the old fallback pair was.
        top = None
        try:
            origin, extent = d.get_actor_bounds(False)
            top = float(origin.z) + float(extent.z) - base
        except Exception:                                          # noqa: BLE001
            top = None

        cands = []
        for cls, cname in ((unreal.StaticMeshComponent, "static"),
                           (unreal.InstancedStaticMeshComponent, "instanced")):
            try:
                comps = d.get_components_by_class(cls)
            except Exception:                                      # noqa: BLE001
                continue
            for comp in comps:
                nm = str(comp.get_name())
                low = nm.lower()
                if "eye" not in low or "halo" in low:
                    continue
                # BOTH READINGS, EVERY TIME, AND NEITHER BREAKS THE LOOP. The pivot is kept because it is
                # what the last run actually used, so the two can be compared in the result rather than
                # argued about from memory.
                pivot = bounds = None
                try:
                    pivot = round(float(comp.get_world_location().z) - base, 1)
                except Exception:                                  # noqa: BLE001
                    pass
                try:
                    bounds = round(float(comp.bounds.origin.z) - base, 1)
                except Exception:                                  # noqa: BLE001
                    pass
                cands.append({"component": nm[:40], "class": cname,
                              "pivot_z": pivot, "bounds_z": bounds})
        found["anchor_candidates"] = cands

        # BOUNDS, not pivot -- and only a candidate in the upper half of the figure. An eye is in a head.
        floor = (top * 0.5) if top else 0.0
        usable = [c["bounds_z"] for c in cands
                  if c["bounds_z"] is not None and c["bounds_z"] >= floor]
        if usable:
            return max(usable), "mesh:bounds"
        rejected = [c["bounds_z"] for c in cands if c["bounds_z"] is not None]
        if rejected:
            # Candidates were found and every one sits below the figure midline. That is a pivot, and
            # saying so is more use than returning it.
            return ((EYE_Z_FALLBACK if skin == "relay_og" else EYE_Z_COSTUME),
                    "fallback:all-candidates-below-midline(%s of %s)"
                    % (max(rejected), round(top, 1) if top else "?"))
        return (EYE_Z_FALLBACK if skin == "relay_og" else EYE_Z_COSTUME), "fallback:no-eye-component"

    #: WHERE THE EYE IS, FOUND RATHER THAN ASSUMED. Filled per skin by locate_eye().
    found = {"eye": None, "face": None}

    def paused(on):
        """Freeze or unfreeze the game world.

        WHY THE SCAN NEEDS THIS, and the noise baseline is what proved it. Capturing the same head TWICE
        with nothing changed produced cell-to-cell differences up to 0.34 luma on the costume skins -- as
        large as the floor-to-clamp deltas the scan was trying to detect, which is why nothing could clear
        2x noise. That is not sensor jitter; that is the SUBJECT MOVING. The Dog idles, and a 7x7 grid of
        cells each about one percent of the viewport cannot measure a head that bobs between frames: the
        cell simply contains a different piece of the figure.

        So the world is paused for the duration of a scan. zc_water established that captures keep
        rendering while paused, which is what makes this safe -- and its control for exactly that is why
        the technique is trusted here rather than tried fresh.
        """
        try:
            unreal.GameplayStatics.set_game_paused(live(), bool(on))
            return True
        except Exception:                                              # noqa: BLE001
            return False

    def scan_cell(here, gx, gy):
        """One cell of the head scan, as a screen-space offset from the projected head point."""
        return patch(here, found.get("anchor_z", EYE_Z_FALLBACK), CELL_W, CELL_H,
                     dx=gx * CELL_W * 2.0, dy=gy * CELL_H * 2.0)

    def locate_eye(here):
        """Find the eye by asking which part of the head CHANGES when the eye level changes.

        THE FAILURE THIS REPLACES. The patch position was inherited from zc_eyes_glow -- the projected head
        point at z + 62, with the cheek 4.8% of a viewport to the side -- and was never verified to land on
        an eye. On relay_og it demonstrably did not: the shipped row read eye 0.5650 against face 0.5629,
        two patches a twentieth of a screen apart returning the same number, which means both sat on the
        same surface. The differential trick cannot rescue that, because a patch on the forehead shows zero
        change whatever the eye does -- and zero change is exactly what "the eye is dark" looks like.

        So the eye is LOCATED before it is measured. The head is scanned as a grid at the eye's floor level
        and again at its clamp, and the cell whose luma moves most IS the eye -- wherever that skin actually
        draws it, at whatever size. The cheek reference is then the cell furthest from it that still read,
        so the two can never be the same surface by construction.

        AND IT SELF-VERIFIES, which a fixed offset cannot. If no cell anywhere on the head moves, the eye
        genuinely does not respond, and that is a finding the job reports as such rather than quietly
        returning the luma of whatever sat at a hard-coded position.
        """
        cvar("wl.Look.EyeGlowDay", "%.3f" % EYE_FLOOR)
        cvar("wl.Look.EyeGlowNight", "%.3f" % EYE_FLOOR)
        yield 2.0
        found["paused"] = paused(True)
        yield 1.0
        lo = {}
        for gx in range(-SCAN, SCAN + 1):
            for gy in range(-SCAN_V, SCAN_V + 1):
                c = scan_cell(here, gx, gy)
                if c is not None:
                    lo[(gx, gy)] = c["luma"]
        # ---- THE CONTROL: the same scan again, with NOTHING changed.
        #
        # Taking the max of 49 cells is biased upward -- the largest of many noisy samples is positive even
        # when nothing moved. The first run showed that signature plainly: the "responding" skins put their
        # eye cell somewhere different at day than at dusk, and arden_infernal's curve swung 0.13 while the
        # level only ever rose. So this measures what the renderer does when the answer IS "no change", and
        # a floor->clamp peak has to beat it.
        yield 2.0
        noise = 0.0
        for gx in range(-SCAN, SCAN + 1):
            for gy in range(-SCAN_V, SCAN_V + 1):
                c = scan_cell(here, gx, gy)
                if c is not None and (gx, gy) in lo:
                    noise = max(noise, abs(c["luma"] - lo[(gx, gy)]))
        found["noise_floor"] = round(noise, 5)
        cvar("wl.Look.EyeGlowDay", "%.3f" % EYE_CLAMP)
        cvar("wl.Look.EyeGlowNight", "%.3f" % EYE_CLAMP)
        yield 2.0
        best, best_d, deltas = None, 0.0, {}
        for gx in range(-SCAN, SCAN + 1):
            for gy in range(-SCAN_V, SCAN_V + 1):
                c = scan_cell(here, gx, gy)
                if c is None or (gx, gy) not in lo:
                    continue
                moved = c["luma"] - lo[(gx, gy)]
                deltas["%d_%d" % (gx, gy)] = round(moved, 5)
                if moved > best_d:
                    best, best_d = (gx, gy), moved
        paused(False)
        found["scan"] = deltas
        found["peak_delta"] = round(best_d, 5)
        # A PEAK THAT DOES NOT BEAT THE NOISE IS NOT AN EYE. Recorded either way, so the report can show
        # how close it came rather than only that it failed.
        found["beats_noise"] = best_d > found.get("noise_floor", 0.0) * NOISE_MARGIN
        found["eye"] = best if found["beats_noise"] else None
        if best is not None:
            far, fd = None, -1.0
            for cell in lo:
                dd = (cell[0] - best[0]) ** 2 + (cell[1] - best[1]) ** 2
                if dd > fd:
                    far, fd = cell, dd
            found["face"] = far

    def read_all(here):
        """The located eye, the cheek furthest from it, and the whole head shot."""
        e, f = found.get("eye"), found.get("face")
        a = found.get("anchor_z", EYE_Z_FALLBACK)
        return {"eye": (scan_cell(here, e[0], e[1]) if e else patch(here, a, CELL_W, CELL_H)),
                "face": (scan_cell(here, f[0], f[1]) if f else patch(here, a, CELL_W, CELL_H, dx=0.048)),
                "frame": patch(here, found.get("anchor_z", EYE_Z_FALLBACK), 0.42, 0.40)}

    # ---------------------------------------------------------------- AXIS B: the eye level, per skin/hour
    if AXIS != "eye":
        rows_wanted = 0
    # Run first, because it is the axis the founder's complaint is actually about.
    cvar("wl.Look.GlowKnee", 700.0)                 # the shipped control while the eye axis moves
    for hour, hlabel in (HOURS if AXIS == "eye" else ()):
        if alive() is None:
            dead("before the %s pass began" % hlabel)
            return
        cvar("wl.Sky.Hour", "%.2f" % hour)
        yield 3.0
        for skin in SKINS:
            if ui is not None:
                ui.wear_relay_skin(skin)
            yield 2.5
            # THE ANCHOR IS RESOLVED FIRST, from this skin's own mesh, because a costume can put the eye
            # somewhere the last costume did not.
            az, how = eye_anchor_z(skin)
            found["anchor_z"] = az
            found["anchor_how"] = how
            here = frame_head()
            if here is None:
                continue
            yield 1.0
            # PULL BACK UNTIL THE FRAME IS NOT BLACK. A premium skin is two to three times the box count of
            # relay_og, and the camera that framed the lean ones sits inside the large ones.
            reach, shot = 300.0, None
            for reach in (300.0, 460.0, 650.0, 900.0):
                d0 = unreal.GameplayStatics.get_player_pawn(live(), 0)
                if d0 is None:
                    break
                hh = d0.get_actor_location()
                yaw = d0.get_actor_rotation().yaw
                pose(unreal.Vector(hh.x + math.cos(math.radians(yaw)) * reach,
                                   hh.y + math.sin(math.radians(yaw)) * reach, hh.z + 70.0),
                     unreal.Vector(hh.x, hh.y, hh.z + found.get("anchor_z", EYE_Z_FALLBACK)), 32.0)
                yield 1.2
                shot = patch(hh, found.get("anchor_z", EYE_Z_FALLBACK), 0.42, 0.40)
                if shot is not None and shot["luma"] >= BLACK_FRAME:
                    break
            if shot is None or shot["luma"] < BLACK_FRAME:
                rows.append({"skin": skin, "hour": hlabel, "level": None, "unmeasured": True,
                             "why": "every camera distance photographed black (out to %.0f uu)" % reach,
                             "frame_luma": None if shot is None else shot["luma"]})
                emit("B_%s_%s" % (skin, hlabel), "WARN",
                     "%s %s: black frame at every distance -- UNMEASURED" % (skin, hlabel), {})
                continue
            d1 = unreal.GameplayStatics.get_player_pawn(live(), 0)
            for step in locate_eye(d1.get_actor_location() if d1 is not None else here):
                yield step
            rows.append({"skin": skin, "hour": hlabel, "level": None, "locator": True,
                         "eye_cell": found.get("eye"), "face_cell": found.get("face"),
                         "anchor_z": found.get("anchor_z"), "anchor_how": found.get("anchor_how"),
                         "anchor_candidates": found.get("anchor_candidates"),
                         "paused": found.get("paused"),
                         "peak_delta": found.get("peak_delta"),
                         "noise_floor": found.get("noise_floor"),
                         "beats_noise": found.get("beats_noise"), "reach_uu": reach,
                         "frame_luma": shot["luma"]})
            base = None
            for level in EYE_LEVELS:
                if alive() is None:
                    dead("%s/%s level %.2f" % (skin, hlabel, level))
                    return
                # BOTH ends of the day-cycle lerp are set to the same value, so the level under test is the
                # level that arrives whatever the hour is -- otherwise dusk would silently read a blend.
                paused(False)
                cvar("wl.Look.EyeGlowDay", "%.3f" % level)
                cvar("wl.Look.EyeGlowNight", "%.3f" % level)
                yield 2.0
                paused(True)
                yield 0.6
                d2 = unreal.GameplayStatics.get_player_pawn(live(), 0)
                if d2 is None:
                    continue
                here = d2.get_actor_location()
                r = read_all(here)
                if r["eye"] is None or r["face"] is None:
                    emit("B_%s_%s_%.2f" % (skin, hlabel, level), "WARN", "eye or cheek off screen", {})
                    continue
                if level == EYE_FLOOR:
                    base = r
                row = {"skin": skin, "hour": hlabel, "level": level,
                       "eye_luma": r["eye"]["luma"], "face_luma": r["face"]["luma"],
                       "over_face": round(r["eye"]["luma"] - r["face"]["luma"], 5),
                       "clipped": r["frame"]["bright"], "crushed": r["frame"]["dark"],
                       "eye_white": r["eye"]["white"],
                       "eye_rgb": r["eye"]["rgb"]}
                if base is not None:
                    eg = r["eye"]["luma"] - base["eye"]["luma"]
                    fg = r["face"]["luma"] - base["face"]["luma"]
                    row["eye_gain"] = round(eg, 5)
                    row["face_gain"] = round(fg, 5)
                    row["isolation"] = round(eg - fg, 5)
                    # THE ADDED LIGHT is what carries the eye's colour; the lit pixel underneath does not.
                    add = [max(r["eye"]["rgb"][i] - base["eye"]["rgb"][i], 0.0) for i in range(3)]
                    row["eye_added_rgb"] = [round(v, 5) for v in add]
                    mag = math.sqrt(sum(v * v for v in add))
                    want = AUTHORED_EYE[skin]
                    wmag = math.sqrt(sum(v * v for v in want))
                    row["hue_retention"] = (round(sum(add[i] * want[i] for i in range(3)) / (mag * wmag), 4)
                                            if mag > 1e-5 else None)
                    row["colour_separation"] = (round((max(add) - min(add)) / max(add), 4)
                                                if max(add) > 1e-5 else 0.0)
                rows.append(row)
                emit("B_%s_%s_%04.1f" % (skin, hlabel, level), "INFO", "%s %s eye=%.2f" % (skin, hlabel, level),
                     {k: row.get(k) for k in ("eye_luma", "over_face", "isolation", "clipped", "hue_retention")})
            # ---- AND THE SHIPPED PAIR, with the day cycle interpolating it as it does in the game.
            if base is not None and alive() is not None:
                paused(False)
                cvar("wl.Look.EyeGlowDay", "%.3f" % SHIPPED_DAY)
                cvar("wl.Look.EyeGlowNight", "%.3f" % SHIPPED_NIGHT)
                yield 2.5
                paused(True)
                yield 0.6
                d3 = unreal.GameplayStatics.get_player_pawn(live(), 0)
                if d3 is not None:
                    r = read_all(d3.get_actor_location())
                    if r["eye"] is not None and r["face"] is not None:
                        eg = r["eye"]["luma"] - base["eye"]["luma"]
                        fg = r["face"]["luma"] - base["face"]["luma"]
                        add = [max(r["eye"]["rgb"][i] - base["eye"]["rgb"][i], 0.0) for i in range(3)]
                        mag = math.sqrt(sum(v * v for v in add))
                        want = AUTHORED_EYE.get(skin, (1.0, 1.0, 1.0))
                        wmag = math.sqrt(sum(v * v for v in want))
                        rows.append({
                            "skin": skin, "hour": hlabel, "level": SHIPPED_LEVEL, "shipped": True,
                            "shipped_day": SHIPPED_DAY, "shipped_night": SHIPPED_NIGHT,
                            "eye_luma": r["eye"]["luma"], "face_luma": r["face"]["luma"],
                            "over_face": round(r["eye"]["luma"] - r["face"]["luma"], 5),
                            "eye_bright": r["eye"]["bright"], "eye_dark": r["eye"]["dark"],
                            "eye_white": r["eye"]["white"], "frame_white": r["frame"]["white"],
                            "clipped": r["frame"]["bright"], "crushed": r["frame"]["dark"],
                            "eye_rgb": r["eye"]["rgb"], "eye_gain": round(eg, 5),
                            "face_gain": round(fg, 5), "isolation": round(eg - fg, 5),
                            "eye_added_rgb": [round(v, 5) for v in add],
                            "hue_retention": (round(sum(add[i] * want[i] for i in range(3)) / (mag * wmag), 4)
                                              if mag > 1e-5 else None),
                            "colour_separation": (round((max(add) - min(add)) / max(add), 4)
                                                  if max(add) > 1e-5 else 0.0)})
                        emit("B_%s_%s_SHIPPED" % (skin, hlabel), "INFO",
                             "%s %s shipped %.0f/%.0f" % (skin, hlabel, SHIPPED_DAY, SHIPPED_NIGHT),
                             {k: rows[-1][k] for k in ("eye_luma", "over_face", "isolation",
                                                       "eye_bright", "clipped")})
            try:
                L.capture_game_viewport(os.path.join(ROOT, "%s_%s_shipped.png" % (skin, hlabel)))
            except Exception:                                          # noqa: BLE001
                pass

    # ---------------------------------------------------------------- AXIS A: the knee, at the live range
    # Noon only: the knee is a body-glow curve and does not interact with the hour except through exposure,
    # which is held. Its whole job here is to answer whether it does ANYTHING at this asset scale.
    cvar("wl.Look.EyeGlowDay", 12.0)
    cvar("wl.Look.EyeGlowNight", 12.0)
    cvar("wl.Sky.Hour", "12.00")
    yield 3.0
    for skin in (SKINS if AXIS == "knee" else ()):
        if ui is not None:
            ui.wear_relay_skin(skin)
        yield 2.5
        here = frame_head()
        if here is None:
            continue
        yield 1.0
        for knee in KNEES:
            if alive() is None:
                dead("knee axis, %s at %.0f" % (skin, knee))
                return
            cvar("wl.Look.GlowKnee", "%.2f" % knee)
            unreal.SystemLibrary.execute_console_command(live(), "wl.Look.Reglow")
            yield 2.0
            d2 = unreal.GameplayStatics.get_player_pawn(live(), 0)
            if d2 is None:
                continue
            here = d2.get_actor_location()
            r = read_all(here)
            if r["frame"] is None:
                continue
            knee_rows.append({"skin": skin, "knee": knee, "frame_luma": r["frame"]["luma"],
                              "clipped": r["frame"]["bright"], "crushed": r["frame"]["dark"],
                              "eye_white": r["eye"]["white"],
                              "face_luma": r["face"]["luma"] if r["face"] else None,
                              "eye_luma": r["eye"]["luma"] if r["eye"] else None})
            emit("A_%s_%05.0f" % (skin, knee), "INFO", "%s knee=%.0f" % (skin, knee),
                 {"frame_luma": r["frame"]["luma"], "clipped": r["frame"]["bright"]})

    # ---------------------------------------------------------------- put the world back
    paused(False)
    for name, value in SHIPPED:
        cvar(name, value)
    unreal.SystemLibrary.execute_console_command(live(), "wl.Look.Reglow")
    yield 2.0
    try:
        L.release_camera(live())
    except Exception:  # noqa: BLE001
        pass
    exposure_after = exposure_now()
    RESULT["exposure_after"] = exposure_after
    RESULT["cvars_restored"] = [n for n, _ in SHIPPED]

    # ---------------------------------------------------------------- the gates
    measured_rows = [r for r in rows if r.get("level") is not None]
    want = len(SKINS) * len(HOURS) * (len(EYE_LEVELS) + 1) if AXIS == "eye" else 0
    RESULT["axis"] = AXIS
    RESULT["hour"] = HOUR_LABEL
    loc = {r["skin"]: r.get("peak_delta") for r in rows if r.get("locator")}
    blackened = [r["skin"] for r in rows if r.get("unmeasured")]
    record_eye("M11", "the eye was FOUND on every skin -- some cell of the head responds to the eye level",
               bool(loc) and not blackened
               and all(r.get("beats_noise") for r in rows if r.get("locator")),
               peak_delta_per_skin=loc, black_framed=blackened,
               anchor_z={r["skin"]: r.get("anchor_z") for r in rows if r.get("locator")},
               anchor_how={r["skin"]: r.get("anchor_how") for r in rows if r.get("locator")},
               anchor_candidates={r["skin"]: r.get("anchor_candidates")
                                  for r in rows if r.get("locator")},
               paused_ok={r["skin"]: r.get("paused") for r in rows if r.get("locator")},
               noise_floor_per_skin={r["skin"]: r.get("noise_floor") for r in rows if r.get("locator")},
               beats_noise={r["skin"]: r.get("beats_noise") for r in rows if r.get("locator")},
               eye_cell={r["skin"]: r.get("eye_cell") for r in rows if r.get("locator")},
               reach_uu={r["skin"]: r.get("reach_uu") for r in rows if r.get("locator")},
               note="the head is scanned at the eye floor and at the clamp and the cell that moves most IS "
                    "the eye -- but only if it beats a same-level noise baseline by %.0fx, because the max "
                    "of 49 cells is positive even on pure noise. A skin with no responding cell is a real "
                    "finding; a skin whose peak does not clear its noise floor is UNRESOLVED, not absent."
                    % NOISE_MARGIN)
    record("M00", "every skin was sampled at every hour at every eye level",
           len(measured_rows) == want, got=len(measured_rows), wanted=want,
           skins=list(SKINS), hours=[h for _, h in HOURS], levels=list(EYE_LEVELS))

    # X00 COMPARES AT THE SAME HOUR, because the day cycle DRIVES exposure from the hour --
    # PaintTheSky sets AutoExposureBias = Lerp(1.45, -0.9, Daylight) every repaint. The first version
    # compared the bias at whatever hour the world happened to be at on entry against the bias at the hour
    # the sweep finished on, and called the day cycle doing its job a confound. What must not move is the
    # PINNED range (min/max EV100), which is a world setting; the hour-driven bias is expected.
    rng_before = [(v[0], v[2], v[3]) for v in exposure_before]
    rng_after = [(v[0], v[2], v[3]) for v in exposure_after]
    record("X00", "the world's pinned exposure range is untouched -- the experiment is not confounded",
           bool(rng_before) and rng_before == rng_after, before=rng_before, after=rng_after,
           bias_before=[v[1] for v in exposure_before], bias_after=[v[1] for v in exposure_after],
           note="min/max EV100 is the world setting and must not move; AutoExposureBias is driven by the "
                "hour by the day cycle and is expected to differ")

    # THE INSTRUMENT MUST RESPOND, or every other number below is a photograph of nothing.
    moved = [r for r in rows if r.get("isolation") is not None and abs(r["isolation"]) > 1e-4]
    record_eye("M01", "driving the eye level actually changes the rendered eye",
           len(moved) > 0, readings_that_moved=len(moved), of=len(rows),
           note="a flat response here is a broken capture, not a finding about the eyes")

    # 3. THE CLAMP, photographed rather than read off the source.
    clamp = {}
    for skin in SKINS:
        for _, hl in HOURS:
            a = next((r for r in rows if r["skin"] == skin and r["hour"] == hl and r["level"] == EYE_CLAMP), None)
            b = next((r for r in rows if r["skin"] == skin and r["hour"] == hl
                      and r["level"] == EYE_ABOVE_CLAMP), None)
            if a and b:
                clamp["%s/%s" % (skin, hl)] = round(b["eye_luma"] - a["eye_luma"], 5)
    identical = [k for k, v in clamp.items() if abs(v) <= 0.002]
    record_eye("M02", "the eye level saturates exactly at SetEyeGlow's clamp and not before",
           len(identical) == len(clamp) and len(clamp) > 0,
           delta_above_minus_at_clamp=clamp, clamp=EYE_CLAMP, probed_above=EYE_ABOVE_CLAMP,
           identical=len(identical), of=len(clamp),
           note="the clamp moved 12 -> 30 in this build so EyeGlowDay 18 is finally reachable; every 'eye "
                "level' reading in the corpus from before it is really 12 whatever it was set to")

    # 4. IS THE EYE REACHING THE RENDER, per skin? This is the founder's Celestial question, asked of all five.
    reach = {}
    for skin in SKINS:
        best = [r["isolation"] for r in measured_rows
                if r["skin"] == skin and r.get("isolation") is not None and r["level"] == SHIPPED_DAY]
        reach[skin] = round(max(best), 5) if best else None
    arriving = [s for s, v in reach.items() if v is not None and v >= ISOLATION_FLOOR]
    record_eye("M03", "on every skin the eye level arrives at the rendered EYE and not merely at the head",
           len(arriving) == len(SKINS), isolation_at_level_18=reach, floor=ISOLATION_FLOOR,
           arriving=arriving, not_arriving=[s for s in SKINS if s not in arriving],
           note="isolation = the eye patch's gain minus the cheek's gain, so a head that glows as a whole "
                "cannot pass this; near zero means the emission is not reaching the eye and no knee will fix it")

    # 5. CONTRAST, at the shipped-equivalent level, on unclipped samples.
    contrast = {}
    for skin in SKINS:
        for _, hl in HOURS:
            r = next((x for x in measured_rows if x["skin"] == skin and x["hour"] == hl and x["level"] == 12.0), None)
            if r:
                contrast["%s/%s" % (skin, hl)] = r["over_face"]
    positive = [k for k, v in contrast.items() if v > 0.0]
    record_eye("M04", "the eye is brighter than the face beside it, on every skin at every hour",
           len(positive) == len(contrast) and len(contrast) > 0, over_face=contrast,
           positive=len(positive), of=len(contrast),
           note="measured against a cheek patch, at eye level 12, which is what the shipped 18 actually "
                "resolves to")

    # 6. NO WHITE CLIPPING, and 7. NOT WON BY GOING DARK.
    worst_clip = max((r["clipped"] for r in measured_rows if r["level"] == SHIPPED_DAY), default=1.0)
    worst_crush = max((r["crushed"] for r in measured_rows if r["level"] == SHIPPED_DAY), default=1.0)
    record_eye("M05", "a mascot filling the frame is not blown out at the shipped eye level",
           worst_clip <= CLIP_CEILING, worst_clipped=worst_clip, ceiling=CLIP_CEILING,
           eye_white={s2: max((r.get("eye_white") for r in rows
                               if r["skin"] == s2 and r["level"] == SHIPPED_DAY and r.get("eye_white") is not None),
                              default=None) for s2 in SKINS},
           what_bright_means="luma > 0.72, not 250/255; a high bright fraction with a LOW eye_white is a "
                             "bright COLOURED core, which is what the founder asked for, and a high bright "
                             "fraction with eye_white near 1.0 is the white clipping they forbade",
           per_skin={s: max((r["clipped"] for r in rows if r["skin"] == s and r["level"] == SHIPPED_DAY), default=None)
                     for s in SKINS})
    record_eye("M06", "and that is not achieved by making the picture dark",
           worst_crush <= CRUSH_CEILING, worst_crushed=worst_crush, ceiling=CRUSH_CEILING)

    # 8. THE EYE KEPT ITS COLOUR.
    hues = {}
    seps = {}
    for skin in SKINS:
        v = [r["hue_retention"] for r in measured_rows
             if r["skin"] == skin and r["level"] == SHIPPED_DAY and r.get("hue_retention") is not None]
        s2 = [r["colour_separation"] for r in measured_rows
              if r["skin"] == skin and r["level"] == SHIPPED_DAY and r.get("colour_separation") is not None]
        hues[skin] = round(min(v), 4) if v else None
        seps[skin] = round(min(s2), 4) if s2 else None
    kept = [s for s, v in hues.items() if v is not None and v >= 0.95]
    record_eye("M07", "the added eye light still points at the skin's authored eye colour",
           len(kept) == len(SKINS), hue_retention=hues, authored=AUTHORED_EYE, floor=0.95,
           note="cosine of the ADDED light against the authored RGB; measured on the difference so a pale "
                "face behind the eye cannot launder a grey eye into looking coloured")
    record_eye("M08", "the eye is a coloured core rather than a white one",
           all(v is not None and v >= 0.25 for v in seps.values()), colour_separation=seps, floor=0.25,
           note="channel spread of the added light; a white-clipped eye reads near 0")

    # THE SHIPPED CONFIGURATION, which is the only row that describes what the founder actually gets.
    ship = {}
    for r in rows:
        if r.get("shipped"):
            ship["%s/%s" % (r["skin"], r["hour"])] = {
                "eye": r["eye_luma"], "over_face": r["over_face"], "isolation": r["isolation"],
                "eye_clipped": r["eye_bright"], "frame_clipped": r["clipped"]}
    dim = [k for k, v in ship.items() if v["isolation"] < ISOLATION_FLOOR or v["over_face"] <= 0.0]
    blown = [k for k, v in ship.items() if v["eye_clipped"] > 0.50]
    record_eye("M10", "at the SHIPPED eye levels the eye reads as a bright core on every skin at every hour "
                      "-- neither dim nor blown",
               bool(ship) and not dim and not blown, shipped_day=SHIPPED_DAY, shipped_night=SHIPPED_NIGHT,
               reading_dim=dim, reading_blown=blown, per_skin_hour=ship,
               note="the swept levels pin both ends of the lerp to isolate the level; this row leaves the "
                    "shipped ratio alone and lets the day cycle interpolate, so it is the only one that "
                    "says what the game does. Dim = isolation under the floor or the eye no brighter than "
                    "the cheek; blown = over half the eye patch at 250+")

    # 9. THE KNEE AXIS: does it do anything at this asset scale?
    spread = {}
    for skin in SKINS:
        v = [r["frame_luma"] for r in knee_rows if r["skin"] == skin]
        spread[skin] = round(max(v) - min(v), 5) if v else None
    inert = [s for s, v in spread.items() if v is not None and v <= 0.005]
    engaged = {}
    for skin in SKINS:
        ctrl = next((r["frame_luma"] for r in knee_rows if r["skin"] == skin and r["knee"] == 700.0), None)
        # DESCENDING. The first version sorted ASCENDING and so always returned the smallest knee swept,
        # reporting "first knee that changes the picture: 2.0" for all eight skins whatever the data said.
        # The question is the HIGHEST knee that still bites, which is where compression begins.
        for kn in sorted((k for k in KNEES if k != 700.0), reverse=True):
            v = next((r["frame_luma"] for r in knee_rows if r["skin"] == skin and r["knee"] == kn), None)
            if ctrl is not None and v is not None and abs(v - ctrl) > 0.005:
                engaged[skin] = kn
                break
    record("M09", "the knee's live range at this asset scale is measured, not assumed",
           len(knee_rows) == (len(SKINS) * len(KNEES) if AXIS == "knee" else 0),
           frame_luma_spread_across_knees=spread, inert_skins=inert,
           highest_knee_that_changes_the_picture=engaged, knees_swept=list(KNEES),
           note="body glow spans 3.3-13.2 after the 4000->6 re-baseline, so a knee at the shipped 700 "
                "compresses nothing; this says where it starts to bite and whether it helps")

    RESULT["summary"] = {"eye_isolation_at_shipped_day": reach, "over_face_at_shipped_day": contrast,
                         "shipped_day": SHIPPED_DAY, "shipped_night": SHIPPED_NIGHT,
                         "hue_retention": hues, "colour_separation": seps,
                         "knee_spread": spread, "knee_engages_at": engaged,
                         "worst_clipped": worst_clip, "worst_crushed": worst_crush,
                         "eye_white": {s2: [r.get("eye_white") for r in measured_rows
                                            if r["skin"] == s2 and r.get("eye_white") is not None]
                                       for s2 in SKINS}}
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
