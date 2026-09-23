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
import math
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
            """A CLEAR VIEW OF THE FRONT, found by tracing rather than assumed.

            Solving the distance from the figure's height is right, but a tall skin needs a long lens-throw --
            Apollo is 235 uu and wants nearly seven metres of it -- and seven metres from the arrival plaza is
            frequently inside a planter. Two frames came back as flat brown nothing that way.

            So candidate eyes are swept from straight-ahead outward in both directions, each traced back to the
            body, and the first unobstructed one wins. Front is preferred because a Relay Dog's identity -- visor,
            eyes, chest emblem -- is all on the front; the sweep only gives that up when the front is blocked.
            """
            height = max(float(body.get_figure_height_uu()), 80.0)
            at = body.get_actor_location()
            look = unreal.Vector(at.x, at.y, at.z + height * 0.46)
            fwd = body.get_actor_forward_vector()
            base = math.degrees(math.atan2(fwd.y, fwd.x))
            # THE BYSTANDERS. A trace cannot see the companions -- they have no collision -- and the first pass
            # came back as a frame full of Jhinn with the Dog somewhere behind her. Anything standing between the
            # lens and the subject, or right beside the lens, disqualifies that eye.
            bystanders = []
            for cls in (unreal.WonderlandCompanionEmbodiment, unreal.WonderlandSubAgentCub, unreal.Pawn):
                for a in unreal.GameplayStatics.get_all_actors_of_class(world, cls):
                    if a == body:
                        continue
                    v = a.get_actor_location()
                    bystanders.append((v.x, v.y))

            def eye_is_crowded(eye):
                ex, ey, lx, ly = eye.x, eye.y, look.x, look.y
                sx, sy = lx - ex, ly - ey
                seg = sx * sx + sy * sy or 1.0
                for bx, by in bystanders:
                    if math.hypot(bx - ex, by - ey) < 220.0:
                        return True
                    tt = max(0.0, min(1.0, ((bx - ex) * sx + (by - ey) * sy) / seg))
                    if math.hypot(ex + sx * tt - bx, ey + sy * tt - by) < 150.0:
                        return True
                return False

            for back_scale in (2.9, 2.4, 2.0):
                back = height * back_scale
                # 40 DEGREES FIRST. Straight ahead of the preview spot is the planter bed, and a bed of flowers has
                # no collision, so a trace calls it clear and Celestial Light was photographed from inside the tulips.
                # Every tall skin found its clear view at +40, which is the open paving; try that before the rest.
                for offset in (40.0, -40.0, 22.0, -22.0, 0.0, 60.0, -60.0, 80.0, -80.0):
                    rad = math.radians(base + offset)
                    eye = unreal.Vector(at.x + math.cos(rad) * back,
                                        at.y + math.sin(rad) * back,
                                        at.z + height * 0.62)
                    if eye_is_crowded(eye):
                        continue
                    blocked = unreal.SystemLibrary.line_trace_single(
                        world, eye, look, unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [body],
                        unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
                    # AND THE LENS ITSELF MUST BE IN OPEN AIR: a trace that STARTS inside a post never hits the
                    # post, which is how a camera sitting in a wall was reported clear.
                    lens_boxed = unreal.SystemLibrary.line_trace_single(
                        world, unreal.Vector(eye.x, eye.y, eye.z + 250.0), eye,
                        unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [body],
                        unreal.DrawDebugTrace.NONE, True, unreal.LinearColor.RED, unreal.LinearColor.GREEN, 0.0)
                    if not blocked and not lens_boxed:
                        L.pose_camera(world, eye, look, 40.0)
                        return {"offset_deg": offset, "back_uu": round(back, 1)}
            # Nothing clear at any distance: take the nearest front view rather than no picture at all.
            rad = math.radians(base)
            L.pose_camera(world, unreal.Vector(at.x + math.cos(rad) * height * 1.8,
                                               at.y + math.sin(rad) * height * 1.8,
                                               at.z + height * 0.62), look, 40.0)
            return {"offset_deg": 0.0, "back_uu": round(height * 1.8, 1), "fallback": True}

        rows = []
        for skin in SKINS:
            ok = bool(ui.handle_terminal_command("/skin %s" % skin))
            yield 1.8
            body = stage.get_body()
            if body is None:
                rows.append({"skin": skin, "accepted": ok, "why": "no body"})
                continue
            cam = frame(body)
            yield 1.2
            H.capture_viewport_jpeg(os.path.join(ROOT, "%s.jpg" % skin), 1900, 95)
            rows.append({"skin": skin, "accepted": ok, "shown": str(stage.get_shown_skin_id()),
                         "height_uu": round(float(body.get_figure_height_uu()), 1), "cam": cam})
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
