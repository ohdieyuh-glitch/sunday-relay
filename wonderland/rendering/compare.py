#!/usr/bin/env python3
"""Put two bench runs side by side and let a person decide.

    python3 compare.py before after            # reads $WL_PROOF/bench/<label>/
    python3 compare.py before after --out /path/report.html

WHAT THIS REFUSES TO DO

It does not score the images. The founder's instruction was explicit — human
visual review is the final authority and no artificial numerical image-match
figure is to be claimed — and it is also just true: a per-pixel or perceptual
distance between a render and a painted reference measures the wrong thing, and
a number nobody can interrogate is worse than no number because it ends the
argument instead of informing it.

So the numbers here are only the ones that were actually MEASURED at an
instrument — frames delivered, bitrate, resolution, freezes, GPU utilisation,
VRAM — and the images are placed next to each other at full size for a person
to look at.

It also prints the SETTINGS DIFF between the two runs, first, because the most
common way a comparison misleads is that two things changed and the result was
attributed to one of them.
"""
import argparse
import html
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def bench_dir(label):
    root = os.environ.get("WL_PROOF")
    if not root:
        root = os.path.join(os.environ.get("WL_ROOT", "/tmp"), "proof")
    return os.path.join(root, "bench", label)


def load(label):
    path = os.path.join(bench_dir(label), "report.json")
    if not os.path.exists(path):
        raise SystemExit(
            "no bench report for %r at %s.\n"
            "Run: bash wonderland/rendering/bench.sh --label %s --profile <PROFILE>"
            % (label, path, label))
    with io.open(path, encoding="utf8") as handle:
        return json.load(handle)


def settings_diff(a, b):
    """What differs between the two launches. Order-independent."""
    def parse(report):
        out = {}
        for item in (report.get("exec_cmds") or "").split(","):
            item = item.strip()
            if not item:
                continue
            bits = item.split(None, 1)
            out[bits[0]] = bits[1] if len(bits) > 1 else ""
        return out
    left, right = parse(a), parse(b)
    rows = []
    for key in sorted(set(left) | set(right)):
        lv, rv = left.get(key, "-"), right.get(key, "-")
        if lv != rv:
            rows.append((key, lv, rv))
    return rows


METRICS = (
    ("fps_p50", "FPS p50", "%.1f"),
    ("fps_min", "FPS min", "%.1f"),
    ("bitrate_kbps", "kbps", "%.0f"),
    ("resolution", "resolution", "%s"),
    ("freeze_count", "freezes", "%.0f"),
    ("mean_decode_ms", "decode ms", "%.2f"),
)
GPU_METRICS = (
    ("gpu_util_mean_pct", "GPU %", "%.0f"),
    ("vram_used_max_mib", "VRAM MiB", "%.0f"),
)


def fmt(value, spec):
    if value is None:
        return "—"
    try:
        return spec % value
    except (TypeError, ValueError):
        return html.escape(str(value))


def rows_for(report):
    return {str(run.get("camera")): run for run in report.get("runs", [])}


