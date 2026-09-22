"""TEN TAILS -- the Project Avatar of raw accumulated power, as a production asset.

WHAT GROWS. The founder's rule is that SMALL -> MEDIUM -> LARGE is development, not scaling, so the three stages
below are three different animals that happen to be the same animal's life:

  SMALL   a hatchling. THREE tails, blunt and tipless. No horns, no teeth, no crest, one eye. Legs shorter than
          the body is deep, so it squats. Plates are smooth: it has not been hit by anything yet.
  MEDIUM  SIX tails, and the last thing each one grew was an EYE at the tip. Brow horns appear, the jaw opens and
          carries teeth, a crest runs the spine, the legs have lengthened past the body depth so it stands.
  LARGE   TEN tails fanned wide, every tip an eye, plus a ring of brow eyes. A crown
          of six horns, a full toothed maw, crag plates broken along the back, and shoulder mass heavy enough to
          make the front half read as the dangerous one. Seventeen eyes look at you at once.

Nothing in that list is a multiplier on a single number. Tail count, eye count, horn count, tooth count and the
leg-to-body ratio each change on their own, which is what makes the three stages read as growth rather than as a
zoom. The one thing that IS uniform is the final fit: avatar_common.fit_scale puts each finished body at the
height project_avatar_figures.py already expects (1.15 / 2.70 / 5.60 m), so LARGE arrives at its intended mature
size and never has to be shrunk to fit a showcase.

FRAME. X right, Y up, Z forward -- the same convention dog_canon uses, so the shared builder, the shared eye and
the shared LOD policy all apply unchanged. The creature faces +Z and its tails stream back along -Z.

THIS FILE DECLARES A BODY. It does not move it. Gait, hover, progression, spawning and Brain integration are
Internal Development's; what this lane owes them is a mesh set, a material set, a joint tree with pivots at the
places a rig will actually rotate, and sockets for the effects they will want.
"""
import math

from avatar_common import aim_z, box, cone, eye, fan_of, ring_of, sphere, tube

FAMILY = "TenTails"

#: Joints a rig will drive. Tails are declared per stage because their COUNT is the growth.
PARENTS = {
    "root": None,
    "spine_low": "root", "spine_mid": "spine_low", "spine_high": "spine_mid",
    "neck": "spine_high", "head": "neck", "jaw": "head",
    "leg_fl_hi": "spine_high", "leg_fl_lo": "leg_fl_hi", "paw_fl": "leg_fl_lo",
    "leg_fr_hi": "spine_high", "leg_fr_lo": "leg_fr_hi", "paw_fr": "leg_fr_lo",
    "leg_bl_hi": "spine_low", "leg_bl_lo": "leg_bl_hi", "paw_bl": "leg_bl_lo",
    "leg_br_hi": "spine_low", "leg_br_lo": "leg_br_hi", "paw_br": "leg_br_lo",
}

