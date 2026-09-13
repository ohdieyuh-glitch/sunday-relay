"""Stacking Blender kit tower modules by the kit's own socket grammar (shared by skyline layers).

A tower is foot -> body* -> terminator. Two modules join when the lower one's `top` socket and the
upper one's `bottom` socket are both of kind `tower` on the same radius rung; a terminator's top is
kind `crown`. Every storey sits at the MEASURED top socket height of the one below
(kit_modules.json, copied from the forge manifest) -- no height is typed here.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = json.loads((HERE / "kit_modules.json").read_text(encoding="utf-8"))
MODULES = KIT["modules"]


def _is_foot(m):
    return m["group"] == "towers" and m["sockets"].get("bottom", {}).get("kind") == "ground" and m["sockets"].get("top", {}).get("kind") == "tower"


def _is_body(m):
    return m["group"] == "towers" and m["sockets"].get("bottom", {}).get("kind") == "tower" and m["sockets"].get("top", {}).get("kind") == "tower"


def _is_terminator(m):
    return m["group"] == "towers" and m["sockets"].get("bottom", {}).get("kind") == "tower" and m["sockets"].get("top", {}).get("kind") == "crown"


def spellings(max_bodies=3):
    """Every legal foot -> body* -> terminator spelling, with its measured total height."""
    feet = [k for k, m in MODULES.items() if _is_foot(m)]
    bodies = [k for k, m in MODULES.items() if _is_body(m)]
    terms = [k for k, m in MODULES.items() if _is_terminator(m)]
    out = []

    def grow(stack, rung, height):
        for t in terms:
            if MODULES[t]["sockets"]["bottom"]["rung"] == rung:
                out.append((stack + [t], height + MODULES[t]["sockets"]["top"]["z"]))
        if len(stack) - 1 >= max_bodies:
            return
        for b in bodies:
            if b in stack:
                continue
            if MODULES[b]["sockets"]["bottom"]["rung"] == rung:
                grow(stack + [b], MODULES[b]["sockets"]["top"]["rung"], height + MODULES[b]["sockets"]["top"]["z"])

    for f in feet:
        grow([f], MODULES[f]["sockets"]["top"]["rung"], MODULES[f]["sockets"]["top"]["z"])
    return out


def storeys(stack):
    """[(module, z)] with each module at the measured top of the one below."""
    z = 0.0
    rows = []
    for name in stack:
        rows.append((name, z))
        z += MODULES[name]["sockets"]["top"]["z"]
    return rows


class Batches:
    """Instances keyed by mesh + material, the way WonderlandInstancedBatch draws them."""

    def __init__(self, prefix):
        self.prefix = prefix
        self.batches = {}

    def add_module(self, name, x, y, z, yaw, scale):
        for part in MODULES[name]["parts"]:
            mesh_name = part["mesh"].split(".")[-1]
            key = "%s_%s_%s" % (self.prefix, mesh_name.replace("WL_", ""), part["material"].replace("MI_V2_", ""))
            b = self.batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": part["material"], "instances": [],
                                              "collides": False, "cast_shadow": True, "affect_df": False})
            b["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                                   round(scale, 3), round(scale, 3), round(scale, 3)])

    def add_stack(self, stack, x, y, ground_z, yaw, scale):
        top = ground_z
        for name, z in storeys(stack):
            self.add_module(name, x, y, ground_z + z * scale, yaw, scale)
            top = ground_z + (z + MODULES[name]["sockets"]["top"]["z"]) * scale
        return top

    def as_list(self):
        return list(self.batches.values())


def footprint(stack):
    return MODULES[stack[0]]["radius"]


def rotate(dx, dy, yaw_deg):
    a = math.radians(yaw_deg)
    return dx * math.cos(a) - dy * math.sin(a), dx * math.sin(a) + dy * math.cos(a)
