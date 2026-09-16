#!/usr/bin/env python3
"""MQ01 -- HD texture sets for the Wonderland surface master (founder quality directive, 2026-09-13).

WHY. The V2 surface materials draw from synthesised maps of 256-1024 px: the plaza's 1024, walls, roofs and cobbles
512, gold, ceramic, mushroom caps and petals 256 -- tiled every 1-2.6 m, so at walking distance every surface reads
as a smooth tint with a faint repeating pattern, and gold reads as crumpled foil (its 256 px hammered normal, 1.1 m
tile). The environment quality reference (WorldDesign/Reference/environment_quality_reference_2026-09-13.png) asks
for stone that reads as stone, gold that reads as polished ornamental metal, and relief the sunlight can find.

WHAT. 2048 px, perfectly tiling sets (spectral synthesis in the frequency domain tiles by construction; Voronoi uses
wrap-around distances), one per surface family, each ALBEDO + NORMAL + ROUGHNESS:
  limestone  walked slabs and kerbs: grain, soft mottling, sparse pitting, faint veining, worn smooth patches
  cobble     rounded stones in a loose light/dark checker, bevelled domes, deep mortar with moss in it
  ivory      wall stone: fine sandstone grain, very soft mottling, low relief
  roof       fish-scale tiles in offset rows, each scale its own tone, a shadow under every overlap
  gold       polished metal: near-flat normal with fine directional scratches, roughness 0.18-0.40 with smudges
  ashlar     castle wall stone laid in courses (MQ05): running-bond blocks, fine joints with chamfered arrises the
             sun can find, every block its own tone and a whisper of tilt; clean, pale, no grime
  grass      lawn (MQ09) -- generated, applied, judged WORSE than the V2 lawn texture, reverted; kept for reference
  macro      one 1024 px low-frequency map (R: brightness, G: roughness) laid at ~60 m to break repetition

Albedos are NEUTRAL like the V2 set (the instance's BaseColor tint carries the colour): the linear mean is scaled to
TARGET_MEAN, and the achieved means are written to hd_textures.json for the material to divide by.

    <venv python with numpy> hd_textures.py <out_dir> [--size 2048] [--only limestone,gold]
"""
import json
import os
import struct
import sys
import zlib

import numpy as np

TARGET_MEAN = 0.72
SEED = 20260913


def png(path, arr):
    """Write an 8-bit RGB or grey PNG (stdlib zlib)."""
    arr = np.clip(arr, 0.0, 1.0)
    data = (arr * 255.0 + 0.5).astype(np.uint8)
    if data.ndim == 2:
        color, channels = 0, 1
    else:
        color, channels = 2, 3
    h, w = data.shape[:2]
    raw = b"".join(b"\x00" + data[y].tobytes() for y in range(h))

    def chunk(tag, payload):
        c = struct.pack(">I", len(payload)) + tag + payload
        return c + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        f.write(chunk(b"IEND", b""))
    _ = channels


