#!/usr/bin/env python3
"""Plan view of a wedge: what stands there now (the census) and what the wedge passes would add.

    python wedge_plan.py [--u0 480] [--u1 1160] [--half 520] [--out w270_plan.png]

The seam frame of w270_rear_seam.py: u (out along bearing 270) runs UP the image, v (east, Tartarus) runs
RIGHT. One pixel per metre. Existing footprints are grey oriented rectangles; each new pass has its colour;
W270G (held until the hedge gate) is drawn in cyan so it is never mistaken for part of the applied set. The
yellow line is the NOCTIS / TARTARUS border. It exists to be LOOKED AT: a generator that places everything
it tried can still produce a layout that reads badly, and only a picture says so.
"""
import argparse
import csv
import gzip
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "Tools" / "world_audit"))
from emptiness import write_png                                    # noqa: E402

CENSUS = HERE.parent.parent / "Tools" / "captures" / "zc" / "census" / "world_census.csv.gz"
NEW = HERE / "w270_new_placements.csv.gz"
COL = {"existing": (150, 150, 150), "HN181": (150, 110, 220), "HN238": (150, 110, 220), "HT356": (215, 60, 60), "HT308": (215, 60, 60), "HI057": (235, 235, 245), "W270S": (230, 190, 70), "W270N": (150, 110, 220),
       "W270T": (215, 60, 60), "W270G": (70, 210, 230), "P165N": (150, 110, 220), "P015T": (215, 60, 60)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--u0", type=float, default=480.0)
    ap.add_argument("--u1", type=float, default=1160.0)
    ap.add_argument("--half", type=float, default=520.0)
    ap.add_argument("--out", default=str(HERE / "w270_plan.png"))
    ap.add_argument("--bearing", type=float, default=270.0)
    ap.add_argument("--new", default=str(NEW))
    a = ap.parse_args()
    W, H = int(2 * a.half), int(a.u1 - a.u0)
    px = bytearray(bytes((34, 52, 34)) * (W * H))                   # lawn

    def put(u_m, v_m, col):
        i, j = int(v_m + a.half), int(a.u1 - u_m)
        if 0 <= i < W and 0 <= j < H:
            o = (j * W + i) * 3
            px[o:o + 3] = bytes(col)

    B = math.radians(a.bearing)
    D, Lf = (math.cos(B), math.sin(B)), (-math.sin(B), math.cos(B))

    def frame(x, y):
        return (x * D[0] + y * D[1]) / 100.0, (x * Lf[0] + y * Lf[1]) / 100.0

    def rect(x, y, hx, hy, yaw, col):
        u, v = frame(x, y)                                          # world -> seam frame, metres
        hx, hy = max(hx / 100.0, 0.5), max(hy / 100.0, 0.5)
        t = math.radians(yaw - a.bearing)                          # the piece's long axis in the seam frame
        du, dv = math.cos(t), math.sin(t)
        r = math.hypot(hx, hy)
        for uu in range(int(u - r), int(u + r) + 1):
            for vv in range(int(v - r), int(v + r) + 1):
                lu, lv = uu - u, vv - v
                a1 = lu * du + lv * dv
                a2 = -lu * dv + lv * du
                if abs(a1) <= hx and abs(a2) <= hy:
                    put(uu, vv, col)

    with gzip.open(CENSUS, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["kind"] == "OTHER" or "Grass_Tuft" in r["mesh"]:
                continue
            x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
            if z < -50000.0 or z > 6000.0:
                continue
            u, v = frame(x, y)
            if not (a.u0 - 50 <= u <= a.u1 + 50 and abs(v) <= a.half + 50):
                continue
            ex, ey = float(r["ex"]), float(r["ey"])
            if max(ex, ey) > 5000.0 and float(r["ez"]) < 300.0:
                continue
            col = (95, 130, 95) if "canopy" in r["mesh"] else COL["existing"]
            rect(x, y, ex, ey, float(r["yaw"]), col)
    if Path(a.new).exists():
        with gzip.open(a.new, "rt", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                rect(float(r["x"]), float(r["y"]), float(r["ex"]), float(r["ey"]), a.bearing,
                     COL.get(r["owner"], (255, 255, 255)))
    for uu in range(int(a.u0), int(a.u1)):                          # the nation border, and 100 m rings
        put(uu, 0.0, (250, 220, 60)) if uu % 6 < 3 else None
    for rr in range(500, 1201, 100):
        for k in range(-60, 61):
            t = math.radians(k * 0.5)
            put(rr * math.cos(t), rr * math.sin(t), (70, 90, 140))
    write_png(a.out, W, H, px)
    print("wrote", a.out, W, "x", H)


if __name__ == "__main__":
    main()
