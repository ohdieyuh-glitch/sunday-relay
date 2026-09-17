#!/usr/bin/env python3
"""GR01 -- the city's plazas, sidewalks and paths are laid in flagstones (2026-09-17).

THE GAP (founder material-realism phase, ground first). A ground census from 12 gameplay cameras found three states:
the HD cobble and the authored slab fields read as stone; the lawn is flat carpet (MQ09's grass texture was rejected);
and the terrace-platform tiles under the plazas, sidewalks and paths wear the SEAMLESS limestone, so a 9-40 m tile reads
as one poured slab -- the 'giant block' look. 196 such tile ACTORS: PlazaShade 35 (53,435 m2), PathWarm 66 (19,380),
PathStone 69 (12,111), PlazaCream 20 (1,089), PlazaWarm 6 (241).

WHAT. The flagstone family (hd_textures.py): random-ashlar flagstones, recessed ~1 cm joints, bevelled arrises with
small chips, per-stone tone/warmth/roughness and tilt, fine grain and pits, a little dirt settled in the joints. Clean.

HOW, without touching anything else. The paving instances are SHARED -- MI_V2_PlazaCream also dresses 371 garden
arches, and all of them cover the kerbs and the forge's real flagstone and slab meshes, where a painted joint pattern
would be wrong. So each gets a TWIN, MI_V2_GroundFlag_<name> (a copy: same master, colour and tuning, flagstone maps),
and only the 196 tile actors are pointed at it (apply_actor_materials.py; before recorded, REVERT restores).
Laying scale: plazas at 4 m per tile (TexScale 0.0025, stones 40-120 cm); paths at 3 m (0.0033, smaller stones).

    python gr01_ground_flagstone.py        (reads terrace_tiles.json; writes gr01_ground_swaps.json)
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp")
TWINS = {"MI_V2_PlazaShade": ("MI_V2_GroundFlag_PlazaShade", 0.0025), "MI_V2_PlazaCream": ("MI_V2_GroundFlag_PlazaCream", 0.0025),
         "MI_V2_PlazaWarm": ("MI_V2_GroundFlag_PlazaWarm", 0.0025), "MI_V2_PathStone": ("MI_V2_GroundFlag_PathStone", 0.0033),
         "MI_V2_PathWarm": ("MI_V2_GroundFlag_PathWarm", 0.0033)}


def main():
    rows = json.loads((TMP / "terrace_tiles.json").read_text(encoding="utf-8"))
    swaps = [{"name": r["name"], "label": r["label"], "slot": 0, "before": r["material"], "after": TWINS[r["material"]][0]}
             for r in rows if r["material"] in TWINS]
    spec = {"pass": "GR01", "title": "Terrace-platform paving tiles laid in flagstones (dedicated twins)", "twins": TWINS, "swaps": swaps}
    (HERE / "gr01_ground_swaps.json").write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    return len(swaps)


if __name__ == "__main__":
    print("swaps", main())
