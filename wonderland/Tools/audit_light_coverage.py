"""Every light fixture standing in Wonderland, against every fixture that actually throws light.

WHY THIS EXISTS. On 2026-09-27, 388 light fixtures on 35 passes were standing in the world -- above ground,
spread from x -45,018 to 48,456 -- and throwing nothing at all. 186 of them were SM_waymarker_lamp: the
world's wayfinding fixtures, built for exactly the founder's "show where traversal continues without the HUD",
and unlit. The Golden Arrival, where every player begins, had FOUR practical light definitions within 120 m
against 762 walkable surface instances and 41 unlit fixtures standing on it.

THE SHAPE OF THE BUG IS THE POINT, because it will happen again. place_practical_lights.TAKE is a
HAND-MAINTAINED ALLOWLIST KEYED BY NAME, and the cost of an omission is SILENCE. Nothing failed, nothing
logged, no gate went red, and the fixtures looked perfectly correct in daylight -- they are ordinary meshes
and they render. TAKE held eleven SD01_* tiles and six FD05_* and had simply fallen behind as more tiles were
authored: FillWE, FillEMN, FillEMC, FillSFE, FillSFW, FillSE2, FillEE, FillEL, FillEMS, the whole Cx family,
and GF entirely.

N_SCALE in zc_night_sweep already catches the WRONG MAGNITUDE case -- an emissive authored against a white of
1.0 when the scene's white is near 25,000. This is the NOT LISTED AT ALL case, which no magnitude check can
see, because there is no light to measure the magnitude of.

WHAT IT DOES. Counts fixtures per pass from the layer specs, counts what TAKE will actually turn into lights,
and reports the difference both ways:

  * a pass with fixtures and no TAKE entry  -- fixtures standing dark. This is the failure and it exits 1.
  * a TAKE entry with no fixtures anywhere  -- a stale key, harmless but a sign the list is drifting.
  * a fixture FAMILY with no emitting part  -- that lantern lights nothing even in a listed
                                              pass. A single unlisted PART is normal and is
                                              not reported: one light per lantern, not per part.

Offline, no editor, no PIE. Run it after authoring any pass that contains a lantern, a lamp or a waymarker:

    python Tools/audit_light_coverage.py
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DESIGN = HERE.parent / "WorldDesign"
PLACER = HERE / "place_practical_lights.py"

#: A fixture is a thing whose job is to be a light. Prefix-matched against the mesh leaf, because the world
#: builds one lantern as several co-located parts (stone, gold, glass) and each is its own batch.
FIXTURE_PREFIXES = (
    "WL_Object_LanternStandard",
    "WL_Detail_Lantern_Hanging",
    "WL_Detail_Wall_Lantern",
    "SM_waymarker_lamp",
)

#: z below this is SINK_UU -- a deliberate trim, not a fixture. See the sink memo in the layer tooling.
ALIVE_Z = -1000.0


def take_and_fixtures():
    """The placer's allowlist and its fixture table, read out of the source rather than imported.

    Importing it would execute the placer. This only needs the two literals.
    """
    src = PLACER.read_text(encoding="utf-8")
    take_block = src[src.index("TAKE = {"):src.index("INVENTORY")]
    take = set(re.findall(r'"([A-Za-z0-9_]+)"\s*:\s*\(', take_block))
    fx_block = src[src.index("FIXTURES = {"):src.index("TAKE = {")]
    known = set(re.findall(r'"([A-Za-z0-9_]+)"\s*:\s*\(', fx_block))
    return take, known


def fixtures_by_pass():
    """Every live light fixture in the design tree, grouped by the pass that places it."""
    out, kinds = {}, {}
    for fp in sorted(DESIGN.rglob("*.json")):
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:                                             # noqa: BLE001
            continue
        if not isinstance(d, dict):
            continue
        pid = d.get("pass")
        if not pid:
            continue
        for b in (d.get("batches") or []):
            leaf = str(b.get("mesh") or "").split("/")[-1].split(".")[0]
            if not any(leaf.startswith(f) for f in FIXTURE_PREFIXES):
                continue
            live = [i for i in (b.get("instances") or [])
                    if len(i) >= 3 and float(i[2]) > ALIVE_Z]
            if not live:
                continue
            out[pid] = out.get(pid, 0) + len(live)
            kinds.setdefault(pid, {}).setdefault(leaf, 0)
            kinds[pid][leaf] += len(live)
    return out, kinds


def emitted_by_pass():
    """Lights ACTUALLY IN practical_lights.json, grouped by the pass that produced them.

    THIS IS THE DOWNSTREAM READING AND IT IS THE POINT. An earlier version of this audit compared fixtures
    against TAKE MEMBERSHIP -- which is still an input, and would pass a pass that is correctly listed and
    still emits nothing. A measurement of the input cannot tell you anything about the output: that rule
    cost two separate hunts on 2026-09-27, one where eye halos were perfect on every input and rendered
    black, and one where two layer specs were perfect on every input and would not apply.
    """
    path = DESIGN / "Look" / "practical_lights.json"
    if not path.exists():
        return None
    d = json.loads(path.read_text(encoding="utf-8"))
    rows = d if isinstance(d, list) else (d.get("lights") or [])
    out = {}
    for r in rows:
        label = str(r.get("label") or "")
        pid = label.split(" ")[0] if label else "?"
        out[pid] = out.get(pid, 0) + 1
    return out


def main():
    take, known_kinds = take_and_fixtures()
    per_pass, per_kind = fixtures_by_pass()
    emitted = emitted_by_pass()

    # A pass is dark when it has fixtures and NO EMITTED LIGHTS. Falling back to TAKE membership only if the
    # light file is missing entirely.
    if emitted is None:
        dark = {p: n for p, n in per_pass.items() if p not in take}
        print("NOTE: practical_lights.json is missing; falling back to TAKE membership, which is"
              " an input and therefore a weaker check than the one this tool is for.")
    else:
        dark = {p: n for p, n in per_pass.items() if emitted.get(p, 0) == 0}
        # A TEAMMATE MID-CAPTURE SWAPS A FILTERED COPY IN, and a gate that goes red at that is a gate people
        # learn to ignore. If a LOT of listed passes emit nothing at once, that is a partial file rather than
        # a world full of dark fixtures, and it says so instead of failing.
        listed_dark = [p for p in dark if p in take]
        if len(listed_dark) > 3:
            print("WARNING: %d passes are in TAKE and still emit nothing, and the light file holds"
                  " only %d lights. That is far more likely to be a filtered or partial copy --"
                  " someone mid-capture -- than a real regression. Re-run on the full file."
                  % (len(listed_dark), sum(emitted.values())))
    stale = sorted(t for t in take if t not in per_pass)
    # ONE LIGHT PER LANTERN, NOT PER PART, and that is deliberate. A lantern is built as several co-located
    # batches -- stone, gold, glass -- and FIXTURES lists only one of them so the lantern emits once. The
    # arithmetic of the 388-fixture find confirms it exactly: 186 waymarkers (one part each) plus 202 wall
    # lantern parts emitting as 101 lanterns is 287 lights, which is precisely what was produced.
    #
    # So a part that FIXTURES does not list is NOT an omission, and reporting it as one is crying wolf. Only
    # a fixture FAMILY with no listed part at all is a real gap -- that is a lantern that emits nothing.
    def family(kind):
        for suffix in ("_glass", "_gold", "_stone"):
            if kind.endswith(suffix):
                return kind[: -len(suffix)]
        return kind

    listed_families = {family(k) for k in known_kinds}
    unknown = sorted({family(k) for kinds in per_kind.values() for k in kinds
                      if family(k) not in listed_families})

    lit_passes = len(per_pass) - len(dark)
    print("light fixtures in the world : %d across %d passes" % (sum(per_pass.values()), len(per_pass)))
    if emitted is not None:
        print("lights actually emitted     : %d" % sum(emitted.values()))
    print("passes that throw light     : %d" % lit_passes)
    print("passes standing DARK        : %d" % len(dark))

    if dark:
        print("\nFIXTURES STANDING IN THE WORLD THAT THROW NOTHING")
        print("(these passes place fixtures and produce NO LIGHT in practical_lights.json, however many")
        print(" fixtures it holds -- and nothing anywhere reports it)\n")
        for p, n in sorted(dark.items(), key=lambda kv: -kv[1]):
            kinds = ", ".join("%s x%d" % (k, v) for k, v in sorted(per_kind[p].items(), key=lambda kv: -kv[1]))
            print("   %5d  %-22s %s" % (n, p, kinds))
        print("\n   %d fixtures dark in total." % sum(dark.values()))
        waymarkers = sum(v for p in dark for k, v in per_kind[p].items() if "waymarker" in k.lower())
        if waymarkers:
            print("   %d of them are waymarker lamps -- the world's wayfinding fixtures, unlit." % waymarkers)

    if stale:
        print("\nTAKE keys with no fixture anywhere (harmless, but the list is drifting):")
        print("   " + ", ".join(stale))
    if unknown:
        print("\nFixture kinds FIXTURES does not know -- skipped even inside a listed pass:")
        print("   " + ", ".join(unknown))

    if dark:
        print("\nFAIL: add the passes above to TAKE, each taking its own family's candela and radius rather")
        print("      than a new judgement -- SD01_* is 8.0/700 path, FD05_* is 6.0/500 facade.")
        return 1
    print("\nOK: every light fixture in the world belongs to a pass that throws light.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
