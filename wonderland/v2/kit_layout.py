"""Where the Blender forge kit stands in Wonderland, and why each stand exists.

EVERY BATCH HERE ANSWERS A MEASURED MISMATCH, not a hunch. The world's own
census is `tools/framescape.py`, which walks all thirty-three cameras and says
what holds the top of each frame; `docs/handoffs/WONDERLAND_WORLD_CURRENT.md`
lists the five largest remaining mismatches. Three of them are what a kit of
architecture is for:

    #2  a district's fungus out-tops its clock tower: `mushroom_landmark` is
        1,743 uu and `tower_clock` 1,190, which is why ClockQuarterCam13 is
        18.3% built and held 35% by a mushroom
    #3  the 180-360 m band is the thinnest part of the world's silhouette,
        tops at +7.9 and +5.6 degrees against +14.0 nearer in
    #4  ten frames have ONE piece holding a third of the ceiling -- the same
        great spire or the same swag, frame after frame

So the stands are placed ON the axis of the camera that measures worst, at a
distance chosen so a 55-60 m tower tops out in the band that is empty, and
every tower in a stand is a DIFFERENT spelling with a different foot and a
different crown. `kit_v2.spellings` dedupes both ends for exactly that reason.

NOTHING HERE IS PLACED ON A CAMERA. `_clear_of_cameras` refuses a stand within
`CAM_CLEARANCE` of any of the thirty-three, because this world has spawned a
depth piece 10.6 m in front of a lens before and the note in `layout_v2` about
it is the reason the check is here rather than in a reviewer's head.

WHAT IS NOT PROVEN. These placements have never been built by an engine. They
are Python, like the rest of `layout_v2`, and every offline instrument the world
uses reads them -- but no frame has been rendered from Unreal with them in it,
and `wonderland/art/unreal/import-plan.json` still says
`imported_into_an_editor: false`.
"""

import math

import kit_v2 as KIT
import v2_config as C

#: No stand may sit closer than this to any camera in the suite, in uu. It is
#: the floor of `clearance_for`, not the whole rule -- see below.
CAM_CLEARANCE = 2600.0

#: The elevation a kit piece may not top out above, seen from any camera's eye.
#:
#: A FLAT CLEARANCE IS THE WRONG SHAPE and this project has learned it once
#: already: `framescape.crowding` was "wrong twice before it was right" because
#: it asked how big a piece is rather than how much of a frame it takes. The
#: same error was here. 2,600 uu treats a 3 m retaining wall and a 63 m tower
#: as the same hazard -- it refused the tea terrace ground that the Tea
#: Terraces are named for, while passing any tower that cleared the same
#: circle. What a camera actually cannot have is a piece LOOMING: filling the
#: lens from below the frame to above it. Forty-five degrees is that, and it
#: falls out of the piece's own height rather than a number typed once.
MAX_LOOM_DEG = 45.0

#: Nothing may stand nearer than this whatever its height, so no camera ever
#: ends up inside a kerb. This one IS unconditional -- a piece behind a lens is
#: still a piece the lens is standing inside.
MIN_CLEARANCE = 900.0

#: Degrees added to a camera's half-fov before a piece counts as out of shot.
#: Generous on purpose: a camera can be re-aimed and a placement is forever.
LOOM_FOV_MARGIN = 12.0


def clearance_for(height_uu, eye_uu=170.0):
    """How far a piece `height_uu` tall must stand off a camera at `eye_uu`.

    45 degrees is not a taste. Measured over the 45,924 piece/camera pairs the
    world's OWN placements make inside a frame, the elevation of a top reads
    p50 +2.2, p90 +8.6, p99 +22.5 and p99.9 +43.2. A 45 degree cap therefore
    refuses 38 of the world's own pieces -- 0.08% -- so the kit is held to
    exactly the standard the world already keeps, and not a stricter one.
    """
    rise = max(0.0, float(height_uu) - float(eye_uu))
    if rise <= 0.0:
        return MIN_CLEARANCE
    return max(MIN_CLEARANCE, rise / math.tan(math.radians(MAX_LOOM_DEG)))


def looms(x, y, height_uu, cams=None):
    """The camera a piece would loom in, or None. Bearing first, then distance.

    A CAMERA LOOKING AWAY CANNOT HAVE ANYTHING LOOM IN IT, and ignoring that is
    how a 45 degree cap -- which refuses only 0.08% of the world's own pieces
    -- came to refuse every spot `_ceiling_break` had. Requiring 61 m from all
    thirty-three cameras regardless of where they point leaves almost no ground
    in a world this dense, and most of what it refuses is behind a lens.

    So: the piece must be IN the picture before its height is a problem, which
    is the same test `framescape.census` applies before it counts anything. The
    margin on the half-fov is generous on purpose -- a camera can be re-aimed,
    a placement is forever, and the honest direction for this test is to flag
    one piece too many rather than one too few.
    """
    for name, loc, yaw, fov, _pitch in (cams or _CAMS):
        d = math.hypot(x - loc[0], y - loc[1])
        if d < MIN_CLEARANCE:
            return (name, d, MIN_CLEARANCE)
        need = clearance_for(height_uu, loc[2])
        if d >= need:
            continue
        th = math.degrees(math.atan2(x - loc[0], y - loc[1])) - (yaw - 90.0)
        th = (th + 180.0) % 360.0 - 180.0
        if abs(th) > fov / 2.0 + LOOM_FOV_MARGIN:
            continue                      # behind the lens, or off its edge
        return (name, d, need)
    return None

_CAMS = [(c["name"], c["location"], c["rotation"][1], c["fov"], c["rotation"][0])
         for c in C.HERO_CAMS]
_BY_NAME = {n: (loc, yaw, fov, pitch) for (n, loc, yaw, fov, pitch) in _CAMS}

SKIPPED = []


def _clear_of_cameras(x, y, why):
    for name, loc, _yaw, _fov, _p in _CAMS:
        if math.hypot(x - loc[0], y - loc[1]) < CAM_CLEARANCE:
            SKIPPED.append("%s at (%.0f, %.0f): %.0f uu from %s"
                           % (why, x, y, math.hypot(x - loc[0], y - loc[1]), name))
            return False
    return True


def forward(cam):
    """A camera's own forward vector, in the convention its instruments use.

    THE SIGN OF X IS NOT THE OBVIOUS ONE and getting it wrong cost a whole
    placement pass. `tools/framescape.py` computes a bearing as
    `atan2(dx, dy) - (yaw - 90)`, so a point dead ahead satisfies
    `atan2(dx, dy) = yaw - 90` and the forward vector is
    `(sin(yaw-90), cos(yaw-90))` = `(-cos yaw, sin yaw)`. Written as
    `(cos yaw, sin yaw)` -- which is right for the two cameras whose yaw is 90
    or 270, and wrong for every other -- seven 60 m towers were placed 131
    degrees off the axis of the camera they were meant to fill, and the census
    was unchanged to the decimal because none of them was in the picture.
    """
    yaw = math.radians(_BY_NAME[cam][1])
    return (-math.cos(yaw), math.sin(yaw))


def on_axis(cam, distance, lateral=0.0):
    """A point `distance` down a camera's view axis, `lateral` across it."""
    loc = _BY_NAME[cam][0]
    fx, fy = forward(cam)
    return (loc[0] + fx * distance - fy * lateral,
            loc[1] + fy * distance + fx * lateral)


def tops_at(cam, distance, height_uu):
    """Where something `height_uu` tall tops out, in the camera's OWN degrees.

    PITCH IS PART OF THE ANSWER. `framescape.census` reports elevations
    relative to the camera's axis -- it subtracts pitch -- so a window quoted
    from the census only means what it says if this subtracts it too. Written
    without the pitch term this read WorldCam12, which looks 16 degrees down,
    a full 16 degrees high, and every window matched against it was that far
    out. The two frames whose pitch is 0 hid it.
    """
    loc, _yaw, _fov, pitch = _BY_NAME[cam]
    return (math.degrees(math.atan2(float(height_uu) - loc[2], float(distance)))
            - float(pitch))


def at_bearing(cam, bearing, distance):
    """The point `distance` away on a given bearing from a camera's axis.

    The inverse of `framescape`'s `th = atan2(dx, dy) - (yaw - 90)`: dead ahead
    is bearing 0 and agrees with `on_axis`, positive bearings run the way the
    census numbers its columns. A batch that has to answer a boss holding
    columns 33-74 needs to place ON those columns, and `on_axis` with a lateral
    offset only approximates a bearing -- exactly at the frame's edge, where
    these bosses live, the approximation is worth several columns.
    """
    loc, yaw, _fov, _pitch = _BY_NAME[cam]
    a = math.radians(float(bearing) + yaw - 90.0)
    return (loc[0] + distance * math.sin(a), loc[1] + distance * math.cos(a))


# ---------------------------------------------------------------------------
# WHICH DISTRICT A BATCH LANDS IN DECIDES WHAT THE BATCH IS.
#
# A camera is named for where it STANDS, not for what it looks at:
# ClockQuarterCam13 stands in the Clock Quarter and looks south-west across the
# Tea Terraces and the Water Gardens. Filling its ceiling with clock towers
# would put a clockyard's architecture in a lake district. So every batch below
# is anchored on the district its ground actually belongs to, and its family is
# that district's own palette.
#
#     clockyard / court / towers   towers, walls, thresholds
#     tea / garden / court         gardens, stairs, ground
#     lake / water                 water
#     hamlet                       market, roofscape
#     grove / wood / meadow        left alone -- the census says green is
#                                  CORRECT for a grove camera
# ---------------------------------------------------------------------------

#: (name, centre, the cameras it answers, why). Centres are district centroids
#: or points measured off a camera axis with `tools`-side probing; the
#: neighbour counts in the comments were measured against `layout_v2.ALL`.
BATCHES = []


