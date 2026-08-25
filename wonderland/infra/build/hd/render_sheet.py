#!/usr/bin/env python3
"""Render every HD asset to one contact sheet — no engine, one Lambert light.

    python3 hd/render_sheet.py out.png            # all assets
    python3 hd/render_sheet.py out.png hd_roof hd_gate_leaf   # a subset, larger

WHAT THIS IS. A software rasteriser: z-buffer, Gouraud shading from the
mesh's own smoothing groups, one directional key plus ambient, the asset's
default MATERIAL_SPEC base colour, a 3/4 orthographic view. It draws the
TRIANGLES this library authored — the roof's scalloped courses, the gate's
twisted pickets, the wreath's open lobes — which is exactly what the offline
composition tracer cannot do, because that tool fills bounding boxes.

WHAT THIS IS NOT. It is not Unreal. No shadows, no GI, no textures, no
roughness, no fog, no tonemapper. It answers one question and only that one:
"is this mesh a primitive, or is it a made thing?" — which is Gauntlet Round 4's
question, and the one the founder's rejection list is about. Whether the
materials and light then make it beautiful is a question for the L4.

Deliberately stdlib-only, like everything under hd/, so it runs on this
laptop for free while the Studio is stopped.
"""
import math
import os
import re
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import assets as A            # noqa: E402
import meshkit as mk          # noqa: E402

GEN = os.path.join(os.path.dirname(HERE), "generate-hub-level.py")

# ---- a 3x5 bitmap font, enough to label a tile ----------------------------
_FONT = {
    'a': "111101111101101", 'b': "110101110101110", 'c': "111100100100111",
    'd': "110101101101110", 'e': "111100110100111", 'f': "111100110100100",
    'g': "111100101101111", 'h': "101101111101101", 'i': "111010010010111",
    'j': "001001001101111", 'k': "101101110101101", 'l': "100100100100111",
    'm': "101111111101101", 'n': "110101101101101", 'o': "111101101101111",
    'p': "111101111100100", 'q': "111101101111001", 'r': "111101110101101",
    's': "111100111001111", 't': "111010010010010", 'u': "101101101101111",
    'v': "101101101101010", 'w': "101101111111101", 'x': "101101010101101",
    'y': "101101111001111", 'z': "111001010100111", '_': "000000000000111",
    '0': "111101101101111", '1': "010110010010111", '2': "111001111100111",
    '3': "111001111001111", '4': "101101111001001", '5': "111100111001111",
    '6': "111100111101111", '7': "111001001001001", '8': "111101111101111",
    '9': "111101111001111", ' ': "000000000000000", ':': "000010000010000",
    '/': "001001010100100", '.': "000000000000010", '-': "000000111000000",
}


def _text(px, W, H, x, y, s, rgb, scale=2):
    for ch in s:
        bits = _FONT.get(ch, _FONT[' '])
        for r in range(5):
            for c in range(3):
                if bits[r * 3 + c] == '1':
                    for dy in range(scale):
                        for dx in range(scale):
                            xx, yy = x + c * scale + dx, y + r * scale + dy
                            if 0 <= xx < W and 0 <= yy < H:
                                i = (yy * W + xx) * 3
                                px[i], px[i + 1], px[i + 2] = rgb
        x += 4 * scale


def base_colours():
    """name -> (r,g,b) in 0..1 linear, from MATERIAL_SPEC read as text."""
    out = {}
    try:
        src = open(GEN, encoding="utf8").read()
    except OSError:
        return out
    for m in re.finditer(r'^\s*"([a-z0-9_]+)":\s*\(\(([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)\)', src, re.M):
        out.setdefault(m.group(1), (float(m.group(2)), float(m.group(3)), float(m.group(4))))
    return out


def _srgb(v):
    v = max(0.0, min(1.0, v))
    return int(round(255.0 * (v ** (1.0 / 2.2))))


