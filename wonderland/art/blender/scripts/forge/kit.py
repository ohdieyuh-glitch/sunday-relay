"""The Wonderland kit grammar: sockets, the radius ladder, materials, specs.

THE PROBLEM THIS SOLVES. `assets_v2.py` authors 200+ complete objects. Each is
excellent and each is exactly one silhouette: `tower_clock` is 11.9 m and will
always be 11.9 m. The founder reference's skyline is not a set of objects, it
is a GRAMMAR -- the same handful of shafts, cornices, crowns and needles
recombined a hundred times at different heights. You cannot get that read by
authoring a hundred towers; you get it by authoring the parts and letting the
Unreal generator spell with them.

So every module here declares where it can be joined, and the joins are drawn
from a fixed ladder rather than from whatever radius the modeller felt like.
Two modules are compatible when the upper one's `bottom` socket radius equals
the lower one's `top` socket radius. That is a machine-checkable statement, it
is checked (`validate_assets.py` fails a module whose socket radius is off the
ladder), and it is what makes `compatible_below` / `compatible_above` in the
manifest true rather than decorative.

THE RADIUS LADDER
-----------------
Four rungs, and the gaps between them are the taper. A tower that steps
XL -> L -> M -> S over four modules narrows by a factor of 3.8 from footing to
crown, which is roughly what the reference's needles do.

    XL  6.80 m   the footing of a monumental tower, a gate pier
    L   4.60 m   a lower shaft, a heavy body
    M   3.00 m   an upper shaft, most crowns
    S   1.80 m   a lantern, a needle root, a finial

The numbers are not round because round numbers in metres produce visible
repetition when the same module is arrayed -- and because the ratio between
consecutive rungs (0.68, 0.65, 0.60) is close to constant, so a stack tapers
evenly however you spell it.

WHY SOCKETS CARRY A KIND. A `tower` socket and a `bridge_end` socket can have
the same radius and still not be a legal join: a skybridge lands on the side
of a shaft, not on top of a crown. `Socket.kind` stops the compatibility
computation from proposing nonsense, and the kinds are deliberately few.

MATERIALS ARE SLOTS, AND GEOMETRY IS SPLIT BY THEM
--------------------------------------------------
`meshkit`'s docstring states the constraint that governs this whole
repository: the world draws through `WonderlandInstancedBatch`, which carries
ONE MaterialPath per batch, so "a multi-slot mesh would silently render slot 0
everywhere". `assets_v2.py` already obeys it by splitting -- `gatehouse_district`
plus `gatehouse_glass`, `fountain_grand` plus `fountain_grand_water`.

This kit obeys the same rule and makes it structural rather than remembered: a
builder writes into named PARTS, one part per material, and the exporter writes
one file per part. A module with stone, gold and glass in it exports three
meshes that share an origin and stack as one thing. `MATERIALS` maps each part
key to the V2 material instance the world session should assign, so the
handoff is a name, not a colour.
"""

import math

# --------------------------------------------------------------------------
# the radius ladder
# --------------------------------------------------------------------------

#: rung -> attach radius in METRES. See the module docstring.
LADDER = {
    "XL": 6.80,
    "L": 4.60,
    "M": 3.00,
    "S": 1.80,
}

#: The order that counts as "tapering", used to check a proposed stack.
LADDER_ORDER = ("XL", "L", "M", "S")

#: How far a measured socket radius may sit from its rung before the module is
#: rejected. 1 cm: tight enough that a typo fails, loose enough that a profile
#: whose last point is on a chamfer still passes.
LADDER_TOLERANCE_M = 0.010


def rung_of(radius_m):
    """Which ladder rung a radius is on, or None. Used by the validator."""
    for name, r in LADDER.items():
        if abs(float(radius_m) - r) <= LADDER_TOLERANCE_M:
            return name
    return None


# --------------------------------------------------------------------------
# sockets
# --------------------------------------------------------------------------

