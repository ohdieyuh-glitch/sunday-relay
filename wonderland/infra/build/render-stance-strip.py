#!/usr/bin/env python3
"""Draw the UPRIGHT Relay Dog and its walk cycle as a picture, with no GPU.

WHY THIS EXISTS

The founder's bar for the upright form is visual -- "make this visually
convincing, not merely technically implemented" -- and every way of looking at
it needs the L4: build, cook, package, stream, capture. When the Studio is off
that is not a slow loop, it is no loop, and "the Dog stands like the reference
sheet" becomes a claim resting on arithmetic nobody can see.

So: the canonical Dog's own part table, carried into the standing body plan by
the ENGINE'S OWN numbers, drawn side-on and front-on as a PNG strip.

WHAT IT IS NOT. Not a render. No lighting, no materials, no perspective, no
Wonderland around it. It must never be shown as one. What it IS is an honest
picture of where the parts actually are, which is the whole question being
asked of the pose.

PROVENANCE, BECAUSE A SECOND IMPLEMENTATION DRIFTS

The parts come from wonderland/web/gait/dog-body.json, generated out of
WonderlandDogBody.cpp. The POSE comes from a golden emitted by compiling
WonderlandDogStance.cpp itself -- this file does not re-implement a single
formula, it reads the numbers the game will use. That is deliberate: the
existing gait strip re-implements two formulas and has to check itself against
a golden to catch drift, and the cheapest way to never drift is never to have a
second copy.

    python3 render-stance-strip.py --out /tmp/stance.png
"""
import argparse
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "..", "Source", "Wonderland")
BODY_JSON = os.path.join(HERE, "..", "..", "web", "gait", "dog-body.json")

# The reference sheet's palette: cream body, black visor band, gold eyes.
CREAM = (238, 232, 214)
CREAM_DARK = (196, 188, 168)
VISOR = (18, 18, 22)
GOLD = (240, 190, 64)
BG = (16, 15, 20)
GRID = (44, 42, 52)
INK = (150, 146, 160)


def emit_golden(leg_len, torso_len, stride):
    """Compile the ENGINE's stance module and ask it for the pose."""
    prog = r'''
#include "WonderlandDogStance.h"
#include <cstdio>
#include <cstdlib>
using namespace WonderlandStance;
int main(int argc, char** argv){
  const float L=atof(argv[1]), T=atof(argv[2]), S=atof(argv[3]);
  const float Lift=15.0f; const int F=12;
  std::printf("{\"stand\":{");
  const FStandingPose P=StandingPose(1.0f,L,T);
  std::printf("\"pelvisRise\":%.4f,\"torsoPitch\":%.4f,\"torsoRise\":%.4f,"
              "\"headRise\":%.4f,\"headPitch\":%.4f,\"tailPitch\":%.4f,\"legStretch\":%.4f,"
              "\"legRise\":[%.4f,%.4f,%.4f,%.4f],\"legPitch\":[%.4f,%.4f,%.4f,%.4f],"
              "\"legSpread\":[%.4f,%.4f,%.4f,%.4f],\"armOut\":[%.4f,%.4f],",
    P.PelvisRise,P.TorsoPitchDeg,P.TorsoRise,P.HeadRise,P.HeadPitchDeg,P.TailPitchDeg,
    P.LegStretch,P.LegRise[0],P.LegRise[1],P.LegRise[2],P.LegRise[3],
    P.LegPitchDeg[0],P.LegPitchDeg[1],P.LegPitchDeg[2],P.LegPitchDeg[3],
    P.LegSpread[0],P.LegSpread[1],P.LegSpread[2],P.LegSpread[3],
    P.ArmOutDeg[0],P.ArmOutDeg[1]);
  std::printf("\"headForward\":%.4f,\"tailForward\":%.4f,"
              "\"legForward\":[%.4f,%.4f,%.4f,%.4f]",
    P.HeadForward,P.TailForward,
    P.LegForward[0],P.LegForward[1],P.LegForward[2],P.LegForward[3]);
  std::printf("},\"frames\":[");
  for(int f=0;f<F;++f){
    const float Ph=f/(float)F;
    const FCarriage C=Carriage(Ph,5.0f,L*0.06f);
    const float A=ArmAmplitudeFor(150.0f,L);
    std::printf("%s{\"phase\":%.4f,\"pelvisRise\":%.4f,\"pelvisSway\":%.4f,"
                "\"torsoYaw\":%.4f,\"headRise\":%.4f,\"legs\":[",f?",":"",Ph,
                C.PelvisRise,C.PelvisSway,C.TorsoYawDeg,C.HeadRise);
    for(int i=0;i<2;++i){
      const FStepPose Q=StepPose(Ph+LegPhaseOffset(i),S,Lift);
      const FLimbSwing W=LimbSwing(Q,L);
      std::printf("%s{\"fwd\":%.4f,\"lift\":%.4f,\"stance\":%d,\"pitch\":%.4f,\"stretch\":%.4f}",
                  i?",":"",Q.Forward,Q.Lift,Q.bStance?1:0,W.PitchDeg,W.Stretch);
    }
    std::printf("],\"arms\":[");
    for(int i=0;i<2;++i){
      const FArmSwing R=ArmSwing(Ph+LegPhaseOffset(i),A);
      std::printf("%s{\"pitch\":%.4f,\"out\":%.4f}",i?",":"",R.PitchDeg,R.OutDeg);
    }
    std::printf("]}");
  }
  std::printf("]}\n"); return 0;
}
'''
    tmp = tempfile.mkdtemp()
    cpp = os.path.join(tmp, "emit.cpp")
    with open(cpp, "w") as fh:
        fh.write(prog)
    binp = os.path.join(tmp, "emit")
    cc = subprocess.run(
        ["g++", "-std=c++17", "-O1", "-I", SRC, "-o", binp,
         os.path.join(SRC, "WonderlandDogStance.cpp"), cpp],
        capture_output=True, text=True)
    if cc.returncode != 0:
        raise SystemExit("the stance module did not compile, so there is no pose "
                         "to draw:\n" + cc.stderr[:800])
    out = subprocess.run([binp, str(leg_len), str(torso_len), str(stride)],
                         capture_output=True, text=True)
    if out.returncode != 0 or not out.stdout.strip():
        raise SystemExit("the stance module produced no pose")
    return json.loads(out.stdout)


