"""The V2 asset recipes — every visible thing in WL_V2_GoldenArrival.

Each recipe builds ONE static mesh through gs.MeshBuilder (Geometry Script in
the editor; meshkit only as the logged fallback), at authored world scale with
the base at z = 0, and returns the builder. `build_assets()` saves them under
the V2 content root with Nanite on for dense static geometry and off for
foliage, and returns key -> /Game path.

Nothing here is a primitive standing in for a thing. A tower is a revolved
profile with entasis, string courses, a machicolation ring and window frames;
a mushroom is a revolved cap with a rolled rim, gills, spots and Perlin bumps
on a curved stem; a rose is three nested cupped whorls; a canopy is an
organic union of displaced masses; a gate leaf is a frame, pickets, spiral
scrolls and a heart in round bar. Where the brief says "reject it yourself if
it still looks like blocks", the recipe is written to the shape the reference
draws, and the render is the judge.
"""

import math
import os

import v2_config as C

F = C.FOLDERS


def _h(*k):
    """Deterministic 0..1 from a key (same hash as the geometry kernel)."""
    import meshkit as mk
    return mk.rnd(*k)



# ==========================================================================
# FOLIAGE: leaves, not blobs (vegetation pass 1, 2026-08-26)
# ==========================================================================
#
# The approved foundation render showed every plant as a smooth sphere cluster.
# A silhouette made of spheres reads as blockout no matter what the material
# does, so foliage is now built from LEAF BLADES scattered in CLUMPS over an
# envelope: the outline is broken at leaf scale, light gets between the
# clusters, and the interior core only stops you seeing through. Positions,
# footprints and the composition are untouched -- only what the meshes look
# like changes.


def _leaf_blade(m, at, yaw, pitch, roll, size):
    """One leaf: a tapered blade with a shoulder and a point, ~1 mm thick."""
    s = float(size)
    poly = [(0.0, -0.10 * s), (0.26 * s, 0.16 * s), (0.34 * s, 0.55 * s), (0.18 * s, 0.90 * s),
            (0.0, 1.02 * s), (-0.18 * s, 0.90 * s), (-0.34 * s, 0.55 * s), (-0.26 * s, 0.16 * s)]
    m.extrude(poly, max(1.0, 0.05 * s), at=at, rot=(pitch, yaw, roll))


