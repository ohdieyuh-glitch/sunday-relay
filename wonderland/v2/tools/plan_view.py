#!/usr/bin/env python3
"""The world from above: hierarchy is the one thing no camera can show.

    python3 wonderland/v2/tools/plan_view.py OUT.png [--size=1400] [--rmax=36000]
                                             [--mode=density|kind|score]

Every camera in this project stands INSIDE the core, at eye height, looking
at a composition. A hierarchy is a property of the whole plan -- how density
falls, whether the tiers read as gradients or as rings, where the roads go --
and none of that is visible from a place inside it. Three passes of this
project went into a twenty-metre patch a camera happened to show while two
orders of magnitude more ground sat outside every frame; this is the picture
that would have made that obvious in a second.

    density  placements per cell, log-shaded -- the hierarchy itself
    kind     one colour per quarter type, plus roads
    score    the raw HIER score field, which is what the generator reads

It is a DIAGRAM, not a render, and it is not evidence of visual quality. It
is evidence about where things are.
"""
import math
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "infra", "build", "hd"))
os.environ.setdefault("WLV2_PASS02", "1")
os.environ.setdefault("WLV2_PASS03", "1")
import layout_v2 as LAYOUT     # noqa: E402

SURFACE = ("garden_lawn", "terrace_platform", "stone_ring_base", "path_steps",
           "side_steps", "kerb_stone", "ground_flowers", "ground_blooms")
KIND_RGB = {"garden": (232, 148, 176), "towers": (150, 176, 236),
            "grove": (140, 206, 146), "wood": (94, 154, 110)}


def write_png(path, W, H, px):
    raw = b"".join(b"\x00" + bytes(px[y * W * 3:(y + 1) * W * 3]) for y in range(H))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n"
                + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def main():
    out = next((a for a in sys.argv[1:] if not a.startswith("--")), "PLAN.png")
    opt = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    W = H = int(opt.get("size", 1400))
    rmax = float(opt.get("rmax", 36000))
    mode = opt.get("mode", "density")
    px = bytearray(W * H * 3)

    def to_px(x, y):
        # screen-right is -X in this world (v2_config), and +Y is up the page
        return (int((0.5 - x / (2.0 * rmax)) * W), int((0.5 - y / (2.0 * rmax)) * H))

    def put(i, j, rgb):
        if 0 <= i < W and 0 <= j < H:
            k = (j * W + i) * 3
            px[k], px[k + 1], px[k + 2] = rgb

    def disc(x, y, r, rgb):
        ci, cj = to_px(x, y)
        rr = max(0, int(r / (2.0 * rmax) * W))
        for j in range(cj - rr, cj + rr + 1):
            for i in range(ci - rr, ci + rr + 1):
                if (i - ci) ** 2 + (j - cj) ** 2 <= rr * rr:
                    put(i, j, rgb)

    # 1. the score field as the ground, so the tiers are visible as tone
    step = 4
    for j in range(0, H, step):
        for i in range(0, W, step):
            wx = (0.5 - i / float(W)) * 2.0 * rmax
            wy = (0.5 - j / float(H)) * 2.0 * rmax
            if wx * wx + wy * wy > rmax * rmax:
                g = (10, 10, 14)
            else:
                s = LAYOUT.HIER(wx, wy)["score"]
                g = (int(16 + 60 * s), int(18 + 54 * s), int(24 + 46 * s))
            for jj in range(j, min(H, j + step)):
                for ii in range(i, min(W, i + step)):
                    put(ii, jj, g)

    if mode == "score":
        write_png(out, W, H, px)
        print("wrote %s (%dx%d, score field, r <= %.0f m)" % (out, W, H, rmax / 100.0))
        return

    # 2. every placement, one pixel, brightened where they pile up
    counts = {}
    for p in LAYOUT.ALL:
        if p["asset"] in SURFACE or p["asset"].startswith(("cloud_", "sky_")):
            continue
        i, j = to_px(p["pos"][0], p["pos"][1])
        if 0 <= i < W and 0 <= j < H:
            counts[(i, j)] = counts.get((i, j), 0) + 1
    for (i, j), n in counts.items():
        t = min(1.0, math.log(1 + n) / math.log(9.0))
        put(i, j, (int(120 + 135 * t), int(150 + 105 * t), int(120 + 100 * t)))

    # 2b. THE ROADS. They are `terrace_platform`, which is SURFACE and so is
    # excluded from every density measurement in this project -- correctly, a
    # road is ground you walk on rather than a thing standing on it. That also
    # made them invisible here, on the one picture whose subject is structure.
    for p in LAYOUT.ALL:
        lab = p.get("label") or ""
        if p["asset"] != "terrace_platform" or "_Road" not in lab and "RingRoad" not in lab:
            continue
        sc = p["scale"]
        sx = abs(sc[0]) if isinstance(sc, (list, tuple)) else abs(sc)
        half = 1440.0 * sx * 0.5
        yaw = math.radians(p["rot"][1])
        for t in range(-10, 11):
            wx = p["pos"][0] + math.cos(yaw) * half * (t / 10.0)
            wy = p["pos"][1] + math.sin(yaw) * half * (t / 10.0)
            i, j = to_px(wx, wy)
            put(i, j, (150, 132, 104))

    # 3. quarter footprints, by kind, as rings -- so tier SIZE is legible
    for s in LAYOUT.SITES:
        rgb = KIND_RGB.get(s["kind"], (220, 220, 220))
        ci, cj = to_px(s["x"], s["y"])
        rr = max(2, int(s.get("reach", 2200.0) / (2.0 * rmax) * W))
        for a in range(0, 360, 2):
            t = math.radians(a)
            put(ci + int(math.cos(t) * rr), cj + int(math.sin(t) * rr), rgb)
        disc(s["x"], s["y"], 220.0, rgb)

    # 4. the three tier boundaries, faint, for reading the plan only
    for rm in (6500.0, 17500.0, 33500.0):
        ci, cj = to_px(0, 0)
        rr = int(rm / (2.0 * rmax) * W)
        for a in range(0, 3600, 3):
            t = math.radians(a / 10.0)
            put(ci + int(math.cos(t) * rr), cj + int(math.sin(t) * rr), (70, 66, 58))

    write_png(out, W, H, px)
    n_solid = sum(counts.values())
    print("wrote %s (%dx%d, r <= %.0f m): %d solid placements, %d quarters"
          % (out, W, H, rmax / 100.0, n_solid, len(LAYOUT.SITES)))


if __name__ == "__main__":
    main()