#: The join kinds. Few on purpose -- every extra kind is a compatibility rule
#: somebody has to keep true.
SOCKET_KINDS = (
    "tower",        # a horizontal ring join in a vertical stack
    "crown",        # the top of a stack: takes a spire or a finial, nothing structural
    "pier",         # the ground foot of an arch or a gate, joins sideways
    "bridge_end",   # a span's landing, attaches to the SIDE of a shaft
    "ground",       # sits on terrain; nothing goes below it
    "route",        # a WALKABLE surface begins or ends here, at a stated level
    "edge",         # a terrace lip: a balustrade or a coping mounts along it
)


# --------------------------------------------------------------------------
# the route ladder -- the radius ladder's horizontal twin
# --------------------------------------------------------------------------
#
# A stair is only a module if the generator knows where it ARRIVES. Sockets
# whose heights are whatever a flight happened to be leave the world session
# solving a packing problem per placement, which is how a stair family becomes
# a set of stair props.
#
# So route elevations are quantised the way join radii are, and the quantum is
# the riser this kit already proved: 0.310 m, which `WL_Wall_Stair_Flight`
# reaches the 6.20 m wall-walk in exactly twenty of. Every rung is a whole
# number of those, in fives:
#
#     T1  1.55 m    5 risers   a garden step-up, a plinth you sit on
#     T2  3.10 m   10 risers   a terrace
#     T3  6.20 m   20 risers   THE WALL-WALK -- already built, now in the system
#     T4  9.30 m   30 risers   an upper court
#
# T3 is not a new number. It is the wall family's `WALK_Z`, which means a
# free-standing stair, a retaining terrace and a curtain wall all arrive at one
# elevation and a generator can join them without knowing they came from
# different families.

#: The riser. Every route elevation in the kit is a whole multiple of it.
RISER_M = 0.310

#: rung -> elevation in METRES.
ROUTE_LADDER = {
    "T1": RISER_M * 5,            # 1.55
    "T2": RISER_M * 10,           # 3.10
    "T3": RISER_M * 20,           # 6.20  == walls.WALK_Z
    "T4": RISER_M * 30,           # 9.30
}

ROUTE_TOLERANCE_M = 0.005


def route_rung(z_m):
    """Which route rung an elevation is on, or None. Used by the validator."""
    for name, z in ROUTE_LADDER.items():
        if abs(float(z_m) - z) <= ROUTE_TOLERANCE_M:
            return name
    return None


def risers_for(z_m):
    """How many 0.310 m risers reach `z_m`, or None if it is not a whole number."""
    n = float(z_m) / RISER_M
    return int(round(n)) if abs(n - round(n)) < 0.02 else None


#: The socket names each kind may use. A hand-maintained allowlist, in the
#: style of the CLI allowlists elsewhere in this repository, and for the same
#: reason: adding a name is a one-line reviewed change, while a typo is a
#: socket a generator will look for and never find.
#:
#: The kinds are not decoration. `tower` and `crown` are the STACK, and their
#: names are fixed at two: a stack is spelled by asking a module for `top` and
#: the next for `bottom`, so a module that called its join `top_socket` would be
#: invisible to `compatible()` and to every spelling in the manifest -- which is
#: exactly the class of mistake nothing else here would catch.
SOCKET_NAMES = {
    "ground": ("bottom",),
    "tower": ("bottom", "top"),
    "crown": ("top", "lantern"),
    "pier": ("end_a", "end_b", "passage", "portal", "wall_join"),
    "bridge_end": ("back", "back_a", "back_b", "deck", "eaves", "end_a",
                   "end_b", "gallery", "walk"),
    "route": ("bottom_route", "deck_route", "floor_route", "foot_route",
              "head_route", "landing", "passage", "shelter", "top_route",
              "walk", "walk_l", "walk_r"),
    "edge": ("balustrade", "board", "counter", "edge", "edge_l", "edge_r",
             "shopfront", "terrace_edge", "water_surface"),
}

