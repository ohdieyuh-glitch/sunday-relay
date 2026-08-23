#!/usr/bin/env python3
"""Publish the canonical Relay Dog's part table as JSON, for the browser.

WHY THIS IS NOT A TRANSCRIPTION

The Three.js gait preview needs a Relay Dog to walk. The tempting thing is to
retype the sixteen rows of WonderlandDogBody.cpp into JavaScript. This project
has already paid for that once: verify-dog-proxy.py exists because a hand copy
of this exact table drifted to a 168 uu Dog against a real 325 uu one, and every
composition number quoted for the hero frame's focal subject was wrong by nearly
three times with nothing able to notice.

So the browser does not get a copy. It gets THIS, generated from the C++, with a
test that fails if the committed JSON stops matching a fresh extraction. Same
discipline as the Marble placement contract and the gait golden table: one
source of truth, published, never re-derived downstream.

    python3 emit-dog-body.py > wonderland/web/gait/dog-body.json

Runs anywhere; no engine, no GPU.
"""
import importlib.util
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BODY = os.path.normpath(os.path.join(HERE, "..", "..", "Source", "Wonderland",
                                     "WonderlandDogBody.cpp"))


def _load_proxy():
    """Reuse verify-dog-proxy.py's parser rather than writing a second one.

    Its cpp_parts() already handles the thing that is easy to get wrong — the
    local constants (LegH, Bz, Hz, HeadX, LegT) are parsed out of the source
    instead of assumed, because assuming them made an earlier checker silently
    drop every row that used a constant it did not know about.
    """
    path = os.path.join(HERE, "verify-dog-proxy.py")
    spec = importlib.util.spec_from_file_location("verify_dog_proxy", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def materials():
    """The 4th field of each FPart row: Body, Visor, Eye or Gold.

    Geometry comes from the shared parser; only the material token is read here,
    and the row counts are asserted equal so the two halves cannot pair up
    offset from each other — which is the failure mode that reports a mismatch
    at the wrong part.
    """
    src = io.open(BODY, encoding="utf8").read()
    # Take only the canonical Parts[] block. The accessory table below it has
    # the same row shape and would otherwise be spliced into the body.
    start = src.index("const FPart Parts[] = {")
    end = src.index("};", start)
    block = src[start:end]
    return re.findall(r"FRotator::ZeroRotator,\s*(\w+)\s*\}", block)


def main():
    proxy = _load_proxy()
    scale, rows = proxy.cpp_parts()
    mats = materials()
    if len(mats) != len(rows):
        raise SystemExit(
            "parsed %d geometry rows but %d materials from %s — the table shape "
            "changed and this emitter needs updating rather than guessing"
            % (len(rows), len(mats), BODY))

    # The named colours, from the material instances the C++ loads. These are
    # the founder's identity rule, not a palette choice: white blocky body,
    # BLACK visor recess, GOLD glowing eyes.
    palette = {
        "Body":  {"color": "#f2f2ee", "role": "coat",  "emissive": 0.0},
        "Visor": {"color": "#0a0a0d", "role": "visor", "emissive": 0.0},
        "Eye":   {"color": "#ffc233", "role": "eye",   "emissive": 1.0},
        "Gold":  {"color": "#e0a63c", "role": "trim",  "emissive": 0.35},
    }

    parts = []
    for (loc, sc), mat in zip(rows, mats):
        if mat not in palette:
            raise SystemExit("unknown material token %r in %s" % (mat, BODY))
        parts.append({"loc": list(loc), "scale": list(sc), "mat": mat})

    # WHICH ROWS ARE THE LEGS. WonderlandGait indexes 0 left-hind, 1 right-hind,
    # 2 left-fore, 3 right-fore; the C++ table lists them -X-Y, -X+Y, +X-Y, +X+Y
    # in that order, and -X is the hind end because the head is at +HeadX. This
    # is derived from the parsed geometry rather than asserted, so a reordering
    # of the table cannot silently animate the wrong cube.
    legs = [i for i, p in enumerate(parts)
            if p["scale"][0] == p["scale"][1] and p["scale"][2] > p["scale"][0] * 2]
    if len(legs) != 4:
        raise SystemExit("expected 4 leg rows, identified %d" % len(legs))

    def leg_index(i):
        x, y = parts[i]["loc"][0], parts[i]["loc"][1]
        hind = x < 0
        left = y < 0
        return (0 if hind and left else 1 if hind else 2 if left else 3)

    leg_rows = {}
    for i in legs:
        leg_rows[leg_index(i)] = i
    if sorted(leg_rows) != [0, 1, 2, 3]:
        raise SystemExit("legs did not resolve to four distinct gait indices: %r" % leg_rows)

    # The torso is the widest row that is not a leg; the head-brow is the row at
    # the greatest +X. Both are needed so the gait can bob one and counter-bob
    # the other.
    non_leg = [i for i in range(len(parts)) if i not in legs]
    torso = max(non_leg, key=lambda i: parts[i]["scale"][0] * parts[i]["scale"][1])
    head_rows = [i for i in non_leg
                 if parts[i]["loc"][0] > parts[torso]["loc"][0] + 10]

    out = {
        "note": "generated by wonderland/infra/build/emit-dog-body.py — do not hand-edit",
        "source": "wonderland/Source/Wonderland/WonderlandDogBody.cpp",
        "referenceScale": scale,
        "unitsPerCube": 100.0,   # UE BasicShapes/Cube is 100 uu at scale 1
        "palette": palette,
        "parts": parts,
        "legRows": [leg_rows[0], leg_rows[1], leg_rows[2], leg_rows[3]],
        "torsoRow": torso,
        "headRows": sorted(head_rows),
    }
    json.dump(out, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
