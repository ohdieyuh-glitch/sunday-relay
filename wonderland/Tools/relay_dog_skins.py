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
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skin_eye_check  # noqa: E402  -- the eyes-inside-the-face rules main() enforces on every skin it writes

# THE NUMBER THAT WAS PINNING EVERY PREMIUM SKIN TO WHITE.
#
# 4000. A skin authoring an ember at 0.6 shipped it at 2,400; Celestial Light's edge at 5.2 shipped at 20,800.
# In the world a material strength of 1.0 renders at luma 0.039 and white pins near 25, so every glowing
# surface on every premium skin was between forty and eight hundred times past clipping. The runtime's knee
# (wl.Look.GlowKnee 700, curve 0.15) then folded that whole range into 840-1,240 -- a 1.5x spread across a
# 13x authored one -- and rendered all of it as the same white. That is why Arden at noon photographs as a
# screen-filling yellow blow-out (captures/zc/before_rebuild_2026-09-27/h12.0_arden_infernal.png), why no
# eye on a premium skin could ever clear its own face, why the chest skull could not read as cyan, and why
# the founder has asked three times for eyes he could not see.
#
# 6. The same authored numbers now land between 3 and 13: bright, coloured, visibly luminous, and BELOW the
# white point, with the eyes -- driven to an absolute 12 by the day cycle -- the brightest thing on every
# head. The knee stops being the compressor and becomes the safety net it was meant to be. Flames go
# through their own sqrt/FireGain curve and come down by about forty times, into the band the flame sweep
# was already reaching for.
# 15, AGAINST THE MEASURED WHITE. The note above reasoned against a white of 25; the world's white at the noon
# exposure is near 25,000 scene units and the runtime supplies the thousand (WonderlandSceneUnits). At 6 a body
# glow of 6 x 1000 was a quarter of white and Celestial Light's halo photographed grey-blue; at 15 the same edge
# is 15,000 -- luminous, coloured, under white -- and the eyes, driven to 18 x 1000, stay the brightest thing on
# every head. The chest skull's pulse peaks at 33,000 and clips at the top of its beat, which a pulse should.
GLOW_SCALE = 15.0
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

    def material(self, name, kind, rgb, strength=1.0, channel=None):
        # CHANNEL (founder, 2026-09-29): an optional player-colour tag written after the strength -- "secondary"
        # makes the surface follow the mascot SECONDARY at its authored brightness, "secondary_light" the same
        # colour lifted toward white, "secondary_deep" a deep shade of it for a lit cloth (Jack Flame's suit, 2026-09-30).
        # The engine reads it in WonderlandCompanionFigure.cpp; older engines stop at
        # the strength, so a tagged figure loads everywhere.
        if name in self.material_names:
            return
        self.materials.append((name, kind, rgb, strength, channel))
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

    # ------------------------------------------------- primitives for the reference plates
    def baroque_scroll(self, part, mats, root, out_dir, size, tile, coils=2.0, lobes=3):
        """A VOLUTE: the curling scrollwork on APOLLO's pauldrons.

        Not a row of cubes stepping outward -- a spiral that tightens as it turns, thickens at the shoulder and
        thins at the tip, with leaf lobes budding off the outer edge. That combination is what reads as carved
        metal rather than as a staircase.
        """
        oy, oz = out_dir
        steps = max(10, int(round(size / tile * 2.2)))
        for s in range(steps):
            f = s / max(steps - 1, 1)
            angle = f * coils * math.pi
            radius = size * (1.0 - 0.62 * f)
            y = root[1] + oy * (math.sin(angle) * radius + size * 0.35 * f)
            z = root[2] + oz * (1.0 - math.cos(angle)) * radius * 0.85 + size * 0.30 * f
            thick = tile * (2.1 - 1.25 * f)
            self.box(part, mats["gold"], (root[0] + math.sin(f * 2.0) * tile * 0.5, y, z), (tile * 1.5, thick, thick))
            if s % max(2, steps // max(lobes, 1)) == 0 and f < 0.8:
                # A LEAF BUDDING OFF THE CURL. The plate's scrolls are not bare spirals; they carry foliage.
                for leaf in range(3):
                    lf = (leaf + 1) / 4.0
                    self.box(part, mats["golddeep"],
                             (root[0] - tile * 0.6, y + oy * lf * size * 0.34, z - lf * size * 0.20),
                             (tile * 1.1, tile * (1.3 - 0.4 * lf), tile * (1.3 - 0.4 * lf)))

    def cherub_face(self, part, mats, centre, size, tile, face_dir=1.0):
        """A SMALL WINGED FACE, as sits on each of APOLLO's pauldrons on the plate."""
        cx, cy, cz = centre
        self.slab(part, mats["gold"], (cx, cy, cz), (size * 0.66, size * 0.86, size), tile=tile)
        # brow and cheeks, so it is a face rather than a bead
        self.box(part, mats["golddeep"], (cx + face_dir * size * 0.34, cy, cz + size * 0.22),
                 (tile * 0.7, size * 0.72, tile * 0.8))
        for e in (-1.0, 1.0):
            self.box(part, mats["dark"], (cx + face_dir * size * 0.36, cy + e * size * 0.22, cz + size * 0.04),
                     (tile * 0.6, tile * 0.7, tile * 0.7))
        # hair lobes
        for lobe in range(4):
            a = math.pi * (0.20 + 0.20 * lobe)
            self.box(part, mats["gold"], (cx - size * 0.10, cy + math.cos(a) * size * 0.56, cz + math.sin(a) * size * 0.62),
                     (size * 0.5, tile * 1.2, tile * 1.2))
        # and the little wings that make it a cherub
        for wing in (-1.0, 1.0):
            for w in range(4):
                wf = w / 3.0
                self.box(part, mats["gold"],
                         (cx - size * 0.22, cy + wing * (size * 0.5 + wf * size * 0.62), cz - wf * size * 0.30),
                         (tile * 0.9, tile * (1.5 - 0.5 * wf), tile * (1.9 - 0.7 * wf)))

    def chain_run(self, part, mat, start, end, tile, sag=0.0, link=None):
        """A HANGING CHAIN between two points, with real sag and alternating links.

        ARDEN's chains lie in curves across the chest. A straight run of identical cubes reads as a pipe, so this
        carries a catenary droop and turns every other link ninety degrees, which is what makes a chain look linked.
        """
        link = link or tile * 0.95
        sx, sy, sz = start
        ex, ey, ez = end
        span = math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2 + (ez - sz) ** 2)
        count = max(3, int(round(span / (link * 0.92))))
        for i in range(count + 1):
            f = i / count
            droop = math.sin(math.pi * f) * sag
            x = sx + (ex - sx) * f
            y = sy + (ey - sy) * f
            z = sz + (ez - sz) * f - droop
            if i % 2 == 0:
                self.box(part, mat, (x, y, z), (link * 0.55, link * 1.15, link * 0.62))
            else:
                self.box(part, mat, (x, y, z), (link * 0.55, link * 0.62, link * 1.15))

    def pendant(self, part, mats, at, tile, drop=2.4, gem="gem"):
        """A GEM DROP on a short gold link, as hangs from every chain on the ARDEN plate."""
        x, y, z = at
        for s in range(max(1, int(round(drop / tile)))):
            self.box(part, mats["gold"], (x, y, z - tile * (s + 0.5)), (tile * 0.6, tile * 0.6, tile * 0.95))
        gz = z - drop - tile * 0.6
        # a faceted stone: a waist ring with a point above and below
        for dy, dz, sy, sz in ((0.0, 0.0, 1.9, 1.3), (0.0, 1.0, 1.2, 0.8), (0.0, -1.0, 1.2, 0.8)):
            self.box(part, mats[gem], (x, y + dy * tile, gz + dz * tile), (tile * 0.9, tile * sy, tile * sz))

    def orb_on_rod(self, part, mats, anchor, bearing, length, orb_r, tile, halo=True):
        """A SACRED ORB PRESENTED ON A GOLD ROD -- the defining furniture of the HAGOROMO plate.

        `bearing` is (dy, dz) in the figure's side plane; the rod runs out along it from the anchor and the orb sits
        at its end, with a thin gold collar where the two meet and an optional ring of light around the sphere.
        """
        ax, ay, az = anchor
        by, bz = bearing
        norm = math.sqrt(by * by + bz * bz) or 1.0
        by, bz = by / norm, bz / norm
        steps = max(3, int(round(length / tile)))
        for s in range(steps):
            f = (s + 0.5) / steps
            self.box(part, mats["gold"], (ax, ay + by * length * f, az + bz * length * f),
                     (tile * 0.62, tile * 0.78, tile * 0.78))
        ey, ez = ay + by * length, az + bz * length
        # the collar, so the rod meets the orb rather than vanishing into it
        self.box(part, mats["gold"], (ax, ey - by * orb_r * 0.9, ez - bz * orb_r * 0.9),
                 (tile * 1.1, tile * 1.35, tile * 1.35))
        for ddy in range(-int(orb_r), int(orb_r) + 1):
            for ddz in range(-int(orb_r), int(orb_r) + 1):
                for ddx in range(-int(orb_r), int(orb_r) + 1):
                    if ddx * ddx + ddy * ddy + ddz * ddz > orb_r * orb_r:
                        continue
                    if ddx * ddx + ddy * ddy + ddz * ddz < (orb_r - 1.1) ** 2:
                        continue
                    self.box(part, mats["orb"], (ax + ddx * tile, ey + ddy * tile, ez + ddz * tile),
                             (tile * 1.02,) * 3)
        # THE HEART: a bright core standing proud of the sphere's front face, so the orb reads as lit from within.
        self.box(part, mats["orbglow"], (ax + orb_r * 0.55, ey, ez), (tile * 1.1, tile * 1.6, tile * 1.6))
        if halo:
            self.ring(part, lambda a: mats["orbglow"], (ax, ey, ez), orb_r + 1.25, tile * 0.55, tile * 0.9)

    def ribcage(self, part, mats, centre, depth, width, height, ribs, tile):
        """A STRUCTURAL RIBCAGE: a sternum with paired ribs that wrap and taper toward the spine.

        FOUNDER: "The ribcage must read structurally. Do not represent it as a few bars, painted lines, or shallow
        generic trim." So each rib is an arc of blocks standing PROUD of the chest with a gap of shadow between it
        and its neighbour, and the ribs shorten as they descend, which is what makes a cage read as anatomy.
        """
        cx, cy, cz = centre
        for r in range(ribs):
            f = r / max(ribs - 1, 1)
            z = cz + height * 0.5 - height * f
            reach = width * 0.5 * (1.0 - 0.30 * f ** 1.6)
            for side in (-1.0, 1.0):
                arc = max(3, int(round(reach / tile)))
                for s in range(arc):
                    t = (s + 0.5) / arc
                    y = side * reach * t
                    # forward at the sternum, curving back around the body toward the spine
                    x = cx + depth * (0.5 - 0.55 * t * t)
                    # THE SWEEP HAS TO BE BIGGER THAN A VOXEL OR IT IS NOT A SWEEP. At height*0.055 the droop came
                    # to about a third of a tile across the whole rib, so every rib quantised to one flat row and
                    # the chest read as a barcode -- the founder's words were "a striped Relay Dog". Real ribs fall
                    # away steeply toward the spine, so the sweep is now several tiles and biased to the outer end,
                    # and the ribs are slimmer so the shadow between them survives.
                    sag = height * 0.26 * math.sin(math.pi * 0.5 * t) * (0.45 + 0.55 * t)
                    self.box(part, mats["bone"], (x, y, z - sag), (tile * 1.25, tile * 1.02, tile * 0.85))
        # the sternum plate the ribs spring from
        for s in range(max(2, ribs - 1)):
            f = s / max(ribs - 2, 1)
            self.box(part, mats["bone"], (cx + depth * 0.52, 0.0, cz + height * 0.42 - height * 0.84 * f),
                     (tile * 1.35, tile * (2.2 - 0.7 * f), tile * 1.45))

    def skull_emblem(self, part, mats, centre, size, tile, deep="dark"):
        """A SKULL: cranium, two sunken sockets, a nasal notch and a row of teeth."""
        cx, cy, cz = centre
        self.slab(part, mats["bone"], (cx, cy, cz + size * 0.12), (size * 0.5, size * 0.92, size * 0.78), tile=tile)
        for e in (-1.0, 1.0):
            self.box(part, mats[deep], (cx + size * 0.28, cy + e * size * 0.24, cz + size * 0.22),
                     (tile * 0.8, size * 0.30, size * 0.26))
        self.box(part, mats[deep], (cx + size * 0.30, cy, cz - size * 0.02), (tile * 0.7, size * 0.12, size * 0.16))
        # jaw and teeth
        self.slab(part, mats["bone"], (cx, cy, cz - size * 0.38), (size * 0.44, size * 0.74, size * 0.26), tile=tile)
        for t in range(4):
            self.box(part, mats[deep], (cx + size * 0.26, cy + (t - 1.5) * size * 0.19, cz - size * 0.30),
                     (tile * 0.55, tile * 0.5, tile * 0.7))

    def mane_layers(self, part, material_for, top, width, length, layers, tile, spread=1.0):
        """OVERLAPPING SHEETS OF MANE, each a little longer and a little wider than the one above it.

        One drape call makes one sheet and reads as a skirt. HAGOROMO's mane on the plate is clearly several
        cascading layers with visible steps between them, which is where all of its volume comes from.
        """
        for layer in range(layers):
            f = layer / max(layers - 1, 1)
            self.drape(part, lambda d, lf=f: material_for(lf, d),
                       (top[0] - f * tile * 1.15, top[1], top[2] - f * tile * 1.9),
                       width * (1.0 + spread * 0.30 * f), length * (0.55 + 0.75 * f),
                       0, tile * (1.0 + 0.10 * f), ragged=0.30)

    def star_burst(self, part, mats, centre, radius, points, tile, plane="yz", key="gold", core="gem"):
        """A POINTED STAR -- HAGOROMO's eight-point chest emblem and CELESTIAL LIGHT's four-point brow mark."""
        cx, cy, cz = centre
        for p in range(points):
            a = 2.0 * math.pi * p / points
            long_arm = radius if p % 2 == 0 or points <= 4 else radius * 0.58
            steps = max(2, int(round(long_arm / tile)))
            for s in range(steps):
                f = (s + 0.5) / steps
                w = tile * (1.5 - 1.0 * f)
                if plane == "yz":
                    at = (cx, cy + math.cos(a) * long_arm * f, cz + math.sin(a) * long_arm * f)
                    self.box(part, mats[key], at, (tile * 0.85, w, w))
                else:
                    at = (cx + math.cos(a) * long_arm * f, cy + math.sin(a) * long_arm * f, cz)
                    self.box(part, mats[key], at, (w, w, tile * 0.85))
        self.box(part, mats[core], centre, (tile * 1.05, tile * 1.7, tile * 1.7))

    def glyph_banner(self, part, mats, top, width, length, tile, rows, cloth="cloth", ink="ink"):
        """A HANGING BANNER WITH A MARK ON IT.

        `rows` is a small bitmap -- a list of strings of '#' and '.' -- so an actual character can be carried
        rather than a suggestion of one. CELESTIAL LIGHT's plate has a legible glyph on its chest and a blurred
        smear in its place would be exactly the "silently replace it with a simpler shape" the founder ruled out.
        """
        tx, ty, tz = top
        nz = max(1, int(round(length / tile)))
        ny = max(1, int(round(width / tile)))
        for iz in range(nz):
            for iy in range(ny):
                y = ty - width * 0.5 + width * (iy + 0.5) / ny
                z = tz - length * (iz + 0.5) / nz
                self.box(part, mats[cloth], (tx, y, z), (tile * 0.55, width / ny * 1.02, length / nz * 1.02))
        if not rows:
            return
        gh = len(rows)
        gw = max(len(r) for r in rows)
        cell = min(width / (gw + 1.2), length / (gh + 1.2))
        for r, line in enumerate(rows):
            for c, ch in enumerate(line):
                if ch != "#":
                    continue
                y = ty + (c - (gw - 1) * 0.5) * cell
                z = tz - length * 0.5 + ((gh - 1) * 0.5 - r) * cell
                self.box(part, mats[ink], (tx + tile * 0.34, y, z), (tile * 0.5, cell * 1.02, cell * 1.02))

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
        # THE CANONICAL BODY'S EXTENT (founder, 2026-09-30, HARD: every skin's body is Relay OG's height). The engine scales
        # the figure so THIS stands at the canon Dog's measured height; horns, crowns and fire come along and reach past.
        extent = getattr(self, "dog_extent", None)
        if extent:
            lines.append("body %.3f %.3f" % (extent[0], extent[1]))
        for name, kind, rgb, strength, channel in self.materials:
            if kind in ("glow", "add"):
                strength *= GLOW_SCALE
            lines.append("material %s %s %.4f %.4f %.4f %.3f%s" % (name, kind, rgb[0], rgb[1], rgb[2], strength,
                                                               "" if not channel else " " + channel))
        for name, parent, pivot, motion, a, b in self.parts:
            extra = "" if a is None else (" %.3f" % a) + ("" if b is None else " %.3f" % b)
            lines.append("part %s %s %.3f %.3f %.3f %s%s" % (name, parent, pivot[0], pivot[1], pivot[2], motion, extra))
        for part, material, c, s, r in self.boxes:
            if abs(r[0]) < 1e-4 and abs(r[1]) < 1e-4 and abs(r[2]) < 1e-4:
                lines.append("box %s %s %.3f %.3f %.3f %.3f %.3f %.3f" % (part, material, c[0], c[1], c[2], s[0], s[1], s[2]))
            else:
                lines.append("box %s %s %.3f %.3f %.3f %.3f %.3f %.3f %.2f %.2f %.2f" % (part, material, c[0], c[1], c[2], s[0], s[1], s[2], r[0], r[1], r[2]))
        # THE BUDGET IS A DRAW-CALL BUDGET, AND IT WAS SET FOR A SIMPLER COSTUME. 6,000 was where these skins sat
        # when they stopped at a halo and a colour, and the founder's plates are denser than that by a long way --
        # layered drapery, chains, waist and knee armour, ribcages, manes. The Project Avatars he accepted run
        # 12k-40k boxes, so a premium skin at this scale is not out of line with what this project already ships.
        # Raised deliberately rather than by trimming the design to fit a number: it is one instanced mesh per
        # material per part, and the costume is a single actor over the canon body.
        assert len(self.boxes) <= 16000, (self.name, "boxes", len(self.boxes))
        assert len(self.parts) <= 48, (self.name, "parts", len(self.parts))
        # 14, not 12: every skin now carries the eye halo as its own additive material, and Arden Infernal
        # was already at the old cap. One instanced component per material per part; two more are nothing.
        assert len(self.materials) <= 14, (self.name, "materials", len(self.materials))
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write("\n".join(lines) + "\n")
        return len(self.boxes), len(self.parts), len(self.materials)


# ============================================================================ the dog underneath

BONE = (0.898, 0.871, 0.800)
BONE_DEEP = (0.690, 0.660, 0.592)
VISOR = (0.045, 0.042, 0.050)

# WHICH BODY IS THE MASCOT. Named here so no skin can be dressed on the wrong morphology by accident: the
# CURRENT DEFAULT RELAY DOG is the standing biped the founder walks around Wonderland (base_dog, matching the
# canon body ARelayDogCharacter::ShowCanonBody builds). The quadruped is the legacy RELAY OG FORM badge from the
# corner of the premium sheets -- kept, because the badge is real lore, but it may never carry a mascot skin.
CANONICAL_BODY = "current_default_relay_dog_biped"
LEGACY_QUADRUPED_BODY = "legacy_relay_og_form_quadruped"

# The one measurement sheet every skin is built on. Nothing below changes it.
# THE ONE MEASUREMENT SHEET EVERY SKIN IS BUILT ON, taken off the founder's ARDEN INFERNAL and APOLLO plates.
# Nothing below this line changes it, and the proportions are the point: an enormous head, small tapered ears, a
# visor cut across three quarters of the face, a short body and two stubby legs. Get these wrong and no amount of
# dress makes it a Relay Dog.
# MEASURED OFF THE FOUNDER'S CANONICAL BODY PHOTO, 2026-09-23, replacing a squat set he rejected by showing the
# two side by side. The old numbers put the head at 39% of the figure and the arms at 20%; on the canonical photo
# the head is 30%, the torso 29%, the legs 30% and the ARMS 36% -- long enough to hang past the hip, clearly
# separated from a narrow torso, over long legs with real feet. That one difference is the whole silhouette: a
# 39%-head body with 20% arms reads as a chibi, and no amount of ornament on top of it fixes that.
#
# THE HEAD IS THE ONE THING KEPT AT ITS OLD SIZE, deliberately -- the head, visor and gold eyes are the Relay
# Dog's identity, so the proportions are corrected by making everything ELSE longer rather than by shrinking the
# face. Head 8.0 stays; the total grows from 20.6 to about 25.7 around it.
DOG = dict(
    tile=1.0,
    head=(8.2, 9.2, 8.0),      # depth, width, height -- 30% of the figure on the canonical photo
    head_z=19.7,
    ear=(2.0, 1.3, 3.0),       # NARROW UPRIGHT POSTS, not tapered tabs -- 14% of the head width on the photo
    # THE FACE, MEASURED OFF THE CANONICAL PHOTO RATHER THAN REMEMBERED. Three things were wrong and together
    # they changed who the Dog looked like: the visor ran too wide across the face (75% of the head instead of
    # 65%), the eyes were too big (18% of the head's width instead of 13%), and -- the loudest error -- they were
    # set far too far apart, centres 38% of the head's width apart against the photo's 23%. Wide-set eyes read as
    # a different character however correct the body is. They are also SQUARE on the photo, not tall.
    visor=(6.0, 2.7),          # width, height -- inset into the face, 65% x 34% of the head
    eye=(1.2, 1.2),            # a square glowing pane, 13% of the head's width
    eye_gap=1.05,              # offset from centre: centres a little under a quarter of the head apart
    torso=(4.0, 5.0, 7.7),     # NARROW and tall: 54% of the head's width on the photo, not 63%
    torso_z=11.85,
    arm=(1.9, 1.9, 9.6),       # 36% of total height -- upper arm, forearm and hand, hanging past the hip
    leg=(2.5, 2.7, 8.0),
    leg_gap=1.6,
)


# ============================================================================ the face: the eyes INSIDE the black square
#
# FOUNDER CORRECTION, 2026-10-01: "the two glowing eyes are currently positioned/protruding OUTSIDE the black
# square/face area ... The mascot's eyes are supposed to be visually CONTAINED INSIDE the black square face/visor
# area ... The eye surfaces should sit within/inset into the front facial plane rather than looking attached outside
# it." Relay OG's canon head is the reference: two panes inside a dark plate, and nothing breaks the head's front.
#
# WHAT HAD GONE WRONG, measured on the shipped RC6 figures (and independently by Second Wonderland):
#   - the visor was never cut in, whatever its comment said: a slab at x 3.00..4.50 against a head front at 4.10,
#     so every costume carried a black BOX 0.40 proud of the face rather than a black window in it;
#   - each eye pane stood 0.15 proud of that box (front 4.65);
#   - the 2026-09-27 halo pane stood proud of the box as well (front 4.70) and was 2.88 tall on a 2.70 visor, so its
#     glow ran over the black's top and bottom edges. Bright, wide and proud, each eye read as a lit block bolted onto
#     the face -- the founder's Jack Flame photographs, side-on and head-on.
# The 2026-09-23 figures, before the halo, show what the founder remembers: two small panes with black all round them.
# This restores that, and finally cuts the visor INTO the head so nothing stands proud of the face from any side.
#
# ONE PLACE LAYS THE EYES (status_eyes), so no skin can drift back on its own, and main() refuses to write a skin
# whose eyes fail skin_eye_check.py -- the same rules the package QA runs on the figure it actually loaded (Q25).
FACE = dict(
    recess=0.45,        # the visor plate's face sits this far BEHIND the head's front plane: a window, not a sticker
    plate=0.60,         # the plate's own thickness
    eye_inset=0.10,     # each eye pane's face stays this far behind the surface round its housing
    eye_depth=0.40,     # and the pane runs this deep, back into the plate
    halo_scale=1.6,     # a halo pane is at most 1.6x its eye (it was 2.4x) ...
    halo_margin=0.25,   # ... and keeps this much black between itself and its housing's edge
    halo_depth=0.20,
    halo_behind=0.10,   # its face this far behind the eye's: the core stays the front-most light
    margin=0.12,        # the least black between an eye and its housing's edge (skin_eye_check.MARGIN)
)


def status_eyes(figure, part, plane_x, housing, centres, eye="eye", size=None):
    """THE RELAY DOG'S STATUS EYES, laid INSIDE their housing. Every mascot skin's eyes come through here.

    plane_x  -- the front plane of the surface AROUND the housing: the head's face, or a mask's.
    housing  -- (y0, y1, z0, z1): the dark opening the eyes sit in -- the visor window, a skull's socket.
    centres  -- [(y, z), ...] for each eye.

    Each pane's face is FACE["eye_inset"] behind plane_x, so from the side nothing breaks the face's plane; each pane
    keeps FACE["margin"] of black to every edge of its housing, or the build stops; and the halo -- the soft rim that
    makes a pane read as a light (founder, 2026-09-27) -- stays INSIDE the housing, behind its eye, and never reaches
    inward past the eye toward the other one.
    """
    f = FACE
    exw, exh = size or DOG["eye"]
    hy0, hy1, hz0, hz1 = housing
    front = plane_x - f["eye_inset"]
    for cy, cz in centres:
        assert hy0 + f["margin"] <= cy - exw * 0.5 and cy + exw * 0.5 <= hy1 - f["margin"], (figure.name, "eye outside its housing across", cy, housing)
        assert hz0 + f["margin"] <= cz - exh * 0.5 and cz + exh * 0.5 <= hz1 - f["margin"], (figure.name, "eye outside its housing up/down", cz, housing)
        figure.box(part, eye, (front - f["eye_depth"] * 0.5, cy, cz), (f["eye_depth"], exw, exh))
        if "eyehalo" not in figure.material_names:
            continue
        side = 1.0 if cy >= 0.0 else -1.0
        inner = abs(cy) - exw * 0.5                                   # never inward past the eye: the glows do not merge
        reach = (hy1 if side > 0.0 else -hy0) - f["halo_margin"]      # the housing's outer edge on this eye's side
        outer = min(abs(cy) + exw * f["halo_scale"] * 0.5, reach)
        half_h = min(exh * f["halo_scale"] * 0.5, cz - hz0 - f["halo_margin"], hz1 - cz - f["halo_margin"])
        assert outer > inner and half_h >= exh * 0.5, (figure.name, "no room for the halo inside the housing", housing)
        halo_front = front - f["halo_behind"]
        figure.box(part, "eyehalo", (halo_front - f["halo_depth"] * 0.5, side * (inner + outer) * 0.5, cz),
                   (f["halo_depth"], outer - inner, half_h * 2.0))


def head_with_window(figure, part, material, centre, size, tile, window):
    """The head as slab() builds it -- a shell of voxel tiles -- with a WINDOW cut through its front face.

    The front-face tiles the window crosses are left out, and what each of them covered OUTSIDE the window is put back
    at the same depth, piece by piece along the tile grid: the coat runs right up to the window's edge with the seams
    where they always were, and the window is exactly the visor's size. Behind it the shell is hollow, so the visor
    plate laid in it is the only thing seen there.
    """
    cx, cy, cz = centre
    sx, sy, sz = size
    nx = max(1, int(round(sx / tile)))
    ny = max(1, int(round(sy / tile)))
    nz = max(1, int(round(sz / tile)))
    wy0, wy1, wz0, wz1 = window
    for ix in range(nx):
        for iy in range(ny):
            for iz in range(nz):
                if 0 < ix < nx - 1 and 0 < iy < ny - 1 and 0 < iz < nz - 1:
                    continue
                px = cx - sx * 0.5 + sx * (ix + 0.5) / nx
                py = cy - sy * 0.5 + sy * (iy + 0.5) / ny
                pz = cz - sz * 0.5 + sz * (iz + 0.5) / nz
                ty0, ty1 = cy - sy * 0.5 + sy * iy / ny, cy - sy * 0.5 + sy * (iy + 1) / ny
                tz0, tz1 = cz - sz * 0.5 + sz * iz / nz, cz - sz * 0.5 + sz * (iz + 1) / nz
                if ix == nx - 1 and ty0 < wy1 and ty1 > wy0 and tz0 < wz1 and tz1 > wz0:
                    # the tile minus the window: left and right of it full height, and above and below it between
                    ly1, ry0 = max(ty0, min(ty1, wy0)), max(ty0, min(ty1, wy1))
                    my0, my1 = max(ty0, wy0), min(ty1, wy1)
                    bz1, tz_ = max(tz0, min(tz1, wz0)), max(tz0, min(tz1, wz1))
                    for (a0, a1, b0, b1) in ((ty0, ly1, tz0, tz1), (ry0, ty1, tz0, tz1), (my0, my1, tz0, bz1), (my0, my1, tz_, tz1)):
                        if a1 - a0 > 1e-6 and b1 - b0 > 1e-6:
                            figure.box(part, material, (px, (a0 + a1) * 0.5, (b0 + b1) * 0.5), (sx / nx, a1 - a0, b1 - b0))
                    continue
                figure.box(part, material, (px, py, pz), (sx / nx, sy / ny, sz / nz))


