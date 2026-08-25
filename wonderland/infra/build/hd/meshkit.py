"""meshkit — author real triangle geometry in pure Python.

WHY THIS EXISTS
---------------
Every visible thing in Wonderland was, until this file, one of five meshes:

    /Engine/BasicShapes/{Cube, Cylinder, Cone, Sphere, Plane}

Nothing else. There are zero .uasset files in the repository. So the founder's
list of unacceptable characteristics — "obvious cubes", "obvious cylinders",
"cone roofs", "sphere/blob trees", "crude mushrooms", "simplistic gold
geometry" — was not a description of a styling problem. It was an exact
description of the asset library. No amount of colour, bloom, saturation,
density or scatter can move it, which is why none of those passes ever did.

This module is the missing half of the pipeline: a small, dependency-free
geometry kernel that produces vertices and triangles. `assets.py` uses it to
author the real Wonderland asset library; `generate-hub-level.py` turns those
into UStaticMesh assets inside the editor commandlet.

DESIGN RULES, EACH PAID FOR
---------------------------
* **stdlib only.** This laptop has no numpy and no PIL. The module must be
  runnable and testable here, offline, with no GPU and no engine — because the
  engine is a stopped cloud instance that costs the founder money per minute.
  Everything in here is checkable for free.

* **Deterministic.** Every random-looking thing comes from `vnoise`/`rnd`,
  which hash their coordinates. The same asset must build byte-identically on
  this laptop and on the Studio, or the offline preview is measuring a
  different world from the one the founder sees.

* **One material slot per mesh.** The world is drawn through
  WonderlandInstancedBatch, which carries a single MaterialPath per batch. A
  multi-slot mesh would silently render slot 0 everywhere. Multi-material
  objects are therefore composed from several single-material meshes, exactly
  as the existing kitbash builders already compose primitives.

* **Authored to a 100 uu box, centred.** /Engine/BasicShapes are all 100 uu
  and origin-centred, and eleven thousand lines of layout arithmetic assume it.
  `fit_box()` puts every HD mesh on the same convention, so an HD mesh is a
  drop-in for the primitive it replaces and no call site has to change.

* **Chamfers, not sharp edges.** A perfectly sharp 90-degree edge is the
  single loudest "this is a primitive" tell: it produces one hard specular
  line and no transitional shading. Real cut stone has an arris. `chamfer_box`
  costs 24 vertices and does more for the read of masonry than any texture in
  this project.
"""

import math
import struct
import zlib

# --------------------------------------------------------------------------
# deterministic noise
# --------------------------------------------------------------------------


def _hash3(i, j, k, seed=0):
    """A stable 32-bit hash of three integers. Not cryptographic; it only has
    to be repeatable across machines and Python versions, which arithmetic on
    fixed masks is and hash() explicitly is not (PYTHONHASHSEED randomises
    str/bytes hashing, and this used to be a str hash)."""
    h = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 1274126177) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) & 0xFFFFFFFF
    h = (h * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) & 0xFFFFFFFF


def rnd(*key):
    """Deterministic float in [0,1) from any tuple of numbers."""
    ints = [int(round(float(k) * 1024.0)) for k in key]
    while len(ints) < 3:
        ints.append(0)
    h = _hash3(ints[0], ints[1], ints[2], seed=len(ints))
    for extra in ints[3:]:
        h = _hash3(h & 0xFFFF, extra, h >> 16, seed=7)
    return h / 4294967296.0


def rrange(lo, hi, *key):
    return lo + (hi - lo) * rnd(*key)


def vnoise(x, y, z, freq=1.0, seed=0):
    """Smooth value noise in [-1,1]. Trilinear over a hashed integer lattice
    with a smoothstep fade — cheap, continuous, and enough to break up a
    silhouette so it stops reading as a lathe."""
    x, y, z = x * freq, y * freq, z * freq
    xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
    xf, yf, zf = x - xi, y - yi, z - zi
    u = xf * xf * (3.0 - 2.0 * xf)
    v = yf * yf * (3.0 - 2.0 * yf)
    w = zf * zf * (3.0 - 2.0 * zf)

    def g(a, b, c):
        return _hash3(int(xi) + a, int(yi) + b, int(zi) + c, seed) / 4294967296.0

    c00 = g(0, 0, 0) * (1 - u) + g(1, 0, 0) * u
    c10 = g(0, 1, 0) * (1 - u) + g(1, 1, 0) * u
    c01 = g(0, 0, 1) * (1 - u) + g(1, 0, 1) * u
    c11 = g(0, 1, 1) * (1 - u) + g(1, 1, 1) * u
    c0 = c00 * (1 - v) + c10 * v
    c1 = c01 * (1 - v) + c11 * v
    return (c0 * (1 - w) + c1 * w) * 2.0 - 1.0


