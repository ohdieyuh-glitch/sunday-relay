# TWO EYES IN THE WARDROBE PREVIEW, FOR EVERY SKIN.
#
# FOUNDER, RELAY OG EYE SPACING, in the list of views that must be verified: "3. Wardrobe preview". And the
# Skeleton Flame note ends its own list with "Wardrobe preview" too. Both say the rendered result is the
# acceptance test.
#
# WHY THIS IS A SEPARATE JOB FROM THE IN-WORLD ONE, and why it is the better instrument of the two. The
# in-world profile has to GUESS where the figure is: the first version used a fixed band, the second searched
# for the brightest row and found lamps and lit walls, and the third derives a window from the camera distance.
# All three are inferences about framing.
#
# THE WARDROBE KNOWS. GetSkinPreviewRect returns the preview window's centre and size in normalised screen
# coordinates, so the figure's location is READ rather than estimated, and the eye band is a fraction of a
# known rect instead of a fraction of the screen. Nothing here can wander onto the world, because the world is
# not in the window.
#
# It is also the founder's own route: the Brain is opened and SWITCH SKIN is PRESSED, because
# SetBrainSkinsOpen is a second door that every earlier wardrobe proof went through while the founder went
# through the button -- and the two behaved differently, which is how the preview once showed the Brain
# chamber instead of the Dog.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import hashlib
import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wardrobe_eyes")
REPO = os.path.dirname(os.path.dirname(CHANNEL))

