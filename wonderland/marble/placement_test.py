#!/usr/bin/env python3
"""Where a Marble mesh lands in Unreal, asserted rather than assumed.

The importer's own scale gate compares SORTED extents on purpose, so that an
axis swap is not misreported as a size error. The cost of that choice is that
it cannot see an axis swap AT ALL, and it cannot see a 180-degree flip, because
neither changes any extent. Both of those have shipped here. These tests make
the comparison the gate gives up: component by component, in Unreal axis order.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import placement  # noqa: E402

PASS = [0]
FAIL = []


def check(name, ok, detail=""):
    if ok:
        PASS[0] += 1
        print("  ok   %s" % name)
    else:
        FAIL.append(name)
        print("  FAIL %s%s" % (name, ("\n         " + detail) if detail else ""))


def close(a, b, tol=1e-6):
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def load(world="royal-garden-backdrop"):
    with open(os.path.join(HERE, "worlds", world, "manifest.json")) as fh:
        return json.load(fh)


def full_chain(manifest):
    node = placement.node_rotation(manifest)
    place = placement.placement_from(manifest)

    def go(pt):
        g = tuple(node[i][0] * pt[0] + node[i][1] * pt[1] + node[i][2] * pt[2]
                  for i in range(3))
        return place(g)
    return go


print("== the chain reproduces what the engine measured ==")
m = load()
pred = placement.predicted_extent(m)
exp = m["transform"]["expected_unreal_extent_cm"]
check("predicted extent matches expected_unreal_extent_cm component by component",
      all(close(p, e, 1e-5) for p, e in zip(pred, exp)),
      "predicted %s expected %s" % ([round(v, 1) for v in pred], exp))
check("...and NOT merely as a sorted multiset (the check the gate can make)",
      all(close(p, e, 1e-5) for p, e in zip(sorted(pred), sorted(exp))))

print("== the conversion must FLIP handedness, and its determinant says so ==")
# The basis was (1,0,0),(0,0,-1),(0,1,0) — determinant +1 — for as long as this
# file has existed. glTF is right-handed, Unreal is left-handed, so a conversion
# between them cannot preserve handedness. This is checkable from first
# principles, needs no engine, and would have caught it before the L4 did.
check("glTF-to-Unreal has determinant -1",
      close(placement.determinant(placement.GLTF_TO_UNREAL), -1.0),
      "a determinant of +1 preserves handedness and therefore cannot be the "
      "right-handed to left-handed conversion, whatever else it gets right")
check("...and it is a pure axis map, so every extent survives it",
      sorted(abs(v) for row in placement.GLTF_TO_UNREAL for v in row) == [0.0] * 6 + [1.0] * 3)
check("a rotation, by contrast, must have determinant +1",
      close(placement.determinant(placement.rotation(180.0, 0.0, 0.0)), 1.0, 1e-9),
      "roll/pitch/yaw can never fix a handedness error; only the conversion can")

print("== the prediction matches what the ENGINE measured, not just its own arithmetic ==")
# Printed by import-marble-world.py on the real L4 import at 2026-08-22 15:26.
ENGINE_CENTRE_OFFSET_CM = (-1130.0, -2227.0, 50464.0)
offset = placement.predicted_centre_offset_cm(m)
check("centre offset agrees with the engine on every axis INCLUDING sign",
      all(abs(a - b) < 1.0 for a, b in zip(offset, ENGINE_CENTRE_OFFSET_CM)),
      "predicted %s vs engine %s" % ([round(v) for v in offset],
                                     list(ENGINE_CENTRE_OFFSET_CM)))
check("...and the Y sign in particular, which is the axis that was mirrored",
      offset[1] < 0)

print("== the shell is the right way up ==")
go = full_chain(m)
origin = go((0.0, 0.0, 0.0))
up = go((0.0, 0.0, 1.0))
check("the mesh's own up axis (raw +Z) maps to Unreal +Z",
      (up[2] - origin[2]) > 0,
      "raw +Z moved %+.1f cm in UE Z" % (up[2] - origin[2]))
check("...and carries the full scale, so up is not a rounding artefact",
      close(up[2] - origin[2], m["transform"]["unreal_backdrop_scale"] * 100.0, 1e-6))

print("== a flip is invisible to an extent check, so assert it directly ==")
flipped = json.loads(json.dumps(m))
flipped["transform"]["axis_correction_deg"] = [0.0, 0.0, 0.0]
check("dropping the axis correction leaves every extent identical",
      all(close(a, b, 1e-5) for a, b in zip(sorted(placement.predicted_extent(flipped)),
                                            sorted(pred))))
check("...while actually putting the world upside down",
      (full_chain(flipped)((0.0, 0.0, 1.0))[2] - full_chain(flipped)((0.0, 0.0, 0.0))[2]) < 0,
      "this is the bug that shipped, and no extent gate can see it")

print("== the origin is the arrival camera, which is what makes a backdrop free ==")
check("the mesh origin lands exactly on unreal_origin_cm",
      all(close(o, e, 1e-9) for o, e in zip(origin, m["transform"]["unreal_origin_cm"])),
      "origin %s" % ([round(v, 3) for v in origin],))
scaled = json.loads(json.dumps(m))
scaled["transform"]["unreal_backdrop_scale"] = m["transform"]["unreal_backdrop_scale"] * 3.0
big = full_chain(scaled)
d1 = [go((1.0, 2.0, 3.0))[i] - origin[i] for i in range(3)]
d3 = [big((1.0, 2.0, 3.0))[i] - origin[i] for i in range(3)]
cos = (sum(a * b for a, b in zip(d1, d3))
       / (math.sqrt(sum(a * a for a in d1)) * math.sqrt(sum(b * b for b in d3))))
check("every ray from that origin is unchanged by the backdrop scale",
      close(cos, 1.0, 1e-9),
      "a backdrop can only be scaled for free if scaling moves nothing across the frame")

print("== the scale is the actor scale, not that times a hundred ==")
check("100 Unreal units per glTF unit, folded in once",
      close(placement.UNITS_PER_GLTF_UNIT, 100.0))
place = placement.placement_from(m)
check("one glTF unit becomes actor_scale * 100 cm",
      close(place.scale, m["transform"]["unreal_backdrop_scale"] * 100.0))
hundred = json.loads(json.dumps(m))
hundred["transform"]["unreal_backdrop_scale"] = m["transform"]["unreal_backdrop_scale"] * 100.0
check("the 100x manifest that shipped predicts the 123-kilometre shell that was measured",
      close(placement.predicted_extent(hundred)[0], 12303954.0, 1e-4),
      "predicted %.0f cm" % placement.predicted_extent(hundred)[0])

print("== a backdrop takes no ground offset; a placed world does ==")
check("backdrop mode applies no z offset",
      close(placement.placement_from(m, placement.BACKDROP).z_offset, 0.0))
metric = placement.placement_from(m, "metric")
check("metric mode raises the mesh by the ground plane offset",
      close(metric.z_offset, m["transform"]["ground_plane_offset_m"] * 100.0),
      "a positive offset means the floor is BELOW the origin")
check("...and metric mode uses the uniform scale, not the backdrop scale",
      close(metric.scale, m["transform"]["unreal_uniform_scale"] * 100.0))

print("== the artistic yaw composes on top, and does not disturb the correction ==")
yawed = json.loads(json.dumps(m))
yawed["transform"]["unreal_rotation_deg"] = [0.0, 0.0, 180.0]
ry = full_chain(yawed)
o2 = ry((0.0, 0.0, 0.0))
check("a 180 yaw still leaves the world the right way up",
      (ry((0.0, 0.0, 1.0))[2] - o2[2]) > 0)
check("...and sends forward geometry behind the camera",
      close(ry((0.0, 1.0, 0.0))[1] - o2[1], -(go((0.0, 1.0, 0.0))[1] - origin[1]), 1e-6))
check("...changing no extent, which is exactly why it needs its own test",
      all(close(a, b, 1e-5) for a, b in zip(sorted(placement.predicted_extent(yawed)),
                                            sorted(pred))))

print("== rotation is Unreal's, not an arbitrary order ==")
check("identity", all(close(placement.rotation(0, 0, 0)[i][j], 1.0 if i == j else 0.0)
                      for i in range(3) for j in range(3)))
roll = placement.rotation(180, 0, 0)
check("a 180 roll maps (x,y,z) to (x,-y,-z)",
      close(roll[0][0], 1.0) and close(roll[1][1], -1.0) and close(roll[2][2], -1.0, 1e-9))
yaw90 = placement.rotation(0, 0, 90)
check("a +90 yaw sends +X to +Y, which is left-handed Unreal",
      close(yaw90[0][0], 0.0, 1e-9) and close(yaw90[1][0], 1.0))

print("== the node rotation belongs to the mesh, and omitting it swaps two axes ==")
check("this export's node carries R_x(+90)",
      close(placement.node_rotation(m)[2][1], 1.0, 1e-6)
      and close(placement.node_rotation(m)[1][2], -1.0, 1e-6),
      "R_x(+90) sends +Z to -Y, which is why a correction is needed at all")
without = json.loads(json.dumps(m))
without["source_mesh"].pop("node_rotation_quat_xyzw", None)
bad = placement.predicted_extent(without)
check("dropping it swaps Y and Z in the prediction",
      close(bad[1], pred[2], 1e-5) and close(bad[2], pred[1], 1e-5),
      "predicted %s" % ([round(v, 1) for v in bad],))
check("...which a sorted comparison would have called correct",
      all(close(a, b, 1e-5) for a, b in zip(sorted(bad), sorted(pred))))

print("== a mesh with no recorded node rotation is not silently mangled ==")
check("absent quaternion means identity, not a guess",
      all(close(placement.node_rotation({})[i][j], 1.0 if i == j else 0.0)
          for i in range(3) for j in range(3)))

print("== a frame is recomputed from the rotator the ENGINE printed ==")
# The packaged build prints HERO_CAM_LOC/ROT/FOV for the camera that actually
# answered. Recomputing composition from that, rather than from the look-at in
# the source table, is the difference between describing the frame you have and
# describing the frame you asked for -- and those diverge exactly when a level
# is older than the camera, which is the case this whole path exists for.
for pos, look in ((( 0.0, -1150.0, 430.0), (0.0, 120.0, 541.0)),
                  ((300.0, -430.0, 205.0), (0.0, 60.0, 190.0)),
                  ((760.0, -180.0, 340.0), (795.0, 410.0, 150.0))):
    rot = placement.rotator_from_look(pos, look)
    f = placement.forward_from_rotator(*rot)
    d = [look[i] - pos[i] for i in range(3)]
    n = math.sqrt(sum(v * v for v in d))
    g = [v / n for v in d]
    check("rotator and look-at agree from %s" % (list(pos),),
          all(close(a, b, 1e-9) for a, b in zip(f, g)),
          "rotator %s -> %s vs %s" % ([round(v, 3) for v in rot],
                                      [round(v, 6) for v in f],
                                      [round(v, 6) for v in g]))
check("roll does not change which geometry is in frame",
      all(close(a, b, 1e-12) for a, b in
          zip(placement.forward_from_rotator(5.0, 90.0, 0.0),
              placement.forward_from_rotator(5.0, 90.0, 37.0))))
check("straight up is +Z", close(placement.forward_from_rotator(90.0, 0.0)[2], 1.0, 1e-9))
check("yaw +90 from level is +Y, which is left-handed Unreal",
      close(placement.forward_from_rotator(0.0, 90.0)[1], 1.0, 1e-9))

print("== the contract handed to the browser says the same thing ==")
# The browser inspector must not compute placement; it applies what this emits.
# If the contract disagreed with placement.py, the tool built to catch a flipped
# import would happily reproduce one.
import placement_contract  # noqa: E402

world = os.path.join(HERE, "worlds", "royal-garden-backdrop")
contract = placement_contract.build(world)
p = contract["placement"]
check("the contract carries the basis placement.py composed",
      all(close(p["basis_rows"][i][j], place.basis[i][j], 1e-12)
          for i in range(3) for j in range(3)))
check("...the same scale", close(p["unreal_units_per_gltf_unit"], place.scale))
check("...the same origin", all(close(a, b) for a, b in zip(p["origin_cm"], place.origin)))
check("...and the node rotation, which belongs to the mesh and must not be reapplied",
      all(close(p["node_rotation_rows"][i][j], placement.node_rotation(m)[i][j], 1e-12)
          for i in range(3) for j in range(3)))
check("the predicted extent matches what the engine measured",
      all(close(a, b, 1e-5) for a, b in
          zip(contract["extent"]["predicted_extent_cm"],
              m["transform"]["expected_unreal_extent_cm"])))
check("the signed centre offset is carried, since it is the only flip detector",
      contract["extent"]["centre_offset_from_origin_cm"][2] > 0)

hand = contract["handedness"]["ue_to_three_rows"]
check("the handedness conversion flips exactly one axis",
      [hand[0][0], hand[1][1], hand[2][2]] == [1.0, -1.0, 1.0],
      "Unreal is left-handed, three.js is right-handed; negating Y is the whole conversion")

cams = {c["index"]: c for c in contract["cameras"]}
check("every hero camera reaches the browser", len(cams) == 7, sorted(cams))
check("HeroCam6 shares HeroCam0's point, so the backdrop anchor holds",
      cams[6]["location_cm"] == cams[0]["location_cm"])
check("HeroCam0's frame stops below the measured skyline",
      cams[0]["frame_elevation_deg"][1] < contract["skyline_elevation_deg"],
      "this is the fault the inspector exists to show without an L4")
check("...and HeroCam6's does not",
      cams[6]["frame_elevation_deg"][1] > contract["skyline_elevation_deg"])
check("an asset that is not on disk is marked absent rather than omitted",
      all("present" in a for a in contract["assets"].values()),
      "an entry for a missing file is how a tool reports 'loaded' for nothing")

print("\npassed %d, failed %d" % (PASS[0], len(FAIL)))
for f in FAIL:
    print("  FAILED: %s" % f)
sys.exit(1 if FAIL else 0)
