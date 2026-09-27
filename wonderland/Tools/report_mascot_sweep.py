"""Assemble the MASCOT sweep artefact the founder asked for, out of the four run results.

WHY THIS EXISTS AS ITS OWN ARTEFACT. The founder was explicit: "Create a mascot-specific sweep artifact;
don't let the Companion's sweep stand in as mascot evidence." zc_glow_sweep's 220 was measured on the
Companion, and the mascots are different geometry, different materials and a different authored scale. This
reads only zzM1-zzM4 -- mascot runs, mascot skins -- and reports the ten quantities the handoff listed, per
skin, at DAY / DUSK / NIGHT.

WHAT IT REFUSES TO DO. It does not fill a gap with a plausible number. A run that aborted is reported as
aborted with the place it died; a skin whose eye could not be located is reported UNRESOLVED rather than 0.0;
a metric the sweep does not actually measure is listed as not measured instead of being approximated from one
that sounds similar. The whole reason this cluster took a day is that four separate readings were believed
that no instrument had actually taken, so the report's job is to make the difference visible at a glance.

Run it after the four results land:  python Tools/report_mascot_sweep.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DONE = os.path.join(HERE, "_channel", "done")
RUNS = (("zzM1_eye_day", "DAY"), ("zzM2_eye_dusk", "DUSK"), ("zzM3_eye_night", "NIGHT"), ("zzM4_knee", "KNEE"))

#: The five the founder named, first and in their order. The V1 twins follow, and they are a control rather
#: than a sixth and seventh subject: a V1 and its V2 share an eye, verified identical across the eight .wlvox,
#: so any eye difference between the pair is the BODY around the eye changing what the eye reads against.
FOUNDER_SKINS = ("relay_og", "celestial_light", "apollo", "arden_infernal", "skeleton_flame")
TWINS = ("apollo_v1", "arden_infernal_v1", "skeleton_flame_v1")

#: The handoff's own list, in the handoff's own order, each paired with the row key that carries it -- or None
#: where this sweep does not measure it, which the report then says out loud rather than substituting.
WANTED = (
    ("face luminance",              "face_luma"),
    ("eye luminance",               "eye_luma"),
    ("eye-vs-face contrast",        "over_face"),
    ("clipped pixel %",             "clipped"),
    ("crushed-black %",             "crushed"),
    ("eye colour separation",       "colour_separation"),
    ("eye hue retention",           "hue_retention"),
    ("emissive level (EyeGlow)",    "level"),
    ("eye bright fraction",         "eye_bright"),
    ("eye whiteness",               "eye_white"),
)


def load(name):
    path = os.path.join(DONE, name + ".json")
    if not os.path.isfile(path):
        return None, "no result file -- this run has not landed"
    try:
        with open(path, "r", encoding="utf-8") as fh:
            d = json.load(fh)
    except Exception as err:                                          # noqa: BLE001
        return None, "unreadable: %s" % str(err)[:120]
    if d.get("died_at"):
        return d, "ABORTED at %s -- the table below is incomplete BY DESIGN, not by accident" % d["died_at"]
    if d.get("status") not in ("measured", "captured"):
        return d, "status %r -- not a completed measurement" % d.get("status")
    return d, None


def fmt(v, blank="  --  "):
    if v is None:
        return blank
    if isinstance(v, float):
        return "%6.4f" % v
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join("%.3f" % float(x) for x in v) + "]"
    return str(v)


def shipped_row(rows, skin):
    """The row taken with EyeGlowDay/Night left at their shipped values and the day cycle interpolating.

    This is the row that answers what the founder actually sees, as opposed to any swept rung: the sweep pins
    both cvars equal at every level to isolate level from hour, which is correct for measuring a response and
    is NOT the shipped configuration, because the shipped configuration is a RATIO.
    """
    for r in rows:
        if r.get("skin") == skin and r.get("shipped"):
            return r
    return None


def main():
    out = []
    w = out.append
    w("# MASCOT GLOW SWEEP -- measured on the mascots, not inherited from the Companion")
    w("")
    w("The Companion's sweep selected a knee of 220 at a clipped fraction of 1.79%. That was measured on the")
    w("Companion. This is the mascot evidence, taken on the mascot skins with the mascot materials, and")
    w("nothing in it is copied from that run -- including the 220.")
    w("")

    loaded, notes = {}, {}
    for name, label in RUNS:
        d, problem = load(name)
        loaded[label] = d
        notes[label] = problem

    # ---------------------------------------------------------------- run health first, always
    w("## Did the runs actually run")
    w("")
    w("Every number below is worth exactly as much as this section. A sweep that measured a torn-down PIE")
    w("published nine gates of the luma of a black viewport earlier today, two of them PASSING, so this")
    w("comes before the data and not after it.")
    w("")
    w("| run | hour | status | died_at | gates green | note |")
    w("|---|---|---|---|---|---|")
    for name, label in RUNS:
        d = loaded[label]
        if d is None:
            w("| %s | %s | **missing** | -- | -- | %s |" % (name, label, notes[label]))
            continue
        t = d.get("tests") or []
        w("| %s | %s | %s | %s | %d/%d | %s |"
          % (name, label, d.get("status"), d.get("died_at") or "none",
             sum(1 for x in t if x.get("pass")), len(t), notes[label] or ""))
    w("")

    live = {k: v for k, v in loaded.items() if v is not None and not v.get("died_at")}
    if not live:
        w("**No completed run. There is nothing to report and nothing is inferred.**")
        print("\n".join(out))
        return 1

    # ---------------------------------------------------------------- was the eye even found
    w("## Was the eye found, and did it respond")
    w("")
    w("A patch that is not on the eye measures a cheek, and a peak that does not beat its own noise floor is")
    w("the largest of 49 noisy cells rather than a response. Both are reported per skin because both were")
    w("silently wrong in earlier runs of this job.")
    w("")
    w("| skin | anchor found by | peak delta | noise floor | beats noise |")
    w("|---|---|---|---|---|")
    ref = live.get("DAY") or list(live.values())[0]
    how = ref.get("anchor_how") or {}
    az = ref.get("anchor_z") or {}
    pk = ref.get("peak_delta_per_skin") or {}
    nf = ref.get("noise_floor_per_skin") or {}
    bn = ref.get("beats_noise") or {}
    for skin in FOUNDER_SKINS + TWINS:
        w("| %s | %s (z=%s) | %s | %s | %s |"
          % (skin, how.get(skin, "not reported"), fmt(az.get(skin)), fmt(pk.get(skin)),
             fmt(nf.get(skin)), "yes" if bn.get(skin) else "**NO -- unresolved, not absent**"))
    w("")

    # ---------------------------------------------------------------- the founder's ten, at the shipped pair
    w("## The shipped configuration, per skin, per hour")
    w("")
    sd = (ref.get("summary") or {}).get("shipped_day")
    sn = (ref.get("summary") or {}).get("shipped_night")
    if sd is None:
        # older runs carried it only on the rows, not in the summary
        for r in (ref.get("eye_axis") or []):
            if r.get("shipped_day") is not None:
                sd, sn = r.get("shipped_day"), r.get("shipped_night")
                break
    w("Taken with EyeGlowDay and EyeGlowNight left at the values the build ships (%s by day, %s at night) and"
      % (fmt(sd), fmt(sn)))
    w("the day cycle allowed to interpolate between them. This is the row that answers what the founder sees.")
    w("The swept rungs isolate the level from the hour by pinning both cvars equal, which is the right way to")
    w("measure a response and is NOT the shipped state.")
    w("")
    w("Two readings need their units stated or they will be misread:")
    w("")
    w("* **clipped %** is the fraction of the head shot above **luma 0.72** -- about 183/255, NOT 250. It")
    w("  cannot tell a saturated eye core from a blown white one on its own.")
    w("* **eye whiteness** is what separates those: 0.0 is fully saturated colour, 1.0 is neutral white. A")
    w("  high bright fraction with LOW whiteness is the bright coloured core the handoff asked for; a high")
    w("  bright fraction with whiteness near 1.0 is the white clipping it forbade.")
    w("")
    for label in ("DAY", "DUSK", "NIGHT"):
        d = live.get(label)
        w("### %s" % label)
        w("")
        if d is None:
            w("_%s did not complete: %s_" % (label, notes[label] or "missing"))
            w("")
            continue
        rows = d.get("eye_axis") or []
        w("| skin | " + " | ".join(n for n, _ in WANTED) + " |")
        w("|---" * (len(WANTED) + 1) + "|")
        for skin in FOUNDER_SKINS + TWINS:
            r = shipped_row(rows, skin)
            mark = "**%s**" % skin if skin in FOUNDER_SKINS else "%s _(twin)_" % skin
            if r is None:
                w("| %s | " % mark + " | ".join("no row" for _ in WANTED) + " |")
                continue
            cells = []
            for _, k in WANTED:
                if k == "level" and r.get("shipped"):
                    cells.append("%s/%s day/night" % (fmt(r.get("shipped_day")).strip(),
                                                      fmt(r.get("shipped_night")).strip()))
                elif k == "hue_retention" and r.get("hue_retention") is None:
                    # None here is not missing data: the sweep only computes retention when the eye actually
                    # ADDED light. No added light is the loudest reading in the table.
                    cells.append("**no light added**")
                else:
                    cells.append(fmt(r.get(k)))
            w("| %s | " % mark + " | ".join(cells) + " |")
        w("")

    # ---------------------------------------------------------------- the knee, on its own axis
    w("## The knee")
    w("")
    kd = live.get("KNEE")
    if kd is None:
        w("_The knee run did not complete: %s_" % (notes.get("KNEE") or "missing"))
    else:
        s = kd.get("summary") or {}
        w("Knees swept: %s, with the shipped 700 as the control." % fmt(s.get("knees_swept")))
        w("")
        w("* frame luma spread across all knees: **%s**" % fmt(s.get("knee_spread")))
        w("* highest knee that changes the picture at all: **%s**" % fmt(s.get("knee_engages_at")))
        w("")
        w("WonderlandTameGlow compresses only ABOVE the knee. After the GLOW_SCALE 4000 -> 6 re-baseline the")
        w("brightest body glow on any skin is 13.2, so a knee anywhere near the Companion's 220 -- or the")
        w("shipped 700 -- sits above every mascot value and compresses nothing. That is the specific reason")
        w("220 could not simply be carried across, and it is the answer to the handoff's first question.")
    w("")

    # ---------------------------------------------------------------- the two the founder singled out
    w("## Celestial Light, and Skeleton Flame")
    w("")
    w("### Celestial Light")
    w("")
    w("The handoff flagged a NEGATIVE eye-vs-face contrast on unclipped samples and said, correctly, that if")
    w("its eye emission is not reaching the rendered eye then a knee will not fix it. The discriminator is the")
    w("isolation column: eye gain minus face gain as the level rises. If isolation stays near zero while the")
    w("level climbs, the level is not arriving at the rendered eye and no knee, curve or halo count will")
    w("change that.")
    w("")
    w("| hour | over_face | isolation | hue retention | eye whiteness |")
    w("|---|---|---|---|---|")
    for label in ("DAY", "DUSK", "NIGHT"):
        d = live.get(label)
        r = shipped_row((d.get("eye_axis") or []) if d else [], "celestial_light")
        if r is None:
            w("| %s | no row | no row | no row | no row |" % label)
            continue
        w("| %s | %s | %s | %s | %s |" % (label, fmt(r.get("over_face")), fmt(r.get("isolation")),
                                          fmt(r.get("hue_retention")), fmt(r.get("eye_white"))))
    w("")
    w("### Skeleton Flame")
    w("")
    w("The ask is to dim the flames while keeping the ghostfire identity: spectral colour, flame motion,")
    w("glowing eyes, chest skull, skull-eye glow, the side and back spectral element, and the LOW -> MID ->")
    w("HIGH pulse. THIS SWEEP DOES NOT MEASURE ANY OF THOSE except the eyes. FlameDim is restored, not swept,")
    w("and nothing here reads flame motion, the pulse, or the chest skull. Treat the flame requirement as")
    w("UNMEASURED rather than as passing quietly on the strength of an eye reading taken on the same skin.")
    w("")

    # ---------------------------------------------------------------- what is still not evidence
    w("## What this artefact does not establish")
    w("")
    w("* **Nothing about the Companion.** 220 is not tested here and is not endorsed or contradicted.")
    w("* **The flame requirements above**, which no gate in this job reads.")
    w("* **Bloom as such.** Bloom intensity and threshold are read from the post-process volume and reported,")
    w("  but bloom is not swept, so \"controlled bloom\" is described rather than demonstrated.")
    w("* **Anything on a skin whose row reads UNRESOLVED.** An unlocated eye is an unknown, not a zero, and")
    w("  averaging it in as a zero is how a dark reading becomes a confident wrong conclusion.")
    w("")
    for label in ("DAY", "DUSK", "NIGHT", "KNEE"):
        d = live.get(label)
        if d and d.get("camera_failures"):
            w("* %s reported %d camera failure(s): %s"
              % (label, len(d["camera_failures"]), "; ".join(d["camera_failures"][:3])))
    w("")

    text = "\n".join(out)
    dest = os.path.join(HERE, "captures", "zc", "mascot_knee", "MASCOT_SWEEP.md")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text + "\n")
    print(text)
    print("\n\nwritten: %s" % dest, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
