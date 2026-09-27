#!/usr/bin/env python3
"""Where the city's lamps are, read from the world that already has lamps in it.

THE WORLD HAS HUNDREDS OF LANTERN STANDARDS AND NO LIGHTS. Every `WL_Object_LanternStandard` down every
march, round every plaza and at every checkpoint is an emissive mesh: it glows, and it lights nothing. At
midnight the crimson-and-black TARTARUS checkpoint reads 0.037 luma with 94% of the frame crushed, beside
eight lanterns. The founder's night item asks for "efficient practicals, architectural accents, path/street
illumination, landmark lighting" and says twice that lights are to be SELECTIVE, not placed indiscriminately.

So this does not invent lamp positions. It reads the specs for the lantern standards the world has ALREADY
placed on the surfaces that matter -- territory entrances, plazas, marches, the arrival -- and gives each one
a light in its head, in the colour its glass already is. The runtime (UWonderlandPracticalLightsSubsystem)
spawns them transient, lights only the nearest few dozen to the player, and dims them with the day cycle's
own night curve. Nothing touches the map.

WHICH PASSES, AND WHY THOSE. The founder's priority order for ground is "primary walking surfaces, plazas,
territory entrances, roads/paths, architecture immediately beside traversal, major landmarks", and the same
order is right for light:
    CP01-CP05   the territory checkpoints and their courts       entrances + landmarks
    AP01        the arrival approaches                           the road out of the city
    IC01/NC01/TQ01  the nation marches                           roads
    SF01-SF03   the band seams                                   roads
    LL01/LL02   the lantern lanes in Golden Arrival              plazas and walks
    XM01        the Christmas street lanterns                    facades: dimmer, warmer, "emissive windows"
Everything else keeps its emissive glow and no light, which is what "selective" means.

    python Tools/place_practical_lights.py            # writes WorldDesign/Look/practical_lights.json
"""
import collections
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WD = ROOT / "WorldDesign"
OUT = WD / "Look" / "practical_lights.json"
KIT = json.loads((WD / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
SKIP = ("nations.json", "mesh_bounds.json", "kit_modules.json")

#: The lantern standard's head sits near the top of its 1220 uu; a light there lights the ground and the
#: post, which is what a street lamp does. A hanging lantern's lamp is its own centre.
STANDARD_HEAD = 0.85 * KIT["WL_Object_LanternStandard"]["height"]
HANGING_MID = 0.5 * KIT["WL_Detail_Lantern_Hanging"]["height"]

#: THE CITY'S LAMP VOCABULARY, counted before this was written rather than guessed: 810 facade wall
#: lanterns (the nation detail passes and Golden Arrival's FD05 dressing), 292 SM_waymarker_lamp path
#: lamps (SD01 street dressing), 134 hanging lanterns (XM01 and the checkpoint fingerposts), 60 lantern
#: standards (the marches and the checkpoints). Every one is an emissive mesh and none of them lights.
#: (mesh leaf -> lift above its placement z, candela scale, radius scale). The lift puts the light in the
#: lamp's own head.
#: A lantern is several co-located parts and exactly ONE of them emits, so the lantern lights once rather
#: than three times. These are the fallbacks: if the emitting part is absent at a position, the named
#: secondary emits in its place instead of the lantern going dark.
SECONDARY = {
    "WL_Detail_Wall_Lantern_glass": "WL_Detail_Wall_Lantern_gold",
    "WL_Detail_Lantern_Hanging_glass": "WL_Detail_Lantern_Hanging_gold",
    "WL_Object_LanternStandard_glass": "WL_Object_LanternStandard",
    "WL_Object_LanternStandard_gold": "WL_Object_LanternStandard",
}


def FAMILY_OF(leaf):
    """The lantern family a mesh leaf belongs to, or None if it is not a lantern part."""
    for fam in ("WL_Detail_Wall_Lantern", "WL_Detail_Lantern_Hanging", "WL_Object_LanternStandard"):
        if leaf.startswith(fam):
            return fam
    return None


FIXTURES = {
    "WL_Object_LanternStandard": (0.85 * KIT["WL_Object_LanternStandard"]["height"], 1.0, 1.0),
    "WL_Detail_Lantern_Hanging_gold": (0.5 * KIT["WL_Detail_Lantern_Hanging"]["height"], 0.5, 0.6),
    "WL_Detail_Wall_Lantern_gold": (0.6 * KIT["WL_Detail_Wall_Lantern"]["height"], 0.3, 0.5),
    "SM_waymarker_lamp": (None, 0.8, 0.8),           # lift read from mesh_inventory below
}

#: Pass -> (candelas, radius uu, kind). Selective by the founder's order; not every pass with a lantern.
TAKE = {
    "CP01": (14.0, 1000.0, "entrance"), "CP02": (14.0, 1000.0, "entrance"),
    "CP03": (14.0, 1000.0, "entrance"), "CP04": (14.0, 1000.0, "entrance"), "CP05": (14.0, 1000.0, "entrance"),
    "AP01": (10.0, 900.0, "road"), "IC01": (10.0, 900.0, "road"), "NC01": (10.0, 900.0, "road"),
    "TQ01": (10.0, 900.0, "road"), "SF01": (10.0, 900.0, "road"), "SF02": (10.0, 900.0, "road"),
    "SF03": (10.0, 900.0, "road"),
    # the gate-to-band avenues: the one road in each nation the founder's traversal ruling is about
    "AV01": (11.0, 950.0, "avenue"), "AV02": (11.0, 950.0, "avenue"), "AV03": (11.0, 950.0, "avenue"),
    "LL01": (9.0, 800.0, "plaza"), "LL02": (9.0, 800.0, "plaza"),
    "XM01": (4.0, 500.0, "facade"), "XM02": (4.0, 500.0, "facade"),
    # path lamps: the street dressing tiles, every one of which is a walking surface
    "SD01_South": (8.0, 700.0, "path"), "SD01_SW": (8.0, 700.0, "path"), "SD01_FillNE": (8.0, 700.0, "path"),
    "SD01_FillW": (8.0, 700.0, "path"), "SD01_FillE": (8.0, 700.0, "path"), "SD01_North": (8.0, 700.0, "path"),
    "SD01_NE": (8.0, 700.0, "path"), "SD01_E": (8.0, 700.0, "path"), "SD01_W": (8.0, 700.0, "path"),
    "SD01_SE": (8.0, 700.0, "path"), "SD01_NW": (8.0, 700.0, "path"),
    # TARTARUS AFTER DARK (TQ05), the founder's night correction section B for one nation. Path candelas, not
    # facade: these lamps exist to say "the road continues this way" on a nation whose entire path lighting was
    # 44 lights over 505 m of avenue, a quarter, a band and a market. The hanging lanterns over the market
    # stalls take half of this automatically -- see FIXTURES -- which is right for a stall.
    "TQ05": (11.0, 950.0, "path"),
    # NOCTIS AND ICARUS AFTER DARK (NQ06, IQ06), the same correction for the two nations this lane owns.
    # THE FIGURE IS DERIVED, NOT COPIED: AV01 and AV02 -- the very avenues these lamps infill -- already run
    # at 11.0 candelas and a 950 uu radius, so a lamp added to Noctis's road throws exactly what Noctis's road
    # already throws. Same fixture, same job, same number. TQ05 landing on the same pair is agreement rather
    # than imitation.
    #
    # WITHOUT THESE TWO LINES THE FIXTURES ARE ORNAMENTS. TAKE is the whole filter: a pass that is not a key
    # here contributes ZERO lights however many lanterns it holds, and NQ06 and IQ06 shipped in that state --
    # 36 lamp posts glowing as emissive meshes and lighting nothing, which is the exact condition this
    # placer exists to end.
    "NQ06": (11.0, 950.0, "path"), "IQ06": (11.0, 950.0, "path"),
    # THE GOLDEN ARRIVAL (GA08). Placed by coverage rather than along a route, because a hub is crossed and
    # not followed -- 78.3% of its true walking ground sat more than 15 m from any light, the worst figure
    # in the world, at the place every player begins. Path candelas: these exist to let someone see where
    # they are standing and which way out they are facing.
    "GA08": (11.0, 950.0, "path"),
    # ---- THE FAMILIES THE HAND-WRITTEN LIST FELL BEHIND ON (2026-09-27).
    #
    # TAKE already held eleven SD01_* tiles and six FD05_*, and MISSED the rest of both families
    # plus GF entirely. 388 light fixtures on 35 passes were physically in the world, above ground,
    # spread from x -45,018 to 48,456 -- and throwing nothing, because a pass that is not a key here
    # contributes zero lights. For scale: 34 passes carrying fixtures WERE in the list, so roughly
    # half the world's light fixtures were dark.
    #
    # 186 OF THEM ARE SM_waymarker_lamp -- the world's actual wayfinding fixtures, unlit. That is
    # exactly the founder's "from any major path the practicals should show where traversal
    # continues, without the HUD", already built and switched off. 41 sit within 150 m of the
    # Golden Arrival, which had four practical definitions in total.
    #
    # EVERY FIGURE IS ITS OWN FAMILY'S, not a new judgement: SD01_* takes the path 8.0/700 its
    # eleven siblings already use, FD05_* the facade 6.0/500 its six already use, and GF the path
    # figure because it carries nothing but waymarker lamps.
    "GF01": (8.0, 700.0, "path"), "GF02": (8.0, 700.0, "path"), "GF03": (8.0, 700.0, "path"),
    "GF04": (8.0, 700.0, "path"), "GF05": (8.0, 700.0, "path"), "SD01_CxCityE": (8.0, 700.0, "path"),
    "SD01_CxCityNE": (8.0, 700.0, "path"), "SD01_CxCityS": (8.0, 700.0, "path"), "SD01_CxCitySW": (8.0, 700.0, "path"),
    "SD01_CxCityWE": (8.0, 700.0, "path"), "SD01_CxSSW": (8.0, 700.0, "path"), "SD01_FillEE": (8.0, 700.0, "path"),
    "SD01_FillEL": (8.0, 700.0, "path"), "SD01_FillEMC": (8.0, 700.0, "path"), "SD01_FillEMN": (8.0, 700.0, "path"),
    "SD01_FillEMS": (8.0, 700.0, "path"), "SD01_FillSE2": (8.0, 700.0, "path"), "SD01_FillSFE": (8.0, 700.0, "path"),
    "SD01_FillSFW": (8.0, 700.0, "path"), "SD01_FillWE": (8.0, 700.0, "path"),
    "FD05_CxCityE": (6.0, 500.0, "facade"), "FD05_CxCityNE": (6.0, 500.0, "facade"), "FD05_CxCityS": (6.0, 500.0, "facade"),
    "FD05_CxCitySW": (6.0, 500.0, "facade"), "FD05_CxCityWE": (6.0, 500.0, "facade"), "FD05_CxSSW": (6.0, 500.0, "facade"),
    "FD05_FillEE": (6.0, 500.0, "facade"), "FD05_FillEL": (6.0, 500.0, "facade"), "FD05_FillEMC": (6.0, 500.0, "facade"),
    "FD05_FillEMN": (6.0, 500.0, "facade"), "FD05_FillEMS": (6.0, 500.0, "facade"), "FD05_FillSE2": (6.0, 500.0, "facade"),
    "FD05_FillSFE": (6.0, 500.0, "facade"), "FD05_FillSFW": (6.0, 500.0, "facade"), "FD05_FillWE": (6.0, 500.0, "facade"),
    # facade accents: architecture immediately beside traversal, dim
    "NC02": (6.0, 500.0, "facade"), "IC04": (6.0, 500.0, "facade"), "NC04": (6.0, 500.0, "facade"),
    "TQ04": (6.0, 500.0, "facade"), "TQ02": (6.0, 500.0, "facade"), "IC02": (6.0, 500.0, "facade"),
    "FD05_South": (6.0, 500.0, "facade"), "FD05_SW": (6.0, 500.0, "facade"), "FD05_FillNE": (6.0, 500.0, "facade"),
    "FD05_FillW": (6.0, 500.0, "facade"), "FD05_FillE": (6.0, 500.0, "facade"), "FD05_North": (6.0, 500.0, "facade"),
}
INVENTORY = ROOT.parent.parent / "Users" / "Kaisi" / ".claude" / "jobs" / "ec4f540e" / "tmp" / "mesh_inventory.json"
INVENTORY = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/mesh_inventory.json")

#: The colour a lamp throws is the colour its glass already is. Read off the glass part's material.
GLASS_COLOUR = {
    "MI_V2_NoctisLuminous": (0.72, 0.86, 1.00),
    "MI_V2_TartarusEmber": (1.00, 0.46, 0.18),
    "MI_V2_IcarusGlass": (0.92, 0.95, 1.00),
    "MI_V2_GlassTeal": (0.70, 0.95, 0.90),
    "MI_V2_GlassAmber": (1.00, 0.72, 0.36),
    "MI_V2_NoctisGlass": (0.62, 0.70, 0.92),
}
WARM = (1.00, 0.78, 0.50)


def main():
    lights, per_pass, glass_by_key = [], collections.Counter(), {}
    sizes = {}
    if INVENTORY.exists():
        for rec in json.loads(INVENTORY.read_text(encoding="utf-8")):
            sizes[rec["name"]] = rec["size_cm"]
    specs = []
    for path in sorted(WD.rglob("*.json")):
        if path.name in SKIP or path.name == OUT.name:
            continue
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
        except Exception:                                                     # noqa: BLE001
            continue
        if isinstance(spec, dict) and "batches" in spec and spec.get("pass") in TAKE:
            specs.append(spec)
    # First pass: the glass colour per (pass, instance position) so the post can look up its own head --
    # and, alongside it, WHICH PARTS OF A LANTERN EXIST AT EACH POSITION.
    #
    # WHY THE SECOND INDEX. A lantern is several co-located batches and exactly one part emits, so the
    # lantern lights once: the bare post for a lantern standard, the gold for a wall or hanging lantern.
    # That is right until a pass places a part WITHOUT its emitting twin -- XM02 carries 91
    # WL_Detail_Wall_Lantern_glass and no gold anywhere, so 91 lanterns threw nothing while XM02 sat
    # correctly in TAKE. Found on 2026-09-27 by audit_light_coverage, and invisible to any check that reads
    # the allowlist rather than the emitted lights.
    parts_by_key = {}
    for spec in specs:
        for b in spec["batches"]:
            leaf = (b.get("mesh") or "").split("/")[-1].split(".")[0]
            fam = FAMILY_OF(leaf)
            for inst in b.get("instances") or []:
                key = (spec["pass"], round(inst[0]), round(inst[1]))
                if leaf.endswith("_glass"):
                    glass_by_key[key] = b.get("material", "")
                if fam:
                    parts_by_key.setdefault((fam,) + key, set()).add(leaf)
    for spec in specs:
        pid = spec["pass"]
        cd, radius, kind = TAKE[pid]
        for b in spec["batches"]:
            leaf = (b.get("mesh") or "").split("/")[-1].split(".")[0]
            primary = SECONDARY.get(leaf)
            if leaf not in FIXTURES and primary is None:
                continue
            # A SECONDARY PART EMITS ONLY WHERE ITS PRIMARY IS NOT PRESENT. Adding the glass leaf outright
            # would double-light the 101 wall lanterns that do have both parts; this lights the ones that
            # do not and leaves the rest exactly as they were.
            borrow = leaf not in FIXTURES
            lift, scale_cd, scale_r = FIXTURES[primary if borrow else leaf]
            if lift is None:
                lift = 0.8 * float(sizes.get(leaf, [0, 0, 300.0])[2])
            fam = FAMILY_OF(leaf)
            for inst in b.get("instances") or []:
                if len(inst) < 7 or float(inst[2]) < -1000.0:
                    continue
                if borrow and primary in parts_by_key.get(
                        (fam, pid, round(inst[0]), round(inst[1])), set()):
                    continue                      # the emitting part is here; this one stays an ornament
                s = float(inst[6])
                mat = glass_by_key.get((pid, round(inst[0]), round(inst[1])), "")
                r, g, bb = GLASS_COLOUR.get(mat, WARM)
                lights.append({"x": round(float(inst[0]), 1), "y": round(float(inst[1]), 1),
                               "z": round(float(inst[2]) + lift * s, 1),
                               "r": r, "g": g, "b": bb, "cd": round(cd * scale_cd, 1),
                               "radius": round(radius * scale_r),
                               "source": 12.0, "label": "%s %s" % (pid, kind)})
                per_pass[pid] += 1
    # LANDMARK LIGHTING: an up-light at the foot of each checkpoint tower, in the nation accent, so the
    # silhouette the tower was built for is still there after dark.
    proof = WD / "Districts" / "cp_proof_points.json"
    if proof.exists():
        for site, row in json.loads(proof.read_text(encoding="utf-8")).items():
            if row.get("tower"):
                accent = {"NOCTIS": GLASS_COLOUR["MI_V2_NoctisLuminous"],
                          "TARTARUS": GLASS_COLOUR["MI_V2_TartarusEmber"],
                          "ICARUS": GLASS_COLOUR["MI_V2_IcarusGlass"]}.get(site, WARM)
                tx, ty = row["tower"]
                lights.append({"x": tx, "y": ty, "z": round(float(row["ground_z"]) + 700.0, 1),
                               "r": accent[0], "g": accent[1], "b": accent[2],
                               "cd": 40.0, "radius": 2600.0, "source": 60.0,
                               "label": "%s landmark" % row["pass"]})
                per_pass[row["pass"] + " landmark"] += 1
    OUT.write_text(json.dumps({"lights": lights,
                               "note": "generated by Tools/place_practical_lights.py from the layer specs; "
                                       "regenerate, do not edit"}, indent=1), encoding="utf-8")
    print("%d practical lights -> %s" % (len(lights), OUT.relative_to(ROOT)))
    for pid, n in per_pass.most_common():
        print("   %-16s %4d" % (pid, n))
    print("The runtime lights only the nearest wl.Look.PracticalCount (48) within wl.Look.PracticalRadius")
    print("(120 m) of the player, so this count is a definition, not a cost.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
