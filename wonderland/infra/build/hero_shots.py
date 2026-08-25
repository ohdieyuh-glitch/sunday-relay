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

    # NAMED CONSTANTS IN THE TABLE, RESOLVED. The arrival position used to be
    # typed out twice — once for HeroCam0 and once for HeroCam6 — and the
    # companions' keep-out needed it a third time, so it became ARRIVAL_CAM.
    # ast.literal_eval cannot see a Name and this gate died on it, which is the
    # gate doing its job: the table it reads is the table the world is built
    # from, and it must keep reading the same one.
    consts = {}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id.isupper():
                try:
                    consts[t.id] = ast.literal_eval(node.value)
                except (ValueError, SyntaxError):
                    pass   # not a literal; nothing this gate can use

    UNRESOLVED = object()

    def resolve(element):
        """literal_eval, but a bare NAME resolves to the constant it names.

        RUNTIME VALUES ARE NOT A FAILURE, THEY ARE A BLIND SPOT, and the
        difference matters. HeroCam3 and HeroCam4 frame a LANDMARK, so they now
        ask landmark_xy where that landmark actually ended up rather than
        carrying a copy of its coordinates -- a copy that had already gone 800
        uu stale elsewhere in this generator and that verify-landmark-copies.py
        now fails the build over. Restoring the literals to keep this gate happy
        would trade a real defect for a readable one.

        So: a shot this gate cannot evaluate is SKIPPED AND NAMED, never
        silently dropped, and the caller still fails if a shot it is actually
        about is among them.
        """
        if isinstance(element, ast.Name):
            return consts.get(element.id, UNRESOLVED)
        try:
            return ast.literal_eval(element)
        except (ValueError, SyntaxError, TypeError):
            return UNRESOLVED

    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if "hero_shots" not in targets:
            continue
        shots, skipped = {}, []
        for element in node.value.elts:
            index, pos, look, fov = (resolve(e) for e in element.elts)
            if UNRESOLVED in (index, pos, look, fov):
                skipped.append(index if isinstance(index, int) else "?")
                continue
            shots[index] = (pos, look, fov)
        if skipped:
            print("  NOTE: hero shot(s) %s are positioned from the layout at "
                  "runtime (landmark_xy) and cannot be read statically. NOT "
                  "CHECKED by this gate." % ", ".join(str(i) for i in skipped))
            # The arrival cameras are what every hero gate is about. If one of
            # THOSE went runtime, silence would be the wrong answer.
            for _needed in (0, 6):
                if _needed in skipped:
                    fail("hero shot %d could not be read statically, and it is "
                         "the arrival camera this gate exists to check"
                         % _needed)
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
