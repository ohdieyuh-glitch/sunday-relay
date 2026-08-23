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


POSE_JSON = os.path.join(WEB, "pose.golden.json")


def render_upright(args, body):
    """The upright work states, from poses the ENGINE emitted.

    No parity check here and none needed: the gait strip mirrors two formulas in
    Python and has to prove it did not drift. The upright pose has a dozen, and
    at that size the right answer is to hand the numbers over instead of writing
    them twice — a renderer that READS the engine's own output cannot disagree
    with it at all.
    """
    if not os.path.isfile(POSE_JSON):
        raise SystemExit("render-gait-strip: missing %s — regenerate it with "
                         "WonderlandDogPose.test.cpp --golden" % POSE_JSON)
    pose = json.load(io.open(POSE_JSON, encoding="utf8"))
    works = pose["works"]
    legs = body["legRows"]
    parts = body["parts"]

    nf = len(works[0]["frames"])
    W = args.cell * nf
    H = args.cell * len(works)
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
    GROUND = (58, 48, 82)
    HIND = (150, 235, 175)     # takes the weight — must stay on the floor
    FORE = (255, 150, 120)     # leaves the ground — that is the point
    SCALE = args.cell / 780.0

    for r, w in enumerate(works):
        hind = parts[legs[0]]
        hip_x = hind["loc"][0]
        hip_z = hind["loc"][2] + hind["scale"][2] * 50.0   # top of the hind leg
        for f, fr in enumerate(w["frames"]):
            ox, oy = f * args.cell, r * args.cell
            gy = oy + int(args.cell * 0.90)
            for x in range(ox, ox + args.cell):
                put(x, gy, GROUND)
            cx = ox + args.cell // 2
            pitch = math.radians(fr["torsoPitch"])
            for i, p in enumerate(parts):
                loc, sc = p["loc"], p["scale"]
                col = COAT
                if p["mat"] == "Visor":
                    col = VISOR
                elif p["mat"] == "Eye":
                    col = EYE
                x_uu, z_uu = loc[0], loc[2]
                if i in legs:
                    li = legs.index(i)
                    z_uu += fr["legRise"][li]
                    # The pitch is drawn as a lean on the limb, which is what
                    # reads at this size; the exact hip solve is the engine's.
                    x_uu += math.sin(math.radians(fr["legPitch"][li])) * 40.0
                    col = HIND if li < 2 else FORE
                else:
                    # Everything above the hips rides the torso: rise, then
                    # rotate about the haunch so the chest comes UP and BACK.
                    z_uu += fr["torsoRise"]
                    dx, dz = x_uu - hip_x, z_uu - hip_z
                    x_uu = hip_x + dx * math.cos(pitch) - dz * math.sin(pitch)
                    z_uu = hip_z + dx * math.sin(pitch) + dz * math.cos(pitch)
                box(cx + x_uu * SCALE, gy - z_uu * SCALE,
                    max(1.0, sc[0] * 50.0 * SCALE), max(1.0, sc[2] * 50.0 * SCALE), col)

    write_png(args.out, W, H, px)
    print("render-gait-strip: %s  %dx%d  upright rows=%s (poses read from the engine)"
          % (args.out, W, H, ",".join(w["name"] for w in works)))


def render_footlock(args, body):
    """One long panel: the Dog ADVANCES, and planted paws leave fixed marks.

    The strip shows which paws are down. This shows the property that actually
    decides whether a walk reads as walking — a planted paw does not move in
    WORLD space. Drawn as a track: every frame, each planted paw stamps a dot at
    its world position. Foot lock makes those dots pile into tight clusters. A
    skate smears them into lines, and the smear is visible instantly at a glance
    in a way that "worst drift 8e-06 uu" is not.
    """
    golden = json.load(io.open(GOLDEN_JSON, encoding="utf8"))
    check_parity(golden)
    gaits = golden.get("gaits") or []
    rows = []
    for want in ("walk", "trot", "run"):
        c = [g for g in gaits if g["gait"] == want]
        if c:
            rows.append(c[len(c) // 2])

    legs = body["legRows"]
    parts = body["parts"]
    W, H = 1500, 200 * len(rows)
    px = bytearray([18, 16, 26] * (W * H))

    def put(x, y, rgb):
        if 0 <= x < W and 0 <= y < H:
            i = (y * W + x) * 3
            px[i], px[i + 1], px[i + 2] = rgb

    def box(cx, cy, hw, hh, rgb):
        for y in range(int(cy - hh), int(cy + hh) + 1):
            for x in range(int(cx - hw), int(cx + hw) + 1):
                put(x, y, rgb)

    COAT = (150, 148, 165)
    GROUND = (58, 48, 82)
    LEG_COLS = [(255, 110, 140), (110, 200, 255), (255, 210, 90), (140, 255, 160)]

    for r, g in enumerate(rows):
        stride, duty, lift = g["stride"], g["duty"], g["lift"]
        oy = r * 200
        gy = oy + 150
        for x in range(W):
            put(x, gy, GROUND)
        dog_h = max(pt["loc"][2] + pt["scale"][2] * 50.0 for pt in parts)
        SCALE = (200 * 0.62) / dog_h
        travel = (W - 260) / SCALE
        # Ghost the body every few frames so the advance is legible, and stamp
        # every planted paw at its WORLD position on every frame.
        for f in range(240):
            dist = (f / 239.0) * travel
            bx = 130 + dist * SCALE
            if f % 26 == 0:
                for i, pt in enumerate(parts):
                    if i in legs or pt["mat"] != "Body":
                        continue
                    box(bx + pt["loc"][0] * SCALE, gy - pt["loc"][2] * SCALE,
                        max(1.0, pt["scale"][0] * 50.0 * SCALE),
                        max(1.0, pt["scale"][2] * 50.0 * SCALE), COAT)
            for li in range(4):
                fwd, lft, stance = leg_pose(dist / stride + g["offsets"][li],
                                            stride, lift, duty)
                if not stance:
                    continue
                # WORLD position of the paw: body distance plus its local offset.
                wx = 130 + (dist + fwd) * SCALE
                box(wx, gy + 6 + li * 5, 1.6, 1.6, LEG_COLS[li])

    write_png(args.out, W, H, px)
    print("render-gait-strip: %s  %dx%d  footlock rows=%s "
          "(each dot is a planted paw at its WORLD position)"
          % (args.out, W, H, ",".join(g["gait"] for g in rows)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/gait-strip.png")
    ap.add_argument("--frames", type=int, default=8)
    ap.add_argument("--cell", type=int, default=210)
    ap.add_argument("--mode", choices=("gait", "upright", "footlock"), default="gait")
    args = ap.parse_args()

    for path in (BODY_JSON, GOLDEN_JSON):
        if not os.path.isfile(path):
            raise SystemExit("render-gait-strip: missing %s" % path)
    body = json.load(io.open(BODY_JSON, encoding="utf8"))
    if args.mode == "upright":
        return render_upright(args, body)
    if args.mode == "footlock":
        return render_footlock(args, body)
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
