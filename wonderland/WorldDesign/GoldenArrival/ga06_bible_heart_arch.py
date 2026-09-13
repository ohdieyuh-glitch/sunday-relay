#!/usr/bin/env python3
"""GA06 -- the Bible's hero path: a heart arch you walk through, and gold screens beside it.

WHAT THE BIBLE SHOWS (VISUAL_AUTHORITY.md). On every hero panel (BOARD_1 centre, BOARD_2 centre, BOARD_3
centre and "Heart Arches", BOARD_4 panel 01, BOARD_5 panel 1, BOARD_6 hero) the path runs through layered
arches -- a green HEART-SHAPED topiary arch, a gold arch beyond it, the castle beyond that -- with an ornate
GOLD GATE / screen on the other side, rising out of the planting.

WHAT WAS THERE. From HeroCam_V2_MarbleReference the garden path runs between low walls (x +/-250) and
hedge blocks (x +/-330) toward the gold garden arch (GA01, y 3200). Two heart topiaries exist, both off to
the right behind 3.2 m hedge masses (GA01 at (-1021, 2230) and the generator's at (-903, 2655)); neither
reads from the hero pose. There is no gold screen on the path at all.

WHAT THIS LAYER ADDS.
  HEART ARCH   SM_heart_topiary is an open heart outline (11.8 m wide, 10.8 m tall, 4 m deep, hollow;
               captured 2026-09-13). Straddling the path at y 1480 -- between the hedge row at y 1100 and
               the hedge blocks at y 1640 -- and sunk so its lower point is below the paving, it leaves a
               walk-through opening wider than the 5 m path with the two lobes rising above the walker.
               No collision: its simple collision is a box that would seal the path.
  GOLD CLOCK   the Bible's big gold pocket clock on the left of the hero path (BOARD_2 and BOARD_6 hero,
               BOARD_3 centre), on a stone pedestal rising out of the flowers at the far end of GA05's left
               planter -- inside the planter's footprint, so it takes no walking room and leaves the plaza's
               central lane (x +/-390) clear. The world's SM_clock_ornate is one gold slot, dial included,
               and at 2x it read as crumpled gold foil from both sides (GA06b, not saved); the forge's
               WL_Object_PocketClock (families/objects.py) has a ceramic dial with gold marks and hands.
  GOLD SCREENS two WL_Detail_Screen_Filigree runs (kit, 6.1 m x 6.3 m, gold filigree in an ivory frame,
               complex-as-simple collision) butted end to end along the path's left side at x +620, rising
               out of the hedge masses, facing the path.

MEASURED INPUTS. obstacles job 141 (box x +/-2600, y 850..3400): walls x +/-250, hedge blocks x +/-330 at
y 1000/1320/1640/..., hedge masses r 365 at x +/-390..420 from y 1950. Ground z -14. Bounds read 142:
heart topiary origin (-6.5, -6.1, 403.5) extent (588.2, 198.6, 541.0); filigree screen extent (305, 45, 315)
from z 0.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "GA06"
GROUND = -14.0
V2 = "/Game/WonderlandV2/"
HEART = V2 + "Vegetation/Topiary/SM_heart_topiary.SM_heart_topiary"
SCREEN = V2 + "Kit/details/WL_Detail_Screen_Filigree.WL_Detail_Screen_Filigree"
SCREEN_GOLD = V2 + "Kit/details/WL_Detail_Screen_Filigree_gold.WL_Detail_Screen_Filigree_gold"
CLOCK_ENAMEL = V2 + "Kit/objects/WL_Object_PocketClock_enamel.WL_Object_PocketClock_enamel"
CLOCK_GOLD = V2 + "Kit/objects/WL_Object_PocketClock_gold.WL_Object_PocketClock_gold"
PEDESTAL = V2 + "Props/Garden/SM_pedestal_finial.SM_pedestal_finial"

HEART_SCALE = 1.05
HEART_TIP_Z = 403.5 - 541.0          # local z of the heart's lower point
HEART_SINK_FRACTION = 0.38           # of the heart's height below the paving: opening ~ path width and more


def build():
    actors = []

    def actor(id_, mesh, loc, materials, scale, yaw=0.0, collision="block"):
        s = [scale] * 3 if isinstance(scale, (int, float)) else list(scale)
        actors.append({"id": id_, "mesh": mesh, "loc": [round(v, 2) for v in loc], "rot": [0.0, round(yaw, 2), 0.0],
                       "scale": [round(v, 4) for v in s], "materials": materials, "collision": collision})

    height = 2.0 * 541.0
    heart_z = GROUND - (HEART_TIP_Z + HEART_SINK_FRACTION * height) * HEART_SCALE
    actor("HeartArch", HEART, (0.0, 1480.0, heart_z), ["MI_V2_LeafMid"], HEART_SCALE, yaw=0.0, collision="none")

    for k, y in enumerate((2050.0, 2660.0)):
        actor("GoldScreen%d_Frame" % k, SCREEN, (620.0, y, GROUND), ["MI_V2_IvoryStone"], 1.0, yaw=90.0)
        actor("GoldScreen%d_Gold" % k, SCREEN_GOLD, (620.0, y, GROUND), ["MI_V2_Gold"], 1.0, yaw=90.0, collision="none")

    # GA05 left planter: centre (470, 420), 164 x 357 cm, top z 12 + 70 * 0.95. The kit clock's dial faces
    # its +X; yaw -90 turns it toward the arrival. Case radius 150 cm at 1x; it stands on its case edge at z 0.
    planter_top = 12.0 + 70.0 * 0.95
    pedestal_scale, clock_scale = 1.0, 0.8
    actor("ClockPedestal", PEDESTAL, (470.0, 560.0, planter_top - 10.0), ["MI_V2_MarblePale"], pedestal_scale, collision="none")
    clock_base = planter_top - 10.0 + 124.0 * pedestal_scale - 6.0
    actor("PocketClock_Dial", CLOCK_ENAMEL, (470.0, 560.0, clock_base), ["MI_V2_Ceramic"], clock_scale, yaw=-90.0, collision="none")
    actor("PocketClock_Gold", CLOCK_GOLD, (470.0, 560.0, clock_base), ["MI_V2_Gold"], clock_scale, yaw=-90.0, collision="none")

    return {"pass": PASS, "title": "Bible hero path: walk-through heart arch and gold filigree screens",
            "folder": "Wonderland/Authored/GA06", "tags": ["V2_Garden"], "actors": actors, "batches": [],
            "heart": {"scale": HEART_SCALE, "z": round(heart_z, 1),
                      "above_paving_m": round(((1.0 - HEART_SINK_FRACTION) * height) * HEART_SCALE / 100.0, 1),
                      "width_m": round(2 * 588.2 * HEART_SCALE / 100.0, 1)}}


if __name__ == "__main__":
    spec = build()
    out = HERE / "ga06_bible_heart_arch.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d actors, heart %s -> %s" % (PASS, len(spec["actors"]), spec["heart"], out.name))
