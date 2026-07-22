# Sunday Relay — Workspace Security (Prompt 7, authoritative)

> Status: **implemented** (2026-07-22, Prompt 7). The isolated Git worktree
> and safe local process-execution foundation a future real Claude Code
> adapter will use. This is LIVE LOCAL infrastructure — real worktrees and
> real policy-restricted processes with `provenance: live` — and it is NEVER
> to be confused with live AI provider execution, which remains unavailable.
> Companion documents: `SECURITY_BOUNDARIES.md`, `ARCHITECTURE.md`,
> `PROTOCOL.md`, `CLI.md`.

## 1. Module and ports

`src/relay/workspace/` is the single logical boundary:

| Module | Role | Node access |
| --- | --- | --- |
| `contracts.ts` | Provider-neutral types + ports (`WorkspaceManagerPort`, `WorkspaceInspectionPort`, `CommandExecutionPort`, combined `WorkspaceService`) | none (pure) |
| `protected-paths.ts` | Segment-safe protected-path + file-claim classification | none (pure) |
| `command-policy.ts` | Approved-command allowlist, hard denylist, env allowlist | none (pure) |
| `output-sanitizer.ts` | Secret-shape redaction + byte bounding | none (pure) |
| `cleanup.ts` | Conservative cleanup decisions | none (pure) |
| `repository-inspector.ts` | Bounded local git invocation, source validation, status parsing | child_process, fs |
| `worktree-manager.ts` | Worktree creation/verification/removal, branch + root safety | child_process, fs |
| `command-runner.ts` | Bounded `spawn(executable, args, {shell:false})` runner | child_process |
| `workspace-evidence.ts` | Live-local EvidenceRecord + normalized event builders | none (pure builders) |
| `doctor.ts` / `verify-harness.ts` | Truthful capability report / fixture verification | child_process, fs |
| `index.ts` | THE composition root (`createLocalWorkspaceService`) | fs |

Boundary tests enforce: pure modules import no Node builtins; `child_process`
exists nowhere in `src/relay` outside this module; Relay Core, connectors,
and the browser prototype never import the workspace implementation; the CLI
reaches it only through the composition root.

## 2. Workspace root layout

```
<parent-of-source-repo>/.relay-workspaces/<projectId>/<runId>/<taskId>
```

The root is absolute, created `0o700`, never a symlink, never inside the
source repository (checked in both directions), untracked, stable per run,
and easy to inspect or remove manually. Tests and the verification harness
use tmp-directory roots instead of real repository siblings.

## 3. Worktree lifecycle

1. **Validate** the source: real directory, non-bare Git repository, root
   resolved via `rev-parse --show-toplevel` + realpath; unborn (commitless)
   repositories rejected; null bytes/traversal rejected.
2. **Pin** the exact `HEAD` revision and record the base branch
   (`(detached)` when headless — never assumes `main`) and source dirtiness
   (uncommitted source changes are never copied; the worktree starts from
   the pinned commit).
3. **Create** `git worktree add -b relay/run/<safe-run-token> <path> <rev>`
   with a validated branch name (allowlist charset; `..`, `//`, `@{`,
   leading `-`, trailing `/`/`.`/`.lock` rejected; pre-existing branches and
   branches owned by other active workspaces refused).
4. **Verify before trusting**: the created worktree must point at the
   expected repository (`--git-common-dir` under the source), the pinned
   revision, and the expected branch, or creation fails.
5. **Idempotency**: the same source+run+task request returns the same
   workspace; a conflicting reuse (different branch, occupied path) fails
   safely with `duplicate-task`.

## 4. Source-worktree protection

Relay never resets, cleans, checks out, commits, merges, or pushes the
source worktree. `git worktree add` writes bookkeeping under the source
`.git/worktrees/` — inherent to worktrees, disclosed here; the source
working tree and revision are verified unchanged before/after operations.
An unexpected source change (revision or branch moved) flags the workspace
`checkpoint_required`, emits `workspace.source_changed`, and records failed
evidence — never silent continuation, never overwriting user work.

## 5. Protected paths and file claims

Policy is repository-specific input (`WorkspacePolicyInput`), never
hardcoded: `forbidden` paths (any change stops work), `readOnly` paths
(writes stop work), and the task's claimed write roots. `.git` is always
baseline-forbidden. Matching is segment-safe (`secrets` covers
`secrets/prod.env`, never `secrets-archive.txt`). Hostile shapes (absolute,
`..`, null bytes, backslash tricks) are rejected by the same normalizer the
claim system uses. After execution, changed + untracked paths are classified
`claimed` / `unclaimed` / `protected`; symlinks are lstat'ed and their
targets realpath-resolved — links pointing outside the workspace (including
dangling ones) are `symlink_escape`. Worst finding wins:
`symlink_escape > protected_change > unclaimed_change > allowed > clean`.
Any flagged assessment sets the workspace `checkpoint_required`, emits
`workspace.change_flagged` with evidence, blocks further command execution,
and NEVER expands the task's claims automatically.

