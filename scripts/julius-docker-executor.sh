#!/bin/bash
set -u
set +e
readonly command_text=${1:?missing command}
readonly receipt_dir="/julius-receipts-root/${JULIUS_EXECUTION_TOKEN:?}"
readonly stage_file="$receipt_dir/executor.stage"
tree_digest() { (cd /workspace && find . -xdev \( -type f -o -type l \) -print0 | sort -z | while IFS= read -r -d '' path; do printf '%s\0' "$path"; stat -c '%f' -- "$path" 2>/dev/null; if test -L "$path"; then readlink -- "$path"; else sha256sum -- "$path" 2>/dev/null; fi; done) | sha256sum | cut -d' ' -f1; }
# A failed rm leaves the temporary aliased to the sealed target, which is harmless: ln refuses a target
# that already exists, so no later call can rewrite what was sealed through the surviving name.
durable_move() { local source=$1 target=$2; sync -f "$source" || true; ln -- "$source" "$target" || return 1; rm -f -- "$source" || true; sync -f "$target" || true; sync || true; }
stage() { printf '%s\n' "$1" > "$stage_file.tmp" || return 1; sync -f "$stage_file.tmp" || true; mv -f -- "$stage_file.tmp" "$stage_file" || return 1; sync -f "$stage_file" || true; sync || true; }
readonly started_at=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
readonly pre_tree=$(tree_digest)
printf 'receiptVersion=1\nphase=BEFORE\nmanifestDigest=%s\ninvocationId=%s\ndispatchGeneration=%s\nsandboxId=%s\ntenantDigest=%s\nprojectDigest=%s\nrunDigest=%s\ntaskDigest=%s\nworkerDigest=%s\ntoolId=%s\ntoolVersion=%s\nrequestDigest=%s\npolicyDigest=%s\nleaseGeneration=%s\nimageDigest=%s\nexecutorIdentity=%s\npreTreeDigest=%s\nstartedAt=%s\n' "$JULIUS_MANIFEST_DIGEST" "$JULIUS_INVOCATION_ID" "$JULIUS_DISPATCH_GENERATION" "$JULIUS_SANDBOX_ID" "$JULIUS_TENANT_DIGEST" "$JULIUS_PROJECT_DIGEST" "$JULIUS_RUN_DIGEST" "$JULIUS_TASK_DIGEST" "$JULIUS_WORKER_DIGEST" "$JULIUS_TOOL_ID" "$JULIUS_TOOL_VERSION" "$JULIUS_REQUEST_DIGEST" "$JULIUS_POLICY_DIGEST" "$JULIUS_LEASE_GENERATION" "$JULIUS_IMAGE_DIGEST" "$JULIUS_EXECUTOR_IDENTITY" "$pre_tree" "$started_at" > "$receipt_dir/before.receipt.tmp"
durable_move "$receipt_dir/before.receipt.tmp" "$receipt_dir/before.receipt" || exit 125
printf 'BEFORE_DURABLE\n' > "$stage_file" || exit 125
sync || true
# The trusted control plane must sign the durable BEFORE fact before the
# untrusted command is permitted to start. A missing acknowledgement is a
# fail-closed executor failure, never permission to continue unsigned.
if test "${JULIUS_ATTESTATION_REQUIRED:-0}" = 1; then
  for _ in $(seq 1 200); do test -f "$receipt_dir/before.attestation" && break; sleep 0.05; done
  test -f "$receipt_dir/before.attestation" || exit 125
