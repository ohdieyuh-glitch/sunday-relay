# Julius consolidation report

## Executive record

- **Open PR count inspected:** 38/38; the complete record is in `OPEN_PR_MERGE_LEDGER.md`.
- **Current main used:** `96451fc0c8da59de792d973113c4e203ddab6f01`.
- **Integration branch:** `codex/julius-consolidation` (final SHA is recorded after the final validation commit).
- **Included effective tips:** #198 (contains #170–#179 and #186–#198), #185 (contains #180–#185), and #201.
- **History strategy:** non-fast-forward merge the effective tips into a new branch from current main. Published stack history was not rewritten. The knowingly invalid #188 architecture is never proposed as an independently mergeable main state; #198’s correction arrives in the same effective tip.
- **Existing PR actions:** none merged, closed, rebased, or force-pushed.

## Disposition and planned order

| Group | PRs | Disposition | Founder-authorized future action |
|---|---|---|---|
| Julius foundation | #170–#179 | CONSOLIDATE | Land only via effective candidate; then close as consolidated. |
| Relay/Julius boundary | #180–#185 | CONSOLIDATE | Land in candidate; keep generic ports and projections. |
| Julius continuation | #186–#187, #189–#198 | CONSOLIDATE | Land only as effective #198 state. |
| Broken intermediate | #188 | SUPERSEDED | Never land alone; founder may close after corrected state lands. |
| C.A.R.D. seam | #201 | CONSOLIDATE | Land with browser/seam proof. |
| Coliseum stack | #138–#141 | RESTACK_REQUIRED | Create a new focused current-main branch if still desired. |
| Durability/tenant work | #142–#143 | NEEDS_REPAIR | Re-audit overlapping current paths, repair, rerun security tests. |
| Wonderland backend | #144 | NEEDS_REPAIR | Resolve dirty bridge composition on a new integration branch. |
| Old doc correction | #129 | OBSOLETE | Founder decides closure after wording review. |

Recommended order is: **(1)** review this consolidation candidate; **(2)** close its production gaps on a sandbox/runtime follow-up before enabling untrusted tools; **(3)** founder-authorized merge; **(4)** close consolidated/superseded stacks; **(5)** separately restack still-wanted historical product work. There is no safe reason to put #188 on main temporarily.

## Stack graph and conflicts

See the ledger’s complete DAG. The important topology is:

```text
main
├─ Julius #170→179 ─ Julius #186→197 ─ #198 correction
├─ Relay boundary #180→185
├─ C.A.R.D. seam #201
└─ candidate-only provider-neutral Unix/tool substrate
```

