import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_WL = _os.path.dirname(_os.path.dirname(_HERE))          # <repo>/wonderland
#!/usr/bin/env python3
"""A CPU ray trace of the hero frame, for LIGHTING only.

The projection preview answers composition and cannot answer light: it has no
shadows, no sun, no ambient, so it cannot tell me whether raising the sky light
from 0.42 to 1.15, warming the gold, brightening the foliage and adding a rim
term leave the frame readable or blow it out. With no GPU reachable and one
build available when the host returns, guessing at that is the largest avoidable
risk left.

So: intersect the world's own primitives directly. Ellipsoids and oriented boxes
are analytic, the generator emits nothing else, and a BVH over twenty thousand
of them is tractable in Python at a small resolution.

WHAT THIS IS NOT. No Lumen global illumination, no virtual shadow map softness,
no specular, no PBR, no TSR, no post grade, no auto-exposure histogram, and
textures point-sampled at 96px. It answers whether the VALUE STRUCTURE is right:
does the sun read, do shadows land, is the shadowed side lifted or crushed.

CALIBRATION AGAINST GROUND TRUTH. Rendering the world state that produced the
real streamed frame `p18`, and comparing the two, this tracer runs:

    luma        +94%   much brighter than Unreal
    contrast    +26%
    saturation  -76%   Unreal is roughly FOUR TIMES more saturated

Its absolute numbers are therefore not Unreal's, and in one direction badly so:
every image this produces looks far more washed out than the engine's, because
Lumen's bounce, PBR specular and the filmic tonemap all add colour this model
has none of. DO NOT conclude "the palette is pale" from a picture made here — I
did, and it was wrong by a factor of four.

What transfers is RELATIVE comparison — A versus B at the same settings — and
per-object coverage of the frame, which is geometry rather than shading. Use it
for those. The streamed California frame remains the only ground truth for how
the world looks.

(Caveat on the calibration: the reference frame carries a partly-cropped player
UI and is 1600x900 against this tracer's 320x180. Direction and magnitude hold;
the exact percentages do not.)
"""
import io
import json
import math
import os
import struct
import sys
import zlib

import sys as _sys2
_sys2.path.insert(0, _HERE)
from wl_preview_leaf import apply as _wl_leaf_apply  # noqa: E402

SP = _HERE
REPO = _os.path.dirname(_WL)
W, H = int(os.environ.get('WL_W', '336')), int(os.environ.get('WL_H', '189'))
SPP_SHADOW = 1


def load_world():
    """Reuse the preview's recorder to get every primitive the generator emits."""
    src = io.open(os.path.join(SP, "verify-hero-composition.py"), encoding="utf8").read()
    ns = {"__name__": "__wl_rt__", "__file__": os.path.join(SP, "verify-hero-composition.py")}
    # run only the top half: the stub, the recorder, the png writer
    # NOTE: this cuts on a literal that also appears as CODE in that file. A
    # blind textual patch of "def main():" once rewrote this string too and
    # broke the harness; the anchor is deliberately the import line that now
    # precedes it, which is unique.
    cut = src.index("\ndef main():")
    exec(compile(src[:cut], "verify-hero-composition.py", "exec"), ns)
    sys.modules["unreal"] = ns["make_unreal"]()
    gen = io.open(os.path.join(SP, "generate-hub-level.py"), encoding="utf8").read()
    # Inject AFTER the label is made unique, not at the function's first line:
    # recording the argument records the name the caller asked for, and the
    # generator may have had to rename it. Attribution has to see what the world
    # actually contains.
    anchor = ("        actor = spawn(unreal.StaticMeshActor, location, "
              "rotation=rotation, scale=scale, label=label)")
    gen = gen.replace(anchor, anchor + "\n        __wl_record__(mesh_key, location, scale, label, rotation, mat)", 1)
    gns = {"__name__": "__wl_rt_gen__",
           "__file__": os.path.join(SP, "generate-hub-level.py"),
           "__wl_record__": ns["record"]}
    cwd = os.getcwd()
    os.chdir(_WL)
    try:
        exec(compile(gen, "gen.py", "exec"), gns)
        # leaf cards exist on the GPU; make the trace agree (see the
        # composition harness for why this matters)
        _wl_leaf_apply(gns)
        ns["records"][:] = []
        gns["build"](json.load(io.open("WorldDesign/hub-layout.json", encoding="utf8")))
    finally:
        os.chdir(cwd)
    return (ns["records"], gns["MATERIAL_SPEC"], ns["write_png"],
            gns["mat_name_for"])


