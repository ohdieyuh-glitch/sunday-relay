"""Generate the two companion preview figures for AWonderlandCompanionEmbodiment.

WHAT THESE ARE. The founder asked (2026-09-15) to SEE an imported LLM Companion and an imported Jhinn AI
Agent floating beside the Relay Dog before any import is wired. Each companion's body is a list of boxes in
the `wlvox 1` text format (Source/Wonderland/WonderlandCompanionFigure.h), which the embodiment reads at
spawn and builds from engine cubes. No asset is created: the figures live in wonderland/Companions/ and can
be regenerated and reloaded in PIE with `wl.Companion.Reload`, no compile needed.

WHAT THEY FOLLOW. The founder's concept frame for the two mascot skins, and the Jhin canon in
WorldDesign/PRODUCTION_ORDER.md: a Jhin is ivory with a dark visor, warm glowing eyes and a spectral lower
body, and an IMPORTED agent's lower body is the immutable cyan-blue crystalline colour. So:

  GPT 6 Astra (LLM Companion) -- a small hooded sprite with a curled cap and a gold star, happy ^ ^ eyes,
  ice-crystal wings and a STARLIGHT wisp: white, the colour of its HUD meter. It is not a Jhin and does not
  wear the imported-agent colour.

  Claude Code Fable 5 (Jhinn AI Agent, imported) -- a taller crowned figure with warm gold eyes, big lavender
  crystal wings, a gold pendant and the CYAN-BLUE CRYSTALLINE spectral lower body.

WHY TILES AND NOT A GRID. A strict voxel grid reads as a block game. Small faceted tiles laid on ellipsoids
and tubes, each turned to face out of the surface, give the sculpted, crumpled-crystal look of the concept
while staying boxes the engine can instance. Everything is seeded, so a regeneration is byte-identical.

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


def aim(direction):
    """Pitch and yaw (degrees) that turn a box's local +X toward `direction`, the way FVector::Rotation does."""
    x, y, z = normalise(direction)
    return math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))


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
    def tile_ellipsoid(self, part, material, centre, radii, tile, depth, keep=None, jitter=0.18, lat=(-90.0, 90.0), inflate=1.0):
        """Tiles over an ellipsoid; `keep(normal, point)` may reject a tile (a face opening, a cut)."""
        cx, cy, cz = centre
        rx, ry, rz = radii
        mean = (rx + ry + rz) / 3.0
        rings = max(3, int(round(math.radians(lat[1] - lat[0]) * mean / tile)))
        for ring in range(rings + 1):
            phi = math.radians(lat[0] + (lat[1] - lat[0]) * ring / rings)
            around = max(1, int(round(2.0 * math.pi * math.cos(phi) * mean / tile)))
            offset = self.rng.random() * 2.0 * math.pi
            for k in range(around):
                theta = offset + 2.0 * math.pi * k / around
                ux, uy, uz = math.cos(phi) * math.cos(theta), math.cos(phi) * math.sin(theta), math.sin(phi)
                point = (cx + rx * ux * inflate, cy + ry * uy * inflate, cz + rz * uz * inflate)
                normal = normalise((ux / rx, uy / ry, uz / rz))
                if keep is not None and not keep(normal, point):
                    continue
                j = 1.0 + (self.rng.random() - 0.5) * 2.0 * jitter
                pitch, yaw = aim(normal)
                roll = (self.rng.random() - 0.5) * 14.0
                self.box(part, material, point, (depth, tile * 1.08 * j, tile * 1.12 * (2.0 - j)), pitch, yaw, roll)

    def tube(self, part_for, material_for, spine, radius_for, tile, depth, twist=0.0):
        """Rings of tiles around a polyline spine. `part_for(s)`, `material_for(s, k)`, `radius_for(s)` take arc fraction s."""
        lengths = [0.0]
        for i in range(1, len(spine)):
            lengths.append(lengths[-1] + math.dist(spine[i], spine[i - 1]))
        total = lengths[-1] or 1.0
        s_step = tile / total
        s = 0.0
        while s <= 1.0 + 1e-6:
            target = s * total
            i = 1
            while i < len(spine) - 1 and lengths[i] < target:
                i += 1
            span = (lengths[i] - lengths[i - 1]) or 1.0
            w = (target - lengths[i - 1]) / span
            p0, p1 = spine[i - 1], spine[i]
            centre = tuple(p0[a] + (p1[a] - p0[a]) * w for a in range(3))
            tangent = normalise(tuple(p1[a] - p0[a] for a in range(3)))
            helper = (0.0, 0.0, 1.0) if abs(tangent[2]) < 0.9 else (1.0, 0.0, 0.0)
            u = normalise(cross(tangent, helper))
            v = cross(tangent, u)
            r = radius_for(s)
            around = max(3, int(round(2.0 * math.pi * r / tile)))
            phase = twist * s * 2.0 * math.pi
            for k in range(around):
                a = phase + 2.0 * math.pi * k / around
                normal = tuple(math.cos(a) * u[n] + math.sin(a) * v[n] for n in range(3))
                point = tuple(centre[n] + normal[n] * r for n in range(3))
                pitch, yaw = aim(normal)
                size = max(tile * (0.55 + 0.45 * r / max(radius_for(0.0), 0.01)), 0.35)
                self.box(part_for(s), material_for(s, k), point, (depth, size * 1.1, size * 1.15), pitch, yaw, (self.rng.random() - 0.5) * 20.0)
            s += s_step

    def shard(self, part, material, root, direction, length, width, thickness, roll=0.0):
        """A long crystal shard from `root` along `direction`: local X is the length."""
        d = normalise(direction)
        centre = tuple(root[n] + d[n] * length * 0.5 for n in range(3))
        pitch, yaw = aim(d)
        self.box(part, material, centre, (length, width, thickness), pitch, yaw, roll)

    def hex_crystal(self, part, material, centre, axis, radius, thickness):
        """Three flat bars turned 0, 60 and 120 degrees about one axis read as a hexagonal gem."""
        pitch, yaw = aim(axis)
        for turn in (0.0, 60.0, 120.0):
            self.box(part, material, centre, (thickness, radius * 1.732, radius), pitch, yaw, turn)

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
        assert len(self.boxes) <= 6000 and len(self.parts) <= 48 and len(self.materials) <= 12
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write("\n".join(lines) + "\n")
        return len(self.boxes), len(self.parts), len(self.materials)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def spiral_tail(fig, parent, top, height, top_radius, segments, glow, core, sweep=(-3.0, 5.0), turns=0.85):
    """A spectral wisp: a spiral spine from `top` down to a point, split into tail parts for the travelling sway."""
    tx, ty, tz = top
    spine = []
    for i in range(33):
        s = i / 32.0
        swirl = turns * 2.0 * math.pi * s
        spine.append((tx + sweep[0] * math.sin(math.pi * s) + 1.6 * s * math.cos(swirl),
                      ty + sweep[1] * math.sin(1.3 * math.pi * s) * s + 1.6 * s * math.sin(swirl),
                      tz - height * s))
    for k in range(segments):
        s = (k + 0.5) / segments
        idx = min(int(s * 32), 32)
        fig.part("tail%d" % k, parent, spine[idx], "tail", k, segments)

    def part_for(s):
        return "tail%d" % min(int(s * segments), segments - 1)

    def radius_for(s):
        return max(top_radius * (1.0 - s) ** 1.25, 0.35)

    fig.tube(part_for, lambda s, k: glow, spine, radius_for, tile=1.7, depth=0.55, twist=0.35)
    # A brighter core, so the wisp has a body of light and not only a shell.
    for i in range(0, 30, 2):
        s = i / 32.0
        p = spine[i]
        r = radius_for(s) * 0.55
        fig.box(part_for(s), core, p, (r * 1.2, r * 1.2, 1.8), 0.0, fig.rng.random() * 90.0, 0.0)
    return spine


