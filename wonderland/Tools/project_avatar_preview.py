"""Render a .wlvox figure to a picture, without an engine.

WHY THIS EXISTS. The founder's Project Avatar checkpoint is six creatures seen in Wonderland, and that proof belongs in
the engine. But an engine cycle costs a build, an editor relaunch and a PIE run, and the faults worth catching first are
the gross ones -- a tail pointing through the body, an eye sunk inside a head, a leg starting above the shoulder. Those
are visible in a flat orthographic projection drawn from the same box list the engine reads.

So this is a development aid, not the proof. It says nothing about materials, light, glow or animation: for those, the
engine is the only honest answer.

HOW IT DRAWS. Painter's algorithm over the boxes, sorted back to front, each box a filled quadrilateral with a simple
lambert shade per face normal, on a dark ground. No dependencies: the output is a BMP written byte by byte, because this
machine has neither Pillow nor numpy and a preview tool is not worth an install.

Usage:  python wonderland/Tools/project_avatar_preview.py [--dir wonderland/ProjectAvatars] [--out DIR] [--size 900]
"""

import argparse
import math
import os
import struct

# The three quarters the founder's own sheets use, so a preview can be compared with them directly.
VIEWS = {
    "front": (0.0, 12.0),
    "side": (90.0, 10.0),
    "threequarter": (38.0, 16.0),
}


def read_figure(path):
    """Materials and boxes. Parts are read only for their pivots: the preview draws the rest pose."""
    materials = {}
    parts = {}
    order = []
    boxes = []
    voxel = 2.5
    for line in open(path, encoding="utf-8"):
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        word = line.split()
        if word[0] == "voxel":
            voxel = float(word[1])
        elif word[0] == "material":
            materials[word[1]] = dict(kind=word[2], rgb=(float(word[3]), float(word[4]), float(word[5])))
        elif word[0] == "part":
            name, parent = word[1], word[2]
            pivot = (float(word[3]), float(word[4]), float(word[5]))
            parts[name] = dict(parent=parent, pivot=pivot)
            order.append(name)
        elif word[0] == "box":
            boxes.append(dict(part=word[1], material=word[2],
                              centre=(float(word[3]), float(word[4]), float(word[5])),
                              size=(float(word[6]), float(word[7]), float(word[8]))))
    return voxel, materials, parts, boxes


def shade(rgb, kind, normal_dot):
    """Lit faces take a simple lambert; glow and additive faces are drawn at their own colour, as they read in engine."""
    if kind in ("glow", "add"):
        return tuple(min(1.0, c * 1.15 + 0.10) for c in rgb)
    lit = 0.34 + 0.66 * max(normal_dot, 0.0)
    return tuple(min(1.0, c * lit) for c in rgb)


