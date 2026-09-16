# Does the mini-map photograph READ, judged from the captured frame rather than from "the photograph was drawn"?
#
# CALIBRATED AGAINST A KNOWN FAILURE. The first HUD proof recorded photo_drawn=true over a disc that was solid white:
# the capture saturated under physically-lit daylight. This reads the disc's own pixels and fails that frame -- a
# check never shown failing is not yet a check.
#
# Pure Python (no PIL on this machine): a PNG decoder that unfilters only the rows the disc covers.
#
#   python minimap_pixels.py <frame.png> <cx_px> <cy_px> <radius_px>
#
# Reports mean luminance, spread, and the share of near-white and near-black pixels inside the disc (minus a rim
# margin, so the ring and the N pill do not count), and a verdict.
import json
import struct
import sys
import zlib


def read_png_rows(path, last_row):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, idat, width, height, colour, depth = 8, bytearray(), 0, 0, 0, 0
    while pos < len(data):
        length, tag = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if tag == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", body[:10])
        elif tag == b"IDAT":
            idat += body
        pos += 12 + length
    assert depth == 8 and colour in (2, 6), "only 8-bit RGB/RGBA"
    bpp = 3 if colour == 2 else 4
    stride = width * bpp
    raw = zlib.decompressobj().decompress(bytes(idat), (stride + 1) * (last_row + 1))
    rows, prev = [], bytearray(stride)
    for y in range(min(last_row + 1, height)):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        rows.append(line)
        prev = line
    return width, height, bpp, rows


def analyse(path, cx, cy, radius, rim=14):
    width, height, bpp, rows = read_png_rows(path, int(cy + radius) + 1)
    inner = radius - rim
    lum, white, black = [], 0, 0
    for y in range(max(0, int(cy - inner)), min(len(rows), int(cy + inner) + 1)):
        row = rows[y]
        for x in range(max(0, int(cx - inner)), min(width, int(cx + inner) + 1)):
            if (x - cx) ** 2 + (y - cy) ** 2 > inner * inner:
                continue
            r, g, b = row[x * bpp], row[x * bpp + 1], row[x * bpp + 2]
            l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            lum.append(l)
            white += l > 0.92
            black += l < 0.04
    n = max(len(lum), 1)
    mean = sum(lum) / n
    spread = (sum((v - mean) ** 2 for v in lum) / n) ** 0.5
    report = {"pixels": len(lum), "mean_luminance": round(mean, 3), "spread": round(spread, 3),
              "near_white": round(white / n, 3), "near_black": round(black / n, 3)}
    # READS means: not blown out, not a black hole, and not one flat colour -- a map has ground in it.
    report["reads"] = report["near_white"] < 0.25 and report["near_black"] < 0.50 and 0.06 < mean < 0.80 and spread > 0.04
    return report


if __name__ == "__main__":
    print(json.dumps(analyse(sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]))))
