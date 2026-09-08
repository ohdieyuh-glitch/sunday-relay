"""Awnings, stalls, canopies, signs: the layer that says a street is INHABITED.

THE GAP. `roofscape.py` gave Wonderland small buildings and `WL_House_Shopfront`
gave one of them a ground floor worth looking at. What no module in this kit
provides is the stuff IN FRONT of a building -- and that layer is the whole
difference between an architectural model and a place people live.

WHAT THIS FAMILY IS NOT. It is not clutter. The brief for it was explicit and
it is the right brief: crates, barrels and baskets scattered at 40 cm do
nothing for a silhouette, cost draw calls, and are invisible past 30 m. Every
module here is chosen because it changes the STREET'S OUTLINE at a distance a
camera actually stands:

  * an awning breaks the vertical face of a building with a horizontal, which
    is the single strongest "inhabited" signal there is
  * a canopy on posts puts a roof over ground that had none, so the street
    reads as rooms rather than as a corridor
  * a hanging sign projects INTO the street, so the row of facades stops being
    a flat plane
  * a covered passage darkens a gap between two buildings, which is what makes
    a street look like it has depth behind it

THE SHARED NUMBERS. Everything keys to `roofscape`:

    BAY_X   6.40 m   the house plan, so an awning spans exactly one house
    STOREY  3.05 m   so a canopy tucks under a first floor and a sign hangs
                     clear of a doorway
    2.10 m           head height under every canopy in the family -- a Relay
                     Dog is small, but a camera walks at human eye level and a
                     canopy it ducks under reads as a mistake

MATERIALS. Fabric is `roof` / `roof_alt` (`MI_V2_RoofRose` / `MI_V2_RoofLilac`)
rather than a new slot: the striped awnings in the reference are exactly the
rose and lilac of its roofs, and the kit gains nothing from an eleventh
material the world session would have to author.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

BAY_X, BAY_Y = 6.40, 5.20          # == roofscape's house plan
STOREY = 3.05
HEAD = 2.10                        # clear height under every canopy here


def _post(part, at, height, radius=0.11, gold=None, base=True):
    """A slender turned post: a plinth, and ONE closed lathe for the shaft.

    Authored as a single closed section in the post's own space. The first
    version stacked three profiles, two of them in absolute z and one in local
    z, built the shaft twice and left the second build behind an `if False` --
    which is the shape a mistake takes when a helper is written before anything
    calls it. One section, one convention, one solid.
    """
    x, y, z = at
    made = []
    if base:
        made += part.box(radius * 3.4, radius * 3.4, 0.18, at=(x, y, z),
                         chamfer=0.03, centre_z=False)
        z += 0.18
    mat = M.xform((x, y, z))
    made += part.lathe(
        [(0.0, 0.0), (radius * 1.5, 0.0), (radius * 1.5, 0.10),
         (radius, 0.22), (radius * 0.94, height * 0.62),
         (radius, height - 0.26), (radius * 1.34, height - 0.13),
         (radius * 1.34, height), (0.0, height)],
        segments=10, smooth=False, matrix=mat)
    if gold is not None:
        gold.lathe([(0.0, 0.0), (radius * 1.22, 0.0), (radius * 1.22, 0.08),
                    (0.0, 0.08)], segments=10, smooth=False,
                   matrix=mat @ M.xform((0.0, 0.0, height * 0.58)))
    return made


def market_awning(f):
    """A striped awning over one house bay: 6.4 m wide, 2.3 m of reach.

    THE HIGHEST-VALUE MODULE IN THIS FAMILY and the simplest. It spans exactly
    one `roofscape` bay, so it clips to any house body's +Y face, and it turns
    a flat facade into a facade with a shadow under it. Sloped rather than
    flat, because a flat awning reads as a shelf and a raked one reads as
    fabric.
    """
    p = f.part("stone")
    r = f.part("roof")
    ra = f.part("roof_alt")
    m = f.part("metal")
    W, REACH = BAY_X, 2.30
    Z0 = 2.55
    # the fabric: alternating rose and lilac panels, raked 14 degrees
    N = 8
    for i in range(N):
        x0 = -W * 0.5 + W * i / N
        x1 = -W * 0.5 + W * (i + 1) / N
        part = r if i % 2 == 0 else ra
        part.loft([[(x0, 0.0, Z0), (x1, 0.0, Z0),
                    (x1, REACH, Z0 - 0.56), (x0, REACH, Z0 - 0.56)],
                   [(x0, 0.0, Z0 + 0.06), (x1, 0.0, Z0 + 0.06),
                    (x1, REACH, Z0 - 0.50), (x0, REACH, Z0 - 0.50)]], smooth=False)
    # the scalloped valance: the detail that makes fabric read as fabric
    for i in range(N * 2):
        x = -W * 0.5 + W * (i + 0.5) / (N * 2)
        part = r if (i // 2) % 2 == 0 else ra
        part.lathe([(0.0, 0.0), (W / (N * 4.0), 0.0), (W / (N * 4.4), -0.16),
                    (0.0, -0.26)], segments=8, arc=180.0,
                   matrix=M.xform((x, REACH, Z0 - 0.50), (90.0, 0.0, 0.0)),
                   smooth=True)
    # the frame: a bar at the wall and two raking arms
    m.sweep([(-W * 0.5, 0.02, Z0 + 0.04), (W * 0.5, 0.02, Z0 + 0.04)],
            [0.045] * 2, sides=6)
    m.sweep([(-W * 0.5 + 0.10, REACH, Z0 - 0.53), (W * 0.5 - 0.10, REACH, Z0 - 0.53)],
            [0.038] * 2, sides=6)
    for sgn in (-1.0, 1.0):
        x = sgn * (W * 0.5 - 0.14)
        m.sweep([(x, 0.02, Z0 + 0.04), (x, REACH, Z0 - 0.53)], [0.032] * 2, sides=5)
        m.sweep([(x, 0.02, Z0 - 0.60), (x, REACH * 0.62, Z0 - 0.30)],
                [0.026] * 2, sides=4)
        p.box(0.26, 0.16, 0.26, at=(x, 0.06, Z0 - 0.10), chamfer=0.03, centre_z=False)
    return K.ModuleSpec(
        "WL_Market_Awning", "market", "prop", "detail",
        f.emit("WL_Market_Awning"),
        [K.Socket("back", 0.0, W * 0.5, "bridge_end",
                  "flat back at y = 0; clips to any roofscape house's +Y face"),
         K.Socket("edge", Z0 - 0.50, W * 0.5, "edge", "the valance line at 2.05 m")],
        districts=("hamlet", "city", "tea_terrace", "plaza"),
        note="6.40 m striped awning over one house bay, 2.30 m reach, raked 14 "
             "degrees with a scalloped valance; rose and lilac alternating",
        params={"width_m": W, "reach_m": REACH, "panels": N,
                "spans": "exactly one roofscape bay",
                "fabric": "MI_V2_RoofRose / MI_V2_RoofLilac"},
        tri_budget=9000, mounts="facade")


def market_canopy(f):
    """A free-standing four-post canopy, 5.2 x 4.0 m, 3.5 m tall.

    A roof over ground that had none. This is the module that turns an open
    plaza into a market: put five of them in a loose row and the space between
    them becomes an aisle, which no amount of ground texture achieves.

    Deliberately OPEN on all four sides. A closed stall is a small building and
    `roofscape` already has those; what a market needs is a roof you can see
    under and through, so the crowd and the buildings behind stay visible.
    """
    p = f.part("stone")
    r = f.part("roof_alt")
    ra = f.part("roof")
    m = f.part("metal")
    g = f.part("gold")
    W, D = 5.20, 4.00
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            _post(p, (sx * (W * 0.5 - 0.24), sy * (D * 0.5 - 0.24), 0.0),
                  HEAD + 0.55, radius=0.13)
    Z = HEAD + 0.73
    for sgn in (-1.0, 1.0):
        m.sweep([(-W * 0.5 + 0.24, sgn * (D * 0.5 - 0.24), Z),
                 (W * 0.5 - 0.24, sgn * (D * 0.5 - 0.24), Z)], [0.05] * 2, sides=6)
        m.sweep([(sgn * (W * 0.5 - 0.24), -D * 0.5 + 0.24, Z),
                 (sgn * (W * 0.5 - 0.24), D * 0.5 - 0.24, Z)], [0.05] * 2, sides=6)
    # a shallow hipped fabric roof on the same helper the houses use
    E.roof_ridged(r, W, D, 1.05, at=(0.0, 0.0, Z + 0.05), overhang=0.46,
                  ridge_frac=0.36)
    for i in range(6):
        t = (i + 0.5) / 6.0
        x = -W * 0.5 - 0.46 + (W + 0.92) * t
        ra.box((W + 0.92) / 12.0, D + 0.92, 0.03, at=(x, 0.0, Z + 0.06),
               centre_z=False)
    E.finial(p, (0.0, 0.0, Z + 1.05), 0.62, radius=0.11, gold=g)
    # the counter: one waist-high plane, which is what makes it a STALL
    p.box(W - 0.90, 0.62, 0.10, at=(0.0, -(D * 0.5 - 0.55), 0.92),
          chamfer=0.02, centre_z=False)
    for sgn in (-1.0, 1.0):
        p.box(0.20, 0.52, 0.92, at=(sgn * (W * 0.5 - 0.80), -(D * 0.5 - 0.55), 0.0),
              chamfer=0.03, centre_z=False)
    return K.ModuleSpec(
        "WL_Market_Canopy", "market", "structure", "detail",
        f.emit("WL_Market_Canopy"),
        [K.Socket("bottom", 0.0, W * 0.5, "ground"),
         # `passage` AT THE GROUND, not `shelter` at head height. A `route`
         # socket says "you can walk here"; 2.10 m was the CLEARANCE, and
         # publishing it as a route made the canopy claim a walkable level two
         # metres up that no flight in the kit could reach.
         K.Socket("passage", 0.0, W * 0.5, "route",
                  "the ground under the canopy stays walkable; %.2f m clear "
                  "to the beams" % HEAD),
         K.Socket("counter", 1.02, W * 0.5, "edge", "the stall counter at 1.02 m")],
        districts=("hamlet", "plaza", "city", "tea_terrace"),
        note="5.20 x 4.00 m open four-post canopy with a striped hipped roof "
             "and a counter; open on all four sides so the street stays visible",
        params={"plan_m": [W, D], "clear_height_m": HEAD, "posts": 4,
                "open": "all four sides"},
        tri_budget=14000, collision=True)


def market_arcade_insert(f):
    """A covered walk in front of one house bay: 6.4 m of colonnade, 3.3 m deep.

    The heavier cousin of the awning, and the one that changes a street's PLAN
    rather than its face. A row of these gives a street a continuous shaded
    walk -- the reference's middle distance has exactly this, and it is why
    its buildings read as a terrace rather than as separate objects.

    ITS ELEVATIONS ARE ON THE RISER, and they were not. The walk was 0.30 m --
    0.97 of this kit's riser -- and the deck 3.37, which is 9.9 risers above
    it, so a flight to either arrived one to three centimetres short. Both are
    now whole risers off the ground datum, which is what a `route` socket
    promises.

    ITS BACK IS AT y = 0, and it was not that either: the plinth was centred on
    D/2 with an extra 0.30 of width, so 0.175 m of it stood BEHIND the mounting
    plane and inside the house it clips to.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    W, D = BAY_X, 3.30
    BAYS = 3
    WALK = K.RISER_M                                  # one riser, not 0.30
    DECK = WALK + K.RISER_M * 10.0                    # eleven risers off grade
    p.box(W + 0.40, D + 0.30, WALK, at=(0.0, (D + 0.30) * 0.5, 0.0),
          chamfer=0.06, centre_z=False)
    for i in range(BAYS + 1):
        x = -W * 0.5 + W * i / BAYS
        E.column(p, (x, D - 0.60, WALK), 2.35, 0.24, flutes=8)
    for i in range(BAYS):
        x = -W * 0.5 + W * (i + 0.5) / BAYS
        span = W / BAYS - 0.52
        E.arch_band(p, span, span * 0.42, 1.10, 0.28,
                    at=(x, D - 0.60, 2.65), kind="ogee", steps=11, keystone=True)
        # the wall's ring is thinner than the band's, so the band reads as a
        # proud arch ring AND the wall stays wider than its own extrados
        # 0.48, not 0.72: at 0.72 the two haunches topped out level with the
        # deck slab's TOP rather than dying into its soffit
        # THE BAY WALLS OVERLAP, THEY DO NOT BUTT. At exactly W/(BAYS*2) two
        # neighbouring haunches met face to face; `Part._append` drops the
        # second of two identical faces as "a duplicate at a shared seam", so
        # the union kept ONE interior face instead of two, and the resulting
        # shell enclosed negative volume. Interpenetrating solids are this
        # kit's idiom everywhere else and have no such seam.
        E.arched_wall(p, span, span * 0.42, 0.48, W / (BAYS * 2.0) + 0.06, 1.00,
                      kind="ogee", steps=11, thickness=0.24,
                      at=(x, D - 0.60, 2.65))
    p.box(W + 0.30, D + 0.20, 0.24, at=(0.0, (D + 0.20) * 0.5, DECK - 0.24),
          chamfer=0.05, centre_z=False)
    E.wear_course(d, DECK, w=W - 0.30, d=D - 0.70, thickness=0.05,
                  at=(0.0, D * 0.5 - 0.20))
    for i in range(9):
        x = -W * 0.5 + W * i / 8.0
        p.lathe([(0.0, 0.0), (0.075, 0.0), (0.062, 0.20), (0.105, 0.42),
                 (0.058, 0.74), (0.070, 0.94), (0.0, 1.04)], segments=8,
                smooth=True, matrix=M.xform((x, D - 0.30, DECK)))
    p.box(W + 0.20, 0.30, 0.14, at=(0.0, D - 0.30, DECK + 1.04), chamfer=0.03,
          centre_z=False)
    E.wear_course(d, WALK, w=W - 0.20, d=D - 1.10, thickness=0.05,
                  at=(0.0, D * 0.5 - 0.30))
    return K.ModuleSpec(
        "WL_Market_Arcade_Insert", "market", "structure", "screen",
        f.emit("WL_Market_Arcade_Insert"),
        [K.Socket("back", 0.0, W * 0.5, "bridge_end",
                  "flat back at y = 0; clips to a roofscape house's +Y face"),
         K.Socket("walk", WALK, W * 0.5, "route",
                  "covered walk at %.3f m (one riser), 2.65 m clear" % WALK),
         K.Socket("deck_route", DECK, W * 0.5, "route",
                  "the roof is a walkable balcony deck at %.2f m "
                  "(eleven risers)" % DECK),
         K.Socket("end_a", 0.0, D * 0.5, "pier", "butts to the next insert at x = -3.20 m"),
         K.Socket("end_b", 0.0, D * 0.5, "pier", "butts to the next insert at x = +3.20 m")],
        districts=("hamlet", "city", "plaza", "tea_terrace"),
        note="three ogee bays of covered walk over one house bay, with a "
             "balustraded roof deck; butts into a continuous arcade",
        params={"width_m": W, "depth_m": D, "bays": BAYS,
                "walk_z_m": round(WALK, 3), "deck_z_m": round(DECK, 3),
                "spans": "exactly one roofscape bay"},
        tri_budget=22000, collision=True)


