"""Age, damage and overgrowth as PARAMETERS, not as a second folder of models.

WHY THIS IS A POST-PROCESS AND NOT A FAMILY. The obvious way to get a ruined
gatehouse is to write `gatehouse_ruined()` next to `gatehouse_twin()`. It is
also the way that guarantees the two drift: the day the twin's arch changes,
the ruin still has the old one, and nothing says so. Every module in this kit
is already a function of its own numbers, so ageing belongs in the same place
-- one recipe, applied to a module that was built the ordinary way, producing a
variant that cannot disagree with its base because it IS its base.

    W = Weather("aged", age=0.55, overgrowth=0.40, seed=3)
    variant = weather(module_spec, W)          # a new ModuleSpec, new meshes

THE THREE DIMENSIONS, and what each is allowed to touch:

  age          Surface only. Vertices move along their own normals by value
               noise, scaled by how EXPOSED they are: an up-facing face high on
               the module moves most, a down-facing face low on it barely moves.
               Erosion is a rain-and-frost process, and geometry that never
               sees either should not weather.

  overgrowth   Addition only. Up-facing ledges above a minimum area get a
               `veg_anchor` volume standing on them. Nothing here models a
               leaf: `veg_anchor` is the world session's own planting hook, so
               the kit says WHERE things grow and the world says what grows.

  damage       Subtraction. The module is cut through at a height by a tilted,
               ragged plane; everything above goes; the cut is capped and
               rubble is dropped at the foot. This is the only dimension that
               can destroy a socket, and it is the reason for the rule below.

THE SOCKET RULE, which the validator enforces:

    A variant's sockets are a SUBSET of its base's, and every socket it keeps
    sits at the same z and the same radius, to the kit's own tolerance.

That is what makes a variant safe to substitute into a spelled stack. `age` and
`overgrowth` may not move a join by a millimetre -- so the bands of geometry
around every join are FROZEN before erosion runs, rather than eroded and hoped
about. `damage` may only DROP sockets it destroyed, never move one, and it
records which ones it dropped in the manifest.

DETERMINISM. Everything here keys off `mesh.rnd`, which is a hash rather than a
generator, so a variant rebuilt tomorrow is byte-identical to today's. The
deterministic-rebuild check in `validate_assets.py` covers variants exactly as
it covers their bases, and it is the reason the noise is not `random`.
"""

import bmesh
import bpy
from mathutils import Vector

from . import kit as K
from . import mesh as M

#: How far above and below a socket's plane is frozen against erosion. A join
#: is a RING of geometry, not a line: 0.30 m holds the ashlar course a socket
#: actually bears on, and is comfortably more than any erosion amount here.
FREEZE_M = 0.30


class Weather(object):
    """One parametric ageing recipe.

    `age`, `damage` and `overgrowth` are all 0..1 and all independent. `seed`
    makes two variants of the same strength differ; `suffix` names the variant
    in the asset id and in `exports/`.
    """

    __slots__ = ("name", "suffix", "age", "damage", "overgrowth", "seed",
                 "break_at", "note")

    def __init__(self, name, age=0.0, damage=0.0, overgrowth=0.0, seed=0,
                 break_at=0.62, suffix=None, note=""):
        for v, n in ((age, "age"), (damage, "damage"),
                     (overgrowth, "overgrowth")):
            if not 0.0 <= float(v) <= 1.0:
                raise ValueError("%s must be 0..1, got %r" % (n, v))
        self.name = str(name)
        self.suffix = str(suffix or name)
        self.age = float(age)
        self.damage = float(damage)
        self.overgrowth = float(overgrowth)
        self.seed = int(seed)
        #: where along the module's height a `damage` cut falls, 0..1
        self.break_at = float(break_at)
        self.note = str(note)

    def as_params(self):
        return {"variant": self.name, "age": self.age, "damage": self.damage,
                "overgrowth": self.overgrowth, "seed": self.seed,
                "break_at": self.break_at if self.damage else None}


