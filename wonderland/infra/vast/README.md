# Wonderland — Vast.ai streaming infrastructure (the ACTIVE GPU path)

**AUTHORED, NOT RENTED.** No instance has been rented, no Unreal frame has
streamed, and no cost has been incurred. This is the reproducible *description*
of one founder-testable Pixel Streaming session on **Vast.ai** — SPECIFIED, not
PROVEN. The AWS Terraform/EC2 stack (`../terraform`, `../scripts`) is preserved
as **deferred/optional** infrastructure; nothing in the active path touches it.

## Why Vast

AWS denied the G/VT GPU quota, so the active provider is now **Vast.ai**, a live
marketplace of hourly GPU hosts. The founder selected a specific offer:

| field | value |
|---|---|
| offer id | `24964770` |
| GPU | 1× NVIDIA **L40S**, 46.1 GB VRAM |
| vCPU / RAM | 32 / 128.9 GB |
| disk available | 969 GB |
| price shown | **$0.6009/hr** |
| location / reliability | Japan / 99.8%, verified host |

The L40S (48 GB) is the same GPU class the AWS path targeted, so the visual
target is unchanged. The 32 vCPU / 128 GB is **far larger** than the AWS
`g6e.xlarge` (4/32) — large enough to **build UE on the instance**, which removes
the S3 artifact hop entirely (no AWS in the active path).

## The lifecycle

```
current best matching offer (selected live at rent-time — ids are ephemeral)
  → founder rent authorization (by hand — the boundary this tooling never crosses)
    → Vast instance launched FROM ghcr.io/epicgames/unreal-engine:dev-5.8
      → onstart bootstrap (vast-onstart.sh) — deps/config, in ONE container
        → acquire Wonderland source (mounted, WONDERLAND_REPO_URL, or a prebuilt artifact)
          → compile with the IN-IMAGE UE 5.8 (RunUAT at the detected UE_ROOT — NO docker pull, NO nested container)
            → generate Hub → cook/package → run packaged app + Pixel Streaming 2
              → WebRTC → Relay browser <video> (#/relay/wonderland)
```

**No docker-in-docker.** The Epic UE dev image *is* the execution environment;
the onstart detects the engine already in the container and builds with it. It
never pulls or launches a second container.

**Hardware floors vs preference.** Hard minimums (never selected below): L40S,
≥40 GB VRAM, ≥16 effective vCPU, ≥64 GB RAM, ≥200 GB disk, verified, enough direct
ports. **Preferred** (what the selector aims for): **32 effective vCPU, ~128 GB
RAM**, in `PREFER_GEO` (Japan) within `MAX_DPH`. If the preferred tier is briefly
unavailable it picks the best that still clears the floor and says so **loudly** —
never a silent downgrade.

Reused unchanged from the existing Wonderland work: `build-wonderland.sh`, the
Hub generator (`generate-hub-level.py`), the Relay↔Unreal bridge, the Pixel
Streaming client (`src/relay/ui/wonderland/`), the stream lifecycle + session
seam (`wonderland-session*.ts`), world projection, the Wandering systems, the
first-frame evidence bundle, and the quality/release gates.

## Operator commands — `wonderland-vast.sh`

Same three authorization boundaries as the AWS `wonderland.sh`:

```bash
# READ-ONLY (run now; charges nothing):
./wonderland-vast.sh preflight     # CLI auth, offer rentable, hardware/ports/disk/balance, no conflict
./wonderland-vast.sh offer         # is offer 24964770 still rentable + meeting minimums?
./wonderland-vast.sh balance       # account credit, if observable
./wonderland-vast.sh status        # our rented instance(s) + how to read mapped ports
./wonderland-vast.sh health <id>   # probe the signalling endpoint
./wonderland-vast.sh logs <id>     # instance logs
./wonderland-vast.sh ssh <id>      # direct-SSH url

# PAID-RENT (plan-only — PRINTS the command; you run it BY HAND = authorization):
./wonderland-vast.sh create        # preflight, then emit the exact `vastai create instance ...`

# LIFECYCLE on an already-rented instance (execute directly):
./wonderland-vast.sh start   <id>  # resume — RESTARTS hourly billing
./wonderland-vast.sh stop    <id>  # halt hourly billing
./wonderland-vast.sh destroy <id>  # irreversible delete (also halts billing); asks to confirm
```

`create` **never rents.** It runs preflight and prints the `vastai create
instance` command for you to run yourself — running it by hand IS the
authorization this script deliberately does not cross (the same boundary the AWS
`apply` keeps).

## Prerequisites (founder-side, one time)

1. **Vast account + API key:** `pip install --upgrade vastai` then
   `vastai set api-key <KEY>` (stored in `~/.vast_api_key`; this repo never reads
   or logs it).
2. **Private Epic image access** for the build-on-instance path: an Epic account
   linked to GitHub (grants `ghcr.io/epicgames/unreal-engine`), and a **GitHub
   classic PAT with `read:packages`**. It is passed to `vastai create ... --login`
   at rent time via **shell variables** — `create` emits
   `--login "-u $GHCR_USER -p $GHCR_PAT ghcr.io"`, so you `export GHCR_USER=…` and
   `export GHCR_PAT=…` in your own shell and the PAT is **never printed, logged, or
   written to the repo**. (See `../build/README.md`.)
   *Alternative:* set `BUILD_URL=<https url>` to a pre-built Linux artifact and a
   generic CUDA image instead — no Epic login needed.