# ============================================================================ GPT 6 Astra
def build_astra():
    fig = Figure("GPT 6 Astra -- LLM Companion", seed=6061)
    fig.material("ivory", "lit", (0.86, 0.82, 0.74))
    fig.material("gold", "lit", (0.92, 0.56, 0.12))
    fig.material("visor", "lit", (0.008, 0.008, 0.011))
    fig.material("eye", "glow", (1.0, 0.42, 0.08), 7.0)
    fig.material("ice", "glow", (0.55, 0.80, 1.0), 2.2)
    fig.material("starlight", "glow", (0.84, 0.92, 1.0), 2.6)
    fig.material("halo", "add", (0.35, 0.60, 1.0), 0.9)

    fig.part("body", "-", (0.0, 0.0, 30.0), "none")
    fig.part("head", "body", (0.0, 0.0, 40.0), "head")
    fig.part("eyes", "head", (10.6, 0.0, 46.0), "blink")
    fig.part("cap", "head", (-2.0, 0.0, 56.0), "none")
    fig.part("wingL", "body", (-6.5, -5.5, 35.0), "wing", -1)
    fig.part("wingR", "body", (-6.5, 5.5, 35.0), "wing", 1)
    fig.part("orbit", "body", (0.0, 0.0, 36.0), "orbit", 16.0)

    # THE HOOD: an ivory shell open at the front, the opening rimmed in gold.
    head_c, head_r = (0.0, 0.0, 46.0), (11.0, 12.0, 12.2)
    fig.tile_ellipsoid("head", "ivory", head_c, head_r, tile=2.3, depth=1.1,
                       keep=lambda n, p: not (n[0] > 0.52 and abs(p[2] - 45.5) < 10.5))
    for i in range(46):
        t = 2.0 * math.pi * i / 46
        y, z = 9.3 * math.cos(t), 45.3 + 9.6 * math.sin(t)
        x = head_r[0] * math.sqrt(max(0.0, 1.0 - (y / head_r[1]) ** 2 - ((z - head_c[2]) / head_r[2]) ** 2)) + 0.4
        pitch, yaw = aim((1.0, y * 0.08, (z - 45.3) * 0.08))
        fig.box("head", "gold", (x, y, z), (1.2, 1.9, 1.5), pitch, yaw, math.degrees(t))
    # THE FACE: a dark glossy screen set back in the opening.
    fig.tile_ellipsoid("head", "visor", (2.2, 0.0, 45.4), (8.6, 9.0, 8.9), tile=1.7, depth=0.9,
                       keep=lambda n, p: n[0] > 0.18)
    # HAPPY EYES, ^ ^: arches of warm light.
    for side in (-1.0, 1.0):
        for i in range(9):
            t = -1.0 + 2.0 * i / 8
            y = side * 3.9 + 2.5 * t
            z = 45.6 + 1.9 * (1.0 - t * t)
            slope = -math.degrees(math.atan(3.8 * t / 2.5))
            fig.box("eyes", "eye", (10.55 - 0.2 * t * t, y, z), (0.6, 1.25, 0.72), 0.0, 0.0, slope)

    # THE CURLED CAP: a tapering tube up and back from the crown, then curling forward, a gold band at its base.
    cap_spine = [(-2.0, 0.0, 54.0), (-4.5, 0.0, 59.5), (-8.5, 0.0, 63.5), (-12.5, 0.0, 65.0), (-15.0, 0.0, 63.0), (-14.5, 0.0, 60.0)]
    fig.tube(lambda s: "cap", lambda s, k: "gold" if 0.06 < s < 0.13 else "ivory", cap_spine,
             lambda s: max(6.2 * (1.0 - s) ** 1.1, 0.5), tile=1.9, depth=1.0, twist=0.1)
    star = (-14.2, 0.0, 58.4)
    fig.box("cap", "gold", star, (1.0, 1.0, 5.2))
    fig.box("cap", "gold", star, (1.0, 5.2, 1.0))
    fig.box("cap", "gold", star, (1.0, 2.6, 2.6), 0.0, 0.0, 45.0)
    fig.box("cap", "starlight", (star[0] + 0.6, star[1], star[2]), (0.4, 1.2, 1.2), 0.0, 0.0, 45.0)

    # THE SHOULDERS AND CAPE, with a gold collar.
    fig.tile_ellipsoid("body", "ivory", (0.0, 0.0, 30.5), (7.4, 9.0, 6.6), tile=2.1, depth=1.0)
    for i in range(30):
        t = 2.0 * math.pi * i / 30
        p = (6.6 * math.cos(t), 8.1 * math.sin(t), 35.2)
        pitch, yaw = aim((math.cos(t), math.sin(t), 0.25))
        fig.box("body", "gold", p, (1.0, 1.8, 1.2), pitch, yaw, 0.0)
    for side in (-1.0, 1.0):
        fig.tile_ellipsoid("body", "ivory", (1.5, side * 9.4, 28.5), (2.7, 2.6, 4.2), tile=1.6, depth=0.8)
        fig.box("body", "gold", (1.6, side * 9.6, 24.8), (2.6, 2.6, 0.9))

    # ICE-CRYSTAL WINGS: two fans of shards behind the shoulders.
    for side, part in ((-1.0, "wingL"), (1.0, "wingR")):
        root = (-6.5, side * 5.5, 35.0)
        for i in range(7):
            up = math.radians(8.0 + 12.0 * i)
            direction = (-0.45, side * math.cos(up), math.sin(up) + 0.15)
            fig.shard(part, "ice", root, direction, 7.5 + 5.0 * math.sin(math.pi * (i + 0.5) / 7), 1.7, 0.7, roll=side * 12.0)
        for i in range(4):
            down = math.radians(-35.0 + 11.0 * i)
            direction = (-0.5, side * math.cos(down), math.sin(down))
            fig.shard(part, "ice", (root[0], root[1], root[2] - 2.0), direction, 5.5 + 1.2 * i, 1.4, 0.6, roll=side * -10.0)

    # THE STARLIGHT WISP.
    spiral_tail(fig, "body", (0.0, 0.0, 25.0), 25.0, 6.6, 8, "starlight", "halo", sweep=(-3.5, 4.5), turns=0.9)

    # HEX CRYSTALS in orbit and FOUR-POINT SPARKLES around it.
    for i in range(5):
        a = 2.0 * math.pi * i / 5 + 0.4
        centre = (19.0 * math.cos(a), 19.0 * math.sin(a), 30.0 + 9.0 * math.sin(2.1 * a))
        fig.hex_crystal("orbit", "ice", centre, (math.cos(a + 1.0), math.sin(a + 1.0), 0.6), 1.5, 0.45)
    for i, (x, y, z) in enumerate(((6.0, -16.0, 52.0), (4.0, 17.0, 44.0), (7.0, -14.0, 22.0), (3.0, 15.0, 13.0), (5.0, -9.0, 62.0))):
        name = "spark%d" % i
        fig.part(name, "body", (x, y, z), "twinkle", i / 5.0)
        fig.sparkle(name, "starlight", (x, y, z), 2.6)
    return fig


