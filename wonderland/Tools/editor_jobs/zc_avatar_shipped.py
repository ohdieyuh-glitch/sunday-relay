# DOES THE SHIPPED /pa PATH ACTUALLY TAKE ITS AVATARS OUT OF GLOBAL ILLUMINATION?
#
# FOUNDER, P0 item 5: "Cached spawn improved about 509 ms to 73 ms but still hitches... optimize remaining
# spawn/render cost."
#
# WHAT IS ALREADY MEASURED. On one avatar at a baseline frame of 203.22 ms, setting
# affect_dynamic_indirect_lighting and affect_distance_field_lighting to false on its components saved
# 170.57 ms -- slightly MORE than turning global illumination off for the whole world (169.47), and without
# touching any other surface's lighting. Shadows are not the cost: every shadow in the scene off saved 5.84.
#
# WHY THAT IS NOT YET EVIDENCE THAT THE FIX WORKS. That measurement was taken on an avatar the JOB spawned
# through the test library, with the properties set from Python. The fix ships in ShowProjectAvatars -- the
# founder's own `/pa` route -- which is a different function, and "I measured the equivalent change on a
# different actor and then compiled" is not the same as having seen it work. A UFUNCTION hook was added for
# exactly this reason rather than leaving the shipped path unmeasured.
#
# SO THIS ASKS TWO THINGS OF THE REAL PATH, and the first is the one that can fail silently:
#
#   DID THE PROPERTIES TAKE?  Read back affect_dynamic_indirect_lighting and affect_distance_field_lighting
#                             on the components of the actors /pa actually created. If the loop missed them
#                             -- wrong component class, ran before they existed, whatever -- this says so
#                             directly, without any inference from a frame time.
#
#   IS THE FRAME CHEAPER?     The whole point. Measured against the SAME avatars with the properties turned
#                             back ON, in the same run, at the same camera, so the comparison is not against
#                             a number from an earlier session on a differently loaded machine.
#
# `stat unit` IS A TOGGLE AND IS VERIFIED LIVE. Issued once is a coin flip: a previous job in the session may
# have left it on, and then a single issue turns it OFF and FStatUnitData returns the same stale numbers
# forever. A run of the avatar ladder did exactly that -- six rungs at frame 36.81, render 26.54, game 37.84,
# byte identical -- and the frozen-frame guard missed it because the ENGINE FRAME NUMBER was advancing fine.
# The numbers were frozen; the frames were not. So this flips it and requires the VALUES to move.
#
# NOT CONCURRENT: this job owns PIE.
CONCURRENT = False

import time
import unreal

L = unreal.WonderlandUiTestLibrary
H = unreal.WonderlandHudTestLibrary
SL = unreal.SystemLibrary

SAMPLES = 24
SETTLE_BUDGET_S = 120.0
SETTLE_TOLERANCE = 0.12
FROZEN_LIMIT = 8


