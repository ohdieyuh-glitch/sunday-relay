# WHAT FRACTION OF THE PREVIEW WINDOW DOES THE MASCOT ACTUALLY COVER?
#
# The founder's instruction was explicit: "DO NOT validate this solely from camera coordinates." Every
# previous framing fix was checked by reading back the camera distance it had just written, which is a
# tautology -- it cannot fail, and it passed while the picture showed a dog the size of a thumbnail.
#
# So this reads the exported pixels. No engine, no camera, no trust: decode the PNG, find every pixel that
# is not the black backdrop, and report the bounding box of that as a fraction of the frame.
import struct
import sys
import zlib


def read_png(path):
    raw = open(path, "rb").read()
    assert raw[:8] == b"\x89PNG\r\n\x1a\n", "not a png"
    pos, idat, w, h, depth, ctype = 8, [], 0, 0, 8, 6
    while pos < len(raw):
        ln = struct.unpack(">I", raw[pos:pos + 4])[0]
        kind = raw[pos + 4:pos + 8]
        body = raw[pos + 8:pos + 8 + ln]
        if kind == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
        elif kind == b"IDAT":
            idat.append(body)
        elif kind == b"IEND":
            break
        pos += 12 + ln
    data = zlib.decompress(b"".join(idat))
    chan = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    assert depth == 8, "expected 8-bit, got %d" % depth
    stride = w * chan
    out = bytearray(stride * h)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = data[p]
        p += 1
        line = bytearray(data[p:p + stride])
        p += stride
        if ft == 1:
            for i in range(chan, stride):
                line[i] = (line[i] + line[i - chan]) & 255
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                a = line[i - chan] if i >= chan else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = line[i - chan] if i >= chan else 0
                b = prev[i]
                c = prev[i - chan] if i >= chan else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, chan, out


def measure(path, floor=34):
    """The subject's bounding box, as a fraction of the frame.

    `floor` is the luma below which a pixel is called backdrop. The stage backdrop is black and the figure is
    lit, so this separates cleanly -- but it is reported alongside the answer so a wrong threshold cannot
    hide inside a number.

    THIRTY-FOUR, AND IT WAS TESTED RATHER THAN INHERITED. Arden Infernal measures 72.8% of frame height where
    the wardrobe's own solve predicts 80.0, and the obvious suspect was this threshold: Arden is crimson and
    near-black on a black stage, so a floor that eats its dark half would report it short. Swept on the same
    capture:

        floor 34   height 72.8%   centre_y 36.3%
        floor 20   height 72.8%   centre_y 36.3%
        floor 12   height 100.0%  centre_y 49.9%   <- the whole frame

    34 and 20 agree exactly, so Arden's dark parts are nowhere near the threshold and the floor is not the
    cause. 12 collapses to the entire frame, because something faint covers all of it. The hypothesis was
    wrong and the number stays; recorded here so the next person does not spend the same hour on it.
    """

    w, h, chan, px = read_png(path)
    min_x, min_y, max_x, max_y, lit = w, h, -1, -1, 0
    for y in range(h):
        row = y * w * chan
        for x in range(w):
            i = row + x * chan
            luma = (px[i] * 54 + px[i + 1] * 183 + px[i + 2] * 19) >> 8
            if luma >= floor:
                lit += 1
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
    if max_x < 0:
        return {"file": path.replace("\\", "/").split("/")[-1], "empty": True}
    # THE MEAN OF THE WHOLE FRAME, AND OF THE SUBJECT ALONE.
    # The first ranks a pulse: across frames of one pose it rises and falls with the fire. The second is the
    # one that says whether the figure is lit, because a subject filling a fifth of the frame barely moves a
    # whole-frame average and a backdrop that brightens moves it a lot.
    total = 0
    inside = 0
    inside_n = 0
    for y in range(h):
        row = y * w * chan
        for x in range(w):
            i = row + x * chan
            luma = (px[i] * 54 + px[i + 1] * 183 + px[i + 2] * 19) >> 8
            total += luma
            if min_x <= x <= max_x and min_y <= y <= max_y:
                inside += luma
                inside_n += 1
    bw, bh = max_x - min_x + 1, max_y - min_y + 1
    return {"file": path.replace("\\", "/").split("/")[-1],
            "mean": round(total / float(w * h), 2),
            "subject_mean": round(inside / float(max(inside_n, 1)), 2),
            "w": w, "h": h,
            "height_pct": round(100.0 * bh / h, 1),
            "width_pct": round(100.0 * bw / w, 1),
            "lit_pixels_pct": round(100.0 * lit / (w * h), 1),
            "centre_x_pct": round(100.0 * (min_x + max_x) / 2.0 / w, 1),
            "centre_y_pct": round(100.0 * (min_y + max_y) / 2.0 / h, 1),
            "threshold": floor}


if __name__ == "__main__":
    import glob, json, os
    pats = sys.argv[1:] or ["*.png"]
    files = []
    for pat in pats:
        files.extend(sorted(glob.glob(pat)))
    for f in files:
        print(json.dumps(measure(f)))
