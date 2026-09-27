# HOW HARD MUST A LUMINOUS SKIN'S BODY BE COMPRESSED BEFORE ITS EYES CAN BE SEEN?
#
# FOUNDER: every active mascot skin must have visibly glowing eyes, at day, dusk and night, keeping its own
# established colour.
#
# THE ARITHMETIC THAT SENT ME HERE, because it rules out the two obvious fixes before spending a run on them.
# In this scene a material strength of 1.0 renders at luma 0.039 -- Relay OG's bone face measures exactly that
# -- so luma pins at white somewhere around strength 25. Now the authored values:
#
#     Celestial Light   eye 28,000 | edge 20,800 | starlight 17,600      <- edge and starlight ARE its face
#     Apollo            eye 30,000 | solar 2,800 | solarmid 3,600 | solarpale 4,800
#     Arden Infernal    eye 30,000 | ember 2,400 | emberpale 4,000 | ruby 4,800
#     Skeleton Flame    eye 32,000 | ghost 2,800 | ghostpale 4,800 | soulpulse 8,800
#     Relay OG          bone 1.0 -- and this is the only skin whose eyes have never failed
#
# Body glow passes through WonderlandTameGlow (knee 700, curve 0.15), so Celestial's 20,800 lands at ~1161 --
# forty-six times past clipping. Its eye is driven to an ABSOLUTE level instead, wl.Look.EyeGlowDay = 18, and
# 18 renders at 0.59. So the eye sits at 0.59 inside a face pinned at 1.0. Measured: over_face -0.2167 at
# noon. The eye is not dim; the face is blown.
#
# THAT IS WHY NEITHER OBVIOUS LEVER WORKS. Raising the eye cannot help: past strength 25 both eye and face
# read 1.0 and the contrast stays zero however far it is pushed. And the world exposure cannot help either --
# a skin whose own material is 46x over white clips at any exposure that leaves the rest of Wonderland
# visible, which is why zc_exposure shows 7.14% clipped AND 40.48% crushed at the same time.
#
# SO THE FACE HAS TO COME DOWN, AND THE KNEE IS THE KNOB THAT DOES IT -- but it changes the look of three
# skins that are luminous BY DESIGN, so it is swept and photographed rather than chosen. Lower knee compresses
# harder. What is wanted is the gentlest setting where every skin's face stops clipping and its eyes clear it,
# because anything harsher than that is taking away glow the founder asked for.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "glow_knee")
SKINS = ("celestial_light", "apollo", "arden_infernal", "skeleton_flame", "relay_og")
# Current, then progressively harder compression. Relay OG rides along as the control: its body is not a glow
# material at all, so if IT moves, the knee is reaching something it should not.
KNEES = (700.0, 120.0, 30.0, 8.0)
HOUR = 12.0


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
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % HOUR)
    yield 4.0

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    ui = L.get_ui(world)
    if dog is None or pc is None:
        tests.append({"id": "K00", "name": "there is a Dog to photograph", "pass": False, "detail": {}})
        RESULT["status"] = "FAIL"
        return

    # The same two heights the eye proof uses -- 62 uu is the eyes, 44 uu the face below them -- so these
    # readings can be laid straight beside its table instead of being a second private scale.
    def patch(z_above, half_w, half_h):
        size = pc.get_viewport_size()
        if not size or size[0] <= 0:
            return None
        here = dog.get_actor_location()
        got = unreal.GameplayStatics.project_world_to_screen(
            pc, unreal.Vector(here.x, here.y, here.z + z_above), False)
        if got is None:
            return None
        cx, cy = float(got.x) / size[0], float(got.y) / size[1]
        if not (0.08 < cx < 0.92 and 0.08 < cy < 0.92):
            return None
        read = L.read_screen_rect(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        if read is None:
            return None
        hot = L.read_screen_extremes(cx - half_w, cy - half_h, cx + half_w, cy + half_h)
        return {"luma": luma(read[0]), "bright": round(float(read[2]), 4),
                "colour": round(max(float(hot[0]), float(hot[1]), float(hot[2])), 4) if hot else None}

    rows = {}
    RESULT["by_knee"] = rows
    for knee in KNEES:
        unreal.SystemLibrary.execute_console_command(world, "wl.Look.GlowKnee %.2f" % knee)
        per = {}
        rows["%.0f" % knee] = per
        for skin in SKINS:
            # The knee is read when a material is BUILT, so the skin has to be re-worn after it changes.
            ui.wear_relay_skin(skin)
            yield 4.0
            at = dog.get_actor_location()
            fwd = dog.get_actor_forward_vector()
            L.pose_camera(world, at + fwd * 300.0 + unreal.Vector(0.0, 0.0, 70.0),
                          at + unreal.Vector(0.0, 0.0, 70.0), 32.0)
            yield 1.2
            eyes = patch(62.0, 0.020, 0.012)
            face = patch(44.0, 0.020, 0.012)
            if eyes is not None and face is not None:
                per[skin] = {"eye": eyes["luma"], "face": face["luma"],
                             "over": round(eyes["luma"] - face["luma"], 4),
                             "face_blown": face["bright"], "eye_blown": eyes["bright"],
                             "colour": eyes["colour"]}
            try:
                L.capture_game_viewport(os.path.join(ROOT, "knee%04.0f_%s.png" % (knee, skin)))
            except Exception:                                      # noqa: BLE001
                pass
            L.release_camera(world)
            yield 0.4
        emit("K_%.0f" % knee, "INFO", "knee %.0f" % knee, per)

    unreal.SystemLibrary.execute_console_command(world, "wl.Look.GlowKnee 700.00")

    read = [v for per in rows.values() for v in per.values()]
    tests.append({"id": "K00", "name": "every knee was read for every skin",
                  "pass": len(read) == len(KNEES) * len(SKINS),
                  "detail": {"read": len(read), "wanted": len(KNEES) * len(SKINS)}})
    if len(read) != len(KNEES) * len(SKINS):
        RESULT["status"] = "FAIL: the sweep was not measured"
        return

    # ---- WHICH SETTINGS LET EVERY SKIN'S EYES BE SEEN, without taking the glow away.
    good = []
    for knee in KNEES:
        key = "%.0f" % knee
        eyes_clear = all(rows[key][s]["over"] > 0.05 for s in SKINS)
        face_unblown = all(rows[key][s]["face_blown"] < 0.90 for s in SKINS)
        colour_kept = all((rows[key][s]["colour"] or 0.0) > 0.0 for s in SKINS)
        if eyes_clear and face_unblown and colour_kept:
            good.append(knee)
    RESULT["knees_passing"] = good
    RESULT["table"] = {k: {s: [v["eye"], v["face"], v["over"], v["face_blown"]]
                           for s, v in per.items()} for k, per in rows.items()}
    emit("K_TABLE", "INFO", "eye / face / over / face_blown by knee", RESULT["table"])

    tests.append({"id": "K01", "name": "there is a glow knee where every skin's eyes clear their own face",
                  "pass": len(good) > 0,
                  "detail": {"passing": good, "table": RESULT["table"],
                             "over_floor": 0.05, "face_blown_ceiling": 0.90,
                             "note": "the GENTLEST passing setting is wanted, not the hardest. These skins "
                                     "are luminous by design and compressing further than necessary takes "
                                     "away the glow the founder asked for. Relay OG is the control: its body "
                                     "is not a glow material, so if it moves the knee is reaching too far."}})
    if good:
        RESULT["recommended"] = max(good)
        emit("K_BEST", "INFO", "the gentlest knee that works everywhere", {"glow_knee": max(good)})

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
