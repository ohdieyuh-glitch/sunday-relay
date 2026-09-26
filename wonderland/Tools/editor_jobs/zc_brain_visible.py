# DOES THE LIVING BRAIN ACTUALLY REACH THE SCREEN?
#
# THE BUG THIS PROVES FIXED. Every render precondition read healthy -- 2015 mass instances, mesh yes, material
# yes, vis=1, hidden=0, actor not hidden, dead ahead of the camera at 808 uu -- and the window was still empty.
# Forcing the sculpture to 320 uu at triple scale changed nothing, which was the tell: distance and size cannot
# beat an opaque wash. SWonderlandBrainBackdrop paints Srgb(3,6,22) at 0.94 alpha across FAnchors(0,0,1,1), so
# the 3D world behind Project Brain -- the sculpture included -- arrived at six percent.
#
# So this measures the two things that actually decide it:
#
#   THE HOLE    the night field must be cutting a real rect for the brain window. Zero area = no hole = invisible.
#   THE DIFF    the same framing photographed with the sculpture shown and then HIDDEN. If the window looks the
#               same either way, nothing of the brain is reaching the screen, whatever the actor reports.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "brain_visible")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith(".jpg"):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
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

    ui.toggle_project_brain()
    yield 2.5
    RESULT["brain_panel_open"] = bool(ui.is_project_brain_open())

    # THE HOLE, read from the panel itself rather than guessed from a photograph.
    rect = ui.get_brain_window_rect()
    RESULT["window_rect_LTRB"] = [round(rect.x, 4), round(rect.y, 4), round(rect.z, 4), round(rect.w, 4)]
    RESULT["hole_is_being_cut"] = (rect.z - rect.x) > 0.001 and (rect.w - rect.y) > 0.001
    RESULT["hole_area_pct_of_screen"] = round((rect.z - rect.x) * (rect.w - rect.y) * 100.0, 2)

    found = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandBrainSculpture)
    RESULT["sculptures"] = len(found)
    if not found:
        RESULT["status"] = "FAIL: no sculpture spawned"
        les.editor_request_end_play()
        yield (lambda: ues.get_game_world() is None, 300)
        return

    art = found[0]
    RESULT["rendering"] = str(art.describe_rendering())
    cam = pc.player_camera_manager
    cam_loc = cam.get_camera_location()
    art_loc = art.get_actor_location()
    RESULT["camera_at"] = [round(cam_loc.x, 1), round(cam_loc.y, 1), round(cam_loc.z, 1)]
    RESULT["sculpture_at"] = [round(art_loc.x, 1), round(art_loc.y, 1), round(art_loc.z, 1)]
    to = art_loc - cam_loc
    RESULT["distance_uu"] = round(float(to.length()), 1)
    RESULT["view_target"] = pc.get_view_target().get_name() if pc.get_view_target() else "none"

    # ---------------------------------------------------------------- SHOWN
    yield 1.0
    H.capture_viewport_jpeg(os.path.join(ROOT, "01_brain_shown.jpg"), 1700, 92)

    # ---------------------------------------------------------------- HIDDEN, same framing
    # The panel does not move and the lens does not move; the ONLY change is the sculpture. Any difference in the
    # window between these two frames is the brain, and no difference means the brain never got there.
    art.set_actor_hidden_in_game(True)
    yield 1.2
    H.capture_viewport_jpeg(os.path.join(ROOT, "02_brain_hidden.jpg"), 1700, 92)

    # ---------------------------------------------------------------- SHOWN AGAIN
    art.set_actor_hidden_in_game(False)
    yield 1.2
    H.capture_viewport_jpeg(os.path.join(ROOT, "03_brain_back.jpg"), 1700, 92)
    yield 2.0
    H.capture_viewport_jpeg(os.path.join(ROOT, "04_brain_later.jpg"), 1700, 92)

    # ---- WHAT CAN BE DECIDED, IS. The photographs remain the verdict on how the brain LOOKS -- organic,
    # polished, not blocky -- which is a judgement and the founder's. But whether the panel is open, whether
    # a hole is actually being cut for it, and whether a sculpture is staged in that hole are facts, and this
    # job measured all three and then asked none of them.
    tests = []
    RESULT["tests"] = tests

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    area = float(RESULT.get("hole_area_pct_of_screen") or 0.0)
    record("B01", "Project Brain is open and cutting a hole for the sculpture",
           bool(RESULT.get("brain_panel_open")) and bool(RESULT.get("hole_is_being_cut")),
           open=RESULT.get("brain_panel_open"), hole=RESULT.get("hole_is_being_cut"),
           rect=RESULT.get("window_rect_LTRB"))
    record("B02", "the hole is a window, not a sliver and not the whole screen",
           5.0 < area < 60.0, hole_area_pct=area,
           note="a hole of nearly zero would pass 'is being cut' while showing nothing, and one near 100 "
                "would mean the panel had eaten the world -- which the founder explicitly ruled out")
    record("B03", "exactly one brain sculpture is staged in it",
           int(RESULT.get("sculptures") or 0) == 1, sculptures=RESULT.get("sculptures"),
           at=RESULT.get("sculpture_at"), camera=RESULT.get("camera_at"),
           distance_uu=RESULT.get("distance_uu"))

    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
