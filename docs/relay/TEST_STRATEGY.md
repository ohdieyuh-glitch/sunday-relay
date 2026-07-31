# Sunday Relay — Test Strategy (authoritative)

> **CLI glitch regression (Prompt 8.7, 2026-07-23):** `product/glitch.test.ts`
> is a pseudo-terminal harness (fake streams + fake clock) driving the REAL
> shell loop and asserting LIFECYCLE (not snapshots): one first frame + alt-
> screen enter once; zero repaints on the idle splash / while paused / after
> COMPLETE; no per-frame `\x1b[2J`; one keypress → one repaint; exactly one
> interval across play/pause/restart/speed churn; resize repaints once without
> spawning a loop; idempotent teardown (timer cleared, cursor/SGR/alt-screen
> restored once); Ctrl+C and fatal both restore; sanitized fatal message; two
> sequential runs; deterministic per-width frame within terminal width. A real-
> binary PTY probe additionally confirms the idle splash is byte-silent.

> **Implementation sync (Prompt 8.7, 2026-07-23) — DATED RECORD, not a
> current claim.** What follows describes `yc/yc-acceptance.test.ts` as it
> stood on that date; the file has grown well past the 35 tests named below.
> Two items are SUPERSEDED. "frontend worktree untouched" recorded the
> assertion that every path the check records is repo-relative — no absolute
> path, nothing outside this checkout — and both Relay surfaces live in this
> one repository, so there is no frontend worktree to leave untouched. The
> "wrong-branch / missing-checkpoint" cases went with the retired branch and
> checkpoint pin — readiness is now repository identity plus the versioned
> product baseline — and no longer exist in the file.
>
> `yc/yc-acceptance.test.ts` (35 tests, provider-free) covered: preflight
> exit-zero on valid state, read-only-git-only recording, repo-relative
> path recording (frontend worktree untouched), safe wrong-branch /
> missing-checkpoint / dirty-tree (WARN, non-destructive) / missing-script
> / missing-doc / failing-demo reporting, MANUAL frontend status, no
> secret/session-id/provider-stream shapes in output, control-byte
> scrubbing of git values, npm command wiring (founder commands exist,
> approved commands unchanged, no `--confirm-live` reachable), fixture
> language (architect/coding/relay/reviewer/F-1/R-1/completion-only-at-
> final-step), deterministic plain snapshot, PACING LOCK (300ms × 7 ticks
> × 20 reveals (21 events − splash) = 42s exact + 15–60s bounds at every
> speed + shell interval
> floor + settle-at-COMPLETE), sanitized fatal path + terminal restoration
> (fake streams), and `--watch` exit-code fidelity. A new boundary block
> (`relay-core-boundary.test.ts`) locks the yc leaf-module rules.

> **Implementation sync (Prompt 8.6, 2026-07-22):** CLI product tests.
> `cli/product/product.test.ts` covers parsing/routing (new + every
> existing command), caps detection, width projection + ANSI-aware layout,
> the safety boundary (injection, masking, streams), the key reducer
> (navigation, view toggle, graceful Ctrl+C, draft flow, no fabricated
> Ask-Relay answers), the Relay Dog (canonical-state animation gating),
> and the deterministic plain demo. `cli/product/verify-harness.ts` is the
> contract proof — 17 categories (~60 checks) over fixtures + an isolated
> temp state root incl. durable restart reload and the recovery screen via
> the REAL persistence service, zero provider calls
> (`relay:cli:contract-verify`).
>
> **Finalized 2026-07-23:** `cli/product/product-hardening.test.ts` adds the
> adversarial-review regressions, the dog/gold visual-correction tests, and the
> offline visual-simulation playback tests (`reduceTick` pacing, play/pause/
> next/restart/speed, active-row marker, footer phase, `/complete` cannot
> bypass CompletionPolicy). Full suite 2131/2131; contract 68/68; 0 provider
> calls.

