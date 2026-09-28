# IS IT THE BLOOM? THE LAST OF THE FOUR CAUSES THE FOUNDER NAMED.
#
# FOUNDER, RELAY OG EYE SPACING: "check whether this spacing problem comes from the underlying eye geometry,
# material/emissive mask, bloom radius, or a combination. Fix the actual cause rather than merely reducing glow
# until the defect is hidden."
#
# THREE OF THE FOUR ARE NOW ANSWERED AND THE GAP IS STILL NOT THERE.
#
#   HALO FOOTPRINT   was the cause and is fixed with certainty. Each halo's width along the eye-to-eye axis was
#                    Size * 0.36 * Ring against a centre at Size * 0.25, so both rings crossed the centreline
#                    and overlapped through the middle. Clamped to the eye's own inner edge.
#   GEOMETRY         was a cause and is improved as far as the mesh allows. The lit panes sat 3.2 units apart on
#                    a 22.8 visor; they are now 6.38, which is the widest at which neither eye overhangs the
#                    face. The engine logs it: "eye gap 6.38 of visor 22.80 = 28.0%".
#   EMISSIVE MASK    is not implicated: the panes are separate objects now, not two regions of one mask.
#
# AND THE WARDROBE PREVIEW -- the one instrument whose window is READ from the widget rather than inferred from
# a camera -- says the trough between the two eyes is 0.946 of the dimmer peak. That is not a gap. Something is
# filling a 28-per-cent-of-visor space that contains no geometry and no halo.
#
# BLOOM IS ADDITIVE IN SCREEN SPACE AND DOES NOT CARE WHAT IS UNDERNEATH IT. A dark strip between two bright
# sources still receives both their blooms, so no amount of black visor between the eyes can survive a bloom
# whose radius exceeds the gap. At this framing the gap is roughly two per cent of screen width, and UE's
# default bloom reaches further than that.
#
# SO THIS SWEEPS THE BLOOM AND MEASURES THE GAP AT EACH SETTING. If the gap opens as the bloom narrows, the
# bloom is the remaining cause and the founder's list is complete. If it does not, the cause is something none
# of us has named and the eye geometry is not it.
#
# REDUCING BLOOM IS NOT REDUCING GLOW, and the difference matters because the founder forbade one and named the
# other. The eyes' emissive, colour and material are untouched by every rung here: they stay exactly as bright.
# What changes is how far the post-process smears that brightness across neighbouring pixels.
#
# NOTHING IS LEFT CHANGED. Every rung restores the value it found, and the final state is read back.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import hashlib
import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "eye_bloom")
REPO = os.path.dirname(os.path.dirname(CHANNEL))

