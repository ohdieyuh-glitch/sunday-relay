# LOOK AT A SKIN WITHOUT THE EDITOR.
#
# THE PROBLEM THIS SOLVES. The Unreal editor is a shared resource -- the world lane holds it for hours at a
# time -- and until it is free a skin change can be measured but not SEEN. That is the worst possible state to
# hand a founder who has rejected skins twice for how they look: numbers went up, trust me. The .wlvox files
# are just coloured boxes, so nothing about drawing them actually needs a game engine.
#
# WHAT IT IS AND IS NOT. An orthographic painter's-algorithm rasteriser: boxes sorted back to front and filled
# as flat rectangles with their own material colour. Along an axis-aligned view an axis-aligned box projects to
# a rectangle and the depth order is exact, so this is a faithful picture of the geometry -- not a guess at one.
#
# It is NOT the engine. There is no perspective, no real lighting, no emissive bloom, no post. A glow material
# is drawn bright rather than made to glow. So this answers "is the shape and the colour scheme right", and the
# in-engine turnaround (Tools/editor_jobs/zc_skin_turnaround.py) still answers "does it look good".
#
#   python wonderland/Tools/wlvox_render.py [--skins RelaySkins] [--out captures/skin_renders] [--size 420]
import argparse
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ORDER = ["RelayOg", "ArdenInfernal", "Apollo", "SkeletonFlame", "Hagoromo", "CelestialLight", "Bee"]
# name -> (kind, r, g, b). Kind decides how bright it is drawn: a glow reads as light, a lit surface as matter.
GLOWY = {"glow", "add"}


def read_figure(path):
    materials, boxes = {}, []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            bits = line.split()
            if not bits:
                continue
            if bits[0] == "material" and len(bits) >= 7:
                materials[bits[1]] = (bits[2], float(bits[3]), float(bits[4]), float(bits[5]))
            elif bits[0] == "box" and len(bits) >= 9:
                try:
                    boxes.append((bits[2], tuple(float(v) for v in bits[3:9])))
                except ValueError:
                    pass
    return materials, boxes


def shade(rgb, kind, depth01, top01):
    """Flat faces need SOME cue or the figure reads as a silhouette again. Depth and height, gently."""
    r, g, b = rgb
    if kind in GLOWY:
        # light does not take shading; it only gets brighter toward the viewer
        k = 0.82 + 0.18 * depth01
        r, g, b = min(1.0, r * k + 0.10), min(1.0, g * k + 0.10), min(1.0, b * k + 0.10)
    else:
        k = 0.55 + 0.30 * depth01 + 0.15 * top01
        r, g, b = r * k, g * k, b * k
    return (int(max(0.0, min(1.0, r)) ** (1 / 2.2) * 255),
            int(max(0.0, min(1.0, g)) ** (1 / 2.2) * 255),
            int(max(0.0, min(1.0, b)) ** (1 / 2.2) * 255))


