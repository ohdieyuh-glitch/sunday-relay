#!/usr/bin/env python3
"""Where can a ring road actually run? The march ring and the outer ring, searched around the whole world.

    python WorldDesign/Rings/ring_probe.py            (writes ring_routes.json + ring_probe.png beside itself)

WHY (2026-09-28, world completion, CORE C2). The world has three radial avenues and, beyond the core, no ring:
a walker can go from the city to a nation and back, but never from one nation to the next. The rings join
them. They have to be laid through a world that is already full of things -- skyline towers, the V2 hedge ring,
mushroom woods, the nations' own quarters -- so the ring is FOUND, not drawn: a circle at a fixed radius is
blocked somewhere in every sector (the WORLD session measured 245-286 deg at 1,000 m alone).

THE INSTRUMENT is the WORLD session's own Occupancy (WorldDesign/Wedges/w270_rear_seam.py): oriented rectangles
with their yaw, a separating-axis test, canopies not solid (their trunks are), grass not an obstacle, SINK_UU
and sky not world, flat plates over 100 m are the floor. Both lanes judge "clear" the same way. One addition:
existing ROAD FLOOR (the avenues' flagstones and kerb runs, plaza pieces, terrace plates) is PAVED -- a ring
may meet and cross an avenue, it may not run through a hall.

THE SEARCH is a Viterbi path over bearings (0.25 deg steps) and radii (2 m steps inside a band). Each step pays
for leaving the nominal radius and for turning; a radius where the road's cross-section (carriageway, kerbs,
verges and a margin) would touch anything standing is forbidden. Where every radius at a bearing is blocked,
the path is let through at a large cost and the arc is REPORTED with what blocks it -- a place that needs a
decision (a gate, a bridge, a detour, or an honest end of the road), never a road through a building.
ANCHORS pin the ring to the plazas the WORLD session built on the rear seam: 645 m and 1,075 m at 270 deg.
"""
import csv
import gzip
import json
import math
import struct
import sys
import zlib
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
WD = HERE.parent
CENSUS = WD.parent / "Tools" / "captures" / "zc" / "census" / "world_census.csv.gz"
sys.path.insert(0, str(WD / "Wedges"))
from w270_rear_seam import Occupancy                                   # noqa: E402  the shared SAT test

PAVED_WORDS = ("Flagstone", "Kerb_Run", "Plaza", "terrace_platform", "plaza_slab", "paving", "verge")
STEP_DEG = 0.25
DR = 200.0                       # uu between candidate radii
HALF_WIDTH = 1000.0              # the agreed 20 m corridor: 6 m carriageway + 1.2 m kerb + 2.4 m verge + 0.4 m, each side
NARROW_HALF = 500.0              # the narrow tier: one 4 m lane + kerbs + 0.4 m, each side
NARROW_COST = 3.0               # per 0.25 deg step: the search narrows only where the full road cannot pass
MAX_TURN = 300.0                # uu of radius change allowed per 0.25 deg step: S-bends round a tower, not zig-zags
RINGS = {
    # name: (nominal, band min, band max, {bearing: pinned radius})
    "MARCH": (58000.0, 50000.0, 74000.0, {270.0: 64500.0}),
    "OUTER": (108000.0, 98000.0, 125000.0, {270.0: 107500.0}),
}


