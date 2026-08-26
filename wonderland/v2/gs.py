"""Mesh authoring for V2 — Geometry Script in the editor, meshkit as the fallback.

ONE RECIPE SURFACE, TWO BACKENDS. Every V2 asset is written once against
`MeshBuilder` (revolve, sweep, extrude, primitives, perlin, subdivide, smooth,
boolean, append, transforms, to_asset). Inside the editor the builder drives
Unreal's Geometry Script on a UDynamicMesh — real subdivision surfaces, real
displacement, real booleans, Nanite on the way out. If the plugin or a
function is missing, the same recipe runs on `hd/meshkit` (pure Python) and
the log says FALLBACK in capitals, because a world built by the fallback is
lower fidelity and must never be mistaken for the Geometry Script one.

EVERY ENGINE CALL IS PROBED. UE's Python API names have surprised this
project before, so `_call` tries candidates, records the one that answered,
and the capability report at the top of the build log is the first thing to
read after a run: `GS CAPABILITY: primitives OK revolve OK sweep OK perlin OK
tessellate MISSING boolean OK asset OK`. A missing capability degrades that
one operation (logged per asset), never the build.
"""

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_HD = os.path.join(os.path.dirname(HERE), "infra", "build", "hd")
if _HD not in sys.path:
    sys.path.insert(0, _HD)
import meshkit as mk        # noqa: E402  (engineering kernel, migrated)


class Caps(object):
    """What the engine answered."""

    def __init__(self):
        self.ok = {}
        self.used = {}
        self.errors = {}

    def report(self):
        keys = sorted(set(self.ok) | set(self.errors))
        return "GS CAPABILITY: " + " ".join(
            "%s %s" % (k, "OK" if self.ok.get(k) else "MISSING") for k in keys)


class Backend(object):
    GS = "geometry-script"
    MESHKIT = "meshkit-FALLBACK"


def _v(unreal, p):
    return unreal.Vector(float(p[0]), float(p[1]), float(p[2]))