def base_dog(figure, coat="bone", coat_deep="bonedeep", eye="eye", tile=None):
    """THE RELAY DOG ITSELF. Every skin calls this first and dresses what it returns.

    Built to the reference plates: a big cubic head with two small tapered ear spurs, a dark visor band inset across
    the face with two glowing panes in it, a short torso and two stubby legs. The dress goes on top; this never moves.
    """
    d = DOG
    tile = tile or d["tile"]
    hd, hw, hh = d["head"]
    figure.body_kind = CANONICAL_BODY
    figure.part("root", "-", (0.0, 0.0, 0.0), "spine", 0.85, 0.0)
    figure.part("body", "root", (0.0, 0.0, d["torso_z"]), "none")
    figure.part("head", "body", (0.0, 0.0, d["head_z"]), "head")

    # THE FACE (see FACE above): the visor is a window cut into the head, with the eyes inside it. Every figure, Relay OG's
    # wardrobe preview included (founder, 2026-10-01: "Change the relay og wardrobe preview to the correct visuals").
    vw, vh = d["visor"]
    visor_z = d["head_z"] - hh * 0.07
    window = (-vw * 0.5, vw * 0.5, visor_z - vh * 0.5, visor_z + vh * 0.5)
    head_with_window(figure, "head", coat, (0.0, 0.0, d["head_z"]), (hd, hw, hh), tile, window)

    # THE EARS: a wider base and a narrower tip, leaning very slightly outward, set at the head's top corners.
    ed, ew, eh = d["ear"]
    for side in (-1.0, 1.0):
        y = side * (hw * 0.5 - ew * 0.9)
        figure.slab("head", coat, (0.0, y, d["head_z"] + hh * 0.5 + eh * 0.28), (ed, ew, eh * 0.62), tile=tile)
        figure.slab("head", coat, (0.0, y, d["head_z"] + hh * 0.5 + eh * 0.78),
                    (ed * 0.96, ew * 0.96, eh * 0.50), tile=tile)

    # THE VISOR, CUT INTO THE FACE. On the sheets it sits in the head rather than on it, so it is recessed a little and
    # the coat is carried round it -- a black plate glued to the front reads as a sticker.
    # SET LOW ON THE FACE. The founder compared the two heads crop to crop: the canonical Dog carries more brow
    # above the visor than mine did, so the band sits BELOW the head's midline rather than on it. A visor riding
    # high reads as a different expression entirely -- more alert, less calm -- which is why this is worth the
    # fraction of a head it moves.
    # NOW ACTUALLY CUT IN (2026-10-01): the plate's face FACE["recess"] behind the head's front plane, filling the window
    # head_with_window left, and the eyes inside it through the one function that lays them.
    figure.slab("head", "visor", (hd * 0.5 - FACE["recess"] - FACE["plate"] * 0.5, 0.0, visor_z),
                (FACE["plate"], vw, vh), tile=tile * 0.62)
    status_eyes(figure, "head", hd * 0.5, window, [(-d["eye_gap"], visor_z), (d["eye_gap"], visor_z)], eye=eye)
    _base_dog_body(figure, coat, coat_deep, tile)
    figure.mark_dog_extent()
    return figure


def _base_dog_body(figure, coat, coat_deep, tile):
    """Everything under the head, identical in every skin and in both faces."""
    d = DOG
    # The body and the two legs. Short, plain, and under the dress in every skin but the bare one.
    td, tw, th = d["torso"]
    figure.slab("body", coat, (0.0, 0.0, d["torso_z"]), (td, tw, th), tile=tile)
    # THE ARMS ARE A LIMB, NOT A STUB. On the canonical photo each arm is an upper arm, a forearm and a hand,
    # hanging past the hip with a clear gap of daylight between it and the narrow torso. The old build was a
    # single short slab tucked against a wide body, which is most of why the figure read as squat.
    for side, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        ad, aw, ah = d["arm"]
        # OUTBOARD OF THE TORSO BY A VISIBLE GAP, and still inside the head's width, as the photo has it.
        arm_y = side * (tw * 0.5 + 0.55 + aw * 0.5)
        pivot = (0.0, arm_y, d["torso_z"] + th * 0.34)
        figure.part(name, "body", pivot, "wing", side)
        figure.slab(name, coat, (0.0, arm_y, pivot[2] - ah * 0.22), (ad, aw, ah * 0.46), tile=tile)
        # the forearm swings from the elbow, so a long arm does not read as a plank
        fore = "%s_fore" % name
        figure.part(fore, name, (0.0, arm_y, pivot[2] - ah * 0.46), "knee", 0.25 + 0.2 * side, 0.5)
        figure.slab(fore, coat, (0.0, arm_y, pivot[2] - ah * 0.70), (ad * 0.92, aw * 0.92, ah * 0.42), tile=tile)
        # the hand: a squarer block at the wrist, slightly proud of the forearm
        figure.slab(fore, coat_deep, (0.0, arm_y, pivot[2] - ah * 0.95), (ad * 1.04, aw * 1.06, ah * 0.13), tile=tile)
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
        # A FOOT, not a scuff mark. The canonical photo has a clearly defined foot standing proud of the ankle and
        # reaching forward; the old build was a 1.2-unit sliver that vanished at any distance.
        figure.slab(shin, coat, (ld * 0.30, side * d["leg_gap"], hip_z - lh + lh * 0.055),
                    (ld * 1.42, lw * 1.10, lh * 0.11), tile=tile)
        figure.slab(shin, coat_deep, (ld * 0.30, side * d["leg_gap"], hip_z - lh + lh * 0.012),
                    (ld * 1.46, lw * 1.14, lh * 0.035), tile=tile)


def quadruped_dog(figure, coat="bone", coat_deep="bonedeep", eye="eye", tile=None):
    """THE RELAY OG FORM: the small four-legged dog in the corner of every sheet.

    Both premium plates show the origin form as a QUADRUPED, not as the standing mascot without its dress, so this is
    a different body with the same head: the visor, the two ear spurs and the gold eyes carry over exactly, and
    everything below the neck is a four-legged animal with a short upright tail.
    """
    d = DOG
    tile = tile or d["tile"]
    figure.body_kind = LEGACY_QUADRUPED_BODY
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
    # THE HALO AROUND THE EYE, so a glowing eye looks like one.
    #
    # FOUNDER: "COLORED EYE CORE + EMISSIVE LIGHT + CONTROLLED BLOOM/HALO + CLEAR CONTRAST AGAINST THE FACE."
    # A bright square pane in a black visor is a bright square; the thing that makes an eye read as a LIGHT
    # is the soft rim of its own colour spilling onto what surrounds it. Bloom does that for a big source and
    # not for one four units across, so the rim is authored: an additive pane standing just behind and a
    # little larger than the eye, in the eye's own colour. The runtime drives anything named "eye" to one
    # absolute level; it drives a name containing "halo" to a fraction of that level, so the core stays the
    # brightest thing and the rim is a rim (AWonderlandCompanionEmbodiment::ApplyColourway).
    figure.material("eyehalo", "add", eye_rgb, eye_strength * 0.35)
    return figure


# ============================================================================ the skins

def relay_og():
    """RELAY OG: THE DOG THE FOUNDER ACTUALLY WALKS AROUND WONDERLAND. The standing mascot, undressed.

    THIS WAS WRONG, AND IT WAS THE ROOT OF THE SKIN PROBLEM. It used to build the QUADRUPED, reasoning from the
    small corner inset on the ARDEN and APOLLO sheets captioned "RELAY OG FORM". That inset is a lore badge saying
    where the Dog came from -- it is NOT the mascot the founder uses. The founder's current-default reference is
    the STANDING BIPED: big cubic head, visor band with two gold panes, ear spurs, torso, arms with hands, two
    stubby legs. Building relay_og as a four-legged animal meant the wardrobe offered a quadruped as "RELAY OG"
    and a biped for every premium skin -- the base and its own skins were different creatures.

    At runtime the default Dog is the character's own C++ body (ARelayDogCharacter::ShowCanonBody) and this file is
    never loaded for it; premium skins spawn a costume actor over that body instead. So this figure exists to be
    PREVIEWED and photographed, and it must be the same mascot the canon body is, or every preview of "wearing
    nothing" shows the founder an animal he does not own.
    """
    figure = start("RELAY DOG -- OG", 7001, (1.00, 0.72, 0.16), 7.0)
    # THE WARDROBE'S RELAY OG WEARS THE CORRECT FACE TOO (founder, 2026-10-01: "Change the relay og wardrobe preview to
    # the correct visuals"): the eyes inside the black visor, as on the canon body the Dog wears in play.
    base_dog(figure)
    return figure


# ============================================================================ V1 -- the previous three, kept
#
# FOUNDER, 2026-09-27: "Call the previous one V1 and keep them in the Wonderland world and make the new ones
# called V2." So the designs that stood at the start of the day are not retired: they are the V1 skins,
# still worn, still previewed, verbatim from the generator that produced them (a copy of which sits in
# RelaySkins/_previous/2026-09-27-pre-redo/). They change in exactly two ways every skin changed today: the
# glow scale is 6 rather than 4000, so they stop rendering as white shapes, and their eyes carry the halo.
# Nothing in their dress was touched. The V2 skins below were written fresh from the founder's sheets.

#: THE ONE BLUE THIS SKIN IS LIT BY: its eyes, its ghostfire's pale tip, its chest skull and its spine seams.
#: The founder named the eyes/flame colour as authoritative, so it is written once and read everywhere.
SKELETON_SOUL = (0.36, 0.95, 1.00)


def arden_infernal_v1():
    """ARDEN INFERNAL -- SCION OF FLAME. BOUND BY DESTINY.

    Rebuilt against the founder's plate: a CREAM body (not black), a flaming gold halo with red gems, layered gold
    chains with dharma-wheel charms and red gem pendants, one asymmetric dark-red demonic claw arm with a glowing
    wheel sigil, a long red/cream layered robe, a curling flame tail and orange eyes.
    """
    figure = start("RELAY DOG SKIN -- ARDEN INFERNAL", 7002, (1.00, 0.58, 0.10), 7.5)
    figure.material("gold", "rim", (0.905, 0.720, 0.290), 1.0)
    figure.material("golddeep", "lit", (0.500, 0.360, 0.110), 1.0)
    figure.material("ember", "glow", (1.00, 0.34, 0.05), 0.6)
    figure.material("emberpale", "glow", (1.00, 0.72, 0.22), 1.0)
    figure.material("crimson", "lit", (0.520, 0.075, 0.065), 1.0)
    figure.material("char", "lit", (0.215, 0.115, 0.105), 1.0)
    figure.material("demon", "lit", (0.360, 0.060, 0.060), 1.0)
    figure.material("ruby", "glow", (1.00, 0.09, 0.12), 1.2)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    td, tw, th = d["torso"]
    shoulder = d["torso_z"] + th * 0.48
    mats = {"gold": "gold", "golddeep": "golddeep", "gem": "ruby", "dark": "char"}

    # ================================================================== THE HALO
    # Enormous, thick, gem-set at the four points and wreathed in flame across its whole upper arc.
    halo_c = (-4.4, 0.0, d["head_z"] + 5.4)
    # MOUNTED, NOT ORBITING. The halo was on "orbit" at 5 degrees a second -- a continuous spin on the biggest
    # ring in the silhouette. The founder read it as wobbling, swinging and rotating unpredictably, and he is
    # right: a large ring that never stops turning cannot look deliberately fitted, and once it reaches edge-on
    # it collapses to a vertical line and the skin loses its outline entirely. It stands fixed to the head now
    # and inherits the head's own motion, which is what "mounted" means.
    figure.part("halo", "head", halo_c, "none")
    for r, m in ((12.8, "gold"), (12.0, "gold"), (11.2, "golddeep")):
        figure.ring("halo", lambda a, mm=m: mm, halo_c, r, tile * 1.35, tile * 1.0)
    figure.ring("halo", lambda a: "gold", (halo_c[0] - 1.3, halo_c[1], halo_c[2]), 12.4, tile * 1.0, tile * 1.05)
    for angle, big in ((90.0, 1.6), (0.0, 1.0), (180.0, 1.0), (270.0, 0.9)):
        a = math.radians(angle)
        gy, gz = halo_c[1] + math.cos(a) * 12.4, halo_c[2] + math.sin(a) * 12.4
        # a gold setting and a faceted ruby standing proud of the band
        figure.box("halo", "gold", (halo_c[0] + 0.6, gy, gz), (tile * 1.8, tile * 2.6 * big, tile * 2.6 * big))
        figure.box("halo", "ruby", (halo_c[0] + 1.6, gy, gz), (tile * 1.1, tile * 1.7 * big, tile * 2.3 * big))
        figure.box("halo", "ruby", (halo_c[0] + 1.6, gy, gz + tile * 1.4 * big), (tile * 0.9, tile * 1.0 * big, tile * 1.0 * big))
        figure.box("halo", "ruby", (halo_c[0] + 1.6, gy, gz - tile * 1.4 * big), (tile * 0.9, tile * 1.0 * big, tile * 1.0 * big))
    figure.part("halofire", "halo", halo_c, "twinkle", 0.18)
    for i in range(15):
        f = i / 14.0
        a = math.radians(-20.0 + 220.0 * f)
        by, bz = halo_c[1] + math.cos(a) * 13.4, halo_c[2] + math.sin(a) * 13.4
        tall = 3.0 + 5.5 * math.sin(a) ** 2 if math.sin(a) > 0 else 2.2
        figure.flame("halofire", lambda up: "ember" if up < 0.5 else "emberpale",
                     (halo_c[0] + 0.3, by, bz), tall, 2.4, 3, tile * 0.95)

    # ================================================================== SACRED ORNAMENTS
    # Three chains looped across the chest, each carrying a pendant at its lowest point, and a dharma-wheel
    # medallion at the sternum. The chains hang with real sag; the old skin had no chains at all.
    # IN FRONT OF THE CLOTH. The first rebuild hung the chains 0.3 uu off the chest, where the front robe panel
    # covered every one of them; in the render there were no chains at all. They now stand a clear step out.
    # SIX STRANDS AT THREE DEPTHS, because the plate's chest is a tangle of them and three read as a necklace.
    # The strands are set at different distances from the chest as well as different heights, so from the side
    # they layer over each other instead of sitting in one plane -- which is what makes a pile of chains read as
    # a pile rather than as three drawn arcs.
    cx = td * 0.5 + 1.7
    for k, (sag, drop_z, out) in enumerate(((1.4, 0.6, 0.0), (2.2, 0.1, 0.55), (3.1, -0.4, 0.15),
                                            (4.0, -0.9, 0.70), (4.9, -1.5, 0.30), (5.8, -2.2, 0.85))):
        top_z = shoulder + drop_z
        span = tw * 0.5 + 0.6 - 0.10 * k
        figure.chain_run("body", "gold", (cx + out, -span, top_z), (cx + out, span, top_z), tile, sag=sag)
        if k % 2 == 0:
            figure.pendant("body", mats, (cx + out + 0.5, (k - 2) * 1.6, top_z - sag + 0.2), tile, drop=1.2 + 0.4 * k)
    figure.spoked_wheel("body", "gold", (cx + 0.8, 0.0, shoulder - 4.4), 2.6, 8, tile)
    figure.ring("body", lambda a: "golddeep", (cx + 0.8, 0.0, shoulder - 4.4), 2.6, tile * 0.7, tile * 0.9)
    figure.box("body", "ruby", (cx + 1.4, 0.0, shoulder - 4.4), (tile * 0.9, tile * 1.5, tile * 1.5))
    # a gold collar the chains hang from
    figure.slab("body", "gold", (0.4, 0.0, shoulder + 1.9), (td * 1.05, tw * 1.08, 1.3), tile=tile)
    # small wheel charms on the shoulders, as the plate has on both sides
    for side in (-1.0, 1.0):
        figure.spoked_wheel("body", "gold", (td * 0.30, side * (tw * 0.5 + 0.9), shoulder + 0.4), 1.4, 6, tile)

    # ================================================================== NO CAPE
    # FOUNDER (2026-09-23): "REMOVE THE CAPE from Inferno. Do not replace it with another giant attachment...
    # Inferno should feel integrated into the Relay Dog body itself."
    #
    # The layered robe and its fringe were the bulk of this skin and the reason it read as Relay Dog + cape +
    # ring + fire. Gone. The infernal identity stays in the flaming halo, the gold chains and charms, the
    # demonic claw arm and the infernal tail -- all of which sit on the body rather than draping it.

    # ================================================================== THE DEMONIC ARM (left)
    # A whole limb, not a slab: a spiked shoulder mass, a thick upper arm, a heavier forearm, four long claws, a
    # burning wheel sigil on the back of the hand, and fire licking off the shoulder. Everything on this side is
    # dark red flesh and char; the right arm stays cream, which is what makes the asymmetry read from a distance.
    # IT HAS TO BE HUGE, AND IT HAS TO LEAVE THE BODY. The first build was a correctly-shaped limb at roughly the
    # size of a normal arm, tucked against the torso: 3.2 wide against a 5.8 torso. On the plate the demonic arm is
    # a DOMINANT silhouette mass -- half again the torso's width, flaring outward and downward away from the ribs,
    # with the claws spread low and clear of the robe. At medium distance that flare is the whole read of ARDEN,
    # and a well-modelled limb held at the side simply disappears behind cloth. Every segment below now steps
    # FURTHER OUT as it descends, so the arm makes its own outline instead of sharing the body's.
    arm_y = -(tw * 0.5 + d["arm"][1] * 0.36)
    az = d["torso_z"] + 1.0
    # the pauldron: a heavy spiked cap, wider than the shoulder it sits on
    figure.slab("arm_l", "char", (0.3, arm_y - 1.6, az + 3.6), (6.0, 6.6, 3.6), tile=tile)           # shoulder mass
    figure.slab("arm_l", "demon", (0.1, arm_y - 2.2, az + 1.9), (5.2, 5.8, 1.8), tile=tile)          # under-cap
    for s in range(6):                                                                                # spikes
        figure.box("arm_l", "char", (1.4 - s * 0.8, arm_y - 3.4 - s * 0.18, az + 5.2 + s * 0.30),
                   (tile * 1.1, tile * 1.4, tile * (3.2 - 0.38 * s)))
    figure.slab("arm_l", "demon", (0.0, arm_y - 2.6, az - 0.4), (5.0, 5.4, 6.6), tile=tile)           # upper arm
    figure.slab("arm_l", "char", (0.9, arm_y - 3.4, az - 4.4), (4.4, 4.6, 2.0), tile=tile)            # elbow knot
    figure.slab("arm_l", "demon", (1.1, arm_y - 4.4, az - 7.6), (5.6, 5.8, 6.2), tile=tile)           # forearm
    for s in range(5):                                                                                # sinew ridges
        figure.box("arm_l", "char", (3.6, arm_y - 4.4 + (s - 2) * 1.3, az - 7.6), (tile * 0.7, tile * 0.8, tile * 5.0))
    for s in range(4):                                                                                # forearm barbs
        figure.box("arm_l", "char", (0.4, arm_y - 6.8, az - 5.4 - s * 1.9), (tile * 0.9, tile * 2.2, tile * 1.0))
    figure.claw_hand("arm_l", ("char", "ember"), (1.4, arm_y - 5.0, az - 11.4), 11.2, tile, -1.0)
    figure.claw_hand("arm_l", ("demon", "ember"), (0.4, arm_y - 6.2, az - 10.6), 8.6, tile, -1.0)
    sigil_c = (4.2, arm_y - 4.4, az - 7.2)
    # A WHEEL MAY TURN, BUT SLOWLY AND ON PURPOSE. -30 degrees a second is three full turns every half minute on
    # a charm the size of a fist: it read as a loose spinning object rather than a sigil burning on the arm.
    figure.part("sigil", "arm_l", sigil_c, "orbit", -7.0)
    figure.spoked_wheel("sigil", "ruby", sigil_c, 2.9, 8, tile)
    figure.ring("sigil", lambda a: "ember", sigil_c, 3.8, tile * 0.55, tile * 0.85)
    figure.box("sigil", "emberpale", sigil_c, (tile * 0.8, tile * 1.4, tile * 1.4))
    # FIRE ALONG THE WHOLE LIMB, not just a tuft at the shoulder: the plate burns at the pauldron, down the outside
    # of the arm and off the claws, which is what keeps the arm reading as infernal once it is this large.
    figure.part("armfire", "arm_l", (0.0, arm_y - 1.6, az + 4.6), "twinkle", 0.4)
    figure.flame("armfire", lambda up: "ember" if up < 0.55 else "emberpale", (0.0, arm_y - 2.2, az + 5.0), 8.5, 4.6, 7, tile * 1.0)
    figure.flame("armfire", lambda up: "ember" if up < 0.55 else "emberpale", (0.6, arm_y - 4.6, az - 0.8), 5.4, 3.0, 4, tile * 0.95)
    figure.flame("armfire", lambda up: "ember" if up < 0.55 else "emberpale", (1.0, arm_y - 6.4, az - 6.4), 4.6, 2.6, 4, tile * 0.9)

    # ================================================================== THE INFERNAL TAIL
    # A curl of char rising and hooking over behind the right hip, burning at the tip.
    tail_root = (-td * 0.5, tw * 0.42, d["torso_z"] + 0.5)
    figure.part("tail", "body", tail_root, "tail", 7.0, 10.0)
    for s in range(16):
        t = s / 15.0
        a = t * math.pi * 1.05
        x = tail_root[0] - 7.2 * math.sin(a) - 1.2 * t
        y = tail_root[1] + 2.4 * t
        z = tail_root[2] + 7.8 * (1.0 - math.cos(a))
        size = tile * (2.1 - 1.1 * t)
        figure.box("tail", "char" if s % 3 else "demon", (x, y, z), (size, size, size))
    figure.part("tailfire", "tail", (tail_root[0] - 8.4, tail_root[1] + 2.4, tail_root[2] + 15.0), "twinkle", 0.5)
    figure.flame("tailfire", lambda up: "ember" if up < 0.5 else "emberpale",
                 (tail_root[0] - 8.4, tail_root[1] + 2.4, tail_root[2] + 15.0), 6.0, 3.0, 4, tile * 0.95)
    figure.flame("tailfire", lambda up: "ember", (tail_root[0] - 4.0, tail_root[1] + 1.2, tail_root[2] + 6.0), 3.0, 2.0, 2, tile * 0.8)
    return figure


