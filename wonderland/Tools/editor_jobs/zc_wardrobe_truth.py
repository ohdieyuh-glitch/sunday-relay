# DOES CLICKING A SKIN MOVE THE PLAYER'S VIEW?
#
# THE MEASUREMENT I GOT WRONG. Every previous run asked IsProjectBrainOpen() and came back true, so I reported
# the wardrobe fixed while the founder kept seeing Wonderland. The panel WAS open. The camera had left. The
# panel staying open was never the question.
#
# So this watches the thing that actually moves him: the player controller's VIEW TARGET, and the camera's
# world location, sampled before and after every single click. If either changes, the click took him somewhere,
# and that is a FAIL no matter what the panel says about itself.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wardrobe_truth")
SKINS = ["relay_og", "apollo", "arden_infernal", "skeleton_flame", "celestial_light"]


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    rows = []
    RESULT["clicks"] = rows
    RESULT["status"] = "running"

    yield (lambda: ues.get_game_world() is None, 1800)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 5.0
    world = ues.get_game_world()
    pc = unreal.GameplayStatics.get_player_controller(world, 0)
    ui = L.get_ui(world)
    L.focus_game_viewport()
    yield 0.5

    def view_state():
        """What the player is actually looking through, and from where."""
        target = pc.get_view_target()
        cam = pc.player_camera_manager
        loc = cam.get_camera_location() if cam else unreal.Vector(0, 0, 0)
        return (target.get_name() if target else "none",
                round(loc.x, 1), round(loc.y, 1), round(loc.z, 1))

    def shot(name):
        H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % name), 1700, 90)

    ui.toggle_project_brain()
    yield 2.0
    RESULT["brain_open"] = bool(ui.is_project_brain_open())
    before_open = view_state()
    RESULT["view_before_wardrobe"] = before_open
    shot("01_brain")

    RESULT["wardrobe_opened"] = bool(ui.set_brain_skins_open(True))
    yield 2.2
    after_open = view_state()
    RESULT["view_after_wardrobe"] = after_open
    RESULT["wardrobe_moved_the_view"] = (before_open != after_open)
    shot("02_wardrobe")

    for skin in SKINS:
        before = view_state()
        worn = bool(ui.wear_relay_skin(skin))
        yield 1.8
        after = view_state()
        moved = (before != after)
        rows.append({
            "skin": skin, "worn": worn,
            "view_before": before, "view_after": after,
            "VIEW_MOVED": moved,
            "brain_still_open": bool(ui.is_project_brain_open()),
        })
        shot("03_%s" % skin)

    RESULT["any_click_moved_the_view"] = any(r["VIEW_MOVED"] for r in rows)
    RESULT["brain_open_at_end"] = bool(ui.is_project_brain_open())
    RESULT["view_at_end"] = view_state()

    # ---- AND NOW JUDGE IT.
    #
    # This job collected every number P0 item 1 asks about and then recorded no tests at all, so it has been
    # reported as PHOTO -- a proof whose verdict is "look at the pictures" -- while the data to decide it was
    # sitting in the result. That is the opposite failure to a fake pass: not a check that cannot fail, a
    # measurement that never gets asked. The founder's clauses are each a line below.
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    wore = [r["skin"] for r in rows if r["worn"]]
    record("W01", "all five named skins actually go on from the Wardrobe",
           len(wore) == len(SKINS), wore=wore, asked=SKINS,
           note="Relay OG, Celestial Light, Apollo, Arden Infernal and Skeleton Flame, by name")

    record("W02", "no skin change teleports the player camera",
           not RESULT["any_click_moved_the_view"]
           and not RESULT["wardrobe_moved_the_view"]
           and RESULT["view_before_wardrobe"] == RESULT["view_at_end"],
           before=RESULT["view_before_wardrobe"], after=RESULT["view_at_end"],
           moved_on_open=RESULT["wardrobe_moved_the_view"],
           moved_on_any_click=RESULT["any_click_moved_the_view"],
           note="the view is the pawn and its location; identical before opening, after every click, and at "
                "the end means the camera never went anywhere")

    record("W03", "Project Brain stays open the whole way through",
           bool(RESULT["brain_open"]) and bool(RESULT["brain_open_at_end"])
           and all(r["brain_still_open"] for r in rows),
           at_start=RESULT["brain_open"], at_end=RESULT["brain_open_at_end"],
           after_each_click=[r["brain_still_open"] for r in rows])

    # THE BLACK BEHIND THE DOG, structurally. The window is a hole into the world, so what stops Wonderland
    # showing through is a backdrop parked beyond the Dog and scaled past the frame's corners. Its presence
    # and placement are checkable; whether it LOOKS right is the captures' job.
    backdrops = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.Actor):
        try:
            label = str(actor.get_actor_label())
        except Exception:
            continue
        if "Backdrop" in label or "WardrobeBackdrop" in label:
            loc = actor.get_actor_location()
            backdrops.append({"label": label[:44],
                              "at": [round(float(loc.x), 1), round(float(loc.y), 1), round(float(loc.z), 1)]})
    RESULT["backdrops"] = backdrops
    record("W04", "a backdrop stands behind the previewed Dog, so the world cannot show through",
           len(backdrops) > 0, backdrops=backdrops,
           note="the preview window is a hole into the world; without this the Dog is judged against "
                "whatever happens to be behind it")

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
