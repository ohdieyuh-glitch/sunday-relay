#!/usr/bin/env python3
"""XM02 -- warm windows: the first thing on the founder's Christmas list, and the cheapest.

FOUNDER DIRECTIVE 2026-09-23, in order: "warm window lighting, subtle string lights, wreaths, garlands...".
Warm window lighting is named FIRST, and XM01 did not deliver it -- that pass ended up as street lanterns
after three captures proved I was reading mesh shapes out of bounding boxes. This is the one that does.

WHY IT COSTS ALMOST NOTHING. The second band already carries 504 arched windows and 264 wall lanterns across
its three detail passes, each one already placed on a real wall face by nation_detail, already seated, already
audited. Lighting a window does not need a new window -- it needs the same glass in a warmer material. So this
pass reads the three detail specs and re-places a SUBSET of their glass at the same transforms in
MI_V2_PaneAmber, inset to 0.97 scale so it sits just inside the existing pane instead of z-fighting with it.
No new geometry, no new art, nothing moved.

WHY A SUBSET, AND WHY A DETERMINISTIC ONE. A street where every window is lit reads as an office block, not a
winter evening -- and the founder's warning in the same breath was "avoid tacky repetition". About a third are
lit, chosen by hashing each window's own position, so the pattern is stable across regenerations (a window
does not flicker between builds), unrepeating, and not obviously periodic.

WARM AGAINST COOL is the whole effect. Wonderland's daylight is a 5,200 K sun under a sky whose Rayleigh
scattering LOOK07 just deepened; amber against that reads as inhabited. The nations keep their own glass --
Icarus pearl-white, Noctis obsidian, Tartarus crimson -- and only the lit third turns amber, so the identity
each nation was given is not painted over.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
NATIONS = HERE.parent / "Nations"
PASS = "XM02"

AMBER_PANE = "MI_V2_PaneAmber"
AMBER_GLASS = "MI_V2_GlassAmber"
#: OFFSET OUTWARD, NOT INSET. The first version scaled the amber pane to 0.97 "just inside the existing
#: pane". A smaller pane sharing a centre is INSIDE the bigger one, so the original glass sat in front of it
#: and hid it completely -- the close capture showed pale windows and a pale wall lantern, no amber anywhere.
#: Instead the amber pane keeps its size and steps a few cm along the window's own facing, so it sits just
#: proud of the glass where it can actually be seen.
PROUD_CM = 5.0
LIT_SHARE = 0.34
CULL = 45000.0

SOURCES = [
    ("ic04_band_detail.json", "IC04_Detail_Window_Arched_glass", "IC04_Detail_Wall_Lantern_glass"),
    ("nc04_band_detail.json", "NC04_Detail_Window_Arched_glass", "NC04_Detail_Wall_Lantern_glass"),
    ("tq04_band_detail.json", "TQ04_Detail_Window_Arched_glass", "TQ04_Detail_Wall_Lantern_glass"),
]


def lit(x, y, z):
    """Stable per-window choice from its own position: the same window is lit in every build.

    THE FIRST VERSION WAS A WEIGHTED SUM, WHICH IS NOT A HASH. `abs(x)*7.31 + abs(y)*3.17 + abs(z)*11.7`
    is linear in position, so a row of windows along a wall -- which is exactly how windows come -- maps to a
    narrow, ordered band of outputs. Measured: ICARUS lit 8 of 168 windows (4.8%) while its wall lanterns lit
    56 of 88 (64%), against one 34% setting. Aligned inputs need avalanche, not arithmetic. This mixes the
    quantised coordinates through xor-shifts so neighbouring windows land far apart in the output.
    """
    h = (int(x) & 0xFFFF) * 73856093 ^ (int(y) & 0xFFFF) * 19349663 ^ (int(z) & 0xFFFF) * 83492791
    h &= 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 0x5bd1e995) & 0xFFFFFFFF
    h ^= h >> 15
    return (h % 10000) / 10000.0 < LIT_SHARE


def main():
    batches = {}
    report = []

    def add(key, mesh, material, inst):
        b = batches.setdefault(key, {"id": "%s_%s" % (PASS, key), "mesh": mesh, "material": material,
                                     "instances": [], "collides": False, "cast_shadow": False,
                                     "affect_df": False, "cull_distance": CULL})
        b["instances"].append(inst)

    for spec_name, window_id, lantern_id in SOURCES:
        spec = json.loads((NATIONS / spec_name).read_text(encoding="utf-8"))
        by_id = {b["id"]: b for b in spec["batches"]}
        nation = window_id.split("_")[0]
        for src_id, key, material in ((window_id, "Window_%s" % nation, AMBER_PANE),
                                      (lantern_id, "Lantern_%s" % nation, AMBER_GLASS)):
            src = by_id.get(src_id)
            if src is None:
                continue
            n = 0
            for i in src["instances"]:
                if not lit(i[0], i[1], i[2]):
                    continue
                a = math.radians(i[4])
                add(key, src["mesh"], material,
                    [round(i[0] + math.cos(a) * PROUD_CM, 1), round(i[1] + math.sin(a) * PROUD_CM, 1),
                     i[2], i[3], i[4], i[5], i[6], i[7], i[8]])
                n += 1
            report.append((src_id, len(src["instances"]), n))

    inst = sum(len(b["instances"]) for b in batches.values())
    spec = {"pass": PASS,
            "title": "XM02: warm windows -- a third of the second band's glass lit amber for the season",
            "tags": ["XM02", "WL_CHRISTMAS", "WL_SEASONAL"],
            "folder": "Wonderland/Authored/XM02_WarmWindows",
            "actors": [], "batches": list(batches.values())}
    (HERE / "xm02_christmas_windows.json").write_text(json.dumps(spec, indent=1), encoding="utf-8")
    print("%s -> xm02_christmas_windows.json" % PASS)
    print("  batches %d, instances %d  (lit share %.0f%%, proud %.0f cm)" % (len(batches), inst, LIT_SHARE * 100, PROUD_CM))
    for src_id, total, n in report:
        print("    %-42s %4d of %4d lit" % (src_id, n, total))
    return spec


if __name__ == "__main__":
    main()
