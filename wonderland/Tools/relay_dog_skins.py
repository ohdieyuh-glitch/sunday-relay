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
        # THE BUDGET IS A DRAW-CALL BUDGET, AND IT WAS SET FOR A SIMPLER COSTUME. 6,000 was where these skins sat
        # when they stopped at a halo and a colour, and the founder's plates are denser than that by a long way --
        # layered drapery, chains, waist and knee armour, ribcages, manes. The Project Avatars he accepted run
        # 12k-40k boxes, so a premium skin at this scale is not out of line with what this project already ships.
        # Raised deliberately rather than by trimming the design to fit a number: it is one instanced mesh per
        # material per part, and the costume is a single actor over the canon body.
        assert len(self.boxes) <= 16000, (self.name, "boxes", len(self.boxes))
        assert len(self.parts) <= 48, (self.name, "parts", len(self.parts))
        assert len(self.materials) <= 12, (self.name, "materials", len(self.materials))
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
    figure.body_kind = CANONICAL_BODY
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
    base_dog(figure)
    return figure


def arden_infernal():
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
    figure.part("halo", "head", halo_c, "orbit", 5.0)
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

    # ================================================================== THE ROBE
    # Long, layered, wider than the body: crimson and char outside, cream inside, a front panel and a back cape.
    figure.part("cloak", "body", (0.0, 0.0, shoulder), "trail", 0.5)
    figure.cloak("cloak", lambda down, across: "char" if abs(across - 0.5) > 0.40 or down > 0.90 else "crimson",
                 (-td * 0.20, 0.0, shoulder - 0.8), tw * 2.15, 19.5, tile * 1.16, flare=2.9, back=-1.6)
    figure.cloak("cloak", lambda down, across: "bone" if down < 0.84 else "crimson",
                 (-td * 0.05, 0.0, shoulder - 1.6), tw * 1.55, 17.5, tile * 1.08, flare=2.3, back=-0.8)
    figure.cloak("cloak", lambda down, across: "crimson" if down < 0.72 else "char",
                 (td * 0.50, 0.0, shoulder - 7.6), tw * 0.92, 9.5, tile * 1.02, flare=1.6)
    figure.cloak("cloak", lambda down, across: "char" if abs(across - 0.5) > 0.36 else "crimson",
                 (-td * 0.66, 0.0, shoulder + 0.4), tw * 1.80, 21.0, tile * 1.12, flare=2.5, back=-3.0)
    # THE CEREMONIAL LENGTH BEHIND. The plate's REAR view is its densest -- a long cream-and-red robe in banded
    # layers falling past the feet and pooling behind, which is why Arden reads as ceremonial rather than as a
    # cloaked figure. The falls above stop around the ankle; these carry the cloth down and back past it, in
    # alternating bands so the back is striped cream/red the way the plate's is rather than one flat sheet.
    for k, (back, width, length, warm) in enumerate(((-5.4, 1.62, 25.0, False), (-7.0, 1.42, 22.5, True),
                                                     (-8.4, 1.20, 19.5, False))):
        figure.cloak("cloak",
                     lambda down, across, w=warm: ("crimson" if w else "bone") if down < 0.78 else "char",
                     (-td * (0.80 + 0.16 * k), 0.0, shoulder - 1.2 - k * 1.1), tw * width, length,
                     tile * 1.12, flare=2.9 + 0.25 * k, back=back)
    # banded trim across the train, the gold rule between each cloth band
    for k in range(4):
        figure.ring("cloak", lambda a: "gold", (-td * 0.95, 0.0, shoulder - 6.0 - k * 3.4), tw * (1.16 - 0.06 * k),
                    tile * 0.7, tile * 0.95, plane="xy")
    figure.part("hemfire", "cloak", (0.0, 0.0, 1.0), "twinkle", 0.55)
    for k in range(6):
        y = (k - 2.5) * 2.6
        figure.flame("hemfire", lambda up: "ember" if up > 0.4 else "crimson",
                     (-td * 0.3 + (k % 2) * 1.4, y, 0.8), 4.2, 2.2, 3, tile * 0.95)

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
    figure.part("sigil", "arm_l", sigil_c, "orbit", -30.0)
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


