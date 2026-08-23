#!/usr/bin/env python3
"""Name the objects that the black regions of a delivered frame belong to.

The founder's first complaint about the arrival frame is giant black/dead
regions, and the instruction is explicit: find the actual cause of each one and
fix the correct layer -- not hide it with fog, exposure, bloom or saturation.
That requires knowing WHICH objects are dark, and neither the streamed frame
(which has pixels but no identities) nor the offline rasteriser (which has
identities but no lighting) can say on its own.

This joins them. The offline preview projects the real geometry through the
real hero camera and knows which object owns every pixel. The capture is the
same camera on the GPU. Resample the capture onto the preview's grid and each
dark pixel gets a name.

    python3 attribute-dark.py <capture.png> [--threshold 0.14]

Needs ffmpeg to decode. No PIL, no engine, no GPU.

A caveat the output repeats, because it decides what the fix is: the two images
come from the same camera but not the same build, and a blob's projected extent
is not its silhouette. Treat the ranking as a direction to look, and confirm in
the capture before editing anything.
"""
import collections
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PREVIEW = os.path.join(HERE, "verify-hero-composition.py")


def decode(path, w, h):
    """Capture -> raw RGB on the preview's grid, via ffmpeg."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=%d:%d" % (w, h),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if out.returncode != 0 or len(out.stdout) != w * h * 3:
        raise SystemExit("ffmpeg could not decode %s: %s"
                         % (path, out.stderr.decode("utf8", "replace")[:400]))
    return out.stdout


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    cap = argv[0]
    thr = 0.14
    if "--threshold" in argv:
        thr = float(argv[argv.index("--threshold") + 1])
    if not os.path.exists(cap):
        raise SystemExit("no such capture: %s" % cap)

    with tempfile.TemporaryDirectory() as td:
        own_path = os.path.join(td, "owner.json")
        env = dict(os.environ, WL_DUMP_OWNER=own_path)
        proc = subprocess.run([sys.executable, PREVIEW], env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if not os.path.exists(own_path):
            print(proc.stdout.decode("utf8", "replace")[-1500:])
            raise SystemExit("the offline preview produced no owner buffer")
        with open(own_path, encoding="utf8") as fh:
            od = json.load(fh)

    w, h, owner, blobs = od["w"], od["h"], od["owner"], od["blobs"]
    px = decode(cap, w, h)

    # Luma on the same convention the palette classifier uses.
    dark_by_label = collections.Counter()
    dark_by_mat = collections.Counter()
    total_by_label = collections.Counter()
    dark_sky = 0
    dark_total = 0
    for k in range(w * h):
        i = k * 3
        y = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255.0
        o = owner[k]
        if o >= 0:
            total_by_label[blobs[o]["label"]] += 1
        if y >= thr:
            continue
        dark_total += 1
        if o < 0:
            dark_sky += 1
        else:
            dark_by_label[blobs[o]["label"]] += 1
            dark_by_mat[blobs[o]["mat"]] += 1

    npx = float(w * h)
    print("capture      %s" % os.path.basename(cap))
    print("dark below   luma %.2f" % thr)
    print("DARK PIXELS  %.1f%% of the frame" % (100.0 * dark_total / npx))
    print("  of which %.1f%% of the frame is dark SKY (no geometry owns it)"
          % (100.0 * dark_sky / npx))
    print()
    print("DARK BY MATERIAL  (the file to open)")
    for mat, n in dark_by_mat.most_common(12):
        print("  %-24s %6.2f%% of frame" % (mat, 100.0 * n / npx))
    print()
    print("DARKEST OBJECTS  (share = how much of THAT object is dark)")
    rows = []
    for lb, n in dark_by_label.items():
        tot = total_by_label[lb]
        if tot >= 60:                     # ignore slivers: a ratio on 6 px is noise
            rows.append((n / npx, n / float(tot), lb, tot))
    rows.sort(reverse=True)
    for frac, share, lb, tot in rows[:16]:
        print("  %-28s %5.2f%% of frame   %3.0f%% of the object is dark"
              % (lb, 100.0 * frac, 100.0 * share))
    print()
    print("NOTE  capture and preview share a camera, not a build, and a blob's")
    print("      projected extent is not its silhouette. This is a direction to")
    print("      look; confirm in the capture before editing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
