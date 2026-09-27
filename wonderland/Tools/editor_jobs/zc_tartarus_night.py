# TARTARUS AFTER DARK: the three places, photographed, before and after.
#
# FOUNDER, 2026-09-27, NIGHTTIME LIGHTING CORRECTION: "Capture representative BEFORE/AFTER images from the
# founder's problematic areas plus Golden Arrival, each major nation, Dubel, and connecting roads ... Do not
# report this complete because a numeric exposure/luma test passes. THE RENDERED RESULT IS THE ACCEPTANCE
# TEST."
#
# This is the Tartarus half of that, and it is a camera job: it changes nothing. Run it once before the TQ05
# lamps exist and once after, with the tag telling the two apart, and the pair is the evidence.
#
# THE THREE PLACES, chosen because they are where the nation's night actually fails rather than where it
# photographs well:
#
#   avenue_dip    the avenue at its shelf transition, 285-321 m along the route. Tartarus's 16 existing
#                 avenue lamps leave gaps of 62 m and 60 m across 217-339 m, so the ONE stretch of road with
#                 steps in it is also its darkest. "Stairs and edges can be navigated visually" fails here
#                 first.
#   quarter_plaza the quarter's paved cluster: a plaza whose own lighting is wall lanterns on the buildings
#                 around it, which light walls.
#   market        the band's stalls -- 144 canopies over 15 stalls, and not one lamp among them.
#
# Each is shot twice: a standing view down the space at eye height, and a walker's view of the ground at his
# feet, because "the path is visible" and "I can see where I am putting my foot" are different questions and
# the founder asked both.
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "tartarus_night")
TAG = JOB_ARG if "JOB_ARG" in globals() and JOB_ARG else "before"
STEP = 2
DARK = 0.14 * 255.0

# (name, eye xyz, look-at xyz) -- world coordinates read off the route and the specs, not eyeballed.
PLACES = (
    # the avenue at the dip: standing on the +12 shelf looking down into the -14 crossing
    ("avenue_dip", (71600.0, -44900.0, 330.0), (74200.0, -43700.0, 60.0)),
    ("avenue_dip_feet", (73200.0, -44200.0, 260.0), (74000.0, -43900.0, -14.0)),
    # the quarter's plaza
    ("quarter_plaza", (58200.0, -34600.0, 420.0), (61200.0, -36600.0, 60.0)),
    ("quarter_plaza_feet", (60100.0, -35800.0, 250.0), (60900.0, -36300.0, 12.0)),
    # the band's market
    ("market", (94000.0, -47200.0, 460.0), (96400.0, -49000.0, 120.0)),
    ("market_feet", (95700.0, -48400.0, 250.0), (96300.0, -48900.0, 12.0)),
)


def frame_stats(path):
    sys.path.insert(0, os.path.dirname(CHANNEL))
    from occupancy import read_png                                  # noqa: WPS433
    w, h, chan, px = read_png(path)
    vals = []
    for y in range(0, h, STEP):
        row = y * w * chan
        for x in range(0, w, STEP):
            i = row + x * chan
            vals.append(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])
    # the bottom third is the ground a walker is about to step on
    ground = []
    for y in range(int(h * 0.66), h, STEP):
        row = y * w * chan
        for x in range(0, w, STEP):
            i = row + x * chan
            ground.append(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])
    return {"luma": round(sum(vals) / float(max(len(vals), 1)) / 255.0, 4),
            "dark_fraction": round(sum(1 for v in vals if v < DARK) / float(max(len(vals), 1)), 4),
            "ground_luma": round(sum(ground) / float(max(len(ground), 1)) / 255.0, 4),
            "ground_dark_fraction": round(sum(1 for v in ground if v < DARK) / float(max(len(ground), 1)), 4)}


def job():
    os.makedirs(ROOT, exist_ok=True)
    RESULT["status"] = "running"
    RESULT["tag"] = TAG
    tests = []
    RESULT["tests"] = tests

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
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 23.60")
    yield 4.0

    # ---- WHAT THE RUNTIME THINKS IT HAS, recorded with the pictures. A capture that shows no lamps and a
    # ---- subsystem that loaded none are the same photograph and a different problem.
    RESULT["practicals"] = ("read WLLIGHT in the editor log for 'N practicals defined, pool of M'; the "
                            "subsystem loads WorldDesign/Look/practical_lights.json at world start and "
                            "wl.Look.PracticalReload re-reads it")
    for cvar in ("wl.Look.PracticalCount", "wl.Look.PracticalRadius", "wl.Look.PracticalGain",
                 "wl.Look.NightShadowLift"):
        unreal.SystemLibrary.execute_console_command(world, cvar)

    readings = {}
    RESULT["readings"] = readings
    shots = []
    for name, eye, look in PLACES:
        live = ues.get_game_world()
        if live is None or unreal.GameplayStatics.get_player_pawn(live, 0) is None:
            tests.append({"id": "T_DEAD_%s" % name, "name": "the world was alive for %s" % name,
                          "pass": False, "detail": {}})
            continue
        L.pose_camera(live, unreal.Vector(*eye), unreal.Vector(*look), 70.0)
        yield 2.0
        unreal.GameplayStatics.set_game_paused(live, True)
        yield 0.4
        fname = "tartarus_%s_%s.png" % (name, TAG)
        path = os.path.join(ROOT, fname)
        try:
            L.capture_game_viewport(path)
            shots.append(fname)
            readings[name] = frame_stats(path)
            emit("T_%s" % name, "INFO", "%s (%s)" % (name, TAG), readings[name])
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[name] = str(err)[:140]
        unreal.GameplayStatics.set_game_paused(live, False)
        L.release_camera(live)
        yield 0.3

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")
    tests.append({"id": "T00", "name": "all six Tartarus night views were captured",
                  "pass": len(shots) == len(PLACES),
                  "detail": {"taken": len(shots), "wanted": len(PLACES), "tag": TAG, "where": ROOT,
                             "note": "the verdict is the pictures against the founder's screenshots, not "
                                     "this clause and not the luma below."}})
    worst = max((v["dark_fraction"] for v in readings.values()), default=1.0)
    tests.append({"id": "T01", "name": "no Tartarus view is a black void",
                  "pass": worst <= 0.80,
                  "detail": {"worst_dark_fraction": worst, "ceiling": 0.80, "per_place": readings,
                             "note": "a ceiling, not a target: passing this is not the same as readable, "
                                     "which only the photograph answers."}})
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "captured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