> **Implementation sync (Prompt 8.5, 2026-07-22):** persistence tests.
> `persistence/persistence.test.ts` covers storage-root resolution, path
> traversal/symlink rejection, atomic writes + permissions, journal
> append/sequence/checksum/torn-tail/tampering/gap/duplicate handling,
> the lifecycle state machine, snapshot rotation + digest fallback, locks
> (live contention + dead-owner reclaim), redaction, store index/archive/
> quarantine, migrations (v0 fixture, backup, no-op, future rejection),
> session-readiness classification, Relay Dog recovery mapping, retention
> defaults, and budget durability. `persistence/verify-harness.ts` is the
> Gate-A OFFLINE RESTART PROOF: 18 scenarios across ~44 SEPARATE Node
> processes (esbuild-bundled driver, fake executables, isolated temp
> state root, zero provider calls); `persistence/recovery-drill.ts` is the
> two-process Gate-B drill ending `DURABLE LOCAL RECOVERY VERIFIED`.
> `relay-core-boundary.test.ts` gained a Prompt-8.5 suite (nothing above
> persistence imports it; recovery can never launch a provider; redaction
> denylist required; restrictive modes required).

> **Implementation sync (Prompt 8.4, 2026-07-22):** supervised workflow
> tests. `connectors/supervised/verify-harness.ts` is the Gate-A offline
> contract verifier — deterministic fake executables for BOTH agents prove
> the full loop: PATH A (genuine approval → verified-complete, released,
> truthful attestations/identities), PATH B (scripted changes_required →
> F-1/R-1 → exact-session Claude repair (attempt 2 confirmed) → Relay
> re-verification → exact-session Codex re-review → resolution →
> verified-complete only after approval), the repair limit (an unapproving
> re-review stops safely — never a second repair), needs_human/blocked
> holds, reviewer file-modification rejection, unclaimed-change stop before
> any review, no-change stop, and wrong-session rejection on BOTH resumes —
> 47 checks, NO provider call. `connectors/supervised/supervised.test.ts`
> adds the combined prerequisite gate and source-level prohibition tests
> (no workspace write, no seeded defect, no fault injection, no forced
> verdict, no direct process spawn). `relay-core-boundary.test.ts` gained a
> Prompt-8.4 suite: nothing above imports the composition; no
> `demo.fault_injected` event exists anywhere in Relay production sources.

> **Implementation sync (Prompt 8.3, 2026-07-22):** Codex reviewer tests.
> `connectors/codex-reviewer/codex-reviewer.test.ts` covers environment
> stripping, config-isolation risk, capability strategy selection, the reviewer
> prompt compiler (independence/read-only/schema, no transcript), the read-only
> permission compiler (never a bypass/full-access flag), the strict report
> parser (id/revision matching, verdict/finding coherence, secret + hidden-
> reasoning rejection, malformed → typed failure), the stream parser (session
> capture, reasoning dropped, structural validity), the Reviewer Execution
> Attestation, the reviewer gate + independence, and the adapter's sync
> refusal. `connectors/codex-reviewer/verify-harness.ts` is the offline
> contract verifier — a DETERMINISTIC FAKE Codex proving the full pipeline
> (approved/changes_required/blocked/needs_human, missing init/session, wrong
> ids/revisions, malformed/secret/hidden-reasoning, timeout, cancellation,
> output overflow, process error, exact-session re-review + wrong session,
> reviewer file-modification rejection, unauthorized-fallback + identity-
> mismatch rejection) with NO provider call. `relay-core-boundary.test.ts`
> gained a Prompt-8.3 suite (Relay Core never imports the Codex adapter;
> browser-safe mission/UI never import it; no bypass/full-access/workspace-
> write flag; read-only sandbox only; provider keys stripped; shell:false; the
> adapter never decides the gate). `npm run relay:codex:contract-verify` runs
> the offline proof; `relay:codex:live` is the explicit REAL Gate-B review
> (never in tests/CI).

