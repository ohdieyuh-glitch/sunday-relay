# Hosted three-role Mission — evidence record

Written 2026-08-11 from real runs against production. Every claim below is
taken from a mission record returned by `/relay-api/mission/<id>`, not from a
test and not from intent. Where something is unproven it says so, and where an
earlier draft of this document overclaimed, the correction is kept visible
rather than silently edited — a corrected record that hides its corrections is
how the defects below survived.

**Surfaces:** bridge `sunday-relay-production-7d60.up.railway.app`, Hermes
Reviewer service `sunday-relay-production-e10d.up.railway.app`.

---

## The pipeline that was proven

```
Prompt Architect (OpenAI, gpt-4o, api-billed)
  → hosted Coding Agent (Claude Agent SDK 0.3.220, claude-sonnet-5, api-billed)
    → Relay's own verification (node --test, file-claim + protected-path policy)
      → independent Reviewer (Hermes Agent 0.18.2 → xAI, api-billed)
        → bounded repair on a blocking rejection → independent re-review
          → completion authority
```

Three vendors, three attestations, one completion decision that belongs to
none of them — including through a rejection and repair.

## Readiness, before any mission

| Fact | Evidence |
|---|---|
| Bridge reachable | `/relay-api/health` → `ok: true`, `roleSlotsBound: true`, `roleSlotRefusals: []` |
| Hermes service live | `/healthz` → `200 {"status":"ok"}`; unauthenticated `/v1/readiness` → `401` |
| Hermes runtime | `installed: true`, `version: "0.18.2"`, `compatible: true`, `machineInterfaceVerified: true` |
| Read-only enforceable | `readOnlyEnforceable: true` — the Reviewer's whole safety property |
| Provider | `provider: "xai"`, `credentialPresent: true` |
| Requested model | **none reported** — `requestedModel: null` on the live readiness surface |
| Reviewer occupant | `mode: "remote"` → `hermes_remote_service`, with `RELAY_ROLE_REVIEWER` unset |
| Hosted Coding Agent | `runtimeInstalled: true`, `0.3.220`, `credentialConfigured: true`, `blockedReason: null` |

**Correction.** An earlier draft of this table said the requested model was
`grok-build-0.1`. That string entered the repository in PR #107 as a test
fixture written during the repair-leg work and appears nowhere else; the live
readiness surface reports `requestedModel: null` and the remote review path
returned `model: null, provider: null`. A fixture value had been recorded as a
live fact, in the same document whose defect list said the served model was
unproven.

**Both halves of that are now fixed** — see defect 3 below. `requestedModel` was
null because the loader read a variable no deployment sets, and the remote path
no longer hardcodes a null model. What has NOT changed is that this table
records readiness as it was observed on 2026-08-11, before those fixes; a
re-probe against the deployed bridge is required before any newer value is
written here.

## Missions run

