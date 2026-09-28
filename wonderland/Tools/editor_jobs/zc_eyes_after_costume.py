# DOES THE DOG STILL HAVE TWO EYES AFTER WEARING A COSTUME AND TAKING IT OFF?
#
# THIS TESTS A BUG THAT WAS NEVER PHOTOGRAPHED, because I found it by reading and fixed it before it shipped.
# BuildEyeGlow hides the Blueprint's combined two-pane eye mesh and draws two panes of its own, farther apart.
# ShowCanonBody shows EVERY static mesh component that is not tagged WL_Prop. So the first time the Dog came
# back from a costume to Relay OG it would have un-hidden the original pane and drawn it ALONGSIDE both
# replacements: three glowing regions instead of two, reaching the founder as a worse version of the defect
# they reported.
#
# The pane is now tagged WL_EyeReplaced before it is hidden and ShowCanonBody leaves it alone. A fix found by
# reading is exactly the kind that rots, because nothing fails when it is undone -- the tag could be dropped in
# a refactor, or a future author could add a third place that iterates the meshes, and the only symptom is a
# photograph nobody is taking.
#
# WHAT IT MEASURES: the same chroma profile the wardrobe job uses, before and after a costume round trip. Two
# eyes have two peaks and a trough; three eyes have a peak in the MIDDLE where the trough was. So the test is
# not "is there still a gap" but "is the profile the SAME SHAPE it was" -- which catches a third eye appearing
# between the two, and would not be caught by a gap clause at all, since a middle eye leaves two outer peaks.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import hashlib
import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eyes_after_costume")
REPO = os.path.dirname(os.path.dirname(CHANNEL))

