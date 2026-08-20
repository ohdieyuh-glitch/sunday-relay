import os as _os
_HERE = _os.path.dirname(_os.path.abspath(__file__))
_WL = _os.path.dirname(_os.path.dirname(_HERE))          # <repo>/wonderland
#!/usr/bin/env python3
"""Rasterise the hero camera OFFLINE from the dry run's actor list.

This is not a render and must never be mistaken for one: no real lighting, no
shadows, no normals, no materials beyond base colour, and every primitive drawn
as a blob. What it IS is an honest projection of the actual geometry the
generator emits, through the actual hero camera, at the actual scales — so it
answers the composition questions a build would otherwise have to answer:

  does the tree reach far enough to frame the top of the frame?
  is the castle behind the plaza or on top of it?
  is the subject clear of the foreground, or buried in it?
  where is the mass, and where is the hole?

Those are the questions the goal's iteration rule asks after every pass, and
this answers them in twenty seconds without a GPU. The streamed frame remains
the only ground truth for how it LOOKS.
"""
import io
import json
import math
import struct
import sys
import types
import zlib

REPO = _os.path.dirname(_WL)
GEN = _os.path.join(_HERE, "generate-hub-level.py")
LAYOUT = _os.path.join(_WL, "WorldDesign", "hub-layout.json")

W, H = 800, 450
records = []
_pending_dogs = []
_dog_scale = {}


def record(mesh_key, location, scale, label, rotation=(0.0, 0.0, 0.0), mat=None):
    try:
        records.append((str(mesh_key), (float(location[0]), float(location[1]), float(location[2])),
                        (float(scale[0]), float(scale[1]), float(scale[2])), mat, str(label),
                        (float(rotation[0]), float(rotation[1]), float(rotation[2]))))
    except Exception:
        pass


# ---------------------------------------------------------------- stub engine
class V:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = float(x), float(y), float(z)

    def __sub__(self, o):
        return V(self.x - o.x, self.y - o.y, self.z - o.z)


class Any(object):
    def __init__(self, name="o"):
        self._n = name

    def __getattr__(self, k):
        if k.startswith("__"):
            raise AttributeError(k)
        return Any(self._n + "." + k)

    def __call__(self, *a, **kw):
        return Any(self._n + "()")

    def get_actor_location(self):
        return V()

    def get_actor_scale3d(self):
        return V(1, 1, 1)

    def get_path_name(self):
        return "/Game/" + self._n


class DogProxy(Any):
    """Records only ITS OWN scale. A shared slot was overwritten by the next
    static mesh's scale write — which is how the preview grew a Dog the size of
    the sky."""

    def __init__(self, slot):
        Any.__init__(self, "DogProxy")
        self._slot = slot

    def set_actor_scale3d(self, v):
        _dog_scale[self._slot] = float(v.x)


_imported = set()


class Enum(object):
    def __getattr__(self, k):
        if k.startswith("__"):
            raise AttributeError(k)
        return "E_" + k