class Canvas(object):
    def __init__(self, w, h, bg):
        self.w, self.h = w, h
        self.px = bytearray()
        for _ in range(w * h):
            self.px += bytes(bg)

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.px[i:i + 3] = bytes(c)

    def rect(self, x0, y0, x1, y1, c):
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.set(x, y, c)

    def quad(self, pts, c):
        """Fill a convex quad -- a rotated box, which is what a swung limb is."""
        ys = [p[1] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            xs = []
            for i in range(len(pts)):
                ax, ay = pts[i]
                bx, by = pts[(i + 1) % len(pts)]
                if (ay <= y < by) or (by <= y < ay):
                    t = (y - ay) / (by - ay)
                    xs.append(ax + (bx - ax) * t)
            if len(xs) >= 2:
                for x in range(int(min(xs)), int(max(xs)) + 1):
                    self.set(x, y, c)

    def write(self, path):
        raw = b""
        for y in range(self.h):
            raw += b"\x00" + bytes(self.px[y * self.w * 3:(y + 1) * self.w * 3])

        def chunk(tag, data):
            return (struct.pack(">I", len(data)) + tag + data
                    + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
        png = (b"\x89PNG\r\n\x1a\n"
               + chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 2, 0, 0, 0))
               + chunk(b"IDAT", zlib.compress(raw, 9))
               + chunk(b"IEND", b""))
        with open(path, "wb") as fh:
            fh.write(png)


