"""The Wonderland HD asset library — real authored geometry, one file.

Every entry here replaces something that was a Cube, a Cylinder, a Cone or a
Sphere. The founder's rejection list is the table of contents:

    "obvious cubes"            -> chamfered, coursed, moulded stone
    "obvious cylinders"        -> entasis, string courses, fluting
    "cone roofs"               -> ogee shells carried on real shingle courses
    "sphere/blob trees"        -> lofted trunks, branch hierarchy, ragged clumps
    "crude mushrooms"          -> lathed organic caps with rolled rims and gills
    "simplistic gold geometry" -> swept filigree scrolls and turned finials
    "primitive decorative props" -> lathed tea, ornate clocks, cut keys

TIERS (the founder's Phase D, plus one)
    S  singleton the landmark that exists once — the arrival arch
    A  hero      near camera, up to ~4,000 tris, full detail
    B  midground reusable modules, up to ~1,400 tris
    C  distant   skyline, up to ~350 tris; detail that subtends under a pixel
                 is removed rather than shrunk

At 1920 px across a 75-degree view one pixel is 0.00068 rad, so a 12 uu shingle
at 25 km subtends 0.0007 px. Tier C roofs therefore carry the ogee SILHOUETTE —
which survives, because it scales with the tower — and no tiles at all.

Each asset declares the material it is authored for. That is a default the
layout may override, not a binding: the batcher keys on the material the caller
names.
"""

import math

try:
    from . import meshkit as mk
except ImportError:                                    # run as a plain script
    import meshkit as mk


ASSETS = {}


def asset(name, tier="B", material="stone", nanite=None, fit="box",
          uniform=False, note=""):
    """Register a builder. `fit` 'box' stretches to the 100 uu cube so the mesh
    is a drop-in for the primitive it replaces; 'uniform' preserves proportion
    for things whose shape IS the design (a key, a teapot); 'none' leaves the
    mesh at authored size."""
    def deco(fn):
        ASSETS[name] = {
            "build": fn, "tier": tier, "material": material,
            "nanite": (tier in ("A", "B")) if nanite is None else bool(nanite),
            "fit": fit, "uniform": uniform, "note": note or (fn.__doc__ or "").strip(),
        }
        return fn
    return deco


TRI_BUDGET = {
    # S is not a quality tier, it is a COUNT: a landmark that exists exactly
    # once in the world. The arrival arch is one mesh spanning the path, and a
    # per-instance budget written for the forty towers says nothing about it.
    "S": 12000,
    "A": 4200,
    "B": 3000,
    "C": 500,
}


# ==========================================================================
# ARCHITECTURE  (Phase G)
# ==========================================================================


@asset("hd_roof", tier="B", material="roof_rose",
       note="Ogee shell + eight scalloped shingle courses + rolled eave.")
def hd_roof():
    """A fairy-tale roof: an S-curved shell, an overhanging rolled eave, and
    eight scalloped courses that break the silhouette at every row.

    The cone this replaces had exactly two silhouette events, the base circle
    and the apex. This has eleven. The courses are lathed RINGS with a scallop
    wobble rather than 113 individual tiles: at every distance this world
    actually views a roof from, what reads is the scalloped course edge and its
    shadow, and the ring delivers that for a fifth of the triangles."""
    m = mk.Mesh()
    R, H = 50.0, 96.0
    shell = mk.ogee(R * 0.94, 1.2, H, steps=13, bulge=0.34, z0=2.0)
    m.merge(mk.lathe(shell, seg=26))
    m.merge(mk.torus(R * 0.92, 5.0, major=26, minor=7).translate(0, 0, 3.0))
    courses = 8
    for c in range(courses):
        t = c / float(courses)
        i0 = int(t * (len(shell) - 1))
        r0, z0 = shell[i0]
        if r0 < 3.0:
            continue
        lobes = max(7, int(20 * (r0 / R)))
        lip = mk.lathe([(r0 * 1.00, 0.0), (r0 * 1.055, 1.5),
                        (r0 * 1.045, 5.0), (r0 * 0.99, 7.0)],
                       seg=26, close=False,
                       wobble=mk.scallop_edge(r0, lobes, depth=0.045,
                                              phase=0.31 * c))
        m.merge(lip.translate(0, 0, z0))
    m.merge(mk.lathe([(3.2, 0.0), (2.0, 6.0), (4.0, 9.0), (0.0, 16.0)], seg=10)
            .translate(0, 0, H))
    return m


@asset("hd_roof_hero", tier="A", material="roof_rose",
       note="The near roof: real individual shingles on the lower courses.")
def hd_roof_hero():
    """Only the roofs the player can walk under earn per-tile geometry. Five
    courses of real overlapping scallop tiles over the shared ogee shell."""
    m = hd_roof()
    R, H = 50.0, 96.0
    shell = mk.ogee(R * 0.94, 1.2, H, steps=13, bulge=0.34, z0=2.0)
    for c in range(5):
        t = c / 8.0
        i0 = int(t * (len(shell) - 1))
        r0, z0 = shell[i0]
        z1 = shell[min(len(shell) - 1, i0 + 2)][1]
        n = max(8, int(22 * (r0 / R)))
        for k in range(n):
            a = 360.0 * (k + 0.5 * (c % 2)) / n
            w = 2.0 * math.pi * r0 / n * 0.62
            tile = mk.prism([(-w, 0.0), (w, 0.0), (w * 0.86, -(z1 - z0) * 0.80),
                             (0.0, -(z1 - z0) * 0.96),
                             (-w * 0.86, -(z1 - z0) * 0.80)], 3.4)
            tile.rotate_x(90.0)
            tile.rotate_x(-16.0)
            tile.translate(0.0, r0 * 1.03, z0 + (z1 - z0) * 0.86)
            tile.rotate_z(a)
            m.merge(tile)
    return m



@asset("hd_roof_far", tier="C", material="roof_rose",
       note="The same silhouette with no courses — for the skyline.")
def hd_roof_far():
    """Distance removes texture and keeps silhouette. A 12 uu shingle at 25 km
    subtends 0.0007 px; the ogee and the overhanging eave scale with the tower
    and survive, so those are what this keeps."""
    m = mk.lathe(mk.ogee(48.0, 1.2, 96.0, steps=8, bulge=0.34, z0=3.0), seg=12)
    m.merge(mk.torus(46.0, 4.5, major=12, minor=5).translate(0, 0, 3.5))
    return m



@asset("hd_roof_bell", tier="B", material="roof_pink",
       note="Onion/bell dome with meridian ribs.")
def hd_roof_bell():
    """The other roof the reference uses — swelling above the springing and
    drawing to a point. Ribs give it eight silhouette events."""
    m = mk.lathe(mk.bell(48.0, 92.0, steps=16, flare=0.30, z0=4.0), seg=26)
    m.merge(mk.torus(45.0, 5.0, major=26, minor=8).translate(0, 0, 4.5))
    prof = mk.bell(48.0, 92.0, steps=16, flare=0.30, z0=4.0)
    for k in range(8):
        a = 360.0 * k / 8.0
        pts = [(r * 1.02, 0.0, z) for (r, z) in prof if r > 1.0]
        if len(pts) > 2:
            rib = mk.tube(pts, [2.2] * len(pts), sides=5)
            rib.rotate_z(a)
            m.merge(rib)
    m.merge(mk.lathe([(4.0, 0.0), (2.4, 7.0), (5.0, 11.0), (0.0, 20.0)], seg=10)
            .translate(0, 0, 92.0))
    return m


@asset("hd_wall", tier="B", material="porcelain",
       note="Staggered ashlar: five courses of five chamfered blocks.")
def hd_wall():
    """A wall the light can read.

    Not a box with lines drawn on it — twenty-five separate chamfered blocks,
    staggered course to course, touching at their chamfers so every joint is a
    real V-groove that returns a shadow. The bed joints run the whole width and
    the perpends do not line up, which is the single thing that separates
    coursed masonry from a painted grid.

    Depth varies +/-1.1 uu per block from the deterministic hash, so the face
    is not a plane and a raking sun picks out individual stones."""
    m = mk.Mesh()
    courses, per = 5, 5
    ch = 100.0 / courses
    for c in range(courses):
        z = -50.0 + ch * (c + 0.5)
        stagger = 0.5 if (c % 2) else 0.0
        for k in range(per + 1):
            u = (k + stagger) / float(per)
            if u <= -1e-6 or u >= 1.0 + 1e-6:
                continue
            w = 100.0 / per
            x = -50.0 + 100.0 * u + w * 0.5
            if x - w * 0.5 < -50.0:
                w -= (-50.0 - (x - w * 0.5))
                x = -50.0 + w * 0.5
            if x + w * 0.5 > 50.0:
                w -= ((x + w * 0.5) - 50.0)
                x = 50.0 - w * 0.5
            if w < 4.0:
                continue
            d = 100.0 + (mk.rnd(c, k, 3) - 0.5) * 2.2
            blk = mk.chamfer_box(w, d, ch, c=1.9)
            blk.translate(x, 0.0, z)
            m.merge(blk)
    return m



@asset("hd_wall_window", tier="A", material="porcelain",
       note="Wall panel with a recessed arched window and a moulded surround.")
