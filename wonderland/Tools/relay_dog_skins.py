"""Generate the Relay Dog SKIN figures: the same dog, dressed six ways.

WHAT A SKIN IS, AND IS NOT (founder, 2026-09-22). A skin changes how the Relay Dog LOOKS and nothing else. Julius's
authority, the Dog's behaviour, its capability and its status eyes are identical under every one of them: "The Bee skin
must still clearly be a Relay Dog. Do not replace Julius identity/authority based on skin."

So every figure here is built from ONE base dog -- the same head box, the same two upright ears, the same black visor
band, the same two glowing status eyes, the same torso, arms and legs -- and then dressed. The dress is what differs:
a flame mane, gold armour, bone plates, layered robes, a corona of light. If you cannot tell it is a Relay Dog at a
glance, the skin is wrong, and that is the acceptance test for every one of them.

THE STATUS EYES ARE NOT DECORATION. They are how the Dog says what it is doing, so every skin keeps them in the same
place at the same size, and only their colour changes. A skin may never hide or move them.

WHY VOXELS, AND WHY TEXT. The founder's reference sheets are voxel builds, which is Wonderland's own language. These are
engineering placeholders in the `wlvox 1` format (Source/Wonderland/WonderlandCompanionFigure.h): read at spawn, built
from engine cubes, no .uasset, nothing in Content, and retunable without a compile. When the founder approves a look,
the Blender lane makes the real mesh and these files are the spec.

Usage:  python wonderland/Tools/relay_dog_skins.py [--out DIR]
"""

import argparse
import math
import os
import random

GLOW_SCALE = 4000.0
# One height for every skin, so a switch in the Project Brain changes the dress and never the dog.
TARGET_METRES = 1.55


def spow(value, exponent):
    return math.copysign(abs(value) ** exponent, value)