def spectral(n, beta, rng, lo=1.0, hi=None):
    """Tileable noise with a 1/f^beta amplitude spectrum, band-limited to [lo, hi] cycles per tile. Zero mean, unit std."""
    fx = np.fft.fftfreq(n) * n
    fy = np.fft.rfftfreq(n) * n
    f = np.sqrt(fx[:, None] ** 2 + fy[None, :] ** 2)
    amp = np.zeros_like(f)
    band = (f >= lo) & ((f <= hi) if hi else True)
    amp[band] = 1.0 / np.power(f[band], beta / 2.0 * 2.0 / 2.0 + beta / 2.0)
    phase = rng.uniform(0, 2 * np.pi, f.shape)
    spec = amp * np.exp(1j * phase)
    out = np.fft.irfft2(spec, s=(n, n))
    out -= out.mean()
    return out / (out.std() + 1e-9)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def normal_from_height(h, strength):
    """Tangent-space normal (OpenGL-style green up is flipped for UE: DirectX, +Y down) from a tiling height map."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * strength
    nz = 1.0 / np.sqrt(dx * dx + dy * dy + 1.0)
    nx, ny = -dx * nz, dy * nz          # DirectX convention (UE): +Y points down the image
    return np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)


def to_srgb(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def neutral_albedo(lum_lin, warm=None):
    """Scale a linear luminance field (with optional per-channel tone) so its mean is TARGET_MEAN; return sRGB + mean."""
    rgb = np.stack([lum_lin, lum_lin, lum_lin], axis=-1)
    if warm is not None:
        rgb = rgb * warm
    means = rgb.reshape(-1, 3).mean(axis=0)
    rgb = rgb * (TARGET_MEAN / means.mean())
    rgb = np.clip(rgb, 0.0, 1.0)
    return to_srgb(rgb), [round(float(v), 4) for v in rgb.reshape(-1, 3).mean(axis=0)]


def voronoi_tiling(n, cells, rng):
    """Per-pixel (F1, F2, cell id) of a wrap-around Voronoi with `cells` jittered sites."""
    side = int(round(np.sqrt(cells)))
    gy, gx = np.mgrid[0:side, 0:side]
    pts = np.stack([(gx.ravel() + 0.5 + rng.uniform(-0.32, 0.32, side * side)) / side,
                    (gy.ravel() + 0.5 + rng.uniform(-0.32, 0.32, side * side)) / side], axis=-1) % 1.0
    cells = side * side
    yy, xx = np.mgrid[0:n, 0:n] / float(n)
    f1 = np.full((n, n), 9.0)
    f2 = np.full((n, n), 9.0)
    idx = np.zeros((n, n), dtype=np.int32)
    for i, (px, py) in enumerate(pts):
        if i >= cells:
            break
        dx = np.abs(xx - px)
        dx = np.minimum(dx, 1.0 - dx)
        dy = np.abs(yy - py)
        dy = np.minimum(dy, 1.0 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        idx = np.where(closer, i, idx)
        f1 = np.where(closer, d, f1)
    return f1, f2, idx


# ------------------------------------------------------------------ families
def limestone(n, rng):
    """Walked limestone: fine grain, ridged cloudy veining, pits of several sizes, a few pale fossil flecks, soft
    mottling, worn smooth patches. Contrast is kept inside +/-15% so a tint still reads as its colour."""
    grain = spectral(n, 1.3, rng, lo=n / 10.0)
    mid = spectral(n, 1.9, rng, lo=6.0, hi=n / 10.0)
    ridged = 1.0 - np.abs(spectral(n, 2.2, rng, lo=3.0, hi=40.0))
    veins = smoothstep(0.82, 0.98, ridged)
    mottle = spectral(n, 2.8, rng, lo=1.0, hi=8.0)
    pits_small = smoothstep(2.0, 2.8, spectral(n, 0.6, rng, lo=n / 6.0))
    pits_big = smoothstep(2.3, 3.0, spectral(n, 1.0, rng, lo=n / 40.0, hi=n / 12.0))
    pits = np.clip(pits_small + pits_big, 0, 1)
    flecks = smoothstep(2.6, 3.2, spectral(n, 0.9, rng, lo=n / 20.0, hi=n / 5.0))
    worn = smoothstep(0.5, 1.5, spectral(n, 2.4, rng, lo=2.0, hi=14.0))
    height = 0.05 * grain + 0.10 * mid - 0.9 * pits_small - 1.4 * pits_big + 0.05 * veins
    lum = 0.80 + 0.05 * grain + 0.06 * mid + 0.035 * mottle - 0.30 * pits + 0.07 * veins + 0.10 * flecks + 0.03 * worn
    tone = 1.0 + 0.005 * mottle + 0.004 * mid
    warm = np.stack([tone * 1.012, np.ones_like(tone), (2.0 - tone) * 0.985], axis=-1)     # a whisper warm, never blue
    alb, mean = neutral_albedo(lum, warm)
    rough = np.clip(0.78 + 0.07 * grain + 0.04 * mid - 0.20 * worn + 0.18 * pits - 0.06 * veins, 0.0, 1.0)
    return alb, normal_from_height(height, 7.0), rough, mean


def cobble(n, rng, cells=196):
    """Rounded, bevelled stones of even size on a jittered grid, laid in a loose light/dark checker (the quality
    reference's plaza), with narrow deep joints and moss in some of them."""
    f1, f2, idx = voronoi_tiling(n, cells, rng)
    side = int(round(np.sqrt(cells)))
    cell = 1.0 / side
    edge = f2 - f1
    mortar = 1.0 - smoothstep(0.0025, 0.0075, edge)                        # 1 in the joints
    dome = smoothstep(0.0, 0.28 * cell, edge)                               # bevelled rise from the joint
    n_sites = side * side
    r1 = rng.uniform(0, 1, n_sites)
    r2 = rng.uniform(0, 1, n_sites)
    checker = np.where(r1[idx] > 0.5, 1.0, 0.70) * (0.90 + 0.20 * r2[idx])
    grain = spectral(n, 1.6, rng, lo=n / 16.0)
    pits = smoothstep(2.2, 3.0, spectral(n, 0.7, rng, lo=n / 8.0))
    height = 0.9 * dome + 0.04 * grain - 0.35 * mortar - 0.2 * pits
    moss = smoothstep(0.6, 1.6, spectral(n, 2.2, rng, lo=3.0, hi=40.0)) * mortar
    lum = checker * (0.86 + 0.06 * grain - 0.2 * pits) * (0.80 + 0.20 * dome)
    lum = lum * (1.0 - mortar) + 0.34 * mortar
    r = lum * (1.0 - moss) + 0.20 * moss
    g = lum * (1.0 - moss) + 0.27 * moss
    b = lum * (1.0 - moss) + 0.12 * moss
    rgb = np.stack([r, g, b], axis=-1)
    means = rgb.reshape(-1, 3).mean(axis=0)
    rgb = np.clip(rgb * (TARGET_MEAN / means.mean()), 0, 1)
    alb, mean = to_srgb(rgb), [round(float(v), 4) for v in rgb.reshape(-1, 3).mean(axis=0)]
    rough = np.clip(0.70 + 0.08 * grain + 0.24 * mortar - 0.10 * dome + 0.1 * pits, 0, 1)
    return alb, normal_from_height(height, 16.0), rough, mean


def ivory(n, rng):
    grain = spectral(n, 1.4, rng, lo=60.0)
    fine = spectral(n, 1.9, rng, lo=12.0, hi=60.0)
    mottle = spectral(n, 2.8, rng, lo=1.0, hi=12.0)
    height = 0.02 * grain + 0.03 * fine
    lum = 0.86 + 0.02 * grain + 0.03 * fine + 0.05 * mottle
    tone = 1.0 + 0.02 * mottle
    alb, mean = neutral_albedo(lum, np.stack([tone, np.ones_like(tone), 2.0 - tone], axis=-1))
    rough = np.clip(0.62 + 0.05 * grain + 0.06 * mottle, 0, 1)
    return alb, normal_from_height(height, 6.0), rough, mean


def roof(n, rng, rows=12, per_row=12):
    """Fish-scale tiles in offset rows. Each scale's rounded edge overlaps the row below it (image-up is world-down
    under the world projection on a roof's side), is raised and catches light; its lower part sits in the shadow of
    the row that overlaps it. Every scale has its own tone."""
    yy, xx = np.mgrid[0:n, 0:n] / float(n)
    yy = 1.0 - yy                                  # rounded edges at the bottom of each image cell
    v = yy * rows
    row = np.floor(v).astype(np.int32)
    fv = v - row
    u = xx * per_row + 0.5 * (row % 2)
    col = np.floor(u).astype(np.int32)
    fu = u - col
    arc = 0.62 * (1.0 - np.sqrt(np.clip(1.0 - (2.0 * fu - 1.0) ** 2, 0.0, 1.0)))
    own = fv >= arc                              # below the arc: this row's scale; above it: the row above overlaps
    # the overlapping scale from the row above (offset by half a tile)
    u_up = xx * per_row + 0.5 * ((row - 1) % 2)
    col_up = np.floor(u_up).astype(np.int32)
    ids_own = ((row * 131 + col * 17) % 997).astype(np.float64)
    ids_up = (((row - 1) * 131 + col_up * 17) % 997).astype(np.float64)
    tone_own = 0.86 + 0.24 * ((np.sin(ids_own * 12.9898) * 43758.5453) % 1.0)
    tone_up = 0.86 + 0.24 * ((np.sin(ids_up * 12.9898) * 43758.5453) % 1.0)
    t_own = np.clip((fv - arc) / np.maximum(1.0 - arc, 1e-3), 0, 1)       # 0 at this scale's edge, 1 at its bottom
    shade = np.where(own, 1.0 - 0.30 * smoothstep(0.55, 1.0, t_own), 0.62 + 0.25 * (fv / np.maximum(arc, 1e-3)))
    tone = np.where(own, tone_own, tone_up)
    grain = spectral(n, 1.5, rng, lo=n / 20.0)
    height = np.where(own, 1.0 - 0.8 * t_own, 0.2 + 0.8 * (fv / np.maximum(arc, 1e-3)) * 0.0) + 0.03 * grain
    lip = smoothstep(0.0, 0.05, np.abs(fv - arc))
    lum = shade * tone * (0.92 + 0.05 * grain) * (0.85 + 0.15 * lip)
    alb, mean = neutral_albedo(lum)
    rough = np.clip(0.62 + 0.08 * grain + 0.12 * (1.0 - shade), 0, 1)
    return alb, normal_from_height(height, 12.0), rough, mean


def gold(n, rng):
    # fine directional scratches: noise stretched along x, plus a whisper of isotropic grain
    streak = spectral(n, 1.2, rng, lo=200.0)
    streak = np.cumsum(streak, axis=1)
    streak = (streak - streak.mean()) / (streak.std() + 1e-9)
    streak -= np.roll(streak, n // 2, axis=1)                                  # keep it tiling
    grain = spectral(n, 1.5, rng, lo=90.0)
    smudge = smoothstep(0.4, 1.8, spectral(n, 2.6, rng, lo=2.0, hi=20.0))
    height = 0.006 * streak + 0.004 * grain
    lum = 0.95 + 0.02 * grain - 0.06 * smudge
    alb, mean = neutral_albedo(lum)
    rough = np.clip(0.24 + 0.05 * np.abs(streak) * 0.3 + 0.16 * smudge + 0.02 * grain, 0.12, 0.5)
    return alb, normal_from_height(height, 3.0), rough, mean


def ashlar(n, rng, courses=8):
    """Coursed ashlar (MQ05). One tile holds `courses` courses; laid at 4 m (TexScale 0.0025) a course is 50 cm and a
    block 0.8-1.7 m. Image rows are world height under the wall projections, so courses run along image x. Every
    course is cut into 3 or 4 blocks whose joints never sit within a fifth of a block of the joints below. Joints are
    ~1.2 cm, a touch darker and rougher than the face; each block rises to its face over a ~2.5 cm chamfer, takes
    its own tone (+/-4.5%), warmth and a slight tilt, and carries the ivory grain. Tiles in x by construction (block
    lengths sum to the tile, offsets wrap) and in y (whole courses)."""
    ch = n // courses
    jw, cw = 3.0, 13.0                                   # joint half-width, chamfer width (px)
    grain = spectral(n, 1.4, rng, lo=60.0)
    fine = spectral(n, 1.9, rng, lo=12.0, hi=60.0)
    mottle = spectral(n, 2.8, rng, lo=2.0, hi=16.0)
    height = np.zeros((n, n))
    lum = np.zeros((n, n))
    tone = np.ones((n, n))
    rough = np.zeros((n, n))
    xs = np.arange(n)
    prev_edges = None
    for r in range(courses):
        for _attempt in range(40):
            k = int(rng.integers(3, 5))
            w = rng.uniform(0.75, 1.25, k)
            lengths = np.round(w / w.sum() * n).astype(int)
            lengths[-1] = n - lengths[:-1].sum()
            offset = int(rng.integers(0, n))
            edges = (offset + np.concatenate([[0], np.cumsum(lengths)[:-1]])) % n
            if prev_edges is None:
                break
            gap = np.abs(edges[:, None] - prev_edges[None, :])
            gap = np.minimum(gap, n - gap)
            if gap.min() > n / (k * 5.0):
                break
        prev_edges = edges
        rel = (xs[:, None] - edges[None, :]) % n           # px from each block's start
        bid = np.argmin(np.where(rel < lengths[None, :], rel, n + 1), axis=1)   # the block each column is in
        start = edges[bid]
        pos = (xs - start) % n
        blen = lengths[bid].astype(float)
        dx = np.minimum(pos, blen - pos)                    # px to the nearest vertical joint
        fu = pos / blen
        y0, y1 = r * ch, (r + 1) * ch if r < courses - 1 else n
        yy = np.arange(y0, y1)[:, None] - y0
        dy = np.minimum(yy + 0.5, (y1 - y0) - yy - 0.5)
        fv = (yy + 0.5) / (y1 - y0)
        d = np.minimum(dx[None, :], dy)
        joint = 1.0 - smoothstep(jw - 1.0, jw + 1.0, d)
        edge = smoothstep(jw, jw + cw, d)
        u_tone = rng.uniform(-1, 1, k)[bid][None, :]
        u_warm = rng.uniform(-1, 1, k)[bid][None, :]
        u_rough = rng.uniform(-1, 1, k)[bid][None, :]
        tilt_a = rng.uniform(-1, 1, k)[bid][None, :]
        tilt_b = rng.uniform(-1, 1, k)[bid][None, :]
        sl = (slice(y0, y1), slice(None))
        height[sl] = 0.55 * edge + 0.020 * (tilt_a * (fu[None, :] - 0.5) + tilt_b * (fv - 0.5)) * edge
        lum[sl] = (0.87 * (1.0 + 0.045 * u_tone)) * (0.955 + 0.045 * edge) * (1.0 - 0.20 * joint)
        tone[sl] = 1.0 + 0.012 * u_warm
        rough[sl] = 0.64 + 0.05 * u_rough + 0.16 * joint
    height += 0.010 * grain + 0.016 * fine
    lum += 0.018 * grain + 0.022 * fine + 0.015 * mottle
    tone += 0.006 * mottle
    warm = np.stack([tone * 1.006, np.ones_like(tone), (2.0 - tone) * 0.992], axis=-1)
    alb, mean = neutral_albedo(lum, warm)
    rough = np.clip(rough + 0.04 * grain + 0.03 * mottle, 0, 1)
    return alb, normal_from_height(height, 12.0), rough, mean


def grass(n, rng):
    """MQ09: lawn that is not a flat plane. The census put lawn at 48% of everything visible in the city, and it read as
    one uniform green sheet -- the Bible's rejected 'low-detail'. At a ~1.4 m tile this is what a walker sees of grass:
      BLADES   very fine speckle, light tips over darker bases, so the surface has grain the sun picks out
      CLUMPS   mid-scale tufts and hollows -- the relief, carried mostly in the normal map
      PATCHES  large lush and dry areas, dry ones warmer, so a lawn is not one colour across a whole square
      GAPS     rare dark soil showing between tufts
      FLOWERS  a sparse sprinkle of pale clover and daisy heads -- the flower-dotted meadow of the boards -- kept small
               and rare so a tint still reads as its green
    Neutral like every family: the instance's BaseColor carries the colour, this carries the life."""
    blades = spectral(n, 0.7, rng, lo=260.0)
    clumps = spectral(n, 2.1, rng, lo=22.0, hi=110.0)
    patches = spectral(n, 2.9, rng, lo=1.0, hi=10.0)
    # FLOWER HEADS AT A SIZE A WALKER CAN SEE. The lawn tiles at ~1.4 m, so 2048 px is ~14 px per cm; a 1.5 cm head is
    # ~21 px, which is ~48 cycles per tile. The first version sampled heads at 420 cycles -- 3 mm dots, invisible.
    heads = spectral(n, 0.3, rng, lo=38.0, hi=72.0)
    gaps = smoothstep(-1.55, -2.35, blades + 0.5 * clumps)
    flowers = smoothstep(2.15, 2.65, heads) * smoothstep(-0.4, 0.4, clumps)
    # NO LARGE PATCHES INSIDE THE TILE. The first applied version put 14-140 cm lush/dry patches in a 1.4 m tile, and
    # at mid-distance they repeated as a plain checkerboard across every lawn (grass_ab.jpg, Lantern Lane). Anything
    # bigger than a few tufts must come from the world-space macro map (~60 m), which does not repeat. So the patch
    # field only warms the tone a little, and clumps carry less contrast than before.
    lum = 0.74 + 0.10 * blades + 0.05 * clumps + 0.008 * patches
    lum = lum * (1.0 - 0.40 * gaps) + 0.55 * flowers
    dry = 0.15 * smoothstep(0.2, 1.4, patches)
    warm = np.stack([1.0 + 0.05 * dry + 0.20 * flowers, np.ones_like(dry) + 0.18 * flowers,
                     1.0 - 0.07 * dry + 0.16 * flowers], axis=-1)
    alb, mean = neutral_albedo(np.clip(lum, 0.05, None), warm)
    height = 0.55 * clumps + 0.30 * blades - 0.6 * gaps + 0.25 * flowers
    rough = np.clip(0.86 + 0.05 * blades - 0.04 * dry, 0, 1)
    return alb, normal_from_height(height, 3.2), rough, mean


def macro(n, rng):
    a = spectral(n, 3.0, rng, lo=1.0, hi=10.0)
    b = spectral(n, 3.0, rng, lo=1.0, hi=10.0)
    rgb = np.stack([0.5 + 0.18 * a, 0.5 + 0.18 * b, np.full_like(a, 0.5)], axis=-1)
    return rgb


FAMILIES = {"limestone": limestone, "cobble": cobble, "ivory": ivory, "roof": roof, "gold": gold, "ashlar": ashlar,
            "grass": grass}
# seed order: the MQ01 sets and macro first, so adding a family never changes a texture already imported
SEED_ORDER = ["limestone", "cobble", "ivory", "roof", "gold", "macro", "ashlar", "grass"]


def main():
    out = sys.argv[1]
    size = int(sys.argv[sys.argv.index("--size") + 1]) if "--size" in sys.argv else 2048
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else list(FAMILIES) + ["macro"]
    os.makedirs(out, exist_ok=True)
    side = os.path.join(out, "hd_textures.json")
    record = json.load(open(side)) if os.path.exists(side) else {"target_mean": TARGET_MEAN, "families": {}}
    for k, fam in enumerate(sorted(set(only))):
        rng = np.random.default_rng(SEED + 101 * SEED_ORDER.index(fam))
        if fam == "macro":
            png(os.path.join(out, "T_HD_macro.png"), macro(1024, rng))
            record["families"]["macro"] = {"size": 1024}
            print("macro done")
            continue
        alb, nrm, rgh, mean = FAMILIES[fam](size, rng)
        png(os.path.join(out, "T_HD_%s_a.png" % fam), alb)
        png(os.path.join(out, "T_HD_%s_n.png" % fam), nrm)
        png(os.path.join(out, "T_HD_%s_r.png" % fam), rgh)
        record["families"][fam] = {"size": size, "albedo_linear_mean": mean}
        print(fam, "done", mean)
    with open(side, "w") as f:
        json.dump(record, f, indent=1)


if __name__ == "__main__":
    main()
