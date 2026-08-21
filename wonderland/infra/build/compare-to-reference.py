#!/usr/bin/env python3
"""Put a Wonderland frame beside the founder's reference, with what produced it.

    python3 compare-to-reference.py <capture-dir-or-png> [--out page.html]
    python3 compare-to-reference.py --preview /tmp/preview.png --facts /tmp/f.json

The goal makes human visual review the final authority, and says the frames must
be fixed-camera and compared against the reference. That review is impossible
from a terminal, so this builds one self-contained page: the two images side by
side, the build that produced ours, what the packaged world reported about
itself, and the measured palette of both.

TWO MODES, LABELLED DIFFERENTLY ON PURPOSE.

A CAPTURE is a real streamed frame. Its palette can be compared with the
reference's, and the delta table is shown.

A PREVIEW is the offline structural projection: no lighting, no shadows, every
surface at full material albedo. It answers composition questions — where the
mass is, whether the subject is clear, whether the tree frames the top — and it
answers nothing about colour or light. Its palette is NOT compared, because the
reference is a lit render and the numbers are not commensurable (measure-
reference.py refuses the same comparison, for the same reason). The page says so
in the banner rather than in a footnote.
"""
import argparse
import base64
import glob
import io
import json
import os
import subprocess
import sys
from string import Template

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import palette as palette_mod                                     # noqa: E402

REFERENCE = os.path.normpath(os.path.join(
    HERE, "..", "..", "marble", "reference", "wonderland-reference.jpg"))