def job():
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

    ui = L.get_ui(world)
    if ui is None:
        RESULT["status"] = "VOID: no UI subsystem"
        return

    def read_frame():
        try:
            got = H.get_raw_frame_cost_ms()
            n = int(H.get_engine_frame_number())
        except Exception:                                           # noqa: BLE001
            return None
        if got is None:
            return None
        return (float(got[0]), float(got[1]), float(got[2]), float(got[3]), n)

    SL.execute_console_command(world, "stat unit")
    yield 2.5

    def stat_is_live():
        seen = []
        for _ in range(8):
            row = read_frame()
            if row is not None:
                seen.append(round(row[0], 4))
            yield 0.15
        return len(set(seen)) > 1

    live = False
    gen = stat_is_live()
    try:
        while True:
            yield next(gen)
    except StopIteration as done:
        live = bool(done.value)
    if not live:
        SL.execute_console_command(world, "stat unit")
        yield 2.5
        gen = stat_is_live()
        try:
            while True:
                yield next(gen)
        except StopIteration as done:
            live = bool(done.value)
    RESULT["stat_overlay_live"] = live
    record("S_STAT", "the stat unit overlay is drawing, so its numbers change", live,
           note="a toggle issued once is a coin flip, and the frozen-frame guard cannot see it because the "
                "engine frame number keeps advancing while the numbers stand still.")
    if not live:
        RESULT["status"] = "VOID: stat unit never reported changing numbers"
        return

    # ---- THE FOUNDER'S OWN ROUTE.
    try:
        shown = bool(ui.show_project_avatars_for_test(""))
    except Exception as err:                                        # noqa: BLE001
        RESULT["status"] = "VOID: could not run the /pa path (%s)" % str(err)[:110]
        return
    yield 8.0
    record("S00", "the founder's own /pa showcase put avatars in the world", shown, returned=shown)
    if not shown:
        RESULT["status"] = "VOID: /pa reported nothing shown"
        return

    # The actors /pa created are embodiments whose label begins WL_PA_.
    avatars = []
    for actor in unreal.GameplayStatics.get_all_actors_of_class(
            world, unreal.WonderlandCompanionEmbodiment):
        try:
            if actor.get_actor_label().startswith("WL_PA_"):
                avatars.append(actor)
        except Exception:                                           # noqa: BLE001
            pass
    RESULT["avatars_found"] = len(avatars)
    record("S01", "the avatars /pa created can be found to be read", bool(avatars), found=len(avatars),
           note="matched on the WL_PA_ label the shipped path assigns, rather than on class -- the costume "
                "worn by the Dog and the AI Companions are the same class.")
    if not avatars:
        RESULT["status"] = "VOID: could not find the avatars /pa created"
        return

    # ---- DID THE PROPERTIES TAKE? Read them off the actors the shipped code made.
    def survey():
        out = {"components": 0, "indirect_off": 0, "distance_field_off": 0}
        for a in avatars:
            for comp in a.get_components_by_class(unreal.PrimitiveComponent):
                out["components"] += 1
                try:
                    if not comp.get_editor_property("affect_dynamic_indirect_lighting"):
                        out["indirect_off"] += 1
                except Exception:                                   # noqa: BLE001
                    pass
                try:
                    if not comp.get_editor_property("affect_distance_field_lighting"):
                        out["distance_field_off"] += 1
                except Exception:                                   # noqa: BLE001
                    pass
        return out

    RESULT["as_shipped"] = survey()
    n = RESULT["as_shipped"]["components"]
    # THE FIGURE'S MESHES, NOT EVERY COMPONENT THE ACTOR OWNS. An actor also carries default subobjects --
    # a root primitive and the like -- which are not part of the figure and are not built by LoadFigure. On
    # three avatars of 66 components each, 195 are the 65 per-part meshes and 3 are those defaults. Demanding
    # 198 was my arithmetic, not the fix's: it failed a run where the change had worked perfectly.
    figure_meshes = n - len(avatars)
    record("S02", "every FIGURE mesh of every /pa avatar is out of global illumination, as shipped",
           n > 0 and RESULT["as_shipped"]["indirect_off"] >= figure_meshes,
           figure_meshes_expected=figure_meshes, **RESULT["as_shipped"],
           note="READ OFF THE ACTORS THE SHIPPED CODE CREATED, not inferred from a frame time. The default "
                "subobjects are left alone deliberately -- they are not the figure, and 3 of 198 is what "
                "that looks like.")

    def measure():
        rows, frozen, last_n = [], 0, None
        while len(rows) < SAMPLES:
            row = read_frame()
            if row is None:
                yield 0.1
                continue
            if last_n is not None and row[4] == last_n:
                frozen += 1
                if frozen > FROZEN_LIMIT:
                    break
            else:
                frozen = 0
                rows.append(row)
            last_n = row[4]
            yield 0.12
        return rows

    def median(vs):
        s = sorted(vs)
        k = len(s)
        return round((s[k // 2] if k % 2 else 0.5 * (s[k // 2 - 1] + s[k // 2])), 2) if k else None

    def take(tag):
        gen2 = measure()
        rows = []
        try:
            while True:
                yield next(gen2)
        except StopIteration as done:
            rows = done.value or []
        RESULT.setdefault("readings", {})[tag] = {
            "frames": len(rows), "frame_ms": median([r[0] for r in rows]),
            "game_ms": median([r[1] for r in rows]), "render_ms": median([r[2] for r in rows])}
        emit("S_%s" % tag, "INFO", tag, RESULT["readings"][tag])

    # settle before the first reading, since it is what the second is compared against
    settle, started = [], time.time()
    while time.time() - started < SETTLE_BUDGET_S:
        row = read_frame()
        if row is not None:
            settle.append(row[0])
            if len(settle) >= 3:
                win = settle[-3:]
                if min(win) > 0 and (max(win) - min(win)) / min(win) < SETTLE_TOLERANCE:
                    break
        yield 0.1
    RESULT["settled"] = len(settle) >= 3

    yield from take("as_shipped_out_of_gi")

    # ---- AND PUT THEM BACK IN, to see what the fix is worth on THESE avatars in THIS run.
    for a in avatars:
        for comp in a.get_components_by_class(unreal.PrimitiveComponent):
            try:
                comp.set_editor_property("affect_dynamic_indirect_lighting", True)
                comp.set_editor_property("affect_distance_field_lighting", True)
                comp.mark_render_state_dirty()
            except Exception:                                       # noqa: BLE001
                pass
    yield 5.0
    RESULT["after_putting_back"] = survey()
    yield from take("put_back_into_gi")

    # and leave them as shipped
    for a in avatars:
        for comp in a.get_components_by_class(unreal.PrimitiveComponent):
            try:
                comp.set_editor_property("affect_dynamic_indirect_lighting", False)
                comp.set_editor_property("affect_distance_field_lighting", False)
                comp.mark_render_state_dirty()
            except Exception:                                       # noqa: BLE001
                pass
    yield 3.0

    out_gi = (RESULT.get("readings") or {}).get("as_shipped_out_of_gi") or {}
    in_gi = (RESULT.get("readings") or {}).get("put_back_into_gi") or {}
    saved = (round(in_gi["frame_ms"] - out_gi["frame_ms"], 2)
             if out_gi.get("frame_ms") is not None and in_gi.get("frame_ms") is not None else None)
    RESULT["milliseconds_the_shipped_fix_saves"] = saved
    # ---- A FRACTION OF THE FRAME, NOT A NUMBER OF MILLISECONDS.
    #
    # An absolute floor is a statement about the machine. 40 ms was set from a session whose baseline frame
    # was 203 ms; on a quieter box the whole frame is 45 and a 14 ms saving -- a QUARTER of it -- fails the
    # same clause. The fix did not change between those two runs; the hardware did.
    base_ms = in_gi.get("frame_ms")
    share = round(saved / base_ms, 4) if (saved is not None and base_ms) else None
    RESULT["share_of_frame_saved"] = share
    record("S03", "the shipped fix makes the frame measurably cheaper on the founder's own avatars",
           share is not None and share >= 0.15,
           saved_ms=saved, share_of_frame=share, floor_share=0.15,
           out_of_gi=out_gi, in_gi=in_gi,
           avatars=len(avatars),
           note="both readings taken in THIS run at the same camera on the SAME avatars, so the comparison "
                "is not against a number from an earlier session on a differently loaded machine. The floor "
                "is deliberately well below the 170.57 measured on one avatar, because /pa shows a whole "
                "family and the machine's load is not controlled.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
