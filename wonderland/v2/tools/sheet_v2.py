#!/usr/bin/env python3
"""DIAGNOSTIC contact sheet of every V2 recipe, built on the meshkit backend.

    python3 sheet_v2.py OUT.png [recipe ...]

Reuses the shared software rasteriser (infra/build/hd/render_sheet.py:
engineering, migrated). It shows the FORM each recipe authors -- proportions,
gaps, a limb that points the wrong way -- before Studio time is spent. It is
not the Geometry Script result (no subdivision smoothness, no engine
materials) and it is never evidence of visual quality.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
V2 = os.path.join(HERE, "..")
HD = os.path.join(V2, "..", "infra", "build", "hd")
sys.path.insert(0, V2)
sys.path.insert(0, HD)
import gs                    # noqa: E402
import assets_v2 as A        # noqa: E402
import materials_v2 as M     # noqa: E402

spec = importlib.util.spec_from_file_location("hd_sheet", os.path.join(HD, "render_sheet.py"))
hd_sheet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hd_sheet)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/V2_DIAG_recipes.png"
    names = [a for a in sys.argv[2:] if not a.startswith("--")] or sorted(A.RECIPES)
    cols = 9 if len(names) > 12 else max(1, min(4, len(names)))
    size = 150 if len(names) > 12 else 300
    rows = (len(names) + cols - 1) // cols
    W, H = cols * size, rows * (size + 14)
    px = bytearray(W * H * 3)
    for i in range(0, len(px), 3):
        px[i], px[i + 1], px[i + 2] = 28, 26, 34
    class U: pass
    ctx = gs.Context(U(), lambda m: None, force_fallback=True)
    for k, name in enumerate(names):
        fn, folder, nan, col = A.RECIPES[name]
        try:
            mb = fn(ctx)
            mesh = mb.mesh
        except Exception as exc:
            sys.stderr.write("\n%s FAILED: %s\n" % (name, exc))
            continue
        # default material colour: the first instance whose family fits the folder, else grey
        colour = {"castle": (0.74, 0.70, 0.62), "gates": (0.92, 0.70, 0.36), "stairs": (0.70, 0.66, 0.57),
                  "trees": (0.14, 0.26, 0.10), "shrubs": (0.14, 0.26, 0.10), "flowers": (0.90, 0.52, 0.68),
                  "roses": (0.88, 0.40, 0.56), "vines": (0.14, 0.26, 0.10), "ivy": (0.14, 0.26, 0.10),
                  "topiary": (0.14, 0.26, 0.10), "mush_small": (0.58, 0.24, 0.20), "mush_medium": (0.58, 0.24, 0.20),
                  "mush_landmark": (0.60, 0.30, 0.24), "tea": (0.90, 0.87, 0.82), "clocks": (0.92, 0.70, 0.36),
                  "keys": (0.92, 0.70, 0.36), "garden_props": (0.90, 0.87, 0.82), "cobble": (0.70, 0.66, 0.57),
                  "garden_arch": (0.14, 0.26, 0.10), "bridges": (0.74, 0.70, 0.62), "vfx_portal": (0.62, 0.40, 0.92),
                  "sky": (0.6, 0.7, 0.9)}.get(folder, (0.6, 0.6, 0.6))
        tile, cov = hd_sheet.render_tile(mesh, colour, size)
        ox, oy = (k % cols) * size, (k // cols) * (size + 14)
        for yy in range(size):
            for xx in range(size):
                idx = yy * size + xx
                if cov[idx]:
                    o = ((oy + yy) * W + ox + xx) * 3
                    px[o] = hd_sheet._srgb(tile[idx * 3])
                    px[o + 1] = hd_sheet._srgb(tile[idx * 3 + 1])
                    px[o + 2] = hd_sheet._srgb(tile[idx * 3 + 2])
        ex = mesh.extents()
        hd_sheet._text(px, W, H, ox + 2, oy + size + 2, ("%s %d %dx%dx%d" % (name, mesh.tri_count(), ex[0], ex[1], ex[2]))[:36], (235, 225, 210), 1)
        sys.stderr.write("\r  %d/%d %s      " % (k + 1, len(names), name))
    sys.stderr.write("\n")
    hd_sheet.write_png(out, W, H, px)
    print("DIAG sheet %s  %dx%d  %d recipes (meshkit backend, not Geometry Script)" % (out, W, H, len(names)))


if __name__ == "__main__":
    main()
