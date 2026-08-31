#!/usr/bin/env python3
"""How TALL is Wonderland, and does its skyline have a hierarchy?

    python3 wonderland/v2/tools/skyline.py [--json out.json] [--top 30]
                                           [--from X,Y] [--min-m 20]

Every audit in this project so far measured the world in PLAN -- where things
are, how dense, how empty, how reachable. None of them could answer the one
question a skyline is: how high does it stand, and is one thing taller than
the rest.

`hierarchy.py` reports a "tallest silhouette" that is really `pos.z`, the
height a piece is PLACED at. A tower placed at z=0 scores 0 there however tall
it is. So this measures the real thing: every recipe is built on the meshkit
fallback backend, its bounding box read, and each placement's TOP is
`pos.z + bbox.top * scale.z`. The heights are MEASURED from the geometry that
ships, never declared in a table beside it -- a table is a derived number in a
comment, which is this project's richest defect vein.

What it reports:

  1. THE LADDER -- the tallest N pieces, with what each one is, where it
     stands, and the angle it subtends from the viewpoint. A hierarchy has
     gaps in this list; a tower field does not.
  2. THE BANDS -- how many pieces stand above 20 / 30 / 50 / 80 / 120 m, and
     what share of the world's built mass each band is.
  3. DOMINANCE -- tallest : second-tallest-distinct-site, and tallest : the
     90th percentile of built height. A dominant spire scores high on both;
     "many tall towers" scores about 1.0 and reads as spam.
  4. READABILITY -- for each of the tallest sites, the range at which it still
     subtends 1.5 deg of vertical angle (about the size at which a shape is
     still a landmark rather than texture) -- and whether the horizon fog
     depth reaches that far.

Angles are computed from an eye at 170 cm, the canonical Relay Dog's camera
height, because "readable from hundreds of metres" is a claim about a player
standing on the ground, not about a plan view.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
V2 = os.path.dirname(HERE)
HD = os.path.join(V2, "..", "infra", "build", "hd")
sys.path.insert(0, V2)
sys.path.insert(0, HD)
os.environ.setdefault("WLV2_PASS02", "1")
os.environ.setdefault("WLV2_PASS03", "1")

import gs                    # noqa: E402
import assets_v2 as A        # noqa: E402
import layout_v2 as LAYOUT   # noqa: E402

EYE_Z = 170.0          #: uu -- the Relay Dog's camera height
LANDMARK_DEG = 1.5     #: deg of vertical angle below which a shape is texture

#: Ground you walk on, sky, and scatter -- none of it is a silhouette.
NOT_SKYLINE = ("garden_lawn", "terrace_platform", "sky_dome", "ground_flowers",
               "ground_blooms", "flagstone", "kerb_stone", "stone_ring_base",
               "cobble", "petal_", "sea_", "water_")

_BBOX_CACHE = None


def bboxes():
    """Measured z-extent of every recipe, built once on the offline backend.

    Cached beside the tools dir and invalidated by assets_v2.py's mtime: a
    stale height table would silently mis-rank the whole skyline.
    """
    global _BBOX_CACHE
    if _BBOX_CACHE is not None:
        return _BBOX_CACHE
    src = os.path.join(V2, "assets_v2.py")
    stamp = str(int(os.path.getmtime(src)))
    path = os.path.join(HERE, "__pycache__", "skyline_bbox.json")
    try:
        with open(path) as fh:
            blob = json.load(fh)
        if blob.get("stamp") == stamp:
            _BBOX_CACHE = blob["bbox"]
            return _BBOX_CACHE
    except Exception:
        pass

    class U:
        pass
    ctx = gs.Context(U(), lambda m: None, force_fallback=True)
    out = {}
    for name in sorted(A.RECIPES):
        fn = A.RECIPES[name][0]
        try:
            mesh = fn(ctx).mesh
            lo, hi = mesh.bbox()
            out[name] = {"zlo": lo[2], "ztop": hi[2],
                         "rx": max(abs(lo[0]), abs(hi[0])),
                         "ry": max(abs(lo[1]), abs(hi[1]))}
        except Exception as exc:
            sys.stderr.write("skyline: %s could not be built: %s\n" % (name, exc))
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump({"stamp": stamp, "bbox": out}, fh)
    except Exception:
        pass
    _BBOX_CACHE = out
    return out


def is_skyline(asset):
    return not any(asset == p or asset.startswith(p) for p in NOT_SKYLINE)


def tops(origin=(0.0, 0.0), within_m=None, beyond_m=None):
    """Every placement's measured top, in uu, with its site.

    `within_m` / `beyond_m` window the world by ground distance from the
    viewpoint. They matter because Wonderland's backdrop stands at 720-1180 m
    and its walkable world ends at 340: measuring them together lets a
    backdrop mass answer a question asked about a tower the player can walk
    to, which is how the first run of this tool reported a hierarchy the
    walkable world does not have."""
    bb = bboxes()
    ox, oy = origin
    rows = []
    unknown = {}
    for p in LAYOUT.ALL:
        a = p["asset"]
        if not is_skyline(a):
            continue
        b = bb.get(a)
        if b is None:
            unknown[a] = unknown.get(a, 0) + 1
            continue
        x, y, z = p["pos"]
        sz = p["scale"][2]
        top = z + b["ztop"] * sz
        d = math.hypot(x - ox, y - oy)
        if within_m is not None and d > within_m * 100.0:
            continue
        if beyond_m is not None and d <= beyond_m * 100.0:
            continue
        rows.append({
            "asset": a, "label": p.get("label") or "", "band": p.get("band"),
            "x": x, "y": y, "z": z, "sz": sz,
            "top_uu": top, "top_m": top / 100.0,
            "d_uu": d,
        })
    return rows, unknown


def site_of(label, asset, x, y):
    """The THING a piece belongs to, so a roof and its tower are one entry.

    A finial, a cap and a drum standing at one coordinate are one tower. A
    ladder that lists them separately reports three landmarks where there is
    one, which is exactly the flattery a verticality pass must not accept.
    """
    parts = (label or "").split("_")
    if len(parts) >= 2:
        head = parts[0]
        if head.startswith("City") or (head[:1] in "QSDC" and head[1:].isdigit()):
            return head + "_" + parts[1] if len(parts) > 2 else head
    return "%s@%d,%d" % (asset, round(x / 400.0), round(y / 400.0))


def ladder(rows, n=30, cluster=900.0):
    """The tallest distinct SITES, tallest first.

    Clustered on ground position: two pieces within `cluster` uu of each other
    are the same landmark seen twice, and the taller wins.
    """
    kept = []
    for r in sorted(rows, key=lambda r: -r["top_uu"]):
        for k in kept:
            if math.hypot(r["x"] - k["x"], r["y"] - k["y"]) < cluster:
                k["pieces"] += 1
                break
        else:
            kept.append(dict(r, pieces=1))
            if len(kept) >= n:
                break
    return kept


def angle_deg(top_uu, d_uu):
    """Vertical angle a piece subtends from an eye at EYE_Z, standing at d."""
    if d_uu <= 1.0:
        return 90.0
    return math.degrees(math.atan2(max(0.0, top_uu - EYE_Z), d_uu))


def readable_range_m(top_uu):
    """Range in metres at which the piece still subtends LANDMARK_DEG."""
    h = max(0.0, top_uu - EYE_Z)
    return (h / math.tan(math.radians(LANDMARK_DEG))) / 100.0


def pct(xs, q):
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(len(s) - 1, max(0, int(q * (len(s) - 1))))]


def report(top_n=30, min_m=20.0, origin=(0.0, 0.0), within_m=None, beyond_m=None):
    rows, unknown = tops(origin, within_m, beyond_m)
    heights = [r["top_uu"] for r in rows]
    lad = ladder(rows, top_n)

    bands = [(20.0, 30.0), (30.0, 50.0), (50.0, 80.0), (80.0, 120.0), (120.0, 1e9)]
    band_rows = []
    for lo, hi in bands:
        sel = [r for r in rows if lo <= r["top_m"] < hi]
        band_rows.append({"lo_m": lo, "hi_m": None if hi > 1e8 else hi,
                          "n": len(sel),
                          "share": len(sel) / float(len(rows)) if rows else 0.0})

    # DOMINANCE. Distinct sites, so a spire's own finial cannot be its rival.
    tall = [k["top_m"] for k in lad]
    dom_site = (tall[0] / tall[1]) if len(tall) > 1 and tall[1] else 0.0
    p90 = pct(heights, 0.90) / 100.0
    dom_p90 = (tall[0] / p90) if p90 else 0.0

    # THE PRESENCE LADDER. Absolute height ranks a 135 m backdrop mass at
    # 1.1 km above a 128 m spire at 368 m, and the spire is more than twice
    # the picture. What a skyline IS, is angle.
    for r in rows:
        r["deg"] = angle_deg(r["top_uu"], r["d_uu"])
    pres = []
    for r in sorted(rows, key=lambda r: -r["deg"]):
        for k in pres:
            if math.hypot(r["x"] - k["x"], r["y"] - k["y"]) < 900.0:
                break
        else:
            pres.append(r)
            if len(pres) >= top_n:
                break

    return {
        "window": {"within_m": within_m, "beyond_m": beyond_m,
                   "origin": list(origin)},
        "n_skyline_pieces": len(rows),
        "unknown_assets": unknown,
        "height_m": {"p50": pct(heights, 0.50) / 100.0, "p90": p90,
                     "p99": pct(heights, 0.99) / 100.0,
                     "max": (max(heights) / 100.0 if heights else 0.0)},
        "bands": band_rows,
        "dominance": {"tallest_over_second_site": dom_site,
                      "tallest_over_p90": dom_p90},
        "ladder": [{
            "site": site_of(k["label"], k["asset"], k["x"], k["y"]),
            "label": k["label"], "asset": k["asset"], "band": k["band"],
            "top_m": round(k["top_m"], 1),
            "x": round(k["x"]), "y": round(k["y"]),
            "dist_m": round(k["d_uu"] / 100.0, 1),
            "subtends_deg": round(angle_deg(k["top_uu"], k["d_uu"]), 2),
            "readable_to_m": round(readable_range_m(k["top_uu"])),
        } for k in lad],
        "presence": [{
            "site": site_of(k["label"], k["asset"], k["x"], k["y"]),
            "label": k["label"], "asset": k["asset"], "band": k["band"],
            "top_m": round(k["top_m"], 1),
            "x": round(k["x"]), "y": round(k["y"]),
            "dist_m": round(k["d_uu"] / 100.0, 1),
            "subtends_deg": round(k["deg"], 2),
        } for k in pres],
        "above_min": sum(1 for r in rows if r["top_m"] >= min_m),
        "min_m": min_m,
    }


# ---------------------------------------------------------------------------
# SITING -- what a candidate landmark would do to every locked camera
# ---------------------------------------------------------------------------
#
# A tall thing is not sited by arithmetic in someone's head. The eight locked
# cameras are a regression system and a 230 m spire dropped on the wrong
# bearing rewrites HeroCam0's approved composition; the way to know that
# BEFORE a fifteen-minute generate and a GPU capture is to project the
# candidate into every camera and read the numbers.
#
# `fits` is the whole question: a landmark whose top leaves the frame reads as
# a wall, and one that subtends under about 4 deg reads as scenery.


def cameras():
    """The camera suite, from v2_config -- never restated here."""
    import v2_config as CFG
    out = []
    for c in CFG.HERO_CAMS:
        tag = [t for t in c["tags"] if t.startswith("HeroCam") and t[7:].isdigit()]
        out.append({"name": c["name"], "tag": (tag or [c["name"]])[0],
                    "loc": c["location"], "pitch": c["rotation"][0],
                    "yaw": c["rotation"][1], "fov": c["fov"]})
    return out


def project(cam, x, y, top_uu, aspect=16.0 / 9.0):
    """Where a vertical object at (x,y) of height top_uu lands in a frame."""
    cx, cy, cz = cam["loc"]
    dx, dy = x - cx, y - cy
    d = math.hypot(dx, dy)
    bearing = math.degrees(math.atan2(dy, dx))
    off = (bearing - cam["yaw"] + 180.0) % 360.0 - 180.0
    hfov = cam["fov"]
    vfov = math.degrees(2.0 * math.atan(math.tan(math.radians(hfov / 2.0)) / aspect))
    el_top = math.degrees(math.atan2(top_uu - cz, d)) - cam["pitch"]
    el_base = math.degrees(math.atan2(0.0 - cz, d)) - cam["pitch"]
    in_h = abs(off) <= hfov / 2.0
    return {"cam": cam["tag"], "name": cam["name"], "dist_m": d / 100.0,
            "off_deg": off, "el_top_deg": el_top, "el_base_deg": el_base,
            "subtend_deg": el_top - el_base,
            "half_h": hfov / 2.0, "half_v": vfov / 2.0,
            "in_frame": in_h and el_top < 1e9,
            "top_in_frame": in_h and el_top <= vfov / 2.0,
            "visible": in_h and el_top > -vfov / 2.0}


def site_report(x, y, h_m):
    top = h_m * 100.0
    rows = [project(c, x, y, top) for c in cameras()]
    print("SITE (%.0f, %.0f)  height %.0f m  radius %.0f m  bearing %.1f deg"
          % (x, y, h_m, math.hypot(x, y) / 100.0,
             math.degrees(math.atan2(y, x)) % 360.0))
    print("  %-16s %8s %8s %9s %9s  %s"
          % ("camera", "dist m", "off deg", "top el", "subtend", "verdict"))
    for r in sorted(rows, key=lambda r: -r["subtend_deg"]):
        if not r["visible"]:
            verdict = "out of frame"
        elif not r["top_in_frame"]:
            verdict = "TOP CUT (needs el<%.0f)" % r["half_v"]
        elif r["subtend_deg"] < 4.0:
            verdict = "scenery"
        else:
            verdict = "reads"
        mark = "  " if r["visible"] else "· "
        print("  %s%-14s %8.1f %+8.1f %+9.1f %9.1f  %s"
              % (mark, r["cam"], r["dist_m"], r["off_deg"], r["el_top_deg"],
                 r["subtend_deg"], verdict))
    seen = [r for r in rows if r["visible"]]
    print("  visible from %d of %d cameras; top fits in %d"
          % (len(seen), len(rows), sum(1 for r in seen if r["top_in_frame"])))
    return rows


def main():
    args = sys.argv[1:]
    out_json = None
    top_n, min_m, origin = 30, 20.0, (0.0, 0.0)
    within_m = beyond_m = None
    for i, a in enumerate(args):
        if a == "--json" and i + 1 < len(args):
            out_json = args[i + 1]
        elif a.startswith("--top="):
            top_n = int(a.split("=", 1)[1])
        elif a.startswith("--min-m="):
            min_m = float(a.split("=", 1)[1])
        elif a.startswith("--from="):
            xs, ys = a.split("=", 1)[1].split(",")
            origin = (float(xs), float(ys))
        elif a.startswith("--within="):
            within_m = float(a.split("=", 1)[1])
        elif a.startswith("--beyond="):
            beyond_m = float(a.split("=", 1)[1])
        elif a.startswith("--site="):
            xs, ys, hs = a.split("=", 1)[1].split(",")
            site_report(float(xs), float(ys), float(hs))
            return 0
    rep = report(top_n, min_m, origin, within_m, beyond_m)

    win = rep["window"]
    print("SKYLINE -- measured from the shipped geometry, eye at %.2f m at (%.0f,%.0f)"
          % (EYE_Z / 100.0, win["origin"][0], win["origin"][1]))
    if win["within_m"] or win["beyond_m"]:
        print("  WINDOW  %s .. %s m from the viewpoint"
              % (("%.0f" % win["beyond_m"]) if win["beyond_m"] else "0",
                 ("%.0f" % win["within_m"]) if win["within_m"] else "inf"))
    print("  skyline pieces        %d" % rep["n_skyline_pieces"])
    h = rep["height_m"]
    print("  height m  p50 %5.1f   p90 %5.1f   p99 %5.1f   max %6.1f"
          % (h["p50"], h["p90"], h["p99"], h["max"]))
    print("  >= %.0f m             %d pieces" % (rep["min_m"], rep["above_min"]))
    if rep["unknown_assets"]:
        print("  UNMEASURED assets (no recipe bbox): %s"
              % ", ".join("%s x%d" % kv for kv in sorted(rep["unknown_assets"].items())))
    print("\nBANDS")
    for b in rep["bands"]:
        hi = "+" if b["hi_m"] is None else "-%.0f" % b["hi_m"]
        print("  %5.0f%-5s m   %6d pieces   %5.2f%% of skyline"
              % (b["lo_m"], hi, b["n"], 100.0 * b["share"]))
    d = rep["dominance"]
    print("\nDOMINANCE")
    print("  tallest : 2nd distinct site   %.2fx" % d["tallest_over_second_site"])
    print("  tallest : p90 of all pieces   %.2fx" % d["tallest_over_p90"])
    print("\nLADDER -- tallest distinct sites")
    print("  %-26s %-22s %7s %8s %8s %9s" % ("site", "asset", "top m", "dist m", "subtend", "readable"))
    for k in rep["ladder"]:
        print("  %-26s %-22s %7.1f %8.1f %7.2f' %7.0f m"
              % (k["site"][:26], k["asset"][:22], k["top_m"], k["dist_m"],
                 k["subtends_deg"], k["readable_to_m"]))
    print("\nPRESENCE -- the same world ranked by the angle it subtends")
    print("  %-26s %-22s %7s %8s %8s" % ("site", "asset", "top m", "dist m", "subtend"))
    for k in rep["presence"]:
        print("  %-26s %-22s %7.1f %8.1f %7.2f'"
              % (k["site"][:26], k["asset"][:22], k["top_m"], k["dist_m"], k["subtends_deg"]))
    if out_json:
        with open(out_json, "w") as fh:
            json.dump(rep, fh, indent=1)
        print("\njson -> %s" % out_json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
