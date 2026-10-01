# THE EYES STAY INSIDE THE FACE -- a regression check on Relay Dog skin figures (.wlvox).
#
# FOUNDER CORRECTION, 2026-10-01: "On the affected mascot skins, the two glowing eyes are currently positioned/
# protruding OUTSIDE the black square/face area ... The mascot's eyes are supposed to be visually CONTAINED INSIDE
# the black square face/visor area", and "Add a QA/regression check ... The test should validate the intended
# relationship between face bounds, eye bounds, eye forward depth ... Do not use a test so loose that the current
# incorrect protruding version would pass."
#
# MEASURED FROM THE BOXES ALONE, the way a camera in front of the figure sees them. For every status eye (material
# "eye") that is not hidden behind something else:
#   E1 HOUSED      the first opaque surface met just outside each edge of the eye, all the way round, is DARK -- black
#                  visible round the eye on every side (MARGIN beyond each edge);
#   E2 NOT PROUD   scanning outward from the eye across its housing until the black ends, the eye's front face is no
#                  further forward than the face that rims the housing (TOLERANCE) -- the eye sits IN the face;
#   E3 HALO        wherever an eye-halo pane (additive, "halo" in its name) can be seen, its light falls on the black
#                  housing or on an eye -- never on the coat or a mask round it -- it is behind its eye's face, and it
#                  never reaches inward past the eyes toward the other one;
#   E4 PAIRED      the visible eyes come in mirrored pairs: same size, same height.
# The RC6 figures fail E2 and E3 (visor box 0.40 proud of the head, eyes 0.15 proud of that, halos 2.88 tall on a
# 2.70 visor and standing in front of everything) -- the check was run against them before the fix to prove it.
#
# Mirrors the package QA's Q25 (WonderlandQaCommands.cpp), which applies the same rules to the figure file the game
# actually loaded. relay_dog_skins.py runs this on every skin it writes and refuses to write one that fails.
#
#   python wonderland/Tools/skin_eye_check.py [--skins DIR] [Name ...]      (default: the five-skin roster, Relay OG's wardrobe figure included)
import argparse
import os
import sys

MARGIN = 0.12      # least black seen round an eye (relay_dog_skins.FACE["margin"]): Baal's skull sockets, built on its 0.6 grid, leave 0.144 above and inside its eyes, the narrowest housing of the five
TOLERANCE = 0.02   # how far an eye's face may stand forward of the face round its housing
HALO_MARGIN = 0.10 # visible halo light keeps this far inside the black as well
DARK = 0.10        # an opaque, non-emissive surface below this luminance reads as the black housing
STEP = 0.05
SCAN = 6.0
SHIPPED = ["RelayOg", "CelestialLight", "SkeletonFlameV2", "JackFlame", "Baal"]
# RELAY OG: the Dog in play is the canon body; RelayOg.wlvox is its WARDROBE PREVIEW, and it is held to the same rules
# (founder, 2026-10-01: "Change the relay og wardrobe preview to the correct visuals").


def load(path):
    materials, motions, boxes = {}, {}, []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            b = line.split()
            if not b or b[0].startswith("#"):
                continue
            if b[0] == "material" and len(b) >= 7:
                materials[b[1]] = (b[2], (float(b[3]), float(b[4]), float(b[5])))
            elif b[0] == "part" and len(b) >= 7:
                motions[b[1]] = b[6]
            elif b[0] == "box" and len(b) >= 9:
                rot = [float(v) for v in b[9:12]] if len(b) >= 12 else [0.0, 0.0, 0.0]
                c = [float(v) for v in b[3:6]]
                s = [float(v) for v in b[6:9]]
                boxes.append(dict(part=b[1], mat=b[2], c=c, s=s, rotated=any(abs(r) > 1e-4 for r in rot)))
    return materials, motions, boxes