def hd_wall_window():
    """The founder's list wants windows. A window is a HOLE, and this library
    has no boolean, so the opening is built as four wall segments around a
    recess — which is how it is built in stone anyway, and gives the reveal a
    real depth the light falls into."""
    m = mk.Mesh()
    W, wr, wh = 100.0, 21.0, 30.0
    m.merge(mk.chamfer_box(W, 18.0, 26.0, c=2.0).translate(0, 0, -37.0))
    m.merge(mk.chamfer_box(W, 18.0, 22.0, c=2.0).translate(0, 0, 39.0))
    for s in (-1, 1):
        m.merge(mk.chamfer_box(W * 0.5 - wr, 18.0, 52.0, c=2.0)
                .translate(s * (W * 0.25 + wr * 0.5), 0.0, 2.0))
    # recessed reveal + sill
    m.merge(mk.chamfer_box(wr * 2.0, 9.0, 52.0, c=1.5).translate(0, -4.0, 2.0))
    m.merge(mk.chamfer_box(wr * 2.4, 20.0, 5.0, c=1.4).translate(0, 1.5, -24.5))
    # moulded surround: jambs, arch voussoirs, keystone
    for s in (-1, 1):
        m.merge(mk.chamfer_box(6.0, 21.0, 40.0, c=1.4)
                .translate(s * (wr + 3.0), 1.0, -4.0))
    for k in range(9):
        a = math.pi * (k + 0.5) / 9.0
        v = mk.chamfer_box(6.5, 21.0, 9.0, c=1.2)
        v.rotate_y(-math.degrees(a) + 90.0)
        v.translate(math.cos(a) * (wr + 2.0), 1.0, 16.0 + math.sin(a) * (wr + 2.0))
        m.merge(v)
    m.merge(mk.chamfer_box(8.0, 23.0, 12.0, c=1.5).translate(0, 1.5, 16.0 + wr + 4.0))
    return m


@asset("hd_tower", tier="B", material="spire",
       note="Tower drum with entasis, plinth torus and a string course.")
def hd_tower():
    """A cylinder with the three things a cylinder is missing: entasis (a real
    tower swells, a primitive does not), a base roll, and a string course two
    thirds up that catches a shadow across the whole silhouette."""
    prof = []
    for i in range(13):
        t = i / 12.0
        r = 47.0 * (1.0 - 0.055 * math.sin(math.pi * t) - 0.11 * t)
        prof.append((r, -50.0 + 100.0 * t))
    m = mk.lathe(prof, seg=26, wobble=mk.scallop_edge(47.0, 20, depth=0.012))
    m.merge(mk.torus(46.0, 5.5, major=26, minor=8).translate(0, 0, -45.0))
    m.merge(mk.lathe([(43.5, 0.0), (49.0, 3.0), (49.5, 7.0), (43.0, 10.0)],
                     seg=26).translate(0, 0, 18.0))
    m.merge(mk.lathe([(41.5, 0.0), (46.0, 4.0), (44.0, 8.0)], seg=26)
            .translate(0, 0, 44.0))
    return m


@asset("hd_tower_far", tier="C", material="spire_far",
       note="Skyline drum: entasis and one string course, 20 sides.")
def hd_tower_far():
    prof = []
    for i in range(7):
        t = i / 6.0
        prof.append((47.0 * (1.0 - 0.05 * math.sin(math.pi * t) - 0.11 * t),
                     -50.0 + 100.0 * t))
    m = mk.lathe(prof, seg=14)
    m.merge(mk.lathe([(44.0, 0.0), (49.0, 3.5), (43.0, 7.0)], seg=14)
            .translate(0, 0, 18.0))
    return m


@asset("hd_cornice", tier="B", material="porcelain",
       note="Moulded cornice: cyma, corona, dentil course.")
def hd_cornice():
    """A cornice is a PROFILE swept round four sides — cavetto, fillet, corona,
    dentils. A box painted a different colour is not one, and the difference is
    the deep shadow the corona throws across the wall beneath it."""
    m = mk.Mesh()
    # profile in (out, up), out measured from the wall face at 0
    prof = [(0.0, -50.0), (6.0, -40.0), (4.0, -30.0), (5.0, -22.0),
            (13.0, -8.0), (13.0, 12.0), (6.0, 26.0), (7.0, 50.0), (0.0, 50.0)]
    for yaw in (0.0, 90.0, 180.0, 270.0):
        poly = [(48.0 + o, u) for (o, u) in prof]
        seg = mk.prism(poly, 96.0)          # extruded along its own +Z
        seg.rotate_x(90.0)                  # lay the profile upright
        seg.rotate_z(yaw)
        m.merge(seg)
    for k in range(16):
        off = -45.0 + 6.0 * k
        for yaw in (0.0, 90.0, 180.0, 270.0):
            d = mk.box(3.6, 9.0, 8.0)
            d.translate(off, 55.5, -14.0)
            d.rotate_z(yaw)
            m.merge(d)
    return m



@asset("hd_column", tier="A", material="porcelain",
       note="Fluted column: moulded base, 20 flutes, volute capital.")
def hd_column():
    m = mk.Mesh()
    m.merge(mk.lathe([(0.0, -50.0), (26.0, -50.0), (26.0, -44.0), (22.0, -40.0),
                      (20.0, -36.0), (18.0, -34.0)], seg=22))
    shaft = []
    for i in range(9):
        t = i / 8.0
        shaft.append((18.0 * (1.0 - 0.10 * t - 0.03 * math.sin(math.pi * t)),
                      -34.0 + 68.0 * t))
    m.merge(mk.lathe(shaft, seg=24, wobble=mk.scallop_edge(18.0, 20, depth=0.055)))
    m.merge(mk.lathe([(15.5, 34.0), (19.0, 37.0), (18.0, 40.0), (24.0, 44.0),
                      (26.0, 48.0), (26.0, 50.0), (0.0, 50.0)], seg=24))
    for s in (0, 90, 180, 270):
        v = mk.tube([( 24.0, 0.0, 42.0), (26.0, 0.0, 45.0), (24.0, 0.0, 47.5),
                     (21.0, 0.0, 46.0), (21.5, 0.0, 43.5)], [2.6] * 5, sides=6)
        v.rotate_z(s)
        m.merge(v)
    return m


@asset("hd_baluster", tier="B", material="porcelain",
       note="Turned baluster — vase, neck, ring, plinth.")
def hd_baluster():
    prof = [(0.0, -50.0), (17.0, -50.0), (17.0, -42.0), (12.0, -38.0),
            (14.0, -32.0), (19.0, -24.0), (20.0, -12.0), (17.0, 2.0),
            (10.0, 14.0), (13.0, 20.0), (9.0, 26.0), (10.0, 32.0),
            (16.0, 38.0), (16.0, 44.0), (19.0, 44.0), (19.0, 50.0), (0.0, 50.0)]
    return mk.lathe(prof, seg=16)


@asset("hd_arch", tier="A", material="porcelain",
       note="Semicircular arch of 15 voussoirs with a keystone.")
def hd_arch():
    m = mk.Mesh()
    R, T, D = 44.0, 12.0, 24.0
    n = 15
    for k in range(n):
        a = math.pi * (k + 0.5) / n
        v = mk.chamfer_box(2.0 * math.pi * R / n * 0.94, D, T, c=1.5)
        v.rotate_y(90.0 - math.degrees(a))
        v.translate(math.cos(a) * R, 0.0, math.sin(a) * R - 20.0)
        m.merge(v)
    key = mk.chamfer_box(15.0, D + 3.0, T + 7.0, c=2.0)
    key.translate(0.0, 0.0, R - 20.0 + 2.5)
    m.merge(key)
    for s in (-1, 1):
        m.merge(mk.chamfer_box(T, D, 32.0, c=1.5).translate(s * R, 0.0, -36.0))
        m.merge(mk.chamfer_box(T + 7.0, D + 5.0, 7.0, c=1.5)
                .translate(s * R, 0.0, -21.5))
    return m


@asset("hd_stairs", tier="A", material="stone",
       note="Six-step flight with nosings and a moulded string.")
def hd_stairs():
    m = mk.Mesh()
    steps, W = 6, 100.0
    rise, run = 100.0 / steps, 100.0 / steps
    for k in range(steps):
        z = -50.0 + rise * (k + 0.5)
        y = 50.0 - run * (k + 0.5)
        tread = mk.chamfer_box(W, run * (steps - k), rise, c=1.6)
        tread.translate(0.0, y - run * (steps - k - 1) * 0.5, z)
        m.merge(tread)
        nos = mk.tube([(-W * 0.5, y - run * 0.5, z + rise * 0.5),
                       (W * 0.5, y - run * 0.5, z + rise * 0.5)],
                      [2.6, 2.6], sides=6)
        m.merge(nos)
    return m


@asset("hd_bridge", tier="B", material="stone",
       note="Single-span arched bridge with a parapet.")
def hd_bridge():
    m = mk.Mesh()
    R = 42.0
    for k in range(13):
        a = math.pi * (k + 0.5) / 13
        v = mk.chamfer_box(2.0 * math.pi * R / 13 * 0.95, 70.0, 14.0, c=1.4)
        v.rotate_y(90.0 - math.degrees(a))
        v.translate(math.cos(a) * R, 0.0, math.sin(a) * R - 44.0)
        m.merge(v)
    for s in (-1, 1):
        m.merge(mk.chamfer_box(14.0, 70.0, 30.0, c=1.4).translate(s * R, 0.0, -35.0))
    deck = []
    for i in range(11):
        t = -1.0 + 2.0 * i / 10.0
        deck.append((t * 50.0, 0.0, -2.0 + 8.0 * (1.0 - t * t)))
    for s in (-1, 1):
        rail = mk.tube([(p[0], s * 34.0, p[2] + 16.0) for p in deck],
                       [3.0] * 11, sides=6)
        m.merge(rail)
        for i in range(0, 11, 2):
            b = mk.lathe([(0, 0), (5, 0), (5, 3), (3, 6), (5, 11), (3, 15), (4, 16)],
                         seg=8)
            b.translate(deck[i][0], s * 34.0, deck[i][2] + 2.0)
            m.merge(b)
    m.merge(mk.chamfer_box(100.0, 66.0, 8.0, c=1.0).translate(0, 0, 2.0))
    return m


