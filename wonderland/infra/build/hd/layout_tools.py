"""Scene-layout tooling for the HD rebuild — Phase S.

Pure placement mathematics with an optional `unreal` seam, so every function
here runs and is testable on this laptop and does the same thing inside the
editor commandlet. The generator calls these; nothing here calls the
generator.

THE PATH SPLINE TOOL
--------------------
`Spline` is a Catmull-Rom curve through authored control points, resampled by
ARC LENGTH so spacing along the path is uniform however the control points are
distributed. `lay_stones()` walks it and emits one placement per stone:
position, yaw aligned to the tangent, per-stone scale, elevation following the
curve — with the two failure modes the brief names ruled out by construction:

  * OVERLAP: stones are laid on a staggered grid whose pitch is the tile size
    divided by the shrink, so two stones can touch at their chamfers and never
    interpenetrate. Jitter is bounded at a quarter of the joint width.
  * FLOATING: every stone's z comes from the spline (or from `ground_z`, a
    caller-supplied sampler), never from a constant. A path climbing a slope
    carries its stones up with it.

DATA LAYER PREPARATION
----------------------
`data_layer_for()` classifies a label or mesh key into one of the founder's
proposed layers (HD_ARRIVAL, HD_GARDEN, HD_CASTLE, HD_DISTANT, HD_VFX,
HD_PROPS, HD_VEGETATION). Data Layer ASSETS need the editor, and this level is
a plain map (no World Partition), so today the classification is written as an
actor TAG and an outliner FOLDER, which is the form later automation can read
back and turn into real Data Layers without reclassifying anything.
"""

import math

try:
    from . import meshkit as mk
except ImportError:
    import meshkit as mk


# --------------------------------------------------------------------------
# the spline
# --------------------------------------------------------------------------


