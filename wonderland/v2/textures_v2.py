#!/usr/bin/env python3
"""WONDERLAND V2 texture set — neutral detail maps for the measured palette.

WHY A V2 SET
------------
The V2 surface master multiplies the albedo TEXTURE by the instance's BaseColor
TINT. The shared synthesiser's albedos carry their own colour: measured linear
means of 0.39/0.34/0.24 for ashlar (a yellow-brown cast), 0.51/0.11/0.16 for
roof (saturated red), 0.18 for cobble. Tinted on top of that, the plaza cream
(0.70,0.66,0.57) renders as (0.27,0.22,0.14) — a dark brown — and the muted
pink roof as near-black crimson. That is the V1 "everything reads as one tan
material" class of defect, arriving through the texture instead of the light.

So every V2 albedo is NEUTRALISED: per-channel LINEAR mean scaled to
`TARGET_MEAN`, so the texture supplies structure (joints, grain, baked AO,
wear, spots) and the tint supplies the measured colour. The achieved mean is
written to `textures_v2.json`; materials_v2 divides each tint by it, which
makes the palette table in VISUAL_SPEC.md hold in the render to within the
clipping of the brightest pixels.

The noise/PNG/normal kernels are imported from the SHARED engineering file
infra/build/gen-textures.py (V1-LEGACY-MANIFEST: shared). No V1 colour
decision survives the neutralisation; V2's own families (plaza slabs, path
flags) are authored here from the panorama.

    python3 wonderland/v2/textures_v2.py <out_dir> [--fast] [--only fam,fam]

stdlib only, deterministic, tiles.
"""
import importlib.util
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
KERNEL = os.path.normpath(os.path.join(HERE, "..", "infra", "build", "gen-textures.py"))
_spec = importlib.util.spec_from_file_location("wl_texkernel", KERNEL)
K = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(K)
sys.modules["wl_texkernel"] = K      # so worker processes can unpickle its functions

SEED = 0x5E2A11
TARGET_MEAN = 0.92          # linear, the aim; the ACHIEVED mean goes in the sidecar
                            # and is what the material divides by
PREFIX = "T_V2_"

fbm, voronoi, smooth, clamp01, _b, _hash2 = K.fbm, K.voronoi, K.smooth, K.clamp01, K._b, K._hash2


# --------------------------------------------------------------------------
# colour space
# --------------------------------------------------------------------------
def _to_lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _to_srgb(l):
    l = clamp01(l)
    return 255.0 * (l * 12.92 if l <= 0.0031308 else 1.055 * (l ** (1.0 / 2.4)) - 0.055)


LIN = [_to_lin(i) for i in range(256)]


