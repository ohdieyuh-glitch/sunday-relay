"""Geometry authoring on bmesh: the operations the Wonderland kit is written in.

WHY NOT USE `meshkit`. `wonderland/infra/build/hd/meshkit.py` is a good
dependency-free kernel and it exists because the laptop that wrote it had no
Blender. This host has real Blender 4.5 LTS, so the kit is written against
bmesh instead and gets, for free, the three things meshkit costs effort to
approximate: a bevel that actually miters, a boolean that actually cuts, and a
normals/manifold model the validator can interrogate rather than infer.

The two kernels are not in competition. meshkit builds the V2 world's meshes
INSIDE the editor at build time; this builds authored files the generator
places. Where the same shape appears in both, this file's version is the more
detailed one and the manifest says so.

WHY THE SURFACE GENERATORS ARE HAND-WRITTEN. `lathe` and `sweep` emit rings
and quads directly rather than driving `bmesh.ops.spin`. Two reasons, both
paid for: spin's merge behaviour at a pole depends on floating-point equality
of the axis vertex, which silently leaves a seam on some profiles; and a
hand-written ring loop lets a profile declare its own smooth/flat shading per
segment, which is what stops a lathed cornice reading as a lathe.

CONVENTIONS INSIDE THIS FILE. Everything is metres. Profiles are lists of
`(r, z)` -- radius from the Z axis, height above the module footing. Polygons
are lists of `(x, y)`. Paths are lists of `(x, y, z)`. Angles are degrees at
the call site and radians inside.
"""

import math

import bpy          # noqa: F401  -- must precede bmesh: the `bpy` wheel only
import bmesh        # registers the sibling modules once bpy itself is loaded
from mathutils import Matrix, Vector

TAU = math.pi * 2.0


# --------------------------------------------------------------------------
# deterministic noise -- the same hash as the V2 kernel, on purpose
# --------------------------------------------------------------------------
#
# `meshkit.rnd` hashes with fixed masks precisely because `hash()` is
# randomised by PYTHONHASHSEED and "the same asset must build byte-identically
# on this laptop and on the Studio". The forge inherits that requirement: a
# rebuild that changes a vertex changes the export, and a changing export makes
# the manifest's measured numbers unreproducible. So this is meshkit's hash,
# reimplemented rather than imported, because meshkit is Unreal-build-side code
# and the forge must not depend on it.


def _hash3(i, j, k, seed=0):
    h = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 1274126177) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) & 0xFFFFFFFF
    h = (h * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) & 0xFFFFFFFF


def rnd(*key):
    """Deterministic float in [0, 1) from any tuple of numbers."""
    ints = [int(round(float(k) * 1024.0)) for k in key]
    while len(ints) < 3:
        ints.append(0)
    h = _hash3(ints[0], ints[1], ints[2], seed=len(ints))
    for extra in ints[3:]:
        h = _hash3(h & 0xFFFF, extra, h >> 16, seed=7)
    return h / 4294967296.0


def rrange(lo, hi, *key):
    return lo + (hi - lo) * rnd(*key)


# --------------------------------------------------------------------------
# transforms
# --------------------------------------------------------------------------


def xform(at=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0), scale=1.0):
    """A matrix from (translate, XYZ-euler in DEGREES, uniform-or-triple scale).

    Rotation order is X then Y then Z, applied about the local origin before
    translation -- the order Blender calls 'XYZ' and the one every call site in
    the families assumes.
    """
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    m = Matrix.Translation(Vector(at))
    m = m @ Matrix.Rotation(math.radians(rot[2]), 4, "Z")
    m = m @ Matrix.Rotation(math.radians(rot[1]), 4, "Y")
    m = m @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
    m = m @ Matrix.Diagonal(Vector(scale).to_4d())
    return m


# --------------------------------------------------------------------------
# the part: one material's worth of geometry
# --------------------------------------------------------------------------