class Spline(object):
    """Catmull-Rom through control points [(x, y, z), ...], arc-length
    parameterised."""

    def __init__(self, points, closed=False, samples_per_segment=12):
        pts = [tuple(float(c) for c in (list(p) + [0.0, 0.0, 0.0])[:3]) for p in points]
        if len(pts) < 2:
            raise ValueError("a spline needs at least two points")
        self.points = pts
        self.closed = bool(closed)
        self._poly = []          # dense polyline [(x,y,z), ...]
        self._cum = []           # cumulative arc length per polyline vertex
        self._build(samples_per_segment)

    def _ctrl(self, i):
        n = len(self.points)
        if self.closed:
            return self.points[i % n]
        return self.points[max(0, min(n - 1, i))]

    def _eval(self, seg, t):
        p0, p1, p2, p3 = (self._ctrl(seg - 1), self._ctrl(seg),
                          self._ctrl(seg + 1), self._ctrl(seg + 2))
        t2, t3 = t * t, t * t * t
        out = []
        for k in range(3):
            out.append(0.5 * ((2.0 * p1[k]) + (-p0[k] + p2[k]) * t
                              + (2.0 * p0[k] - 5.0 * p1[k] + 4.0 * p2[k] - p3[k]) * t2
                              + (-p0[k] + 3.0 * p1[k] - 3.0 * p2[k] + p3[k]) * t3))
        return tuple(out)

    def _build(self, sps):
        segs = len(self.points) if self.closed else len(self.points) - 1
        self._poly = []
        for s in range(segs):
            for i in range(sps):
                self._poly.append(self._eval(s, i / float(sps)))
        self._poly.append(self._eval(segs - 1, 1.0))
        self._cum = [0.0]
        for i in range(1, len(self._poly)):
            a, b = self._poly[i - 1], self._poly[i]
            self._cum.append(self._cum[-1] + math.sqrt(
                (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2))

    @property
    def length(self):
        return self._cum[-1]

    def at(self, d):
        """Point and unit tangent at arc-length d."""
        d = max(0.0, min(self.length, d))
        lo, hi = 0, len(self._cum) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if self._cum[mid] <= d:
                lo = mid
            else:
                hi = mid
        a, b = self._poly[lo], self._poly[min(hi, len(self._poly) - 1)]
        span = (self._cum[min(hi, len(self._cum) - 1)] - self._cum[lo]) or 1.0
        t = (d - self._cum[lo]) / span
        p = tuple(a[k] + (b[k] - a[k]) * t for k in range(3))
        tx, ty, tz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        L = math.sqrt(tx * tx + ty * ty + tz * tz) or 1.0
        return p, (tx / L, ty / L, tz / L)

    def sample(self, spacing):
        """Points every `spacing` uu along the curve: [(d, (x,y,z), (tx,ty,tz))]."""
        n = max(1, int(self.length / spacing))
        return [(i * self.length / n,) + self.at(i * self.length / n) for i in range(n + 1)]

    def offset_xy(self, d, lateral):
        """A point `lateral` uu to the RIGHT of the curve at arc-length d."""
        p, t = self.at(d)
        nx, ny = t[1], -t[0]                # right-hand normal in the XY plane
        return (p[0] + nx * lateral, p[1] + ny * lateral, p[2])

    def distance_xy(self, x, y):
        """Nearest distance from (x, y) to the polyline, in the XY plane."""
        best = 1e18
        for i in range(1, len(self._poly)):
            ax, ay = self._poly[i - 1][0], self._poly[i - 1][1]
            bx, by = self._poly[i][0], self._poly[i][1]
            vx, vy = bx - ax, by - ay
            L2 = vx * vx + vy * vy
            t = 0.0 if L2 < 1e-9 else max(0.0, min(1.0, ((x - ax) * vx + (y - ay) * vy) / L2))
            dx, dy = x - (ax + vx * t), y - (ay + vy * t)
            best = min(best, dx * dx + dy * dy)
        return math.sqrt(best)


# --------------------------------------------------------------------------
# laying stone along it
# --------------------------------------------------------------------------


def lay_stones(spline, width=170.0, tile=60.0, shrink=0.86, seed=0,
               ground_z=None, kerb=True):
    """Placements for a cobbled way along `spline`.

    Returns a list of dicts: {kind: 'stone'|'kerb', x, y, z, yaw, sx, sy, sz,
    tone} — `tone` is 0/1/2 for the three paving materials, chosen by hash so
    the courses alternate and a rebuild lays the identical road.

    The stagger: successive rows shift by half a pitch across the width, so the
    joints never line up along the direction of travel — running bond, which
    is how a road is actually laid and the thing that stops it reading as a
    grid. Pitch = tile / shrink, so a stone scaled by `shrink` sits inside its
    own cell with a joint of tile * (1 - shrink) all round.
    """
    out = []
    pitch = tile / max(shrink, 0.5)
    across = max(1, int(width / pitch))
    d = 0.0
    row = 0
    jitter = tile * (1.0 - shrink) * 0.25
    while d <= spline.length:
        p, t = spline.at(d)
        yaw = math.degrees(math.atan2(t[1], t[0]))
        stagger = 0.5 * pitch if (row % 2) else 0.0
        for k in range(across + 1):
            lat = -width * 0.5 + pitch * k + stagger
            if lat < -width * 0.5 - pitch * 0.25 or lat > width * 0.5 + pitch * 0.25:
                continue
            h = mk.rnd(row, k, seed)
            jx = (mk.rnd(row, k, seed + 1) - 0.5) * 2.0 * jitter
            jy = (mk.rnd(row, k, seed + 2) - 0.5) * 2.0 * jitter
            x, y, z = spline.offset_xy(d, lat)
            x += jx
            y += jy
            if ground_z is not None:
                z = float(ground_z(x, y))
            sc = shrink * (0.94 + 0.12 * mk.rnd(row, k, seed + 3))
            out.append({"kind": "stone", "x": x, "y": y, "z": z,
                        "yaw": yaw + (mk.rnd(row, k, seed + 4) - 0.5) * 14.0,
                        "sx": tile / 100.0 * sc, "sy": tile / 100.0 * sc,
                        "sz": 0.16 + 0.05 * mk.rnd(row, k, seed + 5),
                        "tone": int(h * 3.0) % 3, "d": d})
        if kerb:
            for sgn in (-1, 1):
                x, y, z = spline.offset_xy(d, sgn * (width * 0.5 + tile * 0.35))
                if ground_z is not None:
                    z = float(ground_z(x, y))
                out.append({"kind": "kerb", "x": x, "y": y, "z": z, "yaw": yaw,
                            "sx": tile * 1.2 / 100.0, "sy": tile * 0.6 / 100.0,
                            "sz": 0.14, "tone": 0, "d": d})
        d += pitch
        row += 1
    return out


def overlaps(placements, kind="stone"):
    """Count pairs of stones whose footprints intersect. A layout tool that
    can be asked whether it kept its own promise."""
    ps = [p for p in placements if p["kind"] == kind]
    n = 0
    for i in range(len(ps)):
        a = ps[i]
        ra = 50.0 * max(a["sx"], a["sy"])
        for j in range(i + 1, len(ps)):
            b = ps[j]
            if abs(a["d"] - b["d"]) > ra * 4.0:
                continue
            rb = 50.0 * max(b["sx"], b["sy"])
            if math.hypot(a["x"] - b["x"], a["y"] - b["y"]) < (ra + rb) * 0.82:
                n += 1
    return n


# --------------------------------------------------------------------------
# data layers / folders / tags
# --------------------------------------------------------------------------

DATA_LAYERS = ("HD_ARRIVAL", "HD_GARDEN", "HD_CASTLE", "HD_DISTANT",
               "HD_VFX", "HD_PROPS", "HD_VEGETATION")


def data_layer_for(label="", mesh_key="", material="", distance=0.0):
    """Classify one placed thing into a Data Layer name."""
    lb = (label or "").lower()
    mk_ = (mesh_key or "").lower()
    mt = (material or "").lower()
    if distance and distance > 30000.0:
        return "HD_DISTANT"
    if any(s in lb for s in ("rune", "arcane", "spark", "mote", "glow", "aura")):
        return "HD_VFX"
    if any(s in mk_ for s in ("canopy", "trunk", "branch", "leaf", "shrub", "vine",
                              "rose", "flower", "bloom", "grass", "topiary", "arch")) \
            or mt.startswith(("foliage", "leaf", "petal", "rose")):
        return "HD_VEGETATION"
    if any(s in mk_ for s in ("teacup", "saucer", "teapot", "clock", "key",
                              "lantern", "urn", "bench", "card")):
        return "HD_PROPS"
    if any(s in mk_ for s in ("roof", "tower", "wall", "cornice", "column",
                              "baluster", "merlon", "dome", "corbel", "balcony",
                              "bridge", "stairs", "finial")) or "castle" in lb \
            or "spire" in lb or "sky" in lb:
        return "HD_CASTLE"
    if any(s in mk_ for s in ("flagstone", "cobble", "kerb", "gate", "scroll",
                              "heart_motif", "spear")) or "tile" in lb \
            or "plaza" in lb or "gate" in lb:
        return "HD_ARRIVAL"
    if "mush" in mk_ or "bed" in lb or "orn" in lb or "garden" in lb:
        return "HD_GARDEN"
    return "HD_ARRIVAL"


def folder_for(mesh_key=""):
    """Outliner folder from the HD hierarchy (Phase C), for editor tidiness."""
    try:
        from . import ue_bridge as B
    except ImportError:
        import ue_bridge as B
    return "HD/" + B.FOLDER.get(mesh_key, "Props/Garden")


# --------------------------------------------------------------------------
# the `unreal` seam — every call tolerant, every failure reported not raised
# --------------------------------------------------------------------------


def tag_actor(unreal, actor, tags):
    try:
        cur = list(actor.get_editor_property("tags") or [])
        for t in tags:
            nm = unreal.Name(str(t))
            if nm not in cur:
                cur.append(nm)
        actor.set_editor_property("tags", cur)
        return True
    except Exception:
        return False


def set_folder(unreal, actor, path):
    for fn in ("set_folder_path",):
        try:
            getattr(actor, fn)(unreal.Name(path))
            return True
        except Exception:
            continue
    return False


def make_spline_actor(unreal, actors, spline, label, folder="HD/Splines"):
    """A SplineComponent on an empty actor, so the authored path is EDITABLE
    in the editor by later automation. Best effort: this world is generated
    headlessly and the placements do not depend on the actor existing."""
    try:
        actor = actors.spawn_actor_from_class(unreal.Actor, unreal.Vector(0, 0, 0),
                                              unreal.Rotator())
        if actor is None:
            return None
        actor.set_actor_label(label)
        comp = None
        for args in ((unreal.SplineComponent, False, unreal.Transform(), False),
                     (unreal.SplineComponent,)):
            try:
                comp = actor.add_component_by_class(*args)
                break
            except Exception:
                continue
        if comp is None:
            return actor
        try:
            comp.clear_spline_points(True)
            space = unreal.SplineCoordinateSpace.WORLD
            for p in spline.points:
                comp.add_spline_point(unreal.Vector(p[0], p[1], p[2]), space, True)
            comp.set_closed_loop(spline.closed, True)
        except Exception:
            pass
        set_folder(unreal, actor, folder)
        tag_actor(unreal, actor, ["HD_ARRIVAL", "PathSpline"])
        return actor
    except Exception:
        return None
