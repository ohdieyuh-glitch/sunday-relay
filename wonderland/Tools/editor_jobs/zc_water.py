# IS THE WATER BELIEVABLE, OR STILL A SHINY OPAQUE SOLID?
#
# FOUNDER, P2 item 10: "Replace plastic-looking water/streams/ponds/fountains with believable animated
# water: reflections/refraction, normals, depth/color response, flow, sane performance."
#
# WHAT WAS ALREADY DONE, AND WHY IT IS NOT YET EVIDENCE. M_WL_RealWater was authored as a new master --
# translucent, two normal maps panning at unrelated rates, depth fade, refraction -- and the day-cycle
# subsystem re-dresses every surface wearing MI_V2_Water with it at runtime. All of that is intent. Whether
# 64 basins in a live world actually ended up wet is a different question, and the one a founder looking at
# a pond is asking.
#
# THIS IS THE SHADOW TEST RUN BACKWARDS. zc_shadows holds the world still and asks whether the picture
# holds still with it. Water is the one surface that MUST NOT: if the sky is frozen, the camera is fixed and
# nothing in the level is moving, then a pond that reads identical from one second to the next is not
# flowing, and a pond that reads identical is exactly what "plastic" means.
#
# So the same frame is measured twice, and a patch of ground beside the pond is measured the same way as a
# control. Water must move; the stone beside it must not; and the difference between those two numbers is
# the evidence, rather than any threshold invented here.
import os

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
ROOT = os.path.join(os.path.dirname(CHANNEL), "captures", "zc", "water")

MASTER = "/Game/Wonderland/Materials/M_WL_RealWater.M_WL_RealWater"
RT_W, RT_H = 480, 270
GRID_X, GRID_Y = 12, 9


def sample(world, rt):
    out = []
    for gy in range(GRID_Y):
        for gx in range(GRID_X):
            x = int((gx + 0.5) * RT_W / GRID_X)
            y = int((gy + 0.5) * RT_H / GRID_Y)
            c = unreal.RenderingLibrary.read_render_target_pixel(world, rt, x, y)
            out.append(0.2126 * float(c.r) + 0.7152 * float(c.g) + 0.0722 * float(c.b))
    return out


def spread(a, b):
    if not a or len(a) != len(b):
        return -1.0
    return sum(abs(x - y) for x, y in zip(a, b)) / float(len(a))