#: Socket names that come in pairs: publishing one without the other is a
#: module that can only be joined from one side, which for a run is a bug.
SOCKET_PAIRS = (("end_a", "end_b"), ("back_a", "back_b"),
                ("walk_l", "walk_r"), ("edge_l", "edge_r"))


class Socket(object):
    """One place another module may be joined.

    `z` and `radius` are in METRES in the module's own space, where the
    module's footing is z = 0. `radius` on a `tower`/`crown` socket is the
    attach radius and must be on the ladder. On a `pier`, `bridge_end` or
    `ground` socket it is the local extent and is informational.
    """

    __slots__ = ("name", "z", "radius", "kind", "note")

    def __init__(self, name, z, radius, kind, note=""):
        if kind not in SOCKET_KINDS:
            raise ValueError("unknown socket kind %r" % (kind,))
        self.name = str(name)
        self.z = float(z)
        self.radius = float(radius)
        self.kind = str(kind)
        self.note = str(note)

    def as_dict(self, uu):
        return {
            "name": self.name,
            "kind": self.kind,
            "z_uu": round(uu(self.z), 2),
            "radius_uu": round(uu(self.radius), 2),
            "rung": rung_of(self.radius),
            "note": self.note,
        }


def bottom(radius_m, kind="tower", note=""):
    return Socket("bottom", 0.0, radius_m, kind, note)


def top(z_m, radius_m, kind="tower", note=""):
    return Socket("top", z_m, radius_m, kind, note)


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------