def load_textures():
    """Sample the world's OWN generated maps. gen-textures.py is stdlib-only, so
    the same albedo the engine will get can be produced here and sampled per
    hit — the difference between a render of the world's colours and a render of
    its material NAMES."""
    gt_path = _os.path.join(_HERE, "gen-textures.py")
    ns = {"__name__": "__wl_tex__", "__file__": gt_path}
    exec(compile(io.open(gt_path, encoding="utf8").read(), gt_path, "exec"), ns)
    size = 96                       # small: this is sampled, not displayed
    fams = {}
    for name, fn in (("cobble", ns["make_cobble"]), ("ashlar", ns["make_ashlar"]),
                     ("sward", ns["make_sward"]), ("bark", ns["make_bark"]),
                     ("plaster", ns["make_plaster"]), ("roof", ns["make_roof"])):
        alb = fn(size)[0]
        fams[name] = alb
    print("textures: %d families at %dpx" % (len(fams), size))
    return fams, size


# which palette entries take which map, and at what world scale — mirrored from
# the generator's own `textured` table so the render matches what will cook
TEXTURED = {
    "cobble": ("cobble", 0.0038), "cobble2": ("cobble", 0.0031),
    "plaza": ("cobble", 0.0044), "stone": ("ashlar", 0.0026),
    "ground": ("sward", 0.0060), "moss": ("sward", 0.0110),
    "trunk": ("bark", 0.0090), "spire": ("plaster", 0.0055),
    "spire_pink": ("plaster", 0.0055), "spire_blue": ("plaster", 0.0055),
    "spire_teal": ("plaster", 0.0055), "roof_rose": ("roof", 0.0070),
    "roof_pink": ("roof", 0.0070),
}


