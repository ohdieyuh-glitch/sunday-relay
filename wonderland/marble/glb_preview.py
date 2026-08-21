#!/usr/bin/env python3
"""Look at a Marble GLB without an engine, a GPU or a library.

    python3 glb_preview.py worlds/royal-garden/assets/collider.glb out.png \
        --yaw 0 --pitch -10 --fov 70

WHY THIS EXISTS

A Marble world arrives as geometry and the only picture of it is a 720x480
thumbnail the vendor chose. Everything downstream — is the scale right, where is
the ground, ARE THERE DOGS IN IT AND WHERE — is a question about the mesh, and
answering it by cooking the mesh into Unreal on a paid GPU is the most expensive
possible way to look at a file.

So: parse the GLB, project every vertex, z-buffer them as small splats coloured
by COLOR_0, write a PNG. It is a point cloud, not a render — no triangles, no
lighting, no textures. That is enough to see composition, scale, and what is
standing on the plaza, which is all it claims to do.

Pure stdlib on purpose. There is no PIL in this environment and adding a
dependency to look at a file is how a check stops being run.
"""
import argparse
import json
import math
import os
import struct
import sys
import zlib

COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
             5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def load_glb(path):
    data = open(path, "rb").read()
    magic, _version, _length = struct.unpack("<III", data[:12])
    if magic != 0x46546C67:
        raise SystemExit("%s is not a GLB (magic %r)" % (path, data[:4]))
    off, js, bin_ = 12, None, b""
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf8"))
        elif ctype == 0x004E4942:
            bin_ = chunk
        off += 8 + clen
    if js is None:
        raise SystemExit("no JSON chunk in %s" % path)
    return js, bin_