def apollo():
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
    figure.part("halo", "head", halo_c, "orbit", 3.0)
    for r, m in ((12.6, "gold"), (11.7, "gold"), (10.9, "solarpale")):
        figure.ring("halo", lambda a, mm=m: mm, halo_c, r, tile * 1.45, tile * 1.0)
    # the band has depth: a second ring offset backward gives the rim a thickness you can see from three-quarter
    for r in (12.2, 11.3):
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

    # ---- DIVINE DRAPERY. A column to the floor with a heavy flare, a shorter front panel over it, and a back
    # ---- sheet so the figure has cloth from every angle the founder will inspect it from.
    figure.part("robe", "body", (0.0, 0.0, shoulder - 2.0), "trail", 0.5)
    figure.cloak("robe", lambda down, across: "linen" if down < 0.88 else "golddeep",
                 (-td * 0.18, 0.0, shoulder - 1.0), tw * 2.05, 17.0, tile * 1.16, flare=2.9, back=-1.4)
    figure.cloak("robe", lambda down, across: "linenshade" if abs(across - 0.5) > 0.34 else "linen",
                 (-td * 0.62, 0.0, shoulder - 0.4), tw * 1.70, 15.0, tile * 1.10, flare=2.4, back=-2.6)
    figure.cloak("robe", lambda down, across: "linen",
                 (td * 0.52, 0.0, shoulder - 5.6), tw * 0.96, 9.0, tile * 1.02, flare=1.7)
    # THE TRAIN, and the volume the plate's robe actually has. Three sheets made a skirt; the reference is a
    # CEREMONIAL robe -- cloth stacked in depth, spilling wider at the hem than the figure is, and running back
    # along the ground behind. Without the rear length the three-quarter and rear views were the emptiest of the
    # five, which is where a robed figure should look its best.
    figure.cloak("robe", lambda down, across: "linen" if down < 0.80 else "linenshade",
                 (-td * 1.05, 0.0, shoulder - 1.6), tw * 1.45, 20.0, tile * 1.20, flare=3.4, back=-4.2)
    figure.cloak("robe", lambda down, across: "linenshade" if abs(across - 0.5) > 0.40 else "linen",
                 (-td * 0.34, 0.0, shoulder - 3.2), tw * 2.30, 14.5, tile * 1.10, flare=3.2, back=-0.8)
    for side in (-1.0, 1.0):
        figure.cloak("robe", lambda down, across: "linen",
                     (-td * 0.10, side * tw * 0.86, shoulder - 2.4), tw * 0.80, 13.0, tile * 1.04, flare=2.2, back=-1.2)
    # gold hem trim, so the cloth ends on an edge rather than fading out
    for zz, rad in ((shoulder - 15.4, tw * 1.30), (shoulder - 16.6, tw * 1.16)):
        figure.ring("robe", lambda a: "golddeep", (-td * 0.22, 0.0, zz), rad, tile * 0.85, tile * 1.0, plane="xy")

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
    return figure