#: part key -> what the world session should assign, and what it is for.
#:
#: `unreal` is a material instance that ALREADY EXISTS in
#: `wonderland/v2/materials_v2.py`, so the world session assigns a name it has
#: rather than authoring anything new. `rgb`, `metallic`, `roughness` and
#: `emissive` are that material's own values copied from the same table; they
#: are used ONLY to tint the preview renders and the GLB, so a contact sheet
#: can be judged for gold/stone/roof balance against the founder reference.
#:
#: The preview colour is NOT a material definition and must not be treated as
#: one. `materials_v2.py` is the authority; if the two ever disagree, this
#: table is the stale one. The manifest records the Unreal name, never the RGB.
MATERIALS = {
    "stone": {
        "unreal": "MI_V2_IvoryStone", "rgb": (0.56, 0.51, 0.43),
        "metallic": 0.0, "roughness": 0.58, "emissive": 0.0,
        "use": "the pale ashlar the reference's towers are cut from"},
    "stone_dark": {
        "unreal": "MI_V2_Stone", "rgb": (0.44, 0.40, 0.34),
        "metallic": 0.0, "roughness": 0.82, "emissive": 0.0,
        "use": "shadowed masonry: undercrofts, arch soffits, buttress cores"},
    "roof": {
        "unreal": "MI_V2_RoofRose", "rgb": (0.56, 0.34, 0.37),
        "metallic": 0.0, "roughness": 0.66, "emissive": 0.0,
        "use": "the rose cone roofs that give the skyline its colour"},
    "roof_alt": {
        "unreal": "MI_V2_RoofLilac", "rgb": (0.52, 0.44, 0.62),
        "metallic": 0.0, "roughness": 0.64, "emissive": 0.0,
        "use": "the second roof colour, so a district is not one hue"},
    "metal": {
        "unreal": "MI_V2_Bronze", "rgb": (0.42, 0.31, 0.20),
        "metallic": 0.68, "roughness": 0.52, "emissive": 0.0,
        "use": "railings, ties, hinges, the structural non-gold"},
    "gold": {
        "unreal": "MI_V2_Gold", "rgb": (0.92, 0.70, 0.36),
        "metallic": 0.90, "roughness": 0.42, "emissive": 0.0,
        "use": "leaf gold: finials, filigree, the reference's loudest accent"},
    "gold_aged": {
        "unreal": "MI_V2_GoldAged", "rgb": (0.60, 0.46, 0.19),
        "metallic": 0.72, "roughness": 0.44, "emissive": 0.0,
        "use": "gold that has been outside -- large ornament, so it is not all bright"},
    "glass": {
        "unreal": "MI_V2_GlassAmber", "rgb": (0.93, 0.68, 0.26),
        "metallic": 0.0, "roughness": 0.09, "emissive": 1.6,
        "use": "lit glazing; emissive in the V2 material"},
    "glass_cool": {
        "unreal": "MI_V2_GlassTeal", "rgb": (0.24, 0.62, 0.62),
        "metallic": 0.0, "roughness": 0.09, "emissive": 1.3,
        "use": "the cool glazing, for contrast against the amber"},
    "veg_anchor": {
        "unreal": "MI_V2_LeafMid", "rgb": (0.18, 0.32, 0.13),
        "metallic": 0.0, "roughness": 0.66, "emissive": 0.0,
        "use": "an ivy/planting attachment surface, not a plant"},
    # WATER IS A SURFACE, NOT A VOLUME. `assets_v2.fountain_grand_water` sets
    # the precedent: the stone and the water are separate meshes so the water
    # takes MI_V2_Water and the stone does not. Every water plane in this kit
    # is a flat lid on a basin whose depth is real geometry, so the material
    # has something to be transparent ONTO and the world session can swap the
    # material without touching a single stone.
    "water": {
        "unreal": "MI_V2_Water", "rgb": (0.36, 0.52, 0.55),
        "metallic": 0.0, "roughness": 0.06, "emissive": 0.0,
        "use": "a still water surface; a flat lid on a basin with real depth"},
    "water_lit": {
        "unreal": "MI_V2_GlassTeal", "rgb": (0.24, 0.62, 0.62),
        "metallic": 0.0, "roughness": 0.09, "emissive": 1.3,
        "use": "falling and lit water -- cascades, spouts, the emissive teal"},
    # THE GROUND'S OWN MATERIALS, and they were already in the world. V2 has
    # four plaza tints, a kerb and three path stones; this kit had used none of
    # them because it had no ground module. A ground module that reached for
    # `stone` would have made its paving the same surface as a tower shaft.
    "paving": {
        "unreal": "MI_V2_PlazaCream", "rgb": (0.50, 0.47, 0.40),
        "metallic": 0.0, "roughness": 0.74, "emissive": 0.0,
        "use": "the walked surface: plaza slabs, landings, the top of a step"},
    "paving_warm": {
        "unreal": "MI_V2_PlazaWarm", "rgb": (0.56, 0.48, 0.35),
        "metallic": 0.0, "roughness": 0.74, "emissive": 0.0,
        "use": "the second tint, so a laid surface has more than one stone in it"},
    "paving_shade": {
        "unreal": "MI_V2_PlazaShade", "rgb": (0.30, 0.28, 0.24),
        "metallic": 0.0, "roughness": 0.78, "emissive": 0.0,
        "use": "the dark inlay: a medallion's band, a runnel's floor, a joint"},
    "kerb": {
        "unreal": "MI_V2_Kerb", "rgb": (0.46, 0.42, 0.35),
        "metallic": 0.0, "roughness": 0.80, "emissive": 0.0,
        "use": "kerbs, gutters, tree surrounds -- the edge of the made surface"},
}

#: A part written with no material named lands here.
DEFAULT_PART = "stone"


def unreal_material(part_key):
    return MATERIALS.get(part_key, MATERIALS[DEFAULT_PART])["unreal"]


# --------------------------------------------------------------------------
# categories and roles
# --------------------------------------------------------------------------

