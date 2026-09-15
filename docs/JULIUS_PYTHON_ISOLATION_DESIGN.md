# Hostile Python: the isolation design for `python.run`

Status: **DESIGN. Not built, not composed.** `python.run` is not exposed to any
live Julius worker, and must not be until every proof in
[The isolation proof](#the-isolation-proof-the-gate) passes on real
infrastructure.

## What exists today, stated plainly

**The governed host runner** (`src/relay/workspace/julius-tools/python-runner.ts`)
is what the Brain + Python proofs on this branch exercise. It builds the child
environment from nothing, bounds and redacts streams, applies OS limits (a
Windows Job Object, or POSIX rlimits), kills the process tree, and installs a
permanent audit hook for network, process creation, native loading and file
access. It records its enforcement as `PYTHON_AUDIT_HOOK`.

**The audit hook is not an isolation boundary.** It governs cooperative and
buggy code. Code written to escape it can do so (`_guard.py` says the same).
Nothing in this branch claims otherwise, and the host runner must never run
untrusted code in a live deployment.

**The executor sandbox** (`src/relay/workspace/julius-tools/docker-sandbox-adapter.ts`,
`scripts/julius-docker-executor.sh`, the control plane in
`executor-control-plane-service.ts`) is the real boundary Julius already has.
Each property below is proven against real Docker in the CI evals phase
(`.github/workflows/julius-real-infra.yml`, `scripts/julius-provider-independent-evals.ts`):

- **Container:** `--read-only`, `--network none`, `--cap-drop=ALL`,
  `no-new-privileges`, and a `noexec` tmpfs at `/tmp`.
- **Workload identity:** the workload drops to uid 65532 with no capabilities
  (`setpriv`). Proven: CapEff=0 and NoNewPrivs=1.
- **Limits:** pids, memory, CPUs and nofile. Proven: an OOM kill, a refused
  fork storm, and bounded output.
- **Termination:** a timeout kills the whole container (`docker kill -s KILL`),
  then verifies it is no longer running. Proven: daemonised descendants die.
- **Receipts:** two-phase BEFORE/AFTER receipts, signed with an Ed25519 key
  Julius never holds. Forged and replayed receipts are rejected.
- **Filesystem and tenancy:** no Docker socket inside, the receipt store is
  unreadable by the workload, and cross-tenant mounts are refused.

The executor today has these gaps, and each one matters for Python:

| Gap | Where |
|---|---|
| The image is `node:22-bookworm-slim` with **no Python**, defined inline twice, base not digest-pinned | `.github/julius-live-images.sh`, `julius-real-infra.yml` |
| The only operation is "command string → bash" | adapter `executeProcess`, executor script |
| **No artifact channel** (`collectArtifacts` returns `[]`) | adapter |
| `MEDIATED` network throws; there is no allowlist or proxy | adapter |
| The C.A.R.D. `network: boolean` is **never translated** into sandbox policy (executor effects hard-code DENY) | `relay-bridge/julius/executor-effects.ts` |
| No mechanism to pass a secret into a sandbox | adapter `create`/`exec` pass no secret env |
| Receipts do not attest the Docker flags actually applied, nor no-egress | `executor-terminal-receipt.ts` |
| Cancel works only from the process that started the run (in-memory map) | adapter |
| Development mode runs the workload as uid 0 without `setpriv` | adapter |
| `python.run` is not a `JuliusToolId` | `julius-tools.ts`, `execution-envelope.ts`, `registry.ts`, `sandbox-limits.ts` |

## Decision

`python.run` runs **on the executor, as a new operation of the existing
sandbox**, not as a second sandbox beside it. The executor already carries
tenancy, the durable ledger, signed receipts, container-level termination and
real isolation proofs. A parallel Python sandbox would duplicate all of that and
drift from it.

The Python service (`julius-python-service.ts`) does not change shape. It
already takes a `JuliusPythonRunnerPort`. A `ContainerJuliusPythonRunner`
implements that port by calling the executor control plane. Authorization,
the Brain snapshot, staged proposals, atomic settlement, cancellation via the
durable `CANCEL_REQUESTED` state, and the budget stay where they are.

```
Julius ── JuliusPythonExecutionService ── (port) ── ContainerJuliusPythonRunner
              │  authorise (C.A.R.D.)                      │ HTTPS, scoped credential
              │  snapshot (state mode)                     ▼
              │  settle atomically             executor control plane (ledger, attestor)
              ▼                                            │ docker create / exec
         Project Brain                         python sandbox container (one per execution)
                                                 uid 65532, no caps, no network,
                                                 read-only root, tmpfs workspace
```

## The design

### 1. Image

- **A separate `julius-python-sandbox` image**, so the bash tool's image
  surface does not grow.
  - It is built from a **checked-in Dockerfile**, which also replaces the two
    inline `printf` copies for the existing image.
  - Its base is pinned **by digest** (e.g. `python:3.12-slim-bookworm@sha256:…`).
    The adapter already refuses a sandbox image that is not digest-pinned.
- **Contents:**
  - CPython 3.12.
  - The `relay-python/julius` SDK, read-only at `/opt/julius/sdk`, with its
    tree hash recorded as an image label.
  - The executor supervisor script.
  - No compiler, no package manager usable by uid 65532, no setuid binaries
    beyond what the base carries (the proof enumerates them).
- **Environments are built, never installed at run time.** An environment spec
  (exact pins, the hash `materializeJuliusPythonEnvironment` already computes)
  becomes an image `julius-python-env:<specHash>@sha256:…`, built offline from
  the wheelhouse.
  - The execution request names the environment. The registry resolves it to
    a digest.
  - An unresolvable environment is **DENIED**, never substituted.
  - `pip` is absent from the runtime path.

### 2. One container per execution

- `docker create … sleep infinity`, then `docker exec` into the supervisor.
  This is the existing lifecycle, but **the container is never reused**: it is
  destroyed after settlement. Nothing a script leaves in `/tmp`, in memory, or
  in a background process survives into the next execution.
- **Supervisor (root, the existing four capabilities):**
  1. Lays out `/workspace/{script,inputs,work,out,control}` on a **tmpfs**. No
     host bind for Python.
  2. Receives the request bundle.
  3. Seals the BEFORE receipt.
  4. Runs the interpreter under
     `setpriv --reuid=65532 --regid=65532 --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all`
     with `python -I` (isolated mode: ignores `PYTHON*` variables and the user
     site). The runner sets `sys.path` explicitly to the SDK and the
     environment.
  5. Kills all uid-65532 processes.
  6. Builds the artifact manifest.
  7. Seals the AFTER receipt.
- **The audit hook stays as defence in depth**, and is recorded as exactly that.
- **Development mode may never serve `python.run`.** The adapter refuses the
  operation unless the durable, `setpriv` path is active.

### 3. Inputs and outputs without host paths

- **In:** the script, JSON inputs, input files and the Brain evaluation snapshot
  travel as **one tar stream on `docker exec -i` stdin**. The supervisor
  extracts it into tmpfs, so no host directory is mounted.
  - The bundle digest is part of the execute envelope's request digest, so the
    control plane recomputes it rather than trusting it.
  - `docker cp` is not used: it cannot write into a tmpfs.
- **Out — the missing artifact channel:**
  1. After the run, the supervisor walks `/workspace/out`. It refuses symlinks,
     devices and anything outside, and bounds file count and bytes.
  2. It hashes each file and writes a manifest (name, size, sha256). The
     manifest digest goes into the **signed AFTER receipt**.
  3. `collectArtifacts` streams the files back over `docker exec` stdout,
     bounded.
  4. The host verifies each file against the signed manifest, then stores it
     content-addressed (`cas://sha256/…`), as the host runner does today.
  5. A file that does not match is **quarantined, never admitted**.
- **Secret scan and redaction stay host-side**, unchanged: credential-shaped
  content in streams or artifacts is redacted and counted, and an artifact
  holding a granted literal is quarantined.

### 4. Network: default deny, allowlist only by C.A.R.D. grant

- **Default: `--network none`**, exactly as today. The proof runs with the
  audit hook **disabled**, to show the container denies on its own.
- **Allowlist**, only when C.A.R.D. grants it for this invocation:
  1. **The card changes shape.** `network: boolean` becomes a scoped egress
     grant: `{ host, port }[]`, per invocation, with an expiry.
     `ACCESS_NETWORK` continues to gate it. `executor-effects.ts`'s hard-coded
     DENY is replaced by translating the grant, and a grant that cannot be
     enforced is **DENIED, never silently downgraded or widened**.
  2. **Enforcement is structural, not in-process.** The container joins a
     per-execution `--internal` Docker network (no default route). Its only
     peer is an **egress proxy** owned by the executor.
     - The sandbox has no DNS server. The proxy resolves names.
     - The proxy admits `CONNECT host:port` only for the invocation's grant,
       and re-checks the resolved address. It refuses IP literals, private,
       link-local and metadata ranges unless named explicitly, and DNS answers
       that change mid-connection.
     - Each connection attempt, admitted or refused, is logged with the
       invocation identity.
     - Counts and a log digest go into the AFTER receipt.
  3. **Until that proxy exists and its proof passes**, an `ALLOWLIST` request is
     DENIED with `NETWORK_ALLOWLIST_UNAVAILABLE`. `MEDIATED` keeps throwing.

### 5. No database, no socket, explicit secrets only

- **No database or Docker access.** No `DATABASE_URL`, no Docker socket and no
  provider key are ever in the sandbox's `create` or `exec` environment. This
  holds today and becomes a proof item. The Brain reaches a script only as the
  hashed, mode-selected snapshot. Writes are staged proposals that Julius admits
  at settlement.
- **Secrets:**
  - **Only** C.A.R.D.-granted `secret:<id>` values.
  - Resolved by the control plane at execute time and delivered inside the
    stdin bundle, never as `--env` (which is visible to `docker inspect` and
    the host process list).
  - The supervisor places each value in the setpriv child's environment only.
    It is never written to disk and never included in a receipt. Receipts carry
    the granted capability ids and nothing derived from the value.
  - After the run, host-side redaction scrubs the literal from streams and
    artifacts, as today.

### 6. Limits

| Resource | Mechanism | Python default (proposal) |
|---|---|---|
| Memory | `--memory` with `--memory-swap` equal (no swap) | 1 GiB |
| CPU | `--cpus` | 1 |
| Processes and threads | `--pids-limit` (threads count) | 64 |
| Open files | `--ulimit nofile` | 1024 |
| Disk | tmpfs `size=` on `/workspace` and `/tmp`; `ulimit -f` | 64 MiB / 16 MiB |
| Output | host-bounded stream reader (existing) | request limits |
| Wall clock | `min(request.timeoutMs, policy)`, then container kill | request limits |

The live values belong in `relay-bridge/julius/sandbox-limits.ts`, next to the
bash tool's, and the validator's bounds apply.

### 7. Termination and cancellation

- **Timeout, lost lease or host error:** `docker kill --signal KILL` of the
  container (the whole cgroup, not a guessed process tree), then require
  `State.Running == false` or report `sandbox_hostile_process_survived`. This
  is the existing adapter path.
- **Cancel from any process.** The service already records `CANCEL_REQUESTED`
  durably. The executor gains a **cancel-by-identity** operation that finds the
  container by its `julius.invocation` label, so a cancel works from a
  control-plane process that did not start the run. The result of a cancelled
  execution is discarded at settlement (existing).
- **Always destroyed.** After settlement the container is removed with
  `docker rm -f --volumes`.

### 8. What an execution records

- **The receipt link.** The `PYTHON_EXECUTION` record gains the executor
  receipt id and the attestor's public-key fingerprint.
- **Attested flags.** A new attested field is `sandboxPolicyDigest`: the
  attestor (the executor service, outside the workload container) reads the
  sandbox's actual `HostConfig` with `docker inspect` and signs its digest, so
  a receipt proves the flags that were applied, not the flags intended.
- **Enforcement names only what that execution's receipt proves.** For example:
  `CONTAINER_NETWORK_NONE`, `CGROUP_LIMITS`, `UID_65532_NO_CAPS`,
  `READ_ONLY_ROOT`, `FRESH_CONTAINER`, `PYTHON_AUDIT_HOOK`. An execution on the
  host runner keeps recording `PYTHON_AUDIT_HOOK` alone.

### 9. Registration

Adding `python.run` touches all of these places:

- **`JuliusToolId`** (`julius-tools.ts`).
- **The duplicated `TOOL_IDS`** (`execution-envelope.ts`).
- **The registry** (`registry.ts`): a PYTHON kind, HIGH risk, and
  `accessesNetwork` derived from the grant rather than always true.
- **`allowedTools`** for the Python sandbox policy (`sandbox-limits.ts`, and
  its test).
- **The adapter**, which dispatches per tool (structured request for
  `python.run`, `command` string for `shell.bash`).

The database `tool_id` is free text and the receipt id grammar already accepts
`python.run`.

## Threat model

**In scope.** The script's author is hostile: model-generated code under prompt
injection, or tenant-supplied code. The goals are:

- no egress except what C.A.R.D. granted;
- no host filesystem, Docker socket, database or other tenant;
- no secret beyond those granted to that execution;
- bounded resources;
- guaranteed termination;
- no state carried into another execution;
- no forged result.

**Out of scope for this tier.** An escape through the shared Linux kernel (a
container is not a VM). Before `python.run` serves **untrusted multi-tenant
code in production**, the sandbox should run under gVisor (`--runtime=runsc`)
or in a microVM (Firecracker/Kata). Every property above holds unchanged there,
and the proof below is rerun under that runtime. This design does not claim
kernel-level containment.

## The isolation proof (the gate)

All items run on **real Docker on Linux** (the `julius-real-infra` evals phase),
with the Python audit hook **disabled**. A Windows workstation does not count.

**Identity and filesystem**

1. The interpreter runs as uid 65532 with CapEff=0 and NoNewPrivs=1.
   `os.setuid(0)` and `ctypes` `setuid(0)` both fail.
2. Writes to `/`, `/usr`, `/opt/julius` and the image are refused. The receipt
   root is unreadable. `/var/run/docker.sock` is absent. `/proc/1/environ` is
   unreadable, or holds no secret and no `DATABASE_URL`.
3. No host path is visible. A symlink dropped in `out/` is refused by the
   manifest.

**Network (default)**

4. `socket.create_connection` to an IP literal fails. DNS resolution of a public
   name fails. A raw socket fails. `urllib` to a public URL fails. Each failure
   is a kernel refusal, not an audit-hook exception.

**Resources**

5. A memory bomb is OOM-killed and settles FAILED with an OOM reason.
6. An `os.fork` storm and a thread storm are refused by the pids limit.
7. Filling `/workspace` and `/tmp` hits ENOSPC within the tmpfs size.
8. An output flood is bounded.
9. A CPU spin times out, the container is killed, the execution settles
   TIMED_OUT, and no container with its invocation label remains.
10. A double-forked, `setsid`, SIGTERM-ignoring daemon dies with the container.

**Cancellation**

11. A cancel issued by a different control-plane process kills the run. The
    result is discarded.

**State**

12. A file left in `/tmp` and a background process from execution A are absent
    in execution B.

**Secrets**

13. A granted secret is readable by that execution only. An ungranted one is
    absent.
14. The value never appears in stdout, stderr, artifacts, the receipt, the
    Brain, or `docker inspect` of the sandbox.

**Integrity**

15. A tampered artifact (bytes differ from the signed manifest) is quarantined.
16. A forged or replayed receipt is rejected.
17. `sandboxPolicyDigest` matches the applied `HostConfig`.

**Allowlist (only once the proxy exists)**

18. A granted `host:port` succeeds. Each of these is refused and logged: another
    host, another port, an IP literal, a name resolving to a private or
    metadata address, a DNS answer changed after admission, and direct egress
    that bypasses the proxy (no route).

Only when 1–17 pass does `python.run` become exposable, with network DENY. Item
18 gates `ALLOWLIST`.

## Order of work (after qualification)

1. Checked-in Dockerfiles, digest-pinned bases, and the environment-image build
   from the wheelhouse.
2. The supervisor Python operation, the stdin bundle, and the signed artifact
   manifest with `collectArtifacts`.
3. `ContainerJuliusPythonRunner` implementing `JuliusPythonRunnerPort`, and
   cancel-by-identity.
4. Attested `sandboxPolicyDigest`; enforcement recorded from the receipt.
5. Proof items 1–17 in the real-infra evals.
6. Tool registration and C.A.R.D. translation (network DENY only).
7. Egress proxy and the egress grant shape, then proof item 18, then
   `ALLOWLIST`.
8. gVisor or microVM runtime and a rerun of the proof, before untrusted
   multi-tenant use.
