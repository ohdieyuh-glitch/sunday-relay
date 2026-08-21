#!/usr/bin/env python3
"""Measure the FOUNDER'S reference image with the same classifier we measure our own frame with.

    python3 measure-reference.py                             # the canonical reference
    python3 measure-reference.py --json=/tmp/ref.json
    python3 measure-reference.py --compare /tmp/hero.json    # reference vs our frame

WHY THIS EXISTS

wonderland/WorldDesign/visual-target.json set every palette band from the
founder's WRITTEN DESCRIPTION, and said so plainly: "NOT from the image itself —
the image is not in this repository." The image is in this repository now, at
wonderland/marble/reference/. So the targets can stop being a proposal.

WHAT IT IS AND IS NOT

It is a palette measurement and nothing else. The composition verifier also
reports coverage, depth bands and lone-primitive share — those are properties of
GEOMETRY, and a photograph has none, so they are deliberately absent here rather
than approximated. Inventing a "depth band" for an image would produce a number
that looks comparable and is not.

It is still not a similarity score. Two frames can share a palette and look
nothing alike. The founder remains the authority; this only removes the excuse
that nobody knew what the reference actually contains.

AND IT MUST NOT BE COMPARED AGAINST THE OFFLINE PREVIEW. That was the first
thing I tried and the numbers are meaningless, which the measurement itself
shows: the reference comes back 25.7% DARK and 0.0% GREEN, on an image visibly
full of green topiary and hedges. Nothing is broken — the reference is a LIT
render, its foliage sits in shadow at values the classifier correctly calls
dark, and its global average is a muted mauve. The offline preview has no
lighting at all: every surface is drawn at full material albedo, so it has
almost no dark pixels and its greens are bright. Two pictures of the same world
made that differently cannot have comparable palettes, and a delta table
between them would send someone to de-green a world whose green is fine.

So --compare refuses a preview facts file by name. Compare this against a real
streamed frame, and against nothing else.
"""
import argparse
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import palette as palette_mod                                    # noqa: E402

DEFAULT_REFERENCE = os.path.normpath(os.path.join(
    HERE, "..", "..", "marble", "reference", "wonderland-reference.jpg"))


# A facts file from verify-hero-composition.py carries fields only a GEOMETRY
# projection can have. Detecting it by those, rather than by filename, means
# renaming the file cannot get past this.
UNLIT_PREVIEW_FIELDS = ("actors_drawn", "actors_placed", "lone_primitive_pct")

UNLIT_REFUSAL = """REFUSED: %s is the OFFLINE PREVIEW, and its palette cannot be
compared with a lit image.

  reference   dark %5.2f%%   green_foliage %5.2f%%
  preview     dark %5.2f%%   green_foliage %5.2f%%

Neither is wrong. The reference is a lit render: its foliage is in shadow, at
values this classifier correctly calls dark. The preview has no lighting at all
— every surface is drawn at full material albedo — so it has almost no dark
pixels and its greens are bright. A delta table between them would read as "the
world has 25 points too much green" and send someone to de-green a world whose
green is fine.

Compare this against a REAL STREAMED FRAME. Until one exists, the reference
measurement stands on its own and the preview's palette is judged against
WorldDesign/visual-target.json, whose bands are for an unlit projection.
Nothing was compared."""


def is_unlit_preview(facts):
    return any(field in facts for field in UNLIT_PREVIEW_FIELDS)

def decode(path, width):
    """Raw RGB24 bytes and the decoded size, via ffmpeg.

    ffmpeg rather than a pure-python JPEG decoder: there is no PIL on this
    machine and writing a baseline JPEG decoder to read one file would be a
    second thing to be wrong. Failure is loud — a silently empty buffer would
    measure as 100% dark.
    """
    if not os.path.exists(path):
        raise SystemExit("no reference image at %s" % path)
    scale = "scale=%d:-1" % width if width else "null"
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-vf", scale,
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise SystemExit("ffmpeg is not available (%s). Nothing was measured." % exc)
    if proc.returncode != 0 or not proc.stdout:
        raise SystemExit("ffmpeg could not decode %s:\n%s"
                         % (path, proc.stderr.decode("utf8", "replace")[:800]))
    raw = proc.stdout
    # The height comes from the byte count and the requested width, because
    # asking ffprobe separately is a second call that can disagree with the
    # first. If it does not divide exactly, the decode is not what was asked
    # for and saying so beats measuring a sheared image.
    if width:
        stride = width * 3
        if len(raw) % stride:
            raise SystemExit(
                "decoded %d bytes, which is not a whole number of %d-pixel rows. "
                "The scale filter did not produce the requested width."
                % (len(raw), width))
        return raw, width, len(raw) // stride
    raise SystemExit("--width is required: the height is derived from it.")


def measure(raw, width, height):
    counts = {}
    total = width * height
    for index in range(0, total * 3, 3):
        family = palette_mod.classify(raw[index], raw[index + 1], raw[index + 2])
        counts[family] = counts.get(family, 0) + 1
    return palette_mod.percentages(counts, total), total


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("image", nargs="?", default=DEFAULT_REFERENCE)
    parser.add_argument("--width", type=int, default=800,
                        help="decode width; the reference is measured at the "
                             "preview's own width so the two are comparable")
    parser.add_argument("--json", dest="json_out", default=None)
    parser.add_argument("--compare", default=None,
                        help="a facts JSON from verify-hero-composition.py --json=")
    args = parser.parse_args(argv)

    raw, width, height = decode(args.image, args.width)
    pct, pixels = measure(raw, width, height)

    print("reference: %s" % args.image)
    print("measured at %dx%d (%d pixels), classifier: palette.py" % (width, height, pixels))
    print()
    if not args.compare:
        for family in sorted(pct, key=lambda f: -pct[f]):
            print("  %-18s %6.2f%%" % (family, pct[family]))
    else:
        with io.open(args.compare, encoding="utf8") as handle:
            facts = json.load(handle)
        ours = (facts.get("palette_pct") or {})
        if not ours:
            raise SystemExit("%s has no palette_pct in it. Nothing was compared."
                             % args.compare)
        if is_unlit_preview(facts):
            raise SystemExit(UNLIT_REFUSAL % (args.compare,
                                              pct.get("dark", 0.0),
                                              pct.get("green_foliage", 0.0),
                                              ours.get("dark", 0.0),
                                              ours.get("green_foliage", 0.0)))
        print("  %-18s %9s %9s %9s" % ("family", "reference", "ours", "delta"))
        for family in sorted(pct, key=lambda f: -pct[f]):
            mine = ours.get(family, 0.0)
            print("  %-18s %8.2f%% %8.2f%% %+8.2f" % (family, pct[family], mine,
                                                      mine - pct[family]))
        print()
        print("Delta is OURS MINUS THE REFERENCE. Negative means the world has "
              "less of that family than the image does.")
        missing = [f for f in palette_mod.FAMILIES if f not in ours]
        if missing:
            print("NOT IN THE FACTS FILE (so not compared): %s" % ", ".join(missing))

    if args.json_out:
        payload = {
            "image": os.path.abspath(args.image),
            "measured_at": {"width": width, "height": height, "pixels": pixels},
            "classifier": "wonderland/infra/build/palette.py",
            "palette_pct": pct,
            "what_this_is_not": (
                "a similarity score, and not a coverage or depth measurement — "
                "a photograph has no geometry, so those are absent rather than "
                "approximated"),
        }
        with io.open(args.json_out, "w", encoding="utf8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        print("\nwrote %s" % args.json_out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
