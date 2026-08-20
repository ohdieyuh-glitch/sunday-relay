#!/usr/bin/env python3
"""Read a hero frame and report what can be MEASURED about it.

Prints `key=value` lines for a shell caller and exits 0 whether the frame is
good or bad — the verdict is in the output, not the exit code, because the
proof report needs to record a black frame as a FAIL rather than crash on it.

WHAT THIS CANNOT DO, stated here because the temptation is constant: it cannot
tell you the frame looks good. Luma and variance separate "the renderer drew
something" from "the renderer drew nothing". They say nothing about whether
Wonderland resembles the reference, and a frame can be perfectly structured and
still be ugly, mis-composed or the wrong scene entirely. The visual target is
PROVEN only by a person looking at the PNG.

Pure stdlib: no PIL, no numpy. Runs on the Studio and on a laptop.
"""
import os
import struct
import sys
import zlib


def read_png(path):
    """Decode enough of a PNG to sample it. Returns (w, h, channels, rows)."""
    data = open(path, "rb").read()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("not a PNG")
    i, w, h, bit, ctype, idat = 8, 0, 0, 0, 0, b""
    while i + 8 <= len(data):
        ln = struct.unpack(">I", data[i:i + 4])[0]
        typ = data[i + 4:i + 8]
        if typ == b"IHDR":
            w, h, bit, ctype = struct.unpack(">IIBB", data[i + 8:i + 18])
        elif typ == b"IDAT":
            idat += data[i + 8:i + 8 + ln]
        elif typ == b"IEND":
            break
        i += 12 + ln
    if not w or not h:
        raise ValueError("no IHDR")
    if bit != 8:
        raise ValueError("only 8-bit PNGs are supported, got %d" % bit)
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(ctype)
    if ch is None:
        raise ValueError("unsupported colour type %d" % ctype)
    raw = zlib.decompress(idat)
    stride = w * ch
    rows, prev, pos = [], bytearray(stride), 0
    for _y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos + stride]); pos += stride
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(bytes(line))
        prev = line
    return w, h, ch, rows


def main():
    if len(sys.argv) < 2:
        print("frame=missing")
        print("verdict=UNVERIFIED")
        print("note=no frame path given")
        return 0
    path = sys.argv[1]
    if not os.path.isfile(path):
        print("frame=%s" % path)
        print("verdict=UNVERIFIED")
        print("note=no such file")
        return 0
    print("frame=%s" % path)
    print("bytes=%d" % os.path.getsize(path))
    try:
        w, h, ch, rows = read_png(path)
    except Exception as e:
        print("verdict=FAIL")
        print("note=unreadable: %s" % e)
        return 0
    print("width=%d" % w)
    print("height=%d" % h)

    # Sample rather than sum every pixel: a 1080p frame is two million samples
    # and the answer does not need them.
    vals, colours = [], set()
    step_y = max(1, h // 120)
    step_x = max(1, w // 160)
    for y in range(0, h, step_y):
        row = rows[y]
        for x in range(0, w, step_x):
            o = x * ch
            r, g, b = row[o], row[o + 1] if ch >= 3 else row[o], row[o + 2] if ch >= 3 else row[o]
            vals.append((r * 299 + g * 587 + b * 114) // 1000)
            colours.add((r >> 3, g >> 3, b >> 3))
    n = max(1, len(vals))
    mean = sum(vals) / n
    sd = (sum((v - mean) ** 2 for v in vals) / n) ** 0.5
    print("luma_mean=%.1f" % mean)
    print("luma_sd=%.1f" % sd)
    print("distinct_colours=%d" % len(colours))

    # Three ways a stream fails that all look identical from the outside.
    if mean < 4.0:
        print("verdict=FAIL")
        print("note=black frame - the stream connected but nothing rendered")
    elif sd < 6.0:
        print("verdict=FAIL")
        print("note=flat frame - one colour; renderer up, drawing nothing")
    elif len(colours) < 24:
        print("verdict=FAIL")
        print("note=only %d distinct colours - looks like a UI or error card, "
              "not a rendered world" % len(colours))
    else:
        print("verdict=STRUCTURED")
        print("note=the frame carries real image structure. This is NOT a "
              "judgement that it looks correct - that needs a human eye.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
