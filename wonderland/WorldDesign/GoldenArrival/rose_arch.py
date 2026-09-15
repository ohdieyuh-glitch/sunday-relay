"""Climbing roses on the forge's rose garden arch (WL_Arch_Garden_Rose), at any place, scale and yaw.

Shared by AR02 (the golden garden gate) and GA02 (the Heart Garden's rose arches). The geometry is the arch's own
(families/thresholds.py `arch_garden_rose`): span 5.4 m, springing 4.9 m, rise 3.3 m at 1x. The ogee band is followed
as a two-centred arc through the springing and the crown. A rose run (WL_Flower_Rose_Run, 1.25 m, origin at its
middle) is laid along the stone with its stems out of the face: pitch turns the run up from horizontal and roll -90
puts the stems to local -Y at yaw 0 (probe 434). Rotations compose by adding the arch's yaw (UE applies yaw last).
"""
import math

SPAN_HALF_1X, SPRING_1X, RISE_1X = 270.0, 490.0, 330.0


def climbing_runs(cx, cy, ground, scale, yaw, run_s=1.1, column_face=34.0, band_face=44.0, rows=2, faces=(-1.0, 1.0)):
    """[(x, y, z, pitch, yaw, roll, run_scale), ...] for roses up both columns and over the band, on both faces.
    `column_face` and `band_face` are cm from the arch plane at 1.2x (AR02's measured faces); they scale with the arch.
    Two staggered rows per face read as a climber; one reads as a chain (ar02a)."""
    half, spring, rise = SPAN_HALF_1X * scale, SPRING_1X * scale, RISE_1X * scale
    face_k = scale / 1.2
    run_len = 125.0 * run_s
    radius = (half ** 2 + rise ** 2) / (2.0 * half)
    centre = half - radius
    a_top = math.acos(-centre / radius)
    cy_, sy_ = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    out = []

    def put(lx, ly, z, pitch, lyaw, roll, s):
        out.append((cx + lx * cy_ - ly * sy_, cy + lx * sy_ + ly * cy_, z, pitch, (lyaw + yaw) % 360.0, roll, s))

    for sgn_y in faces:
        for side in (-1.0, 1.0):
            for row, (lead, out_cm, s) in enumerate(((0.5, 0.0, run_s), (1.0, 12.0, run_s * 0.85))[:rows]):
                z = ground + 40.0 * face_k + run_len * lead
                while z < ground + spring - run_len * 0.3:
                    put(side * (half + (9.0 if row else -9.0) * face_k), sgn_y * (column_face * face_k + out_cm), z,
                        90.0, 0.0, -90.0 if sgn_y < 0 else 90.0, s)
                    z += run_len
                arc = run_len * lead
                while True:
                    a = arc / radius
                    if a > a_top - 0.02:
                        break
                    px, pz = centre + radius * math.cos(a), radius * math.sin(a)
                    if side > 0:
                        lyaw, roll = 180.0, (90.0 if sgn_y < 0 else -90.0)
                    else:
                        lyaw, roll = 0.0, (-90.0 if sgn_y < 0 else 90.0)
                    put(side * px, sgn_y * (band_face * face_k + out_cm), ground + spring + pz, 90.0 - math.degrees(a), lyaw, roll, s)
                    arc += run_len
    return out