def data_uri(path):
    ext = os.path.splitext(path)[1].lower()
    mime = {".png": "image/png", ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg"}.get(ext)
    if mime is None:
        raise SystemExit("cannot embed %s: only PNG and JPEG are handled." % path)
    with io.open(path, "rb") as handle:
        return "data:%s;base64,%s" % (mime, base64.b64encode(handle.read()).decode())


def measure_image(path, width=800):
    """Palette of any image on disk, through ffmpeg and the shared classifier."""
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=%d:-1" % width,
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError:
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    raw = proc.stdout
    stride = width * 3
    if len(raw) % stride:
        return None
    height = len(raw) // stride
    counts = {}
    for index in range(0, width * height * 3, 3):
        family = palette_mod.classify(raw[index], raw[index + 1], raw[index + 2])
        counts[family] = counts.get(family, 0) + 1
    return palette_mod.percentages(counts, width * height)


def newest_capture(directory):
    pngs = sorted(glob.glob(os.path.join(directory, "*.png")),
                  key=os.path.getmtime, reverse=True)
    if not pngs:
        raise SystemExit("no PNG in %s. Nothing to compare." % directory)
    png = pngs[0]
    sidecar = os.path.splitext(png)[0] + ".json"
    meta = {}
    if os.path.exists(sidecar):
        with io.open(sidecar, encoding="utf8") as handle:
            meta = json.load(handle)
    return png, meta


def rows(ours, theirs, compare):
    out = []
    for family in palette_mod.FAMILIES:
        mine = (ours or {}).get(family)
        ref = (theirs or {}).get(family)
        delta = ("%+.2f" % (mine - ref)) if (compare and mine is not None
                                             and ref is not None) else "—"
        out.append((family.replace("_", " "),
                    "—" if mine is None else "%.2f%%" % mine,
                    "—" if ref is None else "%.2f%%" % ref, delta))
    return out


HTML = Template("""<title>$title</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600&family=Public+Sans:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  /* Neutrals biased toward the subject's own violet, because violet is both
     Wonderland's identity and the largest measured gap on this page. */
  :root {
    --ground:  #f8f5fc;
    --panel:   #ffffff;
    --ink:     #1f1a2b;
    --muted:   #6a6279;
    --line:    #e7e0f0;
    --arcane:  #6d3fc4;   /* the arcane circle: what the world is short of */
    --gilt:    #a9781c;   /* the gate: what the world has too much of */
    --note-bg: #f3eefb;
    --note-ink:#4a3576;
    --note-line:#ddd0f2;
    --shadow: 0 1px 2px rgba(31,26,43,.05), 0 8px 24px -18px rgba(31,26,43,.35);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:  #141220;
      --panel:   #1c1930;
      --ink:     #ece7f6;
      --muted:   #9b93ad;
      --line:    #2c2742;
      --arcane:  #b78dff;
      --gilt:    #d8b05a;
      --note-bg: #211a38;
      --note-ink:#c9b6f2;
      --note-line:#3a2f5c;
      --shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 28px -20px rgba(0,0,0,.8);
    }
  }
  :root[data-theme="dark"] {
    --ground:  #141220;
    --panel:   #1c1930;
    --ink:     #ece7f6;
    --muted:   #9b93ad;
    --line:    #2c2742;
    --arcane:  #b78dff;
    --gilt:    #d8b05a;
    --note-bg: #211a38;
    --note-ink:#c9b6f2;
    --note-line:#3a2f5c;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 28px -20px rgba(0,0,0,.8);
  }

  * { box-sizing: border-box; }
  body {
    background: var(--ground);
    color: var(--ink);
    margin: 0;
    font-family: "Public Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 44px 22px 84px;
          display: flex; flex-direction: column; gap: 26px; }

  header { display: flex; flex-direction: column; gap: 6px; }
  .eyebrow { font-size: .74rem; letter-spacing: .13em; text-transform: uppercase;
             color: var(--muted); font-weight: 700; }
  h1 { font-family: "Newsreader", Georgia, "Times New Roman", serif;
       font-weight: 600; font-size: clamp(1.9rem, 4vw, 2.6rem); line-height: 1.12;
       margin: 0; letter-spacing: -.015em; text-wrap: balance; }
  .sub { color: var(--muted); margin: 0; max-width: 62ch; }

  .note { background: var(--note-bg); color: var(--note-ink);
          border: 1px solid var(--note-line); border-left: 3px solid var(--arcane);
          border-radius: 10px; padding: 15px 17px; }
  .note b { display: block; margin-bottom: 3px;
            font-family: "Newsreader", Georgia, serif; font-size: 1.05rem;
            font-weight: 600; }
  .note p { margin: 0; font-size: .93rem; }

  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  @media (max-width: 860px) { .pair { grid-template-columns: 1fr; } }
  figure { margin: 0; background: var(--panel); border: 1px solid var(--line);
           border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
  figure img { display: block; width: 100%; height: auto; }
  figcaption { padding: 11px 15px; font-size: .84rem; color: var(--muted);
               border-top: 1px solid var(--line); }
  figcaption b { color: var(--ink); font-weight: 600; }

  .card { background: var(--panel); border: 1px solid var(--line);
          border-radius: 12px; padding: 20px 22px; box-shadow: var(--shadow);
          display: flex; flex-direction: column; gap: 13px; }
  h2 { font-family: "Newsreader", Georgia, serif; font-weight: 600;
       font-size: 1.16rem; margin: 0; letter-spacing: -.005em; }

  .gaps { display: flex; flex-wrap: wrap; gap: 10px; }
  .gap { flex: 1 1 190px; border: 1px solid var(--line); border-radius: 10px;
         padding: 12px 14px; display: flex; flex-direction: column; gap: 2px;
         border-top: 3px solid var(--line); }
  .gap.under { border-top-color: var(--arcane); }
  .gap.over  { border-top-color: var(--gilt); }
  .gap .n { font-family: "IBM Plex Mono", ui-monospace, monospace;
            font-size: 1.5rem; font-weight: 500; font-variant-numeric: tabular-nums;
            letter-spacing: -.02em; }
  .gap.under .n { color: var(--arcane); }
  .gap.over  .n { color: var(--gilt); }
  .gap .k { font-size: .78rem; letter-spacing: .09em; text-transform: uppercase;
            color: var(--muted); font-weight: 700; }
  .gap .d { font-size: .86rem; color: var(--muted); }

  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .92rem;
          font-variant-numeric: tabular-nums; }
  th, td { text-align: right; padding: 7px 11px; border-bottom: 1px solid var(--line); }
  th:first-child, td:first-child { text-align: left; }
  th { color: var(--muted); font-weight: 700; font-size: .76rem;
       letter-spacing: .09em; text-transform: uppercase; }
  tr:last-child td { border-bottom: none; }
  tr.excluded td { color: var(--muted); }
  .mono, code { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
                font-size: .86rem; }
  .flag { font-size: .7rem; letter-spacing: .07em; text-transform: uppercase;
          border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px;
          color: var(--muted); margin-left: 7px; white-space: nowrap; }

  .proof { display: flex; flex-wrap: wrap; gap: 7px; }
  .proof span { background: var(--ground); border: 1px solid var(--line);
                border-radius: 7px; padding: 4px 9px; }
  .foot { color: var(--muted); font-size: .88rem; margin: 0; max-width: 74ch; }
  a { color: var(--arcane); }
  :focus-visible { outline: 2px solid var(--arcane); outline-offset: 2px; }
</style>
<div class="wrap">
  <header>
    <span class="eyebrow">$eyebrow</span>
    <h1>$title</h1>
    <p class="sub">$subtitle</p>
  </header>
  $banner
  $gaps
  <div class="pair">
    <figure><img src="$ours" alt="The Wonderland frame">
      <figcaption><b>Wonderland</b> — $ours_caption</figcaption></figure>
    <figure><img src="$ref" alt="The founder's reference image">
      <figcaption><b>The reference</b> — the hard visual target</figcaption></figure>
  </div>
  $mix
  <div class="card">
    <h2>Colour families, as a share of the whole frame</h2>
    <div class="scroll"><table>
      <tr><th>family</th><th>ours</th><th>reference</th><th>delta</th></tr>
      $rows
    </table></div>
    <p class="foot">$palette_note</p>
  </div>
  $build
  $proof
  <p class="foot">Human visual review is the authority. Nothing on this page
  scores the frame against the reference, and no number here is a verdict.</p>
</div>
""")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", nargs="?", default=None,
                        help="a capture directory or a single PNG")
    parser.add_argument("--preview", default=None,
                        help="an offline structural preview PNG (not a render)")
    parser.add_argument("--facts", default=None,
                        help="facts JSON from verify-hero-composition.py")
    parser.add_argument("--reference", default=REFERENCE)
    parser.add_argument("--out", default="wonderland-vs-reference.html")
    args = parser.parse_args(argv)

    if not os.path.exists(args.reference):
        raise SystemExit("no reference image at %s" % args.reference)

    is_preview = bool(args.preview)
    meta = {}
    if is_preview:
        ours_png = args.preview
        if args.facts and os.path.exists(args.facts):
            with io.open(args.facts, encoding="utf8") as handle:
                meta = {"facts": json.load(handle)}
    elif args.target:
        if os.path.isdir(args.target):
            ours_png, meta = newest_capture(args.target)
        else:
            ours_png = args.target
            sidecar = os.path.splitext(ours_png)[0] + ".json"
            if os.path.exists(sidecar):
                with io.open(sidecar, encoding="utf8") as handle:
                    meta = json.load(handle)
    else:
        raise SystemExit("give a capture directory/PNG, or --preview. Nothing was built.")
    if not os.path.exists(ours_png):
        raise SystemExit("no image at %s" % ours_png)

    ref_pct = measure_image(args.reference)
    ours_pct = (meta.get("facts") or {}).get("palette_pct") if is_preview else measure_image(ours_png)

    if is_preview:
        banner = (
            '<div class="note"><b>This is the structural preview, not a render.</b><p>'
            'No lighting, no shadows, every surface drawn at full material albedo. '
            'It answers where the mass is, whether the subject is clear of the foreground, '
            'and whether the framing reaches the top of the frame. It answers nothing '
            'about colour or light in absolute terms, so the whole-frame palette table '
            'below is shown side by side and deliberately NOT differenced: the reference '
            'is a lit render, and 25.7% of it is shadow that this projection has no way '
            'to produce. The hue mix among coloured pixels IS differenced, because '
            'shadow changes a pixel\'s value and not its hue.</p></div>')
        palette_note = ("No delta is shown on this table. The reference measures 25.7% dark "
                        "and 0% green because its foliage sits in shadow; the preview measures "
                        "almost no dark and bright green because it has no lighting at all. "
                        "Neither is wrong, and subtracting them would produce a finding that is "
                        "an artefact of the lighting. The hue mix below is the comparison that "
                        "survives it.")
        ours_caption = "offline structural projection through HeroCam0, the arrival camera"
        title = "Wonderland vs Reference"
        eyebrow = "Structural preview · HeroCam0"
        subtitle = ("The arrival composition next to the image it is aiming at, "
                    "with the colour measured on both.")
    else:
        banner = ""
        palette_note = ("Delta is ours minus the reference. Both measured with the same "
                        "classifier (wonderland/infra/build/palette.py) at the same width.")
        ours_caption = "streamed frame, hero camera %s" % meta.get("hero_camera", "?")
        title = "Wonderland vs Reference"
        eyebrow = "Streamed frame · hero camera %s" % meta.get("hero_camera", "?")
        subtitle = ("The captured frame next to the image it is aiming at, with "
                    "the build that produced it.")

    build_html = ""
    if meta and not is_preview:
        knobs = meta.get("generator_knobs") or {}
        stream = meta.get("stream") or {}
        bits = [("build", meta.get("build_sha", "?")),
                ("branch", meta.get("branch", "?")),
                ("captured", meta.get("captured_at", "?")),
                ("hero camera", meta.get("hero_camera", "?")),
                ("render profile", meta.get("render_profile") or "—")]
        bits += [(k, v or "—") for k, v in sorted(knobs.items())]
        bits += [(k, v) for k, v in sorted(stream.items())]
        build_html = ('<div class="card"><h2>What produced this frame</h2>'
                      '<div class="scroll"><table>%s</table></div></div>'
                      % "".join('<tr><td>%s</td><td class="mono">%s</td></tr>' % (k, v)
                                for k, v in bits))
    elif is_preview and meta.get("facts"):
        facts = meta["facts"]
        cov = facts.get("coverage") or {}
        dogs = facts.get("relay_dogs") or {}
        bits = [("objects", "%.1f%%" % cov.get("objects_pct", 0)),
                ("sky", "%.1f%%" % cov.get("sky_pct", 0)),
                ("bare ground", "%.2f%%" % cov.get("bare_ground_pct", 0)),
                ("Relay Dogs in frame", dogs.get("in_frame", "?")),
                ("readable", dogs.get("readable", "?")),
                ("tallest Dog", "%.0f px" % dogs.get("tallest_px", 0)),
                ("distinct materials", facts.get("distinct_materials_visible", "?"))]
        build_html = ('<div class="card"><h2>What the projection measured</h2>'
                      '<div class="scroll"><table>%s</table></div></div>'
                      % "".join('<tr><td>%s</td><td class="mono">%s</td></tr>' % (k, v)
                                for k, v in bits))

    proof_html = ""
    lines = meta.get("world_proof") or []
    if lines:
        proof_html = ('<div class="card"><h2>What the packaged world reported</h2>'
                      '<div class="proof">%s</div>'
                      '<p class="foot">Read the frame with these. A good-looking frame '
                      'with MARBLE_ACTORS=0 is a frame of a different world than the one '
                      'being discussed.</p></div>'
                      % "".join('<span class="mono">%s</span>' % l for l in lines))

    gaps_html = ""
    # THE COMPARISON THAT SURVIVES THE LIGHTING DIFFERENCE. Shadow changes a
    # pixel's value, not its hue, so the mix among COLOURED pixels is far more
    # comparable than the absolute percentages — with one named exception.
    mix_html = ""
    if ours_pct and ref_pct:
        ours_mix = palette_mod.chromatic_mix_from_pct(ours_pct)
        ref_mix = palette_mod.chromatic_mix_from_pct(ref_pct)
        def mix_row(f):
            delta = ours_mix[f] - ref_mix[f]
            # GREEN IS STRUCK OUT OF THE READING, not silently averaged in: the
            # reference's topiary is entirely in shadow, so its 0.0% is a fact
            # about the lighting and not about the palette.
            excluded = (f == "green_foliage")
            return ('<tr%s><td>%s%s</td><td>%.1f%%</td><td>%.1f%%</td><td>%s</td></tr>'
                    % (' class="excluded"' if excluded else "",
                       f.replace("_", " "),
                       '<span class="flag">not comparable</span>' if excluded else "",
                       ours_mix[f], ref_mix[f],
                       "—" if excluded else "%+.1f" % delta))
        mix_rows = "".join(mix_row(f) for f in palette_mod.CHROMATIC)

        # The two biggest honest gaps, stated before any table. A page that is
        # scanned rather than read has to put the finding where the eye lands.
        judged = [(f, ours_mix[f] - ref_mix[f]) for f in palette_mod.CHROMATIC
                  if f != "green_foliage"]
        judged.sort(key=lambda kv: -abs(kv[1]))
        cards = []
        for family, delta in judged[:3]:
            if abs(delta) < 4.0:
                continue
            direction = "over" if delta > 0 else "under"
            word = ("more of the frame's colour than the reference" if delta > 0
                    else "less of the frame's colour than the reference")
            cards.append(
                '<div class="gap %s"><span class="k">%s</span>'
                '<span class="n">%+.0f pts</span><span class="d">%s</span></div>'
                % (direction, family.replace("_", " "), delta, word))
        if cards:
            gaps_html = ('<div class="card"><h2>Where the colour is off</h2>'
                         '<div class="gaps">%s</div>'
                         '<p class="foot">Percentage points of the frame\'s COLOURED '
                         'pixels, ours minus the reference. Green is left out — see '
                         'the hue-mix table for why.</p></div>' % "".join(cards))
        mix_html = (
            '<div class="card"><h2>Hue mix among coloured pixels</h2>'
            '<div class="scroll"><table>'
            '<tr><th>family</th><th>ours</th><th>reference</th><th>delta</th></tr>'
            '%s</table></div>'
            '<p class="foot">Dark, cream and neutral-stone pixels are excluded and the '
            'rest renormalised to 100%%. This is the comparison that mostly survives the '
            'lighting difference, because shadow changes a pixel\'s value and not its hue. '
            '<b>Green is the exception and should not be read here</b>: the reference\'s '
            'topiary is entirely in shadow, so it measures 0%% green and the delta on that '
            'row is an artefact. Pink, violet and gold are not affected that way.</p></div>'
            % mix_rows)

    body = HTML.substitute(
        title=title,
        eyebrow=eyebrow,
        subtitle=subtitle,
        banner=banner,
        ours=data_uri(ours_png),
        ref=data_uri(args.reference),
        ours_caption=ours_caption,
        build=build_html,
        proof=proof_html,
        gaps=gaps_html,
        rows="".join("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>" % r
                     for r in rows(ours_pct, ref_pct, compare=not is_preview)),
        palette_note=palette_note,
        mix=mix_html,
    )
    with io.open(args.out, "w", encoding="utf8") as handle:
        handle.write(body)
    print("wrote %s (%.0f KB)" % (args.out, os.path.getsize(args.out) / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
