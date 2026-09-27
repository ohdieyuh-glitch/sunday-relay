# WHERE DO EIGHT HUNDRED AND FORTY MEGABYTES PER AVATAR ACTUALLY GO?
#
# FOUNDER, P0 item 5: "Project Avatars must scale inside one Server Avatar."
#
# Measured live: spawning eight Cherubim_Large avatars took free memory from 7.20 GB to 0.50 GB. About 840 MB
# each. That is the real ceiling on a crowd -- the steady frame cost scales beautifully, 0.33 ms for the tenth
# avatar, while the footprint does not, and eight Large figures exhaust a sixteen-gigabyte machine.
#
# 840 MB FOR 36,025 BOXES IS ABOUT 23 KB PER BOX, and that number is the reason this job exists. An instance
# is a transform -- on the order of sixty-four bytes. Three orders of magnitude of difference is not art
# volume, it is per-component overhead, and overhead has levers that art does not.
#
# THE UNTESTED ONE IS ALREADY WIRED. These figures are built from HierarchicalInstancedStaticMesh components,
# chosen for per-instance culling, and wl.Figure.Hism switches them to plain InstancedStaticMesh. A HISM keeps
# a quadtree over its instances and builds cluster data for them; a plain ISM does not. The earlier ladder
# compared the two on FRAME TIME and found nothing outside the noise -- which settled that the tree does not
# cost time, and said nothing at all about what it costs in memory.
#
# So both are measured the same way, on footprint, with the figure destroyed and the measurement repeated to
# separate a real difference from drift. If the tree is most of the 840 MB then a crowd gets dramatically
# cheaper for a console variable, and P0 item 5 stops being art-bound.
CONCURRENT = True

import os
import time
import unreal

L = unreal.WonderlandUiTestLibrary

AVATARS = os.path.join(os.path.dirname(os.path.dirname(CHANNEL)), "ProjectAvatars")
SPAWN_EACH = 3


def free_mb():
    """What THIS PROCESS is using, in megabytes.

    Used rather than available. Free physical memory moves with every other process on the machine, and this
    session has already been misled once by a number that was really measuring the host: a stuck 618 ms frame
    time that turned out to be the editor thrashing. Attributing a figure's cost needs a reading from inside
    the process that built it, which is why DescribeMemory was added in C++ -- Python is offered none here.

    Returned NEGATED so the arithmetic downstream is unchanged: more used is less "free".
    """
    try:
        note = str(unreal.WonderlandUiTestLibrary.describe_memory())
        for token in note.split():
            if token.startswith("usedPhysicalMb="):
                return -float(token.split("=", 1)[1])
    except Exception:                                              # noqa: BLE001
        return None
    return None


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
    yield 10.0

    probe = free_mb()
    if probe is None:
        record("M00", "the engine reports its own memory", False,
               note="without a reading from inside the process this measures the whole machine, including "
                    "whatever else happens to be running, and would be worthless")
        RESULT["status"] = "FAIL: no memory stats"
        return
    record("M00", "the engine reports its own memory", True, free_mb=round(probe))

    files = [os.path.join(AVATARS, n) for n in sorted(os.listdir(AVATARS)) if n.lower().endswith(".wlvox")]
    big = [f for f in files if "Large" in f] or files
    path = big[0]
    RESULT["figure"] = os.path.basename(path)

    dog = unreal.GameplayStatics.get_player_pawn(world, 0)
    base = dog.get_actor_location() + dog.get_actor_forward_vector() * 1400.0

    rows = {}
    RESULT["by_mode"] = rows

    def run_mode(label, hism):
        unreal.SystemLibrary.execute_console_command(world, "wl.Figure.Hism %d" % hism)
        yield 3.0
        before = free_mb()
        standing = []
        for i in range(SPAWN_EACH):
            spot = unreal.Vector(base.x + i * 600.0, base.y, base.z)
            body = L.spawn_figure_actor(world, spot, path, "WL_Mem_%s_%d" % (label, i))
            if body is not None:
                standing.append(body)
            yield 4.0
        yield 4.0
        after = free_mb()
        parts = None
        if standing:
            try:
                parts = len(standing[0].get_components_by_class(unreal.InstancedStaticMeshComponent))
            except Exception:                                      # noqa: BLE001
                parts = None
        for body in standing:
            try:
                body.destroy_actor()
            except Exception:                                      # noqa: BLE001
                pass
        # A COLLECT AND A PAUSE, so the recovered figure is not counted against the next mode.
        unreal.SystemLibrary.execute_console_command(world, "obj gc")
        yield 8.0
        back = free_mb()
        row = {"free_before_mb": None if before is None else round(before),
               "free_after_mb": None if after is None else round(after),
               "free_recovered_mb": None if back is None else round(back),
               "spawned": len(standing), "components_each": parts}
        if before is not None and after is not None and standing:
            row["mb_per_avatar"] = round((before - after) / float(len(standing)), 1)
        rows[label] = row
        emit("M_%s" % label, "INFO", label, row)

    # OUT AND BACK, so thermal or cache drift shows as the two passes of one mode disagreeing rather than as
    # a difference between modes. The first avatar ladder read the machine warming up and called it a result.
    yield from run_mode("hierarchical_first", 1)
    yield from run_mode("plain_first", 0)
    yield from run_mode("plain_second", 0)
    yield from run_mode("hierarchical_second", 1)
    unreal.SystemLibrary.execute_console_command(world, "wl.Figure.Hism 1")

    got = {k: v.get("mb_per_avatar") for k, v in rows.items()}
    RESULT["mb_per_avatar"] = got
    record("M01", "every mode was measured", all(v is not None for v in got.values()), per_avatar_mb=got)
    if not all(v is not None for v in got.values()):
        RESULT["status"] = "FAIL: a mode did not report"
        return

    hier = [got["hierarchical_first"], got["hierarchical_second"]]
    plain = [got["plain_first"], got["plain_second"]]
    drift = max(abs(hier[0] - hier[1]), abs(plain[0] - plain[1]))
    gap = round((sum(hier) / 2.0) - (sum(plain) / 2.0), 1)
    RESULT["hierarchical_minus_plain_mb"] = gap
    RESULT["repeat_disagreement_mb"] = round(drift, 1)

    record("M02", "the two passes of each mode agree well enough to compare the modes",
           drift <= abs(gap) or drift < 40.0, hierarchical=hier, plain=plain,
           disagreement_mb=RESULT["repeat_disagreement_mb"],
           note="the same setting measured early and late. If these disagree by more than the gap between "
                "SETTINGS, this measured the machine rather than the quadtree.")
    record("M03", "the quadtree is or is not most of an avatar's footprint",
           True, hierarchical_mb=hier, plain_mb=plain, hierarchical_minus_plain_mb=gap,
           note="reported either way. A large positive gap means a crowd gets dramatically cheaper for one "
                "console variable and P0 item 5 stops being art-bound; a small one means the footprint is "
                "the instances themselves and only the art can move it.")

    RESULT["status"] = "measured"
    yield 2.0
    les.editor_request_end_play()
    yield (lambda: ues.get_game_world() is None, 300)
