#!/usr/bin/env python3
"""What the world costs to DRAW, measured from the generator, with no GPU.

    python3 wonderland/rendering/audit-draw-cost.py

WHY THIS COMES BEFORE ANY NANITE DECISION

Wonderland is not a normal open world. It is roughly 33,000 individually
spawned StaticMeshActors, and nearly every one of them is an ENGINE PRIMITIVE —
a cube, a cylinder, a sphere — wearing one of about sixty material instances.
That shape has a specific bottleneck and it is not triangles. A cube is twelve
triangles; thirty-three thousand cubes is under half a million, which an L4
draws without noticing. What it is, is thirty-three thousand draw calls.

That also inverts the usual Nanite advice. Nanite pays for itself on dense
meshes by replacing per-triangle work with cluster work; it carries a fixed
per-mesh cost that a twelve-triangle cube can never earn back. Enabling Nanite
across this world would be the wrong lever applied confidently.

The right lever is INSTANCING, and this measures exactly how much of it is
available: how many (mesh, material) pairs the world actually uses, and how
many actors collapse into each. That number is the draw-call reduction, and it
is knowable on a laptop.

Nothing here is a recommendation to act blindly — it is the arithmetic that
says which experiment is worth GPU time. Cross-check against a real
`stat rhi` / `stat scenerendering` on the box before believing any of it.
"""
import collections
import importlib.util
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.normpath(os.path.join(HERE, "..", "infra", "build"))
GEN = os.path.join(BUILD, "generate-hub-level.py")
PREVIEW = os.path.join(BUILD, "verify-hero-composition.py")

# Engine primitives, and roughly what each costs. These are the shipped
# BasicShapes; the counts are the well-known low-poly figures for them and are
# used ONLY to make the point that triangles are not the problem here.
PRIMITIVE_TRIS = {
    "cube": 12, "plane": 2, "cylinder": 190, "sphere": 760, "cone": 190,
}


def load_preview():
    spec = importlib.util.spec_from_file_location("wl_preview", PREVIEW)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def collect():
    """Run the generator against the stub engine and return every placed mesh."""
    preview = load_preview()
    sys.modules["unreal"] = preview.make_unreal()
    src = io.open(GEN, encoding="utf8").read()
    anchor = ("        actor = spawn(unreal.StaticMeshActor, location, "
              "rotation=rotation, scale=scale, label=label)")
    if anchor not in src:
        raise SystemExit(
            "static_mesh's signature changed — this audit's injection anchor "
            "needs updating. Refusing to report numbers from a partial capture.")
    src = src.replace(
        anchor, anchor + "\n        __wl_record__(mesh_key, location, scale, label, rotation, mat)", 1)
    namespace = {"__name__": "__wl_preview__", "__file__": GEN,
                 "__wl_record__": preview.record}
    exec(compile(src, GEN, "exec"), namespace)
    if hasattr(preview, "_wl_leaf_apply"):
        try:
            preview._wl_leaf_apply(namespace)
        except Exception:
            pass
    # DROP THE MODULE-LEVEL BUILD FIRST. generate-hub-level.py builds at import
    # time when `unreal` is not None, and the stub makes it not None — so
    # exec'ing the module already placed a whole world before build() is called
    # with the real layout. Without this line every number below is exactly
    # doubled, which is the most convincing kind of wrong: internally
    # consistent, plausible, and 2x. verify-hero-composition.py drops it too.
    preview.records[:] = []

    # build() takes the layout, exactly as the preview calls it. Reading the
    # same hub-layout.json means this audit measures the world the generator
    # would actually produce, not a default one.
    import json
    layout_path = os.path.normpath(os.path.join(HERE, "..", "WorldDesign", "hub-layout.json"))
    with io.open(layout_path, encoding="utf8") as handle:
        namespace["build"](json.load(handle))
    return preview.records


