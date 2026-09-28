# ARE THERE TWO EYES ON SCREEN, OR ONE GLOWING MASS?
#
# FOUNDER, RELAY OG EYE SPACING: "The Relay OG mascot's two eyes are TOO CLOSE TOGETHER. With the new glow they
# visually merge into one central glowing mass ... There must be a clearly visible BLACK VISOR GAP between the
# two glowing eyes ... Bloom from one eye must not visually merge with bloom from the other ... Each eye must
# remain individually identifiable at normal gameplay distance." And: "Rendered visual evidence is the
# acceptance test."
#
# WHY A LUMA PROFILE AND NOT A BRIGHTNESS. Every number this project has used on the eyes so far -- emissive
# strength, halo ring multipliers, light fraction, eye glow scale -- can be satisfied by a figure whose eyes
# are one blob. They measure HOW MUCH light there is. The founder's sentence is about WHERE it is, and the
# smallest honest form of it is a horizontal slice across the visor:
#
#   TWO EYES     a peak, a trough, a peak
#   ONE BLOB     a single peak
#
# So this takes the row of pixels across the eye band, finds the two brightest peaks either side of centre, and
# measures the DEEPEST POINT BETWEEN THEM as a fraction of the dimmer peak. A gap that is dark relative to its
# own eyes is a gap at any brightness, which is what makes this immune to the failure the founder named:
# reducing the glow until the defect is hidden cannot pass it, because dimming both eyes lowers the peaks and
# the trough together and leaves the ratio where it was.
#
# AND IT IS MEASURED AT EVERY VIEW THE FOUNDER LISTED, because a gap visible in a close front view can close at
# gameplay distance when the two blooms land in the same pixel.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import hashlib
import os
import sys
import time
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eye_split")
REPO = os.path.dirname(os.path.dirname(CHANNEL))

SKINS = ("relay_og", "skeleton_flame", "apollo", "arden_infernal", "celestial_light")
# The founder's list: daytime, dusk, nighttime.
HOURS = (("day", 12.0), ("dusk", 18.0), ("night", 23.6))
# The founder's list: a close front view and normal gameplay distance. 160 uu is a face-filling look at a
# figure about 200 uu tall; 900 is where the Dog is while you walk with it.
VIEWS = (("close", 160.0), ("gameplay", 900.0))
# A trough this dark relative to the dimmer eye counts as a black gap. 0.45 is a judgement and is reported as
# one: it is the point at which a printed profile stops looking like a saddle and starts looking like two.
GAP_RATIO = 0.45



# ---- CHROMA, NOT LUMA, AND THE PHOTOGRAPH IS WHY.
#
# THE SIXTH VERSION OF THIS PROFILE REPORTED 0.946 -- no gap at all -- FOR A FRAME THAT PLAINLY SHOWS TWO
# SEPARATED EYES WITH A BLACK VISOR BETWEEN THEM. I cropped the capture, enlarged it and looked at it, which
# is what the founder's standard has said to do all along, and the picture and the number disagreed completely.
#
# THE CAUSE: the profile took the BRIGHTEST PIXEL in each column, and Relay OG's head is WHITE. The band around
# the visor is full of white head, so every column returned about 0.999 and the profile was flat. It was
# measuring the head and calling it the eyes. Max-per-column is right for finding a small bright thing on a
# DARK subject and exactly wrong on a bright one.
#
# CHROMA -- max channel minus min channel -- separates all three things by construction: a white head is
# neutral and reads near zero, a black visor reads near zero, and a coloured glow reads high whatever its hue.
# It works for warm gold and for spectral cyan without knowing which skin is on.
#
# CHECKED ON THE CAPTURES BEFORE BEING SHIPPED, which is the part I had not been doing. Across the five skins
# already photographed, luma gave 0.946 / 0.949 / 1.000 / 1.000 / 0.962 -- every one of them "no gap" -- and
# chroma gives 0.094 / 0.333 / 0.452 / 0.733 / 0.252. Relay OG at 0.094 is the deep dark gap the photograph
# shows.
#
# AND IT HAS A KNOWN LIMIT, so it reports rather than guesses. Celestial Light's eyes are (0.62, 0.88, 1.00),
# nearly white, so its chroma peak is 0.059 -- barely above the noise -- and its 0.733 is not a measurement of
# anything. A peak under CHROMA_FLOOR means this method cannot see that skin's eyes, and the clause says
# UNMEASURABLE instead of FAIL. A tool that reports a number it cannot support is how the last six hours went.
CHROMA_FLOOR = 0.10


