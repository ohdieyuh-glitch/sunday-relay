#!/usr/bin/env python3
"""The generator's hero-shot table, read once and shared.

The camera list lives in generate-hub-level.py as a literal inside a function
that imports `unreal`, so it cannot be imported outside the editor. Both the
pre-build skyline gate and the browser inspector's placement contract need it,
and two parsers of the same literal is two chances to disagree about what the
world contains.
"""
import ast
import io
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATOR = os.path.join(HERE, "generate-hub-level.py")
ASPECT = 9.0 / 16.0

ARRIVAL = 0
WIDE = 6
LABELS = {
    0: "ARRIVAL_HERO",
    1: "DOG_CLOSEUP",
    2: "GOLDEN_GATE",
    3: "GIANT_TREE",
    4: "MISSION_OVERLOOK",
    5: "AGENT_GARDEN",
    6: "ARRIVAL_WIDE",
}


def fail(msg):
    raise SystemExit("hero_shots: %s" % msg)


def hero_shots():
    """Read the generator's hero-shot table without importing it -- it imports
    `unreal`, which does not exist outside the editor."""
    tree = ast.parse(io.open(GENERATOR, encoding="utf8").read(), GENERATOR)
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if "hero_shots" not in targets:
            continue
        shots = {}
        for element in node.value.elts:
            index, pos, look, fov = ast.literal_eval(element)
            shots[index] = (pos, look, fov)
        return shots
    fail("no hero_shots table in %s" % GENERATOR)




def frame(pos, look, fov_deg):
    """-> (pitch, bottom, top) in degrees. Unreal FOV is HORIZONTAL."""
    dx, dy, dz = (look[i] - pos[i] for i in range(3))
    flat = math.hypot(dx, dy)
    pitch = math.degrees(math.atan2(dz, flat)) if flat else (90.0 if dz > 0 else -90.0)
    half_v = math.degrees(math.atan(math.tan(math.radians(fov_deg) * 0.5) * ASPECT))
    return pitch, pitch - half_v, pitch + half_v


def yaw_of(pos, look):
    return math.degrees(math.atan2(look[1] - pos[1], look[0] - pos[0]))


def described():
    """Every hero shot with its derived framing, ready to serialise."""
    out = []
    for index, (pos, look, fov) in sorted(hero_shots().items()):
        pitch, bottom, top = frame(pos, look, fov)
        out.append({
            "index": index,
            "label": LABELS.get(index, "HERO%d" % index),
            "tag": "HeroCam%d" % index,
            "location_cm": list(pos),
            "look_at_cm": list(look),
            "fov_horizontal_deg": fov,
            "pitch_deg": round(pitch, 4),
            "yaw_deg": round(yaw_of(pos, look), 4),
            "frame_elevation_deg": [round(bottom, 4), round(top, 4)],
            "aspect": ASPECT,
        })
    return out
