"""Leaf-card support for the offline harnesses.

The masked leaf master is built through Unreal's material-editing API, which a
stub `unreal` module cannot provide. `build_leaf_material()` therefore returns
{} offline, and every `if "leafcard" in MATS` guard in the generator — there
are seven — takes its false branch.

The consequence is not cosmetic. The leaf-card system is what gives shrubs,
tufts and tree canopies a BROKEN silhouette instead of a smooth ball, and it
was absent from every preview, every composition figure and every value trace
taken from one. The harnesses were measuring a world with no foliage cards in
it while the shipped world has thousands.

So the builder is replaced with one that reports the three instances present,
and spec entries supply their colour. Same class of fix as the `mat_name_for`
fallback: what the harness cannot build, it must still REPRESENT, or it
measures a different world than the one that ships.

Lives in one file because three harnesses need it and a stub duplicated three
times drifts.
"""


def leaf_stub(_texs):
    """Stand in for build_leaf_material(): reports the three instances built."""
    return {"leafcard": object(), "leafcard_hi": object(), "leafcard_deep": object()}


# Tints from build_leaf_material, resolved against a mid foliage green so the
# preview reads leaves rather than the neutral grey a missing spec produces.
LEAF_SPEC = {
    "leafcard":      ((0.26, 0.45, 0.24), 0.0, 0.74, (0, 0, 0), 0.0),
    "leafcard_hi":   ((0.37, 0.58, 0.33), 0.0, 0.70, (0, 0, 0), 0.0),
    "leafcard_deep": ((0.14, 0.28, 0.16), 0.0, 0.80, (0, 0, 0), 0.0),
}


def apply(ns):
    """Patch a generator namespace so its leaf-card branches are taken.

    Call AFTER the module executes and BEFORE build() runs: build() is what
    calls build_leaf_material and MATS.update()s the result.
    """
    ns["build_leaf_material"] = leaf_stub
    ns["MATERIAL_SPEC"].update(LEAF_SPEC)
    return ns