def apollo_v1():
    """APOLLO -- GOD OF THE SUN. LIGHT. HARMONY. PERFECTION.

    Rebuilt against the founder's plate: gold ring halo behind the head, a solar flame erupting from the crown,
    ornate baroque pauldrons carrying cherub faces, white drapery to the floor, a gold chest emblem, two lit
    lamp-orbs at the hips and gold boots.
    """
    figure = start("RELAY DOG SKIN -- APOLLO", 7003, (1.00, 0.86, 0.26), 7.5)
    figure.material("gold", "rim", (0.915, 0.735, 0.300), 1.0)
    figure.material("golddeep", "lit", (0.520, 0.375, 0.115), 1.0)
    figure.material("linen", "rim", (0.968, 0.958, 0.930), 1.0)
    figure.material("linenshade", "lit", (0.760, 0.740, 0.700), 1.0)
    figure.material("dark", "lit", (0.055, 0.050, 0.045), 1.0)
    figure.material("solar", "glow", (1.00, 0.36, 0.03), 0.7)
    figure.material("solarmid", "glow", (1.00, 0.56, 0.06), 0.9)
    figure.material("solarpale", "glow", (1.00, 0.78, 0.16), 1.2)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    tw, th = d["torso"][1], d["torso"][2]
    td = d["torso"][0]
    shoulder = d["torso_z"] + th * 0.48
    mats = {"gold": "gold", "golddeep": "golddeep", "dark": "dark", "gem": "solarpale"}

    # ---- THE HALO. Thicker and wider than before, and set BEHIND the head as the plate shows, with an inner
    # ---- bright rim so it reads as a lit ring rather than a drawn circle.
    halo_c = (-4.2, 0.0, d["head_z"] + 6.0)
    # MOUNTED, for the same reason Arden's and Celestial Light's are: a halo that turns is a halo that spends
    # part of its cycle edge-on, and Apollo's is the loudest thing in his silhouette.
    figure.part("halo", "head", halo_c, "none")
    # BIG ENOUGH TO BE THE OUTER FRAME, which is the whole of founder item 10: "the large ring/halo must feel
    # structurally intentional". At 12.6 it was smaller than the baroque pauldron volutes that flank the head, so
    # the ring sat INSIDE them and the eye read four curling gold tendrils with something round lost behind --
    # not a halo at all. Rendered offline (Tools/wlvox_render.py) that is unmistakable, and it is invisible to
    # every silhouette-overlap number, because a tangle is still a distinct shape. Out past the volutes it
    # becomes the one clean circle the whole figure sits inside.
    for r, m in ((20.6, "gold"), (19.5, "gold"), (18.5, "solarpale")):
        figure.ring("halo", lambda a, mm=m: mm, halo_c, r, tile * 1.45, tile * 1.0)
    # the band has depth: a second ring offset backward gives the rim a thickness you can see from three-quarter
    for r in (20.1, 19.0):
        figure.ring("halo", lambda a: "golddeep", (halo_c[0] - 1.5, halo_c[1], halo_c[2]), r, tile * 1.1, tile * 1.05)

    # ---- THE SOLAR CROWN. Taller than the head and billowing wider: on the plate the fire is the loudest thing
    # ---- in the silhouette, and a modest tuft was the single biggest reason this skin read as plain.
    crown_z = d["head_z"] + d["head"][2] * 0.5
    figure.part("crown", "head", (0.0, 0.0, crown_z), "twinkle", 0.1)
    # A VOLUME OF FIRE, not a fan: three passes staggered front to back, so from any angle the crown is a bush
    # of tongues as wide as the head, the way the plate's is.
    for fx, tall, wide, tongues in ((1.8, 15.0, 9.6, 11), (-0.4, 18.0, 11.0, 13), (-2.6, 13.0, 9.0, 10)):
        figure.flame("crown", lambda up: "solar" if up < 0.38 else ("solarmid" if up < 0.74 else "solarpale"),
                     (fx, 0.0, crown_z), tall, wide, tongues, tile * 1.2)

    # ---- BAROQUE PAULDRONS. The widest thing on the body, as on the plate: a shoulder cap, two volutes curling up
    # ---- and out, a cherub face set into the cap, and a fringe of gold leaf beneath.
    # OUTSIDE THE HEAD, which is the mistake the first rebuild made. The Relay Dog's head is 9.2 wide and sits
    # straight on the torso, so a pauldron centred at the shoulder line is INSIDE the head's volume and vanishes.
    # On the plate the pauldrons flank the head at head height and the volutes rise beside it like wings, so the
    # cap starts where the head's width ends and everything grows outward and upward from there.
    hw = d["head"][1]
    for side in (-1.0, 1.0):
        base_y = side * (hw * 0.5 + 1.4)
        figure.slab("body", "gold", (0.2, base_y + side * 1.0, shoulder + 1.6), (5.6, 4.8, 4.2), tile=tile)
        figure.slab("body", "golddeep", (0.0, base_y + side * 2.4, shoulder - 0.6), (4.6, 3.4, 1.8), tile=tile)
        # WINGS, not lumps: the render showed the volutes as compact gold knobs beside the head. Larger, with more
        # of a turn, rooted higher, they sweep up past the ears the way the plate's do.
        figure.baroque_scroll("body", mats, (1.0, base_y + side * 2.6, shoulder + 4.2), (side, 1.0), 14.0, tile,
                              coils=1.9, lobes=5)
        figure.baroque_scroll("body", mats, (-1.6, base_y + side * 2.2, shoulder + 3.4), (side, 1.0), 10.5, tile,
                              coils=1.5, lobes=4)
        figure.baroque_scroll("body", mats, (0.4, base_y + side * 3.0, shoulder + 0.6), (side, -0.55), 7.5, tile,
                              coils=1.2, lobes=3)
        figure.cherub_face("body", mats, (2.6, base_y + side * 1.2, shoulder + 2.4), 4.0, tile, face_dir=1.0)
        for leaf in range(4):
            lf = leaf / 3.0
            figure.box("body", "gold", (1.0 - lf * 1.2, base_y + side * (1.0 + lf * 2.4), shoulder - 2.6 - lf * 0.7),
                       (tile * 1.3, tile * 1.5, tile * (2.4 - 0.7 * lf)))
        # THE CELESTIAL FIGURE ON EACH SHOULDER. The plate does not put ornament on Apollo's shoulders -- it puts
        # a small winged BEING there, a face above a pair of gold wings that fan up and back beside the head. One
        # cherub face set flat into the cap read as a coin; with wings behind it and a second face below, the
        # shoulder becomes the figure the reference shows.
        for w, (span, rise, back) in enumerate(((7.2, 5.4, 0.8), (5.8, 3.4, 2.6), (4.4, 1.6, 4.0))):
            for f in range(5):
                ft = f / 4.0
                figure.box("body", "gold" if f % 2 == 0 else "golddeep",
                           (2.0 - back, base_y + side * (2.0 + span * 0.16 * f),
                            shoulder + 3.4 + rise * 0.22 * f - w * 0.5),
                           (tile * 1.1, tile * 1.25, tile * (3.0 - 0.34 * f)))
        figure.cherub_face("body", mats, (2.2, base_y + side * 3.6, shoulder - 1.0), 2.8, tile, face_dir=1.0)

    # ---- THE GORGET, so the neck is not a bare gap between a gold shoulder and a pale head.
    figure.slab("body", "gold", (0.6, 0.0, shoulder + 2.1), (4.0, tw * 0.94, 1.5), tile=tile)

    # ---- NO CAPE (founder, 2026-09-23): "REMOVE THE CAPE from Apollo as well... Do not replace it with
    # ---- another giant attachment. Simplify Apollo significantly."
    #
    # What stood here was SEVEN stacked cloak sheets plus a ground train and two hem rings -- the single
    # heaviest thing on the figure, and exactly the "dog + lots of attached objects" the founder keeps
    # rejecting. Removed outright rather than swapped for a smaller drape: the celestial identity is carried by
    # the halo, the gorget, the gold body armour and the knee and shin plates, which are ON the character
    # rather than hung off it.

    # The node itself stays: the gold belt, the sash and its drops hang off it and sit ON the body. Only the
    # cloth is gone.
    figure.part("robe", "body", (0.0, 0.0, shoulder - 2.0), "trail", 0.5)

    # ---- KNEE AND SHIN ARMOUR, which the plate carries and the robe parts around.
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        shin = "%s_shin" % name
        figure.slab(shin, "gold", (d["torso_z"] * 0.0 + 0.6, side * d["leg_gap"], d["torso_z"] - th * 0.5 - 6.4),
                    (d["leg"][0] * 1.22, d["leg"][1] * 1.28, 2.4), tile=tile)
        figure.box(shin, "solarpale", (d["leg"][0] * 0.72, side * d["leg_gap"], d["torso_z"] - th * 0.5 - 6.4),
                   (tile * 0.6, tile * 1.0, tile * 1.0))

    # ---- LAYERED NECKLACES. The plate hangs several strands at different depths under the gorget.
    for k, (drop, rad) in enumerate(((1.4, tw * 0.52), (2.9, tw * 0.60), (4.3, tw * 0.66))):
        top_z = shoulder + 1.2 - drop
        figure.chain_run("body", "gold", (td * 0.34, -rad, top_z), (td * 0.34, rad, top_z), tile, sag=0.9 + 0.35 * k)
        figure.pendant("body", mats, (td * 0.44, 0.0, top_z - 0.9 - 0.35 * k), tile, drop=1.1 + 0.4 * k, gem="gem")

    # ---- LAYERED GOLD TRIM, which is what the plate has everywhere the eye rests and this had only at the hem.
    # On the reference every cloth edge and every plate edge is ruled in gold, and that ruling is most of why it
    # reads as ceremonial rather than as white cloth with gold objects on it. Cheap in geometry, and it ties the
    # separate gold pieces -- pauldrons, emblem, tassets, boots -- into one costume.
    for side in (-1.0, 1.0):
        # the two front edges of the robe opening, running from the collar to below the knee
        for k in range(11):
            t = k / 10.0
            figure.box("robe", "gold", (td * 0.50 - t * 0.6, side * (tw * 0.30 + t * tw * 0.20),
                                        shoulder - 1.6 - t * 12.5), (tile * 0.5, tile * 0.6, tile * 1.3))
        # a rule along the outer edge of each pauldron cap
        for k in range(6):
            t = k / 5.0
            figure.box("body", "golddeep", (2.4 - t * 3.4, side * (d["head"][1] * 0.5 + 3.6),
                                            shoulder + 3.0 - t * 1.1), (tile * 0.55, tile * 0.55, tile * 0.9))
    # and a collar rule where the gorget meets the drapery
    for k in range(9):
        a = math.pi * (-0.5 + k / 8.0)
        figure.box("body", "golddeep", (td * 0.46 + math.cos(a) * 0.5, math.sin(a) * tw * 0.56, shoulder + 1.3),
                   (tile * 0.5, tile * 0.7, tile * 0.5))

    # ---- GOLD TASSETS OVER THE ROBE. The plate's waist is not cloth: a belt of separate gold skirt plates hangs
    # ---- over the drapery all the way round, each with a raised boss, and the white shows BETWEEN them. Without
    # ---- these the robe reads as one white sheet from the chest down, which is most of why the lower half looked
    # ---- plain -- the reference's whole midsection is gold-on-white, not white.
    figure.slab("robe", "gold", (0.0, 0.0, shoulder - 5.4), (td * 1.12, tw * 1.12, 1.6), tile=tile)
    figure.slab("robe", "golddeep", (0.0, 0.0, shoulder - 6.6), (td * 1.06, tw * 1.06, 0.9), tile=tile)
    for plate in range(8):
        a = math.radians(-118.0 + 236.0 * (plate / 7.0))
        px, py = math.cos(a) * td * 0.86, math.sin(a) * tw * 0.86
        drop = 4.4 if plate in (0, 7) else (6.2 if plate in (3, 4) else 5.4)
        figure.slab("robe", "gold", (px, py, shoulder - 7.4 - drop * 0.5), (1.5, 2.1, drop), tile=tile)
        figure.box("robe", "golddeep", (px + 0.7, py, shoulder - 7.4 - drop * 0.42),
                   (tile * 0.7, tile * 1.1, tile * 1.1))
        # the boss each plate carries on the plate's own render
        figure.box("robe", "solarpale", (px + 1.1, py, shoulder - 7.4 - drop * 0.42),
                   (tile * 0.5, tile * 0.6, tile * 0.6))

    # ---- BRACERS. The reference's forearms are gold to the wrist; bare cream arms under baroque pauldrons were
    # ---- the one place the costume stopped short of the plate.
    for side, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        ax, aw, ah = d["arm"]
        arm_y = side * (tw * 0.5 + aw * 0.5)
        figure.slab("body", "gold", (0.2, arm_y, shoulder - 3.4), (ax * 1.26, aw * 1.30, 2.6), tile=tile)
        figure.slab("body", "golddeep", (0.3, arm_y, shoulder - 5.2), (ax * 1.30, aw * 1.34, 1.2), tile=tile)

    # ---- THE CHEST EMBLEM: a sun boss on a layered gold plate with rays, deeper than the old flat disc.
    # A STEP IN FRONT OF THE CLOTH, or the front panel swallows it -- in the first render there was no emblem.
    plate_x = td * 0.5 + 1.3
    figure.slab("body", "gold", (plate_x, 0.0, shoulder - 2.2), (1.5, 5.4, 5.0), tile=tile)
    figure.slab("body", "golddeep", (plate_x + 0.5, 0.0, shoulder - 2.2), (0.9, 4.0, 3.6), tile=tile)
    figure.star_burst("body", {"gold": "gold", "gem": "solarpale"},
                      (plate_x + 1.1, 0.0, shoulder - 2.2), 4.4, 12, tile, plane="yz", key="gold", core="gem")
    figure.ring("body", lambda a: "golddeep", (plate_x + 1.0, 0.0, shoulder - 2.2), 3.0, tile * 0.8, tile * 0.9)
    figure.slab("body", "gold", (0.0, 0.0, d["torso_z"] - th * 0.46), (td * 1.20, tw * 1.20, 1.8), tile=tile)
    figure.box("body", "solarpale", (td * 0.62, 0.0, d["torso_z"] - th * 0.46), (tile * 1.0, tile * 2.4, tile * 2.0))

    # ---- GOLD BOOTS, plated rather than a painted band.
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        figure.slab(name, "gold", (0.2, side * d["leg_gap"], d["torso_z"] - th * 0.5 - 2.2),
                    (d["leg"][0] * 1.14, d["leg"][1] * 1.22, 3.4), tile=tile)
        figure.slab(name, "golddeep", (0.4, side * d["leg_gap"], d["torso_z"] - th * 0.5 - 4.6),
                    (d["leg"][0] * 1.20, d["leg"][1] * 1.28, 1.5), tile=tile)

    # ---- PURE LIGHT: the two lamp-orbs at the hem, now on proper posts with a collar and a glow ring.
    figure.part("lamps", "body", (0.0, 0.0, shoulder - 4.0), "float", 0.35)
    for side in (-1.0, 1.0):
        figure.orb_on_rod("lamps", {"gold": "gold", "orb": "solarpale", "orbglow": "solarpale"},
                          (td * 0.34, side * 5.2, shoulder - 5.6), (side * 0.35, -1.0), 5.2, 2.2, tile, halo=True)

    # ================================================================== THE SUNBURST
    # FOUNDER (2026-09-23), item 10, on this skin by name: "Apollo should become a genuinely celestial / solar
    # Relay Dog rather than a base dog with a large ring attached. Integrate the solar/celestial forms into the
    # ENTIRE body design. The large ring/halo must feel structurally intentional."
    #
    # AND THE MEASUREMENT AGREED WITH HIM, for a reason worth writing down. Apollo and Arden Infernal came back
    # as the closest pair of DRESSED skins in the set -- 0.533 front, 0.598 side -- because both are the same
    # sentence: a big round thing behind the head, over a wide ragged skirt. Every solar idea Apollo had was in
    # its COLOUR, which is exactly what the founder's silhouette test throws away.
    #
    # So the sun stops being a ring behind the head and becomes the shape of the whole figure: rays radiating
    # from the chest, long and short alternating, reaching past the halo. A ring is an outline; a sunburst is a
    # star, and a star is not something Arden's flaming circle can be mistaken for at any distance.
    # AND THE RAYS CARRY ONTO THE BODY, so the sun is worn rather than parked behind it: a spike standing off
    # the top of each pauldron, and a row of points along the hem of the robe.
    for side in (-1.0, 1.0):
        for k, (out, up, length) in enumerate(((0.2, 1.9, 4.6), (1.7, 1.2, 3.4), (-1.3, 1.4, 3.0))):
            steps = max(2, int(length / tile))
            for s in range(steps):
                t = (s + 0.5) / steps
                figure.box("body", "gold" if t < 0.6 else "solarpale",
                           (0.3 + out * 0.4, side * (tw * 0.5 + 1.4 + out), shoulder + up + t * length),
                           (tile * (1.2 - 0.6 * t), tile * (1.2 - 0.6 * t), tile))
    return figure


#: THE ONE BLUE THIS SKIN IS LIT BY: its eyes, its ghostfire's pale tip, its chest skull and its spine seams.
#: The founder named the eyes/flame colour as authoritative, so it is written once and read everywhere.
SKELETON_SOUL = (0.36, 0.95, 1.00)


def skeleton_flame_v1():
    """SKELETON FLAME -- BONES IGNITE. SIGNAL NEVER DIES.

    Rebuilt against the founder's plate: a bone body, tall blue ghost-fire from both ears, a ribcage carved INTO
    the chest over a dark hollow, skull emblems at brow and sternum, a gold chain charm, blue flame at every hand
    and foot, jointed bone limbs and cyan eyes.
    """
    figure = start("RELAY DOG SKIN -- SKELETON FLAME", 7004, SKELETON_SOUL, 8.0)
    figure.material("ghost", "glow", (0.22, 0.70, 1.00), 0.7)
    figure.material("ghostpale", "glow", (0.72, 0.94, 1.00), 1.2)
    figure.material("void", "lit", (0.030, 0.040, 0.060), 1.0)
    figure.material("ash", "lit", (0.640, 0.610, 0.540), 1.0)
    figure.material("gold", "rim", (0.905, 0.720, 0.290), 1.0)
    # ---- THE SOUL LIGHT, AND IT BEATS.
    #
    # FOUNDER, 2026-09-25: "Use the current eyes/flame colour as the authoritative glow colour. The chest skull
    # must GLOW that exact colour ... NOT permanently emissive. It should have the same living pulse: glow on ->
    # soften/off -> glow on. The skull's EYES must visibly pulse ... a dark/black block visible from the SIDE or
    # BACK must also pulse ... synchronised as one system."
    #
    # THE COLOUR IS THE EYES', taken from the same tuple the eyes are built from at the top of this function --
    # not a new blue chosen to look similar, which is how two blues end up in one skin.
    #
    # "PULSE" IN THE NAME IS THE CONTRACT. AWonderlandCompanionEmbodiment reads it: a material whose name
    # contains "pulse" beats deeply, down to a twelfth and back, and every other glow on the same body rides
    # the SAME clock at a third of the depth. That is what makes the skull, its sockets, the seams, the eyes
    # and the ghostfire one system rather than five timers -- and it is why nothing here had to be told about
    # any other skin. SKELETON_SOUL is the eyes' colour.
    figure.material("soulpulse", "glow", SKELETON_SOUL, 2.2)
    figure.material("soulveilpulse", "glow", SKELETON_SOUL, 0.55)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    td, tw, th = d["torso"]
    hd, hw, hh = d["head"]
    shoulder = d["torso_z"] + th * 0.48
    hip_z = d["torso_z"] - th * 0.5
    mats = {"bone": "bone", "dark": "void", "gold": "gold", "gem": "ghostpale"}

    # ================================================================== THE EAR FIRE
    # Taller than the head, from both ear tips, with a lower fringe running along the crown between them.
    ed, ew, eh = d["ear"]
    ear_top = d["head_z"] + hh * 0.5 + eh * 0.9
    figure.part("earfire", "head", (0.0, 0.0, ear_top), "twinkle", 0.14)
    for side in (-1.0, 1.0):
        y = side * (hw * 0.5 - ew * 0.9)
        figure.flame("earfire", lambda up: "ghost" if up < 0.55 else "ghostpale", (0.0, y, ear_top - 0.6), 13.5, 5.6, 8, tile * 1.15)
        figure.flame("earfire", lambda up: "ghost", (-1.4, y + side * 0.8, ear_top - 1.2), 8.0, 3.6, 5, tile * 1.0)
    figure.flame("earfire", lambda up: "ghost" if up < 0.6 else "ghostpale", (-1.0, 0.0, d["head_z"] + hh * 0.5), 5.0, 6.0, 6, tile * 0.95)

    # ================================================================== THE SKULLS
    # THE SKULLS ARE ORNAMENTS, NOT MARKS. On the plate the brow skull sits between the ears at a size you read
    # before anything else on the face, the sternum skull is the centrepiece of the chest, and there is a skull
    # set into each shoulder. At 2.8 and 3.2 these were dark smudges the eye skipped, so the skin's whole
    # "skeletal armour" idea rested on the ribs alone.
    figure.skull_emblem("head", mats, (hd * 0.5 + 0.6, 0.0, d["head_z"] + 3.0), 4.4, tile, deep="dark")
    # THE CHEST SKULL IS THE ONE THAT BURNS. Its bone is a dim soul-veil and its sockets, nasal notch and teeth
    # are the bright soul light, so between beats it is a dark skull and on the beat it is a lit one -- which is
    # the founder's "glow on -> soften/off -> glow on" rather than a lamp that is always on. The brow skull and
    # the shoulder skulls stay bone and shadow: three burning skulls would be a lantern, not a mascot.
    soul_mats = {"bone": "soulveilpulse", "dark": "soulpulse", "gold": "gold", "gem": "ghostpale"}
    figure.skull_emblem("body", soul_mats, (td * 0.5 + 1.8, 0.0, d["torso_z"] + th * 0.5 - 1.2), 5.0, tile, deep="dark")
    # AND THE SOCKETS AGAIN, A STEP PROUD AND SMALLER, so the eyes read as eyes at arm's length and across a
    # plaza. The founder asked for the skull's eyes to pulse VISIBLY, and a socket flush with the chest reads as
    # a hole whatever colour it is.
    for eye_side in (-1.0, 1.0):
        figure.box("body", "soulpulse",
                   (td * 0.5 + 1.8 + 5.0 * 0.34, eye_side * 5.0 * 0.24, d["torso_z"] + th * 0.5 - 1.2 + 5.0 * 0.22),
                   (tile * 0.7, tile * 1.5, tile * 1.3))
    for side in (-1.0, 1.0):
        figure.skull_emblem("body", mats, (0.9, side * (tw * 0.5 + 1.6), shoulder + 0.9), 2.9, tile, deep="dark")
    # the gold charm on its chain, hanging just below the sternum skull
    chain_z = d["torso_z"] + th * 0.5 - 3.2
    figure.chain_run("body", "gold", (td * 0.5 + 1.0, -2.2, chain_z), (td * 0.5 + 1.0, 2.2, chain_z), tile, sag=1.2, link=tile * 0.8)
    figure.pendant("body", mats, (td * 0.5 + 1.2, 0.0, chain_z - 1.0), tile, drop=1.0, gem="gem")

    # ================================================================== THE RIBCAGE
    # A dark hollow first, then the ribs standing proud over it, so the cage is a cage and not a pattern.
    # FIVE RIBS OVER FOUR UNITS HAD NO GAPS -- the render showed a plain bone chest with a few dark marks.
    # Four ribs over a taller cage leaves a dark line of hollow between each pair, which is what a cage IS.
    # THREE RIBS ON A FLAT CHEST IS A SET OF STRIPES, which is exactly how the founder read it: "a striped Relay
    # Dog with blue flames". A cage reads as a cage from two things -- more ribs than you can take in at a glance,
    # and real darkness BETWEEN them. So: a deeper hollow, five ribs standing further off the chest, and a sternum
    # running down the middle to tie them together into a ribcage rather than a barcode.
    cage_c = (td * 0.5 + 2.3, 0.0, d["torso_z"] - 1.2)
    figure.slab("body", "void", (td * 0.5 + 0.9, 0.0, cage_c[2]), (2.2, tw * 1.12, th * 0.98), tile=tile)
    figure.ribcage("body", mats, cage_c, 2.8, tw * 1.34, th * 0.98, 5, tile)
    # the sternum: a bone column down the centre of the cage, and a clavicle across the top of it
    figure.slab("body", "bone", (td * 0.5 + 2.6, 0.0, cage_c[2]), (1.5, 1.7, th * 0.86), tile=tile)
    figure.slab("body", "bone", (td * 0.5 + 2.2, 0.0, d["torso_z"] + th * 0.46), (1.6, tw * 1.18, 1.5), tile=tile)
    for side in (-1.0, 1.0):
        figure.box("body", "bone", (td * 0.5 + 2.0, side * tw * 0.60, d["torso_z"] + th * 0.40),
                   (tile * 1.3, tile * 1.5, tile * 2.0))
    # and the spine, visible from behind, so the cage has a back
    for s in range(6):
        figure.box("body", "bone", (-td * 0.52, 0.0, d["torso_z"] + th * 0.36 - s * 1.1), (tile * 1.2, tile * 1.6, tile * 0.85))
        # THE SEAM BETWEEN THE VERTEBRAE IS WHERE THE LIGHT GETS OUT. Unlit soul light, so between beats it is
        # as black as the void it replaces and on the beat the spine is a line of fire -- the founder's
        # "dark/black block visible from the SIDE/BACK must also pulse", answered where the back actually is.
        figure.box("body", "soulpulse", (-td * 0.50, 0.0, d["torso_z"] + th * 0.36 - s * 1.1 - 0.55), (tile * 0.9, tile * 1.2, tile * 0.3))

    # ================================================================== BONE PAULDRONS AND JOINTED LIMBS
    # ONE CAP A SIDE (founder, 2026-09-23): "STOP adding pieces... REMOVE unnecessary layered clutter, random
    # armor pieces, EXCESSIVE SHOULDER STACKS." I had stacked three courses with seams here. Back to the single
    # clean pauldron the plate actually shows.
    for side in (-1.0, 1.0):
        figure.slab("body", "bone", (0.2, side * (tw * 0.5 + 0.9), shoulder + 0.5), (3.8, 3.0, 2.6), tile=tile)
        # AND THE DARK BAND UNDER EACH PAULDRON, which is the block you see from the side. Same light, same beat.
        figure.box("body", "soulpulse", (0.2, side * (tw * 0.5 + 0.9), shoulder - 0.2), (tile * 3.6, tile * 2.6, tile * 0.35))

    ad, aw, ah = d["arm"]
    az = d["torso_z"] + 1.0
    for side, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        y = side * (tw * 0.5 + aw * 0.36)
        # the elbow: a dark gap and a rounded bone end either side of it
        figure.box(name, "void", (0.0, y, az + 0.1), (ad * 1.12, aw * 1.12, tile * 0.5))
        figure.box(name, "ash", (0.0, y, az + 0.65), (ad * 1.18, aw * 1.18, tile * 0.6))
        figure.box(name, "ash", (0.0, y, az - 0.45), (ad * 1.18, aw * 1.18, tile * 0.6))
        # the hand burns
        fire = "handfire_%s" % ("l" if side < 0 else "r")
        figure.part(fire, name, (0.0, y, az - ah * 0.5), "twinkle", 0.3 + 0.2 * side)
        figure.flame(fire, lambda up: "ghost" if up < 0.5 else "ghostpale", (0.3, y, az - ah * 0.5 - 0.4), 5.2, 3.0, 5, tile * 0.95)
    ld, lw, lh = d["leg"]
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        y = side * d["leg_gap"]
        knee = hip_z - lh * 0.50
        figure.box(name, "void", (0.0, y, knee + 0.05), (ld * 1.10, lw * 1.10, tile * 0.5))
        figure.box(name, "ash", (0.0, y, knee + 0.6), (ld * 1.16, lw * 1.16, tile * 0.6))
        shin = "%s_shin" % name
        figure.box(shin, "ash", (0.0, y, knee - 0.5), (ld * 1.16, lw * 1.16, tile * 0.6))
        # the foot burns
        fire = "footfire_%s" % ("l" if side < 0 else "r")
        figure.part(fire, shin, (0.0, y, hip_z - lh + 0.4), "twinkle", 0.5 + 0.2 * side)
        figure.flame(fire, lambda up: "ghost" if up < 0.5 else "ghostpale", (0.6, y, hip_z - lh + 0.2), 4.6, 3.2, 5, tile * 0.95)
        figure.flame(fire, lambda up: "ghost", (-0.8, y, hip_z - lh + 0.2), 3.0, 2.4, 3, tile * 0.85)

    # ================================================================== THE FLANK FIRE AND THE HIP ARMOUR
    # WHY THIS EXISTS, MEASURED. Tools/silhouette_check.py compares every skin's outline with the colour thrown
    # away -- the founder's own test: "if removing the colour would make two skins look nearly identical, the
    # silhouette design is not strong enough." Skeleton Flame came back as two bare vertical bars: 0.60 overlap
    # with Celestial Light and 0.56 with an UNDRESSED Relay OG, at medium distance.
    #
    # AND THE REASON WAS NOT A LACK OF DETAIL. It already carried a ribcage, three skulls, a chain and pendant,
    # pauldrons, jointed limbs and fire at every hand and foot -- 1,597 boxes against Relay OG's 762. Every one
    # of them sits INSIDE the body's own width, so none of it survives being looked at from across a room. More
    # cubes was never going to fix that, which is precisely what the founder said: don't solve detail with cubes.
    #
    # The plate answers it directly: ghostfire stands off BOTH FLANKS from the hip to above the shoulder, and
    # the bone armour flares at the hip instead of running straight down into the legs.
    for side in (-1.0, 1.0):
        y = side * (tw * 0.5 + aw + 2.0)
        name = "flankfire_%s" % ("l" if side < 0 else "r")
        figure.part(name, "body", (0.0, y, shoulder - 2.0), "twinkle", 0.38 + 0.24 * side)
        # BILLOWING, NOT LICKING. Rendered offline (Tools/wlvox_render.py) the first pass read as two small
        # flames at the elbows: 5.6 of width is barely wider than the arm it stands beside, so it looked like a
        # detail rather than the ghostfire the plate wraps this animal in. Wider than the body, taller than the
        # head, and a third pass in front so it is a volume rather than a fan.
        figure.flame(name, lambda up: "ghost" if up < 0.62 else "ghostpale",
                     (-0.4, y, hip_z + 0.4), 15.5, 8.6, 12, tile * 1.15)
        figure.flame(name, lambda up: "ghost",
                     (-2.4, y + side * 2.0, hip_z + 2.4), 11.0, 6.0, 8, tile * 1.05)
        figure.flame(name, lambda up: "ghost" if up < 0.5 else "ghostpale",
                     (1.6, y - side * 1.2, hip_z + 1.6), 9.5, 4.6, 6, tile * 1.0)

    # ================================================================== THE BACK PLUME
    # The plate's rear view is a column of blue fire up the spine; from behind this is most of the skin.
    figure.part("backfire", "body", (-td * 0.55, 0.0, shoulder + 0.5), "twinkle", 0.22)
    figure.flame("backfire", lambda up: "ghost" if up < 0.6 else "ghostpale", (-td * 0.6, 0.0, shoulder + 0.2), 10.5, 6.8, 7, tile * 1.1)

    # AND IT TRAILS BACKWARD, which is the only thing the SIDE of this skin has.
    #
    # The flank fire and the hip plates both spread ACROSS the body, so they fixed the front and left the side
    # exactly where it was -- 0.60 against Celestial Light before and after. From the side they simply hide
    # behind the torso. figure.flame only leans its tongues along Y, so depth cannot come from one call however
    # big: it has to be several, stepped back through X. The plate shows the ghostfire streaming off the spine
    # and sinking as it goes, so that is what these are.
    for k, (backset, drop, height, width, tongues) in enumerate((
            (2.6, 0.8, 9.0, 5.4, 6),
            (5.0, 2.4, 7.0, 4.4, 5),
            (7.2, 4.2, 5.2, 3.4, 4),
            (9.1, 6.0, 3.6, 2.6, 3))):
        figure.flame("backfire", (lambda up: "ghost") if k else (lambda up: "ghost" if up < 0.6 else "ghostpale"),
                     (-td * 0.6 - backset, 0.0, shoulder + 0.2 - drop), height, width, tongues, tile * (1.08 - 0.07 * k))
    return figure


# ============================================================================ V2 -- redone from the sheets
#
# FOUNDER, 2026-09-27: "Don't enhance the mascot skins ... completely redo them ... the three ones." And: "Use the
# actual reference images as the visual authority. Do NOT redesign them from memory. Do NOT loosely take
# inspiration. Do NOT merely adjust colors on the existing implementation."
#
# So these three are not the V1 functions with different numbers. Each is written from its sheet, in the order the
# sheet's own callouts name its parts, with every proportion read off the FRONT view in heads (the head is 9.2
# wide, 8.0 tall, and the one thing every sheet shares) and checked against SIDE, REAR and 3/4. The base dog
# underneath is the canonical body and is never touched: a skin is dress over the animation authority.
#
# What each sheet says, measured:
#   ARDEN INFERNAL  halo 2.3 heads across, gem-set, aflame on its upper arc; a robe of stepped strands from the
#                   shoulders to the floor, cream at the centre, crimson then black outward, 2.6 heads wide at the
#                   hem; six gold chains across a bare cream chest with a wheel medallion and ruby drops; the
#                   demonic arm on the figure's RIGHT reaching to the floor with spread claws and a burning sigil;
#                   the other arm cream with a gold cuff; a char tail curling up behind the left hip, aflame.
#   APOLLO          a plain flat gold ring 2.7 heads across enclosing a crown of fire the head's width and 1.3
#                   heads tall; winged cherub pauldrons rising to ear height; a gold sun on the chest; gold
#                   vambraces and hands holding lamp-orbs at the hips; gold tassets over white drapery that
#                   falls to the floor 2.2 heads wide; gold boots.
#   SKELETON FLAME  a BROAD figure, shoulders 1.7 heads across, in stepped bone plates with dark seams; a brow
#                   skull between the ears and small skulls at the temples; a burning skull at the sternum over
#                   a gold chain; ghostfire a head tall from each ear, off the elbows and up the spine; feet as
#                   blocks of pale blue light in a pool of fire.


def cloth_panel(figure, part, mat, centre, size, tile):
    """ONE PANEL OF CLOTH: a slab broken into tiles so it reads as sewn cloth rather than a plastic sheet."""
    figure.slab(part, mat, centre, size, tile=tile)


def studded_ring(figure, part, ring_mat, stud_mat, centre, radius, thickness, tile, studs=18, proud=0.6):
    """A RING WITH A RUNE BAND: the ring itself, and studs standing proud of it every few degrees, so the band
    carries an engraved pattern the way the ARDEN sheet's halo does rather than reading as a plain hoop."""
    figure.ring(part, lambda a: ring_mat, centre, radius, thickness, tile)
    for i in range(studs):
        a = 2.0 * math.pi * i / studs
        figure.box(part, stud_mat if i % 2 == 0 else ring_mat,
                   (centre[0] + proud, centre[1] + math.cos(a) * radius, centre[2] + math.sin(a) * radius),
                   (tile * 0.7, tile * 1.15, tile * 1.15))


def diamond_frame(figure, part, mats, centre, width, height, tile):
    """THE CROWN ORNAMENT ON ARDEN'S HALO: a gold diamond frame with a red gem in it and a point above."""
    cx, cy, cz = centre
    steps = 6
    for k in range(steps):
        f = (k + 0.5) / steps
        # four bars of the rhombus, from the side points to the top and bottom points
        for sy, sz in ((1.0, 1.0), (-1.0, 1.0), (1.0, -1.0), (-1.0, -1.0)):
            y = cy + sy * (width * 0.5) * (1.0 - f)
            z = cz + sz * (height * 0.5) * f
            figure.box(part, mats["gold"], (cx, y, z), (tile * 0.9, tile * 0.75, tile * 0.75))
    figure.box(part, mats["gem"], (cx + 0.4, cy, cz), (tile * 0.9, width * 0.42, height * 0.42))
    figure.box(part, mats["gold"], (cx, cy, cz + height * 0.5 + tile * 0.8), (tile * 0.7, tile * 0.7, tile * 1.6))
    figure.box(part, mats["gold"], (cx, cy, cz - height * 0.5 - tile * 0.4), (tile * 1.4, tile * 2.2, tile * 0.8))