def skeleton_flame():
    """SKELETON FLAME -- BONES IGNITE. SIGNAL NEVER DIES.

    Rebuilt against the founder's plate: a bone body, tall blue ghost-fire from both ears, a ribcage carved INTO
    the chest over a dark hollow, skull emblems at brow and sternum, a gold chain charm, blue flame at every hand
    and foot, jointed bone limbs and cyan eyes.
    """
    figure = start("RELAY DOG SKIN -- SKELETON FLAME", 7004, (0.36, 0.95, 1.00), 8.0)
    figure.material("ghost", "glow", (0.22, 0.70, 1.00), 0.7)
    figure.material("ghostpale", "glow", (0.72, 0.94, 1.00), 1.2)
    figure.material("void", "lit", (0.030, 0.040, 0.060), 1.0)
    figure.material("ash", "lit", (0.640, 0.610, 0.540), 1.0)
    figure.material("gold", "rim", (0.905, 0.720, 0.290), 1.0)
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
    figure.skull_emblem("body", mats, (td * 0.5 + 1.8, 0.0, d["torso_z"] + th * 0.5 - 1.2), 5.0, tile, deep="dark")
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
        figure.box("body", "void", (-td * 0.50, 0.0, d["torso_z"] + th * 0.36 - s * 1.1 - 0.55), (tile * 0.9, tile * 1.2, tile * 0.3))

    # ================================================================== BONE PAULDRONS AND JOINTED LIMBS
    for side in (-1.0, 1.0):
        figure.slab("body", "bone", (0.2, side * (tw * 0.5 + 0.9), shoulder + 0.5), (3.8, 3.0, 2.6), tile=tile)
        figure.slab("body", "ash", (0.4, side * (tw * 0.5 + 1.2), shoulder - 0.9), (3.2, 2.2, 1.0), tile=tile)
        figure.box("body", "void", (0.2, side * (tw * 0.5 + 0.9), shoulder - 0.2), (tile * 3.6, tile * 2.6, tile * 0.35))
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

    # ================================================================== THE BACK PLUME
    # The plate's rear view is a column of blue fire up the spine; from behind this is most of the skin.
    figure.part("backfire", "body", (-td * 0.55, 0.0, shoulder + 0.5), "twinkle", 0.22)
    figure.flame("backfire", lambda up: "ghost" if up < 0.6 else "ghostpale", (-td * 0.6, 0.0, shoulder + 0.2), 10.5, 6.8, 7, tile * 1.1)
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

    # ================================================================== THE FOUR SACRED ORBS
    # Two high, rising from the shoulders to stand beside and above the ears; two low, standing off the hips.
    # Each on its own gold rod with a collar, and each ringed with light. They float a little, as the plate's
    # do, and they are the widest thing in the silhouette by a distance.
    figure.part("orbs_high", "body", (0.0, 0.0, shoulder + 1.0), "float", 0.45)
    figure.part("orbs_low", "body", (0.0, 0.0, d["torso_z"] - 1.0), "float", 0.35)
    for side in (-1.0, 1.0):
        figure.orb_on_rod("orbs_high", mats, (-0.6, side * (tw * 0.5 + 1.4), shoulder + 1.2), (side * 0.72, 1.0), 10.8, 2.3, tile, halo=True)
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
    figure.material("edge", "glow", (0.62, 0.82, 1.00), 5.2)
    figure.material("starlight", "glow", (0.95, 0.98, 1.00), 4.4)
    figure.material("bannercloth", "rim", (0.80, 0.90, 1.00), 1.0)
    figure.material("ink", "glow", (0.93, 0.98, 1.00), 1.6)
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
        for leaf, (length, lift, sweep) in enumerate(((13.0, 4.2, 5.0), (9.5, 0.8, 6.6))):
            across = max(4, int(length / (tile * 1.4)))
            for s in range(across):
                t2 = (s + 0.5) / across
                half = (0.6 + 2.6 * math.sin(math.pi * min(t2 * 1.12, 1.0))) * (1.0 - 0.22 * t2)
                steps = max(1, int(half / tile))
                for w in range(-steps, steps + 1):
                    figure.box(name, "gauze",
                               (pivot[0] - t2 * sweep + w * tile * 0.35, pivot[1] + side * t2 * length,
                                pivot[2] + t2 * lift + w * tile * 0.95),
                               (tile * 0.45, tile * 1.45, tile * 0.9))
                figure.box(name, "vein", (pivot[0] - t2 * sweep + 0.25, pivot[1] + side * t2 * length, pivot[2] + t2 * lift),
                           (tile * 0.5, tile * 1.5, tile * 0.5))

    # THE STINGER.
    figure.part("sting", "body", (-td * 0.5, 0.0, d["torso_z"] - th * 0.35), "none")
    for s in range(5):
        t3 = s / 4.0
        figure.box("sting", "stripe" if t3 < 0.7 else "amber",
                   (-td * 0.5 - 0.8 - t3 * 2.8, 0.0, d["torso_z"] - th * 0.35 - t3 * 1.1),
                   (tile * (1.2 - 0.7 * t3),) * 3)
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
