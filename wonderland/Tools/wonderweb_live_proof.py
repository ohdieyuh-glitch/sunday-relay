# IS WONDER WEB ACTUALLY A BROWSER, OR A PICTURE OF ONE?
#
# FOUNDER (2026-09-23), priority 3: "Wonder Web needs to actually WORK. Do not leave it as a visual shell."
#
# This answers that without the editor, because the part worth doubting is not Unreal's: it is whether the live
# path behind Wonder Web -- the headless browser in the Julius Connect runtime, which Wonderland drives over
# loopback -- renders a real page and hands back real pixels. Unreal only draws the frame it is given.
#
# WHAT IT REFUSES TO ACCEPT AS A PASS. Not that the route answered, not that the JSON said ok, and not that some
# bytes came back: a blank page is also bytes. It reads the JPEG's own header for real dimensions, and checks the
# image is not one flat colour -- a uniform frame is exactly what a broken capture produces, and it is the same
# failure that made the wardrobe's render target白 for days.
#
#   python wonderland/Tools/wonderweb_live_proof.py [--url https://example.com] [--out <dir>]
#
# example.com by default: IANA's reserved documentation domain, and already on Wonderland's own host allowlist
# (wl.WonderWeb.RealHosts). The tab is always closed again, pass or fail.
import argparse
import json
import os
import struct
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8795/julius-connect/v1/browser"
TAB = "wlproof"


def post(op, **fields):
    body = json.dumps(dict(op=op, tab=TAB, **fields)).encode("utf-8")
    req = urllib.request.Request(BASE + "/intent", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def frame():
    with urllib.request.urlopen("%s/frame?tab=%s" % (BASE, TAB), timeout=30) as resp:
        return resp.read()


def jpeg_size(data):
    """Width and height straight out of the JPEG's own SOF marker. No decoder, no dependency."""
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        seg = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + seg
    return 0, 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://example.com")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                  "..", "..", "captures", "wonderweb"))
    args = ap.parse_args()
    out = os.path.normpath(args.out)
    os.makedirs(out, exist_ok=True)
    checks = []

    def record(name, ok, detail):
        checks.append((name, ok, detail))
        print("%-4s %-46s %s" % ("PASS" if ok else "FAIL", name, detail))

    try:
        nav = post("navigate", url=args.url)
    except urllib.error.URLError as exc:
        record("the live browser runtime is reachable", False,
               "%s -- start it with: npm run julius-connect:dev" % exc)
        return 1
    record("navigate is accepted for an allowlisted host", bool(nav.get("ok")),
           json.dumps(nav)[:140])
    if not nav.get("ok"):
        return 1

    try:
        data = frame()
        path = os.path.join(out, "live_frame.jpg")
        with open(path, "wb") as handle:
            handle.write(data)
        record("a frame comes back at all", len(data) > 0, "%d bytes -> %s" % (len(data), path))

        record("it is a JPEG and not an error page", data[:2] == b"\xff\xd8",
               "leading bytes %s" % data[:2].hex())

        w, h = jpeg_size(data)
        record("it has real dimensions", w >= 320 and h >= 240, "%dx%d" % (w, h))

        # NOT ONE FLAT COLOUR. A blank capture is still a valid JPEG of the right size, so the only honest test is
        # whether the compressed data varies at all. A single-colour 1200x800 frame compresses to almost nothing.
        expected_floor = (w * h) // 600 if w and h else 2000
        record("the page actually drew something", len(data) > expected_floor,
               "%d bytes against a %d-byte floor for %dx%d; a blank frame collapses far below it"
               % (len(data), expected_floor, w, h))

        # AND IT IS A BROWSER, NOT A SCREENSHOT SERVER.
        #
        # Everything above is satisfied by a process that took one picture once and hands the same bytes to
        # everybody. What separates a live browser from that is whether it RESPONDS: change the viewport, and the
        # page must re-render at the size asked for. Deterministic, and it costs no extra page load -- which is
        # why this is the op used rather than a second navigate.
        vp = post("viewport", width=900, height=600)
        record("a viewport change is accepted", bool(vp.get("ok")), json.dumps(vp)[:120])
        after = frame()
        w2, h2 = jpeg_size(after)
        path2 = os.path.join(out, "live_frame_resized.jpg")
        with open(path2, "wb") as handle:
            handle.write(after)
        record("the page re-rendered at the new size", (w2, h2) == (900, 600),
               "%dx%d after asking for 900x600 -> %s" % (w2, h2, path2))
        record("the new frame is genuinely a different picture", after != data,
               "%d bytes vs %d; identical bytes would mean a cached still" % (len(after), len(data)))
    finally:
        try:
            post("close")
            print("     (tab closed)")
        except Exception as exc:
            print("     (could not close tab: %s)" % exc)

    failed = [c for c in checks if not c[1]]
    print("\n%d/%d checks passed" % (len(checks) - len(failed), len(checks)))
    print("The frame is saved above -- LOOK AT IT. These checks prove the path is live, not that the page is right.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
