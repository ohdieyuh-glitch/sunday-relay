#!/usr/bin/env python3
"""Draw the Relay Dog's walk, trot and run as a picture, with no GPU.

WHY THIS EXISTS

Locomotion is the goal's highest-priority VISIBLE item, and every way of looking
at it so far has needed the L4: build, cook, package, stream, capture. When the
Studio is off that is not a slow loop, it is no loop — and "the gait is correct"
becomes a claim resting entirely on arithmetic nobody can see.

So: the canonical Dog's own part table, projected side-on, posed by the engine's
own gait numbers, written out as a PNG strip. It is not a render — no lighting,
no materials, no perspective — and it must never be shown as one. What it IS is
an honest picture of where the legs actually are, which is the entire question.

PROVENANCE, BECAUSE A SECOND IMPLEMENTATION DRIFTS

The parts come from wonderland/web/gait/dog-body.json, generated out of
WonderlandDogBody.cpp. The gait comes from gait.golden.json, emitted by the C++
test binary. This file re-implements the two formulas that turn a phase into a
pose, and CHECKS them against the golden's own sampled rows before drawing
anything — so a drift between this and the engine is a failure here, not a
picture that quietly shows a different animal.

    python3 render-gait-strip.py --out /tmp/gait-strip.png
"""
import argparse
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.normpath(os.path.join(HERE, "..", "..", "web", "gait"))
BODY_JSON = os.path.join(WEB, "dog-body.json")
GOLDEN_JSON = os.path.join(WEB, "gait.golden.json")

_ns = {"__name__": "wl_gen_textures"}
exec(compile(io.open(os.path.join(HERE, "gen-textures.py"), encoding="utf8").read(),
             "gen-textures.py", "exec"), _ns)
write_png = _ns["write_png"]


def frac(v):
    f = v - math.floor(v)
    return f + 1.0 if f < 0 else f


def leg_pose(phase, stride, lift, duty):
    """Mirrors WonderlandGait::LegPose. Checked against the golden below."""
    p = frac(phase)
    d = 0.15 if duty < 0.15 else (0.95 if duty > 0.95 else duty)
    reach = stride * d * 0.5
    if p < d:
        return (reach - (p / d) * (2.0 * reach), 0.0, True)
    w = (p - d) / (1.0 - d)
    return (-reach + w * (2.0 * reach), lift * math.sin(math.pi * w), False)


def body_pose(phase, bob):
    p = frac(phase)
    two_pi = 6.283185307179586
    return (bob * math.sin(two_pi * 2.0 * p),
            1.2 * math.sin(two_pi * 2.0 * p - 1.5707963),
            1.8 * math.sin(two_pi * p))


def check_parity(golden):
    """This file's formulas against the engine's own sampled rows.

    A second implementation of the same arithmetic drifts. If it has, the strip
    would show a different animal from the one Unreal runs, convincingly.
    """
    stride, lift, bob = golden["stride"], golden["lift"], golden["bob"]
    duty = golden["dutyFactor"]
    worst = 0.0
    for s in golden["samples"]:
        f, l, st = leg_pose(s["p"], stride, lift, duty)
        b, _, _ = body_pose(s["p"], bob)
        worst = max(worst, abs(f - s["fwd"]), abs(l - s["lift"]), abs(b - s["bob"]))
        if st != s["stance"]:
            raise SystemExit("render-gait-strip: stance disagrees with the engine "
                             "at phase %.4f — refusing to draw a different animal"
                             % s["p"])
    if worst > 1e-4:
        raise SystemExit("render-gait-strip: pose disagrees with the engine by "
                         "%.6f — refusing to draw a different animal" % worst)
    return worst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/gait-strip.png")
    ap.add_argument("--frames", type=int, default=8)
    ap.add_argument("--cell", type=int, default=210)
    args = ap.parse_args()

    for path in (BODY_JSON, GOLDEN_JSON):
        if not os.path.isfile(path):
            raise SystemExit("render-gait-strip: missing %s" % path)
    body = json.load(io.open(BODY_JSON, encoding="utf8"))
    golden = json.load(io.open(GOLDEN_JSON, encoding="utf8"))
    worst = check_parity(golden)

    gaits = golden.get("gaits") or []
    # One row per NAMED gait, at the speed where it is fully entered — sampling
    # mid-band would draw a blend of two patterns and label it as one.
    rows = []
    for want in ("walk", "trot", "run"):
        cands = [g for g in gaits if g["gait"] == want]
        if cands:
            rows.append(cands[len(cands) // 2])
    if not rows:
        raise SystemExit("render-gait-strip: the golden carries no gait table")

    legs = body["legRows"]
    parts = body["parts"]
    leg_len = golden["legLength"]

    W = args.cell * args.frames
    H = args.cell * len(rows)
    px = bytearray([18, 16, 26] * (W * H))

    def put(x, y, rgb):
        if 0 <= x < W and 0 <= y < H:
            i = (y * W + x) * 3
            px[i], px[i + 1], px[i + 2] = rgb

    def box(cx, cy, hw, hh, rgb):
        for y in range(int(cy - hh), int(cy + hh) + 1):
            for x in range(int(cx - hw), int(cx + hw) + 1):
                put(x, y, rgb)

    COAT = (232, 230, 240)
    VISOR = (12, 12, 18)
    EYE = (255, 198, 60)
    LEG_COLS = [(255, 110, 140), (110, 200, 255), (255, 210, 90), (140, 255, 160)]
    GROUND = (58, 48, 82)

    # Side-on: Unreal +X (nose) to the right, +Z up. uu -> px.
    SCALE = args.cell / 620.0
    for r, g in enumerate(rows):
        stride, duty, lift, bob = g["stride"], g["duty"], g["lift"], g["bob"]
        for f in range(args.frames):
            ox = f * args.cell
            oy = r * args.cell
            gy = oy + int(args.cell * 0.86)
            for x in range(ox, ox + args.cell):
                put(x, gy, GROUND)
            # Distance travelled across the cell = one full stride.
            dist = (f / float(args.frames)) * stride
            bb, _, _ = body_pose(dist / stride, bob)
            cx = ox + args.cell // 2

            for i, p in enumerate(parts):
                loc, sc = p["loc"], p["scale"]
                is_leg = i in legs
                col = COAT
                if p["mat"] == "Visor":
                    col = VISOR
                elif p["mat"] == "Eye":
                    col = EYE
                px_x = cx + loc[0] * SCALE
                px_y = gy - (loc[2] + bb) * SCALE
                hw = max(1.0, sc[0] * 50.0 * SCALE)
                hh = max(1.0, sc[2] * 50.0 * SCALE)
                if is_leg:
                    li = legs.index(i)
                    fwd, lft, stance = leg_pose(dist / stride + g["offsets"][li],
                                                stride, lift, duty)
                    px_x += fwd * SCALE
                    px_y -= lft * SCALE
                    # A PLANTED PAW IS DRAWN IN ITS OWN COLOUR AND A LIFTED ONE
                    # IS DIMMED, so foot lock is legible in a still: the planted
                    # paws should sit on the ground line without sliding.
                    col = LEG_COLS[li] if stance else tuple(int(c * 0.45) for c in LEG_COLS[li])
                box(px_x, px_y, hw, hh, col)

    write_png(args.out, W, H, px)
    print("render-gait-strip: %s  %dx%d  rows=%s  parity worst %.2e"
          % (args.out, W, H, ",".join(g["gait"] for g in rows), worst))


if __name__ == "__main__":
    main()