def market_hanging_sign(f):
    """A wrought bracket and a hanging sign, projecting 1.5 m into the street.

    The cheapest way to stop a row of facades being a flat plane. It projects,
    it swings out over the walk, and at middle distance a street with six of
    these at different heights reads as commerce where the same street without
    them reads as housing.
    """
    p = f.part("stone")
    m = f.part("metal")
    g = f.part("gold")
    Z = 3.30
    REACH = 1.50
    p.box(0.34, 0.30, 0.46, at=(0.0, 0.10, Z - 0.23), chamfer=0.04, centre_z=False)
    m.sweep([(0.0, 0.16, Z), (REACH * 0.55, 0.16, Z), (REACH, 0.16, Z - 0.06)],
            [0.048, 0.042, 0.036], sides=6)
    # the scroll brace: the kit's own spiral, at bracket scale
    pts = []
    for k in range(13):
        t = k / 12.0
        a = t * 1.35 * math.tau
        rr = 0.34 * (1.0 - 0.60 * t)
        pts.append((0.30 + math.cos(a) * rr, 0.16, Z - 0.44 + math.sin(a) * rr))
    m.sweep(pts, [0.022] * len(pts), sides=4, cap=False)
    m.sweep([(0.06, 0.16, Z - 0.34), (0.62, 0.16, Z - 0.02)], [0.026] * 2, sides=4)
    for x in (REACH - 0.42, REACH - 0.06):
        m.sweep([(x, 0.16, Z - 0.06), (x, 0.16, Z - 0.34)], [0.016] * 2, sides=4)
    # the board itself, with a gold rim
    p.box(0.86, 0.09, 0.74, at=(REACH - 0.24, 0.16, Z - 1.10), chamfer=0.03,
          centre_z=False)
    for (dz, h) in ((0.0, 0.05), (0.69, 0.05)):
        g.box(0.96, 0.13, h, at=(REACH - 0.24, 0.16, Z - 1.10 + dz), chamfer=0.015,
              centre_z=False)
    g.lathe([(0.0, 0.0), (0.11, 0.02), (0.09, 0.10), (0.13, 0.16), (0.0, 0.24)],
            segments=10, smooth=True,
            matrix=M.xform((REACH - 0.24, 0.16, Z - 0.36)))
    return K.ModuleSpec(
        "WL_Market_Hanging_Sign", "market", "prop", "detail",
        f.emit("WL_Market_Hanging_Sign"),
        [K.Socket("back", 0.0, 0.20, "bridge_end",
                  "flat back at y = 0; the bracket plate mounts at z = 3.07-3.53 m"),
         K.Socket("board", Z - 1.10, 0.48, "edge",
                  "the sign board, 0.86 x 0.74 m, at 2.20-2.94 m")],
        districts=("hamlet", "city", "tea_terrace", "plaza"),
        note="wrought bracket with a scrolled brace projecting 1.50 m, "
             "carrying a gold-rimmed board; the module that breaks a flat street",
        params={"reach_m": REACH, "board_m": [0.86, 0.74], "mount_z_m": Z},
        tri_budget=5000, mounts="facade")


