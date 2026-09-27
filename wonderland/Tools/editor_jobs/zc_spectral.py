# IS SKELETON FLAME ONE SYNCHRONIZED SPECTRAL SYSTEM, FROM EVERY SIDE?
#
# FOUNDER: the flames, the eyes and the chest skull must share one colour family; the skull's eyes must pulse;
# the dark block on the side and back must glow and pulse with them rather than sitting there black. Capture
# PULSE LOW, MID and HIGH at FRONT, SIDE and BACK.
#
# WHAT WAS ACTUALLY WRONG, and it was not the shader. The generator has carried the spectral system for some
# time -- soulpulse and soulveilpulse in the eyes' own colour, flankfire down both sides, backfire across the
# back -- and the shipped SkeletonFlame.wlvox predates all of it. Regenerating every skin in the lineup into a
# scratch directory and diffing proved it: Relay OG, Arden, Apollo and Celestial Light come out byte-for-byte
# the same size they already are, and only Skeleton Flame moves, 1,485 boxes to 2,186. The founder was looking
# at a stale asset, not a broken system. Both pulse materials are named "...pulse", which is how the animator
# recognises a heartbeat, so they join the existing beat rather than inventing a second one.
#
# HOW THE THREE PULSE LEVELS ARE FOUND. Not by freezing a clock or guessing a phase: the stage is captured
# many times across several seconds at each angle, and the exported frames are ranked afterwards by measured
# brightness. LOW, MID and HIGH are then the dimmest, middle and brightest frames that actually occurred. That
# also answers the question the founder really asked -- if the darkest and brightest frames measure the same,
# there is no pulse, and no amount of looking at one screenshot would have told anyone.
#
# AND THE RANKING IS NOW DONE HERE, AND ASSERTED. This job used to export the frames and record a single
# clause -- "the beat was sampled at every angle" -- with a note that LOW/MID/HIGH would be chosen outside
# the editor. QA read that correctly: a gate NAMED for spectral behaviour that asserts only that its
# instrument ran is reassurance wearing the name of evidence, and in any matrix it reads as "spectral
# behaviour proven". So the exported pixels are decoded in the job -- the same dependency-free reader the
# wardrobe occupancy proof uses, Tools/occupancy.py -- and three things are asserted per angle: the beat is
# visible (HIGH minus LOW), the colour family is cyan (green+blue over red on the bright pixels), and the
# figure is not simply a white shape (how much of it is pinned). The third is the one most likely to be red
# today, and it is the founder's flame-brightness finding measured from a different camera.
CONCURRENT = True

import os
import sys
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "spectral")
ANGLES = (("front", 0.0), ("side", 90.0), ("back", 180.0))
FRAMES = 14

# The beat has to be SEEN, not merely be non-zero. Measured 2026-09-27 on the shipped asset: 5.6 to 9.7 out of
# 255 between the darkest and brightest frame at each angle. 3 is a floor a reader can see; 1 is noise.
BEAT_FLOOR = 3.0
# Fraction of the figure's own pixels that are pinned at or above 245/255. A white-hot flame core clips and
# should; a figure that is mostly clipped has no skull, eyes or ribs left to see in it.
PINNED_CEILING = 0.35
SUBJECT_FLOOR = 34      # the occupancy proof's own backdrop threshold
STEP = 3                # every third pixel in x and y: 9x fewer samples, the same answer, no editor hitch


