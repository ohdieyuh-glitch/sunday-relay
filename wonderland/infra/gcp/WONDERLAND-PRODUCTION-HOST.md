# Wonderland production streaming host

Lightning is **build and test infrastructure**. It is not the production Pixel
Streaming host, for one specific reason: it does not let us pin or prove the
GPU's region. A media path whose length is unknown and changes between sessions
cannot be held to a latency budget, and "it was fine yesterday" is not an
operating standard.

## The two causes of the poor picture, kept separate

The current stream connects reliably and looks heavily compressed. Distance is
only half of it.

| Cause | Symptom | Fix |
|---|---|---|
| **Distance** — unpinned GPU region, tunnel exit wherever Cloudflare chose | high RTT, slow bitrate ramp | pin the region (below) |
| **Transport** — a Cloudflare quick tunnel proxies over **TCP/443**; WebRTC media forced through a TCP relay loses its congestion behaviour | low bitrate that never recovers, freezes, blockiness *regardless of distance* | direct UDP, real STUN/TURN |

Moving the GPU to Las Vegas and keeping the quick tunnel would fix one of these
and leave the other. `verify-stream-quality.py` fails a relayed or TCP path
explicitly so that outcome cannot be mistaken for success.

## Region

Set in `wonderland-region.env`, guarded by an allow-list in `verify-region.py`:

1. **`us-west4` — Las Vegas, Nevada** (default)
2. `us-west2` — Los Angeles, California
3. `us-west1` / `us-west3` — fallback only

A region outside the list is **refused**, not warned about.

## Machine

`g2-standard-8` + `nvidia-l4`. The L4 is the same class already proven, and it
has **NVENC**. Do not substitute an A100 or H100: they have **no encoder at
all**, so a Pixel Streaming host on one cannot hardware-encode.

## Networking: browser → Unreal

The recommended path, in the order ICE should prefer it:

1. **host / srflx over UDP — direct.** The instance needs a public IP and the
   ephemeral UDP range open (`WL_WEBRTC_UDP_MIN`–`WL_WEBRTC_UDP_MAX`). This is
   the only configuration that reaches the quality floor.
2. **STUN** for the reflexive candidate.
3. **TURN over UDP**, on a *publicly reachable* host, as fallback for restrictive
   client networks. A TURN server the browser cannot reach is worse than none —
   ICE spends its timeout on it before failing over.
4. **Signalling only** may sit behind a proxy or tunnel. Wilbur's HTTP/WebSocket
   traffic is small and latency-tolerant; the media must not follow it.

What this replaces: a quick tunnel carrying **both** signalling and media. That
is fine for a first proof and is not an architecture.

## Deploying the EXISTING package

The packaged Linux build is portable. **Do not rebuild the world to change
hosts** — copy the staged tree and run it.

```bash
# 1. region is explicit and allowed, before anything is created
python3 wonderland/infra/build/verify-region.py

# 2. copy the existing staged build to the instance (no cook, no rebuild)
gcloud compute scp --recurse \
  /teamspace/studios/this_studio/wonderland/packaged/Linux \
  wonderland-gpu:~/wonderland-packaged --zone "$WL_GCP_ZONE"

# 3. on the instance: same run-stream.sh, with the tunnel disabled
WL_PUBLIC=none WL_OUT=~/wonderland-packaged \
  bash wonderland/infra/lightning/run-stream.sh
```

## Acceptance

Region is **necessary and not sufficient**, and neither script claims otherwise:

```bash
node wonderland/infra/lightning/stream-stats.cjs "$PLAYER_URL" > /tmp/stats.json
python3 wonderland/infra/build/verify-stream-quality.py /tmp/stats.json
```

- exit 2 `NOT_CONNECTED` — no video arriving
- exit 1 `CONNECTED` — video arriving, below the usability floor, with the
  reasons named (bitrate, fps, rtt, loss, relayed route, TCP pair)
- exit 0 `GOOD_ENOUGH` — direct, low-latency, full-rate

The numbers come from `getStats()` in a browser that actually decoded the video.
Nothing about quality is inferred from where the server is.