def _nudge(bands, x, y, why, max_neighbours=40, step=1400.0, tries=8,
           radius=0.0, height_uu=0.0):
    """The nearest spot to (x, y) that is clear of cameras and not crowded.

    A stand that is simply DROPPED when its first choice is taken makes a batch
    quietly smaller than it says it is, and the census then measures a pass
    that was never placed. Walking outward on a spiral keeps the count honest;
    only when eight rings fail does the stand actually go, and it says so.

    `radius` IS THE BATCH'S OWN SPREAD, and leaving it at zero is how the tea
    terrace came to stand 2,272 uu from TeapotCam24 with a clearance of 2,600.
    A composed batch is not a point: this one clears its centre and then lays a
    retaining run 2,400 uu along the ground either side of it, so the centre
    passing the camera test says nothing about the pieces. `verify_kit_bridge`
    caught it because it tests every PLACEMENT rather than every decision, and
    the fix belongs here -- the ground has to be chosen for the whole batch.
    """
    for k in range(tries):
        a = k * 2.399963                              # the golden angle, in radians
        r = 0.0 if k == 0 else step * math.sqrt(float(k))
        px, py = x + r * math.cos(a), y + r * math.sin(a)
        if looms(px, py, max(height_uu, CAM_CLEARANCE + float(radius))):
            continue
        if _neighbours(bands, px, py) > max_neighbours:
            continue
        return px, py
    SKIPPED.append("%s: no clear ground within %.0f uu of (%.0f, %.0f)"
                   % (why, step * math.sqrt(tries), x, y))
    return None


def _neighbours(bands, x, y, r=1200.0):
    n = 0
    for band in bands:
        for it in band:
            if abs(it["pos"][0] - x) < r and abs(it["pos"][1] - y) < r:
                n += 1
    return n


def _tea_terrace(bands):
    """Tea Terraces: a terraced garden, seen by two veg-roofed cameras.

    ClockQuarterCam13 (18.3% built, the worst frame in the suite) and
    GroveRoadCam18 (21.7%) both look across this ground at 20 km. The palette
    is tea/garden/court, so what belongs is LEVELS -- a retaining edge with a
    flight cut into it, an overlook, and a pavilion base standing on the
    terrace it retains. That is the composition `families/gardens.py` and
    `families/stairs.py` were built to make.
    """
    out = []
    spot = _nudge(bands, -9700.0, -9400.0, "TeaTerrace", max_neighbours=60)
    if spot is None:
        return out
    cx, cy = spot
    RUN = 800.0                                  # the retaining run's own length
    for i in range(-3, 4):
        x = cx + RUN * i
        if i == 0:
            out += KIT.placements_for("WL_Stair_Straight_T2", (x - 200.0, cy, 0.0),
                                      rot=(0.0, 180.0, 0.0),
                                      label="KitTeaTerrace_Flight")
        elif i == 2:
            out += KIT.placements_for("WL_Garden_Overlook", (x, cy, 0.0),
                                      rot=(0.0, 90.0, 0.0),
                                      label="KitTeaTerrace_Overlook")
        else:
            out += KIT.placements_for("WL_Garden_Retaining_Run", (x, cy, 0.0),
                                      label="KitTeaTerrace_Run%d" % (i + 3))
            out += KIT.placements_for("WL_Detail_Balustrade_Run",
                                      (x, cy + 77.0, 310.0),
                                      label="KitTeaTerrace_Rail%d" % (i + 3))
    T2 = 310.0
    out += KIT.placements_for("WL_Garden_Pavilion_Base", (cx, cy + 1100.0, T2),
                              label="KitTeaTerrace_Court")
    out += KIT.placements_for("WL_Tower_Crown_Pavilion", (cx, cy + 1100.0, T2 + 310.0),
                              label="KitTeaTerrace_Pavilion")
    for sgn in (-1.0, 1.0):
        out += KIT.placements_for("WL_Garden_Planter_Wall",
                                  (cx + sgn * 1400.0, cy + 2000.0, T2),
                                  label="KitTeaTerrace_Bed%d" % (1 if sgn < 0 else 2))
    out += KIT.placements_for("WL_Garden_Gate_Threshold", (cx + 2400.0, cy + 1100.0, 0.0),
                              rot=(0.0, 90.0, 0.0), label="KitTeaTerrace_Gate")
    return out


def _water_court(bands):
    """Water Gardens: the reflecting basin, on the district's own centre.

    GroveRoadCam18's axis passes 328 uu from this district's centroid and
    ClockQuarterCam13's passes 196 uu from it; both frames are more than
    two-thirds vegetation. The palette is lake/water/water and this kit's water
    family exists because `MI_V2_Water` was in the world and nothing used it.

    The basin is laid so its HEAD faces the cameras: a 34 m sheet doubles
    whatever stands at its head, and what stands there is the pavilion.
    """
    out = []
    spot = _nudge(bands, -5400.0, -13570.0, "WaterCourt", max_neighbours=60)
    if spot is None:
        return out
    cx, cy = spot
    out += KIT.placements_for("WL_Hero_Water_Court", (cx, cy, 0.0),
                              rot=(0.0, 40.0, 0.0), label="KitWaterCourt_Basin")
    # the canal leaves the basin's foot, butt to butt at its own module length
    UNIT = 880.0
    for i in range(4):
        mod = "WL_Water_Canal_Crossing" if i == 2 else "WL_Water_Canal_Run"
        out += KIT.placements_for(mod, (cx - 2600.0 - UNIT * i, cy - 2200.0, 0.0),
                                  rot=(0.0, 40.0, 0.0),
                                  label="KitWaterCourt_Canal%d" % (i + 1))
    out += KIT.placements_for("WL_Water_Pavilion", (cx + 2600.0, cy + 2200.0, 0.0),
                              label="KitWaterCourt_Pavilion")
    out += KIT.placements_for("WL_Water_Cascade_Stair", (cx - 3400.0, cy + 2600.0, 0.0),
                              rot=(0.0, 220.0, 0.0), label="KitWaterCourt_Cascade")
    out += KIT.placements_for("WL_Water_Sunken_Pool", (cx + 3800.0, cy - 2600.0, 0.0),
                              label="KitWaterCourt_Pool")
    out += KIT.placements_for("WL_Water_Spillway_Wall", (cx - 1200.0, cy + 3000.0, 0.0),
                              rot=(0.0, 90.0, 0.0), label="KitWaterCourt_Weir")
    return out


#: The frames the census says can still be moved, and the elevation window a
#: stand has to reach in each. A frame whose median top already reads +29.4 --
#: the top edge itself -- cannot be moved by a taller piece, because
#: `framescape.py` clips elevation to the frame and a column changes hands only
#: on a strict `>`. The first placement pass learned that the expensive way:
#: seven 60 m towers on GardenRight05's axis moved the census by nothing at all.
#: (camera, the median top the census measured in it before any of this). The
#: WINDOW IS DERIVED, NOT TYPED: a stand is worth placing when it tops above
#: that median and still inside the frame, and both ends of that come from the
#: camera. Typed windows hid a real bug for a whole pass -- they were written
#: against a `tops_at` that ignored pitch, so WorldCam12's (20, 40) was
#: satisfied by stands topping out at +4, and nothing in the numbers said so.
HEADROOM_FRAMES = (
    ("ClockQuarterCam13", 15.7),
    ("ReverseCam03", 16.4),
    ("HamletCam17", 19.0),
    ("WorldCam12", 19.0),
    ("TeaTerraceCam16", 20.9),
    ("LanternLaneCam27", 24.0),
)

#: How tall a stand is assumed to be while its ground is chosen, in uu. The
#: spellings actually used are 50-63 m; 5,500 is the low end, so a spot chosen
#: for it is never LOWER than promised.
STAND_UU = 5500.0

#: Filled by `_depth_stand`, so a report can say where the stands went and
#: which frame each answers without re-deriving it.
DEPTH_CHOSEN = []


def spots_for(cam, bands, want, window, taken, lat_step=2200.0, lat_max=11000.0):
    """Clear ground on one camera's axis that tops out inside its window.

    Scanned rather than typed. Three of eight hand-picked depth spots turned
    out to be inside `CAM_CLEARANCE` of `RearWorldCam10` or crowded past the
    neighbour limit, and a hand-picked spot that fails is a stand that silently
    does not exist. This walks the axis instead and returns what it finds.
    """
    lo, hi = window
    out = []
    d = 4000.0
    while d < 26000.0 and len(out) < want:
        el = tops_at(cam, d, STAND_UU)
        if el < lo or el > hi:
            d += 900.0
            continue
        lat = -lat_max
        while lat <= lat_max and len(out) < want:
            x, y = on_axis(cam, d, lat)
            lat += lat_step
            if any(math.hypot(x - px, y - py) < 3000.0 for px, py in taken):
                continue
            if looms(x, y, 6320.0):        # the tallest spelling, not the low end
                continue
            if _neighbours(bands, x, y) > 34:
                continue
            out.append((x, y, el))
            taken.append((x, y))
        d += 1500.0
    return out


def _depth_stand(bands):
    """Spelled towers where the census says a frame can still be moved.

    One stand per spot, each a DIFFERENT spelling with a different foot and a
    different crown. The variety is not decoration: the world's mismatch #4 is
    that ten frames have ONE piece holding a third of the ceiling, and a stand
    of one repeated tower would be that defect under a new name.
    """
    out, taken, chosen = [], [], []
    for cam, med in HEADROOM_FRAMES:
        window = (med + 1.0, frame_edge(cam) + BREAK_OVERSHOOT)
        reach = tops_at(cam, CAM_CLEARANCE, 6320.0)
        if reach < window[0]:
            SKIPPED.append("%s: unreachable -- it stands %.0f uu up looking %.0f "
                           "down, so the tallest spelling tops out at %+.1f even "
                           "at the clearance limit, against a window of %+.1f"
                           % (cam, _BY_NAME[cam][0][2], -_BY_NAME[cam][3],
                              reach, window[0]))
            continue
        got = spots_for(cam, bands, 3, window, taken)
        for (x, y, el) in got:
            chosen.append((x, y, el, cam))
        if not got:
            SKIPPED.append("%s: no clear ground on its axis inside %s"
                           % (cam, window))
    if not chosen:
        return out
    spells = KIT.spellings(want=len(chosen), min_height_uu=5000.0)
    for i, (x, y, el, cam) in enumerate(chosen):
        chain, _h = spells[i % len(spells)]
        out += KIT.stack(chain, (x, y, 0.0), rot=(0.0, float((i * 47) % 360), 0.0),
                         label="KitDepth%02d" % (i + 1), band="V2_Skyline")
        out += KIT.placements_for("WL_Ground_Plaza_Medallion", (x, y, 0.0),
                                  label="KitDepth%02d_Base" % (i + 1))
    DEPTH_CHOSEN[:] = chosen
    return out