class Face:
    """The figure as seen from the front: every opaque, unrotated box that is drawn as a box."""

    def __init__(self, materials, motions, boxes):
        self.materials = materials
        self.surfaces = []
        self.eyes = []
        self.halos = []
        for i, b in enumerate(boxes):
            kind, rgb = materials.get(b["mat"], ("lit", (1.0, 1.0, 1.0)))
            if b["rotated"] or motions.get(b["part"]) == "twinkle":
                continue                     # fire is drawn as fire, not as its boxes; rotated boxes are never on a face
            (cx, cy, cz), (sx, sy, sz) = b["c"], b["s"]
            rect = (cy - sy * 0.5, cy + sy * 0.5, cz - sz * 0.5, cz + sz * 0.5)
            entry = dict(i=i, mat=b["mat"], kind=kind, rgb=rgb, rect=rect, front=cx + sx * 0.5, back=cx - sx * 0.5)
            if kind == "add":
                if "halo" in b["mat"]:
                    self.halos.append(entry)
                continue                     # additive light is never a surface
            self.surfaces.append(entry)
            if b["mat"] == "eye":
                self.eyes.append(entry)

    def front_at(self, y, z, limit=None):
        # INCLUSIVE AT THE EDGES: two surfaces that meet leave no gap. A point exactly on the seam between the recessed
        # visor and the coat round its window is on both, and the nearer one is what a camera sees there -- tested
        # strictly, such a point saw through to the back of the head and read as a hole that is not there.
        # LIMIT: only surfaces whose face is no further forward than this -- the FACE, without the dress worn over it.
        best = None
        for s in self.surfaces:
            if limit is not None and s["front"] > limit:
                continue
            y0, y1, z0, z1 = s["rect"]
            if y0 - 1e-4 <= y <= y1 + 1e-4 and z0 - 1e-4 <= z <= z1 + 1e-4 and (best is None or s["front"] > best["front"]):
                best = s
        return best

    def dark(self, s):
        if s is None or s["kind"] in ("glow", "add"):
            return False
        r, g, b = s["rgb"]
        return 0.2126 * r + 0.7152 * g + 0.0722 * b < DARK


