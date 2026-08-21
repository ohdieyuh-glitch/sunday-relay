#!/usr/bin/env python3
"""Print the visual mesh `import-marble-world.py` would choose, or explain why not.

This exists so a build can check, before it starts, that the file the import
step is going to want is actually on disk — the meshes are hundreds of megabytes,
they are not in git, and they are symlinked into the checkout from persistent
storage that a fresh session may not have linked yet.

It resolves the path by calling the IMPORTER'S OWN choose_mesh. A preflight with
its own copy of the selection rule is worse than none: it agrees today, drifts
tomorrow, and passes a build that then dies at the step it was meant to protect.
Exit 0 and the path on stdout, or exit 1 and the reason on stderr.
"""
import argparse
import io
import json
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
IMPORTER = os.path.join(HERE, "import-marble-world.py")


def load_importer():
    """Load import-marble-world.py as a module despite the dash in its name.

    `unreal` is absent outside the editor and the importer already tolerates
    that at import time — it only refuses inside main().
    """
    src = io.open(IMPORTER, encoding="utf8").read()
    module = types.ModuleType("import_marble_world")
    module.__file__ = IMPORTER
    exec(compile(src, IMPORTER, "exec"), module.__dict__)
    return module


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--root", default=os.path.join(HERE, "worlds"))
    ap.add_argument("--allow-collider-as-visual", action="store_true")
    args = ap.parse_args(argv)

    world_dir = os.path.join(args.root, args.slug)
    manifest_path = os.path.join(world_dir, "manifest.json")
    if not os.path.exists(manifest_path):
        sys.stderr.write("no manifest at %s\n" % manifest_path)
        return 1
    try:
        manifest = json.load(io.open(manifest_path, encoding="utf8"))
    except ValueError as exc:
        # A traceback here is a preflight failing in a way nobody can act on.
        # An empty or half-written manifest is a real state — a fetch that was
        # interrupted leaves one — and it deserves a sentence, not a stack.
        sys.stderr.write("manifest at %s is not readable JSON: %s\n"
                         % (manifest_path, exc))
        return 1

    module = load_importer()
    source, key, why = module.choose_mesh(
        manifest, world_dir, allow_collider=args.allow_collider_as_visual)
    if not source:
        listed = sorted((manifest.get("assets") or {}).get("downloaded") or {})
        sys.stderr.write(
            "the manifest lists %s but no visual mesh resolves on disk under %s\n"
            % (", ".join(listed) or "nothing", world_dir))
        return 1
    sys.stdout.write("%s\n" % source)
    return 0


if __name__ == "__main__":
    sys.exit(main())
