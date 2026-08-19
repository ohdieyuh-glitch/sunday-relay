# Wonderland — UE 5.8 build host

**RUNNING.** UE 5.8.1 is built, the Wonderland C++ module compiles, the level
cooks and packages, and the packaged client streams to a real browser over Pixel
Streaming 2 from the California GPU host. Superseded: everything below used to
say "authored, not run", which stopped being true on 2026-08-19.

What is still true is that the *authoring* box is a 2-core Chromebook with no
GPU. Nothing in this pipeline is done in the Unreal Editor's GUI: the world is
generated head-lessly by `generate-hub-level.py`, its textures by
`gen-textures.py` and its audio by `gen-audio.py`, all of which run inside
`UnrealEditor-Cmd -run=pythonscript` on the build host.

| Stage | State |
|---|---|
| UE 5.8.1 on the build host | built |
| Wonderland C++ module | compiles (first build needed `AWonderlandPlayerController::OnPossess`, which was declared and never defined) |
| Level generation | runs head-lessly, ~30 s |
| Cook / stage / pak / archive | ~2 min incremental |
| Pixel Streaming to a remote browser | proven: H264 video, Opus audio, open data channel, input reaching the pawn |

## The Epic / GitHub dependency (done, kept for reprovisioning)

Unreal Engine is **not public**. To obtain it you must, once:

1. Have an **Epic Games account**.
2. **Link it to a GitHub account** — epicgames.com → Account → **Connections →
   GitHub → Connect**, then accept the emailed invite to join the **@EpicGames**
   GitHub organization. This grants access to the private
   **`github.com/EpicGames/UnrealEngine`** repo and the
   **`ghcr.io/epicgames/unreal-engine`** container images.
3. Accept the Unreal Engine EULA.

After linking, obtain UE 5.8 on the build host by **one** of:

- **Container (recommended, fastest).** From a GitHub PAT with `read:packages` on
  the Epic-linked account:
  ```bash
  echo "$GH_PAT" | docker login ghcr.io -u <github-user> --password-stdin
  docker pull ghcr.io/epicgames/unreal-engine:dev-5.8
  ```
  Run `build-wonderland.sh` inside that container with the project mounted.
- **Source build.** `git clone -b 5.8 git@github.com:EpicGames/UnrealEngine`, then
  `./Setup.sh` (downloads ~50 GB), `./GenerateProjectFiles.sh`, `make`. Slower
  (hours), needs ~200 GB disk.

> **Host sizing.** The AWS `g6e.xlarge` sizing below is the ORIGINAL plan and is
> not what runs today — the live host is a Vast.ai **RTX 6000 Ada (48 GB)** in
> California with 48 vCPUs, which is why the incremental cook takes ~2 minutes
> rather than the hours this paragraph warns about. Kept because the reasoning
> still applies to any 4-vCPU host.
>
> **Original AWS sizing — first target `g6e.xlarge` (4 vCPUs, 32 GB RAM, 1× L40S).**
> **Use the container path on this host, NOT the source build:** compiling the
> engine from source can exceed 32 GB RAM at link time. The container ships a
> prebuilt engine, so only the Wonderland **game module** compiles + cooks here —
> that fits 32 GB, but expect the first `-build -cook` to be **slow** on 4 vCPUs
> (a one-time cost; the idempotence stamp skips it after). If cook time is
> prohibitive, build/cook once on a larger temporary CPU instance and stream the
> packaged artifact on the `g6e.xlarge`; the GPU (L40S 48 GB) is identical either
> way, so the *runtime* frame is unaffected by the smaller build host.

> The PAT is a **secret**: the founder places it on the build host (or in AWS
> Secrets Manager) — never in this repo, a log, or chat. Identifying the linkage
> requirement is the non-secret action; performing it is founder-only.

## Building + packaging

`build-wonderland.sh` runs `RunUAT BuildCookRun … -platform=Linux -build -cook
-stage -pak -archive`. It compiles the Wonderland C++ module and produces a
staged Linux client, which the host launches directly with Pixel Streaming; the
S3 hand-off below is the AWS plan and is not in the current loop.

Two things about this script cost silent failures and are worth keeping in mind:

- **It re-runs `find` under `set -euo pipefail`.** GNU `find` restores its
  initial working directory when it finishes, so launching the build from a
  mode-700 directory the build user cannot read makes it exit 1 *with all its
  output correct*. The build then dies one line after the version check and
  reads exactly like a crash in the project. Launch with `env -C "$SRC"`.
- **It is idempotent on an input hash** that does not cover `infra/build/`, so
  edits to the generators alone will `SKIP`. Set `FORCE_REBUILD=1`.

## The content, and what "procedural" bought

The `.uproject` still ships no authored content. Everything in the world is
generated, and the generators are the art:

- **`generate-hub-level.py`** builds the whole `WonderlandHub` map from
  `WorldDesign/hub-layout.json` — sun, sky atmosphere, sky light, fog, post
  grade, the material library off one master, the Dog spawns, and every landmark
  as a kitbash of engine BasicShapes. Roughly twenty thousand static meshes.
- **`gen-textures.py`** synthesises the PBR set (cobble, ashlar, sward, bark,
  plaster, fish-scale roof) from integer hashes: albedo with contact shadow baked
  in, a Sobel normal off the same height field, and a roughness mask. Everything
  tiles. No third-party asset, nothing to license, identical on every rebuild.
- **`gen-audio.py`** synthesises the ambient loops and stingers the same way.

**The claim this section used to make — that Milestone 2 "cannot be produced
from this box and is not fully automatable" — is the opposite of what happened.**
It was produced from this box, head-lessly, and it is fully automatable; what it
needs is a build host to run on and a streamed frame to judge against, not an
Editor GUI. That correction matters because the old claim would have sent the
next reader looking for an artist instead of for the generator.

Where procedural authoring genuinely runs out is **surface detail that has to be
painted rather than derived** — hand-authored albedo art, alpha-cut foliage
cards, sculpted hero meshes. Free legal Epic/Fab/Quixel content is the intended
next step there, and is authorised; paid assets are not, without the founder.

### Iterating without a GPU

`generate-hub-level.py` reaches the engine through a small enough surface that
it runs against a stubbed `unreal` module on the authoring box. Two harnesses
make the art loop workable when the build host is unreachable:

- a **dry run** that executes the whole of `build()`, counts spawned actors and
  surfaces every generator warning — it catches NameErrors, bad signatures and
  accidentally-deleted code before a build cycle spends six minutes finding them;
- a **hero-frame preview** that projects every actor's oriented bounding box
  through `cam_arrival_hero`, ray-casts the ground planes and rasterises a PNG,
  and can report any landmark's on-screen box as a percentage of the frame.

Neither is a render — no lighting, shadows, normals or materials beyond base
colour — so the streamed California frame remains the only ground truth for how
the world LOOKS. What they answer is composition, which is measurable: the
preview is what found that the hero camera, at eye z=700 looking level, did not
open onto the ground until about 20 m out, so everything staged in the near
foreground was below the bottom edge rather than merely small.

## GPU build host

**Today: Vast.ai.** The live build-and-stream host is a California RTX 6000 Ada
instance; the Japan L40S instance that preceded it is stopped and preserved as a
fallback. Neither is described by the Terraform in `infra/`, which still targets
AWS and remains the plan of record for production.

**AWS (planned).** The same G6e/L40S instance family the Terraform provisions can
serve as the build host once the EC2 GPU quota (L-DB2E81BA) clears. A larger root volume is needed
for a source build (~250 GB) vs the container path (~80 GB) — raise
`var.root_volume_gb` for a source build.