def fbm(x, y, z, octaves=3, freq=1.0, seed=0, gain=0.5):
    """Fractal sum of vnoise — one octave reads as a wobble, three read as a
    surface."""
    total, amp, f, norm = 0.0, 1.0, freq, 0.0
    for o in range(octaves):
        total += amp * vnoise(x, y, z, f, seed + o * 31)
        norm += amp
        amp *= gain
        f *= 2.0
    return total / norm if norm else 0.0


# --------------------------------------------------------------------------
# the mesh
# --------------------------------------------------------------------------


class Mesh(object):
    """Triangles with per-corner UVs and a smoothing group per triangle.

    Smoothing groups are how a cylinder can be smooth around its side and hard
    at its cap in the same mesh. Corner normals are averaged only across
    triangles that share a vertex AND a group.
    """

    __slots__ = ("verts", "tris", "uvs", "groups")

    def __init__(self):
        self.verts = []    # [(x, y, z), ...]
        self.tris = []     # [(i, j, k), ...]
        self.uvs = []      # [((u,v), (u,v), (u,v)), ...]  parallel to tris
        self.groups = []   # [int, ...]                    parallel to tris

    # -- construction ------------------------------------------------------

    def add_vert(self, x, y, z):
        self.verts.append((float(x), float(y), float(z)))
        return len(self.verts) - 1

    def add_tri(self, a, b, c, uv=None, group=0):
        self.tris.append((int(a), int(b), int(c)))
        self.uvs.append(uv or ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0)))
        self.groups.append(int(group))

    def add_quad(self, a, b, c, d, uv=None, group=0):
        """Quad a-b-c-d, wound so the triangles agree. UV is four corners."""
        if uv is None:
            uv = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
        self.add_tri(a, b, c, (uv[0], uv[1], uv[2]), group)
        self.add_tri(a, c, d, (uv[0], uv[2], uv[3]), group)

    def merge(self, other):
        """Append another mesh. Groups are offset so the two never smooth into
        each other — merging a trunk and a branch must not average their
        normals across the join."""
        base = len(self.verts)
        gbase = (max(self.groups) + 1) if self.groups else 0
        self.verts.extend(other.verts)
        for (a, b, c), uv, g in zip(other.tris, other.uvs, other.groups):
            self.tris.append((a + base, b + base, c + base))
            self.uvs.append(uv)
            self.groups.append(g + gbase)
        return self

    def copy(self):
        m = Mesh()
        m.verts = list(self.verts)
        m.tris = list(self.tris)
        m.uvs = list(self.uvs)
        m.groups = list(self.groups)
        return m

    # -- measurement -------------------------------------------------------

    def bbox(self):
        if not self.verts:
            return ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
        xs = [v[0] for v in self.verts]
        ys = [v[1] for v in self.verts]
        zs = [v[2] for v in self.verts]
        return ((min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs)))

    def extents(self):
        lo, hi = self.bbox()
        return (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])

    def tri_count(self):
        return len(self.tris)

    def surface_area(self):
        total = 0.0
        for (a, b, c) in self.tris:
            pa, pb, pc = self.verts[a], self.verts[b], self.verts[c]
            ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
            wx, wy, wz = pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]
            cx, cy, cz = uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx
            total += 0.5 * math.sqrt(cx * cx + cy * cy + cz * cz)
        return total

    def signature(self):
        """A stable fingerprint of the geometry. Two builds of the same asset
        on different machines must agree, and a gate can assert on it."""
        h = zlib.crc32(struct.pack("<I", len(self.verts)))
        for v in self.verts:
            h = zlib.crc32(struct.pack("<3i", *[int(round(c * 64.0)) for c in v]), h)
        for t in self.tris:
            h = zlib.crc32(struct.pack("<3i", *t), h)
        return h & 0xFFFFFFFF

    # -- transforms (all in place, all returning self so they chain) --------

    def translate(self, dx, dy, dz):
        self.verts = [(v[0] + dx, v[1] + dy, v[2] + dz) for v in self.verts]
        return self

    def scale(self, sx, sy=None, sz=None):
        if sy is None:
            sy = sz = sx
        elif sz is None:
            sz = sy
        self.verts = [(v[0] * sx, v[1] * sy, v[2] * sz) for v in self.verts]
        if (sx * sy * sz) < 0.0:
            self._flip()
        return self

    def _flip(self):
        self.tris = [(a, c, b) for (a, b, c) in self.tris]
        self.uvs = [(u[0], u[2], u[1]) for u in self.uvs]

    def rotate_z(self, deg):
        c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        self.verts = [(v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]) for v in self.verts]
        return self

    def rotate_y(self, deg):
        c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        self.verts = [(v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c) for v in self.verts]
        return self

    def rotate_x(self, deg):
        c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        self.verts = [(v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c) for v in self.verts]
        return self

    def displace(self, fn):
        """fn(x, y, z) -> (x, y, z). The organic pass: mushroom caps, foliage
        masses, cobbles, gnarled trunks."""
        self.verts = [tuple(float(c) for c in fn(*v)) for v in self.verts]
        return self

    def centre(self):
        lo, hi = self.bbox()
        return self.translate(-(lo[0] + hi[0]) * 0.5,
                              -(lo[1] + hi[1]) * 0.5,
                              -(lo[2] + hi[2]) * 0.5)

    def fit_box(self, size=100.0, uniform=False):
        """Put the mesh on the /Engine/BasicShapes convention: centred at the
        origin inside a `size` cube. Non-uniform by default so an HD wall
        panel is a drop-in for a Cube at the same scale; uniform where the
        proportions carry the design (a key, a teapot)."""
        self.centre()
        ex, ey, ez = self.extents()
        ex, ey, ez = max(ex, 1e-9), max(ey, 1e-9), max(ez, 1e-9)
        if uniform:
            k = size / max(ex, ey, ez)
            return self.scale(k, k, k)
        return self.scale(size / ex, size / ey, size / ez)

    # -- normals -----------------------------------------------------------

    def corner_normals(self):
        """Per-triangle-corner normals, averaged within smoothing groups.

        Returned rather than stored: the engine bridge wants them per vertex
        instance, the offline rasteriser wants them per corner, and nothing
        wants them cached and stale after a displace()."""
        face_n = []
        for (a, b, c) in self.tris:
            pa, pb, pc = self.verts[a], self.verts[b], self.verts[c]
            ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
            wx, wy, wz = pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]
            n = (uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx)
            face_n.append(n)          # unnormalised: area-weights the average
        acc = {}
        for ti, (a, b, c) in enumerate(self.tris):
            g = self.groups[ti]
            n = face_n[ti]
            for vi in (a, b, c):
                k = (vi, g)
                p = acc.get(k)
                if p is None:
                    acc[k] = [n[0], n[1], n[2]]
                else:
                    p[0] += n[0]
                    p[1] += n[1]
                    p[2] += n[2]
        out = []
        for ti, (a, b, c) in enumerate(self.tris):
            g = self.groups[ti]
            corner = []
            for vi in (a, b, c):
                n = acc[(vi, g)]
                L = math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2])
                if L < 1e-12:
                    fn = face_n[ti]
                    L2 = math.sqrt(sum(x * x for x in fn)) or 1.0
                    corner.append((fn[0] / L2, fn[1] / L2, fn[2] / L2))
                else:
                    corner.append((n[0] / L, n[1] / L, n[2] / L))
            out.append(tuple(corner))
        return out


