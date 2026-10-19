# ADR-016 — Durable Local Persistence (finalized, Prompt 8.5)

**Status:** Accepted and implemented (2026-07-22). Finalizes the ADR-016
direction recorded in DECISIONS.md.

## Context

Canonical Relay state must outlive processes: a crash mid-supervised-run
was previously unrecoverable (volatile in-memory registries only), which
made cross-process recovery, truthful restart accounting, and any future
durable resume impossible. Constraints: zero new dependencies, no
credential exposure, no provider call implied by persistence, and the Git
repository must not become a state store.

## Decision

1. **Append-only JSONL event journal per run as the single authority**,
   with schema version, monotonic sequence, state digests, sanitized
   payloads, and per-event sha256 checksums. Node builtins only.
2. **Versioned JSON snapshots derived by deterministic replay**, rotated
   (`snapshot.previous.json`) and digest-validated, with fallback
   current → previous → replay-only. On disagreement the journal wins.
3. **State root outside the repository** (refining the earlier
   "project-local `.relay/`" sketch, which is superseded): explicit test
   override → `RELAY_STATE_HOME` → `XDG_STATE_HOME/sunday-relay` →
   `~/.local/state/sunday-relay`; 0o700/0o600 modes; canonical path
   containment; symlinked run dirs rejected.
4. **Crash-safe writes**: temp file + fsync + atomic rename for
   snapshots/metadata/index; fsync'd appends for the journal; explicit
   torn-tail handling on read.
5. **Owner-metadata run locks** (pid/host/time/purpose) with documented
   dead-owner reclaim and preserved stale locks — never a bare
   existence check; one mutating process per run.
6. **Explicit recovery, never silent resume**: a recovery service
   validates, replays, re-inspects the workspace read-only, classifies
   persisted provider-session references (`persisted_unverified` by
   default — a reference is not availability proof), reconciles the
   call budget from the journal, and emits a plan that ALWAYS requires
   explicit founder authorization before any live call.
7. **Explicit, backed-up, deterministic migrations** with rollback and
   unknown-future-schema rejection; loading an old schema fails with a
   migrate-first diagnostic. No uncontrolled automatic migration.
8. **Preserve-by-default retention**: no automatic deletion; archive
   moves within the state root; corruption is quarantined, not erased.
9. **SQLite remains deferred** (revisit only with repository evidence of
   need); files stay user-ownable and diffable.

## Consequences

- A killed process loses nothing durable: the journal replays, the lock
  is provably stale, the budget cannot reset, findings/repairs and the
  workspace association reconstruct, and the next permitted action is
  computed — proven offline by an 18-scenario separate-process harness
  and a two-process recovery drill (both deterministic, no provider
  calls).
- The redactor is load-bearing: journal payloads are sanitized at write
  time and the security tests scan every persisted artifact for
  secret/stream/hidden-reasoning material.
- Real cross-process PROVIDER resume remains a separate,
  founder-authorized future phase; persistence only makes it possible,
  never automatic.