def _xf(unreal, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    r = unreal.Rotator()
    r.set_editor_property("pitch", float(rot[0]))
    r.set_editor_property("yaw", float(rot[1]))
    r.set_editor_property("roll", float(rot[2]))
    return unreal.Transform(_v(unreal, at), r, _v(unreal, scale))


# ==========================================================================
# the builder
# ==========================================================================


class MeshBuilder(object):
    """One mesh under construction. Same calls, either backend."""

    def __init__(self, ctx, name="mesh"):
        self.ctx = ctx
        self.name = name
        self.u = ctx.unreal
        self.backend = ctx.backend
        self.tris_estimate = 0
        self.notes = []
        if self.backend == Backend.GS:
            self.dm = ctx.new_dynamic_mesh()
            if self.dm is None:
                self.backend = Backend.MESHKIT
                self.notes.append("no DynamicMesh; FALLBACK")
        if self.backend == Backend.MESHKIT:
            self.mesh = mk.Mesh()

    # ---- primitives ------------------------------------------------------

    def box(self, w, d, h, at=(0, 0, 0), rot=(0, 0, 0), steps=1, chamfer=None):
        if self.backend == Backend.GS:
            self.ctx.gs("primitives", "append_box", self.dm, self.ctx.prim_opts(), _xf(self.u, at, rot),
                        dimension_x=float(w), dimension_y=float(d), dimension_z=float(h),
                        steps_x=int(steps), steps_y=int(steps), steps_z=int(steps),
                        origin=self.ctx.origin_center())
        else:
            m = mk.chamfer_box(w, d, h, c=chamfer) if chamfer else mk.box(w, d, h)
            self._merge(m, at, rot)
        return self

    def sphere(self, r, at=(0, 0, 0), steps=16):
        if self.backend == Backend.GS:
            self.ctx.gs("primitives", "append_sphere_lat_long", self.dm, self.ctx.prim_opts(), _xf(self.u, at),
                        radius=float(r), steps_phi=int(steps), steps_theta=int(steps * 2),
                        origin=self.ctx.origin_center())
        else:
            prof = [(r * math.sin(math.pi * i / steps), -r * math.cos(math.pi * i / steps)) for i in range(steps + 1)]
            self._merge(mk.lathe(prof, seg=steps * 2), at)
        return self

    def cylinder(self, r, h, at=(0, 0, 0), rot=(0, 0, 0), steps=24, capped=True):
        if self.backend == Backend.GS:
            self.ctx.gs("primitives", "append_cylinder", self.dm, self.ctx.prim_opts(), _xf(self.u, at, rot),
                        radius=float(r), height=float(h), radial_steps=int(steps), height_steps=1,
                        capped=bool(capped), origin=self.ctx.origin_base())
        else:
            self._merge(mk.lathe([(r, 0.0), (r, h)], seg=steps, close=capped), at, rot)
        return self

    def cone(self, r0, r1, h, at=(0, 0, 0), rot=(0, 0, 0), steps=24):
        return self.revolve([(r0, 0.0), (r1, h)], steps=steps, at=at, rot=rot)

    def torus(self, R, r, at=(0, 0, 0), rot=(0, 0, 0), major=32, minor=12, arc=360.0):
        """A ring, full or partial. A partial ring is a circle profile revolved
        through `arc` degrees -- one construction on both backends, which is
        how the dry run caught six recipes reaching for a meshkit-only path
        while running on Geometry Script."""
        if abs(arc - 360.0) < 1e-6 and self.backend == Backend.GS:
            self.ctx.gs("primitives", "append_torus", self.dm, self.ctx.prim_opts(), _xf(self.u, at, rot),
                        self.ctx.revolve_opts(), major_radius=float(R), minor_radius=float(r),
                        major_steps=int(major), minor_steps=int(minor), origin=self.ctx.origin_center())
            return self
        prof = [(R + r * math.cos(2.0 * math.pi * k / minor), r * math.sin(2.0 * math.pi * k / minor))
                for k in range(minor + 1)]
        return self.revolve(prof, steps=major, at=at, rot=rot, arc=arc)

    def revolve(self, profile, steps=48, at=(0, 0, 0), rot=(0, 0, 0), arc=360.0):
        """profile: [(radius, z), ...] revolved about +Z."""
        if self.backend == Backend.GS:
            poly = [self.u.Vector2D(float(r), float(z)) for (r, z) in profile]
            ro = self.ctx.revolve_opts()
            try:
                ro.set_editor_property("revolve_degrees", float(arc))
            except Exception:
                pass
            self.ctx.gs("primitives", "append_revolve_polygon", self.dm, self.ctx.prim_opts(), _xf(self.u, at, rot),
                        poly, ro, steps=int(steps))
        else:
            self._merge(mk.lathe(list(profile), seg=steps, arc=arc), at, rot)
        return self

    def extrude(self, poly, h, at=(0, 0, 0), rot=(0, 0, 0)):
        """poly: [(x, y), ...] extruded along +Z by h (base at z=0)."""
        if self.backend == Backend.GS:
            pv = [self.u.Vector2D(float(x), float(y)) for (x, y) in poly]
            self.ctx.gs("primitives", "append_simple_extrude_polygon", self.dm, self.ctx.prim_opts(),
                        _xf(self.u, at, rot), pv, height=float(h), height_steps=1, capped=True)
        else:
            self._merge(mk.prism(list(poly), h).translate(0, 0, h * 0.5), at, rot)
        return self

    def tube(self, path, radii, sides=8, at=(0, 0, 0), rot=(0, 0, 0)):
        """Sweep a circle of varying radius along a 3D polyline."""
        pts = [tuple(float(c) for c in p) for p in path]
        if not hasattr(radii, "__len__"):
            radii = [float(radii)] * len(pts)
        if self.backend == Backend.GS:
            # a swept polygon along path transforms; radius by per-transform scale
            circle = [self.u.Vector2D(math.cos(2 * math.pi * k / sides), math.sin(2 * math.pi * k / sides))
                      for k in range(sides)]
            xfs = []
            for i, p in enumerate(pts):
                nxt = pts[min(i + 1, len(pts) - 1)]
                prv = pts[max(i - 1, 0)]
                d = (nxt[0] - prv[0], nxt[1] - prv[1], nxt[2] - prv[2])
                L = math.sqrt(sum(c * c for c in d)) or 1.0
                d = (d[0] / L, d[1] / L, d[2] / L)
                yaw = math.degrees(math.atan2(d[1], d[0]))
                pitch = math.degrees(math.asin(max(-1.0, min(1.0, d[2]))))
                # the polygon lies in the transform's local YZ plane, so the X
                # axis is the sweep direction
                xfs.append(_xf(self.u, p, (pitch, yaw, 0.0), (1.0, radii[i], radii[i])))
            self.ctx.gs("primitives", "append_sweep_polygon", self.dm, self.ctx.prim_opts(), _xf(self.u, at, rot),
                        circle, xfs, loop=False, cap_ends=True, rotation_angle_deg=0.0, scale=1.0)
        else:
            self._merge(mk.tube(pts, radii, sides=sides), at, rot)
        return self

    # ---- deformation / refinement ------------------------------------------

    def perlin(self, magnitude, frequency, seed=0, along_normal=True):
        if self.backend == Backend.GS:
            try:
                layer = self.u.GeometryScriptPerlinNoiseLayerOptions()
                layer.set_editor_property("magnitude", float(magnitude))
                layer.set_editor_property("frequency", float(frequency))
                layer.set_editor_property("random_seed", int(seed))
                opts = self.u.GeometryScriptPerlinNoiseOptions()
                opts.set_editor_property("base_layer", layer)
                opts.set_editor_property("apply_along_normal", bool(along_normal))
                self.ctx.gs("deformers", "apply_perlin_noise_to_mesh", self.dm,
                            self.u.GeometryScriptMeshSelection(), opts)
            except Exception as exc:
                self.notes.append("perlin: %s" % exc)
        else:
            f = frequency
            self.mesh.displace(lambda x, y, z: (
                x + magnitude * mk.fbm(x, y, z, 2, f, seed),
                y + magnitude * mk.fbm(x, y, z, 2, f, seed + 7),
                z + magnitude * mk.fbm(x, y, z, 2, f, seed + 13)))
        return self

    def subdivide(self, level=1):
        if self.backend == Backend.GS:
            try:
                opts = self.u.GeometryScriptPNTessellateOptions()
                self.ctx.gs("subdivide", "apply_pn_tessellation", self.dm, opts, tessellation_level=int(level))
            except Exception as exc:
                self.notes.append("tessellate: %s" % exc)
        else:
            for _ in range(int(level)):
                self.mesh = _midpoint_subdivide(self.mesh)
        return self

    def smooth(self, iterations=3, alpha=0.3):
        if self.backend == Backend.GS:
            try:
                opts = self.u.GeometryScriptIterativeMeshSmoothingOptions()
                opts.set_editor_property("num_iterations", int(iterations))
                opts.set_editor_property("alpha", float(alpha))
                self.ctx.gs("smoothing", "apply_iterative_smoothing_to_mesh", self.dm,
                            self.u.GeometryScriptMeshSelection(), opts)
            except Exception as exc:
                self.notes.append("smooth: %s" % exc)
        else:
            _laplacian(self.mesh, int(iterations), float(alpha))
        return self

    def subtract(self, other, at=(0, 0, 0), rot=(0, 0, 0)):
        """Boolean subtract `other` (a MeshBuilder). Fallback: cannot; noted."""
        if self.backend == Backend.GS and other.backend == Backend.GS:
            try:
                op = self.u.GeometryScriptBooleanOperation.SUBTRACT
                self.ctx.gs("booleans", "apply_mesh_boolean", self.dm, _xf(self.u), other.dm, _xf(self.u, at, rot),
                            op, self.u.GeometryScriptMeshBooleanOptions())
            except Exception as exc:
                self.notes.append("boolean: %s" % exc)
        else:
            self.notes.append("boolean subtract skipped (FALLBACK backend)")
        return self

    def append(self, other, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        if self.backend == Backend.GS and other.backend == Backend.GS:
            self.ctx.gs("edit", "append_mesh", self.dm, other.dm, _xf(self.u, at, rot, scale), delete_input=False)
        elif self.backend == Backend.MESHKIT and other.backend == Backend.MESHKIT:
            m = other.mesh.copy()
            m.scale(*scale)
            self._merge(m, at, rot)
        else:
            self.notes.append("append across backends skipped")
        return self

    def translate(self, dx, dy, dz):
        if self.backend == Backend.GS:
            self.ctx.gs("transforms", "translate_mesh", self.dm, _v(self.u, (dx, dy, dz)))
        else:
            self.mesh.translate(dx, dy, dz)
        return self

    def rotate(self, pitch, yaw, roll, origin=(0, 0, 0)):
        if self.backend == Backend.GS:
            r = self.u.Rotator()
            r.set_editor_property("pitch", float(pitch))
            r.set_editor_property("yaw", float(yaw))
            r.set_editor_property("roll", float(roll))
            self.ctx.gs("transforms", "rotate_mesh", self.dm, r, _v(self.u, origin))
        else:
            self.mesh.rotate_x(roll).rotate_y(pitch).rotate_z(yaw)
        return self

    def scale(self, sx, sy=None, sz=None):
        sy = sx if sy is None else sy
        sz = sy if sz is None else sz
        if self.backend == Backend.GS:
            self.ctx.gs("transforms", "scale_mesh", self.dm, _v(self.u, (sx, sy, sz)), _v(self.u, (0, 0, 0)))
        else:
            self.mesh.scale(sx, sy, sz)
        return self

    def split_normals(self, angle=40.0):
        if self.backend == Backend.GS:
            try:
                so = self.u.GeometryScriptSplitNormalsOptions()
                so.set_editor_property("split_by_opening_angle", True)
                so.set_editor_property("opening_angle_deg", float(angle))
                self.ctx.gs("normals", "compute_split_normals", self.dm, so,
                            self.u.GeometryScriptCalculateNormalsOptions())
            except Exception as exc:
                self.notes.append("normals: %s" % exc)
        return self

    def box_uvs(self, size=100.0):
        if self.backend == Backend.GS:
            try:
                self.ctx.gs("uvs", "set_mesh_uvs_from_box_projection", self.dm, 0,
                            _xf(self.u, (0, 0, 0), (0, 0, 0), (size, size, size)),
                            self.u.GeometryScriptMeshSelection(), 2)
            except Exception as exc:
                self.notes.append("uvs: %s" % exc)
        return self

    # ---- out -----------------------------------------------------------------

    def tri_count(self):
        if self.backend == Backend.GS:
            n = self.ctx.gs("queries", "get_num_triangles", self.dm)
            return int(n) if isinstance(n, int) else -1
        return self.mesh.tri_count()

    def to_asset(self, folder, name, nanite=True, collision=False, lods=True):
        """Save as /Game/.../SM_<name>. Returns the asset path or None."""
        return self.ctx.save_static_mesh(self, folder, name, nanite=nanite, collision=collision, lods=lods)

    # ---- meshkit helpers -------------------------------------------------------

    def _merge(self, m, at=(0, 0, 0), rot=(0, 0, 0)):
        if rot != (0, 0, 0):
            m.rotate_x(rot[2]).rotate_y(rot[0]).rotate_z(rot[1])
        m.translate(*at)
        self.mesh.merge(m)


# ---- meshkit refinement (fallback only) --------------------------------------


def _midpoint_subdivide(m):
    out = mk.Mesh()
    out.verts = list(m.verts)
    cache = {}

    def mid(a, b):
        k = (min(a, b), max(a, b))
        if k not in cache:
            pa, pb = m.verts[a], m.verts[b]
            cache[k] = out.add_vert((pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5)
        return cache[k]
    for ti, (a, b, c) in enumerate(m.tris):
        ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
        g = m.groups[ti]
        uv = m.uvs[ti]
        for tri in ((a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)):
            out.add_tri(tri[0], tri[1], tri[2], uv, g)
    return out


def _laplacian(m, iterations, alpha):
    nbr = {}
    for (a, b, c) in m.tris:
        for x, y in ((a, b), (b, c), (c, a)):
            nbr.setdefault(x, set()).add(y)
            nbr.setdefault(y, set()).add(x)
    for _ in range(iterations):
        new = list(m.verts)
        for i, v in enumerate(m.verts):
            ns = nbr.get(i)
            if not ns:
                continue
            cx = sum(m.verts[j][0] for j in ns) / len(ns)
            cy = sum(m.verts[j][1] for j in ns) / len(ns)
            cz = sum(m.verts[j][2] for j in ns) / len(ns)
            new[i] = (v[0] + alpha * (cx - v[0]), v[1] + alpha * (cy - v[1]), v[2] + alpha * (cz - v[2]))
        m.verts = new


# ==========================================================================
# the context: engine seam, capability probing, asset saving
# ==========================================================================

_LIBS = {
    "primitives": "GeometryScript_Primitives",
    "deformers": "GeometryScript_MeshDeformers",
    "subdivide": "GeometryScript_MeshSubdivide",
    "smoothing": "GeometryScript_MeshSmoothing",
    "booleans": "GeometryScript_MeshBooleans",
    "edit": "GeometryScript_MeshBasicEdit",
    "transforms": "GeometryScript_MeshTransforms",
    "normals": "GeometryScript_MeshNormals",
    "uvs": "GeometryScript_MeshUVs",
    "queries": "GeometryScript_MeshQueries",
    "assets": "GeometryScript_AssetUtils",
    "collision": "GeometryScript_CollisionFunctions",
    "selection": "GeometryScript_MeshSelectionFunctions",
}


class Context(object):
    def __init__(self, unreal, log, force_fallback=False):
        self.unreal = unreal
        self.log = log
        self.caps = Caps()
        self.backend = Backend.MESHKIT
        self.saved = []
        self.failed = []
        if not force_fallback:
            self.backend = Backend.GS if self._probe() else Backend.MESHKIT
        self.log("V2 MESH BACKEND: %s" % self.backend)
        self.log(self.caps.report())

    # ---- probing ---------------------------------------------------------

    def _probe(self):
        u = self.unreal
        for key, lib in _LIBS.items():
            self.caps.ok[key] = hasattr(u, lib)
        core = all(self.caps.ok.get(k) for k in ("primitives", "transforms", "edit", "assets"))
        if not core:
            return False
        dm = self.new_dynamic_mesh()
        self.caps.ok["dynamic_mesh"] = dm is not None
        return dm is not None

    def new_dynamic_mesh(self):
        u = self.unreal
        for maker in (lambda: u.new_object(u.DynamicMesh),
                      lambda: u.DynamicMesh(),
                      lambda: u.DynamicMeshPool().request_mesh()):
            try:
                dm = maker()
                if dm is not None:
                    return dm
            except Exception as exc:
                self.caps.errors["dynamic_mesh"] = str(exc)
        return None

    def gs(self, lib_key, fn, *args, **kw):
        u = self.unreal
        lib = getattr(u, _LIBS[lib_key], None)
        if lib is None:
            self.caps.ok[lib_key] = False
            return None
        f = getattr(lib, fn, None)
        if f is None:
            self.caps.errors["%s.%s" % (lib_key, fn)] = "missing"
            return None
        try:
            out = f(*args, **kw)
            self.caps.used["%s.%s" % (lib_key, fn)] = True
            return out
        except TypeError as exc:
            # kwargs may not match this build; retry positionally
            try:
                out = f(*(list(args) + list(kw.values())))
                self.caps.used["%s.%s" % (lib_key, fn)] = "positional"
                return out
            except Exception as exc2:
                self.caps.errors["%s.%s" % (lib_key, fn)] = str(exc2)
                return None
        except Exception as exc:
            self.caps.errors["%s.%s" % (lib_key, fn)] = str(exc)
            return None

    def prim_opts(self):
        try:
            return self.unreal.GeometryScriptPrimitiveOptions()
        except Exception:
            return None

    def revolve_opts(self):
        try:
            return self.unreal.GeometryScriptRevolveOptions()
        except Exception:
            return None

    def origin_center(self):
        try:
            return self.unreal.GeometryScriptPrimitiveOriginMode.CENTER
        except Exception:
            return None

    def origin_base(self):
        try:
            return self.unreal.GeometryScriptPrimitiveOriginMode.BASE
        except Exception:
            return None

    def mesh(self, name="mesh"):
        return MeshBuilder(self, name)

    # ---- saving ------------------------------------------------------------

    def save_static_mesh(self, mb, folder, name, nanite=True, collision=False, lods=True):
        u = self.unreal
        eal = u.EditorAssetLibrary
        tools = u.AssetToolsHelpers.get_asset_tools()
        asset_name = "SM_" + name
        path = folder + "/" + asset_name
        try:
            if eal.does_asset_exist(path):
                eal.delete_asset(path)
            sm = tools.create_asset(asset_name, folder, u.StaticMesh, u.StaticMeshFactoryNew())
            if sm is None:
                raise RuntimeError("create_asset returned None")
            if mb.backend == Backend.GS:
                opts = u.GeometryScriptCopyMeshToAssetOptions()
                for prop, val in (("enable_recompute_normals", False), ("enable_recompute_tangents", True),
                                  ("enable_remove_degenerates", True), ("emit_transaction", False),
                                  ("apply_nanite_settings", bool(nanite))):
                    try:
                        opts.set_editor_property(prop, val)
                    except Exception:
                        pass
                if nanite:
                    try:
                        ns = u.GeometryScriptNaniteOptions()
                        ns.set_editor_property("enabled", True)
                        opts.set_editor_property("nanite_settings", ns)
                    except Exception:
                        pass
                lod = u.GeometryScriptMeshWriteLOD()
                out = self.gs("assets", "copy_mesh_to_static_mesh", mb.dm, sm, opts, lod)
                if out is None:
                    raise RuntimeError("copy_mesh_to_static_mesh failed: %s"
                                       % self.caps.errors.get("assets.copy_mesh_to_static_mesh"))
                if collision:
                    try:
                        co = u.GeometryScriptCollisionFromMeshOptions()
                        self.gs("collision", "set_static_mesh_collision_from_mesh", mb.dm, sm, co)
                    except Exception:
                        pass
            else:
                import ue_bridge as B
                chain = mk.lod_chain(mb.mesh) if lods else [mb.mesh]
                B._fill_description(u, sm, chain, collision)
                if nanite:
                    try:
                        ns = sm.get_editor_property("nanite_settings")
                        ns.set_editor_property("enabled", True)
                        sm.set_editor_property("nanite_settings", ns)
                    except Exception:
                        pass
            eal.save_asset(path, only_if_is_dirty=False)
            self.saved.append((name, path, mb.backend, mb.tri_count(), list(mb.notes)))
            return path
        except Exception as exc:
            self.failed.append((name, "%s: %s" % (type(exc).__name__, exc)))
            self.log("V2 ASSET FAILED %s -- %s" % (name, exc))
            return None