@asset("hd_dome", tier="B", material="gold",
       note="Ribbed onion dome on a drum, with a lantern.")
def hd_dome():
    m = mk.lathe(mk.bell(46.0, 74.0, steps=10, flare=0.06, z0=-20.0), seg=20)
    m.merge(mk.torus(45.0, 5.0, major=20, minor=6).translate(0, 0, -19.0))
    m.merge(mk.lathe([(0.0, -50.0), (46.0, -50.0), (46.0, -22.0), (0.0, -22.0)],
                     seg=20))
    prof = mk.bell(46.0, 74.0, steps=10, flare=0.06, z0=-20.0)
    for k in range(8):
        pts = [(r * 1.015, 0.0, z) for (r, z) in prof if r > 1.5]
        rib = mk.tube(pts, [1.8] * len(pts), sides=4)
        rib.rotate_z(360.0 * k / 8.0)
        m.merge(rib)
    m.merge(mk.lathe([(6.0, 54.0), (4.0, 60.0), (7.0, 63.0), (0.0, 72.0)], seg=8))
    return m



@asset("hd_merlon", tier="C", material="porcelain",
       note="A crenellation block with a weathered cap.")
def hd_merlon():
    m = mk.chamfer_box(100.0, 100.0, 84.0, c=5.0).translate(0, 0, -8.0)
    m.merge(mk.chamfer_box(108.0, 108.0, 12.0, c=4.0).translate(0, 0, 44.0))
    return m


@asset("hd_finial", tier="B", material="gold",
       note="A turned finial with a collar and a bud.")
def hd_finial():
    return mk.lathe([(0.0, -50.0), (13.0, -50.0), (13.0, -43.0), (8.0, -38.0),
                     (16.0, -30.0), (17.0, -18.0), (11.0, -6.0), (6.0, 2.0),
                     (12.0, 8.0), (12.0, 14.0), (6.0, 20.0), (7.0, 28.0),
                     (3.0, 36.0), (0.0, 50.0)], seg=16)


@asset("hd_corbel", tier="B", material="porcelain",
       note="A scrolled bracket, for balconies and eaves.")
def hd_corbel():
    m = mk.Mesh()
    prof = [(-50.0, -50.0), (-50.0, 50.0), (10.0, 50.0), (24.0, 36.0),
            (26.0, 14.0), (12.0, -2.0), (16.0, -20.0), (4.0, -34.0),
            (-14.0, -44.0), (-30.0, -50.0)]
    body = mk.prism(prof, 46.0)
    body.rotate_x(90.0)
    m.merge(body)
    for s in (-1, 1):
        sp = []
        for i in range(16):
            t = i / 15.0
            a = t * 4.6
            r = 15.0 * (1.0 - 0.75 * t)
            sp.append((14.0 + math.cos(a) * r, s * 24.0, 22.0 + math.sin(a) * r))
        m.merge(mk.tube(sp, [3.2 - 1.6 * (i / 15.0) for i in range(16)], sides=5))
    return m


@asset("hd_balcony", tier="A", material="porcelain",
       note="Corbelled balcony ring with turned balusters.")
def hd_balcony():
    m = mk.lathe([(30.0, -50.0), (44.0, -34.0), (48.0, -26.0), (48.0, -20.0),
                  (30.0, -20.0)], seg=24)
    m.merge(mk.torus(47.0, 4.0, major=24, minor=7).translate(0, 0, -21.0))
    m.merge(mk.torus(46.0, 4.5, major=24, minor=7).translate(0, 0, 34.0))
    for k in range(18):
        b = mk.lathe([(0, 0), (5.5, 0), (5.5, 4), (3.2, 8), (5.5, 16),
                      (6.5, 28), (3.6, 40), (5.0, 46), (5.0, 52), (0, 52)], seg=8)
        b.translate(45.0, 0.0, -20.0)
        b.rotate_z(360.0 * k / 18.0)
        m.merge(b)
    return m

# ==========================================================================
# GROUND  (Phase I)
# ==========================================================================


@asset("hd_flagstone", tier="B", material="cobble",
       note="One irregular domed paving stone with a chamfered worn arris.")
def hd_flagstone():
    """Drop-in for the scaled Cube the plaza lays thousands of.

    Three things separate a paving stone from a box: the plan is an irregular
    polygon and not a rectangle, the top is domed from wear, and the arris is
    rounded rather than sharp. All three are silhouette-scale at the distance
    the player stands on it, which is why the plaza has read as a floor
    TEXTURE rather than as stone. Built as three stacked rings so the top edge
    is a real chamfer, not a taper."""
    n = 7
    base = []
    for i in range(n):
        a_ = 2.0 * math.pi * i / n + mk.rrange(-0.18, 0.18, i, 7)
        r = 50.0 * mk.rrange(0.80, 1.00, i, 11)
        base.append((math.cos(a_) * r, math.sin(a_) * r))
    rings = [[(x * 0.97, y * 0.97, -13.0) for (x, y) in base],
             [(x, y, -3.0) for (x, y) in base],
             [(x * 0.94, y * 0.94, 8.0) for (x, y) in base],
             [(x * 0.86, y * 0.86, 11.0) for (x, y) in base]]
    m = mk.loft(rings)
    def dome(x, y, z):
        if z > 7.0:
            d = math.sqrt(x * x + y * y) / 50.0
            return (x, y, z + 2.4 * (1.0 - d * d)
                    + 0.8 * mk.fbm(x, y, 0.0, 2, 0.05, 3))
        return (x, y, z)
    return m.displace(dome)


@asset("hd_cobble_patch", tier="A", material="cobble",
       note="A 5x5 patch of separate irregular setts with real joints.")
def hd_cobble_patch():
    """Where the path is a large field, one patch replaces twenty-five
    instances AND carries twenty-five real joints. The joints are the point:
    a cobbled road is read from the dark line between stones, and a single
    stretched box has none."""
    m = mk.Mesh()
    for gx in range(5):
        for gy in range(5):
            cx = -40.0 + 20.0 * gx + mk.rrange(-2.2, 2.2, gx, gy, 1)
            cy = -40.0 + 20.0 * gy + mk.rrange(-2.2, 2.2, gx, gy, 2)
            n = 6
            poly = []
            for i in range(n):
                a = 2.0 * math.pi * i / n + mk.rrange(-0.22, 0.22, gx, gy, i)
                r = 8.6 * mk.rrange(0.78, 1.05, gx, gy, i + 20)
                poly.append((math.cos(a) * r, math.sin(a) * r))
            s = mk.prism(poly, 9.0, taper=0.86)
            h = mk.rrange(-0.9, 0.9, gx, gy, 5)
            s.translate(cx, cy, h)
            m.merge(s)
    return m


@asset("hd_kerb", tier="B", material="stone",
       note="A kerbstone with a weathered top roll.")
def hd_kerb():
    m = mk.chamfer_box(100.0, 100.0, 80.0, c=6.0).translate(0, 0, -10.0)
    top = mk.chamfer_box(96.0, 96.0, 22.0, c=9.0).translate(0, 0, 39.0)
    m.merge(top)
    return m


# ==========================================================================
# VEGETATION  (Phases K, L, M)
# ==========================================================================


def _lump(r, seed, rough=0.30, seg=12, rings=8, fine=0.12):
    """A noise-displaced blob. The unit of stylised foliage — never used alone,
    because one lump IS a sphere; foliage is what you get when several
    interpenetrate and the outline stops being convex.

    TWO FREQUENCIES. The contact sheet showed the first version as clusters
    of clean balls: one low-frequency wobble moves a sphere's outline but
    leaves it smooth, so it still reads as a sphere. A second, finer term at
    four times the frequency puts a ragged edge on the silhouette — the leafy
    outline the eye actually uses to say "foliage"."""
    prof = []
    for i in range(rings + 1):
        t = i / float(rings)
        a = math.pi * t
        prof.append((r * math.sin(a), -r * math.cos(a)))
    m = mk.lathe(prof, seg=seg)
    def d(x, y, z):
        n = mk.fbm(x, y, z, 3, 1.9 / max(r, 1.0), seed)
        f = mk.vnoise(x, y, z, 7.5 / max(r, 1.0), seed + 101)
        k = 1.0 + rough * n + fine * f
        return (x * k, y * k, z * k)
    return m.displace(d)


@asset("hd_canopy", tier="A", material="foliage",
       note="Ragged leaf mass: nine interpenetrating lumps, not a sphere.")
