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

    def profile(path, band=(0.36, 0.52), across=(0.30, 0.70)):
        """The horizontal luma profile across the eye band, and what it says about two eyes.

        band is the vertical slice of the frame the eyes sit in, as fractions of frame height; across is the
        horizontal window. Both are wide enough to contain the visor at either framing and narrow enough to
        exclude the ghostfire above the head and the chest emblem below it.
        """
        w, h, chan, px = read(path)
        y0, y1 = int(band[0] * h), int(band[1] * h)
        x0, x1 = int(across[0] * w), int(across[1] * w)
        cols = []
        for x in range(x0, x1):
            best = 0.0
            for y in range(y0, y1):
                i = (y * w + x) * chan
                lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
                # THE BRIGHTEST PIXEL IN THE COLUMN, NOT THE MEAN. A mean across the band dilutes a small
                # bright eye with the dark visor around it and turns two eyes into one shallow hill; the
                # founder is looking at the bright parts, so the profile follows them.
                if lum > best:
                    best = lum
            cols.append(round(best / 255.0, 4))
        if not cols:
            return None
        mid = len(cols) // 2
        left = cols[:mid]
        right = cols[mid:]
        if not left or not right:
            return None
        li = max(range(len(left)), key=lambda k: left[k])
        ri = max(range(len(right)), key=lambda k: right[k]) + mid
        peak_l, peak_r = cols[li], cols[ri]
        # the darkest column strictly between the two peaks
        between = cols[min(li, ri) + 1:max(li, ri)]
        trough = min(between) if between else None
        dimmer = min(peak_l, peak_r)
        return {
            "columns": len(cols),
            "peak_left": peak_l, "peak_right": peak_r,
            "peak_left_at": round(li / float(len(cols)), 3), "peak_right_at": round(ri / float(len(cols)), 3),
            "separation_columns": abs(ri - li),
            "trough": trough,
            "trough_over_dimmer_peak": (round(trough / dimmer, 3) if (trough is not None and dimmer > 0) else None),
            "symmetry": (round(min(peak_l, peak_r) / max(peak_l, peak_r), 3) if max(peak_l, peak_r) > 0 else None),
            "profile": cols,
        }

    if ues.get_game_world() is None:
        les.editor_play_simulate()
    yield (lambda: ues.get_game_world() is not None, 300)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 180)
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 6.0

    ui = None
    for candidate in ("WonderlandUiTestLibrary",):
        ui = L
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
            L.wear_relay_skin(skin)
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
                    readings[key] = profile(path)
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
        L.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass

    RESULT["captures_dir"] = ROOT
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
    record("E04", "no other skin merges its eyes into one mass", not merging,
           per_skin=others, merging=merging or None, ceiling=GAP_RATIO,
           note="reported, not corrected. The founder's instruction is to inspect the others and not to "
                "redesign the ones that are already right, so this names the ones that are not.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