def main():
    records = collect()
    if not records:
        print("FAIL the generator placed nothing — this audit measured a "
              "failed run, not an empty world.")
        return 1

    by_mesh = collections.Counter()
    by_material = collections.Counter()
    combos = collections.Counter()
    for mesh, _loc, _scale, mat, _label, _rot in records:
        key = str(mesh).lower().split(".")[-1].split("/")[-1]
        by_mesh[key] += 1
        by_material[str(mat)] += 1
        combos[(key, str(mat))] += 1

    total = len(records)
    unique = len(combos)
    print("WONDERLAND DRAW COST  (generator capture, no engine)\n")
    print("  static mesh components placed : %6d" % total)
    print("  distinct meshes               : %6d" % len(by_mesh))
    print("  distinct materials            : %6d" % len(by_material))
    print("  distinct (mesh, material)     : %6d   <- the instancing floor" % unique)
    print()

    tris = 0
    unknown = 0
    for mesh, count in by_mesh.items():
        per = PRIMITIVE_TRIS.get(mesh)
        if per is None:
            unknown += count
        else:
            tris += per * count
    print("  MESH MIX")
    for mesh, count in by_mesh.most_common(12):
        per = PRIMITIVE_TRIS.get(mesh)
        print("    %-16s %6d  %5.1f%%  %s" % (
            mesh, count, 100.0 * count / total,
            ("~%d tris each" % per) if per else "not a known engine primitive"))
    print("\n  approximate triangles from known primitives: %s" % f"{tris:,}")
    if unknown:
        print("  %d components use a mesh with no known triangle count — the "
              "figure above is a FLOOR, not a total." % unknown)

    print("\n  THE ARITHMETIC")
    print("    one draw call per component      : %s draw calls" % f"{total:,}")
    print("    one per (mesh, material) batch   : %s draw calls" % f"{unique:,}")
    if unique:
        print("    reduction available from instancing: %.0fx (%.1f%% fewer)"
              % (total / float(unique), 100.0 * (1 - unique / float(total))))
    print("    triangles are ~%s." % f"{tris:,}")
    # Say WHERE the triangles are, not just how many. The mesh mix above reads
    # as "mostly cubes", and the triangle budget is the opposite of that.
    heaviest = sorted(((PRIMITIVE_TRIS.get(m, 0) * c, m, c) for m, c in by_mesh.items()),
                      reverse=True)
    if tris and heaviest and heaviest[0][0]:
        share, mesh, count = heaviest[0]
        print("    %.0f%% of them come from %s alone (%d components at ~%d tris)."
              % (100.0 * share / tris, mesh, count, PRIMITIVE_TRIS.get(mesh, 0)))
        print("    So the two levers are different things: INSTANCING attacks the")
        print("    draw calls, and a cheaper %s attacks the triangles. Neither is" % mesh)
        print("    a reason to remove objects from the world.")

    print("\n  LARGEST BATCHES  (each row is ONE draw call if instanced)")
    for (mesh, mat), count in combos.most_common(15):
        print("    %-10s %-18s %6d" % (mesh, mat[:18], count))

    singles = sum(1 for _k, v in combos.items() if v == 1)
    print("\n    %d of %d combinations appear exactly once — instancing cannot "
          "help those, and they stay individual draws." % (singles, unique))

    print("\n  NANITE VERDICT FOR THIS WORLD")
    print("    Against: nearly everything here is an engine primitive of 12 to")
    print("    760 triangles. Nanite's per-mesh overhead is not recoverable on")
    print("    geometry that small, and it is not a draw-call batcher — that is")
    print("    what instancing is for. Enabling it world-wide is the wrong lever.")
    print("    For:     the Marble visual layer, which is dense, static, opaque")
    print("    and free of world-position offset. import-marble-world.py already")
    print("    requests Nanite for that mesh and NOT for the collider.")
    print("    Unresolved: whether this engine build has r.Nanite at all, and")
    print("    what the real draw-call count is. probe-cvars.sh answers the")
    print("    first; `stat scenerendering` on the box answers the second.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