# --------------------------------------------------------------------------
# polygon helpers
# --------------------------------------------------------------------------


def _poly_area2(poly):
    a = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        a += x0 * y1 - x1 * y0
    return a * 0.5


def earclip(poly):
    """Triangulate a simple polygon (concave allowed, no holes) by ear
    clipping. Needed because the heart, the key bow and the clock bezel are
    all concave, and a triangle fan turns a concave outline inside out."""
    n = len(poly)
    if n < 3:
        return []
    idx = list(range(n))
    if _poly_area2(poly) < 0:
        idx.reverse()

    def cross(o, a, b):
        return ((poly[a][0] - poly[o][0]) * (poly[b][1] - poly[o][1])
                - (poly[a][1] - poly[o][1]) * (poly[b][0] - poly[o][0]))

    def inside(p, a, b, c):
        d1 = cross(a, b, p)
        d2 = cross(b, c, p)
        d3 = cross(c, a, p)
        neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
        pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
        return not (neg and pos)

    out = []
    guard = 0
    while len(idx) > 3 and guard < 4 * n * n:
        guard += 1
        clipped = False
        for i in range(len(idx)):
            a, b, c = idx[i - 1], idx[i], idx[(i + 1) % len(idx)]
            if cross(a, b, c) <= 0:
                continue                      # reflex
            bad = False
            for j in idx:
                if j in (a, b, c):
                    continue
                if inside(j, a, b, c):
                    bad = True
                    break
            if bad:
                continue
            out.append((a, b, c))
            idx.pop(i)
            clipped = True
            break
        if not clipped:
            break                             # degenerate; fan the remainder
    for i in range(1, len(idx) - 1):
        out.append((idx[0], idx[i], idx[i + 1]))
    return out


