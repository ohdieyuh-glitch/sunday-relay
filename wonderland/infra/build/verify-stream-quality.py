#!/usr/bin/env python3
"""CONNECTED is not GOOD ENOUGH TO USE. This is the difference, measured.

The Lightning stream connects every time and is visibly poor. "It works" and
"it is usable" had no separate names, so every report said the first while the
founder experienced the second.

Reads the JSON from stream-stats.cjs — real getStats() numbers from a browser
that actually decoded the video — and returns one of:

  NOT_CONNECTED   no peer connection, or no video arriving
  CONNECTED       video is arriving, but below the usability floor
  GOOD_ENOUGH     meets every floor

Never infers quality from server location. A GPU in Las Vegas with a TCP relay
and 400 kbps is not good; a number is the only thing that settles it.

Exit 0 GOOD_ENOUGH   1 CONNECTED but not good enough   2 NOT_CONNECTED
"""
import io, json, os, sys

# FLOORS, each with a reason. Deliberately modest: this separates "usable" from
# "the thing the founder complained about", not "good" from "excellent".
MIN_KBPS = int(os.environ.get("WL_Q_MIN_KBPS", "2500"))    # below this, 720p is mush
MIN_FPS = float(os.environ.get("WL_Q_MIN_FPS", "24"))      # below this it reads as stutter
MAX_RTT_MS = float(os.environ.get("WL_Q_MAX_RTT_MS", "80"))  # US-West to US-West should beat this
MAX_LOSS_PCT = float(os.environ.get("WL_Q_MAX_LOSS_PCT", "2.0"))


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "-"
    raw = sys.stdin.read() if src == "-" else io.open(src, encoding="utf8").read()
    try:
        s = json.loads(raw)
    except ValueError:
        print("NOT_CONNECTED: stream-stats produced no JSON")
        return 2

    if s.get("error"):
        print("NOT_CONNECTED: %s" % s["error"])
        return 2
    inbound = s.get("inbound")
    if not inbound:
        print("NOT_CONNECTED: no inbound video RTP — the browser received no video")
        return 2

    pair = s.get("candidatePair") or {}
    local = s.get("localCandidate") or {}
    remote = s.get("remoteCandidate") or {}

    kbps = s.get("measuredKbps")
    fps = s.get("measuredFps") or inbound.get("framesPerSecond")
    rtt = pair.get("currentRoundTripTime")
    rtt_ms = round(rtt * 1000, 1) if isinstance(rtt, (int, float)) else None
    recv = inbound.get("packetsReceived") or 0
    lost = inbound.get("packetsLost") or 0
    loss_pct = round(100.0 * lost / (recv + lost), 2) if (recv + lost) else None

    # THE ROUTE IS PART OF THE DIAGNOSIS. 'relay' means every frame is going
    # through TURN, and a TCP relay is the single most likely explanation for a
    # stream that connects and looks compressed regardless of GPU location.
    route = "%s/%s -> %s/%s" % (local.get("candidateType"), local.get("protocol"),
                                remote.get("candidateType"), remote.get("protocol"))

    print("  bitrate        %s kbps" % kbps)
    print("  fps            %s" % fps)
    print("  rtt            %s ms" % rtt_ms)
    print("  packet loss    %s %%" % loss_pct)
    print("  resolution     %sx%s" % (inbound.get("frameWidth"), inbound.get("frameHeight")))
    print("  codec          %s" % ((s.get("codec") or {}).get("mimeType")))
    print("  decoder        %s" % inbound.get("decoderImplementation"))
    print("  ice route      %s" % route)
    print("  freezes        %s (%s s)" % (inbound.get("freezeCount"),
                                          inbound.get("totalFreezesDuration")))

    problems = []
    if kbps is None or kbps < MIN_KBPS:
        problems.append("bitrate %s kbps is below the %s kbps floor" % (kbps, MIN_KBPS))
    if fps is None or float(fps) < MIN_FPS:
        problems.append("fps %s is below the %s floor" % (fps, MIN_FPS))
    if rtt_ms is not None and rtt_ms > MAX_RTT_MS:
        problems.append("rtt %s ms exceeds %s ms — the GPU is too far, or the media "
                        "path is being proxied" % (rtt_ms, MAX_RTT_MS))
    if loss_pct is not None and loss_pct > MAX_LOSS_PCT:
        problems.append("packet loss %s%% exceeds %s%%" % (loss_pct, MAX_LOSS_PCT))
    if local.get("candidateType") == "relay" or remote.get("candidateType") == "relay":
        problems.append("media is going through a TURN relay (%s) rather than direct "
                        "UDP; a relayed — especially TCP-relayed — path is the usual "
                        "cause of a stream that connects and looks compressed" % route)
    if str(local.get("protocol", "")).lower() == "tcp":
        problems.append("the selected candidate pair is TCP; WebRTC congestion "
                        "control behaves badly over it and the picture suffers")

    if problems:
        print("CONNECTED (not good enough to use):")
        for p in problems:
            print("  - %s" % p)
        return 1
    print("GOOD_ENOUGH: direct, low-latency, full-rate video is arriving.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
