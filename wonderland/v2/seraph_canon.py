"""SERAPH -- the Project Avatar of ascent, as a production asset.

THE THIRD SILHOUETTE. Ten Tails is horizontal and grounded; the Cherubim is radial and hovering; the Seraph is
VERTICAL. It is a column -- a narrow spindle wrapped in a robe, trailing fire downward and opening wings upward --
and it is the only one of the three that a player reads as taller-than-wide from every angle. Three families, three
different answers to "what shape is it", which is the point of having three.

WHAT GROWS, AND THE ONE RULE IT FOLLOWS. The wings are not a count that merely rises; they arrive in the order the
source gives them. "With twain he covered his face, and with twain he covered his feet, and with twain he did fly."

  SMALL   ONE pair, the FLIGHT pair, and nothing else. A thin spindle in a plain hood, one eye, a stub of train.
          It can move; it cannot yet hide itself.
  MEDIUM  TWO pairs: flight, and the FACE pair folded up and forward. A mantle broadens the shoulders, sleeves
          appear, the veil splits into plates, three eyes, and the train lengthens into something that reads as
          fire rather than as a hem.
  LARGE   THREE pairs: flight, face and the FEET pair sweeping down and forward. A crowned veil, seven eyes, a
          long burning train, and radiant spines along the spindle. At LARGE the column is nearly all wing.

Pair count, blades per wing, veil plates, eye count, spine count, sleeve presence and train length each move on
their own. Not one of them is the same number scaled.

FRAME. Positions and sizes in the web frame (X right, Y up, Z forward); every `rot` is an Unreal Rotator from
avatar_common's verified aim_x/aim_z. The body is authored from y=0 upward and the builder levels it to the deck.
"""
import math

from avatar_common import aim_z, blade, box, cone, eye, sphere, torus, tube

FAMILY = "Seraph"

#: Wing pairs in the order a Seraph grows them: flight first, then face, then feet. Each entry is
#: (rise degrees, forward sweep degrees, length factor, blade-count factor).
#: MEASURED, not guessed. The first arrangement gave a LARGE Seraph 6.6 m of wingspan against 5.6 m of height --
#: a spread eagle, and flatly at odds with this family's whole job of being the vertical one. Raising the flight
#: pair, tucking the sweep and lengthening the column brought the width-to-height ratio to 0.71-0.77 across all
#: three stages, so the Seraph now reads as taller than wide from every angle while keeping 4.3 m of wing at LARGE.
PAIRS = (("flight", 40.0, -18.0, 1.00, 1.00),
         ("face", 74.0, 18.0, 0.82, 0.80),
         ("feet", -38.0, 20.0, 0.88, 0.72))

STAGES = {
    "small": dict(
        body_h=84.0, base_r=9.0, waist_r=11.0, chest_r=13.5, neck_r=6.0, head_r=9.5,
        pairs=1, wing_len=26.0, blades=1, wing_w=13.0, wing_thick=2.0,
        veil=0, veil_r=0.0, crown=0, eyes=1, eye_r=3.0,
        train=3, train_len=22.0, spines=0, sleeves=False, girdle=False),
    "medium": dict(
        body_h=220.0, base_r=19.0, waist_r=25.0, chest_r=33.0, neck_r=13.5, head_r=21.0,
        pairs=2, wing_len=74.0, blades=3, wing_w=32.0, wing_thick=3.6,
        veil=5, veil_r=23.0, crown=0, eyes=3, eye_r=6.0,
        train=6, train_len=112.0, spines=4, sleeves=True, girdle=True),
    "large": dict(
        body_h=500.0, base_r=40.0, waist_r=52.0, chest_r=70.0, neck_r=28.0, head_r=42.0,
        pairs=3, wing_len=175.0, blades=5, wing_w=70.0, wing_thick=7.0,
        veil=9, veil_r=49.0, crown=7, eyes=7, eye_r=12.5,
        train=10, train_len=268.0, spines=10, sleeves=True, girdle=True),
}