#: Every stage's own numbers. Read down a column to see what a stage IS; read across a row to see what grew.
STAGES = {
    "small": dict(
        body_len=52.0, body_w=30.0, body_h=26.0, chunks=3, crag=0.0,
        leg_hi=11.0, leg_lo=9.0, leg_r=5.0, paw_r=6.0, stance_w=0.70, claws=0,
        neck_len=13.0, neck_r=7.5, head_len=24.0, head_w=20.0, head_h=18.0,
        head_rise=0.28, head_reach=0.78,
        snout=0.42, jaw_open=4.0, teeth=0, horns=0, horn_len=0.0, crest=0,
        tails=3, tail_len=32.0, tail_segs=4, tail_r=4.6, spread=30.0, rise=18.0, curl=6.0,
        tail_eyes=False, tail_plates=0, brow_eyes=0, main_eye_r=3.4, tail_eye_r=0.0),
    "medium": dict(
        body_len=112.0, body_w=52.0, body_h=46.0, chunks=4, crag=0.35,
        leg_hi=26.0, leg_lo=22.0, leg_r=12.5, paw_r=12.5, stance_w=0.78, claws=3,
        neck_len=34.0, neck_r=15.0, head_len=48.0, head_w=36.0, head_h=32.0,
        head_rise=0.04, head_reach=1.30,
        snout=0.46, jaw_open=9.0, teeth=8, horns=2, horn_len=22.0, crest=5,
        tails=6, tail_len=112.0, tail_segs=6, tail_r=12.5, spread=48.0, rise=30.0, curl=22.0,
        tail_eyes=True, tail_plates=3, brow_eyes=2, main_eye_r=6.0, tail_eye_r=4.0),
    "large": dict(
        body_len=240.0, body_w=104.0, body_h=96.0, chunks=5, crag=0.80,
        leg_hi=58.0, leg_lo=50.0, leg_r=27.0, paw_r=26.0, stance_w=0.84, claws=4,
        neck_len=76.0, neck_r=31.0, head_len=104.0, head_w=76.0, head_h=68.0,
        head_rise=-0.10, head_reach=1.50,
        snout=0.50, jaw_open=17.0, teeth=14, horns=6, horn_len=58.0, crest=9,
        tails=10, tail_len=250.0, tail_segs=8, tail_r=26.0, spread=72.0, rise=34.0, curl=52.0,
        tail_eyes=True, tail_plates=5, brow_eyes=6, main_eye_r=15.0, tail_eye_r=8.5),
}

#: Surfaces. Emissive values are in SCENE units -- the hard-won lesson from the Cub Ghost: against EV100 13.5
#: daylight an "emissive 2.2" is black, and anything meant to glow in this world lives near 55,000-62,000.
MATERIALS = {
    "hide":      {"color": "#3A2F3C", "roughness": 0.72, "metalness": 0.0,  "emissive": None},
    "plate":     {"color": "#6E6270", "roughness": 0.46, "metalness": 0.08, "emissive": None},
    "crest":     {"color": "#8A7B58", "roughness": 0.38, "metalness": 0.22, "emissive": None},
    "horn":      {"color": "#D9CBA6", "roughness": 0.30, "metalness": 0.0,  "emissive": None},
    "tooth":     {"color": "#F2EAD6", "roughness": 0.22, "metalness": 0.0,  "emissive": None},
    "claw":      {"color": "#241D26", "roughness": 0.26, "metalness": 0.0,  "emissive": None},
    "maw":       {"color": "#3B1418", "roughness": 0.58, "metalness": 0.0,  "emissive": None},
    "eye_ring":  {"color": "#2A2230", "roughness": 0.34, "metalness": 0.0,  "emissive": None},
    "eye":       {"color": "#FFB347", "roughness": 0.10, "metalness": 0.0,  "emissive": 58000.0},
    "pupil":     {"color": "#170D06", "roughness": 0.14, "metalness": 0.0,  "emissive": None},
}

#: Where the effects lane will want to hang things. Named, not guessed, so nobody has to reverse a socket out of
#: a mesh bounds at integration time.
SOCKET_KINDS = ("VFX_Maw", "VFX_Brow", "VFX_TailTip", "VFX_Chest", "VFX_Paw")


def joints(stage):
    """Joint list for a stage: the fixed skeleton plus that stage's own tails."""
    out = list(PARENTS)
    p = STAGES[stage]
    for i in range(p["tails"]):
        out.append("tail_%02d" % i)
    return out


def parents(stage):
    out = dict(PARENTS)
    for i in range(STAGES[stage]["tails"]):
        out["tail_%02d" % i] = "spine_low"
    return out


def _spine(p):
    """Chunk centres along the body, back (-Z) to front (+Z). The chunk count itself grows with the stage, so a
    LARGE body is a longer ARTICULATED trunk rather than a stretched one."""
    n, L = p["chunks"], p["body_len"]
    return [(0.0, 0.0, -L / 2.0 + L * (i + 0.5) / n) for i in range(n)]