#: `hierarchy.py` in the world tools classifies placements ARCH / LANDMARK /
#: VEG / PROP, and PASS 38's ledger entry records what it cost when a whole
#: authored vocabulary landed in `prop` beside the garden benches. The manifest
#: therefore states the intended classification per asset, so the world session
#: can add the kinds to `hierarchy.py`'s tuples deliberately.
CATEGORIES = ("module", "structure", "landmark", "prop")

#: What the piece does to a silhouette. Free-text would rot; this is checked.
ROLES = (
    "foot",       # widens the base, meets the ground
    "body",       # the repeatable middle of a stack
    "crown",      # terminates a stack with a distinct shape
    "needle",     # the thin vertical that owns the top of the frame
    "threshold",  # you walk through it
    "span",       # it crosses a gap
    "screen",     # a vertical plane of ornament you look through
    "detail",     # attaches to something else and changes its outline
    "hero",       # a one-off with its own identity
    "route",      # you WALK ON it, and it changes your elevation
    "terrace",    # a level platform with a retained edge
)


# --------------------------------------------------------------------------
# the spec a builder returns
# --------------------------------------------------------------------------


class ModuleSpec(object):
    """Everything the manifest needs about one authored module.

    A builder function takes a `Forge` and returns one of these. It never
    writes files, never measures itself and never states a dimension: the
    dimensions in the manifest are MEASURED off the exported geometry by
    `build_assets.py`, because a number in a docstring is a number nobody
    re-checks after the profile changes.
    """

    def __init__(self, asset_id, family, category, role, parts, sockets,
                 districts=(), note="", params=None, tri_budget=None,
                 nanite=True, collision=False, excavates=0.0, mounts=None):
        if category not in CATEGORIES:
            raise ValueError("unknown category %r for %s" % (category, asset_id))
        if role not in ROLES:
            raise ValueError("unknown role %r for %s" % (role, asset_id))
        self.asset_id = str(asset_id)
        self.family = str(family)
        self.category = category
        self.role = role
        self.parts = parts            # {part_key: bpy Object}
        self.sockets = list(sockets)
        self.districts = tuple(districts)
        self.note = str(note)
        self.params = dict(params or {})
        self.tri_budget = tri_budget
        self.nanite = bool(nanite)
        self.collision = bool(collision)
        # HOW FAR BELOW THE GROUND DATUM THIS MODULE IS CUT IN, in metres.
        #
        # The kit's origin rule is "footing at z = 0", and the water family is
        # the first thing to show that the rule was stating a CONSEQUENCE
        # rather than the intent. A basin has depth; its tank is under the
        # paving by construction, and a reflecting pool whose lowest geometry
        # sat at z = 0 would be a tray sitting on the lawn.
        #
        # So z = 0 is the GROUND DATUM -- the plane at which the module meets
        # the terrain around it -- and geometry may go below it only when the
        # module says how far. The validator then checks the DECLARED depth
        # against the MEASURED one, which is a tighter rule than the old one,
        # not a looser one: before, a module could not go below zero at all;
        # now it can, and it has to be right about it to the centimetre.
        self.excavates = float(excavates)
        # WHAT CARRIES THIS MODULE, when it is not the ground.
        #
        # `excavates` said a module may go BELOW the datum if it declares it.
        # The market family asks the mirror question: an awning and a hanging
        # sign have no footing at all, because a facade carries them. Their
        # lowest geometry is 2 m up and always will be, and the footing rule
        # would have to be either broken for them or widened for everything.
        #
        # So a module may FLOAT above the datum only when it names what holds
        # it, and the validator then requires the thing that makes that claim
        # checkable: a `bridge_end` socket, which is the kit's flat mounting
        # face. `mounts="facade"` therefore reads "this hangs off a wall, and
        # here is the wall it hangs off" -- not "this one is exempt".
        self.mounts = str(mounts) if mounts else None
        if self.mounts and self.excavates:
            raise ValueError("%s both excavates and mounts" % asset_id)
        for key in self.parts:
            if key not in MATERIALS:
                raise ValueError("%s writes part %r with no material" % (asset_id, key))

    def socket(self, name):
        for s in self.sockets:
            if s.name == name:
                return s
        return None