class Part(object):
    """An accumulating bmesh for a single material slot.

    Every primitive below appends into a Part. A module writes into as many
    Parts as it has materials and never into more than one at a time, which is
    how the one-slot-per-mesh rule stays true by construction instead of by
    review.
    """

    def __init__(self, key):
        self.key = key
        self.bm = bmesh.new()

    # -- the low-level append ------------------------------------------------

    def _append(self, verts, faces, matrix=None, smooth=False, flip=False):
        """Add a vertex list and an index-tuple face list."""
        if matrix is not None:
            verts = [matrix @ Vector(v) for v in verts]
        else:
            verts = [Vector(v) for v in verts]
        bv = [self.bm.verts.new(v) for v in verts]
        made = []
        for f in faces:
            if flip:
                f = tuple(reversed(f))
            try:
                face = self.bm.faces.new([bv[i] for i in f])
            except ValueError:
                continue          # a duplicate face at a shared seam; harmless
            face.smooth = smooth
            made.append(face)
        self.bm.verts.index_update()
        return made

    # -- surfaces ------------------------------------------------------------

    def lathe(self, profile, segments=32, arc=360.0, matrix=None, smooth=True,
              cap_bottom=True, cap_top=True, flip=False):
        """Revolve a `(r, z)` profile about the Z axis.

        A profile point with r == 0 is a pole and is emitted once, so the tip
        of a spire is a single vertex and not a degenerate ring of them --
        which matters because a fan of zero-area triangles is exactly the
        'degenerate geometry' the validator fails on.

        `arc` < 360 leaves the revolve open and caps the two radial ends, which
        is how a buttress or a half-round respond gets built.
        """
        prof = [(float(r), float(z)) for (r, z) in profile]
        if len(prof) < 2:
            raise ValueError("a lathe profile needs at least two points")
        closed = abs(float(arc) - 360.0) < 1e-6
        rings = int(segments) if closed else int(segments) + 1
        step = math.radians(float(arc)) / (int(segments) if closed else int(segments))

        verts, index = [], []
        for (r, z) in prof:
            if r <= 1e-9:
                index.append(("pole", len(verts)))
                verts.append((0.0, 0.0, z))
            else:
                row = []
                for s in range(rings):
                    a = s * step
                    row.append(len(verts))
                    verts.append((math.cos(a) * r, math.sin(a) * r, z))
                index.append(("ring", row))

        faces = []
        for i in range(len(prof) - 1):
            k0, v0 = index[i]
            k1, v1 = index[i + 1]
            span = rings if closed else rings - 1
            for s in range(span):
                t = (s + 1) % rings if closed else s + 1
                if k0 == "pole" and k1 == "ring":
                    faces.append((v0, v1[s], v1[t]))
                elif k0 == "ring" and k1 == "pole":
                    faces.append((v0[s], v1, v0[t]))
                elif k0 == "ring" and k1 == "ring":
                    faces.append((v0[s], v0[t], v1[t], v1[s]))
                # pole to pole is a zero-area segment; skipped on purpose

        # caps: only where the profile leaves an open ring on the axis side
        if closed:
            if cap_bottom and index[0][0] == "ring":
                faces.append(tuple(reversed(index[0][1])))
            if cap_top and index[-1][0] == "ring":
                faces.append(tuple(index[-1][1]))
        else:
            # the two radial ends: the profile itself, swept nowhere
            for side, rev in ((0, False), (rings - 1, True)):
                ring_face = []
                for k, v in index:
                    ring_face.append(v if k == "pole" else v[side])
                seen, uniq = set(), []
                for i in ring_face:
                    if i not in seen:
                        seen.add(i)
                        uniq.append(i)
                if len(uniq) >= 3:
                    faces.append(tuple(reversed(uniq)) if rev else tuple(uniq))
            # AND the top and bottom edges, as pie slices back to the axis.
            #
            # Without these a partial revolve whose profile does not begin and
            # end on the axis is an OPEN shell, and `recalc_face_normals` has
            # no outside to point at -- it orients such a shell arbitrarily.
            # `WL_Tower_Mid_Oriel`'s three bay hoods came out inside-out
            # because of exactly this, and the validator's signed-volume test
            # is what found it. Closing the shell makes the answer determinate.
            for end, rev in ((0, True), (len(prof) - 1, False)):
                kind, row = index[end]
                if kind != "ring":
                    continue
                axis = len(verts)
                verts.append((0.0, 0.0, prof[end][1]))
                fan = list(row) + [axis]
                if rev:
                    fan = list(reversed(fan))
                for s in range(len(row) - 1):
                    tri = (row[s], row[s + 1], axis)
                    faces.append(tuple(reversed(tri)) if rev else tri)

        return self._append(verts, faces, matrix, smooth=smooth, flip=flip)

    def prism(self, poly, height, matrix=None, z0=0.0, cap=True, taper=1.0,
              smooth=False):
        """Extrude a `(x, y)` polygon along +Z, optionally tapering the top."""
        poly = _dedupe(poly)
        n = len(poly)
        if n < 3:
            raise ValueError("a prism needs at least three points")
        if _signed_area(poly) < 0:
            poly = list(reversed(poly))
        verts, faces = [], []
        for (x, y) in poly:
            verts.append((x, y, z0))
        for (x, y) in poly:
            verts.append((x * taper, y * taper, z0 + height))
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i))
        if cap:
            faces.append(tuple(reversed(range(n))))
            faces.append(tuple(range(n, 2 * n)))
        return self._append(verts, faces, matrix, smooth=smooth)

    def box(self, w, d, h, at=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0),
            chamfer=None, matrix=None, centre_z=True):
        """A box, centred in X and Y. `centre_z=False` puts its base at `at.z`.

        A chamfer is not decoration. meshkit's docstring puts it plainly: a
        perfectly sharp 90-degree edge "is the single loudest 'this is a
        primitive' tell", and an arris costs 24 vertices. Every cut-stone
        element in this kit takes one.
        """
        hw, hd = w * 0.5, d * 0.5
        z0 = -h * 0.5 if centre_z else 0.0
        z1 = z0 + h
        c = 0.0 if not chamfer else min(float(chamfer), hw * 0.49, hd * 0.49, h * 0.49)
        local = xform(at, rot)
        if matrix is not None:
            local = matrix @ local
        if c <= 0.0:
            verts = [(-hw, -hd, z0), (hw, -hd, z0), (hw, hd, z0), (-hw, hd, z0),
                     (-hw, -hd, z1), (hw, -hd, z1), (hw, hd, z1), (-hw, hd, z1)]
            faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
                     (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
            return self._append(verts, faces, local)
        # chamfered: an inset ring at each of four heights
        levels = ((z0, hw - c, hd - c), (z0 + c, hw, hd),
                  (z1 - c, hw, hd), (z1, hw - c, hd - c))
        verts, faces = [], []
        for (z, ax, ay) in levels:
            for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                verts.append((sx * ax, sy * ay, z))
        for lvl in range(3):
            a, b = lvl * 4, (lvl + 1) * 4
            for i in range(4):
                j = (i + 1) % 4
                faces.append((a + i, a + j, b + j, b + i))
        faces.append((3, 2, 1, 0))
        faces.append((12, 13, 14, 15))
        return self._append(verts, faces, local)

    def sweep(self, path, radii, sides=8, matrix=None, smooth=True, cap=True,
              profile=None):
        """A tube of varying radius along a polyline, with parallel transport.

        `profile` optionally replaces the circle with a `(u, v)` cross-section
        in the frame's plane -- how the mouldings and the gold bars are made
        without a second code path.
        """
        pts = [Vector(p) for p in path]
        if len(pts) < 2:
            raise ValueError("a sweep needs at least two path points")
        if isinstance(radii, (int, float)):
            radii = [float(radii)] * len(pts)
        if len(radii) != len(pts):
            raise ValueError("sweep: %d points but %d radii" % (len(pts), len(radii)))

        if profile is None:
            profile = [(math.cos(TAU * i / sides), math.sin(TAU * i / sides))
                       for i in range(int(sides))]
        n = len(profile)

        tangents = []
        for i in range(len(pts)):
            if i == 0:
                t = pts[1] - pts[0]
            elif i == len(pts) - 1:
                t = pts[-1] - pts[-2]
            else:
                t = pts[i + 1] - pts[i - 1]
            if t.length < 1e-9:
                t = Vector((0.0, 0.0, 1.0))
            tangents.append(t.normalized())

        up = Vector((0.0, 0.0, 1.0))
        if abs(tangents[0].dot(up)) > 0.999:
            up = Vector((1.0, 0.0, 0.0))
        normal = (up - tangents[0] * up.dot(tangents[0])).normalized()

        verts, rings = [], []
        for i, p in enumerate(pts):
            if i > 0:
                # parallel transport: rotate the frame by the tangent's turn
                prev, cur = tangents[i - 1], tangents[i]
                axis = prev.cross(cur)
                if axis.length > 1e-9:
                    ang = math.atan2(axis.length, prev.dot(cur))
                    normal = (Matrix.Rotation(ang, 4, axis.normalized())
                              @ normal).normalized()
                normal = (normal - cur * normal.dot(cur)).normalized()
            binorm = tangents[i].cross(normal).normalized()
            row = []
            for (u, v) in profile:
                row.append(len(verts))
                off = normal * (u * radii[i]) + binorm * (v * radii[i])
                verts.append(tuple(p + off))
            rings.append(row)

        faces = []
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            for s in range(n):
                t = (s + 1) % n
                faces.append((a[s], a[t], b[t], b[s]))
        if cap:
            faces.append(tuple(reversed(rings[0])))
            faces.append(tuple(rings[-1]))
        return self._append(verts, faces, matrix, smooth=smooth)

    def loft(self, sections, matrix=None, smooth=True, cap_ends=True):
        """Skin a list of equal-length `(x, y, z)` rings. The taper primitive."""
        n = len(sections[0])
        verts, rings = [], []
        for sec in sections:
            if len(sec) != n:
                raise ValueError("loft sections must be equal length")
            row = []
            for p in sec:
                row.append(len(verts))
                verts.append(tuple(p))
            rings.append(row)
        faces = []
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            for s in range(n):
                t = (s + 1) % n
                faces.append((a[s], a[t], b[t], b[s]))
        if cap_ends:
            faces.append(tuple(reversed(rings[0])))
            faces.append(tuple(rings[-1]))
        return self._append(verts, faces, matrix, smooth=smooth)

    def plate(self, poly, thickness, matrix=None, z0=0.0):
        """A flat slab from a polygon: tracery, a sign, a bridge deck."""
        return self.prism(poly, thickness, matrix=matrix, z0=z0)

    # -- surface treatment ---------------------------------------------------

    def bevel(self, faces, offset, segments=1):
        """Bevel the edges of the faces just made. Returns nothing useful."""
        edges = set()
        for f in faces:
            if not f.is_valid:
                continue
            for e in f.edges:
                edges.add(e)
        if not edges:
            return
        bmesh.ops.bevel(self.bm, geom=list(edges), offset=float(offset),
                        segments=int(segments), affect="EDGES", clamp_overlap=True,
                        profile=0.5)

    def displace(self, faces, amount, freq, seed=0):
        """Push the given faces' vertices along their normals by value noise.

        Used sparingly: on a 40 m tower a 3 cm displacement is the difference
        between cut stone and extruded plastic, and anything more reads as
        damage rather than as surface.
        """
        vs = set()
        for f in faces:
            if f.is_valid:
                vs.update(f.verts)
        for v in vs:
            p = v.co
            k = rnd(p.x * freq, p.y * freq, p.z * freq, seed) - 0.5
            nrm = v.normal
            if nrm.length < 1e-9:
                continue
            v.co = p + nrm.normalized() * (k * 2.0 * amount)

    def shade_smooth(self, faces, on=True):
        for f in faces:
            if f.is_valid:
                f.smooth = bool(on)

    # -- finishing -----------------------------------------------------------

    def finalise(self, weld=1e-5):
        """Weld coincident vertices and recompute normals outward.

        Modules are built by appending dozens of independent primitives, so a
        module is a UNION of shells rather than a single closed surface. That
        is correct for this pipeline -- Nanite and the V2 batch renderer both
        take it -- and it is why the validator checks 'no degenerate faces, no
        inverted normals, no loose geometry' rather than 'closed manifold',
        which would be a bar this kit's own construction method could not meet.
        """
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=float(weld))
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        # kill zero-area faces before they reach the exporter
        gone = [f for f in bm.faces if f.calc_area() < 1e-12]
        if gone:
            bmesh.ops.delete(bm, geom=gone, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.normal_update()
        return self

    def tri_count(self):
        return sum(max(0, len(f.verts) - 2) for f in self.bm.faces)

    def bbox(self):
        if not self.bm.verts:
            return None
        xs = [v.co.x for v in self.bm.verts]
        ys = [v.co.y for v in self.bm.verts]
        zs = [v.co.z for v in self.bm.verts]
        return (min(xs), min(ys), min(zs), max(xs), max(ys), max(zs))

    def is_empty(self):
        return len(self.bm.faces) == 0


# --------------------------------------------------------------------------
# polygon helpers
# --------------------------------------------------------------------------


def _signed_area(poly):
    a = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        a += x0 * y1 - x1 * y0
    return a * 0.5


def _dedupe(poly, eps=1e-7):
    out = []
    for p in poly:
        if not out or (abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps):
            out.append((float(p[0]), float(p[1])))
    while len(out) > 1 and abs(out[0][0] - out[-1][0]) < eps and abs(out[0][1] - out[-1][1]) < eps:
        out.pop()
    return out


def ngon(n, radius, phase=0.0):
    """A regular polygon in the XY plane. The plan of most shafts."""
    return [(math.cos(phase + TAU * i / n) * radius,
             math.sin(phase + TAU * i / n) * radius) for i in range(int(n))]


def star_ngon(n, r_outer, r_inner, phase=0.0):
    """An n-pointed star plan -- a shaft with pilasters, in one polygon."""
    out = []
    for i in range(int(n) * 2):
        r = r_outer if i % 2 == 0 else r_inner
        a = phase + math.pi * i / float(n)
        out.append((math.cos(a) * r, math.sin(a) * r))
    return out


def lobed_ngon(n, radius, lobe, segments_per_lobe=5, phase=0.0):
    """A scalloped plan: n round lobes on a circle. Reads as clustered shafts,
    which is the plan the reference's fatter towers actually have."""
    out = []
    total = int(n) * int(segments_per_lobe)
    for i in range(total):
        a = phase + TAU * i / total
        r = radius + lobe * abs(math.sin(n * (a - phase) * 0.5))
        out.append((math.cos(a) * r, math.sin(a) * r))
    return out


# --------------------------------------------------------------------------
# profile helpers -- the vocabulary of the silhouette
# --------------------------------------------------------------------------


def entasis(r0, r1, z0, z1, steps=8, belly=0.035):
    """A shaft that swells slightly at a third of its height.

    A straight taper reads as a cone. Classical entasis is about 1/150 of the
    height; at Wonderland's scale and stylisation 3.5% is legible at 200 m
    without looking inflated.
    """
    out = []
    for i in range(int(steps) + 1):
        t = i / float(steps)
        r = r0 + (r1 - r0) * t
        out.append((r * (1.0 + belly * math.sin(math.pi * t ** 0.85)), z0 + (z1 - z0) * t))
    return out


def ogee(r0, r1, z0, z1, steps=10, bulge=0.28):
    """An S-curve: a bulb dome, the flare under a crown, an onion's shoulder."""
    out = []
    for i in range(int(steps) + 1):
        t = i / float(steps)
        s = t * t * (3.0 - 2.0 * t)
        r = r0 + (r1 - r0) * s + bulge * (r0 - r1) * math.sin(math.pi * t)
        out.append((r, z0 + (z1 - z0) * t))
    return out


def needle(r0, height, steps=7, concavity=0.42, z0=0.0):
    """The reference's dominant crown: a very tall cone whose sides are
    slightly HOLLOWED, so it reads as a spire rather than a party hat.

    `concavity` 0 is a straight cone. The reference's needles sit near 0.4:
    the profile leaves the shoulder almost vertically and only turns in over
    the last third, which is what makes them look tall.
    """
    out = []
    for i in range(int(steps) + 1):
        t = i / float(steps)
        r = r0 * (1.0 - t) ** (1.0 + concavity * 2.0)
        out.append((max(0.0, r), z0 + height * t))
    if out[-1][0] > 1e-9:
        out.append((0.0, z0 + height))
    return out


def bell(r0, height, steps=10, flare=0.24, z0=0.0):
    """A flared roof: it kicks out at the eaves before rising. A witch's hat."""
    out = []
    for i in range(int(steps) + 1):
        t = i / float(steps)
        r = r0 * ((1.0 - t) ** 1.25 + flare * math.sin(math.pi * t ** 1.6) * (1.0 - t))
        out.append((max(0.0, r), z0 + height * t))
    out.append((0.0, z0 + height))
    return out


def onion(r0, height, steps=14, waist=0.86, shoulder=1.16, z0=0.0):
    """A bulb dome: in at the neck, out past the springing, to a point."""
    out = [(r0 * waist, z0)]
    for i in range(1, int(steps) + 1):
        t = i / float(steps)
        r = r0 * (shoulder * math.sin(math.pi * (0.12 + 0.80 * t)) ** 0.85) * (1.0 - t ** 3.2)
        out.append((max(0.0, r), z0 + height * t))
    out.append((0.0, z0 + height))
    return out


def moulding(r, z, run):
    """Append a cornice run to a profile: a sequence of `(dr, dz)` steps.

    Written as deltas because a cornice is a RELATIVE thing -- the same
    torus/fillet/corona sequence at four different radii up a tower is one
    call site, and a string course that had to restate its own radius would
    drift the moment the shaft's taper changed.
    """
    out, cr, cz = [], float(r), float(z)
    for (dr, dz) in run:
        cr += dr
        cz += dz
        out.append((max(0.0, cr), cz))
    return out


#: Cornice runs, named. These are the kit's shared detail vocabulary: any
#: module can put a CORNICE_CORBEL under its crown and the two will match.
CORNICE_STRING = ((0.16, 0.00), (0.04, 0.10), (-0.04, 0.10), (-0.16, 0.00))
CORNICE_CORBEL = ((0.10, 0.06), (0.22, 0.16), (0.06, 0.22), (-0.05, 0.10),
                  (-0.33, 0.00))
CORNICE_CAVETTO = ((0.12, 0.00), (0.16, 0.20), (-0.02, 0.14), (-0.26, 0.04))
CORNICE_ASTRAGAL = ((0.09, 0.02), (0.02, 0.07), (-0.02, 0.07), (-0.09, 0.02))


# --------------------------------------------------------------------------
# the forge: scene management and object emission
# --------------------------------------------------------------------------


class Forge(object):
    """The build context. One per process; `reset()` between modules."""

    def __init__(self):
        self.parts = {}

    # -- part access ---------------------------------------------------------

    def part(self, key):
        """The accumulator for one material. Creates it on first use."""
        if key not in self.parts:
            self.parts[key] = Part(key)
        return self.parts[key]

    def reset(self):
        for p in self.parts.values():
            p.bm.free()
        self.parts = {}

    # -- emission ------------------------------------------------------------

    def emit(self, asset_id):
        """Turn the accumulated parts into Blender objects.

        Returns `{part_key: bpy.types.Object}`. Empty parts are dropped rather
        than exported as a zero-triangle mesh, because an empty file in
        `exports/` is a file the world session would try to place.
        """
        made = {}
        for key, part in sorted(self.parts.items()):
            part.finalise()
            if part.is_empty():
                continue
            name = "%s_%s" % (asset_id, key) if key != "stone" else asset_id
            me = bpy.data.meshes.new(name)
            part.bm.to_mesh(me)
            me.update()
            _assign_material(me, key)
            _box_uvs(me)
            obj = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(obj)
            made[key] = obj
        return made


def _assign_material(me, key):
    """One material, one slot -- the constraint, made physical.

    The material is NAMED for the V2 instance the world session must assign,
    and tinted with that instance's own values so preview renders and the GLB
    are on-palette. `materials_v2.py` remains the authority: this is a label
    and a preview colour, not a material definition.
    """
    from . import kit
    spec = kit.MATERIALS.get(key, kit.MATERIALS[kit.DEFAULT_PART])
    mat_name = spec["unreal"]
    mat = bpy.data.materials.get(mat_name)
    if mat is None:
        mat = bpy.data.materials.new(mat_name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            r, g, b = spec["rgb"]
            bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
            bsdf.inputs["Metallic"].default_value = spec["metallic"]
            bsdf.inputs["Roughness"].default_value = spec["roughness"]
            if spec["emissive"]:
                bsdf.inputs["Emission Color"].default_value = (r, g, b, 1.0)
                bsdf.inputs["Emission Strength"].default_value = spec["emissive"]
        mat.diffuse_color = (spec["rgb"][0], spec["rgb"][1], spec["rgb"][2], 1.0)
    me.materials.append(mat)
    for poly in me.polygons:
        poly.material_index = 0


def _box_uvs(me):
    """Planar-per-face UVs at a fixed world scale.

    NOT a real unwrap. The V2 materials are procedural (`materials_v2.py`
    builds them from a kind and a colour, with no texture samplers on most),
    so a UV set exists here to satisfy importers and to give any future
    tiling material something monotonic to work with. The manifest records
    `uv: "planar-world-2m"` rather than claiming a lightmap-ready layout,
    because claiming one would be the kind of thing nobody re-checks.
    """
    scale = 0.5           # 1 UV tile = 2 metres
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers[0]
    for poly in me.polygons:
        nx, ny, nz = abs(poly.normal.x), abs(poly.normal.y), abs(poly.normal.z)
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if nz >= nx and nz >= ny:
                u, v = co.x, co.y
            elif nx >= ny:
                u, v = co.y, co.z
            else:
                u, v = co.x, co.z
            uv.data[li].uv = (u * scale, v * scale)


def clear_scene():
    """Empty the .blend of everything a previous module left behind."""
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials):
        for item in list(coll):
            coll.remove(item, do_unlink=True)
