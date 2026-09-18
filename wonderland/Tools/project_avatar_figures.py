"""Generate the Project Avatar figures: TEN TAILS and CHERUBIM, each at SMALL, MEDIUM and LARGE.

WHAT A PROJECT AVATAR IS (founder, 2026-09-17). The living representation of a PROJECT inside Wonderland. Not Julius,
not the Relay Dog, not Jhinn, not an LLM Companion, not an NPC: it belongs to the project, and it GROWS as the project
grows. A user starting a project picks a skin and receives the SMALL form; the reference sheets the founder supplied are
the LARGE, mature form.

WHY VOXELS, AND WHY A TEXT FILE. The founder's two reference sheets are themselves voxel-built creatures, which is
Wonderland's own language. So a form is a list of boxes in the `wlvox 1` format
(Source/Wonderland/WonderlandCompanionFigure.h): read at spawn, built from engine cubes, no .uasset created, and
retunable in PIE without a compile. When a design is approved these can become real meshes in the forge; the runtime
does not care where its boxes came from.

NOT ONE MESH AT THREE SCALES -- the founder was explicit. Every stage is generated from its own parameters: the body
lengthens, the legs strengthen, the jaw grows, the tails lengthen and separate, the surface gains complexity, the wings
gain spans and rows, the rings multiply. The IDENTITY is what stays fixed: ten tails and a central eye at every stage
for Ten Tails; a central all-seeing eye, wings and rings at every stage for Cherubim.

DAYLIGHT EMISSIVE. Wonderland is lit by a physically based sun and exposed for it, so glow strengths authored on a 0..10
artistic scale are multiplied by GLOW_SCALE at write time. This was measured the hard way once already (2026-09-15:
every glow part rendered black until the scale was found); the same lesson applies here.

SEEDED. Every figure regenerates byte-identical, so a founder review and a later tweak can be compared.

Usage:  python wonderland/Tools/project_avatar_figures.py [--out DIR]
"""

import argparse
import math
import os
import random

GLOW_SCALE = 4000.0

# ---------------------------------------------------------------------------- palettes, read off the reference sheets

# TEN TAILS: "earthy / pale stone-organic body", red glowing eyes and energy.
STONE = (0.615, 0.545, 0.438)
STONE_PALE = (0.706, 0.639, 0.525)
STONE_DEEP = (0.386, 0.335, 0.270)
EYE_RED = (1.00, 0.105, 0.075)
EYE_RIM = (0.62, 0.055, 0.045)
PUPIL = (0.055, 0.020, 0.020)

# CHERUBIM: ivory and gold, warm gold light.
IVORY = (0.895, 0.878, 0.840)
IVORY_DEEP = (0.660, 0.640, 0.605)
GOLD = (0.855, 0.668, 0.268)
GOLD_DEEP = (0.545, 0.392, 0.130)
EYE_GOLD = (1.00, 0.760, 0.300)
SCLERA = (0.960, 0.950, 0.930)


# HOW BIG EACH STAGE REALLY IS, in metres, against a Wonderland player of about 1.8 m. The founder asked for a coherent
# playable scale rather than locked numbers: SMALL is companion-sized, MEDIUM clearly larger and more developed, LARGE a
# legendary presence that still fits an ordinary district rather than clipping through every building.
#
# The generator SOLVES the voxel size to hit these, so a design change to the grid never quietly changes how tall the
# creature stands. Change the metres here; the shapes stay as drawn.
TARGET_METRES = {"small": 1.15, "medium": 2.70, "large": 5.60}


def spow(value, exponent):
    return math.copysign(abs(value) ** exponent, value)


def normalise(v):
    length = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) or 1.0
    return (v[0] / length, v[1] / length, v[2] / length)