def _clock_quarter(bands):
    """Clock Quarter: architecture that out-tops the district's own fungus.

    The world's mismatch #2, stated in its own handoff: `mushroom_landmark` is
    1,743 uu tall at scale 1 and `tower_clock` is 1,190, so a district's fungus
    out-tops its clock tower before either is scaled. This does not touch
    either recipe -- that is the world stream's call -- it puts five spelled
    towers of 54 to 63 m on the quarter's own ground, which is three times the
    mushroom and is what a quarter named for its clocks should read as.
    """
    cx, cy = 14537.0, -1296.0
    out = []
    spells = KIT.spellings(want=16, min_height_uu=4200.0)[5:]
    ring = [(2600.0, 20.0), (3400.0, 95.0), (2900.0, 168.0),
            (3800.0, 242.0), (3100.0, 310.0)]
    for i, (r, a) in enumerate(ring):
        if i >= len(spells):
            break
        chain, _h = spells[i]
        spot = _nudge(bands, cx + r * math.cos(math.radians(a)),
                      cy + r * math.sin(math.radians(a)),
                      why="ClockQuarter%d" % (i + 1))
        if spot is None:
            continue
        x, y = spot
        out += KIT.stack(chain, (x, y, 0.0), rot=(0.0, a + 90.0, 0.0),
                         label="KitClockTower%d" % (i + 1), band="V2_Skyline")
    return out


def _hamlet_street(bands):
    """Lantern Hamlets: a street that reads as inhabited.

    GardenRight05 looks across this ground at 10 to 14 km and HamletCam17
    stands in it at 46.7% built. The palette is hamlet/court/garden, so what
    belongs is not a tower but a STREET -- two terraces of houses facing each
    other with the awning, arcade, sign and canopy layer between them, which is
    exactly the composition `families/market.py` was built for.
    """
    out = []
    spot = _nudge(bands, -9228.0, 9160.0, "HamletStreet", max_neighbours=60)
    if spot is None:
        return out
    cx, cy = spot
    BAY, STREET = 739.0, 2300.0
    for side in (-1.0, 1.0):
        y = cy + side * STREET * 0.5
        yaw = 0.0 if side < 0 else 180.0
        for i in range(5):
            x = cx + (i - 2) * BAY
            sd = "L" if side < 0 else "R"
            host = "KitHamlet_House%s%d" % (sd, i + 1)
            out += KIT.placements_for("WL_House_Jettied", (x, y, 0.0),
                                      rot=(0.0, yaw, 0.0), label=host)
            # THE AWNING AND THE SIGN ARE CARRIED BY THAT HOUSE. Both declare
            # `mounts_on: facade` and publish a `back` socket with no `bottom`,
            # and the forge authored the mount height into the geometry -- the
            # awning's own bbox starts 192 uu up -- so z stays 0 and the piece
            # lands at 1.9 m on the wall. What was missing was saying so: they
            # were placed on the facade and not DECLARED to be, so a screen
            # that removed the house would have left them in the air.
            if i % 2 == 0:
                out += carried(KIT.placements_for(
                    "WL_Market_Awning", (x, y - side * 313.0, 0.0),
                    rot=(0.0, yaw, 0.0),
                    label="KitHamlet_Awning%s%d" % (sd, i + 1)), host)
            else:
                out += carried(KIT.placements_for(
                    "WL_Market_Hanging_Sign", (x, y - side * 313.0, 0.0),
                    rot=(0.0, yaw, 0.0),
                    label="KitHamlet_Sign%s%d" % (sd, i + 1)), host)
    for i in (-1, 0, 1):
        # the arcade is INSERTED INTO the left terrace's ground floor, so it is
        # carried by the house at the same bay: the row runs x = cx + (k-2)*BAY
        # for k in 0..4, so bay i belongs to house k = i + 2.
        out += carried(KIT.placements_for(
            "WL_Market_Arcade_Insert",
            (cx + i * BAY, cy - STREET * 0.5 + 313.0, 0.0),
            label="KitHamlet_Arcade%d" % (i + 2)),
            "KitHamlet_HouseL%d" % (i + 3))
        out += KIT.placements_for("WL_Market_Canopy",
                                  (cx + i * 900.0, cy, 0.0),
                                  label="KitHamlet_Canopy%d" % (i + 2))
    out += KIT.placements_for("WL_Market_Covered_Passage",
                              (cx + 2.5 * BAY + 250.0, cy - STREET * 0.5, 0.0),
                              label="KitHamlet_Passage")
    out += KIT.placements_for("WL_Market_Corner_Storefront",
                              (cx - 2.5 * BAY - 340.0, cy - STREET * 0.5 + 313.0, 0.0),
                              label="KitHamlet_Corner")
    # the made ground the street stands on
    for i in range(-2, 3):
        out += KIT.placements_for("WL_Ground_Kerb_Run",
                                  (cx + i * 800.0, cy - STREET * 0.5 + 700.0, 0.0),
                                  rot=(0.0, 180.0, 0.0),
                                  label="KitHamlet_Kerb%d" % (i + 3))
    out += KIT.placements_for("WL_Ground_Plaza_Medallion", (cx, cy, 0.0),
                              label="KitHamlet_Medallion")
    return out


#: WHY SIX OF THE TEN "ONE PIECE" FRAMES CANNOT BE FIXED BY PLACING ANYTHING.
#:
#: `framescape.census` clips every elevation to the frame's top edge
#: (`el = min(el, hv)`) and awards a column on a STRICT `>`. So in a column
#: whose incumbent already reads the edge, no piece can ever take the column --
#: not a taller one, not a nearer one, because both clip to the same number and
#: the tie goes to whoever `layout_v2.ALL` lists first. Measured per column
#: across all thirty-three cameras, the ten frames the census reports as held a
#: third by one piece split cleanly in two:
#:
#:   PINNED -- incumbent already at the edge, unmovable by addition
#:     TeapotCam24      DPTeaTerraces_Gatehouse   68%  raw top +50.0 vs edge +33.8
#:     WorldNorthCam19  GreatSpire_Body           58%  raw top +63.2 vs edge +31.5
#:     GroveRoadCam18   Q03_grove_Giant_Cap       57%  raw top +51.9 vs edge +29.4
#:     WaterGardenCam15 Rear_FrameR_SlimCanopy2   43%  raw top +34.7 vs edge +29.4
#:     EastReachCam20   NorthWay8_VergeCanopy2_1  40%  raw top +55.7 vs edge +30.2
#:     GreatSpireCam22  GreatSpire_Body           47%  +33.5 against an edge of
#:                                                     +33.8 -- 0.3 deg is not room
#:
#:   OPEN -- incumbent below the edge, so a taller piece does take the column
#:     ClockQuarterCam13 FlankL_NearMush_Landmark 35%  +21.5, edge +29.4  (+7.9)
#:     HamletCam17      LMTeaTerraces_AvenueCone3 33%  +25.2, edge +29.4  (+4.2)
#:     ClockGrandCam23  DPClockQuarter_Swag       71%  +29.8, edge +33.8  (+4.0)
#:     GateArchCam30    DPClockQuarter_Swag       41%  +32.5, edge +33.8  (+1.3)
#:
#: Of the four open ones, 23 and 30 are held by the SAME swag standing 15 m from
#: two cameras that are 1.7 m apart. Out-topping a foreground piece at 1,535 uu
#: from behind needs `(h - 170) > 0.70 * r`; at any distance a stand can legally
#: occupy that is a 400 m tower. The swag has to move or shrink, and that is the
#: world stream's asset, not the kit's.
#:
#: WHICH LEAVES TWO, and both are held by VEGETATION -- the district's own
#: fungus and an avenue cone out-topping its architecture, which is the world's
#: mismatch #2 as well as #4. Those two are what `_ceiling_break` answers.
EDGE_PINNED = ("TeapotCam24", "WorldNorthCam19", "GroveRoadCam18",
               "WaterGardenCam15", "EastReachCam20", "GreatSpireCam22",
               "ClockGrandCam23", "GateArchCam30")

#: (camera, the piece holding it, the bearings it holds, its elevation there).
#: Measured per column, not estimated: see `EDGE_PINNED` above.
CEILING_BREAK = (
    ("ClockQuarterCam13", "FlankL_NearMush_Landmark", (-19.9, 10.9), 21.5),
    ("HamletCam17", "LMTeaTerraces_AvenueCone3_1", (0.4, 28.1), 25.2),
)

#: How far above the incumbent a stand has to top out before it is worth
#: placing. One degree is inside the width of a census column at these
#: distances; two is a crown a viewer would actually see clear of the cap.
BREAK_MARGIN = 2.0

#: Filled by `_ceiling_break` so the report can name what went where.
BREAK_CHOSEN = []


def frame_edge(cam):
    """The elevation of a camera's own top edge, in degrees.

    A CAMERA IS A RECTANGLE: the vertical field follows from the horizontal one
    and 16:9, so a 90 degree fov tops out at +29.4 and not +45. `framescape`
    derives it the same way and clips to it; a batch that does not know the
    number cannot tell a crown that fills a ceiling from one that has gone
    straight through it.
    """
    half = math.radians(_BY_NAME[cam][2] / 2.0)
    return math.degrees(math.atan(math.tan(half) / (16.0 / 9.0)))


#: How far above a frame's own top edge a stand may top out. Past this it is no
#: longer standing in the ceiling, it IS the ceiling -- which is the defect
#: being fixed, wearing the kit's name. Four degrees leaves a crown clearly
#: clear of the edge without letting a 63 m tower sit 44 m from a lens.
BREAK_OVERSHOOT = 4.0


