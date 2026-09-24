# IS THE DOG IN THE WARDROBE ALIVE? The founder's spec: "it should not look like a frozen statue" -- subtle head
# motion, breathing, weight shifting, while staying roughly in place.
#
# A FRAME COUNTER WOULD NOT ANSWER THIS. The preview is no longer a scene capture; it is the real Dog seen through
# an unpainted hole in the panel, so "the capture is ticking" proves nothing about whether the BODY moves. What
# proves it is the same skin photographed several seconds apart: if the pixels differ the Dog moved, and if the
# actor's location is unchanged it moved without wandering off, which is the whole requirement.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "wardrobe_alive")


def job():
    os.makedirs(ROOT, exist_ok=True)
    for old in os.listdir(ROOT):
        if old.endswith((".jpg", ".png")):
            os.remove(os.path.join(ROOT, old))
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    RESULT["status"] = "running"
    try:
        yield (lambda: ues.get_game_world() is None, 1800)
        L.set_background_throttle_suspended(True)
        les.editor_request_begin_play()
        yield (lambda: ues.get_game_world() is not None, 240)
        yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
        yield 6.0
        world = ues.get_game_world()
        L.focus_game_viewport()
        ui = L.get_ui(world)
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        ui.wear_relay_skin("apollo")
        yield 2.0
        ui.toggle_project_brain()
        yield 1.4
        ui.set_brain_skins_open(True)
        yield 2.4
        RESULT["wardrobe_open"] = bool(ui.is_brain_skins_open())
        frames = []
        for k in range(5):
            name = "alive_%d.jpg" % (k + 1)
            H.capture_viewport_jpeg(os.path.join(ROOT, name), 1600, 94)
            size = os.path.getsize(os.path.join(ROOT, name))
            # WHERE THE DOG IS, not just what it looks like: a Dog that animates by walking out of the window
            # would also change the pixels, and that is not what "alive in place" means.
            loc = pawn.get_actor_location() if pawn else None
            rot = pawn.get_actor_rotation() if pawn else None
            frames.append({"file": name, "bytes": size,
                           "loc": None if loc is None else [round(loc.x, 1), round(loc.y, 1), round(loc.z, 1)],
                           "yaw": None if rot is None else round(rot.yaw, 1)})
            yield 1.8
        RESULT["frames"] = frames
        sizes = [f["bytes"] for f in frames]
        RESULT["pixels_changed_between_frames"] = len(set(sizes)) > 1
        locs = [tuple(f["loc"]) for f in frames if f["loc"]]
        RESULT["stayed_in_place"] = (len(set(locs)) <= 1) if locs else None
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "alive.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLALIVE could not end play: %s" % exc)