def make_unreal():
    u = types.ModuleType("unreal")
    u.log = lambda m: None
    u.log_warning = lambda m: None
    u.log_error = lambda m: None
    u.Vector = V
    u.Rotator = lambda *a, **kw: Any("Rot")
    u.LinearColor = lambda *a, **kw: Any("LC")
    u.Color = lambda *a, **kw: Any("C")
    u.Name = lambda s: s

    class _A(object):
        def spawn_actor_from_object(self, *a, **kw):
            return Any("actor")

        def spawn_actor_from_class(self, cls, loc, *a, **kw):
            # The Relay Dog is a C++ actor that builds its own body, so it never
            # reaches static_mesh. Without a stand-in the one thing the frame is
            # supposed to be ABOUT is invisible in the preview.
            nm = str(getattr(cls, "_n", cls))
            if "Dog" in nm or "Stroll" in nm:
                slot = len(_pending_dogs)
                _pending_dogs.append((loc.x, loc.y, loc.z))
                return DogProxy(slot)
            return Any("actor")

        def get_all_level_actors(self):
            return []

        def destroy_actor(self, a):
            return True

    class _EAL(object):
        def does_asset_exist(self, p):
            return str(p) in _imported

        def does_directory_exist(self, p):
            return False

        def delete_directory(self, p):
            return True

        def load_asset(self, p):
            return Any("as")

        def save_asset(self, p):
            return True

    class _T(object):
        def create_asset(self, *a, **kw):
            return Any("as")

        def import_asset_tasks(self, tasks):
            # mark them present so the generator's "did it import?" check passes
            # and the code path that USES the textures actually runs offline
            for _t in tasks:
                d = getattr(_t, "_dest", None)
                if d:
                    _imported.add(d)
            return []

    class _MEL(object):
        def __getattr__(self, k):
            return lambda *a, **kw: Any("mel")

    u.get_editor_subsystem = lambda c: _A()
    u.EditorAssetLibrary = _EAL()
    u.AssetToolsHelpers = Any("ATH")
    u.AssetToolsHelpers.get_asset_tools = lambda: _T()
    u.MaterialEditingLibrary = _MEL()
    u.load_class = lambda o, p: Any("class:" + str(p))
    u.load_asset = lambda p: Any("as")
    for e in ("MaterialProperty", "MaterialSamplerType", "TextureCompressionSettings",
              "SkyLightSourceType", "AutoExposureMethod", "VectorNoiseFunction", "TextureAddress"):
        setattr(u, e, Enum())
    class _Task(Any):
        def __init__(self):
            Any.__init__(self, "AssetImportTask")
            self._dest_path = ""
            self._dest_name = ""

        def set_editor_property(self, k, v):
            if k == "destination_path":
                self._dest_path = str(v)
            elif k == "destination_name":
                self._dest_name = str(v)
            self._dest = self._dest_path + "/" + self._dest_name

    def _fallback(n):
        if n == "AssetImportTask":
            return _Task
        return Any(n)

    u.__getattr__ = _fallback
    return u


