# Wonderland — UE 5.8 build host

**AUTHORED, NOT RUN.** No Unreal Engine exists in the build environment (this box
is a 2-core Chromebook with no GPU). This documents exactly how the future GPU
build host produces the packaged Wonderland the streaming instance serves, and
the one Epic↔GitHub dependency that gates obtaining Unreal Engine.

## The Epic / GitHub dependency (the founder-only gate)

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

> **Host sizing — the first target is `g6e.xlarge` (4 vCPUs, 32 GB RAM, 1× L40S).**
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
-stage -pak -archive`. It compiles the Wonderland C++ module (parity-checked but
never yet compiled — expect first-build fixups against real UE 5.8 API
signatures, per `docs/relay/WONDERLAND.md` §12) and produces a staged Linux
client. Zip it, upload to S3, set `var.build_artifact_s3_uri`, and the instance
user-data downloads + launches it with Pixel Streaming.

## The content gap — honest and load-bearing

The Wonderland `.uproject` has **no level and no content** (`WONDERLAND.md` §11:
no `.umap`, geometry, lighting, materials, foliage, meshes, Dog rig, VFX). So:

- **Milestone 1** (prove a real UE frame streams from AWS) is served by
  `generate-hub-level.py` — an Editor-Python script (run by `build-wonderland.sh`)
  that procedurally builds a minimal but real `WonderlandHub` map (floor, sky
  atmosphere, sun, sky light, volumetric fog, PlayerStart, the Dog spawn, and
  placeholder landmarks composed per the reference). Enough for an actual frame.
- **Milestone 2** (the polished, AAA-grade Wonderland Hub matching the reference
  images) requires **actual environment art + level design in the Unreal Editor**
  on a GPU workstation. That is genuine artist/Editor work; it cannot be produced
  from this box and is not fully automatable. It is the isolated manual task the
  goal anticipates — everything around it (project, build, stream, integration) is
  automated and ready to receive it.

## GPU build host on AWS

The same G6e/L40S instance family the Terraform provisions can serve as the build
host once the EC2 GPU quota (L-DB2E81BA) clears. A larger root volume is needed
for a source build (~250 GB) vs the container path (~80 GB) — raise
`var.root_volume_gb` for a source build.