def load(occ):
    kept = Counter()
    with gzip.open(CENSUS, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["kind"] == "OTHER":
                continue
            x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
            if z < -50000.0 or z > 6000.0:
                continue
            if not (44000.0 <= math.hypot(x, y) <= 125000.0):
                continue
            ex, ey, ez = float(r["ex"]), float(r["ey"]), float(r["ez"])
            mesh = r["mesh"]
            if max(ex, ey) > 5000.0 and ez < 300.0:        # the floor itself
                continue
            if "Grass_Tuft" in mesh or "tuft" in mesh.lower():
                continue
            if "canopy" in mesh.lower():
                occ.add("existing", x, y, 80.0, 80.0, 0.0, r["owner"] + ":trunk")
                kept["trunk"] += 1
                continue
            if any(w in mesh for w in PAVED_WORDS):
                occ.add("paved", x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["owner"])
                kept["paved"] += 1
                continue
            occ.add("existing", x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["owner"] + ":" + mesh)
            kept["existing"] += 1
    return kept


def search(occ, nominal, rmin, rmax, anchors):
    radii = [rmin + DR * i for i in range(int((rmax - rmin) / DR) + 1)]
    # PIN TO THE GRID. 645 m and 1,075 m fall between the 2 m candidate radii, so a pin tested as "within half a
    # step" matched nothing: every state started infinite and the path collapsed onto the band's inner edge.
    anchors = {b: min(radii, key=lambda rr: abs(rr - pin)) for b, pin in anchors.items()}
    bearings = [STEP_DEG * i for i in range(int(360.0 / STEP_DEG))]
    # Per bearing and radius: 0 = the full road fits, 1 = only the NARROW lane fits (a road that narrows to pass
    # between towers, as roads do), 2 = nothing fits. The narrow test runs only where the full one failed.
    blocked, blockers = [], []
    for b in bearings:
        th = math.radians(b)
        row, why = [], []
        for rad in radii:
            arc = rad * math.radians(STEP_DEG) * 0.5 + 150.0
            x, y = rad * math.cos(th), rad * math.sin(th)
            hit = occ.hits(x, y, arc, HALF_WIDTH, b + 90.0, 0.0, ("existing",))
            level = 0
            if hit is not None:
                narrow = occ.hits(x, y, arc, NARROW_HALF, b + 90.0, 0.0, ("existing",))
                level = 1 if narrow is None else 2
            row.append(level)
            why.append(hit)
        blocked.append(row)
        blockers.append(why)
    # Viterbi around the circle, opened at the first anchor so the loop closes on a pinned radius.
    start = min(anchors) if anchors else 0.0
    order = [(int(start / STEP_DEG) + k) % len(bearings) for k in range(len(bearings) + 1)]
    INF = 1e18
    BLOCK = 5e6
    cost = [INF] * len(radii)
    for i, rad in enumerate(radii):
        if anchors and rad == anchors[start]:
            cost[i] = 0.0
    back = []
    for step, bi in enumerate(order[1:], 1):
        b = bearings[bi]
        pin = anchors.get(b)
        new = [INF] * len(radii)
        arg = [0] * len(radii)
        span = int(MAX_TURN / DR) + 1
        for i, rad in enumerate(radii):
            if pin is not None and rad != pin:
                continue
            level = blocked[bi][i]
            local = abs(rad - nominal) / 1000.0 + (BLOCK if level == 2 else (NARROW_COST if level == 1 else 0.0))
            best, bj = INF, 0
            for j in range(max(0, i - span), min(len(radii), i + span + 1)):
                c = cost[j] + abs(radii[j] - rad) / 100.0
                if c < best:
                    best, bj = c, j
            new[i] = best + local
            arg[i] = bj
        back.append(arg)
        cost = new
    # the loop closes where it opened
    i = min(range(len(radii)), key=lambda k: cost[k])
    path = [i]
    for arg in reversed(back):
        i = arg[i]
        path.append(i)
    path.reverse()
    route = []
    for k, bi in enumerate(order):
        ri = path[k]
        rad = radii[ri]
        th = math.radians(bearings[bi])
        route.append({"bearing": bearings[bi], "r": rad, "x": round(rad * math.cos(th), 1),
                      "y": round(rad * math.sin(th), 1), "blocked": blocked[bi][ri] == 2,
                      "narrow": blocked[bi][ri] == 1, "blocker": blockers[bi][ri]})
    return route


def arcs(route):
    out, cur = [], None
    for p in route:
        if p["blocked"]:
            if cur is None:
                cur = {"from": p["bearing"], "to": p["bearing"], "r": [p["r"], p["r"]], "by": Counter()}
            cur["to"] = p["bearing"]
            cur["r"] = [min(cur["r"][0], p["r"]), max(cur["r"][1], p["r"])]
            cur["by"][(p["blocker"] or "?").split(":", 1)[-1][:48]] += 1
        elif cur is not None:
            out.append(cur)
            cur = None
    if cur is not None:
        out.append(cur)
    return out


# ------------------------------------------------------------------------------------------------ picture
def png(path, w, h, px):
    raw = b"".join(b"\x00" + bytes(px[y * w * 3:(y + 1) * w * 3]) for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def picture(occ, routes, path, half=125000.0, size=1250):
    s = size / (2.0 * half)
    px = bytearray([24, 27, 34] * size * size)

    def put(x, y, col, rad=0):
        cx, cy = int((x + half) * s), int((half - y) * s)
        for dx in range(-rad, rad + 1):
            for dy in range(-rad, rad + 1):
                u, v = cx + dx, cy + dy
                if 0 <= u < size and 0 <= v < size:
                    px[(v * size + u) * 3:(v * size + u) * 3 + 3] = bytes(col)

    def rect(rec, col):
        x, y, hx, hy, yaw = rec[:5]
        c, sn = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        step = 1.0 / s
        nx, ny = max(1, int(2 * hx / step)), max(1, int(2 * hy / step))
        for i in range(nx + 1):
            for j in range(ny + 1):
                lx, ly = -hx + 2 * hx * i / nx, -hy + 2 * hy * j / ny
                put(x + lx * c - ly * sn, y + lx * sn + ly * c, col)

    seen = set()
    for layer, col in (("paved", (150, 128, 96)), ("existing", (120, 124, 132))):
        for recs in occ.layers[layer].values():
            for rec in recs:
                if id(rec) in seen:
                    continue
                seen.add(id(rec))
                rect(rec, col)
    for r_m in (50000.0, 100000.0, 120000.0):
        for k in range(3600):
            t = math.radians(k / 10.0)
            put(r_m * math.cos(t), r_m * math.sin(t), (52, 60, 84))
    for route in routes:
        for p in route:
            put(p["x"], p["y"], (235, 60, 60) if p["blocked"] else ((110, 200, 255) if p["narrow"] else (240, 196, 60)), 2)
    png(path, size, size, px)


def main():
    occ = Occupancy()
    kept = load(occ)
    print("census in the annulus: %s" % dict(kept))
    out, routes = {}, []
    for name, (nominal, rmin, rmax, anchors) in RINGS.items():
        route = search(occ, nominal, rmin, rmax, anchors)
        bad = arcs(route)
        clear = sum(1 for p in route if not p["blocked"]) / float(len(route))
        length = sum(math.hypot(route[k]["x"] - route[k - 1]["x"], route[k]["y"] - route[k - 1]["y"])
                     for k in range(1, len(route))) / 100.0
        rs = [p["r"] / 100.0 for p in route]
        print("\n%s ring: %.0f m long, radius %.0f-%.0f m, %.1f%% of it clear, %d blocked arcs"
              % (name, length, min(rs), max(rs), 100.0 * clear, len(bad)))
        for a in bad:
            print("   blocked %6.2f-%6.2f deg at %4.0f-%4.0f m by %s"
                  % (a["from"], a["to"], a["r"][0] / 100.0, a["r"][1] / 100.0,
                     ", ".join("%s x%d" % kv for kv in a["by"].most_common(3))))
        out[name] = {"nominal_m": nominal / 100.0, "length_m": round(length), "clear_fraction": round(clear, 4),
                     "blocked_arcs": [{"from": a["from"], "to": a["to"], "r_m": [a["r"][0] / 100.0, a["r"][1] / 100.0],
                                       "by": dict(a["by"].most_common(5))} for a in bad],
                     "narrow_fraction": round(sum(1 for p in route if p["narrow"]) / float(len(route)), 4),
                     "points": [[p["bearing"], p["r"], p["x"], p["y"], 2 if p["blocked"] else (1 if p["narrow"] else 0)] for p in route]}
        routes.append(route)
    (HERE / "ring_routes.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    picture(occ, routes, HERE / "ring_probe.png")
    print("\nwrote ring_routes.json and ring_probe.png")


if __name__ == "__main__":
    main()
