#!/usr/bin/env python3
"""Measure a rendered frame the same way every time, and against the reference.

WHY THIS EXISTS

"Does it look like the founder reference" is not reducible to numbers, and this
script does not pretend otherwise. But several of the ways it FAILS to look like
the reference are measurable, and they were being argued about instead:

  * the first native render of this world came back with 44% of the frame above
    luma 224 and 8.15% of it PURE WHITE, which is the "no blown-out white/gold"
    the art direction forbids by name;
  * 0.06% of it was below luma 18 — no shadows anywhere;
  * the SKY BAND was darker than the GROUND BAND, which does not happen
    outdoors in daylight and is the single loudest wrong note in the picture.

None of those are opinions and none of them need a person to look. What a
person is still needed for is everything else.

    python3 measure-render.py frame.png [reference.png]

With a second image it prints both columns and the gap, so a pass can be
ranked by how much it closed. Reads PNG only, by design: a JPEG has been
requantised and its histogram is not the render's.
"""
import io
import os
import struct
import sys
import zlib


def read_png(path):
    d = io.open(path, "rb").read()
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("%s is not a PNG (convert with ffmpeg first; a JPEG's "
                         "histogram is the codec's, not the render's)" % path)
    pos, w, h, bd, ct, idat = 8, None, None, None, None, b""
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos + 4])[0]
        typ, data = d[pos + 4:pos + 8], d[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, bd, ct = struct.unpack(">IIBB", data[:10])
        elif typ == b"IDAT":
            idat += data
        pos += 12 + ln
    if bd != 8 or ct not in (2, 6):
        raise SystemExit("%s: only 8-bit RGB/RGBA is handled (bit depth %s, "
                         "colour type %s)" % (path, bd, ct))
    bpp = 3 if ct == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    px = bytearray(w * h * bpp)
    prev = bytearray(stride)
    o = 0
    for y in range(h):
        f = raw[o]; o += 1
        line = bytearray(raw[o:o + stride]); o += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        px[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bpp, px


def measure(path, step=3):
    w, h, bpp, px = read_png(path)
    n = 0
    lum = sat = 0.0
    blown = dark = 0
    sky_l = grd_l = 0.0
    sky_n = grd_n = 0
    hist = [0] * 16
    for y in range(0, h, step):
        band_sky = y < h * 0.28
        band_grd = y > h * 0.72
        for x in range(0, w, step):
            i = (y * w + x) * bpp
            r, g, b = px[i], px[i + 1], px[i + 2]
            l = 0.2126 * r + 0.7152 * g + 0.0722 * b
            mx, mn = max(r, g, b), min(r, g, b)
            lum += l
            sat += 0.0 if mx == 0 else (mx - mn) / float(mx)
            hist[min(15, int(l) // 16)] += 1
            if r > 250 and g > 250 and b > 250:
                blown += 1
            if l < 18:
                dark += 1
            if band_sky:
                sky_l += l; sky_n += 1
            elif band_grd:
                grd_l += l; grd_n += 1
            n += 1
    n = float(n or 1)
    top = sum(hist[14:])
    return {
        "px": "%dx%d" % (w, h),
        "mean luma": lum / n,
        "mean saturation": sat / n,
        "above luma 224 %": 100.0 * top / n,
        "pure white %": 100.0 * blown / n,
        "below luma 18 %": 100.0 * dark / n,
        "sky band luma": sky_l / max(1, sky_n),
        "ground band luma": grd_l / max(1, grd_n),
        "sky minus ground": (sky_l / max(1, sky_n)) - (grd_l / max(1, grd_n)),
    }


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if not args:
        raise SystemExit(__doc__)
    a = measure(args[0])
    b = measure(args[1]) if len(args) > 1 else None
    name_a = os.path.basename(args[0])[:26]
    if b is None:
        print("  %s" % name_a)
        for k, v in a.items():
            print("    %-20s %s" % (k, v if isinstance(v, str) else "%8.2f" % v))
        return 0
    name_b = os.path.basename(args[1])[:26]
    print("  %-20s %>12s %>12s %>10s" .replace(">", "") % ("", name_a[:12], name_b[:12], "gap"))
    for k in a:
        if isinstance(a[k], str):
            print("    %-20s %12s %12s" % (k, a[k], b[k]))
        else:
            print("    %-20s %12.2f %12.2f %10.2f" % (k, a[k], b[k], a[k] - b[k]))
    # THE TWO THAT ARE NOT PREFERENCES
    if a["sky minus ground"] < 0:
        print("  ! the sky band is DARKER than the ground band by %.1f — that does "
              "not happen outdoors in daylight" % -a["sky minus ground"])
    if a["pure white %"] > 2.0:
        print("  ! %.2f%% of the frame is pure white and carries no information"
              % a["pure white %"])
    if a["below luma 18 %"] < 0.5:
        print("  ! %.2f%% of the frame is below luma 18 — there are effectively "
              "no shadows in it" % a["below luma 18 %"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
