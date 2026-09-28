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
# The band of the frame the figure's legs occupy, as fractions of frame height. Published with every reading.
LEG_BAND = (0.52, 0.86)
ACROSS = (0.34, 0.66)
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
    RESULT["framing"] = {"distance_uu": DISTANCE, "fov_deg": FOV, "leg_band": LEG_BAND, "across": ACROSS,
                         "note": "the legs only: costumes differ above the waist by design, so a whole "
                                 "silhouette would report approved ornament as a stance fault."}

    def record(tid, name, ok, **detail):
        RESULT["tests"].append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    def fingerprint(path):
        try:
            with open(path, "rb") as fh:
                return hashlib.md5(fh.read()).hexdigest()
        except Exception:                                           # noqa: BLE001
            return None

    def leg_profile(path):
        """For each column of the leg band, how far down the figure reaches, as a fraction of the band.

        THE BACKGROUND IS SAMPLED, NOT ASSUMED. A corner of the frame gives the world behind the Dog, and a
        column belongs to the figure where it departs from that. This is why the job can run at any hour and
        in any district without a keyed backdrop.
        """
        w, h, chan, px = read(path)

        def lum(x, y):
            i = (y * w + x) * chan
            return (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255.0

        corners = [lum(4, 4), lum(w - 5, 4), lum(4, h - 5), lum(w - 5, h - 5)]
        back = sorted(corners)[len(corners) // 2]
        x0, x1 = int(ACROSS[0] * w), int(ACROSS[1] * w)
        y0, y1 = int(LEG_BAND[0] * h), int(LEG_BAND[1] * h)
        span = max(y1 - y0, 1)
        prof, filled = [], 0
        for x in range(x0, x1):
            deepest = None
            for y in range(y0, y1):
                if abs(lum(x, y) - back) >= FIGURE_DELTA:
                    deepest = y
            if deepest is None:
                prof.append(0.0)
            else:
                prof.append(round((deepest - y0) / float(span), 4))
                filled += 1
        return {"columns": len(prof), "filled": filled,
                "background_luma": round(back, 4),
                "band_rows": [y0, y1], "profile": prof,
                # A figure that is not in the band at all gives an empty profile, and a comparison of two
                # empty profiles agrees perfectly. That must not read as a pass.
                "usable": filled >= len(prof) * 0.25}

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
        try:
            shot = L.capture_game_viewport(path)
            if not shot:
                raise RuntimeError("capture_game_viewport returned falsy: the editor is probably not foreground")
            RESULT.setdefault("capture_hashes", {})[name] = fingerprint(path)
            readings[skin] = leg_profile(path)
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
    prints = [p for p in (RESULT.get("capture_hashes") or {}).values() if p]
    record("T00", "each skin is a different picture",
           len(prints) == len(SKINS) and len(set(prints)) == len(prints),
           files=len(prints), distinct=len(set(prints)),
           note="five skins photographed from one camera is exactly the shape that yields identical frames if "
                "the costume did not restage, and identical frames would pass a stance comparison perfectly.")

    usable = [s for s in SKINS if (readings.get(s) or {}).get("usable")]
    record("T01", "every skin's legs are actually in the measured band",
           len(usable) == len(SKINS), usable=sorted(usable),
           filled={s: (readings.get(s) or {}).get("filled") for s in SKINS},
           band=LEG_BAND,
           note="an empty profile compares equal to another empty profile. If the figure is not in the band, "
                "this job would report perfect agreement between two pictures of nothing.")
    if len(usable) < len(SKINS):
        RESULT["status"] = "VOID: at least one skin's legs were not in the band, so no comparison is valid"
        return

    # ---- RELAY OG IS THE AUTHORITY, so every other skin is compared to IT and not to an average.
    base = (readings.get("relay_og") or {}).get("profile") or []
    diffs = {}
    for skin in SKINS:
        if skin == "relay_og":
            continue
        other = (readings.get(skin) or {}).get("profile") or []
        if len(other) != len(base) or not base:
            diffs[skin] = None
            continue
        worst = max(abs(a - b) for a, b in zip(base, other))
        mean = sum(abs(a - b) for a, b in zip(base, other)) / float(len(base))
        diffs[skin] = {"worst_column": round(worst, 4), "mean_column": round(mean, 4)}
    RESULT["vs_relay_og"] = diffs
    off = sorted(k for k, v in diffs.items()
                 if v is None or v["worst_column"] > PROFILE_TOLERANCE)
    RESULT["skins_that_stand_differently"] = off or None
    record("T02", "every skin's legs sit where Relay OG's legs sit",
           not off, vs_relay_og=diffs, tolerance=PROFILE_TOLERANCE, differing=off or None,
           note="the founder's item 3 is that one canonical behaviour stack drives every skin and the skins "
                "are cosmetic. The plumbing for that exists -- the Dog publishes a worn pose and the costume "
                "has joint writers for it -- and this is the first reading of whether it ARRIVES. Measured on "
                "the rendered silhouette rather than by reading the pose back, because the founder ruled out "
                "proving a stance from the value that was handed over.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
