#!/usr/bin/env python3
"""Render the perspective view a V2 hero camera sees INSIDE the Marble panorama.

    python3 reproject_reference.py OUT.png [--yaw=0 --pitch=-2 --fov=100 --size=1920x1080]

The panorama is equirectangular; the founder's side-by-sides need a
perspective image with the SAME projection as the Unreal capture, or the
comparison is between two different lenses. This samples the equirect per
pixel (bilinear) for the given yaw/pitch/horizontal FOV -- stdlib + ffmpeg
only, so it runs anywhere. Defaults are HeroCam_V2_MarbleReference.

This is a REFERENCE view, never a render. It is the right-hand panel.
"""
import math
import os
import struct
import subprocess
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
PANO = os.path.join(HERE, "..", "reference", "marble-royal-garden-backdrop-panorama.jpg")


def load(path, w, h):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=%d:%d" % (w, h),
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    if len(raw) != w * h * 3:
        raise SystemExit("ffmpeg could not decode %s" % path)
    return raw


def write_png(path, W, H, px):
    raw = b"".join(b"\x00" + bytes(px[y * W * 3:(y + 1) * W * 3]) for y in range(H))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = args[0] if args else "/tmp/reference_view.png"
    opt = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    yaw = math.radians(float(opt.get("yaw", 0.0)))
    pitch = math.radians(float(opt.get("pitch", -2.0)))
    hfov = math.radians(float(opt.get("fov", 100.0)))
    W, H = [int(v) for v in opt.get("size", "1920x1080").split("x")]
    PW, PH = 4608, 2304
    pano = load(PANO, PW, PH)
    px = bytearray(W * H * 3)
    fx = math.tan(hfov * 0.5)
    fy = fx * H / W
    cp, sp = math.cos(pitch), math.sin(pitch)
    cy, sy = math.cos(yaw), math.sin(yaw)
    for j in range(H):
        vy = (1.0 - 2.0 * (j + 0.5) / H) * fy          # up
        for i in range(W):
            vx = (2.0 * (i + 0.5) / W - 1.0) * fx      # right
            # camera ray: forward (0,1,0), right (1,0,0), up (0,0,1) in a local frame
            dx, dy, dz = vx, 1.0, vy
            # pitch about the right axis
            dy2 = dy * cp - dz * sp
            dz2 = dy * sp + dz * cp
            dy, dz = dy2, dz2
            # yaw about up (positive = turn right)
            dx2 = dx * cy + dy * sy
            dy2 = -dx * sy + dy * cy
            dx, dy = dx2, dy2
            L = math.sqrt(dx * dx + dy * dy + dz * dz)
            az = math.atan2(dx, dy)                      # 0 forward, + right
            el = math.asin(dz / L)
            u = (az / (2.0 * math.pi) + 0.5) * PW
            v = (0.5 - el / math.pi) * PH
            x0 = int(u) % PW
            y0 = min(PH - 1, max(0, int(v)))
            x1 = (x0 + 1) % PW
            y1 = min(PH - 1, y0 + 1)
            fu, fv = u - int(u), v - int(v)
            o = (j * W + i) * 3
            for c in range(3):
                a = pano[(y0 * PW + x0) * 3 + c] * (1 - fu) + pano[(y0 * PW + x1) * 3 + c] * fu
                b = pano[(y1 * PW + x0) * 3 + c] * (1 - fu) + pano[(y1 * PW + x1) * 3 + c] * fu
                px[o + c] = int(a * (1 - fv) + b * fv)
    write_png(out, W, H, px)
    print("reference view %s  %dx%d  yaw %.1f pitch %.1f hfov %.1f" % (out, W, H, math.degrees(yaw), math.degrees(pitch), math.degrees(hfov)))


if __name__ == "__main__":
    main()
