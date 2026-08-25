"""THE GOLDEN ARRIVAL DISTRICT, AUTHORED FROM THE REFERENCE — a fresh start.

The first HD pass kept the old layout and swapped better meshes into it, and
the founder said "I thought I told you to start over." He was right: Phase R
says *do not recreate the old layout because it exists*, and the offline
trace still showed the old generator's scatter — ornament pockets, colonies,
lamp arcs, hedges — wearing new geometry.

So this module IS the district. It places every visible thing in the arrival
frame deliberately, band by band, from `marble/reference/wonderland-reference-hd.png`:

    0-15 m    FOREGROUND     giant trunk right edge (clocks on the bole, vines,
                             leaves overhead), tall mushroom left edge, banks
                             of large pink/violet flowers in both bottom corners,
                             petals and moss on the stone
    15-50 m   COURTYARD      the flagstone plaza and arcane circle (kept), the
                             golden gate LEFT on ivory piers with ivy and a low
                             wall, the giant teacup / saucer / teapot RIGHT on
                             stone plinths, a small purple mushroom, urns,
                             hedges edging the court
    50-120 m  GARDEN         the path continues to the floral arch on the axis,
                             hedges and flower verges either side, the heart
                             wreath RIGHT, the clock tower behind it, two giant
                             red mushrooms left-mid and right-mid, mushroom
                             houses, a broad staircase with balusters up to a
                             columned portal
    120 m+    PALACE/SKYLINE the existing castle city (kept: it is Tier C and
                             already wears the HD roofs and towers)

Inside the district (y -1500..9000, |x| < 7000) the generator DROPS every
placement that is not this module's, the plaza/circle, the ground, the sky, or
the hero mushroom kit — at `static_mesh`, the one choke point all geometry
passes through — and logs what it dropped. Nothing old is edited into shape;
it is simply not there. `WONDERLAND_LOOK=arrivalReset=0` brings it all back.

Landmarks the layout declares (gate, framing tree, heart, arch, teacups,
clock tower, the red and purple mushrooms) are placed HERE at the positions
`landmark_xy()` gives — the layout stays the authority on where the big
things stand, this module is the authority on what they are made of. Their
pieces are labelled `<landmark>_HDAR_<part>` so verify-landmark-scale still
measures them; everything else is `HDAR_<band>_<thing>`.

Screen handedness: the camera at (0, -1150) looks along +Y, so screen-RIGHT
is -X. Every "left"/"right" below is the screen's.
"""

import math

try:
    from . import meshkit as mk
    from . import layout_tools as lt
except ImportError:
    import meshkit as mk
    import layout_tools as lt


def _h(*k):
    return mk.rnd(*k)