MATERIALS = {
    "robe":     {"color": "#7A1F22", "roughness": 0.52, "metalness": 0.0,  "emissive": None},
    "mantle":   {"color": "#A83A2C", "roughness": 0.44, "metalness": 0.04, "emissive": None},
    "gild":     {"color": "#E6BE68", "roughness": 0.21, "metalness": 0.94, "emissive": None},
    "veil":     {"color": "#F6EEDC", "roughness": 0.38, "metalness": 0.0,  "emissive": None},
    "pinion":   {"color": "#F0DCC0", "roughness": 0.33, "metalness": 0.05, "emissive": None},
    "pinion_t": {"color": "#E4A45A", "roughness": 0.24, "metalness": 0.18, "emissive": None},
    "ember":    {"color": "#FF9A3C", "roughness": 0.10, "metalness": 0.0,  "emissive": 61000.0},
    "eye_ring": {"color": "#2E1A14", "roughness": 0.30, "metalness": 0.10, "emissive": None},
    "eye":      {"color": "#FFE7A8", "roughness": 0.08, "metalness": 0.0,  "emissive": 59000.0},
    "pupil":    {"color": "#140A06", "roughness": 0.12, "metalness": 0.0,  "emissive": None},
}

SOCKET_KINDS = ("VFX_Crown", "VFX_Veil", "VFX_Heart", "VFX_WingTip", "VFX_TrainTip", "VFX_Hem")


def _levels(p):
    """The five heights the column is built around, bottom to top."""
    h = p["body_h"]
    return dict(hem=h * 0.06, waist=h * 0.40, chest=h * 0.66, neck=h * 0.84, crown=h)


def wing_dirs(p):
    """One direction per wing, pair by pair, in the order PAIRS declares them."""
    out = []
    for k in range(p["pairs"]):
        _tag, rise, sweep, _lf, _bf = PAIRS[k]
        r, s = math.radians(rise), math.radians(sweep)
        for side in (-1, 1):
            out.append((side * math.cos(r) * math.cos(s), math.sin(r), math.cos(r) * math.sin(s)))
    return out


def joints(stage):
    p = STAGES[stage]
    out = ["root", "hem", "spine_low", "spine_mid", "chest", "neck", "head"]
    if p["veil"]:
        out.append("veil")
    if p["sleeves"]:
        out += ["arm_l", "arm_r"]
    for w in range(p["pairs"] * 2):
        out += ["wing_%02d_a" % w, "wing_%02d_b" % w]
    out += ["train_%02d" % t for t in range(p["train"])]
    return out


def parents(stage):
    p = STAGES[stage]
    out = {"root": None, "hem": "root", "spine_low": "hem", "spine_mid": "spine_low",
           "chest": "spine_mid", "neck": "chest", "head": "neck"}
    if p["veil"]:
        out["veil"] = "head"
    if p["sleeves"]:
        out["arm_l"] = out["arm_r"] = "chest"
    for w in range(p["pairs"] * 2):
        out["wing_%02d_a" % w] = "chest"
        out["wing_%02d_b" % w] = "wing_%02d_a" % w
    for t in range(p["train"]):
        out["train_%02d" % t] = "hem"
    return out


def _wing_root(p, w, d):
    L = _levels(p)
    return (d[0] * p["chest_r"] * 0.94, L["chest"] + p["chest_r"] * 0.30, d[2] * p["chest_r"] * 0.55)


def pivots(stage):
    p = STAGES[stage]
    L = _levels(p)
    out = {"root": (0.0, 0.0, 0.0),
           "hem": (0.0, L["hem"], 0.0),
           "spine_low": (0.0, L["waist"] * 0.62, 0.0),
           "spine_mid": (0.0, L["waist"], 0.0),
           "chest": (0.0, L["chest"], 0.0),
           "neck": (0.0, L["neck"], 0.0),
           "head": (0.0, L["neck"] + p["head_r"] * 1.05, 0.0)}
    if p["veil"]:
        out["veil"] = (0.0, L["neck"] + p["head_r"] * 1.30, 0.0)
    if p["sleeves"]:
        out["arm_l"] = (-p["chest_r"] * 1.02, L["chest"] + p["chest_r"] * 0.16, 0.0)
        out["arm_r"] = (p["chest_r"] * 1.02, L["chest"] + p["chest_r"] * 0.16, 0.0)
    for w, d in enumerate(wing_dirs(p)):
        root = _wing_root(p, w, d)
        out["wing_%02d_a" % w] = root
        out["wing_%02d_b" % w] = (root[0] + d[0] * p["wing_len"] * 0.42,
                                  root[1] + d[1] * p["wing_len"] * 0.42,
                                  root[2] + d[2] * p["wing_len"] * 0.42)
    for t in range(p["train"]):
        a = 360.0 * t / max(1, p["train"]) + 20.0
        out["train_%02d" % t] = (math.cos(math.radians(a)) * p["base_r"] * 1.1, L["hem"],
                                 math.sin(math.radians(a)) * p["base_r"] * 1.1)
    return out