def job():
    os.makedirs(ROOT, exist_ok=True)
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    tests = []
    RESULT["tests"] = tests
    RESULT["status"] = "running"

    def record(tid, name, ok, **detail):
        tests.append({"id": tid, "name": name, "pass": bool(ok), "detail": detail})
        emit(tid, "PASS" if ok else "FAIL", name, detail)

    if ues.get_game_world() is not None:
        les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 600)
    L.set_background_throttle_suspended(True)
    les.editor_request_begin_play()
    yield (lambda: ues.get_game_world() is not None, 240)
    yield (lambda: unreal.GameplayStatics.get_player_pawn(ues.get_game_world(), 0) is not None, 120)
    yield 6.0
    world = ues.get_game_world()
    L.focus_game_viewport()
    yield 0.5

    cap = None
    try:
        # ------------------------------------------------------------ IS IT A REAL WATER SHADER AT ALL
        master = unreal.EditorAssetLibrary.load_asset(MASTER)
        blend = str(master.get_editor_property("blend_mode")) if master is not None else "missing"
        RESULT["master"] = {"asset": MASTER, "blend_mode": blend}
        record("Q00", "the water master exists and is translucent, not opaque",
               master is not None and "TRANSLUCENT" in blend.upper(),
               blend_mode=blend,
               note="the old master was BLEND_OPAQUE, so no parameter value it had could ever look wet")

        # ------------------------------------------------------------ DID IT REACH THE PONDS
        # Matched on the material actually worn, the same way the runtime matches, so a basin's stone rim or
        # a fountain's gold finial cannot be counted as water by having a watery name.
        wet, biggest, best_size = 0, None, -1.0
        for actor in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.StaticMeshActor):
            mesh = actor.static_mesh_component
            if mesh is None:
                continue
            for slot in range(int(mesh.get_num_materials())):
                worn = mesh.get_material(slot)
                if worn is None:
                    continue
                name = str(worn.get_name())
                parent = ""
                try:
                    parent = str(worn.get_editor_property("parent").get_name())
                except Exception:
                    parent = ""
                if "M_WL_RealWater" not in name and "M_WL_RealWater" not in parent:
                    continue
                wet += 1
                origin, extent = actor.get_actor_bounds(False)
                size = float(extent.x) * float(extent.y)
                if size > best_size:
                    best_size, biggest = size, (origin, extent)
        RESULT["surfaces_dressed"] = wet
        record("Q01", "the ponds, wells, canals and basins are actually wearing it",
               wet > 0 and biggest is not None, surfaces=wet,
               note="counted by the material each surface wears in the live world, not by the log line")
        if biggest is None:
            record("Q02", "the water moves while the world stands still", False,
                   note="no dressed water surface was found to look at")
            les.editor_request_end_play()
            yield (lambda: ues.get_game_world() is None, 300)
            return

        # ------------------------------------------------------------ DOES IT FLOW
        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 0")
        yield 1.5

        origin, extent = biggest
        rt = unreal.RenderingLibrary.create_render_target2d(world, RT_W, RT_H)
        down = unreal.Rotator(-90.0, 0.0, 0.0)
        # Low enough that the frame is water and nothing else. A vantage that caught the rim would dilute
        # the measurement with stone and make a still pond look like it was moving a little.
        lift = max(float(extent.z) + 120.0, 200.0)
        at_water = unreal.Vector(origin.x, origin.y, origin.z + lift)
        # SPAWNED BY THE TEST LIBRARY. GameplayStatics' deferred spawn is not bound in this engine's Python,
        # and the editor's own spawn puts an actor in the EDITOR world rather than the running one -- which
        # would photograph a level nobody is playing.
        cap = H.spawn_scene_capture(world, at_water, down, rt)
        if cap is None:
            raise RuntimeError("no scene capture could be spawned into the running world")
        comp = cap.get_editor_property("capture_component2d")
        yield 1.0

        def two_frames():
            comp.capture_scene()
            first = sample(world, rt)
            for _ in range(10):
                yield 0.1
            comp.capture_scene()
            second = sample(world, rt)
            RESULT["_last"] = (first, second)

        for step in two_frames():
            yield step
        a, b = RESULT["_last"]
        water_moves = spread(a, b)
        H.capture_viewport_jpeg(os.path.join(ROOT, "01_water.jpg"), 1400, 90)

        # ---- THE CONTROL: ground beside the pond, same camera height, same frozen sky. Whatever this reads
        # is what the renderer does on its own; the water has to beat it to have moved at all.
        aside = unreal.Vector(origin.x + float(extent.x) * 3.0 + 600.0, origin.y, origin.z + lift)
        cap.set_actor_location(aside, False, False)
        yield 1.2
        for step in two_frames():
            yield step
        c, d = RESULT["_last"]
        stone_moves = spread(c, d)
        H.capture_viewport_jpeg(os.path.join(ROOT, "02_control_ground.jpg"), 1400, 90)

        unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
        yield 0.5

        RESULT["flow"] = {"water_frame_change": round(water_moves, 4),
                          "ground_control_change": round(stone_moves, 4),
                          "grid_points": GRID_X * GRID_Y, "gap_s": 1.0}
        record("Q02", "the water moves while the world stands still",
               water_moves > stone_moves + 1.0,
               water_frame_change=round(water_moves, 4),
               ground_control_change=round(stone_moves, 4),
               note="sky frozen, camera fixed, nothing else moving; the ground beside the pond is the floor "
                    "this has to beat, so no threshold is invented here")

    except Exception as err:                                   # noqa: BLE001
        RESULT["error"] = str(err)
        record("Q99", "the water measurement ran to completion", False, error=str(err))
        try:
            unreal.SystemLibrary.execute_console_command(world, "wl.Sky.DayMinutes 24")
        except Exception:
            pass

    if cap is not None:
        try:
            cap.destroy_actor()
        except Exception:
            pass
    RESULT.pop("_last", None)
    RESULT["status"] = "measured"
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