def market_covered_passage(f):
    """A vaulted passage between two buildings: 3.2 m wide, 7 m long.

    A street with no gaps in it is a wall with doors. This bridges the space
    between two `roofscape` houses at 5.2 m apart, roofs it, and darkens it --
    which reads at any distance as somewhere the street CONTINUES, and is the
    cheapest depth cue in the family.

    THE VAULT IS ONE `arch_band` RUN THE WHOLE LENGTH, which is what a barrel
    vault is: a voussoir ring with 7 m of depth instead of 0.5 m. The ribs are
    the same band again, spanning 0.16 m LESS, so they stand 0.08 m proud of
    the vault surface instead of lying in it -- two arches on one intrados
    would be the coplanar pair this kit keeps rediscovering.

    The side walls run the full height to the deck. They stopped at the
    springing in the first draft, which left the passage open to the sky
    between its own ribs.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    gl = f.part("glass")
    g = f.part("gold")
    W, LEN = 3.20, 7.00
    SPRING, RISE = 2.80, 1.30
    CROWN = SPRING + RISE
    # THE DECK LANDS ON A RISER. At CROWN + 0.42 it sat at 4.52 m, which is
    # 14.6 risers off the datum; the slab is thickened instead so the roof is a
    # level a flight of this kit's own stairs can arrive at.
    DECK = K.RISER_M * 15.0
    SLAB = DECK - CROWN
    for sgn in (-1.0, 1.0):
        p.box(0.90, LEN, DECK - SLAB, at=(sgn * (W * 0.5 + 0.45), 0.0, 0.0),
              chamfer=0.08, centre_z=False)
    # the vault itself (in the darker part, so the passage reads as shade),
    # then the ribs standing proud of it
    E.arch_band(d, W, RISE, LEN, 0.26, at=(0.0, 0.0, SPRING),
                kind="pointed", steps=13)
    NB = 4
    for i in range(NB + 1):
        y = -LEN * 0.5 + LEN * i / NB
        E.arch_band(p, W - 0.16, RISE - 0.07, 0.52, 0.42, at=(0.0, y, SPRING),
                    kind="pointed", steps=13, keystone=(i in (0, NB)))
    # the deck over it, and a cornice under the deck
    p.box(W + 1.80, LEN + 0.24, SLAB, at=(0.0, 0.0, DECK - SLAB), chamfer=0.05,
          centre_z=False)
    for i in range(3):
        y = -LEN * 0.32 + LEN * 0.32 * i
        gl.lathe([(0.0, 0.0), (0.30, 0.0), (0.30, 0.10), (0.0, 0.10)],
                 segments=12, smooth=False,
                 matrix=M.xform((0.0, y, CROWN - 0.46)))
        g.lathe([(0.0, 0.0), (0.10, 0.02), (0.13, 0.12), (0.07, 0.22), (0.0, 0.26)],
                segments=10, smooth=True,
                matrix=M.xform((0.0, y, CROWN - 0.36)))
        g.sweep([(0.0, y, CROWN - 0.10), (0.0, y, CROWN - 0.36)], [0.018] * 2, sides=4)
    d.box(W, LEN, 0.06, at=(0.0, 0.0, 0.0), centre_z=False)
    return K.ModuleSpec(
        "WL_Market_Covered_Passage", "market", "structure", "threshold",
        f.emit("WL_Market_Covered_Passage"),
        [K.Socket("bottom", 0.0, W * 0.5 + 0.90, "ground"),
         K.Socket("passage", 0.0, W * 0.5, "route",
                  "3.20 m clear, 2.80 m to the springing, %.2f m to the crown" % CROWN),
         K.Socket("end_a", 0.0, W * 0.5 + 0.90, "pier", "butts a house gable at y = -3.50 m"),
         K.Socket("end_b", 0.0, W * 0.5 + 0.90, "pier", "butts a house gable at y = +3.50 m"),
         K.Socket("deck_route", DECK, W * 0.5 + 0.90, "route",
                  "the roof deck at %.2f m" % DECK)],
        districts=("hamlet", "city", "tea_terrace"),
        note="7.00 m pointed barrel vault between two houses, five ribs, three "
             "hanging lanterns; the depth cue that stops a street being a wall",
        params={"width_m": W, "length_m": LEN, "clear_m": CROWN,
                "ribs": NB + 1, "lanterns": 3, "deck_z_m": DECK},
        tri_budget=20000, collision=True)


def market_corner_storefront(f):
    """A chamfered corner shop: 3.4 m arms with a 1.6 m splay across the angle.

    Streets have corners, and a corner is where the eye stops. This is a
    clip-on for the OUTSIDE angle of two `roofscape` houses -- a canted bay
    with a door in it, a striped fascia over, and a lantern -- so a block turns
    a corner with an event instead of with a mitre.

    THE PLAN IS A PENTAGON, and getting that wrong is what a chamfer is easy to
    get wrong. The first version listed `(0,0) (A,0) (A/2,A/2) (0,A)`, which
    cuts the corner INWARD: an arrowhead with a re-entrant notch where the shop
    front should be, and the two windows and the door all landed within 0.37 m
    of each other inside it. A chamfer removes the corner, so the plan is the
    square minus a triangle: five points, and the splay is the new fifth edge.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    gl = f.part("glass")
    r = f.part("roof")
    ra = f.part("roof_alt")
    g = f.part("gold")
    A, C = 3.40, 1.60
    plan = [(0.0, 0.0), (A, 0.0), (A, A - C), (A - C, A), (0.0, A)]
    #: the middle of the splay, and its outward normal at 45 degrees
    sx = sy = A - C * 0.5
    SPLAY = C * math.sqrt(2.0)                       # 2.26 m of shopfront
    p.prism(plan, 0.30, z0=0.0)
    p.prism([(x - 0.06 if x > 0.01 else x, y - 0.06 if y > 0.01 else y)
             for (x, y) in plan], 2.86, z0=0.30)

    # the shopfront, all of it on the splay: glazing, a door, a stall riser
    gl.box(SPLAY - 0.42, 0.10, 1.70, at=(sx + 0.05, sy + 0.05, 0.86),
           rot=(0.0, 0.0, 135.0), centre_z=False)
    d.box(SPLAY - 0.30, 0.16, 0.56, at=(sx + 0.02, sy + 0.02, 0.30),
          rot=(0.0, 0.0, 135.0), chamfer=0.03, centre_z=False)
    # 2.12, so the door head sits BELOW the glazing head rather than level
    # with it -- two same-facing tops in one plane render black
    d.box(0.96, 0.18, 2.12, at=(sx + 0.03, sy + 0.03, 0.30),
          rot=(0.0, 0.0, 135.0), chamfer=0.03, centre_z=False)
    for t in (-1.0, 1.0):
        # the two mullions, out along the splay from its middle
        mx = sx + t * (SPLAY * 0.5 - 0.16) * math.cos(math.radians(135.0))
        my = sy + t * (SPLAY * 0.5 - 0.16) * math.sin(math.radians(135.0))
        p.box(0.20, 0.24, 2.56, at=(mx, my, 0.30), rot=(0.0, 0.0, 135.0),
              chamfer=0.03, centre_z=False)

    # the fascia: a striped valance across the splay, then the cornice
    for i in range(5):
        t = (i + 0.5) / 5.0 - 0.5
        fx = sx + 0.12 + t * SPLAY * math.cos(math.radians(135.0))
        fy = sy + 0.12 + t * SPLAY * math.sin(math.radians(135.0))
        (r if i % 2 == 0 else ra).box(SPLAY / 5.0, 0.12, 0.44,
                                      at=(fx, fy, 2.60), rot=(0.0, 0.0, 135.0),
                                      chamfer=0.02, centre_z=False)
    p.prism([(x + 0.10 if x > 0.01 else x - 0.10,
              y + 0.10 if y > 0.01 else y - 0.10) for (x, y) in plan],
            0.22, z0=3.16)
    E.roof_ridged(r, A * 1.05, A * 1.05, 1.05, at=(A * 0.5, A * 0.5, 3.38),
                  rot=(0.0, 0.0, 45.0), overhang=0.26, ridge_frac=0.30)

    # the lantern on the splay, on its own little bracket
    g.sweep([(sx, sy, 2.52), (sx + 0.30, sy + 0.30, 2.52),
             (sx + 0.42, sy + 0.42, 2.42)], [0.035, 0.030, 0.026], sides=5)
    gl.lathe([(0.0, 0.0), (0.17, 0.06), (0.17, 0.36), (0.0, 0.44)], segments=8,
             smooth=False, matrix=M.xform((sx + 0.42, sy + 0.42, 1.98)))
    g.lathe([(0.0, 0.0), (0.11, 0.03), (0.14, 0.13), (0.08, 0.24), (0.0, 0.30)],
            segments=10, smooth=True,
            matrix=M.xform((sx + 0.42, sy + 0.42, 2.42)))
    return K.ModuleSpec(
        "WL_Market_Corner_Storefront", "market", "structure", "detail",
        f.emit("WL_Market_Corner_Storefront"),
        [K.Socket("bottom", 0.0, A * 0.75, "ground"),
         K.Socket("back_a", 0.0, A * 0.5, "bridge_end",
                  "flat back on the -Y face; butts a house's gable"),
         K.Socket("back_b", 0.0, A * 0.5, "bridge_end",
                  "flat back on the -X face; butts the perpendicular house"),
         K.Socket("shopfront", 0.30, SPLAY * 0.5, "edge",
                  "%.2f m of glazed splay across the cut corner" % SPLAY)],
        districts=("hamlet", "city", "plaza", "tea_terrace"),
        note="%.2f m corner shop whose corner is chamfered %.2f m into a "
             "%.2f m glazed splay, with a striped fascia and a lantern"
             % (A, C, SPLAY),
        params={"splay_deg": 45.0, "arm_m": A, "chamfer_m": C,
                "shopfront_m": round(SPLAY, 3),
                "clips_to": "two roofscape houses at an outside angle"},
        tri_budget=12000, collision=True)


BUILDERS = (
    market_awning, market_canopy, market_arcade_insert,
    market_hanging_sign, market_covered_passage, market_corner_storefront,
)