| Mission | Objective character | Outcome |
|---|---|---|
| `hosted-3role-1786401211` | fixture-aligned normalization | **verified_complete** |
| `pack-1-full-normalize` | fully specified, every rule stated | **verified_complete** |
| `pack-2-edge-cases` | behaviour-first: empty separators, doubled hyphens | **verified_complete** |
| `pack-3-minimal-change` | constraint-driven: no dependencies, no new files | **verified_complete** |
| `pack-4-underspecified` | deliberately vague — "make it correct" | **verified_complete** |
| `pack-5-no-regex` | hard constraint the idiomatic solution violates | **verified_complete** |
| `pack-7-optional-guard` | two-part: normalize AND an optional version guard | **verified_complete** |
| `pack-10-strict-export` | six rules plus a second export with an exact TypeError | **verified_complete** — approved, 12 requirements |
| `pack-6-schema-version` | objective broke the existing one-argument test | **failed** — `verification_failed`, tests failed |
| `pack-8-known-rejection` | objective the fixture cannot satisfy | **failed** — `review_blocked`, repair fired and was stopped by #110's defect |
| `pack-11-four-constraints` | no-regex + idempotency + collision + MAX_SLUG_LENGTH | **failed** — repair ran 9 turns and its report was rejected (#112's defect) |
| `pack-12-repair-cycle` | same objective, after #112 | **failed** — repair approved on re-review, refused as stale (#113's defect) |
| `pack-13-full-cycle` | same objective, after #113 | **verified_complete — through the full repair cycle** |

Eight completions across materially different objectives, four failures — one
correct refusal and three that exposed real defects, each fixed and re-run.

## The full repair cycle, observed live

`pack-13-full-cycle-1786430326`, in production, verbatim headlines:

```
18  Review validated — structured verdict accepted.
      Verdict changes_required · 1 finding(s) · 7 requirement(s) checked.
19  Finding prohibited-regex (blocking) persisted.
20  Repair attempt started — 1 blocking finding(s).
21  Claude Code session started.
22  Work submitted — "Rewrote normalizeProjectName in src/normalize.js to use
      manual character-by-character iteration instead of regex literals"
23  Claimed files match changed files. No protected files touched.
24  Required tests passed under Relay verification.
25  Repair verified — Relay re-ran the required tests itself.
26  Re-review complete — verdict approved.
28  Completion policy satisfied — MISSION VERIFIED.
```

A genuine rejection by the independent Reviewer, a bounded repair (one attempt,
findings only, same claimed file), Relay's own re-verification, an independent
re-review bound to the repaired artifact's own digest, and a completion in
which `artifactDigest === reviewedArtifactDigest === b2256c64902cbc00` — the
**repaired** artifact, on both sides of the comparison.

The rejection was real: the same objective failed twice on earlier deploys
(#112, #113 below), and the reviewer rejected the regex implementation every
time it appeared. Nothing about the objective was reworded between runs.

## The six proofs

**1 · Requested versus actual identity.** Every completed mission recorded
three attestations with `requestedActor === actualActor` and
`fallbackOccurred: false`:

| Role | Requested → Actual | Runtime | Billing |
|---|---|---|---|
| prompt_architect | ChatGPT → ChatGPT | `openai-chat-completions` | api_billed |
| coding_agent | Claude Agent SDK → Claude Agent SDK | `claude-agent-sdk-hosted` | api_billed |
| reviewer | Hermes → Hermes | `hermes-agent-cli` | api_billed |

**Correction.** The reviewer row previously said `subscription`. That value was
a hard-coded literal on five separate surfaces while the bound occupant is
registered `billingPath: 'api'` and reviews on an xAI API key — see #111 below.
`api_billed` above is what production now derives from the occupant that ran.

**2 · The Coding Agent actually changed the target.** Relay observed the diff
itself, from the worktree, after the agent exited: *"Claimed files match
changed files. No protected files touched. 1 claimed file changed · source
worktree unchanged."* The agent's own account is never the authority — and on
the repair leg, the same inspection ran again on the repaired worktree.

**3 · The Reviewer ran independently.** Hermes launched read-only with no
retries, on xAI, returning structured verdicts in both directions — `approved`
with 12 requirements checked on one mission, `changes_required` with a blocking
finding on another — and, on the full cycle, both verdicts inside one mission.
`completionVerified: true`.

**4 · Relay verified for itself.** It ran `node --test` against the fixture,
applied the file-claim and protected-path policies, confirmed the source
worktree unchanged, and bound an artifact digest so the review is tied to that
exact result. After a repair it did all of it again, and the completion
decision used the repair's own evidence — scope, tests, digest — not the first
attempt's.

**5 · Completion was earned.** Relay's own words at the decision point:
*"Independent review is REQUIRED for this mission. Passing tests alone, or the
coding agent's own claim, can never produce a verified completion."* On
approval: *"Completion policy satisfied — MISSION VERIFIED. Three genuine
execution attestations."*

**6 · Refusal is real.** Same pipeline, same infrastructure, opposite outcomes:
`pack-6` refused on Relay's own failing tests; `pack-8`, `pack-11` and
`pack-12` refused on review or on Relay's own staleness rule even when every
test passed. An approval that cannot be withheld is not a review — and a
completion authority that refused three of its own repair runs until the
evidence was genuinely coherent is not a rubber stamp.

## Defects found by running, and fixed

Every one was invisible to the full offline suite, and each cost a paid
mission to find.

| Fix | Defect | Why tests missed it |
|---|---|---|
| #99 | Bridge demanded lifecycle `running`; the service emits `ready` | Both fixtures invented `'running'` |
| #100 | The mission catch discarded the error entirely | Nothing asserted on a throw's content |
| #101 | A report failure carried no run shape | The observation held the answer; nothing surfaced it |
| #102 | The hosted execution report was truncated at 600 chars | Fixtures were shorter than the cap |
| #103 | The bridge asked for a review with `limits: {}` | Each side's tests were correct about itself |
| #104 | "Could not read the review" covered six distinct causes | No test asserted on the reason |
| #105 | The Reviewer's verdict was truncated at 600 chars | Fixtures were shorter than the cap |
| #106 | **The Reviewer was judging a 600-char fragment of the diff** | Silent — a confident answer about the wrong text |
| #109 | A repair producing nothing said nothing | Written by me, in the same session |
| #110 | Every repair was stopped for not carrying the objective — a check meant for first attempts applied to a prompt that deliberately omits it | No test drove the coding leg with a `revision` |
| #111 | Every review attested `subscription` on five surfaces while the occupant is registered `api`; `isPaidApiCall` therefore never counted a real review | Four tests asserted the literals; one passed vacuously against the wrong row |
| #112 | The repair prompt demanded "the same JSON object shape" — a back-reference to a prompt the fresh session never saw; a 9-turn repair was discarded on report validation | No test read the revision prompt alone |
| #113 | An approved repair was refused as stale: the repair updated the review but not the evidence, so completion compared the new review against the old artifact — and would have judged a scope-breaking repair on a pre-repair inspection | The harness returned one constant digest for every run, so the completing-repair test passed against broken code |

Three root causes recur. A **display sanitizer reachable from payload paths**
(#102, #105, #106) — each time the refusal blamed the other party. A
**cross-component contract with no shared test** (#99, #103, #112) — each half
correct about itself; the fixes import the other side's real validator or emit
from one shared source. And a **stale sentence carried as fact** (#111, #112):
"billed by subscription" and "resuming this exact session" were both true once,
both stopped being true when the hosted service arrived, and both were load-
bearing — one mis-stated every review's cost on the founder's own billing row,
the other made the report back-reference look reasonable.

#113 adds a fourth worth naming: **a fixture that cannot distinguish the case
under test**. The test "repairs, re-reviews, and COMPLETES" existed and passed,
against code that refused every real repair, because the harness gave the
repaired artifact the same digest as the original. The proof a test bites has
to be run against the failure it names — that fixture now reproduces the
production refusal verbatim when the fix is removed.

## Defects found by running, and carried out of the goal

Recorded rather than repaired at the time, because fixing them would have
widened a goal that was scoped deliberately. **Defect 3 was mandated as a
carry-over and is now closed** — its entry below keeps the original diagnosis,
says where that diagnosis was wrong, and states exactly what is and is not
proven. Defects 1, 2 and 4 remain open.

**1 · An in-flight mission vanishes when the bridge restarts.** The mission
registry is an in-memory `Map`. A Railway redeploy mid-mission leaves
`/relay-api/mission/<id>` answering `mission not found` — after an Architect
call, a Coding Agent run and a Reviewer have been paid for. Relay's own rule
says an unconfirmable in-flight run becomes `disconnected` and is never
replayed; the persistence layer honours that, the bridge's registry does not.
Observed directly: a merge to `main` destroyed a running mission. Operational
consequence while this stands: **never deploy while a mission is in flight.**

**2 · The repair leg covers review rejections, not verification failures.** A
mission whose tests fail ends at `verification_failed` with no second attempt —
arguably the most repairable failure there is. Outside the goal's wording, so
left alone.

**3 · The reviewer's served model is not proven. — CLOSED 2026-08-11.**

As recorded: the live readiness surface reported `requestedModel: null`; the
remote review path returned `model: null, provider: null`; the mission's
reviewer attestation carried no model; and the bridge's model check read
`RELAY_REVIEWER_MODEL` (unset on the bridge) while the service reads
`RELAY_HERMES_MODEL` — two names for one fact. The review demonstrably happened
and was billed; which xAI model produced it was not attested anywhere a founder
could read.

**What the diagnosis missed.** The attestation did not "carry no model" — it
carried the WRONG one. One `model` field held two different facts, and the
reviewer leg resolved it as

```
resolvedModel = reviewOutcome.model ?? hermesReady.model
```

where both operands were configuration. Because the remote path hardcoded
`model: null`, every hosted review fell through to the preflight's configured
value, which was then written into the attestation AND rendered on the review
card as the model that reviewed. The defect was not an absence. It was a
requested model wearing the served model's clothes.

**How it is closed.** Requested and served are now separate fields at every
layer, and the served axis has no fallback anywhere:

| Layer | Before | Now |
|---|---|---|
| `ExecutionAttestation`, `MissionAttestationSummary` | one `model?` | `requestedModel?` + `actualModel?` |
| `MissionReview`, `MissionArchitectReceipt` | one `model` | `requestedModel` + `servedModel` |
| `HermesOutcome` (all three reviewer paths) | one `model`, three meanings | `requestedModel` + `servedModel` |
| `runHermesReview` (local spawn) | never passed `--usage-file`; reported `cfg.model` | asks Hermes for its usage report and reads the model out of it |
| `runRemoteHermesReview` (hosted) | hardcoded `model: null`, never read `usage` | reads the service's own `usage.model` |
| both harness transports | copied token counts, dropped the model | carry `usage.model`; a report naming only a model is still a report |
| `loadXaiConfig` | read `RELAY_REVIEWER_MODEL` | reads `RELAY_HERMES_MODEL`, with the old name still honoured |

Three rules now hold, each with tests that fail against the previous code:

1. **Unknown stays Unknown.** A provider that names no model yields
   `servedModel: null`, an attestation with no `actualModel`, and the words
   *"served model not reported by the provider"* in the record. It is never
   promoted to a match with the requested model.
2. **A substitution is refused.** Both facts known and disagreeing means the
   provider substituted the reviewer. `fallbackOccurred` becomes true, the
   mission fails `review_incomplete` with both model names in the message, and
   an `approved` verdict from a substituted model never completes a mission.
   The same rule applies to a re-review: the original rejection stands.
3. **The requested axis may fall back; the served axis may not.** The requested
   model may come from the preflight (also a statement of what was asked for);
   the served model comes only from the provider.

**Also fixed in the same class, one role over.** The architect's Live Terminal
label read `receipt.model` — the deprecated spelling, which carries the
REQUESTED model — so `gpt-4o` served by `gpt-4o-2024-11-20` was displayed as
`gpt-4o`. The label now names the served model, and says *"(requested; the
provider named no model)"* when there is none. And `coding.ts` spelled its
attestation field inside an object SPREAD, where TypeScript performs no
excess-property check: the rename compiled clean while silently dropping the
coding agent's served model into a field nobody reads.

**Not claimed.** No paid xAI review has been run against this code. The chain is
proven end-to-end against a fake `hermes` process that writes a real usage file
and a fake service that returns a real usage block — which proves the plumbing
and the refusals, not that xAI reports a model in production. The first hosted
review will either populate `servedModel` or leave it `null`, and both outcomes
are now truthful and legible. Tests: `relay-bridge/reviewer-served-model.test.ts`,
the `defect 3` block in `relay-bridge/orchestrator.test.ts`, and the served-model
cases in `relay-bridge/reviewer-harness/hermes/remote-transport.test.ts`.

**4 · The bridge does not report its deployed commit.** `/relay-api/health`
carries no build identity, so proving "the fix is live" requires observing
behaviour only the new code can produce. It worked here (#111's `api_billed`
appearing in the next mission's attestation) but it is inference, not evidence.

## What this evidence does not cover

- **One repository.** Every mission edits Relay's controlled fixture. Nothing
  here says anything about a real codebase — see
  `FUTURE_GOAL_CONFIGURABLE_REPOSITORY_TARGETS.md`.
- **One reviewer verdict shape.** Grok answered in Relay's structured format
  every time it was given an intact payload. Whether it does so on larger
  diffs is untested, and #106 is the reason to care.
- **No Loop ran.** The only Loop agent shipped simulates its iterations and
  production refuses it by design.