# --------------------------------------------------------------------------
# generators
# --------------------------------------------------------------------------


def chamfer_box(w, d, h, c=None, group=0):
    """A box whose twelve edges are cut back by `c`.

    The whole point of the module in one function: the primitive tell is the
    sharp arris, and a chamfer of 2-3% of the shortest side removes it for 96
    triangles. Corners are mitred (the three chamfer faces meet at a corner
    triangle), so it holds up in silhouette as well as in shading."""
    m = Mesh()
    if c is None:
        c = min(w, d, h) * 0.06
    c = max(0.0, min(c, min(w, d, h) * 0.45))
    hx, hy, hz = w * 0.5, d * 0.5, h * 0.5
    ax, ay, az = hx - c, hy - c, hz - c

    # 24 vertices: for each of the 8 corners, the three points where the
    # chamfer meets the three faces.
    vid = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                vid[(sx, sy, sz, 'x')] = m.add_vert(sx * hx, sy * ay, sz * az)
                vid[(sx, sy, sz, 'y')] = m.add_vert(sx * ax, sy * hy, sz * az)
                vid[(sx, sy, sz, 'z')] = m.add_vert(sx * ax, sy * ay, sz * hz)

    def face(axis, s):
        """The flat face on `axis` at sign `s`, as a quad of its four corners."""
        corners = []
        for u in (-1, 1):
            for v in (-1, 1):
                if axis == 'x':
                    corners.append((s, u, v, 'x'))
                elif axis == 'y':
                    corners.append((u, s, v, 'y'))
                else:
                    corners.append((u, v, s, 'z'))
        a, b, cc, dd = corners[0], corners[1], corners[3], corners[2]
        q = [vid[k] for k in (a, b, cc, dd)]
        pa = m.verts[q[0]]
        pb = m.verts[q[1]]
        pc = m.verts[q[2]]
        n = _tri_normal(pa, pb, pc)
        want = [0.0, 0.0, 0.0]
        want['xyz'.index(axis)] = float(s)
        if n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0:
            q = [q[0], q[3], q[2], q[1]]
        m.add_quad(q[0], q[1], q[2], q[3], group=group)

    for s in (-1, 1):
        face('x', s)
        face('y', s)
        face('z', s)

    # 12 edge chamfers, each its own smoothing group so it reads as a facet.
    def edge(k0a, k0b, k1a, k1b, g):
        q = [vid[k0a], vid[k0b], vid[k1b], vid[k1a]]
        pa, pb, pc = m.verts[q[0]], m.verts[q[1]], m.verts[q[2]]
        n = _tri_normal(pa, pb, pc)
        mid = [(m.verts[q[i]][j] for i in range(4)) for j in range(3)]
        cen = [sum(m.verts[i][j] for i in q) / 4.0 for j in range(3)]
        if n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0:
            q = [q[0], q[3], q[2], q[1]]
        m.add_quad(q[0], q[1], q[2], q[3], group=g)

    g = group + 100
    for sy in (-1, 1):
        for sz in (-1, 1):
            edge((-1, sy, sz, 'y'), (-1, sy, sz, 'z'),
                 (1, sy, sz, 'y'), (1, sy, sz, 'z'), g); g += 1
    for sx in (-1, 1):
        for sz in (-1, 1):
            edge((sx, -1, sz, 'x'), (sx, -1, sz, 'z'),
                 (sx, 1, sz, 'x'), (sx, 1, sz, 'z'), g); g += 1
    for sx in (-1, 1):
        for sy in (-1, 1):
            edge((sx, sy, -1, 'x'), (sx, sy, -1, 'y'),
                 (sx, sy, 1, 'x'), (sx, sy, 1, 'y'), g); g += 1

    # 8 corner mitres.
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                a, b, cc = vid[(sx, sy, sz, 'x')], vid[(sx, sy, sz, 'y')], vid[(sx, sy, sz, 'z')]
                n = _tri_normal(m.verts[a], m.verts[b], m.verts[cc])
                cen = [(m.verts[a][j] + m.verts[b][j] + m.verts[cc][j]) / 3.0 for j in range(3)]
                if n[0] * cen[0] + n[1] * cen[1] + n[2] * cen[2] < 0:
                    a, b = b, a
                m.add_tri(a, b, cc, group=g)
                g += 1
    return m


