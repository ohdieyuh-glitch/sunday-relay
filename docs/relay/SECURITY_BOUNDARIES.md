# Sunday Relay — Security Boundaries (authoritative)

> Status: **locked** (Phase 1 architecture lock, 2026-07-21). Companion to
> `ARCHITECTURE.md` (hybrid execution) and `PROTOCOL.md` (contracts).

## 1. Trust boundaries

| Boundary | Trusted side | Untrusted side | Crossing rule |
| --- | --- | --- | --- |
| Client → Core | relay-core | CLI/UI input | CommandEnvelope schema validation; commands cannot mutate state directly |
| Adapter → Core | relay-core | ALL agent reports | ReportEnvelope ingested as `unverified-claim`; promotion only by relay-core |
| Import → Core | relay-core | imported Blueprints, manual reviews, pasted reports | `external-artifact` / `manual` provenance; Blueprints promoted only by the human `accept-blueprint` command; manual reviews and imported reports stay `unverified-claim` and promote only through relay-core CompletionPolicy evaluation (policy must admit `manual`) |
| Core → Provider | provider tool / gateway | compiled packages | minimum sufficient context; no secrets in packages |
| Core → Ledger | relay-ledger | — | sole appender; append-only; typed events only |
| Local ↔ Cloud dispatch | — | — | strictly separate paths (§5); never mixed in one dispatch |

**Agent reports are untrusted inputs.** Nothing an agent writes — including
its own identity, command outputs, pass/fail claims, or resolution claims —
changes canonical state without relay-core promotion backed by
Relay-executed evidence and/or required review. **Imported Blueprints are
untrusted external input**: schema-validated, size-bounded, recorded as
external artifacts, promoted only by explicit human acceptance; their
content never executes anything by itself.

## 2. Credentials

- **Local execution:** provider authentication belongs to the provider tool
  (Claude Code, Codex CLIs). Relay never reads, copies, prints, serializes,
  or transmits local credentials — not into the ledger, events, packages,
  reports, logs, or Aquala infrastructure. Only opaque `sessionRef`
  strings (no tokens, no cookies, no key material) are stored.
- **Cloud execution:** provider credentials live server-side only (Railway
  env vars), per AGENTS.md §5.2. Relay Core never holds them; the
  CloudDispatchGateway implementation outside core uses them.
- **No-secret-output tests** (TEST_STRATEGY §8, No-secret-output) assert that events,
  packages, reports, audit reports, and CLI output never contain values
  matching known credential shapes, and that the secret-redactor
  conventions of this repo are honored at every Relay output surface.

## 3. Workspace isolation

- **Local:** live coding-agent work happens ONLY inside a Relay-approved
  isolated git worktree created by the (future) worktree manager. Absolute
  precondition: no live local coding-agent adapter runs before the worktree
  manager exists and passes its safety tests (Decision 1/6). The manager
  owns: worktree creation/teardown, path containment, protected-path
  verification via diff inspection, command-runner allowlist, cancellation
  kill semantics, crash recovery.
- **Cloud:** Sunday-managed execution uses provider-side/workspace
  isolation defined by the gateway; the same package restrictions apply,
  with enforcement levels declared honestly (§6).

## 4. Standing restrictions

- No push to main. No production deployment from Relay. No unrestricted
  shell — live adapters run through the Relay-owned command runner
  allowlist. Network permissions for live adapters are declared per adapter
  and default-deny beyond provider endpoints. Protected paths (at minimum:
  `.git/`, CI/deploy config, credential files, migration history) are
  verified by diff inspection, not by trusting the agent.
- **Cancellation guarantees:** `cancel-run` transitions the run terminally,
  invalidates outstanding leases and packages (idempotency keys refuse late
  reports as `stale-context`), and — once live adapters exist — propagates
  process termination through the adapter. Late-arriving reports after
  cancellation are recorded as historical claims, never promoted.
- **Recovery-agent permissions:** a future recovery/reassigned agent gets a
  NEW compiled package with the same (or narrower) restrictions — recovery
  never widens permissions, never inherits a session, and never bypasses
  checkpoint requirements.
- **Skill permissions (reserved):** future Aquala Skills compile into
  package restrictions (permittedTools / prohibitedActions / required
  approvals) that carry the same enforced/advisory/unsupported
  classification and can only NARROW — never widen — an adapter's
  permissions; no critical organizational procedure lives only inside a
  provider-specific prompt.

## 5. Spend-authorization layering (Decision 1)

Aquala-funded calls require BOTH approvals, in order:
1. **Inner guard — Relay BudgetPolicy:** run budget, token policy, runtime
   policy, stop-before-dispatch, budget-warning checkpoints.
2. **Outer guard — Sunday global spend breaker** (+ Supabase auth where
   required, emergency stop, provider budgets), reached through
   `SpendAuthorizationPort` implemented outside Relay Core.