> **Implementation sync (Prompt 8.2, 2026-07-22):** Mission Control tests.
> `src/relay/mission/mission-control.test.ts` (19) covers the mode policy +
> escalation-consent/reduction + boundary stops, credential-handle secret
> rejection + `requires_manual_task`, the deterministic dog states incl. the
> sprinting architect+coding coordination requirement and meaningful-event
> filter, reviewer independence + the output-visibility state machine (no
> release before required review + policy; autonomous never bypasses), and the
> terminal read model (dedup/ordering/gap detection/reconnect + redaction +
> reasoning omission). `src/relay/cli/mission-control.test.ts` covers the
> `demo mission-control` frames (truthful labels, 80-column, no ANSI, no
> secret) + the interactive `/mode /dog /terminal /reviewer /access`.
> `src/relay/ui/mission-control.test.tsx` (7) is DOM-less SSR
> (`renderToStaticMarkup`): data projection from Relay Core, MissionControl +
> LiveTerminal + RelayDog render every safe state, the accessible terminal
> button, reduced motion, and no secret/hidden-reasoning leak. Boundary tests
> gained a Mission Control suite (mission engines + `ui/` are pure/browser-safe;
> adapters can't drive dog/mode/entitlement/consent; the handle holds no value).
> All green with NO provider call.

> **Implementation sync (Prompt 8.1, 2026-07-23):** mission projection tests
> in `src/relay/mission/mission.test.ts` (pure: mission validation +
> revisioning + binding-digest staleness + secret rejection; attestation
> requested-vs-actual + launch-proof + fallback authorization/identity +
> immutability + stable digest; review/finding/repair rules incl.
> evidence+re-review resolution and scope/claim-expansion rejection;
> deterministic eight verdicts incl. approval-without-tests and
> missing-attestation/review/evidence; ordered attributable timeline +
> failure path) and `src/relay/cli/competitive.test.ts` (the real
> orchestrator through the `competitive` scenario reaching verified_complete;
> review/repair/evidence not skippable; both agents attested; stable semantic
> outcome; 80-column presentation; clean JSON). Boundary tests gained the
> Mission projection suite (pure leaf; core/adapters never import it;
> secret-free). End-to-end: `npm run relay:competitive` (no provider call).

> **Implementation sync (Prompt 8, 2026-07-23):** Claude Code adapter tests
> in `src/relay/connectors/claude-code/claude-code.test.ts` (pure modules:
> environment stripping, permission compilation incl. no-Bash/no-skip-flag,
> prompt compilation incl. transcript exclusion + report marker + narrow
> revision, strict report parsing, incremental stream parsing incl. hidden-
> reasoning omission + malformed/unknown tolerance, session capture/resume
> incl. wrong-id + second-repair rejection, auth API-key rejection) plus the
> full OFFLINE contract harness `runClaudeContractVerification()` (30 checks:
> end-to-end fixture proof via a deterministic fake Claude with real edits,
> inspection rejection, timeout, cancellation, no provider call). Boundary
> tests gained the Claude adapter suite (core never imports it; no claim
> mutation/promotion/worktree creation; no fusion-engine/server/UI; no
> skip-permissions/Bash-by-default; env stripping; simulation adapters
> unchanged) and updated the workspace "only these spawn" rule to include
> the approved Claude runner. End-to-end offline:
> `npm run relay:claude:contract-verify`. The live smoke
> (`npm run relay:claude:live`) is explicit and NEVER part of automated
> regression.

> **Implementation sync (Prompt 7, 2026-07-22):** workspace security tests
> in `src/relay/workspace/policy.test.ts` (pure: segment-safe protected
> paths, claim classification with no expansion, hostile path shapes,
> command allowlist/denylist incl. destructive git + shells + publication,
> env secret blocking at two layers, output bounding + secret redaction,
> branch-injection rejection, conservative cleanup decisions) and
> `src/relay/workspace/workspace.test.ts` (integration on throwaway fixture
> repos: repository validation, worktree lifecycle incl. idempotency +
> conflicting reuse + dirty-source pinning + unexpected source change,
> claimed/unclaimed/protected/symlink-escape inspection, live command
> execution + rejection + cwd escape + env inheritance, cleanup safety,
> live evidence integrity). Boundary tests gained the Workspace block
> (Node containment, adapter/CLI restrictions, shell:false assertion).
> End-to-end: `npm run relay:workspace:verify` (23-check deterministic
> harness on a fixture repo, run twice per gate).

> **Implementation sync (Prompt 6, 2026-07-22):** YC presentation tests in
> `src/relay/cli/yc.test.ts` (scenario registration/objective, one repair +
> same-session + independence through the real orchestrator, 26 evidence
> records with exactly one failure, presentation frame ordering incl. the
> Project Brain/Handoff/Repair moments, 80-column safety, simulation
> labeling, renderer-only pacing, honest failure frames, repeatable
> semantics, clean JSON) + `scripts/relay-yc-verify.mjs` (bundled
> double-run semantic acceptance, exit 0 gate).

> **Implementation sync (Prompt 4, 2026-07-22):** §9 adapter contracts and
> §11 demonstration scenarios are implemented — 20 new tests:
> `src/relay/connectors/simulated.test.ts` (adapter contracts: provenance,
> role, association, determinism, malformed-input rejection via the same
> schema gate as real input, independence, no credential shapes) and
> `src/relay/relay-vertical-slice.test.ts` (direct success; §11.1 golden
> path with one same-session repair; §11.2 checkpoint escalation; §11.3
> duplicate + stale-revision prevention with zero agent invocation; §11.4
> honest failure ×3 incl. unavailable verification and live-only policy
> rejecting simulated evidence; budget hard-stop + warning; pause/resume/
> cancel/duplicate-command idempotency/terminal protection/checkpoint
> approval). Run scenarios with:
> `npx vitest run src/relay/relay-vertical-slice.test.ts`.

> **Implementation sync (Prompt 3, 2026-07-21):** §§5–7 and the coordination
> scope are implemented — 90 new tests: ownership/lease boundaries
> (`coordination/ownership.test.ts`), duplicate-work/dependency/staleness
> (`coordination/checks.test.ts`), file+resource claims incl. hostile-path
> rejection (`coordination/claims.test.ts`), the 28-check pre-execution
> battery (`coordination/eligibility.test.ts`), compiler/validation/revision
> (`handoff/handoff.test.ts`), completion-policy + evidence-quality + budget
> (`verification/verification.test.ts`), 15-condition repair decision +
> repeated-failure/no-progress/recovery (`recovery/recovery.test.ts`), the
> nine Section-24 integration scenarios
> (`relay-coordination-scenarios.test.ts`), and the extended boundary walk
> (no shell/Git/fs, no provider reassignment). Remaining: §9
> adapter/simulation and §11 demo-scenario wiring (Prompt 4).

> **Implementation sync (Prompt 2, 2026-07-21):** §§1–6 and §8's Prompt-2
> purity walk are implemented — 62 new tests across
> `src/relay/protocol/protocol.test.ts`, `src/relay/core/run-machine.test.ts`,
> `src/relay/core/task-machine.test.ts`, `src/relay/ledger/ledger.test.ts`,
> and `src/relay/relay-core-boundary.test.ts` (protocol validation incl.
> every command/report family, full + one-revision run lifecycles,
> checkpoint/pause/resume/cancel, terminal protection, revision limits 0/1,
> event ordering + idempotency, append-only ledger + replay determinism,
> claim recording/promotion/rejection, task invariants + staleness
> primitives + lease recovery, boundary + security invariants incl.
> credential-shape and hidden-reasoning scans). §7 budget wiring, §9
> adapter/simulation, and §11 demo scenarios land with the next prompts.

> Status: **locked** (Phase 1 architecture lock, 2026-07-21). Framework:
> vitest, mocked/deterministic, **zero paid provider calls ever** (repo
> rule). Tests land with the prompt that implements the behavior; the
> mapping below marks the earliest prompt. Existing prototype tests (7
> files under `src/relay/`) remain green and untouched until the prototype
> is relocated.

## 1. Protocol & schema (Prompt 2)

- **Runtime schema validation** — every envelope/contract validator accepts
  the documented shape and rejects: missing required fields, wrong types,
  unknown protocol version, placeholder junk (carry the prototype's
  placeholder-rejection pattern).
- **Versioning** — unknown `protocolVersion` rejected with a stable error
  code; additive optional fields do not break old fixtures.

## 2. Run/task state machines (Prompt 2)

- **Legal transitions** — the full sequential phase walk, pause/resume,
  checkpoint enter/approve/reject.
- **Illegal transitions** — every out-of-order phase jump rejected
  (`illegal-transition`); table-driven over the full status × command grid.
- **Terminal-state protection** — completed/failed/cancelled runs reject
  every mutating command with `immutable`; late reports become historical
  claims only.
- **One-repair limit** — `repairCount` can never reach 2 by any command
  sequence (property-style test over command permutations).
- **Guided checkpoint behavior** — each of the 15 auto-repair conditions
  individually false → `checkpoint_required` (15 cases); all true → exactly
  one Revision Contract compiled with all 15 evaluations recorded.

## 3. Ledger (Prompt 2)

- **Append-only** — no API mutates or deletes an appended event; attempts
  are compile-impossible (no method) and runtime-guarded.
- **Monotonic ledger version** — gap-free sequence under interleaved
  appends; `expectedLedgerVersion` conflict returns
  `ledger-version-conflict`.
- **Projection rebuild** — current-state projection rebuilt from events
  equals incrementally maintained projection (determinism check).
- **Classification** — claims never appear in the canonical projection;
  only `claim-accepted` re-emissions do.

## 4. Claims, promotion, evidence (Prompt 2)

- **Claim promotion** — schema-valid report → `claim-recorded` only;
  promotion requires policy satisfaction; rejection paths emit
  `claim-rejected` with reasons.
- **Unsupported success claims** — an implementation report claiming green
  commands NEVER yields verified evidence by itself (the anti-pattern
  test: prototype-style pasted "pass" stays `unverified-claim`).
- **Evidence integrity** — EvidenceRecords carry exitCode/environment/
  repoRevision/executedAt; a bundle mixing repoRevisions is `unverified`.
- **Evidence freshness / revision pinning** — evidence for revision A does
  not satisfy a policy evaluated at revision B; freshness computed from
  repoRevision+executedAt, never ingestion time.
- **Reviewer independence** — verdicts from an assignment sharing
  adapter/session lineage with the implementer are rejected as
  non-independent regardless of report-body names; manual reviews satisfy
  policies only when the policy admits `manual`.

## 5. Coordination (Prompt 2)

- **Task ownership** — one owner at a time; second assignment refused.
- **Duplicate-task detection** — same objective/category active →
  `duplicate-task`; completed/superseded tasks refuse re-execution.
- **File-claim conflicts** — overlapping active claims refused; released/
  expired claims free the path.
- **Lease expiry** — expired lease emits `task-lease-expired`, task returns
  to `queued`, a new assignment succeeds (crash recovery).
- **Stale context** — package compiled at contextVersion N refused
  execution when consumed state moved past N; `baseRevision` drift detected.
- **Superseded task / dependency blocking** — superseded tasks are
  `obsolete`; unmet dependencies hold tasks out of `assigned`.
- **Invalidated by decision** — a DecisionRecord accepted after the task's
  `contextVersion` that conflicts with the task refuses execution with
  `invalidated-by-decision` (PROTOCOL §2.4).

## 6. Recovery & failure (Prompt 2 detection; recovery later)

- **Repeated failure** — identical command/test failure twice → FailureRecord
  with `repeated-*` signal → stop (no second repair).
- **No-progress detection** — revision with no meaningful diff → FailureRecord
  → checkpoint/blocked.

## 7. Budget & spend (schema Prompt 2; enforcement wiring in the checkpoint/cost prompt)

- **Budget enforcement** — projected overrun refuses compile/dispatch
  (`budget-exceeded`), emits checkpoint.
- **Spend-authorization layering** — cloud dispatch requires inner
  BudgetPolicy AND outer SpendAuthorizationPort approval; a stub outer-deny
  blocks even when inner approves (layering test with fake gateway).
- **Local/cloud dispatch separation** — a local package can never route to
  the cloud gateway and vice versa (type/port-level + runtime test).

## 8. Boundaries (extend the existing pattern; Prompt 2)

- **Relay-core purity** — `src/relay/{protocol,core,ledger,coordination,handoff,routing,verification,recovery}/**`
  import no fusion-engine, server, session-store, react, zustand, browser
  APIs, or node-fs (fs confined to storage/cli/connectors). Timing:
  **Prompt 2** adds a purity walk over the NEW roots only (prototype
  folders explicitly excluded, existing `relay-boundary.test.ts`
  untouched); the later prototype-relocation prompt rewrites the walk to
  cover all of `src/relay/**` with only `prototype/`, `storage/`, `cli/`,
  `connectors/` exemptions — never weakened as a drive-by (AGENTS.md §5.4).
- **CLI/core boundary** — cli imports only relay-protocol (+ rendering);
  no state-transition/completion/routing/policy/promotion logic in clients
  (source-level assertion, mirroring Decision 9).
- **UI/core boundary** — same assertion for any future client folder.
- **No-secret-output** — events, packages, reports, audits, CLI output
  fixtures scanned against credential shapes (reuse repo secret-redactor
  conventions); adapters' sessionRef fixtures prove opacity.

## 9. Adapters & simulation (simulation-harness prompt)

- **Adapter contract tests** — every adapter (simulated first, Claude
  Code/Codex later) passes the same port-level contract suite: consumes a
  package, emits schema-valid reports, honors stoppingCondition, labels
  provenance truthfully, declares its enforcement capabilities.
- **Simulation provenance** — every simulated event/report carries
  `provenance: simulated`; the run's `provenanceProfile` is `simulated`;
  rendering fixtures show the Simulated label (truthfulness test).
- **Cancellation** — cancel mid-phase invalidates leases/packages; late
  simulated reports are recorded historical, never promoted.
- **Crash recovery** — kill/restart the harness mid-run (in-memory:
  re-hydrate from events); leases expire; run resumes or blocks cleanly.

## 10. Future (reserved, written when parallelism lands)

- **Parallel-conflict tests** — concurrent claims, merge-order, dependency
  scheduling, heartbeat staleness.

## 11. First deterministic demonstration scenarios (the July 24 script)

1. **Golden path with one repair** — objective → simulated blueprint →
   accept → task → package (pinned versions shown) → simulated
   implementation → Relay-executed simulated verification (one failing
   check) → simulated review (changes_requested, 1 finding) → all 15
   conditions true → one Revision Contract → re-verify green → re-review
   approved → promotion → Final Audit Report `verified-complete`,
   provenanceProfile `simulated`.
2. **Checkpoint escalation** — same flow, but the finding touches a
   protected path (condition 6 false) → `checkpoint_required` → founder
   approves via CLI → manual-labeled continuation → audit records the
   checkpoint.
3. **Duplicate/stale prevention** — second identical objective refused
   (`duplicate-task`); a package executed after a ledger move refused
   (`stale-context`); lease expiry frees a crashed run's task.
4. **Honest failure** — repair's re-verification fails → no second repair →
   `blocked` → Final Audit Report `failed` (proves audits are not success
   certificates).