# --------------------------------------------------------------------------
# compatibility, computed rather than declared
# --------------------------------------------------------------------------


def apply_measured_terminals(spec, top_m):
    """Set every terminal socket's z from the MEASURED TOP of the module.

    A `crown` socket with radius 0 says "the stack ends here", so its z is a
    statement about where the module ends -- and a builder cannot measure
    itself. Four modules declared a terminal z their geometry never reached
    (`WL_Tower_Crown_Tiered` said 13.40 m and stopped at 11.06 m), which is
    harmless for stacking, since nothing joins there, and dishonest in a
    manifest that claims every number is measured.

    `top_m` IS THE HIGHEST VERTEX, NOT THE HEIGHT. Those are the same number
    for every module that foots on z = 0, which is why this took an excavating
    module to expose: `WL_Water_Pavilion` stands in a basin cut 0.55 m in, so
    its 12.77 m of height ends at z = 12.22, and passing the height put its
    terminal socket half a metre above its own finial. The socket is a position
    in the module's space; the ground datum is the origin of that space; a
    height is neither.

    Called by BOTH `build_assets.py` and `validate_assets.py`, from here, so
    the two cannot disagree about where a module ends.
    """
    for sock in spec.sockets:
        if sock.kind == "crown" and sock.radius <= 1e-9:
            sock.z = float(top_m)
    return spec


def compatible(lower, upper):
    """May `upper` stand on `lower`?

    True when the lower module publishes a `top` socket, the upper publishes a
    `bottom` socket, and their radii sit on the same rung of the ladder.

    A `crown` socket is TERMINAL: radius 0, and nothing stands on it. That is
    not a policy, it is what the geometry said -- see the `TERMINAL` note in
    `families/towers.py` for the measurement that settled it. Spires are
    therefore an alternative TERMINATOR rather than an addition: they carry a
    `bottom` on the M rung and compete with the M crowns for the top of a
    stack, which is the grammar the founder reference itself draws.
    """
    lo, up = lower.socket("top"), upper.socket("bottom")
    if lo is None or up is None:
        return False
    if lo.kind == "crown":
        return False
    if lo.kind != "tower" or up.kind != "tower":
        return False
    r = rung_of(lo.radius)
    if r is None or r != rung_of(up.radius):
        return False
    return upper.role in ("body", "crown", "needle")


def stack_permutations(specs, max_bodies=3):
    """Count the distinct legal towers this kit can spell.

    A tower is foot -> (body x 1..max_bodies) -> terminator, where a
    terminator is any crown or any spire that fits the last rung. Counted by
    walking the graph rather than by multiplying category sizes, because the
    rungs make most products illegal and a multiplied figure would be a
    marketing number. `build_assets.py` writes what this returns into the
    manifest, and it moves whenever a module is added or a socket changes.
    """
    by_role = {}
    for s in specs:
        by_role.setdefault(s.role, []).append(s)
    feet = by_role.get("foot", [])
    bodies = by_role.get("body", [])
    tops = by_role.get("crown", []) + by_role.get("needle", [])

    total = 0
    for foot in feet:
        frontier = [(foot, 0)]
        while frontier:
            cur, depth = frontier.pop()
            total += sum(1 for t in tops if compatible(cur, t))
            if depth < max_bodies:
                for body in bodies:
                    if compatible(cur, body):
                        frontier.append((body, depth + 1))
    return total


def radial(n, radius, phase=0.0):
    """n evenly spaced (x, y, angle_deg) on a circle. Used everywhere."""
    out = []
    for i in range(int(n)):
        a = phase + 2.0 * math.pi * i / float(n)
        out.append((math.cos(a) * radius, math.sin(a) * radius, math.degrees(a)))
    return out
