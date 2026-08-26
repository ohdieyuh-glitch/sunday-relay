#!/usr/bin/env python3
"""Side-by-side: a real V2 Unreal render (left) beside the reference view (right).

    python3 compare_v2.py RENDER.png OUT.png [--pass=V2_PASS_003] [--cam=0]

The reference view is regenerated for the camera (yaw/pitch/fov from
v2_config.HERO_CAMS) so both panels share one projection. Labels are burned
in when ffmpeg has drawtext. Image metrics are deliberately absent: the
founder's eye is the instrument.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
import v2_config as C   # noqa: E402


def label(src, text, dst, h=720):
    if subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf",
                       "scale=-2:%d,drawtext=text='%s':x=16:y=16:fontsize=30:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10" % (h, text),
                       dst]).returncode != 0:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-vf", "scale=-2:%d" % h, dst], check=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opt = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    render, out = args[0], args[1]
    cam = C.HERO_CAMS[int(opt.get("cam", 0))]
    tag = opt.get("pass", "V2")
    tmp = os.path.dirname(os.path.abspath(out)) or "."
    ref = os.path.join(tmp, "reference_view_cam%s.png" % opt.get("cam", 0))
    if not os.path.exists(ref):
        subprocess.run([sys.executable, os.path.join(HERE, "reproject_reference.py"), ref,
                        "--yaw=%s" % (cam["rotation"][1] - 90.0), "--pitch=%s" % cam["rotation"][0],
                        "--fov=%s" % cam["fov"]], check=True)
    a, b = os.path.join(tmp, "_a.png"), os.path.join(tmp, "_b.png")
    label(render, "%s - REAL UNREAL V2 RENDER (%s)" % (tag, cam["name"]), a)
    label(ref, "MARBLE REFERENCE, same lens", b)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", a, "-i", b,
                    "-filter_complex", "[0][1]hstack=inputs=2", out], check=True)
    print("wrote", out)


if __name__ == "__main__":
    main()
