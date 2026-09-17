#!/usr/bin/env python3
"""Where a census box's wall REALLY is: seat wall-mounted dressing on the mesh, not on its bounding box (2026-09-17).

WHY. building_census.py gives every generator wall as an oriented box, and faces_of(box) has been every facade pass's
idea of the wall. It is not the wall. Cornices, balconies and pilasters reach the bounds, so the wall itself stands
inside them: a castle hall's wall is 30-38 cm (local) inside, and a facade panel's front wall is 56 cm inside. WB01's
plinth course, placed on box faces, stood half a metre out in the street. Measured against the layers, FD02 windows
float a median 28-30 cm off castle-hall walls and SF01 shopfronts 30-38 cm.

HOW. mesh_sections.py slices each wall mesh horizontally at fixed heights in its own space (wall_sections.json, kept
here so designs reproduce). A slice's outline is the wall at that height. seats() maps it through the census box
(centre, yaw, half-extents, z range) into the same face frame faces_of() uses:
  depth  how far the real wall is behind the box face (world cm), and
  lo, hi the real wall's extent along the face's tangent (-ny, nx), measured from the box centre.
The meshes are closed rectangles at every slice, so a slice's extents are its wall planes.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SECTIONS = json.loads((HERE / "wall_sections.json").read_text(encoding="utf-8"))


def _outline(sec, h):
    segs = sec["levels"][h]
    xs = [v for g in segs for v in (g[0], g[2])]
    ys = [v for g in segs for v in (g[1], g[3])]
    return min(xs), max(xs), min(ys), max(ys)


def levels_between(mesh, lo_local, hi_local):
    """The slice heights (local units above the mesh's foot) that have an outline, within [lo_local, hi_local]."""
    sec = SECTIONS[mesh]
    hs = sorted(float(h) for h, s in sec["levels"].items() if s)
    inside = [h for h in hs if lo_local <= h <= hi_local]
    return inside or [min(hs, key=lambda h: min(abs(h - lo_local), abs(h - hi_local)))]


def seats(b, h):
    """For each of faces_of(b)'s four faces, (depth, lo, hi) in world cm from the slice `h` (a key of the mesh's
    levels, e.g. "5.0")."""
    sec = SECTIONS[b["mesh"]]
    x0, y0, _, x1, y1, _ = sec["bb"]
    ox0, ox1, oy0, oy1 = _outline(sec, h if isinstance(h, str) else str(float(h)))
    cx, cy = (x0 + x1) * 0.5, (y0 + y1) * 0.5
    sx, sy = b["hx"] / ((x1 - x0) * 0.5), b["hy"] / ((y1 - y0) * 0.5)
    return [((x1 - ox1) * sx, (oy0 - cy) * sy, (oy1 - cy) * sy),        # +X, tangent +Y
            ((ox0 - x0) * sx, -(oy1 - cy) * sy, -(oy0 - cy) * sy),      # -X, tangent -Y
            ((y1 - oy1) * sy, -(ox1 - cx) * sx, -(ox0 - cx) * sx),      # +Y, tangent -X
            ((oy0 - y0) * sy, (ox0 - cx) * sx, (ox1 - cx) * sx)]        # -Y, tangent +X


def local_z(b, z_world):
    """A world height as local units above the mesh's foot."""
    sec = SECTIONS[b["mesh"]]
    sz = (b["zmax"] - b["zmin"]) / (sec["bb"][5] - sec["bb"][2])
    return (z_world - b["zmin"]) / sz


def wall_depth(b, fi, z0, z1):
    """The plain wall's depth behind face fi over the world height band [z0, z1]: the median of the slices inside it, so
    one string course or cornice slice cannot move a window."""
    ds = sorted(seats(b, str(h))[fi][0] for h in levels_between(b["mesh"], local_z(b, z0), local_z(b, z1)))
    return ds[len(ds) // 2]
