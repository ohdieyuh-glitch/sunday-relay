"""Top-down plan of the wild ring (R50) over the world census -> plans/wild_ring_plan.png.

North (+Y) up, like Tools/world_audit's emptiness maps; 2 m a pixel, +/-1,600 m. Grey = everything the census
holds; the woods in their nation's colour (white ICARUS, purple NOCTIS, red TARTARUS; trunks and landmark
mushrooms drawn larger); the trails yellow; Dubel's path radius (the curve the trails are routed to follow)
faint olive; the ring's two edges dotted.

    python wild_ring_plan.py
"""
import csv
import gzip
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT / "Tools" / "world_audit"))
sys.path.insert(0, str(HERE))
from emptiness import write_png  # noqa: E402
import wild_ring  # noqa: E402

N, SCALE = 1600, 200.0
COL = {"ICARUS": (245, 245, 250), "NOCTIS": (170, 120, 240), "TARTARUS": (235, 70, 60)}


def main():
    px = bytearray(bytes((24, 38, 24)) * (N * N))

    def put(x, y, col, r=0):
        i, j = int(N / 2 + x / SCALE), int(N / 2 - y / SCALE)
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                a, b = i + di, j + dj
                if 0 <= a < N and 0 <= b < N:
                    o = (b * N + a) * 3
                    px[o:o + 3] = bytes(col)

    with gzip.open(wild_ring.W.CENSUS, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["kind"] not in ("ISM", "SMA") or not (-50000.0 <= float(r["z"]) <= 6000.0):
                continue
            put(float(r["x"]), float(r["y"]), (120, 120, 120))
    for k in range(0, 3600):
        b = k / 10.0
        rr = wild_ring.trail_r(b)
        put(rr * math.cos(math.radians(b)), rr * math.sin(math.radians(b)), (90, 110, 50))
    for rr in (wild_ring.R_IN, wild_ring.R_OUT):
        for k in range(0, 3600, 3):
            t = math.radians(k / 10.0)
            put(rr * math.cos(t), rr * math.sin(t), (70, 90, 70))
    for fn in sorted(HERE.glob("w[int]*_*_wood.json")):
        nation = fn.stem.split("_")[1].upper()
        for b in json.loads(fn.read_text(encoding="utf-8"))["batches"]:
            big = "Trunk" in b["id"] or "Landmark" in b["id"]
            for i in b["instances"]:
                put(i[0], i[1], COL[nation], 1 if big else 0)
    for fn in sorted(HERE.glob("w[int]*_walk.json")):
        for x, y in json.loads(fn.read_text(encoding="utf-8"))["walk"]:
            put(x, y, (250, 210, 60))
    out = HERE / "plans" / "wild_ring_plan.png"
    write_png(str(out), N, N, px)
    print(out)


if __name__ == "__main__":
    main()