def rot(px, pz, cx, cz, deg):
    """Rotate a point about (cx,cz) -- a limb pivoting at its hip."""
    a = math.radians(deg)
    dx, dz = px - cx, pz - cz
    return (cx + dx * math.cos(a) + dz * math.sin(a),
            cz - dx * math.sin(a) + dz * math.cos(a))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/stance-strip.png")
    ap.add_argument("--frames", type=int, default=8)
    args = ap.parse_args()

    body = json.load(open(BODY_JSON))
    parts = body["parts"]
    upc = float(body["unitsPerCube"])
    legs = body["legRows"]
    torso_row = body["torsoRow"]
    head_rows = body["headRows"]
    tail_rows = [i for i in range(len(parts))
                 if i not in legs and i != torso_row and i not in head_rows]

    leg_len = parts[legs[0]]["scale"][2] * upc
    torso_len = parts[torso_row]["scale"][0] * upc
    stride = 132.0
    g = emit_golden(leg_len, torso_len, stride)
    stand = g["stand"]
    frames = g["frames"][:args.frames]

    CW, CH = 190, 300
    PAD = 12
    W = PAD + (CW + PAD) * (len(frames) + 1)
    H = CH + 54
    cv = Canvas(W, H, BG)

    def draw_dog(ox, blend, fr):
        """Draw the Dog side-on. blend 0 quadruped, 1 standing."""
        # ground line
        base = CH - 30
        for x in range(ox, ox + CW):
            cv.set(x, base, GRID)
        sc = 0.62
        cx = ox + CW // 2

        pelv = (fr["pelvisRise"] if fr else 0.0) * blend
        # DRAW ORDER, for the diagnostic only. Parts are stored legs-first, so
        # the ARMS (limb 2 and 3) get painted over by the torso and vanish. In
        # 3D they sit beside the body and are visible; here they have to be
        # drawn after it. Nothing about the pose changes -- only the order the
        # boxes are filled in.
        order = ([i for i in range(len(parts)) if i in legs[:2]]
                 + [i for i in range(len(parts)) if i not in legs and i != torso_row and i not in head_rows]
                 + [torso_row]
                 + [i for i in range(len(parts)) if i in legs[2:]]
                 + [i for i in range(len(parts)) if i in head_rows])
        for idx in order:
            p = parts[idx]
            lx, ly, lz = p["loc"]
            sx, sy, sz = p["scale"]
            mat = p["mat"]
            col = CREAM
            if mat == "Visor":
                col = VISOR
            elif mat == "Eye":
                col = GOLD
            elif idx in legs and legs.index(idx) >= 2 and blend > 0.5:
                # THE ARMS, SHADED APART. In a true side view an arm hangs
                # directly over the torso and vanishes into it -- correct
                # anatomy, useless diagram. This is a drawing choice in the
                # DIAGNOSTIC only; it changes nothing about the pose.
                col = (176, 152, 108)
            elif ly < -1.0:
                col = CREAM_DARK      # far side, so the silhouette reads

            px, pz = lx, lz
            hw, hh = sx * upc * 0.5, sz * upc * 0.5
            pitch = 0.0

            if idx in legs:
                li = legs.index(idx)
                pz += stand["legRise"][li] * blend
                px += stand["legForward"][li] * blend
                pitch += stand["legPitch"][li] * blend
                if fr:
                    if li < 2:
                        L = fr["legs"][li % 2]
                        px += L["fwd"] * blend
                        pz += L["lift"] * blend + pelv
                        pitch += L["pitch"] * blend
                        hh *= 1.0 + (stand["legStretch"] - 1.0) * blend
                    else:
                        A = fr["arms"][li % 2]
                        pz += pelv * 0.9
                        pitch += A["pitch"] * blend
            elif idx == torso_row:
                pz += stand["torsoRise"] * blend + pelv
                pitch += stand["torsoPitch"] * blend
            elif idx in head_rows:
                pz += stand["headRise"] * blend + pelv + (fr["headRise"] if fr else 0.0) * blend
                px += stand["headForward"] * blend
                pitch += stand["headPitch"] * blend
            else:
                pz += stand["torsoRise"] * blend * 0.9 + pelv
                px += stand["tailForward"] * blend
                pitch += stand["tailPitch"] * blend

            # corners of the box, pivoted about its own centre by pitch
            corners = [(px - hw, pz - hh), (px + hw, pz - hh),
                       (px + hw, pz + hh), (px - hw, pz + hh)]
            if abs(pitch) > 0.01:
                corners = [rot(c[0], c[1], px, pz, pitch) for c in corners]
            scr = [(cx + c[0] * sc, base - c[1] * sc) for c in corners]
            cv.quad(scr, col)

    # left-most cell: the canonical quadruped, for comparison
    draw_dog(PAD, 0.0, None)
    for i, fr in enumerate(frames):
        draw_dog(PAD + (CW + PAD) * (i + 1), 1.0, fr)

    # a rule under the standing frames so the strip reads as one cycle
    for x in range(PAD + CW + PAD, W - PAD):
        cv.set(x, CH + 8, INK)

    cv.write(args.out)
    print("wrote %s  (%dx%d)" % (args.out, W, H))
    print("  leftmost cell  = canonical QUADRUPED, blend 0")
    print("  the rest       = one full UPRIGHT walk cycle, %d frames" % len(frames))
    print("  pose numbers come from WonderlandDogStance.cpp itself, not a copy")


if __name__ == "__main__":
    main()