#: The bearing two stands must differ by, in degrees, before they read as two
#: pieces rather than a clump. SEPARATION IS AN ANGLE, NOT A DISTANCE, and
#: `apart` alone got that wrong the same way the bearing step did: 2,600 uu at
#: 10 km is 15 degrees of arc, so a stand on one arc of a frame silently
#: refused every spot on the arc 13 degrees away -- which is how the founder's
#: reference frame ended up with one stand where three fitted. What the frame
#: cares about is how far apart two towers look; what the GROUND cares about is
#: that they do not intersect, and that is a much smaller number.
MIN_SEP_DEG = 6.0


def spots_on_bearing(cam, bands, arc, min_el, heights, want, taken,
                     apart=1400.0):
    """Clear ground ACROSS a boss's arc that tops INSIDE the frame above it.

    Spread, not a wall. Each spot is taken on a different bearing inside the
    arc the incumbent holds, so the columns it loses are shared between several
    stands rather than handed to one new piece -- a stand that took the whole
    arc would be mismatch #4 again with a different name on it.

    FAR FIRST, and the reason is compositional rather than convenient. The same
    stand that reads as a crown standing clear behind a cap at 110 m is a
    monolith at 44 m, and the near spot is always the one that clears the
    margin first. Scanning inward from the far end takes the deepest ground
    that still works, and `BREAK_OVERSHOOT` refuses the near ground outright.
    """
    lo, hi = arc
    ceiling = frame_edge(cam) + BREAK_OVERSHOOT
    loc = _BY_NAME[cam][0]
    out = []
    # THE WHOLE LADDER, TALLEST FIRST, NOT JUST THE TALLEST. Elevation is a
    # ratio of height to distance, so a 48 m tower at 8 km reaches what a 63 m
    # one reaches at 10.5 km -- and it needs 4,660 uu of camera clearance
    # instead of 6,150. Asking only the tallest spelling threw away every spot
    # where a shorter one fits, and the clearance rule made those the majority.
    ladder = sorted({float(h) for h in
                     (heights if isinstance(heights, (list, tuple, set))
                      else [heights])}, reverse=True)
    # A BEARING STEP IS NOT A DISTANCE. Three degrees apart at 11.6 km is 600
    # uu of ground, well inside the spacing this batch demands, so a fixed step
    # walked eleven bearings and placed two stands. The step is the angle that
    # actually separates two stands at the depth they will stand at.
    #
    # AND IT MUST STILL SAMPLE A NARROW ARC. That spacing is 13 degrees, which
    # on an arc 11 degrees wide tries exactly ONE bearing -- and one blocked
    # bearing then reads as "no clear ground" for the whole arc. It refused the
    # founder's own reference frame, the one camera in the suite with a ground
    # truth to miss. Sample any arc at least four ways whatever the spacing;
    # `taken` still keeps two stands from landing on top of each other.
    step = max(1.5, math.degrees(math.atan2(apart, 11000.0)))
    step = min(step, max(MIN_SEP_DEG / 2.0, (hi - lo) / 3.0))
    th = lo
    while th <= hi and len(out) < want:
        got = None
        for height_uu in ladder:
            d = 12200.0
            while d >= 4200.0:
                top = tops_at(cam, d, height_uu)
                if top <= min_el + BREAK_MARGIN or top > ceiling:
                    d -= 600.0
                    continue
                x, y = at_bearing(cam, th, d)
                d -= 600.0
                if any(math.hypot(x - px, y - py) < apart
                       for px, py, _c, _t in taken):
                    continue
                if any(c == cam and abs(t - th) < MIN_SEP_DEG
                       for _px, _py, c, t in taken):
                    continue
                if looms(x, y, height_uu):
                    continue
                if _neighbours(bands, x, y) > 34:
                    continue
                got = (x, y, th, top, math.hypot(x - loc[0], y - loc[1]),
                       height_uu)
                break
            if got:
                break
        if got:
            # THE HEIGHT IS PART OF THE SPOT. It was validated against `looms`
            # for THIS spelling: handing the spot a taller one afterwards is
            # how 25 stands were chosen for a 48 m tower and then given a 63 m
            # one, which the screen then refused. The caller picks a spelling
            # that actually is this tall.
            out.append(got)
            taken.append((got[0], got[1], cam, th))
        th += step
    return out


def _spelling_of(spells, height_uu, seed=0):
    """A spelling that really is `height_uu` tall, varied by `seed`.

    `spots_on_bearing` validates a spot against a specific height -- both its
    elevation in the frame and its camera clearance depend on it -- so the
    stand that lands there has to be that tall. Rotating blindly through the
    spelling table put a 63 m tower on ground cleared for a 48 m one.
    """
    same = [c for c in spells if abs(c[1] - float(height_uu)) < 1.0]
    if not same:
        same = sorted(spells, key=lambda c: abs(c[1] - float(height_uu)))[:1]
    return same[seed % len(same)]


def _ceiling_break(bands):
    """Built crowns through the ceilings still held by one plant.

    THE OTHER EIGHT ARE NOT SKIPPED OUT OF LAZINESS -- `EDGE_PINNED` records,
    per column, why nothing placed can move them. Adding towers to those frames
    would cost a pass and change the census by zero, which is precisely the
    mistake the first placement pass made and the reason that constant is
    written down rather than remembered.

    Here the incumbent tops out BELOW the frame's edge, so a stand that clears
    it by `BREAK_MARGIN` genuinely takes the column: the viewer sees the cap,
    and a spelled crown standing clear above it.

    HAMLETCAM17 IS EXPECTED TO COME BACK EMPTY, and that is the batch working.
    Its arc is walled at 5,600-12,000 uu by FlankRightCam09 and TeaTerraceCam16,
    so the only ground `CAM_CLEARANCE` leaves open is 4,400-5,000 uu -- where a
    63 m tower tops out at +53 against a frame edge of +29.4. That stand would
    take the ceiling from the avenue cone by BEING a bigger version of the same
    defect, so `BREAK_OVERSHOOT` refuses it and the frame stays as the depth
    pass left it (+16.6 built). A batch that placed it would have scored.
    """
    out, taken, chosen = [], [], []
    spells = KIT.spellings(want=16, min_height_uu=4200.0)
    ladder = [h for _c, h in spells]
    for cam, boss, arc, el in CEILING_BREAK:
        got = spots_on_bearing(cam, bands, arc, el, ladder, 8, taken)
        if not got:
            SKIPPED.append("%s: nothing between %+.1f (over %s) and %+.1f "
                           "(the frame's edge plus %.0f) on bearings %s"
                           % (cam, el + BREAK_MARGIN, boss,
                              frame_edge(cam) + BREAK_OVERSHOOT,
                              BREAK_OVERSHOOT, arc))
        for (x, y, th, top, r, h) in got:
            chosen.append((x, y, th, top, r, cam, boss, h))
    for i, (x, y, _th, _top, _r, _cam, _boss, want_h) in enumerate(chosen):
        chain, _h = _spelling_of(spells, want_h, i)
        out += KIT.stack(chain, (x, y, 0.0), rot=(0.0, float((i * 63) % 360), 0.0),
                         label="KitBreak%02d" % (i + 1), band="V2_Skyline")
        out += KIT.placements_for("WL_Ground_Plaza_Medallion", (x, y, 0.0),
                                  label="KitBreak%02d_Base" % (i + 1))
    BREAK_CHOSEN[:] = chosen
    return out


#: Cameras that STAND IN A GROVE. `framescape`'s own note is that a green
#: ceiling is CORRECT for one of these -- the number it prints is a reading,
#: not a fault -- so no batch here fills them. Roofing a wood with towers would
#: score against the census and lose the district.
GROVE_CAMS = ("GroveRoadCam18", "MushroomGroveCam14", "GardenRight05",
              "GardenLeft04")

#: The founder's reference, classified from its own pixels, is built 71.5%. A
#: frame already past that has a city over it and its remaining green is the
#: frame breathing, not a defect.
BENCH_BUILT = 71.5

