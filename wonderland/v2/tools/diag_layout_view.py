#!/usr/bin/env python3
"""DIAGNOSTIC ONLY: project the V2 layout's bounding boxes through a V2 camera.

    python3 diag_layout_view.py OUT.png [--cam=0] [--size=1600x900]

Every placement's oriented box (from the asset's authored extents x scale)
is projected through the camera and filled by material colour, nearest last.
It answers one question before Studio time is spent: is the COMPOSITION
where the reprojected reference puts it? It is not a render, it is not
evidence of quality, and it is labelled DIAG in its filename for that reason.
"""
import math
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "infra", "build", "hd"))
import v2_config as C            # noqa: E402
import layout_v2 as L            # noqa: E402
import assets_v2 as A            # noqa: E402
import materials_v2 as M         # noqa: E402
import dressing_v2 as D          # noqa: E402
import gs                        # noqa: E402


def write_png(path, W, H, px):
    raw = b"".join(b"\x00" + bytes(px[y * W * 3:(y + 1) * W * 3]) for y in range(H))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opt = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    out = args[0] if args else "/tmp/V2_DIAG_layout.png"
    cam = C.HERO_CAMS[int(opt.get("cam", 0))]
    W, H = [int(v) for v in opt.get("size", "1600x900").split("x")]
    class U: pass
    ctx = gs.Context(U(), lambda m: None, force_fallback=True)
    ext = {}
    for key, (fn, folder, nan, col) in A.RECIPES.items():
        try:
            mb = fn(ctx)
            lo, hi = mb.mesh.bbox()
            ext[key] = (lo, hi)
        except Exception:
            ext[key] = ((-50, -50, 0), (50, 50, 100))
    colours = {n: v[1] for n, v in M.INSTANCES.items()}
    cx, cy, cz = cam["location"]
    pitch, yaw = math.radians(cam["rotation"][0]), math.radians(cam["rotation"][1] - 90.0)
    fx = math.tan(math.radians(cam["fov"]) * 0.5)
    fy = fx * H / W
    items = list(L.ALL) + D.plan()
    # plaza slabs and path as one ground plane colour: draw a flat quad each
    x0, x1, y0, y1 = L.PLAZA_RECT
    items = [{"asset": "_plaza", "pos": ((x0 + x1) / 2, (y0 + y1) / 2, 0), "rot": (0, 0, 0),
              "scale": (1, 1, 1), "mat": "MI_V2_PlazaCream", "label": "plaza", "_box": ((x0, y0, -2), (x1, y1, 2))},
             {"asset": "_path", "pos": (0, 2600, 40), "rot": (0, 0, 0), "scale": (1, 1, 1), "mat": "MI_V2_PathStone",
              "label": "path", "_box": ((-220, 850, 0), (220, 4450, 120))}] + items
    zbuf = [1e12] * (W * H)
    px = bytearray(W * H * 3)
    for i in range(0, len(px), 3):
        px[i], px[i + 1], px[i + 2] = 150, 190, 235          # sky
    for j in range(H // 2, H):                                  # ground
        for i in range(W):
            o = (j * W + i) * 3
            px[o], px[o + 1], px[o + 2] = 120, 150, 90
    def project(p):
        dx, dy, dz = p[0] - cx, p[1] - cy, p[2] - cz
        # yaw: world +Y is the camera's forward when yaw = 0 (rotation yaw 90)
        fx_, fy_ = dx * math.cos(yaw) + dy * math.sin(yaw), -dx * math.sin(yaw) + dy * math.cos(yaw)
        # pitch
        fwd = fy_ * math.cos(pitch) + dz * math.sin(pitch)
        up = -fy_ * math.sin(pitch) + dz * math.cos(pitch)
        right = -fx_                                           # screen-right is -X
        if fwd < 30.0:
            return None
        sx = (right / fwd) / fx
        sy = (up / fwd) / fy
        return ((sx + 1.0) * 0.5 * W, (1.0 - sy) * 0.5 * H, fwd)
    drawn = 0
    for it in items:
        if it["asset"] == "sky_dome":
            continue
        if "_box" in it:
            lo, hi = it["_box"]
            corners = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        else:
            e = ext.get(it["asset"])
            if e is None:
                continue
            lo, hi = e
            sx_, sy_, sz_ = it["scale"]
            yw = math.radians(it["rot"][1])
            px_, py_, pz_ = it["pos"]
            corners = []
            for x in (lo[0] * sx_, hi[0] * sx_):
                for y in (lo[1] * sy_, hi[1] * sy_):
                    for z in (lo[2] * sz_, hi[2] * sz_):
                        corners.append((px_ + x * math.cos(yw) - y * math.sin(yw), py_ + x * math.sin(yw) + y * math.cos(yw), pz_ + z))
        if "_box" in it:
            # ground quads reach behind the camera: clip each corner to the
            # near plane by pulling it toward the camera position
            clipped = []
            for c in corners:
                dx, dy = c[0] - cx, c[1] - cy
                fwd = -dx * math.sin(yaw) + dy * math.cos(yaw)
                if fwd < 40.0:
                    t = (40.0 - fwd) / max(1e-6, (40.0 - fwd) + (fwd - (-1e9)))  # placeholder
                    # move the corner along the view direction until fwd == 40
                    dxv, dyv = -math.sin(yaw), math.cos(yaw)
                    c = (c[0] + dxv * (40.0 - fwd), c[1] + dyv * (40.0 - fwd), c[2])
                clipped.append(c)
            corners = clipped
        pts = [project(c) for c in corners]
        if any(p is None for p in pts):
            continue
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; d = min(p[2] for p in pts)
        bx0, bx1 = max(0, int(min(xs))), min(W - 1, int(max(xs)))
        by0, by1 = max(0, int(min(ys))), min(H - 1, int(max(ys)))
        if bx1 < bx0 or by1 < by0:
            continue
        col = colours.get(it.get("mat"), (0.6, 0.6, 0.6))
        shade = 1.0 / (1.0 + d / 15000.0)                       # crude aerial fade
        rgb = tuple(int(255 * min(1.0, (c ** 0.6) * shade + (1 - shade) * 0.72)) for c in col)
        # a rounded fill so foliage does not read as bricks in the diagnostic
        mx, my = (bx0 + bx1) * 0.5, (by0 + by1) * 0.5
        ex, ey = max(0.5, (bx1 - bx0) * 0.5), max(0.5, (by1 - by0) * 0.5)
        roundish = it["asset"] not in ("_plaza", "_path") and not it["asset"].startswith(("castle", "gate_pier", "retaining", "side_steps", "garden_wall", "facade", "roof_flat", "terrace", "planter", "pedestal", "path_steps", "stairs"))
        for yy in range(by0, by1 + 1):
            for xx in range(bx0, bx1 + 1):
                if roundish and ((xx - mx) / ex) ** 2 + ((yy - my) / ey) ** 2 > 1.0:
                    continue
                k = yy * W + xx
                if d < zbuf[k]:
                    zbuf[k] = d
                    o = k * 3
                    px[o], px[o + 1], px[o + 2] = rgb
        drawn += 1
    write_png(out, W, H, px)
    print("DIAG %s  %d boxes projected through %s (%.0f deg)" % (out, drawn, cam["name"], cam["fov"]))


if __name__ == "__main__":
    main()
