"""NQ06 / IQ06 -- NOCTIS and ICARUS after dark, on the rules TQ05 already established.

THE FOUNDER'S NIGHT CORRECTION, SECTION B, FOR THE TWO NATIONS THIS LANE OWNS. Tartarus was done first by the
other lane under written rules; this reuses that generator's placement logic ITSELF rather than restating it,
because two implementations of one rule is two rules waiting to disagree. STRAIGHT, AT_DECISION,
DECISION_REACH, TURN_DEGREES, TURN_BASE, LATERAL and KEEP_CLEAR all come from tq05_tartarus_lamps, and so does
avenue_lamps() -- which was already nation-agnostic, taking points and a list of lamps to avoid.

WHY THESE TWO AND IN THIS ORDER, measured rather than assumed. Projecting every lantern in the world onto each
nation's route and taking the gaps between consecutive lamps:

    TARTARUS   37 lamps on the path   worst gap  25 m   no shelf transition unlit   (after TQ05)
    ICARUS     16 lamps on the path   worst gap  65 m   transition at 228 m unlit
    NOCTIS     17 lamps on the path   worst gap 114 m   ALL FOUR transitions unlit

Noctis is the worst stretch of road in Wonderland: 114 m with no lamp on it, and every shelf transition -- every
step a walker actually has to see -- falls in a gap of 25 m or more. That is the founder's "paths disappearing"
and "traversal visually uncomfortable" with a number against it.

A NOTE ON HOW THAT NUMBER WAS NEARLY WRONG, because it matters for anyone re-running this. My first pass asked
"is there a lamp within 25 m of this route point", which marks every point near a single lamp as lit and
collapsed all three nations to a worst gap of 8 m -- it reported Noctis as fully lit. The other lane's
contradicting count is what caught it. A lamp 25 m away is not lighting a path; the honest measure is the
distance between consecutive lamps PROJECTED ONTO the route, inside a corridor tight enough that a lamp
lighting a wall forty metres off the road does not count as lighting the road.

CANON IS NOT EXTENDED. ICARUS is video game development, white; NOCTIS is content creation, black. That is all
WorldDesign/CANON states and nothing here invents more. Fixtures are the kit's existing lantern standard in
each nation's own materials, so the light thrown is the colour that nation's glass already is, and no new
fixture family is authored. Nothing is spawned per-fixture: these are entries for the existing
UWonderlandPracticalLightsSubsystem pool, which already holds 970 definitions against a live pool of 48.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tq05_tartarus_lamps as TQ                                      # noqa: E402  the rules, not a copy

HERE = Path(__file__).resolve().parent

#: Each nation's own materials, so a lamp throws the colour its own glass already is. Read off the nation
#: material sets that exist; nothing invented. If a nation has no ember/metal/stone trio the build says so
#: rather than substituting Tartarus's.
NATIONS = {
    # A LANTERN IS THREE CO-LOCATED PARTS, not one mesh: TQ.STANDARD carries stone, gold and glass, and the
    # world's existing lanterns are three instances at the same point. Each nation gets its own three.
    #
    # EVERY NAME HERE WAS CHECKED AGAINST Content/WonderlandV2/Materials/Instances BEFORE USE, not recalled.
    # My first draft invented MI_V2_NoctisGlow, MI_V2_IcarusGlow, *Metal and *Stone -- six names, none of
    # which exists. What the nations actually own: Noctis Obsidian, Charcoal, Glass, Silver, Luminous;
    # Icarus Silver, Pearl, Glass, Ashlar; Tartarus Metal, Black, Ember, Crimson, Roof.
    "NOCTIS": {
        "pass": "NQ06",
        "out": "nq06_noctis_lamps.json",
        "parts": {"stone": "MI_V2_NoctisObsidian",
                  "gold": "MI_V2_NoctisSilver",
                  "glass": "MI_V2_NoctisLuminous"},
        "why_glass": ("Noctis's own luminous instance, the direct analogue of the Ember glass TQ05 put in "
                      "Tartarus's lanterns. The practical subsystem colours each light from its own glass, "
                      "so the nation throws its own light rather than a borrowed one."),
    },
    "ICARUS": {
        "pass": "IQ06",
        "out": "iq06_icarus_lamps.json",
        "parts": {"stone": "MI_V2_IcarusAshlar",
                  "gold": "MI_V2_IcarusSilver",
                  "glass": "MI_V2_IcarusGlass"},
        "why_glass": ("Icarus owns no luminous instance, so its glass is used. A brighter Icarus lantern "
                      "would be a NEW material, which is a founder and visual call rather than something to "
                      "invent inside a placement pass."),
    },
}


def every_lantern_in_the_world():
    """Every lantern standard anywhere in WorldDesign, so this pass never doubles one up.

    TQ.existing_lamps() is hardcoded to Tartarus's own five spec files, which is right for TQ05 and silently
    wrong for anyone else: called for Noctis it returns NOTHING, so the "before" count reads 0 where the
    route actually has 17, and -- the part that would have done damage -- KEEP_CLEAR protects nothing and new
    lamps land on top of the ones already there. Scan the whole design tree instead.
    """
    # SKIP ITS OWN OUTPUT OR THE GENERATOR EATS ITSELF. Run once, nq06 and iq06 are on disk; run again and the
    # scan finds the lamps it just wrote, KEEP_CLEAR refuses every position, and it places nothing while
    # reporting the route as already lit. territory_checkpoints.py hit this exact bug earlier today and the
    # fix is the same: a generator must never count its own family as existing world.
    mine = {cfg["out"] for cfg in NATIONS.values()}
    out = []
    for fp in sorted(Path(HERE.parent).rglob("*.json")):
        if fp.name in mine:
            continue
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:                                             # noqa: BLE001
            continue
        if not isinstance(d, dict):
            continue
        for b in (d.get("batches") or []):
            leaf = str(b.get("mesh") or "").split("/")[-1].split(".")[0]
            if not leaf.startswith("WL_Object_LanternStandard"):
                continue
            for i in (b.get("instances") or []):
                # SINK_UU: z at -100000 is a deliberate trim, not a lamp.
                if len(i) >= 3 and float(i[2]) > -1000.0:
                    out.append((float(i[0]), float(i[1])))
    # the three material parts of one lantern sit at one point; collapse them
    uniq = []
    for x, y in out:
        if all(abs(x - ux) > 1.0 or abs(y - uy) > 1.0 for ux, uy in uniq):
            uniq.append((x, y))
    return uniq


def route_for(nation):
    d = json.loads((HERE / "nation_routes.json").read_text(encoding="utf-8"))
    return d[nation]["points"]


def gaps_on(pts, lamps, corridor=1500.0):
    """Distance between consecutive lamps PROJECTED onto the route -- the measure that is not a lie.

    A radius test around each route point reports a path as lit when one lamp happens to sit near a run of
    closely-spaced samples. This asks where each lamp falls ALONG the route and how far apart those are.
    """
    cum = [0.0]
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + math.hypot(pts[i + 1]["x"] - pts[i]["x"], pts[i + 1]["y"] - pts[i]["y"]))
    on = []
    for lx, ly in lamps:
        j = min(range(len(pts)), key=lambda i: math.hypot(lx - pts[i]["x"], ly - pts[i]["y"]))
        if math.hypot(lx - pts[j]["x"], ly - pts[j]["y"]) <= corridor:
            on.append(cum[j])
    on = sorted(set(round(v) for v in on))
    worst, prev = 0.0, 0.0
    for m in on + [cum[-1]]:
        worst = max(worst, m - prev)
        prev = m
    return len(on), worst / 100.0, cum[-1] / 100.0


def main():
    existing = every_lantern_in_the_world()
    print("existing lantern standards world-wide: %d" % len(existing))
    report = {}
    for nation, cfg in NATIONS.items():
        pts = route_for(nation)
        before_n, before_gap, route_m = gaps_on(pts, existing)

        taken = list(existing)
        placed, decisions = TQ.avenue_lamps(pts, taken)

        after_n, after_gap, _ = gaps_on(pts, existing + [(p[0], p[1]) for p in placed])
        trans = [round(i) for i in range(1, len(pts))
                 if round(pts[i]["floor"]) != round(pts[i - 1]["floor"])]

        spec = {
            "pass": cfg["pass"],
            "tags": ["WL_AUTHORED", "WL_PASS_%s" % cfg["pass"], "WL_NATION_%s" % nation, "WL_NATION_LAMPS"],
            "folder": "Wonderland/Nations/%s/Lamps" % nation.title(),
            "route_source": "nation_routes.json %s, %d points, %.0f m" % (nation, len(pts), route_m),
            "note": ("the founder's night correction, section B, for %s: %d lantern standards along the route, "
                     "alternating sides, %.0f m apart on a straight and %.0f m within %.0f m of a decision. "
                     "Decisions are read off the route -- its %d shelf transitions plus its real bends -- not "
                     "chosen. Worst lamp-to-lamp gap on the path goes %.0f m -> %.0f m."
                     % (nation, len(placed), TQ.STRAIGHT / 100, TQ.AT_DECISION / 100,
                        TQ.DECISION_REACH / 100, len(trans), before_gap, after_gap)),
            "materials": cfg["parts"],
            "why_glass": cfg["why_glass"],
            # ONE BATCH PER PART, at the same points, exactly as the world's existing lanterns are built --
            # and each with the id and collision flags apply_layer requires. A batch without `id` raises
            # KeyError there and applies NOTHING, and it also crashes validate_layer_spec's nested_collision
            # for every spec in the tree, so one malformed file takes the offline gate down with it. Both my
            # specs shipped in that state.
            #
            # ONLY THE STONE POST COLLIDES. A walker should be stopped by a lamp post and not by its glass or
            # its gold, which is how AV03's own sixteen lanterns are built.
            "batches": [TQ.batch("%s_Object_LanternStandard_%s" % (cfg["pass"], part),
                                 TQ.STANDARD[part][0], mat, placed, part == "stone")
                        for part, mat in cfg["parts"].items()],
        }
        (HERE / cfg["out"]).write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
        report[nation] = {"placed": len(placed), "decisions": len(decisions),
                          "lamps_on_path": [before_n, after_n],
                          "worst_gap_m": [round(before_gap), round(after_gap)],
                          "route_m": round(route_m), "shelf_transitions": len(trans),
                          "out": cfg["out"]}

    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
