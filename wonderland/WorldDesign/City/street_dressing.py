#!/usr/bin/env python3
"""SD01 -- the city's streets get lived in: flower beds and lamps along every street edge (2026-09-16).

THE GAP. The 24-camera survey (evidence 2026-09-16-SC01) found the city streets -- most of what a visitor walks --
grey and EMPTY. SC01/LOOK02 fixed the grey. This fixes the empty: the Bible's streets overflow with flowers and are
lit by lamps, and ours had nothing between the paving and the walls.

WHERE, measured not scattered. street_census.py found 600 street slabs -- the generator's SM_terrace_platform tiles,
mostly 14 m square, 9.3 km of street in all. A street is a chain of those tiles, so a tile edge with NO neighbouring
tile across it is a real street edge, and a tile edge that meets another tile is only a seam. Dressing goes on real
edges only, which is what puts flowers against building bases and lawns and keeps the middle of every street clear.

WHAT, on each real edge:
  BEDS    forge flower runs every BED_SPACING, inset from the edge onto the paving, alternating rose, lavender and
          daisy along the street, turned to run with it;
  LAMPS   a waymarker lamp at the midpoint of every second real edge, so a street has a rhythm rather than a fence.

AS BATCHES, NOT ACTORS. Thousands of pieces world-wide would be thousands of actors; as instanced batches they are a
few dozen draws. Petals cast no shadow -- a field of tiny shadows is expensive and invisible.

ONE LAYER PER DISTRICT (by the generator's label prefix), so any district's dressing can be removed on its own.

    python street_dressing.py [PREFIX ...]      (writes sd01_<prefix>.json; no args = every district)
"""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CENSUS = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/street_census.json")
KIT = json.loads((ROOT / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
V2 = "/Game/WonderlandV2/"
WAYMARKER = V2 + "Props/Garden/SM_waymarker.SM_waymarker"
WAYMARKER_LAMP = V2 + "Props/Garden/SM_waymarker_lamp.SM_waymarker_lamp"
PLANTER = V2 + "Props/Garden/SM_planter_box.SM_planter_box"
KERB = V2 + "Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone"
SPIRAL = V2 + "Vegetation/Topiary/SM_topiary_spiral.SM_topiary_spiral"
ROSE_BUSH = V2 + "Vegetation/Roses/SM_rose_bush.SM_rose_bush"

# THREE PREVIEWS DECIDED THE PIECES.
#   sd01a  forge flower runs laid on the paving: a run is a low strip under a metre long and vanished entirely.
#   sd01b  raised flower beds (SM_flower_bed_blooms_0 at 1.5x): visible, but the bloom mesh reads as a heap of
#          dark purple lettuce, not flowers.
#   sd01c  THE HERO PLANTER, the one piece of planting in the whole world that already reads from a camera: GA05's
#          ivory trough with a gold lip, planted three rows deep with forge flower runs raised to the rim and 30%
#          taller so the planting mounds over it (its own FL01c note: at soil level and in two rows it read empty).
#          The streets now speak the corridor's language instead of inventing a weaker one.
PLANTER_SCALE = (0.78, 1.7, 0.95)                  # 164 x 357 x 67 cm, GA05's own
PLANTER_RIM = 70.0 * 0.95
ROWS = (  # (lateral offset in the trough, three runs along it)
    (-44.0, (("WL_Flower_Daisy_Run", "MI_V2_PetalViolet"), ("WL_Flower_Daisy_Run", "MI_V2_PetalPink"),
             ("WL_Flower_Daisy_Run", "MI_V2_PetalViolet"))),
    (0.0, (("WL_Flower_Rose_Run", "MI_V2_RosePink"), ("WL_Flower_Lavender_Run", "MI_V2_PetalViolet"),
           ("WL_Flower_Rose_Run", "MI_V2_RoseRed"))),
    (40.0, (("WL_Flower_Lavender_Run", "MI_V2_PetalViolet"), ("WL_Flower_Rose_Run", "MI_V2_RoseRed"),
            ("WL_Flower_Lavender_Run", "MI_V2_PetalViolet"))),
)
BED_SPACING = 420.0          # along a street edge, between pieces
SPIRAL_SCALE = 0.85          # about 2 m across, 2.9 m tall
ROSE_SCALE = 1.1
INSET = 170.0                # from the edge onto the paving -- these are bigger than a run
END_MARGIN = 180.0           # keep beds out of the corners, where streets meet
PROBE_OUT = 160.0            # how far past an edge to look for a neighbouring tile
LAMP_EVERY = 2               # a lamp on every second real edge
LAMP_SCALE = 0.42
LAMP_MIN_GAP = 900.0         # no two lamps closer than this
PASS = "SD01"
# CLEARANCE, MEASURED. Pieces are placed by geometry alone, so some land on a column, a bench or a doorway. Every
# candidate is written to SITES and tested with probe_site_clear.py (editor-world box overlap); anything that
# overlaps a standing actor other than the street itself is dropped. CLEAR_RESULT holds that probe's answer.
SITES = HERE / "sd01_sites.json"
CLEAR_RESULT = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/channel/done/sd01_clear.json")
HALF = {"bed": (185.0, 90.0, 60.0), "spiral": (95.0, 95.0, 140.0), "rose": (110.0, 110.0, 70.0), "lamp": (60.0, 60.0, 250.0)}
IGNORE = ("V2_GroundSlab",)                     # plus every street tile, by label, at run time
# THE BOX PROBE IS BLIND TO BATCHES. Generator props held in instanced batches -- 9,291 of the 10,104 props in the
# city: balustrades, columns, lamps, gate pieces, benches -- have no collision in the editor, so a box overlap walks
# straight through them. That is how two preview lamps landed on columns. So candidates are ALSO tested by distance
# against a census of every prop (vegetation_census.py over the whole city, instances included).
PROPS = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/city_props.json")
PROP_PAD = 40.0
LINEAR = ("balustrade", "hedge_mass", "hedge_block")
LINEAR_RADIUS = 80.0


def frame(t):
    th = math.radians(t["yaw"])
    return (math.cos(th), math.sin(th)), (-math.sin(th), math.cos(th))


def inside(t, px, py, slack=0.0):
    (fx, fy), (rx, ry) = frame(t)
    dx, dy = px - t["x"], py - t["y"]
    a = dx * fx + dy * fy
    b = dx * rx + dy * ry
    return abs(a) <= t["len_x"] * 0.5 + slack and abs(b) <= t["len_y"] * 0.5 + slack


def real_edges(tiles):
    """Yield (tile, edge_centre, along_unit, outward_unit, length) for every edge no other tile continues."""
    grid = defaultdict(list)
    CELL = 3000.0
    for i, t in enumerate(tiles):
        grid[(int(t["x"] // CELL), int(t["y"] // CELL))].append(i)

    def neighbours(x, y):
        gx, gy = int(x // CELL), int(y // CELL)
        for ix in (gx - 1, gx, gx + 1):
            for iy in (gy - 1, gy, gy + 1):
                yield from grid.get((ix, iy), ())

    for i, t in enumerate(tiles):
        (fx, fy), (rx, ry) = frame(t)
        hx, hy = t["len_x"] * 0.5, t["len_y"] * 0.5
        for (ox, oy, half_out, along, half_along) in (
                (fx, fy, hx, (rx, ry), hy), (-fx, -fy, hx, (rx, ry), hy),
                (rx, ry, hy, (fx, fy), hx), (-rx, -ry, hy, (fx, fy), hx)):
            cx, cy = t["x"] + ox * half_out, t["y"] + oy * half_out
            # a real edge: none of three points just beyond it (middle and both quarters) lies on another tile
            covered = 0
            for s in (-0.5, 0.0, 0.5):
                px = cx + ox * PROBE_OUT + along[0] * half_along * s
                py = cy + oy * PROBE_OUT + along[1] * half_along * s
                if any(j != i and inside(tiles[j], px, py) for j in neighbours(px, py)):
                    covered += 1
            if covered == 0:
                yield t, (cx, cy), along, (ox, oy), half_along * 2.0


def prop_grid():
    """Every censused prop, bucketed for a fast radius test: (x, y, radius)."""
    if not PROPS.exists():
        return None
    rows = json.loads(PROPS.read_text(encoding="utf-8"))
    rows = rows["rows"] if isinstance(rows, dict) else rows
    grid = defaultdict(list)
    for r in rows:
        radius = r["radius"]
        # A LINEAR PROP IS NOT A DISC. The census radius comes from a bounds diagonal, which for a 4 m balustrade or
        # a hedge run is a 2 m circle -- and that excluded 160 of the SW district's 180 pieces, most of them beds
        # that would have stood in front of a balustrade, which is exactly where a bed belongs. Those are capped.
        # Gates, steps, columns, lamps, benches and trees keep their full footprint: those are the ones that can
        # block a doorway or put a lamp through a column.
        if any(w in r["mesh"] for w in LINEAR):
            radius = min(radius, LINEAR_RADIUS)
        grid[(int(r["x"] // 2000), int(r["y"] // 2000))].append((r["x"], r["y"], radius))
    return grid


def near_prop(grid, x, y, half):
    gx, gy = int(x // 2000), int(y // 2000)
    reach = max(half[0], half[1])
    for ix in (gx - 1, gx, gx + 1):
        for iy in (gy - 1, gy, gy + 1):
            for (px, py, pr) in grid.get((ix, iy), ()):
                if (px - x) ** 2 + (py - y) ** 2 < (pr + reach + PROP_PAD) ** 2:
                    return True
    return False


def load_clear():
    """{site id: True/False} from the clearance probe, or None if it has not been run."""
    if not CLEAR_RESULT.exists():
        return None
    sites = json.loads(CLEAR_RESULT.read_text(encoding="utf-8")).get("sites", {})
    street_labels = {r["label"] for r in json.loads(CENSUS.read_text(encoding="utf-8"))}
    out = {}
    for sid, r in sites.items():
        blockers = [b for b in r.get("blockers", []) if b not in IGNORE and b not in street_labels
                    and not b.startswith("SD01")]
        out[sid] = not blockers
    return out


def main(prefixes):
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))
    by_prefix = defaultdict(list)
    for r in rows:
        by_prefix[r["label"].split("_")[0]].append(r)
    out = {}
    clear = load_clear()
    props = prop_grid()
    all_sites = []
    for p in (prefixes or sorted(by_prefix)):
        # a district's edges are tested against EVERY street tile in the city, so a street that crosses a district
        # boundary is not mistaken for two dead ends
        layer, sites = build(p, by_prefix[p], rows, clear, props)
        all_sites.extend(sites)
        (HERE / ("sd01_%s.json" % p.lower())).write_text(json.dumps(layer), encoding="utf-8")
        out[p] = layer["stats"]
    SITES.write_text(json.dumps({"sites": all_sites}), encoding="utf-8")
    return out


def build(prefix, own, everything, clear=None, props=None):
    """One district's dressing: its own tiles' real edges, judged against every street tile in the city.
    Returns (layer, candidate sites). With `clear`, a piece whose site the probe found occupied is left out."""
    own_labels = {t["label"] for t in own}
    batches = {}
    sites = []
    dropped = [0]

    def site(kind, x, y, z):
        """Register a candidate; True if it may be placed."""
        # IDS ARE POSITIONS, NOT COUNTERS. They were sequential, so skipping one duplicate lamp shifted every later id
        # and the clearance answers stopped lining up with the candidates they were measured for -- beds halved from
        # 778 to 432 on a change that only touched lamps. A position cannot drift when a different piece is filtered.
        sid = "%s|%s|%d|%d" % (prefix, kind, round(x), round(y))
        hx, hy, hz = HALF[kind]
        sites.append([sid, round(x, 1), round(y, 1), hx, hy, hz, round(z + hz + 8.0, 1)])
        if props is not None and near_prop(props, x, y, HALF[kind]):
            dropped[0] += 1
            return False
        if clear is not None and not clear.get(sid, False):
            dropped[0] += 1
            return False
        return True

    def add(key, mesh, material, x, y, z, yaw, scale=1.0, collides=False, shadow=True):
        b = batches.setdefault(key, {"id": key, "mesh": mesh, "material": material, "instances": [],
                                     "collides": collides, "cast_shadow": shadow, "affect_df": False})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 2), 0.0, round(yaw % 360.0, 1), 0.0, scale, scale, scale])

    beds = lamps = edges = 0
    placed_lamps = []
    k = 0
    n = 0
    for (t, (cx, cy), along, outward, length) in real_edges(everything):
        if t["label"] not in own_labels:
            continue
        edges += 1
        top = t["top"]
        yaw = math.degrees(math.atan2(along[1], along[0]))
        usable = length - 2.0 * END_MARGIN
        if usable > BED_SPACING * 0.5:
            count = max(1, int(usable // BED_SPACING))
            step = usable / count
            for s in range(count):
                offset = -usable * 0.5 + step * (s + 0.5)
                x = cx + along[0] * offset - outward[0] * INSET
                y = cy + along[1] * offset - outward[1] * INSET
                beat = k % 4
                k += 1
                if beat in (0, 2):
                    if not site("bed", x, y, top):
                        continue
                    # the trough runs ALONG the street: its long axis is the planter mesh's Y, so turn it square.
                    # Purple-dominant runs, as the Bible's beds are, with rose and white between.
                    th = math.radians(yaw)
                    ax, ay = math.cos(th), math.sin(th)            # along the street
                    b = batches.setdefault("%s_%s_Planter" % (PASS, prefix),
                                           {"id": "%s_%s_Planter" % (PASS, prefix), "mesh": PLANTER,
                                            "material": "MI_V2_IvoryStone", "instances": [], "collides": False,
                                            "cast_shadow": True, "affect_df": False})
                    b["instances"].append([round(x, 1), round(y, 1), top, 0.0, round((yaw + 90.0) % 360.0, 1), 0.0]
                                          + list(PLANTER_SCALE))
                    rim = top + PLANTER_RIM
                    lip = batches.setdefault("%s_%s_PlanterLip" % (PASS, prefix),
                                             {"id": "%s_%s_PlanterLip" % (PASS, prefix), "mesh": KERB,
                                              "material": "MI_V2_Gold", "instances": [], "collides": False,
                                              "cast_shadow": False, "affect_df": False})
                    # the gold lip faces the street, which is the inward side of a real edge
                    lip["instances"].append([round(x - outward[0] * 84.0, 1), round(y - outward[1] * 84.0, 1),
                                             round(rim - 6.0, 2), 0.0, round(yaw % 360.0, 1), 0.0, 2.9, 0.35, 0.4])
                    for r_i, (lat, runs) in enumerate(ROWS):
                        for j, (module, petal) in enumerate(runs):
                            along_off = (j - 1) * 114.0 + (r_i - 1) * 20.0
                            px = x + ax * along_off + outward[0] * -lat
                            py = y + ay * along_off + outward[1] * -lat
                            for part in KIT[module]["parts"]:
                                material = petal if part["part"] == "petal" else (
                                    "MI_V2_LeafDark" if part["part"] == "leaf" and (j + r_i) % 2 else part["material"])
                                key = "%s_%s_Run_%s_%s" % (PASS, prefix, part["part"], material.replace("MI_V2_", ""))
                                rb = batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": material,
                                                              "instances": [], "collides": False,
                                                              "cast_shadow": part["part"] != "petal",
                                                              "affect_df": False})
                                rb["instances"].append([round(px, 1), round(py, 1), round(rim - 3.0, 2), 0.0,
                                                        round(yaw % 360.0, 1), 0.0, 0.95, 0.9, 1.3])
                elif beat == 1:
                    if not site("spiral", x, y, top):
                        continue
                    add("%s_%s_Spiral" % (PASS, prefix), SPIRAL, "MI_V2_LeafDark", x, y, top, yaw, SPIRAL_SCALE)
                else:
                    if not site("rose", x, y, top):
                        continue
                    add("%s_%s_Rose" % (PASS, prefix), ROSE_BUSH, "MI_V2_LeafMid", x, y, top, yaw, ROSE_SCALE)
                beds += 1
        # AT THE CORNER, NOT THE MIDPOINT. A lamp on the edge's midpoint stood in the middle of a planter whenever the
        # edge held an odd number of them (sd01c, SW plaza). Half an end-margin in from the corner is clear of the
        # first planter by more than both footprints, and corners are where a street wants its lamps anyway.
        corner = -length * 0.5 + END_MARGIN * 0.5
        lx = cx + along[0] * corner - outward[0] * (INSET + 40.0)
        ly = cy + along[1] * corner - outward[1] * (INSET + 40.0)
        # ONE LAMP PER CORNER. Two perpendicular real edges share a tile corner, and each put its lamp half an end
        # margin in from it -- so corners got a matched pair standing shoulder to shoulder (sd01d, SW plaza).
        near_lamp = any((lx - qx) ** 2 + (ly - qy) ** 2 < LAMP_MIN_GAP ** 2 for (qx, qy) in placed_lamps)
        if n % LAMP_EVERY == 0 and length > 900.0 and not near_lamp and site("lamp", lx, ly, top):
            placed_lamps.append((lx, ly))
            x, y = lx, ly
            # NO COLLISION on a lamp placed by an algorithm. A lamp you can walk through is a small flaw; one that
            # blocks a doorway nobody checked is a traversal bug, and traversal is a protected system.
            add("%s_%s_LampPost" % (PASS, prefix), WAYMARKER, "MI_V2_IvoryStone", x, y, top, yaw, LAMP_SCALE, collides=False)
            add("%s_%s_LampHead" % (PASS, prefix), WAYMARKER_LAMP, "MI_V2_GlassAmber", x, y, top, yaw, LAMP_SCALE, shadow=False)
            lamps += 1
        n += 1
    return ({"pass": "%s_%s" % (PASS, prefix),
             "title": "SD01 %s: flower beds, topiary and lamps along the street edges" % prefix,
             "tags": ["SD01"], "actors": [], "batches": list(batches.values()),
             "stats": {"tiles": len(own), "real_edges": edges, "beds": beds, "lamps": lamps, "dropped": dropped[0],
                       "instances": sum(len(b["instances"]) for b in batches.values())}}, sites)


if __name__ == "__main__":
    stats = main(sys.argv[1:])
    tot = defaultdict(int)
    for p, s in stats.items():
        print("%-9s tiles %3d  edges %3d  beds %4d  lamps %3d  dropped %3d  instances %5d"
              % (p, s["tiles"], s["real_edges"], s["beds"], s["lamps"], s["dropped"], s["instances"]))
        for k2 in ("tiles", "real_edges", "beds", "lamps", "dropped", "instances"):
            tot[k2] += s[k2]
    print("TOTAL     tiles %3d  edges %3d  beds %4d  lamps %3d  dropped %3d  instances %5d"
          % (tot["tiles"], tot["real_edges"], tot["beds"], tot["lamps"], tot["dropped"], tot["instances"]))
