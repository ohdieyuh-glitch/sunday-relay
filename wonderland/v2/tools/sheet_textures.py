#!/usr/bin/env python3
"""DIAGNOSTIC: tile the V2 albedo + normal maps into one PNG to eyeball the
set (structure and neutrality), stdlib only. Never evidence of the render.

    python3 wonderland/v2/tools/sheet_textures.py <texture_dir> <out.png>
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from verify_v2_textures import read_png  # noqa: E402
_spec = importlib.util.spec_from_file_location("wl_texkernel", os.path.join(HERE, "..", "..", "infra", "build", "gen-textures.py"))
K = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(K)


def main(d, out, tile=128):
    meta = json.load(open(os.path.join(d, "textures_v2.json")))
    fams = sorted(meta["families"])
    cols = len(fams)
    W, H = cols * tile, 2 * tile
    buf = bytearray(W * H * 3)
    for ci, fam in enumerate(fams):
        for row, suf in enumerate(("_a", "_n")):
            p = os.path.join(d, meta["prefix"] + fam + suf + ".png")
            if not os.path.exists(p):
                continue
            w, h, ch, px = read_png(p)
            for y in range(tile):
                sy = int(y * h / tile)
                for x in range(tile):
                    sx = int(x * w / tile)
                    i = (sy * w + sx) * ch
                    o = ((row * tile + y) * W + ci * tile + x) * 3
                    if ch == 3:
                        buf[o:o + 3] = px[i:i + 3]
                    else:
                        buf[o] = buf[o + 1] = buf[o + 2] = px[i]
    K.write_png(out, W, H, buf)
    print("DIAG texture sheet %s %dx%d: %s" % (out, W, H, " ".join(fams)))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
