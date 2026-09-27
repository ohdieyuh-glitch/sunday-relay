#!/usr/bin/env python3
"""WHAT CAN YOU SEE FROM HERE, AND IS THERE ANYTHING TO AIM AT? A skyline profile computed from source.

The founder's world-defect list names three things this answers together: "poor landmark visibility", "weak
silhouettes", "bad sightlines". `Tools/editor_jobs/skyline_profile.py` measures this properly in the engine,
from one camera, one run at a time. This measures it for the WHOLE world from the specs, from as many
viewpoints as you like, in a second -- so a gap can be found before an editor is booked, and a pass can be
judged by whether it changed the profile.

WHAT IT COMPUTES. From each viewpoint, at every bearing, the highest ANGULAR ELEVATION any placed thing
reaches above the eye, and what that thing is. Angular elevation, not height, because that is what
visibility actually is: a 74 m tower at 3 km subtends less than a 9 m obelisk at 40 m, and a player finds
their way by what fills the view rather than by what is tallest in the level.

    elevation = atan2(top_of_thing - eye_z, horizontal distance)

A bearing whose best elevation is under EMPTY_DEG has nothing in it to walk towards. A run of such bearings
is a blank quarter of the horizon, which is the measurable form of "I don't know where to go".

WHAT IT DELIBERATELY DOES NOT DO. It does not trace occlusion: a thing behind a nearer, taller thing still
counts. That makes it an upper bound on what is visible, so a bearing it calls EMPTY is certainly empty,
while a bearing it calls occupied may still be blocked -- which is the safe direction for finding gaps.
Clouds and the sky deck are excluded; they are everywhere and they are not landmarks.

    python Tools/audit_sightlines.py                     # the four registry viewpoints
    python Tools/audit_sightlines.py --without CP02 CP03 CP04 CP05   # the same world minus a pass, to
                                                                      judge what that pass bought
"""
import argparse
import collections
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WD = ROOT / "WorldDesign"
KIT = json.loads((WD / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
INVENTORY = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/mesh_inventory.json")
SKIP_FILES = ("nations.json", "mesh_bounds.json", "kit_modules.json")

EYE = 160.0                 # a standing player's eye above the floor
STEP_DEG = 5.0              # 72 bearings
MAX_R = 200000.0            # 2 km; past that is sky and cloud deck
EMPTY_DEG = 1.5             # below this a bearing has nothing to aim at
#: A LANDMARK IS NOT STREET FURNITURE. Angular elevation is the right measure of what fills a view, and it
#: therefore ranks a hanging lantern 4 m from the eye above a 74 m tower -- correctly, and uselessly, because
#: the question "what do I aim at" is about things you walk TOWARDS. The horizon-occupancy numbers keep every
#: placement; only the "what dominates this view" list applies this floor.
LANDMARK_MIN_R = 1500.0
SUNK_BELOW = -1000.0        # trimmed-away content, see SINK_UU in audit_float_bury
#: Everywhere and not a landmark.
IGNORE = ("cloud", "Cloud")

#: The viewpoints that matter: the five territory checkpoints, with the floor measured under each.
VIEWS = {
    "arrival":  (0.0, -1460.0, 12.3),
    "ICARUS":   (0.0, 52500.0, 12.0),
    "NOCTIS":   (-45466.3, -26250.0, 12.0),
    "TARTARUS": (45466.3, -26250.0, 12.0),
    "DUBEL":    (0.0, 126000.0, -14.0),
}


def sizes():
    out = {}
    if INVENTORY.exists():
        for rec in json.loads(INVENTORY.read_text(encoding="utf-8")):
            out[rec["name"]] = rec["size_cm"]
    for mod in KIT.values():
        for part in mod["parts"]:
            out.setdefault(part["mesh"].split("/")[-1].split(".")[0], mod["size"])
    return out


def load(without):
    size = sizes()
    pts = []
    for path in sorted(WD.rglob("*.json")):
        if path.name in SKIP_FILES:
            continue
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
        except Exception:                                                      # noqa: BLE001
            continue
        if not isinstance(spec, dict) or "batches" not in spec:
            continue
        pid = spec.get("pass", path.stem)
        if pid in without:
            continue
        for b in spec["batches"]:
            mesh = (b.get("mesh") or "").split("/")[-1].split(".")[0]
            if any(tag in mesh for tag in IGNORE):
                continue
            sz = size.get(mesh)
            if sz is None:
                continue
            h = float(sz[2])
            for inst in b.get("instances") or []:
                if len(inst) < 7 or float(inst[2]) <= SUNK_BELOW:
                    continue
                pts.append((float(inst[0]), float(inst[1]),
                            float(inst[2]) + h * float(inst[6]), pid, mesh))
    return pts


def profile(pts, vx, vy, vz):
    eye = vz + EYE
    n = int(360.0 / STEP_DEG)
    best = [(-90.0, None, 0.0)] * n
    for x, y, top, pid, mesh in pts:
        dx, dy = x - vx, y - vy
        d = math.hypot(dx, dy)
        if d < 300.0 or d > MAX_R:
            continue
        elev = math.degrees(math.atan2(top - eye, d))
        b = int((math.degrees(math.atan2(dy, dx)) % 360.0) / STEP_DEG) % n
        if elev > best[b][0]:
            best[b] = (elev, "%s %s" % (pid, mesh), d)
    return best


def runs_of_empty(best):
    """Contiguous stretches of horizon with nothing to aim at, as (start_deg, width_deg)."""
    n = len(best)
    flags = [b[0] < EMPTY_DEG for b in best]
    out, i = [], 0
    if all(flags):
        return [(0.0, 360.0)]
    while i < n:
        if flags[i] and not flags[(i - 1) % n]:
            width = 0
            j = i
            while flags[j % n] and width < n:
                width += 1
                j += 1
            out.append((i * STEP_DEG, width * STEP_DEG))
        i += 1
    return out


def report(pts, label):
    print("=" * 98)
    print("%s -- %d placements considered" % (label, len(pts)))
    for name, (vx, vy, vz) in VIEWS.items():
        best = profile(pts, vx, vy, vz)
        elevs = [b[0] for b in best]
        empty = runs_of_empty(best)
        occupied = sum(1 for e in elevs if e >= EMPTY_DEG)
        print()
        print("  FROM %s at (%.0f, %.0f), eye %.0f" % (name, vx, vy, vz + EYE))
        print("    horizon occupied %d of %d bearings (%.0f%%)   best %.1f deg   median %.1f deg"
              % (occupied, len(best), 100.0 * occupied / len(best), max(elevs),
                 sorted(elevs)[len(elevs) // 2]))
        if empty:
            widest = max(empty, key=lambda r: r[1])
            print("    blank horizon: %d run(s), widest %.0f deg starting at bearing %.0f"
                  % (len(empty), widest[1], widest[0]))
            print("      %s" % ", ".join("%.0f deg for %.0f" % r for r in sorted(empty, key=lambda r: -r[1])[:6]))
        else:
            print("    blank horizon: none -- every bearing has something above %.1f deg" % EMPTY_DEG)
        ranked = sorted(((b[0], b[1], b[2], i * STEP_DEG) for i, b in enumerate(best)
                         if b[1] and b[2] >= LANDMARK_MIN_R), reverse=True)
        print("    the four LANDMARKS that dominate this view (past %.0f m, so not street furniture):"
              % (LANDMARK_MIN_R / 100.0))
        seen = set()
        shown = 0
        for elev, what, dist, bearing in ranked:
            key = what.split()[0]
            if key in seen:
                continue
            seen.add(key)
            print("      %5.1f deg at %6.0f m, bearing %3.0f   %s" % (elev, dist / 100.0, bearing, what))
            shown += 1
            if shown == 4:
                break


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--without", nargs="*", default=[], metavar="PASS")
    args = ap.parse_args()
    full = load(set())
    report(full, "WONDERLAND AS BUILT")
    if args.without:
        less = load(set(args.without))
        report(less, "THE SAME WORLD WITHOUT " + ", ".join(args.without))
        print()
        print("Read the two together: the difference is what those passes bought the horizon, and it is the")
        print("only honest way to say a landmark pass improved visibility.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
