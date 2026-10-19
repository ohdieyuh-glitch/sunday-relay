# Sunday Relay — Durable Local Persistence (Prompt 8.5, authoritative)

> **CLI sync (Prompt 8.6, 2026-07-22):** the terminal product consumes this
> store directly: project drafts persist as `projects/<id>.json` records
> (sanitized, atomic), `relay home`/`relay projects` list durable records,
> `relay recover` renders the recovery service's plan, and the CLI
> survives restart (projects, runs, findings, budgets reload from the
> canonical root). There is no CLI-specific state directory.

Relay's run state now outlives the process. `src/relay/persistence/` is a
durable, local, versioned, crash-safe foundation: after a restart Relay can
reconstruct the truthful state of an interrupted project or supervised run
without inventing progress, silently repeating completed work, losing
provider-call accounting, losing findings or repair obligations, losing
workspace associations, falsely claiming a provider session was resumed, or
exposing credentials, private reasoning, or raw provider streams.

## State root (never the Git repository)

Resolution order: explicit test override → `RELAY_STATE_HOME` →
`XDG_STATE_HOME/sunday-relay` → `~/.local/state/sunday-relay`. Roots under
provider credential directories (`.codex/`, `.claude/`), `Downloads/`, or a
Git work tree are rejected. Structure:

```
<state-root>/
  index/runs.json                     # safe run summaries (atomic writes)
  runs/<run-id>/
    metadata.json                     # schema version, lifecycle, timestamps
    journal.jsonl                     # THE AUTHORITY — append-only events
    snapshot.json                     # newest derived snapshot
    snapshot.previous.json            # rotated known-good fallback
    lock                              # owner-metadata mutation lock
  workspaces/<workspace-id>.json      # workspace registry records
  archive/<run-id>/                   # archived runs (still inspectable)
  quarantine/<run-id>-<ts>/           # corrupted records (never discarded)
  migrations/backup-<run>-<ts>/       # pre-migration backups
```

Files are written 0o600 and directories 0o700 where the platform supports
it. Run references are validated as single safe path segments; resolution
is canonical, containment-checked, and symlinked run directories are
rejected (never followed).

## Journal authority + snapshots

Every durable state change is one append-only journal event carrying:
schema version, event id, monotonic gap-free sequence, timestamp,
project/mission/task/run/attempt ids, a safe event kind, a safe actor
identity, workspace revision where applicable, previous- and
resulting-state digests, a SANITIZED payload, and a sha256 checksum over
the deterministic serialization. Journal appends are fd-write + fsync;
snapshot/metadata/index writes are temp-file + fsync + atomic rename — the
only known-good snapshot is never overwritten in place (`snapshot.json`
rotates to `snapshot.previous.json` first).

Snapshots are versioned projections REDUCED from the journal and must
always be reconstructable by full replay; the loader validates the
snapshot digest and falls back current → previous → replay-only. The
journal remains authoritative — on disagreement, replay wins.

Replay enforces the explicit lifecycle state machine (initialized →
implementation_running → held_for_inspection → held_for_verification →
held_for_review → { approved_for_release | revision_required →
repair_authorized → repair_running → held_for_inspection →
held_for_reverification → held_for_rereview → approved_for_release } →
verified_complete → released, with stopped_safely/canceled/
recovery_required/corrupted/quarantined) — an invalid transition or an
over-budget call authorization is rejected at append time AND at replay
(recovery never skips states), and duplicate journal lines replay
idempotently (call budgets are never double-consumed).

## What is persisted / what is never persisted

Persisted (safe metadata only): project identity, mission contract summary
+ acceptance criteria + policy references, task identity/owner/FileClaims/
protected paths/attempt lineage, run mode + lifecycle + phase + output
visibility + stop reason + completion verdict, the CALL BUDGET (max,
consumed, remaining, per-provider, automatic-retry prohibition), workspace
association (paths, source revision, branch, claimed files, last
inspected/verified revisions, claimed-file CONTENT DIGESTS, cleanup
status), minimum provider-session references (provider, adapter, relay
ref, provider session identifier for exact resume, association, attempt,
author, independence group, initialization status, timestamps, resume
eligibility, invalidation), Execution Attestations, bounded evidence
manifests (command identity, exit status, workspace revision, result
DIGEST, criteria, authority, stale/current), findings and repairs (linked,
with required actions and bounded evidence).

NEVER persisted (redactor-enforced + artifact-scanned): passwords, API
keys, access/refresh tokens, cookies, recovery codes, credential values,
raw provider event streams, transcripts, chain-of-thought / hidden
reasoning, full internal prompts, account information (including emails),
unredacted environment values, or unrestricted command output. File
contents are never persisted for convenience — digests, paths, and bounded
references only.

A persisted provider-session reference is NOT proof the provider session
remains available. After restart it is classified: `persisted_unverified`
(default), `resume_ready`, `resume_unavailable`, `invalid`, `expired`, or
`manual_action_required`. Raw provider session ids are never displayed by
default in CLI output — only the readiness classification.

## Crash behavior, locks, recovery

