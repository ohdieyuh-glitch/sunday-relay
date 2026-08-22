#!/usr/bin/env python3
"""Mean colour AND acutance of a rectangle in a PNG, with no PIL and no ffmpeg.

    python3 measure-frame-region.py frame.png X Y W H

WHY STDLIB. The Lightning box has neither ffmpeg nor a system PIL, and adding a
dependency to read four numbers out of a picture is how a measurement stops
being taken. A PNG is a zlib stream of filtered scanlines; that is all this
decodes, and only for the 8-bit RGB/RGBA colour types the capture actually
produces. Anything else is refused by name rather than guessed at.

It exists because "is the backdrop brighter than it was" is a question about
pixels, and answering it by eye across a sweep is how a tuning pass concludes
whatever the tuner expected.
"""
import struct
import sys
import zlib

_CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


def read_png(path):
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("%s is not a PNG" % path)
    pos, idat, header = 8, [], None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
        pos += 12 + length
    if header is None:
        raise SystemExit("%s has no IHDR" % path)
    width, height, depth, colour, _c, _f, interlace = header
    if depth != 8 or colour not in (2, 6) or interlace != 0:
        raise SystemExit(
            "%s is bit-depth %d, colour type %d, interlace %d — this reader only "
            "handles 8-bit RGB/RGBA non-interlaced, which is what the capture "
            "writes. Refusing rather than returning a wrong number."
            % (path, depth, colour, interlace))
    channels = _CHANNELS[colour]
    raw = zlib.decompress(b"".join(idat))
    stride = width * channels
    out = bytearray(height * stride)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        filter_type = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if filter_type == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filter_type == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filter_type == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filter_type == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif filter_type != 0:
            raise SystemExit("unknown PNG filter %d on row %d" % (filter_type, y))
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, out


def main(argv):
    if len(argv) < 6:
        sys.stderr.write(__doc__)
        return 2
    path = argv[1]
    x, y, w, h = (int(v) for v in argv[2:6])
    width, height, channels, pixels = read_png(path)
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(width, x + w), min(height, y + h)
    if x1 <= x0 or y1 <= y0:
        raise SystemExit("the requested region is outside the %dx%d image"
                         % (width, height))
    totals = [0, 0, 0]
    count = 0
    stride = width * channels
    for row in range(y0, y1):
        base = row * stride
        for col in range(x0, x1):
            i = base + col * channels
            totals[0] += pixels[i]
            totals[1] += pixels[i + 1]
            totals[2] += pixels[i + 2]
            count += 1
    means = [t / float(count) for t in totals]

    # ACUTANCE, because "sharper" has to be a number or it is an opinion.
    #
    # Mean absolute luma gradient over the region: the average difference between
    # neighbouring pixels. Blur, softness and over-smoothed upscaling all reduce
    # it; real edges, readable geometry and texture detail all raise it. It is
    # scale-dependent, so it compares frames of the SAME region at the same size
    # and says nothing across different crops — which is exactly the comparison a
    # sharpening sweep makes.
    grad_total = 0.0
    grad_count = 0
    def luma_at(row, col):
        i = row * stride + col * channels
        return 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]
    for row in range(y0, y1 - 1):
        for col in range(x0, x1 - 1):
            here = luma_at(row, col)
            grad_total += abs(luma_at(row, col + 1) - here) + abs(luma_at(row + 1, col) - here)
            grad_count += 2
    acutance = (grad_total / grad_count) if grad_count else 0.0

    print("%s %dx%d region=%d,%d,%dx%d mean_rgb=%.1f,%.1f,%.1f luma=%.1f acutance=%.3f"
          % (path.split("/")[-1], width, height, x0, y0, x1 - x0, y1 - y0,
             means[0], means[1], means[2],
             0.2126 * means[0] + 0.7152 * means[1] + 0.0722 * means[2], acutance))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
