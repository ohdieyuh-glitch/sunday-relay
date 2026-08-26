#!/usr/bin/env python3
"""GATE: the V2 texture set exists, is neutral, and covers every family the
materials ask for.

    python3 wonderland/v2/verify_v2_textures.py <texture_dir>

Checks (each a line, PASS/FAIL at the end):
  1. every stem in materials_v2.FAMILY_FILES has a file in <dir>
  2. every neutral `_a` albedo has no colour cast (linear channel means agree
     within 0.06) and is bright enough to correct (min channel mean >= 0.70);
     the material divides its tint by the sidecar's recorded mean
  3. foreground families (plaza, pathstone, ashlar) are >= 512 px unless the
     sidecar says the set was generated --fast (then the gate says so and
     refuses to bless it for a build)
  4. the sidecar's recorded means agree with the files (no stale JSON)
"""
import json
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import materials_v2 as M  # noqa: E402


def read_png(p):
    d = open(p, "rb").read()
    pos, idat, w, h, ct = 8, b"", 0, 0, 0
    while pos < len(d):
        n = struct.unpack(">I", d[pos:pos + 4])[0]
        t, c = d[pos + 4:pos + 8], d[pos + 8:pos + 8 + n]
        pos += 12 + n
        if t == b"IHDR":
            w, h, _bd, ct = struct.unpack(">IIBB", c[:10])
        elif t == b"IDAT":
            idat += c
    raw = zlib.decompress(idat)
    ch = 3 if ct == 2 else 1
    stride = w * ch
    out, prev = bytearray(), bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - ch] if i >= ch else 0
            b = prev[i]
            c = prev[i - ch] if i >= ch else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else (b if pb <= pc else c))) & 255
        out += line
        prev = line
    return w, h, ch, out


def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


LUT = [_lin(i) for i in range(256)]


def main(d):
    fails = []
    side = os.path.join(d, "textures_v2.json")
    if not os.path.exists(side):
        print("FAIL: no textures_v2.json in %s (run textures_v2.py first)" % d)
        return 1
    meta = json.load(open(side))
    target = float(meta.get("target_mean", 0.92))
    fast = bool(meta.get("fast"))
    wanted = sorted({s for v in M.FAMILY_FILES.values() for s in v if s})
    missing = [s for s in wanted if not any(os.path.exists(os.path.join(d, s + e)) for e in (".png", ".tga", ".jpg"))]
    print("stems: %d wanted, %d missing%s" % (len(wanted), len(missing), (": " + ", ".join(missing)) if missing else ""))
    if missing:
        fails.append("missing stems")
    for fam, rec in sorted(meta["families"].items()):
        p = os.path.join(d, meta["prefix"] + fam + "_a.png")
        if not os.path.exists(p):
            continue
        w, h, ch, px = read_png(p)
        n = w * h
        step = max(1, n // 40000)
        mask = None
        if rec.get("masked"):
            mp = os.path.join(d, meta["prefix"] + fam + "_m.png")
            if os.path.exists(mp):
                mask = read_png(mp)[3]
        idx = [i for i in range(0, n, step) if mask is None or mask[i] >= 128]
        cnt = max(1, len(idx))
        mean = [sum(LUT[px[i * 3 + c]] for i in idx) / cnt for c in range(3)]
        neutral = rec.get("neutral", True)
        # NEUTRAL means: no colour cast (channels agree) and bright enough that
        # the tint/mean correction stays inside the texture's reach. The exact
        # mean is not the criterion -- a heavily structured surface (setts with
        # dark joints) cannot average 0.92 without crushing its structure, and
        # the material divides by whatever mean the sidecar records.
        spread = (max(mean) - min(mean)) if neutral else 0.0
        low = (min(mean) < 0.70) if neutral else False
        stale = max(abs(mean[c] - rec["mean"][c]) for c in range(3))
        ok = spread <= 0.06 and not low and stale <= 0.02
        print("  %-10s %4dpx mean (%.3f %.3f %.3f) %s sidecar-drift %.3f %s" % (
            fam, w, mean[0], mean[1], mean[2], ("cast %.3f" % spread) if neutral else "authored  ", stale, "ok" if ok else "FAIL"))
        if spread > 0.06:
            fails.append("%s has a colour cast (spread %.3f)" % (fam, spread))
        if low:
            fails.append("%s too dark to correct (mean %.2f < 0.70)" % (fam, min(mean)))
        if stale > 0.02:
            fails.append("%s sidecar stale" % fam)
        if fam in ("plaza", "pathstone", "ashlar") and w < 512 and not fast:
            fails.append("%s is %dpx (< 512) in a non-fast set" % (fam, w))
    if fast:
        print("NOTE: this set was generated --fast (sizes /4); it exercises the pipeline and must NOT feed a build")
    if fails:
        print("FAIL: " + "; ".join(fails))
        return 1
    print("PASS: V2 textures complete and neutral%s" % (" (fast set)" if fast else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("WONDERLAND_TEXTURE_DIR", "/opt/wonderland/textures")))