def render(path, out_path, size=900, yaw_deg=38.0, pitch_deg=16.0):
    voxel, materials, parts, boxes = read_figure(path)
    if not boxes:
        return None

    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    # Camera basis: looking along -X after yaw, with Z up.
    def project(p):
        x, y, z = p
        rx = x * math.cos(yaw) - y * math.sin(yaw)
        ry = x * math.sin(yaw) + y * math.cos(yaw)
        # depth grows away from the camera
        depth = rx * math.cos(pitch) + z * math.sin(pitch)
        screen_x = ry
        screen_y = z * math.cos(pitch) - rx * math.sin(pitch)
        return screen_x, screen_y, depth

    # Fit the whole figure in frame.
    corners = []
    for box in boxes:
        cx, cy, cz = box["centre"]
        sx, sy, sz = box["size"]
        for dx in (-0.5, 0.5):
            for dy in (-0.5, 0.5):
                for dz in (-0.5, 0.5):
                    corners.append(project((cx + sx * dx, cy + sy * dy, cz + sz * dz)))
    min_x = min(c[0] for c in corners)
    max_x = max(c[0] for c in corners)
    min_y = min(c[1] for c in corners)
    max_y = max(c[1] for c in corners)
    span = max(max_x - min_x, max_y - min_y) * 1.10 or 1.0
    scale = size / span
    off_x = (min_x + max_x) * 0.5
    off_y = (min_y + max_y) * 0.5

    def to_pixel(p):
        sx, sy, depth = project(p)
        return ((sx - off_x) * scale + size * 0.5, size * 0.5 - (sy - off_y) * scale, depth)

    ground = (0.055, 0.055, 0.075)
    pixels = [[ground for _ in range(size)] for _ in range(size)]
    zbuf = [[1e18 for _ in range(size)] for _ in range(size)]

    # Faces of a unit box, with their normals.
    faces = [
        ((0, 0, 1), [(-0.5, -0.5, 0.5), (0.5, -0.5, 0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5)]),
        ((0, 0, -1), [(-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, 0.5, -0.5), (-0.5, 0.5, -0.5)]),
        ((1, 0, 0), [(0.5, -0.5, -0.5), (0.5, 0.5, -0.5), (0.5, 0.5, 0.5), (0.5, -0.5, 0.5)]),
        ((-1, 0, 0), [(-0.5, -0.5, -0.5), (-0.5, 0.5, -0.5), (-0.5, 0.5, 0.5), (-0.5, -0.5, 0.5)]),
        ((0, 1, 0), [(-0.5, 0.5, -0.5), (0.5, 0.5, -0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5)]),
        ((0, -1, 0), [(-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, -0.5, 0.5), (-0.5, -0.5, 0.5)]),
    ]
    # A key light from over the camera's left shoulder, as the sheets are lit. +X is a figure's FRONT in this format,
    # so the key leans that way: lighting the back left every face a reader wants to judge in shadow.
    light = (0.50, -0.52, 0.69)
    light_len = math.sqrt(sum(c * c for c in light))
    light = tuple(c / light_len for c in light)

    for box in sorted(boxes, key=lambda b: -to_pixel(b["centre"])[2]):
        material = materials.get(box["material"], dict(kind="lit", rgb=(0.8, 0.8, 0.8)))
        cx, cy, cz = box["centre"]
        sx, sy, sz = box["size"]
        for normal, quad in faces:
            dot = sum(n * l for n, l in zip(normal, light))
            colour = shade(material["rgb"], material["kind"], dot)
            points = [to_pixel((cx + sx * qx, cy + sy * qy, cz + sz * qz)) for qx, qy, qz in quad]
            # Scanline fill of the quad, depth-tested so a nearer box wins.
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            top = max(0, int(min(ys)))
            bottom = min(size - 1, int(max(ys)) + 1)
            left = max(0, int(min(xs)))
            right = min(size - 1, int(max(xs)) + 1)
            if right < left or bottom < top:
                continue
            depth = sum(p[2] for p in points) / 4.0
            for py in range(top, bottom + 1):
                # Crossings of this scanline with the quad's edges.
                spans = []
                for i in range(4):
                    x0, y0 = points[i][0], points[i][1]
                    x1, y1 = points[(i + 1) % 4][0], points[(i + 1) % 4][1]
                    if (y0 <= py < y1) or (y1 <= py < y0):
                        t = (py - y0) / (y1 - y0)
                        spans.append(x0 + (x1 - x0) * t)
                if len(spans) < 2:
                    continue
                for px in range(max(0, int(min(spans))), min(size - 1, int(max(spans))) + 1):
                    if depth < zbuf[py][px]:
                        zbuf[py][px] = depth
                        pixels[py][px] = colour

    _write_bmp(out_path, pixels, size)
    return out_path


def _write_bmp(path, pixels, size):
    row_padding = (4 - (size * 3) % 4) % 4
    data = bytearray()
    for y in range(size - 1, -1, -1):  # BMP rows run bottom-up
        for x in range(size):
            r, g, b = pixels[y][x]
            data += bytes((int(min(1.0, b) * 255), int(min(1.0, g) * 255), int(min(1.0, r) * 255)))
        data += b"\x00" * row_padding
    header = struct.pack("<2sIHHI", b"BM", 14 + 40 + len(data), 0, 0, 14 + 40)
    info = struct.pack("<IiiHHIIiiII", 40, size, size, 1, 24, 0, len(data), 2835, 2835, 0, 0)
    with open(path, "wb") as handle:
        handle.write(header + info + data)


def main():
    parser = argparse.ArgumentParser(description="Preview .wlvox figures without an engine.")
    parser.add_argument("--dir", default=os.path.join("wonderland", "ProjectAvatars"))
    parser.add_argument("--out", default=os.path.join("wonderland", "ProjectAvatars", "preview"))
    parser.add_argument("--size", type=int, default=760)
    parser.add_argument("--views", default="threequarter")
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    wanted = [v.strip() for v in args.views.split(",") if v.strip()]
    for name in sorted(os.listdir(args.dir)):
        if not name.endswith(".wlvox"):
            continue
        for view in wanted:
            yaw, pitch = VIEWS[view]
            out = os.path.join(args.out, "%s_%s.bmp" % (name[: -len(".wlvox")], view))
            render(os.path.join(args.dir, name), out, size=args.size, yaw_deg=yaw, pitch_deg=pitch)
            print("%-34s -> %s" % (name, os.path.basename(out)))


if __name__ == "__main__":
    main()
