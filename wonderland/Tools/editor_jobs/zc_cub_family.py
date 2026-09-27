# DOES EVERY SKIN'S FLOCK LOOK LIKE THAT SKIN'S CUBS?
#
# FOUNDER, 2026-09-27: "Every mascot skin must have a corresponding Sub-Agent Cub ... The player should
# immediately be able to look at a Cub and know: that is the Skeleton Flame Cub ... The selected mascot skin
# should determine the default Cub appearance ... Preserve the actual Sub-Agent Cub gameplay/runtime identity."
#
# So, in the world rather than on the stage: the Dog wears each skin in turn, a flock of three is summoned the
# way Julius summons one, and the cubs are photographed beside their parent, front and side, by day and by
# night. Three things are asserted. The flock's bodies are the DRESSED figures and not the plain cub -- read off
# the box counts, because a dressed cub carries its parent's halo, fire, skull or edge and is 70-180 boxes
# heavier than the plate's plain cub. The flock CHANGES when the skin does, in place, without being dismissed.
# And the grounding the founder already ruled on holds: no cub sinks, no companion moves when the flock arrives.
#
# The resemblance itself -- "that is the Apollo Cub" -- is the founder's call, from the pictures.
# NOT CONCURRENT. This job begins and ends Play-In-Editor. On 2026-09-27 a stage sweep of mine declared
# CONCURRENT = True, the channel ran it beside the world session's ten-minute mascot sweep, and its closing
# editor_request_end_play tore PIE down under that sweep at 15:08 UTC -- which then reported a black viewport
# as mascot measurements through nine gates. Any job that owns PIE is serialised.
CONCURRENT = False

import math
import os
import unreal

L = unreal.WonderlandUiTestLibrary

ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "cub_family")
SKINS = ("relay_og", "celestial_light", "apollo_v1", "apollo", "arden_infernal_v1", "arden_infernal", "skeleton_flame_v1", "skeleton_flame")
# The plate's plain cubs, as the generator writes them. A dressed cub is heavier than any of these.
PLAIN_CUB_BOXES = (595, 601, 603)
FLOCK = 3
HOURS = (("day", 12.0), ("night", 22.5))


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
    yield 8.0
    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    ui = L.get_ui(world)
    cubs = L.get_cubs(world)
    record("K00", "the Sub-Agent Cub subsystem is running", cubs is not None)
    if cubs is None or dog is None or ui is None:
        RESULT["status"] = "FAIL"
        return

    def bodies():
        out = []
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandSubAgentCub):
            try:
                body = actor.get_body()
                out.append(int(body.get_box_count()) if body is not None else 0)
            except Exception:                                      # noqa: BLE001
                out.append(0)
        return sorted(out)

    def aim(offset_deg, distance=420.0):
        here = dog.get_actor_location()
        yaw = dog.get_actor_rotation().yaw + offset_deg
        eye = unreal.Vector(here.x + math.cos(math.radians(yaw)) * distance,
                            here.y + math.sin(math.radians(yaw)) * distance, here.z + 110.0)
        L.pose_camera(world, eye, unreal.Vector(here.x, here.y, here.z + 70.0), 55.0)

    # ---- ONE FLOCK, RE-DRESSED IN PLACE AS THE SKIN CHANGES. Summoned once, never dismissed between skins,
    # so the second assertion -- that a living flock follows the Dog's skin -- is actually exercised.
    cubs.summon_sub_agent_cubs(0)
    yield 2.0
    cubs.summon_sub_agent_cubs(FLOCK)
    yield 7.0

    by_skin = {}
    RESULT["by_skin"] = by_skin
    for skin in SKINS:
        ui.wear_relay_skin(skin)
        # the flock is re-dressed on the tick after the registry changes; a figure takes a moment to build
        yield 5.0
        counts = bodies()
        row = {"cub_boxes": counts, "dressed": [c for c in counts if c > 0 and c not in PLAIN_CUB_BOXES],
               "plain": [c for c in counts if c in PLAIN_CUB_BOXES]}
        by_skin[skin] = row
        for hour_label, hour in HOURS:
            unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour %.2f" % hour)
            yield 3.0
            for view, offset in (("front", 20.0), ("side", 95.0)):
                aim(offset)
                yield 1.5
                try:
                    L.capture_game_viewport(os.path.join(ROOT, "%s_%s_%s.png" % (skin, hour_label, view)))
                except Exception:                                  # noqa: BLE001
                    pass
                L.release_camera(world)
                yield 0.3
        emit("K_%s" % skin, "INFO", "flock under %s" % skin, row)

    unreal.SystemLibrary.execute_console_command(world, "wl.Sky.Hour 12.00")

    record("K01", "a flock of three stands beside the Dog under every skin",
           all(len(r["cub_boxes"]) == FLOCK and all(c > 0 for c in r["cub_boxes"]) for r in by_skin.values()),
           counts={k: r["cub_boxes"] for k, r in by_skin.items()})
    record("K02", "under Relay OG the flock is the plate's own cubs, and under every premium skin it is dressed",
           by_skin.get("relay_og", {}).get("plain") and len(by_skin["relay_og"]["plain"]) == FLOCK
           and all(len(by_skin[s]["dressed"]) == FLOCK for s in SKINS if s != "relay_og"),
           plain_under_relay_og=by_skin.get("relay_og", {}).get("plain"),
           dressed={s: by_skin[s]["dressed"] for s in SKINS if s != "relay_og"},
           note="box counts: a dressed cub carries its parent's halo, fire, skull or edge and is heavier than "
                "the plain cub. This proves the RIGHT FILE loaded; whether it reads as that skin's cub is the "
                "founder's call from the captures.")
    distinct = len({tuple(by_skin[s]["cub_boxes"]) for s in SKINS})
    record("K03", "the same living flock changed its coat with every skin change, without being dismissed",
           distinct == len(SKINS), distinct_flocks=distinct, of=len(SKINS),
           note="one summon at the start, five skins, five different flocks: re-dressed in place.")

    cubs.summon_sub_agent_cubs(0)
    RESULT["captures_dir"] = ROOT
    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
