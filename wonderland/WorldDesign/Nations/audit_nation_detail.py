#!/usr/bin/env python3
"""Audit a nation-detail pass BEFORE the editor ever sees it.

FOUNDER DIRECTIVE (2026-09-22): "Audit the actual visual placement. Check: scale, transforms, wall seating,
repetition, collision where appropriate, material consistency, performance. Do not repeat the old
local-space/world-scale mistake."

Most of that can be answered on disk, and the parts that can be answered on disk should be, because an apply
costs a slot on a single shared editor and this lane has already spent one discovering a typo.

WHAT THIS CHECKS THAT THE GENERATOR CANNOT CHECK ITSELF. Re-running the generator's own arithmetic would only
prove the generator agrees with itself. These tests are deliberately INDEPENDENT of how the instances were
produced:

  1. NATION. Every instance is re-classified by nations.nation_at(x, y) -- a function that knows nothing about
     this pass -- and must land in the nation the pass claims. A local-space/world-space confusion does not
     produce a subtle offset in a rotated quarter; it throws geometry into a different sector or into the
     neutral core, and this catches that in one line. It is the single most valuable test here.
  2. WALL SEATING. Each instance is rotated back into its own building's local frame and must sit ON one of the
     four faces -- at half-width or half-depth, within the run, not floating in the middle of the plan or out
     past the corner.
  3. HEIGHT. Nothing may sit below its building's floor or above the wall top the pass used, because a window
     opening onto a roof is the failure this pass was written to avoid.
  4. SCALE. Kit modules must be placed at 1.0. Only the cornice is stretched, and only along its run.
  5. REPETITION. No two instances of the same batch at the same place, and a report of how much of each wall is
     actually covered, so "evenly spaced" is a number rather than an impression.
  6. COLLISION. Every batch must be non-colliding: this is decoration on walls a player is already blocked by,
     and a window that blocks is a wall that grew.
  7. MATERIAL. Every material must be one the nation's own palette declares, so a detail pass cannot quietly
     introduce a colour the quarter does not use.
  8. COST. Instances, batches and triangles, against the pass it is decorating.

    python audit_nation_detail.py
"""
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import nation_detail as ND             # noqa: E402
import nations                         # noqa: E402
import noctis_quarter as NOCTIS        # noqa: E402
import tartarus_quarter as TARTARUS    # noqa: E402

KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]

#: Every StaticMesh's measured triangle count, written by the mesh_inventory editor job. The kit records
#: a MODULE's triangles; a batch places ONE MESH, and those are not the same number.
_INV = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/mesh_inventory.json")
INVENTORY_BY_NAME = ({r["name"]: r for r in json.loads(_INV.read_text(encoding="utf-8"))}
                     if _INV.exists() else {})

CASES = (
    dict(pass_id="NC02", nation="NOCTIS", mod=NOCTIS, spec="nc02_noctis_detail.json",
         footprints="nc01_footprints.json", parent="nc01_quarter.json"),
    dict(pass_id="TQ02", nation="TARTARUS", mod=TARTARUS, spec="tq02_tartarus_detail.json",
         footprints="tq01_footprints.json", parent="tq01_quarter.json"),
    #: The second band's detail, checked by the same independent tests. Their footprints carry a scale, so
    #: seating is tested against the SCALED plan -- which is the whole point of recording it.
    dict(pass_id="IC04", nation="ICARUS", mod=ND.NATIONS["IC04"]["mod"], spec="ic04_band_detail.json",
         footprints="ic03_band_footprints.json", parent="ic03_band.json"),
    dict(pass_id="NC04", nation="NOCTIS", mod=ND.NATIONS["NC04"]["mod"], spec="nc04_band_detail.json",
         footprints="nc03_band_footprints.json", parent="nc03_band.json"),
    dict(pass_id="TQ04", nation="TARTARUS", mod=ND.NATIONS["TQ04"]["mod"], spec="tq04_band_detail.json",
         footprints="tq03_band_footprints.json", parent="tq03_band.json"),
)

FACE_TOL = 40.0        # cm a detail may stand proud of its wall face before it counts as floating
RUN_TOL = 60.0         # cm a detail may overhang the end of its face


def wall_top(module, height):
    """Same rule the pass used: an eaves or deck socket if the kit declares one, else a low assumption."""
    sockets = KIT[module].get("sockets") or {}
    for key in ("eaves", "parapet", "deck"):
        s = sockets.get(key)
        if isinstance(s, dict) and s.get("z"):
            return float(s["z"])
    return height * 0.45