A crash leaves the run lock held; the lock carries owner metadata (pid,
host, acquisition time, purpose — never a bare existence check). A dead
same-host owner is classified `stale_owner_dead` and reclaimed only under
that documented condition, with the stale lock preserved for diagnosis; a
live owner rejects the second writer (bounded attempts, safe diagnostic) —
so two processes can never mutate the same run or concurrently authorize a
provider launch. Read-only inspection never takes the lock.

The recovery service (`recovery.ts` — separate from the CLI, structurally
unable to launch a provider) performs: journal validation → snapshot
validation/fallback → replay → workspace re-inspection (read-only git
`rev-parse`/`status` + claimed-file digest comparison) → source-worktree
protection check → provider-session classification → call-budget
reconciliation (journal wins) → stale-evidence marking (durable) → a safe
RECOVERY PLAN: `inspection_only`, `ready_for_verification`,
`ready_for_review`, `ready_for_repair_authorization`,
`ready_for_exact_claude_resume`, `ready_for_exact_codex_resume`,
`waiting_for_user`, `manual_action_required`, `stopped_safely`, or
`unrecoverable`. Every plan carries
`requiresFounderAuthorizationForLiveCalls: true` — Relay never silently
resumes provider execution because a process restarted.

Integrity failures are never silently discarded: a torn FINAL journal line
is dropped with a diagnostic (the partial event is never invented); an
interior malformation, checksum mismatch (tampering), sequence gap,
conflicting duplicate, or unknown FUTURE schema is corruption — the run is
quarantined (records preserved) and recovery reports `unrecoverable`.
Workspace drift (digest mismatch) marks prior evidence STALE and blocks
completion until re-verification; a changed source repository stops
recovery safely.

## Migration + retention + archive

Schema `relay-state.v1` is current; `relay-state.v0` (fixture-backed)
migrates deterministically with a full pre-migration backup under
`migrations/` and rollback on failure; re-migration is a no-op; unknown
future schemas are rejected, never guessed; loading an old-schema run
fails with a migrate-first diagnostic (no uncontrolled automatic
migration). Retention policy defaults PRESERVE everything (completed and
stopped runs; journal compaction is configured only — nothing is deleted
in this phase). `archiveRun` moves a terminal (or explicitly abandoned)
run inside the state root; it stays fully inspectable. There is no purge
command.

## Supervised integration + call-budget durability

The Prompt-8.4 supervised runner records every significant boundary
through an optional persistence hook (no hooks → volatile, exactly the
8.4 behavior): run initialized, workspace created, provider launch
authorized, implementer initialization/report, inspections, verification,
reviewer launch/initialization, review received, finding/repair created,
exact-session resume authorized, repair received, re-verification,
re-review, completion evaluated, verified_complete / stopped_safely, and
cleanup. Call-budget consumption is carried BY the launch/resume
authorization events, persisted BEFORE the provider process starts — a
crash can never produce an unaccounted call, and a restart can never
reset consumed calls, maximums, per-provider counts, or the
automatic-retry prohibition. The live CLI path wires the recorder to the
default state root; live commands remain founder-confirmed.

## Projections (Live Terminal + Relay Dog)

The persisted journal is NOT the Live Terminal transcript. Recovery emits
only safe normalized projection events (`persistence.loaded`,
`persistence.validated`, `snapshot.replayed`, `workspace.reconciled`,
`evidence.marked_stale`, `provider_session.persisted_unverified`,
`recovery.plan_created`, `run.recovery_required`, `run.recovery_ready`,
`run.quarantined` — all protocol event kinds); missing terminal dialogue
is never reconstructed or invented. Relay Dog derives from recovered
canonical state: recovery_required → waiting_for_user; re-inspection/
verification work → verifying; exact-session resume offers →
waiting_for_user; unrecoverable → stopped_safely; verified_complete →
complete.

## Commands

- `relay state doctor` — state directory, resolution source, writability,
  permissions, schema, migration status, corruption count, lock status.
- `relay runs list` — safe summaries (no raw ids beyond the reference).
- `relay runs inspect --run <ref>` — mission summary, phase, workspace
  status, evidence, findings/repairs, calls consumed/remaining, session
  READINESS classification, next permitted action.
- `relay runs recover --run <ref>` — validation + replay + workspace
  inspection + reconciliation + plan; ZERO provider calls.
- `relay runs archive --run <ref>` — archive without deletion.
- `npm run relay:persistence:contract-verify` — Gate A: the 18-scenario
  offline restart proof across separate Node processes (65 checks).
- `npm run relay:persistence:recovery-drill` — Gate B: the two-process
  crash-recovery drill; ends `DURABLE LOCAL RECOVERY VERIFIED`.

## Status + remaining limitation

Gate A and the offline Gate B drill PASSED 2026-07-22 (both run twice; 44
separate Node processes per contract run; zero provider calls anywhere).
**Remaining limitation:** real cross-process PROVIDER resume — actually
resuming a live Claude or Codex session from a persisted reference after a
restart — is NOT live-proven; a persisted reference stays
`persisted_unverified` until a separate founder-authorized phase proves
live resumability. Multi-machine persistence and cloud synchronization are
out of scope.