The three effective tips merged cleanly at the text level. Semantic review found the main hazards to be duplicated configuration authority (#201 prevents it), feature-specific Gauntlet vocabulary (#198 removes it), and historical branches that appear GitHub-clean despite enormous divergence (#138–#141). Migrations 011–018 form one Julius chain; migration 017 belongs to the external Gauntlet namespace rather than Julius.

## Architectural result

- Julius owns state transitions, scheduling, routing, C.A.R.D., budgets, retry/fallback, sub-agents, evidence, verification, repair, recovery, trajectories, evals, and completion authority.
- Workers remain replaceable intelligence providers. Worker output is structured input to Julius, never an authoritative global transition.
- Gauntlet consumes generic work/review interfaces and lives outside Julius. Julius has no Gauntlet API, event, trajectory, table, or policy field.
- Relay/Wonderland consume one authoritative C.A.R.D. configuration. A second onboarding store was removed by #201.
- Tool contracts are model-independent and sit in Julius domain; Node/Unix execution is a connector adapter.

## Unix/Bash and coding-cycle proof

The real-filesystem scenario creates a disposable repository-like directory, reads and searches source, writes a repair with before/after hashes, invokes real Bash, observes a test-like success, and emits command/file evidence. Additional cases prove no side effect after C.A.R.D. denial, traversal and symlink refusal, output bounds, stderr separation, nonzero exit, secret redaction, timeout process-group termination, and invocation deduplication.

This is a real local Unix substrate, not a model response or test double. It is not yet a production hostile-code sandbox: deployment network/filesystem namespaces, durable invocations, artifacts, and live provider translation remain explicit blockers in `JULIUS_TOOLING_AUDIT.md`.

## Security review

| Finding | Severity | State |
|---|---|---|
| A general shell could bypass a naive `network=false` check | Critical | Fixed fail-closed: all general processes are network-capable and denied before spawn unless C.A.R.D. allows network and the runtime attests mediation. |
| Shell could mutate a nominal read-only workspace | Critical | **OPEN:** C.A.R.D. denies no-mutation calls, but the local adapter is not an OS sandbox. Production execution remains disabled pending a trusted container/microVM. |
| Structured filesystem traversal/symlink escape | Critical | Final-component and directory symlinks are refused; TOCTOU-hardening still belongs in the production sandbox. Bash host escape remains **OPEN** until containerization. |
| Host environment/secret output leakage | Critical | Reserved environment fields cannot be overridden and secret-shaped output is redacted, but host filesystem reads through local Bash remain **OPEN** pending the sandbox. |
| Timeout leaves grandchildren | High | Detached process group receives TERM then KILL; real `sleep & wait` test passes. |
| Duplicate tool charges/mutations | High | In-process active/completed idempotency works; durable multi-process implementation remains a production blocker. |
| Unbounded stdout/stderr | High | Separate byte caps; flood test passes. Durable overflow artifacts remain a gap. |
| Caller-forged isolation attestation | Critical deployment risk | Must be minted only by trusted container/microVM composition. Tool execution must remain disabled in production until that adapter exists. |
| Cross-tenant durable tool rows | Critical deployment risk | No durable tool rows exist yet; tenant-scoped schema is required before adding them. |

No credentialed Git push tool is registered. Shipping remains a separate founder-authorized operation.

## Validation record

The final command table is updated after the final run. Current focused proof:

| Command | Result | Classification |
|---|---|---|
| `npx vitest run src/relay/mission/julius src/relay/mission/gauntlet src/relay/integration src/relay/connectors/julius-tools src/relay/persistence/julius\\*.test.ts src/relay/persistence/wonderland-postgres.test.ts` | 32 files, 656 tests passed | PASS |
| `npx vitest run src/relay/connectors/julius-tools/julius-tools.e2e.test.ts` | 1 file, 6 tests passed | PASS |
| `npm run typecheck` | passed after `npm ci` | PASS |
| `npm run build` | passed; Vite large-chunk advisory only | PASS |
| `npm run relay:build` | passed | PASS |
| `npm run relay:bridge:build` | passed | PASS |
| `npm run relay:surface-parity:check:strict` | passed; one pre-existing unmounted economics panel disclosed | PASS |
| `node scripts/relay-repository-boundary.mjs` | passed after synthetic merged-stack secrets were repaired | PASS |
| `node scripts/relay-parity-gate.mjs` | passed | PASS |
| `git diff --check` | passed after ledger whitespace repair | PASS |
| `npx vitest run` (full repository) | first run exposed three new boundary allowlist failures; second run was interrupted after merged redaction fixtures failed while being repaired. Focused rerun passed 28 files/522 tests. | INCOMPLETE — do not classify green |

## PostgreSQL and migration reality

The inherited persistence suite contains SQL/model conformance and migration-chain tests. No `postgres`, `initdb`, `psql`, or Docker executable is available in this environment, so a real disposable PostgreSQL server could not be run. The final validation checks for a server and records the outcome. Until a live database run covers empty migration, `SKIP LOCKED`, concurrent claims, stale generation, rollback, outbox atomicity, approvals, recovery, and future tool invocation rows, this report does **not** claim production PostgreSQL proof.

## Remaining production gaps

1. Trusted container/microVM sandbox with immutable base, per-task overlay, process/resource namespaces, default-deny egress, metadata blocking, and runtime-minted isolation capability.
2. Durable tenant-scoped tool invocation/idempotency/outbox/artifact persistence.
3. Live provider protocol translation and bridge composition so coding workers actually call the controller.
4. Streaming encrypted artifact store for overflow output and patches.
5. Live PostgreSQL concurrency/rollback/atomicity validation.
6. Deployment E2E showing restart recovery without duplicate destructive mutations.

## Exact founder actions required

1. Review this candidate and independent review findings; do not merge any existing PR merely because GitHub reports it clean.
2. Decide whether this architecture may proceed while production tool execution remains feature-disabled pending the six gaps above.
3. Authorize and provision the sandbox/PostgreSQL infrastructure if production-grade execution is desired.
4. After all required CI is green and gaps required for the intended deployment are closed, explicitly authorize merge of the consolidation PR.
5. Only after landing, explicitly authorize closing the consolidated and superseded PRs. No closure is performed by Codex.
6. Separately decide whether #138–#144 merit fresh restacks; do not merge their historical branches directly.

## Independent review

A genuinely separate Codex sub-agent reviewed the final-direction diff. It found Critical issues in forgeable isolation attestations, final-component symlink writes, and cross-tenant idempotency, plus High issues in cancellation, bounds, atomicity, production wiring, and overclaimed documentation. This revision fixed final-component symlink refusal, tenant/run-scoped request-bound idempotency, pre-abort cancellation, one total output cap, reserved environment projection, reservation scoping, and the boundary placement. It corrected the capability matrix and security claims. The OS sandbox, durable transactional settlement, fully awaited descendant proof, bounded streaming filesystem search, artifacts, and production wiring remain open; therefore **this candidate is not merge-ready and must not be merged**.