def render(materials, boxes, axes, depth_axis, depth_sign, width, height, bounds, bg=(16, 17, 22)):
    across, up = axes
    lo, hi = bounds
    span_a = max(hi[across] - lo[across], 1e-6)
    span_u = max(hi[up] - lo[up], 1e-6)
    scale = min((width - 8) / span_a, (height - 8) / span_u)
    off_a = (width - span_a * scale) * 0.5
    off_u = (height - span_u * scale) * 0.5
    dlo, dhi = lo[depth_axis], hi[depth_axis]
    dspan = max(dhi - dlo, 1e-6)
    zlo, zhi = lo[2], hi[2]
    zspan = max(zhi - zlo, 1e-6)

    px = bytearray()
    for _ in range(width * height):
        px.extend(bg)

    # BACK TO FRONT. Along an axis-aligned view this ordering is exact for axis-aligned boxes.
    ordered = sorted(boxes, key=lambda b: depth_sign * b[1][depth_axis])
    for mat, box in ordered:
        centre, size = box[0:3], box[3:6]
        spec = materials.get(mat)
        if spec is None:
            continue
        kind, r, g, b = spec
        depth01 = (centre[depth_axis] - dlo) / dspan
        if depth_sign < 0:
            depth01 = 1.0 - depth01
        top01 = (centre[2] - zlo) / zspan
        colour = shade((r, g, b), kind, depth01, top01)

        a0 = (centre[across] - size[across] * 0.5 - lo[across]) * scale + off_a
        a1 = (centre[across] + size[across] * 0.5 - lo[across]) * scale + off_a
        u0 = (centre[up] - size[up] * 0.5 - lo[up]) * scale + off_u
        u1 = (centre[up] + size[up] * 0.5 - lo[up]) * scale + off_u
        x0, x1 = int(max(0, min(a0, a1))), int(min(width - 1, max(a0, a1)))
        y0, y1 = int(max(0, min(u0, u1))), int(min(height - 1, max(u0, u1)))
        # at least one pixel: a sub-pixel box is still a box that is there
        if x1 < x0:
            x1 = x0
        if y1 < y0:
            y1 = y0
        for y in range(y0, y1 + 1):
            row = (height - 1 - y) * width
            base = (row + x0) * 3
            for _ in range(x1 - x0 + 1):
                px[base] = colour[0]
                px[base + 1] = colour[1]
                px[base + 2] = colour[2]
                base += 3
    return px


def write_png(path, width, height, rgb):
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)
        raw.extend(rgb[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
           + chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(png)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skins", default=os.path.join(HERE, "..", "RelaySkins"))
    ap.add_argument("--out", default=os.path.join(HERE, "..", "..", "captures", "skin_renders"))
    ap.add_argument("--size", type=int, default=420)
    args = ap.parse_args()
    skins_dir, out = os.path.normpath(args.skins), os.path.normpath(args.out)
    os.makedirs(out, exist_ok=True)

    figures = {}
    for name in ORDER:
        path = os.path.join(skins_dir, name + ".wlvox")
        if os.path.isfile(path):
            figures[name] = read_figure(path)
    if not figures:
        raise SystemExit("no .wlvox found in %s" % skins_dir)

    lo, hi = [1e9] * 3, [-1e9] * 3
    for _, boxes in figures.values():
        for _, box in boxes:
            for i in range(3):
                lo[i] = min(lo[i], box[i] - box[3 + i] * 0.5)
                hi[i] = max(hi[i], box[i] + box[3 + i] * 0.5)

    w = args.size
    h = int(args.size * 1.25)
    names = [n for n in figures]
    # front: look along -X, so across=Y and up=Z, nearest box has the LARGEST x
    # side:  look along -Y, so across=X and up=Z, nearest box has the LARGEST y
    views = (("front", (1, 2), 0, +1), ("side", (0, 2), 1, +1))
    sheet_w = w * len(names)
    sheet_h = h * len(views)
    sheet = bytearray()
    for _ in range(sheet_w * sheet_h):
        sheet.extend((16, 17, 22))

    for row, (vname, axes, daxis, dsign) in enumerate(views):
        for col, name in enumerate(names):
            materials, boxes = figures[name]
            tile = render(materials, boxes, axes, daxis, dsign, w, h, (lo, hi))
            single = os.path.join(out, "%s_%s.png" % (name, vname))
            write_png(single, w, h, tile)
            for y in range(h):
                src = y * w * 3
                dst = ((row * h + y) * sheet_w + col * w) * 3
                sheet[dst:dst + w * 3] = tile[src:src + w * 3]
            print("  %-16s %-6s -> %s" % (name, vname, single))

    sheet_path = os.path.join(out, "skin_sheet.png")
    write_png(sheet_path, sheet_w, sheet_h, sheet)
    print("\ncontact sheet: %s" % sheet_path)
    print("order: %s" % ", ".join(names))
    print("top row FRONT, bottom row SIDE, one shared scale.")
    print("NOT the engine: no perspective, no real lighting, no bloom. Shape and palette only.")


if __name__ == "__main__":
    main()