def render_html(a, b, label_a, label_b):
    left, right = rows_for(a), rows_for(b)
    cameras = sorted(set(left) | set(right), key=lambda c: (len(c), c))
    diff = settings_diff(a, b)

    out = []
    out.append("<h1>Wonderland rendering: %s vs %s</h1>"
               % (html.escape(label_a), html.escape(label_b)))
    out.append("<p class=note><strong>There is no image-match score here, on "
               "purpose.</strong> Every number below came off an instrument. "
               "Whether the picture is better is a question for a person.</p>")

    out.append("<h2>What changed</h2>")
    out.append("<p>%s → %s</p>" % (html.escape(str(a.get("profile"))),
                                   html.escape(str(b.get("profile")))))
    if diff:
        out.append("<table><tr><th>console variable</th><th>%s</th><th>%s</th></tr>"
                   % (html.escape(label_a), html.escape(label_b)))
        for key, lv, rv in diff:
            out.append("<tr><td><code>%s</code></td><td>%s</td><td class=hi>%s</td></tr>"
                       % (html.escape(key), html.escape(lv), html.escape(rv)))
        out.append("</table>")
    else:
        out.append("<p class=warn>The two runs used IDENTICAL console variables. "
                   "Any difference below is noise, a stream-argument change, or a "
                   "content change — not a renderer setting.</p>")
    out.append("<p class=small>stream arguments are recorded per run in "
               "<code>render-launch.txt</code> on the box.</p>")

    out.append("<h2>Measured</h2><table><tr><th>camera</th>")
    for _key, name, _spec in METRICS + GPU_METRICS:
        out.append("<th>%s %s</th><th>%s %s</th>"
                   % (html.escape(label_a), name, html.escape(label_b), name))
    out.append("</tr>")
    for cam in cameras:
        la, rb = left.get(cam, {}), right.get(cam, {})
        out.append("<tr><td>HeroCam%s</td>" % html.escape(cam))
        for key, _name, spec in METRICS:
            out.append("<td>%s</td><td>%s</td>"
                       % (fmt((la.get("stream") or {}).get(key), spec),
                          fmt((rb.get("stream") or {}).get(key), spec)))
        for key, _name, spec in GPU_METRICS:
            out.append("<td>%s</td><td>%s</td>"
                       % (fmt((la.get("gpu") or {}).get(key), spec),
                          fmt((rb.get("gpu") or {}).get(key), spec)))
        out.append("</tr>")
    out.append("</table>")

    failed = [(lbl, r) for lbl, rep in ((label_a, a), (label_b, b))
              for r in rep.get("runs", []) if r.get("status") != "ok"]
    if failed:
        out.append("<h2 class=warn>Runs that produced no measurement</h2><ul>")
        for lbl, run in failed:
            out.append("<li><strong>%s HeroCam%s</strong> — %s</li>"
                       % (html.escape(lbl), html.escape(str(run.get("camera"))),
                          html.escape(str(run.get("status")))))
        out.append("</ul><p class=warn>Those rows are not evidence of anything.</p>")

    out.append("<h2>The frames</h2>")
    for cam in cameras:
        la, rb = left.get(cam, {}), right.get(cam, {})
        out.append("<h3>HeroCam%s</h3><div class=pair>" % html.escape(cam))
        for lbl, run in ((label_a, la), (label_b, rb)):
            shot = run.get("screenshot")
            out.append("<figure>")
            if shot and os.path.exists(shot):
                out.append('<img src="%s" alt="%s HeroCam%s">'
                           % (html.escape(os.path.abspath(shot)), html.escape(lbl),
                              html.escape(cam)))
            else:
                out.append('<div class="missing">no frame captured</div>')
            out.append("<figcaption>%s</figcaption></figure>" % html.escape(lbl))
        out.append("</div>")

    out.append("<h2>The reference</h2>")
    reference = os.path.normpath(os.path.join(HERE, "..", "marble", "reference",
                                              "wonderland-reference.png"))
    if os.path.exists(reference):
        out.append('<figure><img src="%s" alt="the founder reference">'
                   '<figcaption>the founder\'s reference</figcaption></figure>'
                   % html.escape(reference))
    else:
        out.append("<p class=warn>The founder's reference image is not in the "
                   "repository (expected at <code>wonderland/marble/reference/"
                   "wonderland-reference.png</code>), so this report cannot show "
                   "what it is being compared against.</p>")

    style = """
    body{font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;margin:2rem auto;
         max-width:1400px;padding:0 1rem;color:#1c1a22;background:#fbfafc}
    h1{font-size:1.6rem}h2{margin-top:2.2rem;font-size:1.2rem;
       border-bottom:1px solid #e2dfe8;padding-bottom:.3rem}
    table{border-collapse:collapse;width:100%;font-size:13px;margin:.6rem 0}
    th,td{border:1px solid #e2dfe8;padding:.3rem .5rem;text-align:right}
    th:first-child,td:first-child{text-align:left}
    th{background:#f2eff7;font-weight:600}
    td.hi{background:#efe7ff;font-weight:600}
    .pair{display:flex;gap:1rem;flex-wrap:wrap}
    figure{margin:0;flex:1 1 560px}
    img{width:100%;height:auto;border:1px solid #d9d4e4;border-radius:4px;display:block}
    figcaption{font-size:12px;color:#6b6478;padding-top:.3rem}
    .missing{padding:4rem 1rem;text-align:center;color:#a3a3a3;border:1px dashed #d9d4e4}
    .note{background:#f2eff7;padding:.7rem 1rem;border-left:3px solid #7c5cff;border-radius:2px}
    .warn{color:#a3341f}
    .small{font-size:12px;color:#6b6478}
    code{background:#f2eff7;padding:.05rem .3rem;border-radius:3px}
    """
    return ("<!doctype html><meta charset=utf-8>"
            "<title>Wonderland rendering %s vs %s</title><style>%s</style>%s"
            % (html.escape(label_a), html.escape(label_b), style, "".join(out)))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("--out", default=None)
    args = parser.parse_args(argv)

    a, b = load(args.before), load(args.after)
    out = args.out or os.path.join(bench_dir(args.after),
                                   "compare-%s-vs-%s.html" % (args.before, args.after))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with io.open(out, "w", encoding="utf8") as handle:
        handle.write(render_html(a, b, args.before, args.after))
    print("wrote %s" % out)

    diff = settings_diff(a, b)
    if not diff:
        print("WARNING: the two runs used identical console variables. Whatever "
              "differs in the numbers, a renderer setting is not the cause.")
    for label, report in ((args.before, a), (args.after, b)):
        failed = [r for r in report.get("runs", []) if r.get("status") != "ok"]
        if failed:
            print("WARNING: %d run(s) in %r produced no measurement."
                  % (len(failed), label))
    return 0


if __name__ == "__main__":
    sys.exit(main())
