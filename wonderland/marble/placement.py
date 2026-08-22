#!/usr/bin/env python3
"""The one description of where a Marble mesh lands in Unreal.

This chain has been wrong twice, and both times every gate stayed green while
the world was ruined: once by a factor of 100 (a 123-kilometre shell) and once
upside down (a kilometre of castle city hanging below the plaza). Both were
found by reading, not by a check, because the checks compared SORTED extents --
deliberately, so an axis swap is not misreported as a size error -- and a
180-degree flip changes no extent at all.

So the chain lives here, in one stdlib-only place with no engine and no numpy,
where it can be asserted against the numbers the engine actually measured. The
offline previewer renders through it; the test proves it reproduces
transform.expected_unreal_extent_cm from source_mesh.min/max.

The composition, stated once:

  raw glTF vertex           the file's own coordinates, Z-up in this export
  x node rotation           R_x(+90) here, which sends raw +Z to glTF -Y
  x UE's glTF conversion    UE = (gX, -gZ, gY), and 100 uu per glTF unit
  x axis_correction_deg     [180,0,0] -- the roll that undoes the Y-down above
  x unreal_rotation_deg     the artistic yaw, on top of everything
  x actor scale             metric factor, times the backdrop multiplier
  + unreal_origin_cm        the arrival camera, for a backdrop

UE's conversion and the node rotation compose to UE = (x, -y, -z), so with the
[180,0,0] roll the mesh ends up in RAW axis order. That is not an assumption
here: it is what makes expected_unreal_extent_cm come out in raw (x,y,z) order,
which is how the first live import measured it.
"""

import math

BACKDROP = "backdrop_at_camera"


def _matmul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3))
                 for i in range(3))


def rotation(roll, pitch, yaw):
    """Unreal's rotator as a 3x3, applied Z(yaw) . Y(pitch) . X(roll)."""
    r, p, y = (math.radians(v) for v in (roll, pitch, yaw))
    cr, sr, cp, sp, cy, sy = (math.cos(r), math.sin(r), math.cos(p),
                              math.sin(p), math.cos(y), math.sin(y))
    rx = ((1.0, 0.0, 0.0), (0.0, cr, -sr), (0.0, sr, cr))
    ry = ((cp, 0.0, sp), (0.0, 1.0, 0.0), (-sp, 0.0, cp))
    rz = ((cy, -sy, 0.0), (sy, cy, 0.0), (0.0, 0.0, 1.0))
    return _matmul(rz, _matmul(ry, rx))


# UE's glTF import: right-handed Y-up to left-handed Z-up. The 100 uu per glTF
# unit that comes with it is folded into the scale below, because it is a scale.
GLTF_TO_UNREAL = ((1.0, 0.0, 0.0),
                  (0.0, 0.0, -1.0),
                  (0.0, 1.0, 0.0))

UNITS_PER_GLTF_UNIT = 100.0


class Placement(object):
    """Callable transform from raw glTF units to Unreal centimetres."""

    def __init__(self, basis, scale, origin, z_offset):
        self.basis = basis
        self.scale = scale
        self.origin = origin
        self.z_offset = z_offset

    def __call__(self, point):
        x, y, z = point
        b = self.basis
        return tuple(
            (b[i][0] * x + b[i][1] * y + b[i][2] * z) * self.scale
            + self.origin[i] + (self.z_offset if i == 2 else 0.0)
            for i in range(3))

    def describe(self):
        return ("basis rows %s | %.4f cm per glTF unit | origin %s | z offset %+.1f cm"
                % (self.basis, self.scale, self.origin, self.z_offset))


def placement_from(manifest, mode=None):
    """Build the transform this manifest asks for.

    A backdrop is anchored ON the arrival camera and takes no ground offset:
    the mesh origin IS the reconstruction viewpoint, so translating it would
    break the scale-invariance that makes the backdrop multiplier free.
    """
    t = manifest["transform"]
    mode = mode or t.get("placement_mode", "")
    correction = t.get("axis_correction_deg") or [0.0, 0.0, 0.0]
    artistic = t.get("unreal_rotation_deg") or [0.0, 0.0, 0.0]
    basis = _matmul(rotation(artistic[0] + correction[0],
                             artistic[1] + correction[1],
                             artistic[2] + correction[2]), GLTF_TO_UNREAL)
    actor_scale = float(t["unreal_backdrop_scale"] if mode == BACKDROP
                        else t["unreal_uniform_scale"])
    origin = tuple(float(v) for v in t["unreal_origin_cm"])
    z_offset = 0.0 if mode == BACKDROP else float(t.get("ground_plane_offset_m", 0.0)) * 100.0
    return Placement(basis, actor_scale * UNITS_PER_GLTF_UNIT, origin, z_offset)


def node_rotation(manifest):
    """The rotation the GLB's own node carries, as a 3x3.

    This belongs to the MESH, not to the actor: Unreal bakes the node hierarchy
    into the static mesh at import, so by the time the actor transform applies,
    the vertices are already in glTF scene space. It matters here only because
    source_mesh.min/max are read from the accessor, which is BEFORE the node --
    predicting the Unreal extent from those bounds without it silently swaps
    two axes, and sorted-extent checks cannot see that.
    """
    q = manifest.get("source_mesh", {}).get("node_rotation_quat_xyzw")
    if not q:
        return ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    x, y, z, w = (float(v) for v in q)
    return ((1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
            (2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
            (2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)))


def corners(minimum, maximum):
    return [(x, y, z) for x in (minimum[0], maximum[0])
            for y in (minimum[1], maximum[1])
            for z in (minimum[2], maximum[2])]


def extent_of(points):
    axes = list(zip(*points))
    return tuple(max(a) - min(a) for a in axes)


def predicted_extent(manifest, mode=None):
    """The Unreal extent this manifest's own source_mesh bounds imply.

    Returned in Unreal axis order, so it can be compared against
    transform.expected_unreal_extent_cm component by component -- which is the
    comparison the importer's own scale gate deliberately cannot make.
    """
    src = manifest["source_mesh"]
    node = node_rotation(manifest)
    place = placement_from(manifest, mode)
    pts = []
    for c in corners(src["min"], src["max"]):
        g = tuple(node[i][0] * c[0] + node[i][1] * c[1] + node[i][2] * c[2] for i in range(3))
        pts.append(place(g))
    return extent_of(pts)


def predicted_centre_offset_cm(manifest, mode=None):
    """Where the geometry's bounding-box CENTRE sits relative to the actor origin.

    This is the signed quantity an extent check throws away, and it is the one
    that catches a flip. This export's raw bounds run z = -0.94 .. +80.49: the
    shell is overwhelmingly ABOVE its own pivot, because the pivot is the
    reconstruction viewpoint standing on the plaza floor. Land it upside down
    and that offset points down instead, while every extent is unchanged and
    every existing gate stays green -- which is exactly what happened.
    """
    src = manifest["source_mesh"]
    node = node_rotation(manifest)
    place = placement_from(manifest, mode)
    pts = []
    for c in corners(src["min"], src["max"]):
        g = tuple(node[i][0] * c[0] + node[i][1] * c[1] + node[i][2] * c[2] for i in range(3))
        pts.append(place(g))
    axes = list(zip(*pts))
    centre = [(max(a) + min(a)) / 2.0 for a in axes]
    origin = place(place_inverse_origin())
    return tuple(centre[i] - origin[i] for i in range(3))


def place_inverse_origin():
    """The mesh point that lands on unreal_origin_cm. It is the mesh origin:
    every rotation here fixes it and the scale is uniform."""
    return (0.0, 0.0, 0.0)