#: Arcs where VEGETATION holds a ceiling and there is real room above it:
#: (camera, bearings, the elevation the leaf tops out at). Measured per column
#: against `layout_v2.ALL` -- `kit_layout` cannot measure this itself, because
#: `layout_v2` imports this module and the census imports `layout_v2`, so the
#: table is generated from a census run and recorded here the way
#: `HEADROOM_FRAMES` is.
#:
#: FILTERED FOUR WAYS BEFORE IT WAS WRITTEN DOWN, and the filters are the
#: difference between a pass and a rash of towers. The full scan found 38 arcs
#: over 22 cameras; what is left is the arcs that are
#:   below `BENCH_BUILT`      -- a frame already past the reference is left alone
#:   not in `GROVE_CAMS`      -- a wood keeps its canopy
#:   inside 0.9 of the half-fov -- past that is the frame's outer rim, where a
#:                              tower is peripheral clutter rather than a
#:                              skyline. THIS WAS A FLAT 35 DEGREES and the
#:                              flat number cost the two frames that most
#:                              needed it: `FlankLeftCam08` is the third-worst
#:                              frame in the suite and its largest reachable
#:                              arc runs 35.6 to 43.9, and the founder's own
#:                              reference had a six-column arc at -47. A
#:                              fraction of the frame is the same judgement
#:                              applied to a 90 and a 100 degree lens; 35 was
#:                              the same judgement applied to neither.
#:   at least 6 columns wide  -- narrower is a gap between two canopies, and
#:                              filling it buys a column and costs a building
GREEN_CEILINGS = (
    # MEASURED WITH THE KIT'S OWN CEILING BATCHES SWITCHED OFF, and that is not
    # a detail. Re-measuring this table against the world as it stands drops
    # every arc these batches already answered -- because they answered it --
    # which removes the stand, which re-opens the arc. A target list read
    # through its own results oscillates. Done naively it took `green_ceiling`
    # from 139 placements to 42 and put `ClockQuarterCam13` back where it
    # started. The scan is run against `PASSES` minus `ceiling_break`,
    # `green_ceiling` and `depth_stand`, so the arcs are the ones the world
    # has WITHOUT the kit's ceiling work, which is a stable thing to aim at.
    #
    # Arcs are clipped to 0.9 of each camera's own half-fov; the built% is the
    # frame without the kit's ceiling batches.
    ("ClockQuarterCam13", (-19.9, 12.4), 21.5),     # 44 cols, edge +29.4, built 18.3%
    ("ClockQuarterCam13", (14.6, 31.1), 11.4),      # 23 cols, edge +29.4, built 18.3%
    ("ClockQuarterCam13", (-40.5, -34.9), 15.7),    # 14 cols, edge +29.4, built 18.3%
    ("ClockQuarterCam13", (36.4, 40.5), 9.9),       # 12 cols, edge +29.4, built 18.3%
    ("WaterGardenCam15", (16.9, 35.6), 18.8),       # 26 cols, edge +29.4, built 31.7%
    ("FlankLeftCam08", (35.6, 40.5), 17.0),         # 12 cols, edge +29.4, built 33.3%
    ("FlankLeftCam08", (2.6, 6.4), 23.9),           #  6 cols, edge +29.4, built 33.3%
    ("ReverseCam03", (-28.1, -13.9), 16.4),         # 20 cols, edge +29.4, built 45.0%
    ("ReverseCam03", (16.9, 23.6), 15.0),           # 10 cols, edge +29.4, built 45.0%
    ("ReverseCam03", (5.6, 9.4), 11.5),             #  6 cols, edge +29.4, built 45.0%
    ("HamletCam17", (0.4, 40.5), 25.2),             # 60 cols, edge +29.4, built 46.7%
    ("TeaTerraceCam16", (-16.9, -4.1), 25.1),       # 18 cols, edge +29.4, built 50.8%
    ("TeaTerraceCam16", (37.1, 40.5), 19.8),        # 11 cols, edge +29.4, built 50.8%
    ("TeaTerraceCam16", (22.9, 29.6), 19.8),        # 10 cols, edge +29.4, built 50.8%
    ("TeaTerraceCam16", (12.4, 16.9), 10.1),        #  7 cols, edge +29.4, built 50.8%
    ("HeroCam_V2_MarbleReference", (-36.2, -23.8), 29.1),  # 16 cols, edge +33.8, built 56.7%
    ("HeroCam_V2_MarbleReference", (-45.0, -43.8), 29.1),  #  8 cols, edge +33.8, built 56.7%
    ("PathCam02", (-31.1, -27.4), 21.0),            #  6 cols, edge +29.4, built 60.8%
    ("WorldCam12", (-41.0, -24.1), 16.8),           # 23 cols, edge +30.2, built 63.3%
)

#: Filled by `_green_ceiling`.
GREEN_CHOSEN = []


def _green_ceiling(bands):
    """Built crowns where a leaf holds a ceiling that has room above it.

    `_ceiling_break` answers the census's headline -- ONE piece holding a third
    of a frame. This answers the quieter half of the same reading: a frame can
    be roofed by twenty different canopies and still be a frame with no city in
    it, and no single-piece number ever says so.

    TWO STANDS AN ARC, NOT A ROW. The point is a skyline behind a canopy, not a
    hedge of towers replacing it; `spots_on_bearing` spreads them and
    `BREAK_OVERSHOOT` keeps them from becoming the ceiling themselves. Several
    arcs are expected to come back empty -- `HamletCam17` and the near half of
    `ClockQuarterCam13` are walled by other cameras -- and `SKIPPED` says so
    rather than the batch quietly shrinking.
    """
    out, taken, chosen = [], [], []
    spells = KIT.spellings(want=16, min_height_uu=4200.0)
    ladder = [h for _c, h in spells]
    for cam, arc, el in GREEN_CEILINGS:
        if cam in GROVE_CAMS:
            continue
        # AN ARC WITH TWO OWNERS IS AN ARC BOTH DO BADLY. `CEILING_BREAK` and
        # this table are measured the same way and overlap where a frame's
        # biggest green run IS its boss: `ClockQuarterCam13`'s (-19.9, 12.4) is
        # `ceiling_break`'s (-19.9, 10.9). Both batches then chased the same
        # ground, `ceiling_break` took the good spots and this one took what was
        # left over -- and the frame went from 75.0% built to 59.2%. The boss
        # table runs first and owns its arcs.
        if any(b_cam == cam and arc[0] < b_arc[1] and b_arc[0] < arc[1]
               for b_cam, _boss, b_arc, _el in CEILING_BREAK):
            SKIPPED.append("%s: %s is ceiling_break's arc; not chased twice"
                           % (cam, arc))
            continue
        got = spots_on_bearing(cam, bands, arc, el, ladder, 2, taken)
        if not got:
            SKIPPED.append("%s: no clear ground on %s topping between %+.1f and "
                           "%+.1f" % (cam, arc, el + BREAK_MARGIN,
                                      frame_edge(cam) + BREAK_OVERSHOOT))
        for (x, y, th, top, r, h) in got:
            chosen.append((x, y, th, top, r, cam, h))
    # a different offset into the spelling table from `_ceiling_break`, so the
    # two passes do not put the same tower in two frames of the same district
    off = len(BREAK_CHOSEN)
    for i, (x, y, _th, _top, _r, _cam, want_h) in enumerate(chosen):
        chain, _h = _spelling_of(spells, want_h, i + off)
        out += KIT.stack(chain, (x, y, 0.0), rot=(0.0, float((i * 41 + 20) % 360), 0.0),
                         label="KitGreen%02d" % (i + 1), band="V2_Skyline")
        out += KIT.placements_for("WL_Ground_Plaza_Medallion", (x, y, 0.0),
                                  label="KitGreen%02d_Base" % (i + 1))
    GREEN_CHOSEN[:] = chosen
    return out


#: Empty ground the world's own `tools/emptiness.py` found, at the distance
#: `tools/skyline.py` calls the thinnest part of the silhouette: (centre, the
#: bearing the wall runs along, the cameras that can see it). The regions
#: `emptiness.py` marks "castle sightline, deliberate" are NOT in this list and
#: must not be -- a sightline is empty on purpose.
#:
#: 180-360 M IS THE WORLD'S THINNEST BAND, mismatch #3 in its own handoff: tops
#: at +7.9 and +5.6 degrees against +14.0 nearer in. A 40 m precinct at 300 m
#: reads at about +8, which is exactly that band and exactly why the batch goes
#: here rather than somewhere it would score better on a ceiling.
PRECINCTS = (
    ((-20606.0, -24316.0), 20.0, "ReverseCam03 +37, ScaleCam07 +40, ClockQuarterCam13 +5"),
    ((14730.0, 29419.0), -65.0, "HeroCam_V2_MarbleReference +26, PlayerCam01 +26, PathCam02 +29"),
    ((12518.0, -24042.0), 105.0, "ReverseCam03 -25, GardenLeft04 +26, ScaleCam07 -28"),
)

#: uu. A curtain run is 13.6 m and butts end to end into any length, so a bay
#: is its own footprint and nothing here is a guess.
BAY_UU = 1360.0

#: Filled by `_castle_precinct`.
PRECINCT_CHOSEN = []


def _castle_precinct(bands):
    """A curtain wall with its towers, its gate and its ruin, on empty ground.

    FIVE FAMILIES HAD ZERO PRESENCE IN THE WORLD -- walls, thresholds, civic,
    hero, and every one of the nine weathered variants. A kit that ships a
    postern gate nobody can walk to is a catalogue, not content, and the
    weathering axis in particular was built to say that a wall has a history:
    an unbroken pristine curtain says the opposite of what it was made for.

    IT MOVED NO INSTRUMENT, AND THAT IS RECORDED HERE RATHER THAN GLOSSED.
    This batch was placed aiming at mismatch #3 -- the 180-360 m ring is the
    thinnest part of the world's silhouette -- and measured against that ring
    afterwards it did nothing worth a number:

        ring 180-360 m   p50 top +0.4 -> +0.5    built 65.0% -> 65.3%

    631 pieces into a ring that already holds 67,608 cannot move a percentile,
    and the 33-camera census is unchanged to the decimal because a 40 m
    precinct at 300 m reads at +8 degrees against frame edges of +29. The
    original version of this docstring said the batch "fills" that band. It
    does not, the measurement above is why, and an overclaim in a comment is
    the same defect as an overclaim in a UI.

    WHAT IT IS ACTUALLY FOR, then, stated as the coverage it is: five families
    had zero presence in the world and three audited-empty regions had no built
    edge. Both are real gaps in a castle world and neither is a silhouette
    defect. Judge this batch on that, not on a census delta it was never going
    to produce.

    The ruined stretch is deliberate and it is placed at the FAR end of each
    run, so a viewer reads the wall as intact where it meets the world and
    failing where it runs out. A wall aged evenly reads as a texture; a wall
    aged at one end reads as a history.
    """
    out, chosen = [], []
    for n, (centre, bearing, seen) in enumerate(PRECINCTS):
        spot = _nudge(bands, centre[0], centre[1], "Precinct%d" % (n + 1),
                      max_neighbours=48, step=1600.0, tries=12)
        if spot is None:
            continue
        cx, cy = spot
        rad = math.radians(bearing)
        ax, ay = math.cos(rad), math.sin(rad)          # along the wall
        nx, ny = -ay, ax                               # into the precinct
        tag = "KitPrecinct%d" % (n + 1)
        BAYS = 9
        half = (BAYS - 1) / 2.0
        for i in range(BAYS):
            t = (i - half) * BAY_UU
            x, y = cx + ax * t, cy + ay * t
            far = i >= BAYS - 3                        # the stretch that failed
            if i == 0 or i == BAYS - 1:
                aid = "WL_Wall_Corner_Bastion"
            elif i == BAYS // 2:
                aid = "WL_Wall_Postern_Gate"
            elif i % 3 == 1:
                aid = "WL_Wall_Mural_Tower__ruined" if far else "WL_Wall_Mural_Tower"
            else:
                aid = "WL_Wall_Curtain_Run__aged" if far else "WL_Wall_Curtain_Run"
            out += KIT.placements_for(aid, (x, y, 0.0), rot=(0.0, bearing, 0.0),
                                      label="%s_Bay%d" % (tag, i))
        # inside the wall: a colonnade along it, and the ceremonial arch on the
        # postern's own axis so the gate leads somewhere
        for j, aid in enumerate(("WL_Colonnade_Arcade", "WL_Colonnade_Straight",
                                 "WL_Colonnade_Arcade__ruined")):
            t = (j - 1) * 2400.0
            x = cx + ax * t + nx * 3200.0
            y = cy + ay * t + ny * 3200.0
            out += KIT.placements_for(aid, (x, y, 0.0), rot=(0.0, bearing, 0.0),
                                      label="%s_Court%d" % (tag, j))
        out += KIT.placements_for("WL_Arch_Ceremonial",
                                  (cx + nx * 1800.0, cy + ny * 1800.0, 0.0),
                                  rot=(0.0, bearing + 90.0, 0.0),
                                  label="%s_Arch" % tag)
        chosen.append((cx, cy, bearing, seen))
    PRECINCT_CHOSEN[:] = chosen
    return out


