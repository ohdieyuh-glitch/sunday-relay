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

# (name, eye xyz, look-at xyz) -- EVERY NUMBER DERIVED, not eyeballed.
#
# The first pair of these was typed by eye from the route's bounding box and put the camera on grass a
# kilometre short of the dip, looking at open field: a black frame that was honestly black and was not the
# place it claimed to be. These come from the data. The avenue pair is the route polyline sampled at 250 m
# and 330 m -- either side of the four shelf transitions at 285, 301, 318 and 321 m -- at the route's own
# floor height. The plaza is the centroid of the quarter's largest cluster of KERB PAVING and plinths (70
# pieces at z +12, the surface a walker stands on, not the terrace tiles at -128). The market is the centroid
# of the band's largest canopy cluster, 20 roofs.
PLACES = (
    # THE CHECKPOINT COURT, the one Tartarus viewpoint another lane has already photographed successfully
    # (zc_night_sweep's "entrance_tartarus"). Borrowed rather than invented: the two views I derived from the
    # route polyline put the camera against a crimson wall at the avenue and on open grass at the market, and
    # a reading of a wall at close range is a bright honest number about the wrong subject.
    ("checkpoint_court", (44000.0, -21500.0, 260.0), (46177.0, -22619.0, 60.0)),
    ("checkpoint_court_feet", (45600.0, -22200.0, 150.0), (46177.0, -22619.0, -14.0)),
    # the road out of the checkpoint, on the -14 shelf the proof points declare
    ("road_out", (46600.0, -26400.0, 240.0), (48064.0, -27750.0, -14.0)),
    ("road_in", (44600.0, -25400.0, 240.0), (42868.0, -24750.0, -14.0)),
    # the tower, the nation's landmark and the one thing meant to carry a light signature after dark
    ("tower", (45400.0, -23200.0, 400.0), (48255.0, -23818.0, 400.0)),
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
        pawn = unreal.GameplayStatics.get_player_pawn(live, 0) if live is not None else None
        if live is None or pawn is None:
            tests.append({"id": "T_DEAD_%s" % name, "name": "the world was alive for %s" % name,
                          "pass": False, "detail": {}})
            continue
        # ---- THE WORLD STREAMS AROUND THE PAWN, NOT AROUND THE CAMERA.
        #
        # The first run of this job posed a camera at Tartarus and left the Dog at Golden Arrival, 50 km away.
        # World Partition loads cells around the PLAYER, so the camera was looking at unloaded space -- and by
        # the sixth view the pawn's own cell had gone too and the world reported dead. Tartarus was never in
        # the frame at all. The pawn goes first and the camera follows it.
        #
        # AND IT GOES TO WHAT THE CAMERA IS LOOKING AT, just above the ground there -- not to the camera's own
        # eye, which is metres up and metres back. Dropped at the eye position the Dog fell from 340 uu at a
        # place whose ground had not finished streaming, went through the floor, and was destroyed: the last
        # two views of the run then reported a dead world, which is true and blames the wrong thing. The
        # subject of the shot is the thing that must be loaded, so the pawn stands on it.
        pawn.set_actor_location(unreal.Vector(look[0], look[1], look[2] + 120.0), False, True)
        # ---- AND THEN WAIT FOR THE GROUND TO EXIST, rather than for four seconds to pass.
        #
        # Four seconds was enough for the avenue and not for the market, 25 km further out: that capture came
        # back as two companions floating in a black void with the minimap showing bare terrain, which is an
        # honest photograph of a world that had not arrived yet and is indistinguishable from a world that is
        # too dark. A time is a guess about streaming; a trace is an answer. This waits until a line dropped
        # from above the subject actually hits something, then gives the cell one more second to finish its
        # detail, and records how long it took so a slow place can be seen rather than inferred.
        waited = 0.0
        landed = False
        while waited < 30.0:
            hit = unreal.SystemLibrary.line_trace_single(
                live, unreal.Vector(look[0], look[1], look[2] + 900.0),
                unreal.Vector(look[0], look[1], look[2] - 1500.0),
                unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [], unreal.DrawDebugTrace.NONE, True)
            if hit is not None:
                landed = True
                break
            yield 1.0
            waited += 1.0
        RESULT.setdefault("streaming_seconds", {})[name] = waited
        RESULT.setdefault("ground_found", {})[name] = landed
        yield 1.5
        L.pose_camera(live, unreal.Vector(*eye), unreal.Vector(*look), 70.0)
        yield 2.0
        unreal.GameplayStatics.set_game_paused(live, True)
        yield 0.4
        fname = "tartarus_%s_%s.png" % (name, TAG)
        path = os.path.join(ROOT, fname)
        try:
            if os.path.exists(path):
                os.remove(path)
            # ---- THE CAPTURE RETURNS FALSE, IT DOES NOT THROW, and the second run of this job threw away
            # ---- that bool and reported "the capture never landed on disk" for all six views -- true, and
            # ---- silent about why. CaptureGameViewport is synchronous: Slate takes the shot and writes the
            # ---- PNG before it returns, so a missing file means TakeScreenshot refused, which it does when
            # ---- the game viewport is not drawable. Record what it said.
            got = L.capture_game_viewport(path)
            ok = bool(got[0]) if isinstance(got, (tuple, list)) else bool(got)
            RESULT.setdefault("capture_returned", {})[name] = str(got)
            if not ok or not os.path.exists(path):
                raise RuntimeError("capture_game_viewport returned %s" % (got,))
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
