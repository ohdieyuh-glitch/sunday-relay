# THE FOUNDER'S SILHOUETTE TEST, MADE MEASURABLE.
#
# FOUNDER (2026-09-23), on the mascot skins: "if removing the colour would make two skins look nearly identical,
# the silhouette design is not strong enough." And: judge them at MEDIUM DISTANCE, not nose to nose.
#
# That is a rule about shape, and shape is in the .wlvox files already -- so it can be checked without opening
# the editor and without another round of photographs. This reads every skin, throws the colour away, rasterises
# what is left from the front and the side, and reports how much of each pair overlaps.
#
# WHY IOU AND NOT A BOX COUNT. A skin can be thousands of boxes denser than another and still cut the same hole
# in the sky; density is what the founder already rejected as an answer ("don't solve detail with more cubes").
# Intersection-over-union of the silhouettes is exactly the question asked: with the colour gone, how much of
# these two are the same shape.
#
# AND AT TWO DISTANCES. Full resolution is the nose-to-nose read. The coarse pass downsamples to roughly what a
# figure occupies across a room, which is where the founder said the test actually lives: fine trim disappears
# and only the profile survives.
#
#   python wonderland/Tools/silhouette_check.py [--out <dir>]
#
# Writes a PNG contact sheet of the silhouettes, in black, in the order it prints.
import argparse
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SKINS = os.path.normpath(os.path.join(HERE, "..", "RelaySkins"))
# The pair the founder named as the quality bar is Celestial Light; it stays in the comparison as the reference.
ORDER = ["RelayOg", "ArdenInfernal", "Apollo", "SkeletonFlame", "Hagoromo", "CelestialLight", "Bee"]


def read_boxes(path):
    """Every box as (x, y, z, sx, sy, sz). Colour and material are deliberately discarded."""
    boxes = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            if not line.startswith("box "):
                continue
            bits = line.split()
            # box <part> <material> x y z sx sy sz
            if len(bits) < 9:
                continue
            try:
                boxes.append(tuple(float(v) for v in bits[3:9]))
            except ValueError:
                continue
    return boxes


def bounds(all_boxes):
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    for boxes in all_boxes.values():
        for (x, y, z, sx, sy, sz) in boxes:
            for i, (c, s) in enumerate(((x, sx), (y, sy), (z, sz))):
                lo[i] = min(lo[i], c - s * 0.5)
                hi[i] = max(hi[i], c + s * 0.5)
    return lo, hi


def rasterise(boxes, lo, hi, axes, width, height):
    """
    A binary silhouette. axes picks which two world axes become (across, up).

    ONE SCALE FOR BOTH AXES, and the same one for every skin. Stretching each axis to fill the frame would make a
    tall narrow figure and a short wide one draw the same rectangle, which is the exact comparison this is meant
    to make honestly -- and it would distort the contact sheet the judgement is then made from.
    """
    across, up = axes
    span_a = max(hi[across] - lo[across], 1e-6)
    span_u = max(hi[up] - lo[up], 1e-6)
    scale = min((width - 1) / span_a, (height - 1) / span_u)
    # Centred, so a narrow skin sits in the middle of the frame rather than hard against its left edge.
    off_a = (width - 1 - span_a * scale) * 0.5
    off_u = (height - 1 - span_u * scale) * 0.5
    grid = bytearray(width * height)
    for box in boxes:
        centre = box[0:3]
        size = box[3:6]
        a0 = (centre[across] - size[across] * 0.5 - lo[across]) * scale + off_a
        a1 = (centre[across] + size[across] * 0.5 - lo[across]) * scale + off_a
        u0 = (centre[up] - size[up] * 0.5 - lo[up]) * scale + off_u
        u1 = (centre[up] + size[up] * 0.5 - lo[up]) * scale + off_u
        for px in range(max(0, int(a0)), min(width - 1, int(a1) + 1) + 1):
            if px >= width:
                break
            for py in range(max(0, int(u0)), min(height - 1, int(u1) + 1) + 1):
                if py >= height:
                    break
                # y is flipped so up is up in the image
                grid[(height - 1 - py) * width + px] = 1
    return grid