def segmented_limb(figure, part, mats, top, bottom, width, segments, tile, lean=0.0):
    """A SEGMENTED DEMONIC LIMB: dark flesh segments with a glowing seam between each pair, stepping outward as
    it descends, as the DEMONIC ARM inset shows -- not one slab of black."""
    dark, seam = mats
    for k in range(segments):
        f0 = k / segments
        f1 = (k + 1) / segments
        zc = top[2] + (bottom[2] - top[2]) * (f0 + f1) * 0.5
        yc = top[1] + (bottom[1] - top[1]) * (f0 + f1) * 0.5 + lean * (f0 + f1) * 0.5
        xc = top[0] + (bottom[0] - top[0]) * (f0 + f1) * 0.5
        h = abs(bottom[2] - top[2]) / segments
        figure.slab(part, dark, (xc, yc, zc), (width * (1.0 + 0.05 * k), width * (1.0 + 0.05 * k), h * 0.78), tile=tile)
        if k < segments - 1:
            figure.box(part, seam, (xc, yc, zc - h * 0.5), (width * 0.92, width * 0.92, h * 0.16))


def robe_panel(figure, part, material_for, top, width, length, tile, ragged=0.16, flare=1.25, trim=None):
    """A HANGING PANEL OF ROBE, several strands wide, flaring a little as it falls, with an optional gold trim
    along its top edge. The founder's sheets build their robes from these: cream, crimson and black side by
    side, not one cloth."""
    strands = max(3, int(round(width / (tile * 1.35))))
    for k in range(strands):
        t = (k + 0.5) / strands
        rest = (t - 0.5) * width
        drop = length * (0.90 + 0.10 * math.sin(math.pi * t)) * (1.0 - figure.rng.uniform(0.0, ragged))
        steps = max(3, int(round(drop / tile)))
        for st in range(steps):
            down = st / max(steps - 1, 1)
            spread = 1.0 + (flare - 1.0) * down
            figure.box(part, material_for(down, t),
                       (top[0] + math.sin(down * 2.1 + k) * tile * 0.18, top[1] + rest * spread, top[2] - tile * (st + 0.5)),
                       (tile * 1.1, width / strands * spread * 1.02, tile * 1.04))
    if trim is not None:
        for k in range(max(3, int(round(width / tile)))):
            t = (k + 0.5) / max(3, int(round(width / tile)))
            figure.box(part, trim, (top[0] + tile * 0.4, top[1] + (t - 0.5) * width, top[2] + tile * 0.1),
                       (tile * 0.6, tile * 1.02, tile * 0.7))


def feather_fan(figure, part, mats, root, side, rows, tile):
    """ROWS OF GOLD FEATHERS fanning outward and upward from a pauldron, each shorter than the one below, the
    wing-like shoulder architecture of the APOLLO sheet."""
    for r in range(rows):
        f = r / max(rows - 1, 1)
        length = 6.6 - 3.4 * f
        rise = 0.35 + 0.30 * f
        steps = max(3, int(round(length / (tile * 1.05))))
        for st in range(steps):
            u = (st + 0.5) / steps
            figure.box(part, mats["gold"] if (st + r) % 2 == 0 else mats["golddeep"],
                       (root[0] - r * 0.55, root[1] + side * (0.6 + u * length), root[2] + r * 1.05 + u * length * rise),
                       (tile * 1.15, tile * 1.15, tile * (1.9 - 0.9 * u)))


def arden_infernal():
    """ARDEN INFERNAL V2 -- SCION OF FLAME. BOUND BY DESTINY. Built from the sheet's component inventory
    (WorldDesign/SKIN_REBUILD_INVENTORY_2026_09_27.md), row by row: halo, tunic, mantle, chains, demonic arm,
    cuff, robe, tail. The base dog underneath is never touched."""
    figure = start("RELAY DOG SKIN -- ARDEN INFERNAL V2", 7202, (1.00, 0.58, 0.10), 7.5)
    figure.material("gold", "rim", (0.905, 0.720, 0.290), 1.0)
    figure.material("golddeep", "lit", (0.500, 0.360, 0.110), 1.0)
    figure.material("cream", "lit", (0.960, 0.930, 0.860), 1.0)
    figure.material("ember", "glow", (1.00, 0.34, 0.05), 0.6)
    figure.material("emberpale", "glow", (1.00, 0.72, 0.22), 1.0)
    figure.material("crimson", "lit", (0.520, 0.075, 0.065), 1.0)
    figure.material("char", "lit", (0.215, 0.115, 0.105), 1.0)
    figure.material("demon", "lit", (0.360, 0.060, 0.060), 1.0)
    figure.material("ruby", "glow", (1.00, 0.09, 0.12), 1.2)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    td, tw, th = d["torso"]
    hd, hw, hh = d["head"]
    ad, aw, ah = d["arm"]
    shoulder = d["torso_z"] + th * 0.48
    torso_top = d["torso_z"] + th * 0.5
    hip = d["torso_z"] - th * 0.5
    head_top = d["head_z"] + hh * 0.5
    mats = {"gold": "gold", "golddeep": "golddeep", "gem": "ruby", "dark": "char"}
    S = 1.0                       # the demonic side: the figure's right, the viewer's left, as on the sheet

    # ================================================================== 2-6. THE HALO
    R = hw * 1.20
    hc = (-hd * 0.44, 0.0, head_top + 1.3)
    figure.part("halo", "head", hc, "none")
    figure.ring("halo", lambda a: "gold", hc, R, tile * 1.6, tile * 1.05)
    figure.ring("halo", lambda a: "gold", hc, R - 1.1, tile * 1.6, tile * 1.05)
    studded_ring(figure, "halo", "golddeep", "gold", (hc[0] + 0.7, 0.0, hc[2]), R - 0.55, tile * 0.9, tile, studs=22, proud=0.5)
    diamond_frame(figure, "halo", mats, (hc[0] + 0.5, 0.0, hc[2] + R + 1.7), 2.8, 3.8, tile)
    for side in (-1.0, 1.0):
        gy = side * (R - 0.5)
        figure.box("halo", "gold", (hc[0] + 0.7, gy, hc[2]), (tile * 1.8, tile * 2.4, tile * 2.6))
        figure.box("halo", "ruby", (hc[0] + 1.7, gy, hc[2]), (tile * 1.0, tile * 1.3, tile * 1.7))
        for dz in (1.6, -1.6):
            figure.box("halo", "ruby", (hc[0] + 1.6, gy, hc[2] + dz), (tile * 0.8, tile * 0.9, tile * 0.9))
    figure.box("halo", "gold", (hc[0] + 0.6, 0.0, hc[2] - R + 0.4), (tile * 1.6, tile * 2.2, tile * 1.6))
    figure.box("halo", "ruby", (hc[0] + 1.5, 0.0, hc[2] - R + 0.4), (tile * 0.9, tile * 1.1, tile * 1.1))
    figure.part("halofire", "halo", hc, "twinkle", 0.18)
    # THE FIRE SUPPORTS THE RING RATHER THAN HIDING THE HEAD (founder: "Fire should support the design rather
    # than hide it"). Nineteen tongues up to 7.4 tall photographed as a dense orange mass over the whole head by
    # day and a yellow blaze at night; thirteen shorter ones, two tongues each, read as a ring on fire.
    for i in range(13):
        f = i / 12.0
        a = math.radians(-18.0 + 216.0 * f)
        tall = 1.5 + 3.6 * max(0.0, math.sin(a)) ** 1.5
        figure.flame("halofire", lambda up: "ember" if up < 0.5 else "emberpale",
                     (hc[0] + 0.3, math.cos(a) * (R + 0.8), hc[2] + math.sin(a) * (R + 0.8)), tall, 1.8, 2, tile * 0.95)
    for i in range(7):
        a = math.radians(205.0 + 130.0 * i / 6.0)
        figure.flame("halofire", lambda up: "ember", (hc[0] + 0.2, math.cos(a) * (R + 0.7), hc[2] + math.sin(a) * (R + 0.7)), 1.5, 1.2, 2, tile * 0.8)

    # ================================================================== 7-8. THE TUNIC, COLLAR AND WAIST
    tz = d["torso_z"] + 0.1
    cloth_panel(figure, "body", "cream", (-td * 0.5 - 0.7, 0.0, tz), (1.2, tw * 1.14, th * 0.94), tile)             # back
    for side in (-1.0, 1.0):
        cloth_panel(figure, "body", "cream", (0.0, side * (tw * 0.5 + 0.65), tz), (td * 1.1, 1.2, th * 0.90), tile)   # sides
        cloth_panel(figure, "body", "cream", (td * 0.5 + 0.7, side * 1.75, tz), (1.2, 2.0, th * 0.92), tile)          # front, either side of the V
    cloth_panel(figure, "body", "crimson", (td * 0.5 + 0.25, 0.0, tz - 0.4), (0.9, 2.3, th * 0.84), tile)               # the V's red inside
    cloth_panel(figure, "body", "crimson", (0.0, 0.0, hip + 0.35), (td * 1.32, tw * 1.30, 1.2), tile)                   # the red hem
    figure.slab("body", "gold", (0.3, 0.0, torso_top + 0.35), (td * 1.28, tw * 1.24, 1.1), tile=tile)                  # collar
    for k in range(8):
        a = math.pi * (-0.5 + k / 7.0)
        figure.box("body", "golddeep", (td * 0.64 + math.cos(a) * 0.4, math.sin(a) * tw * 0.64, torso_top + 0.35), (tile * 0.5, tile * 0.6, tile * 0.6))
    figure.slab("body", "gold", (0.0, 0.0, hip + 0.9), (td * 1.38, tw * 1.36, 1.3), tile=tile)                         # waist band
    for k in range(6):
        a = math.pi * (-0.42 + 0.84 * k / 5.0)
        figure.box("body", "golddeep", (td * 0.70 + math.cos(a) * 0.3, math.sin(a) * tw * 0.70, hip + 0.9), (tile * 0.5, tile * 0.7, tile * 0.8))
    figure.box("body", "ruby", (td * 0.72 + 0.4, 0.0, hip + 0.9), (tile * 0.7, tile * 1.2, tile * 1.0))

    # ================================================================== 9. THE SHOULDER MANTLE, cream side
    my = -S * (tw * 0.5 + 0.55 + aw * 0.5)
    figure.slab("body", "cream", (0.2, my + (-S) * 0.4, shoulder + 0.9), (ad * 2.9, aw * 1.9, 1.5), tile=tile)     # over the shoulder
    figure.slab("arm_l", "cream", (0.2, my + (-S) * 1.25, shoulder - 2.2), (ad * 2.7, 1.2, 5.6), tile=tile)          # the panel down the outer arm
    figure.slab("arm_l", "crimson", (0.0, my + (-S) * 0.55, shoulder - 2.8), (ad * 2.3, 0.8, 5.0), tile=tile)       # its red underlayer
    figure.drape("arm_l_fore", lambda f: "crimson" if f > 0.55 else "cream",
                 (0.3, my + (-S) * 1.2, shoulder - 5.0), 3.8, 6.8, 0, tile, ragged=0.20)
    for k in range(5):
        figure.box("arm_l", "gold", (ad * 1.55, my + (-S) * 1.25, shoulder + 0.2 - k * 1.2), (tile * 0.6, tile * 0.7, tile * 1.02))

    # ================================================================== 10-12. SACRED ORNAMENTS
    cx = td * 0.5 + 1.9
    for k, (sag, drop, out) in enumerate(((1.2, 0.3, 0.0), (1.9, -0.2, 0.55), (2.7, -0.7, 0.15),
                                          (3.6, -1.3, 0.75), (4.4, -1.9, 0.35), (5.3, -2.6, 0.9))):
        span_y = tw * 0.5 + 0.9 - 0.08 * k
        figure.chain_run("body", "gold", (cx + out, -span_y, torso_top + drop), (cx + out, span_y, torso_top + drop), tile, sag=sag)
        if k % 2 == 1:
            figure.pendant("body", mats, (cx + out + 0.5, (k - 3) * 1.1, torso_top + drop - sag + 0.2), tile, drop=1.0 + 0.3 * k)
    figure.pendant("body", mats, (cx + 0.6, 0.0, torso_top - 0.4), tile, drop=0.8)
    med = (cx + 1.1, 0.0, d["torso_z"] - 0.6)
    figure.spoked_wheel("body", "gold", med, 2.9, 8, tile)
    figure.ring("body", lambda a: "golddeep", med, 2.9, tile * 0.7, tile * 0.9)
    figure.box("body", "ruby", (med[0] + 0.6, 0.0, med[2]), (tile * 0.9, tile * 1.7, tile * 1.7))
    sun = (cx + 0.9, 0.0, d["torso_z"] + 2.9)
    figure.spoked_wheel("body", "gold", sun, 1.5, 6, tile)
    figure.box("body", "ruby", (sun[0] + 0.5, 0.0, sun[2]), (tile * 0.7, tile * 1.0, tile * 1.0))
    for side in (-1.0, 1.0):
        figure.spoked_wheel("body", "gold", (td * 0.30, side * (tw * 0.5 + 1.1), shoulder + 0.7), 1.3, 6, tile)

    # ================================================================== 13-16. THE DEMONIC ARM
    ARM = "arm_r"
    ay = S * (tw * 0.5 + 0.55 + aw * 0.5)
    az = d["torso_z"] + th * 0.34
    figure.slab(ARM, "char", (0.3, ay + S * 1.6, az + 2.4), (6.4, 7.0, 3.8), tile=tile)                            # the spiked shoulder
    figure.slab(ARM, "demon", (0.1, ay + S * 2.2, az + 0.6), (5.6, 6.2, 1.6), tile=tile)
    for k in range(6):
        figure.box(ARM, "char", (1.5 - k * 0.8, ay + S * (3.6 + k * 0.2), az + 4.0 + k * 0.3), (tile * 1.1, tile * 1.4, tile * (3.4 - 0.4 * k)))
    segmented_limb(figure, ARM, ("demon", "ember"), (0.0, ay + S * 2.6, az - 0.2), (0.4, ay + S * 3.6, az - 6.6), 4.8, 3, tile)
    figure.slab(ARM, "char", (0.9, ay + S * 3.9, az - 7.2), (4.6, 5.0, 1.6), tile=tile)                              # elbow knot
    segmented_limb(figure, ARM + "_fore", ("demon", "ember"), (0.6, ay + S * 4.2, az - 7.9), (1.4, ay + S * 5.6, az - 13.6), 5.4, 3, tile)
    for k in range(5):
        figure.box(ARM + "_fore", "char", (4.0, ay + S * 4.9 + (k - 2) * 1.3, az - 10.6), (tile * 0.7, tile * 0.8, tile * 5.0))
    for k in range(4):
        figure.box(ARM + "_fore", "char", (0.5, ay + S * 8.0, az - 8.4 - k * 1.7), (tile * 0.9, tile * 2.0, tile * 1.0))
    figure.claw_hand(ARM + "_fore", ("char", "ember"), (1.6, ay + S * 5.8, az - 13.8), 9.4, tile, S)
    figure.claw_hand(ARM + "_fore", ("demon", "ember"), (0.6, ay + S * 7.0, az - 13.2), 7.2, tile, S)
    sig = (5.4, ay + S * 5.4, az - 11.2)
    figure.part("sigil", ARM + "_fore", sig, "orbit", -7.0)
    figure.ring("sigil", lambda a: "golddeep", (sig[0] - 0.4, sig[1], sig[2]), 4.3, tile * 0.7, tile * 0.95)
    figure.ring("sigil", lambda a: "ember", sig, 3.9, tile * 0.6, tile * 0.85)
    figure.spoked_wheel("sigil", "ruby", (sig[0] + 0.3, sig[1], sig[2]), 3.2, 8, tile)
    figure.box("sigil", "emberpale", (sig[0] + 0.7, sig[1], sig[2]), (tile * 0.9, tile * 1.7, tile * 1.7))
    for k in range(8):
        a = 2.0 * math.pi * k / 8.0 + math.pi / 8.0
        figure.box("sigil", "ruby", (sig[0] + 0.2, sig[1] + math.cos(a) * 4.3, sig[2] + math.sin(a) * 4.3), (tile * 0.8, tile * 0.8, tile * 0.8))
    figure.part("armfire", ARM, (0.0, ay + S * 1.8, az + 3.6), "twinkle", 0.4)
    figure.flame("armfire", lambda up: "ember" if up < 0.55 else "emberpale", (0.0, ay + S * 2.4, az + 4.0), 7.5, 4.6, 7, tile * 1.0)
    figure.flame("armfire", lambda up: "ember" if up < 0.55 else "emberpale", (0.6, ay + S * 5.0, az - 2.0), 4.6, 3.0, 4, tile * 0.95)
    figure.flame("armfire", lambda up: "ember" if up < 0.55 else "emberpale", (1.0, ay + S * 7.4, az - 9.0), 4.0, 2.6, 4, tile * 0.9)

    # ================================================================== 17. THE CUFF on the cream wrist
    wrist = az - ah * 0.86
    figure.slab("arm_l_fore", "gold", (0.0, my, wrist + 0.4), (ad * 1.32, aw * 1.32, 1.5), tile=tile)
    figure.box("arm_l_fore", "ruby", (ad * 0.72, my, wrist + 0.4), (tile * 0.6, tile * 1.0, tile * 1.0))

    # ================================================================== 18-19. THE ROBE
    def robe_cloth(down, across):
        edge = abs(across - 0.5) * 2.0
        if edge > 0.80:
            return "char"
        if edge > 0.46 or down > 0.86:
            return "crimson"
        return "cream"
    figure.part("robe", "body", (0.0, 0.0, hip + 0.4), "trail", 0.5)
    figure.cloak("robe", robe_cloth, (-td * 0.5 - 0.6, 0.0, shoulder + 0.4), hw * 1.10, shoulder + 0.2, tile, flare=2.4, back=-2.8, ragged=0.14)
    figure.cloak("robe", lambda dn, ac: "char" if abs(ac - 0.5) > 0.32 else "crimson",
                 (-td * 0.5 - 1.8, 0.0, shoulder - 0.4), hw * 1.30, shoulder - 0.6, tile, flare=2.7, back=-2.2, ragged=0.20)
    robe_panel(figure, "robe", lambda dn, t: "crimson" if abs(t - 0.5) < 0.16 else "cream", (td * 0.5 + 0.9, 0.0, hip + 0.2), tw * 0.96, hip + 0.1, tile, trim="gold")
    for side in (-1.0, 1.0):
        robe_panel(figure, "robe", lambda dn, t: "crimson", (td * 0.5 + 0.4, side * (tw * 0.5 + 1.2), hip + 0.15), 3.2, hip, tile, flare=1.35, trim="gold")
        robe_panel(figure, "robe", lambda dn, t: "char" if dn > 0.3 else "crimson", (td * 0.1, side * (tw * 0.5 + 3.4), hip + 0.1), 3.0, hip - 0.4, tile, flare=1.5)
        robe_panel(figure, "robe", lambda dn, t: "cream" if dn < 0.7 else "crimson", (-td * 0.3, side * (tw * 0.5 + 2.2), hip + 0.15), 2.6, hip - 0.2, tile, flare=1.4)

    # ================================================================== 20-21. THE INFERNAL TAIL
    root = (-td * 0.5 - 0.4, -S * (tw * 0.5 + 1.6), hip + 0.6)   # outboard of the hip, so it rises beside the body as the sheet has it
    figure.part("tail", "body", root, "tail", 7.0, 10.0)
    for k in range(22):
        t = k / 21.0
        a = t * math.pi * 1.15
        p = (root[0] - 7.4 * math.sin(a) - 1.2 * t, root[1] - S * 3.4 * t, root[2] + 10.2 * (1.0 - math.cos(a)))
        size = tile * (2.3 - 1.2 * t)
        figure.box("tail", "char" if k % 3 else "demon", p, (size, size, size))
        if k % 3 == 2 and k < 20:
            figure.box("tail", "ember", (p[0] + 0.1, p[1], p[2] + size * 0.55), (size * 0.8, size * 0.8, tile * 0.3))
    tip = (root[0] - 8.6, root[1] - S * 3.4, root[2] + 20.2)
    figure.part("tailfire", "tail", tip, "twinkle", 0.5)
    figure.flame("tailfire", lambda up: "ember" if up < 0.5 else "emberpale", tip, 6.0, 3.0, 4, tile * 0.95)
    figure.flame("tailfire", lambda up: "ember", (root[0] - 6.4, root[1] - S * 2.0, root[2] + 13.0), 3.2, 2.0, 3, tile * 0.85)
    figure.flame("tailfire", lambda up: "ember", (root[0] - 3.2, root[1] - S * 1.0, root[2] + 5.4), 2.6, 1.8, 2, tile * 0.8)
    return figure


def eh_of(d):
    return d["ear"][2]


def apollo():
    """APOLLO V2 -- GOD OF THE SUN. LIGHT. HARMONY. PERFECTION. Built from the sheet's component inventory
    (WorldDesign/SKIN_REBUILD_INVENTORY_2026_09_27.md): crown, ring, pauldrons with cherubs, scrolls and
    feathers, gorget, sash, sun, chains, belt and tassets, vambraces, lamps, drapery, greaves."""
    figure = start("RELAY DOG SKIN -- APOLLO V2", 7203, (1.00, 0.86, 0.26), 7.5)
    figure.material("gold", "rim", (0.915, 0.735, 0.300), 1.0)
    figure.material("golddeep", "lit", (0.520, 0.375, 0.115), 1.0)
    figure.material("linen", "rim", (0.968, 0.958, 0.930), 1.0)
    figure.material("linenshade", "lit", (0.760, 0.740, 0.700), 1.0)
    figure.material("dark", "lit", (0.055, 0.050, 0.045), 1.0)
    figure.material("solar", "glow", (1.00, 0.36, 0.03), 0.7)
    figure.material("solarmid", "glow", (1.00, 0.56, 0.06), 0.9)
    figure.material("solarpale", "glow", (1.00, 0.78, 0.16), 1.2)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    td, tw, th = d["torso"]
    hd, hw, hh = d["head"]
    ad, aw, ah = d["arm"]
    ld, lw, lh = d["leg"]
    shoulder = d["torso_z"] + th * 0.48
    torso_top = d["torso_z"] + th * 0.5
    hip = d["torso_z"] - th * 0.5
    head_top = d["head_z"] + hh * 0.5
    mats = {"gold": "gold", "golddeep": "golddeep", "dark": "dark", "gem": "solarpale"}

    # ================================================================== 2. THE SOLAR CROWN
    figure.part("crown", "head", (0.0, 0.0, head_top), "twinkle", 0.1)
    for fx, tall, wide, tongues in ((1.6, hh * 1.1, hw * 0.95, 10), (-0.5, hh * 1.3, hw * 1.05, 12), (-2.6, hh * 0.95, hw * 0.85, 9)):
        figure.flame("crown", lambda up: "solar" if up < 0.38 else ("solarmid" if up < 0.74 else "solarpale"),
                     (fx, 0.0, head_top - 0.4), tall, wide, tongues, tile * 1.15)

    # ================================================================== 3. THE RING
    R = hw * 1.42
    hc = (-hd * 0.5, 0.0, head_top + hh * 0.6)
    figure.part("halo", "head", hc, "none")
    figure.ring("halo", lambda a: "gold", hc, R, tile * 1.8, tile * 1.05)
    figure.ring("halo", lambda a: "gold", hc, R - 1.05, tile * 1.8, tile * 1.05)
    figure.ring("halo", lambda a: "golddeep", (hc[0] - 1.3, 0.0, hc[2]), R - 0.5, tile * 1.0, tile * 1.05)

    # ================================================================== 4-8. THE PAULDRONS
    #
    # ON THEIR OWN PART, AND THE WARDROBE IS WHY. These were parented to "body", and the wardrobe's framing
    # box is the union of the parts named body, head, arm_ and leg_ -- the founder's rule that framing
    # "MUST derive from the physical BODY", excluding ornament. Scrolls, cherub faces and a six-feather fan
    # reaching a hand's width past each shoulder are ornament by any reading, and filed under body they made
    # Apollo's framing box WIDER THAN IT IS TALL -- 47.2 against 33.0, where every other skin measures 51.7
    # tall. Width then pushed the camera back and Apollo photographed at 64% of frame height against the
    # founder's 76-94 band (zc_wardrobe_20, V03), the only skin whose solve predicted its own failure.
    #
    # Nothing about the figure changes: same geometry, same place, same materials, parented to the body so it
    # moves with the shoulders exactly as before. Only the framing box stops counting it, which is what the
    # rule asked for in the first place.
    figure.part("pauldrons", "body", (0.0, 0.0, shoulder), "none")
    for side in (-1.0, 1.0):
        by = side * (hw * 0.5 + 1.2)
        figure.slab("pauldrons", "gold", (0.2, by + side * 1.0, shoulder + 1.7), (5.8, 5.0, 3.2), tile=tile)
        figure.slab("pauldrons", "golddeep", (0.0, by + side * 2.4, shoulder - 0.5), (4.8, 3.6, 1.8), tile=tile)
        figure.cherub_face("pauldrons", mats, (2.8, by + side * 1.2, shoulder + 2.5), 4.0, tile, face_dir=1.0)
        figure.cherub_face("pauldrons", mats, (2.3, by + side * 3.7, shoulder - 1.0), 2.8, tile, face_dir=1.0)
        figure.baroque_scroll("pauldrons", mats, (1.0, by + side * 2.6, shoulder + 4.3), (side, 1.0), hh * 1.15, tile, coils=1.9, lobes=5)
        figure.baroque_scroll("pauldrons", mats, (-1.6, by + side * 2.2, shoulder + 3.5), (side, 1.0), hh * 0.9, tile, coils=1.5, lobes=4)
        figure.baroque_scroll("pauldrons", mats, (0.4, by + side * 3.0, shoulder + 0.7), (side, -0.55), hh * 0.7, tile, coils=1.2, lobes=3)
        feather_fan(figure, "pauldrons", mats, (-0.2, by + side * 2.2, shoulder + 2.6), side, 6, tile)
        for k in range(3):
            figure.slab("pauldrons", "gold", (0.2, by + side * 0.5, shoulder - 2.2 - k * 1.6), (2.9, 3.3, 1.25), tile=tile)
            figure.box("pauldrons", "golddeep", (0.2, by + side * 0.5, shoulder - 2.95 - k * 1.6), (2.7, 3.1, tile * 0.3))

    # ================================================================== 9-10. GORGET AND SASH
    figure.slab("body", "gold", (0.6, 0.0, torso_top + 0.5), (4.2, tw * 1.02, 1.5), tile=tile)
    figure.box("body", "golddeep", (td * 0.5 + 0.9, 0.0, torso_top + 0.5), (tile * 0.5, tw * 0.9, tile * 0.5))
    for side in (-1.0, 1.0):
        steps = 9
        for k in range(steps):
            t = k / (steps - 1.0)
            figure.box("body", "linen", (td * 0.5 + 0.9, side * (2.5 - 4.2 * t), torso_top - 0.3 - 6.2 * t), (tile * 0.9, tile * 1.5, tile * 1.5))
            figure.box("body", "linenshade", (td * 0.5 + 0.55, side * (2.5 - 4.2 * t) + side * 0.9, torso_top - 0.3 - 6.2 * t), (tile * 0.6, tile * 0.9, tile * 1.5))

    # ================================================================== 11-12. THE SUN AND THE CHAINS
    px = td * 0.5 + 1.5
    ez = d["torso_z"] + 1.4
    figure.slab("body", "gold", (px, 0.0, ez), (1.5, 5.8, 5.4), tile=tile)
    figure.slab("body", "golddeep", (px + 0.5, 0.0, ez), (0.9, 4.2, 3.8), tile=tile)
    figure.star_burst("body", {"gold": "gold", "gem": "solarpale"}, (px + 1.1, 0.0, ez), 4.8, 12, tile, plane="yz", key="gold", core="gem")
    figure.ring("body", lambda a: "golddeep", (px + 1.0, 0.0, ez), 3.2, tile * 0.8, tile * 0.9)
    figure.box("body", "solarpale", (px + 1.6, 0.0, ez), (tile * 0.8, tile * 1.8, tile * 1.8))
    for k, (drop, rad) in enumerate(((3.6, tw * 0.56), (4.9, tw * 0.62), (6.1, tw * 0.66))):
        figure.chain_run("body", "gold", (td * 0.5 + 0.8, -rad, ez - drop), (td * 0.5 + 0.8, rad, ez - drop), tile, sag=0.8 + 0.3 * k)
        figure.pendant("body", mats, (td * 0.5 + 1.1, 0.0, ez - drop - 0.7 - 0.3 * k), tile, drop=0.9 + 0.3 * k, gem="gem")

    # ================================================================== 13. BELT AND TASSETS
    figure.slab("body", "gold", (0.0, 0.0, hip + 0.9), (td * 1.36, tw * 1.32, 1.5), tile=tile)
    figure.slab("body", "golddeep", (0.0, 0.0, hip - 0.1), (td * 1.28, tw * 1.24, 0.8), tile=tile)
    figure.part("robe", "body", (0.0, 0.0, hip + 0.4), "trail", 0.5)
    for plate in range(8):
        a = math.radians(-118.0 + 236.0 * (plate / 7.0))
        pxx, pyy = math.cos(a) * td * 0.92, math.sin(a) * tw * 0.92
        drop = 4.4 if plate in (0, 7) else (6.4 if plate in (3, 4) else 5.5)
        figure.slab("robe", "gold", (pxx, pyy, hip - 0.4 - drop * 0.5), (1.5, 2.1, drop), tile=tile)
        figure.box("robe", "golddeep", (pxx + 0.75, pyy, hip - 0.4 - drop * 0.35), (tile * 0.6, tile * 1.2, tile * 1.2))
        figure.box("robe", "solarpale", (pxx + 1.1, pyy, hip - 0.4 - drop * 0.35), (tile * 0.5, tile * 0.7, tile * 0.7))

    # ================================================================== 14-15. VAMBRACES, HANDS, LAMPS
    wrist = d["torso_z"] + th * 0.34 - ah * 0.86
    for side, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        arm_y = side * (tw * 0.5 + 0.55 + aw * 0.5)
        fore = "%s_fore" % name
        figure.slab(fore, "gold", (0.2, arm_y, wrist + 2.6), (ad * 1.30, aw * 1.34, 3.2), tile=tile)
        figure.slab(fore, "golddeep", (0.3, arm_y, wrist + 0.7), (ad * 1.36, aw * 1.40, 0.8), tile=tile)
        figure.slab(fore, "gold", (0.1, arm_y, wrist - 0.9), (ad * 1.14, aw * 1.16, 1.5), tile=tile)
        figure.box(fore, "solarpale", (ad * 0.72, arm_y, wrist + 2.6), (tile * 0.5, tile * 0.9, tile * 0.9))
    figure.part("lamps", "body", (0.0, 0.0, hip + 2.0), "float", 0.35)
    for side in (-1.0, 1.0):
        figure.orb_on_rod("lamps", {"gold": "gold", "orb": "solarpale", "orbglow": "solarpale"},
                          (td * 0.4, side * (tw * 0.5 + aw + 2.4), hip + 1.2), (side * 0.25, -1.0), 5.2, 2.2, tile, halo=True)

    # ================================================================== 16-17. THE DIVINE DRAPERY
    figure.cloak("robe", lambda dn, ac: "linenshade" if abs(ac - 0.5) > 0.42 or dn > 0.90 else "linen",
                 (-td * 0.5 - 0.5, 0.0, shoulder + 0.6), hw * 1.05, shoulder + 0.4, tile, flare=2.3, back=-2.6, ragged=0.12)
    figure.cloak("robe", lambda dn, ac: "linenshade" if abs(ac - 0.5) > 0.36 else "linen",
                 (-td * 0.5 - 1.6, 0.0, shoulder), hw * 1.22, shoulder - 0.2, tile, flare=2.6, back=-2.1, ragged=0.16)
    robe_panel(figure, "robe", lambda dn, t: "linenshade" if dn > 0.9 else "linen", (td * 0.5 + 0.7, 0.0, hip - 0.2), tw * 0.9, hip - 0.4, tile, trim="golddeep")
    for side in (-1.0, 1.0):
        robe_panel(figure, "robe", lambda dn, t: "linen" if abs(t - 0.5) < 0.36 else "linenshade", (td * 0.5 + 0.3, side * (tw * 0.5 + 1.3), hip - 0.1), 3.4, hip - 0.3, tile, flare=1.35, trim="golddeep")
        robe_panel(figure, "robe", lambda dn, t: "linenshade" if dn > 0.4 else "linen", (td * 0.05, side * (tw * 0.5 + 3.6), hip - 0.2), 2.8, hip - 0.6, tile, flare=1.5)
        for k in range(6):
            figure.box("robe", "golddeep", (td * 0.5 + 1.1, side * (tw * 0.5 + 2.9), hip - 1.0 - k * 1.4), (tile * 0.5, tile * 0.6, tile * 1.0))

    # ================================================================== 18. GREAVES AND BOOTS
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        shin = "%s_shin" % name
        y = side * d["leg_gap"]
        figure.slab(shin, "gold", (0.3, y, hip - lh * 0.66), (ld * 1.30, lw * 1.36, 2.6), tile=tile)
        figure.box(shin, "solarpale", (ld * 0.78, y, hip - lh * 0.56), (tile * 0.6, tile * 1.0, tile * 1.0))
        figure.slab(shin, "gold", (0.2, y, hip - lh * 0.86), (ld * 1.20, lw * 1.26, 1.6), tile=tile)
        figure.slab(shin, "golddeep", (0.4, y, hip - lh + 0.55), (ld * 1.42, lw * 1.30, 0.9), tile=tile)
    return figure