def _train_dir(p, t):
    """A train strand leaves the hem going DOWN and BACK, fanned around the column. The back strands reach
    furthest, which is what makes the train read as something trailing behind rather than a bell skirt."""
    n = max(1, p["train"])
    a = math.radians(360.0 * t / n + 20.0)
    back = 0.55 + 0.45 * (-math.cos(a))          # strongest behind (-Z)
    # MOSTLY BACKWARD, NOT MOSTLY DOWN. The first version pointed the strands almost straight down (-0.86) with
    # a wide lateral spread, so from the hem -- which is already near the floor -- they hit the ground at once
    # and splayed outward in a ring. Rendered, a Seraph's burning train looked like a pair of yellow webbed feet.
    # A train trails behind a figure and lies along the floor; it does not stand under it.
    return (math.cos(a) * 0.26, -0.50, math.sin(a) * 0.26 - back * 1.05), back


def parts(stage):
    p = STAGES[stage]
    L = _levels(p)
    out = []

    # ---- the spindle: one swept column, narrow at the foot, full at the chest, drawn in at the neck
    col = [(0.0, L["hem"] * 0.30, 0.0), (0.0, L["waist"] * 0.60, 0.0), (0.0, L["waist"], 0.0),
           (0.0, L["chest"], 0.0), (0.0, L["neck"], 0.0)]
    rad = [p["base_r"], p["base_r"] * 1.24, p["waist_r"], p["chest_r"], p["neck_r"]]
    out.append(tube("column_low", "spine_low", "robe", col[:3], rad[:3], sides=12))
    out.append(tube("column_high", "chest", "robe", col[2:], rad[2:], sides=12))

    # ---- mantle across the shoulders: the stage where the column acquires a FIGURE
    if p["sleeves"]:
        out.append(box("mantle", "chest", "mantle", (0.0, L["chest"] + p["chest_r"] * 0.34, 0.0),
                       (p["chest_r"] * 2.5, p["chest_r"] * 0.62, p["chest_r"] * 1.5),
                       chamfer=p["chest_r"] * 0.26))
        for side, j in ((-1, "arm_l"), (1, "arm_r")):
            out.append(blade("sleeve_" + j, j, "robe",
                             (side * p["chest_r"] * 1.02, L["chest"] + p["chest_r"] * 0.16, 0.0),
                             (side * 0.42, -0.90, 0.10), p["chest_r"] * 2.1, p["chest_r"] * 0.66,
                             p["chest_r"] * 0.50, chamfer=p["chest_r"] * 0.16))
    if p["girdle"]:
        out.append(torus("girdle", "spine_mid", "gild", (0.0, L["waist"], 0.0),
                         p["waist_r"] * 1.02, p["waist_r"] * 0.11,
                         rot=aim_z((0.0, 1.0, 0.0)), major=20, minor=8))

    # ---- radiant spines up the column: embers held in the robe, none at SMALL
    for i in range(p["spines"]):
        f = i / float(max(1, p["spines"] - 1))
        y = L["hem"] + (L["neck"] - L["hem"]) * f
        side = -1 if i % 2 else 1
        r = p["waist_r"] * (0.9 + 0.3 * math.sin(math.pi * f))
        out.append(cone("spine_%02d" % i, "spine_mid" if f < 0.6 else "chest", "ember",
                        (side * r, y, -r * 0.35), p["waist_r"] * 0.13, p["waist_r"] * 0.02,
                        p["waist_r"] * 0.86, rot=aim_z((side * 0.55, 0.72, -0.42)), steps=8))

    # ---- head, hood and veil
    hy = L["neck"] + p["head_r"] * 1.05
    out.append(sphere("head", "head", "veil", (0.0, hy, 0.0), p["head_r"], steps=14))
    # THE HOOD WAS A CRATE AROUND THE HEAD. At 2.0 x 1.5 x 1.9 head radii centred barely behind the skull it
    # spanned z -1.21r to +0.69r against a head whose face is at +1.0r, so a quarter of a sphere poked out of a
    # red box and the figure read as a crate on a stick. A cowl sits BEHIND a head, not around it.
    out.append(box("hood", "head", "robe", (0.0, hy + p["head_r"] * 0.34, -p["head_r"] * 0.62),
                   (p["head_r"] * 1.86, p["head_r"] * 1.35, p["head_r"] * 1.50),
                   chamfer=p["head_r"] * 0.40))
    for v in range(p["veil"]):
        a = -96.0 + 192.0 * (v / float(max(1, p["veil"] - 1)))
        d = (math.sin(math.radians(a)), -0.30, math.cos(math.radians(a)))
        out.append(blade("veil_%02d" % v, "veil", "veil",
                         (d[0] * p["head_r"] * 0.92, hy + p["head_r"] * 0.42, d[2] * p["head_r"] * 0.92),
                         d, p["veil_r"], p["veil_r"] * 0.62, p["veil_r"] * 0.09,
                         roll=90.0, chamfer=p["veil_r"] * 0.05))
    for c in range(p["crown"]):
        a = -84.0 + 168.0 * (c / float(max(1, p["crown"] - 1)))
        d = (math.sin(math.radians(a)) * 0.42, 0.90, math.cos(math.radians(a)) * 0.42)
        h = p["head_r"] * (0.9 - 0.34 * abs(c - (p["crown"] - 1) / 2.0) / max(1.0, (p["crown"] - 1) / 2.0))
        out.append(blade("crown_%02d" % c, "veil", "gild",
                         (d[0] * p["head_r"] * 0.80, hy + p["head_r"] * 0.80, d[2] * p["head_r"] * 0.80),
                         d, h * 1.5, p["head_r"] * 0.17, p["head_r"] * 0.10, chamfer=p["head_r"] * 0.04))

    # ---- eyes. One on the face; the rest rise up the column and onto the veil, so a LARGE Seraph is watched
    # from head to heart rather than having one big face.
    out.extend(eye("eye_face", "head", (0.0, hy + p["head_r"] * 0.10, p["head_r"] * 0.92), p["eye_r"]))
    extra = p["eyes"] - 1
    for i in range(extra):
        f = (i + 1) / float(extra + 1)
        if i % 2 == 0:
            y = L["chest"] + (L["neck"] - L["chest"]) * f
            r = p["chest_r"] * (1.0 - 0.35 * f)
            out.extend(eye("eye_chest_%02d" % i, "chest", (0.0, y, r * 0.95), p["eye_r"] * 0.66,
                           ring=False, look=(0.0, 0.12, 1.0)))
        else:
            a = -62.0 + 124.0 * f
            d = (math.sin(math.radians(a)), 0.0, math.cos(math.radians(a)))
            out.extend(eye("eye_veil_%02d" % i, "veil" if p["veil"] else "head",
                           (d[0] * p["head_r"] * 1.28, hy + p["head_r"] * 0.34, d[2] * p["head_r"] * 1.28),
                           p["eye_r"] * 0.58, ring=False, look=d))

    # ---- wings, pair by pair, in the order they are grown
    for w, d in enumerate(wing_dirs(p)):
        pair = w // 2
        _tag, _rise, _sweep, lf, bf = PAIRS[pair]
        root = _wing_root(p, w, d)
        L_w = p["wing_len"] * lf
        nblades = max(1, int(round(p["blades"] * bf)))
        out.append(blade("wingarm_%02d" % w, "wing_%02d_a" % w, "gild", root, d,
                         L_w * 0.44, p["wing_w"] * 0.56, p["wing_thick"] * 1.8,
                         roll=90.0, chamfer=p["wing_thick"] * 0.5))
        mid = (root[0] + d[0] * L_w * 0.42, root[1] + d[1] * L_w * 0.42, root[2] + d[2] * L_w * 0.42)
        for b in range(nblades):
            f = 0.0 if nblades == 1 else (b / float(nblades - 1)) - 0.5
            # pinions fan mostly DOWNWARD off the arm -- a feather sheet, not a starburst
            bd = (d[0] * (1.0 - 0.18 * abs(f) * 2.0), d[1] - f * 0.62, d[2] + f * 0.34)
            Lb = L_w * (0.80 - 0.26 * abs(f) * 2.0)
            # roll=90 for the Cherubim's reason: a horizontal pinion is a splinter from the ground, and six
            # pairs of splinters is what the first render of this family actually showed.
            out.append(blade("pinion_%02d_%d" % (w, b), "wing_%02d_b" % w, "pinion", mid, bd,
                             Lb, p["wing_w"] * (1.0 - 0.30 * abs(f) * 2.0), p["wing_thick"],
                             roll=90.0, chamfer=p["wing_thick"] * 0.38))
            tip = (mid[0] + bd[0] * Lb * 0.90, mid[1] + bd[1] * Lb * 0.90, mid[2] + bd[2] * Lb * 0.90)
            out.append(blade("pinion_tip_%02d_%d" % (w, b), "wing_%02d_b" % w, "pinion_t", tip, bd,
                             Lb * 0.20, p["wing_w"] * 0.40, p["wing_thick"] * 0.85, roll=90.0))

    # ---- the train: strands of fire leaving the hem, down and back
    for t in range(p["train"]):
        d, back = _train_dir(p, t)
        a = math.radians(360.0 * t / max(1, p["train"]) + 20.0)
        root = (math.cos(a) * p["base_r"] * 1.05, L["hem"], math.sin(a) * p["base_r"] * 1.05)
        Lt = p["train_len"] * (0.58 + 0.60 * back)
        segs = 4
        path = []
        radii = []
        for k in range(segs + 1):
            u = k / float(segs)
            path.append((root[0] + d[0] * Lt * u,
                         max(p["base_r"] * 0.10, root[1] + d[1] * Lt * u * (0.45 + 0.55 * u)),
                         root[2] + d[2] * Lt * u))
            radii.append(p["base_r"] * 0.52 * (1.0 - 0.82 * u) + p["base_r"] * 0.05)
        out.append(tube("train_%02d" % t, "train_%02d" % t,
                        "ember" if t % 2 == 0 else "robe", path, radii, sides=7))
    return out