The onstart is passed as **content**, not a filename: the emitted command uses
`--onstart-cmd "$(cat …/vast-onstart.sh)"`, which is the interface vastai 1.5.4
documents for ssh/direct launch types. The script carries no secret, so `cat`-ing
it is safe.

## Ports (why they differ from AWS, and the real count)

Vast maps **discrete** host ports, not EC2's 16k-wide UDP range, so the plan opens
**only what Pixel Streaming 2 + TURN + SSH actually need** — **14 direct ports**
by default:

| purpose | port(s) | proto | count |
|---|---|---|---|
| direct SSH | (Vast-assigned by `--ssh --direct`) | tcp | 1 |
| WSS signalling | `443` | tcp | 1 |
| STUN/TURN | `3478` | tcp + udp | 2 |
| WebRTC media (pinned window) | `50000–50009` | udp | 10 |
| certbot HTTP-01 | `80` | tcp | +1 **only if** a TLS domain is set |

`REQUIRED_PORTS` is computed as `1 (ssh) + 1 (443) + 2 (3478) + WEBRTC_UDP_COUNT +
(80 only with a domain)` = **14** for the self-signed default, 15 with a domain.
UE Pixel Streaming is launched with `-PixelStreamingWebRTCMinPort=50000
-PixelStreamingWebRTCMaxPort=50009` and coturn's `min-port/max-port` match, so all
media stays inside the opened window. Preflight verifies the offer's
`direct_port_count` covers `REQUIRED_PORTS` (the Japan host has 256). Widen with
`WEBRTC_UDP_COUNT=<n>` for more concurrent peers. External ports Vast assigns are
read from `vastai show instances` after rent; point
`VITE_WONDERLAND_SIGNALLING_URL` at `wss://<host>:<mapped-443>`.

## TLS / WSS

The browser runs on `https://sunday-relay.vercel.app`, so mixed-content rules
forbid `ws://` — signalling must be `wss://`. The onstart terminates TLS on 443:
set `WONDERLAND_SIGNALLING_DOMAIN` (DNS pointed at the host) for a real certbot
cert, or accept the auto-generated **self-signed** cert once for a first-frame
proof.

## Cost controls

- **Instance ceiling: 1.** Enforced by the `wonderland-stream` label; preflight
  refuses `create` when a labelled instance already exists.
- **STOP vs DESTROY — two different bills.** `stop` ends the **compute** bill but
  **storage keeps billing** (the container disk is retained so you can resume).
  `destroy` ends **both** — it deletes the instance *and its disk*, so it is the
  only way to stop paying entirely. Rule of thumb: `stop` for a short break,
  `destroy` when the session is truly over. Both messages in the CLI say which.
- **Instance ceiling stays 1** (the `wonderland-stream` label); there is no
  autoscaler and no forgotten-GPU tail beyond one instance.
- **No idle CloudWatch alarm** (that was AWS-only). The onstart logs idle; the
  operator `stop`s or `destroy`s when done.
- **Expected rate:** the offer shows **$0.6009/hr** — confirm against the live
  `offer` output before renting; a marketplace price can move.

## Offer ids are EPHEMERAL — the tool selects at rent-time (proven live)

Vast **re-issues the ask-id on almost every query**. Probed live against this
account, the founder's Japan L40S host appeared as `24964770`, `24964771`,
`24964709`, `24964750`, `24964753` across consecutive searches seconds apart — the
same machine, a new id each time. A **pinned id is stale by rent time**, so
`24964770` (the founder's original) is best read as a *reference to the machine
profile*, not a durable handle.

So the tooling never pins an id. `preflight`, `offer`, and `create` **select the
current best offer** matching the profile at that instant — `gpu_name=L40S`, every
Wonderland minimum, preferring `PREFER_GEO` (default `Japan`) within `MAX_DPH`
(default `$0.70`), else the cheapest match, **never below the minimums** (no silent
downgrade). `create` prints a command carrying a *just-selected* id plus a warning
to run it promptly; if the id has drifted by the time you run it, Vast errors and
you simply re-run `create` for a fresh one.

- `./wonderland-vast.sh offer` — show the current pick + cheapest alternatives.
- `OFFER_ID=<id> ./wonderland-vast.sh create` — honour a specific id **only if it
  is still listed**, else fall through to the current best with a notice.
- The underlying profile search (also what `offer` runs) is:
  ```bash
  vastai search offers 'gpu_name=L40S num_gpus=1 gpu_ram>=40 disk_space>=200 cpu_cores>=8 direct_port_count>=15 reliability>0.98 rentable=true verified=true' -o 'dph'
  ```

## Still unproven

No instance has been rented, no Unreal frame has streamed, no cost has been
incurred, and the exact **Pixel Streaming 2** signalling entrypoint + launch
flags for UE 5.8 must be confirmed against the plugin on first real run (the PS2
signalling server differs from the PS1 `cirrus.js` shown; `vast-onstart.sh` notes
this). The runtime session provider (`wonderland-session-provider.ts`) still
returns `unavailable` until a real Vast-backed provider is wired to this stack.
