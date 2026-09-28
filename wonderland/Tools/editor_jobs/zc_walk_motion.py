# DOES THE VISIBLE FIGURE MOVE WHEN THE DOG WALKS? ONE NUMBER PER SKIN.
#
# FOUNDER, P0 item 3: "They still STAND/WALK weird."
#
# STANDING IS SETTLED AND WALKING IS NOT. Measured and observed: the pose is copied field for field across 23
# fields, the costume root offset is identical across skins (z spread 0.0), the authored foot plane is
# identical (3.720 in every file the runtime loads), and photographed from one camera all five meet the
# paving at the same height. I have spent a long time on the first of the founder's two words.
#
# AND THE PICTURE SHOWED SOMETHING THE NUMBERS COULD NOT. Apollo and Arden Infernal have floor-length
# drapery -- a `robe` part of 622 and 480 boxes -- PARENTED TO THE BODY, and their legs are completely hidden
# behind it. The three skins whose feet are visible are exactly the three with no drapery. So the legs may be
# following Relay OG's stride perfectly, which is measured, while nothing anyone can SEE follows it.
#
# THE ROBE IS NOT STATIC, WHICH IS WHY THIS NEEDS MEASURING RATHER THAN ASSERTING. Its part declares the
# motion `trail`, not `none`. Whether a tail-style sway on the companion's own clock reads as a walk is
# exactly the question, and it is not answerable from a part table.
#
# SO: WALK THE DOG AND WATCH THE SILHOUETTE. For each skin, the Dog is driven forward with movement input
# applied EVERY FRAME -- a gait pose at rest is a constant, and an earlier pose job passed every comparison
# on a Dog that was standing still -- and the camera rides beside it. Frame to frame, how much of the
# figure's outline changes?
#
#   A WALKING FIGURE's silhouette changes a lot: legs swing through it.
#   A GLIDING FIGURE's changes little: the visible shape is rigid and only translates.
#
# RELAY OG IS THE REFERENCE, because the founder's sentence makes it one. The question is not "does Apollo
# move" in the abstract, it is "does Apollo move like Relay OG does".
#
# MEASURED IN THE FIGURE'S OWN BOX, not in a fixed slice of the frame. Four separate instruments tonight
# measured the HUD or the scenery because their region was a fraction of the FRAME; this one finds the
# figure against the background first and compares within it.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "walk_motion")
SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
FRAMES = 10
GAP = 0.18
SIDE = 420.0
STEP = 2


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".png", ".jpg")):
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

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    if ui is None or dog is None:
        RESULT["status"] = "VOID: no UI subsystem or no pawn"
        return

    hidden = 0
    for actor in unreal.GameplayStatics.get_all_actors_of_class(
            world, unreal.WonderlandCompanionEmbodiment):
        try:
            if actor.get_attach_parent_actor() != dog:
                actor.set_actor_hidden_in_game(True)
                hidden += 1
        except Exception:                                           # noqa: BLE001
            pass
    RESULT["bystanders_hidden"] = hidden
    yield 1.5

    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "Tools"))
    from night_figure import read                                   # noqa: E402

    home = dog.get_actor_location()

    def ride():
        """Camera beside the Dog, following it, so the figure stays in frame while it walks."""
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw + 90.0)) * SIDE,
                            here.y + math.sin(math.radians(yaw + 90.0)) * SIDE,
                            here.z + 40.0)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z - 20.0), 40.0)

    def silhouette(path):
        """A column occupancy profile of the FIGURE, found against the background."""
        w, h, chan, px = read(path)
        # the figure is centred by the camera; search a generous window and find it by brightness contrast
        x0, x1 = int(w * 0.30), int(w * 0.70)
        y0, y1 = int(h * 0.10), int(h * 0.86)
        cols = []
        for x in range(x0, x1, STEP):
            top = None
            bottom = None
            for y in range(y0, y1, STEP):
                i = (y * w + x) * chan
                lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255.0
                # the mascots are all far brighter than this courtyard's stone in shadow
                if lum > 0.42:
                    if top is None:
                        top = y
                    bottom = y
            cols.append(0 if top is None else (bottom - top))
        return cols

    def change(a, b):
        """How much two profiles differ, as a fraction of the figure's own height."""
        if not a or not b or len(a) != len(b):
            return None
        tall = max(max(a), max(b), 1)
        return round(sum(abs(p - q) for p, q in zip(a, b)) / float(len(a) * tall), 4)

    rows = {}
    RESULT["walk"] = rows
    for skin in SKINS:
        try:
            ui.wear_relay_skin(skin)
        except Exception as err:                                    # noqa: BLE001
            RESULT.setdefault("errors", {})[skin] = str(err)[:140]
            continue
        yield 6.0
        dog.set_actor_location(home, False, False)
        yield 1.0
        profiles = []
        forward = dog.get_actor_forward_vector()
        for k in range(FRAMES):
            # EVERY FRAME. An earlier pose job passed every comparison because the Dog was standing still,
            # and a gait pose at rest is a constant.
            for _ in range(3):
                dog.add_movement_input(forward, 1.0, False)
                yield 0.05
            ride()
            yield GAP
            path = os.path.join(ROOT, "%s_%02d.png" % (skin, k))
            try:
                if L.capture_game_viewport(path):
                    profiles.append(silhouette(path))
            except Exception:                                       # noqa: BLE001
                pass
        L.release_camera(world)
        deltas = [change(profiles[i], profiles[i + 1]) for i in range(len(profiles) - 1)]
        deltas = [d for d in deltas if d is not None]
        rows[skin] = {"frames": len(profiles),
                      "mean_silhouette_change": round(sum(deltas) / len(deltas), 4) if deltas else None,
                      "max_change": round(max(deltas), 4) if deltas else None,
                      "figure_height_px": max((max(p) for p in profiles if p), default=0)}
        emit("W_%s" % skin, "INFO", skin, rows[skin])
        yield 1.0

    try:
        ui.wear_relay_skin("relay_og")
    except Exception:                                               # noqa: BLE001
        pass
    yield 3.0
    record("W_SKIN", "Relay OG was put back on the Dog",
           "relay_og" in str(dog.get_worn_skin_id()).lower(), worn=str(dog.get_worn_skin_id()))

    got = [s for s in SKINS if (rows.get(s) or {}).get("mean_silhouette_change") is not None]
    record("W00", "every skin was walked and photographed", len(got) == len(SKINS),
           measured=sorted(got), wanted=sorted(SKINS))

    ref = (rows.get("relay_og") or {}).get("mean_silhouette_change")
    RESULT["reference_change"] = ref
    table = {s: (rows.get(s) or {}).get("mean_silhouette_change") for s in SKINS}
    RESULT["silhouette_change_by_skin"] = table
    emit("W01", "INFO", "how much each skin's outline moves while walking", table)

    # THE CONTROL: Relay OG itself must move, or the Dog was not walking and every number is of a still figure.
    record("W02", "Relay OG's own silhouette changes while walking, so the Dog really walked",
           ref is not None and ref > 0.004, relay_og_change=ref, floor=0.004,
           note="THE CONTROL. If the reference does not move, movement input never took and every skin "
                "below is a photograph of a standing Dog -- which is exactly how an earlier pose job passed "
                "every comparison it made.")
    if ref is None or ref <= 0.004:
        RESULT["status"] = "VOID: the reference skin did not move, so the Dog was not walking"
        return

    quiet = sorted(s for s in SKINS
                   if table.get(s) is not None and table[s] < ref * 0.55)
    RESULT["skins_whose_outline_barely_moves"] = quiet or None
    record("W03", "every skin's visible outline moves about as much as Relay OG's",
           not quiet, change_by_skin=table, reference=ref, floor_fraction=0.55, quiet=quiet or None,
           note="the founder's 'walk weird', asked of the thing they can actually see. A skin whose legs "
                "copy the stride perfectly but whose visible silhouette is rigid reads as GLIDING, and the "
                "two skins with floor-length body-parented drapery are the candidates.")

    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