def render_tile(mesh, colour, size, yaw=38.0, pitch=-24.0):
    """Orthographic 3/4 view into a size x size RGB tile + coverage mask."""
    m = mesh.copy()
    m.centre()
    ex = m.extents()
    diag = math.sqrt(sum(e * e for e in ex)) or 1.0
    m.scale(1.0 / diag)
    m.rotate_z(yaw)
    m.rotate_x(pitch)
    normals = m.corner_normals()
    # screen: x -> right, z -> up, y -> depth (toward viewer is -y)
    half = size * 0.5
    zoom = size * 0.86
    tile = [0.0] * (size * size * 3)
    zbuf = [1e9] * (size * size)
    cov = bytearray(size * size)
    L = (-0.45, -0.55, 0.70)
    Ll = math.sqrt(sum(c * c for c in L))
    L = (L[0] / Ll, L[1] / Ll, L[2] / Ll)
    for ti, (a, b, c) in enumerate(m.tris):
        P = [m.verts[a], m.verts[b], m.verts[c]]
        S = [(half + p[0] * zoom, half - p[2] * zoom, p[1]) for p in P]
        sh = []
        for k in range(3):
            n = normals[ti][k]
            lam = max(0.0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2])
            rim = max(0.0, -n[1]) ** 3 * 0.10
            sh.append(0.22 + 0.78 * lam + rim)
        x0 = max(0, int(min(s[0] for s in S)))
        x1 = min(size - 1, int(max(s[0] for s in S)) + 1)
        y0 = max(0, int(min(s[1] for s in S)))
        y1 = min(size - 1, int(max(s[1] for s in S)) + 1)
        if x1 < x0 or y1 < y0:
            continue
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = S
        det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(det) < 1e-9:
            continue
        inv = 1.0 / det
        for yy in range(y0, y1 + 1):
            py = yy + 0.5
            for xx in range(x0, x1 + 1):
                pxx = xx + 0.5
                w1 = ((bx - pxx) * (cy - py) - (cx - pxx) * (by - py)) * inv
                w2 = ((cx - pxx) * (ay - py) - (ax - pxx) * (cy - py)) * inv
                w0 = 1.0 - w1 - w2
                # note: w1 is weight of A? derive: barycentric with the
                # standard formula; the sign test is what matters.
                if w0 < -1e-6 or w1 < -1e-6 or w2 < -1e-6:
                    continue
                # weights map (w1->A, w2->B, w0->C) for this formula
                z = w1 * az + w2 * bz + w0 * cz
                idx = yy * size + xx
                if z >= zbuf[idx]:
                    continue
                zbuf[idx] = z
                s = w1 * sh[0] + w2 * sh[1] + w0 * sh[2]
                tile[idx * 3] = colour[0] * s
                tile[idx * 3 + 1] = colour[1] * s
                tile[idx * 3 + 2] = colour[2] * s
                cov[idx] = 1
    return tile, cov


def write_png(path, W, H, px):
    raw = b"".join(b"\x00" + bytes(px[y * W * 3:(y + 1) * W * 3]) for y in range(H))
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        f.write(chunk(b"IEND", b""))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/hd_sheet.png"
    names = [a for a in sys.argv[2:] if not a.startswith("--")] or sorted(A.ASSETS)
    cols = 8 if len(names) > 12 else max(1, min(4, len(names)))
    size = 160 if len(names) > 12 else 300
    rows = (len(names) + cols - 1) // cols
    W, H = cols * size, rows * (size + 14)
    px = bytearray(W * H * 3)
    for i in range(0, len(px), 3):
        px[i], px[i + 1], px[i + 2] = 28, 26, 34
    cols_rgb = base_colours()
    for k, name in enumerate(names):
        spec = A.ASSETS[name]
        # THE AUTHORED MESH, NOT THE FITTED ONE. fit_box stretches a 7 uu-deep
        # gate leaf to 100 uu deep so a kit's scale arithmetic works; the first
        # sheet drew that stretched slab and it looked like the very box this
        # library exists to remove. The kits scale the depth back down in the
        # world; the sheet shows what was authored.
        mesh = spec["build"]()
        colour = cols_rgb.get(spec["material"], (0.6, 0.6, 0.6))
        tile, cov = render_tile(mesh, colour, size)
        ox, oy = (k % cols) * size, (k // cols) * (size + 14)
        for yy in range(size):
            for xx in range(size):
                idx = yy * size + xx
                if cov[idx]:
                    o = ((oy + yy) * W + ox + xx) * 3
                    px[o] = _srgb(tile[idx * 3])
                    px[o + 1] = _srgb(tile[idx * 3 + 1])
                    px[o + 2] = _srgb(tile[idx * 3 + 2])
        ex = mesh.extents()
        label = "%s %s %d %dx%dx%d" % (name[3:] if name.startswith("hd_") else name,
                                       spec["tier"].lower(), mesh.tri_count(),
                                       ex[0], ex[1], ex[2])
        _text(px, W, H, ox + 2, oy + size + 2, label[:38], (235, 225, 210), 1 if size < 200 else 2)
        sys.stderr.write("\r  %d/%d %s" % (k + 1, len(names), name))
    sys.stderr.write("\n")
    write_png(out, W, H, px)
    print("sheet %s  %dx%d  %d assets" % (out, W, H, len(names)))


if __name__ == "__main__":
    main()
