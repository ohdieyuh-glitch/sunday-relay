# Julius PR 9: a reference that cannot be resolved is not a reference

Durable artifact truth, audited on trusted main `9a399faa`. The audit found two
artifact systems that never touch each other. This closes the half that can be
closed without moving a single byte, and reports the half that cannot.

No provider was called and no credential was read. There was no Anthropic,
OpenAI or xAI spend of any kind. The attempt ceiling is untouched, and no
paid-qualification parameter moved.

---

## What the audit found

**A complete, hash-verified, content-addressed artifact store exists and is
wired to nothing.** `LocalJuliusArtifactStore` stages bytes, verifies them on
finalize AND on read, refuses a cross-tenant scope and an escaping path;
`julius_artifacts` holds its metadata; settlement re-hashes the bytes before the
row lands. Every production composition passes `artifacts: []`, so the table is
always empty and the verification branch is unreachable. That is known debt in
`JULIUS_BETA_READINESS.md`, and it is **not** what this PR changes.

What the live mission actually uses is a `Map<string,string>` in one process,
keyed **per run** — `plan:<runId>`, `diff:<runId>` — capped at 256 KiB and gone
on restart. Julius already fails CLOSED when a body is missing
(`reviewer_plan_absent`), which is right and already proven.

## The defect: the record ABOUT those bodies was false

| | before |
|---|---|
| `integrity_hash` on worker evidence | **NULL on 100% of rows** — while the adapter computed the sha256, cut it to 16 characters and wrote it into an English sentence |
| `artifact_ref` | a key into that `Map` — a durable row telling every later reader to look somewhere that no longer exists |
| the coordinator | took **both fields verbatim** from whatever the provider sent, with no shape check — while the tool path has refused an unverified reference since #208 |
| `julius_worker_results.evidence_ids` | `[]` on every attempt, **including attempts that had persisted evidence one line earlier** |

The digest was computed and thrown away. The pointer was kept and could never
resolve. That is exactly backwards: a digest survives a restart and identifies
the bytes; the key does neither.

## The rule

**A reference that cannot be resolved is not a reference.** It is kept only
when it names something that outlives the process that wrote it — `artifact:…`,
or the store's own `local://…`. A hash is kept only when it IS one: sha256,
lowercase hex, 64 characters. Everything else is null, which is the answer this
runtime already gives for a cost nobody reported.

So the truthful record of a body with no durable home is its **digest** and a
**null reference**. When the store is wired, the reference becomes real and
nothing else has to change.

Also fixed, same family: `evidence_ids` now names the evidence the result
actually cited. `provider_receipt_ids` stays empty because that is TRUE — no
provider receipt is minted anywhere in this runtime yet, and saying so is not
the same as pretending none was cited.

---

## Proofs

**New proofs (18)**

- `julius-artifact-reference.test.ts` (7) — what a digest is and what merely
  looks like one (a truncated digest, uppercase hex, `sha256:`-prefixed); what a
  durable reference is; and that **every key the live exchange actually uses** —
  `plan:run-1`, `diff:run-1`, `test-output:run-1`, `base:run-1`, `guidance:…` —
  is refused by name.
- `julius-evidence-artifact.e2e.test.ts` (7) — through the real pipeline: a
  durable reference survives; the Map key a live adapter used to write is
  dropped while the evidence itself is still recorded; a digest survives; a
  plausible non-digest does not; the two are independent (a body can be
  identified with nowhere durable to keep it); and the result row cites exactly
  the evidence of that attempt rather than claiming it cited none.
- `julius-postgres.test.ts` (2) — the `julius.evidence.recorded` event carries
  the digest and the reference instead of dropping both, and announces null
  where the row holds null. The stream is what a projection, an eval and
  Project Brain read; it was a weaker record than the row it announced.
- `coding-agent-port.test.ts` (2) and `julius-live-composition.test.ts` (1) —
  the adapters: the diff and the test output are named by their whole sha256
  (the test output carried **nothing** before), no durable reference is claimed,
  no digest is left as theatre in a sentence — and **an uncaptured diff is
  identified by nothing**, while the test output it did capture still is.

## Mutation testing

| Set | Run | Killed | Not killed |
|---|---|---|---|
| PR 9 — the vocabulary, the coordinator, the adapters, the announcement | 17 | 17 | 0 |
| PR 1 - PR 8 regression, at this head | 274 | 259 | 15 (see below) |

**The 15 not killed are 9 stale-anchor duplicates, 2 deliberate re-measurements,
and the same 4 PR 8 analysed — no new survivor.** The regression chain carries
both the original and the re-anchored form of nine mutants (PR 7's five gained
their killing proof in its third commit; three name lines PR 8 moved when the
in-memory append became shared; C2-M17 needs the PR 4 proof). **Every one of
those nine is killed in this same run** under its re-anchored name. The
genuine four are C3-M16 and P3-M15 — the equivalents documented at #270 and
#275 — and C3-M14 and P4-M23, whose detectors PR 8 superseded and which are
re-measured here on purpose so the claim stays measured rather than asserted.

One PR 9 survivor on the first run, and it was a real gap rather than a weak
mutant: nothing proved that an **uncaptured** diff gets no digest. A sha256 of
whatever `stdout` happened to hold would be a real digest of a body nobody
produced — the plausible-looking stand-in this column exists to keep out. That
case is now a test.

## Gates at the frozen head

Frozen head `92f670c9ae6ba3413a5b91ae6bd3b9ba4bc0a28a`, tree `e17a3278ae0c9047c04521aa88b02aded099db76`, on trusted main
`9a399faaf6925419446214b9a57d967e126cc2be`.

- `npm run typecheck` (four passes) — exit 0
- `julius:harness:check` — OK; `git diff --check` — clean
- `relay-repository-boundary.mjs`, `build`, `relay:build`, `relay:bridge:build`,
  `relay:hermes:build`, `relay-parity-gate.mjs`, `relay:surface-parity:check`
  and `:strict`, `relay:yc-demo:check`, `relay:cli:contract-verify` — all exit 0
- Julius kernel + bridge + persistence — 2 193 tests, 2 failing: the two
  dynamic-import tests that time out at 5 s under load and pass alone.
- Broad `vitest run`, whole suite, compared failure by failure against trusted
  main in a separate worktree at the SAME commit: **162 failing on the branch
  against 185 on main**, 158 shared. **Four branch-only failures, none of them
  this change:** two `julius-slot-envelope` / `repository-target-observer`
  load-sensitive tests that pass when run alone, and two
  `relay-hermes-service/signal-lifecycle` tests that **fail identically on the
  untouched baseline once the same `relay:hermes:build` artifact exists** —
  they only ran on the branch because the gate run had built it there. Nothing
  branch-only survives isolation.

**CI on the frozen head, all green:** Verify Relay (10m49s), `first-live-topology`
both jobs, `sibling-control-plane`, and the Vercel builds.

## Not in this PR

- **Artifact bodies are still process-local.** The store, the schema and the
  byte verification all exist and are proven; wiring them into the worker path
  — so a plan, a diff and a test output survive a restart, and so a repair round
  stops overwriting the round before it — is a boundary of its own and is the
  next one. Reported, not hidden.
- The attempt ceiling (2 declared vs 3 operative) remains the founder's
  decision. The job stays 120 minutes with the coder's share at 40.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