Relay Core cannot bypass the outer guard because it cannot reach providers
at all: it has no credentials and no fusion-engine/server imports (enforced
by boundary tests). Local subscription-funded execution does not consult
the Sunday breaker (it is not Aquala-funded) but IS bounded by the Relay
BudgetPolicy (runtime/token policies still apply).

## 6. Enforcement matrix (Decision 5)

Levels: **E** = enforced (Relay technically guarantees it) · **A** =
advisory (conveyed, not technically guaranteed) · **U** = unsupported
(cannot be represented/verified — blocks high-risk tasks when the
CompletionPolicy requires enforcement).

| Control | Simulation adapter | Manual / import path | Local native adapter (future) | Cloud adapter (future) |
| --- | --- | --- | --- | --- |
| Worktree path isolation | E (simulated FS, labeled) | U | E (worktree manager) | E (managed workspace) |
| Command allowlist | E (simulated, labeled) | U | E (Relay command runner) | E (gateway policy) |
| Protected paths | E (diff inspection of simulated diff) | A (human checks diff) | E (diff inspection) | E (diff inspection) |
| Permitted files (claims) | E | A | E (worktree scoping + diff) | E |
| Permitted tools | E (simulated) | A (prompt text only) | A→E (per-tool capability) | E (gateway) |
| Prohibited actions | E (simulated) | A | A→E (per action class) | E (gateway) |
| Budget stop-before-dispatch | E | E (Relay refuses to compile) | E | E (+ global breaker) |
| Token / runtime limits | E | A | E (runner timeouts) | E |
| Loop count (one repair) | E (relay-core) | E (relay-core) | E (relay-core) | E (relay-core) |
| Reviewer independence | E (assignment lineage) | A (labeled `manual`) | E (adapter/session lineage) | E |
| Evidence integrity (revision pinning, exit codes) | E (simulated runner, labeled) | U (pasted evidence = unverified claim) | E (Relay executes checks) | E |
| Provenance labeling (simulated/live/imported/manual) | E | E | E | E |
| No-credential output | E | E | E | E |
| Push-to-main / deployment ban | E (nothing can push) | A (human hands) | E (worktree has no push remote perms) | E (gateway policy) |

Simulation adapters must declare, in their adapter descriptor, which
policies they *simulate* versus actually *enforce* — simulated enforcement
is labeled in events (provenance `simulated`) so a demo can never be
mistaken for hardened enforcement.

## 7. Evidence & artifact integrity

EvidenceRecords are produced only by relay-verification executing checks
itself (or, later, validating signed adapter runner output): exit codes,
environment, `repoRevision`, `executedAt`, optional artifact hashes.
Freshness/staleness is computed from `repoRevision` + `executedAt`; a
bundle mixing revisions is `unverified`. Prototype-style pasted evidence is
permanently classified `unverified claim` (Decision 7). Artifacts referenced
by packages/reports carry integrity metadata (`sha256`, size) when stored.

## 8. Audit requirements

Every run yields an append-only trail sufficient to reconstruct: who was
assigned what (TaskAssignments), what context they received (packages +
compilation records with pinned versions), what they claimed (reports),
what Relay proved (evidence bundles + verification records), what was
promoted (claim-accepted events), every checkpoint and human decision
(approvals), all spend (usage records), and the final outcome (Final Audit
Report — which can state failure). Provenance labels survive end-to-end.

## 9. Threats & mitigations (summary)

| Threat | Mitigation |
| --- | --- |
| Agent fabricates success ("tests pass") | Relay-executed evidence only; claims never promote themselves; policy-gated promotion |
| Agent self-reviews under another name | Structural independence from assignment/session lineage, not report text |
| Prompt-injected report tries to trigger actions | Reports are data (claims); commands come only from clients; promotion is policy code, not text interpretation |
| Malicious/poisoned imported Blueprint | Untrusted external artifact; schema-validated; human `accept-blueprint`; never executable |
| Credential leakage via events/logs | No credentials in Relay state by construction; no-secret-output tests; opaque sessionRefs |
| Runaway spend | Inner BudgetPolicy stop-before-dispatch + outer global breaker (cloud); token/runtime caps |
| Infinite repair loops | `repairCount ≤ 1` enforced in relay-core; then checkpoint/blocked/failed |
| Stale/duplicate/conflicting work | Pre-execution check battery; leases with expiry; `expectedLedgerVersion` optimistic concurrency |
| Crashed agent locks work forever | Lease expiry → `task-lease-expired` → task returns to `queued` |
| Demo mistaken for live execution | Mandatory provenance labels; `provenanceProfile` on runs; UI/CLI must render true enforcement + provenance |
| Protected-path tampering | Diff inspection against protected patterns before promotion (E where a diff exists) |
| Late report after cancel | Idempotency keys + `stale-context` rejection; recorded as historical claim only |