def skeleton_flame():
    """SKELETON FLAME V2 -- BONES IGNITE. SIGNAL NEVER DIES. Written from the sheet."""
    figure = start("RELAY DOG SKIN -- SKELETON FLAME V2", 7204, SKELETON_SOUL, 8.0)
    # THE SPECTRAL FIRE FOLLOWS THE FLAME COLOUR (founder, 2026-10-01: "Skeleton Flame: Flame Color controls supernatural
    # flames; skull/body are not recolored by it; skull stays black/non-emissive; eyes remain glow treatment"). ghost and
    # its pale core are the fire -- the ear, paw, foot, hip and back flames and their spectral trims. The skull (bone and
    # void), the soul glows (soulpulse, soulveilpulse, voidglow) and the chest skull's eyes (soulgaze) carry no tag.
    figure.material("ghost", "glow", (0.22, 0.70, 1.00), 0.7, channel="flame")
    figure.material("ghostpale", "glow", (0.72, 0.94, 1.00), 1.2, channel="flame_light")
    figure.material("void", "lit", (0.030, 0.040, 0.060), 1.0)
    figure.material("ash", "lit", (0.640, 0.610, 0.540), 1.0)
    # FOUNDER, SKELETON FLAME: "The OTHER BLACK SECTIONS OF THE BODY are supposed to participate in the
    # glowing treatment. In particular, the BLACK PARTS ON THE LEGS need to visibly GLOW. Preserve their
    # black identity while giving them the intended luminous/glowing behavior."
    #
    # THAT IS ONE MATERIAL, NOT A RECOLOUR. `void` is the near-black the skeletal seams are made of and it
    # is LIT, so it receives light and emits none -- black in daylight and black at night, which is half of
    # what the founder describes. This is the same near-black as a GLOW at a low strength: it keeps its
    # identity in daylight, where a twentieth of white against a sunlit bone plate still reads black, and
    # carries a visible inner light once the world goes dark.
    #
    # KEPT FAR DARKER THAN THE SPECTRAL BLUES ON PURPOSE. ghost is (0.22, 0.70, 1.00) and ghostpale
    # (0.72, 0.94, 1.00); those are the skin's spectral sections and the founder's instruction is that they
    # stay distinct. A black part that glows must not become a third blue part, so this is barely cool and a
    # fraction of their strength.
    # STRENGTH RAISED FROM 0.55 AFTER MEASURING. Glow output in this project is Colour x Strength x the scene
    # unit, which is pinned at 1000, so 0.55 with a blue of 0.105 emitted about 58 against ghost's 700 -- eight
    # per cent of the spectral blue, and the leg band is five-sixths LIT BONE which at night is brighter than
    # that. The seam was emissive and invisible, which measures the same as not emissive at all: the leg clause
    # came back at 0.73 to 1.00 against the torso, meaning the legs hold their light no better than lit bone.
    #
    # 1.6 emits about 168 in blue, a quarter of ghost. Bright enough to read as an inner light at night, dark
    # enough that a sunlit bone plate beside it is still far brighter by day, and still a long way from being a
    # third spectral section -- which is the constraint the founder set.
    figure.material("voidglow", "glow", (0.050, 0.065, 0.105), 1.6)
    figure.material("gold", "rim", (0.905, 0.720, 0.290), 1.0)
    figure.material("soulpulse", "glow", SKELETON_SOUL, 2.2)
    figure.material("soulveilpulse", "glow", SKELETON_SOUL, 0.55)
    # THE CHEST SKULL'S EYES, AND ONLY ITS EYES. FOUNDER, 2026-09-28 (correction pass): "Skeleton V2 currently has
    # the skull itself glowing. That is NOT what I requested. The skull must remain BLACK. ONLY THE EYES should
    # glow on the skull ... The eyes should remain clearly visible and individually glowing."
    #
    # NOT A `pulse` MATERIAL ON PURPOSE. The heartbeat takes anything named "pulse" down to a twelfth between
    # beats (AWonderlandCompanionEmbodiment::AnimateGlow, DeepBeat), which is how the skull's eyes photographed
    # BLACK while its glowing surface stayed lit. Every other glow on a body with a heartbeat takes the same
    # clock at a third of the depth (ShallowBeat, 0.62-1.0): the eyes still beat with the skull's owner and are
    # never out. Strength 1.2 lands at about 18,000 scene units by day and a fifth of that by night -- lit and
    # cyan against both whites, and under them, so the eyes do not bloom across the black skull around them.
    figure.material("soulgaze", "glow", SKELETON_SOUL, 1.2)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    td, tw, th = d["torso"]
    hd, hw, hh = d["head"]
    ad, aw, ah = d["arm"]
    ld, lw, lh = d["leg"]
    ed, ew, eh = d["ear"]
    shoulder = d["torso_z"] + th * 0.48
    hip = d["torso_z"] - th * 0.5
    head_top = d["head_z"] + hh * 0.5
    bone = {"bone": "bone", "dark": "void", "gold": "gold", "gem": "ghostpale"}
    # THE CHEST SKULL IN THE BODY'S OWN GREY. FOUNDER, 2026-09-28, three notes in one morning, the last one
    # deciding it: "NO keep the face of the mascot skin of the skeleton mascot skin grey just make the skeleton on
    # the chest gray as well." Before that: "The skull/head must be the SAME charcoal/dark-gray color as the gray
    # body portion of this exact mascot skin ... Trace the material/color parameter actually producing the
    # mascot's gray body and reuse that exact value/material treatment", "Eyes remain WHITE and glowing. Do NOT
    # make the skull emissive."
    #
    # TRACED, NOT PICKED: the grey the founder sees on the face and the body is `bone`, the one coat every plate,
    # limb and the head are built in (a rim material, 0.898 / 0.871 / 0.800, which reads grey in the evening
    # light the photographs were taken in). So the chest skull's cranium and jaw take `bone` -- the exact
    # material, and the same treatment, the mascot PRIMARY colourway included -- and its sockets, nose and teeth
    # the skin's lit near-black `void`, the same pair the brow and temple skulls on the face have always used.
    # Was {"bone": "soulveilpulse", "dark": "soulpulse"}: a glowing cyan skull whose sockets went dark between
    # heartbeats; and for an hour this morning an all-`void` black one, which the founder turned down for grey.
    grey_skull = bone

    def plates(part, centre, size, courses, seam="void", lit=None):
        """STEPPED BONE PLATES with a dark seam between each course -- the SKELETAL ARMOR of the sheet."""
        cx, cy, cz = centre
        sx, sy, sz = size
        each = sz / courses
        for k in range(courses):
            zz = cz + sz * 0.5 - each * (k + 0.5)
            grow = 1.0 + 0.06 * k
            figure.slab(part, "bone", (cx, cy, zz), (sx * grow, sy * grow, each * 0.86), tile=tile)
            if k < courses - 1:
                figure.box(part, seam, (cx, cy, zz - each * 0.5), (sx * grow * 0.96, sy * grow * 0.96, each * 0.16))
            if lit is not None:
                figure.box(part, lit, (cx + sx * grow * 0.5, cy, zz), (tile * 0.3, sy * 0.5, each * 0.5))

    # ---- GHOSTFIRE ENERGY. A tuft a head tall from each ear tip, a fringe along the crown between them, and --
    # the thing every view shows -- fire off both elbows and up the spine.
    figure.part("earfire", "head", (0.0, 0.0, head_top + eh), "twinkle", 0.14)
    for side in (-1.0, 1.0):
        y = side * (hw * 0.5 - ew * 0.9)
        figure.flame("earfire", lambda up: "ghost" if up < 0.55 else "ghostpale", (0.0, y, head_top + eh * 0.7), hh * 1.05, 4.0, 6, tile * 1.1)
        figure.flame("earfire", lambda up: "ghost", (-1.4, y + side * 0.8, head_top + eh * 0.5), hh * 0.65, 2.8, 4, tile * 1.0)
    figure.flame("earfire", lambda up: "ghost" if up < 0.6 else "ghostpale", (-1.0, 0.0, head_top), hh * 0.6, hw * 0.6, 6, tile * 0.95)

    # ---- THE SKULLS. The brow skull between the ears, read before anything else on the face; a small skull
    # at each temple; and the skull at the sternum -- grey like the face and the body, with its two eyes the only
    # light in it (founder, 2026-09-28) -- over the gold chain of the ARCANE CHARM. Sizes and positions are
    # unchanged: this is which parts emit and what they are made of, not the silhouette.
    figure.skull_emblem("head", bone, (hd * 0.5 + 0.6, 0.0, d["head_z"] + hh * 0.36), 4.6, tile, deep="dark")
    for side in (-1.0, 1.0):
        figure.skull_emblem("head", bone, (hd * 0.15, side * (hw * 0.5 + 0.5), d["head_z"] + hh * 0.05), 2.6, tile, deep="dark")
    chest_skull = (td * 0.5 + 1.9, 0.0, d["torso_z"] + th * 0.5 - 1.4)
    figure.skull_emblem("body", grey_skull, chest_skull, 5.2, tile, deep="dark")
    # THE EYES: one block proud of each socket, so each reads as its own white light from the front and the 3/4,
    # set in a dark socket rather than on the grey.
    for side in (-1.0, 1.0):
        figure.box("body", "soulgaze", (chest_skull[0] + 1.8, side * 1.25, chest_skull[2] + 1.15), (tile * 0.7, tile * 1.5, tile * 1.3))
    chain_z = chest_skull[2] - 3.4
    figure.chain_run("body", "gold", (td * 0.5 + 1.0, -2.3, chain_z), (td * 0.5 + 1.0, 2.3, chain_z), tile, sag=1.2, link=tile * 0.8)
    figure.pendant("body", bone, (td * 0.5 + 1.2, 0.0, chain_z - 1.0), tile, drop=1.0, gem="gem")

    # ---- SKELETAL ARMOR. The broad figure of the sheet: bone pauldrons a third of a head out from each
    # shoulder, three stepped courses down each upper arm and two heavier ones down each forearm, a plated
    # chest under the skull, hip plates that flare, plated thighs and shins, ash at every joint.
    for side in (-1.0, 1.0):
        py = side * (tw * 0.5 + 1.9)
        figure.slab("body", "bone", (0.2, py, shoulder + 0.7), (4.4, 3.8, 2.8), tile=tile)
        figure.box("body", "soulpulse", (0.2, py, shoulder - 0.9), (tile * 4.0, tile * 3.4, tile * 0.35))
        figure.box("body", "void", (0.2, py + side * 1.9, shoulder + 0.7), (tile * 3.6, tile * 0.3, tile * 2.2))
    az = d["torso_z"] + 1.0
    for side, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        y = side * (tw * 0.5 + 0.55 + aw * 0.5)
        fore = "%s_fore" % name
        plates(name, (0.2, y + side * 0.3, az + 2.2), (ad * 1.6, aw * 1.5, 4.6), 3)
        figure.box(name, "ash", (0.0, y, az - 0.4), (ad * 1.2, aw * 1.2, tile * 0.6))
        plates(fore, (0.3, y + side * 0.35, az - 4.6), (ad * 1.65, aw * 1.6, 4.6), 2, lit="soulveilpulse")
        figure.slab(fore, "ghostpale", (0.4, y, az - ah * 0.5 + 0.9), (ad * 1.3, aw * 1.3, 0.9), tile=tile)
        fire = "handfire_%s" % ("l" if side < 0 else "r")
        figure.part(fire, name, (0.0, y, az - 1.0), "twinkle", 0.3 + 0.2 * side)
        figure.flame(fire, lambda up: "ghost" if up < 0.5 else "ghostpale", (-1.2, y + side * 1.4, az - 1.6), 5.6, 3.2, 5, tile * 0.95)
        figure.flame(fire, lambda up: "ghost", (-0.6, y + side * 1.0, az - ah * 0.5), 3.4, 2.4, 3, tile * 0.9)
    for k in range(3):
        zz = d["torso_z"] - 2.4 - k * 1.8
        figure.slab("body", "bone", (td * 0.5 + 0.9, 0.0, zz), (1.8, tw * (1.18 - 0.06 * k), 1.4), tile=tile)
        for side in (-1.0, 1.0):
            figure.box("body", "void", (td * 0.5 + 1.9, side * tw * 0.30, zz), (tile * 0.5, tile * 1.1, tile * 0.8))
    for side in (-1.0, 1.0):
        figure.slab("body", "bone", (0.0, side * (tw * 0.5 + 1.2), hip + 0.6), (td * 1.1, 2.6, 2.4), tile=tile)
    for s_ in range(6):
        figure.box("body", "bone", (-td * 0.52, 0.0, d["torso_z"] + th * 0.36 - s_ * 1.1), (tile * 1.2, tile * 1.6, tile * 0.85))
        figure.box("body", "soulpulse", (-td * 0.50, 0.0, d["torso_z"] + th * 0.36 - s_ * 1.1 - 0.55), (tile * 0.9, tile * 1.2, tile * 0.3))
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        y = side * d["leg_gap"]
        shin = "%s_shin" % name
        knee = hip - lh * 0.50
        plates(name, (0.0, y, hip - lh * 0.24), (ld * 1.35, lw * 1.35, lh * 0.44), 2)
        figure.box(name, "ash", (0.0, y, knee + 0.4), (ld * 1.2, lw * 1.2, tile * 0.6))
        # THE BLACK ON THE LEGS GLOWS. plates() draws a bone course with a dark seam between courses, and that
        # seam is the black the founder is pointing at. It was `void`, which emits nothing, so the leg read as
        # black plating and stayed black plating. With the glowing near-black it reads as black plating with
        # light in its joints, which is what the note asks for without changing one dimension.
        # ---- AND THE PLATE EDGES, NOT JUST THE ONE SEAM.
        #
        # COUNTED IN THE GENERATED FIGURE: "voidglow" appeared three times -- the material declaration and one
        # seam box per leg. TWO BOXES in the whole mascot, because plates() draws a seam only BETWEEN courses
        # and the shin has two courses. Two thin boxes are not "the BLACK PARTS ON THE LEGS", however bright
        # they are made, which is why raising the strength from 0.55 to 1.6 moved the measurement by 0.004.
        #
        # plates() already takes a `lit` material and puts a strip down the outer edge of EVERY course. Passing
        # the glowing near-black there doubles the lit geometry and puts it on the edge, where a plate is read,
        # rather than only in the crack between two of them.
        #
        # STILL NO NEW BOXES AND NO SIZE CHANGES: `lit` is a parameter plates() has always had, and the founder's
        # instruction is a targeted correction to which parts glow, not a redesign of the leg.
        plates(shin, (0.0, y, knee - lh * 0.24), (ld * 1.3, lw * 1.3, lh * 0.40), 2,
               seam="voidglow", lit="voidglow")
        # THE FEET BURN: blocks of pale blue light in a pool of ghostfire.
        # ---- THE FEET ARE THE BODY'S COLOURWAY, NOT THE SPECTRE'S.
        #
        # FOUNDER: "The FEET should NOT be blue ... they should use the same neutral color family as the
        # non-blue portions of the mascot -- the existing GRAY/BLACK body colorway ... They should visually
        # belong to the skeleton/body rather than looking like extensions of the blue spectral areas."
        #
        # The upper foot slab was `ghostpale` and the sole `ghost`, which are the two spectral glow materials --
        # so the feet were not blue-tinted, they were made of the same substance as the ghostfire. `ash` is the
        # gray already on the ankle and knee bands and `void` the near-black of the seams, so the foot joins the
        # family of the parts directly above it and no colour arrives that is not already on this skin.
        #
        # SIZES, POSITIONS AND TILE UNCHANGED: a material correction, because the founder's instruction is not to
        # broadly recolour and not to alter the silhouette.
        figure.slab(shin, "ash", (ld * 0.32, y, hip - lh + lh * 0.075), (ld * 1.55, lw * 1.25, lh * 0.15), tile=tile)
        figure.slab(shin, "void", (ld * 0.30, y, hip - lh + lh * 0.010), (ld * 1.75, lw * 1.45, lh * 0.04), tile=tile)
        fire = "footfire_%s" % ("l" if side < 0 else "r")
        figure.part(fire, shin, (0.0, y, hip - lh + 0.4), "twinkle", 0.5 + 0.2 * side)
        figure.flame(fire, lambda up: "ghost" if up < 0.5 else "ghostpale", (0.6, y, hip - lh + 0.2), 4.2, 3.2, 5, tile * 0.95)
        figure.flame(fire, lambda up: "ghost", (-0.8, y, hip - lh + 0.2), 2.8, 2.4, 3, tile * 0.85)

    # ---- THE FLANK FIRE, behind the arms and at the arms' own size, and THE BACK PLUME up the spine.
    for side in (-1.0, 1.0):
        y = side * (tw * 0.5 + aw + 2.2)
        name = "flankfire_%s" % ("l" if side < 0 else "r")
        figure.part(name, "body", (0.0, y, shoulder - 2.0), "twinkle", 0.38 + 0.24 * side)
        figure.flame(name, lambda up: "ghost" if up < 0.62 else "ghostpale", (-2.2, y, hip + 0.4), 9.0, 5.0, 8, tile * 1.1)
        figure.flame(name, lambda up: "ghost", (-3.6, y + side * 1.4, hip + 2.4), 6.5, 4.0, 5, tile * 1.0)
    figure.part("backfire", "body", (-td * 0.55, 0.0, shoulder + 0.5), "twinkle", 0.22)
    figure.flame("backfire", lambda up: "ghost" if up < 0.6 else "ghostpale", (-td * 0.6, 0.0, shoulder + 0.2), 9.0, 6.4, 7, tile * 1.1)
    for k, (backset, drop, height, width, tongues) in enumerate(((2.6, 0.8, 7.5, 5.0, 6), (5.0, 2.4, 5.8, 4.0, 5), (7.2, 4.2, 4.2, 3.0, 4))):
        figure.flame("backfire", (lambda up: "ghost") if k else (lambda up: "ghost" if up < 0.6 else "ghostpale"),
                     (-td * 0.6 - backset, 0.0, shoulder + 0.2 - drop), height, width, tongues, tile * (1.08 - 0.07 * k))
    return figure



def hagoromo():
    """HAGOROMO -- SKY KING. BEYOND THE HEAVENS. BEYOND COMPARE.

    Rebuilt against the founder's plate: a white and lavender celestial mane in cascading layers, a violet gem at
    the brow, a gold eight-point star at the chest, a gold-trimmed violet sash and banner, FOUR sacred orbs each
    presented on a gold rod, and violet eyes.
    """
    figure = start("RELAY DOG SKIN -- HAGOROMO", 7005, (0.72, 0.36, 1.00), 7.0)
    figure.material("snow", "rim", (0.975, 0.965, 0.995), 1.0)
    figure.material("lavender", "lit", (0.740, 0.640, 0.880), 1.0)
    figure.material("violet", "lit", (0.400, 0.200, 0.620), 1.0)
    figure.material("gold", "rim", (0.905, 0.720, 0.290), 1.0)
    figure.material("golddeep", "lit", (0.500, 0.360, 0.110), 1.0)
    figure.material("amethyst", "glow", (0.66, 0.30, 1.00), 1.2)
    figure.material("orb", "glow", (0.56, 0.22, 1.00), 0.6)
    figure.material("orbglow", "glow", (0.90, 0.78, 1.00), 1.0)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    td, tw, th = d["torso"]
    hd, hw, hh = d["head"]
    shoulder = d["torso_z"] + th * 0.48
    mats = {"gold": "gold", "golddeep": "golddeep", "gem": "amethyst", "orb": "orb", "orbglow": "orbglow"}

    # ================================================================== THE MANE
    # Cascading sheets: a crown fall over the back of the head, a side fall past each ear, and a long back fall
    # from the shoulders to the knees. White at the top, lavender where it hangs deepest, as the plate has it.
    # IT IS THE BIGGEST THING ON THE PLATE AND IT WAS THE SMALLEST THING HERE. On the reference the mane is a
    # CASCADE -- sheet over sheet over sheet, falling from the crown past the knees and spreading wider than the
    # robe, so the figure's whole outline is hair. Four short layers made a hood. More layers, longer, and each
    # one set a little further back and wider than the last, so the fall has depth from the side as well as bulk
    # from the front.
    figure.part("mane", "head", (0.0, 0.0, d["head_z"]), "trail", 0.35)
    figure.mane_layers("mane", lambda lf, down: "snow" if down < 0.45 + 0.25 * lf else "lavender",
                       (-hd * 0.30, 0.0, d["head_z"] + hh * 0.46), hw * 1.34, 19.0, 6, tile, spread=1.35)
    figure.mane_layers("mane", lambda lf, down: "snow" if down < 0.32 + 0.30 * lf else "lavender",
                       (-hd * 0.62, 0.0, d["head_z"] + hh * 0.30), hw * 1.52, 24.0, 5, tile * 1.05, spread=1.55)
    for side in (-1.0, 1.0):
        figure.mane_layers("mane", lambda lf, down: "snow" if down < 0.5 else "lavender",
                           (hd * 0.05, side * (hw * 0.5 + 0.8), d["head_z"] + hh * 0.30), 5.2, 17.0, 5, tile * 0.95, spread=0.95)
        # a second fall further out and further back, so the side of the head is hair to the shoulder line
        figure.mane_layers("mane", lambda lf, down: "snow" if down < 0.38 else "lavender",
                           (-hd * 0.34, side * (hw * 0.5 + 2.2), d["head_z"] + hh * 0.18), 4.4, 20.0, 4, tile, spread=1.05)
    figure.part("backmane", "body", (0.0, 0.0, shoulder), "trail", 0.5)
    figure.mane_layers("backmane", lambda lf, down: "snow" if down < 0.35 + 0.3 * lf else "lavender",
                       (-td * 0.55, 0.0, shoulder + 0.6), tw * 2.15, 25.0, 7, tile * 1.05, spread=1.55)
    figure.mane_layers("backmane", lambda lf, down: "lavender" if down > 0.42 else "snow",
                       (-td * 1.05, 0.0, shoulder - 1.4), tw * 1.80, 21.0, 5, tile * 1.05, spread=1.75)
    # the ruff at the collar, so the mane meets the robe rather than stopping at the neck
    figure.slab("body", "snow", (0.3, 0.0, shoulder + 1.6), (td * 1.25, tw * 1.30, 2.0), tile=tile)

    # ================================================================== THE BROW GEM
    figure.box("head", "gold", (hd * 0.5 + 0.35, 0.0, d["head_z"] + 2.6), (tile * 0.8, tile * 2.2, tile * 2.8))
    figure.box("head", "amethyst", (hd * 0.5 + 0.9, 0.0, d["head_z"] + 2.6), (tile * 0.8, tile * 1.2, tile * 1.9))
    figure.box("head", "amethyst", (hd * 0.5 + 0.9, 0.0, d["head_z"] + 3.6), (tile * 0.7, tile * 0.7, tile * 0.7))

    # ================================================================== THE ROBE, SASH AND BANNER
    figure.part("robe", "body", (0.0, 0.0, shoulder - 2.0), "trail", 0.5)
    figure.cloak("robe", lambda down, across: "lavender" if abs(across - 0.5) > 0.38 or down > 0.90 else "snow",
                 (-td * 0.15, 0.0, shoulder - 1.2), tw * 2.0, 17.5, tile * 1.14, flare=2.6, back=-1.2)
    figure.cloak("robe", lambda down, across: "snow" if down < 0.82 else "gold",
                 (td * 0.48, 0.0, shoulder - 3.0), tw * 1.0, 11.0, tile * 1.02, flare=1.6)
    # LAYERED SLEEVES, GOLD CUFFS AND HAND ENERGY. A band of gold and one white slab is not a sleeve: the plate's
    # arms are wide ceremonial sleeves falling in layers well below the hand, trimmed in gold at every edge, with
    # a bloom of violet light held at each palm. The arms were the plainest part of a figure whose whole point is
    # ornament, and on the plate they are where the eye goes after the orbs.
    for side, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        y = side * (tw * 0.5 + d["arm"][1] * 0.36)
        # three sleeve layers, each wider and longer than the one above it
        for k, (w, ln) in enumerate(((1.45, 5.0), (1.72, 7.0), (1.95, 9.0))):
            figure.slab(name, "snow" if k < 2 else "lavender",
                        (-0.2 * k, y, d["torso_z"] + 1.4 - k * 2.4),
                        (d["arm"][0] * w, d["arm"][1] * w, ln * 0.45), tile=tile)
            figure.box(name, "gold", (-0.2 * k, y, d["torso_z"] + 1.4 - k * 2.4 - ln * 0.22),
                       (d["arm"][0] * w, d["arm"][1] * w, tile * 0.7))
        # the cuff proper, and the violet light held below it
        figure.box(name, "gold", (0.0, y, d["torso_z"] - 4.6), (d["arm"][0] * 1.5, d["arm"][1] * 1.5, tile * 1.0))
        figure.slab(name, "snow", (0.0, y, d["torso_z"] - 5.6), (d["arm"][0] * 1.20, d["arm"][1] * 1.24, 1.8), tile=tile)
        figure.part("palm_%s" % ("l" if side < 0 else "r"), name, (0.4, y, d["torso_z"] - 7.4), "float", 0.4 + 0.2 * side)
        pn = "palm_%s" % ("l" if side < 0 else "r")
        figure.box(pn, "orbglow", (0.4, y, d["torso_z"] - 7.4), (tile * 1.9, tile * 2.1, tile * 2.1))
        figure.ring(pn, lambda a: "orb", (0.4, y, d["torso_z"] - 7.4), 2.1, tile * 0.6, tile * 0.85)
        for sp in range(5):
            a = sp * 2.0 * math.pi / 5.0
            figure.box(pn, "orbglow", (0.4 + math.cos(a) * 2.6, y, d["torso_z"] - 7.4 + math.sin(a) * 2.6),
                       (tile * 0.7, tile * 0.7, tile * 0.7))
    # the sash: a violet band with gold edges, and a knot at the hip
    sash_z = d["torso_z"] - th * 0.30
    figure.slab("body", "violet", (0.0, 0.0, sash_z), (td * 1.18, tw * 1.18, 1.9), tile=tile)
    figure.slab("body", "gold", (0.0, 0.0, sash_z + 1.15), (td * 1.20, tw * 1.20, 0.5), tile=tile)
    figure.slab("body", "gold", (0.0, 0.0, sash_z - 1.15), (td * 1.20, tw * 1.20, 0.5), tile=tile)
    figure.slab("body", "violet", (td * 0.2, tw * 0.62, sash_z - 0.4), (2.0, 2.2, 2.6), tile=tile)
    # the banner: violet, gold-edged, with a gold star and a gem, hanging from the sash at the front
    figure.part("banner", "body", (td * 0.62, 0.0, sash_z - 1.0), "trail", 0.6)
    figure.glyph_banner("banner", {"cloth": "violet", "ink": "gold"}, (td * 0.62, 0.0, sash_z - 1.0), 4.6, 9.5, tile, None)
    for zz in (sash_z - 1.3, sash_z - 10.3):
        figure.box("banner", "gold", (td * 0.66, 0.0, zz), (tile * 0.7, 4.8, tile * 0.6))
    for yy in (-2.3, 2.3):
        figure.box("banner", "gold", (td * 0.66, yy, sash_z - 5.75), (tile * 0.7, tile * 0.6, 9.5))
    figure.star_burst("banner", {"gold": "gold", "gem": "amethyst"}, (td * 0.72, 0.0, sash_z - 5.6), 1.7, 8, tile, key="gold", core="gem")

    # ================================================================== THE CHEST EMBLEM
    figure.slab("body", "golddeep", (td * 0.54, 0.0, shoulder - 2.6), (1.2, 4.4, 4.4), tile=tile)
    figure.star_burst("body", {"gold": "gold", "gem": "amethyst"}, (td * 0.54 + 0.9, 0.0, shoulder - 2.6), 3.3, 8, tile, key="gold", core="gem")
    figure.ring("body", lambda a: "gold", (td * 0.54 + 0.9, 0.0, shoulder - 2.6), 2.3, tile * 0.7, tile * 0.85)

    # ================================================================== THE SIX SACRED ORBS
    # Two high, rising from the shoulders to stand beside and above the ears; two mid, reaching furthest out;
    # two low, standing off the hips. Each on its own gold rod with a collar, and each ringed with light. They
    # float a little, as the plate's do, and they are the widest thing in the silhouette by a distance.
    #
    # SIX, NOT FOUR. Counted off the founder's own plate (recovered from the session transcript rather than
    # remembered): the armature carries three orbs to a side, and the middle pair -- reaching out level with
    # the chest, further than either the high or the low -- is what makes the arrangement read as a CIRCLE of
    # orbs around the figure instead of two pairs bracketing it. Missing that pair, the widest point of the
    # silhouette sat at the shoulders and the shape closed up into an hourglass.
    figure.part("orbs_high", "body", (0.0, 0.0, shoulder + 1.0), "float", 0.45)
    figure.part("orbs_mid", "body", (0.0, 0.0, d["torso_z"] + 1.6), "float", 0.40)
    figure.part("orbs_low", "body", (0.0, 0.0, d["torso_z"] - 1.0), "float", 0.35)
    for side in (-1.0, 1.0):
        figure.orb_on_rod("orbs_high", mats, (-0.6, side * (tw * 0.5 + 1.4), shoulder + 1.2), (side * 0.72, 1.0), 10.8, 2.3, tile, halo=True)
        figure.orb_on_rod("orbs_mid", mats, (-0.2, side * (tw * 0.5 + 1.2), d["torso_z"] + 1.8), (side * 1.0, 0.52), 12.6, 2.2, tile, halo=True)
        figure.orb_on_rod("orbs_low", mats, (0.2, side * (tw * 0.5 + 0.9), d["torso_z"] - 1.2), (side * 1.0, 0.18), 7.8, 2.0, tile, halo=True)
    return figure


