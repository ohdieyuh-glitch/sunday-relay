#!/usr/bin/env python3
"""A before / after / reference sheet from PNGs, stdlib only (no PIL on the
laptop or the Studio). Panels are resampled to one width, labelled, and laid
side by side. DIAGNOSTIC: it composes frames, it does not judge them.

  python3 wonderland/v2/tools/sheet_compare.py OUT.png "A label" a.png "B label" b.png ["C label" c.png ...] [--width 640]
"""
import os
import sys
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
V2 = os.path.join(HERE, "..")
LIGHTNING = os.path.join(V2, "..", "infra", "lightning")
HD = os.path.join(V2, "..", "infra", "build", "hd")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


FC = _load("frame_check", os.path.join(LIGHTNING, "frame-check.py"))
RS = _load("render_sheet", os.path.join(HD, "render_sheet.py"))


def panel(path, width):
    w, h, ch, rows = FC.read_png(path)
    height = max(1, int(h * width / w))
    px = bytearray(width * height * 3)
    for y in range(height):
        sy = min(h - 1, int(y * h / height))
        row = rows[sy]
        for x in range(width):
            sx = min(w - 1, int(x * w / width))
            o = (y * width + x) * 3
            if ch >= 3:
                px[o] = row[sx * ch]; px[o + 1] = row[sx * ch + 1]; px[o + 2] = row[sx * ch + 2]
            else:
                v = row[sx * ch]; px[o] = v; px[o + 1] = v; px[o + 2] = v
    return width, height, px


def main(argv):
    if len(argv) < 5 or (len(argv) - 1) % 2 == 0 and "--width" not in argv:
        print(__doc__); return 2
    width = 640
    if "--width" in argv:
        i = argv.index("--width"); width = int(argv[i + 1]); argv = argv[:i] + argv[i + 2:]
    out = argv[0]
    pairs = list(zip(argv[1::2], argv[2::2]))
    panels = [(label, panel(path, width)) for label, path in pairs]
    gap, bar = 6, 22
    H = max(h for _, (_, h, _) in panels) + bar
    W = width * len(panels) + gap * (len(panels) - 1)
    px = bytearray(W * H * 3)
    for i in range(0, len(px), 3):
        px[i], px[i + 1], px[i + 2] = 18, 18, 22
    x0 = 0
    for label, (w, h, ppx) in panels:
        for y in range(h):
            src = ppx[y * w * 3:(y + 1) * w * 3]
            dst = ((y + bar) * W + x0) * 3
            px[dst:dst + w * 3] = src
        RS._text(px, W, H, x0 + 6, 4, label.upper()[:48], (240, 232, 214), 2)
        x0 += w + gap
    RS.write_png(out, W, H, px)
    print("sheet %s %dx%d panels=%d" % (out, W, H, len(panels)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
