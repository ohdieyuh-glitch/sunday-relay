"""Generate the companion preview figures for AWonderlandCompanionEmbodiment.

WHAT THESE ARE. The founder asked (2026-09-15) to SEE imported companions floating beside the Relay Dog before
any import is wired. Each body is a list of boxes in the `wlvox 1` text format
(Source/Wonderland/WonderlandCompanionFigure.h), read at spawn and built from engine cubes. No asset is created:
the figures live in wonderland/Companions/ and are regenerated and reloaded in PIE with `wl.Companion.Reload`.

WHAT THEY FOLLOW -- the founder's two reference sheets of 2026-09-15, which replace the first concept frame:

  LLM COMPANIONS are the small chibi GHOSTS: a chunky ivory helmet with a black face and glowing eyes, a gem on
  the brow, a little armoured body with a chest gem, small crystal wings, and a translucent crystal ghost tail
  in the companion's own colour, with hexagonal gems floating round it. Four skins are on the sheet and all four
  are generated: AURUM (gold, curled horns, happy eyes), EMBER (red, crystal flames, glowing square eyes),
  FROST (blue, ice spikes, a wink and a smile) and BLOSSOM (pink, a bob of hair and a gold flower).
  GPT 6 Astra wears AURUM -- the skin closest to the first frame's hooded, curled, gold, happy-eyed Astra.

  JHINN AI AGENTS are the full-body figures with the periwinkle-blue crystalline spectral lower body.
  Claude Code Fable 5 is the winged one: a white bob under a gold tiara, warm eyes, lavender hands, a gold key
  pendant and chains, tall layered crystal wings. The Jhin canon (WorldDesign/PRODUCTION_ORDER.md) is kept: an
  imported agent's lower body is cyan-blue crystalline, so its crystal carries cyan glints through the periwinkle.

HOW BOXES BECOME THAT. Chunky helmets are rounded-cube superellipsoids tiled in big blocks with visible seams.
Translucent crystal is approximated with glowing facet tiles laid with gaps -- the world shows between them --
over an additive core, in three tones per colour. Everything is seeded, so a regeneration is byte-identical.

Usage:  python wonderland/Tools/companion_figures.py [--out DIR]
"""

import argparse
import math
import os
import random

VOXEL_UU = 2.5


def normalise(v):
    length = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) or 1.0
    return (v[0] / length, v[1] / length, v[2] / length)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def spow(t, e):
    return math.copysign(abs(t) ** e, t)


def aim(direction):
    """Pitch and yaw (degrees) that turn a box's local +X toward `direction`, the way FVector::Rotation does."""
    x, y, z = normalise(direction)
    return math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def polyline_at(spine, s):
    """Point and unit tangent at arc fraction s of a polyline."""
    lengths = [0.0]
    for i in range(1, len(spine)):
        lengths.append(lengths[-1] + math.dist(spine[i], spine[i - 1]))
    total = lengths[-1] or 1.0
    target = max(0.0, min(1.0, s)) * total
    i = 1
    while i < len(spine) - 1 and lengths[i] < target:
        i += 1
    span = (lengths[i] - lengths[i - 1]) or 1.0
    w = (target - lengths[i - 1]) / span
    return lerp3(spine[i - 1], spine[i], w), normalise(tuple(spine[i][n] - spine[i - 1][n] for n in range(3)))


