"""The shared architectural elements every family is spelled with.

WHY THESE ARE SHARED AND NOT COPIED. A kit whose modules each invent their own
column reads as a kit. The reference does not: one order of column, one arch
curve and one cornice run recur at every scale, and that repetition IS the
architectural identity. So a column is written once here, and a gatehouse pier,
an arcaded tower storey and a colonnade all call it. Change the capital and the
whole city changes together, which is the property that makes this a
vocabulary rather than a folder.

WHY OPENINGS ARE BUILT, NOT CUT. The obvious way to put an arcade in a tower is
to boolean arch-shaped holes out of a cylinder. It is also the way that
produces n-gons on the cut face, non-manifold slivers where two cuts meet, and
a triangle count dominated by the drum you then threw away. Every opening in
this kit is instead ASSEMBLED -- piers, then an arch band swept along the
curve, then a spandrel above -- so the hole is the space nothing was built in.
That is cheaper, it is manifold by construction, and it gives the arch real
voussoir depth, which is the thing that reads at distance.

ANGLES ARE DEGREES AT THE CALL SITE. Radians only inside.
"""

import math

from . import mesh as M

TAU = math.pi * 2.0


# --------------------------------------------------------------------------
# arch curves -- the kit's single most repeated line
# --------------------------------------------------------------------------


def _bezier(p0, p1, p2, p3, steps):
    out = []
    for i in range(int(steps) + 1):
        t = i / float(steps)
        u = 1.0 - t
        x = (u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0])
        y = (u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1])
        out.append((x, y))
    return out


def _arc(cx, cz, r, a0, a1, steps):
    out = []
    for i in range(int(steps) + 1):
        a = a0 + (a1 - a0) * i / float(steps)
        out.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return out