# ============================================================================ Claude Code Fable 5
def build_fable():
    fig = Figure("Claude Code Fable 5 -- Jhinn AI Agent (imported)", seed=5150)
    fig.material("ivory", "lit", (0.86, 0.82, 0.74))
    fig.material("gold", "lit", (0.92, 0.56, 0.12))
    fig.material("visor", "lit", (0.008, 0.008, 0.011))
    fig.material("eye", "glow", (1.0, 0.72, 0.30), 6.0)
    # THE IMPORTED-AGENT COLOUR (canon, immutable): cyan-blue crystalline, never throat-chakra blue.
    fig.material("imported", "glow", (0.25, 0.85, 1.0), 2.8)
    fig.material("importedhalo", "add", (0.20, 0.70, 1.0), 0.9)
    fig.material("lavender", "glow", (0.62, 0.45, 1.0), 2.3)
    fig.material("lilac", "lit", (0.72, 0.62, 0.95))

    fig.part("body", "-", (0.0, 0.0, 38.0), "none")
    fig.part("head", "body", (0.0, 0.0, 50.0), "head")
    fig.part("eyes", "head", (9.6, 0.0, 57.0), "blink")
    fig.part("wingL", "body", (-6.0, -5.0, 48.0), "wing", -1)
    fig.part("wingR", "body", (-6.0, 5.0, 48.0), "wing", 1)
    fig.part("orbit", "body", (0.0, 0.0, 44.0), "orbit", -12.0)

    # THE HEAD: a tall ivory hood open at the front, a dark visor inside.
    head_c, head_r = (0.0, 0.0, 57.0), (9.6, 10.2, 11.6)
    fig.tile_ellipsoid("head", "ivory", head_c, head_r, tile=2.1, depth=1.0,
                       keep=lambda n, p: not (n[0] > 0.5 and abs(p[2] - 56.5) < 8.8))
    fig.tile_ellipsoid("head", "visor", (1.8, 0.0, 56.3), (7.6, 8.2, 8.0), tile=1.6, depth=0.9,
                       keep=lambda n, p: n[0] > 0.16)
    for side in (-1.0, 1.0):
        for dy in (-0.7, 0.7):
            for dz in (-1.1, 0.0, 1.1):
                if abs(dy) > 0.5 and abs(dz) > 1.0:
                    continue
                fig.box("eyes", "eye", (9.55, side * 3.3 + dy, 57.0 + dz), (0.6, 1.3, 1.25))

    # THE CROWN: a gold band and a rising row of spires, the tallest at the front, cyan gems at their tips.
    for i in range(34):
        t = 2.0 * math.pi * i / 34
        p = (8.2 * math.cos(t), 8.7 * math.sin(t), 66.2)
        pitch, yaw = aim((math.cos(t), math.sin(t), 0.1))
        fig.box("head", "gold", p, (1.0, 1.7, 1.8), pitch, yaw, 0.0)
    for i, deg in enumerate((-70.0, -45.0, -22.0, 0.0, 22.0, 45.0, 70.0)):
        t = math.radians(deg)
        h = 9.5 - abs(deg) / 70.0 * 5.0
        base = (8.0 * math.cos(t), 8.5 * math.sin(t), 67.0)
        fig.box("head", "gold", (base[0], base[1], base[2] + h * 0.5), (1.1, 1.1, h), 0.0, math.degrees(t), 0.0)
        fig.box("head", "imported", (base[0], base[1], base[2] + h + 0.6), (1.2, 1.2, 1.2), 0.0, math.degrees(t) + 45.0, 45.0)

    # THE TORSO AND ARMS, with the gold pendant.
    fig.tile_ellipsoid("body", "ivory", (0.0, 0.0, 41.0), (6.2, 7.6, 8.4), tile=2.0, depth=1.0)
    for i in range(18):
        t = -1.0 + 2.0 * i / 17
        fig.box("body", "gold", (6.4 - 1.2 * t * t, 4.2 * t, 45.5 - 2.6 * (1.0 - t * t)), (0.8, 0.9, 0.9))
    fig.box("body", "gold", (6.9, 0.0, 40.5), (1.0, 2.2, 3.4))
    fig.box("body", "imported", (7.5, 0.0, 40.8), (0.6, 1.1, 1.1), 0.0, 0.0, 45.0)
    for side in (-1.0, 1.0):
        fig.tile_ellipsoid("body", "ivory", (0.0, side * 8.2, 46.5), (3.2, 3.2, 3.0), tile=1.7, depth=0.9)
        arm = [(0.0, side * 8.8, 45.0), (2.0, side * 12.5, 40.0), (4.0, side * 16.0, 35.5)]
        fig.tube(lambda s: "body", lambda s, k: "gold" if s > 0.82 else "ivory", arm, lambda s: 2.1 - 0.7 * s, tile=1.6, depth=0.8)

    # THE WINGS: a tall upper fan and a shorter lower one of lavender crystal, lilac edges for form in daylight.
    for side, part in ((-1.0, "wingL"), (1.0, "wingR")):
        root = (-6.0, side * 5.0, 48.0)
        for i in range(10):
            up = math.radians(5.0 + 9.5 * i)
            direction = (-0.55, side * math.cos(up), math.sin(up) + 0.25)
            length = 14.0 + 13.0 * math.sin(math.pi * (i + 0.6) / 10)
            fig.shard(part, "lavender" if i % 3 else "lilac", root, direction, length, 2.4, 0.8, roll=side * 16.0)
            tip = tuple(root[n] + normalise(direction)[n] * length for n in range(3))
            fig.box(part, "lavender", tip, (1.3, 1.3, 1.3), 0.0, 45.0, 45.0)
        for i in range(6):
            down = math.radians(-58.0 + 10.0 * i)
            direction = (-0.6, side * math.cos(down), math.sin(down))
            fig.shard(part, "lavender" if i % 2 else "lilac", (root[0], root[1], root[2] - 5.0), direction, 10.0 + 1.6 * i, 2.0, 0.7, roll=side * -14.0)

    # THE IMPORTED SPECTRAL LOWER BODY: a flared crystalline skirt that becomes the wisp.
    spiral_tail(fig, "body", (0.0, 0.0, 33.5), 33.0, 8.6, 10, "imported", "importedhalo", sweep=(-4.0, -5.0), turns=0.75)

    # HEX CRYSTALS in orbit, cyan and lavender.
    for i in range(6):
        a = 2.0 * math.pi * i / 6 + 0.25
        centre = (22.0 * math.cos(a), 22.0 * math.sin(a), 36.0 + 11.0 * math.sin(1.7 * a))
        fig.hex_crystal("orbit", "imported" if i % 2 else "lavender", centre, (math.cos(a + 0.8), math.sin(a + 0.8), 0.5), 1.8, 0.5)
    return fig


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", default=os.path.join(here, "..", "Companions"))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for build, file_name in ((build_astra, "GPT6Astra.wlvox"), (build_fable, "ClaudeCodeFable5.wlvox")):
        boxes, parts, materials = build().write(os.path.join(args.out, file_name))
        print("%-24s %5d boxes  %2d parts  %2d materials" % (file_name, boxes, parts, materials))


if __name__ == "__main__":
    main()
