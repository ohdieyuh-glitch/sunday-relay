# Editor job: build the RELAY DOG SUB-AGENT CUB GHOST asset family into /Game/WonderlandV2.
#
# FOUNDER DIRECTIVE (2026-09-22, as corrected the same day): the Cubs are the physical Wonderland
# representation of REGULAR SUB-AGENTS. Not /MAS, not swarm agents, not Compound AI Agent clones.
# Asset names are RelayDogCub / SA_CubGhost throughout.
#
# The geometry, materials and hierarchy live with the canonical Relay Dog's own generator, on the
# forge branch, because the Cub is DERIVED from the Dog rather than modelled to look like it:
# cub_canon.py imports dog_canon.py and re-bases the Dog's actual head boxes. This job is only the
# door into the editor -- it adds that folder to sys.path, reloads it so a re-run picks up edits,
# and calls the build in stages so the channel keeps breathing between them.
#
# It creates ASSETS ONLY. It does not touch the open map, spawns nothing, and saves no level.
# Globals: FORGE (where the generator lives), OUT.
import importlib
import json
import sys

FORGE = globals().get("FORGE", r"C:/dev/iwonder/wonderland-blender-forge/wonderland/v2")
OUT = globals().get("OUT", r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/cub_build.json")


def job():
    ues = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)
    # Building assets while the game world is up risks cooking a half-made asset into a PIE session.
    while ues.get_game_world() is not None:
        yield 5.0
    if FORGE not in sys.path:
        sys.path.insert(0, FORGE)
    import dog_canon, gs, cub_canon, cub_ghost_v2          # noqa: E401
    for mod in (dog_canon, gs, cub_canon, cub_ghost_v2):
        importlib.reload(mod)
    cub_ghost_v2 = sys.modules["cub_ghost_v2"]

    ctx = gs.Context(unreal, cub_ghost_v2.LOG)
    RESULT["backend"] = str(ctx.backend)
    yield 0.2
    mats = cub_ghost_v2.build_materials()
    RESULT["materials"] = sorted(mats.keys())
    yield 0.5
    meshes, report = cub_ghost_v2.build_meshes(ctx)
    RESULT["meshes"] = len(report)
    RESULT["tris_total"] = sum(p["tris"] for p in report if isinstance(p["tris"], int))
    yield 0.5
    bp_path, made = cub_ghost_v2.build_blueprint(meshes, mats)
    m = cub_canon.measurements()
    out = {"blueprint": bp_path, "folder": cub_ghost_v2.CUB_FOLDER,
           "ghost_master": cub_ghost_v2.GHOST_MASTER, "head_width_uu": cub_ghost_v2.W_UU,
           "hover_uu": cub_ghost_v2.HOVER_UU, "height_cm": round(cub_canon.height() * cub_ghost_v2.W_UU, 1),
           "parts": report, "made": made,
           "components_per_cub": made["pivots"] + made["meshes"] + made["sockets"] + 1,
           "sockets": [[j, n, [round(v, 2) for v in loc]] for j, n, loc in cub_canon.sockets_unreal(cub_ghost_v2.W_UU)],
           "joints": list(cub_canon.JOINTS), "parents": cub_canon.PARENTS,
           "measurements": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in m.items()}}
    with open(OUT, "w", newline="\n") as f:
        json.dump(out, f, indent=1)
    RESULT["blueprint"] = bp_path
    RESULT["height_cm"] = out["height_cm"]
    RESULT["components_per_cub"] = out["components_per_cub"]
    RESULT["made"] = made
    RESULT["status"] = "done"
