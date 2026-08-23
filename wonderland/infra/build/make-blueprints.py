#!/usr/bin/env python3
"""Create Wonderland's Blueprint assets from the C++ classes, in the editor.

WHY BLUEPRINTS, AND WHY ONLY THESE

The brief asks for Blueprint-first CONTENT iteration while C++ keeps the Relay
integration, the performance-critical animation and the provenance
infrastructure. That division is the point: a Blueprint subclass of a C++ actor
gets you defaults, components and event graphs you can change without a
40-minute cook, while the arithmetic that must be tested with g++ on a laptop
stays where it can be.

So this creates BLUEPRINT SUBCLASSES of classes that already exist and are
tested. It does not move logic into them. A Blueprint is a binary .uasset and
cannot be hand-written or diffed, which is exactly why nothing load-bearing
should live in one and why this file refuses to fabricate them.

WHAT IT REFUSES TO DO

  * It never writes a .uasset by hand. Every asset is created through
    unreal.AssetToolsHelpers, which is the only supported path.
  * It never invents a parent class. If the C++ class is missing, load_class
    returns None and this says so LOUDLY — the same failure shape that once
    removed eight Relay Dogs from a world that still reported a plausible
    actor count.
  * It is idempotent. An existing Blueprint is left alone, because
    regenerating it every build would discard whatever was authored in it,
    which is the one thing that would make Blueprint iteration worthless.

Run inside the editor:
    UnrealEditor-Cmd Wonderland.uproject -run=pythonscript -script=make-blueprints.py
"""
import sys

try:
    import unreal
except ImportError:  # pragma: no cover - only importable inside the editor
    sys.stderr.write("make-blueprints.py must run inside the Unreal Editor\n")
    raise SystemExit(2)

PACKAGE_PATH = "/Game/Wonderland/Blueprints"

# (asset name, parent C++ class, why it is worth a Blueprint at all)
WANTED = (
    ("BP_RelayDog", "/Script/Wonderland.WonderlandStrollingDog",
     "coat, accessory, roam radius, cruise speed and which Avatar it attends "
     "are all content decisions; the gait underneath them is not"),
    ("BP_ProjectAvatar", "/Script/Wonderland.WonderlandProjectAvatarActor",
     "archetype look and stage thresholds are content; the truthfulness rules "
     "that stop it inventing work stay in C++ where they are tested"),
    ("BP_WonderlandProp", "/Script/Wonderland.WonderlandInteractable",
     "the base every authored interactive prop derives from, so a new prop is "
     "a Blueprint and not a rebuild"),
)


def main():
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    eal = unreal.EditorAssetLibrary
    created, kept, missing = 0, 0, []

    for name, parent_path, why in WANTED:
        dest = "%s/%s" % (PACKAGE_PATH, name)
        if eal.does_asset_exist(dest):
            # IDEMPOTENT ON PURPOSE. Regenerating would discard whatever was
            # authored in the graph, and a Blueprint layer you cannot edit
            # between builds is not a Blueprint layer.
            unreal.log_warning("BLUEPRINT KEPT %s (already exists; not regenerated)" % dest)
            kept += 1
            continue

        parent = unreal.load_class(None, parent_path)
        if parent is None:
            # load_class returns None rather than raising. Silence here is how
            # a missing class becomes a missing world.
            unreal.log_error(
                "BLUEPRINT PARENT MISSING %s for %s — the C++ module is not in "
                "this build. No Blueprint was created." % (parent_path, name))
            missing.append(name)
            continue

        factory = unreal.BlueprintFactory()
        factory.set_editor_property("parent_class", parent)
        asset = tools.create_asset(name, PACKAGE_PATH, unreal.Blueprint, factory)
        if asset is None:
            unreal.log_error("BLUEPRINT CREATE FAILED %s" % dest)
            missing.append(name)
            continue
        eal.save_asset(dest)
        unreal.log_warning("BLUEPRINT CREATED %s <- %s (%s)" % (dest, parent_path, why))
        created += 1

    unreal.log_warning("BLUEPRINTS created=%d kept=%d missing=%d"
                       % (created, kept, len(missing)))
    if missing:
        # A build that silently shipped without them would look identical.
        unreal.log_error("BLUEPRINTS_INCOMPLETE=%s" % ",".join(missing))


if __name__ == "__main__":
    main()