def frame_stats(path):
    """Subject brightness, cyan excess on the bright pixels, and how much of the figure is pinned."""
    sys.path.insert(0, os.path.dirname(CHANNEL))
    from occupancy import read_png                                  # noqa: WPS433
    w, h, chan, px = read_png(path)
    sub_n = 0
    sub_l = 0.0
    pinned = 0
    hot_n = 0
    hot_r = hot_g = hot_b = 0.0
    for y in range(0, h, STEP):
        row = y * w * chan
        for x in range(0, w, STEP):
            i = row + x * chan
            r, g, b = px[i], px[i + 1], px[i + 2]
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if lum > SUBJECT_FLOOR:
                sub_n += 1
                sub_l += lum
                if lum >= 245.0:
                    pinned += 1
            if lum > 140.0:
                hot_n += 1
                hot_r += r
                hot_g += g
                hot_b += b
    return {
        "subject_mean": round(sub_l / max(sub_n, 1), 1),
        "subject_px": sub_n,
        "pinned_fraction": round(pinned / float(max(sub_n, 1)), 3),
        "cyan_excess": round((((hot_g + hot_b) * 0.5) - hot_r) / max(hot_n, 1) / 255.0, 3) if hot_n else None,
    }


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
    yield 6.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.0")
    ui = L.get_ui(world)
    if not ui.is_project_brain_open():
        ui.toggle_project_brain()
    yield 3.0
    ui.press_switch_skin()
    yield 4.0
    ui.wear_relay_skin("skeleton_flame")
    yield 6.0

    stage = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage):
        stage = actor
        break
    if stage is None:
        record("S00", "the stage exists", False)
        RESULT["status"] = "FAIL"
        return
    target = stage.get_render_target()

    figure = None
    for actor in unreal.GameplayStatics.get_all_actors_of_class(
            world, unreal.WonderlandCompanionEmbodiment):
        try:
            if "SkinStage" in str(actor.get_actor_label()):
                figure = actor
                break
        except Exception:                                          # noqa: BLE001
            pass

    # ---- WHAT THE FIGURE SAYS IT IS MADE OF, so the capture is not the only witness.
    said = {}
    RESULT["figure"] = said
    if figure is not None:
        try:
            said["flames"] = str(figure.describe_flames())[:800]
        except Exception as err:                                   # noqa: BLE001
            said["flames"] = "?" + str(err)[:80]
        try:
            said["framing"] = str(stage.describe_framing())
        except Exception:                                          # noqa: BLE001
            pass
    emit("S_FIG", "INFO", "what Skeleton Flame reports", said)

    exported = {}
    for name, yaw in ANGLES:
        if figure is not None:
            try:
                figure.set_actor_rotation(unreal.Rotator(0.0, yaw, 0.0), False)
            except Exception:                                      # noqa: BLE001
                pass
        yield 2.0
        exported[name] = []
        for frame in range(FRAMES):
            path = os.path.join(ROOT, "%s_f%02d.png" % (name, frame))
            try:
                unreal.RenderingLibrary.export_render_target(
                    world, target, ROOT, "%s_f%02d.png" % (name, frame))
                exported[name].append(path)
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})["%s %d" % (name, frame)] = str(err)[:100]
            yield 0.32
        emit("S_%s" % name, "INFO", "captured %s across the beat" % name, {"frames": FRAMES})

    if figure is not None:
        try:
            figure.set_actor_rotation(unreal.Rotator(0.0, 0.0, 0.0), False)
        except Exception:                                          # noqa: BLE001
            pass

    record("S00", "the beat was sampled at every angle",
           all(len(exported.get(a[0], [])) == FRAMES for a in ANGLES),
           angles=[a[0] for a in ANGLES], frames_each=FRAMES,
           note="a precondition, not the finding. The three clauses below are the finding.")

    # ---- THE RANKING, IN THE JOB, FROM THE PIXELS. One frame per tick so the editor is not held.
    ranked = {}
    RESULT["ranked"] = ranked
    for name, _yaw in ANGLES:
        rows = []
        for path in exported.get(name, []):
            if not os.path.exists(path):
                continue
            try:
                got = frame_stats(path)
                got["file"] = os.path.basename(path)
                rows.append(got)
            except Exception as err:                               # noqa: BLE001
                RESULT.setdefault("errors", {})[os.path.basename(path)] = str(err)[:100]
            yield 0.0
        rows.sort(key=lambda r: r["subject_mean"])
        if rows:
            ranked[name] = {"LOW": rows[0], "MID": rows[len(rows) // 2], "HIGH": rows[-1],
                            "beat": round(rows[-1]["subject_mean"] - rows[0]["subject_mean"], 1),
                            "frames_measured": len(rows)}
        emit("S_RANK_%s" % name, "INFO", "LOW / MID / HIGH at %s" % name, ranked.get(name))

    measured = all(name in ranked and ranked[name]["frames_measured"] == FRAMES for name, _ in ANGLES)
    record("S01", "the beat is visible from every side: the brightest frame is plainly brighter than the dimmest",
           measured and all(ranked[n]["beat"] >= BEAT_FLOOR for n, _ in ANGLES),
           beat={n: ranked.get(n, {}).get("beat") for n, _ in ANGLES}, floor=BEAT_FLOOR,
           note="HIGH minus LOW in subject luma out of 255, from the frames that actually occurred. If these "
                "are near zero at any angle there is no pulse on that side, whatever the animator says.")
    record("S02", "the colour family is cyan from every side: the bright pixels carry green+blue over red",
           measured and all((ranked[n]["HIGH"]["cyan_excess"] or 0.0) > 0.0 for n, _ in ANGLES),
           cyan_at_high={n: ranked.get(n, {}).get("HIGH", {}).get("cyan_excess") for n, _ in ANGLES},
           note="the eyes, the chest skull, the flank and back elements and the ghostfire are one system "
                "only if they are one colour. Positive is cyan; zero is white; negative is warm.")
    record("S03", "the figure is not a white shape: most of it is NOT pinned at white",
           measured and all(ranked[n]["HIGH"]["pinned_fraction"] < PINNED_CEILING for n, _ in ANGLES),
           pinned_at_high={n: ranked.get(n, {}).get("HIGH", {}).get("pinned_fraction") for n, _ in ANGLES},
           ceiling=PINNED_CEILING,
           note="the founder's flame finding measured from the wardrobe camera. A skull, eyes and ribs "
                "cannot be read inside a region that is pinned; if this is red the fire is the reason the "
                "spectral detail cannot be seen, and dimming the fire is the fix rather than raising the "
                "detail.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
