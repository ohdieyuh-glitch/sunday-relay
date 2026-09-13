#!/usr/bin/env python3
"""SKY01 -- floating elements over the Golden Arrival corridor.

WHAT WAS THERE. The Marble reference's sky carries floating gold keys and rose orbs over the castle.
The recovered world has four hover props -- two gold keys 1.3 m long and a teapot and cup -- at
21-33 m up: from the ground they are specks, so the sky read as empty of anything magical.

WHAT THIS LAYER ADDS. Floating props on AWonderlandHoverProp (slow bob and sway), sized to read from
the corridor: large gold keys over the heart garden and palace, rose orbs among the spires, a gold
clock over the Clock Plaza, and a flight of teacups by the palace. Heights keep them above every
roof they are near; nothing collides.
"""
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
V2 = "/Game/WonderlandV2/"
KEY = V2 + "Props/Keys/SM_key_ornate.SM_key_ornate"
ORB = V2 + "Sky/SM_balloon_envelope.SM_balloon_envelope"
CLOCK = V2 + "Props/Clocks/SM_clock_ornate.SM_clock_ornate"
CUP = V2 + "Props/Tea/SM_tea_cup_small.SM_tea_cup_small"
SAUCER = V2 + "Props/Tea/SM_tea_saucer.SM_tea_saucer"


def build():
    rng = random.Random(20260913 + 10)
    hovers = []

    def hover(id_, mesh, material, loc, scale, rot=(0.0, 0.0, 0.0), amp=60.0, period=9.0, sway=5.0):
        hovers.append({"id": id_, "mesh": mesh, "material": material, "loc": list(loc), "rot": list(rot), "scale": [scale] * 3,
                       "amp": amp, "period": period, "sway": sway, "phase": round(rng.uniform(0.0, 1.0), 3)})

    # Gold keys: 14 m long at 9x, tilted like the reference's drifting keys.
    for k, (x, y, z, yaw, roll) in enumerate(((-1900.0, 8400.0, 3300.0, 30.0, 32.0), (2300.0, 11800.0, 4300.0, -40.0, -28.0),
                                              (-3100.0, 14600.0, 5200.0, 70.0, 40.0), (900.0, 17300.0, 4800.0, -15.0, 22.0))):
        hover("Key%d" % k, KEY, "MI_V2_Gold", (x, y, z), 9.0, rot=(12.0, yaw, roll), amp=80.0, period=10.0 + k, sway=6.0)
    # Rose and lavender orbs among the spires.
    orbs = ((-2600.0, 7200.0, 2600.0, 0.32, "MI_V2_PetalRose"), (2900.0, 9600.0, 3600.0, 0.4, "MI_V2_RoofPink"),
            (-900.0, 12600.0, 5600.0, 0.5, "MI_V2_PetalRose"), (3600.0, 15400.0, 6200.0, 0.45, "MI_V2_Lavender"),
            (-4200.0, 11200.0, 4200.0, 0.36, "MI_V2_RoofPink"), (1600.0, 6400.0, 3000.0, 0.26, "MI_V2_Lavender"))
    for k, (x, y, z, s, material) in enumerate(orbs):
        hover("Orb%d" % k, ORB, material, (x, y, z), s, amp=110.0, period=12.0 + 1.5 * k, sway=2.0)
    # A gold clock over the Clock Plaza, dial turned to the arriving visitor.
    hover("PlazaClock", CLOCK, "MI_V2_Gold", (-1150.0, 6100.0, 2400.0), 5.5, rot=(0.0, 90.0, -8.0), amp=50.0, period=11.0, sway=3.0)
    # A flight of teacups by the palace.
    for k, (x, y, z, yaw, roll) in enumerate(((1900.0, 9200.0, 2500.0, 40.0, 18.0), (2300.0, 9600.0, 2900.0, 120.0, -22.0), (1600.0, 9800.0, 3300.0, 200.0, 12.0))):
        hover("Cup%d" % k, CUP, "MI_V2_Ceramic", (x, y, z), 1.3, rot=(0.0, yaw, roll), amp=45.0, period=8.0 + k, sway=8.0)
        hover("Saucer%d" % k, SAUCER, "MI_V2_Ceramic", (x - 40.0, y - 30.0, z - 260.0), 0.7, rot=(0.0, yaw, roll * 0.6), amp=45.0, period=8.0 + k, sway=8.0)
    return {"pass": "SKY01", "title": "Floating gold keys, rose orbs, a plaza clock and flying teacups over the corridor",
            "folder": "Wonderland/Authored/SKY01", "tags": ["V2_Skyline"], "actors": [], "batches": [], "hovers": hovers}


if __name__ == "__main__":
    spec = build()
    out = HERE / "sky01_floating_elements.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("SKY01: %d hover props -> %s" % (len(spec["hovers"]), out.name))