class Figure:
    def __init__(self, name, seed):
        self.name = name
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
    def superellipsoid(self, part, material_for, centre, radii, n, tile, depth, keep=None, gap=0.10, lat=(-90.0, 90.0)):
        """Big seamed blocks over a rounded cube (n ~ 3) or a soft ellipsoid (n = 2).
        Each tile is sized from the local spacing of the parameterisation, so flat faces stay covered."""
        cx, cy, cz = centre
        a, b, c = radii
        e = 2.0 / n
        mean = (a + b + c) / 3.0
        rings = max(3, int(round(math.radians(lat[1] - lat[0]) * mean / tile)))
        d_phi = math.radians(lat[1] - lat[0]) / rings

        def surface(phi, theta):
            ux, uy, uz = math.cos(phi) * math.cos(theta), math.cos(phi) * math.sin(theta), math.sin(phi)
            return (a * spow(ux, e), b * spow(uy, e), c * spow(uz, e))

        for ring in range(rings + 1):
            phi = math.radians(lat[0]) + d_phi * ring
            around = max(4, int(round(2.0 * math.pi * max(math.cos(phi), 0.15) * mean / tile)))
            d_theta = 2.0 * math.pi / around
            offset = (ring % 2) * d_theta * 0.5
            for k in range(around):
                theta = offset + d_theta * k
                px, py, pz = surface(phi, theta)
                normal = normalise((spow(px / a, n - 1) / a, spow(py / b, n - 1) / b, spow(pz / c, n - 1) / c))
                point = (cx + px, cy + py, cz + pz)
                if keep is not None and not keep(normal, point):
                    continue
                along = math.dist(surface(phi, theta + d_theta), (px, py, pz))
                up = math.dist(surface(min(phi + d_phi, math.pi / 2), theta), (px, py, pz))
                sy = min(max(along * (1.0 - gap) * 1.08, 0.5), tile * 2.2)
                sz = min(max(up * (1.0 - gap) * 1.08, 0.5), tile * 2.2)
                pitch, yaw = aim(normal)
                material = material_for(normal, point) if callable(material_for) else material_for
                self.box(part, material, point, (depth, sy, sz), pitch, yaw, (self.rng.random() - 0.5) * 4.0)

    def tube(self, part_for, material_for, spine, radius_for, tile, depth, twist=0.0, size_scale=1.0, jitter=0.0):
        """Rings of tiles around a polyline spine; part_for(s), material_for(s, k), radius_for(s) take arc fraction s."""
        lengths = [0.0]
        for i in range(1, len(spine)):
            lengths.append(lengths[-1] + math.dist(spine[i], spine[i - 1]))
        total = lengths[-1] or 1.0
        s = 0.0
        ring = 0
        while s <= 1.0 + 1e-6:
            centre, tangent = polyline_at(spine, s)
            helper = (0.0, 0.0, 1.0) if abs(tangent[2]) < 0.9 else (1.0, 0.0, 0.0)
            u = normalise(cross(tangent, helper))
            v = cross(tangent, u)
            r = radius_for(s)
            around = max(3, int(round(2.0 * math.pi * r / tile)))
            phase = twist * s * 2.0 * math.pi + (ring % 2) * math.pi / around
            step = min(tile, 2.0 * math.pi * r / around) if r > 0.5 else tile
            for k in range(around):
                ang = phase + 2.0 * math.pi * k / around
                normal = tuple(math.cos(ang) * u[n] + math.sin(ang) * v[n] for n in range(3))
                point = tuple(centre[n] + normal[n] * r for n in range(3))
                if jitter:
                    point = tuple(point[n] + (self.rng.random() - 0.5) * jitter for n in range(3))
                pitch, yaw = aim(normal)
                size = max(step, 0.35) * size_scale
                material = material_for(s, k)
                if material is None:
                    continue
                self.box(part_for(s), material, point, (depth, size * 1.05, tile * size_scale * 1.1), pitch, yaw, (self.rng.random() - 0.5) * 10.0)
            s += tile * 0.92 / total
            ring += 1

    def blade(self, part, material, root, direction, length, width, thickness, roll=0.0):
        """A long flat box from `root` along `direction`: local X is the length."""
        d = normalise(direction)
        centre = tuple(root[n] + d[n] * length * 0.5 for n in range(3))
        pitch, yaw = aim(d)
        self.box(part, material, centre, (length, width, thickness), pitch, yaw, roll)

    def hex_gem(self, part, material, centre, axis, radius, thickness):
        """Three flat bars turned 0, 60 and 120 degrees about one axis read as a hexagonal gem."""
        pitch, yaw = aim(axis)
        for turn in (0.0, 60.0, 120.0):
            self.box(part, material, centre, (thickness, radius * 1.732, radius), pitch, yaw, turn)

    def diamond(self, part, frame, gem, centre, facing, size):
        """A gold rotated-square frame with a glowing gem set in it, facing along `facing`."""
        pitch, yaw = aim(facing)
        f = normalise(facing)
        helper = (0.0, 0.0, 1.0) if abs(f[2]) < 0.9 else (1.0, 0.0, 0.0)
        right = normalise(cross(helper, f))
        up = cross(f, right)
        bar = size * 0.72
        for sx, sz in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            mid = tuple(centre[n] + (right[n] * sx + up[n] * sz) * size * 0.25 for n in range(3))
            self.box(part, frame, mid, (0.8, bar, size * 0.16), pitch, yaw, 45.0 * sx * sz)
        self.box(part, gem, tuple(centre[n] + f[n] * 0.25 for n in range(3)), (0.9, size * 0.42, size * 0.42), pitch, yaw, 45.0)

    def sparkle(self, part, material, centre, size):
        """A four-point star: two crossed thin bars, facing forward."""
        self.box(part, material, centre, (0.25, size * 0.22, size))
        self.box(part, material, centre, (0.25, size * 0.72, size * 0.18))

    # ------------------------------------------------------------------ write
    def write(self, path):
        lines = [
            "# %s -- generated by wonderland/Tools/companion_figures.py. Do not hand-edit; change the generator." % self.name,
            "# Read by AWonderlandCompanionEmbodiment (Source/Wonderland/WonderlandCompanionFigure.h documents the format).",
            "wlvox 1",
            "voxel %.3f" % VOXEL_UU,
        ]
        for name, kind, rgb, strength in self.materials:
            lines.append("material %s %s %.4f %.4f %.4f %.3f" % (name, kind, rgb[0], rgb[1], rgb[2], strength))
        for name, parent, pivot, motion, a, b in self.parts:
            extra = "" if a is None else (" %.3f" % a) + ("" if b is None else " %.3f" % b)
            lines.append("part %s %s %.3f %.3f %.3f %s%s" % (name, parent, pivot[0], pivot[1], pivot[2], motion, extra))
        for part, material, c, s, r in self.boxes:
            if abs(r[0]) < 1e-4 and abs(r[1]) < 1e-4 and abs(r[2]) < 1e-4:
                lines.append("box %s %s %.3f %.3f %.3f %.3f %.3f %.3f" % (part, material, c[0], c[1], c[2], s[0], s[1], s[2]))
            else:
                lines.append("box %s %s %.3f %.3f %.3f %.3f %.3f %.3f %.2f %.2f %.2f" % (part, material, c[0], c[1], c[2], s[0], s[1], s[2], r[0], r[1], r[2]))
        assert len(self.boxes) <= 6000 and len(self.parts) <= 48 and len(self.materials) <= 12, (len(self.boxes), len(self.parts), len(self.materials))
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write("\n".join(lines) + "\n")
        return len(self.boxes), len(self.parts), len(self.materials)


