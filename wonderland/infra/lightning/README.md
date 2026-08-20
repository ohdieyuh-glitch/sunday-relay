# Wonderland on Lightning AI

Lightning is the GPU build/render/stream machine. **Claude Code does not run
inside it** — it stays on the founder's Chromebook and drives development; the
Studio only ever executes the scripts in this directory.

Target flow:

```
GPU on  →  one command  →  Wonderland builds  →  URL appears  →  founder opens it
```

---

## Which GPU to pick — and the trap

**Choose an L4, or an A10G. Do not choose an A100 or an H100.**

This is counterintuitive and it matters more than raw speed: **A100 and H100
have no NVENC video encoder at all.** They are compute parts — the encoder
block was removed. Pixel Streaming needs hardware H264 encoding, so on an A100
Wonderland would fall back to software encoding, which burns CPU, adds latency,
and gives a worse stream than a card a quarter of the price. "Strongest GPU
available" is the wrong instinct here.

| GPU | VRAM | NVENC | Verdict |
|---|---|---|---|
| **L4** | 24 GB | 2 | **Best pick.** Ada encoder, efficient, plenty for Wonderland |
| **A10G** | 24 GB | 1 | Also good; more raw power, older encoder |
| T4 | 16 GB | 1 | Works. Lumen will be slow but the stream is fine |
| A100 | 40–80 GB | **0** | Avoid — no hardware encoder |
| H100 | 80 GB | **0** | Avoid — no hardware encoder |

Wonderland streamed at 1280×720 / 140 fps on an RTX 6000 Ada. An L4 has
comfortable headroom for that; the earlier measured bottleneck was never the
GPU, it was **network distance** — pick a region near the founder.

---

## Order of operations

### 1. While the Studio is still on CPU

```bash
git clone -b relay/wonderland-ca-fixes https://github.com/ohdieyuh-glitch/sunday-relay.git \
  /teamspace/studios/this_studio/wonderland/src
bash /teamspace/studios/this_studio/wonderland/src/wonderland/infra/lightning/prepare.sh
```

`prepare.sh` does everything that does not need a GPU: packages, the source
checkout, the offline gates, and the procedural textures and audio. It ends by
telling you whether Unreal Engine 5.8 is present.

**Getting UE 5.8 is the one thing that needs you.** Epic put it behind an
account link and the scripts will not work around that. `prepare.sh` prints the
exact commands; the short version is to link Epic↔GitHub once, then
`docker pull ghcr.io/epicgames/unreal-engine:dev-5.8`. Do it on CPU — it is a
large download and none of it needs a GPU.

### 2. Switch the Studio to the GPU, then one command

```bash
bash /teamspace/studios/this_studio/wonderland/src/wonderland/infra/lightning/launch-wonderland.sh
```

It checks the GPU, disk and RAM; updates the branch; runs the CPU prep;
builds/cooks/packages; starts TURN, signalling, the client and the tunnel;
captures the founder hero frame; verifies the frame is actually rendering; and
prints the URL in a box.

### 3. When you are done looking

```bash
bash .../wonderland/infra/lightning/stop-wonderland.sh
```

It stops everything, confirms nothing is still holding the GPU, and only then
says it is safe to switch the Studio back to CPU. It exits non-zero if a
process survived — switching down with a live process is how a "stopped"
session keeps costing money.

---

## What is where

| Path | Holds |
|---|---|
| `$WL_ROOT` | `/teamspace/studios/this_studio/wonderland` by default |
| `$WL_ROOT/src` | the git checkout of `relay/wonderland-ca-fixes` |
| `$WL_ROOT/UnrealEngine` | the engine, if installed natively |
| `$WL_ROOT/packaged` | the cooked build |
| `$WL_ROOT/proof` | hero frames, `hero-latest.png` symlinked to the newest |
| `$WL_ROOT/logs` | build, app, signalling, tunnel, gates |

Everything lives under `/teamspace` on purpose: that is the only storage that
survives a Studio stopping. Put the engine anywhere else and you pay to
download it again every session.

---

## Files

- `common.sh` — path detection, logging, the `/proc/net/tcp` port reader
- `prepare.sh` — all CPU work; safe to re-run; never starts a GPU
- `build-render.sh` — generate, compile, cook, package (native or container)
- `run-stream.sh` — TURN → signalling → client → public URL
- `launch-wonderland.sh` — **the one command**
- `stop-wonderland.sh` — clean shutdown + a safe-to-switch-off verdict
- `shot.cjs` — hero-frame capture from the player page
- `lightning-runner.test.sh` — offline tests, no GPU needed

---

## Traps already paid for

These cost real time on the previous host. They are encoded in the scripts;
this is why.

- **The engine's own screenshot request is a phantom** — it returns success and
  writes nothing. The only trustworthy frame is one captured from the receiving
  browser, which is what `shot.cjs` does.
- **Playwright's bundled Chromium has no H264 decoder.** The page loads, the
  stream negotiates, the video stays black, and nothing reports an error.
  `shot.cjs` uses `channel: "chrome"` for this reason alone.
- **TURN must be advertised in the signalling server's peer options.** Not just
  running — advertised. Without it the stream works on the host and is black
  everywhere else.
- **Use the engine's bundled Node for signalling.** The system Node on these
  images is usually far too old, and it fails looking like a network problem.
- **`ss` is not always installed** and reports "nothing listening" when
  something is. `common.sh` reads `/proc/net/tcp`.
- **Auto-exposure does not converge in the packaged stream.** Capturing
  immediately gives a washed frame that sends you chasing a lighting bug that
  is not there; `shot.cjs` waits.
- **Check free disk before cooking.** A 261 GiB sparse intermediate killed an
  export once; the launcher refuses to start under 60 GB.

---

## Status

**Written, not yet run.** No Lightning Studio has executed any of this, and no
Lightning GPU has rendered a Wonderland frame. `lightning-runner.test.sh`
covers what is testable without hardware — syntax, storage detection, the port
reader, the frame verifier's ability to tell black from flat from rendered, the
absence of the old host's paths, and the no-GPU refusal — and passes 18/18.

Graphics are **not** proven until a real Lightning GPU frame exists.
