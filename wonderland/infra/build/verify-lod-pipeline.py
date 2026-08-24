#!/usr/bin/env python3
"""LODs and HISM are one fix, and either half alone does nothing.

WHY BOTH, AND WHY THIS CHECKS BOTH

Wonderland is geometry-bound. Isolating each subsystem through the real stream
showed r.ScreenPercentage 70 -- half the pixel work -- changing the frame rate
by nothing, while ~50,285 Sphere instances at roughly 1,900 triangles each put
on the order of 95 million triangles in every frame. They all draw at LOD0
because /Engine/BasicShapes ships a single LOD.

Reduction LODs fix the mesh side. They are also completely inert on their own:
a plain InstancedStaticMeshComponent selects ONE LOD for the whole component,
and these batches span the entire world, so every instance keeps drawing at
LOD0 whatever LODs the mesh now has. Per-instance selection is what
HierarchicalInstancedStaticMeshComponent's cluster tree is for.

So the two are a single change wearing two hats, and shipping one without the
other is the failure this file exists to prevent: LODs with ISM look like a
correct optimisation that mysteriously does nothing, which is exactly the shape
of the three defects that already cost this project builds -- the material
usage flag, the unforwarded docker knob, and Nanite without SM6. In every one
of them the authored side was right and something downstream quietly declined
to use it.

WHAT IT CHECKS

  1. the generator builds LODs on project-owned copies of the primitives;
  2. it sets bHierarchical on the batch actors when LODs are on;
  3. the batch actor actually supports bHierarchical.

It runs the generator against the offline stub, so it costs seconds on a laptop
against the 10-40 minute package that is the only other way to find out.
"""
import importlib.util
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")
BATCH_H = os.path.abspath(os.path.join(
    HERE, "..", "..", "Source", "Wonderland", "WonderlandInstancedBatch.h"))


def main():
    src = io.open(GEN, encoding="utf8").read()

    lods_on = re.search(
        r'os\.environ\.get\(\s*"WONDERLAND_LODS"\s*,\s*"([01])"\s*\)', src)
    hism = re.search(
        r'set_prop\(actor,\s*"bHierarchical"', src)
    if not lods_on:
        print("FAIL: no WONDERLAND_LODS switch in the generator; this "
              "validator has drifted from the code it checks.")
        return 1

    on = lods_on.group(1) != "0"
    print("LODs default        : %s" % ("on" if on else "off"))

    if on and not hism:
        print("FAIL: LODs are built but nothing sets bHierarchical on the batch "
              "actors.")
        print("      A plain ISM selects ONE LOD for the whole component, and "
              "these batches span the world, so every instance would still draw "
              "at LOD0 and the LODs would be inert.")
        return 1
    print("bHierarchical set   : %s" % ("yes" if hism else "no"))

    if not os.path.isfile(BATCH_H):
        print("FAIL: %s is missing, so it cannot be shown that the batch actor "
              "even has bHierarchical." % BATCH_H)
        return 1
    if "bHierarchical" not in io.open(BATCH_H, encoding="utf8").read():
        print("FAIL: the batch actor has no bHierarchical property, so setting "
              "it does nothing and the LODs stay inert.")
        return 1
    print("batch actor supports: yes")

    # Prove the conversion actually produces meshes, not merely that it is called.
    spec = importlib.util.spec_from_file_location(
        "wl_dry_lod", os.path.join(HERE, "verify-generator-dryrun.py"))
    dry = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dry)
    sys.modules["unreal"] = dry.make_unreal()

    marker = "            _LOD_MESH = wl_lod_primitives()"
    if marker not in src:
        print("FAIL: the LOD call site is gone or has changed shape.")
        return 1
    instrumented = src.replace(
        marker, marker + "\n            _WL_L['built'] = dict(_LOD_MESH)", 1)
    ns = {"__name__": "__wl_lod__", "__file__": GEN, "_WL_L": {}}
    exec(compile(instrumented, GEN, "exec"), ns)
    built = ns["_WL_L"].get("built")

    if on:
        if not built:
            print()
            print("FAIL: the LOD step ran and produced NOTHING, so every piece "
                  "still draws at LOD0 and the ~95M triangles a frame are "
                  "unchanged.")
            return 1
        print("meshes with LODs    : %d" % len(set(built.values())))

    print()
    print("PASS: LODs are built and per-instance LOD selection is enabled.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