def hd_canopy():
    """The fix for "blob trees".

    A single displaced sphere is still a sphere in outline — noise only ruffles
    a convex hull. This is nine lumps of four different radii pushed out to
    different distances, so the silhouette has deep re-entrant notches between
    clumps. That concavity is the whole difference between a tree and a ball on
    a stick, and it is visible at any distance the silhouette is."""
    m = mk.Mesh()
    spots = [(0.0, 0.0, 6.0, 30.0), (26.0, 8.0, -6.0, 22.0),
             (-22.0, 14.0, -2.0, 24.0), (8.0, -26.0, -4.0, 23.0),
             (-14.0, -20.0, 8.0, 20.0), (18.0, 18.0, 16.0, 18.0),
             (-24.0, -6.0, 18.0, 17.0), (4.0, 22.0, 22.0, 19.0),
             (0.0, -6.0, -22.0, 21.0), (30.0, -12.0, 10.0, 15.0),
             (-8.0, 30.0, 4.0, 14.0), (-30.0, 4.0, -14.0, 15.0)]
    for i, (x, y, z, r) in enumerate(spots):
        L = _lump(r, seed=17 + i * 13, rough=0.30, seg=11, rings=7, fine=0.16)
        L.translate(x, y, z)
        m.merge(L)
    # Leaf sprays at the surface, leaning outward, so the outline carries
    # individual leaves at the scale the hero camera sees the framing trees.
    for i in range(10):
        a_ = 2.0 * math.pi * 0.618 * i
        el = mk.rrange(-0.5, 0.9, i, 4)
        sp = _spray_lo()
        sp.scale(0.30, 0.30, 0.30)
        sp.rotate_x(mk.rrange(50.0, 110.0, i, 6))
        sp.rotate_z(math.degrees(a_) + 90.0)
        sp.translate(math.cos(a_) * math.cos(el) * 40.0,
                     math.sin(a_) * math.cos(el) * 40.0, math.sin(el) * 34.0)
        m.merge(sp)
    return m


@asset("hd_canopy_far", tier="C", material="foliage",
       note="Four lumps — enough for a ragged outline at distance.")
def hd_canopy_far():
    m = mk.Mesh()
    for i, (x, y, z, r) in enumerate([(0, 0, 4, 32), (24, 10, -8, 24),
                                      (-22, 12, -4, 25), (2, -24, 10, 23),
                                      (-10, -14, -16, 18), (16, 22, 12, 16)]):
        L = _lump(r, seed=31 + i * 7, rough=0.30, seg=8, rings=5, fine=0.14)
        L.translate(x, y, z)
        m.merge(L)
    return m


@asset("hd_trunk", tier="A", material="bark",
       note="Lofted trunk: root flare, bark ridges, a lean and a twist.")
def hd_trunk():
    """A cylinder has one radius and no lean. A trunk has a flaring base that
    grips the ground, ridges that run up it, a taper, and a bend — and it is
    the bend that makes the eye read wood."""
    rings = []
    N = 14
    for i in range(N + 1):
        t = i / float(N)
        r = 26.0 * (1.0 - 0.62 * t) + 20.0 * math.exp(-t * 9.0)
        lean_x = 16.0 * t * t
        lean_y = -5.0 * t * t
        ring = []
        for k in range(14):
            a = 2.0 * math.pi * k / 14 + 0.55 * t
            ridge = 1.0 + 0.13 * math.cos(5.0 * a + 2.4 * t) \
                        + 0.09 * mk.fbm(math.cos(a) * 4, math.sin(a) * 4, t * 7, 2, 1.0, 5)
            ring.append((lean_x + math.cos(a) * r * ridge,
                         lean_y + math.sin(a) * r * ridge,
                         -50.0 + 100.0 * t))
        rings.append(ring)
    m = mk.loft(rings)
    for k in range(6):
        a = 2.0 * math.pi * k / 6 + 0.4
        root = mk.tube([(math.cos(a) * 20.0, math.sin(a) * 20.0, -36.0),
                        (math.cos(a) * 34.0, math.sin(a) * 34.0, -45.0),
                        (math.cos(a) * 46.0, math.sin(a) * 46.0, -50.0)],
                       [11.0, 7.5, 4.5], sides=6)
        m.merge(root)
    return m


@asset("hd_trunk_giant", tier="A", material="bark",
       note="The frame-edge tree: deep bark furrows, buttress roots, a hollow.")
def hd_trunk_giant():
    """The reference's right-hand frame is one enormous trunk, and in ours that
    edge measures luma 43 against our 94 — the darkest sixth of the picture is
    a tree. This is that tree: twelve deep furrows, six buttress roots, and a
    heavy lean into frame so it arches over the camera."""
    rings = []
    N = 16
    for i in range(N + 1):
        t = i / float(N)
        r = 34.0 * (1.0 - 0.40 * t) + 26.0 * math.exp(-t * 7.0)
        ring = []
        for k in range(18):
            a = 2.0 * math.pi * k / 18 + 0.9 * t
            furrow = 1.0 + 0.17 * math.cos(12.0 * a + 3.1 * t) \
                         + 0.11 * math.cos(5.0 * a - 1.6 * t) \
                         + 0.07 * mk.fbm(math.cos(a) * 6, math.sin(a) * 6, t * 9, 3, 1.0, 9)
            ring.append((26.0 * t * t + math.cos(a) * r * furrow,
                         -9.0 * t * t + math.sin(a) * r * furrow,
                         -50.0 + 100.0 * t))
        rings.append(ring)
    m = mk.loft(rings)
    for k in range(6):
        a = 2.0 * math.pi * k / 6 + 0.25
        m.merge(mk.tube([(math.cos(a) * 26.0, math.sin(a) * 26.0, -30.0),
                         (math.cos(a) * 44.0, math.sin(a) * 44.0, -43.0),
                         (math.cos(a) * 58.0, math.sin(a) * 58.0, -50.0)],
                        [15.0, 10.0, 6.0], sides=7))
    return m


@asset("hd_branch", tier="B", material="bark",
       note="A tapered branch that forks twice.")
def hd_branch():
    m = mk.Mesh()
    def limb(p0, dirv, length, r0, depth, key):
        pts, rr = [], []
        for i in range(6):
            t = i / 5.0
            bend = 0.30 * t * t
            pts.append((p0[0] + dirv[0] * length * t,
                        p0[1] + dirv[1] * length * t,
                        p0[2] + dirv[2] * length * t + bend * length * 0.32))
            rr.append(r0 * (1.0 - 0.66 * t))
        m.merge(mk.tube(pts, rr, sides=max(4, 7 - depth)))
        if depth >= 2:
            return
        for s in (-1, 1):
            a = 0.85 * s + mk.rrange(-0.25, 0.25, key, depth, s)
            nd = (dirv[0] * math.cos(a) - dirv[1] * math.sin(a),
                  dirv[0] * math.sin(a) + dirv[1] * math.cos(a),
                  dirv[2] * 0.6 + 0.25)
            L = math.sqrt(sum(c * c for c in nd)) or 1.0
            nd = (nd[0] / L, nd[1] / L, nd[2] / L)
            limb(pts[-1], nd, length * 0.70, r0 * 0.55, depth + 1, key + 1)
    limb((0.0, 0.0, -50.0), (0.18, 0.0, 0.98), 62.0, 13.0, 0, 3)
    # A second primary limb from the same base, so the asset is a FORK and
    # not a spike: the sheet showed one tapering pole with two twigs.
    limb((0.0, 0.0, -42.0), (-0.52, 0.30, 0.80), 52.0, 9.5, 0, 9)
    limb((0.0, 0.0, -30.0), (0.30, -0.60, 0.74), 44.0, 8.0, 1, 15)
    return m


@asset("hd_leaf", tier="C", material="foliage",
       note="One leaf blade with a midrib crease.")
def hd_leaf():
    poly = []
    for i in range(11):
        t = i / 10.0
        w = 26.0 * math.sin(math.pi * t) ** 0.75
        poly.append((w, -50.0 + 100.0 * t))
    for i in range(10, -1, -1):
        t = i / 10.0
        w = 26.0 * math.sin(math.pi * t) ** 0.75
        poly.append((-w, -50.0 + 100.0 * t))
    m = mk.plate(poly, 1.6)
    m.displace(lambda x, y, z: (x, y, z + 5.0 * (1.0 - abs(x) / 26.0) ** 2
                                - 3.0 * ((y + 50.0) / 100.0) ** 2))
    return m


@asset("hd_leaf_spray", tier="B", material="foliage",
       note="Seven leaves on a common stem — the unit foliage detail.")
def hd_leaf_spray():
    m = mk.Mesh()
    m.merge(mk.tube([(0, 0, -50), (2, 0, -18), (6, 0, 20), (10, 0, 46)],
                    [2.6, 2.0, 1.4, 0.8], sides=4))
    for i in range(7):
        t = 0.16 + 0.13 * i
        leaf = hd_leaf()
        leaf.scale(0.42, 0.42, 0.42)
        leaf.rotate_x(90.0)
        leaf.rotate_y(-38.0 + 12.0 * i)
        leaf.rotate_z(360.0 * 0.618 * i)
        leaf.translate(2.0 + 8.0 * t, 0.0, -50.0 + 96.0 * t)
        m.merge(leaf)
    return m


@asset("hd_rose", tier="A", material="rose_pink",
       note="A layered rose — five whorls of cupped petals.")
def hd_rose():
    """The reference puts roses everywhere: on the gate, the arch, the heart,
    the beds. A rose is concentric cupped petals with a spiral offset, and it
    is the one flower that must never be a sphere, because its whole read is
    the spiral."""
    m = mk.Mesh()
    whorls = [(5, 46.0, -18.0, 0.00, 62.0), (5, 36.0, -4.0, 0.32, 52.0),
              (5, 26.0, 8.0, 0.64, 44.0), (4, 17.0, 18.0, 0.96, 36.0),
              (3, 9.0, 27.0, 1.28, 30.0)]
    for wi, (n, R, z, ph, tilt) in enumerate(whorls):
        for k in range(n):
            a = 2.0 * math.pi * k / n + ph
            poly = []
            for i in range(9):
                t = i / 8.0
                w = R * 0.62 * math.sin(math.pi * t) ** 0.6
                poly.append((w, -R * 0.5 + R * t))
            for i in range(8, -1, -1):
                t = i / 8.0
                w = R * 0.62 * math.sin(math.pi * t) ** 0.6
                poly.append((-w, -R * 0.5 + R * t))
            p = mk.plate(poly, 1.8)
            p.displace(lambda x, y, z, R=R: (x, y, z + 0.30 * (x * x) / R))
            p.rotate_x(90.0 - tilt)
            p.translate(R * 0.42, 0.0, z)
            p.rotate_z(math.degrees(a))
            m.merge(p)
    m.merge(mk.lathe([(0, 24.0), (7.0, 30.0), (4.0, 36.0), (0, 38.0)], seg=8))
    return m


