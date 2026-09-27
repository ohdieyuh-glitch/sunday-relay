# HOW BRIGHT MUST A RIBBON ON M_WL_Fire BE TO READ AS FIRE?
#
# FOUNDER, P0 item 4: "believable animated Unreal fire, not plastic voxel flames ... flicker, emissive
# falloff, softness/distortion, proper attachment." M_WL_Fire is that material -- soft across the ribbon,
# falling off to nothing at the tip, with bands of flicker scrolling up it. Putting the ribbons on it took the
# flames off the mascots, and the legacy path was shipped to get the founder's flames back while the bug
# stayed open.
#
# THE BUG, FOUND BY READING THE SECTION RATHER THAN GUESSING AT IT. Nothing structural is wrong: two sections,
# visible, 768 vertices, wearing MID_M_WL_Fire, UVs running 0 to 1 exactly. What differs is the NUMBER. The
# same ribbon is handed Color (264.0, 89.8, 13.2) on the legacy voxel glow and (12.4, 4.2, 0.6) on the fire
# material -- and the voxel glow then multiplies by a large internal emissive exposure that M_WL_Fire has no
# equivalent of, while the shape terms on the fire material multiply DOWN by about six. The ribbons were
# always drawing. They were arriving about three orders of magnitude too faint to see, which is why cranking
# the gain to 30 looked like "still nothing" rather than like progress.
#
# So the gain is swept over a range wide enough to contain the answer, and judged the way the wardrobe was:
# the figure must out-read the ground it stands on, and it must not be clipped to a featureless white shape.
# Both skins, at night, on the fire material, with a capture at every rung.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "fire_calibrate")
SKINS = ("arden_infernal", "skeleton_flame")
GAINS = (2.3, 12.0, 45.0, 140.0, 420.0)
HOUR = 21.0


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
    yield 7.0

    def cmd(line):
        unreal.SystemLibrary.execute_console_command(world, line)

    cmd("wl.Sky.DayMinutes 0")
    cmd("wl.Sky.Hour %.2f" % HOUR)
    yield 5.0

    ui = L.get_ui(world)
    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)

    def frame():
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * 620.0,
                            here.y + math.sin(math.radians(yaw)) * 620.0, here.z + 120.0)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + 70.0), 45.0)

    def figure_box():
        size = pc.get_viewport_size()
        if not size or size[0] <= 0:
            return None
        here = dog.get_actor_location()
        low = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(here.x, here.y, here.z - 10.0), False)
        high = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(here.x, here.y, here.z + 230.0), False)
        if low is None or high is None:
            return None
        cx = (low.x + high.x) * 0.5 / float(size[0])
        y0 = max(min(low.y, high.y) / float(size[1]), 0.0)
        y1 = min(max(low.y, high.y) / float(size[1]), 1.0)
        half = 0.20 * (y1 - y0)
        return (max(cx - half, 0.0), y0, min(cx + half, 1.0), y1)

    rows = {}
    RESULT["by_skin"] = rows

    # ---- THE LEGACY PATH FIRST, as the thing the founder has already approved and the number to beat.
    cmd("wl.Look.FireMaterial 0")
    cmd("wl.Look.FireGain 2.3")
    legacy = {}
    RESULT["legacy"] = legacy
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        yield 6.0
        cmd("wl.Look.Reglow")
        yield 3.0
        frame()
        yield 2.0
        box = figure_box()
        if box is None:
            continue
        fig = L.read_screen_rect(*box)
        gnd = L.read_screen_rect(0.66, 0.80, 0.94, 0.96)
        legacy[skin] = {"figure": None if fig is None else luma(fig[0]),
                        "blown": None if fig is None else round(float(fig[2]), 4),
                        "ground": None if gnd is None else luma(gnd[0])}
        try:
            L.capture_game_viewport(os.path.join(ROOT, "%s_legacy.png" % skin))
        except Exception:
            pass
        L.release_camera(world)
        emit("C_LEGACY_%s" % skin, "INFO", "%s on the legacy voxel glow" % skin, legacy[skin])

    # ---- AND NOW THE FIRE MATERIAL, swept.
    cmd("wl.Look.FireMaterial 1")
    for skin in SKINS:
        per = {}
        rows[skin] = per
        for gain in GAINS:
            cmd("wl.Look.FireGain %.2f" % gain)
            ui.wear_relay_skin(skin)
            yield 5.0
            cmd("wl.Look.Reglow")
            yield 3.0
            frame()
            yield 2.0
            box = figure_box()
            if box is None:
                per["%.1f" % gain] = None
                continue
            fig = L.read_screen_rect(*box)
            gnd = L.read_screen_rect(0.66, 0.80, 0.94, 0.96)
            row = {"figure": None if fig is None else luma(fig[0]),
                   "blown": None if fig is None else round(float(fig[2]), 4),
                   "ground": None if gnd is None else luma(gnd[0])}
            if row["figure"] is not None and row["ground"] is not None:
                row["over_ground"] = round(row["figure"] - row["ground"], 4)
            per["%.1f" % gain] = row
            try:
                L.capture_game_viewport(os.path.join(ROOT, "%s_gain_%05.1f.png" % (skin, gain)))
            except Exception:
                pass
            L.release_camera(world)
        emit("C_%s" % skin, "INFO", skin, per)

    cmd("wl.Look.FireMaterial 0")
    cmd("wl.Look.FireGain 2.3")
    cmd("wl.Look.Reglow")

    read = [v for per in rows.values() for v in per.values() if v and v.get("figure") is not None]
    record("C00", "every gain was photographed for both skins",
           len(read) == len(SKINS) * len(GAINS), read=len(read), wanted=len(SKINS) * len(GAINS))
    if len(read) != len(SKINS) * len(GAINS):
        RESULT["status"] = "FAIL: the sweep was not measured"
        return

    record("C01", "the gain reaches the ribbons on the fire material",
           all(per["%.1f" % GAINS[-1]]["figure"] > per["%.1f" % GAINS[0]]["figure"] + 0.02
               for per in rows.values()),
           lowest={s: per["%.1f" % GAINS[0]]["figure"] for s, per in rows.items()},
           highest={s: per["%.1f" % GAINS[-1]]["figure"] for s, per in rows.items()},
           note="if the top of this sweep does not out-read the bottom, the ribbons are not being fed at all "
                "and the fault is not brightness")

    # ---- WHICH RUNGS READ AS FIRE: brighter than the ground, and not a clipped white shape.
    good = {}
    for skin, per in rows.items():
        good[skin] = [g for g in GAINS
                      if per["%.1f" % g].get("over_ground", -1) > 0.06
                      and per["%.1f" % g]["blown"] <= 0.30]
    RESULT["rungs_reading_as_fire"] = {s: v for s, v in good.items()}
    RESULT["table"] = {s: {k: {"figure": v["figure"], "blown": v["blown"],
                               "over": v.get("over_ground")}
                           for k, v in per.items()} for s, per in rows.items()}
    emit("C_TABLE", "INFO", "figure / blown / over-ground by gain", RESULT["table"])

    both = [g for g in GAINS if all(g in good[s] for s in good)]
    RESULT["works_for_both_skins"] = both
    record("C02", "there is a gain where both flame skins read as fire on M_WL_Fire",
           len(both) > 0, per_skin=good, both=both, table=RESULT["table"],
           legacy=RESULT["legacy"],
           note="over-ground above 0.06 means the figure is plainly burning; blown at or under 0.30 means it "
                "is fire and not a white cut-out. The legacy row is what the founder has been looking at.")
    if both:
        RESULT["recommended_gain"] = max(both)
        emit("C_BEST", "INFO", "the brightest gain that works for both", {"gain": max(both)})

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
