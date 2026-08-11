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

**THE FIRST FIX INTRODUCED A WORSE DEFECT, and an independent review found it
by running the code.** The rule was written as `requested !== served`, which
calls `gpt-4o` answered by `gpt-4o-2024-08-06` a substitution. That is the same
model named exactly, it is what every provider does, and the test file that
shipped with the fix calls it *"the ordinary case"* in a comment. On
`openai_reviewer` — the reviewer configuration `FOUNDER_TESTING_HANDOFF.md` and
`.env.example` both recommend for a hosted run — a mission then died at the
review step with `retryable: false`, after the review had been paid for, and the
founder was told their provider had swapped the reviewer. Removing the refusal
alone would not have fixed it: `fallbackOccurred` blocked the mission a second
time, through `attestsRealExecution`, with a message that said the reviewer
returned no valid review.

`relay-bridge/model-identity.ts` is now the ONE rule, and both review legs and
the architect leg call it — the architect leg was attesting
`fallbackOccurred: false` for the identical relationship four hundred lines
earlier in the same file. A `resolution` (requested family + a version-shaped
snapshot suffix) is truthful on both axes and is not a fallback. A `substitution`
is refused. `gpt-4o` → `gpt-4o-mini` is a SUBSTITUTION, not a resolution: a
"prefix plus separator" rule accepted it, and `-mini`, `-turbo`, `-preview` and
`-latest` are all different, weaker, or unnamed models. `modelMatchesVerified`
in the xAI harness had its own exact-match copy of this rule with no production
caller; it delegates here now, because two legs deciding one fact by different
means is how they came to disagree.

Three rules now hold, each with tests that fail against the previous code:

1. **Unknown stays Unknown.** A provider that names no model yields
   `servedModel: null`, an attestation with no `actualModel`, and the words
   *"served model not reported by the provider"* in the record. It is never
   promoted to a match with the requested model.
2. **A SUBSTITUTION is refused — and not every difference is one.** The rule is
   `classifyModelIdentity`, whose relations are the vocabulary: `exact` and
   `resolution` are accepted; `unknown` and `alias_unverifiable` are neither
   accepted nor refused and say so in the record; only `substitution` is
   refused. "Both facts known and disagreeing" is NOT the rule — that phrasing
   IS the regression the paragraph above describes, and it stood here for
   twenty-nine lines after that paragraph was written. A re-review caught it. `fallbackOccurred` becomes true, the
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

**What the independent review also found, and what it cost.** Nine findings, one
High and four Medium, all repaired in the same change:

| # | Finding | Repair |
|---|---|---|
| 1 | the version-resolution regression above | one shared rule, both legs, and the architect |
| 2 | an adopted re-review overwrote the review CARD's model facts and not the ATTESTATION, so the two described different reviews for one mission | the attestation is rebuilt from the second outcome |
| 3 | the PRODUCER half of the hosted chain (`local-transport` → `service.ts`) had no test — 212 passed with it reverted | a real fake-Hermes → real service → real HTTP test, using a new fake scenario that reports a RESOLVED model so `clean`'s echo cannot pass it by accident |
| 4 | the two founder-facing surfaces had no test at all — both could be reverted to the requested axis silently | `H-1.8` in `review-verification-truth.test.ts` |
| 5 | a comment claimed the served model "renders as not reported"; the row DROPPED the segment, going silent in exactly the case this work exists to make legible | renders `served model Unknown`, matching the provider one field over. **The comment the finding actually cited was missed in round 2 and corrected in round 3** — the repair changed the row and left the sentence, so the divergence survived its own repair and this table recorded it as fixed. Two greps found it. |
| 6 | "the one funnel every outcome passes through … six `finish` call sites" — the spawn throw bypasses it, and there are four | corrected |
| 7 | the liveness probe's argv no longer mirrored the mission's after `--usage-file` was added, which is exactly what its comment existed to prevent | the probe passes it too |
| 8 | "the first of three layers" said twice, of two different layers, against a table that says four | named by position instead |
| 9 | the rule was implemented twice | one means |

**ROUND 3 — the re-review found that the repair had defects of its own.** The
pattern this repository keeps producing held for the third time: *every review
round finds something the previous round's author asserted rather than checked.*
One High and six Medium, all repaired:

