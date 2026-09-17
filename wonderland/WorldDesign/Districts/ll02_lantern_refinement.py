#!/usr/bin/env python3
"""LL02 -- the strange lanterns keep their shape and lose the rust (2026-09-17).

THE GAP (unchanged from LL01). At LanternLaneCam27 the 25 SM_lantern_strange landmarks -- the Lantern Hamlets' 11, the
Mushroom Grove's 11 and 3 waypoints -- read as cheap and rusty: a streaked bronze body and beige barrel glass.

WHAT LL01 TAUGHT (rejected, 8db397c0): replacing the object loses what is good about it -- the sculptural silhouette,
the tight cluster, the Mushroom Grove's teal, the whimsy. So LL02 changes MATERIALS ONLY, on these actors only:
  - body: MI_V2_LanternBrass, a clean warm enchanted brass (its own instance; MI_V2_Bronze is also shop and market
    metal and must not move);
  - glass: luminous jewel glass, its own instances (the shared glass is every lit window):
      Mushroom Grove and the waypoints   MI_V2_LanternGlassTeal  (their identity, now glowing)
      Lantern Hamlets                    MI_V2_LanternGlassRose / MI_V2_LanternGlassLavender by a hash of position,
                                         so the cluster reads as a set of different lanterns, not one repeated
Geometry, positions, count and silhouette are untouched: one lantern per existing position.

Reversible: ll02_lantern_swaps.json records every actor's before material (apply_actor_materials.py, REVERT = True).
The materials themselves are created by make_lantern_materials (staged job). Source: lantern_census.json.

    python ll02_lantern_refinement.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp")

BODY_AFTER = "MI_V2_LanternBrass"
TEAL = "MI_V2_LanternGlassTeal"
HAMLET_GLASS = ("MI_V2_LanternGlassRose", "MI_V2_LanternGlassLavender")


def hash01(*vals):
    h = 2166136261
    for v in vals:
        for ch in str(int(round(v))):
            h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h / 4294967295.0


def main():
    rows = [r for r in json.loads((TMP / "lantern_census.json").read_text(encoding="utf-8"))
            if r["kind"] == "actor" and r["mesh"] in ("SM_lantern_strange", "SM_lantern_strange_glass")]
    swaps = []
    for r in rows:
        before = r["materials"][0]
        if r["mesh"] == "SM_lantern_strange":
            after = BODY_AFTER
        elif r["label"].startswith("LMLanternHamlets"):
            t = r["transform"]
            after = HAMLET_GLASS[0] if hash01(t[0], t[1], 7) < 0.5 else HAMLET_GLASS[1]
        else:
            after = TEAL
        swaps.append({"name": r["name"], "label": r["label"], "slot": 0, "before": before, "after": after})
    spec = {"pass": "LL02", "title": "Strange lanterns: enchanted brass and luminous jewel glass (materials only)", "swaps": swaps}
    (HERE / "ll02_lantern_swaps.json").write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    counts = {}
    for s in swaps:
        counts[s["after"]] = counts.get(s["after"], 0) + 1
    return len(swaps), counts


if __name__ == "__main__":
    print(main())