def build_district(ctx):
    """ctx: part(mesh, x, y, z, sx, sy, sz, mat, label, rot=(p,y,r)),
    landmark_xy(id, fallback) -> (x, y), hd_ok(key), has_mat(name),
    near_y (where the frame's bottom ray meets the ground), hero_dog (x, y),
    log(msg). Returns {band: count}."""
    P = ctx["part"]
    L = ctx["landmark_xy"]
    ok = ctx["hd_ok"]
    has = ctx["has_mat"]
    NEAR = float(ctx["near_y"])
    log = ctx["log"]
    counts = {"foreground": 0, "courtyard": 0, "garden": 0, "path": 0}

    def m(name, fallback):
        return name if has(name) else fallback

    IVORY, STONE, GOLD = m("ivory", "porcelain"), "stone", "gold"
    FOL, FOL_HI, FOL_DEEP = "foliage", "foliage_hi", "foliage_deep"
    ROSE, ROSE_PINK, PETAL_P, PETAL_V = "rose", "rose_pink", "petal_pink", "petal_violet"
    BARK, PORC = m("bark", "trunk"), "porcelain"
    MUSH_RED, MUSH_STEM, MUSH_SPOT = "mush_red", m("mush_stem", "mush_white"), m("mush_spot", "mush_white")
    MUSH_PURPLE = m("mush_purple", "mush_red")
    COB_HERO = m("cobble_hero", "cobble")

    def piece(band, mesh, x, y, z, sx, sy, sz, mat, label, rot=(0.0, 0.0, 0.0)):
        P(mesh, x, y, z, sx, sy, sz, mat, label, rot)
        counts[band] += 1

    # ======================================================================
    # FOREGROUND  (0-15 m)
    # ======================================================================

    # ---- the giant trunk, right edge ---------------------------------------
    tx, ty = L("framing_tree", (700.0, -200.0))
    lm = "framing_tree_HDAR_"
    piece("foreground", "hd_trunk_giant", tx, ty, 850.0, 2.9, 2.9, 17.0, BARK, lm + "trunk")
    for i, (bx, by, bz, yaw, pitch) in enumerate(((160.0, 40.0, 1180.0, 20.0, -30.0),
                                                   (-40.0, -120.0, 1380.0, 250.0, -40.0),
                                                   (120.0, 150.0, 1520.0, 110.0, -20.0))):
        piece("foreground", "hd_branch", tx + bx, ty + by, bz, 4.2, 4.2, 6.5, BARK,
              lm + "bough%d" % i, rot=(pitch, yaw, 0.0))
    # two clocks set into the bole, facing the camera (-Y), the reference's own detail
    piece("foreground", "hd_clock", tx + 70.0, ty - 168.0, 640.0, 2.1, 0.22, 2.1, GOLD, lm + "clockA")
    piece("foreground", "hd_clock_hand", tx + 70.0, ty - 182.0, 674.0, 0.14, 0.05, 0.72, "dog_visor", lm + "clockAmin")
    piece("foreground", "hd_clock_hand", tx + 96.0, ty - 182.0, 640.0, 0.14, 0.05, 0.52, "dog_visor", lm + "clockAhr", rot=(90.0, 0.0, 0.0))
    piece("foreground", "hd_clock", tx + 40.0, ty - 150.0, 1010.0, 1.3, 0.2, 1.3, GOLD, lm + "clockB")
    piece("foreground", "hd_clock_hand", tx + 40.0, ty - 162.0, 1032.0, 0.1, 0.05, 0.46, "dog_visor", lm + "clockBmin")
    for i in range(6):
        a = -0.4 + 0.5 * i
        piece("foreground", "hd_vine", tx + math.cos(a) * 150.0, ty + math.sin(a) * 150.0 - 40.0,
              1100.0 - 60.0 * (i % 3), 1.2, 1.2, 4.6 + 0.8 * (i % 2), FOL, lm + "vine%d" % i,
              rot=(0.0, 60.0 * i, 0.0))
    for i, (cx, cy, cz, s) in enumerate(((0.0, 60.0, 1720.0, 7.5), (380.0, 260.0, 1420.0, 5.2),
                                         (-260.0, 300.0, 1600.0, 5.6), (200.0, -120.0, 1580.0, 4.6))):
        piece("foreground", "hd_canopy", tx + cx, ty + cy, cz, s, s, s * 0.82,
              (FOL, FOL_HI, FOL, FOL_DEEP)[i], lm + "canopy%d" % i, rot=(0.0, 70.0 * i, 0.0))
    for i in range(5):
        piece("foreground", "hd_leaf_spray", tx + 300.0 + 90.0 * i, ty + 120.0 + 40.0 * (i % 2),
              1250.0 - 60.0 * i, 1.6, 1.6, 2.2, (FOL_HI, FOL)[i % 2], lm + "spray%d" % i,
              rot=(-70.0 + 12.0 * i, 40.0 * i, 0.0))

    # ---- flower banks in both bottom corners -------------------------------
    def bank(cx, cy, seed, n_rose=7, n_flower=6, n_cluster=4):
        # DARK FOLIAGE FIRST, blooms on top. The first trace drew the banks
        # as heaps of beach balls: roses at 90-160 uu with nothing under
        # them. The reference's corners are big pink flowers over a DARK mass
        # of leaves, and the mass is most of the area.
        for i in range(6):
            r = 60.0 + 300.0 * _h(seed, i, 21)
            a = 2.0 * math.pi * _h(seed, i, 22)
            s = 1.6 + 1.2 * _h(seed, i, 23)
            piece("foreground", "hd_shrub", cx + math.cos(a) * r, cy + math.sin(a) * r * 0.7,
                  40.0 * s * 0.5, s, s, s * 0.7, (FOL_DEEP, FOL, FOL_DEEP)[i % 3],
                  "HDAR_fg_leafmass%d_%d" % (seed, i), rot=(0.0, 360.0 * _h(seed, i, 24), 0.0))
        for i in range(n_rose):
            r = 90.0 + 320.0 * _h(seed, i, 1)
            a = 2.0 * math.pi * _h(seed, i, 2)
            s = 0.55 + 0.45 * _h(seed, i, 3)
            piece("foreground", "hd_rose", cx + math.cos(a) * r, cy + math.sin(a) * r * 0.7,
                  20.0 + 26.0 * s, s, s, s * 0.8, (ROSE_PINK, PETAL_V, ROSE, ROSE_PINK)[i % 4],
                  "HDAR_fg_rose%d_%d" % (seed, i), rot=(-20.0 + 40.0 * _h(seed, i, 4), 360.0 * _h(seed, i, 5), 0.0))
        for i in range(n_flower):
            r = 60.0 + 360.0 * _h(seed, i, 6)
            a = 2.0 * math.pi * _h(seed, i, 7)
            s = 0.45 + 0.35 * _h(seed, i, 8)
            piece("foreground", "hd_flower", cx + math.cos(a) * r, cy + math.sin(a) * r * 0.7,
                  14.0 + 20.0 * s, s, s, s * 0.5, (PETAL_P, PETAL_V)[i % 2],
                  "HDAR_fg_flower%d_%d" % (seed, i), rot=(-30.0 + 60.0 * _h(seed, i, 9), 360.0 * _h(seed, i, 10), 0.0))
        for i in range(n_cluster):
            r = 120.0 + 300.0 * _h(seed, i, 11)
            a = 2.0 * math.pi * _h(seed, i, 12)
            s = 0.8 + 0.5 * _h(seed, i, 13)
            piece("foreground", "hd_bloom_cluster", cx + math.cos(a) * r, cy + math.sin(a) * r * 0.7,
                  22.0, s, s, s * 0.7, (ROSE_PINK, PETAL_V)[i % 2], "HDAR_fg_bloom%d_%d" % (seed, i),
                  rot=(0.0, 360.0 * _h(seed, i, 14), 0.0))
        for i in range(5):
            r = 80.0 + 340.0 * _h(seed, i, 15)
            a = 2.0 * math.pi * _h(seed, i, 16)
            piece("foreground", "hd_grass_tuft", cx + math.cos(a) * r, cy + math.sin(a) * r * 0.7,
                  30.0, 1.0, 1.0, 0.8, FOL, "HDAR_fg_grass%d_%d" % (seed, i), rot=(0.0, 360.0 * _h(seed, i, 17), 0.0))
        for i in range(4):
            r = 100.0 + 300.0 * _h(seed, i, 18)
            a = 2.0 * math.pi * _h(seed, i, 19)
            piece("foreground", "hd_leaf_spray", cx + math.cos(a) * r, cy + math.sin(a) * r * 0.7,
                  40.0, 1.3, 1.3, 1.2, FOL_HI, "HDAR_fg_spray%d_%d" % (seed, i),
                  rot=(-30.0, 360.0 * _h(seed, i, 20), 0.0))
    bank(820.0, NEAR + 240.0, 1)
    bank(-780.0, NEAR + 400.0, 2, n_rose=5, n_flower=5, n_cluster=3)
    bank(1250.0, NEAR + 700.0, 3, n_rose=4, n_flower=4, n_cluster=2)
    bank(-1200.0, NEAR + 820.0, 4, n_rose=4, n_flower=4, n_cluster=2)

    # ---- petals and moss on the stone ----------------------------------------
    hero = ctx["hero_dog"]
    for i in range(48):
        x = -950.0 + 1900.0 * _h(5, i, 1)
        y = NEAR + 60.0 + 1500.0 * _h(5, i, 2)
        if math.hypot(x - hero[0], y - hero[1]) < 420.0:
            continue
        piece("foreground", "hd_flower", x, y, 10.6, 0.13, 0.13, 0.05,
              (PETAL_P, PETAL_V, ROSE_PINK)[i % 3], "HDAR_petal%d" % i, rot=(0.0, 360.0 * _h(5, i, 3), 0.0))
    for i in range(34):
        x = -1000.0 + 2000.0 * _h(6, i, 1)
        y = NEAR + 40.0 + 1700.0 * _h(6, i, 2)
        if math.hypot(x - hero[0], y - hero[1]) < 380.0:
            continue
        piece("foreground", "hd_grass_tuft", x, y, 9.5, 0.28, 0.28, 0.08, "moss",
              "HDAR_moss%d" % i, rot=(0.0, 360.0 * _h(6, i, 3), 0.0))

    # ======================================================================
    # COURTYARD  (15-50 m)
    # ======================================================================

    # ---- the golden gate, left ----------------------------------------------
    gx, gy = L("golden_gate", (880.0, 1180.0))
    gm = "golden_gate_HDAR_"
    for s in (-1, 1):
        px = gx + s * 330.0
        piece("courtyard", "hd_gate_pillar", px, gy, 320.0, 1.3, 1.3, 6.4, IVORY, gm + "pier%d" % s)
        for i in range(4):
            a = 0.8 + 1.57 * i
            piece("courtyard", "hd_vine", px + math.cos(a) * 62.0, gy + math.sin(a) * 62.0, 420.0,
                  1.1, 1.1, 3.8, FOL, gm + "ivy%d_%d" % (s, i), rot=(0.0, 90.0 * i, 0.0))
        for i in range(4):
            a = 0.3 + 1.6 * i
            piece("courtyard", "hd_rose", px + math.cos(a) * 68.0, gy + math.sin(a) * 68.0,
                  300.0 + 110.0 * (i % 3), 0.5, 0.5, 0.4, (ROSE, ROSE_PINK)[i % 2], gm + "rose%d_%d" % (s, i),
                  rot=(-60.0, 90.0 * i, 0.0))
    # finials: a heart on the inner pier, a ball on the outer -- the reference's pair
    piece("courtyard", "hd_heart_motif", gx - 330.0, gy, 700.0, 0.9, 0.12, 0.85, GOLD, gm + "heartfinial")
    piece("courtyard", "hd_finial", gx + 330.0, gy, 690.0, 0.55, 0.55, 0.9, GOLD, gm + "ballfinial")
    # the two leaves, closed, gold; hd_gate_leaf carries its own frame,
    # twisted pickets, scrolls, heart and spears
    for s in (-1, 1):
        piece("courtyard", "hd_gate_leaf", gx + s * 160.0, gy, 300.0, 3.0, 0.09, 5.6, GOLD, gm + "leaf%d" % s)
    # a low ivied wall running left from the outer pier
    for i in range(5):
        wx = gx + 330.0 + 65.0 + 130.0 + i * 260.0
        piece("courtyard", "hd_wall", wx, gy, 120.0, 2.6, 0.8, 2.4, IVORY, gm + "wall%d" % i)
        piece("courtyard", "hd_kerb", wx, gy, 255.0, 2.7, 0.9, 0.3, STONE, gm + "wallcap%d" % i)
        piece("courtyard", "hd_vine", wx - 60.0 + 40.0 * (i % 3), gy - 44.0, 200.0, 1.0, 1.0, 2.4, FOL,
              gm + "wallivy%d" % i, rot=(0.0, 30.0 * i, 0.0))
        piece("courtyard", "hd_shrub", wx, gy + 170.0, 90.0, 2.2, 2.2, 1.9, (FOL, FOL_HI)[i % 2], gm + "wallhedge%d" % i)
    # hedges behind the gate, so it reads as a garden gate not a prop
    for i in range(6):
        piece("courtyard", "hd_shrub", gx - 420.0 + 170.0 * i, gy + 260.0, 100.0, 2.4, 2.4, 2.1,
              (FOL, FOL_HI, FOL_DEEP)[i % 3], gm + "hedge%d" % i, rot=(0.0, 50.0 * i, 0.0))

    # ---- the tea set, right --------------------------------------------------
    ax, ay = L("stacked_teacup_a", (-700.0, 1900.0))
    am = "stacked_teacup_a_HDAR_"
    piece("courtyard", "hd_kerb", ax, ay, 50.0, 4.2, 4.2, 1.0, STONE, am + "plinth")
    piece("courtyard", "hd_saucer", ax, ay, 125.0, 5.0, 5.0, 0.6, PORC, am + "saucer")
    piece("courtyard", "hd_teacup", ax, ay, 305.0, 3.2, 3.2, 3.6, PORC, am + "cup", rot=(0.0, 200.0, 0.0))
    for i in range(3):
        a = 2.0 * math.pi * i / 3.0 + 0.6
        piece("courtyard", "hd_heart_motif", ax + math.cos(a) * 150.0, ay + math.sin(a) * 150.0, 330.0,
              0.5, 0.1, 0.45, ROSE, am + "heart%d" % i, rot=(0.0, math.degrees(a) + 90.0, 0.0))
    bx, by = L("stacked_teacup_b", (-1050.0, 2150.0))
    bm = "stacked_teacup_b_HDAR_"
    piece("courtyard", "hd_kerb", bx, by, 40.0, 2.8, 2.8, 0.8, STONE, bm + "plinth")
    piece("courtyard", "hd_saucer", bx, by, 95.0, 3.4, 3.4, 0.4, PORC, bm + "saucer")
    piece("courtyard", "hd_teacup", bx, by, 215.0, 2.2, 2.2, 2.4, PORC, bm + "cup", rot=(0.0, 140.0, 0.0))
    piece("courtyard", "hd_kerb", -880.0, 2280.0, 35.0, 3.0, 3.0, 0.7, STONE, "HDAR_teapot_plinth")
    piece("courtyard", "hd_teapot", -880.0, 2280.0, 200.0, 2.6, 2.2, 2.4, PORC, "HDAR_teapot", rot=(0.0, 160.0, 0.0))
    for i in range(3):
        piece("courtyard", "hd_rose", -880.0 + 90.0 * (i - 1), 2180.0, 90.0, 0.6, 0.6, 0.5,
              (ROSE_PINK, ROSE, PETAL_V)[i], "HDAR_teapot_rose%d" % i, rot=(-40.0, 60.0 * i, 0.0))

    # ---- a small purple mushroom by the tea set --------------------------------
    ux, uy = L("mushroom_purple_a", (-1300.0, 3300.0))
    um = "mushroom_purple_a_HDAR_"
    piece("courtyard", "hd_mush_stem", ux, uy, 130.0, 0.9, 0.9, 2.6, MUSH_STEM, um + "stem")
    piece("courtyard", "hd_mush_cap", ux, uy, 300.0, 2.6, 2.6, 1.2, MUSH_PURPLE, um + "cap")
    for i in range(4):
        a = i * 2.4 + 0.3
        piece("courtyard", "hd_mush_spot", ux + math.cos(a) * 60.0, uy + math.sin(a) * 60.0, 340.0,
              0.4, 0.4, 0.14, MUSH_SPOT, um + "spot%d" % i)

    # ---- urns and hedges edging the court ------------------------------------
    for i, (x, y) in enumerate(((1250.0, 700.0), (-1250.0, 900.0), (1350.0, 2500.0))):
        piece("courtyard", "hd_urn", x, y, 95.0, 1.6, 1.6, 1.9, PORC, "HDAR_urn%d" % i)
        for k in range(3):
            piece("courtyard", "hd_rose", x + 40.0 * (k - 1), y - 20.0 + 30.0 * (k % 2), 215.0,
                  0.55, 0.55, 0.5, (ROSE, ROSE_PINK, PETAL_V)[k], "HDAR_urnrose%d_%d" % (i, k),
                  rot=(-30.0, 70.0 * k, 0.0))
    for side in (-1, 1):
        for i in range(7):
            y = 600.0 + 260.0 * i
            x = side * (1380.0 + 40.0 * (i % 2))
            if side > 0 and 900.0 < y < 1500.0:
                continue                          # the gate stands here
            piece("courtyard", "hd_shrub", x, y, 100.0, 2.4, 2.4, 2.0, (FOL, FOL_HI, FOL_DEEP)[i % 3],
                  "HDAR_courthedge%d_%d" % (side, i), rot=(0.0, 45.0 * i, 0.0))
            if i % 2:
                piece("courtyard", "hd_bloom_cluster", x - side * 120.0, y, 30.0, 1.4, 1.4, 1.0,
                      (ROSE_PINK, PETAL_V)[i % 4 == 1], "HDAR_courtbloom%d_%d" % (side, i))

    # ======================================================================
    # GARDEN  (50-120 m)
    # ======================================================================

    # ---- the path continues on the axis to the stairs --------------------------
    sp = lt.Spline([(0.0, 2300.0, 4.5), (30.0, 3400.0, 4.5), (-30.0, 4800.0, 4.5),
                    (0.0, 6200.0, 4.5), (0.0, 7250.0, 4.5)])
    stones = lt.lay_stones(sp, width=240.0, tile=62.0, shrink=0.86, seed=41, kerb=False)
    tones = (COB_HERO, "cobble", "cobble2")
    for k, st in enumerate(stones):
        piece("path", "hd_flagstone", st["x"], st["y"], st["z"], st["sx"], st["sy"], st["sz"],
              tones[st["tone"]], "HDAR_PATH_sett%d" % k, rot=(0.0, st["yaw"], 0.0))
    log("ARRIVAL PATH: %.0f uu, %d setts, overlaps=%d" % (sp.length, len(stones), lt.overlaps(stones)))

    # ---- the floral arch on the axis --------------------------------------------
    rx, ry = L("rose_arch", (0.0, 4000.0))
    rm = "rose_arch_HDAR_"
    piece("garden", "hd_floral_arch", rx, ry, 430.0, 9.4, 2.4, 8.6, FOL, rm + "arch")
    for s in (-1, 1):
        piece("garden", "hd_trunk", rx + s * 420.0, ry, 250.0, 0.7, 0.7, 5.0, BARK, rm + "post%d" % s)
        piece("garden", "hd_rose", rx + s * 400.0, ry - 70.0, 520.0, 0.7, 0.7, 0.6, ROSE_PINK, rm + "postrose%d" % s, rot=(-50.0, 0.0, 0.0))

    # ---- verges: flowers by the path, hedges behind, then the tall storey ---------
    for side in (-1, 1):
        for i in range(14):
            y = 2700.0 + 280.0 * i
            xh = side * (470.0 + 30.0 * (i % 3))
            piece("garden", "hd_shrub", xh, y, 80.0, 2.0, 2.0, 1.7, (FOL, FOL_HI, FOL_DEEP)[i % 3],
                  "HDAR_verge_hedge%d_%d" % (side, i), rot=(0.0, 37.0 * i, 0.0))
            for k in range(2):
                xf = side * (190.0 + 190.0 * _h(7, side, i, k))
                yf = y - 120.0 + 240.0 * _h(8, side, i, k)
                s = 0.45 + 0.45 * _h(9, side, i, k)
                piece("garden", ("hd_rose", "hd_flower", "hd_bloom_cluster")[(i + k) % 3], xf, yf, 16.0 + 30.0 * s,
                      s, s, s * 0.7, (ROSE_PINK, PETAL_V, PETAL_P, ROSE)[(i * 2 + k) % 4],
                      "HDAR_verge_flower%d_%d_%d" % (side, i, k), rot=(0.0, 360.0 * _h(10, side, i, k), 0.0))
            if i % 3 == 1:
                piece("garden", "hd_shrub", side * (820.0 + 60.0 * (i % 2)), y + 100.0, 170.0, 4.2, 4.2, 3.6,
                      (FOL_DEEP, FOL)[i % 2], "HDAR_verge_bush%d_%d" % (side, i), rot=(0.0, 60.0 * i, 0.0))
            if i % 4 == 2:
                piece("garden", "hd_shrub", side * 700.0, y, 200.0, 2.8, 2.8, 2.8, FOL_HI,
                      "HDAR_verge_ball%d_%d" % (side, i))
    for side in (-1, 1):
        for i in range(3):
            x = side * (1000.0 + 120.0 * i)
            y = 3200.0 + 1100.0 * i
            piece("garden", "hd_mush_stem", x, y, 130.0, 1.0, 1.0, 2.6, MUSH_STEM, "HDAR_gmush%d_%d_stem" % (side, i))
            piece("garden", "hd_mush_cap", x, y, 300.0, 3.0, 3.0, 1.4, MUSH_RED, "HDAR_gmush%d_%d_cap" % (side, i))
            for k in range(4):
                a = k * 1.9 + i
                piece("garden", "hd_mush_spot", x + math.cos(a) * 70.0, y + math.sin(a) * 70.0, 345.0,
                      0.42, 0.42, 0.14, MUSH_SPOT, "HDAR_gmush%d_%d_spot%d" % (side, i, k))

    # ---- garden trees: the big round one behind the gate, a smaller one right ----
    for i, (x, y, ts, cs) in enumerate(((1950.0, 3300.0, 1.0, 1.0), (-2700.0, 4700.0, 0.8, 0.85))):
        tm = "HDAR_gtree%d_" % i
        piece("garden", "hd_trunk", x, y, 420.0 * ts, 3.4 * ts, 3.4 * ts, 8.4 * ts, BARK, tm + "trunk")
        for k, (ox, oy, oz, s) in enumerate(((0.0, 0.0, 1200.0, 9.0), (420.0, 160.0, 1020.0, 6.4),
                                             (-380.0, 220.0, 1080.0, 6.8), (120.0, -360.0, 1000.0, 6.0),
                                             (-80.0, 400.0, 1380.0, 5.6), (300.0, -80.0, 1500.0, 5.0))):
            piece("garden", "hd_canopy", x + ox * cs, y + oy * cs, oz * ts, s * cs, s * cs, s * cs * 0.85,
                  (FOL, FOL_HI, FOL_DEEP, FOL, FOL_HI, FOL)[k], tm + "canopy%d" % k, rot=(0.0, 55.0 * k, 0.0))
        for k in range(7):
            a = k * 2.39996
            el = -0.3 + 0.9 * _h(11, i, k)
            piece("garden", "hd_canopy_far", x + math.cos(a) * 520.0 * cs * math.cos(el),
                  y + math.sin(a) * 520.0 * cs * math.cos(el), (1200.0 + 420.0 * math.sin(el)) * ts,
                  1.3 * cs, 1.3 * cs, 1.1 * cs, (ROSE_PINK, PETAL_V, PETAL_P)[k % 3], tm + "bloom%d" % k)

    # ---- the heart wreath, right ------------------------------------------------
    hx, hy = L("heart_topiary", (-820.0, 4300.0))
    hm = "heart_topiary_HDAR_"
    piece("garden", "hd_trunk", hx, hy, 80.0, 0.9, 0.9, 1.6, BARK, hm + "trunk")
    piece("garden", "hd_topiary_heart", hx, hy, 580.0, 9.0, 2.0, 8.4, FOL, hm + "heart")
    for i in range(3):
        piece("garden", "hd_shrub", hx - 260.0 + 260.0 * i, hy + 80.0, 90.0, 2.2, 2.2, 1.8, (FOL_DEEP, FOL, FOL_HI)[i], hm + "base%d" % i)

    # ---- the clock tower behind it -------------------------------------------
    cx, cy = L("clock_tower", (-1500.0, 5200.0))
    cm = "clock_tower_HDAR_"
    piece("garden", "hd_tower", cx, cy, 350.0, 2.6, 2.6, 7.0, IVORY, cm + "drum")
    piece("garden", "hd_cornice", cx, cy, 720.0, 3.0, 3.0, 0.5, IVORY, cm + "cornice")
    piece("garden", "hd_tower", cx, cy, 850.0, 2.0, 2.0, 2.6, IVORY, cm + "upper")
    piece("garden", "hd_clock", cx, cy - 106.0, 860.0, 1.9, 0.22, 1.9, GOLD, cm + "clock")
    piece("garden", "hd_clock_hand", cx, cy - 120.0, 890.0, 0.12, 0.05, 0.6, "dog_visor", cm + "min")
    piece("garden", "hd_clock_hand", cx + 24.0, cy - 120.0, 860.0, 0.12, 0.05, 0.44, "dog_visor", cm + "hr", rot=(90.0, 0.0, 0.0))
    piece("garden", "hd_roof_bell", cx, cy, 1140.0, 3.0, 3.0, 3.2, "roof_pink", cm + "roof")
    piece("garden", "hd_finial", cx, cy, 1340.0, 0.5, 0.5, 0.9, GOLD, cm + "finial")
    for i in range(4):
        a = 0.5 + 1.57 * i
        piece("garden", "hd_wall_window", cx + math.cos(a) * 128.0, cy + math.sin(a) * 128.0, 420.0,
              0.9, 0.24, 1.2, IVORY, cm + "win%d" % i, rot=(0.0, math.degrees(a) + 90.0, 0.0))

    # ---- two giant red mushrooms, left-mid and right-mid ----------------------
    for lmid, fb in (("mushroom_red_a", (1900.0, 4400.0)), ("mushroom_red_b", (-2300.0, 5800.0))):
        x, y = L(lmid, fb)
        mm = lmid + "_HDAR_"
        big = 1.0 if lmid.endswith("a") else 1.12
        piece("garden", "hd_mush_stem", x, y, 550.0 * big, 2.6 * big, 2.6 * big, 11.0 * big, MUSH_STEM, mm + "stem")
        piece("garden", "hd_mush_cap", x, y, 1260.0 * big, 9.0 * big, 9.0 * big, 4.0 * big, MUSH_RED, mm + "cap")
        for i in range(7):
            a = i * 2.39996 + 0.7
            rr = 0.25 + 0.5 * ((i * 37) % 7) / 7.0
            piece("garden", "hd_mush_spot", x + math.cos(a) * 450.0 * big * rr, y + math.sin(a) * 450.0 * big * rr,
                  (1400.0 - rr * rr * 160.0) * big, 1.4 * big, 1.4 * big, 0.5 * big, MUSH_SPOT, mm + "spot%d" % i)
        for i in range(4):
            a = i * 1.6
            piece("garden", "hd_shrub", x + math.cos(a) * 380.0, y + math.sin(a) * 380.0, 100.0,
                  2.6, 2.6, 2.2, (FOL, FOL_DEEP)[i % 2], mm + "foot%d" % i)

    # ---- mushroom houses --------------------------------------------------------
    for i, (x, y, cap) in enumerate(((1700.0, 6600.0, MUSH_RED), (-2400.0, 7300.0, MUSH_RED))):
        hm2 = "HDAR_mushhouse%d_" % i
        piece("garden", "hd_tower", x, y, 350.0, 5.0, 5.0, 7.0, IVORY, hm2 + "body")
        piece("garden", "hd_arch", x, y - 255.0, 110.0, 1.6, 0.4, 2.0, PORC, hm2 + "door")
        for s in (-1, 1):
            piece("garden", "hd_wall_window", x + s * 150.0, y - 252.0, 330.0, 2.2, 0.3, 2.6, IVORY, hm2 + "win%d" % s)
        piece("garden", "hd_mush_house_cap", x, y, 975.0, 11.0, 11.0, 5.5, cap, hm2 + "cap")
        for k in range(6):
            a = k * 2.39996 + i
            rr = 0.3 + 0.5 * ((k * 37) % 6) / 6.0
            piece("garden", "hd_mush_spot", x + math.cos(a) * 520.0 * rr, y + math.sin(a) * 520.0 * rr,
                  1180.0 - rr * rr * 220.0, 2.2, 2.2, 0.7, MUSH_SPOT, hm2 + "spot%d" % k)
        for k in range(3):
            piece("garden", "hd_vine", x + 200.0 * (k - 1), y - 260.0, 620.0, 1.2, 1.2, 3.4, FOL, hm2 + "ivy%d" % k)

    # ---- the staircase to the palace ------------------------------------------
    for k in range(3):
        y = 7300.0 + 300.0 * k
        z = 90.0 + 180.0 * k
        piece("garden", "hd_stairs", 0.0, y, z, 7.0, 3.0, 1.8, STONE, "HDAR_Step%d" % k)
        for s in (-1, 1):
            for b in range(3):
                piece("garden", "hd_baluster", s * 380.0, y - 100.0 + 100.0 * b, z + 150.0, 0.5, 0.5, 1.2, PORC,
                      "HDAR_Step%d_baluster%d_%d" % (k, s, b))
        piece("garden", "hd_kerb", 0.0, y + 150.0, z + 90.0 + 15.0, 7.2, 0.6, 0.3, STONE, "HDAR_Step%d_landing" % k)
    for s in (-1, 1):
        piece("garden", "hd_finial", s * 380.0, 7150.0, 200.0, 0.6, 0.6, 1.2, GOLD, "HDAR_Step_newel%d" % s)
        piece("garden", "hd_urn", s * 520.0, 7150.0, 95.0, 1.6, 1.6, 1.9, PORC, "HDAR_Step_urn%d" % s)
    piece("garden", "hd_kerb", 0.0, 8500.0, 600.0, 12.0, 6.0, 1.2, STONE, "HDAR_Terr_platform")
    for s in (-1, 1):
        piece("garden", "hd_column", s * 520.0, 8400.0, 900.0, 1.4, 1.4, 5.0, PORC, "HDAR_Terr_column%d" % s)
        piece("garden", "hd_finial", s * 520.0, 8400.0, 1190.0, 0.5, 0.5, 0.8, GOLD, "HDAR_Terr_capfinial%d" % s)
    piece("garden", "hd_arch", 0.0, 8400.0, 1150.0, 11.0, 1.6, 5.0, IVORY, "HDAR_Terr_portal")
    piece("garden", "hd_heart_motif", 0.0, 8400.0, 1440.0, 1.2, 0.14, 1.1, GOLD, "HDAR_Terr_heart")
    for s in (-1, 1):
        for i in range(4):
            piece("garden", "hd_shrub", s * (900.0 + 300.0 * i), 7600.0 + 250.0 * i, 130.0, 3.4, 3.4, 2.8,
                  (FOL_DEEP, FOL)[i % 2], "HDAR_Terr_hedge%d_%d" % (s, i))

    log("ARRIVAL DISTRICT: " + ", ".join("%s %d" % kv for kv in sorted(counts.items())))
    return counts
