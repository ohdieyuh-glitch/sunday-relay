#!/usr/bin/env python3
"""What each camera's NEAR FIELD actually contains, before a frame is spent.

    python3 wonderland/v2/tools/camera_framing.py [--json out.json]

A camera does not see the ground in front of its feet. Its frame's lower edge
leaves the lens at (pitch - vfov/2) and meets the ground at

    d_near = eye_z / tan(-(pitch - vfov/2))

and everything nearer than that is UNDER THE LENS -- present in the world,
absent from the picture. PASS 09 and PASS 10 both placed foreground planting
to cure a bare-looking frame and both put it inside d_near, so two passes of
work were invisible for exactly the reason the problem was:

    RearWorldCam10   eye 3.20 m  pitch -3  ->  d_near 5.0 m; planting at 2.2 m
    FlankLeftCam08   eye 2.65 m  pitch -4  ->  d_near 4.0 m; planting at 3.5 m

"Near the camera" and "in the near field of the frame" are different things,
and the second one is arithmetic on numbers that already sit in v2_config.
This prints, per camera: where its picture of the ground begins, and how many
placements stand in the band from there to three times it -- the stretch that
fills the bottom third of a frame and reads as foreground.

It is a REPORT, not a gate. A camera with an empty near field is sometimes
right (HeroCam0 opens onto a plaza on purpose). It is a question worth being
asked before a capture rather than after.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "infra", "build", "hd"))
os.environ.setdefault("WLV2_PASS02", "1")
os.environ.setdefault("WLV2_PASS03", "1")

import v2_config as C          # noqa: E402
import layout_v2 as LAYOUT     # noqa: E402

ASPECT = float(os.environ.get("WL_ASPECT", 16.0 / 9.0))


def report():
    rows = []
    for cam in C.HERO_CAMS:
        x, y, z = cam["location"]
        pitch, yaw = cam["rotation"][0], cam["rotation"][1]
        hfov = math.radians(float(cam["fov"]))
        vfov = 2.0 * math.atan(math.tan(hfov / 2.0) / ASPECT)
        lower = math.radians(pitch) - vfov / 2.0
        if lower >= -1e-6:                      # level or looking up: no ground edge
            rows.append({"name": cam["name"], "d_near_m": None, "near": 0, "note": "looks level or up"})
            continue
        d_near = z / math.tan(-lower)           # uu
        d_far = d_near * 3.0
        fwd = (math.cos(math.radians(yaw)), math.sin(math.radians(yaw)))
        half = hfov / 2.0
        n_near, n_under = 0, 0
        for p in LAYOUT.ALL:
            dx, dy = p["pos"][0] - x, p["pos"][1] - y
            along = dx * fwd[0] + dy * fwd[1]
            if along <= 0:
                continue
            across = abs(-dx * fwd[1] + dy * fwd[0])
            if across > along * math.tan(half):
                continue
            if along < d_near:
                n_under += 1
            elif along <= d_far:
                n_near += 1
        rows.append({"name": cam["name"], "d_near_m": d_near / 100.0,
                     "d_far_m": d_far / 100.0, "near": n_near, "under": n_under,
                     "eye_m": z / 100.0, "pitch": pitch, "fov": cam["fov"]})
    return rows


def main():
    rows = report()
    print("%-26s %6s %6s %8s %8s   %6s %6s" %
          ("camera", "eye m", "pitch", "sees>=m", "band m", "in", "under"))
    print("-" * 76)
    for r in rows:
        if r.get("d_near_m") is None:
            print("%-26s %6s %6s %8s %8s   %6s %6s" % (r["name"], "-", "-", "-", r["note"], "-", "-"))
            continue
        flag = "  <-- EMPTY NEAR FIELD" if r["near"] == 0 else ""
        print("%-26s %6.2f %6.0f %8.1f %8.1f   %6d %6d%s" %
              (r["name"], r["eye_m"], r["pitch"], r["d_near_m"], r["d_far_m"],
               r["near"], r["under"], flag))
    print("\n'under' counts placements nearer than the frame's lower edge: present in")
    print("the world, absent from the picture. A high 'under' with a low 'in' is")
    print("foreground work that will not appear.")
    for a in sys.argv[1:]:
        if a.startswith("--json="):
            with open(a.split("=", 1)[1], "w") as fh:
                json.dump(rows, fh, indent=1)


if __name__ == "__main__":
    main()