def box(w, d, h, group=0):
    """A plain 12-triangle box. For detail small enough that a chamfer would
    be sub-pixel — dentils, perpends, tile edges — where chamfer_box's 44
    triangles would be spent on nothing anyone can see."""
    m = Mesh()
    hx, hy, hz = w * 0.5, d * 0.5, h * 0.5
    v = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                v[(sx, sy, sz)] = m.add_vert(sx * hx, sy * hy, sz * hz)
    faces = (
        (( 1, -1, -1), ( 1, 1, -1), ( 1, 1, 1), ( 1, -1, 1)),
        ((-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)),
        ((-1,  1, -1), (-1, 1, 1), ( 1, 1, 1), ( 1, 1, -1)),
        ((-1, -1, -1), ( 1, -1, -1), ( 1, -1, 1), (-1, -1, 1)),
        ((-1, -1,  1), ( 1, -1, 1), ( 1, 1, 1), (-1, 1, 1)),
        ((-1, -1, -1), (-1, 1, -1), ( 1, 1, -1), ( 1, -1, -1)),
    )
    for i, f in enumerate(faces):
        m.add_quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], group=group + i)
    return m


def _tri_normal(pa, pb, pc):
    ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
    wx, wy, wz = pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]
    n = (uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx)
    L = math.sqrt(sum(x * x for x in n)) or 1.0
    return (n[0] / L, n[1] / L, n[2] / L)


def lathe(profile, seg=24, arc=360.0, close=True, group=0, smooth=True,
          twist=0.0, wobble=None):
    """Revolve a (radius, z) profile about +Z.

    This is the workhorse: towers, domes, mushroom caps, teacups, teapots,
    urns, balusters, finials, clock bezels and rolled roof eaves are all
    profiles. A profile is where a real silhouette lives — a cone roof and a
    bell roof differ only in whether the profile is a straight line.

    `wobble(a, t) -> radius multiplier` breaks the perfect circle, which is
    what stops a lathe reading as a lathe on an organic form.
    """
    m = Mesh()
    n = len(profile)
    full = abs(arc - 360.0) < 1e-6
    cols = seg if full else seg + 1
    ring = []
    for i in range(cols):
        t = i / float(seg)
        a = math.radians(arc * t)
        col = []
        for j, (r, z) in enumerate(profile):
            tw = math.radians(twist) * (j / float(max(1, n - 1)))
            k = 1.0 if wobble is None else float(wobble(a, j / float(max(1, n - 1))))
            col.append(m.add_vert(math.cos(a + tw) * r * k,
                                  math.sin(a + tw) * r * k, z))
        ring.append(col)
    g = group if smooth else group
    for i in range(cols if full else cols - 1):
        i2 = (i + 1) % cols
        for j in range(n - 1):
            a, b = ring[i][j], ring[i2][j]
            c, d = ring[i2][j + 1], ring[i][j + 1]
            u0, u1 = i / float(seg), (i + 1) / float(seg)
            v0, v1 = j / float(n - 1), (j + 1) / float(n - 1)
            deg = (profile[j][0] < 1e-7 and profile[j + 1][0] < 1e-7)
            if deg:
                continue
            gg = g if smooth else g + j
            if profile[j][0] < 1e-7:
                m.add_tri(a, c, d, ((u0, v0), (u1, v1), (u0, v1)), gg)
            elif profile[j + 1][0] < 1e-7:
                m.add_tri(a, b, c, ((u0, v0), (u1, v0), (u1, v1)), gg)
            else:
                m.add_quad(a, b, c, d,
                           ((u0, v0), (u1, v0), (u1, v1), (u0, v1)), gg)
    if close and full:
        # Cap any open end with a fan, in its own group so the cap is hard.
        for j, sgn in ((0, -1), (n - 1, 1)):
            r = profile[j][0]
            if r < 1e-7:
                continue
            cz = profile[j][1]
            cvi = m.add_vert(0.0, 0.0, cz)
            gg = group + 900 + j
            for i in range(cols):
                i2 = (i + 1) % cols
                a, b = ring[i][j], ring[i2][j]
                if sgn > 0:
                    m.add_tri(cvi, a, b, group=gg)
                else:
                    m.add_tri(cvi, b, a, group=gg)
    return m