| # | Finding | Repair |
|---|---|---|
| H-1 | the architect's newly-derived `fallbackOccurred` reached `attestsRealExecution` → `decideCompletion`, so a substituted architect model killed the mission **at the very end** — after the Coding Agent and the Reviewer had both run and been paid — under the message "The Prompt Architect did not produce an attested execution", with no event naming a model anywhere | refused at the architect step, `prompt_architect_failed`, both model names in the message, an event that explains it, and the Coding Agent never dispatched |
| M-1 | `.` was in `RESOLUTION_SEPARATORS`, undocumented, and made `gpt-4` → `gpt-4.1` a "resolution" — a version BUMP is a different model. The comment enumerated four separators while the array held five, and the undocumented fifth was the unsound one | `.` removed; the separator list and its sentence are now asserted against each other; a three-digit floor added, because `gpt-4o` → `gpt-4o-2` and `claude-3` → `claude-3-5` also matched |
| M-2 | the "three rules now hold" list still stated `requested !== served` as the current rule, twenty-nine lines below the paragraph describing it as the regression | rewritten in `classifyModelIdentity`'s vocabulary |
| M-3 | `MissionReview.servedModel`'s own doc said a review served by "a model other than the requested one" never reaches the record — the rule the repair exists to remove | corrected to name substitution |
| M-4 | the comment the round-2 finding actually cited was never changed; only the row was, so the divergence survived its own repair and this table recorded it as fixed | comment corrected; the table row above now says so |
| M-5 | the rebuilt reviewer attestation gets a new id (derived from `missionId:role:startedAt`), so an earlier event's `attestationRef` pointed at an attestation the record no longer held — and it was the event a founder reads first | a notice naming BOTH ids; the reference is explained rather than erased, because the first attestation really did exist and really was superseded |
| M-6 | the same over-refusal class as H-1 from round 1, for provider ALIAS ids: `claude-3-5-sonnet-latest` → `claude-3-5-sonnet-20241022` was refused, discarding a paid review | a fifth relation, `alias_unverifiable` — Relay holds no alias table and must not invent one, so the record says the check could not be made rather than pretending either way. Bounded: an alias answered by another provider's family is still a substitution |

Seven Low findings were repaired too, including a probe cleanup that was not in a
`finally`, and a `--help` gate that did not check the `--usage-file` flag the
probe had just started passing — so a hermes build without it failed as "the
one-shot probe produced no output", a message naming the wrong cause.

**The meta-finding, which is the one worth keeping.** H-1 shipped because the
test written for it asserted `fallbackOccurred === true` and never looked at
`view.state`. A test that checks a flag and not the outcome agrees with the code
about a field and knows nothing about the behaviour. That test now asserts the
mission state, the error code, both model names in the message, and that the
Coding Agent was never called.

**REAL EVIDENCE, from the actual Hermes binary — and what it does NOT prove.**
Probed directly (Hermes Agent v0.18.2, isolated `HERMES_HOME`, no credential, so
no provider call could succeed and nothing was spent):

```
$ hermes -z "…" --safe-mode --usage-file <path> -m grok-4 --provider xai
hermes -z: agent failed: No usable credentials found for provider 'xai'. Set XAI_API_KEY.

$ cat <path>
{ "estimated_cost_usd": null, "input_tokens": null, "output_tokens": null,
  "total_tokens": null, "api_calls": null, "model": null, "provider": null,
  "session_id": null, "completed": null, "failed": true,
  "failure": "No usable credentials found for provider 'xai'. Set XAI_API_KEY." }
```

**What this proves:** the real binary accepts `--usage-file`, writes the file even
on failure, and its schema contains a `model` key AND a `provider` key. Relay's
parser reads the right field name from the right file. The plumbing is aimed at
something that exists.

**What it does not prove:** that xAI populates `model` on a SUCCESSFUL review.
The value is `null` here because the run failed at the credential, before any
provider was contacted. Settling it needs one real paid xAI review — a founder
authorization boundary — and the single command that would settle it is the probe
above with `XAI_API_KEY` set.

**A misattribution avoided, recorded because it nearly became evidence.** Eight
`/tmp/relay-hermes-review-*/relay-hermes-usage.json` files on the dev box contain
`{"input_tokens":1200,"output_tokens":300,"model":"grok-4-0709"}`, and an
independent review flagged them as possible real xAI output. They are **test
fixtures**: `1200`/`300` are the literals `reviewer-served-model.test.ts` writes
(Hermes' own fake writes `340`/`1540`), and their timestamps match that file's
run. Reporting them as served-model evidence would have been fabrication by
misattribution — the exact thing this defect is about. They also proved the
scratch-directory leak was real: after the cleanup fix, a full run of that file
leaves **zero** directories behind.

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