fi
readonly start_ms=$(date +%s%3N)
stage COMMAND_STARTING
set +e
(ulimit -f "$JULIUS_OUTPUT_BLOCKS"; /usr/bin/setpriv --reuid=65532 --regid=65532 --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all /bin/bash --noprofile --norc -lc "$command_text") > "$receipt_dir/stdout.tmp" 2> "$receipt_dir/stderr.tmp"
readonly exit_code=$?
# The container supervisor is uid 0. Every untrusted invocation process is uid 65532.
# Reap any daemonized descendants before measuring or sealing the workspace.
pkill -KILL -u 65532 2>/dev/null || true
for _ in 1 2 3 4 5; do pgrep -u 65532 >/dev/null || break; sleep 0.05; done
if pgrep -u 65532 >/dev/null; then exit 124; fi
set -e
stage COMMAND_EXITED
durable_move "$receipt_dir/stdout.tmp" "$receipt_dir/stdout"
durable_move "$receipt_dir/stderr.tmp" "$receipt_dir/stderr"
readonly end_ms=$(date +%s%3N)
readonly duration_ms=$((end_ms-start_ms))
# git reads configuration out of the workspace the untrusted command just wrote, and core.fsmonitor names a
# program git will run. It is therefore run as the unprivileged invocation user with a hermetic configuration,
# and the post-state digest is taken afterwards so it describes the tree this step leaves behind.
# `safe.directory` is required because the command runs as 65532 in a workspace it may not own, and the two
# hermetic settings above remove every other place that exception could come from. An empty result must not be
# ambiguous, so a refusal is recorded as a line rather than discarded: silence would be attested as "nothing changed".
(cd /workspace && GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null /usr/bin/setpriv --reuid=65532 --regid=65532 --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all git -c core.fsmonitor= -c core.hooksPath=/dev/null -c safe.directory=/workspace --no-optional-locks status --porcelain=v1 2>/dev/null) | head -n 100 | head -c 65536 > "$receipt_dir/changed-paths.tmp"
# The pipeline's status is `head`'s, which succeeds however the git leg fared. Only PIPESTATUS carries the
# fact the receipt is about to attest, and an empty list from a failed git must never read as "nothing changed".
if test "${PIPESTATUS[0]}" -eq 0; then changed_paths_available=1; else changed_paths_available=0; fi
readonly changed_paths_available
durable_move "$receipt_dir/changed-paths.tmp" "$receipt_dir/changed-paths"
readonly post_tree=$(tree_digest)
readonly stdout_digest=$(sha256sum "$receipt_dir/stdout" | cut -d' ' -f1)
readonly stderr_digest=$(sha256sum "$receipt_dir/stderr" | cut -d' ' -f1)
readonly changed_digest=$(sha256sum "$receipt_dir/changed-paths" | cut -d' ' -f1)
readonly output_bytes=$(($(wc -c < "$receipt_dir/stdout")+$(wc -c < "$receipt_dir/stderr")))
readonly result_digest=$(printf '%s\n%s\n%s\n%s\n%s\n%s' "$exit_code" "$duration_ms" "$stdout_digest" "$stderr_digest" "$post_tree" "$changed_digest" | sha256sum | cut -d' ' -f1)
readonly finished_at=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)
if test "$exit_code" -eq 0; then terminal_state=SUCCEEDED; else terminal_state=FAILED; fi
printf 'receiptVersion=1\nphase=AFTER\nmanifestDigest=%s\ninvocationId=%s\ndispatchGeneration=%s\nsandboxId=%s\nrequestDigest=%s\nexecutorIdentity=%s\nterminalState=%s\nexitCode=%s\ndurationMs=%s\nfinishedAt=%s\nstdoutDigest=%s\nstderrDigest=%s\npreTreeDigest=%s\npostTreeDigest=%s\nchangedPathsDigest=%s\nchangedPathsAvailable=%s\noutputBytes=%s\nexecutorResultDigest=%s\n' "$JULIUS_MANIFEST_DIGEST" "$JULIUS_INVOCATION_ID" "$JULIUS_DISPATCH_GENERATION" "$JULIUS_SANDBOX_ID" "$JULIUS_REQUEST_DIGEST" "$JULIUS_EXECUTOR_IDENTITY" "$terminal_state" "$exit_code" "$duration_ms" "$finished_at" "$stdout_digest" "$stderr_digest" "$pre_tree" "$post_tree" "$changed_digest" "$changed_paths_available" "$output_bytes" "$result_digest" > "$receipt_dir/after.receipt.tmp"
durable_move "$receipt_dir/after.receipt.tmp" "$receipt_dir/after.receipt"
# Likewise, do not report terminal execution until the control plane has
# durably signed the authoritative AFTER fact.
if test "${JULIUS_ATTESTATION_REQUIRED:-0}" = 1; then
  for _ in $(seq 1 200); do test -f "$receipt_dir/after.attestation" && break; sleep 0.05; done
  test -f "$receipt_dir/after.attestation" || exit 125
fi
stage AFTER_DURABLE
exit "$exit_code"