class Figure:
    """One form of one Project Avatar, as boxes."""

    def __init__(self, name, seed, voxel_uu):
        self.name = name
        self.voxel_uu = voxel_uu
        self.rng = random.Random(seed)
        self.materials = []
        self.parts = []
        self.part_names = set()
        self.boxes = []

    # ---------------------------------------------------------------- records
    def material(self, name, kind, rgb, strength=1.0):
        self.materials.append((name, kind, rgb, strength))

    def part(self, name, parent, pivot, motion="none", a=None, b=None):
        assert parent == "-" or parent in self.part_names, (name, parent)
        self.parts.append((name, parent, pivot, motion, a, b))
        self.part_names.add(name)

    def box(self, part, material, centre, size, pitch=0.0, yaw=0.0, roll=0.0):
        assert part in self.part_names, part
        self.boxes.append((part, material, centre, size, (pitch, yaw, roll)))

    # ------------------------------------------------------------- primitives
    def shell(self, part, material_for, centre, radii, n=2.6, tile=2.2, lat=(-90.0, 90.0), jitter=0.0):
        """A seamed voxel shell over a superellipsoid. n near 3 reads as a rounded cube, near 2 as a soft egg."""
        cx, cy, cz = centre
        a, b, c = radii
        e = 2.0 / n
        mean = (a + b + c) / 3.0
        rings = max(3, int(round(math.radians(lat[1] - lat[0]) * mean / tile)))
        d_phi = math.radians(lat[1] - lat[0]) / rings
        for ring in range(rings + 1):
            phi = math.radians(lat[0]) + d_phi * ring
            around = max(4, int(round(2.0 * math.pi * max(math.cos(phi), 0.12) * mean / tile)))
            d_theta = 2.0 * math.pi / around
            offset = (ring % 2) * d_theta * 0.5
            for k in range(around):
                theta = offset + d_theta * k
                ux, uy, uz = math.cos(phi) * math.cos(theta), math.cos(phi) * math.sin(theta), math.sin(phi)
                px, py, pz = a * spow(ux, e), b * spow(uy, e), c * spow(uz, e)
                wobble = 1.0 + (self.rng.uniform(-jitter, jitter) if jitter > 0.0 else 0.0)
                size = tile * wobble
                self.box(part, material_for(px, py, pz), (cx + px, cy + py, cz + pz), (size, size, size))

    def limb(self, part, material_for, start, end, r_start, r_end, tile=2.0, twist=0.0):
        """A tapering chain of blocks from start to end: a leg, a tail, a neck."""
        sx, sy, sz = start
        ex, ey, ez = end
        length = math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2 + (ez - sz) ** 2)
        steps = max(2, int(round(length / (tile * 0.85))))
        for step in range(steps + 1):
            t = step / steps
            cx = sx + (ex - sx) * t
            cy = sy + (ey - sy) * t
            cz = sz + (ez - sz) * t
            radius = r_start + (r_end - r_start) * t
            size = max(tile * 0.7, radius * 1.15)
            yaw = twist * t
            self.box(part, material_for(cx, cy, cz), (cx, cy, cz), (size, size, size), 0.0, yaw, 0.0)
            # A SECOND, OFFSET BLOCK gives the limb a knobbled, stone-grown edge rather than a smooth sausage.
            if radius > tile * 0.8:
                off = radius * 0.55
                ox = self.rng.uniform(-off, off)
                oy = self.rng.uniform(-off, off)
                self.box(part, material_for(cx + ox, cy + oy, cz), (cx + ox, cy + oy, cz + off * 0.3), (size * 0.62,) * 3)

    def eye(self, part, centre, radius, facing, sclera, iris, pupil, ring=None):
        """An eye that reads at a distance: a lid ring, a bright iris disc and a dark pupil, facing a direction."""
        fx, fy, fz = normalise(facing)
        # Two in-plane axes for laying the disc out.
        up = (0.0, 0.0, 1.0) if abs(fz) < 0.9 else (1.0, 0.0, 0.0)
        ax = normalise((up[1] * fz - up[2] * fy, up[2] * fx - up[0] * fz, up[0] * fy - up[1] * fx))
        ay = normalise((fy * ax[2] - fz * ax[1], fz * ax[0] - fx * ax[2], fx * ax[1] - fy * ax[0]))
        tile = max(0.8, radius * 0.42)

        def at(u, v, push):
            return (
                centre[0] + ax[0] * u + ay[0] * v + fx * push,
                centre[1] + ax[1] * u + ay[1] * v + fy * push,
                centre[2] + ax[2] * u + ay[2] * v + fz * push,
            )

        steps = max(3, int(round(radius / (tile * 0.8))))
        for iy in range(-steps, steps + 1):
            for ix in range(-steps, steps + 1):
                u = ix * tile * 0.85
                v = iy * tile * 0.85
                d = math.sqrt(u * u + v * v)
                if d > radius:
                    continue
                if d > radius * 0.72:
                    self.box(part, ring or sclera, at(u, v, radius * 0.16), (tile,) * 3)
                elif d > radius * 0.30:
                    self.box(part, iris, at(u, v, radius * 0.24), (tile,) * 3)
                else:
                    self.box(part, pupil, at(u, v, radius * 0.30), (tile,) * 3)

    def torus(self, part, material_for, centre, major, minor, tilt, tile=1.8):
        """A voxel ring: a wheel of Cherubim, tilted out of the plane."""
        around = max(10, int(round(2.0 * math.pi * major / (tile * 0.9))))
        through = max(2, int(round(2.0 * math.pi * minor / (tile * 1.1))))
        pitch, yaw = math.radians(tilt[0]), math.radians(tilt[1])
        for i in range(around):
            a = 2.0 * math.pi * i / around
            for j in range(through):
                b = 2.0 * math.pi * j / through
                r = major + minor * math.cos(b)
                x, y, z = r * math.cos(a), r * math.sin(a), minor * math.sin(b)
                # tilt about Y then about Z
                x, z = x * math.cos(pitch) - z * math.sin(pitch), x * math.sin(pitch) + z * math.cos(pitch)
                x, y = x * math.cos(yaw) - y * math.sin(yaw), x * math.sin(yaw) + y * math.cos(yaw)
                point = (centre[0] + x, centre[1] + y, centre[2] + z)
                self.box(part, material_for(a, b), point, (tile,) * 3)

    def feather_wing(self, part, side, root, span, rows, spread, sweep, tile=1.9, material_for=None):
        """A wing as rows of blocky feathers: longest at the outer edge, shorter toward the root."""
        for row in range(rows):
            t_row = row / max(rows - 1, 1)
            # Each row is a fan of feathers; later rows sit lower and sweep back.
            count = max(3, int(round(span / (tile * 2.1))))
            for k in range(count):
                t = (k + 0.5) / count
                length = span * (0.35 + 0.65 * t) * (1.0 - 0.28 * t_row)
                angle = math.radians(spread * (1.0 - t) - sweep * t_row)
                x = root[0] - math.sin(angle) * length * 0.35 - span * 0.10 * t_row
                y = root[1] + side * (root[2] * 0.0 + length * math.cos(math.radians(18.0)) * 0.75 + tile * 1.4)
                z = root[2] + math.sin(angle) * length * 0.55 - t_row * tile * 2.3
                # The feather itself: a tapering run of blocks outward and down.
                tip = (x - length * 0.34, root[1] + side * (length * 1.02 + tile * 1.2), z - length * 0.30)
                self.limb(part, material_for, (x, y, z), tip, tile * 1.15, tile * 0.55, tile=tile)

    # ------------------------------------------------------------------ scale
    def fit_to_metres(self, metres):
        """Set the voxel size so this form stands exactly this tall. Measured from the boxes, after they are all in."""
        lowest = min(c[2] - s[2] * 0.5 for _, _, c, s, _ in self.boxes)
        highest = max(c[2] + s[2] * 0.5 for _, _, c, s, _ in self.boxes)
        units = max(highest - lowest, 0.001)
        self.voxel_uu = metres * 100.0 / units
        return self.voxel_uu

    # ------------------------------------------------------------------ write
    def write(self, path):
        lines = [
            "# %s -- generated by wonderland/Tools/project_avatar_figures.py. Do not hand-edit; change the generator." % self.name,
            "# A PROJECT AVATAR form. Read by the Project Avatar runtime; format in Source/Wonderland/WonderlandCompanionFigure.h.",
            "wlvox 1",
            "voxel %.3f" % self.voxel_uu,
        ]
        for name, kind, rgb, strength in self.materials:
            if kind in ("glow", "add"):
                strength *= GLOW_SCALE
            lines.append("material %s %s %.4f %.4f %.4f %.3f" % (name, kind, rgb[0], rgb[1], rgb[2], strength))
        for name, parent, pivot, motion, a, b in self.parts:
            extra = "" if a is None else (" %.3f" % a) + ("" if b is None else " %.3f" % b)
            lines.append("part %s %s %.3f %.3f %.3f %s%s" % (name, parent, pivot[0], pivot[1], pivot[2], motion, extra))
        for part, material, c, s, r in self.boxes:
            if abs(r[0]) < 1e-4 and abs(r[1]) < 1e-4 and abs(r[2]) < 1e-4:
                lines.append("box %s %s %.3f %.3f %.3f %.3f %.3f %.3f" % (part, material, c[0], c[1], c[2], s[0], s[1], s[2]))
            else:
                lines.append("box %s %s %.3f %.3f %.3f %.3f %.3f %.3f %.2f %.2f %.2f" % (part, material, c[0], c[1], c[2], s[0], s[1], s[2], r[0], r[1], r[2]))
        assert len(self.boxes) <= 6000, (self.name, "boxes", len(self.boxes))
        assert len(self.parts) <= 48, (self.name, "parts", len(self.parts))
        assert len(self.materials) <= 12, (self.name, "materials", len(self.materials))
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write("\n".join(lines) + "\n")
        return len(self.boxes), len(self.parts), len(self.materials)