IVORY = (0.86, 0.83, 0.76)
GOLD = (0.93, 0.60, 0.16)
VISOR = (0.006, 0.006, 0.009)


def crystal_tail(fig, parent, spine, radius_at, segments, tones, halo, density=0.82):
    """A translucent crystal ghost tail: facet tiles with gaps in three tones over an additive core."""
    for k in range(segments):
        centre, _ = polyline_at(spine, (k + 0.5) / segments)
        fig.part("tail%d" % k, parent, centre, "tail", k, segments)

    def part_for(s):
        return "tail%d" % min(int(s * segments), segments - 1)

    deep, base, pale = tones

    def tone(s, k):
        h = (k * 7 + int(s * 40) * 3) % 11
        if h in (0, 5):
            return pale
        if h in (2, 7, 9):
            return deep
        return base

    fig.tube(part_for, tone, spine, radius_at, tile=1.9, depth=0.7, twist=0.25, size_scale=density, jitter=0.35)
    # The inner light, so the crystal glows from inside rather than being only a skin.
    steps = 22
    for i in range(steps):
        s = i / (steps - 1)
        centre, tangent = polyline_at(spine, s)
        r = radius_at(s) * 0.62
        pitch, yaw = aim(tangent)
        fig.box(part_for(s), halo, centre, (2.2, r * 1.5, r * 1.5), pitch, yaw, fig.rng.random() * 90.0)


# ============================================================================ LLM COMPANION GHOSTS
GHOST_SKINS = {
    "aurum":   dict(deep=(0.95, 0.50, 0.05), base=(1.0, 0.74, 0.18), pale=(1.0, 0.93, 0.58), gem=(1.0, 0.80, 0.22),
                    eye=(1.0, 0.88, 0.56), wing=(1.0, 0.95, 0.84), halo=(1.0, 0.62, 0.12)),
    "ember":   dict(deep=(0.80, 0.05, 0.02), base=(1.0, 0.20, 0.07), pale=(1.0, 0.56, 0.32), gem=(1.0, 0.08, 0.05),
                    eye=(1.0, 0.66, 0.24), wing=(1.0, 0.84, 0.86), halo=(1.0, 0.18, 0.06)),
    "frost":   dict(deep=(0.18, 0.40, 1.0), base=(0.42, 0.66, 1.0), pale=(0.80, 0.91, 1.0), gem=(0.45, 0.74, 1.0),
                    eye=(1.0, 0.90, 0.62), wing=(0.76, 0.88, 1.0), halo=(0.30, 0.55, 1.0)),
    "blossom": dict(deep=(0.90, 0.28, 0.60), base=(1.0, 0.50, 0.78), pale=(1.0, 0.84, 0.93), gem=(1.0, 0.34, 0.64),
                    eye=(1.0, 0.92, 0.84), wing=(1.0, 0.88, 0.94), halo=(1.0, 0.40, 0.72)),
}