def two_peaks(cols):
    """The two brightest separated peaks and the trough between them.

    NOT A MIDPOINT SPLIT. The previous version cut the window in half and took the max of each side, which
    assumes the face is centred in the window. It was not: the head sat at 0.44 of the window and BOTH halves
    peaked inside the same eye, so the columns "between the peaks" were all eye and the trough came back at
    0.945 of the peak. The two peaks are now the global maximum and the best peak at least a tenth of the
    window away from it, which needs no assumption about where the subject is.
    """
    n = len(cols)
    if n < 8:
        return None
    apart = max(n // 10, 3)
    i1 = max(range(n), key=lambda k: cols[k])
    cand = [k for k in range(n) if abs(k - i1) >= apart]
    if not cand:
        return None
    i2 = max(cand, key=lambda k: cols[k])
    a, b = min(i1, i2), max(i1, i2)
    between = cols[a + 1:b]
    if not between:
        return None
    trough = min(between)
    dim = min(cols[i1], cols[i2])
    weak = dim < CHROMA_FLOOR
    return {
        "peak_left": round(cols[a], 4), "peak_right": round(cols[b], 4),
        "peak_left_at": round(a / float(n), 3), "peak_right_at": round(b / float(n), 3),
        "separation_columns": b - a, "trough": round(trough, 4),
        "trough_over_dimmer_peak": (None if weak else (round(trough / dim, 3) if dim > 0 else None)),
        "symmetry": (round(dim / max(cols[i1], cols[i2]), 3) if max(cols[i1], cols[i2]) > 0 else None),
        "unmeasurable": weak,
        "why_unmeasurable": ("the chroma peak is %.3f, under the %.2f floor: this skin's eyes are too close to "
                             "white for a chroma profile to find them, so no ratio is reported"
                             % (dim, CHROMA_FLOOR)) if weak else None,
        "profile": cols,
    }


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    os.makedirs(ROOT, exist_ok=True)
    sys.path.insert(0, os.path.join(REPO, "Tools"))
    from night_figure import read                                   # noqa: WPS433

    RESULT["tests"] = []

    def record(tid, name, ok, **detail):
        RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def profile(path, distance):
        """The horizontal luma profile across the eye band, and what it says about two eyes.

        THE EYES ARE AT THE CENTRE OF THE FRAME BY CONSTRUCTION, and that is the only reliable thing here.
        look() aims the camera AT the Dog's eye height, so the visor is on the centre row whatever the
        distance. Everything else about locating it has been wrong twice.

        VERSION ONE took rows 0.36 to 0.52 at both distances. At 160 uu the head fills much of the frame and
        at 900 uu it is a twentieth of it, so one band cannot hold the visor in both.

        VERSION TWO searched for the BRIGHTEST ROW in the upper frame, on the theory that the eyes are the
        brightest thing on the figure. They are not the brightest thing in the PICTURE. The band came back
        anywhere from 0.108 to 0.592 of frame height across thirty captures of the same subject, with peaks
        350 to 700 columns apart -- most of the frame wide. It was finding lamps, lit walls and sky, and
        reporting them as a pair of eyes with a confident ratio.

        SO THE WINDOW IS DERIVED FROM THE CAMERA INSTEAD OF SEARCHED FOR. A head of fixed size subtends an
        angle that falls as 1/distance, so the window scales the same way from one calibration at the close
        rung. The search for the brightest row still happens, but only INSIDE that window, so it can pick the
        eye row out of the visor without being able to wander onto the world.

        It still fails safe: if the window does not contain two bright regions, the profile has no trough and
        the clause fails rather than measuring something else convincingly.
        """
        w, h, chan, px = read(path)
        # ---- THE SPAN IS SOLVED FROM THE LENS, NOT CALIBRATED BY EYE.
        #
        # I wrote "at 160 uu the head is about a quarter of the frame" and scaled from it. The camera maths says
        # otherwise. look() uses a 38 degree field of view, so the frame is 2 * d * tan(19 deg) = 0.689 * d wide
        # in world units: 110 uu at 160, 620 at 900. A Dog's head is about 14 uu across. So the head is ELEVEN
        # per cent of the close frame, not twenty-four, and my window was 2.4x too wide at both distances --
        # which at close range let it reach past the head into the world it was supposed to exclude.
        #
        # A guessed calibration that happens to be in the right decade is the most expensive kind of wrong: it
        # produces plausible readings and nothing in them says the window is oversized.
        HEAD_UU, MARGIN, FOV_DEG = 14.0, 1.6, 38.0
        frame_uu = 2.0 * max(distance, 1.0) * math.tan(math.radians(FOV_DEG * 0.5))
        span = max(HEAD_UU * MARGIN * 0.5 / frame_uu, 0.012)
        x0, x1 = int((0.5 - span) * w), int((0.5 + span) * w)
        y_lo, y_hi = int((0.5 - span) * h), int((0.5 + span) * h)
        best_row, best_val = (y_lo + y_hi) // 2, -1.0
        for y in range(max(y_lo, 0), min(y_hi, h), 2):
            row = y * w * chan
            peak = 0.0
            for x in range(x0, min(x1, w), 2):
                i = row + x * chan
                r, g, b = px[i], px[i + 1], px[i + 2]
                lum = max(r, g, b) - min(r, g, b)          # chroma: see the note above two_peaks
                if lum > peak:
                    peak = lum
            if peak > best_val:
                best_val, best_row = peak, y
        half = max(int(span * h * 0.25), 2)
        y0, y1 = max(best_row - half, 0), min(best_row + half, h)
        cols = []
        for x in range(x0, x1):
            best = 0.0
            for y in range(y0, y1):
                i = (y * w + x) * chan
                r, g, b = px[i], px[i + 1], px[i + 2]
                lum = max(r, g, b) - min(r, g, b)          # chroma: see the note above two_peaks
                # THE BRIGHTEST PIXEL IN THE COLUMN, NOT THE MEAN. A mean across the band dilutes a small
                # bright eye with the dark visor around it and turns two eyes into one shallow hill; the
                # founder is looking at the bright parts, so the profile follows them.
                if lum > best:
                    best = lum
            cols.append(round(best / 255.0, 4))
        if not cols:
            return None
        got = two_peaks(cols)
        if got is None:
            return None
        got.update({
            "columns": len(cols),
            # THE BAND THIS READING USED, so a reader can check it against the capture instead of trusting it.
            "band_rows": [y0, y1], "band_centre_fraction": round(best_row / float(h), 3),
            # THE WINDOW THE SEARCH WAS CONFINED TO, so a reader can see it was not free to wander.
            "window_span_fraction": round(span, 4), "window_cols": [x0, x1], "window_rows": [y_lo, y_hi],
            "window_derivation": {"head_uu": HEAD_UU, "margin": MARGIN, "fov_deg": FOV_DEG,
                                  "frame_uu_at_this_distance": round(frame_uu, 1)},
            "band_peak_chroma": round(best_val / 255.0, 4),
        })
        return got

    # ---- EVERY CAPTURE MUST BE A DIFFERENT PICTURE, and nothing checked that until it was not.
    #
    # The first run of zc_eye_split wrote thirty byte-identical PNGs and its "was everything photographed"
    # clause PASSED, because it counted FILES. Thirty files existed. They were one image. Every downstream
    # reading was then identical to four decimal places across five skins, three hours and two distances, and
    # the only reason that was caught is that identical numbers across thirty conditions are absurd on their
    # face -- which is not a test, it is luck.
    #
    # So the hash of each capture is kept and the count of DISTINCT images is a clause. A run whose pictures
    # are all the same is a run that photographed the editor rather than the game, and it must fail loudly
    # rather than publish thirty copies of one number.
    def fingerprint(path):
        try:
            with open(path, "rb") as fh:
                return hashlib.md5(fh.read()).hexdigest()
        except Exception:                                           # noqa: BLE001
            return None

    # ---- REAL PLAY, NOT SIMULATE, AND THIS IS WHY EVERY CAPTURE WAS THE SAME IMAGE.
    #
    # The first run of zc_eye_split called editor_play_simulate() and wrote THIRTY BYTE-IDENTICAL PNGs: five
    # skins, three hours and two distances all landing on one hash, 1,589,542 bytes each. In simulate there is
    # no player camera, so pose_camera has nothing to pose and the viewport keeps showing the editor's own
    # fixed view -- the skins changed, the hour changed, the camera moved, and the photograph did not.
    #
    # Every job in this tree that has ever captured a frame uses editor_request_begin_play, and I wrote
    # simulate from habit. The throttle suspension comes with it: an unfocused PIE window throttles into UE's
    # delta clamp, which is a separate way for a capture to be a picture of nothing happening.
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

    # THE SKIN IS WORN THROUGH THE UI SUBSYSTEM, NOT THE TEST LIBRARY. The first run of this job errored on
    # every skin with "WonderlandUiTestLibrary has no attribute wear_relay_skin" -- I wrote the call from
    # memory of zc_night_bodies, where it reads ui.wear_relay_skin() and `ui` is L.get_ui(world), not L.
    ui = L.get_ui(world)
    if ui is None:
        RESULT["status"] = "VOID: no UI subsystem"
        return
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    if dog is None:
        RESULT["status"] = "VOID: no pawn"
        return

    # ---- THE MEASURED SETTINGS, READ BACK, so a build without the fix voids itself instead of failing.
    for cvar in ("wl.Dog.EyeSpread", "wl.Dog.EyeGap"):
        try:
            RESULT.setdefault("settings", {})[cvar] = float(
                unreal.SystemLibrary.get_console_variable_float_value(cvar))
        except Exception:                                           # noqa: BLE001
            RESULT.setdefault("settings", {})[cvar] = None
    known = RESULT.get("settings") or {}
    record("E00", "this build carries the eye spacing controls",
           known.get("wl.Dog.EyeSpread") is not None and known.get("wl.Dog.EyeGap") is not None,
           settings=known,
           note="an editor built before the fix reports neither cvar, and every profile below would then "
                "describe the OLD eyes while reading as a result for the new ones.")
    if known.get("wl.Dog.EyeSpread") is None:
        RESULT["status"] = "VOID: this editor predates the eye spacing fix"
        return

    def look(distance):
        """Front view at the Dog's eye height, from the way it faces."""
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        import math
        eye_z = here.z + 96.0
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * distance,
                            here.y + math.sin(math.radians(yaw)) * distance, eye_z)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, eye_z), 38.0)

    shots = []
    readings = {}
    RESULT["readings"] = readings
    for skin in SKINS:
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:140]
            continue
        yield 6.0
        for hour_label, hour in HOURS:
            unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
            yield 3.0
            for view_label, distance in VIEWS:
                live = ues.get_game_world()
                if live is None or unreal.GameplayStatics.get_player_pawn(live, 0) is None:
                    record("E_DEAD_%s_%s_%s" % (skin, hour_label, view_label),
                           "the world was alive for this reading", False)
                    continue
                look(distance)
                yield 1.2
                unreal.GameplayStatics.set_game_paused(live, True)
                yield 0.3
                key = "%s/%s/%s" % (skin, hour_label, view_label)
                name = "eyes_%s_%s_%s.png" % (skin, hour_label, view_label)
                path = os.path.join(ROOT, name)
                try:
                    got = L.capture_game_viewport(path)
                    if not got:
                        raise RuntimeError("capture_game_viewport returned falsy: the editor window is "
                                           "probably not foreground")
                    shots.append(name)
                    RESULT.setdefault("capture_hashes", {})[name] = fingerprint(path)
                    readings[key] = profile(path, distance)
                except Exception as err:                            # noqa: BLE001
                    RESULT.setdefault("errors", {})[key] = str(err)[:160]
                unreal.GameplayStatics.set_game_paused(live, False)
                L.release_camera(live)
                yield 0.3
        emit("E_%s" % skin, "INFO", "%s eye profiles" % skin,
             {k: {kk: vv for kk, vv in (v or {}).items() if kk != "profile"}
              for k, v in readings.items() if k.startswith(skin + "/")})

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")
    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass

    RESULT["captures_dir"] = ROOT
    # THE DISTINCTNESS CLAUSE, before any reading is interpreted.
    prints = [p for p in (RESULT.get("capture_hashes") or {}).values() if p]
    distinct = len(set(prints))
    RESULT["distinct_captures"] = {"files": len(prints), "distinct": distinct}
    record("E_DISTINCT", "each capture is a different picture", len(prints) > 0 and distinct == len(prints),
           files=len(prints), distinct=distinct,
           note="thirty byte-identical PNGs passed a clause that counted files. In simulate mode there is no "
                "player camera, so the skins, the hour and the camera all changed and the photograph did not. "
                "A run whose pictures are all the same photographed the editor, not the game.")

    record("E01", "every skin was photographed at every hour and distance the founder listed",
           len(shots) >= len(SKINS) * len(HOURS) * len(VIEWS), taken=len(shots),
           wanted=len(SKINS) * len(HOURS) * len(VIEWS), where=ROOT)

    # ---- RELAY OG IS THE FOUNDER'S SUBJECT, so it is judged and the rest are inspected.
    def ratio(key):
        return (readings.get(key) or {}).get("trough_over_dimmer_peak")

    og = {}
    for hour_label, _ in HOURS:
        for view_label, _d in VIEWS:
            og["%s/%s" % (hour_label, view_label)] = ratio("relay_og/%s/%s" % (hour_label, view_label))
    RESULT["relay_og_gap"] = og
    # THE isinstance GUARD IS WHAT SAVED E02 AND E03 FROM THE SAME VACUOUS PASS, and it is worth saying so
    # rather than leaving it as a lucky habit: every value came back None on the first run, isinstance rejected
    # each one, and both clauses failed honestly. E04 had no such guard and passed. Same run, same data.
    record("E02", "Relay OG shows a dark gap between two eyes at every hour and distance",
           bool(og) and all(isinstance(v, float) and v <= GAP_RATIO for v in og.values()),
           trough_over_dimmer_peak=og, ceiling=GAP_RATIO,
           note="the darkest point between the two brightest peaks, as a fraction of the dimmer peak. This "
                "cannot be passed by dimming the eyes: lowering both peaks lowers the trough with them and "
                "leaves the ratio unchanged, which is the failure the founder named explicitly.")

    sym = {}
    for hour_label, _ in HOURS:
        for view_label, _d in VIEWS:
            sym["%s/%s" % (hour_label, view_label)] = (
                readings.get("relay_og/%s/%s" % (hour_label, view_label)) or {}).get("symmetry")
    RESULT["relay_og_symmetry"] = sym
    record("E03", "the two eyes are symmetrical about the centreline",
           bool(sym) and all(isinstance(v, float) and v >= 0.70 for v in sym.values()),
           symmetry=sym, floor=0.70,
           note="the dimmer peak over the brighter. The founder asked for them kept 'perfectly symmetrical "
                "around the visor/head centerline', and a lit figure photographed from slightly off-axis will "
                "never read 1.000, so this asks whether one eye is materially dimmer than the other.")

    # ---- AND EVERY OTHER SKIN, INSPECTED RATHER THAN REDESIGNED.
    #
    # FOUNDER: "After Relay OG is corrected, quickly inspect every other mascot skin for the same eye-merging
    # problem, but do not unnecessarily redesign skins whose eye spacing is already correct." So this reports
    # which skins merge and changes nothing about them. A skin that already separates is left alone.
    others = {}
    for skin in SKINS:
        if skin == "relay_og":
            continue
        worst = None
        worst_at = None
        for hour_label, _ in HOURS:
            for view_label, _d in VIEWS:
                r = ratio("%s/%s/%s" % (skin, hour_label, view_label))
                if isinstance(r, float) and (worst is None or r > worst):
                    worst, worst_at = r, "%s/%s" % (hour_label, view_label)
        others[skin] = {"worst_gap_ratio": worst, "worst_at": worst_at,
                        "merges": (worst is not None and worst > GAP_RATIO)}
    RESULT["other_skins"] = others
    merging = sorted(k for k, v in others.items() if v.get("merges"))
    RESULT["skins_that_merge"] = merging or None
    # E04 PASSED VACUOUSLY ON ITS FIRST RUN, on zero readings. Every skin errored out, `others` held five
    # entries whose worst_gap_ratio was None, nothing was flagged as merging, and "no other skin merges its
    # eyes" reported PASS over a run that had not photographed anything. A clause whose failure condition is a
    # non-empty list passes hardest when the list could not be built.
    #
    # So it now requires a MEASUREMENT for every skin it claims to clear.
    measured = [k for k, v in others.items() if isinstance(v.get("worst_gap_ratio"), float)]
    record("E04", "no other skin merges its eyes into one mass",
           not merging and len(measured) == len(SKINS) - 1,
           per_skin=others, merging=merging or None, measured=sorted(measured),
           wanted=len(SKINS) - 1, ceiling=GAP_RATIO,
           note="reported, not corrected. The founder's instruction is to inspect the others and not to "
                "redesign the ones that are already right, so this names the ones that are not.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