# ---------------------------------------------------------------- png
def write_png(path, w, h, px):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += px[y * w * 3:(y + 1) * w * 3]

    def ck(t, pl):
        return struct.pack(">I", len(pl)) + t + pl + struct.pack(">I", zlib.crc32(t + pl) & 0xFFFFFFFF)

    open(path, "wb").write(b"\x89PNG\r\n\x1a\n"
                           + ck(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                           + ck(b"IDAT", zlib.compress(bytes(raw), 6)) + ck(b"IEND", b""))




import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from wl_preview_leaf import apply as _wl_leaf_apply  # noqa: E402


def main():
    sys.modules["unreal"] = make_unreal()
    src = io.open(GEN, encoding="utf8").read()
    # inject a recorder at the top of static_mesh's body: every primitive in the
    # world goes through it, including everything _part builds
    # Inject AFTER the label is made unique, not at the function's first line:
    # recording the argument records the name the caller asked for, and the
    # generator may have had to rename it. Attribution has to see what the world
    # actually contains.
    anchor = ("        actor = spawn(unreal.StaticMeshActor, location, "
              "rotation=rotation, scale=scale, label=label)")
    if anchor not in src:
        raise SystemExit("static_mesh signature changed; preview needs its anchor updated")
    src = src.replace(anchor, anchor + "\n        __wl_record__(mesh_key, location, scale, label, rotation, mat)", 1)
    ns = {"__name__": "__wl_preview__", "__file__": GEN, "__wl_record__": record}
    exec(compile(src, GEN, "exec"), ns)
    # Patch AFTER the module executes and BEFORE build() runs: build() is what
    # calls build_leaf_material and then MATS.update()s the result, so the
    # substitution has to be in place for that call and not before it.
    _wl_leaf_apply(ns)
    records[:] = []                                   # drop the module-level build
    ns["build"](json.load(io.open(LAYOUT, encoding="utf8")))
    # STAND-INS FOR THE DOGS, transcribed from the C++ pawn.
    #
    # The Dog is the focal subject of the hero frame and it is NOT built by the
    # generator — AWonderlandDogPawn::BuildVisibleBody assembles it at runtime —
    # so the preview has to supply its own. The old stand-in was three cubes
    # eyeballed at "about dog-shaped", and measuring it against the C++ it was
    # 168 uu tall where the real Dog is 325: barely half, with no legs at all.
    # Every composition number quoted for the Dog was therefore understating the
    # one object the whole shot is arranged around.
    #
    # These are the real part list from WonderlandDogPawn.cpp, S = 1.3f. THIS IS
    # A TRANSCRIPTION AND IT WILL ROT — if the pawn's proportions change, this
    # must change with them, and verify-dog-proxy.py checks that they still
    # agree.
    #
    # The pawn builds the Dog facing +X and is yawed at spawn; the hero Dog
    # faces the camera, which looks along +Y, so local +X maps to world -Y and
    # local +Y to world +X. Scales swap with the axes.
    for _i, (_dx, _dy, _dz) in enumerate(_pending_dogs):
        _S = 1.3 * (_dog_scale.get(_i, 1.2) / 1.2)   # C++ S, carrying any per-dog scale
        _LegH = 100.0 * _S
        _Bz = _LegH + 34.0 * _S
        _Hz = _Bz + 50.0 * _S
        _M = "dog_body"
        for _n, (_lx, _ly, _lz, _sx, _sy, _sz, _mat) in enumerate((
            # four legs, with the gaps between them that make the Dog read lean
            (-48.0 * _S, -30.0 * _S, _LegH * 0.5, 0.19 * _S, 0.19 * _S, _LegH / 100.0, _M),
            (-48.0 * _S,  30.0 * _S, _LegH * 0.5, 0.19 * _S, 0.19 * _S, _LegH / 100.0, _M),
            ( 48.0 * _S, -30.0 * _S, _LegH * 0.5, 0.19 * _S, 0.19 * _S, _LegH / 100.0, _M),
            ( 48.0 * _S,  30.0 * _S, _LegH * 0.5, 0.19 * _S, 0.19 * _S, _LegH / 100.0, _M),
            (0.0, 0.0, _Bz, 1.28 * _S, 0.86 * _S, 0.66 * _S, _M),            # body
            (78.0 * _S, 0.0, _Hz, 0.80 * _S, 0.82 * _S, 0.80 * _S, _M),      # head
            (6.0 * _S, -26.0 * _S, _Hz + 46.0 * _S, 0.24 * _S, 0.2 * _S, 0.40 * _S, _M),
            (6.0 * _S,  26.0 * _S, _Hz + 46.0 * _S, 0.24 * _S, 0.2 * _S, 0.40 * _S, _M),
            (118.0 * _S, 0.0, _Hz + 6.0 * _S, 0.18 * _S, 0.86 * _S, 0.30 * _S, "dog_visor"),
            (124.0 * _S, -21.0 * _S, _Hz + 2.0 * _S, 0.1 * _S, 0.22 * _S, 0.13 * _S, "dog_eye"),
            (124.0 * _S,  21.0 * _S, _Hz + 2.0 * _S, 0.1 * _S, 0.22 * _S, 0.13 * _S, "dog_eye"),
            (-74.0 * _S, 0.0, _Bz + 24.0 * _S, 0.44 * _S, 0.18 * _S, 0.20 * _S, _M),
        )):
            records.append(("cube",
                            (_dx + _ly, _dy - _lx, _lz),
                            (_sy, _sx, _sz), _mat,
                            "DOGPROXY_%02d_%d" % (_i, _n), (0.0, 0.0, 0.0)))
    spec = ns["MATERIAL_SPEC"]
    mat_name_for = ns["mat_name_for"]
    lay = json.load(io.open(LAYOUT, encoding="utf8"))
    hero = [c for c in lay["heroCameras"] if c["id"] == "cam_arrival_hero"][0]
    eye = [float(v) for v in hero["location"]]
    tgt = [float(v) for v in hero["lookAt"]]
    fov = math.radians(float(hero.get("fovDeg", 64)))

    f = [tgt[i] - eye[i] for i in range(3)]
    fl = math.sqrt(sum(c * c for c in f))
    f = [c / fl for c in f]
    up = [0.0, 0.0, 1.0]
    # screen-right is -X when looking along +Y, which is what the streamed
    # frames show (the gate at x=-1050 appears on the right)
    r = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]]
    rl = math.sqrt(sum(c * c for c in r)) or 1.0
    r = [c / rl for c in r]
    u2 = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]]
    focal = (W * 0.5) / math.tan(fov * 0.5)

    # sky gradient
    px = bytearray(W * H * 3)
    for y in range(H):
        t = y / float(H)
        # deep blue overhead into a warm lavender horizon
        cr = int((0.26 + 0.52 * t) * 255)
        cg = int((0.46 + 0.34 * t) * 255)
        cb = int((0.86 + 0.04 * t) * 255)
        for x in range(W):
            i = (y * W + x) * 3
            px[i], px[i + 1], px[i + 2] = cr, cg, cb

    HAZE = 34000.0
    SKY = (0.62, 0.70, 0.88)

    def shade(mat, z, mesh="", lb=""):
        # Same fallback the generator applies, so the preview shows the colour an
        # object will actually get rather than a neutral stand-in. mesh and lb
        # are PARAMETERS: closing over them picked up whatever those names
        # happened to hold at the call site, which in the plane path was nothing
        # at all.
        m = spec.get(mat or mat_name_for(mesh, lb),
                     ((0.5, 0.5, 0.5), 0, 0.5, (0, 0, 0), 0.0))
        base, emi, es = m[0], m[3], m[4]
        col = [min(1.0, base[c] * 0.80 + emi[c] * min(es, 2.0) * 0.30) for c in range(3)]
        hz = 1.0 - math.exp(-max(z, 0.0) / HAZE)
        return [col[c] * (1.0 - hz) + SKY[c] * hz for c in range(3)]

    def project(p):
        d = (p[0] - eye[0], p[1] - eye[1], p[2] - eye[2])
        z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]
        if z <= 40.0:
            return None
        sx = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / z
        sy = (d[0] * u2[0] + d[1] * u2[1] + d[2] * u2[2]) / z
        return (W * 0.5 + sx * focal, H * 0.5 - sy * focal, z)

    # ---- GROUND PLANES BY RAY CAST. A 3 km plane has no meaningful screen-space
    # bounding box (its corners are behind the camera), so it is the one thing
    # that has to be solved per pixel rather than per actor. Cheap: a handful of
    # planes, one ray-plane intersection each.
    planes = []
    for mesh, loc, sc, mat, _lb, _rt in records:
        if mesh in ("plane", "water_plane"):
            planes.append((loc[2], loc[0], loc[1], abs(sc[0]) * 50.0, abs(sc[1]) * 50.0,
                           mat, mesh, _lb))
    planes.sort(key=lambda q: q[0])
    depth = [1e18] * (W * H)
    for yy in range(H):
        for xx in range(W):
            # ray through this pixel
            sx = (xx + 0.5 - W * 0.5) / focal
            sy = (H * 0.5 - (yy + 0.5)) / focal
            dx = f[0] + r[0] * sx + u2[0] * sy
            dy = f[1] + r[1] * sx + u2[1] * sy
            dz = f[2] + r[2] * sx + u2[2] * sy
            best = None
            for pz, px0, py0, hx, hy, mat, pmesh, plb in planes:
                if abs(dz) < 1e-9:
                    continue
                t = (pz - eye[2]) / dz
                if t <= 0.0:
                    continue
                wx = eye[0] + dx * t
                wy = eye[1] + dy * t
                if abs(wx - px0) > hx or abs(wy - py0) > hy:
                    continue
                zz = t * (dx * f[0] + dy * f[1] + dz * f[2])
                if best is None or zz < best[0]:
                    best = (zz, mat, pmesh, plb)
            if best is None:
                continue
            col = shade(best[1], best[0], best[2], best[3])
            i = (yy * W + xx) * 3
            px[i] = int(col[0] * 255)
            px[i + 1] = int(col[1] * 255)
            px[i + 2] = int(col[2] * 255)
            depth[yy * W + xx] = best[0]

    # ---- everything else: project the eight corners of the oriented box, then
    # fill its screen bounding box (boxes) or the inscribed ellipse (round
    # primitives). Far more faithful than one radius from the largest axis,
    # which drew a 3 km plane and a 20 cm flagstone with the same rule.
    ROUND = ("sphere", "cylinder", "cone", "tree", "teacup", "clock", "pool_rim",
             "island", "mushroom", "spire", "brain", "teapot")
    drawn = 0
    blobs = []
    for mesh, loc, sc, mat, lb, _rt in records:
        if mesh in ("plane", "water_plane"):
            continue
        hx, hy, hz = abs(sc[0]) * 50.0, abs(sc[1]) * 50.0, abs(sc[2]) * 50.0
        minx = miny = 1e18
        maxx = maxy = -1e18
        minz = 1e18
        ok = False
        for cx in (-1, 1):
            for cy in (-1, 1):
                for cz in (-1, 1):
                    q = project((loc[0] + cx * hx, loc[1] + cy * hy, loc[2] + cz * hz))
                    if q is None:
                        continue
                    ok = True
                    minx = min(minx, q[0]); maxx = max(maxx, q[0])
                    miny = min(miny, q[1]); maxy = max(maxy, q[1])
                    minz = min(minz, q[2])
        if not ok:
            continue
        if maxx < 0 or minx > W or maxy < 0 or miny > H:
            continue
        if (maxx - minx) < 0.6 and (maxy - miny) < 0.6:
            continue
        blobs.append((minz, minx, miny, maxx, maxy, mesh, mat, lb))

    blobs.sort(key=lambda b: -b[0])
    for z, x0, y0, x1, y1, mesh, mat, lb in blobs:
        col = shade(mat, z, mesh, lb)
        cr, cg, cb = int(col[0] * 255), int(col[1] * 255), int(col[2] * 255)
        rnd = mesh in ROUND
        ex, ey = (x1 - x0) * 0.5, (y1 - y0) * 0.5
        mx, my = (x0 + x1) * 0.5, (y0 + y1) * 0.5
        ex = max(ex, 0.5); ey = max(ey, 0.5)
        for yy in range(max(0, int(y0)), min(H, int(y1) + 1)):
            dy = (yy + 0.5 - my) / ey
            for xx in range(max(0, int(x0)), min(W, int(x1) + 1)):
                if rnd:
                    dx = (xx + 0.5 - mx) / ex
                    if dx * dx + dy * dy > 1.0:
                        continue
                k = yy * W + xx
                if z > depth[k]:
                    continue
                depth[k] = z
                i = k * 3
                px[i], px[i + 1], px[i + 2] = cr, cg, cb
        drawn += 1

    # LANDMARK EXTENTS. "Is the Observatory visible" is a measurable question,
    # and measuring it beats squinting at a 800px preview.
    for want in [a[7:] for a in sys.argv if a.startswith("--find=")]:
        hits = [b for b in blobs if want.lower() in b[7].lower()]
        if not hits:
            print("  FIND %-22s : nothing on screen" % want)
            continue
        x0 = min(h[1] for h in hits); x1 = max(h[3] for h in hits)
        y0 = min(h[2] for h in hits); y1 = max(h[4] for h in hits)
        z = min(h[0] for h in hits)
        print("  FIND %-22s : %3d parts  x[%5d %5d] (%4.1f%% wide)  y[%5d %5d] (%4.1f%% tall)  z=%6.0f"
              % (want, len(hits), x0, x1, 100.0 * (x1 - x0) / W, y0, y1,
                 100.0 * (y1 - y0) / H, z))

    if "--budget" in sys.argv:
        # WHAT THE WORLD COSTS, BY GROUP. If the streamed frame rate ever needs
        # actors back, this says exactly where they are — guessing which pass
        # was expensive is how you delete the cheap thing that mattered.
        import collections as _c
        tally = _c.Counter()
        for _m, _l, _sc, _mt, _lb, _r in records:
            key = _lb.rstrip("0123456789_")
            key = key.split("_")[0][:22] if "_" in _lb else key[:22]
            tally[key] += 1
        tot = sum(tally.values())
        print("  ACTOR BUDGET  %d static meshes" % tot)
        for k, v in tally.most_common(22):
            print("    %-24s %6d  %4.1f%%" % (k, v, 100.0 * v / tot))

    big = sorted(blobs, key=lambda b: -((b[3] - b[1]) * (b[4] - b[2])))
    print("  largest on screen (label, %% of frame, screen box):")
    seen = set()
    shown = 0
    for z, x0, y0, x1, y1, mesh, mat, lb in big:
        key = lb.rstrip("0123456789_")
        if key in seen:
            continue
        seen.add(key)
        area = (min(x1, W) - max(x0, 0)) * (min(y1, H) - max(y0, 0))
        if area <= 0:
            continue
        print("    %-30s %5.1f%%  x[%5d %5d] y[%4d %4d] z=%7.0f %s"
              % (lb[:30], 100.0 * area / (W * H), x0, x1, y0, y1, z, mat))
        shown += 1
        if shown >= 18:
            break

    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/preview.png"
    write_png(out, W, H, px)
    print("preview %s  actors=%d  drawn=%d  planes=%d" % (out, len(records), drawn, len(planes)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