def _rose_lo(seed=0):
    """A rose at composite cost. Three whorls, four petals, six-sided plates.

    Composites embed roses by the dozen — the arch carries seventeen and the
    heart nine — and at hero detail that is 26,000 triangles of flower on a
    4,200-triangle budget. The spiral still reads; the petal edge does not need
    nine segments to."""
    m = mk.Mesh()
    for wi, (n, R, z, ph) in enumerate(((4, 44.0, -14.0, 0.0),
                                        (4, 30.0, 2.0, 0.5),
                                        (3, 16.0, 16.0, 1.0))):
        for k in range(n):
            a_ = 2.0 * math.pi * k / n + ph
            poly = [(R * 0.30, -R * 0.5), (R * 0.52, -R * 0.1),
                    (R * 0.34, R * 0.4), (0.0, R * 0.52),
                    (-R * 0.34, R * 0.4), (-R * 0.52, -R * 0.1),
                    (-R * 0.30, -R * 0.5)]
            p = mk.plate(poly, 1.8)
            p.rotate_x(34.0)
            p.translate(R * 0.42, 0.0, z)
            p.rotate_z(math.degrees(a_))
            m.merge(p)
    return m


def _flower_lo():
    """Five petals as one plate each, no boss."""
    m = mk.Mesh()
    for k in range(5):
        p = mk.plate([(0.0, 6.0), (14.0, 20.0), (10.0, 44.0), (0.0, 50.0),
                      (-10.0, 44.0), (-14.0, 20.0)], 1.5)
        p.rotate_z(72.0 * k)
        m.merge(p)
    return m


def _spray_lo():
    """A stem and five leaves at quarter cost."""
    m = mk.tube([(0, 0, -50), (4, 0, 0), (9, 0, 46)], [2.4, 1.6, 0.8], sides=3)
    for i in range(5):
        t = 0.22 + 0.17 * i
        leaf = mk.plate([(0.0, 0.0), (9.0, 16.0), (0.0, 40.0), (-9.0, 16.0)], 1.4)
        leaf.rotate_x(90.0)
        leaf.rotate_y(-30.0 + 15.0 * i)
        leaf.rotate_z(360.0 * 0.618 * i)
        leaf.translate(2.0 + 7.0 * t, 0.0, -50.0 + 96.0 * t)
        m.merge(leaf)
    return m

@asset("hd_flower", tier="C", material="petal_pink",
       note="A five-petal bloom with a raised boss.")
def hd_flower():
    m = mk.Mesh()
    for k in range(5):
        poly = []
        for i in range(7):
            t = i / 6.0
            w = 22.0 * math.sin(math.pi * t) ** 0.55
            poly.append((w, 8.0 + 42.0 * t))
        for i in range(6, -1, -1):
            t = i / 6.0
            w = 22.0 * math.sin(math.pi * t) ** 0.55
            poly.append((-w, 8.0 + 42.0 * t))
        p = mk.plate(poly, 1.5)
        p.displace(lambda x, y, z: (x, y, z + 0.045 * y))
        p.rotate_z(72.0 * k)
        m.merge(p)
    m.merge(mk.lathe([(0, 2.0), (9.0, 6.0), (7.0, 12.0), (0, 14.0)], seg=8))
    return m


@asset("hd_bloom_cluster", tier="B", material="rose_pink",
       note="Eleven blooms on a shared base — one instance, many flowers.")
def hd_bloom_cluster():
    m = mk.Mesh()
    for i in range(11):
        f = _flower_lo()
        s = mk.rrange(0.30, 0.62, i, 3)
        f.scale(s, s, s)
        f.rotate_x(mk.rrange(-34.0, 34.0, i, 5))
        f.rotate_z(mk.rrange(0.0, 360.0, i, 7))
        f.translate(mk.rrange(-38.0, 38.0, i, 11),
                    mk.rrange(-38.0, 38.0, i, 13),
                    mk.rrange(-40.0, 40.0, i, 17))
        m.merge(f)
    return m


@asset("hd_shrub", tier="B", material="foliage",
       note="Five lumps with a ragged top — a bush, not a ball.")
def hd_shrub():
    m = mk.Mesh()
    for i, (x, y, z, r) in enumerate([(0, 0, -8, 34), (24, 10, 4, 24),
                                      (-20, 16, 2, 25), (12, -22, 8, 22),
                                      (-16, -18, 14, 20)]):
        L = _lump(r, seed=61 + i * 11, rough=0.32, seg=10, rings=6, fine=0.16)
        L.translate(x, y, z)
        m.merge(L)
    for i in range(8):
        sp = _spray_lo()
        sp.scale(0.30, 0.30, 0.30)
        sp.rotate_x(mk.rrange(20.0, 70.0, i, 2))
        sp.rotate_z(mk.rrange(0.0, 360.0, i, 4))
        sp.translate(mk.rrange(-26.0, 26.0, i, 6), mk.rrange(-26.0, 26.0, i, 8),
                     mk.rrange(10.0, 34.0, i, 9))
        m.merge(sp)
    return m


@asset("hd_topiary_heart", tier="A", material="foliage",
       note="A heart WREATH — a thick band of clipped ivy with an open centre.")
