# Wonderland on Google Compute Engine

The GCP GPU path. Sibling of `../vast/` (the provider it replaces) and
`../terraform/` (the AWS path, deferred long before either).

## What this had to replace, and what it didn't

Vast.ai did exactly one job here: rent one GPU box by the hour to build and
stream Wonderland. There is no job queue, no per-mission provisioning, no
artifact round-trip — it is a long-lived interactive host.

**Relay's product code has no idea a GPU exists.** Grep `src/` and
`relay-bridge/` for a provider name and you get nothing back. The only seam
between Relay and this machine is one browser env var,
`VITE_WONDERLAND_SIGNALLING_URL`. That is why the provider abstraction lives at
the shell and not inside Relay: adding a `ComputeProvider` interface to the
product would *create* a coupling that does not currently exist, and the brief
asked for the opposite.

So the migration is entirely within `wonderland/infra/`. Unchanged and
provider-independent: `infra/build/build-wonderland.sh`, the level and texture
generators, the signalling/TURN/streamer topology, the port plan, and all of
Relay.

## The three commands

```
./wonderland-gcp.sh preflight     # every gate before money is spent
./wonderland-gcp.sh create        # PLAN ONLY — prints the gcloud for you to run
./wonderland-gcp.sh stop          # halts compute billing; the disk keeps billing
```

`create` never provisions. Running the command it prints is the authorization,
which is the same boundary `../vast/wonderland-vast.sh` draws and for the same
reason.

## Sizing, from measurement

The Vast box is an RTX 6000 Ada, 48 GB. Measured on the live stream it used
**2.3 GB of VRAM at 36-40% GPU** for 720-1080p H.264. Pixel Streaming is
NVENC-bound; it is not compute-bound and nowhere near VRAM-bound.

So: **1x L4 on `g2-standard-8`**. An A100 or H100 would be waste rather than
headroom, and the brief is explicit about not buying one because it is there.

| | STANDARD | SPOT |
|---|---|---|
| g2-standard-8 + 1x L4, us-central1 | ~$0.85-1.00/hr | ~$0.30-0.40/hr |

Against $0.794/hr on Vast. Spot is 60-70% cheaper and can be reclaimed on 30
seconds' notice — fine for a rebuild, which is idempotent and resumable, and not
fine mid-demo. `GCP_PROVISIONING_MODEL` switches it per run and defaults to
STANDARD.

One caveat: **building** UE wants ~16 vCPU, streaming does not. Either use
`GCP_BUILD_MACHINE_TYPE=g2-standard-16` for the build and drop back, or build
once and keep the disk.

## Cost protection

A forgotten GPU VM is the most expensive mistake available here, so the startup
script installs a watchdog **before** the long build, not after:

- stops the VM at `GCP_MAX_RUNTIME_MIN` (default 240)
- stops it after `GCP_IDLE_SHUTDOWN_MIN` (default 30) with no established
  connection to the signalling port — nobody watching a GPU that still bills
- `preflight` refuses to plan a second instance named `$GCP_INSTANCE_NAME`
- `preflight` refuses `GCP_GPU_COUNT > 1` without a deliberate override

It **stops** rather than deletes. Compute billing ends either way and stopping
keeps the disk, which holds the built engine, the packaged game and the
generated textures — all expensive to rebuild. Deleting stays a human act.

## What is genuinely different from Vast

| | Vast | GCE |
|---|---|---|
| NVIDIA driver | host supplies it via the container runtime | **ours** — boot a CUDA image and verify |
| the Epic UE image | *is* the environment | a container we run with `--gpus all` |
| ports | discrete mapped ports | firewall rules on a network tag |
| address | rented SSH proxy | external IP on the instance |
| idle cost | founder watches it | the watchdog above |

The startup script fails closed on the first of these: no working `nvidia-smi`
means it refuses to start the streamer at all, because a Pixel Streaming host
that cannot encode comes up, accepts a viewer and sends nothing — worse than
being down, and much harder to diagnose.

## Not done here — and why

Nothing has been provisioned. `gcloud` is not installed on the authoring machine
and there are no Google credentials, so authentication, project selection,
billing and GPU quota are all unverified. Those are yours to clear:
`gcloud auth login`, `gcloud auth application-default login`, pick a project,
and request GPU quota — new projects ship with **zero** and only Google can
raise it. `preflight` checks every one of them and names the exact fix.