def read_accessor(js, bin_, index):
    acc = js["accessors"][index]
    view = js["bufferViews"][acc["bufferView"]]
    fmt, size = COMPONENT[acc["componentType"]]
    n = NCOMP[acc["type"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride") or (size * n)
    out = []
    for i in range(acc["count"]):
        base = start + i * stride
        out.append(struct.unpack_from("<" + fmt * n, bin_, base))
    return out


def write_png(path, w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6))
           + chunk(b"IEND", b""))
    open(path, "wb").write(png)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("glb")
    ap.add_argument("out")
    ap.add_argument("--width", type=int, default=900)
    ap.add_argument("--height", type=int, default=560)
    ap.add_argument("--yaw", type=float, default=0.0, help="degrees around the up axis")
    ap.add_argument("--pitch", type=float, default=-8.0)
    ap.add_argument("--fov", type=float, default=70.0)
    ap.add_argument("--dist", type=float, default=0.0, help="0 = auto from bounds")
    ap.add_argument("--eye-height", type=float, default=0.0,
                    help="raw units above the ground plane; 0 = auto")
    ap.add_argument("--top", action="store_true", help="orthographic plan view instead")
    ap.add_argument("--mark", default="", help="x,z,radius — draw a ring, in raw units")
    ap.add_argument("--eye", default="", help="x,y,z explicit eye position in raw units")
    # MARBLE'S COLLIDER EXPORT IS Y-DOWN. Measured, not assumed: near the
    # reconstruction origin the vertex Y range is -5.02..0.63, the densest bands
    # sit at negative Y, and the reported ground_plane_offset of 1.075 m matches
    # raw Y +0.63 once metric_scale_factor is applied. So +Y is BELOW the camera
    # and the towers are at negative Y. Rendering it as Y-up produces a world
    # hanging upside down from a point, which is what it looked like.
    ap.add_argument("--flip-y", action="store_true",
                    help="negate Y (Marble's collider export is Y-down)")
    args = ap.parse_args(argv)

    js, bin_ = load_glb(args.glb)
    prim = js["meshes"][0]["primitives"][0]
    pos = read_accessor(js, bin_, prim["attributes"]["POSITION"])
    if args.flip_y:
        pos = [(p[0], -p[1], p[2]) for p in pos]
    col = (read_accessor(js, bin_, prim["attributes"]["COLOR_0"])
           if "COLOR_0" in prim["attributes"] else None)

    xs = [p[0] for p in pos]; ys = [p[1] for p in pos]; zs = [p[2] for p in pos]
    lo = (min(xs), min(ys), min(zs)); hi = (max(xs), max(ys), max(zs))
    ctr = [(lo[i] + hi[i]) / 2.0 for i in range(3)]
    span = max(hi[i] - lo[i] for i in range(3))
    sys.stderr.write("verts %d  bounds %s .. %s\n" % (len(pos),
        [round(v, 2) for v in lo], [round(v, 2) for v in hi]))

    W, H = args.width, args.height
    px = bytearray(W * H * 3)
    for i in range(0, W * H * 3, 3):
        px[i] = 12; px[i + 1] = 12; px[i + 2] = 18
    zbuf = [1e30] * (W * H)

    def put(sx, sy, depth, rgb, size=1):
        for oy in range(-size, size + 1):
            for ox in range(-size, size + 1):
                x, y = sx + ox, sy + oy
                if 0 <= x < W and 0 <= y < H:
                    k = y * W + x
                    if depth < zbuf[k]:
                        zbuf[k] = depth
                        j = k * 3
                        px[j], px[j + 1], px[j + 2] = rgb

    if args.top:
        # Plan view: the fastest way to find WHERE something is standing.
        sx_ = (W - 20) / max(1e-6, hi[0] - lo[0])
        sz_ = (H - 20) / max(1e-6, hi[2] - lo[2])
        s = min(sx_, sz_)
        for i, p in enumerate(pos):
            sxp = int(10 + (p[0] - lo[0]) * s)
            syp = int(10 + (p[2] - lo[2]) * s)
            c = col[i] if col else (200, 200, 200, 255)
            put(sxp, syp, -p[1], (c[0], c[1], c[2]))
    else:
        yaw = math.radians(args.yaw); pitch = math.radians(args.pitch)
        dist = args.dist or span * 0.75
        eye_h = args.eye_height or (hi[1] - (hi[1] - lo[1]) * 0.12)
        if args.eye:
            eye = tuple(float(v) for v in args.eye.split(","))
        else:
            eye = (ctr[0] + math.sin(yaw) * dist, eye_h, ctr[2] + math.cos(yaw) * dist)
        f = (W / 2.0) / math.tan(math.radians(args.fov) / 2.0)
        cy, sy2 = math.cos(-yaw), math.sin(-yaw)
        cp, sp = math.cos(-pitch), math.sin(-pitch)
        for i, p in enumerate(pos):
            dx, dy, dz = p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]
            rx = dx * cy - dz * sy2
            rz = dx * sy2 + dz * cy
            ry = dy * cp - rz * sp
            rz2 = dy * sp + rz * cp
            if rz2 >= -0.05:
                continue                      # behind the eye
            depth = -rz2
            sxp = int(W / 2 + f * rx / depth)
            syp = int(H / 2 - f * ry / depth)
            c = col[i] if col else (200, 200, 200, 255)
            put(sxp, syp, depth, (c[0], c[1], c[2]), 1 if depth > span * 0.25 else 2)

    if args.mark and args.top:
        mx, mz, mr = [float(v) for v in args.mark.split(",")]
        s = min((W - 20) / max(1e-6, hi[0] - lo[0]), (H - 20) / max(1e-6, hi[2] - lo[2]))
        cxp = int(10 + (mx - lo[0]) * s); czp = int(10 + (mz - lo[2]) * s)
        for a in range(0, 360, 2):
            r = math.radians(a)
            x = int(cxp + math.cos(r) * mr * s); y = int(czp + math.sin(r) * mr * s)
            if 0 <= x < W and 0 <= y < H:
                j = (y * W + x) * 3
                px[j], px[j + 1], px[j + 2] = (255, 40, 200)

    write_png(args.out, W, H, px)
    print("wrote %s (%dx%d) from %d vertices" % (args.out, W, H, len(pos)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