def _clean_poly(poly, eps=1e-6):
    """Drop consecutive duplicate points. A petal outline traced up one side
    and back down the other lands on its tip twice; the duplicate makes a
    zero-area side quad and two zero-area cap triangles, which the validator
    found in every rose and vine — 120 dead triangles per rose."""
    out = []
    for p in poly:
        if out and abs(p[0] - out[-1][0]) < eps and abs(p[1] - out[-1][1]) < eps:
            continue
        out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) < eps and abs(out[0][1] - out[-1][1]) < eps:
        out.pop()
    return out


def prism(poly, h, group=0, cap=True, taper=1.0):
    """Extrude a 2D polygon along +Z from -h/2 to +h/2, optionally tapering."""
    m = Mesh()
    poly = _clean_poly(poly)
    n = len(poly)
    bot = [m.add_vert(x, y, -h * 0.5) for (x, y) in poly]
    top = [m.add_vert(x * taper, y * taper, h * 0.5) for (x, y) in poly]
    for i in range(n):
        j = (i + 1) % n
        m.add_quad(bot[i], bot[j], top[j], top[i], group=group + 10 + i)
    if cap:
        tris = earclip(poly)
        for (a, b, c) in tris:
            m.add_tri(top[a], top[b], top[c], group=group + 1)
            m.add_tri(bot[c], bot[b], bot[a], group=group + 2)
    return m


def loft(sections, closed_ring=True, group=0, cap_ends=True, smooth=True):
    """Stitch a list of equal-length rings of 3D points into a surface.

    Trunks, branches, gnarled stems and tapered towers are lofts: every ring
    can have its own radius, offset, rotation and noise, which is exactly the
    freedom a lathe does not have."""
    m = Mesh()
    idx = [[m.add_vert(*p) for p in ring] for ring in sections]
    n = len(sections[0])
    for s in range(len(sections) - 1):
        for i in range(n if closed_ring else n - 1):
            j = (i + 1) % n
            a, b = idx[s][i], idx[s][j]
            c, d = idx[s + 1][j], idx[s + 1][i]
            u0, u1 = i / float(n), (i + 1) / float(n)
            v0 = s / float(len(sections) - 1)
            v1 = (s + 1) / float(len(sections) - 1)
            m.add_quad(a, b, c, d,
                       ((u0, v0), (u1, v0), (u1, v1), (u0, v1)),
                       group if smooth else group + s)
    if cap_ends and closed_ring:
        for s, sgn in ((0, -1), (len(sections) - 1, 1)):
            ring = sections[s]
            cx = sum(p[0] for p in ring) / n
            cy = sum(p[1] for p in ring) / n
            cz = sum(p[2] for p in ring) / n
            cvi = m.add_vert(cx, cy, cz)
            gg = group + 800 + s
            for i in range(n):
                j = (i + 1) % n
                if sgn > 0:
                    m.add_tri(cvi, idx[s][i], idx[s][j], group=gg)
                else:
                    m.add_tri(cvi, idx[s][j], idx[s][i], group=gg)
    return m