SKINS = ("relay_og", "skeleton_flame", "apollo", "arden_infernal", "celestial_light")
# A trough this dark relative to the dimmer eye counts as a black gap. Same judgement as the in-world job, so
# the two are comparable; stated as a judgement rather than a standard.
GAP_RATIO = 0.45
# The eyes sit in the upper part of the figure, which stands in the lower-middle of the preview square. These
# fractions are OF THE PREVIEW RECT, not of the screen, and they are published with every reading.
BAND = (0.18, 0.46)
ACROSS = (0.20, 0.80)



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
    RESULT["band_of_preview_rect"] = {"vertical": BAND, "across": ACROSS}

    def record(tid, name, ok, **detail):
        RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def fingerprint(path):
        try:
            with open(path, "rb") as fh:
                return hashlib.md5(fh.read()).hexdigest()
        except Exception:                                           # noqa: BLE001
            return None

    def profile(path, centre, size):
        """The horizontal luma profile across the eye band INSIDE the preview rect.

        centre and size are normalised screen coordinates from GetSkinPreviewRect, so every bound below is a
        fraction of a window whose position was read from the widget rather than assumed.
        """
        w, h, chan, px = read(path)
        rx0 = (centre.x - size.x * 0.5) * w
        ry0 = (centre.y - size.y * 0.5) * h
        rw, rh = size.x * w, size.y * h
        x0, x1 = int(rx0 + ACROSS[0] * rw), int(rx0 + ACROSS[1] * rw)
        y0, y1 = int(ry0 + BAND[0] * rh), int(ry0 + BAND[1] * rh)
        x0, x1 = max(x0, 0), min(x1, w)
        y0, y1 = max(y0, 0), min(y1, h)
        if x1 - x0 < 8 or y1 - y0 < 2:
            return None
        cols = []
        for x in range(x0, x1):
            best = 0.0
            for y in range(y0, y1):
                i = (y * w + x) * chan
                r, g, b = px[i], px[i + 1], px[i + 2]
                lum = max(r, g, b) - min(r, g, b)          # chroma: see the note above two_peaks
                # The brightest pixel in the column, not the mean: a mean dilutes a small bright eye with the
                # dark visor around it and turns two eyes into one shallow hill.
                if lum > best:
                    best = lum
            cols.append(round(best / 255.0, 4))
        got = two_peaks(cols)
        if got is None:
            return None
        got["columns"] = len(cols)
        got["rect_pixels"] = [x0, y0, x1, y1]
        return got

    # ---- REAL PLAY, NOT SIMULATE. See Tools/editor_jobs/README.md: in simulate there is no player camera and
    # every capture is a photograph of the editor.
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

    ui = L.get_ui(world)
    if ui is None:
        RESULT["status"] = "VOID: no UI subsystem"
        record("Q00", "the UI subsystem is reachable", False)
        return
    record("Q00", "the UI subsystem is reachable", True)

    for cvar in ("wl.Dog.EyeSpread", "wl.Dog.EyeGap"):
        try:
            RESULT.setdefault("settings", {})[cvar] = float(
                unreal.SystemLibrary.get_console_variable_float_value(cvar))
        except Exception:                                           # noqa: BLE001
            RESULT.setdefault("settings", {})[cvar] = None
    record("Q01", "this build carries the eye spacing controls",
           (RESULT.get("settings") or {}).get("wl.Dog.EyeSpread") is not None,
           settings=RESULT.get("settings"),
           note="an editor built before the fix reports neither cvar, and every profile below would describe "
                "the old eyes while reading as a result for the new ones.")

    # ---- THE FOUNDER'S ROUTE: the Brain, then the BUTTON.
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    record("Q02", "the Project Brain is open", ui.is_project_brain_open())
    pressed = ui.press_switch_skin()
    yield 4.0
    record("Q03", "SWITCH SKIN was pressed and the wardrobe opened from that press alone",
           bool(pressed) and ui.is_brain_skins_open(),
           pressed=bool(pressed), skins_open=ui.is_brain_skins_open(),
           note="SetBrainSkinsOpen is a second door. Every earlier wardrobe proof used it and the founder uses "
                "the button; the two behaved differently, which is how the preview once showed the Brain "
                "chamber instead of the Dog.")

    # Unreal folds a bool return with out-params into "tuple or None": None IS the false.
    rect = ui.get_skin_preview_rect()
    got = rect is not None
    centre, size = rect if got else (None, None)
    RESULT["preview_rect"] = {
        "got": got,
        "centre": [round(centre.x, 4), round(centre.y, 4)] if got else None,
        "size": [round(size.x, 4), round(size.y, 4)] if got else None,
    }
    record("Q04", "the preview window has painted and reports where it is", got, **RESULT["preview_rect"])
    if not got:
        RESULT["status"] = "FAIL: no preview rect, so no reading can be located"
        return

    readings = {}
    RESULT["readings"] = readings
    shots = []
    for skin in SKINS:
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:140]
            continue
        # THE STAGE HAS TO HAVE DRAWN. The wardrobe stages a figure and frames a camera on it, and a capture
        # taken before that lands photographs the previous skin -- which would read as a perfect A/B.
        yield 6.0
        name = "wardrobe_eyes_%s.png" % skin
        path = os.path.join(ROOT, name)
        try:
            shot = L.capture_game_viewport(path)
            if not shot:
                raise RuntimeError("capture_game_viewport returned falsy: the editor window is probably not "
                                   "foreground")
            shots.append(name)
            RESULT.setdefault("capture_hashes", {})[name] = fingerprint(path)
            readings[skin] = profile(path, centre, size)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:160]
        emit("Q_%s" % skin, "INFO", "%s in the preview" % skin,
             {k: v for k, v in (readings.get(skin) or {}).items() if k != "profile"})

    RESULT["captures_dir"] = ROOT

    prints = [p for p in (RESULT.get("capture_hashes") or {}).values() if p]
    distinct = len(set(prints))
    RESULT["distinct_captures"] = {"files": len(prints), "distinct": distinct}
    record("Q05", "each capture is a different picture",
           len(prints) > 0 and distinct == len(prints), files=len(prints), distinct=distinct,
           note="five skins staged in one window is exactly the shape that produces identical captures if the "
                "stage has not redrawn, and identical captures read as a perfect result.")

    def ratio(skin):
        return (readings.get(skin) or {}).get("trough_over_dimmer_peak")

    og = ratio("relay_og")
    RESULT["relay_og_gap"] = og
    RESULT["relay_og_unmeasurable"] = (readings.get("relay_og") or {}).get("unmeasurable")
    record("Q06", "Relay OG shows a dark gap between two eyes in the Wardrobe preview",
           isinstance(og, float) and og <= GAP_RATIO,
           trough_over_dimmer_peak=og, ceiling=GAP_RATIO,
           note="the darkest point between the two brightest peaks, as a fraction of the dimmer peak. Dimming "
                "the eyes cannot pass this: both peaks and the trough fall together and the ratio does not "
                "move, which is the failure the founder named explicitly.")

    sym = (readings.get("relay_og") or {}).get("symmetry")
    record("Q07", "the two eyes are symmetrical about the centreline", isinstance(sym, float) and sym >= 0.70,
           symmetry=sym, floor=0.70,
           note="the dimmer peak over the brighter. The preview is a fixed three-quarter framing, so this can "
                "be stricter than the in-world one and still fair.")

    # ---- UNMEASURABLE IS NEITHER PASS NOR FAIL, and saying so is the whole point of the chroma floor.
    #
    # Celestial Light's eyes are (0.62, 0.88, 1.00): nearly white, against a nearly white head. Its chroma peak
    # is 0.059, a twentieth of Relay OG's, so a chroma profile cannot find its eyes at all and the 0.733 the
    # last run reported is noise with a ratio drawn on it. Failing it would send someone to fix a skin on the
    # strength of a number this method cannot produce; passing it would be worse.
    #
    # So the three outcomes are separated. A skin whose eyes this method CAN see is judged. A skin whose eyes
    # it cannot is named, with its peak, for a photograph to settle -- which is the founder's standard anyway.
    others, unmeasurable = {}, []
    for skin in SKINS:
        if skin == "relay_og":
            continue
        row = readings.get(skin) or {}
        r = row.get("trough_over_dimmer_peak")
        if row.get("unmeasurable"):
            unmeasurable.append(skin)
            others[skin] = {"gap_ratio": None, "merges": None,
                            "unmeasurable": True, "why": row.get("why_unmeasurable"),
                            "chroma_peak": min(row.get("peak_left") or 0.0, row.get("peak_right") or 0.0)}
        else:
            others[skin] = {"gap_ratio": r, "merges": (isinstance(r, float) and r > GAP_RATIO)}
    judged = [k for k, v in others.items() if isinstance(v.get("gap_ratio"), float)]
    merging = sorted(k for k, v in others.items() if v.get("merges"))
    RESULT["other_skins"] = others
    RESULT["skins_that_merge"] = merging or None
    RESULT["skins_unmeasurable_by_chroma"] = sorted(unmeasurable) or None
    record("Q08", "no other skin this method can read merges its eyes into one mass",
           not merging and len(judged) + len(unmeasurable) == len(SKINS) - 1,
           per_skin=others, merging=merging or None, judged=sorted(judged),
           unmeasurable=sorted(unmeasurable) or None, wanted=len(SKINS) - 1,
           note="requires an OUTCOME for every skin -- a ratio or an honest 'this method cannot see it'. The "
                "in-world version of this clause once passed over a run that had photographed nothing, because "
                "its failure condition was a non-empty list.")

    RESULT["status"] = "measured"
    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