## 6. Command execution policy

- `spawn(executable, args, { shell: false })` always — no shell exists, so
  interpolation, pipes, substitution, and redirects are impossible; shell
  metacharacters in arguments are additionally rejected as hostile intent.
- Executables are bare names on an explicit allowlist (default:
  `node --version`, `npm --version`, read-only `git` inspection). A hard
  denylist (shells, `rm`, `sudo`, `curl`/`ssh`, DB tools) wins over any
  configured rule.
- Git subcommands are restricted to `status`/`rev-parse`/`diff`/`log`/
  `show`; `push`, `reset`, `clean`, `checkout`, `merge`, `rebase`, `config`,
  `worktree`, force flags, and exec-injection flags are never approved.
  `npm publish/install/config/exec` are never approved.
- Working directories resolve inside the workspace realpath or the command
  is rejected.
- Environment: allowlist ∩ request, minus a secret-name denylist
  (`*TOKEN*`, `*SECRET*`, `*KEY*`, `ANTHROPIC*`, `OPENAI*`, `AWS_*`, …) —
  provider secrets are not inherited by default OR by request.
- Bounded: default 30 s timeout (max 120 s), 256 KB output (max 1 MB).
  Timeout ⇒ SIGTERM then SIGKILL of the detached process group; exceeding
  the output budget terminates the process (`output_limit`) rather than
  pretending full output exists. Exit codes, signals, timestamps, and
  duration are captured; termination is reported `termination_confirmed`
  only when the close event was actually observed, else
  `termination_unconfirmed`.
- All captured output passes the secret-shape sanitizer before storage.
- Results are idempotent per `commandId`; every command produces live
  EvidenceRecords and `workspace.command_*` events.

## 7. Cancellation

`cancelCommand(commandId)` terminates the active process group and resolves
the pending result `cancelled` with the observed termination outcome. A
flagged/cancelled workspace refuses further execution. Cancellation during
synchronous worktree creation is not supported (creation is a single bounded
git invocation) — documented limitation.

## 8. Cleanup

Conservative by construction (`cleanup.ts`): `preserve_always`,
`preserve_on_failure` (default), `preserve_on_checkpoint`,
`remove_on_success`, `manual_cleanup`. Removal requires BOTH explicit
authorization and policy permission for the current status; failed,
checkpoint, and cancelled workspaces are preserved for inspection. Before
any removal: the workspace must be registered, its realpath inside the
approved root, and never the source worktree. `git worktree remove` is
never forced — a dirty worktree yields `cleanup_failed`, not data loss. The
run branch is retained in the source repository after removal (history).
Unknown workspaces are refused (`cleanup_refused`).

## 9. Evidence and provenance

Every lifecycle step produces EvidenceRecords (verifier `relay-workspace`,
`provenance: live`) and normalized `workspace.*` events (validated against
the protocol event schema): source pinned, worktree created/verified,
source-unchanged checks, inspection assessments, command results,
preservation/cleanup outcomes. Event summaries never contain absolute paths
or secrets. The audit/UI distinction is three-way: simulated agent
execution (`simulated`) · live workspace enforcement (`live`, this module) ·
future live provider execution (`live`, adapters — still unavailable).

## 10. Verification

```
relay workspace doctor        # read-only, truthful capability report
npm run relay:workspace:verify  # deterministic fixture proof (exit 0/1)
```

The verification harness builds a THROWAWAY fixture repository under the OS
tmpdir (never the Sunday repository), then proves end-to-end: baseline
commit → isolated worktree (pinned, branch-verified, root-confined) →
idempotent reuse → source unchanged → approved command runs → `git push`
rejected → claimed change allowed → protected change detected and execution
stopped → timeout/cancellation/output-limit/sanitizer enforced → authorized
cleanup of a clean workspace → preservation of the flagged workspace →
unknown-workspace refusal → source repository byte-identical → all events
protocol-valid, all evidence live-local, no secret shapes anywhere. The
fixture tree is removed at the end.

## 11. Known limitations

- The workspace registry is volatile (in-process) — durable workspace
  persistence arrives with the persistence phase; worktrees on disk survive
  and are manually inspectable/removable.
- Run branches are retained after worktree removal (never auto-deleted).
- Cancellation during worktree creation is not supported (bounded sync op).
- File-claim enforcement is detective (post-change inspection + stop), not
  preventive OS-level sandboxing; enforcement level is reported truthfully
  as detection + refusal-to-continue.
- `git worktree add` writes bookkeeping inside the source `.git` (§4).

## 12. Exact next phase

**Real Claude Code Local Adapter** — dispatch a real local Claude Code
session INSIDE a prepared isolated workspace under this module's protected
paths, command policy, bounded runner, evidence, and cleanup rules.