def tube(path, radii, sides=8, group=0, cap=True, twist=0.0):
    """Sweep a circle along a 3D polyline using parallel-transport frames.

    Branches, vines, filigree scrolls, teapot spouts, key shafts, twisted
    railing bars. Parallel transport rather than a fixed up-vector because a
    branch that curves through vertical makes the naive frame flip and the
    tube turn inside out."""
    pts = [tuple(float(c) for c in p) for p in path]
    n = len(pts)
    if n < 2:
        return Mesh()
    if not hasattr(radii, "__len__"):
        radii = [float(radii)] * n
    tangents = []
    for i in range(n):
        if i == 0:
            t = _sub(pts[1], pts[0])
        elif i == n - 1:
            t = _sub(pts[n - 1], pts[n - 2])
        else:
            t = _sub(pts[i + 1], pts[i - 1])
        tangents.append(_norm(t))
    ref = (0.0, 0.0, 1.0)
    if abs(_dot(tangents[0], ref)) > 0.9:
        ref = (1.0, 0.0, 0.0)
    normal = _norm(_cross(ref, tangents[0]))
    frames = []
    for i in range(n):
        if i > 0:
            axis = _cross(tangents[i - 1], tangents[i])
            L = _len(axis)
            if L > 1e-9:
                ang = math.atan2(L, _dot(tangents[i - 1], tangents[i]))
                normal = _rot_about(normal, _norm(axis), ang)
            normal = _norm(_sub(normal, _mul(tangents[i], _dot(normal, tangents[i]))))
        binormal = _cross(tangents[i], normal)
        frames.append((normal, binormal))
    sections = []
    for i in range(n):
        nrm, bin_ = frames[i]
        tw = math.radians(twist) * (i / float(n - 1))
        ring = []
        for k in range(sides):
            a = 2.0 * math.pi * k / sides + tw
            ca, sa = math.cos(a) * radii[i], math.sin(a) * radii[i]
            ring.append((pts[i][0] + nrm[0] * ca + bin_[0] * sa,
                         pts[i][1] + nrm[1] * ca + bin_[1] * sa,
                         pts[i][2] + nrm[2] * ca + bin_[2] * sa))
        sections.append(ring)
    return loft(sections, group=group, cap_ends=cap)


def torus(R, r, major=24, minor=10, arc=360.0, group=0):
    """A ring. Arches, handles, gate hoops, halos, barrel bands."""
    sections = []
    steps = major if abs(arc - 360.0) < 1e-6 else major + 1
    for i in range(steps):
        a = math.radians(arc * i / float(major))
        ca, sa = math.cos(a), math.sin(a)
        ring = []
        for j in range(minor):
            b = 2.0 * math.pi * j / minor
            rr = R + r * math.cos(b)
            ring.append((ca * rr, sa * rr, r * math.sin(b)))
        sections.append(ring)
    if abs(arc - 360.0) < 1e-6:
        sections.append(sections[0])
        m = loft(sections, group=group, cap_ends=False)
        return m
    return loft(sections, group=group, cap_ends=True)


def plate(poly, thickness, group=0):
    """A flat polygon given thickness — leaves, petals, playing cards, clock
    hands, roof tiles."""
    return prism(poly, thickness, group=group)


# -- small vector helpers ---------------------------------------------------

def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _len(a):
    return math.sqrt(_dot(a, a))


def _norm(a):
    L = _len(a)
    return (a[0] / L, a[1] / L, a[2] / L) if L > 1e-12 else (0.0, 0.0, 1.0)


def _rot_about(v, axis, ang):
    c, s = math.cos(ang), math.sin(ang)
    return _add(_add(_mul(v, c), _mul(_cross(axis, v), s)),
                _mul(axis, _dot(axis, v) * (1.0 - c)))


def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


# --------------------------------------------------------------------------
# profile helpers — the shapes that stop a lathe reading as a cone
# --------------------------------------------------------------------------


def ogee(r0, r1, h, steps=10, bulge=0.28, z0=0.0):
    """An S-curve from radius r0 up to r1 over height h.

    A fairy-tale roof is an ogee; a placeholder roof is a straight line. Same
    two endpoints, entirely different silhouette, and the founder's list names
    "cone roofs" explicitly."""
    out = []
    for i in range(steps + 1):
        t = i / float(steps)
        # cubic ease that overshoots outward low and tucks in high
        e = t * t * (3.0 - 2.0 * t)
        r = r0 + (r1 - r0) * e + bulge * (r0 - r1) * math.sin(math.pi * t) * 0.5
        out.append((max(r, 0.0), z0 + h * t))
    return out


def bell(r0, h, steps=12, flare=0.22, z0=0.0):
    """Onion/bell dome: swells above the springing, then draws to a point."""
    out = []
    for i in range(steps + 1):
        t = i / float(steps)
        r = r0 * (math.cos(t * math.pi * 0.5) ** 0.72) * (1.0 + flare * math.sin(math.pi * t) * (1.0 - t))
        out.append((max(r, 0.0), z0 + h * t))
    out[-1] = (0.0, z0 + h)
    return out


