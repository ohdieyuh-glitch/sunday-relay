# Editor job: give the kit's architecture real collision geometry, reversibly.
#
# WHY (2026-09-22, found by the IC02 walk and then measured by collision_geometry.py). BR01 turned the `collides`
# flag on for 687 batches and the world became walkable -- but a flag only asks the mesh to be solid. It does not
# make it solid. The audit of the 252 meshes actually placed in this map:
#
#     134 meshes  CTF_USE_COMPLEX_AS_SIMPLE   -- collision is the render mesh, so arches have real holes
#     118 meshes  CTF_USE_DEFAULT + ZERO simple primitives -- NO collision geometry whatsoever
#
# The second group is almost entirely the imported WL_* kit: gatehouses, arches, colonnades, palace wings, houses,
# towers. Every one of them draws a building and blocks nothing. A player walks through the Icarus gatehouse, the
# great halls and the studio rows, and no screenshot would ever show it.
#
# THE FIX IS THE FLAG THE OTHER 134 ALREADY USE. Complex-as-simple makes collision the triangles that are already
# in memory: no new geometry, no extra asset, and -- the reason it matters here -- an arch keeps its hole, which a
# fitted box never would. A gatehouse with an 8 m passage is only a gatehouse if the passage is passable.
#
# TARGETED, NOT BLANKET (the founder's rule). Only meshes that are (a) currently drawn by a batch that is set to
# collide, (b) carry no simple primitive at all, and (c) are not foliage or small props a player should walk
# through. Everything changed is recorded with its prior flag, so REVERT puts it back exactly.
# Globals: RECORD, REVERT, SAVE, SKIP_WORDS, MAX_TRIS.
import json
import os

RECORD = globals().get("RECORD")
REVERT = globals().get("REVERT", False)
SAVE = globals().get("SAVE", True)
#: A player should walk through a flower bed, a hanging lantern and a banner; they are not architecture.
SKIP_WORDS = tuple(globals().get("SKIP_WORDS", (
    "flower", "bloom", "petal", "leaf", "grass", "tuft", "ivy", "vine", "rose", "lavender", "shrub", "topiary",
    "canopy", "mushroom", "banner", "lantern_hanging", "wall_lantern", "veg_anchor", "glass", "cloud", "sky",
    "finial", "urn", "teacup", "saucer", "clock", "key", "awning", "grate", "verge", "drain")))
#: A collision mesh is the render mesh here, so a very dense mesh is a bad trade for a thing you bump into.
MAX_TRIS = int(globals().get("MAX_TRIS", 12000))


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    while ues.get_game_world() is not None:
        yield 5.0
    world = ues.get_editor_world()
    eal = unreal.EditorAssetLibrary
    record = json.load(open(RECORD)) if (RECORD and os.path.exists(RECORD)) else {}

    if REVERT:
        back = 0
        for path, prior in record.items():
            mesh = eal.load_asset(path)
            if mesh is None:
                continue
            bs = mesh.get_editor_property("body_setup")
            if bs is None:
                continue
            bs.set_editor_property("collision_trace_flag",
                                   getattr(unreal.CollisionTraceFlag, prior["before"], unreal.CollisionTraceFlag.CTF_USE_DEFAULT))
            if SAVE:
                eal.save_asset(path, only_if_is_dirty=False)
            back += 1
            if back % 20 == 0:
                yield None
        RESULT["reverted"] = back
        RESULT["status"] = "done"
        return

    # which meshes are drawn by a batch that is meant to be solid?
    wanted = {}
    for b in unreal.GameplayStatics.get_all_actors_of_class(world, unreal.WonderlandInstancedBatch):
        mesh = b.get_editor_property("mesh")
        if mesh is None or not bool(b.get_editor_property("collides")):
            continue
        wanted.setdefault(mesh.get_path_name(), mesh)
        yield None

    changed, skipped = 0, {}
    for path, mesh in wanted.items():
        name = mesh.get_name().lower()
        if any(w in name for w in SKIP_WORDS):
            skipped["not architecture"] = skipped.get("not architecture", 0) + 1
            continue
        bs = mesh.get_editor_property("body_setup")
        if bs is None:
            skipped["no body setup"] = skipped.get("no body setup", 0) + 1
            continue
        flag = str(bs.get_editor_property("collision_trace_flag"))
        if "COMPLEX_AS_SIMPLE" in flag:
            skipped["already complex"] = skipped.get("already complex", 0) + 1
            continue
        agg = bs.get_editor_property("agg_geom")
        simple = 0
        for field in ("box_elems", "sphere_elems", "sphyl_elems", "convex_elems"):
            try:
                simple += len(agg.get_editor_property(field))
            except Exception:
                pass
        if simple > 0:
            skipped["has simple collision"] = skipped.get("has simple collision", 0) + 1
            continue
        try:
            tris = mesh.get_num_triangles(0)
        except Exception:
            tris = 0
        if tris > MAX_TRIS:
            skipped["over %d tris" % MAX_TRIS] = skipped.get("over %d tris" % MAX_TRIS, 0) + 1
            continue
        record.setdefault(path, {"name": mesh.get_name(), "before": flag.split(".")[-1].split(":")[0], "tris": tris})
        bs.set_editor_property("collision_trace_flag", unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)
        if SAVE:
            eal.save_asset(path, only_if_is_dirty=False)
        changed += 1
        if changed % 10 == 0:
            yield None

    if RECORD:
        os.makedirs(os.path.dirname(RECORD), exist_ok=True)
        with open(RECORD, "w", newline="\n") as f:
            json.dump(record, f, indent=1)
    RESULT["changed"] = changed
    RESULT["skipped"] = skipped
    RESULT["examples"] = [v["name"] for v in list(record.values())[:20]]
    RESULT["status"] = "done"