def _leaf_shell(m, centre, radii, count, size, seed, elev=(-0.75, 1.0), jitter=0.20, clump=3, droop=26.0):
    """Scatter `count` leaves over an ellipsoid in clumps of `clump`. Each leaf
    points outward with angular jitter and a downward droop, so the mass reads
    as many small surfaces rather than one big one."""
    cx, cy, cz = centre
    rx, ry, rz = radii
    anchors = max(1, int(count) // max(1, clump))
    for i in range(anchors):
        t = (i + 0.5) / anchors
        el = math.asin(max(-1.0, min(1.0, elev[0] + (elev[1] - elev[0]) * t)))
        a = i * 2.3999632
        for j in range(clump):
            ja = a + (_h(seed, i, j, 1) - 0.5) * 0.6
            je = el + (_h(seed, i, j, 2) - 0.5) * 0.5
            rr = 1.0 - jitter * _h(seed, i, j, 3)
            ca, sa, ce, se = math.cos(ja), math.sin(ja), math.cos(je), math.sin(je)
            _leaf_blade(m, (cx + ca * ce * rx * rr, cy + sa * ce * ry * rr, cz + se * rz * rr),
                        math.degrees(ja) - 90.0 + 70.0 * (_h(seed, i, j, 4) - 0.5),
                        -math.degrees(je) - droop * (0.3 + 0.7 * _h(seed, i, j, 5)),
                        360.0 * _h(seed, i, j, 6),
                        size * (0.70 + 0.60 * _h(seed, i, j, 7)))


def _twigs(m, centre, radii, count, seed, r0=7.0):
    """Short branches from the canopy heart to its shell, so the leaves have
    something to hang from where the eye can see between clumps."""
    cx, cy, cz = centre
    rx, ry, rz = radii
    for i in range(count):
        a = i * 2.3999632
        el = -0.5 + 1.4 * _h(seed, i, 1)
        ca, sa, ce, se = math.cos(a), math.sin(a), math.cos(el), math.sin(el)
        f = 0.55 + 0.40 * _h(seed, i, 2)
        m.tube([(cx, cy, cz - rz * 0.25), (cx + ca * ce * rx * f * 0.5, cy + sa * ce * ry * f * 0.5, cz + se * rz * f * 0.5),
                (cx + ca * ce * rx * f, cy + sa * ce * ry * f, cz + se * rz * f)],
               [r0, r0 * 0.6, r0 * 0.3], sides=5)


def _petal_ring(m, centre, n, size, seed, tilt=48.0, z=0.0):
    """A small open flower: petals as blades around a centre, not a sphere."""
    cx, cy, cz = centre
    for i in range(n):
        a = 2.0 * math.pi * i / n + _h(seed, i, 9) * 0.4
        _leaf_blade(m, (cx + math.cos(a) * size * 0.18, cy + math.sin(a) * size * 0.18, cz + z),
                    math.degrees(a) - 90.0, -tilt - 16.0 * _h(seed, i, 8), 0.0, size)

def _heart_pts(scale, n=48, z=0.0):
    out = []
    for i in range(n + 1):
        t = 2.0 * math.pi * i / n
        x = 16.0 * math.sin(t) ** 3
        y = (13.0 * math.cos(t) - 5.0 * math.cos(2 * t) - 2.0 * math.cos(3 * t) - math.cos(4 * t))
        out.append((x * scale, 0.0, z + y * scale))
    return out


def _spiral_pts(r0, turns, n, decay, plane="xz"):
    out = []
    for i in range(n):
        t = i / float(n - 1)
        a = t * turns * 2.0 * math.pi
        r = r0 * math.exp(-decay * t)
        if plane == "xz":
            out.append((math.cos(a) * r, 0.0, math.sin(a) * r))
        else:
            out.append((math.cos(a) * r, math.sin(a) * r, 0.0))
    return out


# ==========================================================================
# GROUND
# ==========================================================================


def cobble_slab(ctx, variant):
    """An irregular paving stone: 7-sided plan, domed and worn top, 14 uu thick."""
    m = ctx.mesh("cobble_slab_%d" % variant)
    n = 7
    poly = []
    for i in range(n):
        a = 2.0 * math.pi * i / n + (_h(variant, i, 1) - 0.5) * 0.4
        r = 50.0 * (0.78 + 0.24 * _h(variant, i, 2))
        poly.append((math.cos(a) * r, math.sin(a) * r))
    m.extrude(poly, 14.0)
    m.subdivide(2)
    m.perlin(2.2, 0.06, seed=100 + variant)
    m.smooth(1, 0.25)
    m.split_normals(50.0)
    return m


def portal_disc(ctx):
    m = ctx.mesh("portal_disc")
    m.revolve([(0.0, 0.0), (630.0, 0.0), (630.0, 4.0), (0.0, 4.0)], steps=96)
    m.box_uvs(1260.0)
    return m


def portal_ring(ctx):
    m = ctx.mesh("portal_ring")
    m.torus(600.0, 7.0, at=(0, 0, 7.0), major=96, minor=10)
    return m


# ==========================================================================
# TREES AND FOLIAGE
# ==========================================================================


def _bent_path(h, lean, sway, n=14, base_z=-80.0):
    pts = []
    for i in range(n):
        t = i / float(n - 1)
        pts.append((lean * t * t + sway * math.sin(t * 3.0) * 0.35,
                    sway * 0.3 * math.sin(t * 2.2 + 1.0),
                    base_z + (h - base_z) * t))
    return pts


def _trunk(ctx, name, h, r_base, r_top, lean, seed, roots=6, sides=22):
    m = ctx.mesh(name)
    path = _bent_path(h, lean, 60.0, n=14)
    radii = [r_base * (1.0 - 0.55 * (i / 13.0)) + (r_base * 1.3 - r_base) * math.exp(-i * 0.9)
             for i in range(14)]
    radii[-1] = r_top
    m.tube(path, radii, sides=sides)
    for k in range(roots):
        a = 2.0 * math.pi * k / roots + _h(seed, k, 1) * 0.6
        rr = r_base * 1.15
        m.tube([(math.cos(a) * rr * 0.55, math.sin(a) * rr * 0.55, 40.0),
                (math.cos(a) * rr * 1.25, math.sin(a) * rr * 1.25, -20.0),
                (math.cos(a) * rr * 2.0, math.sin(a) * rr * 2.0, -70.0)],
               [r_base * 0.42, r_base * 0.30, r_base * 0.16], sides=9)
    m.perlin(r_base * 0.06, 0.012, seed=seed)          # bark furrows
    m.perlin(r_base * 0.018, 0.05, seed=seed + 5)      # fine bark
    m.subdivide(1)
    m.split_normals(60.0)
    return m, path


def _limb(m, start, direction, length, r0, depth, seed):
    pts, rr = [], []
    for i in range(6):
        t = i / 5.0
        pts.append((start[0] + direction[0] * length * t, start[1] + direction[1] * length * t,
                    start[2] + direction[2] * length * t + 0.25 * length * t * t))
        rr.append(r0 * (1.0 - 0.62 * t))
    m.tube(pts, rr, sides=8)
    if depth >= 2:
        return
    for s in (-1, 1):
        a = 0.8 * s + (_h(seed, depth, s) - 0.5) * 0.5
        nd = (direction[0] * math.cos(a) - direction[1] * math.sin(a),
              direction[0] * math.sin(a) + direction[1] * math.cos(a), direction[2] * 0.6 + 0.3)
        L = math.sqrt(sum(c * c for c in nd)) or 1.0
        _limb(m, pts[-1], (nd[0] / L, nd[1] / L, nd[2] / L), length * 0.66, r0 * 0.55, depth + 1, seed + 3)


def tree_clock_trunk(ctx):
    """The right-edge tree: 20 m of furrowed trunk leaning into frame (+X),
    buttress roots, four boughs high up. Clocks and vines are separate assets
    so the layout can place them against the bole."""
    m, path = _trunk(ctx, "tree_clock_trunk", 2000.0, 170.0, 95.0, 260.0, seed=31, roots=7, sides=26)
    for k, (ang, z, ln) in enumerate(((0.3, 1150.0, 620.0), (2.3, 1400.0, 560.0), (4.2, 1600.0, 640.0),
                                      (1.4, 1800.0, 520.0), (3.3, 900.0, 420.0))):
        p = path[int(len(path) * z / 2000.0)]
        _limb(m, (p[0], p[1], z), (math.cos(ang) * 0.85, math.sin(ang) * 0.85, 0.40), ln, 88.0, 0, 40 + k)
    return m


def tree_mature_trunk(ctx):
    """The left framing tree and the garden trees: 14 m, heavier, three limbs
    spreading into the crown."""
    m, path = _trunk(ctx, "tree_mature_trunk", 1400.0, 160.0, 100.0, -120.0, seed=57, roots=6)
    for k, (ang, z, ln) in enumerate(((0.6, 900.0, 560.0), (2.7, 1000.0, 600.0), (4.6, 1100.0, 540.0), (1.7, 760.0, 440.0))):
        p = path[int(len(path) * z / 1400.0)]
        _limb(m, (p[0], p[1], z), (math.cos(ang) * 0.8, math.sin(ang) * 0.8, 0.50), ln, 76.0, 0, 60 + k)
    return m


def canopy_large(ctx):
    """A ~10 m garden canopy: a dark interior core, twigs, and three asymmetric
    leaf lobes of clumped blades. The silhouette is leaves, not spheres."""
    m = ctx.mesh("canopy_large")
    for (x, y, z, r) in ((0, 0, 30, 175), (200, 90, -50, 130), (-190, 130, 10, 140), (60, -200, -30, 125)):
        m.sphere(r, at=(x, y, z), steps=10)
    m.perlin(34.0, 0.005, seed=11)
    m.smooth(1, 0.3)
    _twigs(m, (0, 0, 20), (430, 400, 360), 16, 1101, r0=9.0)
    for k, (c, rad, n, sz) in enumerate((((30, 20, 60), (470, 430, 400), 300, 62.0),
                                         ((-230, 150, -40), (300, 290, 260), 220, 56.0),
                                         ((180, -170, -20), (280, 270, 240), 210, 56.0),
                                         ((30, 20, 40), (330, 300, 280), 200, 52.0))):
        _leaf_shell(m, c, rad, n, sz, 1110 + k, elev=(-0.7, 1.0), jitter=0.30, clump=3)
    m.split_normals(62.0)
    return m


def blossom_cluster(ctx):
    """A blossom clump ~1.8 m: leaf clumps carrying open five-petal flowers."""
    m = ctx.mesh("blossom_cluster")
    for i in range(5):
        a = i * 2.3999632
        m.sphere(22.0 + 10.0 * _h(3, i, 1), at=(math.cos(a) * 52.0, math.sin(a) * 52.0, 40.0 * _h(3, i, 2)), steps=9)
    m.perlin(6.0, 0.035, seed=21)
    _leaf_shell(m, (0, 0, 30), (86, 100, 84), 150, 23.0, 2110, elev=(-0.5, 1.0), jitter=0.26, clump=3, droop=22.0)
    for i in range(9):
        a = i * 2.3999632
        el = 0.1 + 0.8 * _h(3, i, 5)
        _petal_ring(m, (math.cos(a) * math.cos(el) * 78.0, math.sin(a) * math.cos(el) * 88.0, 34.0 + math.sin(el) * 70.0),
                    5, 24.0 + 8.0 * _h(3, i, 6), 2200 + i)
    m.split_normals(58.0)
    return m


def hedge_mass(ctx):
    """An informal hedge mass ~6 m: a lumpy core under clumped leaf cover."""
    m = ctx.mesh("hedge_mass")
    for (x, y, z, r) in ((0, 0, 120, 78), (150, 50, 100, 60), (-135, 80, 110, 62), (55, -135, 95, 60)):
        m.sphere(r, at=(x, y, z), steps=10)
    m.scale(1.0, 1.0, 0.78)
    m.perlin(16.0, 0.009, seed=71)
    m.smooth(1, 0.25)
    for k, (c, rad, n) in enumerate((((0, 0, 105), (290, 255, 150), 260, ),
                                     ((160, 60, 95), (170, 150, 110), 140),
                                     ((-150, 90, 100), (175, 155, 112), 140),
                                     ((60, -140, 92), (165, 145, 108), 130),
                                     ((0, 0, 100), (240, 210, 130), 180))):
        _leaf_shell(m, c[0:3] if len(c) > 2 else c, rad, n * 2, 24.0, 7100 + k, elev=(-0.4, 1.0), jitter=0.26, clump=3, droop=20.0)
    m.split_normals(58.0)
    return m


def vine_hanging(ctx):
    """Hanging vines: five swaying strands with leaf clumps, 6 m drop."""
    m = ctx.mesh("vine_hanging")
    for k in range(9):
        a = 2.0 * math.pi * k / 9
        pts, rr = [], []
        for i in range(14):
            t = i / 13.0
            pts.append((math.cos(a) * 70.0 + 30.0 * math.sin(t * 6.0 + k),
                        math.sin(a) * 70.0 + 24.0 * math.cos(t * 5.0 + k), -(520.0 + 160.0 * _h(k, 9)) * t))
            rr.append(4.5 - 2.8 * t)
        m.tube(pts, rr, sides=5)
        for i in range(1, 14, 2):
            leaf = [(0, 0), (7, 6), (9, 16), (5, 26), (0, 30), (-5, 26), (-9, 16), (-7, 6)]
            m.extrude(leaf, 1.2, at=(pts[i][0] + 6.0, pts[i][1], pts[i][2]), rot=(60.0 + 30.0 * _h(k, i, 2), 360.0 * _h(k, i, 3), 0.0))
            m.sphere(9.0 + 5.0 * _h(k, i, 1), at=(pts[i][0] - 4.0, pts[i][1] + 3.0, pts[i][2] - 6.0), steps=6)
    m.perlin(5.0, 0.03, seed=81)
    return m


def ivy_drape(ctx):
    m = ctx.mesh("ivy_drape")
    for k in range(6):
        a = 2.0 * math.pi * k / 6
        pts, rr = [], []
        for i in range(8):
            t = i / 7.0
            pts.append((math.cos(a) * 75.0 + 25.0 * math.sin(t * 5.0 + k),
                        math.sin(a) * 75.0 + 20.0 * math.cos(t * 4.0 + k), -420.0 * t))
            rr.append(5.0 - 2.5 * t)
        m.tube(pts, rr, sides=6)
        for i in range(8):
            m.sphere(26.0 + 10.0 * _h(k, i, 2), at=(pts[i][0] + 10.0, pts[i][1] + 8.0, pts[i][2]), steps=8)
    m.perlin(6.0, 0.03, seed=91)
    return m


def heart_topiary(ctx):
    """The heart topiary, ~10 m: the heart armature stays exactly where it is;
    its surface becomes clipped foliage with roses along the crown."""
    m = ctx.mesh("heart_topiary")
    pts, rr = [], []
    N = 96
    for i in range(N + 1):
        t = 2.0 * math.pi * i / N
        x = 16.0 * math.sin(t) ** 3
        y = 13.0 * math.cos(t) - 5.0 * math.cos(2 * t) - 2.0 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((x * 30.0, 0.0, y * 30.0 + 470.0))
        rr.append(52.0)
    m.tube(pts, rr, sides=12)
    for i in range(0, N, 2):
        t = 2.0 * math.pi * i / N
        x = 16.0 * math.sin(t) ** 3
        y = 13.0 * math.cos(t) - 5.0 * math.cos(2 * t) - 2.0 * math.cos(3 * t) - math.cos(4 * t)
        _leaf_shell(m, (x * 30.0, 0.0, y * 30.0 + 470.0), (66.0, 60.0, 66.0), 26, 22.0,
                    24400 + i, elev=(-0.9, 1.0), jitter=0.12, clump=3, droop=16.0)
    for i in range(14):
        t = 2.0 * math.pi * (i + 0.3) / 14.0
        x = 16.0 * math.sin(t) ** 3
        y = 13.0 * math.cos(t) - 5.0 * math.cos(2 * t) - 2.0 * math.cos(3 * t) - math.cos(4 * t)
        _cup(m, 0.34, (x * 30.0, -46.0, y * 30.0 + 470.0), 90.0, -20.0 + 40.0 * _h(244, i, 1))
    m.split_normals(58.0)
    return m


def floral_arch(ctx):
    """A real hoop of vine over the path: the structural arc, four wrapping
    strands, leaf clumps along it, posts at the feet."""
    m = ctx.mesh("floral_arch")
    R = 500.0
    arc = [(math.cos(math.pi * i / 36) * R, 0.0, math.sin(math.pi * i / 36) * R + 120.0) for i in range(37)]
    m.tube(arc, [40.0] * 37, sides=10)
    for w in range(4):
        pts, rr = [], []
        for i in range(37):
            t = i / 36.0
            a = math.pi * t
            wob = 34.0 * math.sin(t * 14.0 + w * 1.7)
            pts.append((math.cos(a) * (R + wob), (w - 1.5) * 34.0 + 22.0 * math.sin(t * 9.0 + w),
                        math.sin(a) * (R + wob) + 120.0))
            rr.append(12.0)
        m.tube(pts, rr, sides=6)
    for i in range(26):
        t = _h(7, i, 1)
        a = math.pi * t
        m.sphere(38.0 + 26.0 * _h(7, i, 2),
                 at=(math.cos(a) * (R + (_h(7, i, 3) - 0.5) * 70.0), (_h(7, i, 4) - 0.5) * 120.0,
                     math.sin(a) * (R + (_h(7, i, 5) - 0.5) * 70.0) + 120.0), steps=9)
    for s in (-1, 1):
        m.cylinder(34.0, 130.0, at=(s * R, 0.0, 0.0), steps=12)
    m.perlin(9.0, 0.02, seed=111)
    m.subdivide(1)
    return m


# ==========================================================================
# FLOWERS
# ==========================================================================


def _cup(m, s, at, yaw, tilt):
    prof = [(0.0, 0.0), (24.0 * s, 6.0 * s), (40.0 * s, 26.0 * s), (46.0 * s, 50.0 * s), (42.0 * s, 52.0 * s),
            (30.0 * s, 34.0 * s), (14.0 * s, 14.0 * s), (0.0, 12.0 * s)]
    m.revolve(prof, steps=18, at=at, rot=(tilt, yaw, 0.0))


def rose_bloom(ctx):
    """Three nested cupped whorls on a stem with two leaves — a rose reads by
    its spiral, and the spiral is the offset between the whorls."""
    m = ctx.mesh("rose_bloom")
    m.tube([(0, 0, 0), (6, 0, 40), (10, 4, 80)], [5.0, 4.0, 3.0], sides=6)
    _cup(m, 1.0, (10, 4, 80), 0.0, 6.0)
    _cup(m, 0.72, (10, 4, 92), 25.0, -4.0)
    _cup(m, 0.46, (10, 4, 104), 50.0, 3.0)
    m.sphere(10.0, at=(10, 4, 112), steps=8)
    for k, yaw in enumerate((40.0, 200.0)):
        leaf = [(0, 0), (16, 12), (20, 32), (10, 52), (0, 60), (-10, 52), (-20, 32), (-16, 12)]
        m.extrude(leaf, 2.0, at=(4 + 2 * k, 2, 30.0 + 18.0 * k), rot=(60.0, yaw, 0.0))
    m.perlin(1.6, 0.06, seed=121)
    m.subdivide(1)
    m.smooth(1, 0.2)
    return m


def flower_cluster(ctx):
    """Seven five-petal flowers on a low leafy mound, ~1.6 m across."""
    m = ctx.mesh("flower_cluster")
    m.sphere(70.0, at=(0, 0, -30.0), steps=10)
    m.scale(1.3, 1.2, 0.6)
    for i in range(7):
        a = i * 2.39996
        cx, cy = math.cos(a) * 45.0 * _h(5, i, 1) + 10.0, math.sin(a) * 45.0 * _h(5, i, 2)
        h = 40.0 + 30.0 * _h(5, i, 3)
        m.tube([(cx, cy, 0.0), (cx + 4, cy, h)], [2.5, 1.8], sides=5)
        for p in range(5):
            petal = [(0, 0), (9, 8), (7, 24), (0, 30), (-7, 24), (-9, 8)]
            m.extrude(petal, 1.5, at=(cx + 4, cy, h), rot=(-25.0, 72.0 * p + 20.0 * i, 0.0))
        m.sphere(5.0, at=(cx + 4, cy, h + 3), steps=6)
    m.perlin(1.5, 0.08, seed=131)
    return m


# ==========================================================================
# MUSHROOMS
# ==========================================================================


def _mushroom(ctx, name, height, cap_w, seed, gills=36, spots=7, lean=0.18):
    """Curved swelling stem, a cap with rolled rim, gills under it, spots on top."""
    m = ctx.mesh(name)
    stem_h = height * 0.72
    r0 = cap_w * 0.13
    path = [(lean * stem_h * (i / 9.0) ** 2, 0.0, -10.0 + stem_h * i / 9.0) for i in range(10)]
    radii = [r0 * (1.0 + 0.9 * math.exp(-i * 0.7)) * (1.0 - 0.2 * i / 9.0) for i in range(10)]
    m.tube(path, radii, sides=18)
    top = path[-1]
    # annulus skirt
    m.revolve([(r0 * 0.9, 0.0), (r0 * 1.9, -8.0 * height / 300.0), (r0 * 1.8, -22.0 * height / 300.0), (r0 * 0.9, -16.0 * height / 300.0)],
              steps=20, at=(top[0] - lean * stem_h * 0.15, 0.0, stem_h * 0.62))
    R = cap_w * 0.5
    ch = height * 0.28
    cap = [(0.0, ch), (0.28 * R, ch * 0.96), (0.56 * R, ch * 0.82), (0.80 * R, ch * 0.58), (0.95 * R, ch * 0.30),
           (1.00 * R, ch * 0.10), (0.97 * R, 0.0), (0.90 * R, -ch * 0.02), (0.88 * R, ch * 0.06), (0.62 * R, ch * 0.10),
           (0.30 * R, ch * 0.12), (r0 * 1.1, ch * 0.12), (r0 * 1.1, ch * 0.02), (0.0, ch * 0.02)]
    m.revolve(cap, steps=40, at=(top[0], top[1], stem_h - ch * 0.05))
    for g in range(gills):
        a = 360.0 * g / gills
        m.extrude([(r0 * 1.15, 0.0), (0.86 * R, 0.0), (0.86 * R, -ch * 0.05), (r0 * 1.15, -ch * 0.02)], 1.2 * height / 300.0,
                  at=(top[0], top[1], stem_h + ch * 0.06), rot=(0.0, a, 90.0))   # roll: the blade's depth hangs DOWN (pitch put it vertical, inside the stem)
    m.perlin(R * 0.025, 0.05 * 300.0 / height, seed=seed)
    m.subdivide(1)
    m.smooth(1, 0.2)
    m.split_normals(55.0)
    return m, top, stem_h, R, ch


def mushroom_small(ctx):
    m, top, sh, R, ch = _mushroom(ctx, "mushroom_small", 300.0, 240.0, 141, gills=28, spots=5)
    _spots(m, top, sh, R, ch, 5, 141)
    return m


def mushroom_medium(ctx):
    m, top, sh, R, ch = _mushroom(ctx, "mushroom_medium", 600.0, 520.0, 151, gills=36, spots=7)
    _spots(m, top, sh, R, ch, 7, 151)
    return m


def mushroom_landmark(ctx):
    m, top, sh, R, ch = _mushroom(ctx, "mushroom_landmark", 1700.0, 1300.0, 161, gills=48, spots=9, lean=0.12)
    _spots(m, top, sh, R, ch, 9, 161)
    return m


def _spots(m, top, sh, R, ch, n, seed):
    for i in range(n):
        a = i * 2.39996 + 0.5
        rr = 0.22 + 0.58 * ((i * 37) % n) / float(n)
        x, y = top[0] + math.cos(a) * R * rr, top[1] + math.sin(a) * R * rr
        z = sh + ch * (0.98 - rr * rr * 0.6)
        m.sphere(R * 0.11 * (1.0 - 0.3 * rr), at=(x, y, z), steps=8)
    m.scale(1.0, 1.0, 1.0)


# ==========================================================================
# THE GATE
# ==========================================================================


def gate_pier(ctx):
    """An ivory pier: octagonal plinth, panelled shaft, moulded cap, ball base."""
    m = ctx.mesh("gate_pier")
    octo = [(math.cos(math.pi / 8 + math.pi * i / 4) * 92.0, math.sin(math.pi / 8 + math.pi * i / 4) * 92.0) for i in range(8)]
    m.extrude(octo, 60.0)
    m.extrude([(p[0] * 0.86, p[1] * 0.86) for p in octo], 30.0, at=(0, 0, 60.0))
    m.box(120.0, 120.0, 430.0, at=(0, 0, 90.0 + 215.0), chamfer=4.0)
    for yaw in (0.0, 90.0, 180.0, 270.0):
        m.box(76.0, 8.0, 330.0, at=(math.sin(math.radians(yaw)) * -64.0, math.cos(math.radians(yaw)) * 64.0, 300.0),
              rot=(0.0, yaw, 0.0), chamfer=2.0)
    m.revolve([(0.0, 520.0), (78.0, 520.0), (84.0, 540.0), (76.0, 556.0), (88.0, 576.0), (88.0, 596.0), (60.0, 612.0),
               (30.0, 640.0), (0.0, 650.0)], steps=24)
    return m


def gate_leaf(ctx):
    """One wrought leaf, hinged at x = 0, 400 wide and 560 tall: a frame,
    seven pickets with collars and spear heads, four spiral scrolls, a heart."""
    m = ctx.mesh("gate_leaf")
    W, H = 400.0, 560.0
    for z in (20.0, 250.0, 520.0):
        m.box(W, 8.0, 10.0, at=(W * 0.5, 0.0, z))
    for x in (5.0, W - 5.0):
        m.box(10.0, 8.0, H, at=(x, 0.0, H * 0.5))
    for k in range(7):
        x = W * (k + 0.5) / 7.0
        m.tube([(x, 0.0, 12.0), (x, 0.0, 500.0)], [5.5, 5.5], sides=5)
        for z in (120.0, 380.0):
            m.revolve([(6.0, -4.0), (10.0, -2.0), (10.0, 2.0), (6.0, 4.0)], steps=8, at=(x, 0.0, z))
        m.revolve([(0.0, 0.0), (8.0, 6.0), (9.0, 22.0), (5.0, 40.0), (0.0, 70.0)], steps=10, at=(x, 0.0, 500.0))
    for (cx, cz, sc, flip) in ((110.0, 400.0, 1.0, 1), (290.0, 400.0, 1.0, -1), (110.0, 140.0, 0.8, -1), (290.0, 140.0, 0.8, 1)):
        pts = _spiral_pts(80.0 * sc, 1.9, 28, 1.3)
        pts = [(cx + flip * p[0], 0.0, cz + p[2]) for p in pts]
        m.tube(pts, [4.5 - 2.2 * i / 27.0 for i in range(28)], sides=6)
    hp = [(W * 0.5 + p[0] * 2.4, 0.0, 270.0 + p[2] * 2.4) for p in _heart_pts(1.0, n=40)]
    m.tube(hp, [5.0] * len(hp), sides=6)
    return m


def gate_finial_heart(ctx):
    m = ctx.mesh("gate_finial_heart")
    m.revolve([(0.0, 0.0), (22.0, 0.0), (22.0, 10.0), (12.0, 18.0), (12.0, 26.0)], steps=12)
    hp = [(p[0] * 2.6, 0.0, 70.0 + p[2] * 2.6) for p in _heart_pts(1.0, n=44)]
    m.tube(hp, [6.0] * len(hp), sides=8)
    m.torus(52.0, 4.0, at=(0, 0, 70.0), rot=(90.0, 0.0, 0.0), major=32, minor=6)
    return m


def gate_finial_ball(ctx):
    m = ctx.mesh("gate_finial_ball")
    m.revolve([(0.0, 0.0), (24.0, 0.0), (24.0, 10.0), (14.0, 18.0), (16.0, 30.0), (34.0, 52.0), (40.0, 74.0),
               (34.0, 96.0), (16.0, 112.0), (10.0, 120.0), (0.0, 128.0)], steps=24)
    m.subdivide(1)
    return m


def garden_wall(ctx):
    """A low ivory wall, 5 m long, coursed, with a rolled cap."""
    m = ctx.mesh("garden_wall")
    courses = 5
    for c in range(courses):
        for k in range(4):
            w = 125.0 if k < 3 else 115.0
            x = -250.0 + (62.5 if c % 2 else 0.0) + 125.0 * k + w * 0.5
            if x + w * 0.5 > 250.0:
                w -= (x + w * 0.5 - 250.0)
                x = 250.0 - w * 0.5
            m.box(w, 90.0 + 4.0 * _h(c, k, 1), 48.0, at=(x, 0.0, 24.0 + 48.0 * c), chamfer=3.0)
    m.box(510.0, 100.0, 22.0, at=(0, 0, 251.0), chamfer=6.0)
    m.perlin(1.2, 0.05, seed=171)
    return m


def garden_urn(ctx):
    m = ctx.mesh("garden_urn")
    m.revolve([(0.0, 0.0), (40.0, 0.0), (42.0, 12.0), (28.0, 24.0), (34.0, 36.0), (60.0, 72.0), (74.0, 112.0),
               (66.0, 150.0), (56.0, 170.0), (72.0, 184.0), (80.0, 196.0), (72.0, 200.0), (62.0, 188.0),
               (50.0, 170.0), (0.0, 160.0)], steps=28)
    for s in (-1, 1):
        m.torus(28.0, 7.0, at=(s * 72.0, 0.0, 150.0), rot=(0.0, 0.0, 90.0), major=18, minor=7, arc=220.0)
    m.subdivide(1)
    return m


# ==========================================================================
# STAIRS, TERRACE, COLUMNS, ARCH
# ==========================================================================


def stairs_broad(ctx):
    m = ctx.mesh("stairs_broad")
    W, rise, run, n = 700.0, 26.0, 50.0, 7
    for k in range(n):
        d = run * (n - k)
        m.box(W, d, rise, at=(0.0, run * k + d * 0.5, rise * (k + 0.5)), chamfer=2.0)
        m.tube([(-W * 0.5, run * k, rise * (k + 1)), (W * 0.5, run * k, rise * (k + 1))], [4.0, 4.0], sides=6)
    m.perlin(0.8, 0.05, seed=181)
    return m


def balustrade(ctx):
    m = ctx.mesh("balustrade")
    m.box(350.0, 36.0, 12.0, at=(0, 0, 6.0), chamfer=3.0)
    m.box(350.0, 30.0, 14.0, at=(0, 0, 118.0), chamfer=4.0)
    for k in range(5):
        x = -140.0 + 70.0 * k
        m.revolve([(0.0, 12.0), (14.0, 12.0), (14.0, 20.0), (9.0, 28.0), (12.0, 44.0), (16.0, 66.0), (12.0, 88.0),
                   (8.0, 100.0), (12.0, 108.0), (12.0, 112.0), (0.0, 112.0)], steps=12, at=(x, 0.0, 0.0))
    return m


def garden_lawn(ctx):
    """The garden floor: one 60 x 72 m slab per side, its top a 48 x 48 grid
    displaced by low-frequency noise (a lawn's gentle rise and settle, +/-9 cm)
    so raking sunlight and the sward normal map have something to shade. Sits
    2 cm under the beds and walls; the moss ground slab stays beneath as
    terrain. A flat plane here is the founder's "flat colour" in one actor."""
    m = ctx.mesh("garden_lawn")
    m.box(6000.0, 7200.0, 24.0, at=(0, 0, -12.0), steps=48)
    m.perlin(9.0, 0.0025, seed=31)
    m.box_uvs(200.0)
    return m


def terrace_platform(ctx):
    m = ctx.mesh("terrace_platform")
    m.box(1400.0, 700.0, 120.0, at=(0, 0, 60.0), chamfer=8.0)
    m.box(1440.0, 740.0, 20.0, at=(0, 0, 130.0), chamfer=5.0)
    return m


def column_ornate(ctx):
    m = ctx.mesh("column_ornate")
    m.revolve([(0.0, 0.0), (74.0, 0.0), (74.0, 18.0), (60.0, 30.0), (52.0, 40.0), (48.0, 48.0)], steps=24)
    m.revolve([(48.0, 48.0), (44.0, 300.0), (42.0, 600.0), (40.0, 840.0)], steps=24)
    for k in range(20):
        a = 360.0 * k / 20.0
        m.tube([(math.cos(math.radians(a)) * 45.0, math.sin(math.radians(a)) * 45.0, 60.0),
                (math.cos(math.radians(a)) * 41.0, math.sin(math.radians(a)) * 41.0, 830.0)], [4.0, 3.6], sides=5)
    m.revolve([(40.0, 840.0), (48.0, 852.0), (46.0, 870.0), (66.0, 900.0), (76.0, 930.0), (76.0, 950.0), (0.0, 950.0)], steps=24)
    for k in range(4):
        pts = _spiral_pts(26.0, 1.4, 16, 1.2)
        pts = [(math.cos(math.radians(90 * k)) * (62.0 + p[0]) , math.sin(math.radians(90 * k)) * (62.0 + p[0]), 905.0 + p[2]) for p in pts]
        m.tube(pts, [5.0 - 2.0 * i / 15.0 for i in range(16)], sides=5)
    return m


def arch_stone(ctx):
    m = ctx.mesh("arch_stone")
    R, T, D, n = 500.0, 70.0, 120.0, 15
    for k in range(n):
        a = math.pi * (k + 0.5) / n
        m.box(2.0 * math.pi * R / n * 0.94, D, T, at=(math.cos(a) * R, 0.0, math.sin(a) * R + 300.0),
              rot=(90.0 - math.degrees(a), 0.0, 0.0), chamfer=4.0)
    m.box(90.0, D + 16.0, T + 40.0, at=(0.0, 0.0, R + 300.0 + 10.0), chamfer=5.0)
    for s in (-1, 1):
        m.box(T, D, 300.0, at=(s * R, 0.0, 150.0), chamfer=4.0)
        m.box(T + 30.0, D + 24.0, 24.0, at=(s * R, 0.0, 300.0), chamfer=4.0)
    return m


# ==========================================================================
# THE CASTLE KIT
# ==========================================================================


def castle_tower(ctx):
    """A round tower, 17 m at scale 1: entasis, plinth roll, two string
    courses, a machicolation ring and two rows of arched window frames."""
    m = ctx.mesh("castle_tower")
    prof = []
    for i in range(13):
        t = i / 12.0
        prof.append((260.0 * (1.0 - 0.05 * math.sin(math.pi * t) - 0.10 * t), 1700.0 * t))
    m.revolve([(0.0, 0.0)] + prof + [(0.0, 1700.0)], steps=36)
    m.torus(262.0, 26.0, at=(0, 0, 40.0), major=36, minor=8)
    for z, r in ((620.0, 250.0), (1180.0, 236.0)):
        m.revolve([(r - 8.0, z), (r + 22.0, z + 12.0), (r + 24.0, z + 30.0), (r - 8.0, z + 42.0)], steps=36)
    for k in range(16):
        a = 2.0 * math.pi * k / 16
        m.box(44.0, 44.0, 70.0, at=(math.cos(a) * 246.0, math.sin(a) * 246.0, 1560.0), rot=(0.0, math.degrees(a), 0.0), chamfer=3.0)
    m.revolve([(230.0, 1600.0), (272.0, 1620.0), (272.0, 1660.0), (230.0, 1700.0)], steps=36)
    for row, z in ((0, 380.0), (1, 900.0)):
        for k in range(6):
            a = 2.0 * math.pi * (k + 0.5 * row) / 6
            r = 255.0 * (1.0 - 0.10 * z / 1700.0)
            x, y = math.cos(a) * r, math.sin(a) * r
            yaw = math.degrees(a)
            m.box(56.0, 12.0, 110.0, at=(x, y, z), rot=(0.0, yaw + 90.0, 0.0), chamfer=2.0)
            m.torus(26.0, 6.0, at=(x, y, z + 52.0), rot=(0.0, yaw + 90.0, 90.0), major=14, minor=5, arc=180.0)
            m.box(70.0, 16.0, 8.0, at=(x, y, z - 58.0), rot=(0.0, yaw + 90.0, 0.0))
    return m


def roof_ogee(ctx):
    """A fairy-tale roof: ogee shell, eave roll, scalloped courses, finial."""
    m = ctx.mesh("roof_ogee")
    R, H = 300.0, 700.0
    prof = [(0.0, 0.0)]
    for i in range(15):
        t = i / 14.0
        e = t * t * (3.0 - 2.0 * t)
        r = R * 0.96 + (6.0 - R * 0.96) * e + 0.34 * (R * 0.96 - 6.0) * math.sin(math.pi * t) * 0.5
        prof.append((max(r, 0.0), H * t + 14.0))
    prof.append((0.0, H + 14.0))
    m.revolve(prof, steps=36)
    m.torus(R * 0.93, 24.0, at=(0, 0, 16.0), major=36, minor=8)
    for c in range(7):
        t = c / 7.0
        i0 = 1 + int(t * 14)
        r0, z0 = prof[i0]
        if r0 < 20.0:
            continue
        m.revolve([(r0 * 0.99, 0.0), (r0 * 1.06, 6.0), (r0 * 1.05, 26.0), (r0 * 0.98, 34.0)], steps=36, at=(0, 0, z0))
    m.revolve([(0.0, 0.0), (18.0, 0.0), (12.0, 30.0), (22.0, 50.0), (0.0, 110.0)], steps=12, at=(0, 0, H + 10.0))
    m.perlin(2.0, 0.02, seed=201)
    return m


def roof_bell(ctx):
    m = ctx.mesh("roof_bell")
    R, H = 300.0, 560.0
    prof = [(0.0, 0.0)]
    for i in range(17):
        t = i / 16.0
        r = R * (math.cos(t * math.pi * 0.5) ** 0.72) * (1.0 + 0.3 * math.sin(math.pi * t) * (1.0 - t))
        prof.append((max(r, 0.0), H * t + 20.0))
    prof.append((0.0, H + 20.0))
    m.revolve(prof, steps=36)
    m.torus(R * 0.94, 26.0, at=(0, 0, 22.0), major=36, minor=8)
    for k in range(8):
        pts = [(r * 1.02 * math.cos(math.radians(45.0 * k)), r * 1.02 * math.sin(math.radians(45.0 * k)), z) for (r, z) in prof if r > 8.0]
        m.tube(pts, [10.0] * len(pts), sides=5)
    m.revolve([(0.0, 0.0), (20.0, 0.0), (14.0, 34.0), (26.0, 56.0), (0.0, 120.0)], steps=12, at=(0, 0, H + 16.0))
    return m


def roof_hip(ctx):
    m = ctx.mesh("roof_hip")
    m.revolve([(0.0, 0.0), (760.0, 0.0), (140.0, 420.0), (0.0, 420.0)], steps=4, rot=(0.0, 45.0, 0.0))
    m.scale(1.0, 0.68, 1.0)
    m.box(1300.0, 900.0, 28.0, at=(0, 0, 6.0), chamfer=6.0)
    for c in range(6):
        t = (c + 0.5) / 6.0
        m.box(1300.0 * (1.0 - 0.82 * t) + 40.0, 900.0 * (1.0 - 0.82 * t) + 40.0, 10.0, at=(0, 0, 420.0 * t), chamfer=3.0)
    return m


def castle_hall(ctx):
    """A palace hall, 12 x 8 x 9 m: coursed walls, a cornice, two rows of
    arched window frames with sills and a balcony band."""
    m = ctx.mesh("castle_hall")
    m.box(1200.0, 800.0, 900.0, at=(0, 0, 450.0), chamfer=8.0)
    m.box(1260.0, 860.0, 40.0, at=(0, 0, 900.0), chamfer=6.0)
    m.box(1240.0, 840.0, 24.0, at=(0, 0, 470.0), chamfer=4.0)
    for z in (300.0, 700.0):
        for k in range(5):
            x = -480.0 + 240.0 * k
            for s in (-1, 1):
                y = s * 404.0
                m.box(70.0, 12.0, 150.0, at=(x, y, z), chamfer=2.0)
                m.torus(34.0, 6.0, at=(x, y, z + 72.0), rot=(0.0, 0.0, 90.0), major=14, minor=5, arc=180.0)
                m.box(90.0, 20.0, 10.0, at=(x, y, z - 80.0))
        for s in (-1, 1):
            for k in range(3):
                y = -260.0 + 260.0 * k
                m.box(12.0, 70.0, 150.0, at=(s * 604.0, y, z), chamfer=2.0)
    for k in range(24):
        m.box(16.0, 16.0, 60.0, at=(-575.0 + 50.0 * k, 430.0, 970.0), chamfer=2.0)
    return m


def castle_dome(ctx):
    m = ctx.mesh("castle_dome")
    m.revolve([(0.0, 0.0), (300.0, 0.0), (300.0, 160.0), (0.0, 160.0)], steps=32)
    prof = [(0.0, 160.0)]
    for i in range(13):
        t = i / 12.0
        prof.append((max(300.0 * (math.cos(t * math.pi * 0.5) ** 0.72) * (1.0 + 0.08 * math.sin(math.pi * t)), 0.0), 160.0 + 420.0 * t))
    prof.append((0.0, 580.0))
    m.revolve(prof, steps=32)
    for k in range(12):
        pts = [(r * 1.02 * math.cos(math.radians(30.0 * k)), r * 1.02 * math.sin(math.radians(30.0 * k)), z) for (r, z) in prof if r > 8.0]
        m.tube(pts, [9.0] * len(pts), sides=5)
    m.revolve([(0.0, 0.0), (26.0, 0.0), (16.0, 40.0), (30.0, 60.0), (0.0, 130.0)], steps=12, at=(0, 0, 574.0))
    return m


def castle_bridge(ctx):
    m = ctx.mesh("castle_bridge")
    L, W = 900.0, 130.0
    deck = [(-L * 0.5 + L * i / 10.0, 0.0, 10.0 + 60.0 * (1.0 - (i / 5.0 - 1.0) ** 2)) for i in range(11)]
    for i in range(10):
        a, b = deck[i], deck[i + 1]
        m.box(L / 10.0 + 2.0, W, 22.0, at=((a[0] + b[0]) * 0.5, 0.0, (a[2] + b[2]) * 0.5), rot=(-math.degrees(math.atan2(b[2] - a[2], b[0] - a[0])), 0.0, 0.0))
    R = 300.0
    for k in range(11):
        a = math.pi * (k + 0.5) / 11
        m.box(2.0 * math.pi * R / 11 * 0.95, W, 40.0, at=(math.cos(a) * R, 0.0, math.sin(a) * R - 240.0), rot=(90.0 - math.degrees(a), 0.0, 0.0))
    for s in (-1, 1):
        m.tube([(p[0], s * (W * 0.5 - 8.0), p[2] + 70.0) for p in deck], [6.0] * 11, sides=6)
        for i in range(0, 11, 2):
            m.revolve([(0.0, 0.0), (9.0, 0.0), (9.0, 6.0), (5.0, 14.0), (8.0, 40.0), (5.0, 62.0), (7.0, 68.0)], steps=8,
                      at=(deck[i][0], s * (W * 0.5 - 8.0), deck[i][2] + 8.0))
    return m


def balcony_ring(ctx):
    m = ctx.mesh("balcony_ring")
    m.revolve([(230.0, 0.0), (320.0, 40.0), (330.0, 56.0), (330.0, 70.0), (230.0, 70.0)], steps=36)
    m.torus(322.0, 8.0, at=(0, 0, 150.0), major=36, minor=6)
    for k in range(24):
        a = 2.0 * math.pi * k / 24
        m.revolve([(0.0, 0.0), (10.0, 0.0), (10.0, 6.0), (6.0, 14.0), (10.0, 44.0), (12.0, 60.0), (7.0, 76.0), (9.0, 80.0)],
                  steps=8, at=(math.cos(a) * 316.0, math.sin(a) * 316.0, 70.0))
    return m


def tower_clock(ctx):
    """The garden clock tower: a drum, a cornice, an upper drum, window frames;
    the clock and the bell roof are placed by the layout."""
    m = ctx.mesh("tower_clock")
    m.revolve([(0.0, 0.0), (150.0, 0.0), (142.0, 700.0), (0.0, 700.0)], steps=28)
    m.torus(152.0, 16.0, at=(0, 0, 26.0), major=28, minor=7)
    m.revolve([(130.0, 700.0), (172.0, 712.0), (176.0, 740.0), (130.0, 760.0)], steps=28)
    m.revolve([(0.0, 760.0), (118.0, 760.0), (112.0, 1180.0), (0.0, 1180.0)], steps=28)
    m.revolve([(104.0, 1150.0), (140.0, 1160.0), (140.0, 1180.0), (104.0, 1190.0)], steps=28)
    for k in range(4):
        a = math.radians(90.0 * k + 45.0)
        m.box(50.0, 12.0, 120.0, at=(math.cos(a) * 146.0, math.sin(a) * 146.0, 420.0), rot=(0.0, 90.0 * k + 135.0, 0.0), chamfer=2.0)
        m.torus(24.0, 5.0, at=(math.cos(a) * 146.0, math.sin(a) * 146.0, 478.0), rot=(0.0, 90.0 * k + 135.0, 90.0), major=12, minor=5, arc=180.0)
    return m


# ==========================================================================
# PROPS
# ==========================================================================


def clock_ornate(ctx):
    """An ornate clock, 1.5 m across, facing -Y: moulded bezel, recessed dial,
    twelve raised markers, two pierced hands, four corner scrolls."""
    m = ctx.mesh("clock_ornate")
    m.revolve([(0.0, 0.0), (62.0, 0.0), (72.0, 4.0), (78.0, 12.0), (76.0, 22.0), (68.0, 28.0), (60.0, 24.0),
               (58.0, 14.0), (54.0, 10.0), (0.0, 10.0)], steps=36)
    for k in range(12):
        a = math.radians(30.0 * k)
        big = k % 3 == 0
        m.box(7.0 if big else 4.0, 16.0 if big else 10.0, 4.0, at=(math.cos(a) * 46.0, math.sin(a) * 46.0, 12.0), rot=(0.0, 30.0 * k + 90.0, 0.0))
    m.extrude([(-5.0, -10.0), (5.0, -10.0), (2.5, 30.0), (0.0, 44.0), (-2.5, 30.0)], 3.0, at=(0, 0, 14.0), rot=(0.0, 20.0, 0.0))
    m.extrude([(-4.0, -8.0), (4.0, -8.0), (2.0, 22.0), (0.0, 32.0), (-2.0, 22.0)], 3.0, at=(0, 0, 17.0), rot=(0.0, 130.0, 0.0))
    m.sphere(6.0, at=(0, 0, 18.0), steps=8)
    for k in range(4):
        pts = _spiral_pts(28.0, 1.6, 16, 1.2, plane="xy")
        a = math.radians(90.0 * k + 45.0)
        pts = [(math.cos(a) * 70.0 + p[0], math.sin(a) * 70.0 + p[1], 6.0) for p in pts]
        m.tube(pts, [4.0 - 1.8 * i / 15.0 for i in range(16)], sides=5)
    m.rotate(90.0, 0.0, 0.0)          # stand it up, face toward -Y
    return m


def key_ornate(ctx):
    m = ctx.mesh("key_ornate")
    hp = [(p[0] * 1.3, 0.0, 110.0 + p[2] * 1.3) for p in _heart_pts(1.0, n=40)]
    m.tube(hp, [5.0] * len(hp), sides=7)
    m.tube([(0, 0, 90.0), (0, 0, -30.0)], [5.5, 5.5], sides=8)
    for z in (80.0, 40.0, -10.0):
        m.revolve([(6.0, -3.0), (9.0, -1.5), (9.0, 1.5), (6.0, 3.0)], steps=10, at=(0, 0, z))
    m.box(5.0, 22.0, 22.0, at=(0, 13.0, -20.0))
    m.box(5.0, 10.0, 7.0, at=(0, 18.0, -6.0))
    m.box(5.0, 8.0, 6.0, at=(0, 22.0, -30.0))
    m.subdivide(1)
    return m


def tea_cup(ctx):
    m = ctx.mesh("tea_cup")
    m.revolve([(0.0, 0.0), (52.0, 0.0), (56.0, 12.0), (44.0, 20.0), (78.0, 70.0), (110.0, 150.0), (124.0, 230.0),
               (128.0, 250.0), (134.0, 258.0), (126.0, 262.0), (118.0, 248.0), (106.0, 160.0), (72.0, 76.0),
               (36.0, 36.0), (0.0, 34.0)], steps=40)
    m.torus(60.0, 13.0, at=(160.0, 0.0, 150.0), rot=(0.0, 0.0, 90.0), major=24, minor=9, arc=250.0)
    m.subdivide(1)
    return m


def tea_saucer(ctx):
    m = ctx.mesh("tea_saucer")
    m.revolve([(0.0, 0.0), (60.0, 0.0), (64.0, 8.0), (54.0, 12.0), (100.0, 18.0), (170.0, 36.0), (210.0, 48.0),
               (260.0, 56.0), (256.0, 62.0), (200.0, 52.0), (140.0, 38.0), (80.0, 28.0), (0.0, 26.0)], steps=48)
    m.subdivide(1)
    return m


def tea_plinth(ctx):
    m = ctx.mesh("tea_plinth")
    m.box(400.0, 400.0, 70.0, at=(0, 0, 35.0), chamfer=10.0)
    m.box(360.0, 360.0, 26.0, at=(0, 0, 83.0), chamfer=8.0)
    m.perlin(1.0, 0.05, seed=211)
    return m


def tea_pot(ctx):
    m = ctx.mesh("tea_pot")
    m.revolve([(0.0, 0.0), (60.0, 0.0), (66.0, 14.0), (52.0, 24.0), (96.0, 66.0), (132.0, 130.0), (138.0, 170.0),
               (114.0, 210.0), (82.0, 228.0), (80.0, 236.0), (0.0, 236.0)], steps=40)
    m.revolve([(0.0, 236.0), (82.0, 236.0), (78.0, 246.0), (56.0, 262.0), (26.0, 272.0), (18.0, 278.0), (28.0, 288.0),
               (20.0, 300.0), (0.0, 306.0)], steps=28)
    m.tube([(80.0, 0.0, 110.0), (124.0, 0.0, 128.0), (162.0, 0.0, 168.0), (182.0, 0.0, 218.0), (176.0, 0.0, 248.0)],
           [34.0, 28.0, 22.0, 17.0, 15.0], sides=12)
    m.torus(64.0, 14.0, at=(-160.0, 0.0, 150.0), rot=(0.0, 0.0, 90.0), major=24, minor=9, arc=260.0)
    m.subdivide(1)
    return m


def tea_heart(ctx):
    m = ctx.mesh("tea_heart")
    hp = [(p[0] * 1.6, 0.0, p[2] * 1.6) for p in _heart_pts(1.0, n=40)]
    m.tube(hp, [5.0] * len(hp), sides=7)
    m.rotate(0.0, 0.0, 0.0)
    return m


def sky_dome(ctx):
    """The Marble skyline: an inward-facing sphere 450 m out wearing the
    equirectangular panorama (unlit, 'is sky', masked below the horizon)."""
    m = ctx.mesh("sky_dome")
    m.sphere(45000.0, steps=48)
    return m


# ==========================================================================
# registry
# ==========================================================================

def mushroom_giant_gills(ctx):
    """The giant mushroom's underside: a pale gill ring (56 radial blades
    under the cap rim) and the thin underside skin between stem and rim. Same
    transform as `mushroom_giant`; its own material (MI_V2_MushCream)."""
    m = ctx.mesh("mushroom_giant_gills")
    stem_h = 1150.0
    R, ch = 1000.0, 420.0
    z = stem_h + ch * 0.10
    # the underside skin: a shallow revolved dish from the stem to the rim
    m.revolve([(200.0, 8.0), (0.30 * R, 10.0), (0.60 * R, 6.0), (0.84 * R, 0.0), (0.84 * R, -2.0),
               (0.60 * R, 2.0), (0.30 * R, 4.0), (200.0, 2.0)], steps=48, at=(30.0, 0.0, z))
    for g in range(56):
        a = 360.0 * g / 56
        m.extrude([(210.0, 0.0), (0.84 * R, 0.0), (0.84 * R, -22.0), (210.0, -9.0)], 5.0,
                  at=(30.0, 0.0, z), rot=(0.0, a, 90.0))   # roll: the blade's depth hangs DOWN (pitch put it vertical, inside the stem)
    m.perlin(6.0, 0.02, seed=353)
    m.split_normals(50.0)
    return m



RECIPES = {
    "portal_disc": (portal_disc, "vfx_portal", True, False),
    "portal_ring": (portal_ring, "vfx_portal", True, False),
    "tree_clock_trunk": (tree_clock_trunk, "trees", True, True),
    "tree_mature_trunk": (tree_mature_trunk, "trees", True, True),
    "canopy_large": (canopy_large, "trees", False, False),
    "blossom_cluster": (blossom_cluster, "flowers", False, False),
    "hedge_mass": (hedge_mass, "shrubs", False, False),
    "vine_hanging": (vine_hanging, "vines", False, False),
    "ivy_drape": (ivy_drape, "ivy", False, False),
    "heart_topiary": (heart_topiary, "topiary", False, True),
    "floral_arch": (floral_arch, "garden_arch", False, True),
    "rose_bloom": (rose_bloom, "roses", False, False),
    "flower_cluster": (flower_cluster, "flowers", False, False),
    "mushroom_small": (mushroom_small, "mush_small", True, True),
    "mushroom_medium": (mushroom_medium, "mush_medium", True, True),
    "mushroom_landmark": (mushroom_landmark, "mush_landmark", True, True),
    "gate_pier": (gate_pier, "gates", True, True),
    "gate_leaf": (gate_leaf, "gates", True, True),
    "gate_finial_heart": (gate_finial_heart, "gates", True, False),
    "gate_finial_ball": (gate_finial_ball, "gates", True, False),
    "garden_wall": (garden_wall, "gates", True, True),
    "garden_urn": (garden_urn, "garden_props", True, True),
    "stairs_broad": (stairs_broad, "stairs", True, True),
    "balustrade": (balustrade, "stairs", True, True),
    "terrace_platform": (terrace_platform, "stairs", True, True),
    "mushroom_giant_gills": (mushroom_giant_gills, "mush_landmark", True, False),
    "garden_lawn": (garden_lawn, "terrain", True, True),
    "column_ornate": (column_ornate, "castle", True, True),
    "arch_stone": (arch_stone, "castle", True, True),
    "castle_tower": (castle_tower, "castle", True, True),
    "castle_hall": (castle_hall, "castle", True, True),
    "castle_dome": (castle_dome, "castle", True, False),
    "castle_bridge": (castle_bridge, "bridges", True, True),
    "balcony_ring": (balcony_ring, "castle", True, False),
    "roof_ogee": (roof_ogee, "castle", True, False),
    "roof_bell": (roof_bell, "castle", True, False),
    "roof_hip": (roof_hip, "castle", True, False),
    "tower_clock": (tower_clock, "castle", True, True),
    "clock_ornate": (clock_ornate, "clocks", True, False),
    "key_ornate": (key_ornate, "keys", True, False),
    "tea_cup": (tea_cup, "tea", True, True),
    "tea_saucer": (tea_saucer, "tea", True, True),
    "tea_plinth": (tea_plinth, "tea", True, True),
    "tea_pot": (tea_pot, "tea", True, True),
    "tea_heart": (tea_heart, "tea", True, False),
    "sky_dome": (sky_dome, "sky", False, False),
}
COBBLE_VARIANTS = 4


#: WLV2_REUSE_ASSETS=1: an asset already saved under the V2 root is used as it
#: is instead of being rebuilt. The 83 meshes are deterministic and cost ~6
#: minutes of Geometry Script per run; during the World Partition recovery the
#: meshes are not what changed.
REUSE_ASSETS = os.environ.get("WLV2_REUSE_ASSETS", "0") == "1"


#: WLV2_REBUILD=key,key: rebuild these even when reuse is on -- the vegetation
#: pass changes ten recipes; the other 73 meshes are unchanged and cost minutes.
REBUILD_KEYS = set(k.strip() for k in os.environ.get("WLV2_REBUILD", "").split(",") if k.strip())


def _existing_asset(ctx, folder, key):
    if not REUSE_ASSETS or key in REBUILD_KEYS:
        return None
    path = F[folder] + "/SM_" + key
    try:
        if ctx.unreal.EditorAssetLibrary.does_asset_exist(path):
            return path
    except Exception:
        return None
    return None


def build_assets(ctx, keys=None, log=print):
    """Build and save every recipe (plus the cobble variants). Returns
    key -> asset path for those that saved."""
    out = {}
    reused = 0
    keys = list(keys) if keys else list(RECIPES)
    for key in keys:
        fn, folder, nanite, collision = RECIPES[key]
        have = _existing_asset(ctx, folder, key)
        if have:
            out[key] = have
            reused += 1
            continue
        try:
            mb = fn(ctx)
            path = mb.to_asset(F[folder], key, nanite=nanite and bool(C.LOOK["nanite"]), collision=collision)
            if path:
                out[key] = path
                log("V2 ASSET %-20s %s tris=%s %s%s" % (key, mb.backend, mb.tri_count(), path,
                                                        ("  notes: " + "; ".join(mb.notes)) if mb.notes else ""))
        except Exception as exc:
            log("V2 ASSET %-20s FAILED in recipe: %s: %s" % (key, type(exc).__name__, exc))
    if reused:
        log("V2 ASSETS: %d recipe(s) REUSED from disk (WLV2_REUSE_ASSETS=1)" % reused)
    for v in range(COBBLE_VARIANTS):
        have = _existing_asset(ctx, "cobble", "cobble_slab_%d" % v)
        if have:
            out["cobble_slab_%d" % v] = have
            continue
        try:
            mb = cobble_slab(ctx, v)
            path = mb.to_asset(F["cobble"], "cobble_slab_%d" % v, nanite=bool(C.LOOK["nanite"]), collision=True)
            if path:
                out["cobble_slab_%d" % v] = path
        except Exception as exc:
            log("V2 ASSET cobble_slab_%d FAILED: %s" % (v, exc))
    return out


# ==========================================================================
# MARBLE-REFERENCE ADDITIONS (2026-08-25): the plaza, the garden language,
# the white capped towers, the giant mushroom as the panorama draws it
# ==========================================================================


def plaza_slab(ctx, variant):
    """A large pale plaza slab, ~1.3 m, near-rectangular with slightly
    irregular edges, a subtle bevel and a worn top. The reference's plaza is
    big slabs in a loose cream/grey checker with wide seams."""
    m = ctx.mesh("plaza_slab_%d" % variant)
    w, d = 128.0 * (0.94 + 0.12 * _h(variant, 1)), 124.0 * (0.94 + 0.12 * _h(variant, 2))
    poly = []
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        poly.append((sx * w * 0.5 + (_h(variant, i, 3) - 0.5) * 6.0, sy * d * 0.5 + (_h(variant, i, 4) - 0.5) * 6.0))
    m.extrude(poly, 12.0)
    m.subdivide(2)
    m.perlin(1.1, 0.04, seed=300 + variant)
    m.smooth(1, 0.3)
    m.split_normals(45.0)
    return m


def path_steps(ctx):
    """Three low steps across the path, 4.6 m wide, 0.2 m rise each."""
    m = ctx.mesh("path_steps")
    for k in range(3):
        d = 90.0 * (3 - k)
        m.box(460.0, d, 20.0, at=(0.0, 90.0 * k + d * 0.5, 20.0 * (k + 0.5)), chamfer=2.5)
    m.perlin(0.8, 0.05, seed=311)
    return m


def retaining_wall(ctx):
    """A low cream garden wall, 4 m long, 0.85 m high: coursed blocks, a
    rolled cap. The reference's beds sit behind these."""
    m = ctx.mesh("retaining_wall")
    for c in range(3):
        for k in range(4):
            w = 100.0
            x = -200.0 + (50.0 if c % 2 else 0.0) + 100.0 * k + w * 0.5
            if x + w * 0.5 > 200.0:
                w -= (x + w * 0.5 - 200.0)
                x = 200.0 - w * 0.5
            m.box(w, 60.0 + 3.0 * _h(c, k, 1), 24.0, at=(x, 0.0, 12.0 + 24.0 * c), chamfer=2.0)
    m.box(410.0, 70.0, 12.0, at=(0, 0, 78.0), chamfer=4.0)
    m.perlin(0.8, 0.05, seed=321)
    return m


def planter_box(ctx):
    """A raised stone planter, 2 x 2 m, with a soil fill the beds sit on."""
    m = ctx.mesh("planter_box")
    m.box(200.0, 200.0, 60.0, at=(0, 0, 30.0), chamfer=4.0)
    m.box(210.0, 210.0, 10.0, at=(0, 0, 65.0), chamfer=3.0)
    return m


def topiary_cone_roses(ctx):
    """The reference's rose cone, ~4 m: a clipped cone of leaves with roses
    threaded through it, on a short clear stem."""
    m = ctx.mesh("topiary_cone_roses")
    prof = [(0.0, 0.0)] + [(92.0 * (1.0 - i / 10.0) ** 0.82 + 6.0, 40.0 + 420.0 * i / 10.0) for i in range(11)] + [(0.0, 486.0)]
    m.revolve(prof, steps=22)
    m.cylinder(18.0, 60.0, at=(0, 0, 0), steps=8)
    for k in range(16):
        t = k / 15.0
        z = 46.0 + 424.0 * t
        r = 128.0 * (1.0 - t) ** 0.82 + 10.0
        _leaf_shell(m, (0, 0, z), (r, r, 24.0), 60, 21.0, 10300 + k, elev=(-0.35, 0.5), jitter=0.10, clump=4, droop=14.0)
    for i in range(22):
        a = i * 2.3999632
        t = 0.12 + 0.80 * _h(103, i, 1)
        r = (128.0 * (1.0 - t) ** 0.82 + 10.0) * 0.92
        z = 46.0 + 424.0 * t
        _cup(m, 0.30, (math.cos(a) * r, math.sin(a) * r, z), math.degrees(a), 30.0 - 60.0 * _h(103, i, 2))
    m.split_normals(58.0)
    return m


def topiary_ball(ctx):
    """A clipped ball topiary, 1.6 m: trimmed foliage -- a tight, even leaf
    shell over a small core, short leaves, little droop."""
    m = ctx.mesh("topiary_ball")
    m.cylinder(11.0, 30.0, at=(0, 0, 0), steps=8)
    m.sphere(44.0, at=(0, 0, 78.0), steps=12)
    _leaf_shell(m, (0, 0, 78.0), (72, 73, 58), 300, 22.0, 5501, elev=(-0.85, 1.0), jitter=0.10, clump=4, droop=12.0)
    _leaf_shell(m, (0, 0, 78.0), (80, 81, 64), 240, 20.0, 5502, elev=(-0.8, 1.0), jitter=0.08, clump=3, droop=10.0)
    m.split_normals(58.0)
    return m


def tower_capped(ctx):
    """The reference's white garden tower: a slender white drum with a string
    course, small windows, a balcony ring, and a steep dark conical cap with
    a gold finial (cap placed by the layout: roof_cone_steep)."""
    m = ctx.mesh("tower_capped")
    prof = []
    for i in range(9):
        t = i / 8.0
        prof.append((150.0 * (1.0 - 0.08 * t), 1100.0 * t))
    m.revolve([(0.0, 0.0)] + prof + [(0.0, 1100.0)], steps=28)
    m.torus(152.0, 14.0, at=(0, 0, 24.0), major=28, minor=7)
    m.revolve([(136.0, 560.0), (168.0, 572.0), (170.0, 596.0), (136.0, 610.0)], steps=28)
    m.revolve([(132.0, 1040.0), (176.0, 1052.0), (178.0, 1080.0), (132.0, 1100.0)], steps=28)
    for row, z in ((0, 320.0), (1, 800.0)):
        for k in range(4):
            a = 2.0 * math.pi * (k + 0.5 * row) / 4 + 0.4
            r = 150.0 * (1.0 - 0.08 * z / 1100.0)
            m.box(40.0, 10.0, 90.0, at=(math.cos(a) * r, math.sin(a) * r, z), rot=(0.0, math.degrees(a) + 90.0, 0.0), chamfer=2.0)
            m.torus(20.0, 5.0, at=(math.cos(a) * r, math.sin(a) * r, z + 42.0), rot=(0.0, math.degrees(a) + 90.0, 90.0), major=12, minor=5, arc=180.0)
    return m


def roof_cone_steep(ctx):
    """A steep dark cap for tower_capped: 1.9 m radius, 5 m tall, with a
    rolled eave, four dormer ridges and a gold finial base."""
    m = ctx.mesh("roof_cone_steep")
    m.revolve([(0.0, 0.0), (192.0, 0.0), (188.0, 14.0), (120.0, 200.0), (52.0, 400.0), (8.0, 500.0), (0.0, 520.0)], steps=28)
    m.torus(186.0, 14.0, at=(0, 0, 8.0), major=28, minor=6)
    for k in range(4):
        pts = [(r * 1.02 * math.cos(math.radians(90.0 * k + 45.0)), r * 1.02 * math.sin(math.radians(90.0 * k + 45.0)), z)
               for (r, z) in ((188.0, 14.0), (120.0, 200.0), (52.0, 400.0), (8.0, 500.0))]
        m.tube(pts, [7.0, 6.0, 5.0, 4.0], sides=5)
    m.revolve([(0.0, 510.0), (14.0, 516.0), (10.0, 540.0), (18.0, 556.0), (0.0, 600.0)], steps=12)
    return m


def mushroom_giant(ctx):
    """THE landmark: the panorama's giant mushroom -- a broad, thick,
    slightly drooping cap ~20 m across on a massive 3.5 m stem, 13 m to the
    underside, ivy on top, a clock face on the stem. Thick rim, visible
    gills, organic sag; nothing about it is a cap on a pole."""
    m = ctx.mesh("mushroom_giant")
    stem_h = 1150.0
    path = [(30.0 * (i / 8.0) ** 2, 0.0, -40.0 + stem_h * i / 8.0) for i in range(9)]
    radii = [175.0 * (1.0 + 0.7 * math.exp(-i * 0.6)) * (1.0 - 0.12 * i / 8.0) for i in range(9)]
    m.tube(path, radii, sides=24)
    R, ch = 1000.0, 420.0
    cap = [(0.0, ch), (0.22 * R, ch * 0.97), (0.48 * R, ch * 0.86), (0.72 * R, ch * 0.66), (0.90 * R, ch * 0.42),
           (1.00 * R, ch * 0.18), (0.99 * R, 0.0), (0.93 * R, -ch * 0.06), (0.86 * R, -ch * 0.02), (0.84 * R, ch * 0.10),
           (0.60 * R, ch * 0.14), (0.30 * R, ch * 0.16), (200.0, ch * 0.16), (200.0, ch * 0.04), (0.0, ch * 0.04)]
    m.revolve(cap, steps=48, at=(30.0, 0.0, stem_h - ch * 0.05))
    # the gills and the underside are a SEPARATE recipe (mushroom_giant_gills)
    # placed at the same transform, so they wear the pale cream material the
    # reference shows under the red cap -- the arrival camera looks UP at it
    m.perlin(26.0, 0.006, seed=351)
    m.perlin(8.0, 0.03, seed=352)
    m.subdivide(1)
    m.smooth(1, 0.2)
    m.split_normals(55.0)
    return m


def garden_arch_stone(ctx):
    """The gateway at the end of the garden corridor: a stone arch on
    pilasters with a moulded cap, 7 m wide."""
    m = ctx.mesh("garden_arch_stone")
    R, T, D = 350.0, 60.0, 90.0
    for k in range(13):
        a = math.pi * (k + 0.5) / 13
        m.box(2.0 * math.pi * R / 13 * 0.94, D, T, at=(math.cos(a) * R, 0.0, math.sin(a) * R + 320.0),
              rot=(90.0 - math.degrees(a), 0.0, 0.0), chamfer=3.0)
    m.box(80.0, D + 14.0, T + 30.0, at=(0.0, 0.0, R + 320.0 + 8.0), chamfer=4.0)
    for s in (-1, 1):
        m.box(90.0, D + 10.0, 320.0, at=(s * R, 0.0, 160.0), chamfer=4.0)
        m.box(120.0, D + 30.0, 24.0, at=(s * R, 0.0, 320.0), chamfer=4.0)
        m.box(120.0, D + 30.0, 20.0, at=(s * R, 0.0, 10.0), chamfer=4.0)
    return m


RECIPES.update({
    "path_steps": (path_steps, "stairs", True, True),
    "retaining_wall": (retaining_wall, "gates", True, True),
    "planter_box": (planter_box, "garden_props", True, True),
    "topiary_cone_roses": (topiary_cone_roses, "topiary", False, True),
    "topiary_ball": (topiary_ball, "topiary", False, False),
    "tower_capped": (tower_capped, "castle", True, True),
    "roof_cone_steep": (roof_cone_steep, "castle", True, False),
    "mushroom_giant": (mushroom_giant, "mush_landmark", True, True),
    "garden_arch_stone": (garden_arch_stone, "garden_arch", True, True),
})
PLAZA_VARIANTS = 4

_old_build_assets = build_assets


def build_assets(ctx, keys=None, log=print):
    out = _old_build_assets(ctx, keys, log)
    for v in range(PLAZA_VARIANTS):
        have = _existing_asset(ctx, "cobble", "plaza_slab_%d" % v)
        if have:
            out["plaza_slab_%d" % v] = have
            continue
        try:
            mb = plaza_slab(ctx, v)
            path = mb.to_asset(F["cobble"], "plaza_slab_%d" % v, nanite=bool(C.LOOK["nanite"]), collision=True)
            if path:
                out["plaza_slab_%d" % v] = path
        except Exception as exc:
            log("V2 ASSET plaza_slab_%d FAILED: %s" % (v, exc))
    return out


# ==========================================================================
# THE CITY LANGUAGE (permanent directive): real modular variation
# ==========================================================================


def _window_arched(m, x, y, z, yaw, w=44.0, h=100.0, d=10.0):
    m.box(w, d, h, at=(x, y, z), rot=(0.0, yaw, 0.0), chamfer=2.0)
    m.torus(w * 0.5, 5.0, at=(x, y, z + h * 0.5 - 4.0), rot=(0.0, yaw, 90.0), major=12, minor=5, arc=180.0)
    m.box(w + 16.0, d + 6.0, 7.0, at=(x, y, z - h * 0.5 - 4.0), rot=(0.0, yaw, 0.0))


def _window_rect(m, x, y, z, yaw, w=40.0, h=80.0, d=10.0):
    m.box(w, d, h, at=(x, y, z), rot=(0.0, yaw, 0.0), chamfer=2.0)
    m.box(w + 12.0, d + 8.0, 8.0, at=(x, y, z + h * 0.5 + 4.0), rot=(0.0, yaw, 0.0), chamfer=1.5)
    m.box(w + 14.0, d + 6.0, 7.0, at=(x, y, z - h * 0.5 - 4.0), rot=(0.0, yaw, 0.0))


def _window_round(m, x, y, z, yaw, r=24.0, d=10.0):
    m.torus(r, 6.0, at=(x, y, z), rot=(0.0, yaw, 90.0), major=18, minor=6)


def _cornice_ring(m, r, z, steps=32, dentils=True):
    m.revolve([(r - 6.0, z), (r + 20.0, z + 10.0), (r + 24.0, z + 30.0), (r - 6.0, z + 42.0)], steps=steps)
    if dentils:
        for k in range(24):
            a = 2.0 * math.pi * k / 24
            m.box(10.0, 12.0, 12.0, at=(math.cos(a) * (r + 6.0), math.sin(a) * (r + 6.0), z - 8.0), rot=(0.0, math.degrees(a), 0.0))


def castle_tower_square(ctx):
    """A square tower, 5 x 5 x 16 m: battered base, quoins, two window rows
    (arched below, rectangular above), a cornice and a crenellated parapet."""
    m = ctx.mesh("castle_tower_square")
    m.box(560.0, 560.0, 120.0, at=(0, 0, 60.0), chamfer=6.0)
    m.box(500.0, 500.0, 1480.0, at=(0, 0, 120.0 + 740.0), chamfer=8.0)
    for c in range(12):
        for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            m.box(50.0, 50.0, 58.0, at=(sx * 240.0, sy * 240.0, 160.0 + 120.0 * c + (30.0 if c % 2 else 0.0)), chamfer=3.0)
    for yaw, (nx, ny) in ((0.0, (0, -1)), (90.0, (1, 0)), (180.0, (0, 1)), (270.0, (-1, 0))):
        for k in range(2):
            x = nx * 254.0 + (ny * (-90.0 + 180.0 * k))
            y = ny * 254.0 + (nx * (-90.0 + 180.0 * k))
            _window_arched(m, x, y, 420.0, yaw)
            _window_rect(m, x, y, 900.0, yaw)
        _window_round(m, nx * 254.0, ny * 254.0, 1300.0, yaw)
    m.box(560.0, 560.0, 36.0, at=(0, 0, 1600.0 + 18.0), chamfer=5.0)
    for k in range(24):
        m.box(18.0, 18.0, 30.0, at=(-260.0 + 22.6 * k, 268.0, 1640.0), chamfer=2.0)
    for s in (-1, 1):
        for k in range(6):
            m.box(60.0, 60.0, 90.0, at=(s * 250.0, -250.0 + 100.0 * k, 1680.0), chamfer=4.0)
            m.box(60.0, 60.0, 90.0, at=(-250.0 + 100.0 * k, s * 250.0, 1680.0), chamfer=4.0)
    return m


def castle_tower_octagon(ctx):
    """An octagonal tower, 6 m across, 18 m: a string course, arched windows
    on alternate faces, a corbelled top and a parapet ring."""
    m = ctx.mesh("castle_tower_octagon")
    octo = [(math.cos(math.pi / 8 + math.pi * i / 4) * 300.0, math.sin(math.pi / 8 + math.pi * i / 4) * 300.0) for i in range(8)]
    m.extrude([(p[0] * 1.1, p[1] * 1.1) for p in octo], 100.0)
    m.extrude(octo, 1600.0, at=(0, 0, 100.0))
    _cornice_ring(m, 300.0, 700.0, steps=8)
    for i in range(0, 8, 2):
        a = math.pi / 8 + math.pi * i / 4 + math.pi / 8
        for z in (450.0, 1050.0):
            _window_arched(m, math.cos(a) * 300.0, math.sin(a) * 300.0, z, math.degrees(a) + 90.0)
    m.extrude([(p[0] * 1.14, p[1] * 1.14) for p in octo], 60.0, at=(0, 0, 1660.0))
    for k in range(16):
        a = 2.0 * math.pi * k / 16
        m.box(50.0, 50.0, 80.0, at=(math.cos(a) * 320.0, math.sin(a) * 320.0, 1760.0), rot=(0.0, math.degrees(a), 0.0), chamfer=3.0)
    return m


def castle_tower_slender(ctx):
    """A slender round tower, 2.4 m across, 20 m: the reference's white
    spires. Entasis, three string courses, small windows, a corbel crown."""
    m = ctx.mesh("castle_tower_slender")
    prof = []
    for i in range(11):
        t = i / 10.0
        prof.append((120.0 * (1.0 - 0.06 * math.sin(math.pi * t) - 0.16 * t), 2000.0 * t))
    m.revolve([(0.0, 0.0)] + prof + [(0.0, 2000.0)], steps=24)
    m.torus(122.0, 12.0, at=(0, 0, 20.0), major=24, minor=6)
    for z in (600.0, 1200.0, 1700.0):
        r = 120.0 * (1.0 - 0.16 * z / 2000.0)
        m.revolve([(r - 4.0, z), (r + 14.0, z + 8.0), (r + 14.0, z + 22.0), (r - 4.0, z + 30.0)], steps=24)
    for row, z in ((0, 400.0), (1, 900.0), (2, 1450.0)):
        for k in range(3):
            a = 2.0 * math.pi * (k + 0.33 * row) / 3
            r = 120.0 * (1.0 - 0.16 * z / 2000.0)
            _window_arched(m, math.cos(a) * r, math.sin(a) * r, z, math.degrees(a) + 90.0, w=28.0, h=64.0, d=8.0)
    for k in range(12):
        a = 2.0 * math.pi * k / 12
        m.box(24.0, 24.0, 40.0, at=(math.cos(a) * 110.0, math.sin(a) * 110.0, 1960.0), rot=(0.0, math.degrees(a), 0.0), chamfer=2.0)
    return m


def roof_flat_crenellated(ctx):
    """A flat parapet roof for the square tower and halls: crenellations."""
    m = ctx.mesh("roof_flat_crenellated")
    m.box(520.0, 520.0, 24.0, at=(0, 0, 12.0), chamfer=4.0)
    for s in (-1, 1):
        for k in range(6):
            m.box(60.0, 40.0, 80.0, at=(-230.0 + 92.0 * k, s * 240.0, 64.0), chamfer=4.0)
            m.box(40.0, 60.0, 80.0, at=(s * 240.0, -230.0 + 92.0 * k, 64.0), chamfer=4.0)
    return m


def facade_panel(ctx):
    """A palace facade bay, 4 x 6 m: pilasters, an arched window with a
    balcony, a cornice. Tiled along halls to give a real facade rhythm."""
    m = ctx.mesh("facade_panel")
    m.box(400.0, 60.0, 600.0, at=(0, 0, 300.0), chamfer=4.0)
    for s in (-1, 1):
        m.box(36.0, 80.0, 560.0, at=(s * 180.0, -10.0, 300.0), chamfer=3.0)
        m.box(52.0, 90.0, 24.0, at=(s * 180.0, -10.0, 580.0), chamfer=3.0)
    _window_arched(m, 0.0, -34.0, 380.0, 0.0, w=110.0, h=220.0, d=12.0)
    m.box(200.0, 70.0, 16.0, at=(0, -50.0, 262.0), chamfer=3.0)
    for k in range(7):
        m.revolve([(0.0, 0.0), (7.0, 0.0), (7.0, 4.0), (4.0, 10.0), (6.0, 34.0), (8.0, 50.0), (5.0, 62.0), (7.0, 66.0)],
                  steps=8, at=(-84.0 + 28.0 * k, -78.0, 270.0))
    m.box(220.0, 12.0, 8.0, at=(0, -78.0, 340.0), chamfer=2.0)
    m.box(440.0, 90.0, 30.0, at=(0, -8.0, 615.0), chamfer=4.0)
    return m


def castle_arcade(ctx):
    """A ground-floor arcade, 6 m long: three arches on columns."""
    m = ctx.mesh("castle_arcade")
    m.box(600.0, 120.0, 40.0, at=(0, 0, 400.0), chamfer=4.0)
    for k in range(4):
        x = -300.0 + 200.0 * k
        m.revolve([(0.0, 0.0), (26.0, 0.0), (26.0, 8.0), (20.0, 14.0), (18.0, 300.0), (24.0, 330.0), (30.0, 345.0), (0.0, 345.0)], steps=14, at=(x, 0.0, 0.0))
    for k in range(3):
        x = -200.0 + 200.0 * k
        for j in range(9):
            a = math.pi * (j + 0.5) / 9
            m.box(2.0 * math.pi * 90.0 / 9 * 0.9, 100.0, 30.0, at=(x + math.cos(a) * 90.0, 0.0, 300.0 + math.sin(a) * 90.0), rot=(90.0 - math.degrees(a), 0.0, 0.0), chamfer=2.0)
    return m


def finial_spire(ctx):
    """A tall gold spire finial, 3 m."""
    m = ctx.mesh("finial_spire")
    m.revolve([(0.0, 0.0), (28.0, 0.0), (28.0, 14.0), (16.0, 22.0), (22.0, 60.0), (10.0, 120.0), (14.0, 140.0), (4.0, 240.0), (0.0, 300.0)], steps=12)
    m.sphere(12.0, at=(0, 0, 150.0), steps=8)
    return m


RECIPES.update({
    "castle_tower_square": (castle_tower_square, "castle", True, True),
    "castle_tower_octagon": (castle_tower_octagon, "castle", True, True),
    "castle_tower_slender": (castle_tower_slender, "castle", True, True),
    "roof_flat_crenellated": (roof_flat_crenellated, "castle", True, False),
    "facade_panel": (facade_panel, "castle", True, True),
    "castle_arcade": (castle_arcade, "castle", True, True),
    "finial_spire": (finial_spire, "castle", True, False),
})


# ==========================================================================
# THE VEGETATION FAMILIES (permanent directive): variation per family
# ==========================================================================


def tree_slender_trunk(ctx):
    """A slender garden tree, 9 m: straight, a fork at 5 m, fine limbs."""
    m, path = _trunk(ctx, "tree_slender_trunk", 900.0, 70.0, 40.0, 30.0, seed=81, roots=4, sides=16)
    p = path[int(len(path) * 0.55)]
    for k, ang in enumerate((0.4, 2.5, 4.4)):
        _limb(m, (p[0], p[1], 520.0), (math.cos(ang) * 0.75, math.sin(ang) * 0.75, 0.65), 380.0, 38.0, 0, 90 + k)
    return m


def canopy_medium(ctx):
    """A ~6 m canopy: core, twigs and two leaf lobes."""
    m = ctx.mesh("canopy_medium")
    for (x, y, z, r) in ((0, 0, 15, 105), (120, 50, -25, 80), (-110, 70, 5, 84)):
        m.sphere(r, at=(x, y, z), steps=10)
    m.perlin(20.0, 0.007, seed=93)
    m.smooth(1, 0.3)
    _twigs(m, (0, 0, 10), (270, 250, 200), 11, 9301, r0=6.0)
    for k, (c, rad, n, sz) in enumerate((((10, 10, 30), (300, 275, 210), 240, 52.0),
                                         ((-140, 90, -20), (190, 180, 150), 170, 46.0),
                                         ((10, 10, 20), (210, 195, 155), 150, 44.0))):
        _leaf_shell(m, c, rad, n, sz, 9310 + k, elev=(-0.7, 1.0), jitter=0.30, clump=3)
    m.split_normals(62.0)
    return m


def topiary_cone_plain(ctx):
    """A clipped cone topiary, 3 m: tight leaf cover in stacked tiers."""
    m = ctx.mesh("topiary_cone_plain")
    prof = [(0.0, 0.0)] + [(56.0 * (1.0 - i / 10.0) ** 0.8 + 4.0, 30.0 + 250.0 * i / 10.0) for i in range(11)] + [(0.0, 290.0)]
    m.revolve(prof, steps=20)
    m.cylinder(15.0, 42.0, at=(0, 0, 0), steps=8)
    for k in range(14):
        t = k / 13.0
        z = 36.0 + 254.0 * t
        r = 100.0 * (1.0 - t) ** 0.8 + 9.0
        _leaf_shell(m, (0, 0, z), (r, r, 22.0), 56, 19.0, 10100 + k, elev=(-0.35, 0.5), jitter=0.08, clump=4, droop=14.0)
    m.split_normals(58.0)
    return m


def topiary_spiral(ctx):
    """A spiral-clipped topiary, 3.2 m: the helix stays, the surface is leaves."""
    m = ctx.mesh("topiary_spiral")
    pts, rr = [], []
    for i in range(40):
        t = i / 39.0
        a = t * 5.0 * 2.0 * math.pi
        r = 80.0 * (1.0 - t) + 9.0
        pts.append((math.cos(a) * r * 0.55, math.sin(a) * r * 0.55, 50.0 + 268.0 * t))
        rr.append(r * 0.58 + 5.0)
    m.tube(pts, rr, sides=10)
    m.cylinder(13.0, 52.0, at=(0, 0, 0), steps=8)
    for i in range(0, 40, 1):
        t = i / 39.0
        a = t * 5.0 * 2.0 * math.pi
        r = 80.0 * (1.0 - t) + 9.0
        _leaf_shell(m, (math.cos(a) * r * 0.55, math.sin(a) * r * 0.55, 50.0 + 268.0 * t),
                    (r * 0.70 + 7.0, r * 0.70 + 7.0, 20.0), 20, 17.0, 11100 + i, elev=(-0.5, 0.8), jitter=0.10, clump=3, droop=12.0)
    m.split_normals(58.0)
    return m


def rose_bush(ctx):
    """A rose bush, 2 m: arching stems, leaf clumps, nine blooms proud of them."""
    m = ctx.mesh("rose_bush")
    for (x, y, z, r) in ((0, 0, 62, 36), (42, 18, 46, 30), (-38, 26, 54, 28)):
        m.sphere(r, at=(x, y, z), steps=9)
    m.perlin(7.0, 0.035, seed=121)
    _leaf_shell(m, (0, 0, 66), (96, 92, 70), 190, 21.0, 12100, elev=(-0.4, 1.0), jitter=0.24, clump=3, droop=24.0)
    for i in range(9):
        a = i * 2.3999632
        rad = 38.0 + 46.0 * _h(12, i, 1)
        x, y = math.cos(a) * rad, math.sin(a) * rad
        z = 92.0 + 38.0 * _h(12, i, 2)
        m.tube([(x * 0.6, y * 0.6, z - 40.0), (x, y, z)], [3.0, 2.2], sides=5)
        _cup(m, 0.36, (x, y, z), 40.0 * i, -20.0 + 40.0 * _h(12, i, 3))
        _cup(m, 0.25, (x, y, z + 4.0), 40.0 * i + 25.0, 0.0)
    m.split_normals(58.0)
    return m


def shrub_flowering(ctx):
    """A flowering shrub ~3.5 m across: leafy mass with open blossoms."""
    m = ctx.mesh("shrub_flowering")
    for (x, y, z, r) in ((0, 0, 100, 62), (75, 35, 82, 48), (-68, 50, 86, 50), (25, -75, 72, 46)):
        m.sphere(r, at=(x, y, z), steps=10)
    m.perlin(10.0, 0.018, seed=131)
    _twigs(m, (0, 0, 90), (150, 140, 100), 9, 13100, r0=5.0)
    _leaf_shell(m, (0, 0, 100), (168, 152, 108), 280, 27.0, 13110, elev=(-0.4, 1.0), jitter=0.24, clump=3, droop=22.0)
    _leaf_shell(m, (0, 0, 94), (128, 116, 86), 170, 25.0, 13111, elev=(-0.5, 1.0), jitter=0.20, clump=3, droop=20.0)
    for i in range(13):
        a = i * 2.3999632
        el = 0.25 + 0.65 * _h(13, i, 1)
        _petal_ring(m, (math.cos(a) * math.cos(el) * 140.0, math.sin(a) * math.cos(el) * 128.0, 96.0 + math.sin(el) * 96.0),
                    5, 26.0 + 8.0 * _h(13, i, 2), 13200 + i)
    m.split_normals(58.0)
    return m


def hedge_block(ctx):
    """A clipped rectangular hedge, 3 x 1 x 1.2 m: a trimmed box whose faces
    are leaves -- an uneven crown, dense sides, dark between the clumps."""
    m = ctx.mesh("hedge_block")
    m.box(268.0, 70.0, 92.0, at=(0, 0, 50.0), chamfer=10.0)
    m.subdivide(1)
    m.perlin(4.0, 0.04, seed=141)
    for i in range(15):
        x = -140.0 + 280.0 * i / 14.0
        _leaf_shell(m, (x, 0.0, 104.0), (24.0, 50.0, 16.0), 26, 18.0, 14100 + i, elev=(-0.2, 1.0), jitter=0.12, clump=3, droop=16.0)
        for sgn in (-1, 1):
            _leaf_shell(m, (x, sgn * 44.0, 56.0), (22.0, 12.0, 46.0), 22, 17.0, 14200 + i * 2 + (sgn > 0), elev=(-0.7, 0.7), jitter=0.10, clump=2, droop=18.0)
    m.split_normals(58.0)
    return m


def ground_flowers(ctx):
    """Low ground flowers, 1 m patch: many small blooms on a leafy mat."""
    m = ctx.mesh("ground_flowers")
    m.sphere(60.0, at=(0, 0, -25.0), steps=10)
    m.scale(1.6, 1.4, 0.5)
    for i in range(16):
        a = i * 2.39996
        rad = 15.0 + 60.0 * _h(14, i, 1)
        x, y = math.cos(a) * rad, math.sin(a) * rad
        h = 16.0 + 14.0 * _h(14, i, 2)
        m.tube([(x, y, 0.0), (x + 2, y, h)], [1.6, 1.2], sides=4)
        for p in range(5):
            m.extrude([(0, 0), (5, 5), (4, 14), (0, 18), (-4, 14), (-5, 5)], 1.0, at=(x + 2, y, h), rot=(-25.0, 72.0 * p + 30.0 * i, 0.0))
    return m


def vine_wall(ctx):
    """Ivy over a wall face, 3 x 2 m: strands and leaf clumps on a plane."""
    m = ctx.mesh("vine_wall")
    for k in range(7):
        pts, rr = [], []
        for i in range(8):
            t = i / 7.0
            pts.append((-140.0 + 46.0 * k + 22.0 * math.sin(t * 6.0 + k), -8.0 - 6.0 * math.sin(t * 4.0), 200.0 - 200.0 * t))
            rr.append(4.0 - 2.0 * t)
        m.tube(pts, rr, sides=5)
        for i in range(8):
            m.sphere(16.0 + 10.0 * _h(15, k, i), at=(pts[i][0] + 6.0, -18.0, pts[i][2]), steps=7)
    m.perlin(4.0, 0.04, seed=151)
    return m


RECIPES.update({
    "tree_slender_trunk": (tree_slender_trunk, "trees", True, True),
    "canopy_medium": (canopy_medium, "trees", False, False),
    "topiary_cone_plain": (topiary_cone_plain, "topiary", False, True),
    "topiary_spiral": (topiary_spiral, "topiary", False, True),
    "rose_bush": (rose_bush, "roses", False, False),
    "shrub_flowering": (shrub_flowering, "shrubs", False, False),
    "hedge_block": (hedge_block, "shrubs", False, True),
    "ground_flowers": (ground_flowers, "flowers", False, False),
    "vine_wall": (vine_wall, "ivy", False, False),
})



# ==========================================================================
# FROM THE FOUNDER'S GUIDE VIEW (cam0 reprojection): the sunken plaza's side
# steps, the pedestals with gold finials, the mushroom's stone base, a cup
# ==========================================================================


def side_steps(ctx):
    """Three low steps rising away from the plaza along its side, a 4 m
    module: the plaza is sunken and the terraces are two steps up."""
    m = ctx.mesh("side_steps")
    for k in range(3):
        m.box(400.0, 60.0 * (3 - k), 20.0, at=(0.0, 30.0 * k + 30.0 * (3 - k), 20.0 * (k + 0.5)), chamfer=2.5)
    m.perlin(0.7, 0.05, seed=361)
    return m


def pedestal_finial(ctx):
    """A cream stone pedestal, 1.2 m, with a moulded cap -- the gold finial
    (gate_finial_ball) is placed on it by the layout."""
    m = ctx.mesh("pedestal_finial")
    m.box(70.0, 70.0, 16.0, at=(0, 0, 8.0), chamfer=3.0)
    m.box(56.0, 56.0, 84.0, at=(0, 0, 58.0), chamfer=4.0)
    for yaw in (0.0, 90.0, 180.0, 270.0):
        m.box(34.0, 6.0, 60.0, at=(math.sin(math.radians(yaw)) * -30.0, math.cos(math.radians(yaw)) * 30.0, 58.0), rot=(0.0, yaw, 0.0), chamfer=1.5)
    m.revolve([(0.0, 100.0), (36.0, 100.0), (40.0, 108.0), (34.0, 116.0), (22.0, 122.0), (0.0, 124.0)], steps=16)
    return m


def stone_ring_base(ctx):
    """A low round stone platform, 5 m across, two tiers: what the giant
    mushroom's stem stands on in the reference."""
    m = ctx.mesh("stone_ring_base")
    m.revolve([(0.0, 0.0), (250.0, 0.0), (254.0, 30.0), (246.0, 40.0), (0.0, 40.0)], steps=32)
    m.revolve([(0.0, 40.0), (190.0, 40.0), (194.0, 66.0), (186.0, 76.0), (0.0, 76.0)], steps=32)
    m.perlin(1.2, 0.03, seed=371)
    return m


def tea_cup_small(ctx):
    """A floating teacup with its saucer, for the sky."""
    m = ctx.mesh("tea_cup_small")
    m.revolve([(0.0, 0.0), (60.0, 0.0), (64.0, 8.0), (54.0, 12.0), (100.0, 18.0), (130.0, 26.0), (128.0, 32.0), (90.0, 24.0), (0.0, 22.0)], steps=28)
    m.revolve([(0.0, 22.0), (40.0, 22.0), (44.0, 34.0), (34.0, 40.0), (62.0, 80.0), (86.0, 140.0), (98.0, 200.0), (104.0, 212.0),
               (96.0, 216.0), (82.0, 150.0), (56.0, 82.0), (28.0, 52.0), (0.0, 50.0)], steps=28)
    m.torus(46.0, 10.0, at=(124.0, 0.0, 140.0), rot=(0.0, 0.0, 90.0), major=20, minor=8, arc=250.0)
    m.subdivide(1)
    return m


RECIPES.update({
    "side_steps": (side_steps, "stairs", True, True),
    "pedestal_finial": (pedestal_finial, "garden_props", True, True),
    "stone_ring_base": (stone_ring_base, "mush_landmark", True, True),
    "tea_cup_small": (tea_cup_small, "tea", True, False),
})