def scallop_edge(r, n, depth=0.18, phase=0.0):
    """A wobble function for lathe(): n scallops around, `depth` deep.
    Turns a plain drum into a fluted column or a cap with a lobed rim."""
    def f(a, t):
        return 1.0 + depth * math.cos(n * (a + phase))
    return f


# --------------------------------------------------------------------------
# decimation — the LOD chain this world actually needs
# --------------------------------------------------------------------------


def decimate(mesh, cell, group=None):
    """Vertex-cluster decimation onto a grid of `cell` uu.

    WHY THIS AND NOT NANITE. The project targets SM5 only, on purpose and by
    measurement: SM6 halved the frame rate on the L4 with the frame visually
    identical, and Nanite is inert without SM6. So the proven lever here is
    REDUCTION LODs, and /Engine/BasicShapes cannot supply them — a Sphere is
    ~1,900 triangles with exactly one LOD, which is why 50,285 of them cost
    ~95 million triangles a frame however far away they are.

    Authored geometry can do what the engine primitives cannot: ship a real
    LOD chain. Vertex clustering is the right algorithm for it here — it is
    deterministic, it never produces a non-manifold surprise, it collapses
    exactly the detail that has fallen below a pixel, and it runs in one pass
    with no floating-point comparison to tune.

    Triangles whose three corners land in one cell vanish, which is the point.
    """
    if cell <= 0.0:
        return mesh.copy()
    out = Mesh()
    remap, reps = {}, {}
    for i, v in enumerate(mesh.verts):
        key = (int(math.floor(v[0] / cell)), int(math.floor(v[1] / cell)),
               int(math.floor(v[2] / cell)))
        acc = reps.get(key)
        if acc is None:
            reps[key] = [v[0], v[1], v[2], 1]
        else:
            acc[0] += v[0]
            acc[1] += v[1]
            acc[2] += v[2]
            acc[3] += 1
        remap[i] = key
    order = {}
    for key, acc in reps.items():
        order[key] = out.add_vert(acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3])
    seen = set()
    for ti, (a, b, c) in enumerate(mesh.tris):
        ka, kb, kc = remap[a], remap[b], remap[c]
        if ka == kb or kb == kc or ka == kc:
            continue
        ia, ib, ic = order[ka], order[kb], order[kc]
        key = frozenset((ia, ib, ic))
        if key in seen:
            continue                       # two source tris folded onto one
        pa, pb, pc = out.verts[ia], out.verts[ib], out.verts[ic]
        ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
        wx, wy, wz = pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]
        n = (uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx)
        if (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) < 1e-9:
            continue                       # collapsed to a sliver
        # A FOLD-OVER IS A TRIANGLE WHOSE NORMAL FLIPPED. Clustering can drag
        # one corner past the opposite edge, and the result is a bow-tie that
        # shares its edges with three neighbours and renders as a black
        # flicker at distance. Compare against the source triangle's normal
        # and drop anything that turned round — the validator counted
        # hundreds of these per LOD before this test existed.
        qa, qb, qc = mesh.verts[a], mesh.verts[b], mesh.verts[c]
        sx, sy, sz = qb[0] - qa[0], qb[1] - qa[1], qb[2] - qa[2]
        tx, ty, tz = qc[0] - qa[0], qc[1] - qa[1], qc[2] - qa[2]
        n0 = (sy * tz - sz * ty, sz * tx - sx * tz, sx * ty - sy * tx)
        if n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] < 0.0:
            continue
        seen.add(key)
        out.add_tri(ia, ib, ic, mesh.uvs[ti],
                    mesh.groups[ti] if group is None else group)
    return out


def lod_chain(mesh, levels=(0.0, 0.028, 0.065, 0.140), floor_tris=24):
    """LOD0 plus reductions at fractions of the mesh's own size.

    The cell is expressed as a fraction of the bounding box so one setting
    suits a 100 uu flagstone and a 100 uu castle alike. A level that fails to
    reduce, or that reduces below `floor_tris`, is dropped rather than shipped
    — an LOD that is not cheaper is pure overhead, and one that is empty is a
    hole in the world at a distance nobody tested."""
    ex = mesh.extents()
    diag = math.sqrt(sum(e * e for e in ex)) or 1.0
    out = [mesh]
    for f in levels[1:]:
        d = decimate(mesh, diag * f)
        if d.tri_count() < floor_tris:
            break
        if d.tri_count() >= out[-1].tri_count() * 0.92:
            continue
        out.append(d)
    return out