class Figure:
    def __init__(self, name, seed):
        self.name = name
        self.voxel_uu = 1.0
        self.rng = random.Random(seed)
        self.materials = []
        self.material_names = set()
        self.parts = []
        self.part_names = set()
        self.boxes = []

    def material(self, name, kind, rgb, strength=1.0):
        if name in self.material_names:
            return
        self.materials.append((name, kind, rgb, strength))
        self.material_names.add(name)

    def part(self, name, parent, pivot, motion="none", a=None, b=None):
        assert parent == "-" or parent in self.part_names, (name, parent)
        self.parts.append((name, parent, pivot, motion, a, b))
        self.part_names.add(name)

    def box(self, part, material, centre, size, pitch=0.0, yaw=0.0, roll=0.0):
        assert part in self.part_names, part
        assert material in self.material_names, material
        self.boxes.append((part, material, centre, size, (pitch, yaw, roll)))

    # ------------------------------------------------------------- primitives
    def slab(self, part, material, centre, size, jitter=0.0, tile=None):
        """A filled block, optionally broken into voxel tiles so it reads as built rather than extruded."""
        if tile is None:
            self.box(part, material, centre, size)
            return
        cx, cy, cz = centre
        sx, sy, sz = size
        nx = max(1, int(round(sx / tile)))
        ny = max(1, int(round(sy / tile)))
        nz = max(1, int(round(sz / tile)))
        for ix in range(nx):
            for iy in range(ny):
                for iz in range(nz):
                    # Only the shell: the inside of a solid is never seen and costs boxes.
                    if 0 < ix < nx - 1 and 0 < iy < ny - 1 and 0 < iz < nz - 1:
                        continue
                    px = cx - sx * 0.5 + sx * (ix + 0.5) / nx
                    py = cy - sy * 0.5 + sy * (iy + 0.5) / ny
                    pz = cz - sz * 0.5 + sz * (iz + 0.5) / nz
                    wobble = 1.0 + (self.rng.uniform(-jitter, jitter) if jitter > 0.0 else 0.0)
                    self.box(part, material, (px, py, pz), (sx / nx * wobble, sy / ny * wobble, sz / nz * wobble))

    def drape(self, part, material_for, top, width, length, rows, tile, ragged=0.35):
        """A hanging fall of cloth or mane.

        STRANDS, NOT THREADS. The first version made each fall one voxel wide and every robe in the set came out a
        grass skirt: a row of identical bristles with gaps of background between them. Cloth reads as cloth when the
        falls are WIDER than the gaps and when neighbours differ in length, so a strand is now several voxels across
        and its drop varies, and the sheets' heavy layered silhouette survives.
        """
        strands = max(3, int(round(width / (tile * 2.2))))
        for k in range(strands):
            t = (k + 0.5) / strands
            y = top[1] - width * 0.5 + width * t
            wide = width / strands * 1.06
            drop = length * (0.62 + 0.38 * math.sin(math.pi * t)) * (1.0 - self.rng.uniform(0.0, ragged))
            steps = max(2, int(round(drop / tile)))
            for s in range(steps):
                z = top[2] - tile * (s + 0.5)
                x = top[0] + math.sin(s * 0.42 + k) * tile * 0.22
                taper = 1.0 - 0.30 * (s / max(steps - 1, 1))
                self.box(part, material_for(s / steps), (x, y, z), (tile * 1.15, wide * taper, tile * 1.02))

    def flame(self, part, material_for, base, height, width, tongues, tile):
        """A tuft of fire: tapering tongues that read as flame in blocks, brightest at the tip."""
        for tongue in range(tongues):
            t = (tongue + 0.5) / tongues
            lean = (t - 0.5) * width
            steps = max(2, int(round(height * (0.55 + 0.45 * math.sin(math.pi * t)) / tile)))
            for s in range(steps):
                up = (s + 0.5) / max(steps, 1)
                z = base[2] + tile * s
                x = base[0] + math.sin(up * 3.1 + tongue) * tile * 0.35
                y = base[1] + lean + math.cos(up * 2.4 + tongue) * tile * 0.25
                size = tile * (1.0 - 0.45 * up)
                self.box(part, material_for(up), (x, y, z), (size, size, tile))

    def ring(self, part, material_for, centre, radius, thickness, tile, plane="yz"):
        """A halo or a wheel, in blocks."""
        around = max(12, int(round(2.0 * math.pi * radius / (tile * 0.95))))
        for i in range(around):
            a = 2.0 * math.pi * i / around
            if plane == "yz":
                point = (centre[0], centre[1] + math.cos(a) * radius, centre[2] + math.sin(a) * radius)
            else:
                point = (centre[0] + math.cos(a) * radius, centre[1] + math.sin(a) * radius, centre[2])
            self.box(part, material_for(a), point, (thickness, tile, tile))

    def cloak(self, part, material_for, top, width, length, tile, flare=2.1, back=0.0, ragged=0.22):
        """A CLOAK OF STEPPED STRANDS THAT FLARES AS IT FALLS -- the single most recognisable thing on both sheets.

        On the reference the cloak is not a curtain hanging straight down: it spreads outward toward the floor, each
        strand is a staircase of blocks rather than a smooth fall, the strands differ in length, and the ones at the
        outside are a different colour from the ones at the centre. All four of those are what makes it read as cloth
        with weight, and a version missing any of them reads as a grass skirt, which is what the first pass produced.

        `material_for(down, across)` is given how far down the strand is and how far across the cloak, so a skin can
        put cream at the middle and black at the edges exactly as ARDEN does.
        """
        strands = max(7, int(round(width / (tile * 0.95))))
        for k in range(strands):
            across = (k + 0.5) / strands
            rest = (across - 0.5) * width
            drop = length * (0.86 + 0.14 * math.sin(math.pi * across)) * (1.0 - self.rng.uniform(0.0, ragged))
            steps = max(3, int(round(drop / tile)))
            for s in range(steps):
                down = s / max(steps - 1, 1)
                spread = 1.0 + (flare - 1.0) * down ** 1.25
                y = rest * spread
                z = top[2] - tile * (s + 0.5)
                x = top[0] + back * down + math.sin(down * 2.3 + k * 1.7) * tile * 0.30
                wide = width / strands * spread * 0.98
                self.box(part, material_for(down, across), (x, y, z), (tile * 1.12, wide, tile * 1.04))

    def claw_hand(self, part, materials, wrist, reach, tile, side):
        """The demonic arm's hand: four long tapering fingers and a thumb, spread wide, as the DEMONIC ARM inset shows."""
        dark, hot = materials
        for finger in range(4):
            t = (finger - 1.5) / 3.0
            length = reach * (0.80 + 0.30 * math.cos(t * 1.7))
            steps = max(4, int(length / tile))
            for s in range(steps):
                f = (s + 0.5) / steps
                # Down and slightly forward, fanned across the body's width -- a hanging claw, not an outstretched palm.
                self.box(part, dark if f < 0.80 else hot,
                         (wrist[0] + f * length * 0.10,
                          wrist[1] + side * (0.6 + f * 1.1) + t * tile * 2.1 * (1.0 + f * 0.5),
                          wrist[2] - f * length),
                         (tile * (1.05 - 0.45 * f),) * 3)
        for s in range(3):
            f = (s + 0.5) / 3
            self.box(part, dark, (wrist[0], wrist[1] + side * 0.3, wrist[2] + 0.8 - f * 1.4), (tile * 1.5, tile * 1.4, tile * 1.0))

    def spoked_wheel(self, part, material, centre, radius, spokes, tile, plane="yz"):
        """The sacred wheel: a rim and its spokes. It is on ARDEN's chest, at its sigil, and at its cloak."""
        self.ring(part, lambda a: material, centre, radius, tile * 0.55, tile * 0.80, plane=plane)
        for i in range(spokes):
            a = 2.0 * math.pi * i / spokes
            steps = max(2, int(radius / tile))
            for s in range(steps):
                r = radius * (s + 0.5) / steps
                if plane == "yz":
                    p = (centre[0], centre[1] + math.cos(a) * r, centre[2] + math.sin(a) * r)
                else:
                    p = (centre[0] + math.cos(a) * r, centre[1] + math.sin(a) * r, centre[2])
                self.box(part, material, p, (tile * 0.5, tile * 0.55, tile * 0.55))

    # ------------------------------------------------------------------ write
    def mark_dog_extent(self):
        """Remember how tall the DOG is, before anything is added on top of it."""
        self.dog_extent = (
            min(c[2] - s[2] * 0.5 for _, _, c, s, _ in self.boxes),
            max(c[2] + s[2] * 0.5 for _, _, c, s, _ in self.boxes),
        )

    def fit_to_metres(self, metres):
        """Scale so THE DOG is `metres` tall -- never the crown, the halo or the flames it happens to be wearing.

        Measuring the whole figure would shrink the dog inside a skin with a tall headpiece, so Apollo would stand
        shorter than Bee and the founder's rule -- the dog is identical under every skin -- would be broken by the
        arithmetic rather than by the art. A halo sticking out above the target height is correct: it is a halo.
        """
        lowest, highest = getattr(self, "dog_extent", None) or (
            min(c[2] - s[2] * 0.5 for _, _, c, s, _ in self.boxes),
            max(c[2] + s[2] * 0.5 for _, _, c, s, _ in self.boxes),
        )
        self.voxel_uu = metres * 100.0 / max(highest - lowest, 0.001)
        return self.voxel_uu

    def write(self, path):
        lines = [
            "# %s -- generated by wonderland/Tools/relay_dog_skins.py. Do not hand-edit; change the generator." % self.name,
            "# A RELAY DOG SKIN. The dog underneath is identical in every one: same head, same visor, same status eyes.",
            "wlvox 1",
            "voxel %.4f" % self.voxel_uu,
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


# ============================================================================ the dog underneath

BONE = (0.898, 0.871, 0.800)
BONE_DEEP = (0.690, 0.660, 0.592)
VISOR = (0.045, 0.042, 0.050)

# The one measurement sheet every skin is built on. Nothing below changes it.
# THE ONE MEASUREMENT SHEET EVERY SKIN IS BUILT ON, taken off the founder's ARDEN INFERNAL and APOLLO plates.
# Nothing below this line changes it, and the proportions are the point: an enormous head, small tapered ears, a
# visor cut across three quarters of the face, a short body and two stubby legs. Get these wrong and no amount of
# dress makes it a Relay Dog.
DOG = dict(
    tile=1.0,
    head=(8.2, 9.2, 8.0),      # depth, width, height -- about 35% of the figure, and wider than the body
    head_z=16.6,
    ear=(2.2, 1.7, 3.4),       # a small tapered spur at each top corner, NOT a tall rabbit ear
    visor=(6.9, 3.0),          # width, height -- inset into the face
    eye=(1.7, 1.9),            # width, height of each glowing pane
    eye_gap=1.75,
    torso=(4.6, 5.8, 6.2),
    torso_z=9.1,
    arm=(1.9, 1.9, 4.2),
    leg=(2.5, 2.7, 6.0),
    leg_gap=1.6,
)


def base_dog(figure, coat="bone", coat_deep="bonedeep", eye="eye", tile=None):
    """THE RELAY DOG ITSELF. Every skin calls this first and dresses what it returns.

    Built to the reference plates: a big cubic head with two small tapered ear spurs, a dark visor band inset across
    the face with two glowing panes in it, a short torso and two stubby legs. The dress goes on top; this never moves.
    """
    d = DOG
    tile = tile or d["tile"]
    hd, hw, hh = d["head"]
    figure.part("root", "-", (0.0, 0.0, 0.0), "spine", 0.85, 0.0)
    figure.part("body", "root", (0.0, 0.0, d["torso_z"]), "none")
    figure.part("head", "body", (0.0, 0.0, d["head_z"]), "head")

    figure.slab("head", coat, (0.0, 0.0, d["head_z"]), (hd, hw, hh), tile=tile)

    # THE EARS: a wider base and a narrower tip, leaning very slightly outward, set at the head's top corners.
    ed, ew, eh = d["ear"]
    for side in (-1.0, 1.0):
        y = side * (hw * 0.5 - ew * 0.9)
        figure.slab("head", coat, (0.0, y, d["head_z"] + hh * 0.5 + eh * 0.28), (ed, ew, eh * 0.62), tile=tile)
        figure.slab("head", coat, (0.0, y + side * ew * 0.16, d["head_z"] + hh * 0.5 + eh * 0.78),
                    (ed * 0.72, ew * 0.72, eh * 0.50), tile=tile)

    # THE VISOR, CUT INTO THE FACE. On the sheets it sits in the head rather than on it, so it is recessed a little and
    # the coat is carried round it -- a black plate glued to the front reads as a sticker.
    vw, vh = d["visor"]
    visor_z = d["head_z"] + hh * 0.06
    figure.slab("head", "visor", (hd * 0.5 - 0.35, 0.0, visor_z), (1.5, vw, vh), tile=tile * 0.62)

    # THE STATUS EYES. The brightest thing on the dog, and the one part of the face a skin may recolour.
    exw, exh = d["eye"]
    for side in (-1.0, 1.0):
        figure.box("head", eye, (hd * 0.5 + 0.30, side * d["eye_gap"], visor_z), (0.5, exw, exh))

    # The body and the two legs. Short, plain, and under the dress in every skin but the bare one.
    td, tw, th = d["torso"]
    figure.slab("body", coat, (0.0, 0.0, d["torso_z"]), (td, tw, th), tile=tile)
    for side, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        ad, aw, ah = d["arm"]
        pivot = (0.0, side * (tw * 0.5 + aw * 0.36), d["torso_z"] + th * 0.30)
        figure.part(name, "body", pivot, "wing", side)
        figure.slab(name, coat, (pivot[0], pivot[1], pivot[2] - ah * 0.44), (ad, aw, ah), tile=tile)
    ld, lw, lh = d["leg"]
    for side, name, phase in ((-1.0, "leg_l", 0.0), (1.0, "leg_r", 0.5)):
        hip_z = d["torso_z"] - th * 0.5
        # The two legs are half a cycle apart, which for two legs is simply walking.
        figure.part(name, "body", (0.0, side * d["leg_gap"], hip_z), "stride", phase, 0.8)
        figure.slab(name, coat, (0.0, side * d["leg_gap"], hip_z - lh * 0.26), (ld, lw, lh * 0.55), tile=tile)
        # Everything below the knee is its own joint. Short legs still need one: a chibi mascot whose leg is a single
        # rigid post reads as a peg, however well the hip swings.
        shin = "%s_shin" % name
        figure.part(shin, name, (0.0, side * d["leg_gap"], hip_z - lh * 0.50), "knee", phase, 0.7)
        figure.slab(shin, coat, (0.0, side * d["leg_gap"], hip_z - lh * 0.74), (ld * 0.94, lw * 0.94, lh * 0.52), tile=tile)
        figure.slab(shin, coat_deep, (ld * 0.16, side * d["leg_gap"], hip_z - lh + tile * 0.55),
                    (ld * 1.18, lw * 1.04, tile * 1.2), tile=tile)
    figure.mark_dog_extent()
    return figure


def quadruped_dog(figure, coat="bone", coat_deep="bonedeep", eye="eye", tile=None):
    """THE RELAY OG FORM: the small four-legged dog in the corner of every sheet.

    Both premium plates show the origin form as a QUADRUPED, not as the standing mascot without its dress, so this is
    a different body with the same head: the visor, the two ear spurs and the gold eyes carry over exactly, and
    everything below the neck is a four-legged animal with a short upright tail.
    """
    d = DOG
    tile = tile or d["tile"]
    hd, hw, hh = (d["head"][0] * 0.80, d["head"][1] * 0.80, d["head"][2] * 0.80)
    body_z = 7.4
    head_z = body_z + 3.4

    figure.part("root", "-", (0.0, 0.0, 0.0), "spine", 1.0, 0.0)
    figure.part("body", "root", (0.0, 0.0, body_z), "none")
    figure.part("head", "body", (5.2, 0.0, head_z), "head")

    # A long low back, a chest a little deeper than the hips.
    figure.slab("body", coat, (0.0, 0.0, body_z), (11.5, 5.6, 5.0), tile=tile)
    figure.slab("body", coat, (4.1, 0.0, body_z + 0.5), (3.6, 5.9, 5.4), tile=tile)

    # The same head, at the front of it.
    figure.slab("head", coat, (5.2, 0.0, head_z), (hd, hw, hh), tile=tile)
    ed, ew, eh = d["ear"]
    for side in (-1.0, 1.0):
        y = side * (hw * 0.5 - ew * 0.85)
        figure.slab("head", coat, (5.2, y, head_z + hh * 0.5 + eh * 0.26), (ed * 0.85, ew * 0.85, eh * 0.55), tile=tile)
        figure.slab("head", coat, (5.2, y + side * ew * 0.14, head_z + hh * 0.5 + eh * 0.70),
                    (ed * 0.62, ew * 0.62, eh * 0.44), tile=tile)
    visor_z = head_z + hh * 0.05
    figure.slab("head", "visor", (5.2 + hd * 0.5 - 0.3, 0.0, visor_z), (1.3, hw * 0.74, hh * 0.36), tile=tile * 0.6)
    for side in (-1.0, 1.0):
        figure.box("head", eye, (5.2 + hd * 0.5 + 0.28, side * 1.5, visor_z), (0.45, 1.5, 1.6))

    # Four legs, and a short tail carried up.
    for fx, name in ((3.9, "leg_fl"), (3.9, "leg_fr"), (-3.9, "leg_bl"), (-3.9, "leg_br")):
        side = -1.0 if name.endswith("l") else 1.0
        front = fx > 0.0
        # Diagonal pairs: front-left with rear-right, half a cycle from front-right with rear-left.
        phase = 0.0 if front == (side < 0.0) else 0.5
        hip_z = body_z - 2.5
        figure.part(name, "body", (fx, side * 1.7, hip_z), "stride", phase, 1.0)
        figure.slab(name, coat, (fx, side * 1.7, hip_z - 1.3), (2.3, 2.3, 2.6), tile=tile)
        shin = "%s_shin" % name
        figure.part(shin, name, (fx, side * 1.7, hip_z - 2.5), "knee", phase, 1.0)
        figure.slab(shin, coat, (fx, side * 1.7, hip_z - 3.6), (2.1, 2.1, 2.4), tile=tile)
        figure.slab(shin, coat_deep, (fx + 0.2, side * 1.7, hip_z - 4.6), (2.6, 2.5, tile * 1.1), tile=tile)
    figure.part("tail", "body", (-5.6, 0.0, body_z + 1.6), "trail", 6.0, 8.0)
    for s in range(5):
        t = s / 4.0
        figure.box("tail", coat, (-5.6 - t * 1.2, 0.0, body_z + 1.6 + t * 3.6), (2.0 - t * 0.5, 2.0 - t * 0.5, 1.6))

    figure.mark_dog_extent()
    return figure


def start(name, seed, eye_rgb, eye_strength=6.0, coat=BONE, coat_deep=BONE_DEEP):
    figure = Figure(name, seed)
    figure.material("bone", "rim", coat, 1.0)
    figure.material("bonedeep", "lit", coat_deep, 1.0)
    figure.material("visor", "lit", VISOR, 1.0)
    figure.material("eye", "glow", eye_rgb, eye_strength)
    return figure


# ============================================================================ the skins

def relay_og():
    """RELAY OG FORM. The origin: a small white four-legged dog with the visor and the warm gold eyes.

    Both premium sheets show this in the corner as a quadruped, captioned RELAY OG FORM -- "even in origin, the flame
    cannot be erased" on ARDEN, "the light that started it all" on APOLLO. It is a different body from the standing
    mascot, not the mascot stripped, and that is why it gets its own builder.
    """
    figure = start("RELAY DOG -- OG FORM", 7001, (1.00, 0.72, 0.16), 7.0)
    quadruped_dog(figure)
    return figure


def arden_infernal():
    """ARDEN INFERNAL — SCION OF FLAME. BOUND BY DESTINY.

    Built feature by feature off the sheet's own list: INFERNAL ENERGY, SACRED ORNAMENTS ("the chains and charms of a
    chosen one"), DEMONIC ARM ("a darkened arm of ruin, sealed by a fiery sigil"), FLAME MANIPULATION, INFERNAL TAIL
    ("a tail of flame and fury, whipping through ash").
    """
    figure = start("RELAY DOG SKIN -- ARDEN INFERNAL", 7002, (1.00, 0.58, 0.10), 7.5)
    figure.material("gold", "rim", (0.905, 0.720, 0.290), 1.0)
    figure.material("ember", "glow", (1.00, 0.34, 0.05), 5.5)
    figure.material("crimson", "lit", (0.520, 0.075, 0.065), 1.0)
    figure.material("char", "lit", (0.215, 0.115, 0.105), 1.0)
    figure.material("ruby", "glow", (1.00, 0.09, 0.12), 6.0)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    tw, th = d["torso"][1], d["torso"][2]
    shoulder = d["torso_z"] + th * 0.48

    # ---- THE CLOAK. Cream down the middle, crimson and char at the edges, flaring wide past the feet. The sheet's
    # ---- single biggest shape, and the one the first pass got most wrong.
    figure.part("cloak", "body", (0.0, 0.0, shoulder), "none")
    # THE OUTER CAPE: black and crimson, the widest shape in the silhouette, sweeping well past the feet.
    figure.cloak("cloak", lambda down, across: "char" if abs(across - 0.5) > 0.42 or down > 0.88 else "crimson",
                 (-d["torso"][0] * 0.28, 0.0, shoulder + 0.8), tw * 1.85, 15.0, tile * 1.18, flare=2.7, back=-1.8)
    # THE INNER FALL: cream, in front of the legs, a little shorter -- the sheet's pale panels between the red.
    figure.cloak("cloak", lambda down, across: "bone" if down < 0.86 else "bonedeep",
                 (d["torso"][0] * 0.62, 0.0, shoulder - 0.4), tw * 1.15, 11.5, tile * 1.08, flare=1.85)
    # And crimson showing between the pale panels, at the sides, where the two layers part.
    for side in (-1.0, 1.0):
        figure.cloak("cloak", lambda down, across: "crimson" if down < 0.7 else "char",
                     (d["torso"][0] * 0.05, side * tw * 0.62, shoulder - 0.8), tw * 0.42, 12.5, tile * 1.05, flare=2.2)
    # Flame licking off the cloak's hem, the sheet's FLAME MANIPULATION inset.
    figure.part("hemfire", "cloak", (0.0, 0.0, 1.0), "twinkle", 0.55)
    for side in (-1.0, 1.0):
        figure.flame("hemfire", lambda up: "ember" if up > 0.45 else "crimson",
                     (-1.0, side * 6.2, 0.6), 5.0, 2.6, 3, tile * 1.15)

    # ---- SACRED ORNAMENTS: two heavy gold chains that sag across the chest, a spoked wheel medallion between them,
    # ---- and diamond ruby charms hanging off both.
    for i, z in enumerate((shoulder - 1.4, shoulder - 3.4)):
        span = tw * (0.94 - i * 0.14)
        links = max(5, int(span / (tile * 1.4)))
        for k in range(links + 1):
            y = -span * 0.5 + span * k / links
            sag = (1.0 - (2.0 * k / links - 1.0) ** 2) * (1.7 + i * 0.6)
            figure.box("body", "gold", (d["torso"][0] * 0.55, y, z - sag), (tile * 0.6, tile * 1.3, tile * 0.95))
    figure.spoked_wheel("body", "gold", (d["torso"][0] * 0.60, 0.0, shoulder - 5.6), 1.9, 8, tile)
    for side in (-1.0, 1.0):
        for s in range(3):
            figure.box("body", "gold", (d["torso"][0] * 0.58, side * 2.6, shoulder - 4.0 - s * 0.85), (tile * 0.5,) * 3)
        figure.box("body", "ruby", (d["torso"][0] * 0.60, side * 2.6, shoulder - 6.6), (tile * 0.7, tile * 1.25, tile * 1.7))
    figure.box("body", "ruby", (d["torso"][0] * 0.62, 0.0, shoulder - 2.6), (tile * 0.7, tile * 1.1, tile * 1.5))

    # ---- THE HALO: a large ornate gold ring standing behind the head, four red diamonds at the cardinal points, and
    # ---- flame licking off the whole circumference. On the sheet it is nearly twice the head's width.
    halo_c = (-2.6, 0.0, d["head_z"] + 3.0)
    figure.part("halo", "head", halo_c, "orbit", 6.0)
    figure.ring("halo", lambda a: "gold", halo_c, 9.6, tile * 0.95, tile * 1.05)
    figure.ring("halo", lambda a: "gold", halo_c, 8.5, tile * 0.55, tile * 1.05)
    for i in range(4):
        a = math.pi * 0.5 * i + math.pi * 0.5
        gem = (halo_c[0] + 0.3, halo_c[1] + math.cos(a) * 9.6, halo_c[2] + math.sin(a) * 9.6)
        for dy, dz, size in ((0.0, 0.0, 1.5), (0.0, 1.3, 0.9), (0.0, -1.3, 0.9), (1.3, 0.0, 0.9), (-1.3, 0.0, 0.9)):
            figure.box("halo", "ruby", (gem[0], gem[1] + dy, gem[2] + dz), (tile * 0.8, tile * size, tile * size))
    figure.part("halofire", "halo", halo_c, "twinkle", 0.18)
    for i in range(20):
        a = 2.0 * math.pi * i / 20
        r = 10.9 + (i % 3) * 0.8
        figure.box("halofire", "ember", (halo_c[0] - 0.2, halo_c[1] + math.cos(a) * r, halo_c[2] + math.sin(a) * r),
                   (tile * 0.75,) * 3)

    # ---- THE DEMONIC ARM, on the dog's right: char to the shoulder, a wide clawed hand, and a red wheel sigil
    # ---- burning in front of it.
    arm_y = -(tw * 0.5 + d["arm"][1] * 0.36)
    figure.slab("arm_l", "char", (0.0, arm_y, d["torso_z"] + 1.0), (d["arm"][0] * 1.25, d["arm"][1] * 1.25, 4.6), tile=tile)
    figure.claw_hand("arm_l", ("char", "ember"), (0.4, arm_y - 0.6, d["torso_z"] - 1.6), 5.6, tile, -1.0)
    sigil_c = (2.2, arm_y - 3.4, d["torso_z"] - 3.2)
    figure.part("sigil", "arm_l", sigil_c, "orbit", -30.0)
    figure.spoked_wheel("sigil", "ruby", sigil_c, 2.8, 8, tile)
    figure.ring("sigil", lambda a: "ember", sigil_c, 3.7, tile * 0.5, tile * 0.85)

    # ---- THE INFERNAL TAIL: a long ash-black coil curling up behind on the dog's left, burning at the tip.
    figure.part("tail", "body", (-d["torso"][0] * 0.5, tw * 0.42, d["torso_z"] + 0.5), "tail", 7.0, 10.0)
    for s in range(18):
        t = s / 17.0
        a = t * 4.6
        figure.box("tail", "char" if t < 0.45 else ("crimson" if t < 0.74 else "ember"),
                   (-d["torso"][0] * 0.5 - math.sin(a) * 3.8 - t * 1.6,
                    tw * 0.42 + 2.4 + math.cos(a) * 3.4,
                    d["torso_z"] + 0.5 + t * 7.5),
                   (tile * (1.25 - 0.55 * t),) * 3)
    return figure


def apollo():
    """APOLLO — GOD OF THE SUN. LIGHT. HARMONY. PERFECTION.

    Off the sheet's own list: SOLAR FLAME ("radiant fire blessed by the sun"), CELESTIAL HARMONY, DIVINE ARMOR
    ("forged from golden light itself"), PURE LIGHT, and the DIVINE DRAPERY inset.
    """
    figure = start("RELAY DOG SKIN -- APOLLO", 7003, (1.00, 0.86, 0.26), 7.5)
    figure.material("gold", "rim", (0.915, 0.735, 0.300), 1.0)
    figure.material("golddeep", "lit", (0.520, 0.375, 0.115), 1.0)
    figure.material("linen", "rim", (0.968, 0.958, 0.930), 1.0)
    figure.material("solar", "glow", (1.00, 0.46, 0.06), 6.0)
    figure.material("solarpale", "glow", (1.00, 0.84, 0.36), 6.0)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    tw, th = d["torso"][1], d["torso"][2]
    shoulder = d["torso_z"] + th * 0.48

    # ---- THE HALO: LARGE, THICK, AND PLAIN. On the sheet it is a clean gold band with no ornament at all, and it is
    # ---- the widest thing in the silhouette. Ornamenting it would be Arden's halo, not this one.
    halo_c = (-3.0, 0.0, d["head_z"] + 6.4)
    figure.part("halo", "head", halo_c, "orbit", 4.0)
    for r in (10.4, 9.5):
        figure.ring("halo", lambda a: "gold", halo_c, r, tile * 1.15, tile * 1.05)

    # ---- THE SOLAR FLAME: burning straight up out of the head and taller than the head itself.
    figure.part("crown", "head", (0.0, 0.0, d["head_z"] + d["head"][2] * 0.5), "twinkle", 0.1)
    figure.flame("crown", lambda up: "solar" if up < 0.45 else "solarpale",
                 (0.4, 0.0, d["head_z"] + d["head"][2] * 0.5), 11.5, 6.6, 7, tile * 1.25)

    # ---- DIVINE DRAPERY: white cloth from the waist to the floor, wide and flowing, with a shorter front fall.
    figure.part("robe", "body", (0.0, 0.0, shoulder - 2.0), "none")
    figure.cloak("robe", lambda down, across: "linen" if down < 0.92 else "golddeep",
                 (-d["torso"][0] * 0.12, 0.0, shoulder - 1.4), tw * 1.60, 13.5, tile * 1.12, flare=2.5, back=-1.0)
    figure.cloak("robe", lambda down, across: "linen",
                 (d["torso"][0] * 0.46, 0.0, shoulder - 3.4), tw * 0.78, 8.0, tile * 1.0, flare=1.5)

    # ---- CELESTIAL ARMOR: gold winged scrolls curling up off both shoulders, a breastplate with a round sun boss,
    # ---- a belt, and gold panels over the thighs.
    for side in (-1.0, 1.0):
        figure.slab("body", "gold", (0.0, side * (tw * 0.5 + 1.3), shoulder - 0.4), (4.0, 3.0, 1.9), tile=tile)
        for w in range(6):
            f = w / 5.0
            # A quarter turn upward and outward: out fast at first, then up, so the tip finishes above the shoulder.
            out = math.sin(f * 1.30) * 6.8
            up = (1.0 - math.cos(f * 1.30)) * 9.0
            figure.box("body", "gold",
                       (1.6 - f * 0.9, side * (tw * 0.5 + 1.6 + out), shoulder + 0.4 + up),
                       (tile * 1.5, tile * (2.3 - 0.7 * f), tile * (2.3 - 0.7 * f)))
            figure.box("body", "golddeep",
                       (1.2 - f * 0.9, side * (tw * 0.5 + 3.1 + out), shoulder - 0.7 + up),
                       (tile * 1.1, tile * 1.3, tile * 1.3))
    figure.slab("body", "gold", (d["torso"][0] * 0.52, 0.0, shoulder - 2.2), (1.2, 4.0, 3.8), tile=tile)
    for i in range(10):
        a = 2.0 * math.pi * i / 10
        figure.box("body", "gold", (d["torso"][0] * 0.60, math.cos(a) * 2.5, shoulder - 2.2 + math.sin(a) * 2.5), (tile * 0.6,) * 3)
    figure.box("body", "solarpale", (d["torso"][0] * 0.64, 0.0, shoulder - 2.2), (tile * 0.8, tile * 1.6, tile * 1.6))
    figure.slab("body", "golddeep", (0.0, 0.0, d["torso_z"] - th * 0.46), (d["torso"][0] * 1.14, tw * 1.14, 1.4), tile=tile)
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        figure.slab(name, "gold", (d["leg"][0] * 0.4, side * d["leg_gap"], d["torso_z"] - th * 0.5 - 1.8),
                    (1.0, d["leg"][1] * 1.15, 3.2), tile=tile)

    # ---- PURE LIGHT: the two gold lamp posts at the hem, each carrying a white orb.
    for side in (-1.0, 1.0):
        base_y = side * 6.4
        for s in range(5):
            figure.box("robe", "gold", (d["torso"][0] * 0.30, base_y, 1.2 + s * 1.05), (tile * 0.7, tile * 0.7, tile * 1.05))
        top = (d["torso"][0] * 0.30, base_y, 7.2)
        for dy in (-1.0, 0.0, 1.0):
            for dz in (-1.0, 0.0, 1.0):
                if abs(dy) + abs(dz) > 1.5:
                    continue
                figure.box("robe", "solarpale", (top[0], top[1] + dy, top[2] + dz), (tile * 1.05,) * 3)
        figure.box("robe", "gold", (top[0], base_y, 5.9), (tile * 1.1, tile * 1.5, tile * 0.6))
    return figure


def skeleton_flame():
    """Bone plate over bone, with blue ghostfire at the ears, shoulders and feet."""
    # A COLDER, PALER COAT AND A MUCH DARKER RECESS than the other skins, because ribs cut into bone only read
    # when the gap between them is dark. At the shared bone colour this skin rendered as a plain dog with two wisps.
    figure = start("RELAY DOG SKIN -- SKELETON FLAME", 7004, (0.45, 0.92, 1.00), 7.5,
                   coat=(0.905, 0.915, 0.900), coat_deep=(0.235, 0.255, 0.270))
    figure.material("ghost", "glow", (0.28, 0.72, 1.00), 6.0)
    figure.material("ghostpale", "glow", (0.72, 0.94, 1.00), 4.5)
    figure.material("gold", "rim", (0.870, 0.700, 0.300), 1.0)
    base_dog(figure)
    d = DOG
    tile = d["tile"]

    # THE RIBCAGE: pale ribs standing PROUD of a dark recess, wrapping round the sides of the body. Flat plates
    # the colour of the coat were invisible; a rib is a light bar with a shadow under it.
    figure.slab("body", "bonedeep", (0.0, 0.0, d["torso_z"] - 0.2), (d["torso"][0] * 1.06, d["torso"][1] * 1.06, 6.0), tile=tile)
    for r in range(4):
        z = d["torso_z"] + 2.0 - r * 1.6
        span = d["torso"][1] * (0.98 - r * 0.05)
        figure.slab("body", "bone", (d["torso"][0] * 0.56, 0.0, z), (0.9, span, 0.85), tile=tile * 0.9)
        for side in (-1.0, 1.0):
            figure.box("body", "bone", (d["torso"][0] * 0.18, side * span * 0.54, z - 0.3), (2.2, tile * 0.9, tile * 0.85))
    # A spine down the front, and a gold clasp where the ribs meet.
    figure.slab("body", "bone", (d["torso"][0] * 0.56, 0.0, d["torso_z"] - 3.4), (0.9, tile * 1.1, 2.4), tile=tile * 0.9)
    figure.box("body", "gold", (d["torso"][0] * 0.66, 0.0, d["torso_z"] + 0.4), (tile * 0.7, tile * 1.7, tile * 1.7))
    # Dark sockets around the eyes: the skull under the visor.
    for side in (-1.0, 1.0):
        figure.box("head", "bonedeep", (d["head"][0] * 0.5 + 0.2, side * d["eye_gap"], d["head_z"] + d["head"][2] * 0.08), (0.5, 2.5, 2.4))

    # GHOSTFIRE: off both ears, both shoulders and both feet. Blue, and the reason this skin reads at distance.
    figure.part("fire_head", "head", (0.0, 0.0, d["head_z"] + d["head"][2] * 0.5), "twinkle", 0.35)
    for side in (-1.0, 1.0):
        figure.flame("fire_head", lambda up: "ghost" if up < 0.6 else "ghostpale",
                     (0.0, side * (d["head"][1] * 0.5 - 1.2), d["head_z"] + d["head"][2] * 0.5 + 3.2), 8.5, 4.2, 5, tile * 1.35)
    figure.part("fire_body", "body", (0.0, 0.0, d["torso_z"]), "twinkle", 0.7)
    for side in (-1.0, 1.0):
        figure.flame("fire_body", lambda up: "ghost" if up < 0.55 else "ghostpale",
                     (-1.4, side * (d["torso"][1] * 0.5 + 1.6), d["torso_z"] + d["torso"][2] * 0.30), 7.5, 4.0, 4, tile * 1.25)
    for name, side in (("leg_l", -1.0), ("leg_r", 1.0)):
        figure.flame(name, lambda up: "ghostpale" if up > 0.5 else "ghost",
                     (0.0, side * d["leg_gap"], d["torso_z"] - d["torso"][2] * 0.5 - d["leg"][2] + 0.4), 4.5, 3.0, 4, tile * 1.1)
    return figure


def hagoromo():
    """White and lavender robes with gold trim, a celestial mane, and sacred orbs on gold arms."""
    figure = start("RELAY DOG SKIN -- HAGOROMO", 7005, (0.78, 0.45, 1.00), 7.0)
    figure.material("robe", "rim", (0.925, 0.910, 0.960), 1.0)
    figure.material("lilac", "rim", (0.780, 0.735, 0.900), 1.0)
    figure.material("gold", "rim", (0.880, 0.710, 0.300), 1.0)
    figure.material("amethyst", "glow", (0.66, 0.28, 0.95), 5.5)
    figure.material("orb", "glow", (0.80, 0.45, 1.00), 6.0)
    base_dog(figure)
    d = DOG
    tile = d["tile"]

    # THE CELESTIAL MANE: long layered falls, white at the top and lilac below.
    figure.part("mane", "head", (0.0, 0.0, d["head_z"] - d["head"][2] * 0.2), "none")
    figure.drape("mane", lambda t: "robe" if t < 0.45 else "lilac",
                 (-d["head"][0] * 0.42, 0.0, d["head_z"] - d["head"][2] * 0.2), d["head"][1] * 1.25, 15.0, 4, tile * 1.05, ragged=0.28)
    figure.part("robebody", "body", (0.0, 0.0, d["torso_z"] + 1.4), "none")
    figure.drape("robebody", lambda t: "robe" if t < 0.7 else "lilac",
                 (d["torso"][0] * 0.42, 0.0, d["torso_z"] + 1.4), d["torso"][1] * 1.5, 12.0, 3, tile * 1.05)

    # GOLD TRIM: a sash, a sun emblem, and a gem at the throat.
    figure.slab("body", "gold", (d["torso"][0] * 0.48, 0.0, d["torso_z"] - 1.2), (0.8, d["torso"][1] * 1.02, 1.1), tile=tile)
    figure.slab("body", "gold", (d["torso"][0] * 0.56, 0.0, d["torso_z"] + 0.8), (0.7, 2.8, 2.8), tile=tile * 0.8)
    figure.box("body", "amethyst", (d["torso"][0] * 0.66, 0.0, d["torso_z"] + 0.8), (tile * 0.6, tile * 1.1, tile * 1.1))
    figure.box("head", "amethyst", (d["head"][0] * 0.5, 0.0, d["head_z"] + d["head"][2] * 0.36), (tile * 0.6, tile * 1.2, tile * 1.4))

    # THE SACRED ORBS: two gold staves out of the shoulders, each carrying a SOLID glowing orb, turning slowly.
    # They were thin rings floating behind the head and read as two pink doughnuts; an orb has to be a ball, held
    # clear of the silhouette where it can be seen.
    for side, spin in ((-1.0, 22.0), (1.0, -22.0)):
        name = "orbarm_%s" % ("l" if side < 0 else "r")
        pivot = (-0.4, side * (d["torso"][1] * 0.5 + 0.8), d["torso_z"] + d["torso"][2] * 0.46)
        figure.part(name, "body", pivot, "orbit", spin)
        tip = (pivot[0] + 1.4, pivot[1] + side * 5.4, pivot[2] + 4.2)
        steps = 7
        for s in range(steps):
            t = (s + 1) / steps
            figure.box(name, "gold", (pivot[0] + t * (tip[0] - pivot[0]), pivot[1] + t * (tip[1] - pivot[1]),
                                      pivot[2] + t * (tip[2] - pivot[2])), (tile * 0.75,) * 3)
        # a ball, built as a small solid sphere of voxels
        r = 2.0
        span = int(r / tile) + 1
        for ix in range(-span, span + 1):
            for iy in range(-span, span + 1):
                for iz in range(-span, span + 1):
                    p = (ix * tile, iy * tile, iz * tile)
                    if p[0] * p[0] + p[1] * p[1] + p[2] * p[2] <= r * r:
                        figure.box(name, "orb", (tip[0] + p[0], tip[1] + p[1], tip[2] + p[2]), (tile * 1.02,) * 3)
    return figure


def celestial_light():
    """The dog made of light: a glowing white coat, a star at the brow, a banner, and an aura."""
    figure = start("RELAY DOG SKIN -- CELESTIAL LIGHT", 7006, (0.55, 0.90, 1.00), 8.0,
                   coat=(0.940, 0.960, 1.000), coat_deep=(0.760, 0.840, 0.980))
    figure.material("halo", "add", (0.55, 0.80, 1.00), 2.2)
    figure.material("star", "glow", (0.85, 0.96, 1.00), 7.0)
    figure.material("mark", "glow", (0.98, 1.00, 1.00), 5.0)
    base_dog(figure)
    d = DOG
    tile = d["tile"]

    # A STAR AT THE BROW, the sheet's emblem.
    figure.part("brow", "head", (d["head"][0] * 0.5, 0.0, d["head_z"] + d["head"][2] * 0.40), "twinkle", 0.0)
    for arm in range(4):
        a = math.pi * 0.5 * arm
        for s in range(3):
            t = (s + 1) / 3.0
            figure.box("brow", "star", (d["head"][0] * 0.5 + 0.3, math.cos(a) * t * 1.8, d["head_z"] + d["head"][2] * 0.40 + math.sin(a) * t * 1.8),
                       (tile * 0.4, tile * (0.8 - 0.2 * t), tile * (0.8 - 0.2 * t)))

    # THE BANNER on the chest, with its mark.
    figure.slab("body", "bonedeep", (d["torso"][0] * 0.5, 0.0, d["torso_z"] + 0.4), (0.5, 4.4, 4.6), tile=tile * 0.9)
    for stroke in ((0.0, 1.2, 0.5, 2.6), (-1.0, -0.4, 1.8, 0.5), (1.2, -0.6, 0.5, 2.0)):
        figure.box("body", "mark", (d["torso"][0] * 0.56, stroke[0], d["torso_z"] + 0.4 + stroke[1]), (tile * 0.35, stroke[2], stroke[3]))

    # THE AURA: a wide halo disc STANDING BEHIND the dog, and a fine drift of sparks around it -- not the clump of
    # cartoon clouds stuck to the body that twenty-six fat additive cubes produced.
    figure.part("aura", "root", (-3.2, 0.0, d["torso_z"] + 2.0), "orbit", 4.0)
    for band, (radius, thickness) in enumerate(((10.5, tile * 1.0), (8.8, tile * 0.6))):
        around = int(2.0 * math.pi * radius / (tile * 1.05))
        for i in range(around):
            a = 2.0 * math.pi * i / around
            figure.box("aura", "halo", (-3.2, math.cos(a) * radius, d["torso_z"] + 2.0 + math.sin(a) * radius),
                       (thickness, tile * 1.0, tile * 1.0))
    figure.part("sparks", "root", (0.0, 0.0, d["torso_z"]), "twinkle", 0.45)
    for i in range(30):
        a = 2.0 * math.pi * i / 30 * 3.0
        r = 5.0 + (i % 4) * 1.6
        figure.box("sparks", "star", (math.cos(a) * 2.5, math.sin(a) * r, d["torso_z"] - 6.0 + i * 0.62), (tile * 0.55,) * 3)
    return figure


def bee():
    """The Bee family's first form: amber and black bands, gauze wings, a small stinger. Still a Relay Dog."""
    figure = start("RELAY DOG SKIN -- BEE", 7007, (0.20, 0.16, 0.10), 3.0,
                   coat=(0.960, 0.760, 0.180), coat_deep=(0.620, 0.470, 0.090))
    figure.material("stripe", "lit", (0.110, 0.095, 0.070), 1.0)
    figure.material("gauze", "add", (0.80, 0.92, 1.00), 1.1)
    figure.material("amber", "glow", (1.00, 0.72, 0.12), 4.0)
    base_dog(figure)
    d = DOG
    tile = d["tile"]

    # THE BANDS: black across the body, which is what makes a bee a bee at fifty metres.
    for band in range(3):
        z = d["torso_z"] + 2.0 - band * 2.4
        figure.slab("body", "stripe", (0.0, 0.0, z), (d["torso"][0] * 1.04, d["torso"][1] * 1.04, 1.1), tile=tile)
    figure.slab("head", "stripe", (0.0, 0.0, d["head_z"] - d["head"][2] * 0.42), (d["head"][0] * 1.02, d["head"][1] * 1.02, 0.9), tile=tile)

    # ANTENNAE, small and on the ears' own line so the silhouette still reads Relay Dog first.
    for side in (-1.0, 1.0):
        for s in range(3):
            figure.box("head", "stripe", (0.6 + s * 0.5, side * (d["head"][1] * 0.32), d["head_z"] + d["head"][2] * 0.5 + 1.0 + s * 0.9), (tile * 0.45,) * 3)
        figure.box("head", "amber", (2.1, side * (d["head"][1] * 0.32), d["head_z"] + d["head"][2] * 0.5 + 3.4), (tile * 0.8,) * 3)

    # GAUZE WINGS: a pair of swept leaf shapes per side, angled BACK and UP off the shoulders, and they beat.
    # Two straight rows of blocks held out sideways read as a pair of white blades, which is not a wing.
    for side in (-1.0, 1.0):
        name = "wing_%s" % ("l" if side < 0 else "r")
        pivot = (-d["torso"][0] * 0.42, side * d["torso"][1] * 0.45, d["torso_z"] + d["torso"][2] * 0.44)
        figure.part(name, "body", pivot, "wing", side)
        for leaf, (length, lift, sweep) in enumerate(((9.0, 3.4, 4.0), (6.4, 0.6, 5.2))):
            across = max(3, int(length / (tile * 1.6)))
            for s in range(across):
                t = (s + 0.5) / across
                # half-width of a leaf: fat in the middle, pointed at the tip
                half = (0.55 + 1.85 * math.sin(math.pi * min(t * 1.15, 1.0))) * (1.0 - 0.25 * t)
                steps = max(1, int(half / tile))
                for w in range(-steps, steps + 1):
                    figure.box(name, "gauze",
                               (pivot[0] - t * sweep + w * tile * 0.35,
                                pivot[1] + side * t * length,
                                pivot[2] + t * lift + w * tile * 0.95),
                               (tile * 0.45, tile * 1.45, tile * 0.9))

    # THE STINGER.
    figure.part("sting", "body", (-d["torso"][0] * 0.5, 0.0, d["torso_z"] - d["torso"][2] * 0.35), "none")
    for s in range(4):
        t = s / 3.0
        figure.box("sting", "stripe" if t < 0.7 else "amber", (-d["torso"][0] * 0.5 - 0.8 - t * 2.2, 0.0, d["torso_z"] - d["torso"][2] * 0.35 - t * 1.0),
                   (tile * (1.0 - 0.55 * t),) * 3)
    return figure



# ============================================================================ the sub-agent cub

def cub_ghost(eyes="flat"):
    """A RELAY DOG CUB GHOST: a regular temporary sub-agent, as the founder's "RELAY DOG CUBS / SUB AGENTS" plate
    draws one.

    NOT A MINIATURE OF THE MASCOT. The plate shows a floating HEAD -- the Relay Dog head with its two ear spurs, its
    black visor and its warm gold eyes, two small pearl ball hands detached at either side, and a ghost tail
    trailing below where a body would be. There is no torso, no arms, no elbows and no legs. A cub built by shrinking
    the standing mascot is a different creature from the one on the sheet, and the world lane deleted exactly those
    parts from its own build for the same reason.

    NOT A /MAS CLONE EITHER (founder correction, 2026-09-22). A cub is a lightweight delegated helper under the
    primary Compound AI Agent. It holds no mission authority, and nothing about how it is drawn may suggest it does.

    THE EYE SHAPE CARRIES THE EXPRESSION. A creature with no face and no body has only its eyes, so the plate gives
    each cub a different pair -- flat bars, curved arcs, slanted wedges -- and this takes the same three.
    """
    figure = start("RELAY DOG CUB GHOST -- SUB AGENT", 7100 + len(eyes), (1.00, 0.80, 0.34), 8.0,
                   coat=(0.965, 0.960, 0.945), coat_deep=(0.800, 0.800, 0.800))
    figure.material("ghost", "add", (0.98, 0.96, 0.90), 1.5)
    d = DOG
    tile = d["tile"]
    hd, hw, hh = d["head"]
    # The cub's own scale: a head about two thirds the mascot's, since it is a cub.
    k = 0.66
    hd, hw, hh = hd * k, hw * k, hh * k
    head_z = 0.0

    # THE HEAD. Everything a Relay Dog is recognised by, and nothing else.
    figure.part("root", "-", (0.0, 0.0, 0.0), "float")
    figure.part("head", "root", (0.0, 0.0, head_z), "head")
    figure.slab("head", "bone", (0.0, 0.0, head_z), (hd, hw, hh), tile=tile * k)
    ed, ew, eh = (v * k for v in d["ear"])
    for side in (-1.0, 1.0):
        y = side * (hw * 0.5 - ew * 0.9)
        figure.slab("head", "bone", (0.0, y, head_z + hh * 0.5 + eh * 0.28), (ed, ew, eh * 0.62), tile=tile * k)
        figure.slab("head", "bone", (0.0, y + side * ew * 0.16, head_z + hh * 0.5 + eh * 0.78),
                    (ed * 0.72, ew * 0.72, eh * 0.50), tile=tile * k)
    figure.slab("head", "visor", (hd * 0.5 - 0.25, 0.0, head_z + hh * 0.06), (1.1, hw * 0.76, hh * 0.38), tile=tile * 0.45)

    # THE EYES, in one of the plate's three shapes. Same place and same size in all three: expression may change, and
    # legibility may not.
    ex = hd * 0.5 + 0.22
    for side in (-1.0, 1.0):
        base = (ex, side * hw * 0.19, head_z + hh * 0.06)
        if eyes == "flat":
            figure.box("head", "eye", base, (0.35, hw * 0.20, hh * 0.13))
        elif eyes == "arc":
            for s in range(5):
                a = math.pi * (0.18 + 0.64 * s / 4.0)
                figure.box("head", "eye", (base[0], base[1] + math.cos(a) * hw * 0.10, base[2] + math.sin(a) * hh * 0.07 - hh * 0.03),
                           (0.35, hw * 0.055, hh * 0.055))
        else:  # slant
            for s in range(4):
                f = (s - 1.5) / 3.0
                figure.box("head", "eye", (base[0], base[1] + f * hw * 0.13, base[2] + side * f * hh * 0.08),
                           (0.35, hw * 0.06, hh * 0.07))

    # THE TWO BALL HANDS. Their own joints, detached, with nothing to weld them to -- as the plate has them and as
    # the world lane rigged them. They lag the head rather than being fixed to it.
    for side, name in ((-1.0, "hand_l"), (1.0, "hand_r")):
        pivot = (hd * 0.22, side * (hw * 0.5 + 2.3), head_z - hh * 0.14)
        figure.part(name, "root", pivot, "trail", 1.0, 2.0)
        r = 1.5
        span = int(r / (tile * 0.55)) + 1
        for ix in range(-span, span + 1):
            for iy in range(-span, span + 1):
                for iz in range(-span, span + 1):
                    q = (ix * tile * 0.55, iy * tile * 0.55, iz * tile * 0.55)
                    if q[0] * q[0] + q[1] * q[1] + q[2] * q[2] <= r * r:
                        figure.box(name, "bone", (pivot[0] + q[0], pivot[1] + q[1], pivot[2] + q[2]), (tile * 0.58,) * 3)

    # THE GHOST TAIL: a smooth comet below and behind, not a stack of blocks. Two joints so it drags rather than
    # swinging rigidly with the head.
    figure.part("tail", "root", (-hd * 0.22, 0.0, head_z - hh * 0.45), "trail", 1.0, 3.0)
    figure.part("tail_tip", "tail", (-hd * 0.55, 0.0, head_z - hh * 1.5), "trail", 2.6, 3.0)
    for s in range(15):
        f = s / 14.0
        host = "tail" if f < 0.45 else "tail_tip"
        width = (1.0 - 0.78 * f) * hw * 0.44
        # Back three times as far as it falls, with a curl: a comet, as the plate draws it.
        figure.box(host, "ghost" if f > 0.28 else "bone",
                   (-hd * 0.30 - f * hd * 1.55 + math.sin(f * 2.6) * 0.8,
                    math.sin(f * 3.4) * hw * 0.16,
                    head_z - hh * 0.40 - f * hh * 0.62 - math.sin(f * 2.2) * hh * 0.10),
                   (width * 1.15, width, width))
    figure.mark_dog_extent()
    return figure


CUB_EYES = ("flat", "arc", "slant")

SKINS = [
    ("RelayOg", relay_og),
    ("ArdenInfernal", arden_infernal),
    ("Apollo", apollo),
    ("SkeletonFlame", skeleton_flame),
    ("Hagoromo", hagoromo),
    ("CelestialLight", celestial_light),
    ("Bee", bee),
]


def main():
    parser = argparse.ArgumentParser(description="Generate the Relay Dog skin figures.")
    parser.add_argument("--out", default=os.path.join("wonderland", "RelaySkins"))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name, build in SKINS:
        figure = build()
        figure.fit_to_metres(TARGET_METRES)
        path = os.path.join(args.out, "%s.wlvox" % name)
        boxes, parts, materials = figure.write(path)
        print("%-22s %5d boxes  %2d parts  %2d materials  voxel %.2f uu" % (os.path.basename(path), boxes, parts, materials, figure.voxel_uu))

    # THE CUBS. A cub is about a third of the Dog's height on the plate, which is what "cub proportions" means here.
    cubs = os.path.join(os.path.dirname(args.out), "RelayCubs")
    os.makedirs(cubs, exist_ok=True)
    for eyes in CUB_EYES:
        figure = cub_ghost(eyes)
        figure.fit_to_metres(TARGET_METRES * 0.34)
        path = os.path.join(cubs, "CubGhost_%s.wlvox" % eyes.capitalize())
        boxes, parts, materials = figure.write(path)
        print("%-22s %5d boxes  %2d parts  %2d materials  voxel %.2f uu" % (os.path.basename(path), boxes, parts, materials, figure.voxel_uu))


if __name__ == "__main__":
    main()