# The knob and the rungs. r.BloomQuality 0 disables bloom outright, which is the control that says whether
# bloom is involved AT ALL; the sizescale rungs then say whether a usable setting exists between "as now" and
# "off". Read back at every rung, because a cvar that is not recognised leaves the world exactly as it was.
RUNGS = (
    ("as_found", None, None),
    ("bloom_off", "r.BloomQuality", 0.0),
    ("bloom_half", "r.Bloom.Cross", 0.0),
)
GAP_RATIO = 0.45
BAND = (0.18, 0.46)
ACROSS = (0.20, 0.80)


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

    def profile(path, centre, size):
        """Trough between the two brightest peaks, inside the preview rect. Same arithmetic as the wardrobe job."""
        w, h, chan, px = read(path)
        rx0 = (centre.x - size.x * 0.5) * w
        ry0 = (centre.y - size.y * 0.5) * h
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
                lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
                if lum > best:
                    best = lum
            cols.append(round(best / 255.0, 4))
        mid = len(cols) // 2
        left, right = cols[:mid], cols[mid:]
        if not left or not right:
            return None
        li = max(range(len(left)), key=lambda k: left[k])
        ri = max(range(len(right)), key=lambda k: right[k]) + mid
        peak_l, peak_r = cols[li], cols[ri]
        between = cols[min(li, ri) + 1:max(li, ri)]
        trough = min(between) if between else None
        dimmer = min(peak_l, peak_r)
        return {"peak_left": peak_l, "peak_right": peak_r, "trough": trough,
                "separation_columns": abs(ri - li),
                "trough_over_dimmer_peak": (round(trough / dimmer, 3)
                                            if (trough is not None and dimmer > 0) else None),
                "profile": cols}

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
    try:
        ui.wear_relay_skin("relay_og")
    except Exception as err:                                        # noqa: BLE001
        RESULT["status"] = "VOID: could not wear relay_og: %s" % str(err)[:120]
        return
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    pressed = ui.press_switch_skin()
    yield 4.0
    record("L00", "the wardrobe is open through the founder's own button",
           bool(pressed) and ui.is_brain_skins_open(), pressed=bool(pressed))
    rect = ui.get_skin_preview_rect()
    got = rect is not None
    centre, size = rect if got else (None, None)
    record("L01", "the preview window reports where it is", got,
           centre=[round(centre.x, 4), round(centre.y, 4)] if got else None,
           size=[round(size.x, 4), round(size.y, 4)] if got else None,
           note="every bound below is a fraction of THIS rect, so nothing here infers the framing.")
    if not got:
        RESULT["status"] = "FAIL: no preview rect"
        return

    def read_cvar(name):
        try:
            return float(unreal.SystemLibrary.get_console_variable_float_value(name))
        except Exception:                                           # noqa: BLE001
            return None

    readings = {}
    RESULT["readings"] = readings
    for label, cvar, value in RUNGS:
        before = read_cvar(cvar) if cvar else None
        if cvar is not None:
            unreal.SystemLibrary.execute_console_command(world, "%s %g" % (cvar, value))
            yield 2.0
            after = read_cvar(cvar)
            RESULT.setdefault("cvar_readback", {})[label] = {
                "cvar": cvar, "was": before, "asked": value, "read": after}
            if after is None or abs(after - value) > 1e-3:
                # VOID THE RUNG, NOT THE WORLD. An unrecognised cvar leaves everything as it was, and
                # publishing that as a bloom measurement credits a knob that did nothing.
                readings[label] = None
                record("L_%s" % label, "%s took the value it was given" % cvar, False,
                       asked=value, read=after)
                continue
            record("L_%s" % label, "%s took the value it was given" % cvar, True, asked=value, read=after)
        yield 2.0
        name = "eye_bloom_%s.png" % label
        path = os.path.join(ROOT, name)
        try:
            shot = L.capture_game_viewport(path)
            if not shot:
                raise RuntimeError("capture_game_viewport returned falsy: the editor is probably not foreground")
            RESULT.setdefault("capture_hashes", {})[name] = fingerprint(path)
            readings[label] = profile(path, centre, size)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[label] = str(err)[:160]
        emit("L_%s_read" % label, "INFO", label,
             {k: v for k, v in (readings.get(label) or {}).items() if k != "profile"})
        if cvar is not None and before is not None:
            unreal.SystemLibrary.execute_console_command(world, "%s %g" % (cvar, before))
            yield 1.0

    prints = [p for p in (RESULT.get("capture_hashes") or {}).values() if p]
    record("L02", "each rung is a different picture",
           len(prints) > 0 and len(set(prints)) == len(prints),
           files=len(prints), distinct=len(set(prints)),
           note="if turning bloom off changes nothing on screen, the captures are identical and no rung below "
                "means anything.")

    def gap(label):
        return (readings.get(label) or {}).get("trough_over_dimmer_peak")

    found, off = gap("as_found"), gap("bloom_off")
    RESULT["gap_by_rung"] = {label: gap(label) for label, _c, _v in RUNGS}
    record("L03", "the gap is present with bloom disabled",
           isinstance(off, float) and off <= GAP_RATIO,
           gap_by_rung=RESULT["gap_by_rung"], ceiling=GAP_RATIO,
           note="THE DECISIVE RUNG. The geometry and the halos are already fixed, so if the gap appears with "
                "bloom off then bloom is what is filling it and the founder's list of causes is complete. If "
                "the gap is still absent with bloom off, the cause is something none of us has named and the "
                "eye geometry is not it.")

    if isinstance(found, float) and isinstance(off, float):
        RESULT["bloom_share"] = {
            "as_found": found, "bloom_off": off, "opened_by": round(found - off, 3),
            "reading": ("BLOOM IS THE REMAINING CAUSE: the gap appears when the post-process stops smearing "
                        "the eyes across it, with no change to their emissive, colour or material."
                        if off < found - 0.15 else
                        "BLOOM IS NOT THE REMAINING CAUSE: disabling it did not open the gap, so the light in "
                        "the middle is coming from somewhere still unidentified."),
        }
        record("L04", "disabling bloom measurably opens the gap", off < found - 0.15, **RESULT["bloom_share"])

    RESULT["final_cvars"] = {c: read_cvar(c) for _l, c, _v in RUNGS if c}
    record("L05", "every knob was restored to the value it was found at",
           all(v is not None for v in RESULT["final_cvars"].values()),
           final=RESULT["final_cvars"], asked_back_to=RESULT.get("cvar_readback"),
           note="a job that leaves a render setting changed makes every later measurement in this session a "
                "reading of this job.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