def _stats(alb, size, mask=None, step=None):
    n = size * size
    step = step or max(1, n // 30000)
    vals = [[], [], []]
    for i in range(0, n, step):
        if mask is not None and mask[i] < 128:
            continue
        for c in range(3):
            vals[c].append(LIN[alb[i * 3 + c]])
    return vals


def _solve_gamma(vals, gain, target):
    """Bisection on the exponent g so that mean(clip(v*gain)^g) == target.
    Monotone in g, so it converges; a texture whose bulk cannot reach the
    target inside [0.15, 4.0] gets the nearest end and the gate reports it."""
    lo, hi = 0.15, 4.0
    for _ in range(28):
        g = 0.5 * (lo + hi)
        m = sum(clamp01(v * gain) ** g for v in vals) / len(vals)
        if m < target:
            hi = g       # brighten: smaller exponent
        else:
            lo = g
    return 0.5 * (lo + hi)


def neutralise(alb, size, target=TARGET_MEAN, mask=None):
    """Make each channel's LINEAR mean equal `target` WITHOUT clipping the
    structure away: the 97th percentile is mapped to 1.0 (so joints, grain
    and wear keep their full range), then a per-channel exponent lifts or
    lowers the mean onto the target. One linear gain alone clips bimodal
    textures (setts + dark joints) and lands short — the gate found cobble
    at 0.65 and roof at 0.75 that way. With `mask`, only masked pixels count
    (leaf cards: the transparent surround is not surface).
    Returns the achieved means (measured on the written pixels)."""
    n = size * size
    vals = _stats(alb, size, mask)
    if not vals[0]:
        return [0.0, 0.0, 0.0]
    gains, gammas = [], []
    for c in range(3):
        v = sorted(vals[c])
        p97 = v[min(len(v) - 1, int(len(v) * 0.97))]
        gain = 1.0 / p97 if p97 > 1e-6 else 1.0
        gains.append(gain)
        gammas.append(_solve_gamma(vals[c], gain, target))
    lut = [[_b(_to_srgb(clamp01(LIN[i] * gains[c]) ** gammas[c]) + 0.5) for i in range(256)] for c in range(3)]
    got = [0.0, 0.0, 0.0]
    cnt = 0
    for i in range(n):
        inside = mask is None or mask[i] >= 128
        for c in range(3):
            o = lut[c][alb[i * 3 + c]]
            alb[i * 3 + c] = o
            if inside:
                got[c] += LIN[o]
        if inside:
            cnt += 1
    return [g / max(1, cnt) for g in got]


# --------------------------------------------------------------------------
# V2-authored families (from the panorama)
# --------------------------------------------------------------------------
def make_plaza(size):
    """The reference plaza: LARGE pale slabs (about 1.3 m), laid in courses with
    a half-slab bond, hairline chamfered joints, a faint saw texture, and only
    a few percent of tonal variation per slab. Two slabs per tile edge, so the
    sheet repeats every ~2.6 m at TexScale 0.0038. No moss, no cracks: the
    plaza is clean and dry in the reference."""
    alb = bytearray(size * size * 3)
    rgh = bytearray(size * size)
    hgt = [0.0] * (size * size)
    rows = cols = 2
    inv = 1.0 / size
    for y in range(size):
        v = (y + 0.5) * inv
        ry = v * rows
        r_i = int(ry)
        fy = ry - r_i
        shift = 0.5 * (r_i % 2)
        for x in range(size):
            u = (x + 0.5) * inv
            rx = (u + shift) * cols
            c_i = int(rx)
            fx = rx - c_i
            cid = _hash2(c_i % cols, r_i % rows, SEED + 11)
            dj = min(fx, 1.0 - fx, fy, 1.0 - fy)      # distance to the joint, slab space
            joint = smooth(0.0, 0.012, dj)               # 0 in the joint, 1 on the face
            chamfer = smooth(0.012, 0.030, dj)
            saw = fbm(u * 1.0, v * 0.25, 140, 40, 2, SEED + 17)   # long shallow saw lines
            grain = fbm(u, v, 110, 110, 3, SEED + 23)
            blotch = fbm(u, v, 7, 7, 3, SEED + 29)
            mineral = clamp01((fbm(u, v, 60, 60, 2, SEED + 31) - 0.70) * 5.0)
            tone = 0.94 + 0.07 * (((cid >> 9) & 255) / 255.0)
            face = tone * (0.96 + 0.05 * grain) * (0.985 + 0.03 * saw) * (0.97 + 0.05 * blotch)
            face *= 1.0 + 0.05 * mineral
            mortar = 0.66 + 0.06 * grain
            k = smooth(0.0, 0.5, joint)
            val = mortar + (face - mortar) * k
            ao = 0.80 + 0.20 * smooth(0.0, 0.5, chamfer)
            val *= ao
            i = y * size + x
            # near-neutral: the cream is the tint's job. A hair warm so the
            # neutralisation has nothing to fight.
            alb[i * 3] = _b(val * 255.0)
            alb[i * 3 + 1] = _b(val * 0.995 * 255.0)
            alb[i * 3 + 2] = _b(val * 0.985 * 255.0)
            rgh[i] = _b(clamp01(0.70 + 0.08 * grain + 0.10 * (1.0 - joint) - 0.06 * mineral) * 255.0)
            hgt[i] = chamfer * 0.85 + grain * 0.06 + saw * 0.04 + 0.05 * (tone - 0.94) / 0.07
    return alb, K.height_to_normal(hgt, size, 2.2), rgh


def make_pathstone(size):
    """The darker central path: irregular FLAGS, larger and flatter than setts,
    tight joints, dry (no moss), matte. Three flags per tile edge."""
    alb = bytearray(size * size * 3)
    rgh = bytearray(size * size)
    hgt = [0.0] * (size * size)
    inv = 1.0 / size
    for y in range(size):
        v = (y + 0.5) * inv
        for x in range(size):
            u = (x + 0.5) * inv
            f1, f2, cid = voronoi(u, v, 4, SEED + 41, jitter=0.62)
            edge = smooth(0.0, 0.035, f2 - f1)
            dome = edge ** 0.30
            grain = fbm(u, v, 56, 56, 4, SEED + 43)
            fine = fbm(u, v, 170, 170, 2, SEED + 47)
            tone = 0.86 + 0.24 * (((cid >> 9) & 255) / 255.0)
            face = tone * (0.90 + 0.18 * grain) * (0.96 + 0.08 * fine) * (0.94 + 0.10 * dome)
            mortar = 0.62 + 0.10 * grain
            k = smooth(0.05, 0.50, edge)
            val = mortar + (face - mortar) * k
            ao = 0.62 + 0.38 * smooth(0.0, 0.40, edge)
            val *= ao
            i = y * size + x
            alb[i * 3] = _b(val * 255.0)
            alb[i * 3 + 1] = _b(val * 255.0)
            alb[i * 3 + 2] = _b(val * 1.01 * 255.0)
            rgh[i] = _b(clamp01(0.84 - 0.14 * dome + 0.10 * grain) * 255.0)
            hgt[i] = dome * 0.80 + grain * 0.14 + fine * 0.06
    return alb, K.height_to_normal(hgt, size, 3.0), rgh


# name -> (fn, size)   sizes: foreground families largest
FAMILIES = (
    ("plaza", make_plaza, 1024),
    ("pathstone", make_pathstone, 512),
    ("ashlar", K.make_ashlar, 512),
    ("cobble", K.make_cobble, 512),
    ("plaster", K.make_plaster, 512),
    ("roof", K.make_roof, 512),
    ("sward", K.make_sward, 256),
    ("bark", K.make_bark, 512),
    ("metal", K.make_metal, 256),
    ("glaze", K.make_glaze, 256),
    ("cap", K.make_cap, 256),
    ("petal", K.make_petal, 256),
    ("runes", K.make_runes, 1024),
)


#: line art / emissive: keep the authored values, the tint is not divided
NOT_NEUTRAL = ("runes",)


def _one(args):
    name, size, out = args
    fn = dict((n, f) for n, f, _s in FAMILIES)[name]
    t0 = time.time()
    alb, nrm, rgh = fn(size)
    if name in NOT_NEUTRAL:
        v = _stats(alb, size)
        mean = [sum(ch) / len(ch) for ch in v]
    else:
        mean = neutralise(alb, size)
    K.write_png(os.path.join(out, PREFIX + name + "_a.png"), size, size, alb)
    K.write_png(os.path.join(out, PREFIX + name + "_n.png"), size, size, nrm)
    K.write_png(os.path.join(out, PREFIX + name + "_r.png"), size, size, rgh, greyscale=True)
    return name, size, mean, time.time() - t0


def _leaf(out, size):
    alb, nrm, msk = K.make_leafcard(size)
    mean = neutralise(alb, size, mask=msk)
    K.write_png(os.path.join(out, PREFIX + "leafcard_a.png"), size, size, alb)
    K.write_png(os.path.join(out, PREFIX + "leafcard_n.png"), size, size, nrm)
    K.write_png(os.path.join(out, PREFIX + "leafcard_m.png"), size, size, msk, greyscale=True)
    return "leafcard", size, mean


def generate(out, fast=False, only=None, jobs=None):
    if not os.path.isdir(out):
        os.makedirs(out)
    div = 4 if fast else 1
    work = [(n, max(64, s // div), out) for n, _fn, s in FAMILIES if not only or n in only]
    meta = {"prefix": PREFIX, "target_mean": TARGET_MEAN, "fast": bool(fast), "families": {}}
    t0 = time.time()
    results = []
    try:
        import multiprocessing
        procs = jobs or max(1, min(len(work), (os.cpu_count() or 1)))
        if procs > 1 and len(work) > 1:
            with multiprocessing.Pool(procs) as pool:
                results = pool.map(_one, work)
        else:
            results = [_one(w) for w in work]
    except (ImportError, OSError):
        results = [_one(w) for w in work]
    for name, size, mean, dt in results:
        meta["families"][name] = {"size": size, "mean": [round(m, 4) for m in mean], "neutral": name not in NOT_NEUTRAL}
        print("  %s%s_{a,n,r} %dx%d mean (%.3f %.3f %.3f) %.0fs" % (PREFIX, name, size, size, mean[0], mean[1], mean[2], dt))
    if not only or "leafcard" in only:
        name, size, mean = _leaf(out, max(64, 256 // div))
        meta["families"][name] = {"size": size, "mean": [round(m, 4) for m in mean], "neutral": True, "masked": True}
        print("  %sleafcard_{a,n,m} %dx%d mean (%.3f %.3f %.3f)" % (PREFIX, size, size, mean[0], mean[1], mean[2]))
    with open(os.path.join(out, "textures_v2.json"), "w") as fh:
        json.dump(meta, fh, indent=1, sort_keys=True)
    print("textures_v2: %d families -> %s in %.0fs%s" % (len(meta["families"]), out, time.time() - t0, " (FAST: sizes /4, not for a build)" if fast else ""))
    return meta


if __name__ == "__main__":
    argv = [a for a in sys.argv[1:]]
    fast = "--fast" in argv
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    pos = [a for a in argv if not a.startswith("--") and (only is None or a != ",".join(sorted(only)))]
    pos = [a for a in pos if a not in (only or ())]
    out = pos[0] if pos else os.environ.get("WONDERLAND_TEXTURE_DIR", "/opt/wonderland/textures")
    generate(out, fast=fast, only=only)
