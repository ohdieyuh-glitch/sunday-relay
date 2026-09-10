# The mission sandbox — how Julius engineers Sunday Relay without touching it

> **Julius must never write directly to trusted Sunday Relay main.** Every paid
> engineering mission runs: trusted SHA → isolated disposable sandbox → Julius
> works there and may break or repair it → verified candidate diff →
> worker-authored branch and PR → CI, provenance, review → only then main. A
> failed mission must be able to destroy its own sandbox without damaging the
> canonical checkout.

This document is how that rule is actually enforced, and what the enforcing
mechanism can and cannot do. **Every constraint below was measured against the
real code or run against the real binary; none is inferred.**

## The envelope a mission workspace has to fit

These are the executor's, not this document's. They were established before any
mission was designed around them, and a design that ignores one is a design that
fails part-way through a paid run.

| Constraint | Value | Where it is enforced |
|---|---|---|
| Workspace backing filesystem | **≤ 4 MiB** | `BETA_WORKSPACE_BYTES` in `workspace-provisioning.ts`; `assertEnforceableWorkspaceCeiling` refuses `total > workspaceBytes` |
| Network | **none** | `--network none` in the container args; `MEDIATED` throws `sandbox_mediated_network_unavailable` |
| Memory / CPU / pids | 128 MiB / 1 / 32 | `relay-bridge/julius/sandbox-limits.ts` |
| Wall clock, per command | **15 s** | same |
| Output, per command | 32 KiB | same |
| Coding agent's tools | `Read/Glob/Grep/Edit` — **`Write` denied** | `hosted-coding-agent/hosted-envelope.ts` |
| Sandbox image | `node:22-bookworm-slim` + util-linux, git, ca-certificates, procps | `.github/julius-live-images.sh` |

Three consequences follow, and they are what shaped the design:

1. **A Sunday Relay checkout cannot be the workspace.** It is orders of
   magnitude over 4 MiB and would be refused outright.
2. **`npm ci` cannot run.** No network. So no vitest, no TypeScript compiler,
   nothing from `node_modules` — a mission's test command must be satisfiable by
   the bare image.
3. **A worker cannot create a file.** `Write` is denied, and `git diff` never
   reports an untracked file anyway. Deliverables must be seeded and committed
   so the worker EDITS them.

## What the sandbox actually is

A **4 MiB tmpfs** holding a **fresh git repository**, mounted per mission and
unmounted and deleted by the workflow afterwards. The canonical checkout is
never mounted into the sandbox, never written by it, and never at risk from it.
`assertUnrenameableAncestry` additionally refuses a workspace whose parents the
sandbox user could rename out from under the mount.

A mission seeds that repository one of two ways, and **exactly one**; a mission
declaring both is refused, because then nothing could say what the coder was
editing.

### Throwaway-tree mode — `workspace/`

The original mode, used by live missions 1–3. The mission ships its own small
tree of invented files. Right for a mission whose subject is a self-contained
problem (Live Run 3's `path-scope.js` was four files). Its diff applies to
nothing outside itself, which is fine, because nothing outside itself is meant
to change.

### Slice mode — `slice.txt`

For a mission whose subject **is Sunday Relay**. The mission declares
repository-relative paths, one per line, and the provisioner materialises them
with `git archive <trusted sha> -- <paths>`.

- **From a revision, never the working tree.** A dirty runner cannot leak an
  uncommitted file into a paid mission, and the slice is exactly what that SHA
  says it is.
- **Paths are validated as data.** An absolute path, a `..` segment or a glob is
  refused before git sees it, so a mission can only name paths inside the
  repository.
- **Sized before it is written.** The tmpfs would refuse an oversized slice too,
  but as an ENOSPC part-way through an extraction. Naming the slice and its
  byte count is a refusal someone can act on.
- **Repository-relative paths are preserved.** This is the point of the mode:
  a diff taken in the sandbox names `src/relay/…` and applies to Sunday Relay.

### Why the sliced files are byte-identical, and what it buys

A mission's entire output is `git diff` over its workspace. If provisioning
rewrote anything on the way in — import specifiers being the obvious temptation
— those rewrites would ride along in the diff, the patch would not apply to the
repository it came from, and nobody could separate a worker's change from the
harness's.

So nothing is rewritten. Instead the seed carries two dependency-free files
under `.julius/` (`resolve.mjs`, `loader.mjs`, from
`.github/julius-mission-slice/`) which teach Node the extensionless relative
imports Relay writes. They live outside every repository path a slice can name,
so they cannot shadow a real file, and they are committed in the seed, so the
diff reports them only if a worker changes one.

The test command becomes
`node --import ./.julius/loader.mjs --test <paths>`.

## Verified, by running it

Against `node:22`'s real behaviour and this repository's real files:

| Claim | Result |
|---|---|
| Node 22 runs `.ts` under `node --test` with no flag, no dependency, no network | **yes** — type stripping is on by default in 22.22.2 |
| Real, unmodified Relay domain source runs that way | **yes** — `julius-cost-accounting.ts` under `node --test`, 1 pass |
| Extensionless relative imports resolve through the seeded loader | **yes** — with the sliced file byte-identical to the repository's |
| A two-file slice fits the ceiling | 20,480 bytes against 4,194,304 |
| The whole Julius production domain would fit | 517,031 bytes across 37 files |
| The Project Brain surface would fit | ~283 KB across 10 files |
| **A diff taken in the sandbox applies to Sunday Relay** | **`git apply --check` clean**, and correctly refused when reversed |

## The one syntax rule a slice must obey

Type stripping erases types; it does not compile TypeScript. **Parameter
properties (`constructor(private readonly x: T)`), `enum` and `namespace` are
not erasable** and will fail to load.

Swept across the 37 Julius production files: **five** use parameter properties —
`julius-execution-coordinator.ts`, `julius-router.ts`, `julius-runtime-api.ts`,
`julius-tool-settlement.ts`, `julius-tools.ts`. No `enum` and no `namespace`
anywhere. Of the ten files making up the Project Brain surface, exactly one
(`julius-runtime-api.ts`) is affected.

A slice containing one of those five needs the mission's test command to reach
the module some other way, or the file to be excluded. This is a real limit and
it is written down rather than discovered during a paid run.

## What this does NOT give a mission

Stated plainly, because the tempting summary is stronger than the truth:

- **The sandbox cannot run Relay's own test suite.** No `node_modules`, and 15 s
  per command against a suite that takes 12–16 minutes. The full suite runs in
  **CI, after** the worker branch is pushed — which is exactly where the
  founder's pipeline puts it, and is why the sandbox never needed to.
- **The sandbox has no database.** A mission whose subject needs PostgreSQL must
  be expressed against the pure domain, which is where Relay's mission logic
  lives anyway.
- **A slice is not the repository.** A worker sees only the files the mission
  named. Anything it needs to read must be in `slice.txt`.
- **A green sandbox run is not a green repository.** The candidate diff has
  proven only what the mission's own test command proves. CI, the boundary
  scanners, typecheck and the drills are the gate, and they run after.