# ============================================================================ TEN TAILS

# THE IDENTITY, AT EVERY STAGE: ten tails, a central eye, an eye in each tail, four legs, pale stone-organic body,
# red energy. What changes is how grown it is.
TEN_TAILS_STAGES = {
    # voxel: uu per grid unit, so the same grid design lands at a playable size. See the scale note in the report.
    "small": dict(
        voxel=3.05, body=(9.5, 7.0, 6.6), head=5.2, neck=3.4, leg=6.2, leg_r=2.3, paw=2.6,
        tail_len=15.0, tail_r=2.5, tail_tip=1.0, tail_spread=44.0, tail_rise=54.0, tail_parts=1,
        eye=4.0, tail_eye=1.35, jaw=3.2, teeth=4, horns=0, tile=2.0, glow=3.2, crest=0.55, crag=0.10,
    ),
    "medium": dict(
        voxel=3.95, body=(15.0, 8.6, 7.8), head=6.0, neck=5.0, leg=9.6, leg_r=2.9, paw=3.3,
        tail_len=27.0, tail_r=3.0, tail_tip=0.9, tail_spread=58.0, tail_rise=62.0, tail_parts=2,
        eye=4.4, tail_eye=1.75, jaw=4.4, teeth=6, horns=4, tile=2.1, glow=5.2, crest=0.8, crag=0.16,
    ),
    "large": dict(
        voxel=5.25, body=(21.0, 10.4, 9.2), head=7.0, neck=6.6, leg=13.0, leg_r=3.6, paw=4.2,
        tail_len=42.0, tail_r=3.6, tail_tip=0.85, tail_spread=72.0, tail_rise=68.0, tail_parts=2,
        eye=5.0, tail_eye=2.2, jaw=5.8, teeth=9, horns=8, tile=2.2, glow=8.0, crest=1.0, crag=0.22,
    ),
}


