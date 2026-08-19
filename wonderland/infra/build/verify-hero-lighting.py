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
textures reduced to their average colour. It answers exactly one question — is
the VALUE STRUCTURE right: does the sun read, do shadows land, is the shadowed
side lifted or crushed, does gold separate from stone. The streamed California
frame remains the only ground truth for how it looks.
"""
import io
import json
import math
import os
import struct
import sys
import zlib

SP = os.path.dirname(os.path.abspath(__file__))
REPO = "/home/kaisinrogodfree5/wonderland-ca-fixes"
W, H = int(os.environ.get('WL_W', '336')), int(os.environ.get('WL_H', '189'))
SPP_SHADOW = 1


def load_world():
    """Reuse the preview's recorder to get every primitive the generator emits."""
    src = io.open(os.path.join(SP, "preview.py"), encoding="utf8").read()
    ns = {"__name__": "__wl_rt__", "__file__": os.path.join(SP, "preview.py")}
    # run only the top half: the stub, the recorder, the png writer
    cut = src.index("def main():")
    exec(compile(src[:cut], "preview.py", "exec"), ns)
    sys.modules["unreal"] = ns["make_unreal"]()
    gen = io.open(REPO + "/wonderland/infra/build/generate-hub-level.py", encoding="utf8").read()
    anchor = ("    def static_mesh(mesh_key, location, scale, label, "
              "rotation=(0.0, 0.0, 0.0), mat=None):")
    gen = gen.replace(anchor, anchor + "\n        __wl_record__(mesh_key, location, scale, label, rotation, mat)", 1)
    gns = {"__name__": "__wl_rt_gen__",
           "__file__": REPO + "/wonderland/infra/build/generate-hub-level.py",
           "__wl_record__": ns["record"]}
    cwd = os.getcwd()
    os.chdir(REPO + "/wonderland")
    try:
        exec(compile(gen, "gen.py", "exec"), gns)
        ns["records"][:] = []
        gns["build"](json.load(io.open("WorldDesign/hub-layout.json", encoding="utf8")))
    finally:
        os.chdir(cwd)
    return ns["records"], gns["MATERIAL_SPEC"], ns["write_png"]


def main():
    records, SPEC, write_png = load_world()
    lay = json.load(io.open(REPO + "/wonderland/WorldDesign/hub-layout.json", encoding="utf8"))
    hero = [c for c in lay["heroCameras"] if c["id"] == "cam_arrival_hero"][0]
    atm = lay.get("atmosphere", {})

    # ---- primitives ---------------------------------------------------
    # 0 = ellipsoid, 1 = oriented box. Cones and cylinders are traced as boxes:
    # at this resolution their silhouette contribution is a few pixels and their
    # LIGHTING behaves like a box, which is the only thing being measured.
    ROUND = ("sphere",)
    prims = []
    for mesh, loc, sc, mat, lb, rot in records:
        hx, hy, hz = abs(sc[0]) * 50.0, abs(sc[1]) * 50.0, abs(sc[2]) * 50.0
        if hx < 1e-4 or hy < 1e-4 or hz < 1e-4:
            continue
        yaw = math.radians(rot[1] if mesh not in ROUND else 0.0)
        m = SPEC.get(mat or "plaza", ((0.5, 0.5, 0.5), 0.0, 0.5, (0, 0, 0), 0.0))
        base = m[0]
        emis = (m[3][0] * m[4], m[3][1] * m[4], m[3][2] * m[4])
        kind = 0 if mesh in ROUND else 1
        prims.append((kind, loc[0], loc[1], loc[2], hx, hy, hz,
                      math.cos(yaw), math.sin(yaw), base, emis))
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
    SKY_I = float(os.environ.get('WL_SKY_I', '1.15'))

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
                ndl = nx*lx + ny*ly + nz*lz
                if ndl > 0.0:
                    _, si = hit(hx+nx*0.6, hy+ny*0.6, hz+nz*0.6, lx, ly, lz, 1e9, True)
                    if si >= 0: ndl = 0.0
                amb = 0.5 + 0.5*nz
                cr = base[0]*(SUN[0]*SUN_I*ndl + SKY_UP[0]*SKY_I*amb) + emis[0]
                cg = base[1]*(SUN[1]*SUN_I*ndl + SKY_UP[1]*SKY_I*amb) + emis[1]
                cb = base[2]*(SUN[2]*SUN_I*ndl + SKY_UP[2]*SKY_I*amb) + emis[2]
            # clamp before the gamma: a negative channel raised to a fractional
            # power is complex, and one such value takes the whole frame down
            if cr < 0.0: cr = 0.0
            if cg < 0.0: cg = 0.0
            if cb < 0.0: cb = 0.0
            i = (yy*W+xx)*3
            px[i]   = int(255.0*(cr/(1.0+cr))**0.4545)
            px[i+1] = int(255.0*(cg/(1.0+cg))**0.4545)
            px[i+2] = int(255.0*(cb/(1.0+cb))**0.4545)
        if yy % 20 == 0:
            print("  row %d/%d" % (yy, H)); sys.stdout.flush()

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
