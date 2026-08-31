#!/usr/bin/env bash
# The executor answers 404 on GET /v1/execute once it is listening; anything else means it is not ready.
set -euo pipefail
for _ in $(seq 1 60); do
  if docker exec julius-executor node scripts/julius-executor-ready.mjs; then exit 0; fi
  sleep 1
done
docker logs julius-executor
echo 'executor_never_became_ready' >&2
exit 1