# --------------------------------------------------------------------------
# the three dimensions
# --------------------------------------------------------------------------


def _frozen_bands(spec):
    """The z bands erosion may not touch: every join, and the ground datum.

    A `route`, `edge` or `crown` socket is a place you STAND or a place the
    module ends, not a place another module bolts on, so only the structural
    kinds are frozen -- freezing every socket on a stair would freeze the whole
    stair.
    """
    bands = [(-FREEZE_M, FREEZE_M)]                     # the ground datum
    for s in spec.sockets:
        if s.kind in ("tower", "pier", "bridge_end", "ground"):
            bands.append((s.z - FREEZE_M, s.z + FREEZE_M))
    return bands


def erode(obj, amount, freq, seed, bands, lo_z, hi_z):
    """Move vertices along their normals by noise, scaled by EXPOSURE.

    Exposure is `0.35 + 0.65 * up` times a height ramp, where `up` is the
    vertex normal's z mapped to 0..1. The effect is that copings, sills and
    parapets lose their arris while soffits and plinth returns stay crisp,
    which is what weathered masonry actually looks like -- and it means the
    silhouette changes where a silhouette is read.
    """
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    span = max(hi_z - lo_z, 1e-6)
    moved = 0
    for v in bm.verts:
        z = v.co.z
        if any(a <= z <= b for (a, b) in bands):
            continue
        n = v.normal
        if n.length < 1e-9:
            continue
        n = n.normalized()
        up = 0.5 * (n.z + 1.0)
        ramp = 0.45 + 0.55 * ((z - lo_z) / span)
        k = M.rnd(v.co.x * freq, v.co.y * freq, v.co.z * freq, seed) - 0.5
        v.co = v.co + n * (k * 2.0 * amount * (0.35 + 0.65 * up) * ramp)
        moved += 1
    bm.to_mesh(me)
    bm.free()
    me.update()
    return moved


def ledges(objs, min_area=0.14, min_z=0.45):
    """Up-facing faces big enough to stand something on, with their centres.

    Returns `[(area, centre)]` sorted by descending area, so a caller planting
    n things plants them on the n best ledges rather than on n random faces.
    """
    out = []
    for obj in objs.values():
        mw = obj.matrix_world
        mn = mw.to_3x3()
        for f in obj.data.polygons:
            n = mn @ f.normal
            if n.length < 1e-9 or n.normalized().z < 0.92:
                continue
            if f.area < min_area:
                continue
            c = mw @ f.center
            if c.z < min_z:
                continue
            out.append((f.area, (c.x, c.y, c.z)))
    out.sort(key=lambda t: -t[0])
    return out


def overgrow(part, spots, density, seed, bands=(), ceiling=None):
    """Stand `veg_anchor` volumes on the given ledges.

    Low, wide and few. A tall shrub on every ledge reads as topiary; what
    ageing looks like is a handful of clumps in the corners that catch dirt,
    so the volumes are sized from the ledge they sit on and thinned by a hash
    rather than laid on every one.
    """
    n = 0
    for i, (area, (x, y, z)) in enumerate(spots):
        # NOTHING GROWS ON A JOIN. The frozen bands are frozen for overgrowth
        # too: a clump planted on `WL_Tower_Base_Buttressed`'s top socket sat
        # exactly where the next module bolts on, and pushed the measured top
        # 8 cm above the socket the manifest publishes.
        if M.rnd(x, y, z, seed + 91) > density:
            continue
        w = min(1.15, max(0.30, area ** 0.5 * 0.55))
        h = 0.22 + 0.55 * M.rnd(x, y, seed + 7)
        # THE CLUMP ITSELF MUST CLEAR THE JOIN, not just its ledge. The first
        # version tested only where a clump STOOD, so one planted 0.10 m below
        # `WL_Tower_Base_Buttressed`'s frozen band grew 0.48 m up through it
        # and pushed the module's measured top 8 cm above its own top socket.
        if any(z < b and z + h > a for (a, b) in bands):
            continue
        if ceiling is not None and z + h > ceiling:
            continue
        part.box(w, w * (0.7 + 0.5 * M.rnd(y, x, seed + 13)), h,
                 at=(x, y, z), chamfer=0.0, centre_z=False)
        n += 1
    return n


