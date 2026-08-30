#!/usr/bin/env python3
"""Audit a traversal video the way a player experiences it: frame by frame.

    ffmpeg -i explore.mp4 -vf signalstats,metadata=print:file=sig.txt -f null -
    python3 wonderland/v2/tools/walk_audit.py sig.txt --fps=12

A contact sheet from locked cameras proves the world composes. It cannot prove
the walk is any good -- the founder's list is about what happens BETWEEN the
camera stations: regions too dark to read, ivory blown out, foliage swallowing
the lens, dead stretches where nothing changes.

Those are measurable over a continuous take, and this reads ffmpeg's
signalstats -- per-frame luma mean, min, max and spread -- against the same
route timeline the performance split uses, so a finding lands in a PLACE.

WHAT IT LOOKS FOR, and why each is a real defect rather than a number:

  TOO DARK    a stretch whose luma sits under the readable floor. The founder's
              first quality priority was foliage collapsing to black, and a
              still from a locked camera cannot find the stretch of road that
              does it.
  BLOWN       ivory clipping at the top of the range. This world is cream and
              gold; when it clips it stops being a material and becomes a hole.
  FLAT        near-zero spread across a run of frames -- the lens is inside
              something. Two captures have already been lost to a camera in a
              bush, and at walking speed that reads as the world going away.
  DEAD        a long run with almost no change frame to frame: nothing entered
              or left the view. Not a bug on its own, and exactly what "paths
              that mathematically connect but feel pointless" looks like.
"""
import os, re, sys

SEGMENTS = [
    ("idle at spawn",   0,   9), ("arrival gate",    9,  28),
    ("plaza crossing", 28,  50), ("fountain court", 50,  64),
    ("castle approach",64,  88), ("garden quarter", 88, 161),
    ("mushroom wood", 161, 210), ("clock quarter", 210, 305),
    ("hamlet",        305, 403),
]
DARK, BLOWN, FLAT, DEAD = 42.0, 0.006, 8.0, 0.6   # luma 0-255; see notes below


def parse(path):
    """ffmpeg metadata=print output -> one dict per frame."""
    frames, cur = [], None
    key = re.compile(r"lavfi\.signalstats\.(\w+)=([-\d.eE]+)")
    for line in open(path):
        if line.startswith("frame:"):
            if cur:
                frames.append(cur)
            cur = {}
        m = key.search(line)
        if m and cur is not None:
            cur[m.group(1)] = float(m.group(2))
    if cur:
        frames.append(cur)
    return frames


def runs(flags, fps, minimum=1.0):
    """Contiguous stretches where a flag holds, at least `minimum` seconds."""
    out, start = [], None
    for i, f in enumerate(flags):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if (i - start) / fps >= minimum:
                out.append((start / fps, i / fps))
            start = None
    if start is not None and (len(flags) - start) / fps >= minimum:
        out.append((start / fps, len(flags) / fps))
    return out


def main():
    path = sys.argv[1]
    fps = float(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--fps=")), 12))
    fr = parse(path)
    if not fr:
        print("no signalstats frames in %s" % path)
        return 1
    y = [f.get("YAVG", 0.0) for f in fr]
    hi = [f.get("YHIGH", f.get("YMAX", 0.0)) for f in fr]
    lo = [f.get("YLOW", f.get("YMIN", 0.0)) for f in fr]
    spread = [h - l for h, l in zip(hi, lo)]
    # frame-to-frame change: how much the view is actually moving
    delta = [0.0] + [abs(y[i] - y[i - 1]) for i in range(1, len(y))]

    print("WALK AUDIT -- %d frames at %.0f fps (%.0f s of traversal)"
          % (len(fr), fps, len(fr) / fps))
    print("luma is 0-255 on the delivered frame, after the stream's encode.\n")
    print("%-18s %7s %7s %7s %7s %7s" % ("segment", "frames", "luma", "p5", "p95", "spread"))
    print("-" * 62)
    for (label, a, b) in SEGMENTS:
        i0, i1 = int(a * fps), min(len(fr), int(b * fps))
        seg = y[i0:i1]
        if not seg:
            print("%-18s %7d   (not filmed)" % (label, 0))
            continue
        s = sorted(seg)
        sp = sorted(spread[i0:i1])
        print("%-18s %7d %7.1f %7.1f %7.1f %7.1f"
              % (label, len(seg), s[len(s) // 2], s[int(len(s) * 0.05)],
                 s[int(len(s) * 0.95)], sp[len(sp) // 2]))

    def report(name, flags, note, minimum=1.0):
        rs = runs(flags, fps, minimum)
        print("\n%s: %d stretch(es)%s" % (name, len(rs), "" if rs else " -- none"))
        if rs:
            print("  (%s)" % note)
        for (a, b) in sorted(rs, key=lambda r: r[0] - r[1])[:8]:
            where = next((l for (l, s0, s1) in SEGMENTS if s0 <= a < s1), "?")
            print("    %6.1f s .. %6.1f s  (%4.1f s)  in %s" % (a, b, b - a, where))

    report("TOO DARK", [v < DARK for v in y],
           "luma under %.0f: the founder's first priority was foliage going black" % DARK)
    # YHIGH is the 90th-percentile luma; clipping shows as it pinning near 255.
    report("BLOWN IVORY", [h >= 252.0 for h in hi],
           "the top of the range pinned: cream stops being a material")
    report("FLAT / LENS BLOCKED", [s < FLAT for s in spread],
           "almost no tonal range in frame -- the camera is inside something")
    report("DEAD VIEW", [d < DEAD for d in delta],
           "nothing entering or leaving the view for seconds at a time", minimum=4.0)
    print("\nwhole walk: luma median %.1f, darkest frame %.1f, brightest %.1f"
          % (sorted(y)[len(y) // 2], min(y), max(y)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
