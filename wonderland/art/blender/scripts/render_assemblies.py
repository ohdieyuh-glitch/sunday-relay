#!/usr/bin/env python3
"""Render the placement recipes, so a composition can be LOOKED at.

    python3 wonderland/art/blender/scripts/render_assemblies.py [--only NAME]

WHY THIS EXISTS. `make_recipes.py` checks that a recipe's arithmetic is sound
-- stacks agree on the ladder, butts touch, footprints do not clash -- and
arithmetic is not composition. A wall circuit can close perfectly and still
look like a fence; a skyline cluster can pass every check and read as a row of
one thing. The kit's own rule applies to assemblies as much as to modules: a
silhouette nobody looked at is a folder of plausible JSON.

So this builds every module a recipe names, places it exactly where the recipe
says, and renders the result. It never re-derives a position. If a picture is
wrong, the recipe is wrong, and that is the point of rendering it.

WHAT THE PICTURES ARE NOT. Blender and Cycles with the V2 palette on a
Principled BSDF -- no V2 material graph, no Lumen, no sky, no fog. They show
massing, spacing and silhouette, which is what a placement decision turns on.
"""

import argparse
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy                                          # noqa: E402

from forge import mesh as M                         # noqa: E402
from forge import preview as P                      # noqa: E402
from forge import units as U                        # noqa: E402
from forge.registry import builders as ALL_BUILDERS  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, ".."))
RECIPES = os.path.join(ROOT, "manifests", "wonderland-placement-recipes.json")
OUT = os.path.join(ROOT, "validation", "renders")

#: How each assembly is framed. A wall circuit wants height to read as a wall,
#: a skyline wants to be seen from near the ground, and a street wants to be
#: looked ALONG rather than at.
SHOTS = {
    "needle_skyline_cluster": dict(azimuth=68.0, elevation=4.0, res=(1700, 900)),
    "royal_threshold": dict(azimuth=182.0, elevation=6.0, res=(1700, 700)),
    "wall_circuit": dict(azimuth=52.0, elevation=13.0, res=(1700, 620)),
    # 262, not 118: the retaining runs batter on their -Y face, so the LOW
    # side is -Y and that is the side a retaining wall is a retaining wall
    # from. At 118 the upper court stood between the camera and the edge.
    "terrace_flight": dict(azimuth=262.0, elevation=11.0, res=(1700, 620)),
    # 20, not 176: at 176 the 90 m axis ran diagonally out of the frame. This
    # looks DOWN the basin from beyond its head, which is the view the module
    # was designed for -- the one where the reflection is doing the work.
    "water_garden": dict(azimuth=20.0, elevation=7.0, res=(1700, 620)),
    # 40, not 6: at 6 the street receded straight away from the camera and the
    # near house hid the four behind it. A street is looked ACROSS.
    "market_street": dict(azimuth=40.0, elevation=12.0, res=(1700, 640)),
}
DEFAULT_SHOT = dict(azimuth=70.0, elevation=10.0, res=(1700, 700))


def build_library(wanted):
    """Build each wanted module ONCE and keep its objects to duplicate from.

    A recipe places the same curtain run eleven times; building it eleven times
    would cost eleven times as long and produce eleven identical meshes for
    Cycles to carry. Linked duplicates share the mesh data.
    """
    lib = {}
    for group, builder in ALL_BUILDERS():
        if not wanted:
            break
        forge = M.Forge()
        spec = builder(forge)
        forge.parts = {}
        if spec.asset_id in wanted:
            for obj in spec.parts.values():
                obj.hide_render = True
                obj.hide_viewport = True
            lib[spec.asset_id] = list(spec.parts.values())
            wanted.discard(spec.asset_id)
        else:
            for obj in list(spec.parts.values()):
                bpy.data.objects.remove(obj, do_unlink=True)
    return lib


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="render one recipe by name")
    ap.add_argument("--samples", type=int, default=28)
    args = ap.parse_args(argv)

    with io.open(RECIPES, encoding="utf8") as fh:
        data = json.load(fh)
    os.makedirs(OUT, exist_ok=True)

    for recipe in data["recipes"]:
        if args.only and recipe["name"] != args.only:
            continue
        items = recipe.get("placements") or []
        if not items:
            print("  skip %s (nothing to place)" % recipe["name"])
            continue
        M.clear_scene()
        lib = build_library({it["module"] for it in items})
        placed = []
        for it in items:
            src = lib.get(it["module"])
            if not src:
                print("  MISSING %s -- not in the kit; the picture is short "
                      "one module and says so here" % it["module"])
                continue
            for obj in src:
                dup = obj.copy()                 # linked: shares the mesh data
                dup.hide_render = False
                dup.hide_viewport = False
                bpy.context.scene.collection.objects.link(dup)
                dup.location = (U.uu_to_m(it["at_uu"][0]),
                                U.uu_to_m(it["at_uu"][1]),
                                U.uu_to_m(it["at_uu"][2]))
                dup.rotation_euler = (0.0, 0.0, math.radians(it["yaw_deg"]))
                placed.append(dup)
        bpy.context.view_layer.update()
        shot = SHOTS.get(recipe["name"], DEFAULT_SHOT)
        # THE GROUND PLANE HIDES AN EXCAVATION, here as in the family sheets:
        # the sunken pool came back as a black ellipse on an unbroken floor.
        digs = any((o.matrix_world @ v.co).z < -0.05
                   for o in placed for v in o.data.vertices)
        P.rig(ground=not digs)
        P.frame_camera(placed, shot["res"], azimuth=shot["azimuth"],
                       elevation=shot["elevation"], margin=1.06, lens=60.0,
                       target_bias=0.42)
        path = os.path.join(OUT, "ASSEMBLY_%s.png" % recipe["name"])
        P.render(path, res=shot["res"], samples=args.samples)
        print("  render -> ASSEMBLY_%s.png  %d placement(s), %d object(s)"
              % (recipe["name"], len(items), len(placed)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