# 凯 (kai), as a 13 x 12 bitmap: 岂 on the left (山 over 己), 几 on the right.
KAI_GLYPH = [
    "..#.#.#....#.",
    "..#.#.#....#.",
    "..#####...#.#",
    ".........#..#",
    "..#####..#..#",
    "......#..#..#",
    "..#####..#..#",
    "..#......#..#",
    "..#......#..#",
    "..#...#..#..#",
    "..#####.#...#",
    "........#..##",
]


def celestial_light():
    """CELESTIAL LIGHT -- CELESTIAL ENERGY. RADIANT GLOW. STARLIGHT AURA.

    Rebuilt against the founder's plate: a luminous white-blue body whose edges radiate, a four-point star at the
    brow, a chest banner bearing 凯, drifting starlight, and white-blue eyes.
    """
    figure = start("RELAY DOG SKIN -- CELESTIAL LIGHT", 7006, (0.62, 0.88, 1.00), 7.0,
                   coat=(0.930, 0.960, 1.000), coat_deep=(0.720, 0.820, 1.000))
    # THE LUMINOSITY COMES LAST, AND ONLY NOW. The founder's order was explicit -- "First make the geometry
    # detailed. Then add controlled luminosity" -- so this was deliberately left weak until the armour, the
    # engraving, the brow star and the banner were actually built. They are, so the light can come up.
    # THE PLATE IS LIT ON BLACK AND THIS DOG STANDS IN A GARDEN AT NOON, which is most of the apparent gap: at
    # 2.8 the edges lost to daylight and the figure read as pale grey rather than radiant. Raised until the cut
    # lines and rim carry in sunlight, and no further -- the point is that the geometry reads THROUGH the glow.
    # BROUGHT UNDER THE EYES. At 5.2 and 4.4 (x GLOW_SCALE) the edges and the brow star were the brightest
    # things on the head by a wide margin -- sixty-three boxes of head glow around two eye boxes -- and the
    # eyes measured DARKER than the face at every hour (over_face -0.22 / -0.12 / -0.16). The eyes are driven
    # to an absolute 12; the face now sits at 6 and 4.8, so the eyes are the brightest thing on it, which is
    # the whole of "visibly glowing eyes" on this skin. The cut lines still carry: 6 is well above the 1.0 of
    # the body it edges.
    figure.material("edge", "glow", (0.62, 0.82, 1.00), 0.7)
    figure.material("starlight", "glow", (0.95, 0.98, 1.00), 0.6)
    figure.material("bannercloth", "rim", (0.80, 0.90, 1.00), 1.0)
    figure.material("ink", "glow", (0.93, 0.98, 1.00), 0.6)
    figure.material("frost", "rim", (0.86, 0.93, 1.00), 1.0)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    td, tw, th = d["torso"]
    hd, hw, hh = d["head"]
    shoulder = d["torso_z"] + th * 0.48

    # ================================================================== THE EDGES RADIATE
    # A thin bar of light along every edge of the head and torso, and the outer edges of the limbs. The interior
    # stays the pale body colour, so the form is read by its glowing outline rather than lost in a flare.
    def edge_frame(part, centre, size, thin=0.95):
        cx, cy, cz = centre
        sx, sy, sz = size
        hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
        for ey in (-hy, hy):
            for ez in (-hz, hz):
                figure.box(part, "edge", (cx, cy + ey, cz + ez), (sx, tile * thin, tile * thin))
        for ex in (-hx, hx):
            for ez in (-hz, hz):
                figure.box(part, "edge", (cx + ex, cy, cz + ez), (tile * thin, sy, tile * thin))
        for ex in (-hx, hx):
            for ey in (-hy, hy):
                figure.box(part, "edge", (cx + ex, cy + ey, cz), (tile * thin, tile * thin, sz))

    edge_frame("head", (0.0, 0.0, d["head_z"]), (hd * 1.02, hw * 1.02, hh * 1.02))
    edge_frame("body", (0.0, 0.0, d["torso_z"]), (td * 1.04, tw * 1.04, th * 1.02))
    ed, ew, eh = d["ear"]
    for side in (-1.0, 1.0):
        y = side * (hw * 0.5 - ew * 0.9)
        edge_frame("head", (0.0, y, d["head_z"] + hh * 0.5 + eh * 0.28), (ed * 1.05, ew * 1.05, eh * 0.64), thin=0.45)
    ad, aw, ah = d["arm"]
    for side, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        edge_frame(name, (0.0, side * (tw * 0.5 + aw * 0.36), d["torso_z"] + 1.0), (ad * 1.06, aw * 1.06, ah * 1.02), thin=0.45)
    ld, lw, lh = d["leg"]
    hip_z = d["torso_z"] - th * 0.5
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        edge_frame(name, (0.0, side * d["leg_gap"], hip_z - lh * 0.25), (ld * 1.06, lw * 1.06, lh * 0.50), thin=0.45)
        edge_frame("%s_shin" % name, (0.0, side * d["leg_gap"], hip_z - lh * 0.74), (ld * 1.0, lw * 1.0, lh * 0.50), thin=0.45)
    # ================================================================== LAYERED LUMINOUS ARMOUR
    # THE GEOMETRY FIRST, AND THEN THE LIGHT. This skin was a bare body wearing an outline: two frost slabs, an
    # edge glow and an aura, which is exactly the "bloom hiding simple geometry" the founder called out -- at any
    # distance it collapsed to a white blob because there was nothing under the glow to read. The plate's figure
    # is ARMOURED: segmented pauldrons stepping down the arm, a bordered breastplate, vambraces, knee plates and
    # lit boots. All of it is built as plates with their own edges lit, so the light describes structure.
    for side in (-1.0, 1.0):
        # pauldrons: three plates stepping outward and down, each smaller, each with a lit lip
        for k in range(3):
            w = 3.6 - k * 0.6
            yy = side * (tw * 0.5 + 0.9 + k * 0.85)
            zz = shoulder + 0.8 - k * 1.9
            figure.slab("body", "frost", (0.3, yy, zz), (w, 2.4 - k * 0.3, 2.2 - k * 0.3), tile=tile)
            figure.box("body", "edge", (0.3 + w * 0.5, yy, zz - (1.0 - k * 0.12)), (tile * 0.55, 2.2 - k * 0.3, tile * 0.55))
        # vambrace: a cuff of two plates on the forearm
        for k, zz in enumerate((shoulder - 4.2, shoulder - 5.8)):
            figure.slab("body", "frost", (0.2, side * (tw * 0.5 + aw * 0.42), zz), (ad * 1.30, aw * 1.34, 1.5 - k * 0.3), tile=tile)
        # knee plate and a lit boot, so the legs are not two bare posts
        figure.slab("%s_shin" % ("leg_l" if side < 0 else "leg_r"), "frost",
                    (td * 0.22, side * d["leg_gap"], hip_z - lh * 0.56), (ld * 1.14, lw * 1.20, 2.2), tile=tile)
        figure.slab("%s_shin" % ("leg_l" if side < 0 else "leg_r"), "frost",
                    (0.2, side * d["leg_gap"], hip_z - lh * 0.94), (ld * 1.22, lw * 1.26, 1.8), tile=tile)
        figure.box("%s_shin" % ("leg_l" if side < 0 else "leg_r"), "edge",
                   (0.2, side * d["leg_gap"], hip_z - lh * 1.02), (ld * 1.22, lw * 1.26, tile * 0.6))

    # THE BREASTPLATE the banner hangs on, with a raised border and a star boss at the collar.
    figure.slab("body", "frost", (td * 0.42, 0.0, shoulder - 1.2), (1.6, tw * 1.06, 5.6), tile=tile)
    for yy in (-tw * 0.53, tw * 0.53):
        figure.box("body", "edge", (td * 0.42 + 0.8, yy, shoulder - 1.2), (tile * 0.5, tile * 0.5, 5.6))
    for zz in (shoulder + 1.6, shoulder - 4.0):
        figure.box("body", "edge", (td * 0.42 + 0.8, 0.0, zz), (tile * 0.5, tw * 1.06, tile * 0.5))
    figure.slab("body", "frost", (td * 0.40, 0.0, shoulder + 2.4), (1.4, tw * 0.86, 1.6), tile=tile)   # gorget
    figure.star_burst("body", {"gold": "starlight", "gem": "starlight"},
                      (td * 0.5 + 1.0, 0.0, shoulder + 2.4), 1.9, 4, tile, key="gold", core="gem")

    # ENGRAVING, which is what stops a lit plate reading as a blank lit plate. The reference's armour is covered
    # in fine scrollwork that only shows because the light catches the cut lines -- so these are single-voxel
    # runs of the edge material laid ON the plates: a scroll curl either side of the breastplate, a run of
    # chevrons down its centre, and a lit line along each pauldron's leading edge.
    for side in (-1.0, 1.0):
        for k in range(5):
            a = math.pi * (0.15 + 0.30 * k / 4.0)
            figure.box("body", "edge",
                       (td * 0.5 + 1.0, side * (tw * 0.20 + math.sin(a) * tw * 0.22), shoulder - 0.2 - math.cos(a) * 2.4),
                       (tile * 0.45, tile * 0.55, tile * 0.55))
    for k in range(4):
        figure.box("body", "edge", (td * 0.5 + 1.0, 0.0, shoulder + 0.6 - k * 1.5), (tile * 0.45, tile * 1.6, tile * 0.5))
        figure.box("body", "edge", (td * 0.5 + 1.0, 0.0, shoulder + 0.1 - k * 1.5), (tile * 0.45, tile * 0.9, tile * 0.5))

    # HANDS, which the plate shows plainly and this skin did not have at all.
    for side, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        figure.slab("body", "frost", (0.1, side * (tw * 0.5 + aw * 0.44), shoulder - 7.2),
                    (ad * 1.16, aw * 1.24, 1.9), tile=tile)

    # ================================================================== THE BROW STAR
    # BIG ENOUGH TO BE THE BROW STAR. On the plate it is the second thing you see after the glow, sitting above
    # the visor and nearly as wide as the gap between the ears; at 2.3 it was a speck lost in the head's own light.
    figure.star_burst("head", {"gold": "starlight", "gem": "starlight"}, (hd * 0.5 + 0.6, 0.0, d["head_z"] + 2.8), 3.6, 4, tile,
                      key="gold", core="gem")
    figure.star_burst("head", {"gold": "edge", "gem": "starlight"}, (hd * 0.5 + 0.35, 0.0, d["head_z"] + 2.8), 2.2, 4, tile,
                      key="gold", core="gem")
    figure.box("head", "edge", (hd * 0.5 + 0.4, 0.0, d["head_z"] + 2.8), (tile * 0.6, tile * 1.6, tile * 1.6))

    # ================================================================== THE HALO STANDING BEHIND
    # THE WARDROBE PROMISED THIS AND THE MODEL DID NOT HAVE IT. The skin registry's own description reads "A coat
    # of light, a star at the brow, a marked banner, and a HALO STANDING BEHIND" -- so the founder was being told
    # about a halo while looking at a Dog that had none.
    #
    # It also fixes the one skin that failed the founder's medium-distance test. Every other premium skin breaks
    # its outline with something: Apollo a halo and crown, Arden a demonic arm, Hagoromo a mane and four orbs,
    # Skeleton Flame tall ghostfire, Bee wings. CELESTIAL LIGHT had only surface detail -- brow star, banner,
    # engraving -- all of which vanish at distance, leaving a silhouette identical to bare RELAY OG. A ring
    # standing behind the head is the cheapest honest way to give it an outline of its own.
    halo_c = (-hd * 0.34, 0.0, d["head_z"] + hh * 0.30)
    # STANDING, NOT SPINNING. On "orbit" the ring turns, and a ring seen edge-on is a vertical line -- the first
    # render caught it at about seventy degrees and the halo read as a narrow almond around the head instead of a
    # disc behind it. Since the whole reason this halo exists is to give the skin an outline at gameplay distance,
    # a motion that periodically deletes that outline defeats it. It stands still and always reads.
    figure.part("halo", "head", halo_c, "none")
    for r, m in ((11.4, "edge"), (10.4, "starlight"), (9.5, "edge")):
        figure.ring("halo", lambda a, mm=m: mm, halo_c, r, tile * 1.15, tile * 0.95)
    # four points on the ring, at the compass, so it reads as celestial rather than as a hoop
    for k in range(4):
        a = math.pi * 0.5 * k + math.pi * 0.25
        figure.star_burst("halo", {"gold": "starlight", "gem": "edge"},
                          (halo_c[0], math.cos(a) * 10.4, halo_c[2] + math.sin(a) * 10.4), 2.2, 4, tile,
                          key="gold", core="gem")

    # ================================================================== THE BANNER, WITH 凯
    figure.part("banner", "body", (td * 0.5 + 1.0, 0.0, shoulder + 0.6), "trail", 0.45)
    figure.glyph_banner("banner", {"cloth": "bannercloth", "ink": "ink"}, (td * 0.5 + 1.1, 0.0, shoulder + 0.6), 7.2, 9.0, tile, KAI_GLYPH)
    for zz in (shoulder + 0.4, shoulder - 8.6):
        figure.box("banner", "edge", (td * 0.5 + 1.5, 0.0, zz), (tile * 0.5, 7.4, tile * 0.5))
    for yy in (-3.6, 3.6):
        figure.box("banner", "edge", (td * 0.5 + 1.5, yy, shoulder - 4.1), (tile * 0.5, tile * 0.5, 9.0))

    # ================================================================== THE STARLIGHT AURA
    # Drifting motes in a shell around the body, sparser high, denser near the shoulders, never on the face.
    figure.part("aura", "root", (0.0, 0.0, d["torso_z"]), "float", 0.8)
    for i in range(46):
        u = figure.rng.random()
        a = figure.rng.uniform(0.0, 2.0 * math.pi)
        r = 6.5 + figure.rng.uniform(0.0, 5.5)
        z = 2.0 + u * 22.0
        x, y = math.cos(a) * r, math.sin(a) * r
        if x > 3.0 and abs(y) < 5.0 and 12.0 < z < 21.0:
            continue
        s = tile * figure.rng.uniform(0.35, 0.8)
        figure.box("aura", "starlight", (x, y, z), (s, s, s))
    return figure


def bee():
    """BEE -- amber and black bands, broad gauze wings on a dark thorax, curved antennae, a honeycomb emblem, a
    stinger. Polished, not rebuilt: the concept already read, and the founder asked that it stay a Relay Dog.
    """
    figure = start("RELAY DOG SKIN -- BEE", 7007, (0.20, 0.16, 0.10), 3.0,
                   coat=(0.960, 0.760, 0.180), coat_deep=(0.620, 0.470, 0.090))
    figure.material("stripe", "lit", (0.110, 0.095, 0.070), 1.0)
    figure.material("gauze", "add", (0.80, 0.92, 1.00), 1.1)
    figure.material("vein", "add", (0.55, 0.70, 0.90), 0.9)
    figure.material("amber", "glow", (1.00, 0.72, 0.12), 0.8)
    figure.material("honey", "glow", (1.00, 0.58, 0.06), 0.7)
    figure.material("fuzz", "rim", (0.985, 0.880, 0.520), 1.0)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    td, tw, th = d["torso"]
    hd, hw, hh = d["head"]
    shoulder = d["torso_z"] + th * 0.48

    # THE BANDS, thicker, and carried onto the legs so the striping reads as the whole animal and not a jumper.
    for band in range(3):
        z = d["torso_z"] + 2.0 - band * 2.4
        figure.slab("body", "stripe", (0.0, 0.0, z), (td * 1.06, tw * 1.06, 1.5), tile=tile)
    figure.slab("head", "stripe", (0.0, 0.0, d["head_z"] - hh * 0.42), (hd * 1.02, hw * 1.02, 1.2), tile=tile)
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        figure.slab(name, "stripe", (0.0, side * d["leg_gap"], d["torso_z"] - th * 0.5 - 1.6),
                    (d["leg"][0] * 1.08, d["leg"][1] * 1.08, 1.0), tile=tile)

    # THORAX FUZZ: a pale collar of down at the neck and shoulders, which is what makes a bee look soft.
    figure.slab("body", "fuzz", (0.3, 0.0, shoulder + 1.4), (td * 1.16, tw * 1.22, 1.6), tile=tile)
    for k in range(10):
        a = 2.0 * math.pi * k / 10
        figure.box("body", "fuzz", (0.3 + math.cos(a) * td * 0.55, math.sin(a) * tw * 0.62, shoulder + 2.3),
                   (tile * 0.8, tile * 0.8, tile * 0.7))

    # THE HONEYCOMB EMBLEM: seven cells on the chest, each a dark comb wall around an amber heart.
    cx = td * 0.5 + 0.7
    cells = [(0.0, 0.0)] + [(math.cos(math.radians(60 * k)) * 2.1, math.sin(math.radians(60 * k)) * 2.1) for k in range(6)]
    for cy, cz in cells:
        figure.box("body", "stripe", (cx, cy, shoulder - 3.4 + cz), (tile * 0.9, tile * 2.0, tile * 2.0))
        figure.box("body", "honey", (cx + 0.5, cy, shoulder - 3.4 + cz), (tile * 0.7, tile * 1.2, tile * 1.2))

    # ANTENNAE: five segments each, rising from the brow and curving back, with an amber club at the tip.
    for side in (-1.0, 1.0):
        y = side * hw * 0.30
        for s in range(5):
            f = s / 4.0
            figure.box("head", "stripe",
                       (hd * 0.35 - f * 2.6, y + side * f * 0.8, d["head_z"] + hh * 0.5 + 0.6 + f * 4.4),
                       (tile * 0.55, tile * 0.55, tile * 1.15))
        figure.box("head", "amber", (hd * 0.35 - 2.9, y + side * 0.9, d["head_z"] + hh * 0.5 + 5.6), (tile * 1.1,) * 3)

    # THE WINGS: broad, on a dark thorax plate, with a vein running the length of each leaf, and they beat.
    figure.slab("body", "stripe", (-td * 0.48, 0.0, d["torso_z"] + th * 0.36), (1.3, tw * 0.9, 2.6), tile=tile)
    for side in (-1.0, 1.0):
        name = "wing_%s" % ("l" if side < 0 else "r")
        pivot = (-td * 0.44, side * tw * 0.42, d["torso_z"] + th * 0.46)
        figure.part(name, "body", pivot, "wing", side)
        figure.box(name, "stripe", pivot, (tile * 1.2, tile * 1.4, tile * 1.4))
        # BROADER LEAVES. The wings were the only real silhouette this skin had and they were a thin strip: two
        # units of chord against a thirteen unit span, which is a blade, not a wing. Widened and lengthened so
        # that from the front the wings ARE the animal, the way they are on the founder's plate.
        for leaf, (length, lift, sweep) in enumerate(((15.5, 4.6, 5.0), (11.5, 0.6, 6.8))):
            across = max(4, int(length / (tile * 1.4)))
            for s in range(across):
                t2 = (s + 0.5) / across
                half = (0.9 + 4.6 * math.sin(math.pi * min(t2 * 1.12, 1.0))) * (1.0 - 0.18 * t2)
                steps = max(1, int(half / tile))
                for w in range(-steps, steps + 1):
                    figure.box(name, "gauze",
                               (pivot[0] - t2 * sweep + w * tile * 0.35, pivot[1] + side * t2 * length,
                                pivot[2] + t2 * lift + w * tile * 0.95),
                               (tile * 0.45, tile * 1.45, tile * 0.9))
                figure.box(name, "vein", (pivot[0] - t2 * sweep + 0.25, pivot[1] + side * t2 * length, pivot[2] + t2 * lift),
                           (tile * 0.5, tile * 1.5, tile * 0.5))

    # ================================================================== THE ABDOMEN
    # FOUNDER (2026-09-23), on this skin by name: "Do not make it simply: yellow/black dog + wings + antennae.
    # Create a stronger cohesive Bee identity." And on the set as a whole: "recognizable from silhouette alone."
    #
    # WHAT THE MEASUREMENT SAID. Tools/silhouette_check.py put Bee at 0.66 front and 0.72 side against an
    # UNDRESSED Relay OG -- the worst pair in the entire set. With the colour taken away it WAS the base dog:
    # the stripes are paint, the emblem is paint, and a five-box stinger is not a shape. The wings were the only
    # real silhouette on it.
    #
    # SO IT GETS THE ONE THING THAT MAKES A BEE A BEE FROM ACROSS A ROOM: a heavy banded abdomen, slung back and
    # down off the thorax, segment by segment, tapering into the sting. It is the whole rear half of the animal
    # and it is what the old five boxes were standing in for.
    ab_root = (-td * 0.5 - 0.6, 0.0, d["torso_z"] - th * 0.24)
    # "tail", NOT an invented kind. The loader knows a fixed set of motions (blink, float, head, knee, none,
    # orbit, spine, stride, tail, trail, twinkle, wing) and rejects anything else -- and an unknown motion
    # cost the WHOLE FIGURE: Bee loaded with 0 parts in engine and its turnaround came back as an empty
    # lawn, while the offline renderer drew it perfectly because that renderer ignores motion entirely.
    figure.part("abdomen", "body", ab_root, "tail", 5.0, 7.0)
    segments = ((0.0, 0.00, 2.9, 5.4, 4.8), (2.5, -1.15, 2.8, 5.6, 4.9), (5.0, -2.60, 2.6, 5.0, 4.4),
                (7.2, -4.20, 2.2, 4.0, 3.6), (9.0, -5.70, 1.7, 2.9, 2.6), (10.4, -6.90, 1.2, 1.9, 1.7))
    for seg, (back, drop, depth, wide, tall) in enumerate(segments):
        band = "stripe" if seg % 2 else None
        centre = (ab_root[0] - back, 0.0, ab_root[2] + drop)
        figure.slab("abdomen", band or "bone", centre, (depth, wide, tall), tile=tile)
        # THE BANDS ARE CUT INTO IT, not painted on: a dark groove standing proud between every pair of
        # segments, so the abdomen reads as segmented at the distance the founder judges these from.
        if seg < len(segments) - 1:
            nxt = segments[seg + 1]
            figure.slab("abdomen", "stripe",
                        (ab_root[0] - (back + nxt[0]) * 0.5, 0.0, ab_root[2] + (drop + nxt[1]) * 0.5),
                        (depth * 0.5, wide * 1.06, tall * 0.52), tile=tile)
        # a warm underglow along the belly of each segment, which is where a bee actually carries its colour
        figure.slab("abdomen", "amber", (centre[0], 0.0, centre[2] - tall * 0.42),
                    (depth * 0.72, wide * 0.74, 0.9), tile=tile)

    # THE STING: short, dark, and the only part of the animal that comes to a point.
    tip = (ab_root[0] - 11.4, 0.0, ab_root[2] - 7.6)
    for s in range(4):
        t3 = s / 3.0
        figure.box("abdomen", "stripe" if t3 < 0.65 else "amber",
                   (tip[0] - t3 * 2.0, 0.0, tip[2] - t3 * 1.0), (tile * (1.15 - 0.72 * t3),) * 3)

    # THE POLLEN BASKETS: a loaded clump on the outside of each hind leg. Small, but it is the detail that says
    # this animal has been working rather than that somebody painted a dog yellow.
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        y = side * (d["leg_gap"] + d["leg"][1] * 0.5 + 0.5)
        figure.slab(name, "honey", (0.2, y, d["torso_z"] - th * 0.5 - 3.2), (2.0, 1.5, 2.6), tile=tile)
        figure.box(name, "amber", (0.9, y, d["torso_z"] - th * 0.5 - 3.2), (tile * 0.9, tile * 1.0, tile * 1.4))
    return figure


# ============================================================================ THE 2026-09-29 ROSTER
#
# FOUNDER, 2026-09-29, SKIN ROSTER UPDATE: "REMOVE / REPLACE: 1. Arden Infernal 2. Apollo. REPLACE THEM WITH:
# 1. JACK FLAME RELAY DOG 2. BAAL RELAY DOG ... These are replacements, NOT additional roster slots." The premium
# roster is now Relay OG, Celestial Light, Skeleton Flame, Jack Flame and Baal. The two sheets are the visual
# authority and are kept beside the others: RelaySkins/_reference/JackFlame_reference_2026-09-29.png and
# RelaySkins/_reference/Baal_reference_2026-09-29.jpg.
#
# THE CANONICAL RULE, restated with the order: "Every skin must preserve the canonical Relay Dog body type. The skin
# is a costume/material/accessory transformation wrapped around the Relay Dog -- do NOT replace the underlying
# character silhouette with a humanoid or a different creature." So both builders call base_dog() first, exactly as
# every other skin does, and everything below is dress laid over that body: no limb is lengthened, no head is
# replaced, and the visor with its two status panes stays where the canonical Dog carries it.
#
# ARDEN INFERNAL AND APOLLO ARE UNREGISTERED, NOT DELETED -- the Bee/Hagoromo precedent. Their builders stay and the
# forge still writes their figures, so nothing reusable is destroyed; the runtime registry no longer offers them and
# migrates anyone wearing them (arden_infernal* -> jack_flame, apollo* -> baal; WonderlandRelaySkins.cpp).

#: JACK FLAME'S EYES: the sheet's amber panes in the black visor.
JACK_EYES = (1.00, 0.66, 0.10)
#: BAAL'S EYES AND FIRE: the one blue the sheet lights it with -- eyes, flames, feet.
BAAL_SOUL = (0.30, 0.66, 1.00)