def check(path):
    """(ok, lines): every rule, with what was measured."""
    face = Face(*load(path))
    lines, ok = [], True
    visible = []
    for e in face.eyes:
        y0, y1, z0, z1 = e["rect"]
        top = face.front_at((y0 + y1) * 0.5, (z0 + z1) * 0.5)
        if top is not None and top["i"] != e["i"] and top["front"] > e["front"] + 1e-6:
            continue                         # hidden behind something (Baal's own visor eyes, behind its skull)
        visible.append(e)
    if len(visible) < 2:
        return False, ["no visible pair of status eyes (%d visible)" % len(visible)]
    inner_edge = min(min(abs(e["rect"][0]), abs(e["rect"][1])) for e in visible)
    ornaments = set()
    for e in visible:
        y0, y1, z0, z1 = e["rect"]
        cy, cz = (y0 + y1) * 0.5, (z0 + z1) * 0.5
        tag = "eye at y %+.2f z %.2f (%.2f x %.2f)" % (cy, cz, y1 - y0, z1 - z0)

        def scan(limit):
            """Out from each edge across the housing until the black ends; returns {direction: (distance, rim)}."""
            out = {}
            for name, dy, dz, start in (("out+y", 1, 0, y1), ("out-y", -1, 0, y0), ("up", 0, 1, z1), ("down", 0, -1, z0)):
                d, hit = STEP, None
                while d <= SCAN:
                    s = face.front_at(start + dy * d if dy else cy, start + dz * d if dz else cz, limit)
                    if s is None or (not face.dark(s) and s["mat"] != "eye"):
                        hit = s
                        break
                    d += STEP
                out[name] = (d, hit)
            return out

        # E2: the face that rims the housing is the LEAST proud surface met where the black ends, in any direction;
        # the eye's face may stand no further forward than it
        found = scan(None)
        rims = [hit["front"] for _, hit in found.values() if hit is not None]
        if len(rims) < 4:
            ok = False
            lines.append("E2 FAIL %s: no face round its housing in %d of 4 directions within %.1f" % (tag, 4 - len(rims), SCAN))
            continue
        plane = min(rims)
        limit = plane + TOLERANCE
        if e["front"] > limit:
            ok = False
            lines.append("E2 FAIL %s: its face at x %.2f stands %.2f PROUD of the face round its housing (x %.2f)" % (tag, e["front"], e["front"] - plane, plane))
        else:
            extent = {k: v[0] for k, v in scan(limit).items()}
            lines.append("E2 ok   %s: face x %.2f, %.2f behind the face round it (x %.2f); black %.2f up, %.2f down, %.2f/%.2f across"
                         % (tag, e["front"], plane - e["front"], plane, extent["up"], extent["down"], extent["out-y"], extent["out+y"]))
        # E1: black all round, MARGIN beyond each edge -- judged on the FACE (surfaces no further forward than it). Dress
        # standing proud of the face and passing in front of the housing (Celestial Light's brow star sends a ray down
        # between the eyes, as it always has) is the skin's own, and is named below rather than counted against the eye.
        ring = []
        for k in range(9):
            t = k / 8.0
            ring += [(y0 - MARGIN + (y1 - y0 + 2 * MARGIN) * t, z0 - MARGIN), (y0 - MARGIN + (y1 - y0 + 2 * MARGIN) * t, z1 + MARGIN),
                     (y0 - MARGIN, z0 - MARGIN + (z1 - z0 + 2 * MARGIN) * t), (y1 + MARGIN, z0 - MARGIN + (z1 - z0 + 2 * MARGIN) * t)]
        bad = []
        for (y, z) in ring:
            s = face.front_at(y, z, limit)
            if not face.dark(s) and not (s is not None and s["mat"] == "eye" and s["i"] == e["i"]):
                bad.append((y, z, s))
            over = face.front_at(y, z)
            if over is not None and over["front"] > limit and not face.dark(over):
                ornaments.add("%s (face x %.2f, %.2f proud of the face)" % (over["mat"], over["front"], over["front"] - plane))
        if bad:
            ok = False
            y, z, s = bad[0]
            lines.append("E1 FAIL %s: not black %.2f beyond its edge at (%.2f, %.2f): %s" % (tag, MARGIN, y, z, s["mat"] if s else "nothing"))
        else:
            lines.append("E1 ok   %s: black at least %.2f beyond every edge" % (tag, MARGIN))
    for o in sorted(ornaments):
        lines.append("note    dress passing in front of the housing, not part of the face: %s" % o)
    # E3: where halo light can be seen, it is on black or on an eye, behind the eyes' faces, and not between the eyes
    eye_front = max(e["front"] for e in visible)
    for h in face.halos:
        y0, y1, z0, z1 = h["rect"]
        seen = bad_on = between = 0
        first_bad = None
        n = max(2, int((y1 - y0) / 0.1)), max(2, int((z1 - z0) / 0.1))
        for iy in range(n[0] + 1):
            for iz in range(n[1] + 1):
                y = y0 + 0.01 + (y1 - y0 - 0.02) * iy / n[0]
                z = z0 + 0.01 + (z1 - z0 - 0.02) * iz / n[1]
                s = face.front_at(y, z)
                if s is not None and s["front"] > h["front"] + 1e-6:
                    continue                 # hidden behind a surface: no light reaches the eye from here
                seen += 1
                around = [face.front_at(y + a, z + b) for a, b in ((0, 0), (HALO_MARGIN, 0), (-HALO_MARGIN, 0), (0, HALO_MARGIN), (0, -HALO_MARGIN))]
                if not all(t is not None and (face.dark(t) or t["mat"] == "eye" or t["front"] > h["front"] + 1e-6) for t in around):
                    bad_on += 1
                    first_bad = first_bad or (y, z, s["mat"] if s else "nothing")
                if abs(y) < inner_edge - 0.01:
                    between += 1
        tag = "halo at y %+.2f z %.2f (%.2f x %.2f, face x %.2f)" % ((y0 + y1) * 0.5, (z0 + z1) * 0.5, y1 - y0, z1 - z0, h["front"])
        if seen == 0:
            lines.append("E3 ok   %s: wholly hidden" % tag)
            continue
        if bad_on:
            ok = False
            lines.append("E3 FAIL %s: %d of %d visible points light something that is not the black housing, e.g. (%.2f, %.2f) over %s"
                         % (tag, bad_on, seen, first_bad[0], first_bad[1], first_bad[2]))
        if h["front"] > eye_front + 1e-6:
            ok = False
            lines.append("E3 FAIL %s: stands in FRONT of the eyes' faces (x %.2f)" % (tag, eye_front))
        if between:
            ok = False
            lines.append("E3 FAIL %s: %d visible points reach inward past the eyes" % (tag, between))
        if not bad_on and h["front"] <= eye_front + 1e-6 and not between:
            lines.append("E3 ok   %s: %d visible points, all over the black housing or an eye" % (tag, seen))
    # E4: mirrored pairs
    for e in visible:
        y0, y1, z0, z1 = e["rect"]
        mate = [f for f in visible if abs(((f["rect"][0] + f["rect"][1]) * 0.5) + (y0 + y1) * 0.5) < 0.02
                and abs(f["rect"][2] - z0) < 0.02 and abs((f["rect"][1] - f["rect"][0]) - (y1 - y0)) < 0.02]
        if not mate:
            ok = False
            lines.append("E4 FAIL eye at y %+.2f z %.2f has no mirrored partner" % ((y0 + y1) * 0.5, (z0 + z1) * 0.5))
    return ok, lines


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="Relay Dog skins: are the eyes inside the face?")
    ap.add_argument("--skins", default=os.path.join(here, "..", "RelaySkins"))
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("names", nargs="*")
    args = ap.parse_args()
    names = args.names or SHIPPED
    failed = 0
    for name in names:
        path = os.path.join(args.skins, name + ".wlvox")
        if not os.path.isfile(path):
            print("%-16s MISSING %s" % (name, path))
            failed += 1
            continue
        ok, lines = check(path)
        failed += 0 if ok else 1
        print("%-16s %s" % (name, "PASS -- eyes inside the face" if ok else "FAIL"))
        if not args.quiet or not ok:
            for line in lines:
                print("    " + line)
    print("EYES INSIDE THE FACE: %s (%d of %d skins failed)" % ("PASS" if failed == 0 else "FAIL", failed, len(names)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