def ten_tails(stage):
    p = TEN_TAILS_STAGES[stage]
    figure = Figure("TEN TAILS PROJECT AVATAR -- %s" % stage.upper(), seed=1010 + len(stage), voxel_uu=p["voxel"])
    figure.material("stone", "rim", STONE, 1.0)
    figure.material("pale", "rim", STONE_PALE, 1.0)
    figure.material("crag", "lit", STONE_DEEP, 1.0)
    figure.material("eyered", "glow", EYE_RED, p["glow"])
    figure.material("eyerim", "glow", EYE_RIM, p["glow"] * 0.45)
    figure.material("pupil", "lit", PUPIL, 1.0)
    figure.material("ember", "add", EYE_RED, p["glow"] * 0.10)

    bl, bw, bh = p["body"]
    crag_chance = p["crag"]

    def hide(x, y, z):
        # Pale along the spine and the flanks' tops, deeper stone underneath: a creature lit from above, in blocks.
        if figure.rng.random() < crag_chance:
            return "crag"
        return "pale" if z > bh * 0.15 else "stone"

    ground = 0.0
    body_z = ground + p["leg"] + bh * 0.72

    # ---- the body: a heavy barrel, longer and lower as it matures
    figure.part("root", "-", (0.0, 0.0, 0.0), "float")
    figure.shell("root", hide, (0.0, 0.0, body_z), (bl * 0.5, bw * 0.5, bh * 0.5), n=2.8, tile=p["tile"], jitter=0.10)
    # A crest of plates along the spine, taller at every stage.
    plates = max(3, int(bl / (p["tile"] * 1.6)))
    for i in range(plates):
        t = (i + 0.5) / plates
        x = -bl * 0.5 + bl * t
        height = p["crest"] * p["tile"] * (1.6 + 2.2 * math.sin(math.pi * t))
        figure.box("root", "crag", (x, 0.0, body_z + bh * 0.5 + height * 0.45), (p["tile"] * 1.25, p["tile"] * 0.9, height))

    # ---- four legs, heavier and longer as it matures
    for sx, name_x in ((1.0, "f"), (-1.0, "r")):
        for sy, name_y in ((1.0, "r"), (-1.0, "l")):
            name = "leg_%s%s" % (name_x, name_y)
            hip = (sx * bl * 0.30, sy * bw * 0.42, body_z - bh * 0.32)
            figure.part(name, "root", hip, "none")
            knee = (hip[0] + sx * p["leg"] * 0.10, hip[1] + sy * p["leg"] * 0.06, hip[2] - p["leg"] * 0.55)
            foot = (hip[0] + sx * p["leg"] * 0.20, hip[1] + sy * p["leg"] * 0.10, ground + p["paw"] * 0.45)
            figure.limb(name, hide, hip, knee, p["leg_r"], p["leg_r"] * 0.82, tile=p["tile"])
            figure.limb(name, hide, knee, foot, p["leg_r"] * 0.82, p["leg_r"] * 0.66, tile=p["tile"])
            # The paw, and blocky claws that grow into the reference's talons.
            figure.shell(name, hide, foot, (p["paw"] * 1.25, p["paw"], p["paw"] * 0.62), n=3.0, tile=p["tile"] * 0.9)
            claws = 3
            for c in range(claws):
                ty = (c - (claws - 1) * 0.5) / max(claws - 1, 1)
                tip = (foot[0] + sx * p["paw"] * 1.9, foot[1] + ty * p["paw"] * 1.1, ground + p["paw"] * 0.22)
                figure.limb(name, lambda *_: "crag", (foot[0] + sx * p["paw"] * 0.9, foot[1] + ty * p["paw"] * 0.9, foot[2]),
                            tip, p["tile"] * 0.7, p["tile"] * 0.34, tile=p["tile"] * 0.8)

    # ---- neck and head: the head is proportionally largest when young
    neck_root = (bl * 0.46, 0.0, body_z + bh * 0.16)
    head_c = (neck_root[0] + p["neck"] * 0.85, 0.0, neck_root[1] * 0.0 + body_z + bh * 0.30 + p["neck"] * 0.30)
    figure.part("head", "root", head_c, "head")
    figure.limb("root", hide, neck_root, (head_c[0] - p["head"] * 0.6, 0.0, head_c[2] - p["head"] * 0.1),
                p["head"] * 0.62, p["head"] * 0.74, tile=p["tile"])
    figure.shell("head", hide, head_c, (p["head"] * 0.92, p["head"] * 0.80, p["head"] * 0.74), n=2.9, tile=p["tile"], jitter=0.08)

    # THE CENTRAL EYE, the thing that says Ten Tails at any size: on the brow, facing forward.
    brow = (head_c[0] + p["head"] * 0.62, 0.0, head_c[2] + p["head"] * 0.30)
    figure.eye("head", brow, p["eye"] * 0.5, (1.0, 0.0, 0.22), "eyerim", "eyered", "pupil")
    figure.box("head", "ember", (brow[0] + 0.6, 0.0, brow[2]), (p["eye"] * 0.9,) * 3)

    # ---- the maw: small and blunt when young, a chasm when mature
    jaw_c = (head_c[0] + p["head"] * 0.50, 0.0, head_c[2] - p["head"] * 0.42)
    figure.part("jaw", "head", jaw_c, "none")
    figure.shell("jaw", hide, (jaw_c[0] + p["jaw"] * 0.20, 0.0, jaw_c[2] - p["jaw"] * 0.22),
                 (p["jaw"] * 0.95, p["jaw"] * 0.72, p["jaw"] * 0.42), n=3.0, tile=p["tile"] * 0.95)
    for t in range(p["teeth"]):
        ty = (t - (p["teeth"] - 1) * 0.5) / max(p["teeth"] - 1, 1)
        tooth_y = ty * p["jaw"] * 1.15
        figure.box("head", "pale", (jaw_c[0] + p["jaw"] * 0.42, tooth_y, jaw_c[2] + p["jaw"] * 0.22),
                   (p["tile"] * 0.7, p["tile"] * 0.6, p["tile"] * 1.25))
        figure.box("jaw", "pale", (jaw_c[0] + p["jaw"] * 0.42, tooth_y, jaw_c[2] - p["jaw"] * 0.30),
                   (p["tile"] * 0.7, p["tile"] * 0.6, p["tile"] * 1.05))

    # ---- horns: none when young, a crown of them when mature
    for h in range(p["horns"]):
        side = 1.0 if h % 2 == 0 else -1.0
        t = (h // 2 + 1) / max(p["horns"] // 2, 1)
        base = (head_c[0] - p["head"] * 0.25 * t, side * p["head"] * (0.45 + 0.22 * t), head_c[2] + p["head"] * 0.55)
        tip = (base[0] - p["head"] * 0.35, base[1] + side * p["head"] * 0.30, base[2] + p["head"] * (0.55 + 0.30 * t))
        figure.limb("head", lambda *_: "crag", base, tip, p["tile"] * 0.85, p["tile"] * 0.30, tile=p["tile"] * 0.85)

    # ---- TEN TAILS. All ten at every stage: that is the name.
    count = 10
    for index in range(count):
        # Fanned symmetrically behind and above, the outer ones rising highest.
        half = (index - (count - 1) * 0.5) / ((count - 1) * 0.5)
        yaw = math.radians(half * p["tail_spread"])
        rise = math.radians(p["tail_rise"] * (0.62 + 0.38 * (1.0 - abs(half))))
        root = (-bl * 0.46, half * bw * 0.30, body_z + bh * 0.34)
        name = "tail_%d" % index
        figure.part(name, "root", root, "tail", 0.0, float(count))
        length = p["tail_len"]
        mid = (
            root[0] - math.cos(rise) * length * 0.45 * math.cos(yaw) * 1.0,
            root[1] - math.cos(rise) * length * 0.45 * math.sin(yaw) * -1.0,
            root[2] + math.sin(rise) * length * 0.45,
        )
        if p["tail_parts"] == 1:
            figure.limb(name, hide, root, mid, p["tail_r"], p["tail_r"] * p["tail_tip"], tile=p["tile"])
            eye_at = (root[0] + (mid[0] - root[0]) * 0.72, root[1] + (mid[1] - root[1]) * 0.72, root[2] + (mid[2] - root[2]) * 0.72)
            facing = (0.4, math.sin(yaw) * -1.0, 0.5)
        else:
            tip = (
                root[0] - math.cos(rise * 0.82) * length * 0.95 * math.cos(yaw),
                root[1] + math.cos(rise * 0.82) * length * 0.95 * math.sin(yaw),
                root[2] + math.sin(rise * 0.82) * length * 0.95,
            )
            figure.limb(name, hide, root, mid, p["tail_r"], p["tail_r"] * 0.72, tile=p["tile"])
            outer = "%s_tip" % name
            figure.part(outer, name, mid, "tail", 1.0, float(count))
            figure.limb(outer, hide, mid, tip, p["tail_r"] * 0.72, p["tail_r"] * p["tail_tip"], tile=p["tile"])
            eye_at = (mid[0] + (tip[0] - mid[0]) * 0.34, mid[1] + (tip[1] - mid[1]) * 0.34, mid[2] + (tip[2] - mid[2]) * 0.34)
            facing = (0.5, math.sin(yaw), 0.35)
            # A red glint at the very tip, as on the sheet.
            figure.box(outer, "eyered", tip, (p["tile"] * 0.75,) * 3)
            name = outer
        # AN EYE IN EVERY TAIL: smaller when young, prominent when mature.
        figure.eye(name, eye_at, p["tail_eye"], facing, "eyerim", "eyered", "pupil")
    return figure


# ============================================================================ CHERUBIM

# THE IDENTITY, AT EVERY STAGE: a central all-seeing eye, ivory and gold, wings, rings, other eyes, celestial light.
CHERUBIM_STAGES = {
    "small": dict(
        voxel=3.10, body=(5.6, 4.6, 6.4), eye=3.4, wings=2, span=13.0, rows=2, spread=34.0, sweep=16.0,
        rings=1, ring_major=7.4, ring_minor=1.05, others=3, tile=1.75, glow=3.0, gold=0.35, halo=1.4,
    ),
    "medium": dict(
        voxel=3.95, body=(7.0, 5.6, 8.6), eye=3.9, wings=4, span=21.0, rows=3, spread=42.0, sweep=22.0,
        rings=2, ring_major=9.6, ring_minor=1.15, others=7, tile=1.85, glow=5.0, gold=0.5, halo=2.0,
    ),
    "large": dict(
        voxel=5.30, body=(8.6, 6.6, 10.4), eye=4.5, wings=4, span=31.0, rows=4, spread=48.0, sweep=26.0,
        rings=3, ring_major=11.6, ring_minor=1.25, others=12, tile=1.95, glow=7.6, gold=0.62, halo=2.8,
    ),
}


def cherubim(stage):
    p = CHERUBIM_STAGES[stage]
    figure = Figure("CHERUBIM PROJECT AVATAR -- %s" % stage.upper(), seed=2020 + len(stage), voxel_uu=p["voxel"])
    figure.material("ivory", "rim", IVORY, 1.0)
    figure.material("shade", "lit", IVORY_DEEP, 1.0)
    figure.material("gold", "rim", GOLD, 1.0)
    figure.material("golddeep", "lit", GOLD_DEEP, 1.0)
    figure.material("sclera", "lit", SCLERA, 1.0)
    figure.material("eyegold", "glow", EYE_GOLD, p["glow"])
    figure.material("pupil", "lit", (0.06, 0.05, 0.04), 1.0)
    figure.material("halo", "add", EYE_GOLD, p["halo"] * 0.05)

    bw, bd, bh = p["body"]
    centre_z = bh * 1.35
    gold_chance = p["gold"]

    def plume(x, y, z):
        # Ivory feathers with gold along their leading edges: the sheet's white-and-gold, in blocks.
        return "gold" if figure.rng.random() < gold_chance * 0.45 else ("ivory" if figure.rng.random() > 0.18 else "shade")

    def body_hide(x, y, z):
        if figure.rng.random() < gold_chance * 0.30:
            return "gold"
        return "ivory" if z > centre_z - bh * 0.2 else "shade"

    # ---- the floating body, with the great eye at its centre
    figure.part("root", "-", (0.0, 0.0, 0.0), "float")
    figure.shell("root", body_hide, (0.0, 0.0, centre_z), (bw * 0.5, bd * 0.5, bh * 0.5), n=2.5, tile=p["tile"], jitter=0.08)
    # A lower body that tapers into light, as on the sheet.
    figure.limb("root", body_hide, (0.0, 0.0, centre_z - bh * 0.42), (0.0, 0.0, centre_z - bh * 1.15), bw * 0.34, bw * 0.16, tile=p["tile"])

    figure.part("eye", "root", (bd * 0.30, 0.0, centre_z), "none")
    figure.eye("eye", (bd * 0.34, 0.0, centre_z), p["eye"] * 0.5, (1.0, 0.0, 0.0), "sclera", "eyegold", "pupil", ring="gold")
    figure.box("eye", "halo", (bd * 0.30, 0.0, centre_z), (p["eye"] * 1.5,) * 3)

    # ---- wings: two when young, four when grown, with more rows and span at every stage
    pairs = p["wings"] // 2
    for pair in range(pairs):
        for side in (1.0, -1.0):
            name = "wing_%d_%s" % (pair, "r" if side > 0 else "l")
            root = (-bw * 0.22, side * bd * 0.34, centre_z + (bh * 0.30 if pair == 0 else -bh * 0.22))
            figure.part(name, "root", root, "wing", side, None)
            figure.feather_wing(name, side, root, p["span"] * (1.0 if pair == 0 else 0.72), p["rows"],
                                p["spread"] * (1.0 if pair == 0 else -0.55), p["sweep"], tile=p["tile"], material_for=plume)

    # ---- the wheels: one when young, three when grown, each turning at its own rate
    for ring in range(p["rings"]):
        name = "ring_%d" % ring
        # Independent rates and tilts, so they never lock together -- the founder asked for them not to be frozen.
        rate = 9.0 - ring * 3.5 + (2.0 if ring == 1 else 0.0)
        figure.part(name, "root", (0.0, 0.0, centre_z), "orbit", rate * (1.0 if ring % 2 == 0 else -1.0), None)
        tilt = ((22.0 + ring * 34.0), (ring * 47.0))
        major = p["ring_major"] * (1.0 + 0.16 * ring)

        def ring_mat(a, b, ring=ring):
            # Gold bands with ivory between, and a gold node every quarter turn.
            if (int(a / (math.pi * 0.5)) + ring) % 2 == 0 and abs(math.cos(b)) > 0.55:
                return "gold"
            return "ivory" if figure.rng.random() > 0.2 else "golddeep"

        figure.torus(name, ring_mat, (0.0, 0.0, 0.0), major, p["ring_minor"], tilt, tile=p["tile"])

    # ---- the other eyes: on the rings and the body, blinking on their own
    for other in range(p["others"]):
        name = "eye_%d" % other
        a = 2.0 * math.pi * (other / max(p["others"], 1)) + 0.4
        on_ring = p["rings"] > 0 and other % 2 == 0
        radius = p["eye"] * (0.20 if on_ring else 0.16)
        if on_ring:
            host = "ring_%d" % (other % p["rings"])
            at = (math.cos(a) * p["ring_major"] * 1.0, math.sin(a) * p["ring_major"] * 1.0, 0.0)
            figure.part(name, host, at, "blink")
            figure.eye(name, at, radius, (math.cos(a), math.sin(a), 0.15), "sclera", "eyegold", "pupil", ring="gold")
        else:
            at = (bd * 0.18, math.cos(a) * bw * 0.42, centre_z + math.sin(a) * bh * 0.34)
            figure.part(name, "root", at, "blink")
            figure.eye(name, at, radius, (1.0, math.cos(a) * 0.4, math.sin(a) * 0.3), "sclera", "eyegold", "pupil", ring="gold")

    # ---- the light beneath, which is part of how the sheet reads
    figure.part("glory", "root", (0.0, 0.0, centre_z - bh * 1.25), "twinkle", 0.35, None)
    for i in range(10):
        a = 2.0 * math.pi * i / 10.0
        figure.box("glory", "halo", (math.cos(a) * bw * 0.8, math.sin(a) * bw * 0.8, centre_z - bh * 1.25), (p["tile"] * 1.6,) * 3)
    return figure


# ============================================================================ write them all

FORMS = [
    ("TenTails", "ten_tails", ten_tails),
    ("Cherubim", "cherubim", cherubim),
]
STAGES = ("small", "medium", "large")


def main():
    parser = argparse.ArgumentParser(description="Generate the Project Avatar figures.")
    parser.add_argument("--out", default=os.path.join("wonderland", "ProjectAvatars"))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for label, slug, build in FORMS:
        for stage in STAGES:
            figure = build(stage)
            figure.fit_to_metres(TARGET_METRES[stage])
            path = os.path.join(args.out, "%s_%s.wlvox" % (label, stage.capitalize()))
            boxes, parts, materials = figure.write(path)
            print("%-28s %5d boxes  %2d parts  %2d materials  voxel %.2f uu  height ~%.2f m" % (
                os.path.basename(path), boxes, parts, materials, figure.voxel_uu,
                _height_metres(figure)))


def _height_metres(figure):
    """The form's real height, so the three stages can be checked against the player before anyone looks at them."""
    lowest = min(c[2] - s[2] * 0.5 for _, _, c, s, _ in figure.boxes)
    highest = max(c[2] + s[2] * 0.5 for _, _, c, s, _ in figure.boxes)
    return (highest - lowest) * figure.voxel_uu / 100.0


if __name__ == "__main__":
    main()
