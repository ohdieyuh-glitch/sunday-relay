# THE FOUNDER'S SKIN PORTRAITS: all seven, in the world, framed so the whole Dog reads.
#
# FOUNDER, section 10: "entire Dog readable, head clearly visible, arms clearly visible, important skin features
# visible, no clipping, no giant empty margins, no camera inside the mesh."
#
# THE FIRST PASS CROPPED THE HEAD. The camera stood 300 uu from a body 201 uu tall at a 45 degree field, which
# fills the frame with chest. This solves the distance from the body's own measured height instead, and takes the
# last frame twice a few seconds apart so the idle can be seen to be live rather than asserted to be.
#
# EVERY SWITCH GOES THROUGH /skin, the command the founder will actually type. Nothing here reaches past the
# registry, and nothing here grants an entitlement: the preview body is dressed, the account is not.
import json
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "skin_portraits")
SKINS = ["relay_og", "arden_infernal", "apollo", "skeleton_flame", "hagoromo", "celestial_light", "bee"]


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
        ui = L.get_ui(world)
        if not ui:
            RESULT["status"] = "failed"
            RESULT["why"] = "no ui subsystem"
            return
        L.focus_game_viewport()

        # `/skin <id>` stages the preview body in the world and dresses it, with no panel in the way.
        RESULT["staged"] = bool(ui.handle_terminal_command("/skin relay_og"))
        yield 3.0
        stages = unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSkinStage)
        if not stages:
            RESULT["status"] = "failed"
            RESULT["why"] = "no skin stage after /skin"
            return
        stage = stages[0]
        RESULT["in_world"] = bool(stage.is_in_world_preview())

        def frame(body):
            # SOLVED FROM THE BODY'S OWN HEIGHT, not a constant. A halo or a crown stands well above the head, so
            # the distance is taken from the measured figure and the look-at sits at mid-chest.
            height = max(float(body.get_figure_height_uu()), 80.0)
            at = body.get_actor_location()
            back = height * 2.9
            # IN FRONT OF THE DOG, NOT BEHIND IT. Standing the camera at a fixed +X offset photographed the back of
            # the head -- a plain white box with no visor and no eyes -- because the body turns to face the player.
            # The world lane hit exactly this on its creatures. Ask the body which way it is looking.
            fwd = body.get_actor_forward_vector()
            right = body.get_actor_right_vector()
            eye = unreal.Vector(at.x + fwd.x * back + right.x * height * 0.5,
                                at.y + fwd.y * back + right.y * height * 0.5,
                                at.z + height * 0.72)
            L.pose_camera(world, eye, unreal.Vector(at.x, at.y, at.z + height * 0.46), 40.0)

        rows = []
        for skin in SKINS:
            ok = bool(ui.handle_terminal_command("/skin %s" % skin))
            yield 1.8
            body = stage.get_body()
            if body is None:
                rows.append({"skin": skin, "accepted": ok, "why": "no body"})
                continue
            frame(body)
            yield 1.2
            H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % skin), 1900, 95)
            rows.append({"skin": skin, "accepted": ok, "shown": str(stage.get_shown_skin_id()),
                         "height_uu": round(float(body.get_figure_height_uu()), 1)})
        RESULT["portraits"] = rows
        RESULT["all_shown"] = all(r.get("shown", "").endswith(r["skin"]) or r["skin"] in r.get("shown", "")
                                  for r in rows)

        # ---- AND IT IS ALIVE: the same skin, twice, seconds apart. If the two frames differ the idle is running.
        body = stage.get_body()
        if body is not None:
            def pose():
                return [(round(c.get_relative_transform().rotation.euler().y, 3),
                         round(c.get_relative_transform().translation.z, 3))
                        for c in body.get_components_by_class(unreal.SceneComponent)]

            a = pose()
            where_a = body.get_actor_location()
            frame(body)
            yield 0.8
            H.capture_viewport_jpeg(os.path.join(ROOT, "idle_a.jpg"), 1900, 95)
            yield 3.2
            b = pose()
            where_b = body.get_actor_location()
            H.capture_viewport_jpeg(os.path.join(ROOT, "idle_b.jpg"), 1900, 95)
            RESULT["parts_moved"] = sum(1 for x, y in zip(a, b) if x != y)
            RESULT["parts_total"] = len(a)
            # STAYS IN ONE PLACE is measured HORIZONTALLY: a gentle vertical float is the idle, not walking.
            RESULT["drift_xy_uu"] = round(
                ((where_b.x - where_a.x) ** 2 + (where_b.y - where_a.y) ** 2) ** 0.5, 2)
            RESULT["stayed_in_place"] = RESULT["drift_xy_uu"] < 1.0
            RESULT["idle_is_live"] = RESULT["parts_moved"] > 0
        L.release_camera(world)
        RESULT["status"] = "done"
    finally:
        with open(os.path.join(ROOT, "portraits.json"), "w", encoding="utf-8") as fh:
            json.dump({k: v for k, v in RESULT.items()}, fh, indent=1, default=str)
        try:
            les.editor_request_end_play()
            L.set_background_throttle_suspended(False)
        except Exception as exc:
            unreal.log_warning("WLPORTRAIT could not end play: %s" % exc)