def hd_topiary_heart():
    """The founder's signature landmark, and the first version of it was solid.

    Look at the reference: the heart is a WREATH. It is a thick band of ivy
    following the heart outline with the middle OPEN — you see the castle
    through it. A solid heart is a different object, and in the offline trace
    it read as exactly what it was: a 3.7%-of-frame dark green mass sitting on
    the skyline, blocking the depth it is supposed to sit in front of.

    So: the heart curve swept as a fat noisy tube, not extruded as a slab. The
    radius varies along the curve (a clipped hedge is not a machined pipe), the
    surface carries fbm at two frequencies, leaf sprays break the outline, and
    roses stud the lobes the way the reference's do."""
    N = 46
    pts, rad = [], []
    for i in range(N + 1):
        t = 2.0 * math.pi * i / N
        x = 16.0 * math.sin(t) ** 3
        y = (13.0 * math.cos(t) - 5.0 * math.cos(2 * t)
             - 2.0 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((x * 2.7, 0.0, y * 2.7))
        rad.append(11.0 * (1.0 + 0.20 * mk.vnoise(x, y, 0.0, 0.10, 5)))
    m = mk.tube(pts, rad, sides=7, cap=False)
    m.displace(lambda x, y, z: (
        x + 2.6 * mk.fbm(x, y, z, 3, 0.045, 31),
        y + 2.6 * mk.fbm(x, y, z, 3, 0.045, 33),
        z + 2.6 * mk.fbm(x, y, z, 3, 0.045, 37)))
    for i in range(10):
        t = 2.0 * math.pi * mk.rnd(i, 3, 1)
        x = 16.0 * math.sin(t) ** 3 * 2.7
        z = (13.0 * math.cos(t) - 5.0 * math.cos(2 * t)
             - 2.0 * math.cos(3 * t) - math.cos(4 * t)) * 2.7
        r = _rose_lo(i)
        sc = mk.rrange(0.20, 0.34, i, 9)
        r.scale(sc, sc, sc)
        r.rotate_x(mk.rrange(-70.0, -20.0, i, 11))
        r.translate(x, -10.0, z)
        m.merge(r)
    for i in range(9):
        t = 2.0 * math.pi * mk.rnd(i, 7, 2)
        x = 16.0 * math.sin(t) ** 3 * 2.7
        z = (13.0 * math.cos(t) - 5.0 * math.cos(2 * t)
             - 2.0 * math.cos(3 * t) - math.cos(4 * t)) * 2.7
        sp = _spray_lo()
        sp.scale(0.34, 0.34, 0.34)
        sp.rotate_x(mk.rrange(40.0, 140.0, i, 5))
        sp.rotate_z(mk.rrange(0.0, 360.0, i, 6))
        sp.translate(x * 1.06, mk.rrange(-9.0, 9.0, i, 8), z * 1.06)
        m.merge(sp)
    return m


@asset("hd_grass_tuft", tier="C", material="foliage",
       note="Nine curved blades from one root.")
def hd_grass_tuft():
    m = mk.Mesh()
    for i in range(9):
        a = 2.0 * math.pi * 0.618 * i
        lean = mk.rrange(14.0, 46.0, i, 2)
        h = mk.rrange(60.0, 100.0, i, 4)
        pts, rr = [], []
        for k in range(4):
            t = k / 3.0
            pts.append((math.cos(a) * lean * t * t, math.sin(a) * lean * t * t,
                        -50.0 + h * t))
            rr.append(4.4 * (1.0 - 0.92 * t))
        m.merge(mk.tube(pts, rr, sides=3))
    return m


@asset("hd_vine", tier="B", material="foliage",
       note="A twisting vine with leaves along its length.")
def hd_vine():
    m = mk.Mesh()
    pts, rr = [], []
    for i in range(13):
        t = i / 12.0
        a = t * 5.4
        pts.append((math.cos(a) * 15.0 * (1.0 - 0.4 * t),
                    math.sin(a) * 15.0 * (1.0 - 0.4 * t), 50.0 - 100.0 * t))
        rr.append(3.4 * (1.0 - 0.55 * t))
    m.merge(mk.tube(pts, rr, sides=5))
    for i in range(0, 13, 2):
        leaf = hd_leaf()
        leaf.scale(0.26, 0.26, 0.26)
        leaf.rotate_x(78.0)
        leaf.rotate_z(mk.rrange(0.0, 360.0, i, 3))
        leaf.translate(*pts[i])
        m.merge(leaf)
    return m


# ==========================================================================
# MUSHROOMS  (Phase N)
# ==========================================================================


@asset("hd_mush_cap", tier="A", material="mush_red",
       note="Organic cap: ogee crown, rolled rim, radial gills beneath.")
def hd_mush_cap():
    """A cone is the wrong shape twice over — it has no rolled rim and no
    underside. This has an ogee crown that tucks under at the edge, a lobed rim
    from a scallop wobble, and forty gills radiating from the stem, which is
    the detail that actually reads when a cap is above eye level, and every cap
    in the reference is."""
    prof = [(0.0, 46.0), (12.0, 44.0), (26.0, 39.0), (38.0, 31.0),
            (46.0, 20.0), (50.0, 8.0), (49.0, 1.0), (44.0, -1.0),
            (43.0, 3.0), (30.0, 6.0), (16.0, 8.0), (7.0, 8.0), (7.0, 2.0)]
    m = mk.lathe(prof, seg=26,
                 wobble=lambda a, t: 1.0 + 0.030 * math.cos(9.0 * a) * (1.0 - t))
    def bumps(x, y, z):
        r = math.sqrt(x * x + y * y)
        if z < 6.0:
            return (x, y, z)
        k = 1.0 + 0.035 * mk.fbm(x, y, z, 2, 0.055, 41)
        return (x * k, y * k, z + 1.4 * mk.fbm(x, y, z * 2, 2, 0.06, 43))
    m.displace(bumps)
    for k in range(40):
        a = 360.0 * k / 40.0
        g = mk.plate([(7.0, 0.0), (44.0, 0.0), (44.0, -3.4), (7.0, -1.4)], 1.1)
        g.rotate_x(90.0)
        g.rotate_z(a)
        g.translate(0.0, 0.0, 5.4)
        m.merge(g)
    return m


@asset("hd_mush_cap_far", tier="C", material="mush_red",
       note="Cap silhouette only — no gills.")
def hd_mush_cap_far():
    prof = [(0.0, 46.0), (24.0, 39.0), (42.0, 26.0), (50.0, 8.0),
            (48.0, 0.0), (42.0, 2.0), (16.0, 7.0), (7.0, 7.0)]
    return mk.lathe(prof, seg=12)


@asset("hd_mush_stem", tier="A", material="mush_stem",
       note="Bulbous curved stem with a ring skirt.")
def hd_mush_stem():
    """Stems in the reference lean, swell at the base and carry an annulus.
    A cylinder does none of those."""
    rings = []
    N = 12
    for i in range(N + 1):
        t = i / float(N)
        r = 14.0 + 12.0 * math.exp(-t * 5.0) - 3.0 * t
        ring = []
        for k in range(12):
            a = 2.0 * math.pi * k / 12
            w = 1.0 + 0.05 * math.cos(6.0 * a + 3.0 * t)
            ring.append((10.0 * t * t + math.cos(a) * r * w,
                         -3.0 * t * t + math.sin(a) * r * w,
                         -50.0 + 100.0 * t))
        rings.append(ring)
    m = mk.loft(rings)
    m.merge(mk.lathe([(13.0, 0.0), (26.0, -3.0), (25.0, -8.0), (12.0, -6.0)],
                     seg=14).translate(6.0, -1.6, 22.0))
    return m


@asset("hd_mush_spot", tier="C", material="mush_spot",
       note="A raised wart, the way the reference's caps carry them.")
def hd_mush_spot():
    return mk.lathe([(0.0, 34.0), (18.0, 30.0), (34.0, 18.0), (44.0, 0.0),
                     (46.0, -12.0), (0.0, -12.0)], seg=12)


@asset("hd_mush_house_cap", tier="B", material="mush_red",
       note="A mushroom-house roof: cap with an eave lip and window dormers.")
def hd_mush_house_cap():
    prof = [(0.0, 50.0), (16.0, 47.0), (32.0, 40.0), (43.0, 28.0),
            (50.0, 12.0), (50.0, 2.0), (44.0, -2.0), (42.0, 2.0),
            (22.0, 6.0), (8.0, 8.0)]
    m = mk.lathe(prof, seg=22,
                 wobble=lambda a, t: 1.0 + 0.022 * math.cos(11.0 * a))
    m.merge(mk.torus(47.0, 4.2, major=22, minor=7).translate(0, 0, 6.0))
    return m


# ==========================================================================
# THE GATE AND ITS ORNAMENT  (Phases O, P)
# ==========================================================================


@asset("hd_scroll", tier="A", material="gold",
       note="A swept filigree volute — the unit of wrought ironwork.")
def hd_scroll():
    """Wrought metal is a LINE swept in space. Every gold thing in the
    reference gate is scrollwork, and a scroll is a logarithmic spiral of round
    bar. This is that, and the gate is built by repeating and mirroring it."""
    pts, rr = [], []
    N = 26
    for i in range(N):
        t = i / float(N - 1)
        a = t * 5.6
        r = 46.0 * math.exp(-1.35 * t)
        pts.append((math.cos(a) * r, 0.0, math.sin(a) * r))
        rr.append(4.4 - 2.0 * t)
    return mk.tube(pts, rr, sides=6)


@asset("hd_heart_motif", tier="A", material="gold",
       note="A heart drawn in round bar, for gate and railing centres.")
def hd_heart_motif():
    pts = []
    N = 40
    for i in range(N + 1):
        t = 2.0 * math.pi * i / N
        x = 16.0 * math.sin(t) ** 3
        y = (13.0 * math.cos(t) - 5.0 * math.cos(2 * t)
             - 2.0 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((x * 3.0, 0.0, y * 3.0))
    return mk.tube(pts, [5.0] * len(pts), sides=6, cap=False)


@asset("hd_gate_bar", tier="B", material="gold",
       note="A twisted square bar with a collar — not a box.")
def hd_gate_bar():
    m = mk.Mesh()
    rings = []
    for i in range(15):
        t = i / 14.0
        ring = []
        for k in range(4):
            a = 2.0 * math.pi * k / 4 + t * 7.2
            ring.append((math.cos(a) * 5.2, math.sin(a) * 5.2, -50.0 + 100.0 * t))
        rings.append(ring)
    m.merge(mk.loft(rings))
    for z in (-24.0, 26.0):
        m.merge(mk.lathe([(6.0, -4.0), (9.0, -2.0), (9.0, 2.0), (6.0, 4.0)],
                         seg=8).translate(0, 0, z))
    return m


@asset("hd_spear_finial", tier="B", material="gold",
       note="A fleur/spear head for railing tops.")
def hd_spear_finial():
    m = mk.lathe([(0.0, -50.0), (7.0, -46.0), (7.0, -38.0), (11.0, -34.0),
                  (11.0, -28.0), (6.0, -22.0), (9.0, -10.0), (7.0, 12.0),
                  (3.0, 34.0), (0.0, 50.0)], seg=12)
    for k in range(4):
        b = mk.plate([(0.0, 0.0), (16.0, 6.0), (21.0, 18.0), (12.0, 15.0),
                      (5.0, 6.0)], 2.4)
        b.rotate_x(90.0)
        b.rotate_z(90.0 * k)
        b.translate(0.0, 0.0, -22.0)
        m.merge(b)
    return m


def _gate_bar_lo():
    """A twisted picket without the two collars."""
    rings = []
    for i in range(9):
        t = i / 8.0
        rings.append([(math.cos(2.0 * math.pi * k / 4 + t * 7.2) * 5.2,
                       math.sin(2.0 * math.pi * k / 4 + t * 7.2) * 5.2,
                       -50.0 + 100.0 * t) for k in range(4)])
    return mk.loft(rings)


def _spear_lo():
    """A spear head as a lathe and two blades."""
    m = mk.lathe([(0.0, -50.0), (8.0, -44.0), (10.0, -30.0), (6.0, -18.0),
                  (7.0, 6.0), (0.0, 50.0)], seg=8)
    for k in range(2):
        b = mk.plate([(0.0, 0.0), (16.0, 8.0), (11.0, 16.0)], 2.2)
        b.rotate_x(90.0)
        b.rotate_z(90.0 * k)
        b.translate(0.0, 0.0, -20.0)
        m.merge(b)
    return m

@asset("hd_gate_pillar", tier="A", material="porcelain",
       note="Moulded gate pier: plinth, panelled shaft, cornice, ball cap.")
def hd_gate_pillar():
    """The reference's piers are architecture, not posts: a stepped plinth, a
    recessed panel on each face, a moulded cap and a gold ball. Five silhouette
    events up the height where a box has one."""
    m = mk.Mesh()
    m.merge(mk.chamfer_box(100.0, 100.0, 13.0, c=3.0).translate(0, 0, -43.5))
    m.merge(mk.chamfer_box(90.0, 90.0, 9.0, c=2.5).translate(0, 0, -32.5))
    m.merge(mk.chamfer_box(78.0, 78.0, 58.0, c=3.0).translate(0, 0, 0.0))
    for yaw in (0.0, 90.0, 180.0, 270.0):
        p = mk.chamfer_box(56.0, 6.0, 42.0, c=2.0)
        p.translate(0.0, 40.0, 1.0)
        p.rotate_z(yaw)
        m.merge(p)
    m.merge(mk.chamfer_box(92.0, 92.0, 8.0, c=3.0).translate(0, 0, 33.0))
    m.merge(mk.chamfer_box(80.0, 80.0, 7.0, c=2.5).translate(0, 0, 40.5))
    m.merge(mk.lathe([(0.0, 44.0), (17.0, 46.0), (22.0, 53.0), (17.0, 60.0),
                      (7.0, 64.0), (0.0, 65.0)], seg=16))
    return m


@asset("hd_gate_leaf", tier="A", material="gold",
       note="One gate leaf: frame, twisted pickets, scroll infill, heart.")
def hd_gate_leaf():
    """The whole point of Phase O in one asset. Deleting the glowing slab left
    a row of bars; this is what wrought iron actually is — a frame, pickets
    with collars, four mirrored scrolls filling the head, a heart at the
    centre, and a spear on every picket top."""
    m = mk.Mesh()
    W, H = 96.0, 100.0
    for z in (-48.0, -6.0, 44.0):
        m.merge(mk.box(W, 7.0, 6.4).translate(0, 0, z))
    for s in (-1, 1):
        m.merge(mk.box(6.4, 7.0, H).translate(s * (W * 0.5 - 3.2), 0, 0))
    picks = 7
    for k in range(picks):
        x = -W * 0.5 + W * (k + 0.5) / picks
        bar = _gate_bar_lo()
        bar.scale(0.62, 0.62, 0.92)
        bar.translate(x, 0.0, -4.0)
        m.merge(bar)
        sp = _spear_lo()
        sp.scale(0.20, 0.20, 0.20)
        sp.translate(x, 0.0, 48.0)
        m.merge(sp)
    for sx in (-1, 1):
        for sz in (-1, 1):
            sc = hd_scroll()
            sc.scale(0.34, 0.34, 0.34)
            sc.rotate_y(90.0 if sz > 0 else -90.0)
            sc.scale(sx, 1.0, 1.0)
            sc.translate(sx * 26.0, 0.0, 22.0 + sz * 8.0)
            m.merge(sc)
    h = hd_heart_motif()
    h.scale(0.24, 0.24, 0.24)
    h.translate(0.0, 0.0, 20.0)
    m.merge(h)
    return m


@asset("hd_floral_arch", tier="S", material="foliage",
       note="An arch of vine over a real structural hoop, roses irregular.")
def hd_floral_arch():
    """Phase P. The structure is a hoop of bar; the vines wrap it; the roses
    are unevenly distributed, because an even distribution is the tell that a
    loop placed them."""
    m = mk.Mesh()
    R = 46.0
    hoop = []
    for i in range(25):
        a = math.pi * i / 24.0
        hoop.append((math.cos(a) * R, 0.0, math.sin(a) * R - 20.0))
    m.merge(mk.tube(hoop, [4.0] * 25, sides=6))
    for s in (-1, 1):
        for w in range(2):
            pts, rr = [], []
            for i in range(29):
                t = i / 28.0
                a = math.pi * t
                wob = 7.0 * math.sin(t * 13.0 + w * 2.1 + (0 if s > 0 else 1.1))
                pts.append((math.cos(a) * (R + wob * 0.5),
                            s * (5.0 + 4.0 * math.sin(t * 9.0 + w)),
                            math.sin(a) * (R + wob * 0.5) - 20.0))
                rr.append(2.4)
            m.merge(mk.tube(pts, rr, sides=4))
    for i in range(17):
        t = mk.rnd(i, 5, 1)
        a = math.pi * t
        r = _rose_lo(i)
        sc = mk.rrange(0.16, 0.30, i, 9)
        r.scale(sc, sc, sc)
        r.rotate_x(mk.rrange(-60.0, 60.0, i, 11))
        r.translate(math.cos(a) * (R + mk.rrange(-8.0, 9.0, i, 13)),
                    mk.rrange(-11.0, 11.0, i, 15),
                    math.sin(a) * (R + mk.rrange(-8.0, 9.0, i, 17)) - 20.0)
        m.merge(r)
    for i in range(11):
        t = mk.rnd(i, 7, 2)
        a = math.pi * t
        sp = _spray_lo()
        sp.scale(0.32, 0.32, 0.32)
        sp.rotate_y(mk.rrange(0.0, 360.0, i, 3))
        sp.translate(math.cos(a) * R, mk.rrange(-10.0, 10.0, i, 5),
                     math.sin(a) * R - 20.0)
        m.merge(sp)
    return m


# ==========================================================================
# PROPS  (Phase Q)
# ==========================================================================


@asset("hd_teacup", tier="A", material="porcelain", uniform=True,
       note="Lathed cup with a rolled lip, a foot ring and a torus handle.")
def hd_teacup():
    m = mk.lathe([(0.0, -50.0), (16.0, -50.0), (17.0, -44.0), (13.0, -40.0),
                  (24.0, -22.0), (33.0, 6.0), (36.0, 34.0), (37.0, 44.0),
                  (39.0, 48.0), (36.0, 50.0), (34.0, 44.0), (32.0, 10.0),
                  (22.0, -20.0), (11.0, -36.0), (0.0, -37.0)], seg=24)
    h = mk.torus(19.0, 4.2, major=18, minor=7, arc=250.0)
    h.rotate_x(90.0)
    h.rotate_z(90.0)
    h.translate(48.0, 0.0, 20.0)
    m.merge(h)
    return m


@asset("hd_saucer", tier="B", material="porcelain",
       note="A saucer with a well and a rolled rim.")
def hd_saucer():
    return mk.lathe([(0.0, -12.0), (18.0, -12.0), (19.0, -6.0), (16.0, -3.0),
                     (30.0, 2.0), (46.0, 9.0), (50.0, 13.0), (48.0, 16.0),
                     (44.0, 12.0), (28.0, 6.0), (14.0, 2.0), (0.0, 1.0)], seg=24)


@asset("hd_teapot", tier="A", material="porcelain", uniform=True,
       note="Body, lid, knob, swept spout, torus handle.")
def hd_teapot():
    """The reference floats one over the castle. A sphere is not a teapot; the
    spout and the handle are the entire silhouette."""
    m = mk.lathe([(0.0, -46.0), (18.0, -46.0), (20.0, -40.0), (16.0, -36.0),
                  (30.0, -22.0), (42.0, 0.0), (44.0, 14.0), (36.0, 26.0),
                  (26.0, 32.0), (25.0, 35.0), (0.0, 35.0)], seg=24)
    m.merge(mk.lathe([(0.0, 35.0), (26.0, 35.0), (25.0, 39.0), (18.0, 45.0),
                      (8.0, 48.0), (6.0, 50.0), (9.0, 53.0), (7.0, 57.0),
                      (0.0, 59.0)], seg=20))
    spout = [(24.0, 0.0, -12.0), (38.0, 0.0, -6.0), (50.0, 0.0, 6.0),
             (56.0, 0.0, 22.0), (54.0, 0.0, 32.0)]
    m.merge(mk.tube(spout, [11.0, 9.0, 7.0, 5.6, 5.0], sides=8))
    h = mk.torus(20.0, 4.6, major=18, minor=7, arc=260.0)
    h.rotate_x(90.0)
    h.rotate_z(90.0)
    h.translate(-50.0, 0.0, 6.0)
    m.merge(h)
    return m


@asset("hd_clock", tier="A", material="gold",
       note="Ornate clock: moulded bezel, recessed dial, twelve markers.")
def hd_clock():
    """Two of these hang on the reference's tree at the right frame edge. A
    clock is a bezel PROFILE and a recessed dial; a cylinder with a decal is
    not one, and the founder's list names crude clocks."""
    m = mk.lathe([(0.0, -14.0), (40.0, -14.0), (46.0, -10.0), (50.0, -2.0),
                  (49.0, 6.0), (44.0, 12.0), (40.0, 14.0), (37.0, 11.0),
                  (39.0, 4.0), (36.0, 0.0), (34.0, -3.0), (0.0, -3.0)], seg=26)
    for k in range(12):
        a = 360.0 * k / 12.0
        big = (k % 3 == 0)
        mark = mk.box(4.6 if big else 2.6, 11.0 if big else 7.0, 3.0)
        mark.rotate_x(90.0)
        mark.translate(0.0, 30.0, 0.0)
        mark.rotate_y(0.0)
        mark.rotate_z(a)
        mark.translate(0.0, 0.0, -1.0)
        m.merge(mark)
    for k in range(4):
        sc = hd_scroll()
        sc.scale(0.20, 0.20, 0.20)
        sc.rotate_x(90.0)
        sc.rotate_z(90.0 * k + 45.0)
        sc.translate(0.0, 0.0, -6.0)
        m.merge(sc)
    # Stand the dial up, facing -Y (toward the arrival camera, which looks
    # along +Y). Authored upright so the kit places it with NO rotation: a
    # rotation guessed at a call site has mis-aimed a camera and the sun in
    # this project already, and the FRotator field order is the trap.
    m.rotate_x(90.0)
    return m


@asset("hd_clock_hand", tier="B", material="gold",
       note="A tapered, pierced clock hand with a counterweight.")
def hd_clock_hand():
    m = mk.plate([(-4.0, -14.0), (4.0, -14.0), (2.4, 30.0), (0.0, 50.0),
                  (-2.4, 30.0)], 2.6)
    m.merge(mk.lathe([(0.0, 0.0), (7.0, 0.0), (7.0, 2.6), (0.0, 2.6)], seg=10)
            .translate(0.0, -14.0, 0.0))
    # Upright like the dial: length along +Z, thickness along Y. The hour hand
    # is the same mesh pitched 90 degrees at its call site.
    m.rotate_x(90.0)
    return m


@asset("hd_key", tier="A", material="gold", uniform=True,
       note="An ornate key: heart bow, collared shaft, cut bit.")
def hd_key():
    """Three float over the reference's castle. A key is a bow, a shaft with
    collars, and a bit with real notches — all silhouette."""
    m = mk.Mesh()
    bow = hd_heart_motif()
    bow.scale(0.30, 0.30, 0.30)
    bow.rotate_x(90.0)
    bow.translate(0.0, 0.0, 34.0)
    m.merge(bow)
    m.merge(mk.tube([(0, 0, 20.0), (0, 0, -46.0)], [4.6, 4.6], sides=8))
    for z in (14.0, -6.0, -30.0):
        m.merge(mk.lathe([(5.0, -2.6), (8.0, -1.2), (8.0, 1.2), (5.0, 2.6)],
                         seg=10).translate(0, 0, z))
    bit = mk.box(4.4, 20.0, 18.0)
    bit.translate(0.0, 12.0, -36.0)
    m.merge(bit)
    for (yy, zz, hh) in ((16.0, -28.0, 6.0), (20.0, -40.0, 5.0)):
        m.merge(mk.box(4.6, 9.0, hh).translate(0.0, yy, zz))
    return m


@asset("hd_lantern", tier="B", material="gold",
       note="A four-sided lantern cage with a finial and a ring.")
def hd_lantern():
    m = mk.Mesh()
    m.merge(mk.lathe([(0.0, -50.0), (20.0, -50.0), (22.0, -44.0), (14.0, -40.0)],
                     seg=12))
    for k in range(4):
        a = 90.0 * k + 45.0
        p = mk.box(4.0, 4.0, 62.0)
        p.translate(15.0, 0.0, -8.0)
        p.rotate_z(a)
        m.merge(p)
    m.merge(mk.lathe([(24.0, 22.0), (24.0, 26.0), (14.0, 34.0), (5.0, 38.0)],
                     seg=12))
    m.merge(mk.lathe([(0.0, 38.0), (5.0, 40.0), (3.0, 44.0), (0.0, 50.0)], seg=8))
    return m


@asset("hd_urn", tier="B", material="porcelain",
       note="A garden urn: foot, swelling body, everted rim, handles.")
def hd_urn():
    m = mk.lathe([(0.0, -50.0), (20.0, -50.0), (21.0, -44.0), (14.0, -38.0),
                  (17.0, -32.0), (30.0, -16.0), (37.0, 4.0), (33.0, 24.0),
                  (28.0, 34.0), (36.0, 42.0), (40.0, 48.0), (36.0, 50.0),
                  (31.0, 44.0), (25.0, 34.0), (0.0, 30.0)], seg=22)
    for s in (-1, 1):
        h = mk.torus(13.0, 3.4, major=14, minor=6, arc=210.0)
        h.rotate_x(90.0)
        h.rotate_z(90.0 if s > 0 else -90.0)
        h.translate(s * 36.0, 0.0, 30.0)
        m.merge(h)
    return m


@asset("hd_bench", tier="B", material="stone",
       note="A garden bench with turned legs and a shaped back.")
def hd_bench():
    m = mk.Mesh()
    m.merge(mk.chamfer_box(100.0, 34.0, 7.0, c=1.8).translate(0, 0, 0.0))
    for s in (-1, 1):
        for t in (-1, 1):
            leg = mk.lathe([(0, -46), (8, -46), (8, -40), (5, -34), (7, -22),
                            (5, -10), (7, -4), (7, 0), (0, 0)], seg=10)
            leg.translate(s * 40.0, t * 12.0, -4.0)
            m.merge(leg)
    for k in range(5):
        m.merge(mk.box(6.0, 4.0, 34.0).translate(-36.0 + 18.0 * k, -15.0, 20.0))
    m.merge(mk.chamfer_box(100.0, 6.0, 9.0, c=2.0).translate(0, -15.0, 40.0))
    return m


@asset("hd_card", tier="B", material="card_white",
       note="A playing-card sign with a rounded edge and a raised pip.")
def hd_card():
    poly = []
    W, H, r = 34.0, 50.0, 7.0
    for (cx, cy, a0) in ((W - r, H - r, 0.0), (-(W - r), H - r, 90.0),
                         (-(W - r), -(H - r), 180.0), (W - r, -(H - r), 270.0)):
        for i in range(5):
            a = math.radians(a0 + 22.5 * i)
            poly.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    m = mk.plate(poly, 4.0)
    heart = []
    for i in range(24):
        t = 2.0 * math.pi * i / 24
        x = 16.0 * math.sin(t) ** 3
        y = (13.0 * math.cos(t) - 5.0 * math.cos(2 * t)
             - 2.0 * math.cos(3 * t) - math.cos(4 * t))
        heart.append((x * 0.85, y * 0.85))
    hp = mk.plate(heart, 1.6)
    hp.translate(0.0, 0.0, 2.6)
    m.merge(hp)
    return m


# ==========================================================================
# THE TWO TABLES EVERY OTHER LAYER READS
# ==========================================================================

#: What primitive an HD key falls back to if its asset did not build.
#:
#: Every HD key is registered in PLACEHOLDER_MESH against its fallback BEFORE
#: the editor is asked to build anything, so a key always resolves to some
#: mesh. If the bridge fails, the world comes back looking exactly like the one
#: the founder rejected — which is a legible failure that the HD_MESHES log
#: line explains — instead of coming back empty, or coming back as thousands of
#: "No placeholder mesh for 'hd_roof'" warnings and a field of default cubes.
FALLBACK = {
    "hd_roof": "cone", "hd_roof_hero": "cone", "hd_roof_far": "cone",
    "hd_roof_bell": "cone", "hd_mush_cap": "cone", "hd_mush_cap_far": "cone",
    "hd_mush_house_cap": "cone", "hd_spear_finial": "cone",
    "hd_tower": "cylinder", "hd_tower_far": "cylinder", "hd_dome": "sphere",
    "hd_baluster": "cylinder", "hd_column": "cylinder", "hd_finial": "cylinder",
    "hd_balcony": "cylinder", "hd_trunk": "cylinder", "hd_trunk_giant": "cylinder",
    "hd_branch": "cylinder", "hd_mush_stem": "cylinder", "hd_vine": "cylinder",
    "hd_gate_bar": "cylinder", "hd_lantern": "cylinder", "hd_urn": "cylinder",
    "hd_teacup": "cylinder", "hd_saucer": "cylinder", "hd_clock": "cylinder",
    "hd_grass_tuft": "cylinder", "hd_key": "cylinder", "hd_leaf_spray": "cylinder",
    "hd_canopy": "sphere", "hd_canopy_far": "sphere", "hd_shrub": "sphere",
    "hd_bloom_cluster": "sphere", "hd_rose": "sphere", "hd_teapot": "sphere",
    "hd_mush_spot": "sphere",
    "hd_wall": "cube", "hd_wall_window": "cube", "hd_cornice": "cube",
    "hd_merlon": "cube", "hd_corbel": "cube", "hd_arch": "cube",
    "hd_stairs": "cube", "hd_bridge": "cube", "hd_kerb": "cube",
    "hd_flagstone": "cube", "hd_cobble_patch": "cube", "hd_bench": "cube",
    "hd_gate_pillar": "cube", "hd_gate_leaf": "cube", "hd_scroll": "cube",
    "hd_heart_motif": "cube", "hd_topiary_heart": "cube",
    "hd_floral_arch": "cube", "hd_flower": "plane", "hd_leaf": "plane",
    "hd_card": "cube", "hd_clock_hand": "cube",
}

#: How the OFFLINE tracer should fill an HD key's projected box.
#:
#: verify-hero-composition.py has no geometry — it fills the projected bounding
#: box of every piece with a mask chosen by testing the mesh key against two
#: tuples, and anything unrecognised fills the WHOLE RECTANGLE. So an untaught
#: HD key would draw a solid block where a rose is, and the offline preview —
#: the only free look this project gets at composition — would quietly become
#: wrong in exactly the places this rebuild changed.
#:
#: 'round' = inscribed ellipse, 'cone' = triangle from the top, 'box' = full
#: rectangle. It is a silhouette approximation and nothing more; the tracer
#: says so about the primitives too.
SILHOUETTE = {}
for _n, _f in FALLBACK.items():
    SILHOUETTE[_n] = {"sphere": "round", "cylinder": "round", "cone": "cone",
                      "plane": "box", "cube": "box"}[_f]
# Hand corrections where the fallback primitive and the real silhouette differ.
SILHOUETTE.update({
    "hd_flagstone": "round",       # irregular heptagon, not a rectangle
    "hd_cobble_patch": "box",
    "hd_topiary_heart": "ring",    # a wreath: open in the middle
    "hd_heart_motif": "ring",
    "hd_floral_arch": "arch",      # a hoop: the tracer cuts the opening out
    "hd_canopy": "round", "hd_canopy_far": "round", "hd_shrub": "round",
    "hd_trunk_giant": "round", "hd_trunk": "round",
    "hd_gate_leaf": "box", "hd_gate_pillar": "box",
    "hd_stairs": "box", "hd_wall": "box",
})

assert set(FALLBACK) == set(ASSETS), (
    "FALLBACK and ASSETS disagree: %r" % (set(FALLBACK) ^ set(ASSETS)))
assert set(SILHOUETTE) == set(ASSETS)