def simple_tail(figure, material, tile, flame_mats=None):
    """THE SIMPLE SINGLE-LINE RELAY DOG TAIL: one block thick, straight out behind the hip, then up once.

    Jack Flame's sheet draws it in its SINGLE LINE TAIL inset -- a white L of cubes with a flame at its end -- and the
    Baal order asks for "the simple canonical Relay Dog tail rather than a large decorative tail". One function, so
    the two skins carry the same tail and neither grows an ornament.
    """
    d = DOG
    td, tw, th = d["torso"]
    hip = d["torso_z"] - th * 0.5
    root = (-td * 0.5 - 0.3, 0.0, hip + 1.2)
    figure.part("tail", "body", root, "tail", 4.0, 6.0)
    pts = [(root[0] - 0.95 * (k + 1), 0.0, root[2]) for k in range(4)]
    corner = pts[-1]
    pts += [(corner[0] - 0.35, 0.0, corner[2] + 0.95 * (k + 1)) for k in range(4)]
    for k, p in enumerate(pts):
        s = tile * (0.95 if k < 6 else 0.82)
        figure.box("tail", material, p, (s, s, s))
    tip = (pts[-1][0], 0.0, pts[-1][2] + 0.55)
    if flame_mats:
        figure.part("tailfire", "tail", tip, "twinkle", 0.45)
        figure.flame("tailfire", lambda up: flame_mats[0] if up < 0.5 else flame_mats[1], tip, 4.8, 2.2, 4, tile * 0.9)
    return tip


def pinstripe_block(figure, part, centre, size, tile, faces=("+x", "-x", "+y", "-y"), pitch=0.85, cloth="suit", stripe="stripe"):
    """A BLOCK OF BLACK PINSTRIPE CLOTH: a suit slab with thin white lines running down the faces named.

    The sheet's CLASSIC JACK OUTFIT is the pinstripe as much as the black: every sleeve, lapel panel and trouser leg
    carries fine white verticals. A line one tenth of a block proud of the cloth reads as a stripe from the 3/4 view
    without thickening the silhouette."""
    cx, cy, cz = centre
    sx, sy, sz = size
    figure.slab(part, cloth, centre, size, tile=tile)
    for face in faces:
        axis, sign = face[1], (1.0 if face[0] == "+" else -1.0)
        span = sy if axis == "x" else sx
        n = max(1, int(span / pitch))
        for i in range(n):
            t = (i + 0.5) / n - 0.5
            if axis == "x":
                p = (cx + sign * (sx * 0.5 + 0.04), cy + t * span, cz)
                figure.box(part, stripe, p, (0.10, 0.16, sz * 0.98))
            else:
                p = (cx + t * span, cy + sign * (sy * 0.5 + 0.04), cz)
                figure.box(part, stripe, p, (0.16, 0.10, sz * 0.98))


def jack_flame():
    """JACK FLAME RELAY DOG -- "SAME SOUL. NEW FLAME." Written from the founder's sheet (2026-09-29).

    The sheet's inventory, in the order it is built:
      FLAMING HEAD       orange infernal fire rising off the crown and the ears. The FACE stays clear, so the visor
                         and its two amber panes read exactly as the Relay Dog's own -- with the stitched grin under
                         them that the FLAMING HEAD inset shows.
      NIGHTMARE COLLAR   a wide fan of black spikes at the neck, edged white, with a burning heart at its centre.
      CLASSIC JACK OUTFIT  a black pinstripe suit: jacket open in a white V, sleeves, trousers.
      FLAME PAWS         both hands in orange fire.
      FLAME FEET         both feet in orange fire (every view of the sheet stands the Dog in fire).
      SINGLE LINE TAIL   the simple white tail, with a flame at its end.
    """
    figure = start("RELAY DOG SKIN -- JACK FLAME", 7301, JACK_EYES, 7.5)
    # AND THE SUIT FOLLOWS THE SECONDARY TOO (founder, 2026-09-30: "The Jack Flame secondary color must now control ALL
    # THREE: flames, tie, suit ... while preserving material detail/readability"). `secondary_deep` gives the cloth a deep
    # shade of the chosen colour (WonderlandMascotStyle::DeepAccentColour): at the authored near-black brightness any hue
    # would still read black. The pinstripes stay white on it, and the NIGHTMARE COLLAR -- a separate item on the sheet --
    # keeps its own black ("nightmare"), so the tie still sits on a black knot whatever colour the suit is.
    figure.material("suit", "lit", (0.034, 0.032, 0.040), 1.0, channel="secondary_deep")
    figure.material("stripe", "lit", (0.780, 0.760, 0.720), 1.0)
    # ORANGE, NOT YELLOW. The first in-engine sheet (zzS06) rendered the fire YELLOW and the heart a yellow slab: the
    # engine's real-fire surfaces lift a flame's colour toward white, so the colour has to be authored deeper and
    # more saturated than the orange the sheet shows, and the heart dimmer, so it stays red rather than blooming.
    # THE TIE FOLLOWS THE SECONDARY, THE FIRE THE FLAME COLOUR (founder, 2026-10-01: "Jack Flame: Secondary Color controls
    # suit/tie customization; Flame Color controls head flames, hand flames, foot flames, tail-tip flame; preserve
    # accepted head treatment"). It replaces 2026-09-29's "the SECONDARY COLOR customization must control BOTH the FLAMES
    # and the RED TIE": the tie -- the burning heart on the collar -- stays `secondary`, and the fire moves to its own
    # row. The pale inner flame keeps its lighter core in whatever colour is chosen.
    figure.material("flame", "glow", (1.00, 0.20, 0.02), 0.55, channel="flame")
    figure.material("flamepale", "glow", (1.00, 0.44, 0.06), 0.85, channel="flame_light")
    figure.material("heart", "glow", (0.95, 0.08, 0.02), 0.6, channel="secondary")
    figure.material("nightmare", "lit", (0.034, 0.032, 0.040), 1.0)
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    td, tw, th = d["torso"]
    hd, hw, hh = d["head"]
    ad, aw, ah = d["arm"]
    ld, lw, lh = d["leg"]
    ed, ew, eh = d["ear"]
    head_top = d["head_z"] + hh * 0.5
    torso_top = d["torso_z"] + th * 0.5
    hip = d["torso_z"] - th * 0.5
    fire = lambda up: "flame" if up < 0.52 else "flamepale"      # noqa: E731

    # ================================================================== FLAMING HEAD
    # Rows of tongues across the crown, tallest at the back and the middle, the front row short so the face and the
    # visor are never behind fire ("Preserve the Relay Dog visor/eye identity underneath the costume treatment").
    # THIS IS THE ACCEPTED HEAD, AND IT STAYS (founder, 2026-09-30): a whole-head burn was built and reverted the same
    # night -- "The head-flame redesign request is CANCELLED ... restore the original head treatment". Keep this one part.
    figure.part("headfire", "head", (0.0, 0.0, head_top), "twinkle", 0.16)
    # THE EARS STAY READABLE INSIDE THE FIRE. Round 1 ran a row of tongues straight through the ear posts (x 0) and
    # the ears vanished into a band of orange; the sheet shows them standing white inside the blaze. So the tall
    # rows burn BEHIND the ears, one low row burns in front of them, and the tongues are fatter so they read as fire
    # rather than as a comb.
    for x, tall, width, tongues in ((-3.4, 8.8, hw * 0.94, 6), (-1.9, 7.4, hw * 0.98, 6), (2.5, 3.0, hw * 0.62, 4)):
        figure.flame("headfire", fire, (x, 0.0, head_top - 0.2), tall, width, tongues, tile * 1.35)
    for side in (-1.0, 1.0):
        y = side * (hw * 0.5 - ew * 0.9)
        # the ears burn too: a tongue off each ear post, so they stay readable as ears inside the fire
        figure.flame("headfire", fire, (0.0, y, head_top + eh * 0.9), 3.6, 1.6, 3, tile * 0.9)
        # and the fire runs down the back corners of the head, as on the side and rear views
        figure.flame("headfire", fire, (-hd * 0.45, side * (hw * 0.5 - 0.3), d["head_z"] + 0.6), 4.6, 1.4, 2, tile * 0.95)
    # THE STITCHED GRIN, under the visor: a black seam across the lower face, its ends turned up, crossed by stitches.
    visor_z = d["head_z"] - hh * 0.07
    grin_z = d["head_z"] - hh * 0.34
    for k in range(13):
        y = -2.9 + k * (5.8 / 12.0)
        figure.box("head", "visor", (hd * 0.5 + 0.08, y, grin_z + 0.30 * (y / 2.9) ** 2), (0.16, 0.52, 0.26))
    for k in range(7):
        y = -2.4 + k * 0.8
        figure.box("head", "visor", (hd * 0.5 + 0.10, y, grin_z + 0.30 * (y / 2.9) ** 2), (0.16, 0.18, 0.95))

    # ================================================================== NIGHTMARE COLLAR
    collar_z = torso_top - 0.2
    figure.part("collar", "body", (0.4, 0.0, collar_z), "none")
    # BROAD BLADES, NOT WHISKERS. Round 1 drew each spike 0.66 across and about one block tall, and from the front the
    # collar read as a spray of thin lines. The sheet's NIGHTMARE COLLAR is a fan of wide black bat-wing blades that
    # overlap at the throat into one dark mass, each edged in white. So each blade is now tall at its root, tapering
    # to a point, overlapping its neighbours, and fans both up past the jaw and down over the shoulders.
    for side in (-1.0, 1.0):
        for i, (deg, length) in enumerate(((-38.0, 5.6), (-22.0, 7.0), (-8.0, 8.2), (6.0, 8.8), (19.0, 8.4), (32.0, 7.2), (45.0, 5.8))):
            a = math.radians(deg)
            steps = max(5, int(round(length / 0.55)))
            for s in range(steps):
                f = (s + 0.5) / steps
                r = 1.0 + f * length
                tall = 1.70 * (1.0 - f) ** 0.8 + 0.30
                p = (0.9 - 0.6 * f - (i % 2) * 0.4, side * r * math.cos(a), collar_z + r * math.sin(a))
                figure.box("collar", "nightmare", p, (0.9, 0.62, tall))
                # the white edge along the top of each blade: the sheet's collar is black lined in white
                if s % 2 == 0 and f < 0.92:
                    figure.box("collar", "stripe", (p[0] + 0.12, p[1], p[2] + tall * 0.5), (0.7, 0.58, 0.12))
    # THE BURNING HEART AT THE COLLAR'S CENTRE, where the blades meet -- set on a black bow-knot so it reads as the
    # collar's jewel and not as something hanging from the chin (round 1), and BELOW the head's underside (z 15.7):
    # the head overhangs to x 4.1 and would otherwise swallow it.
    heart = (td * 0.5 + 1.15, 0.0, torso_top - 1.9)
    figure.box("collar", "nightmare", (heart[0] - 0.45, 0.0, heart[2] + 0.2), (0.9, 3.4, 2.8))
    for dy in (-1.0, 1.0):
        figure.box("collar", "nightmare", (heart[0] - 0.35, dy * 1.9, heart[2] + 0.25), (0.8, 1.2, 2.2))
    # a heart in five blocks: two lobes, a broad middle, and the point
    for (dy, dz, sy, sz) in ((-0.52, 0.55, 0.95, 0.85), (0.52, 0.55, 0.95, 0.85), (0.0, 0.05, 1.9, 0.95), (0.0, -0.62, 1.15, 0.6), (0.0, -1.05, 0.5, 0.45)):
        figure.box("collar", "heart", (heart[0] + 0.1, dy, heart[2] + dz), (0.5, sy, sz))

    # ================================================================== CLASSIC JACK OUTFIT
    jz = d["torso_z"] - 0.2
    jh = th + 0.8
    pinstripe_block(figure, "body", (-td * 0.5 - 0.30, 0.0, jz), (0.6, tw + 1.2, jh), tile, faces=("-x",))
    for side in (-1.0, 1.0):
        pinstripe_block(figure, "body", (0.0, side * (tw * 0.5 + 0.30), jz), (td + 1.2, 0.6, jh), tile, faces=("+y" if side > 0 else "-y",))
    # THE FRONT, OPEN IN A V: the white V is the Dog's own bone torso showing through -- the shirt of the sheet.
    rows = int(round(jh))
    v_top, v_bottom = jz + jh * 0.5, d["torso_z"] - 1.2
    for r in range(rows):
        z = jz - jh * 0.5 + r + 0.5
        vh = 1.45 * max(0.0, (z - v_bottom) / (v_top - v_bottom))
        for side in (-1.0, 1.0):
            inner, outer = vh, tw * 0.5 + 0.6
            if outer - inner < 0.2:
                continue
            yc = side * (inner + outer) * 0.5
            figure.box("body", "suit", (td * 0.5 + 0.30, yc, z), (0.6, outer - inner, 1.02))
            if vh > 0.05:
                # the lapel: a fold proud of the jacket along the V, edged white
                figure.box("body", "suit", (td * 0.5 + 0.66, side * (inner + 0.28), z), (0.22, 0.56, 1.02))
                figure.box("body", "stripe", (td * 0.5 + 0.80, side * (inner + 0.04), z), (0.10, 0.12, 1.02))
            y = side * (inner + 0.75)
            while abs(y) < outer - 0.2:
                figure.box("body", "stripe", (td * 0.5 + 0.64, y, z), (0.10, 0.16, 1.0))
                y += side * 0.85
    # two buttons at the bottom of the V
    for k in range(2):
        figure.box("body", "stripe", (td * 0.5 + 0.66, 0.0, v_bottom - 0.9 - k * 1.3), (0.2, 0.42, 0.42))
    # SLEEVES and TROUSERS, on the canonical limbs. The hands and feet stay out of the cloth: they are fire.
    for side, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        y = side * (tw * 0.5 + 0.55 + aw * 0.5)
        pz = d["torso_z"] + th * 0.34
        pinstripe_block(figure, name, (0.0, y, pz - ah * 0.22), (ad + 0.6, aw + 0.6, ah * 0.48), tile)
        pinstripe_block(figure, name + "_fore", (0.0, y, pz - ah * 0.66), (ad + 0.5, aw + 0.5, ah * 0.36), tile)
        # FLAME PAWS: the hand wrapped in fire -- a burning block round it and tongues climbing off it
        pf = "pawfire_%s" % ("l" if side < 0 else "r")
        wrist = pz - ah * 0.95
        figure.part(pf, name + "_fore", (0.0, y, wrist), "twinkle", 0.30 + 0.2 * side)
        # A FIST OF FIRE, bigger than the hand (the FLAME PAWS inset): a burning block round the paw, fingers of flame
        # below it, and tongues climbing the cuff.
        for dx in (-0.75, 0.0, 0.75):
            for dy in (-0.75, 0.75):
                for dz in (-0.7, 0.2):
                    figure.box(pf, "flame" if dz < 0 else "flamepale", (dx * 1.1, y + dy * 1.1, wrist + dz), (1.05, 1.1, 1.0))
        for k in range(3):
            figure.box(pf, "flame", (0.6 + 0.3 * k, y + (k - 1) * 0.7, wrist - 1.5), (0.7, 0.6, 0.9))
        figure.flame(pf, fire, (0.0, y, wrist + 0.9), 5.2, 2.8, 5, tile * 1.0)
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        y = side * d["leg_gap"]
        pinstripe_block(figure, name, (0.0, y, hip - lh * 0.26), (ld + 0.5, lw + 0.5, lh * 0.56), tile)
        pinstripe_block(figure, name + "_shin", (0.0, y, hip - lh * 0.66), (ld + 0.4, lw + 0.4, lh * 0.36), tile)
        # FLAME FEET: the foot as a block of fire, and fire standing up off it
        ff = "footfire_%s" % ("l" if side < 0 else "r")
        figure.part(ff, name + "_shin", (0.0, y, hip - lh + 0.4), "twinkle", 0.55 + 0.2 * side)
        # the whole foot in fire: round 1 left the bone sole showing under the flame blocks
        for dx in (-1.0, 0.2, 1.4):
            for dy in (-0.8, 0.8):
                figure.box(ff, "flame", (ld * 0.30 + dx, y + dy, hip - lh + 0.5), (1.35, 1.65, 1.15))
        figure.flame(ff, fire, (ld * 0.35, y, hip - lh + 1.1), 3.8, 2.8, 5, tile * 0.95)
        figure.flame(ff, fire, (-0.8, y, hip - lh + 1.0), 2.6, 2.0, 3, tile * 0.85)

    # ================================================================== SINGLE LINE TAIL
    simple_tail(figure, "bone", tile, flame_mats=("flame", "flamepale"))
    return figure


def baal():
    """BAAL RELAY DOG -- "SHADOWS HUNT. SIGNAL NEVER DIES." Written from the founder's sheet (2026-09-29).

    The sheet's inventory, in the order it is built:
      DEER SKULL MASK   an oversized, full-face skeletal deer skull over the Relay Dog's face, with great branching
                        antlers. The rear view shows the plain canonical head and ears behind it, so the mask is worn
                        ON the head, not in place of it.
      GLOWING BLUE EYES in the skull's sockets -- the Dog's own status panes, carried forward to the socket mouth.
      CURSED ARMOR      dark layered ritual armour: patchwork plates of bone on near-black, a long tattered skirt of
                        dark layers to below the knee.
      RITUAL BONES / ARCANE CHARM  a gold chain down the chest to a bone skull charm.
      SHADOW ENERGY     blue supernatural flame up both flanks, around the head and at the forearms; feet of blue light.
      TAIL              the simple canonical tail, and nothing decorative on it.
    """
    figure = start("RELAY DOG SKIN -- BAAL", 7302, BAAL_SOUL, 8.0)
    figure.material("armor", "lit", (0.075, 0.085, 0.120), 1.0)
    figure.material("armordeep", "lit", (0.030, 0.034, 0.050), 1.0)
    figure.material("antler", "rim", (0.800, 0.660, 0.420), 1.0)
    figure.material("gold", "rim", (0.905, 0.720, 0.290), 1.0)
    # DEEP BLUE, NOT ICE. The first in-engine sheet (zzS06) rendered the fire pale ice-blue: the real-fire surfaces
    # lift toward white, so the sheet's saturated blue is authored deeper and less bright than it looks.
    # AND IT FOLLOWS THE FLAME COLOUR (founder, 2026-10-01: "Baal: Flame Color controls supernatural blue-flame layer
    # independently of armor/body colors"). The armour, antlers, gold and bone carry no tag.
    figure.material("spirit", "glow", (0.06, 0.28, 1.00), 0.6, channel="flame")
    figure.material("spiritpale", "glow", (0.30, 0.60, 1.00), 0.9, channel="flame_light")
    base_dog(figure)
    d = DOG
    tile = d["tile"]
    td, tw, th = d["torso"]
    hd, hw, hh = d["head"]
    ad, aw, ah = d["arm"]
    ld, lw, lh = d["leg"]
    head_top = d["head_z"] + hh * 0.5
    torso_top = d["torso_z"] + th * 0.5
    hip = d["torso_z"] - th * 0.5
    shoulder = d["torso_z"] + th * 0.48
    visor_z = d["head_z"] - hh * 0.07
    blue = lambda up: "spirit" if up < 0.55 else "spiritpale"      # noqa: E731

    def patchwork(part, centre, size, seed, bone_share=0.42, cell=0.9):
        """CURSED ARMOUR: a plate built as a patchwork of cells, bone on near-black, as every limb of the sheet is."""
        rng = random.Random(seed)
        cx, cy, cz = centre
        sx, sy, sz = size
        nx, ny, nz = max(1, int(round(sx / cell))), max(1, int(round(sy / cell))), max(1, int(round(sz / cell)))
        for ix in range(nx):
            for iy in range(ny):
                for iz in range(nz):
                    if 0 < ix < nx - 1 and 0 < iy < ny - 1 and 0 < iz < nz - 1:
                        continue
                    roll = rng.random()
                    mat = "bone" if roll < bone_share else ("armor" if roll < 0.80 else "armordeep")
                    p = (cx - sx * 0.5 + sx * (ix + 0.5) / nx, cy - sy * 0.5 + sy * (iy + 0.5) / ny, cz - sz * 0.5 + sz * (iz + 0.5) / nz)
                    figure.box(part, mat, p, (sx / nx * 1.01, sy / ny * 1.01, sz / nz * 1.01))

    # ================================================================== DEER SKULL MASK
    face = hd * 0.5
    figure.part("mask", "head", (face, 0.0, d["head_z"]), "none")
    socket_half = 0.95
    step = 0.6
    ny, nz = 13, 11
    # A SKULL, NOT A SECOND FACE. Round 1 laid the plate across the full width of the head, and from the front the mask
    # read as another box head. A deer's skull is wide at the brow and narrows hard toward the muzzle, so the plate
    # keeps the full width only down to the sockets and draws in below them into the snout.
    for iy in range(ny):
        for iz in range(nz):
            y = -3.6 + iy * step
            z = visor_z - 1.35 + iz * step
            if any(abs(y - s * d["eye_gap"]) < socket_half and abs(z - visor_z) < socket_half for s in (-1.0, 1.0)):
                continue
            if abs(y) > 3.0 and z > head_top - 0.6:
                continue                                        # the cranium's rounded upper corners
            half = 3.9 if z >= visor_z - 0.4 else 3.9 - (visor_z - 0.4 - z) * 1.6
            if abs(y) > half:
                continue                                        # the skull drawing in below the sockets
            figure.box("mask", "bone", (face + 0.45, y, z), (0.9, step * 1.02, step * 1.02))
    # the brow ridge over the sockets, and the dark rims inside them
    for s in (-1.0, 1.0):
        figure.box("mask", "bone", (face + 1.0, s * d["eye_gap"], visor_z + 1.25), (0.5, 2.3, 0.5))
        figure.box("mask", "armordeep", (face + 0.85, s * d["eye_gap"], visor_z - 1.05), (0.4, 1.9, 0.2))
        # THE STATUS EYES, IN THE SOCKETS. The panes base_dog set in the visor stay where they are; these are the same
        # material ("eye": the runtime drives them as the status eyes), the same size, height and spacing, brought
        # forward so the skull does not bury them -- but no further than INSIDE the socket (founder correction,
        # 2026-10-01). They used to stand at the socket MOUTH, face 1.10 against the skull's 0.90 -- 0.20 proud of the
        # bone, with a halo over the bone round it -- the "eyes floating in front of the square" the founder saw. Laid
        # now by status_eyes like every skin's eyes: behind the skull's face, black all round, the halo in the socket.
        sy = s * d["eye_gap"]
        status_eyes(figure, "mask", face + 0.9, (sy - socket_half, sy + socket_half, visor_z - socket_half, visor_z + socket_half),
                    [(sy, visor_z)])
    # THE SNOUT: long, narrowing and angled down and forward over the chest, as a deer's skull is.
    for k in range(9):
        z = visor_z - 1.5 - k * 0.62
        w = 3.8 - k * 0.34
        x = face + 0.7 + k * 0.16
        figure.box("mask", "bone", (x, 0.0, z), (1.15, w, 0.66))
        if 1 <= k <= 3:
            for s in (-1.0, 1.0):
                figure.box("mask", "armordeep", (x + 0.6, s * 0.55, z), (0.14, 0.42, 0.62))   # the nasal openings
        if k >= 7:
            for t in range(3):
                figure.box("mask", "armordeep", (x + 0.6, (t - 1) * 0.55, z - 0.2), (0.14, 0.2, 0.4))  # the teeth
    figure.box("mask", "bone", (face + 1.25, 0.0, visor_z - 2.6), (0.4, 0.7, 3.6))           # the nasal ridge
    # THE ANTLERS: a main beam out and up from each temple, with tines off its upper side.
    figure.part("antlers", "head", (0.0, 0.0, head_top), "none")
    # A HEAVY BEAM THAT SWEEPS OUT AND THEN UP, with long tines -- round 1's beam was a thin ladder of cubes.
    for s in (-1.0, 1.0):
        beam = []
        n = 16
        for k in range(n):
            f = k / (n - 1.0)
            y = s * (2.6 + 6.2 * math.sin(f * math.pi * 0.55))
            z = head_top + 0.3 + 8.8 * f ** 1.15
            x = face - 1.5 - 2.2 * f
            beam.append((x, y, z))
            size = 1.45 - 0.70 * f
            figure.box("antlers", "antler", (x, y, z), (size, size, size * 1.1))
        for k, length, lean in ((4, 3.8, 0.35), (7, 4.4, 0.20), (10, 4.0, 0.05), (13, 3.2, -0.10), (15, 2.4, -0.2)):
            bx, by, bz = beam[k]
            steps = int(length / 0.5)
            for t in range(steps):
                f = (t + 1) * 0.5
                w = 0.85 - 0.45 * t / max(steps - 1, 1)
                figure.box("antlers", "antler", (bx + lean * f, by + s * 0.12 * f, bz + f), (w, w, 0.55))
        # a brow tine forward over the mask, as the front view shows
        for t in range(4):
            figure.box("antlers", "antler", (face - 0.6 + t * 0.55, s * 2.8, head_top + 0.4 + t * 0.35), (0.62, 0.62, 0.62))

    # ================================================================== CURSED ARMOR
    ch = th + 0.6
    patchwork("body", (-td * 0.5 - 0.35, 0.0, d["torso_z"]), (0.7, tw + 1.4, ch), 11, bone_share=0.25)
    for s in (-1.0, 1.0):
        patchwork("body", (0.0, s * (tw * 0.5 + 0.35), d["torso_z"]), (td + 1.4, 0.7, ch), 12 + int(s), bone_share=0.25)
    # the front: dark layered bands, each a little prouder than the one above it, as the plate steps down the chest
    for k in range(7):
        z = torso_top - 0.6 - k * 1.05
        figure.box("body", "armor" if k % 2 == 0 else "armordeep", (td * 0.5 + 0.35 + 0.05 * k, 0.0, z), (0.7, tw + 1.2 + 0.1 * k, 1.0))
    # layered pauldrons: three plates stepping down and out over each shoulder, patchwork like the sheet's
    for s in (-1.0, 1.0):
        for k in range(3):
            patchwork("body", (0.1 - 0.2 * k, s * (tw * 0.5 + 1.6 + 0.45 * k), shoulder + 0.9 - 1.0 * k), (4.4 - 0.3 * k, 3.2, 0.9), 30 + k + int(3 * s), bone_share=0.5)
    # ARCANE CHARM: a gold chain from each shoulder to the sternum, one link down the middle, a bone skull at the end
    sternum = (td * 0.5 + 1.0, 0.0, torso_top - 2.3)
    for s in (-1.0, 1.0):
        figure.chain_run("body", "gold", (td * 0.5 + 0.9, s * (tw * 0.5 + 0.2), torso_top - 0.3), sternum, tile * 0.8, sag=0.5, link=tile * 0.7)
    figure.chain_run("body", "gold", sternum, (sternum[0] + 0.2, 0.0, sternum[2] - 2.6), tile * 0.8, link=tile * 0.7)
    figure.skull_emblem("body", {"bone": "bone", "dark": "armordeep"}, (sternum[0] + 0.6, 0.0, sternum[2] - 4.4), 2.8, tile * 0.7, deep="dark")
    # sleeves and leggings of the same patchwork on the canonical limbs; hands stay the Dog's own
    for s, name in ((-1.0, "arm_l"), (1.0, "arm_r")):
        y = s * (tw * 0.5 + 0.55 + aw * 0.5)
        pz = d["torso_z"] + th * 0.34
        patchwork(name, (0.0, y, pz - ah * 0.22), (ad + 0.6, aw + 0.6, ah * 0.48), 40 + int(s))
        patchwork(name + "_fore", (0.0, y, pz - ah * 0.66), (ad + 0.5, aw + 0.5, ah * 0.36), 42 + int(s))
        # SHADOW ENERGY at the forearm, climbing off the elbow
        af = "armfire_%s" % ("l" if s < 0 else "r")
        figure.part(af, name, (0.0, y, pz - ah * 0.46), "twinkle", 0.34 + 0.2 * s)
        figure.flame(af, blue, (-0.8, y + s * 1.3, pz - ah * 0.60), 4.4, 2.4, 4, tile * 0.9)
    for s, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        y = s * d["leg_gap"]
        patchwork(name, (0.0, y, hip - lh * 0.26), (ld + 0.5, lw + 0.5, lh * 0.56), 50 + int(s), bone_share=0.35)
        patchwork(name + "_shin", (0.0, y, hip - lh * 0.66), (ld + 0.4, lw + 0.4, lh * 0.36), 52 + int(s), bone_share=0.35)
        # FEET OF BLUE LIGHT: the sheet stands Baal on two glowing blocks with fire at their edges
        ff = "footfire_%s" % ("l" if s < 0 else "r")
        figure.part(ff, name + "_shin", (0.0, y, hip - lh + 0.4), "twinkle", 0.50 + 0.2 * s)
        figure.slab(ff, "spiritpale", (ld * 0.30, y, hip - lh + 0.45), (ld * 1.5, lw * 1.2, 0.9), tile=tile)
        figure.flame(ff, blue, (ld * 0.30, y, hip - lh + 0.95), 2.6, 2.6, 4, tile * 0.85)
    # THE TATTERED SKIRT: long dark layers from the waist to below the knee, all the way round, ragged at the hem
    rng = random.Random(7302)
    figure.part("skirt", "body", (0.0, 0.0, hip + 0.6), "trail", 0.5)
    strands = 26
    for k in range(strands):
        a = 2.0 * math.pi * (k + 0.5) / strands
        rx, ry = td * 0.5 + 0.9, tw * 0.5 + 1.0
        drop = 5.0 + 1.6 * rng.random() + (0.8 if math.cos(a) < 0 else 0.0)
        mat = "armor" if k % 3 else "armordeep"
        steps = int(round(drop / 0.9))
        for sidx in range(steps):
            f = sidx / max(steps - 1, 1)
            flare = 1.0 + 0.35 * f
            x = math.cos(a) * rx * flare
            y = math.sin(a) * ry * flare
            z = hip + 0.3 - 0.9 * sidx
            w = 1.25 * (1.0 - 0.35 * f)
            figure.box("skirt", mat, (x, y, z), (w, w, 0.95))
    # SHADOW ENERGY up both flanks and round the back of the head -- the sheet's blue fire framing the figure
    for s in (-1.0, 1.0):
        name = "flankfire_%s" % ("l" if s < 0 else "r")
        y = s * (tw * 0.5 + aw + 2.3)
        figure.part(name, "body", (0.0, y, shoulder - 2.0), "twinkle", 0.40 + 0.22 * s)
        figure.flame(name, blue, (-1.6, y, hip - 1.0), 9.0, 4.4, 7, tile * 1.05)
        figure.flame(name, blue, (-2.8, y + s * 1.2, hip + 2.0), 6.0, 3.4, 5, tile * 0.95)
    figure.part("headfire", "head", (-hd * 0.5, 0.0, head_top), "twinkle", 0.20)
    for s in (-1.0, 1.0):
        figure.flame("headfire", blue, (-hd * 0.30, s * (hw * 0.5 + 0.6), d["head_z"] - 1.0), 7.5, 2.6, 5, tile * 1.0)
    figure.flame("headfire", blue, (-hd * 0.45, 0.0, head_top - 0.4), 5.0, hw * 0.8, 6, tile * 1.0)

    # ================================================================== THE SIMPLE CANONICAL TAIL
    simple_tail(figure, "bone", tile)
    return figure


