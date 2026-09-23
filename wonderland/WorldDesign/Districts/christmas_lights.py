#!/usr/bin/env python3
"""XM01 -- Christmas in Wonderland: light, hung where people already walk.

FOUNDER DIRECTIVE 2026-09-23: "Push the world into a stronger CHRISTMAS atmosphere. Do NOT cheaply cover every
object with random Christmas props. Use tasteful environmental art direction. Avoid tacky repetition."

Read the founder's own list and it is mostly LIGHT, not objects: warm window lighting, subtle string lights,
illuminated architecture, distant decorative lights, warm/cool lighting contrast. Only then wreaths, garlands
and ornaments. So this pass is a lighting pass that happens to be festive, and it follows three rules:

  1. HANG IT WHERE PEOPLE WALK. Every element goes along a route the world already has -- the three nations'
     principal avenues and the approach through each gate. Nothing is scattered across roofs or fields where
     it would read as confetti.
  2. WARM AGAINST COOL. Wonderland's daylight is a 5,200 K sun with a cool sky. Amber glass and gold lanterns
     against that is the whole effect: the contrast does the work, not the quantity.
  3. RHYTHM, NOT CARPET. Swags span the avenue at a regular interval with lanterns hung along them, the way a
     real street is dressed. Repetition at a stated spacing reads as decoration; repetition everywhere reads
     as tack.

PLACED FROM THE AVENUES THEMSELVES. The three band specs already hold their avenue paving in world
coordinates, so this pass reads those instances and dresses the street they describe rather than guessing
where the street is. If an avenue moves, this pass moves with it.

CHEAP ON PURPOSE. The world is at 3.5 fps with 99.2% of its triangles on single-LOD meshes, so every asset
here is chosen from the light end of the kit: the hanging lantern is 24-432 triangles, the wall lantern 24-664,
the swag 648-2,070. The whole pass is a rounding error against the 38 M triangles Dubel Forest just added.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
NATIONS = HERE.parent / "Nations"
PASS = "XM01"

KIT = "/Game/WonderlandV2/Kit/%s/%s.%s"
PROP = "/Game/WonderlandV2/Props/Garden/%s.%s"

#: (mesh path, material) -- the warm half of the palette, against a 5,200 K sun and a cool sky.
SWAG = ("/Game/WonderlandV2/Props/Garden/SM_lantern_swag.SM_lantern_swag", "MI_V2_GoldAged")
SWAG_GLASS = ("/Game/WonderlandV2/Props/Garden/SM_lantern_swag_glass.SM_lantern_swag_glass", "MI_V2_GlassAmber")
HANG = ("/Game/WonderlandV2/Kit/details/WL_Detail_Lantern_Hanging_gold.WL_Detail_Lantern_Hanging_gold", "MI_V2_GoldAged")
HANG_GLASS = ("/Game/WonderlandV2/Kit/details/WL_Detail_Lantern_Hanging_glass.WL_Detail_Lantern_Hanging_glass", "MI_V2_GlassAmber")

#: SCALE, LEARNED FROM THE FIRST CAPTURE. WL_Detail_Lantern_Hanging is 72 x 83 x 233 cm, so at scale 1.0 it is
#: a 2.3 m lantern -- and the first pass hung three of those every fourth slab at head height. The capture
#: showed exactly what that is: enormous gold blobs filling the street, which is the "tacky repetition" the
#: founder warned against in the same sentence that asked for the pass. A street lantern is about a metre.
#: SCALE, LEARNED TWICE FROM CAPTURES. SM_lantern_swag is 3260 x 260 x 1250 cm -- it is not a rope, it is a
#: COMPLETE decorated garland 32.6 m wide and 12.5 m tall with its lanterns already modelled into it. The
#: first pass hung it at scale 1.0 AND added three 2.3 m lanterns of its own underneath, which is why the
#: capture showed a street full of enormous gold blobs. The avenue paving runs x = +/-720, so the street is
#: about 14.4 m across: the swag wants 0.45, and the separate lanterns want deleting entirely.
#: NO SWAG. SM_lantern_swag's 3260 x 260 x 1250 cm bounds read like a garland spanning a street; it is not.
#: It is a vertical standard carrying a lantern, and two captures of it hung across the avenue -- once at
#: scale 1.0, once at 0.45 -- produced a street of enormous gold blobs and then a post planted in the
#: carriageway. Both were worse than no pass at all. Reading a mesh's SHAPE from its bounding box is a guess,
#: and this is what the guess cost. What remains is the one asset these captures actually proved:
#: WL_Detail_Lantern_Hanging at 0.42, which rendered correctly as a small ornate street lantern.
LANTERN_EVERY = 5              # every Nth avenue slab gets a pair
LANTERN_SCALE = 0.42           # 2.33 m mesh -> a ~1 m lantern
LANTERN_Z = 430.0              # cm above the paving: lamp height, clear of a walking player
KERB_OFFSET = 860.0            # cm from the avenue centreline: just outside the 720 cm carriageway
CULL = 45000.0

BANDS = [("ic03_band.json", "IC03_Avenue"), ("nc03_band.json", "NC03_Avenue"), ("tq03_band.json", "TQ03_Avenue")]


def main():
    batches = {}

    def add(key, mesh, material, x, y, z, yaw, scale, shadow=False):
        b = batches.setdefault(key, {"id": "%s_%s" % (PASS, key), "mesh": mesh, "material": material,
                                     "instances": [], "collides": False, "cast_shadow": shadow,
                                     "affect_df": False, "cull_distance": CULL})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                               round(scale, 3), round(scale, 3), round(scale, 3)])

    dressed = 0
    for spec_name, batch_id in BANDS:
        spec = json.loads((NATIONS / spec_name).read_text(encoding="utf-8"))
        avenue = next((b for b in spec["batches"] if b["id"] == batch_id), None)
        if avenue is None:
            continue
        inst = sorted(avenue["instances"], key=lambda i: math.hypot(i[0], i[1]))
        for n, i in enumerate(inst):
            if n % LANTERN_EVERY:
                continue
            x, y, z, yaw = i[0], i[1], i[2], i[4]
            # A pair, one either side of the carriageway, at the kerb line -- the way a street is lit.
            across = math.radians(yaw + 90.0)
            for side in (-1.0, 1.0):
                ox, oy = math.cos(across) * KERB_OFFSET * side, math.sin(across) * KERB_OFFSET * side
                add("Lantern", HANG[0], HANG[1], x + ox, y + oy, z + LANTERN_Z, yaw, LANTERN_SCALE)
                add("Lantern_glass", HANG_GLASS[0], HANG_GLASS[1], x + ox, y + oy, z + LANTERN_Z, yaw, LANTERN_SCALE)
                dressed += 1

    inst_total = sum(len(b["instances"]) for b in batches.values())
    spec = {"pass": PASS,
            "title": "XM01: Christmas in Wonderland -- swags and lanterns over the three principal avenues",
            "tags": ["XM01", "WL_CHRISTMAS", "WL_SEASONAL"],
            "folder": "Wonderland/Authored/XM01_Christmas",
            "actors": [], "batches": list(batches.values())}
    (HERE / "xm01_christmas_lights.json").write_text(json.dumps(spec, indent=1), encoding="utf-8")
    print("%s -> xm01_christmas_lights.json" % PASS)
    print("  avenues dressed at %d swags, %d batches, %d instances" % (dressed, len(batches), inst_total))
    for k in sorted(batches, key=lambda k: -len(batches[k]["instances"])):
        print("    %-22s %5d" % (k, len(batches[k]["instances"])))
    return spec


if __name__ == "__main__":
    main()