def build_ghost(skin_name, display):
    skin = GHOST_SKINS[skin_name]
    fig = Figure("%s -- LLM Companion (%s ghost)" % (display, skin_name), seed=sum(ord(ch) * (i + 1) for i, ch in enumerate(skin_name)))
    fig.material("ivory", "lit", IVORY)
    fig.material("gold", "lit", GOLD)
    fig.material("visor", "lit", VISOR)
    fig.material("eye", "glow", skin["eye"], 5.0)
    fig.material("deep", "glow", skin["deep"], 1.3)
    fig.material("base", "glow", skin["base"], 1.7)
    fig.material("pale", "glow", skin["pale"], 2.3)
    fig.material("gem", "glow", skin["gem"], 2.6)
    fig.material("wing", "glow", tuple(0.55 * w + 0.45 * b for w, b in zip(skin["wing"], skin["base"])), 1.35)
    fig.material("halo", "add", skin["halo"], 0.9)
    if skin_name == "blossom":
        fig.material("hair", "lit", (0.97, 0.80, 0.87))

    fig.part("body", "-", (0.0, 0.0, 28.0), "none")
    fig.part("head", "body", (0.0, 0.0, 35.0), "head")
    fig.part("eyes", "head", (8.6, 0.0, 40.0), "blink")
    fig.part("wingL", "body", (-4.2, -4.0, 31.0), "wing", -1)
    fig.part("wingR", "body", (-4.2, 4.0, 31.0), "wing", 1)
    fig.part("orbit", "body", (0.0, 0.0, 26.0), "orbit", 14.0)

    # THE HELMET: a rounded cube of big seamed ivory blocks, open at the front in a rounded rectangle.
    hc, hr, hn = (0.0, 0.0, 41.0), (9.2, 10.4, 9.8), 2.7
    face_w, face_h, face_z = 8.1, 6.9, 40.0

    def in_face(p, grow=0.0):
        return (abs(p[1]) / (face_w + grow)) ** 4 + (abs(p[2] - face_z) / (face_h + grow)) ** 4 < 1.0

    fig.superellipsoid("head", "ivory", hc, hr, hn, tile=2.9, depth=1.9, gap=0.14,
                       keep=lambda nrm, p: not (nrm[0] > 0.1 and in_face(p)))

    def front_x(y, z, inset=0.0):
        inner = 1.0 - (abs(y) / hr[1]) ** hn - (abs(z - hc[2]) / hr[2]) ** hn
        return hc[0] + hr[0] * max(inner, 0.0) ** (1.0 / hn) - inset

    # The rim: a ring of chunky blocks standing proud of the helmet round the face.
    for i in range(30):
        t = 2.0 * math.pi * i / 30
        y = spow(math.cos(t), 0.5) * (face_w + 1.0)
        z = face_z + spow(math.sin(t), 0.5) * (face_h + 1.0)
        x = front_x(y, z) + 0.5
        pitch, yaw = aim((1.0, y * 0.05, (z - face_z) * 0.05))
        fig.box("head", "ivory", (x + 0.3, y, z), (2.6, 2.6, 2.6), pitch, yaw, 0.0)
    # The face: a black screen set back inside the rim, gently domed.
    y = -face_w
    while y <= face_w + 1e-6:
        z = face_z - face_h
        while z <= face_z + face_h + 1e-6:
            if in_face((0.0, y, z), -0.2):
                x = hc[0] + hr[0] - 1.9 - 0.012 * (y * y + (z - face_z) ** 2)
                fig.box("head", "visor", (x, y, z), (0.8, 1.62, 1.62), 0.0, 0.0, 0.0)
            z += 1.5
        y += 1.5
    visor_x = hc[0] + hr[0] - 1.4

    # THE EYES, per skin.
    def arch(side, z0, width, height, down=False):
        for i in range(9):
            t = -1.0 + 2.0 * i / 8
            yy = side * 3.4 + width * t
            zz = z0 + (-1.0 if down else 1.0) * height * (1.0 - t * t)
            slope = math.degrees(math.atan(2.0 * height * t / width)) * (1.0 if down else -1.0)
            fig.box("eyes", "eye", (visor_x - 0.012 * (yy * yy), yy, zz), (0.7, 1.45, 1.6), 0.0, 0.0, slope)

    if skin_name in ("aurum", "blossom"):
        arch(-1.0, 38.8, 2.6, 2.2)
        arch(1.0, 38.8, 2.6, 2.2)
    elif skin_name == "ember":
        for side in (-1.0, 1.0):
            fig.box("eyes", "eye", (visor_x, side * 3.4, 40.0), (0.6, 2.8, 3.2))
            fig.box("eyes", "eye", (visor_x, side * 3.4, 40.0), (0.6, 3.4, 2.5))
    else:
        arch(-1.0, 39.6, 2.1, 1.7)                              # the closed, winking eye
        fig.box("eyes", "eye", (visor_x, 3.4, 40.6), (0.6, 2.5, 2.9))   # the open one
        fig.box("eyes", "eye", (visor_x, 3.4, 40.6), (0.6, 3.0, 2.2))
        for i in range(7):                                     # the smile
            t = -1.0 + 2.0 * i / 6
            fig.box("eyes", "eye", (visor_x, 1.6 * t, 35.9 - 0.9 * (1.0 - t * t)), (0.6, 0.9, 0.7), 0.0, 0.0, math.degrees(math.atan(1.1 * t)))

    # THE BROW GEM.
    gem_z = face_z + face_h + 2.1
    fig.diamond("head", "gold", "gem", (front_x(0.0, gem_z) + 1.1, 0.0, gem_z + 0.3), (1.0, 0.0, 0.45), 5.0)

    # THE SKIN'S CROWNING FEATURE.
    if skin_name == "aurum":
        for side in (-1.0, 1.0):
            spine = [(-0.8, side * 6.2, 48.5), (-1.2, side * 8.0, 53.5), (-2.2, side * 10.8, 57.0), (-3.6, side * 14.4, 57.6),
                     (-4.6, side * 16.8, 55.0), (-4.2, side * 16.6, 51.6), (-2.8, side * 14.8, 50.2)]
            fig.tube(lambda s: "head", lambda s, k: "gold" if (0.16 < s < 0.22 or 0.52 < s < 0.57) else "ivory", spine,
                     lambda s: max(3.3 * (1.0 - 0.72 * s), 0.8), tile=2.0, depth=1.2, size_scale=0.95)
    elif skin_name == "ember":
        fig.part("flames", "head", (-1.0, 0.0, 50.0), "twinkle", 0.3)
        for i, (y0, lean, height) in enumerate(((-5.5, -0.5, 11.0), (-2.2, -0.2, 15.5), (1.4, 0.2, 13.0), (4.6, 0.5, 10.0), (0.0, 0.0, 8.0))):
            spine = [(-1.0 - i * 0.4, y0, 48.0), (-2.0, y0 + lean * 3.0, 48.0 + height * 0.45), (-3.6, y0 + lean * 5.0 + 1.5, 48.0 + height * 0.8), (-5.5, y0 + lean * 6.0 + 3.0, 48.0 + height)]
            fig.tube(lambda s: "flames", lambda s, k: "pale" if s > 0.75 else ("base" if (k + i) % 3 else "deep"), spine,
                     lambda s: max(3.0 * (1.0 - s) ** 0.9, 0.35), tile=1.7, depth=0.7, size_scale=0.85, jitter=0.3)
    elif skin_name == "frost":
        spikes = ((0.0, 62.0, 15.0), (-32.0, 52.0, 14.0), (32.0, 52.0, 14.0), (-62.0, 36.0, 13.0), (62.0, 36.0, 13.0),
                  (-92.0, 18.0, 11.5), (92.0, 18.0, 11.5), (-118.0, 4.0, 9.5), (118.0, 4.0, 9.5), (-16.0, 78.0, 12.0), (16.0, 78.0, 12.0),
                  (180.0, 50.0, 12.5), (-150.0, 38.0, 12.0), (150.0, 38.0, 12.0), (-45.0, 20.0, 9.0), (45.0, 20.0, 9.0))
        for i, (az, el, length) in enumerate(spikes):
            d = (math.cos(math.radians(el)) * math.cos(math.radians(az)) * 0.45 - 0.45, math.cos(math.radians(el)) * math.sin(math.radians(az)), math.sin(math.radians(el)))
            root = (hc[0] - 1.0 + d[0] * 6.0, d[1] * 8.0, hc[2] + 4.0 + d[2] * 5.0)
            for layer, (w, mat) in enumerate(((3.8, "deep"), (2.6, "base"), (1.2, "pale"))):
                fig.blade("head", mat, root, d, length * (1.0 - 0.12 * layer), w, 0.9 + 0.3 * layer, roll=i * 30.0)
    else:
        fig.superellipsoid("head", "hair", (-0.9, 0.0, 42.0), (9.9, 11.8, 10.6), 2.6, tile=2.3, depth=1.4, gap=0.08,
                           keep=lambda nrm, p: not (nrm[0] > 0.05 and in_face(p, 0.8)) and p[2] > 32.5)
        for i in range(8):
            yy = -6.3 + 1.8 * i
            fig.box("head", "hair", (front_x(yy, 47.0) + 0.9, yy, 47.2 - 0.25 * abs(yy)), (1.5, 2.0, 4.4), 0.0, 0.0, (i - 3.5) * 5.0)
        for side in (-1.0, 1.0):
            fig.box("head", "hair", (3.0, side * 11.0, 36.5), (4.2, 2.2, 10.0), 0.0, 0.0, side * 8.0)
        flower = (front_x(7.0, 49.0) - 0.5, 7.2, 49.8)
        for k in range(5):
            ang = 72.0 * k
            fig.box("head", "gold", (flower[0] + 0.3, flower[1] + 1.6 * math.cos(math.radians(ang)), flower[2] + 1.6 * math.sin(math.radians(ang))), (0.8, 1.9, 1.3), 0.0, 20.0, ang)
        fig.box("head", "gem", (flower[0] + 0.8, flower[1], flower[2]), (0.8, 1.2, 1.2), 0.0, 20.0, 45.0)

    # THE LITTLE BODY: a rounded ivory chest, a gold collar, shoulder plates, small arms and hands, a chest gem.
    fig.superellipsoid("body", "ivory", (0.0, 0.0, 27.8), (4.9, 6.4, 4.8), 2.6, tile=2.2, depth=1.3, gap=0.1)
    for i in range(22):
        t = 2.0 * math.pi * i / 22
        pitch, yaw = aim((math.cos(t), math.sin(t), 0.2))
        fig.box("body", "gold", (5.0 * math.cos(t), 6.4 * math.sin(t), 32.1), (1.0, 1.6, 1.2), pitch, yaw, 0.0)
    for side in (-1.0, 1.0):
        fig.box("body", "ivory", (0.3, side * 6.9, 30.4), (4.2, 3.2, 2.3), 0.0, 0.0, side * -18.0)
        fig.box("body", "gold", (0.3, side * 7.6, 29.3), (4.3, 1.6, 0.6), 0.0, 0.0, side * -18.0)
        fig.tube(lambda s: "body", lambda s, k: "ivory", [(0.4, side * 7.4, 29.0), (1.8, side * 7.8, 26.2), (3.2, side * 7.0, 24.2)],
                 lambda s: 1.5, tile=1.5, depth=0.9)
        fig.box("body", "ivory", (3.8, side * 6.6, 23.6), (2.4, 2.2, 2.2))
    if skin_name == "blossom":
        fig.diamond("body", "gold", "gem", (5.6, 0.0, 28.2), (1.0, 0.0, 0.1), 3.4)
        fig.box("body", "gem", (6.1, -0.55, 28.8), (0.8, 1.3, 1.3), 0.0, 0.0, 45.0)
        fig.box("body", "gem", (6.1, 0.55, 28.8), (0.8, 1.3, 1.3), 0.0, 0.0, 45.0)
    else:
        fig.diamond("body", "gold", "gem", (5.6, 0.0, 28.2), (1.0, 0.0, 0.1), 3.4)

    # SMALL CRYSTAL WINGS: four feathers a side fanning up and out, a gold clasp at the root.
    for side, part in ((-1.0, "wingL"), (1.0, "wingR")):
        root = (-4.2, side * 4.0, 31.0)
        for i, (up, length) in enumerate(((6.0, 8.0), (28.0, 11.5), (50.0, 13.0), (72.0, 10.5))):
            d = (-0.45, side * math.cos(math.radians(up)), math.sin(math.radians(up)))
            fig.blade(part, "wing", root, d, length, 2.9, 0.7, roll=side * 25.0)
            fig.blade(part, "pale", root, d, length * 0.55, 1.0, 0.8, roll=side * 25.0)
        fig.box(part, "gold", root, (1.6, 1.6, 1.6), 0.0, 45.0, 45.0)

    # THE CRYSTAL GHOST TAIL: an S that curls up at its tip.
    spine = [(0.0, 0.0, 25.0), (-0.6, 1.4, 21.0), (-1.6, 3.8, 16.6), (-2.2, 4.8, 12.2), (-2.0, 3.2, 8.2), (-1.2, -0.4, 5.2),
             (-0.4, -3.6, 3.4), (0.3, -5.8, 3.0), (0.7, -7.0, 4.4), (0.6, -6.8, 6.2)]

    def radius_at(s):
        profile = ((0.0, 5.6), (0.22, 4.9), (0.45, 3.4), (0.65, 2.1), (0.85, 1.0), (1.0, 0.45))
        for (s0, r0), (s1, r1) in zip(profile, profile[1:]):
            if s <= s1:
                return r0 + (r1 - r0) * (s - s0) / (s1 - s0)
        return profile[-1][1]

    crystal_tail(fig, "body", spine, radius_at, 8, ("deep", "base", "pale"), "halo")

    # HEXAGONAL GEMS in orbit, and sparkles near the tail.
    for i in range(5):
        a = 2.0 * math.pi * i / 5 + 0.7
        centre = (15.0 * math.cos(a), 15.5 * math.sin(a), 20.0 + 11.0 * math.sin(1.9 * a + 0.4))
        fig.hex_gem("orbit", "gem" if i % 2 else "base", centre, (math.cos(a + 1.2), math.sin(a + 1.2), 0.5), 1.8, 0.5)
    for i, (x, y, z) in enumerate(((3.0, -9.0, 14.0), (2.0, 8.0, 9.0), (4.0, -5.5, 5.0), (1.0, 10.0, 18.0))):
        name = "spark%d" % i
        fig.part(name, "body", (x, y, z), "twinkle", i / 4.0)
        fig.sparkle(name, "pale", (x, y, z), 1.8)
    return fig