def coarsen(grid, width, height, factor):
    """Medium distance: shrink, and keep a cell only if a real part of it was filled."""
    w2, h2 = max(1, width // factor), max(1, height // factor)
    out = bytearray(w2 * h2)
    for y in range(h2):
        for x in range(w2):
            hit = 0
            total = 0
            for dy in range(factor):
                sy = y * factor + dy
                if sy >= height:
                    continue
                for dx in range(factor):
                    sx = x * factor + dx
                    if sx >= width:
                        continue
                    total += 1
                    hit += grid[sy * width + sx]
            if total and hit * 3 >= total:  # a third covered reads as solid at distance
                out[y * w2 + x] = 1
    return out, w2, h2


def iou(a, b):
    inter = 0
    union = 0
    for i in range(len(a)):
        if a[i] or b[i]:
            union += 1
            if a[i] and b[i]:
                inter += 1
    return (inter / union) if union else 1.0


def write_png(path, width, height, pixels):
    """8-bit greyscale PNG, no dependencies."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * width:(y + 1) * width])
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(png)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "..", "..", "captures", "silhouettes"))
    ap.add_argument("--width", type=int, default=150)
    ap.add_argument("--height", type=int, default=260)
    args = ap.parse_args()
    out = os.path.normpath(args.out)
    os.makedirs(out, exist_ok=True)

    skins = {}
    for name in ORDER:
        path = os.path.join(SKINS, name + ".wlvox")
        if os.path.isfile(path):
            skins[name] = read_boxes(path)
    if not skins:
        raise SystemExit("no .wlvox skins found in %s" % SKINS)
    lo, hi = bounds(skins)
    print("shared bounds  x %.1f..%.1f   y %.1f..%.1f   z %.1f..%.1f"
          % (lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]))
    print("boxes:", ", ".join("%s=%d" % (n, len(b)) for n, b in skins.items()))

    views = {"front": (1, 2), "side": (0, 2)}
    grids = {}
    for view, axes in views.items():
        for name, boxes in skins.items():
            grids[(view, name)] = rasterise(boxes, lo, hi, axes, args.width, args.height)

    names = [n for n in ORDER if n in skins]
    for view in views:
        print("\n=== %s silhouette overlap (IoU); 1.00 means the same shape ===" % view.upper())
        header = "                " + "".join("%14s" % n[:13] for n in names)
        print(header)
        for a in names:
            row = "%-16s" % a[:15]
            for b in names:
                if a == b:
                    row += "%14s" % "-"
                else:
                    row += "%14.3f" % iou(grids[(view, a)], grids[(view, b)])
            print(row)

        print("-- at MEDIUM DISTANCE (coarse) --")
        coarse = {}
        for n in names:
            coarse[n], cw, ch = coarsen(grids[(view, n)], args.width, args.height, 4)
        worst = []
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                worst.append((iou(coarse[a], coarse[b]), a, b))
        worst.sort(reverse=True)
        for score, a, b in worst[:6]:
            flag = "  <-- TOO ALIKE" if score >= 0.75 else ""
            print("   %-16s vs %-16s  %.3f%s" % (a, b, score, flag))

    # ---- the contact sheet: every silhouette, black on white, in ORDER
    pad = 6
    sheet_w = (args.width + pad) * len(names) + pad
    sheet_h = (args.height + pad) * 2 + pad
    sheet = bytearray([255] * (sheet_w * sheet_h))
    for row, view in enumerate(("front", "side")):
        for col, name in enumerate(names):
            g = grids[(view, name)]
            ox = pad + col * (args.width + pad)
            oy = pad + row * (args.height + pad)
            for y in range(args.height):
                base = (oy + y) * sheet_w + ox
                line = y * args.width
                for x in range(args.width):
                    if g[line + x]:
                        sheet[base + x] = 0
    sheet_path = os.path.join(out, "skin_silhouettes.png")
    write_png(sheet_path, sheet_w, sheet_h, sheet)
    print("\ncontact sheet: %s" % sheet_path)
    print("order, left to right: %s" % ", ".join(names))
    print("top row FRONT, bottom row SIDE, all at the same scale.")


if __name__ == "__main__":
    main()