#: (camera, distance down its axis, lateral, the stair spelling, why). A GARDEN
#: LEVEL IS A HELD EDGE PLUS A WAY UP, and both halves are in the manifest's own
#: socket grammar: a retaining run publishes `top_route` at z=310 and every
#: T2 flight publishes `bottom_route` at z=0 and `top_route` at z=310, so a
#: flight and the edge it serves meet at a number neither of them guessed.
#:
#: SEVEN OF THE EIGHT STAIR MODULES HAD NEVER BEEN PLACED. The kit's own note on
#: them, learned the expensive way and recorded in the forge's README, is that
#: stairs to a flat plane are stairs to nowhere -- so this batch does not place
#: a flight anywhere it has not first built the edge for it to climb.
GARDEN_LEVELS = (
    ("WaterGardenCam15", 10000.0, 0.0, "WL_Stair_Quarter_Landing",
     "the water gardens' own terrace, 100 m down the camera that names them"),
    ("GlassPavilionCam28", 8000.0, -4000.0, "WL_Stair_Curved",
     "the pavilion's approach, where the ground already steps"),
    ("GlassPavilionCam28", 10000.0, 4000.0, "WL_Stair_HalfTurn",
     "a second level behind the first, so the flight has two storeys to climb"),
)

#: uu. One terrace level, and it is the retaining run's own `top_route`.
LEVEL_UU = 310.0

#: Filled by `_garden_levels`.
LEVEL_CHOSEN = []


def _garden_levels(bands):
    """Held edges with a way up them, in the districts that are all planting.

    The world's garden cameras are the densest ground in it -- `GardenLeft04`
    and `GardenRight05` have no clear axis at all -- which is correct for a
    garden and is also why they have no STRUCTURE. A garden district that is
    only planting reads as a park; what makes it a garden is a level held by a
    wall you can walk along and reach by a flight.

    Every module here meets the one below it at a published socket, never at a
    number typed into this file: `top_route` on the retaining runs is 310 uu,
    which is exactly the `top_route` of a T2 flight and the `landing` of the
    half-turn. `WL_Stair_HalfTurn` climbs two of them, so its site gets the
    second level its own grammar asks for.

    LIKE `_castle_precinct`, THIS MOVED THE CENSUS BY NOTHING, measured after
    the fact: mean built 74.82% before and after, to the decimal. It is ground
    structure 3 to 6 m tall and the frames it stands in are roofed at +29
    degrees, so it was never going to hold a column. Judge it on what it is:
    seven of the eight stair modules had never been placed, and the two garden
    cameras with the densest ground in the world had no built structure at all.
    """
    out, chosen = [], []
    for n, (cam, dist, lat, flight, why) in enumerate(GARDEN_LEVELS):
        gx, gy = on_axis(cam, dist, lat)
        spot = _nudge(bands, gx, gy, "GardenLevel%d" % (n + 1),
                      max_neighbours=64, step=1500.0, tries=14)
        if spot is None:
            continue
        cx, cy = spot
        tag = "KitLevel%d" % (n + 1)
        bearing = float((n * 37) % 360)
        rad = math.radians(bearing)
        ax, ay = math.cos(rad), math.sin(rad)
        nx, ny = -ay, ax
        RUN = 800.0
        two = flight == "WL_Stair_HalfTurn"
        # the held edge: runs along the bearing, turned in at one end and out
        # at the other, with a curved section so the wall is not a ruler
        for i in range(-3, 4):
            t = RUN * i
            x, y = cx + ax * t, cy + ay * t
            if i == -3:
                aid = "WL_Garden_Retaining_Corner_In"
            elif i == 3:
                aid = "WL_Garden_Retaining_Corner_Out"
            elif i == 2:
                aid = "WL_Garden_Retaining_Curved"
            elif i == 0:
                continue                       # the flight goes here
            else:
                aid = "WL_Garden_Retaining_Run"
            out += KIT.placements_for(aid, (x, y, 0.0), rot=(0.0, bearing, 0.0),
                                      label="%s_Edge%d" % (tag, i + 3))
        # the way up, in the gap the edge left for it
        out += KIT.placements_for(flight, (cx, cy, 0.0),
                                  rot=(0.0, bearing + 180.0, 0.0),
                                  label="%s_Flight" % tag)
        if two:
            # a second held edge one level up, which is what a half-turn climbs
            for i in (-2, -1, 1, 2):
                x = cx + ax * RUN * i + nx * 1600.0
                y = cy + ay * RUN * i + ny * 1600.0
                out += KIT.placements_for("WL_Garden_Retaining_Run",
                                          (x, y, LEVEL_UU), rot=(0.0, bearing, 0.0),
                                          label="%s_Upper%d" % (tag, i + 2))
        top = LEVEL_UU * (2.0 if two else 1.0)
        # what the level is FOR: something to stand on it and look from
        out += KIT.placements_for("WL_Garden_Overlook",
                                  (cx + nx * 900.0, cy + ny * 900.0, LEVEL_UU),
                                  rot=(0.0, bearing + 90.0, 0.0),
                                  label="%s_Overlook" % tag)
        for sgn in (-1.0, 1.0):
            out += KIT.placements_for("WL_Garden_Planter_Wall",
                                      (cx + ax * sgn * 1500.0 + nx * 1900.0,
                                       cy + ay * sgn * 1500.0 + ny * 1900.0, top),
                                      rot=(0.0, bearing, 0.0),
                                      label="%s_Bed%d" % (tag, 1 if sgn < 0 else 2))
        out += KIT.placements_for("WL_Garden_Gate_Threshold",
                                  (cx + ax * 2600.0, cy + ay * 2600.0, 0.0),
                                  rot=(0.0, bearing + 90.0, 0.0),
                                  label="%s_Gate" % tag)
        out += KIT.placements_for("WL_Detail_Balustrade_Run",
                                  (cx + nx * 77.0, cy + ny * 77.0, LEVEL_UU),
                                  rot=(0.0, bearing, 0.0),
                                  label="%s_Rail" % tag)
        chosen.append((cx, cy, flight, why))
    LEVEL_CHOSEN[:] = chosen
    return out


#: (camera, distance down its axis, lateral, why). A LANE IS THE ONE PLACE THE
#: WHOLE KIT MEETS: ground that is laid rather than assumed, houses with three
#: different roofs on it, and the pieces that only exist BECAUSE there is a
#: facade to carry them.
STREET_SITES = (
    ("ColossalKeyCam25", 5000.0, 3000.0, "the only clear axis in the eastern quarter"),
    ("LanternLaneCam27", 9000.0, -3000.0, "the lantern hamlets, which the census says are 83% built and have no street"),
    ("GiantBloomCam29", 7000.0, 3000.0, "behind the bloom, where the hamlet thins out"),
)

#: uu. A house is 6.4-7.4 m on plan and a lane wants air between its doors.
PLOT_UU = 1000.0

#: Filled by `_street_fabric`.
STREET_CHOSEN = []


