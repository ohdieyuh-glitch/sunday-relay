#!/usr/bin/env bash
# Builds the two pinned images the first-live rig runs: the sandbox image the executor launches
# workloads in, and the executor image that holds the Docker CLI. Their digests are written as
# step outputs (`sandbox`, `executor`).
#
# ONE SCRIPT FOR THE MISSION AND FOR ITS REGRESSION. The first-live workflow calls this, and so
# does the provider-free `first-live-topology` job in julius-real-infra.yml, so what the
# regression builds and drives is byte-for-byte what the paid mission builds and drives.
set -euo pipefail
build=${JULIUS_CI_BUILD_DIR:-/tmp/julius-ci-build}
mkdir -p "$build"
cp scripts/julius-docker-executor.sh "$build/julius-executor"
printf '%s\n' 'FROM node:22-bookworm-slim' \
  'RUN apt-get update && apt-get install -y --no-install-recommends util-linux git ca-certificates procps && rm -rf /var/lib/apt/lists/*' \
  'COPY julius-executor /usr/local/bin/julius-executor' \
  'RUN chmod 0555 /usr/local/bin/julius-executor' > "$build/Sandboxfile"
# `docker build -q` prints a bare sha256 digest, which is what the adapter requires — it refuses
# any image reference that is not digest-pinned.
sandbox_image=$(docker build -q -f "$build/Sandboxfile" "$build")
printf '%s\n' 'FROM node:22-bookworm-slim' \
  'RUN apt-get update && apt-get install -y --no-install-recommends docker.io ca-certificates && rm -rf /var/lib/apt/lists/*' > "$build/Executorfile"
executor_image=$(docker build -q -f "$build/Executorfile" "$build")
echo "sandbox=$sandbox_image" >> "${GITHUB_OUTPUT:?missing GITHUB_OUTPUT}"
echo "executor=$executor_image" >> "$GITHUB_OUTPUT"
echo "sandbox_image=$sandbox_image"
echo "executor_image=$executor_image"