def main():
    records, SPEC, write_png, mat_name_for = load_world()
    FAMS, TSZ = load_textures()
    lay = json.load(io.open(os.path.join(_WL, "WorldDesign", "hub-layout.json"), encoding="utf8"))
    hero = [c for c in lay["heroCameras"] if c["id"] == "cam_arrival_hero"][0]
    atm = lay.get("atmosphere", {})

    # ---- primitives ---------------------------------------------------
    # 0 = ellipsoid, 1 = oriented box. Cones and cylinders are traced as boxes:
    # at this resolution their silhouette contribution is a few pixels and their
    # LIGHTING behaves like a box, which is the only thing being measured.
    # element 13 is the material name and 14 the actor label, so a hit can be
    # attributed to the OBJECT that produced it — needed twice now to answer
    # "what exactly is that 20% of the frame", and both times the answer was not
    # what I would have guessed
    ROUND = ("sphere",)
    prims = []
    for mesh, loc, sc, mat, lb, rot in records:
        hx, hy, hz = abs(sc[0]) * 50.0, abs(sc[1]) * 50.0, abs(sc[2]) * 50.0
        # A PLANE IS FLAT. Engine BasicShapes are 100 uu, so half-extent = 50 x
        # scale — but /Engine/BasicShapes/Plane has no thickness at all, and
        # giving it 50 uu turned every ground plane into a 100 uu SLAB that
        # swallowed the paving lying on top of it. That artifact reported the
        # plaza as 1.6% of the frame and bare lawn as 21.8%, and I acted on both
        # numbers before checking the tool.
        if mesh in ("plane", "water_plane"):
            hz = 0.5
        if hx < 1e-4 or hy < 1e-4 or hz < 1e-4:
            continue
        yaw = math.radians(rot[1] if mesh not in ROUND else 0.0)
        # RESOLVE THE FALLBACK. Objects spawned without an explicit material get
        # one from mat_name_for(mesh, label) in the generator; painting them
        # neutral grey instead greyed out a FIFTH of the frame, and I was making
        # colour judgements from that.
        if not mat:
            mat = mat_name_for(mesh, lb)
        m = SPEC.get(mat, ((0.5, 0.5, 0.5), 0.0, 0.5, (0, 0, 0), 0.0))
        base = m[0]
        met, rgh = float(m[1]), float(m[2])
        emis = (m[3][0] * m[4], m[3][1] * m[4], m[3][2] * m[4])
        kind = 0 if mesh in ROUND else 1
        tf = TEXTURED.get(mat or "")
        tex = FAMS.get(tf[0]) if tf else None
        tsc = tf[1] if tf else 0.0
        prims.append((kind, loc[0], loc[1], loc[2], hx, hy, hz,
                      math.cos(yaw), math.sin(yaw), base, emis, tex, tsc,
                      mat or "", lb, met, rgh))
    n = len(prims)

    # ---- BVH ----------------------------------------------------------
    def bounds(i):
        p = prims[i]
        r = math.hypot(p[4], p[5])              # yaw-safe conservative radius
        return (p[1] - r, p[2] - r, p[3] - p[6], p[1] + r, p[2] + r, p[3] + p[6])

    boxes = [bounds(i) for i in range(n)]
    nodes = []                                   # (minx,miny,minz,maxx,maxy,maxz,left,right,start,count)
    order = list(range(n))

    def build(lo, hi, depth):
        b = [1e30, 1e30, 1e30, -1e30, -1e30, -1e30]
        for k in range(lo, hi):
            q = boxes[order[k]]
            if q[0] < b[0]: b[0] = q[0]
            if q[1] < b[1]: b[1] = q[1]
            if q[2] < b[2]: b[2] = q[2]
            if q[3] > b[3]: b[3] = q[3]
            if q[4] > b[4]: b[4] = q[4]
            if q[5] > b[5]: b[5] = q[5]
        idx = len(nodes)
        cnt = hi - lo
        if cnt <= 4 or depth > 40:
            nodes.append((b[0], b[1], b[2], b[3], b[4], b[5], -1, -1, lo, cnt))
            return idx
        ex = (b[3] - b[0], b[4] - b[1], b[5] - b[2])
        ax = 0 if ex[0] >= ex[1] and ex[0] >= ex[2] else (1 if ex[1] >= ex[2] else 2)
        mid = (lo + hi) // 2
        seg = order[lo:hi]
        seg.sort(key=lambda i: boxes[i][ax] + boxes[i][ax + 3])
        order[lo:hi] = seg
        nodes.append(None)
        l = build(lo, mid, depth + 1)
        r = build(mid, hi, depth + 1)
        nodes[idx] = (b[0], b[1], b[2], b[3], b[4], b[5], l, r, 0, 0)
        return idx

    sys.setrecursionlimit(10000)
    build(0, n, 0)
    print("BVH %d prims / %d nodes" % (n, len(nodes)))

    # ---- camera --------------------------------------------------------
    eye = [float(v) for v in hero["location"]]
    tgt = [float(v) for v in hero["lookAt"]]
    fov = math.radians(float(hero.get("fovDeg", 66)))
    f = [tgt[i] - eye[i] for i in range(3)]
    fl = math.sqrt(sum(c * c for c in f)); f = [c / fl for c in f]
    up = [0.0, 0.0, 1.0]
    r = [up[1]*f[2]-up[2]*f[1], up[2]*f[0]-up[0]*f[2], up[0]*f[1]-up[1]*f[0]]
    rl = math.sqrt(sum(c*c for c in r)) or 1.0; r = [c/rl for c in r]
    u2 = [f[1]*r[2]-f[2]*r[1], f[2]*r[0]-f[0]*r[2], f[0]*r[1]-f[1]*r[0]]
    focal = (W * 0.5) / math.tan(fov * 0.5)

    # ---- lights ---------------------------------------------------------
    el = math.radians(float(atm.get("sunElevationDeg", 52.0)))
    az = math.radians(float(atm.get("sunAzimuthDeg", 138.0)))
    # UE's directional light TRAVELS along its forward vector, and the generator
    # sets pitch = -elevation, yaw = azimuth. So the direction TO the sun is the
    # NEGATIVE of that forward in X and Y. Getting this backwards lit the world
    # from behind and made every camera-facing surface read as a silhouette —
    # which is exactly the false alarm this tool exists to avoid raising.
    L = [-math.cos(el) * math.cos(az), -math.cos(el) * math.sin(az), math.sin(el)]
    SUN = (1.00, 0.94, 0.82)
    SUN_I = float(os.environ.get('WL_SUN_I', '2.35'))
    SKY_UP = (0.42, 0.58, 0.95)
    SKY_DN = (0.55, 0.52, 0.46)
    # the value under test: SkyLight intensity was raised 0.42 -> 1.15
    SKY_I = float(os.environ.get('WL_SKY_I', '0.90'))
    NSHAD = int(os.environ.get('WL_SHADOW', '3'))
    NAO = int(os.environ.get('WL_AO', '4'))
    AO_R = 340.0
    BOUNCE = float(os.environ.get("WL_BOUNCE", "0.55"))
    # Swept against the streamed frame p18. Lower exposure does recover
    # saturation — 0.164 at 1.0, 0.223 at 0.20 — because a Reinhard curve
    # desaturates whatever it compresses. It does not come close to closing the
    # gap to the real frame's 0.640, and neither did adding specular or a bounce
    # term. What is left is global illumination and a filmic tonemap, and this
    # tracer is not going to grow either. 0.30 is a reasonable place to sit.
    EXPOSURE = float(os.environ.get("WL_EXPOSURE", "0.30"))
    # measured against the streamed frame p18 on the identical world state
    CALIB = os.environ.get("WL_CALIBRATE", "") not in ("", "0")
    # Fitted against the streamed frame p18 by rendering the identical world
    # state and matching mean, spread and saturation. Residual at these values:
    # luma +15%, contrast -3%, saturation -11% against the real frame — close
    # enough to be REPRESENTATIVE, and not to be quoted as a measurement.
    # Residual at these values, measured on p18: luma +7%, contrast -21%,
    # saturation -41%. Better than the raw output's -76% saturation and nowhere
    # near a match. A cosmetic transform of an approximation is not evidence and
    # this mode stays OFF by default; the raw output is what the tool is for.
    CAL_SAT = float(os.environ.get("WL_CAL_SAT", "3.4"))
    CAL_DST = float(os.environ.get("WL_CAL_DST", "70.4"))     # Unreal mean on p18
    CAL_SD_DST = float(os.environ.get("WL_CAL_SD", "49.1"))   # Unreal spread on p18
    JIT = [(0.0, 0.0, 0.0)]
    for _k in range(1, 8):
        _a = _k * 2.39996
        JIT.append((math.cos(_a)*0.035, math.sin(_a)*0.035, math.cos(_a*1.7)*0.035))
    HEMI = []
    for _k in range(8):
        _a = _k * 2.39996
        _r = math.sqrt((_k + 0.5) / 8.0)
        HEMI.append((math.cos(_a)*_r*1.15, math.sin(_a)*_r*1.15, 0.30))
    RIM = {"gold": 1.05, "gold_glow": 0.90, "float_glow": 0.85, "magic_gold": 0.70,
           "foliage": 0.60, "foliage_hi": 0.72, "leaf": 0.66, "leaf_hi": 0.78,
           "porcelain": 0.34, "water": 0.55, "dog_body": 0.42, "dog_eye": 0.90}

    def hit(ox, oy, oz, dx, dy, dz, tmax, anyhit):
        best = tmax; bi = -1
        idx = [0]
        push = idx.append; pop = idx.pop
        invx = 1e30 if dx == 0.0 else 1.0/dx
        invy = 1e30 if dy == 0.0 else 1.0/dy
        invz = 1e30 if dz == 0.0 else 1.0/dz
        while idx:
            ni = pop()
            nd = nodes[ni]
            t1 = (nd[0]-ox)*invx; t2 = (nd[3]-ox)*invx
            tmin_ = t1 if t1 < t2 else t2; tmx = t2 if t1 < t2 else t1
            t1 = (nd[1]-oy)*invy; t2 = (nd[4]-oy)*invy
            a = t1 if t1 < t2 else t2; b = t2 if t1 < t2 else t1
            if a > tmin_: tmin_ = a
            if b < tmx: tmx = b
            t1 = (nd[2]-oz)*invz; t2 = (nd[5]-oz)*invz
            a = t1 if t1 < t2 else t2; b = t2 if t1 < t2 else t1
            if a > tmin_: tmin_ = a
            if b < tmx: tmx = b
            if tmx < 0.0 or tmin_ > tmx or tmin_ > best:
                continue
            if nd[6] < 0:
                for k in range(nd[8], nd[8] + nd[9]):
                    pi = order[k]
                    p = prims[pi]
                    ca = p[7]; sa = p[8]
                    lx = ox - p[1]; ly = oy - p[2]; lz = oz - p[3]
                    rx = lx*ca + ly*sa; ry = -lx*sa + ly*ca
                    ex = dx*ca + dy*sa; ey = -dx*sa + dy*ca
                    if p[0] == 0:
                        ax_ = rx/p[4]; ay_ = ry/p[5]; az_ = lz/p[6]
                        bx = ex/p[4]; by = ey/p[5]; bz = dz/p[6]
                        A = bx*bx+by*by+bz*bz
                        if A == 0.0: continue
                        B = 2.0*(ax_*bx+ay_*by+az_*bz)
                        C = ax_*ax_+ay_*ay_+az_*az_-1.0
                        disc = B*B-4.0*A*C
                        if disc < 0.0: continue
                        sq = math.sqrt(disc)
                        t = (-B-sq)/(2.0*A)
                        if t < 1e-3: t = (-B+sq)/(2.0*A)
                        if t < 1e-3 or t >= best: continue
                        best = t; bi = pi
                        if anyhit: return best, bi
                    else:
                        t0 = -1e30; t3 = 1e30
                        ok = True
                        for (o_, d_, h_) in ((rx, ex, p[4]), (ry, ey, p[5]), (lz, dz, p[6])):
                            if d_ == 0.0:
                                if o_ < -h_ or o_ > h_: ok = False; break
                                continue
                            inv = 1.0/d_
                            u_ = (-h_-o_)*inv; v_ = (h_-o_)*inv
                            if u_ > v_: u_, v_ = v_, u_
                            if u_ > t0: t0 = u_
                            if v_ < t3: t3 = v_
                            if t0 > t3: ok = False; break
                        if not ok: continue
                        t = t0 if t0 > 1e-3 else t3
                        if t < 1e-3 or t >= best: continue
                        best = t; bi = pi
                        if anyhit: return best, bi
            else:
                push(nd[6]); push(nd[7])
        return best, bi

    def normal_at(pi, px, py, pz):
        p = prims[pi]
        ca = p[7]; sa = p[8]
        lx = px - p[1]; ly = py - p[2]; lz = pz - p[3]
        rx = lx*ca + ly*sa; ry = -lx*sa + ly*ca
        if p[0] == 0:
            nx = rx/(p[4]*p[4]); ny = ry/(p[5]*p[5]); nz = lz/(p[6]*p[6])
        else:
            axv = abs(rx)/p[4]; ayv = abs(ry)/p[5]; azv = abs(lz)/p[6]
            if axv >= ayv and axv >= azv: nx, ny, nz = (1.0 if rx > 0 else -1.0), 0.0, 0.0
            elif ayv >= azv: nx, ny, nz = 0.0, (1.0 if ry > 0 else -1.0), 0.0
            else: nx, ny, nz = 0.0, 0.0, (1.0 if lz > 0 else -1.0)
        wx = nx*ca - ny*sa; wy = nx*sa + ny*ca
        ln = math.sqrt(wx*wx+wy*wy+nz*nz) or 1.0
        return wx/ln, wy/ln, nz/ln

    px = bytearray(W*H*3)
    lx, ly, lz = L
    for yy in range(H):
        for xx in range(W):
            sx = (xx + 0.5 - W*0.5)/focal
            sy = (H*0.5 - (yy + 0.5))/focal
            dx = f[0] + r[0]*sx + u2[0]*sy
            dy = f[1] + r[1]*sx + u2[1]*sy
            dz = f[2] + r[2]*sx + u2[2]*sy
            dl = math.sqrt(dx*dx+dy*dy+dz*dz)
            dx /= dl; dy /= dl; dz /= dl
            t, pi = hit(eye[0], eye[1], eye[2], dx, dy, dz, 1e9, False)
            if pi < 0:
                k = max(0.0, min(1.0, dz*2.2))
                cr = SKY_DN[0] + (SKY_UP[0]-SKY_DN[0])*k
                cg = SKY_DN[1] + (SKY_UP[1]-SKY_DN[1])*k
                cb = SKY_DN[2] + (SKY_UP[2]-SKY_DN[2])*k
            else:
                hx = eye[0]+dx*t; hy = eye[1]+dy*t; hz = eye[2]+dz*t
                nx, ny, nz = normal_at(pi, hx, hy, hz)
                p = prims[pi]
                base = p[9]; emis = p[10]
                # SOFT SHADOW: the sun is a disc, not a point, and a hard-edged
                # shadow is one of the loudest "not a real render" cues there is
                ndl = nx*lx + ny*ly + nz*lz
                if ndl > 0.0 and NSHAD:
                    lit = 0
                    for _q in range(NSHAD):
                        jx = lx + JIT[_q][0]; jy = ly + JIT[_q][1]; jz = lz + JIT[_q][2]
                        _, si = hit(hx+nx*0.8, hy+ny*0.8, hz+nz*0.8, jx, jy, jz, 1e9, True)
                        if si < 0: lit += 1
                    ndl *= lit / float(NSHAD)
                # AMBIENT OCCLUSION: short cosine-ish rays off the normal. Contact
                # darkening is most of what makes geometry sit ON something.
                ao = 1.0
                if NAO:
                    occ = 0
                    for _q in range(NAO):
                        ox_ = nx + HEMI[_q][0]; oy_ = ny + HEMI[_q][1]; oz_ = nz + HEMI[_q][2]
                        ol = math.sqrt(ox_*ox_+oy_*oy_+oz_*oz_) or 1.0
                        _, si = hit(hx+nx*0.8, hy+ny*0.8, hz+nz*0.8,
                                    ox_/ol, oy_/ol, oz_/ol, AO_R, True)
                        if si >= 0: occ += 1
                    # 0.78 was too strong: this traces no global illumination at
                    # all, and UE's Lumen will bounce light back into every one
                    # of these creases. Occluding as hard as a GI-less model
                    # suggests makes the render systematically darker than the
                    # engine, which is the wrong direction for a tool whose job
                    # is to warn me about darkness.
                    ao = 1.0 - 0.55 * (occ / float(NAO))
                amb = (0.5 + 0.5*nz) * ao
                # albedo from the world's own map, projected the way the master
                # projects it: world XY on horizontal, (x+y, z) on vertical
                tex = p[11]
                if tex is not None:
                    ts = p[12]
                    if abs(nz) > 0.55:
                        uu = hx*ts; vv = hy*ts
                    else:
                        uu = (hx+hy)*ts; vv = hz*ts
                    ix = int((uu % 1.0)*TSZ) % TSZ
                    iy = int((vv % 1.0)*TSZ) % TSZ
                    ti = (iy*TSZ+ix)*3
                    base = (base[0]*tex[ti]/140.0, base[1]*tex[ti+1]/140.0,
                            base[2]*tex[ti+2]/140.0)
                # ---- SPECULAR ------------------------------------------
                # One of the two terms this model was missing entirely, and the
                # reason gold and porcelain read as matte paint here while the
                # engine gives them highlights. Blinn-Phong off the same sun:
                # metals tint the highlight with their own colour, dielectrics
                # take a small white one.
                _met, _rgh = p[15], p[16]
                _spec = 0.0
                if ndl > 0.0:
                    _hx2 = lx - dx; _hy2 = ly - dy; _hz2 = lz - dz
                    _hl = math.sqrt(_hx2*_hx2 + _hy2*_hy2 + _hz2*_hz2) or 1.0
                    _ndh = (nx*_hx2 + ny*_hy2 + nz*_hz2) / _hl
                    if _ndh > 0.0:
                        _a2 = max(_rgh, 0.05) ** 4
                        _expn = max(2.0, 2.0 / _a2 - 2.0)
                        if _expn > 4096.0:
                            _expn = 4096.0
                        _spec = (_ndh ** _expn) * ndl
                _sr = (0.04 + (base[0] - 0.04) * _met) * _spec * SUN_I * 2.0
                _sg = (0.04 + (base[1] - 0.04) * _met) * _spec * SUN_I * 2.0
                _sb = (0.04 + (base[2] - 0.04) * _met) * _spec * SUN_I * 2.0

                # ---- ONE CRUDE BOUNCE ----------------------------------
                # The other missing term. Lumen puts light back into a surface
                # from its neighbours, tinted by THEIR colour; approximating it
                # as this surface's own albedo re-lit by the sun is wrong in
                # detail and right in character — it warms shadows and returns
                # saturation that a pure sun-plus-blue-sky model throws away.
                _bnc = BOUNCE * ao
                # rim, the same instrument the master got this sprint
                vdn = -(dx*nx + dy*ny + dz*nz)
                rim = (1.0 - (vdn if vdn > 0.0 else 0.0)) ** 3.4
                rr_ = RIM.get(p[13], 0.0)
                cr = (base[0]*(SUN[0]*SUN_I*ndl + SKY_UP[0]*SKY_I*amb
                               + base[0]*SUN[0]*SUN_I*_bnc)
                      + emis[0] + rim*rr_*1.00 + _sr)
                cg = (base[1]*(SUN[1]*SUN_I*ndl + SKY_UP[1]*SKY_I*amb
                               + base[1]*SUN[1]*SUN_I*_bnc)
                      + emis[1] + rim*rr_*0.86 + _sg)
                cb = (base[2]*(SUN[2]*SUN_I*ndl + SKY_UP[2]*SKY_I*amb
                               + base[2]*SUN[2]*SUN_I*_bnc)
                      + emis[2] + rim*rr_*0.55 + _sb)
            # clamp before the gamma: a negative channel raised to a fractional
            # power is complex, and one such value takes the whole frame down
            if cr < 0.0: cr = 0.0
            if cg < 0.0: cg = 0.0
            if cb < 0.0: cb = 0.0
            i = (yy*W+xx)*3
            # EXPOSURE. The model was running at roughly twice the streamed
            # frame's mean, and a Reinhard curve desaturates everything it
            # compresses — so an over-bright render loses colour in the highlights
            # and reads washed. That, not a missing saturation term, is why this
            # was four times less saturated than Unreal. Exposing correctly
            # recovers the colour instead of painting it back on.
            cr *= EXPOSURE; cg *= EXPOSURE; cb *= EXPOSURE
            _r = 255.0*(cr/(1.0+cr))**0.4545
            _g = 255.0*(cg/(1.0+cg))**0.4545
            _b = 255.0*(cb/(1.0+cb))**0.4545
            px[i]   = 0 if _r < 0 else (255 if _r > 255 else int(_r))
            px[i+1] = 0 if _g < 0 else (255 if _g > 255 else int(_g))
            px[i+2] = 0 if _b < 0 else (255 if _b > 255 else int(_b))
        if yy % 20 == 0:
            print("  row %d/%d" % (yy, H)); sys.stdout.flush()

    if CALIB:
        # NORMALISE BY THIS IMAGE'S OWN STATISTICS. The first attempt subtracted
        # a fixed offset fitted to one frame's mean, which is only correct for
        # frames with that mean — applied to a darker render it produced a neon
        # night scene. A histogram match works on any input: measure this
        # image's mean and spread, map them onto the streamed frame's, then
        # boost saturation by the measured ratio.
        lum = [0.2126*px[i] + 0.7152*px[i+1] + 0.0722*px[i+2] for i in range(0, len(px), 3)]
        m0 = sum(lum) / len(lum)
        sd0 = (sum((v - m0) ** 2 for v in lum) / len(lum)) ** 0.5 or 1.0
        for j in range(0, len(px), 3):
            r0, g0, b0 = px[j], px[j+1], px[j+2]
            l0 = 0.2126*r0 + 0.7152*g0 + 0.0722*b0
            r1 = l0 + (r0 - l0) * CAL_SAT
            g1 = l0 + (g0 - l0) * CAL_SAT
            b1 = l0 + (b0 - l0) * CAL_SAT
            lt = CAL_DST + (l0 - m0) * (CAL_SD_DST / sd0)
            k = 1.0 if l0 <= 0.5 else lt / l0
            for off, v in ((0, r1*k), (1, g1*k), (2, b1*k)):
                px[j+off] = 0 if v < 0 else (255 if v > 255 else int(v))

    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SP, "rt.png")
    write_png(out, W, H, px)
    lum = [0.2126*px[i]+0.7152*px[i+1]+0.0722*px[i+2] for i in range(0, len(px), 3)]
    mean = sum(lum)/len(lum)
    var = sum((v-mean)**2 for v in lum)/len(lum)
    sat = 0.0
    for i in range(0, len(px), 3):
        mx = max(px[i], px[i+1], px[i+2]); mn = min(px[i], px[i+1], px[i+2])
        sat += 0.0 if mx == 0 else (mx - mn) / float(mx)
    sat /= (len(px) / 3.0)
    print("%s  luma mean %.1f  sd %.1f  sat %.3f  clipped %.1f%%"
          % (out, mean, var**0.5, sat, 100.0*sum(1 for v in lum if v > 250)/len(lum)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