# ============================================================================ JHINN AI AGENT: CLAUDE CODE FABLE 5
def build_fable():
    fig = Figure("Claude Code Fable 5 -- Jhinn AI Agent (imported)", seed=5150)
    fig.material("ivory", "lit", IVORY)
    fig.material("gold", "lit", GOLD)
    fig.material("visor", "lit", VISOR)
    fig.material("lilac", "lit", (0.70, 0.66, 0.96))
    fig.material("eye", "glow", (1.0, 0.80, 0.36), 5.0)
    # The spectral lower body: periwinkle crystal with the imported-agent cyan glinting through it (canon).
    fig.material("deep", "glow", (0.36, 0.42, 1.0), 1.3)
    fig.material("base", "glow", (0.52, 0.60, 1.0), 1.6)
    fig.material("cyan", "glow", (0.36, 0.86, 1.0), 2.2)
    fig.material("wing", "glow", (0.46, 0.50, 1.0), 1.25)
    fig.material("wingpale", "glow", (0.74, 0.74, 1.0), 1.9)
    fig.material("halo", "add", (0.45, 0.58, 1.0), 0.85)

    fig.part("body", "-", (0.0, 0.0, 48.0), "none")
    fig.part("head", "body", (0.0, 0.0, 61.0), "head")
    fig.part("eyes", "head", (5.5, 0.0, 65.0), "blink")
    fig.part("wingL", "body", (-3.6, -3.2, 55.0), "wing", -1)
    fig.part("wingR", "body", (-3.6, 3.2, 55.0), "wing", 1)
    fig.part("orbit", "body", (0.0, 0.0, 34.0), "orbit", -11.0)

    # THE HEAD: a black face under a white bob, a gold tiara.
    fig.superellipsoid("head", "visor", (0.0, 0.0, 65.4), (4.6, 4.6, 5.4), 2.2, tile=1.4, depth=0.9, gap=0.02)
    yy = -3.9
    while yy <= 3.9 + 1e-6:
        zz = 60.8
        while zz <= 68.2 + 1e-6:
            if (yy / 4.1) ** 2 + ((zz - 64.6) / 4.2) ** 2 < 1.0:
                fig.box("head", "visor", (5.1 - 0.05 * yy * yy - 0.03 * (zz - 64.6) ** 2, yy, zz), (0.7, 1.12, 1.12))
            zz += 1.0
        yy += 1.0
    hair_c, hair_r = (-0.7, 0.0, 66.2), (5.9, 6.4, 6.6)
    fig.superellipsoid("head", "ivory", hair_c, hair_r, 2.7, tile=1.8, depth=1.2, gap=0.1,
                       keep=lambda nrm, p: p[2] > 66.0 and not (nrm[0] > 0.0 and abs(p[1]) < 4.3 and p[2] < 67.8))
    # THE BOB, as strands: blocks hanging from the crown to the chin all round the back and sides, straight
    # bangs across the brow, so it reads as hair and not as a helmet.
    for k in range(26):
        az = math.radians(48.0 + (360.0 - 96.0) * k / 25)
        length = 8.6 + 0.9 * math.sin(k * 1.7)
        top = (hair_c[0] + 6.1 * math.cos(az), 6.7 * math.sin(az), 70.4)
        centre = (top[0], top[1], top[2] - length * 0.5)
        pitch, yaw = aim((math.cos(az), math.sin(az), 0.0))
        fig.box("head", "ivory", centre, (1.5, 1.85, length), pitch - 6.0, yaw, 0.0)
    for i in range(9):
        yy = -4.4 + 1.1 * i
        drop = 3.0 + 0.35 * ((i * 5) % 3)
        fig.box("head", "ivory", (5.5 - 0.045 * yy * yy, yy, 70.4 - drop * 0.5), (1.4, 1.2, drop), -8.0, 0.0, (i - 4) * 2.0)
    for side in (-1.0, 1.0):
        for j in range(3):
            fig.box("head", "ivory", (3.6 - j * 1.4, side * (5.2 + 0.35 * j), 64.4), (1.6, 1.4, 8.4 - j * 0.9), 0.0, 0.0, side * 3.0)
    for side in (-1.0, 1.0):
        fig.box("eyes", "eye", (5.55, side * 1.9, 65.0), (0.6, 1.7, 1.15), 0.0, 0.0, side * 12.0)
    # The tiara.
    for i in range(22):
        t = math.radians(-110.0 + 220.0 * i / 21)
        pitch, yaw = aim((math.cos(t), math.sin(t), 0.3))
        fig.box("head", "gold", (hair_c[0] + 5.2 * math.cos(t), 5.6 * math.sin(t), 71.3 + 0.5 * math.cos(t)), (0.7, 1.0, 0.9), pitch, yaw, 0.0)
    for deg, height, tip in ((0.0, 6.5, "gem"), (-26.0, 4.2, "gold"), (26.0, 4.2, "gold"), (-52.0, 2.8, "gold"), (52.0, 2.8, "gold")):
        t = math.radians(deg)
        base = (hair_c[0] + 5.1 * math.cos(t), 5.5 * math.sin(t), 71.6 + 0.5 * math.cos(t))
        steps = max(int(height / 0.8), 2)
        for k in range(steps):
            s = k / (steps - 1)
            size = 1.5 * (1.0 - s) + 0.35
            fig.box("head", "gold", (base[0], base[1], base[2] + height * s), (size * 0.7, size, size), 0.0, deg, 45.0)
        if tip == "gem":
            fig.box("head", "cyan", (base[0] + 0.3, base[1], base[2] + 2.0), (0.8, 1.5, 1.5), 0.0, 0.0, 45.0)
        else:
            fig.box("head", "gold", (base[0], base[1], base[2] + height + 0.4), (0.8, 0.8, 0.8), 0.0, deg + 45.0, 45.0)

    # THE BODY: a slender ivory torso, lilac neck and waist, a gold neckline and the gold key pendant.
    fig.tube(lambda s: "body", lambda s, k: "lilac", [(0.0, 0.0, 57.6), (0.2, 0.0, 61.0)], lambda s: 1.4, tile=1.2, depth=0.8)
    fig.superellipsoid("body", "ivory", (0.0, 0.0, 51.5), (3.9, 4.9, 6.6), 2.5, tile=1.8, depth=1.1, gap=0.08,
                       keep=lambda nrm, p: p[2] > 46.8)
    fig.superellipsoid("body", "lilac", (0.0, 0.0, 45.8), (3.4, 4.2, 2.6), 2.2, tile=1.6, depth=0.9, gap=0.08)
    for i in range(9):
        t = -1.0 + 2.0 * i / 8
        fig.box("body", "gold", (3.9 - 0.8 * t * t, 3.4 * t, 56.4 - 2.8 * (1.0 - abs(t))), (0.7, 0.8, 0.8), 0.0, 0.0, 45.0)
    key_x = 4.6
    for k in range(8):
        a = 2.0 * math.pi * k / 8
        fig.box("body", "gold", (key_x, 0.95 * math.cos(a), 52.2 + 0.95 * math.sin(a)), (0.6, 0.7, 0.7), 0.0, 0.0, math.degrees(a))
    fig.box("body", "gold", (key_x, 0.0, 49.1), (0.6, 0.55, 4.6))
    fig.box("body", "gold", (key_x, 0.6, 47.4), (0.6, 0.9, 0.5))
    fig.box("body", "gold", (key_x, 0.6, 48.3), (0.6, 0.7, 0.5))
    # Shoulders, and the arms: the right lowered along the body, the left reaching out and down, lilac hands.
    for side in (-1.0, 1.0):
        fig.superellipsoid("body", "ivory", (0.0, side * 5.6, 56.2), (2.0, 2.2, 1.7), 2.4, tile=1.3, depth=0.8, gap=0.08)
        fig.box("body", "gold", (0.2, side * 6.4, 55.0), (3.4, 1.0, 0.5), 0.0, 0.0, side * -25.0)
    arms = {1.0: [(0.0, 6.0, 55.4), (0.5, 8.2, 49.2), (1.5, 9.4, 43.6), (2.0, 9.8, 41.6)],
            -1.0: [(0.0, -6.0, 55.4), (0.8, -11.2, 51.6), (1.8, -16.0, 48.2), (2.2, -18.0, 47.2)]}
    for side, spine in arms.items():
        fig.tube(lambda s: "body", lambda s, k: "ivory" if s < 0.45 else "lilac", spine, lambda s: 1.25 - 0.35 * s, tile=1.2, depth=0.8)
        hand = spine[-1]
        fig.box("body", "lilac", hand, (1.4, 1.6, 2.2), 0.0, 0.0, side * 20.0)
        fig.box("body", "gold", lerp3(spine[-2], spine[-1], 0.1), (1.2, 1.6, 0.5), 0.0, 0.0, side * 20.0)
        if side < 0:
            for f in range(4):
                fig.box("body", "lilac", (hand[0] + 0.9, hand[1] - 0.9 - 0.2 * f, hand[2] - 1.3 + 0.7 * f), (0.5, 1.9, 0.45), 0.0, 0.0, -40.0 + 14.0 * f)

    # THE HIPS: armoured ivory plates flaring over the crystal, gold chains draped across them.
    for i in range(14):
        t = 2.0 * math.pi * i / 14
        d = (math.cos(t), math.sin(t), -0.35)
        pitch, yaw = aim((d[0], d[1], 0.0))
        fig.box("body", "ivory", (4.4 * math.cos(t), 5.2 * math.sin(t), 42.4), (1.0, 2.9, 5.2), pitch + 18.0, yaw, 0.0)
        fig.box("body", "gold", (4.9 * math.cos(t), 5.8 * math.sin(t), 39.8), (0.6, 2.7, 0.5), pitch + 18.0, yaw, 0.0)
    for drop, z0 in ((1.6, 44.4), (2.6, 42.4)):
        for i in range(13):
            t = -1.0 + 2.0 * i / 12
            fig.box("body", "gold", (4.8 - 0.5 * t * t, 4.6 * t, z0 - drop * (1.0 - t * t)), (0.5, 0.6, 0.6), 0.0, 0.0, 45.0)

    # THE WINGS: three tiers of long rectangular crystal panes fanning up and back.
    for side, part in ((-1.0, "wingL"), (1.0, "wingR")):
        root = (-3.6, side * 3.2, 55.0)
        tiers = (((52.0, 22.0), (62.0, 29.0), (72.0, 35.0), (82.0, 38.0), (92.0, 36.0), (102.0, 30.0), (112.0, 22.0)),
                 ((18.0, 19.0), (30.0, 24.0), (42.0, 27.0)),
                 ((-30.0, 11.0), (-14.0, 15.0), (2.0, 18.0), (12.0, 17.0)))
        for tier, blades in enumerate(tiers):
            for up, length in blades:
                d = (-0.55 - 0.08 * tier, side * math.cos(math.radians(up)) * 0.9, math.sin(math.radians(up)))
                d = normalise(d)
                panes = 4 if length > 18 else 3
                for pane in range(panes):
                    start = tuple(root[n] + d[n] * (length * pane / panes + 0.5) for n in range(3))
                    material = "wingpale" if (pane == panes - 1 and (int(up) + pane) % 2 == 0) else "wing"
                    fig.blade(part, material, start, d, length / panes - 0.7, 3.2, 0.6, roll=side * 18.0)
        fig.box(part, "gold", root, (1.4, 1.4, 1.4), 0.0, 45.0, 45.0)

    # THE SPECTRAL LOWER BODY: a skirt of crystal flaring under the plates and curling to a point.
    spine = [(0.0, 0.0, 41.0), (-0.4, 0.4, 35.0), (-1.4, 1.4, 28.0), (-2.4, 1.0, 21.0), (-2.4, -1.6, 14.0), (-1.4, -4.6, 8.4),
             (0.0, -6.6, 4.8), (1.2, -7.6, 3.4), (1.8, -7.9, 5.0), (1.6, -7.3, 6.8)]

    def radius_at(s):
        profile = ((0.0, 7.0), (0.10, 8.2), (0.30, 6.6), (0.50, 4.4), (0.70, 2.4), (0.88, 1.0), (1.0, 0.45))
        for (s0, r0), (s1, r1) in zip(profile, profile[1:]):
            if s <= s1:
                return r0 + (r1 - r0) * (s - s0) / (s1 - s0)
        return profile[-1][1]

    crystal_tail(fig, "body", spine, radius_at, 10, ("deep", "base", "cyan"), "halo", density=0.92)

    # Floating crystal cubes.
    for i in range(8):
        a = 2.0 * math.pi * i / 8 + 0.3
        centre = (13.0 * math.cos(a), 14.0 * math.sin(a), 16.0 + 16.0 * ((i * 37) % 10) / 10.0)
        size = 1.3 + 0.6 * ((i * 53) % 7) / 7.0
        fig.box("orbit", "cyan" if i % 3 == 0 else "base", centre, (size, size, size), 30.0 * i, 45.0 + 17.0 * i, 20.0 * i)
    return fig


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", default=os.path.join(here, "..", "Companions"))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    outputs = [
        (lambda: build_ghost("aurum", "GPT 6 Astra"), "GPT6Astra.wlvox"),
        (lambda: build_ghost("aurum", "Aurum"), "LlmGhostAurum.wlvox"),
        (lambda: build_ghost("ember", "Ember"), "LlmGhostEmber.wlvox"),
        (lambda: build_ghost("frost", "Frost"), "LlmGhostFrost.wlvox"),
        (lambda: build_ghost("blossom", "Blossom"), "LlmGhostBlossom.wlvox"),
        (build_fable, "ClaudeCodeFable5.wlvox"),
    ]
    for build, file_name in outputs:
        boxes, parts, materials = build().write(os.path.join(args.out, file_name))
        print("%-24s %5d boxes  %2d parts  %2d materials" % (file_name, boxes, parts, materials))


if __name__ == "__main__":
    main()