def pivots(stage):
    """Where a rig actually rotates this creature. These are the numbers the animation lane needs from us and
    the ones a mesh authored in a joint's own frame is built around."""
    p = STAGES[stage]
    hip = p["leg_hi"] + p["leg_lo"] + p["paw_r"]          # body underside sits on top of the legs
    body_y = hip + p["body_h"] / 2.0
    half = p["body_len"] / 2.0
    hw = p["body_w"] / 2.0 * p["stance_w"]
    neck_z = half * 0.92
    # A QUADRUPED CARRIES ITS HEAD IN FRONT OF ITS CHEST, NOT ON TOP OF ITS SHOULDERS. The first arrangement put
    # the head at 0.28 of the body depth above the spine and only 0.78 of a (short) neck forward, which on the
    # LARGE form left more than half the skull inside the shoulder mass and level with the roots of ten tails.
    # Rendered head-on, the creature had no face. head_rise is now per stage and NEGATIVE at LARGE -- the head
    # drops below the line of the back, the way an animal's does -- and head_reach carries it clear of the body.
    head_y = body_y + p["body_h"] * p["head_rise"] + p["neck_len"] * 0.55
    head_z = neck_z + p["neck_len"] * p["head_reach"]
    out = {
        "root": (0.0, 0.0, 0.0),
        "spine_low": (0.0, body_y, -half * 0.58),
        "spine_mid": (0.0, body_y + p["body_h"] * 0.06, 0.0),
        "spine_high": (0.0, body_y + p["body_h"] * 0.14, half * 0.56),
        "neck": (0.0, body_y + p["body_h"] * 0.30, neck_z),
        "head": (0.0, head_y, head_z),
        "jaw": (0.0, head_y - p["head_h"] * 0.22, head_z + p["head_len"] * 0.10),
    }
    for tag, sx, sz in (("fl", -1, 1), ("fr", 1, 1), ("bl", -1, -1), ("br", 1, -1)):
        lz = half * (0.60 if sz > 0 else -0.62)
        out["leg_%s_hi" % tag] = (sx * hw, hip, lz)
        out["leg_%s_lo" % tag] = (sx * hw, p["leg_lo"] + p["paw_r"], lz)
        out["paw_%s" % tag] = (sx * hw, p["paw_r"], lz)
    for i in range(p["tails"]):
        out["tail_%02d" % i] = _tail_root(p, i)
    return out


def _tail_root(p, i):
    """Tails leave the hips in a spread arc, so ten of them do not all emerge from one point -- the difference
    between a fan and a bundle, and the whole reason the LARGE silhouette reads at distance."""
    hip = p["leg_hi"] + p["leg_lo"] + p["paw_r"]
    body_y = hip + p["body_h"] / 2.0
    n = p["tails"]
    t = 0.0 if n == 1 else (i / float(n - 1)) - 0.5
    # the outermost tails leave the hips LOWER than the middle ones, so the fan is a fan rather than a wall
    return (t * p["body_w"] * 0.52,
            body_y + p["body_h"] * (0.30 - 0.34 * abs(t) * 2.0),
            -p["body_len"] / 2.0 * 0.96)


def _tail_ends(p):
    return fan_of(p["tails"], p["spread"], p["tail_len"], 0.0, p["rise"])


def _tail_path(p, i, segs):
    """One tail as a 3D polyline: out along its fan direction, lifted by a curl in the middle, tip settling.
    The curl is what stops ten straight spikes looking like a sea urchin."""
    root = _tail_root(p, i)
    end = _tail_ends(p)[i]
    n = p["tails"]
    t_lat = 0.0 if n == 1 else (i / float(n - 1)) - 0.5
    pts = []
    for k in range(segs + 1):
        t = k / float(segs)
        x = root[0] + end[0] * t
        y = root[1] + end[1] * t + p["curl"] * math.sin(math.pi * t) * (1.0 - 0.45 * abs(t_lat) * 2.0)
        z = root[2] + end[2] * t
        # a gentle lateral S so neighbouring tails do not lie in one plane
        x += p["curl"] * 0.35 * math.sin(math.pi * t) * (1.0 if i % 2 == 0 else -1.0) * 0.6
        pts.append((x, y, z))
    return pts