def arch_curve(span, rise, steps=14, kind="round", z0=0.0, x0=0.0):
    """The intrados of an opening, as `(x, z)` points left springing to right.

    `span` is the full width, `rise` the height from springing to crown. Four
    kinds, and the choice of kind is most of a district's character:

      round     a semicircle. Roman, calm; the colonnades and the undercrofts.
      pointed   a true two-centred arch. Both halves are circular arcs struck
                from centres ON the springing line, at c = (rise^2 - half^2) /
                (2 half). That formula is the whole of it: c > 0 gives the
                pointed arch, c = 0 degenerates exactly to the semicircle, and
                c < 0 gives a segmental arch -- so one kind covers three and
                any rise is legal instead of only the equilateral one.
      ogee      the keel: it bulges PAST the springing low down and draws into
                a point at the crown. Two cubics, mirrored. This is the curve
                the reference's gate heads and window heads actually draw, and
                it is the single most Wonderland-specific line in the kit.
      trefoil   three lobes, as three real arcs. Ornamental; screens and the
                small openings in a filigree panel.
    """
    half = span * 0.5
    n = max(4, int(steps))
    if rise <= 1e-9 or half <= 1e-9:
        raise ValueError("arch_curve needs a positive span and rise")

    if kind == "round":
        pts = [(-half * math.cos(math.pi * i / n), rise * math.sin(math.pi * i / n))
               for i in range(n + 1)]

    elif kind == "pointed":
        c = (rise * rise - half * half) / (2.0 * half)
        r = c + half
        # left half: centre at (+c), from the left springing round to the crown
        a_spring = math.atan2(0.0, -half - c)          # = pi
        a_crown = math.atan2(rise, -c)
        left = _arc(c, 0.0, r, a_spring, a_crown, n // 2)
        right = [(-x, z) for (x, z) in reversed(left[:-1])]
        pts = left + right

    elif kind == "ogee":
        half_steps = max(3, n // 2)
        left = _bezier((-half, 0.0), (-half * 1.12, rise * 0.44),
                       (-half * 0.30, rise * 0.74), (0.0, rise), half_steps)
        right = [(-x, z) for (x, z) in reversed(left[:-1])]
        pts = left + right

    elif kind == "trefoil":
        lr = half * 0.52                      # side-lobe radius
        tr = half * 0.60                      # top-lobe radius
        tc = rise - tr                        # top-lobe centre height
        seg = max(2, n // 3)
        left = _arc(-half + lr, 0.0, lr, math.pi, math.radians(58.0), seg)
        top = _arc(0.0, tc, tr, math.radians(180.0 - 46.0), math.radians(46.0), seg)
        right = [(-x, z) for (x, z) in reversed(left[:-1])]
        pts = left + top + right

    else:
        raise ValueError("unknown arch kind %r" % (kind,))

    return [(x0 + x, z0 + z) for (x, z) in pts]


def arch_band(part, span, rise, depth, thickness, at=(0.0, 0.0, 0.0),
              rot=(0.0, 0.0, 0.0), kind="round", steps=14, keystone=False,
              matrix=None):
    """A real arch: the voussoir ring above an opening, swept along the curve.

    The band spans in local X, is `depth` thick front-to-back in local Y, and
    `thickness` deep radially. Returns the faces so the caller can bevel them.
    """
    curve = arch_curve(span, rise, steps=steps, kind=kind)
    inner = curve
    outer = []
    cx = 0.0
    for (x, z) in curve:
        vx, vz = x - cx, z
        L = math.hypot(vx, vz) or 1.0
        outer.append((x + vx / L * thickness, z + vz / L * thickness))
    verts, faces = [], []
    hd = depth * 0.5
    n = len(inner)
    for (x, z) in inner:
        verts.append((x, -hd, z))
        verts.append((x, hd, z))
    for (x, z) in outer:
        verts.append((x, -hd, z))
        verts.append((x, hd, z))
    o = 2 * n
    for i in range(n - 1):
        a0, a1 = 2 * i, 2 * i + 1
        b0, b1 = 2 * (i + 1), 2 * (i + 1) + 1
        c0, c1 = o + 2 * i, o + 2 * i + 1
        d0, d1 = o + 2 * (i + 1), o + 2 * (i + 1) + 1
        faces.append((a1, a0, b0, b1))       # intrados
        faces.append((c0, c1, d1, d0))       # extrados
        faces.append((a0, c0, d0, b0))       # front
        faces.append((b1, d1, c1, a1))       # back
    faces.append((0, 1, o + 1, o))
    faces.append((2 * (n - 1) + 1, 2 * (n - 1), o + 2 * (n - 1), o + 2 * (n - 1) + 1))
    mat = M.xform(at, rot)
    if matrix is not None:
        mat = matrix @ mat
    made = part._append(verts, faces, mat)
    if keystone:
        cxp, czp = curve[len(curve) // 2]
        made += part.box(thickness * 1.15, depth * 1.12, thickness * 1.5,
                         at=(cxp, 0.0, czp + thickness * 0.35), matrix=mat,
                         chamfer=thickness * 0.12)
    return made


# --------------------------------------------------------------------------
# the order: one column, used everywhere
# --------------------------------------------------------------------------


def column(part, at, height, radius, flutes=0, entasis=0.030, base=True,
           capital=True, matrix=None):
    """One column of the Wonderland order.

    A plinth and a torus base, a shaft with entasis, an astragal at the neck,
    a cushion capital and a square abacus. `flutes` > 0 turns the shaft into a
    fluted plan, which costs triangles and buys a vertical read at distance --
    worth it on a colonnade the player walks past, not on a tower at 400 m.
    """
    made = []
    x, y, z = at
    zb = z
    if base:
        made += part.box(radius * 2.55, radius * 2.55, radius * 0.34,
                         at=(x, y, zb), matrix=matrix, chamfer=radius * 0.09,
                         centre_z=False)
        zb += radius * 0.34
        made += part.lathe(M.moulding(radius * 1.02, zb, (
            (0.22 * radius, 0.0), (0.06 * radius, 0.16 * radius),
            (-0.10 * radius, 0.16 * radius), (-0.18 * radius, 0.06 * radius))),
            segments=16, matrix=M.xform((x, y, 0)) if matrix is None else matrix @ M.xform((x, y, 0)))
        zb += radius * 0.38
    shaft_h = height - (zb - z) - (radius * 0.86 if capital else 0.0)
    if flutes >= 4:
        plan = M.lobed_ngon(int(flutes), radius * 0.94, radius * 0.10,
                            segments_per_lobe=3)
        sections = []
        steps = 5
        for i in range(steps + 1):
            t = i / float(steps)
            r = (1.0 - 0.11 * t) * (1.0 + entasis * math.sin(math.pi * t ** 0.85))
            sections.append([(x + px * r, y + py * r, zb + shaft_h * t)
                             for (px, py) in plan])
        made += part.loft(sections, matrix=matrix, smooth=True)
    else:
        prof = M.entasis(radius, radius * 0.89, zb, zb + shaft_h, steps=6, belly=entasis)
        made += part.lathe(prof, segments=14, smooth=True, matrix=(
            M.xform((x, y, 0)) if matrix is None else matrix @ M.xform((x, y, 0))))
    zt = zb + shaft_h
    if capital:
        made += part.lathe(M.moulding(radius * 0.89, zt, (
            (0.05 * radius, 0.05 * radius), (-0.05 * radius, 0.05 * radius),
            (0.10 * radius, 0.04 * radius), (0.36 * radius, 0.40 * radius),
            (0.10 * radius, 0.14 * radius))), segments=16, matrix=(
            M.xform((x, y, 0)) if matrix is None else matrix @ M.xform((x, y, 0))))
        made += part.box(radius * 2.9, radius * 2.9, radius * 0.22,
                         at=(x, y, zt + radius * 0.68), matrix=matrix,
                         chamfer=radius * 0.06, centre_z=False)
    return made


# --------------------------------------------------------------------------
# rings that go round a shaft
# --------------------------------------------------------------------------


def string_course(part, z, radius, run=None, segments=28, matrix=None):
    """A horizontal moulding round a shaft. The cheapest depth in the kit:
    one of these every eight metres is the difference between a tower and a
    pipe."""
    run = run or M.CORNICE_STRING
    return part.lathe(M.moulding(radius, z, run), segments=segments,
                      smooth=False, matrix=matrix)


def corbel_table(part, z, radius, count=24, depth=0.34, drop=0.52, matrix=None):
    """Corbels under a projecting course -- the shadow line that says the top
    of a tower is heavier than its middle. The reference's towers all have
    one; a cylinder with a band does not."""
    made = []
    for (x, y, a) in _ring(count, radius):
        made += part.box(depth * 1.05, depth * 0.72, drop,
                         at=(x, y, z), rot=(0.0, 0.0, a), matrix=matrix,
                         chamfer=depth * 0.14, centre_z=False)
    made += part.lathe(M.moulding(radius - depth * 0.15, z + drop, (
        (depth * 0.55, 0.0), (0.0, drop * 0.30), (-depth * 0.20, drop * 0.16),
        (-depth * 0.35, 0.0))), segments=max(20, count), matrix=matrix)
    return made


def merlon_ring(part, z, radius, count=16, width=0.62, height=1.05, gap=None,
                matrix=None):
    """A crenellated parapet. Openings between merlons are what make a
    silhouette legible against sky at a kilometre."""
    made = []
    for (x, y, a) in _ring(count, radius):
        made += part.box(width, width * 0.66, height, at=(x, y, z), rot=(0, 0, a),
                         matrix=matrix, chamfer=width * 0.11, centre_z=False)
    return made


def balcony_ring(part, z, radius, out=0.95, thickness=0.30, corbels=18,
                 rail=None, balusters=28, matrix=None):
    """A projecting gallery: corbels, a deck, a rail on balusters.

    The single most useful detail module in the kit. It breaks a shaft's
    vertical line, it casts a hard shadow, and at any distance it says the
    tower is INHABITED, which no amount of window detail does.
    """
    made = []
    for (x, y, a) in _ring(corbels, radius):
        made += part.box(out * 0.85, out * 0.42, thickness * 1.5,
                         at=(x, y, z - thickness * 0.6), rot=(0, 0, a),
                         matrix=matrix, chamfer=out * 0.08, centre_z=False)
    made += part.lathe([(radius - 0.1, z), (radius + out, z),
                        (radius + out, z + thickness), (radius - 0.1, z + thickness)],
                       segments=max(24, corbels), smooth=False, matrix=matrix)
    rh = rail if rail is not None else thickness * 3.6
    for (x, y, a) in _ring(balusters, radius + out * 0.72):
        made += part.lathe(
            [(0.0, 0.0), (0.055, 0.0), (0.048, rh * 0.16), (0.085, rh * 0.34),
             (0.052, rh * 0.62), (0.062, rh * 0.86), (0.0, rh)],
            segments=8, smooth=True,
            matrix=M.xform((x, y, z + thickness)) if matrix is None
            else matrix @ M.xform((x, y, z + thickness)))
    made += part.lathe([(radius + out * 0.50, z + thickness + rh),
                        (radius + out * 0.94, z + thickness + rh),
                        (radius + out * 0.94, z + thickness + rh + 0.16),
                        (radius + out * 0.50, z + thickness + rh + 0.16)],
                       segments=max(24, balusters), smooth=False, matrix=matrix)
    return made


def _ring(n, radius, phase=0.0):
    out = []
    for i in range(int(n)):
        a = phase + TAU * i / float(n)
        out.append((math.cos(a) * radius, math.sin(a) * radius, math.degrees(a)))
    return out


def arcade_ring(part, z, radius, bays, height, rise=None, pier=0.44, depth=0.72,
                kind="round", columns=True, phase=0.0, glass_part=None,
                spandrel=True, matrix=None):
    """A ring of open arches: `bays` piers on a circle, arched between.

    THIS IS THE KIT'S MOST VALUABLE SINGLE ELEMENT and it is worth saying why.
    Every tower in the founder reference is pierced -- you can see sky through
    its galleries -- and every tower in the current world is a solid drum with
    a band painted on. Solid mass at 400 m reads as one blob whatever its
    surface does; a pierced gallery reads as architecture at any distance,
    because the eye gets light THROUGH it.

    Returns the faces. The arches are built between piers rather than cut out
    of a wall, for the reasons in this module's docstring.
    """
    made = []
    n = int(bays)
    chord = 2.0 * radius * math.sin(math.pi / n)
    span = chord - pier * 1.35
    if span <= 0.2:
        raise ValueError("arcade_ring: %d bays at r=%.2f leaves no opening" % (n, radius))
    rise = rise if rise is not None else span * 0.5
    cap_h = height - rise
    if cap_h <= 0.4:
        raise ValueError("arcade_ring: height %.2f too small for rise %.2f" % (height, rise))

    for (x, y, a) in _ring(n, radius, phase):
        if columns:
            made += column(part, (x, y, z), cap_h, pier * 0.5,
                           flutes=0, base=True, capital=True, matrix=matrix)
        else:
            made += part.box(pier, depth, cap_h, at=(x, y, z), rot=(0, 0, a),
                             matrix=matrix, chamfer=pier * 0.14, centre_z=False)

    for i in range(n):
        a0 = phase + TAU * i / n
        a1 = phase + TAU * (i + 1) / n
        mx = math.cos((a0 + a1) * 0.5) * radius * math.cos(math.pi / n)
        my = math.sin((a0 + a1) * 0.5) * radius * math.cos(math.pi / n)
        yaw = math.degrees((a0 + a1) * 0.5) + 90.0
        made += arch_band(part, span, rise, depth, pier * 0.62,
                          at=(mx, my, z + cap_h), rot=(0.0, 0.0, yaw),
                          kind=kind, steps=9, keystone=(n <= 12), matrix=matrix)
        if glass_part is not None:
            glass_part.box(span * 0.94, depth * 0.22, cap_h * 0.92,
                           at=(mx, my, z + cap_h * 0.04), rot=(0.0, 0.0, yaw),
                           centre_z=False)
        if spandrel:
            made += part.box(chord * 0.98, depth * 0.86, height - (cap_h + rise) + 0.30,
                             at=(mx, my, z + cap_h + rise - 0.02), matrix=matrix,
                             rot=(0.0, 0.0, yaw), chamfer=0.08, centre_z=False)
    return made


# --------------------------------------------------------------------------
# openings in a wall or a drum
# --------------------------------------------------------------------------


def window_arched(part, at, width, height, depth=0.28, rot=(0, 0, 0), kind="ogee",
                  sill=True, glass_part=None):
    """A window as a RECESSED FRAME plus an optional glazed plane.

    Not a hole. The drum behind it is solid; what reads as a window at
    distance is the shadow of the surround and the darker glass plane inside
    it, and that reads correctly from every angle without costing a boolean.
    """
    made = []
    x, y, z = at
    jamb = width * 0.16
    body = height - width * 0.5
    for sgn in (-1.0, 1.0):
        made += part.box(jamb, depth, body, at=(x + sgn * (width * 0.5 - jamb * 0.5), y, z),
                         rot=rot, chamfer=jamb * 0.22, centre_z=False)
    made += arch_band(part, width, width * 0.5 * (1.35 if kind == "ogee" else 1.0),
                      depth, jamb, at=(x, y, z + body), rot=rot, kind=kind, steps=9)
    if sill:
        made += part.box(width * 1.34, depth * 1.5, jamb * 0.72,
                         at=(x, y, z - jamb * 0.5), rot=rot, chamfer=jamb * 0.14,
                         centre_z=False)
    if glass_part is not None:
        gh = body + width * 0.42
        glass_part.box(width - jamb * 2.0, depth * 0.30, gh,
                       at=(x, y - depth * 0.16, z), rot=rot, centre_z=False)
    return made


def slit_ring(part, z, radius, count=8, width=0.30, height=2.2, depth=0.22,
              phase=0.0, matrix=None):
    """Arrow-slit windows round a drum. Cheap, and they scale a tower: a
    viewer reads height off the number of storeys, and storeys off these."""
    made = []
    for (x, y, a) in _ring(count, radius - depth * 0.25, phase):
        made += part.box(width, depth, height, at=(x, y, z), rot=(0, 0, a),
                         matrix=matrix, chamfer=width * 0.2, centre_z=False)
    return made


# --------------------------------------------------------------------------
# tops
# --------------------------------------------------------------------------


def finial(part, at, height, radius=None, gold=None):
    """The point a spire ends on: a collar, a bud, a ball and a pin.

    Written to be called with `gold` = the gold Part, because in the reference
    every terminal is metal and every shaft is stone -- the split is the whole
    reason the kit has more than one part per module.
    """
    p = gold if gold is not None else part
    r = radius if radius is not None else height * 0.16
    x, y, z = at
    m = M.xform((x, y, 0.0))
    made = p.lathe([(0.0, z), (r * 1.35, z), (r * 1.5, z + height * 0.07),
                    (r * 1.1, z + height * 0.13)], segments=12, matrix=m)
    made += p.lathe(M.onion(r * 1.25, height * 0.44, steps=10, z0=z + height * 0.13),
                    segments=14, matrix=m, smooth=True)
    made += p.lathe([(0.0, z + height * 0.57), (r * 0.62, z + height * 0.60),
                     (r * 0.70, z + height * 0.68), (r * 0.40, z + height * 0.75),
                     (r * 0.22, z + height * 0.86), (0.0, z + height)],
                    segments=12, matrix=m, smooth=True)
    return made


def pinnacle(part, at, height, radius, gold=None):
    """A small subordinate spire. Four of these round a crown turn one
    silhouette into a cluster, which is how the reference's towers get their
    barbed outline without any one of them being complicated."""
    x, y, z = at
    m = M.xform((x, y, 0.0))
    made = part.lathe([(radius * 1.12, z), (radius * 1.12, z + height * 0.08),
                       (radius * 0.96, z + height * 0.11)], segments=8, matrix=m)
    made += part.lathe(M.needle(radius, height * 0.89, steps=6, concavity=0.30,
                                z0=z + height * 0.11), segments=8, matrix=m, smooth=True)
    if gold is not None:
        finial(part, (x, y, z + height * 0.96), height * 0.16, radius * 0.42, gold=gold)
    return made


# --------------------------------------------------------------------------
# ornament: the reference's loudest single element
# --------------------------------------------------------------------------


def plate_xz(part, poly_xz, depth, at=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0)):
    """Extrude an `(x, z)` polygon through `depth` in Y: a wall with a shape.

    `prism` builds in XY and extrudes along +Z. Rotating by +90 degrees about X
    maps (x, y, 0) to (x, 0, y) and the extrusion to -Y, so the same primitive
    draws an elevation. Everything that is a WALL rather than a solid -- the
    spandrels, the tympana, the bridge parapets -- is one of these.
    """
    mat = M.xform(at, rot) @ M.xform((0.0, depth * 0.5, 0.0), (90.0, 0.0, 0.0))
    return part.prism(list(poly_xz), depth, matrix=mat)


def arched_wall(part, span, rise, top_z, outer_x, depth, kind="round", steps=14,
                thickness=0.0, at=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0),
                base_z=0.0):
    """A wall from `base_z` to `top_z` with an arch-shaped hole in its outline.

    ADDED AFTER LOOKING AT A RENDER, which is why it is worth its own entry.
    `WL_Arch_Ceremonial` first had its two upper corners filled with
    rectangular blocks sized by eye at 62% of the rise. The ogee crown then rose
    past them, and the attic storey above appeared to float over a gap. The fix
    is not a taller block: it is the actual region, whose inner edge is the
    arch's own extrados.

    So the wall is ONE polygon -- across the bottom, up the left extrados, over
    the crown, down the right, out to the far corner and back along the top --
    with the opening as a bite taken out of its outline. That is why this is
    not a boolean: a hole in an OUTLINE is a hole nothing had to be subtracted
    to make, so it is manifold by construction and the arch band standing in it
    can never disagree with the wall around it.
    """
    curve = arch_curve(span, rise, steps=steps, kind=kind)
    inner = []
    for (x, z) in curve:
        L = math.hypot(x, z) or 1.0
        inner.append((x + x / L * thickness, z + z / L * thickness))
    top = float(top_z) - float(base_z)
    origin = (at[0], at[1], at[2] + float(base_z))

    if max(z for (_, z) in inner) <= top + 1e-6:
        # the wall is taller than the arch: one polygon, the opening a bite
        poly = [(-outer_x, 0.0)] + list(inner)
        poly += [(outer_x, 0.0), (outer_x, top), (-outer_x, top)]
        return plate_xz(part, poly, depth, at=origin, rot=rot)

    # THE ARCH RISES THROUGH THE WALL'S OWN TOP. This is the common case, not
    # the exception -- a bridge whose deck sits just above its arch crown has
    # NO masonry over the crown at all, only the two haunches beside it. The
    # first version of this function ignored that and emitted one polygon that
    # crossed itself; it rendered as a black void under `WL_Bridge_Arc`, and
    # the same defect was present in the ceremonial arch and the tiered arch.
    # So when the arch is taller than the wall, the wall is TWO regions.
    # `inner` runs left springing -> crown -> right springing. Each haunch is
    # traced so the outline never crosses the opening: on the left, out along
    # the bottom and UP the arch; on the right, DOWN the arch and out along the
    # bottom. Getting that order wrong makes a polygon that jumps across the
    # opening, which is what the first version did -- it showed as a torn dark
    # web under `WL_Hero_Gate_Royal`'s arch.
    made = []
    for sgn in (-1.0, 1.0):
        side = [(x, z) for (x, z) in inner if x * sgn >= -1e-9 and z <= top + 1e-9]
        if len(side) < 2:
            continue
        if sgn < 0:
            poly = [(-outer_x, 0.0)] + side + [(side[-1][0], top), (-outer_x, top)]
        else:
            poly = [(side[0][0], top)] + side + [(outer_x, 0.0), (outer_x, top)]
        made += plate_xz(part, poly, depth, at=origin, rot=rot)
    return made


def filigree_panel(part, width, height, at=(0, 0, 0), rot=(0, 0, 0), bar=0.075,
                   cells_x=4, cells_y=6, scroll=True, seed=0):
    """A panel of ornamental metalwork: frame, bars, and scrolled spirals.

    The reference's left third is a huge gold lattice screen and the current
    world has nothing like it at any scale. This is that element, made
    parametric so it serves a gate leaf, a balcony infill, a window grille and
    a free-standing screen from one builder.
    """
    made = []
    hw, hh = width * 0.5, height * 0.5
    mat = M.xform(at, rot)
    frame = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    for (ax, ay, w, h) in ((0, -hh, width, bar * 2.0), (0, hh, width, bar * 2.0),
                           (-hw, 0, bar * 2.0, height), (hw, 0, bar * 2.0, height)):
        made += part.box(w, bar * 1.8, h, at=(ax, 0.0, ay), matrix=mat,
                         chamfer=bar * 0.3)
    for i in range(1, int(cells_x)):
        x = -hw + width * i / float(cells_x)
        made += part.box(bar * 1.3, bar * 1.3, height - bar * 2.0, at=(x, 0.0, 0.0),
                         matrix=mat, chamfer=bar * 0.25)
    for j in range(1, int(cells_y)):
        z = -hh + height * j / float(cells_y)
        made += part.box(width - bar * 2.0, bar * 1.1, bar * 1.1, at=(0.0, 0.0, z),
                         matrix=mat, chamfer=bar * 0.22)
    if scroll:
        for i in range(int(cells_x)):
            for j in range(int(cells_y)):
                if (i + j) % 2:
                    continue
                cx = -hw + width * (i + 0.5) / cells_x
                cz = -hh + height * (j + 0.5) / cells_y
                r0 = min(width / cells_x, height / cells_y) * 0.34
                for sgn in (1.0, -1.0):
                    pts = []
                    turns = 1.6
                    for k in range(11):
                        t = k / 10.0
                        a = t * turns * TAU
                        r = r0 * (1.0 - 0.62 * t)
                        pts.append((cx + sgn * math.cos(a) * r, 0.0,
                                    cz + math.sin(a) * r))
                    made += part.sweep(pts, [bar * 0.55] * len(pts), sides=4,
                                       matrix=mat, cap=False)
    return made


def rib_set(part, z0, z1, radius, count=8, width=0.30, out=0.22, taper=0.86,
            matrix=None):
    """Vertical ribs up a shaft or a dome. Verticals are what make a needle
    read as tall rather than merely thin."""
    made = []
    for (x, y, a) in _ring(count, radius):
        h = z1 - z0
        made += part.box(out * 2.0, width, h, at=(x, y, z0), rot=(0, 0, a),
                         chamfer=width * 0.24, centre_z=False, matrix=matrix)
    return made