def orient_shells(bm, open_ratio=0.01):
    """Flip any CLOSED shell whose signed volume is negative.

    The same test `export.normals_report` judges by, applied rather than
    reported: for a closed surface the divergence theorem gives a positive
    volume when the winding is outward, so a negative one is an inside-out
    shell whatever its shape.

    IT IS HERE BECAUSE CUTTING A UNION IS NOT LIKE CUTTING A SOLID. Every
    module in this kit is a union of intersecting shells whose individual
    windings only have to be right where they are VISIBLE; a plane through the
    middle of one turns interior surfaces into exterior ones, and four of the
    broken balustrade's balusters came out of `bisect_plane` enclosing negative
    volume. `bmesh.ops.recalc_face_normals` is the usual answer and is worse
    here -- it ray-casts to decide what "outside" means, which for a baluster
    buried in a rail has no answer, and it flipped shells that were correct.

    Shells whose volume is small against their own area are OPEN -- a swept rib,
    an uncapped lathe -- and have no meaningful sign, so they are left alone.
    """
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for i, f in enumerate(bm.faces):
        f.index = i
    for e in bm.edges:
        fs = [f.index for f in e.link_faces]
        for j in fs[1:]:
            a, b = find(fs[0]), find(j)
            if a != b:
                parent[a] = b
    shells = {}
    for i, f in enumerate(bm.faces):
        shells.setdefault(find(i), []).append(f)

    flipped = 0
    for members in shells.values():
        vol = 0.0
        area = 0.0
        for f in members:
            vs = [v.co for v in f.verts]
            area += f.calc_area()
            for t in range(1, len(vs) - 1):
                vol += vs[0].dot(vs[t].cross(vs[t + 1])) / 6.0
        if vol >= 0.0 or abs(vol) <= (area ** 1.5) * open_ratio:
            continue
        for f in members:
            f.normal_flip()
        flipped += 1
    return flipped


def break_off(obj, z_cut, tilt, ragged, seed):
    """Cut the mesh with a tilted plane, throw away the top, cap the hole.

    The cut is TILTED and then RAGGED: a horizontal slice reads as a saw, and a
    saw reads as unfinished rather than as ruined. The tilt is a fraction of
    the module's own width, so a 3 m module and a 30 m one both break at a
    believable angle.
    """
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    no = Vector((tilt * 0.6, tilt * 0.35, 1.0)).normalized()
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    res = bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5,
                                 plane_co=(0.0, 0.0, z_cut), plane_no=no,
                                 clear_outer=True)
    cut_edges = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    for e in cut_edges:
        for v in e.verts:
            v.co.z += (M.rnd(v.co.x * 3.1, v.co.y * 3.1, seed + 5) - 0.5) * 2.0 * ragged
    if cut_edges:
        made = bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)
        faces = [f for f in made.get("faces", []) if f.is_valid]
        if faces:
            tri = bmesh.ops.triangulate(bm, faces=faces)
            faces = [f for f in tri.get("faces", faces) if f.is_valid]
        # ONLY THE NEW CAPS ARE ORIENTED, and they are oriented by the plane
        # rather than by ray casting. `recalc_face_normals` over the whole mesh
        # turned 3 shells of the broken balustrade inside out: a kit module is
        # a UNION of intersecting shells, and asking Blender which way is
        # "outside" for a baluster buried in a rail has no good answer. The cap
        # of a cut, on the other hand, faces the way the cut does, always.
        bm.normal_update()
        for f in faces:
            if f.normal.dot(no) < 0.0:
                f.normal_flip()
    orient_shells(bm)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return len(cut_edges)


# --------------------------------------------------------------------------
# the recipe, applied
# --------------------------------------------------------------------------