def _street_fabric(bands):
    """A lane: laid ground, three roofs, and the pieces that need a wall.

    THE MOUNTED FAMILY IS THE POINT. `Roof_Dormer`, `Roof_Chimney`,
    `House_Shopfront`, `Detail_Oriel_Bay` and `Detail_Balcony_Bracket` publish
    a `back` socket and NO `bottom` -- they do not stand on the ground, they
    are carried by a facade, and until this batch there was no facade in
    Wonderland carrying one. Five modules that cannot be placed alone is not a
    gap in the layout; it is a gap in the world's building stock.

    Every mount height is the HOST's published socket, never a guess: the
    gabled house publishes `eaves` at 610 uu and the hipped at 915, so that is
    where the dormer and the chimney go, and the chimney tops out at 1,351
    against a 1,257 house because a stack rises above its ridge.

    The ground is laid rather than assumed -- a verge between kerbs, a runnel
    down the fall, tree grates where the planting goes, a corner at each end,
    and broad steps where the lane changes level. `Ground_Steps_Broad` is three
    0.310 m risers, which is the same `RISER_M` every stair in the kit uses, so
    the lane's level change and a garden's are the same height by construction.

    THE THIRD BATCH RUNNING TO A CENSUS NULL, and stated for the third time
    rather than left for a reader to notice: mean built 74.82% before and
    after, to the decimal. A house is 10 to 13 m and these lanes stand 50 to
    110 m out under frames roofed at +29 degrees. Ground fabric does not hold
    ceilings. What it does is spend 24 modules that had never been placed, five
    of which CANNOT be placed alone.
    """
    out, chosen = [], []
    for n, (cam, dist, lat, why) in enumerate(STREET_SITES):
        gx, gy = on_axis(cam, dist, lat)
        spot = _nudge(bands, gx, gy, "Street%d" % (n + 1),
                      max_neighbours=64, step=1600.0, tries=14)
        if spot is None:
            continue
        cx, cy = spot
        tag = "KitStreet%d" % (n + 1)
        bearing = float((n * 53 + 15) % 360)
        rad = math.radians(bearing)
        ax, ay = math.cos(rad), math.sin(rad)      # along the lane
        nx, ny = -ay, ax                           # across it, to the houses
        HOUSES = ("WL_House_Gabled", "WL_House_Hipped", "WL_House_Jettied")
        EAVES = {"WL_House_Gabled": 610.0, "WL_House_Hipped": 915.0,
                 "WL_House_Jettied": 915.0}
        for i in range(-2, 3):
            t = PLOT_UU * i
            # ---- the ground, laid ------------------------------------------
            gx2, gy2 = cx + ax * t, cy + ay * t
            if i == -2 or i == 2:
                lay = "WL_Ground_Kerb_Corner"
            elif i == 0:
                lay = "WL_Ground_Steps_Broad"
            else:
                lay = "WL_Ground_Drain_Channel"
            out += KIT.placements_for(lay, (gx2, gy2, 0.0), rot=(0.0, bearing, 0.0),
                                      label="%s_Lay%d" % (tag, i + 2))
            out += KIT.placements_for("WL_Ground_Verge_Run",
                                      (gx2 - nx * 620.0, gy2 - ny * 620.0, 0.0),
                                      rot=(0.0, bearing, 0.0),
                                      label="%s_Verge%d" % (tag, i + 2))
            if i % 2 == 0:
                out += KIT.placements_for("WL_Ground_Tree_Grate",
                                          (gx2 - nx * 900.0, gy2 - ny * 900.0, 0.0),
                                          rot=(0.0, bearing, 0.0),
                                          label="%s_Grate%d" % (tag, i + 2))
            else:
                out += KIT.placements_for("WL_Ground_Step_Single",
                                          (gx2 - nx * 900.0, gy2 - ny * 900.0, 0.0),
                                          rot=(0.0, bearing, 0.0),
                                          label="%s_Step%d" % (tag, i + 2))
            # ---- the house, and what its wall carries -----------------------
            host = HOUSES[(i + 2) % 3]
            hx = gx2 + nx * 1500.0
            hy = gy2 + ny * 1500.0
            face = bearing + 180.0                 # the wall that faces the lane
            out += KIT.placements_for(host, (hx, hy, 0.0), rot=(0.0, face, 0.0),
                                      label="%s_House%d" % (tag, i + 2))
            # the facade plane, half a plan depth in front of the house centre
            fx = hx - nx * (KIT.asset(host)["size_uu"][1] * 0.5)
            fy = hy - ny * (KIT.asset(host)["size_uu"][1] * 0.5)
            eaves = EAVES[host]
            carrier = "%s_House%d" % (tag, i + 2)
            if host == "WL_House_Hipped":
                out += carried(KIT.placements_for(
                    "WL_Roof_Chimney", (hx, hy, eaves), rot=(0.0, face, 0.0),
                    label="%s_Stack%d" % (tag, i + 2)), carrier)
            else:
                out += carried(KIT.placements_for(
                    "WL_Roof_Dormer", (fx, fy, eaves), rot=(0.0, face, 0.0),
                    label="%s_Dormer%d" % (tag, i + 2)), carrier)
            if i in (-1, 1):
                out += carried(KIT.placements_for(
                    "WL_House_Shopfront", (fx, fy, 0.0), rot=(0.0, face, 0.0),
                    label="%s_Shop%d" % (tag, i + 2)), carrier)
            if i == 0:
                out += carried(KIT.placements_for(
                    "WL_Detail_Oriel_Bay", (fx, fy, 380.0), rot=(0.0, face, 0.0),
                    label="%s_Oriel" % tag), carrier)
            if i == -2:
                out += carried(KIT.placements_for(
                    "WL_Detail_Balcony_Bracket", (fx, fy, 420.0),
                    rot=(0.0, face, 0.0),
                    label="%s_Balcony" % tag), carrier)
        # ---- the ends: a threshold each way, and the lane's punctuation -----
        for sgn, aid in ((-1.0, "WL_Gatehouse_Screen"), (1.0, "WL_Arch_Trefoil_Screen")):
            out += KIT.placements_for(aid, (cx + ax * sgn * 3000.0,
                                            cy + ay * sgn * 3000.0, 0.0),
                                      rot=(0.0, bearing + 90.0, 0.0),
                                      label="%s_End%d" % (tag, 1 if sgn < 0 else 2))
        out += KIT.placements_for("WL_Arch_Garden_Rose",
                                  (cx - nx * 2600.0, cy - ny * 2600.0, 0.0),
                                  rot=(0.0, bearing, 0.0), label="%s_RoseArch" % tag)
        out += KIT.placements_for("WL_Detail_Screen_Filigree",
                                  (cx - nx * 1900.0, cy - ny * 1900.0, 0.0),
                                  rot=(0.0, bearing, 0.0), label="%s_Screen" % tag)
        out += KIT.placements_for("WL_Detail_Pinnacle_Grand",
                                  (cx + ax * 2200.0 - nx * 1900.0,
                                   cy + ay * 2200.0 - ny * 1900.0, 0.0),
                                  rot=(0.0, bearing, 0.0), label="%s_Pinnacle" % tag)
        for sgn in (-1.0, 1.0):
            out += KIT.placements_for("WL_Detail_Newel_Urn",
                                      (cx + ax * sgn * 2200.0 - nx * 620.0,
                                       cy + ay * sgn * 2200.0 - ny * 620.0, 31.0),
                                      rot=(0.0, bearing, 0.0),
                                      label="%s_Newel%d" % (tag, 1 if sgn < 0 else 2))
        chosen.append((cx, cy, bearing, why))
    STREET_CHOSEN[:] = chosen
    return out


#: uu. A `WL_Bridge_Sky` is a 32 m span whose ends are published at z 402. Two
#: stands carry one when their centres are far enough apart that the deck
#: reaches past both shafts and near enough that it does not hang in air: a
#: stand's shaft is about 400 uu of radius, so the span plus two half-shafts is
#: the far end of the window and the span itself is the near one. Outside it the
#: bridge is not spanning anything and this batch does not place one.
SPAN_UU = 3236.0
SPAN_WINDOW = (SPAN_UU, SPAN_UU + 880.0)

#: uu. Where a sky bridge's soffit sits on the shafts it links. Every spelling
#: in `KIT.spellings` is 5,400 uu or taller, so a deck at 30 m is inside the
#: shaft of both ends with room above and below.
SPAN_Z = 3000.0

#: Filled by `_sky_bridges`.
SPAN_CHOSEN = []


def _sky_bridges(bands):
    """The kit's own towers, linked -- and the only batch that could move a frame.

    `WL_Bridge_Sky` publishes `end_a` and `end_b` and NO `bottom`: like the
    dormers, it does not stand on the ground. Unlike the dormers it needs TWO
    carriers, and the only way one exists in Wonderland is if two stands
    happen to be the right distance apart -- which `spots_on_bearing` never
    aimed for, because it was placing towers to fill ceilings.

    So this reads the stands back out of the batches that made them and links
    the pairs whose spacing the module can actually reach. A bridge whose ends
    do not land on a shaft is a bridge hanging in the air, and `SPAN_WINDOW` is
    the span the manifest publishes rather than a tolerance chosen to make more
    pairs qualify.

    Both ends are `carried()` by their stands, so if a screen ever removes one
    tower the bridge goes with it rather than being left slung from nothing.
    """
    out, chosen, taken = [], [], set()
    stands = {}
    for band in bands:
        for it in band:
            lab = it.get("label") or ""
            if not it.get("kit"):
                continue
            head = lab.split("_")[0]
            if not head.startswith(("KitDepth", "KitBreak", "KitGreen",
                                    "KitClockTower")):
                continue
            stands.setdefault(head, (it["pos"][0], it["pos"][1], lab))
    keys = sorted(stands)
    lo, hi = SPAN_WINDOW
    for i, a in enumerate(keys):
        if a in taken:
            continue
        for b in keys[i + 1:]:
            if b in taken:
                continue
            ax, ay, alab = stands[a]
            bx, by, blab = stands[b]
            d = math.hypot(bx - ax, by - ay)
            if not (lo <= d <= hi):
                continue
            mx, my = (ax + bx) * 0.5, (ay + by) * 0.5
            bearing = math.degrees(math.atan2(by - ay, bx - ax))
            span = carried(KIT.placements_for(
                "WL_Bridge_Sky", (mx, my, SPAN_Z), rot=(0.0, bearing, 0.0),
                label="KitSpan_%s_%s" % (a, b), band="V2_Skyline"), alab)
            for pl in span:
                pl["carried_also_by"] = blab
            out += span
            chosen.append((a, b, d, mx, my))
            taken.add(a)
            taken.add(b)
            break
    SPAN_CHOSEN[:] = chosen
    return out


#: uu. The wall-walk a curtain run publishes, and the height
#: `WL_Wall_Stair_Flight` climbs to. Not a number chosen here: both come from
#: the manifest, and the stair's note says "20 risers of 0.310 m reaching the
#: 6.20 m wall-walk exactly".
WALK_UU = 620.0

#: uu. T1, the low terrace `Stair_Ceremonial`, `Stair_Garden` and
#: `Ramp_Terrace` all climb to -- 1.55 m, deliberately off the kit's 0.310 m
#: riser because a ceremonial rise is shallower than a working one.
T1_UU = 155.0

#: What each precinct gets that the others do not, so three walled enclosures
#: do not read as one enclosure built three times.
PRECINCT_SPECIAL = ("WL_Gatehouse_Twin", "WL_Arch_Twin_Tiered",
                    "WL_Gatehouse_Twin__aged")

#: Filled by `_precinct_works`.
WORKS_CHOSEN = []