def sockets(stage):
    p = STAGES[stage]
    L = _levels(p)
    pv = pivots(stage)
    hy = L["neck"] + p["head_r"] * 1.05
    out = [("VFX_Crown", "veil" if p["veil"] else "head", (0.0, hy + p["head_r"] * 1.35, 0.0)),
           ("VFX_Veil", "veil" if p["veil"] else "head", (0.0, hy, p["head_r"] * 1.1)),
           ("VFX_Heart", "chest", (0.0, L["chest"], p["chest_r"] * 0.6)),
           ("VFX_Hem", "hem", (0.0, L["hem"], 0.0))]
    for w, d in enumerate(wing_dirs(p)):
        root = _wing_root(p, w, d)
        Lw = p["wing_len"] * PAIRS[w // 2][3]
        out.append(("VFX_WingTip_%02d" % w, "wing_%02d_b" % w,
                    (root[0] + d[0] * Lw, root[1] + d[1] * Lw, root[2] + d[2] * Lw)))
    for t in range(p["train"]):
        d, back = _train_dir(p, t)
        a = math.radians(360.0 * t / max(1, p["train"]) + 20.0)
        Lt = p["train_len"] * (0.58 + 0.60 * back)
        out.append(("VFX_TrainTip_%02d" % t, "train_%02d" % t,
                    (math.cos(a) * p["base_r"] * 1.05 + d[0] * Lt,
                     max(p["base_r"] * 0.10, L["hem"] + d[1] * Lt),
                     math.sin(a) * p["base_r"] * 1.05 + d[2] * Lt)))
    return out


def eye_count(stage):
    return STAGES[stage]["eyes"]


def wing_pairs(stage):
    return tuple(PAIRS[k][0] for k in range(STAGES[stage]["pairs"]))


def collision_capsule(stage):
    """(radius, half_height, centre_y) in canon units, around the robed column. The wings are above and outside
    it on purpose: a Seraph is passed under, not walked around."""
    p = STAGES[stage]
    return (p["chest_r"] * 1.20, p["body_h"] * 0.50, p["body_h"] * 0.50)