BAND = (0.18, 0.46)
ACROSS = (0.20, 0.80)
CHROMA_FLOOR = 0.10
# A column counts as part of a bright region at this fraction of the tallest chroma in the band.
PEAK_PROMINENCE = 0.35
# How much the middle of the visor may brighten across a round trip before it is a new light and not noise.
MIDDLE_TOLERANCE = 0.15


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

    def fingerprint(path):
        try:
            with open(path, "rb") as fh:
                return hashlib.md5(fh.read()).hexdigest()
        except Exception:                                           # noqa: BLE001
            return None

    def columns(path, centre, size):
        """Chroma per column inside the preview rect. See zc_wardrobe_eyes for why chroma and not luma."""
        w, h, chan, px = read(path)
        rx0, ry0 = (centre.x - size.x * 0.5) * w, (centre.y - size.y * 0.5) * h
        rw, rh = size.x * w, size.y * h
        x0, x1 = max(int(rx0 + ACROSS[0] * rw), 0), min(int(rx0 + ACROSS[1] * rw), w)
        y0, y1 = max(int(ry0 + BAND[0] * rh), 0), min(int(ry0 + BAND[1] * rh), h)
        if x1 - x0 < 8 or y1 - y0 < 2:
            return None
        cols = []
        for x in range(x0, x1):
            best = 0.0
            for y in range(y0, y1):
                i = (y * w + x) * chan
                r, g, b = px[i], px[i + 1], px[i + 2]
                v = max(r, g, b) - min(r, g, b)
                if v > best:
                    best = v
            cols.append(best / 255.0)
        return cols

    def shape(cols):
        """What the profile looks like, in terms that can be COMPARED across a round trip.

        AN ABSOLUTE PEAK COUNT DOES NOT WORK, AND I CHECKED BEFORE SHIPPING IT. Counting the runs above a
        fraction of the tallest chroma gave 3 for Relay OG, 8 for Arden Infernal and 6 for Apollo on the
        captures already on disk, every one of which plainly has two eyes. The band contains other coloured
        detail: visor edges, brow trim, whatever a costume puts near the face. A counter tuned until Relay OG
        reads 2 would be tuned to one skin's ornament.

        SO THE TEST IS THE CHANGE, NOT THE COUNT. The bug this job exists for puts a THIRD EYE BETWEEN THE
        TWO, so it shows as chroma rising in the MIDDLE while the outer peaks stay exactly where they were. A
        gap clause cannot see that, because the outer peaks do not move. The middle can: it is the same
        quantity measured twice on the same skin, and only a new light there can raise it.
        """
        if not cols:
            return None
        top = max(cols)
        if top < CHROMA_FLOOR:
            return None
        n = len(cols)
        cut = top * PEAK_PROMINENCE
        bright = [i for i, v in enumerate(cols) if v >= cut]
        if len(bright) < 2:
            return None
        lo, hi = bright[0], bright[-1]
        mid = (lo + hi) // 2
        half = max((hi - lo) // 10, 2)
        middle = cols[max(mid - half, 0):min(mid + half + 1, n)]
        if not middle:
            return None
        return {"tallest": round(top, 4),
                "outer_span": [lo, hi], "outer_span_fraction": round((hi - lo) / float(n), 3),
                "middle_over_tallest": round((sum(middle) / len(middle)) / top, 3),
                "middle_peak_over_tallest": round(max(middle) / top, 3)}

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
        return
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    pressed = ui.press_switch_skin()
    yield 4.0
    record("R00", "the wardrobe is open through the founder's own button",
           bool(pressed) and ui.is_brain_skins_open(), pressed=bool(pressed))
    rect = ui.get_skin_preview_rect()
    got = rect is not None
    centre, size = rect if got else (None, None)
    record("R01", "the preview window reports where it is", got)
    if not got:
        RESULT["status"] = "FAIL: no preview rect"
        return

    readings = {}
    RESULT["readings"] = readings

    def shoot(label):
        name = "eyes_%s.png" % label
        path = os.path.join(ROOT, name)
        try:
            shot = L.capture_game_viewport(path)
            if not shot:
                raise RuntimeError("capture_game_viewport returned falsy: the editor is probably not foreground")
            RESULT.setdefault("capture_hashes", {})[name] = fingerprint(path)
            cols = columns(path, centre, size)
            readings[label] = shape(cols) if cols else None
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[label] = str(err)[:160]
        emit("R_%s" % label, "INFO", label, readings.get(label))

    # ---- THE ROUND TRIP. Relay OG, then a costume, then Relay OG again.
    for step, skin in (("before", "relay_og"), ("costume", "skeleton_flame"), ("after", "relay_og")):
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[step] = str(err)[:140]
            continue
        # THE STAGE HAS TO REDRAW. A capture taken before the wardrobe restages photographs the PREVIOUS skin,
        # which on a round trip would show "before" and "after" as identical for the wrong reason.
        yield 7.0
        shoot(step)

    prints = [p for p in (RESULT.get("capture_hashes") or {}).values() if p]
    record("R02", "each capture is a different picture",
           len(prints) == 3 and len(set(prints)) == 3,
           files=len(prints), distinct=len(set(prints)),
           note="if the wardrobe did not restage, before and after are the same file and this job would pass "
                "by photographing one moment three times.")

    before = readings.get("before") or {}
    after = readings.get("after") or {}
    RESULT["shape"] = dict(readings)
    # THE MEAN OF THE MIDDLE, NOT ITS PEAK, and the existing captures say why. middle_peak_over_tallest reads
    # 0.839 for Relay OG, 0.909 for Arden and 1.000 for Skeleton Flame -- it is high for everything, because
    # the middle window straddles the inner edges of the two eyes whenever the span is wide. The MEAN
    # separates them properly: 0.216 for Relay OG's dark gap against 0.980 for Skeleton Flame's flat band.
    # Both are published; the clause turns on the one that discriminates.
    b_mid = before.get("middle_over_tallest")
    a_mid = after.get("middle_over_tallest")
    record("R03", "the face was measurable before and after the costume",
           isinstance(b_mid, float) and isinstance(a_mid, float),
           before=before or None, after=after or None,
           note="an unmeasurable reading here VOIDS the comparison rather than passing it: two Nones are "
                "equal, and equality is exactly what this job tests.")
    record("R04", "the middle of the visor did not light up after a costume round trip",
           isinstance(b_mid, float) and isinstance(a_mid, float) and a_mid <= b_mid + MIDDLE_TOLERANCE,
           before_middle=b_mid, after_middle=a_mid, tolerance=MIDDLE_TOLERANCE,
           note="THE BUG THIS JOB EXISTS FOR puts a third eye BETWEEN the two, because ShowCanonBody would "
                "un-hide the original combined pane and draw it alongside both replacements. A gap clause "
                "cannot catch it, since the outer peaks do not move, and an absolute peak count cannot be "
                "trusted: counting bright runs gives 3 for Relay OG and 8 for Arden on captures that plainly "
                "show two eyes.")
    b_span = before.get("outer_span_fraction")
    a_span = after.get("outer_span_fraction")
    record("R05", "the eyes are in the same place after as before",
           isinstance(b_span, float) and isinstance(a_span, float) and abs(a_span - b_span) <= 0.06,
           before_span=b_span, after_span=a_span, tolerance=0.06)

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