def _precinct_works(bands):
    """What a wall is for: a way up it, a way through it, and a court behind it.

    `_castle_precinct` built three curtain walls and left them as scenery. This
    is the sixteen modules that turn one into a place, and every one of them
    keys into something already standing at a socket the manifest publishes:

      `WL_Wall_Stair_Flight`   20 risers to `walk` at 620 -- the exact height a
                               curtain run publishes. The one module in the kit
                               whose whole purpose is another module.
      `WL_Bridge_Flying`       a raking brace with a `back` socket, leaning on
                               the wall's outer face; the kit's only diagonal
      `WL_Colonnade_Curved`    authored about the PLAZA's centre, not its own:
                               its bbox runs x 1887..2575, so six copies at one
                               position, 60 degrees apart, close a ring
      `WL_Stair_Ceremonial`    ) three ways onto that ring's low platform, all
      `WL_Ramp_Terrace`        ) climbing to T1 -- a stair, a ramp and a garden
      `WL_Stair_Garden`        ) step, because a court has more than one door

    THE RUINED HALF IS PLACED WITH THE RUINED HALF. `_castle_precinct` weathers
    the far end of each wall run; the overgrown house, the overgrown retaining
    run, the broken balustrade and the aged tower stub go there and nowhere
    else, so the precinct reads as one place with a history rather than a new
    wall with old bits sprinkled through it.
    """
    out, chosen = [], []
    for n, (cx, cy, bearing, _why) in enumerate(PRECINCT_CHOSEN):
        rad = math.radians(bearing)
        ax, ay = math.cos(rad), math.sin(rad)
        nx, ny = -ay, ax
        tag = "KitWorks%d" % (n + 1)

        def at(along, into, z=0.0):
            return (cx + ax * along + nx * into, cy + ay * along + ny * into, z)

        # up the wall, from inside. The stair's flat back is its y = 0 and a
        # curtain run is 450 deep, so it stands on the inner face.
        out += KIT.placements_for("WL_Wall_Stair_Flight", at(-BAY_UU, 225.0),
                                  rot=(0.0, bearing, 0.0),
                                  label="%s_WallStair" % tag)
        # A SECOND WAY UP, and a different one. `WL_Stair_Straight_T3` climbs
        # `top_route` 620 -- the same wall-walk -- but it is a free flight with
        # `edge_l`/`edge_r` rather than a flat back, so it stands off the wall
        # instead of against it. Two routes onto a wall-walk is what a wall
        # with a garrison looks like; one is a fire escape.
        out += KIT.placements_for("WL_Stair_Straight_T3", at(BAY_UU * 2.0, 700.0),
                                  rot=(0.0, bearing + 180.0, 0.0),
                                  label="%s_WalkStair" % tag)
        # and a brace against the outer one
        out += KIT.placements_for("WL_Bridge_Flying", at(BAY_UU, -1400.0),
                                  rot=(0.0, bearing + 90.0, 0.0),
                                  label="%s_Brace" % tag)
        # through it
        out += KIT.placements_for(PRECINCT_SPECIAL[n % len(PRECINCT_SPECIAL)],
                                  at(0.0, -2600.0), rot=(0.0, bearing + 90.0, 0.0),
                                  label="%s_Entrance" % tag)
        # the round court behind it, on a T1 platform
        for k in range(6):
            out += KIT.placements_for("WL_Colonnade_Curved", at(0.0, 4200.0, T1_UU),
                                      rot=(0.0, bearing + 60.0 * k, 0.0),
                                      label="%s_Court%d" % (tag, k + 1))
        for aid, off, lab in (("WL_Stair_Ceremonial", 0.0, "Steps"),
                              ("WL_Ramp_Terrace", 120.0, "Ramp"),
                              ("WL_Stair_Garden", 240.0, "Postern")):
            a2 = math.radians(bearing + 90.0 + off)
            out += KIT.placements_for(
                aid, (cx + nx * 4200.0 + ax * 0.0 - math.cos(a2) * 2600.0,
                      cy + ny * 4200.0 + ay * 0.0 - math.sin(a2) * 2600.0, 0.0),
                rot=(0.0, bearing + 90.0 + off, 0.0),
                label="%s_%s" % (tag, lab))
        # a span on the court's own axis
        out += KIT.placements_for("WL_Bridge_Arc" if n else "WL_Bridge_Arc__aged",
                                  at(0.0, 2000.0), rot=(0.0, bearing + 90.0, 0.0),
                                  label="%s_Span" % tag)
        # the ruined end -- with the wall's own ruined end, never scattered
        far = BAY_UU * 3.0
        out += KIT.placements_for("WL_Tower_Base_Buttressed__aged",
                                  at(far + 1200.0, 600.0), rot=(0.0, bearing, 0.0),
                                  label="%s_Stub" % tag)
        out += KIT.placements_for("WL_House_Jettied__overgrown",
                                  at(far, 2400.0), rot=(0.0, bearing + 180.0, 0.0),
                                  label="%s_Ruin" % tag)
        for i in (0, 1):
            out += KIT.placements_for(
                "WL_Garden_Retaining_Run__overgrown",
                at(far - 800.0 * i, 1500.0), rot=(0.0, bearing, 0.0),
                label="%s_Overgrown%d" % (tag, i + 1))
            out += KIT.placements_for(
                "WL_Detail_Balustrade_Run__broken",
                at(far - 800.0 * i, 1500.0 + 77.0), rot=(0.0, bearing, 0.0),
                label="%s_Broken%d" % (tag, i + 1))
        chosen.append((cx, cy, bearing, PRECINCT_SPECIAL[n % len(PRECINCT_SPECIAL)]))
    WORKS_CHOSEN[:] = chosen
    return out


PASSES = (("tea_terrace", _tea_terrace), ("water_court", _water_court),
          ("depth_stand", _depth_stand), ("clock_quarter", _clock_quarter),
          ("hamlet_street", _hamlet_street),
          ("ceiling_break", _ceiling_break),
          ("green_ceiling", _green_ceiling),
          ("castle_precinct", _castle_precinct),
          ("garden_levels", _garden_levels),
          ("street_fabric", _street_fabric),
          ("precinct_works", _precinct_works),
          ("sky_bridges", _sky_bridges))


#: Every placement a screen refused, with the camera and the numbers.
REFUSED = []


def carried(placements, host_label):
    """Mark placements as carried by a host, so a screen cannot orphan them.

    `Roof_Dormer`, `Roof_Chimney`, `House_Shopfront`, `Detail_Oriel_Bay` and
    `Detail_Balcony_Bracket` publish a `back` socket and no `bottom`: they are
    carried by a facade and have no meaning without one. `_screen` works on
    placements, and a dormer is a short placement that passes every test its
    host fails -- so when `KitStreet3_House0` was refused for standing 644 uu
    from FloatingStairCam26, its dormer, its shopfront and its oriel stayed
    exactly where they were, hanging in the air where a house used to be.

    `verify_kit_bridge` found it. The fix is that a carried piece names its
    carrier and the screen drops it with them.
    """
    for p in placements:
        p["carried_by"] = host_label
    return placements


def _screen(name, band, placed=()):
    """Refuse any placement that would loom in a camera, and say which.

    RUN ON PLACEMENTS, NOT ON DECISIONS. A batch clears its CENTRE and then
    lays a retaining run 2,400 uu either side of it, so the centre passing a
    camera test says nothing about the pieces; the tea terrace stood 2,272 uu
    from TeapotCam24 for exactly that reason and `verify_kit_bridge` found it
    by walking `layout_v2.ALL` rather than by re-reading this file. So the
    enforcement lives here, downstream of every batch, where the only thing
    left to look at is where a piece actually is.
    """
    keep = []
    for p in band:
        h = 0.0
        try:
            h = KIT.height_uu(p["kit"])
        except Exception:                                  # noqa: BLE001
            pass
        # HOW HIGH IT REACHES, NOT HOW TALL IT IS. A 12 m sky bridge slung
        # between two towers 30 m up tops out at 42 m, and asking the module
        # for its height alone would have let it stand 10 m from a lens on the
        # strength of being a small module. What looms is the top.
        h += max(0.0, float(p["pos"][2]))
        bad = looms(p["pos"][0], p["pos"][1], h)
        if bad:
            REFUSED.append("%s: %s (reaches %.0f uu) is %.0f uu from %s, in "
                           "shot, and needs %.0f"
                           % (name, p["label"], h, bad[1], bad[0], bad[2]))
            continue
        keep.append(p)
    # A UNIT IS ONE THING. `kit_v2.stack` marks a spelled tower's rungs with a
    # shared `unit` because they bear on each other: refusing the crown and
    # keeping the base leaves a decapitated tower, which is worse than either
    # answer on its own. If any part of a unit was refused, the rest goes.
    gone = {p["unit"] for p in band
            if p.get("unit") and p not in keep} - {None}
    if gone:
        for p in keep:
            if p.get("unit") in gone:
                REFUSED.append("%s: %s goes with the rest of unit %s"
                               % (name, p["label"], p["unit"]))
        keep = [p for p in keep if p.get("unit") not in gone]
    # SECOND PASS: nothing carried may outlive its carrier. Run to a fixed
    # point, because a carrier can itself be carried.
    #
    # A CARRIER CAN BE IN AN EARLIER BATCH. `_sky_bridges` links stands that
    # `depth_stand` and `clock_quarter` made, so a screen that looked only at
    # its own batch declared every bridge an orphan and refused all five.
    # `placed` is everything the passes before this one kept.
    outside = {p["label"] for band0 in placed for p in band0}
    while True:
        alive = {p["label"] for p in keep} | outside
        orphans = [p for p in keep
                   if p.get("carried_by") and p["carried_by"] not in alive]
        if not orphans:
            break
        for p in orphans:
            REFUSED.append("%s: %s is carried by %s, which was refused"
                           % (name, p["label"], p["carried_by"]))
        drop = {p["label"] for p in orphans}
        keep = [p for p in keep if p["label"] not in drop]
    return keep


def build(existing_bands=()):
    """Every batch, as a list of bands in `layout_v2`'s own shape.

    `existing_bands` is what the layout has already declared, so a batch can
    refuse ground that is taken. It is passed IN rather than imported, because
    `layout_v2` imports this module and a module cannot import the thing that
    is halfway through importing it.
    """
    global BATCHES
    BATCHES = []
    out = []
    del REFUSED[:]
    for name, fn in PASSES:
        # EACH PASS SEES WHAT THE ONES BEFORE IT PLACED. `_sky_bridges` has to
        # -- it links stands the earlier batches made, and given only the
        # world's own bands it found none and placed nothing. It also stops the
        # later batches crowding ground the earlier ones already took.
        band = _screen(name, fn(tuple(existing_bands) + tuple(out)), out)
        BATCHES.append((name, len(band)))
        if band:
            out.append(band)
    return out


def summary(bands):
    by = {}
    for band in bands:
        for it in band:
            by[it["band"]] = by.get(it["band"], 0) + 1
    return by