def audit(case):
    spec = json.loads((HERE / case["spec"]).read_text(encoding="utf-8"))
    foots = json.loads((HERE / case["footprints"]).read_text(encoding="utf-8"))
    parent = json.loads((HERE / case["parent"]).read_text(encoding="utf-8"))
    mod = case["mod"]
    palette = set(mod.PART_MATERIAL.values())

    # buildings in WORLD space, so seating is tested against where they really are
    buildings = []
    for fp in foots:
        wx, wy = mod.world(fp["u"], fp["v"])
        buildings.append({"module": fp["module"], "x": wx, "y": wy,
                          "yaw": (fp["yaw"] + mod.BEARING) % 360.0,
                          "w": fp["w"], "d": fp["d"], "z": fp["z"],
                          "top": wall_top(fp["module"],
                                          KIT[fp["module"]]["size"][2] * float(fp.get("scale", 1.0)))})

    problems = Counter()
    detail = defaultdict(list)
    seen = defaultdict(set)
    cover = defaultdict(lambda: [0, 0.0])
    total = tris = 0

    for b in spec["batches"]:
        mat = b["material"].rsplit("/", 1)[-1].split(".")[0]
        if mat not in palette:
            problems["material outside the nation palette: " + mat] += 1
        if b.get("collides"):
            problems["batch collides: " + b["id"]] += 1
        for inst in b["instances"]:
            total += 1
            x, y, z = inst[0], inst[1], inst[2]
            sx, sy, sz = inst[6], inst[7], inst[8]

            # 5. repetition -- exact duplicates within a batch
            key = (round(x, 1), round(y, 1), round(z, 1))
            if key in seen[b["id"]]:
                problems["duplicate instance in " + b["id"]] += 1
            seen[b["id"]].add(key)

            # 4. scale -- only the cornice may stretch, and only along its run
            is_cornice = b["id"].endswith("_Cornice")
            if is_cornice:
                if abs(sy - 1.0) > 0.01 or abs(sz - 1.0) > 0.01:
                    problems["cornice scaled off-run"] += 1
            elif abs(sx - 1.0) > 0.01 or abs(sy - 1.0) > 0.01 or abs(sz - 1.0) > 0.01:
                problems["module not placed at scale 1.0"] += 1

            # 1. nation -- the independent test
            got = nations.nation_at(x, y)
            got_id = got[0] if isinstance(got, (tuple, list)) else got
            if got_id != case["nation"]:
                problems["instance outside %s (landed in %s)" % (case["nation"], got_id)] += 1
                detail["wrong nation"].append((b["id"], round(x), round(y)))

            # 2/3. seating -- test against EVERY building and accept the one that actually seats it.
            #
            # The first version of this audit picked the building with the nearest CENTRE, and reported 293
            # NC02 instances floating and 109 above their wall. Every one was the audit's fault: a colonnade
            # is 23 m long and 4 m deep, so a window correctly seated on a house next door is still nearer to
            # the colonnade's centre than to the house's. Nearest-centre is not the same question as "whose
            # wall is this on", and on elongated buildings the two answers diverge badly.
            seat = None
            for bl in buildings:
                a = math.radians(-bl["yaw"])
                dx, dy = x - bl["x"], y - bl["y"]
                lx = dx * math.cos(a) - dy * math.sin(a)
                ly = dx * math.sin(a) + dy * math.cos(a)
                hw, hd = bl["w"] / 2.0, bl["d"] / 2.0
                on_x = abs(abs(lx) - hw) <= FACE_TOL and abs(ly) <= hd + RUN_TOL
                on_y = abs(abs(ly) - hd) <= FACE_TOL and abs(lx) <= hw + RUN_TOL
                if on_x or on_y:
                    rel = z - bl["z"]
                    # prefer a building that seats it AND whose wall is tall enough to carry it there
                    if seat is None or (rel <= bl["top"] + 2.0 and seat[1] > seat[0]["top"] + 2.0):
                        face = ("X+" if lx > 0 else "X-") if on_x else ("Y+" if ly > 0 else "Y-")
                        seat = (bl, rel, face)
            if seat is None:
                problems["not seated on any wall face"] += 1
                detail["floating"].append((b["id"], round(x), round(y), round(z)))
                continue
            bl, rel, face = seat
            fk = (bl["module"], round(bl["x"]), round(bl["y"]), face)
            cover[fk][0] += 1
            cover[fk][1] = bl["d"] if face.startswith("X") else bl["w"]
            if rel < -2.0:
                problems["below its building's floor"] += 1
            elif rel > bl["top"] + 2.0:
                problems["above the wall top it was placed against"] += 1
                detail["above wall"].append((b["id"], bl["module"], round(rel), round(bl["top"])))

        #: TRIANGLES COME FROM THE MESH INVENTORY, NOT THE KIT MODULE.
        #: This used to look up the MODULE and multiply its whole triangle count by each batch's
        #: instances -- but a module is placed as several co-located per-material batches, so a
        #: four-part module was counted four times over. IC04 reported ~310,592 triangles on
        #: 2026-09-23 when its real cost is 136,816, an inflation of 2.3x, and a triangle count that
        #: overstates is worse than none when it is what performance gets judged on.
        r = INVENTORY_BY_NAME.get(b["mesh"].rsplit("/", 1)[-1].split(".")[0])
        if r and r.get("tris"):
            tris += r["tris"] * len(b["instances"])

    parent_inst = sum(len(x["instances"]) for x in parent["batches"])
    print("== %s  (%s)" % (case["pass_id"], case["spec"]))
    print("   %d instances in %d batches, decorating a quarter of %d"
          % (total, len(spec["batches"]), parent_inst))
    if tris:
        print("   ~%s triangles added" % "{:,}".format(tris))
    faces = len(cover)
    if faces:
        per = sum(v[0] for v in cover.values()) / float(faces)
        print("   seated on %d wall faces, %.1f details per face" % (faces, per))
    if not problems:
        print("   PASS -- nation, seating, height, scale, repetition, collision and palette all clean")
        return True
    print("   PROBLEMS:")
    for k, v in problems.most_common():
        print("     %-52s %5d" % (k, v))
    for k, rows in detail.items():
        print("     e.g. %s: %s" % (k, rows[:3]))
    return False


def main():
    ok = all([audit(c) for c in CASES])
    print()
    print("All checks are on disk. They do not replace looking at it in the editor -- they decide whether it is")
    print("worth spending a slot on looking at it.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