def parts(stage):
    """Every piece of this stage's body, in the creature's own units, tagged with the joint that owns it."""
    p = STAGES[stage]
    out = []
    hip = p["leg_hi"] + p["leg_lo"] + p["paw_r"]
    body_y = hip + p["body_h"] / 2.0
    half = p["body_len"] / 2.0

    # ---- trunk: chunks, each a chamfered plate block, tapering toward the tail
    joint_for = ["spine_low", "spine_mid", "spine_high"]
    for i, (cx, _cy, cz) in enumerate(_spine(p)):
        f = i / float(max(1, p["chunks"] - 1))
        j = joint_for[min(2, int(f * 2.999))]
        w = p["body_w"] * (0.74 + 0.34 * f)
        h = p["body_h"] * (0.80 + 0.26 * f)
        d = p["body_len"] / p["chunks"] * 1.06
        out.append(box("trunk_%02d" % i, j, "hide", (cx, body_y + p["body_h"] * 0.05 * f, cz),
                       (w, h, d), chamfer=h * 0.16))
        # belly plate -- a separate surface, because the underside is what a player sees of a LARGE avatar
        out.append(box("belly_%02d" % i, j, "plate", (cx, body_y - h * 0.44, cz),
                       (w * 0.72, h * 0.16, d * 0.92), chamfer=h * 0.05))

    # ---- crag plates along the back. crag=0 at SMALL: a hatchling has not been broken yet.
    if p["crag"] > 0.0:
        for i in range(p["chunks"] * 2):
            f = i / float(p["chunks"] * 2 - 1)
            j = joint_for[min(2, int(f * 2.999))]
            z = -half * 0.92 + p["body_len"] * 0.92 * f
            w = p["body_w"] * (0.30 + 0.22 * f) * p["crag"]
            out.append(box("crag_%02d" % i, j, "plate",
                           ((-1 if i % 2 else 1) * p["body_w"] * 0.22, body_y + p["body_h"] * 0.40, z),
                           (w, p["body_h"] * 0.13 * p["crag"], p["body_len"] / p["chunks"] * 0.52),
                           rot=(0.0, 0.0, (12.0 if i % 2 else -12.0)), chamfer=w * 0.18))

    # ---- crest: a row of rising fins on the spine. Count grows; SMALL has none.
    for i in range(p["crest"]):
        f = i / float(max(1, p["crest"] - 1))
        j = joint_for[min(2, int(f * 2.999))]
        hgt = p["body_h"] * (0.20 + 0.30 * math.sin(math.pi * f))
        out.append(box("crest_%02d" % i, j, "crest",
                       (0.0, body_y + p["body_h"] * 0.48 + hgt * 0.5, -half * 0.86 + p["body_len"] * 0.88 * f),
                       (p["body_w"] * 0.07, hgt, p["body_len"] * 0.055), chamfer=hgt * 0.20))

    # ---- neck
    # The neck is swept to wherever the head pivot actually is, rather than to a second set of numbers that
    # had to be kept in step with it by hand. Move the head and the neck follows.
    nz0 = half * 0.86
    ny0 = body_y + p["body_h"] * 0.26
    _hx, _hy, _hz = pivots(stage)["head"]
    out.append(tube("neck", "neck", "hide",
                    [(0.0, ny0, nz0),
                     (0.0, ny0 + (_hy - ny0) * 0.45, nz0 + (_hz - nz0) * 0.42),
                     (0.0, ny0 + (_hy - ny0) * 0.86, nz0 + (_hz - nz0) * 0.84)],
                    [p["neck_r"] * 1.15, p["neck_r"], p["neck_r"] * 0.88], sides=10))

    # ---- head
    hx, hy, hz = pivots(stage)["head"]
    out.append(box("skull", "head", "hide", (0.0, hy, hz), (p["head_w"], p["head_h"], p["head_len"] * 0.62),
                   chamfer=p["head_h"] * 0.20))
    snout_z = hz + p["head_len"] * 0.44
    out.append(box("snout", "head", "hide", (0.0, hy - p["head_h"] * 0.10, snout_z),
                   (p["head_w"] * 0.66, p["head_h"] * p["snout"], p["head_len"] * 0.44),
                   chamfer=p["head_h"] * 0.10))
    out.append(box("brow", "head", "plate", (0.0, hy + p["head_h"] * 0.36, hz + p["head_len"] * 0.12),
                   (p["head_w"] * 0.94, p["head_h"] * 0.20, p["head_len"] * 0.34),
                   chamfer=p["head_h"] * 0.07))
    # jaw: its own joint, so the maw can open. SMALL's barely parts; LARGE's is a door.
    out.append(box("jaw", "jaw", "hide", (0.0, hy - p["head_h"] * (0.30 + p["jaw_open"] / p["head_h"] * 0.4),
                                          hz + p["head_len"] * 0.30),
                   (p["head_w"] * 0.62, p["head_h"] * 0.24, p["head_len"] * 0.62),
                   chamfer=p["head_h"] * 0.08))
    if p["teeth"]:
        out.append(box("maw", "jaw", "maw", (0.0, hy - p["head_h"] * 0.22, hz + p["head_len"] * 0.32),
                       (p["head_w"] * 0.52, p["head_h"] * 0.10, p["head_len"] * 0.54)))
        for i in range(p["teeth"]):
            f = (i % (p["teeth"] // 2)) / float(max(1, p["teeth"] // 2 - 1))
            side = -1 if i < p["teeth"] // 2 else 1
            tz = hz + p["head_len"] * (0.10 + 0.52 * f)
            tr = p["head_w"] * 0.035 * (1.25 - 0.5 * f)
            # upper teeth bite DOWN, lower teeth bite UP; aimed rather than guessed
            out.append(cone("tooth_u%02d" % i, "head", "tooth",
                            (side * p["head_w"] * 0.26, hy - p["head_h"] * 0.20, tz),
                            tr, tr * 0.12, p["head_h"] * 0.26, rot=aim_z((0.0, -1.0, 0.08)), steps=8))
            out.append(cone("tooth_l%02d" % i, "jaw", "tooth",
                            (side * p["head_w"] * 0.23, hy - p["head_h"] * 0.34, tz),
                            tr * 0.85, tr * 0.10, p["head_h"] * 0.20, rot=aim_z((0.0, 1.0, 0.08)), steps=8))

    # ---- horns. 0 -> 2 -> 6: a crown, not a bigger pair.
    for i in range(p["horns"]):
        row, k = divmod(i, 2)
        side = -1 if k == 0 else 1
        out_deg = 18.0 + row * 14.0          # each row of the crown leans further outward
        back_deg = 26.0 + row * 12.0         # and further back, so six horns read as a crown, not a thicket
        L = p["horn_len"] * (1.0 - row * 0.22)
        co, si = math.cos(math.radians(out_deg)), math.sin(math.radians(out_deg))
        cb, sb = math.cos(math.radians(back_deg)), math.sin(math.radians(back_deg))
        out.append(cone("horn_%02d" % i, "head", "horn",
                        (side * p["head_w"] * (0.34 + row * 0.06),
                         hy + p["head_h"] * (0.46 + row * 0.03),
                         hz - p["head_len"] * (0.04 + row * 0.16)),
                        p["head_w"] * 0.085, p["head_w"] * 0.012, L,
                        rot=aim_z((side * si, co * cb, -co * sb)), steps=10))

    # ---- eyes. One central eye at SMALL; a brow ring at MEDIUM and LARGE.
    # forward on the face and larger: at LARGE this was a 13 cm bead on a 5.6 m animal, and it read as nothing
    out.extend(eye("eye_main", "head", (0.0, hy + p["head_h"] * 0.10, hz + p["head_len"] * 0.34),
                   p["main_eye_r"] * 1.35, look=(0.0, 0.10, 1.0)))
    for i, (ex, ey_, ez) in enumerate(ring_of(p["brow_eyes"], p["head_w"] * 0.40,
                                              hy + p["head_h"] * 0.30, phase=20.0, tilt=28.0)):
        out.extend(eye("eye_brow_%02d" % i, "head", (ex, ey_, hz + p["head_len"] * 0.10 + ez * 0.35),
                       p["main_eye_r"] * 0.48, ring=False,
                       look=(ex * 0.5, (ey_ - hy) * 0.5 + 0.25, 0.9)))

    # ---- legs
    for tag, sx, sz in (("fl", -1, 1), ("fr", 1, 1), ("bl", -1, -1), ("br", 1, -1)):
        lx = sx * p["body_w"] / 2.0 * p["stance_w"]
        lz = half * (0.60 if sz > 0 else -0.62)
        heavy = 1.18 if sz > 0 else 1.0        # the front half is the dangerous half
        out.append(tube("thigh_" + tag, "leg_%s_hi" % tag, "hide",
                        [(lx, hip, lz), (lx * 1.04, hip - p["leg_hi"] * 0.55, lz + sz * p["leg_hi"] * 0.10),
                         (lx * 1.06, p["leg_lo"] + p["paw_r"], lz)],
                        [p["leg_r"] * 1.28 * heavy, p["leg_r"] * 1.05 * heavy, p["leg_r"] * 0.92 * heavy],
                        sides=8))
        out.append(tube("shin_" + tag, "leg_%s_lo" % tag, "hide",
                        [(lx * 1.06, p["leg_lo"] + p["paw_r"], lz),
                         (lx * 1.02, p["paw_r"] * 1.4, lz - sz * p["leg_lo"] * 0.12)],
                        [p["leg_r"] * 0.92 * heavy, p["leg_r"] * 0.66 * heavy], sides=8))
        out.append(box("paw_" + tag, "paw_%s" % tag, "hide",
                       (lx * 1.02, p["paw_r"] * 0.72, lz - sz * p["leg_lo"] * 0.12 + sz * p["paw_r"] * 0.35),
                       (p["paw_r"] * 1.7, p["paw_r"] * 1.1, p["paw_r"] * 2.2), chamfer=p["paw_r"] * 0.30))
        for c in range(p["claws"]):
            f = 0.5 if p["claws"] == 1 else c / float(p["claws"] - 1)
            out.append(cone("claw_%s_%d" % (tag, c), "paw_%s" % tag, "claw",
                            (lx * 1.02 + (f - 0.5) * p["paw_r"] * 1.3, p["paw_r"] * 0.34,
                             lz - sz * p["leg_lo"] * 0.12 + sz * p["paw_r"] * 1.5),
                            p["paw_r"] * 0.17, p["paw_r"] * 0.02, p["paw_r"] * 0.9,
                            rot=aim_z((0.0, -0.42, sz * 0.91)), steps=7))

    # ---- tails. THE feature. Count, tip eyes and plating all grow.
    for i in range(p["tails"]):
        path = _tail_path(p, i, p["tail_segs"])
        r0 = p["tail_r"] * (1.0 - 0.22 * abs((i / float(max(1, p["tails"] - 1))) - 0.5) * 2.0)
        radii = [r0 * (1.0 - 0.86 * (k / float(p["tail_segs"]))) ** 0.85 for k in range(p["tail_segs"] + 1)]
        radii[-1] = max(radii[-1], r0 * 0.10)
        out.append(tube("tail_%02d" % i, "tail_%02d" % i, "hide", path, radii,
                        sides=8 if p["tails"] > 6 else 10))
        for k in range(p["tail_plates"]):
            t = (k + 1) / float(p["tail_plates"] + 1)
            idx = min(p["tail_segs"], int(t * p["tail_segs"]))
            pt = path[idx]
            rr = radii[idx]
            out.append(box("tailplate_%02d_%d" % (i, k), "tail_%02d" % i, "plate",
                           (pt[0], pt[1] + rr * 0.9, pt[2]),
                           (rr * 1.5, rr * 0.55, rr * 2.1), chamfer=rr * 0.20))
        if p["tail_eyes"]:
            tip = path[-1]
            # THE BULB WAS EATING THE EYE. The first render gave ten dark spheres with a thin yellow crescent at
            # the edge of each: the bulb was 1.45x the eye's radius while the eye sat less than one radius inside
            # it, so the socket swallowed the light it was meant to hold. That is this project's "an opaque
            # sheath hides its core" lesson for the third time. The bulb is smaller now and the eye stands proud
            # of it along the TAIL'S OWN DIRECTION, so each eye looks the way its tail points.
            prev = path[-2]
            d = [tip[j] - prev[j] for j in range(3)]
            L = math.sqrt(sum(v * v for v in d)) or 1.0
            d = [v / L for v in d]
            er = p["tail_eye_r"]
            out.append(sphere("tailbulb_%02d" % i, "tail_%02d" % i, "plate", tip, er * 1.10, steps=10))
            # the bulb is this eye's rim, in the plate surface, so the eye itself still skips one
            out.extend(eye("eye_tail_%02d" % i, "tail_%02d" % i,
                           (tip[0] + d[0] * er * 0.95, tip[1] + d[1] * er * 0.95, tip[2] + d[2] * er * 0.95),
                           er, ring=False, look=d))
    return out


def sockets(stage):
    """Effect anchors, in the creature's own units, each on the joint that carries it."""
    p = STAGES[stage]
    pv = pivots(stage)
    hx, hy, hz = pv["head"]
    out = [("VFX_Maw", "jaw", (0.0, hy - p["head_h"] * 0.20, hz + p["head_len"] * 0.62)),
           ("VFX_Brow", "head", (0.0, hy + p["head_h"] * 0.52, hz)),
           ("VFX_Chest", "spine_high", (0.0, pv["spine_high"][1] - p["body_h"] * 0.30, p["body_len"] * 0.40))]
    for tag in ("fl", "fr", "bl", "br"):
        out.append(("VFX_Paw_" + tag, "paw_%s" % tag, (pv["paw_%s" % tag][0], 0.0, pv["paw_%s" % tag][2])))
    for i in range(p["tails"]):
        out.append(("VFX_TailTip_%02d" % i, "tail_%02d" % i, _tail_path(p, i, p["tail_segs"])[-1]))
    return out


def eye_count(stage):
    p = STAGES[stage]
    return 1 + p["brow_eyes"] + (p["tails"] if p["tail_eyes"] else 0)


def collision_capsule(stage):
    """The capsule a player actually bumps into, in canon units: (radius, half_height, centre_y).

    Deliberately NOT derived from the mesh bounds. A LARGE Ten Tails is 8.8 m deep because its ten tails fan
    behind it, and a capsule drawn around that would stop a player nearly five metres short of a creature whose
    body is one metre wide. What blocks is the TORSO and the legs beneath it; the tails are presentation and the
    head reaches forward above capsule height, which is normal for a quadruped.
    """
    p = STAGES[stage]
    hip = p["leg_hi"] + p["leg_lo"] + p["paw_r"]
    top = hip + p["body_h"]
    return (p["body_w"] * 0.55, top * 0.5, top * 0.5)
