# Relay Workspace Security (Prompt 7) — Isolated Worktree Foundation

> **What this is:** REAL local infrastructure (`provenance: live`) — Git
> worktree isolation, protected paths, file-claim enforcement, and bounded
> shell-free command execution. It is the security boundary a future real
> Claude Code adapter will run inside.
> **What this is NOT:** agent execution. No coding agent, no Claude Code,
> no Codex, no provider call, no deployment, no push exists behind it.
> "Live workspace enforcement" must never be conflated with "live provider
> execution" — the Final Audit and UI distinguish the two by provenance and
> verifier identity (`relay-workspace`).

## Module boundary

`src/relay/workspace/` is the ONLY Node process/filesystem zone in Relay:

| File | Role | Node? |
| --- | --- | --- |
| `contracts.ts` | provider-neutral types + ports (`WorkspaceManagerPort`, `WorkspaceInspectionPort`, `CommandExecutionPort`, combined `WorkspaceService`) | no |
| `protected-paths.ts` | segment-safe path classification (pure) | no |
| `command-policy.ts` | executable/arg/env approval (pure) | no |
| `output-sanitizer.ts` | secret-shape redaction + byte bounding (pure) | no |
| `cleanup.ts` | conservative cleanup decisions (pure) | no |
| `repository-inspector.ts` | fixed-executable git invocation, repo validation, porcelain-z parsing | yes |
| `worktree-manager.ts` | worktree create/verify/remove, branch validation, root resolution | yes |
| `command-runner.ts` | bounded `spawn(exe, args, {shell:false})` runner | yes |
| `workspace-evidence.ts` | live EvidenceRecords + normalized `workspace.*` events | yes (os identity only) |
| `index.ts` | the ONE composition root (`createWorkspaceService`) | yes |
| `doctor.ts` / `verify-harness.ts` | truthful capability report / deterministic proof | yes |

Boundary-tested: Relay Core/protocol/ledger/connectors never import the
implementation or `child_process`; the CLI may import only the facade;
simulation adapters cannot create worktrees; browser prototype modules
cannot import workspace code.

## Workspace root layout

```
<realpath(parent-of-source-repo)>/.relay-workspaces/<project-id>/<run-id>/
```

- Absolute, canonicalized (realpath) root beside — never inside — the
  source repository; created `0o700`; refused if it is a symlink.
- Path segments are sanitized (`[A-Za-z0-9._-]` only); containment under
  the root is re-verified after joining.
- Untracked by the project; easy to inspect and remove manually.
- The registry is volatile (in-memory), matching the storage profile —
  workspaces survive on disk, registration does not survive the process
  (documented limitation until durable persistence lands).

## Worktree lifecycle

1. **Validate** — source path must exist, canonicalize, be a directory,
   and be the repository ROOT (subdirectories rejected); null bytes and
   traversal products rejected.
2. **Pin** — exact `HEAD` revision, current branch (`(detached)` when
   headless — never assumes `main`), and dirty flag are recorded. A dirty
   source is allowed but the worktree starts from the COMMIT; uncommitted
   source work is never copied and never touched.
3. **Create** — `git worktree add -b relay/run/<safe-token> <path> <rev>`
   from the source repo; the branch must not already exist; the path must
   not already exist (unregistered directories are never reused).
4. **Verify** — created worktree's `HEAD`, branch, and `--git-common-dir`
   must match the pinned revision, requested branch, and source `.git`.
5. **Register** — idempotent per `{project, run, task, source}`: the same
   request returns the same workspace; a branch registered to another
   active workspace is a conflicting reuse and fails safely.

**Branch names** pass a conservative subset of `git-check-ref-format`:
`[A-Za-z0-9][A-Za-z0-9._/-]*`, ≤100 chars, no `..`, `//`, `@{`, no empty /
`.` / `..` / `-`-leading / `.lock`-suffixed segments. Injection shapes
(`-D`, `--force`, spaces, control chars) are rejected outright.

## Source-worktree protection

The source repository is inspected before and after workspace operations
(`verifySourceUnchanged`): revision + branch + porcelain status. If the
source moved from its pin, Relay does not silently continue — the
workspace transitions to `checkpoint_required`, a `workspace.source_changed`
event and failed evidence are recorded, and revalidation is required.
Relay never resets, cleans, checks out, commits, merges, or pushes the
source worktree; the git surface for infrastructure contains no such
invocation (source-asserted by boundary tests).

## Protected paths and file claims

Policy is INPUT (`WorkspacePolicyInput`) — repository-specific lists are
never hardcoded. `.git` is baseline-forbidden always. Matching is
segment-safe (`secrets` covers `secrets/prod.env`, never
`secrets-archive.txt`). Rejected path shapes: absolute, `..` traversal,
null bytes, backslash separators, empty resolutions — all classified
`invalid` → treated as protected.

Post-execution inspection (`git status --porcelain=v1 -z`, machine-
readable, rename-aware) classifies every changed/untracked path:

| Result | Meaning | Workspace status |
| --- | --- | --- |
| `clean` | no changes | unchanged |
| `allowed` | all changes inside task write claims | active |
| `unclaimed_change` | change outside claims | `dirty` + flagged |
| `protected_change` | forbidden/read-only path touched (claims NEVER override protection) | `checkpoint_required` |
| `symlink_escape` | changed path is a symlink resolving outside the workspace realpath | `checkpoint_required` |

Flagged changes stop automatic work, produce failed `diff` evidence and a
`workspace.change_flagged` event, and NEVER auto-expand the task's claims.

## Command policy and execution

- Executable + argument arrays only; `spawn(..., { shell: false })`; no
  shell exists, so pipes/substitution/redirects cannot be interpreted —
  metacharacters in args are rejected anyway as hostile intent.
- Allowlist-only executables with an absolute denylist above it (shells,
  `rm`, `sudo`, `curl`, db clients, …). Approved git is inspection-only
  (`status`, `rev-parse`, `diff`, `log`, `show`); `push`, `reset`,
  `clean`, `checkout`, `merge`, `worktree`, `commit`, `config`, `remote`,
  `fetch`, `-c`, `--force` are denied even under a custom policy. npm may
  not `publish`/`install`/`exec`.
- Working directory: workspace-relative, canonicalized, containment-
  verified — escapes refused.
- Environment: base allowlist (`PATH`, `HOME`, locale, tmp) intersected
  with policy; a secret-name denylist (`*TOKEN*`, `*SECRET*`, `*KEY*`,
  `ANTHROPIC*`, `OPENAI*`, `AWS_*`, …) blocks provider credentials even if
  an allowlist mistake grants them. Results record granted key NAMES only.
- Bounds: default 30 s / max 120 s runtime; default 256 KiB / max 1 MiB
  per-stream capture. Exceeding a stream cap terminates the process
  (`output_limit`) — no unbounded capture exists. Timeouts escalate
  SIGTERM → SIGKILL; termination is reported honestly
  (`termination_confirmed` / `termination_unconfirmed` — never a silent
  success claim).
- Cancellation: `cancelCommand(commandId)` kills the running process and
  the result records `cancelled` with the termination outcome.
- Output is secret-shape sanitized (`[REDACTED:secret-shape]`) before
  storage; command evidence stores status/exit/signal/flags, never
  secrets, never absolute host paths.
- Rejected commands never spawn: they produce a `rejected` result with
  structured reasons, a `workspace.command_rejected` event, and failed
  command evidence.

## Cleanup

Removal ALWAYS requires explicit authorization (`authorizeRemoval: true`);
policies only make preservation stricter: `preserve_always` ·
`preserve_on_failure` (default — failure/cancelled/dirty/checkpoint states
preserved even when authorized) · `preserve_on_checkpoint` ·
`remove_on_success` · `manual_cleanup`. Before deletion the service
verifies: registered workspace, path under the approved root, not the
source worktree, no other registered workspace on the path. Removal uses
`git worktree remove` (never forced) and verifies the path is gone.
Unknown workspaces are refused. Branches are preserved (never deleted).

## Evidence and provenance

Every operation produces `EvidenceRecord`s (verifier `relay-workspace`,
`provenance: 'live'`, run/task association, pinned source revision) and
normalized `workspace.*` events: validated · created · reused · inspected ·
source_changed · change_flagged · command_started/completed/rejected ·
cancelled · preserved · cleaned · cleanup_refused. Environment fields
carry `[relay-workspace]` instead of absolute paths.

## Verification

```bash
npm run relay -- workspace doctor    # truthful capability report
npm run relay:workspace:verify       # deterministic end-to-end proof
```

The verification harness builds a THROWAWAY fixture repository under the
OS temp dir (never the Sunday repository), then proves: baseline commit →
isolated worktree (pinned, outside the source) → idempotent reuse →
source unchanged → approved command runs → push/shell rejected → claimed
change allowed → protected change flagged + checkpoint → timeout with
confirmed termination → cancellation → preservation of the flagged
workspace despite authorized cleanup → authorized removal of a clean
workspace → double-cleanup refused → source still pristine → live
secret-free evidence → fixture fully removed. Passed twice per phase gate.

## Known limitations

- Volatile registry: workspace registration dies with the process (durable
  persistence is a later phase); orphaned `.relay-workspaces` directories
  from crashed processes require manual `git worktree remove`.
- Process-tree termination uses process-level signals; grandchild
  processes that detach from the process group may survive (documented —
  the runner reports `termination_unconfirmed` rather than claiming
  otherwise when exit is not observed).
- Case-normalization bypasses are not applicable on the case-sensitive
  Linux dev filesystem; case-insensitive filesystems are future work.
- Cancellation during worktree CREATION is not supported (creation is a
  short synchronous operation); cancellation applies to commands.

## Exact next phase

**Real Claude Code Local Adapter** — a live coding-agent adapter that
executes INSIDE this workspace boundary: handoff-scoped claims become the
policy input, agent commands route through the approved command policy,
and all agent-caused changes pass the same inspection gate before any
report is trusted.