# ============================================================================ the sub-agent cub

# ============================================================================ the cubs, one per skin
#
# FOUNDER, 2026-09-27: "Every mascot skin must have a corresponding Sub-Agent Cub. The Cub should look like a
# SMALLER CHILD/CUB VERSION OF THAT EXACT MASCOT SKIN ... The player should immediately be able to look at a
# Cub and know: that is the Skeleton Flame Cub." And in the same breath: "The Cub remains a Cub: smaller,
# compact, subordinate visual scale. Do NOT simply scale the full adult mascot mesh down."
#
# So the cub keeps the founder's own cub morphology -- the floating head, the two ball hands, the ghost tail,
# from the RELAY DOG CUBS / SUB AGENTS plate -- and wears its parent's IDENTITY on that body: the parent's
# eye colour and glow, its coat, its signature head-mounted features scaled to the cub (a flaming gold ring,
# a crown of solar fire, a brow skull and ghostfire, a radiant edge and a brow star), and a tail in the
# parent's own light. VFX are built at the cub's scale, never the adult's, so nothing hides the cub's body.
# Relay OG's cub is the plate's cub unchanged: white body, black visor, warm gold eyes.
CUB_SKINS = {
    #             file stem         eyes                  coat                    coat deep              tail light
    "relay_og":        ("",               (1.00, 0.80, 0.34), (0.965, 0.960, 0.945), (0.800, 0.800, 0.800), (0.98, 0.96, 0.90)),
    "arden_infernal":  ("ArdenInfernal",  (1.00, 0.58, 0.10), BONE,                  BONE_DEEP,             (1.00, 0.46, 0.08)),
    "apollo":          ("Apollo",         (1.00, 0.86, 0.26), BONE,                  BONE_DEEP,             (1.00, 0.80, 0.30)),
    "skeleton_flame":  ("SkeletonFlame",  SKELETON_SOUL,      BONE,                  BONE_DEEP,             (0.40, 0.85, 1.00)),
    "celestial_light": ("CelestialLight", (0.62, 0.88, 1.00), (0.930, 0.960, 1.000), (0.720, 0.820, 1.000), (0.80, 0.92, 1.00)),
    # 2026-09-29 roster. APPENDED, NOT INSERTED: a cub's seed is its skin's index in this dict, so an entry placed
    # anywhere else would re-seed every cub after it and quietly change Skeleton Flame's and Celestial Light's.
    "jack_flame":      ("JackFlame",      JACK_EYES,          BONE,                  BONE_DEEP,             (1.00, 0.46, 0.08)),
    "baal":            ("Baal",           BAAL_SOUL,          BONE,                  BONE_DEEP,             (0.35, 0.66, 1.00)),
}


def dress_cub(figure, skin, k, head_z, hd, hw, hh, tile):
    """The parent skin's signature, at the cub's scale, on the cub's head. Nothing here touches the eyes."""
    top = head_z + hh * 0.5
    if skin == "arden_infernal":
        figure.material("gold", "rim", (0.905, 0.720, 0.290), 1.0)
        figure.material("ember", "glow", (1.00, 0.34, 0.05), 0.6)
        figure.material("emberpale", "glow", (1.00, 0.72, 0.22), 1.0)
        figure.material("ruby", "glow", (1.00, 0.09, 0.12), 1.2)
        figure.material("char", "lit", (0.215, 0.115, 0.105), 1.0)
        # the flaming gold ring behind the head, gem at the crown, fire along the upper arc
        halo_c = (-hd * 0.40, 0.0, head_z + hh * 0.42)
        figure.part("halo", "head", halo_c, "none")
        r = hw * 0.78
        figure.ring("halo", lambda a: "gold", halo_c, r, tile * k * 1.3, tile * k * 1.0)
        figure.box("halo", "ruby", (halo_c[0] + 0.4, 0.0, halo_c[2] + r), (tile * k, tile * k * 1.6, tile * k * 2.0))
        figure.part("halofire", "halo", halo_c, "twinkle", 0.18)
        for i in range(7):
            a = math.radians(20.0 + 140.0 * i / 6.0)
            figure.flame("halofire", lambda up: "ember" if up < 0.5 else "emberpale",
                         (halo_c[0] + 0.2, math.cos(a) * (r + 0.6), halo_c[2] + math.sin(a) * (r + 0.6)),
                         2.2 + 1.6 * math.sin(a), 1.4, 2, tile * k * 0.95)
        # one chain under the chin with a ruby drop, and a char claw over the right hand
        figure.chain_run("head", "gold", (hd * 0.5 + 0.3, -hw * 0.34, head_z - hh * 0.36), (hd * 0.5 + 0.3, hw * 0.34, head_z - hh * 0.36), tile * k, sag=0.9)
        figure.pendant("head", {"gold": "gold", "gem": "ruby"}, (hd * 0.5 + 0.5, 0.0, head_z - hh * 0.36 - 0.8), tile * k, drop=0.9)
        hy = hw * 0.5 + 2.3
        for f in range(3):
            figure.box("hand_r", "char", (hd * 0.22 + 0.8, hy + (f - 1) * 0.9, head_z - hh * 0.14 - 1.6 - f * 0.2), (tile * k * 0.7, tile * k * 0.7, tile * k * 1.8))
        figure.box("hand_r", "ember", (hd * 0.22 + 0.8, hy, head_z - hh * 0.14 - 2.9), (tile * k * 0.9, tile * k * 2.2, tile * k * 0.6))
    elif skin == "apollo":
        figure.material("gold", "rim", (0.915, 0.735, 0.300), 1.0)
        figure.material("golddeep", "lit", (0.520, 0.375, 0.115), 1.0)
        figure.material("solar", "glow", (1.00, 0.36, 0.03), 0.7)
        figure.material("solarpale", "glow", (1.00, 0.78, 0.16), 1.2)
        halo_c = (-hd * 0.40, 0.0, head_z + hh * 0.55)
        figure.part("halo", "head", halo_c, "none")
        figure.ring("halo", lambda a: "gold", halo_c, hw * 0.80, tile * k * 1.2, tile * k * 0.95)
        figure.ring("halo", lambda a: "golddeep", (halo_c[0] - 0.6, 0.0, halo_c[2]), hw * 0.76, tile * k * 0.9, tile * k * 0.95)
        figure.part("crown", "head", (0.0, 0.0, top), "twinkle", 0.1)
        figure.flame("crown", lambda up: "solar" if up < 0.45 else "solarpale", (0.3, 0.0, top - 0.2), hh * 0.95, hw * 0.62, 5, tile * k * 1.1)
        # the gold gorget under the chin
        figure.slab("head", "gold", (hd * 0.30, 0.0, head_z - hh * 0.50), (hd * 0.7, hw * 0.78, tile * k * 1.3), tile=tile * k)
        figure.box("head", "solarpale", (hd * 0.5 + 0.25, 0.0, head_z - hh * 0.50), (tile * k * 0.6, tile * k * 1.4, tile * k * 1.1))
    elif skin == "skeleton_flame":
        figure.material("ghost", "glow", (0.22, 0.70, 1.00), 0.7)
        figure.material("ghostpale", "glow", (0.72, 0.94, 1.00), 1.2)
        figure.material("void", "lit", (0.030, 0.040, 0.060), 1.0)
        figure.skull_emblem("head", {"bone": "bone", "dark": "void"}, (hd * 0.5 + 0.35, 0.0, head_z + hh * 0.34), hh * 0.46, tile * k, deep="dark")
        ed, ew, eh = (v * k for v in DOG["ear"])
        figure.part("earfire", "head", (0.0, 0.0, top + eh), "twinkle", 0.14)
        for side in (-1.0, 1.0):
            y = side * (hw * 0.5 - ew * 0.9)
            figure.flame("earfire", lambda up: "ghost" if up < 0.55 else "ghostpale", (0.0, y, top + eh * 0.7), hh * 0.85, ew * 2.4, 4, tile * k * 1.05)
        for name in ("hand_l", "hand_r"):
            side = -1.0 if name.endswith("l") else 1.0
            figure.box(name, "ghostpale", (hd * 0.22, side * (hw * 0.5 + 2.3), head_z - hh * 0.14 - 1.5), (tile * k * 1.8, tile * k * 1.8, tile * k * 0.7))
    elif skin == "celestial_light":
        figure.material("edge", "glow", (0.62, 0.82, 1.00), 1.0)
        figure.material("starlight", "glow", (0.95, 0.98, 1.00), 0.8)
        hx, hy, hz = hd * 0.5, hw * 0.5, hh * 0.5
        thin = tile * k * 0.5
        for ey in (-hy, hy):
            for ez in (-hz, hz):
                figure.box("head", "edge", (0.0, ey, head_z + ez), (hd * 1.02, thin, thin))
        for ex in (-hx, hx):
            for ez in (-hz, hz):
                figure.box("head", "edge", (ex, 0.0, head_z + ez), (thin, hw * 1.02, thin))
        figure.star_burst("head", {"gold": "starlight", "gem": "starlight"}, (hd * 0.5 + 0.35, 0.0, head_z + hh * 0.33), hh * 0.34, 4, tile * k, key="gold", core="gem")
        halo_c = (-hd * 0.36, 0.0, head_z + hh * 0.25)
        figure.part("halo", "head", halo_c, "none")
        figure.ring("halo", lambda a: "edge", halo_c, hw * 0.74, tile * k * 0.9, tile * k * 0.9)
    elif skin == "jack_flame":
        # Jack's signature at the cub's scale: the crown of orange fire, the stitched grin under the visor, and a
        # small black collar with the burning heart under the chin. The cub's eyes are its expression and are never
        # covered.
        figure.material("flame", "glow", (1.00, 0.20, 0.02), 0.55)
        figure.material("flamepale", "glow", (1.00, 0.44, 0.06), 0.85)
        figure.material("suit", "lit", (0.034, 0.032, 0.040), 1.0)
        figure.material("heart", "glow", (0.95, 0.08, 0.02), 0.6)
        figure.part("headfire", "head", (0.0, 0.0, top), "twinkle", 0.16)
        figure.flame("headfire", lambda up: "flame" if up < 0.52 else "flamepale", (-0.6, 0.0, top - 0.2), hh * 1.0, hw * 0.80, 5, tile * k * 1.05)
        for r in range(9):
            y = -hw * 0.30 + r * (hw * 0.60 / 8.0)
            figure.box("head", "visor", (hd * 0.5 + 0.06, y, head_z - hh * 0.30), (0.12, hw * 0.08, tile * k * 0.22))
        for side in (-1.0, 1.0):
            for i, deg in enumerate((-20.0, 5.0, 30.0)):
                a = math.radians(deg)
                for sidx in range(4):
                    r = 0.8 + sidx * 0.55
                    figure.box("head", "suit", (0.3, side * r * math.cos(a), head_z - hh * 0.62 + r * math.sin(a)), (tile * k * 0.8, tile * k * 0.6, tile * k * (0.8 - 0.12 * sidx)))
        figure.box("head", "heart", (hd * 0.30, 0.0, head_z - hh * 0.66), (tile * k * 0.6, tile * k * 1.3, tile * k * 1.1))
    elif skin == "baal":
        # Baal's signature at the cub's scale: the deer skull's snout under the visor (the cub's eyes are its face,
        # so the skull does not cover them), the two branching antlers, and a wisp of blue fire behind the head.
        figure.material("antler", "rim", (0.800, 0.660, 0.420), 1.0)
        figure.material("spirit", "glow", (0.06, 0.28, 1.00), 0.6)
        figure.material("spiritpale", "glow", (0.30, 0.60, 1.00), 0.9)
        figure.material("socket", "lit", (0.030, 0.034, 0.050), 1.0)
        for r in range(5):
            figure.box("head", "bone", (hd * 0.5 + 0.35 + r * 0.12, 0.0, head_z - hh * 0.30 - r * 0.42), (0.7, hw * (0.52 - 0.07 * r), 0.44))
        for side in (-1.0, 1.0):
            figure.box("head", "socket", (hd * 0.5 + 0.72, side * 0.38, head_z - hh * 0.40), (0.1, 0.3, 0.5))
            for s_ in range(7):
                f = s_ / 6.0
                figure.box("head", "antler", (-0.2, side * (hw * 0.30 + 2.8 * math.sin(f * 1.4)), top + 0.2 + 3.6 * f), (tile * k * (0.9 - 0.3 * f),) * 3)
            for s_ in range(3):
                figure.box("head", "antler", (0.2, side * (hw * 0.30 + 1.6), top + 1.6 + s_ * 0.5), (tile * k * 0.55,) * 3)
        figure.part("headfire", "head", (-hd * 0.5, 0.0, top), "twinkle", 0.2)
        figure.flame("headfire", lambda up: "spirit" if up < 0.55 else "spiritpale", (-hd * 0.45, 0.0, top - 0.6), hh * 0.8, hw * 0.6, 4, tile * k * 1.0)


def cub_ghost(eyes="flat", skin="relay_og"):
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
    stem, eye_rgb, coat, coat_deep, tail_rgb = CUB_SKINS[skin]
    figure = start("RELAY DOG CUB GHOST -- SUB AGENT%s" % ((" -- " + stem.upper()) if stem else ""),
                   7100 + len(eyes) + 10 * list(CUB_SKINS).index(skin), eye_rgb, 8.0,
                   coat=coat, coat_deep=coat_deep)
    # "ghost" is the tail's light, in the parent's colour: named without "eye" or "pulse" on purpose.
    figure.material("ghost", "add", tail_rgb, 1.5)
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
        # THE CUB'S EYES GLOW LIKE THE PARENT'S: the same soft halo pane, proud of the eye, sized to the flat
        # eye's footprint whichever shape the plate draws. It is named "eyehalo" so the runtime drives it as
        # an eye at the halo share, and its face (ex + 0.27) stands in front of the eye's own (ex + 0.175).
        if "eyehalo" in figure.material_names:
            # ---- AND THE CUB'S HALO STOPS AT ITS OWN EYE, for the same reason the adults' do.
            #
            # Checked rather than assumed, because the cubs share this code path and I had only fixed the adult
            # costume. The cub's eye centre is 0.19 of the head's half width out and its eye is 0.20 wide, so a
            # halo at 2.4x centred on the eye spans -0.05 to +0.43: it crosses the centreline by 0.05 and the
            # two halos meet in the middle of a face that is mostly eyes already.
            #
            # Shifted outward and narrowed to run from the eye's inner edge to the full 2.4x reach outward,
            # exactly as the adult pane now does. The outward and vertical spill -- which is where a halo reads
            # -- is untouched, and no brightness changes anywhere.
            cub_in = hw * 0.19 - hw * 0.20 * 0.5
            cub_out = hw * 0.19 + hw * 0.20 * 2.4 * 0.5
            figure.box("head", "eyehalo",
                       (ex + 0.12, (base[1] / abs(base[1]) if base[1] else 1.0) * (cub_in + cub_out) * 0.5,
                        base[2]),
                       (0.30, cub_out - cub_in, hh * 0.13 * 2.4))
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
    # MEASURED BEFORE IT IS DRESSED, or a halo or a crown of fire would shrink the cub under it: the cub is a
    # third of the Dog and stays a third of the Dog whatever it wears, exactly as fit_to_metres does for the adult.
    figure.mark_dog_extent()
    dress_cub(figure, skin, k, head_z, hd, hw, hh, tile)
    return figure


CUB_EYES = ("flat", "arc", "slant")

# ============================================================================ SHADOW FLAME (founder, 2026-10-01)
#
#: THE EYES: strong glowing yellow, the one warm thing on the figure (sheet: two yellow squares in a black head).
SHADOW_EYES = (1.00, 0.84, 0.12)
#: THE COAT: near-black with a deep navy undertone. It is a RIM material, so its own colour, taken brighter by the strength,
#: is what catches at the silhouette's grazing edge -- a restrained midnight-blue edge on a black body, never a blue body.
SHADOW_COAT = (0.016, 0.019, 0.042)
SHADOW_COAT_DEEP = (0.009, 0.010, 0.022)
#: THE STRIPS: black. Blue may appear only as the faintest rim (founder: "Their visual identity must remain BLACK SHADOW
#: ENERGY"), so the strip material is a rim material whose colour is one step above black -- with just enough navy that its
#: grazing edge separates a black strip from a dark wall or the wardrobe's night-blue stage (the first runtime pass: invisible there).
SHADOW_STRIP = (0.010, 0.012, 0.030)
#: The few emissive accents the founder allows ("controlled dark-blue highlights; emissive accents where appropriate").
SHADOW_EDGE = (0.10, 0.26, 0.95)


def shadow_flame():
    """SHADOW FLAME RELAY DOG -- living darkness around the canonical standing Relay Dog. Founder, 2026-10-01.

    From the founder's sheet (RelaySkins/_reference/shadow_flame_sheet.png) and his three motion references:
      BODY       the canonical standing Relay Dog, unclothed: near-black with a deep navy undertone, kept readable by a
                 midnight-blue rim at the silhouette's edge and a few restrained blue accents (ear edges, soles).
      EYES       strong glowing yellow, inside the black visor like every skin's (status_eyes).
      TAIL       the simple canonical tail, in the coat.
      STRIPS     the defining feature: BLACK shadow tendrils moving autonomously round the Dog -- rising off the
                 shoulders and back, curling round the torso, passing behind the head, sweeping by the legs, trailing.
                 They are NOT boxes. Each part tagged `shadow` only says where tendrils grow (its boxes' bounds), how
                 many (a) and how long relative to the Dog (b); AWonderlandCompanionEmbodiment::RebuildShadows lays them
                 every frame as tapered black ribbons, each with its own speed, curl, height, radius, phase and
                 lifetime, trailing behind the Dog's recent path when it moves.

    No coat, robe or clothing: the founder's order is explicit ("no clothing").
    """
    figure = Figure("RELAY DOG SKIN -- SHADOW FLAME", 7501)
    # start()'s materials, with the coat's rim strength raised: at strength 1 a near-black rim is invisible.
    figure.material("bone", "rim", SHADOW_COAT, 3.2)
    figure.material("bonedeep", "lit", SHADOW_COAT_DEEP, 1.0)
    figure.material("visor", "lit", VISOR, 1.0)
    figure.material("eye", "glow", SHADOW_EYES, 7.5)
    figure.material("eyehalo", "add", SHADOW_EYES, 7.5 * 0.35)
    # RIM, like the coat: a black core whose grazing edge catches a faint navy. Measured 2026-10-02: drawn LIT, the strips
    # read in the world but VANISHED in the wardrobe (black on the stage's black) -- the founder's "faint energy edges"
    # are what lets a black strip exist against black. At (0.010, 0.014, 0.046) x 3.0 the wardrobe's showcase light turned
    # whole ribbons royal blue ("very subtle rim illumination" only), so the edge is greyer and dimmer.
    figure.material("shadow", "rim", SHADOW_STRIP, 2.4)
    figure.material("voidedge", "glow", SHADOW_EDGE, 0.30)
    base_dog(figure)          # marks the Dog's extent: nothing added below can change its height
    d = DOG
    tile = d["tile"]
    hd, hw, hh = d["head"]
    td, tw, th = d["torso"]
    simple_tail(figure, "bone", tile)

    # ---- THE FEW BLUE ACCENTS: the ears' outer edges and the soles, so the silhouette separates from a dark world.
    # EDGES, NOT PANELS: two thin vertical lines on each ear's outer corners. (A first cut laid a plate over the ear's
    # outer face; seen from the side the whole ear turned blue, which is a blue ear rather than a lit edge.)
    ed, ew, eh = d["ear"]
    for side in (-1.0, 1.0):
        y = side * (hw * 0.5 - ew * 0.9) + side * (ew * 0.5 - 0.04)
        for fx in (-1.0, 1.0):
            figure.box("head", "voidedge", (fx * (ed * 0.5 - 0.04), y, d["head_z"] + hh * 0.5 + eh * 0.50), (0.12, 0.12, eh * 0.92))
    ld, lw, lh = d["leg"]
    hip_z = d["torso_z"] - th * 0.5
    for side, name in ((-1.0, "leg_l"), (1.0, "leg_r")):
        figure.box("%s_shin" % name, "voidedge", (ld * 0.30, side * d["leg_gap"], hip_z - lh - 0.02),
                   (ld * 1.40, lw * 1.08, 0.10))

    # ---- THE SHADOW ANCHORS. Each box only bounds where its tendrils are born; none is ever drawn.
    #      part             parent  pivot (the region's centre)                              count  reach (Dog units)
    # REACH IS HOW FAR OUTSIDE THE DOG THEY GO. The first runtime pass reached 8-15 units and the strips never left the
    # silhouette -- black on black, hidden behind the head -- so they now reach well past it: up over the head, round
    # beyond the arms, out past the legs.
    back_z = d["torso_z"] + th * 0.30
    figure.part("shadow_back", "body", (-td * 0.5, 0.0, back_z), "shadow", 4, 26.0)
    figure.box("shadow_back", "shadow", (-td * 0.5, 0.0, back_z), (1.0, tw + 3.0, th * 0.45))
    figure.part("shadow_torso", "body", (0.0, 0.0, d["torso_z"]), "shadow", 4, 16.0)
    figure.box("shadow_torso", "shadow", (0.0, 0.0, d["torso_z"]), (td, tw, th * 0.6))
    figure.part("shadow_hips", "body", (-td * 0.3, 0.0, hip_z + 0.6), "shadow", 3, 14.0)
    figure.box("shadow_hips", "shadow", (-td * 0.3, 0.0, hip_z + 0.6), (td * 0.8, tw + 1.0, 1.2))
    figure.part("shadow_head", "head", (-hd * 0.35, 0.0, d["head_z"] + hh * 0.30), "shadow", 2, 18.0)
    figure.box("shadow_head", "shadow", (-hd * 0.35, 0.0, d["head_z"] + hh * 0.30), (hd * 0.4, hw * 0.8, hh * 0.3))
    return figure


SKINS = [
    ("RelayOg", relay_og),
    ("ArdenInfernalV1", arden_infernal_v1),
    ("ArdenInfernalV2", arden_infernal),
    ("ApolloV1", apollo_v1),
    ("ApolloV2", apollo),
    ("SkeletonFlameV1", skeleton_flame_v1),
    ("SkeletonFlameV2", skeleton_flame),
    ("Hagoromo", hagoromo),
    ("CelestialLight", celestial_light),
    ("Bee", bee),
    # 2026-09-29: the two replacements. One version each -- they are new skins, not redos, so there is no V1/V2 pair.
    ("JackFlame", jack_flame),
    ("Baal", baal),
    # 2026-10-01: Shadow Flame, an addition to the lineup (its black strips are drawn by the engine, see shadow_flame).
    ("ShadowFlame", shadow_flame),
]


def main():
    parser = argparse.ArgumentParser(description="Generate the Relay Dog skin figures.")
    parser.add_argument("--out", default=os.path.join("wonderland", "RelaySkins"))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for name, build in SKINS:
        figure = build()
        # THE CANONICAL BODY IS ENFORCED, NOT TRUSTED. relay_og silently shipped as a four-legged animal for a
        # whole round because nothing checked which body a skin was dressed on, and a wardrobe that offers a
        # quadruped base and bipedal skins is the defect the founder reported. Every mascot skin is built on the
        # CURRENT DEFAULT RELAY DOG -- the standing biped of base_dog -- and the build fails loudly rather than
        # writing a skin dressed on the legacy morphology.
        kind = getattr(figure, "body_kind", None)
        if kind != CANONICAL_BODY:
            raise SystemExit(
                "%s was built on body '%s', not the canonical '%s'. The current default Relay Dog is the standing\n"
                "biped (base_dog). The quadruped is the legacy RELAY OG FORM badge and must not carry a mascot skin."
                % (name, kind, CANONICAL_BODY))
        figure.fit_to_metres(TARGET_METRES)
        path = os.path.join(args.out, "%s.wlvox" % name)
        boxes, parts, materials = figure.write(path)
        print("%-22s %5d boxes  %2d parts  %2d materials  voxel %.2f uu" % (os.path.basename(path), boxes, parts, materials, figure.voxel_uu))
        # THE EYES ARE ENFORCED, NOT TRUSTED (founder correction, 2026-10-01): a figure whose status eyes stand proud of
        # its face, sit outside their black housing, or spill halo light over the coat is not written -- every skin,
        # Relay OG's wardrobe preview included.
        eyes_ok, report = skin_eye_check.check(path)
        if not eyes_ok:
            os.remove(path)
            raise SystemExit("%s: the eyes are not inside the face (skin_eye_check.py):\n  %s" % (name, "\n  ".join(report)))

    # THE CUBS. A cub is about a third of the Dog's height on the plate, which is what "cub proportions" means here.
    cubs = os.path.join(os.path.dirname(args.out), "RelayCubs")
    os.makedirs(cubs, exist_ok=True)
    # ONE CUB PER SKIN PER EXPRESSION. Relay OG's keep the plate's own file names, which the runtime has
    # always loaded; a premium skin's are CubGhost_<Skin>_<Eyes>.wlvox, and UWonderlandSubAgentCubSubsystem
    # picks the set that matches the skin the Dog is wearing.
    for skin, (stem, _e, _c, _cd, _t) in CUB_SKINS.items():
        for eyes in CUB_EYES:
            figure = cub_ghost(eyes, skin)
            figure.fit_to_metres(TARGET_METRES * 0.34)
            name = "CubGhost_%s.wlvox" % eyes.capitalize() if not stem else "CubGhost_%s_%s.wlvox" % (stem, eyes.capitalize())
            path = os.path.join(cubs, name)
            boxes, parts, materials = figure.write(path)
            print("%-34s %5d boxes  %2d parts  %2d materials  voxel %.2f uu" % (os.path.basename(path), boxes, parts, materials, figure.voxel_uu))
    mirror_to_sibling_worktrees(args.out)
    mirror_to_sibling_worktrees(cubs)


def mirror_to_sibling_worktrees(out_dir):
    """
    A FIGURE THE EDITOR CANNOT SEE IS A FIGURE THAT DOES NOT EXIST.

    UWonderlandRelaySkinSubsystem::FigurePathFor resolves to ProjectDir()/RelaySkins, so a running editor reads
    the folder of the worktree it was LAUNCHED from, not this one. Only Content is shared between the
    worktrees; RelaySkins is a separate tree in each. Regenerating here therefore leaves every other worktree
    stale, and a proof run against a stale folder photographs the PREVIOUS round and reports on it.

    That is not hypothetical: this session regenerated four figures here and left the editor worktree hours out
    of date, while the generator's own output said it had written them.

    ONLY WHERE THE FOLDER ALREADY EXISTS. A worktree without one has deliberately not got one -- the world
    lane's has no RelaySkins at all -- and creating it there would push mascot files into a tree that never
    asked for them.

    AND ONLY WHERE AN EDITOR IS ACTUALLY LAUNCHED FROM. "The folder exists" was too broad a test, and the
    integration lane found out how: its worktree is branched from THIS branch, so it has RelaySkins, so a
    regeneration here rewrote 25 TRACKED files in a tree that had not asked for them. Nothing was lost --
    they commit staged files only -- but in a worktree built from this branch my work-in-progress appears
    as ordinary modified tracked files, and one `git commit -a` there would land unfinished mascots on
    someone else's branch under someone else's name. A worktree that never launches an editor never needs
    a figure; only these do. Add a name here rather than widening the test back to "has the folder".
    """
    LAUNCHES_AN_EDITOR = ("wonderland-task3", "wonderland-proof")
    here = os.path.abspath(out_dir)
    if not os.path.isdir(here):
        return
    leaf = os.path.basename(here)
    root = os.path.dirname(os.path.dirname(os.path.dirname(here)))
    if not os.path.isdir(root):
        return
    skipped = []
    for sibling in sorted(os.listdir(root)):
        target = os.path.join(root, sibling, "wonderland", leaf)
        if not os.path.isdir(target) or os.path.abspath(target) == here:
            continue
        if sibling not in LAUNCHES_AN_EDITOR:
            skipped.append(sibling)
            continue
        copied = 0
        for name in sorted(os.listdir(here)):
            if not name.endswith(".wlvox"):
                continue
            src, dst = os.path.join(here, name), os.path.join(target, name)
            with open(src, "rb") as handle:
                payload = handle.read()
            if os.path.isfile(dst):
                with open(dst, "rb") as handle:
                    if handle.read() == payload:
                        continue
            with open(dst, "wb") as handle:
                handle.write(payload)
            copied += 1
        if copied:
            print("mirrored %d figure(s) -> %s" % (copied, target))
    if skipped:
        print("not mirrored (no editor launches there): %s" % ", ".join(skipped))


if __name__ == "__main__":
    main()