def weather(spec, w, base_group=None):
    """Return a NEW ModuleSpec: `spec` aged, damaged and overgrown per `w`.

    The base spec's own meshes are consumed -- the caller builds a fresh one
    for the base if it wants both, which is what `build_assets.py` does. That
    is deliberate: a variant that shared meshes with its base would be a
    variant only until somebody moved a vertex.
    """
    aid = "%s__%s" % (spec.asset_id, w.suffix)
    objs = dict(spec.parts)

    zs = [(o.matrix_world @ v.co).z for o in objs.values() for v in o.data.vertices]
    lo_z, hi_z = min(zs), max(zs)
    bands = _frozen_bands(spec)
    sockets = list(spec.sockets)
    dropped = []

    if w.damage > 0.0:
        z_cut = lo_z + (hi_z - lo_z) * w.break_at
        width = max(max(abs((o.matrix_world @ v.co).x) for o in objs.values()
                        for v in o.data.vertices), 0.5)
        tilt = 0.10 + 0.22 * w.damage
        ragged = (0.05 + 0.30 * w.damage) * min(1.0, width * 0.25)
        for obj in objs.values():
            break_off(obj, z_cut, tilt, ragged, w.seed)
        # A DESTROYED SOCKET IS DROPPED, NEVER MOVED. `damage` is the only
        # dimension allowed to change a variant's socket list, and the names it
        # drops go in the manifest so a generator can see what it lost.
        keep = []
        for s in sockets:
            if s.z > z_cut - FREEZE_M and s.kind != "ground":
                dropped.append(s.name)
            else:
                keep.append(s)
        sockets = keep

    if w.age > 0.0:
        amount = 0.012 + 0.055 * w.age
        for obj in objs.values():
            erode(obj, amount, 1.4 + 1.6 * w.age, w.seed + 31, bands, lo_z, hi_z)

    if w.overgrowth > 0.0:
        spots = ledges(objs)
        if spots:
            f = M.Forge()
            veg = f.part("veg_anchor")
            planted = overgrow(veg, spots, 0.18 + 0.55 * w.overgrowth, w.seed,
                               bands=bands, ceiling=hi_z)
            if planted:
                grown = f.emit(aid)
                for key, o in grown.items():
                    if key in objs:                     # merge into an existing
                        old = objs[key]                 # veg_anchor part
                        bm = bmesh.new()
                        bm.from_mesh(old.data)
                        bm.from_mesh(o.data)
                        bm.to_mesh(old.data)
                        bm.free()
                        old.data.update()
                        bpy.data.objects.remove(o, do_unlink=True)
                    else:
                        objs[key] = o

    # A PART THE BREAK EMPTIED IS DROPPED, not exported as an empty mesh.
    # `WL_Wall_Mural_Tower__ruined` cut away the whole roof: `Forge.emit` has
    # the same rule for the same reason -- a zero-triangle file in `exports/`
    # is a file the world session would find and try to place.
    for key in [k for k, o in objs.items() if not o.data.vertices]:
        bpy.data.objects.remove(objs.pop(key), do_unlink=True)
    if not objs:
        raise ValueError("%s: the %s recipe removed every part" % (aid, w.name))

    # rename every mesh and object into the variant's namespace
    renamed = {}
    for key, o in objs.items():
        name = "%s_%s" % (aid, key) if key != "stone" else aid
        o.name = name
        o.data.name = name
        renamed[key] = o

    params = dict(spec.params)
    params.update(w.as_params())
    params["variant_of"] = spec.asset_id
    if dropped:
        params["sockets_destroyed"] = dropped
    note = spec.note
    if w.note:
        note = "%s; %s" % (note, w.note)
    return K.ModuleSpec(
        aid, spec.family, spec.category, spec.role, renamed, sockets,
        districts=spec.districts, note=note, params=params,
        tri_budget=spec.tri_budget, nanite=spec.nanite,
        collision=spec.collision, excavates=spec.excavates,
        mounts=spec.mounts)
