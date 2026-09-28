# Julius beta readiness

> **THIS SECTION SUPERSEDES THE 2026-08-30 ASSESSMENT BELOW.** That one is kept
> because it is the record of what was believed then, and because two of its rows
> were wrong in a way worth remembering: it scored the context integrity layer and
> the Project Brain trust core as present, and every exported function in both
> threw `*_not_implemented`. A capability matrix that reads a declared signature
> as a capability is the failure mode this document is supposed to catch.

**Assessment date:** 2026-09-26 UTC.
**Base reviewed:** `origin/main` `a384b21590c664f752682de86f4dcc6fb533849d` (#287),
plus the three commits on `relay/julius-beta-qualification` described at the end.
**Julius is not beta-ready.**

## The five things a row may claim, and they are strictly cumulative

| | Means |
|---|---|
| **IMPLEMENTED** | The code exists and does the thing. Nothing about whether anything calls it. |
| **UNIT/INTEGRATION TESTED** | `npm test` holds its behaviour, including through the composition that would call it in production. |
| **LIVE PROVIDER VERIFIED** | A real provider answered, and the record names which model. |
| **ADVERSARIALLY VERIFIED** | Something tried to break it: a mutation campaign, a hostile input, or a control case proving the test could have failed. |
| **RELEASE QUALIFIED** | A representative end-to-end mission exercised it with no founder rescue, and the evidence survives the database. |

A large test count is none of these on its own. Two rows below are
ADVERSARIALLY VERIFIED and not LIVE PROVIDER VERIFIED, which is exactly the
shape of this run: the money was not available to spend, and the proofs that did
not need money were built instead.

## The scorecard

| # | Area | Weight | Complete | Highest claim held | Evidence | Remaining gap |
|---|---|---|---|---|---|---|
| 1 | Core runtime | 12 | **88%** | RELEASE QUALIFIED | Paid run 34414726976 completed 4 ticks, VERIFIED, no rescue. 1,830 passing cases under `src/relay/mission/julius`; 161 through the live composition root. **Breadth, on the live path:** a mission that declares no deterministic check (`testCommand: ""`) now parses, constructs the live coder, runs nothing, records no TEST row, is held to the DIFF it produced, and tells its reviewer no check was declared. Before this, the only way to run a report or analysis mission live was to give it a fake test command and record evidence of a check nobody declared. | Nothing mounts `JuliusRuntimeApi`. Bodies still live in an in-process exchange (PR #286 frozen). |
| 2 | C.A.R.D. lifecycle | 7 | **80%** | UNIT/INTEGRATION TESTED | Policy, autonomy, concurrency, subagent ceiling and approvals are proven in the kernel and through the live composition. | No operator lifecycle channel is composed: `julius-lifecycle-postgres.ts` is declared-not-reached. Pause/resume/cancel exist and nothing serves them. |
| 3 | Task Contract / governance | 8 | **88%** | LIVE PROVIDER VERIFIED | Proposed → revised → **locked by the independent evaluator** → one binding digest carried by the coder AND its reviewer, read from two independently-produced tables of a paid bundle. | The CHALLENGE leg has never run against a provider, and paid run 34414726976 recorded no disposition for its absence. Silence is not a disposition. |
| 4 | Project Brain / persistence | 8 | **80%** | ADVERSARIALLY VERIFIED | 26 migrations, journal-as-authority, recovery drills, brain writes authored by the run itself, replay-absorbing appends. The v2 trust core is implemented with its seeded specification committed beside it. **The claim store now exists at its minimum:** `julius_claim_standings` (migration 026), append-only with history, one port (`JuliusClaimStore`) on both stores; every brain write the runtime makes ADMITS a claim at the standing the derivation gives it (one definition); an Independent Reviewer's accepted review PROMOTES the reviewed work's entries to VERIFIED through the trust core — which refuses self-verification by name and the record shows it; the compiler reads the recorded standing in place of the derived one. Proven on the memory store in a real run (`julius-continuous-lifecycle.e2e`: three promotions with history, one refusal by name, a replay that manufactures nothing), on the unit ledger (12 cases), and on real PostgreSQL (gated suite, 2 cases, run locally against the container). | **No asserter of `supersedes` or `contradicts`** — the runtime does not know two entries disagree and nothing infers it from text (deferred by the founder), so the fail-closed clash path is still reachable only through its seam. (A delivered guidance row was attributed to the worker whose tick delivered it; it is now attributed to its AUTHOR, the architect, with the deliverer on the `guidance.delivered` event — so self-verification follows authorship, and the delivered answer is promoted when the continuation's review accepts.) Artifact bodies are durable (PR 11) and unwired (PR #286). |
| 5 | Context integrity | 8 | **87%** | ADVERSARIALLY VERIFIED | Implemented and **wired to the real dispatch path**. 39 unit cases (the paid mission's own spec, ported, plus 16 more) and 12 e2e cases that read the packet a live Coding Agent was handed out of the durable snapshot. The 120-distractor selector case and a 60-distractor delivery case both hold; a control shows the pre-integrity compiler losing the needed fact at the same budget. Decision durable in migration 025. A second pass added the task-isolation half: prior-mission residue scoped to another task, another role and SECRET is excluded from the learning mission’s packet AND reported as excluded, with a control proving the reviewer still receives its own material — a scope, not a filter. **The standing the compiler ranks on is now the RECORDED one** where a claim exists (`mergeJuliusDurableStanding`): a memory a reviewer verified ranks as VERIFIED in every later packet of the run, not as whatever its kind derives to. | Lineage is still unasserted (see 4), so `conflicts` is `[]` on every live packet and the fail-closed path is driven only through its seam. The `GOVERNANCE` authority rung is reachable by no derived claim, and says so. |
| 6 | Evidence / provenance | 8 | **88%** | LIVE PROVIDER VERIFIED | Digests recorded, unresolvable references refused (PR 9), decision + history in one write (PR 8), one append contract across both stores (PR 7), attempt-scoped workspace truth (PR 6), and every event dump ordered by `stream_id,sequence` rather than a tying wall clock (#254). `julius-evidence-completeness.e2e` now reads every field the brief names back out of one real mission, and found the defect below while doing it: the trajectory’s four measurement columns were null on every successful dispatch, so the whole eval layer was projecting an empty column. Fixed at the coordinator, which had the numbers all along. | The bundle cannot yet resolve a body: the artifact exchange that would make an `artifact_ref` resolvable is PR #286. |
| 7 | Reviewer independence | 7 | **88%** | ADVERSARIALLY VERIFIED | Independence is structural — a shared independence group is refused at binding, before spend — and read-only is structural too. **A reviewer now demonstrably catches a real defect:** a content-derived verdict over the coder's actual diff, with a control proving the same judge approves the clean version first, and a no-laundering case where an unrepaired defect is caught again and the run does not complete. And a real hole closed: a sub-agent could carry `role: INDEPENDENT_REVIEWER` under an ordinary task type, putting the reviewer inside the swarm. Reproduced red, guarded, and the guard pinned to exactly one role wide. | The catch is zero-spend. Paid run 34414726976 recorded, as its own gap, that its reviewer never had a defect in front of it. |
| 8 | Repair / recovery | 7 | **85%** | ADVERSARIALLY VERIFIED | Repair lineage, effective-verification semantics, a crash injected at every transaction boundary, nothing executed twice across a restart, an honest park when a repair round is refused. | The two persistence gates **cannot run on Windows at all**, and now say so in one line instead of failing seven steps that look like recovery defects: they spawn the repository's fake provider executables, which are Node scripts made executable by a POSIX shebang, and `CreateProcess` honours neither. Both exit non-zero rather than reporting a vacuous pass. Their last recorded green is CI. The three Julius drills (`julius:recovery-drill`, `julius:failure-recovery-drill`, `julius:repair-loop-drill`) were not run in this session. |
| 9 | Learning Loop | 5 | **78%** | ADVERSARIALLY VERIFIED | A measurement and a promotion gate, not a learner. A matched pair driven through the REAL run loop: the mission without the learning takes a repair round because the real context compiler could not carry a fact nobody stored. The gate refuses on regression, on no effect, on an unmatched pair, on an unmeasured dimension and on a policy that could not refuse anything. The cost and token dimensions are now genuinely measurable rather than permanently UNMEASURABLE, and the refusal case gained the counterpart that makes it non-vacuous: on a priced pair the dimensions are measured and mission A’s repair round is provably more expensive. No irrelevant task context leaks into the improved mission. **A promotion now has somewhere to land:** a reviewer-verified memory is a durable VERIFIED standing with its history, which is what the loop's promotion gate was measuring toward with nothing to write to. **AND THE CARRY IS REAL NOW.** The bootstrap inherits the project’s VERIFIED and APPROVED claims into each new mission (`relay-bridge/julius/mission-knowledge.ts`: capped at 12, newest first, never from the run doing the carrying, never across projects), keeping each fact’s author, evidence and standing — so mission B ranks a reviewer-verified fact as verified and still cannot self-verify it. Proven against real PostgreSQL: A’s verified fact is inherited, A’s assertion is not, a replay inherits nothing twice, another project inherits nothing. The matched-pair packet proof now uses the carry’s own entry ids and reads the standing off the record. | The worker's knowledge-dependence is the fixture's PREMISE and is stated as one; a real model's version of it is noisier. Nothing in the runtime calls the loop — it is an evaluation surface read after a mission. No paid matched pair exists. |
| 10 | Provider conformance | 8 | **55%** | LIVE PROVIDER VERIFIED (one leg) | The registry now carries a qualification per occupant, keyed to the **served model**, with 22 structural cases including the anti-generalisation rule as a function. Requested and served are separate fields everywhere. | **Two of the three legs cannot be pinned to a model.** Paid run 34414726976 ran a real architect and a real coder and its bundle names the served model of the reviewer only, because `worker-diagnostics.tsv` held zero rows on the success path. One leg is VERIFIED: `hermes_local` at `grok-build-0.1`. |
| 11 | Failure handling | 7 | **88%** | ADVERSARIALLY VERIFIED | Five provider failure codes, a malformed result, a timeout, budget pressure, a reviewer rejection, a repair cycle, a restart, an unresolved evidence reference — and now a **context-authority conflict that fails the task closed instead of aborting the tick**, with both conflicting claim ids on the ledger row. A failed attempt that BILLED now carries its spend on the row the evals read, so a mission that spent and then failed no longer reports a total biased low. **And a provider declining the REQUEST is now its own class:** `CONTENT_REFUSED` on the Coding Agent (the hosted classifier's `content_filtered`, which used to fall through to UNCLASSIFIED), carried as `INVALID_REQUEST`, never retried, never an operator action; the Prompt Architect's `refused` carries the same code. Proof: `julius-continuous-lifecycle.e2e` (one call, FAILED, the class and the code on the record, not AUTH_CONFIGURATION) and the provider taxonomy table. **And a refusal is ROUTED, not merely named:** Julius raises a `PROVIDER_DECLINED_REQUEST` checkpoint itself, the architect restates the ask, the work continues in a continuation segment and the refused task ends SKIPPED — one re-plan per unit, bounded by durable state, and a second refusal fails truthfully. The reviewer has its own class (`review_content_refused`) and is deliberately NOT re-planned, because an unjudged change may not be completed around. | The Independent Reviewer's provider cannot report a content refusal: a Hermes decline arrives as a verdict that does not parse and is filed as malformed. Nothing yet ROUTES a refusal — the task fails and the run does not complete, which is truthful, but re-planning the ask through the architect is not attempted. The full tool-failure path needs the executor's Docker sandbox and was not exercised here. |
| 12 | Wonderland integration contract | 4 | **97%** | UNIT/INTEGRATION TESTED | `inspectSlots` projects the three peers from the durable ledger: state, provider identity, requested vs served model, a cost FLOOR with `costComplete` beside it, last failure class, findings raised. 11 e2e cases drive it from a real mission. `docs/JULIUS_WONDERLAND_CONTRACT.md` states the four rules a client must implement. **Mounted:** `GET /relay-api/julius/runs/<id>/<view>` on the bridge, operator-only, read-only, composed over the same PostgreSQL store the mission job writes through; with no `DATABASE_URL` it answers 503 naming the variable. 9 route cases over a mission the harness really ran. **Now also CREATION:** `POST /relay-api/julius/missions` takes a contract exactly as the contract file is written, through the contract library's own parser and the same `createLiveJuliusBootstrapPort` over the same two repositories, and lands the run durable in READY for the read routes to watch. It says `dispatched: false` on the wire. 12 route cases over the REAL bootstrap port with a recording store. Found on the way and avoided: importing the parser from the mission job's entry file put the job's `require.main === module` guard inside the server bundle, where it is true — the bundled server printed the job's usage line at startup. The parser and compiler now live in `relay-bridge/julius/mission-contract.ts`, a library with no entry guard, re-exported by the job. **And the loop’s last step has a projection at last:** `GET .../result` answers the only question a user asks — verified (the runtime’s completion decision, quoted, never recomputed), each criterion with what satisfied it, the deliverables (a product, never a reviewer’s finding, with `retained: false` where no body was kept), the cost with its unknowns, and a failure that a FAILED run can always name. Before it, a surface had to assemble that answer from six reads and its own idea of completion. | Driving a run is not reachable from a client (a created run stays READY until the mission job drives it — the deployment decision that spends money, deliberately not taken here), and a browser session cannot read it (a product decision about which fields a session may see). **Both routes are now exercised against a real PostgreSQL:** `julius-bridge-seam.real-postgres.test.ts` (3 cases, gated like the other real-postgres suites and added to the real-infra workflow) proves through the production compositions that what a client creates is what it watches and both are what the tables hold; and on 2026-09-27 the built bridge process was driven over HTTP against that database by hand — recorded in the handoff with the run id. **And a real Unreal client has now called it**: the integration lane's first in-engine (PIE) acceptance, on the production bridge against an isolated PostgreSQL, had a paired player's world adopt the exact run Julius created, switch between two runs of one mission and back, read STALE on a dropped link without touching the mission, and recover the same durable run across a reconnect and a full play restart — with Julius's side showing both runs READY and never dispatched. That is another lane's proof on another branch (`relay/wonderland-julius-integration` @ `f28a61a5`, Core build `8cccaa50`), quoted in `docs/JULIUS_BETA_LANDING.md` and deliberately NOT a row in this repository's ledger, because nothing here can resolve it. | Driving a run is still not reachable from a client, and a browser session still cannot read it. The in-engine acceptance exercised the create/observe contract as of Julius `00fa52ad`: no Unreal client has called the `result` view, and the visible Missions panel still draws the simulated presentation, so a player sees "No mission is running" while the world follows a real run (their clause A06e). |
| 13 | Performance / reliability | 5 | **72%** | UNIT/INTEGRATION TESTED | Bounded graphs, a large-graph case, a 5,000-row read ceiling, per-role context budgets, derived lease and deadline windows. **And now multi-mission evidence, which did not exist:** three missions through ONE run loop all reach verified completion, interleaved (a tick serving more than one run, the fairness share honoured); cross-mission isolation is asserted per mission over evidence, findings, decisions, brain entries AND the compiled packets each worker was handed; a mission that fails permanently does not take its neighbours with it; and twelve missions pay exactly 48 dispatches in fewer than 48 ticks, timed rather than thresholded. `src/relay/mission/julius/julius-multi-mission.e2e.test.ts`. | No LATENCY evidence: providers are replaced at their boundary, so what is measured is Julius’s own scheduling and bookkeeping, not a real mission’s wall clock. No PostgreSQL-backed concurrency measurement (the multi-mission proof runs on the in-memory store, where the claim query is a model of the real one). Still no green full suite on this platform (see below). |
| 14 | Final release qualification | 6 | **40%** | LIVE PROVIDER VERIFIED | One paid mission has completed end to end with no founder rescue: 34414726976, with four gaps it recorded itself. The MVP qualification suite now exists as a ledger organised by the founder’s four categories (`docs/JULIUS_MVP_QUALIFICATION.md`), every row resolved by a test: 8 software, 3 game, 4 professional-work and 10 failure/recovery missions, all deterministic, plus the one live run. | The representative PAID mission has not been run, and no Unreal change has been made under Julius’s contracts — the founder’s strongest qualification environment is entirely unexercised. The Docker executor proof is CI-only (Linux runner: image builds, a tmpfs mount, generated keys). |

### JULIUS BETA READINESS: 80%

`Σ(weight × complete) / 100`, weights summing to 100.

**EIGHTH PASS, 2026-09-27: 80.0 → 80.05.** Row 12 rises 95 → 97 on evidence this
lane did not produce: the integration lane's first in-engine acceptance, which
put a real Unreal client on this contract for the first time. The rise is small
on purpose — the number is about the contract's quality, the proof is another
lane's, and one of its own criteria (the visible panel) is unmet.

**SEVENTH PASS, 2026-09-27: 79.8 → 80.0.** Row 12 rises 92 → 95 for the result
view — the MVP loop’s final step, "returns a truthful verified result", which
had no projection at all: every client would have assembled it differently, and
the first to get it wrong would have shown a mission as done while a criterion
had no passing evidence.

**SIXTH PASS, 2026-09-27: 79.0 → 79.8.** Row 13 rises 55 → 72 for the
multi-mission evidence that did not exist — three missions through one loop,
isolation asserted over the packets themselves, a failure that stays in its own
run, and twelve missions measured. The founder’s fourth mission class
(everyday/practical work) also has rows now, including the honest one: a mission
whose acceptance needs an action no tool can take does NOT complete.

**FIFTH PASS, 2026-09-27, latest: 78.3 → 79.0.** Row 9 rises 68 → 78 because the
Learning Loop’s premise became a fact — the bootstrap really carries a prior
mission’s verified knowledge, and the packet proof reads the carried standing off
the record instead of off a fixture’s assertion. Row 11 rises 86 → 88: a content
refusal is a class on all three peers AND is routed into a re-plan instead of
collapsing the mission. Row 12 rises 90 → 92 for the active-run guard and the
rerun path, both exercised over the real bridge binary by the integration lane’s
own drill (31 of 33 clauses, then the two it caught fixed).

**AND A DEFECT IN THIS LANE’S CODE THAT ANOTHER LANE HAD TO FIND.**
`workspaceContained` in the Docker sandbox adapter never checked
`isAbsolute(rel)`, so on Windows another drive and a UNC share read as
CONTAINED — and that predicate gates `permittedWorkspace`, which decides what
gets mounted. Every POSIX case passed, which is how it survived. Fixed, with
the four cases that would have caught it. It is recorded here rather than in a
commit message alone because "the tests pass" was true the whole time.

**FOURTH PASS, 2026-09-27, later still: 77.2 → 78.3.** Row 4 rises 72 → 80, row
5 85 → 87 and row 9 62 → 68 for the claim store at its minimum — a durable
standing with history, promotion on an accepted review through the trust core,
the record winning at compile — which is the +2.5-not-+6 this page estimated
for it, and no more, because no asserter of lineage exists and none was
invented. Row 12 also carries the integration lane's graded end-to-end run of
the create route on the built bridge (12 of 13 clauses at their `39edf442`;
the one red is a percent-encoded run id, fixed in `842ac5f0` and not yet in
their tree; the question of intent — a changed contract is a new run — is
answered in the contract document and now asserted by their drill).

**THIRD PASS, 2026-09-27, later: 78% was an addition error, and the honest figure
is 77%.** The table's own numbers summed to 76.7 before this pass, not 78; row 12
rises 80 → 90 for mission creation over the bridge and both routes exercised
against a real PostgreSQL (in-process and from the built bridge), row 11 rises
85 → 86 for the content-refusal class, and the sum is now 77.2. The
number moves DOWN while the system got better, because the previous total was
wrong and a corrected total is worth more than a flattering one. Nothing else in
the table changed, and the four blockers that gate this number are where they
were: PR #286 frozen, no claim store, the final mission unpaid — and the runtime
API, which is no longer "mounted by nothing", is still unexercised against a real
PostgreSQL from a running bridge.

**SECOND PASS, 2026-09-27: 74% → 75%, and the single point is the honest answer.**
Four rows rose because real defects were found and closed — a sub-agent that could
be the Independent Reviewer, and a trajectory whose four measurement columns were
null on every successful dispatch, which made every cost and duration the eval
layer reported an empty projection. Finding a defect of that size lowers
confidence in what was already claimed about as much as fixing it raises it, and
none of the four blockers that actually gate this number moved: PR #286 is still
frozen, there is still no claim store, the runtime API is still mounted by
nothing, and the final qualification mission still has not been paid for.

**It is lower than the ~88% previously carried, and the drop is a correction
rather than a regression.** The old figure counted context integrity and the
trust core as capabilities; both threw on every call. It also counted provider
conformance without a rule that a qualification belongs to a model, which is the
rule that reveals two of the three legs to be unpinned.

## What changed in this run

Three commits on `relay/julius-beta-qualification`, off `a384b215`:

1. **`1a0c679b`** — the context integrity layer and the Project Brain v2 trust
   core, implemented, wired into the real dispatch path, with both paid missions'
   own specifications committed and passing (10/10 and 21/21 under the mission
   sandbox's own declared test command). Migration 025 makes the decision durable.
   Found on the way: a redaction that wrote the literal characters `$1` instead of
   naming the key it redacted, and two mission slices whose import chains had been
   broken long enough that provisioning either died before an assertion ran.
2. **`574d660d`** — the Learning Loop's measurement and gate, with a matched-pair
   experiment through the real run loop; and a reviewer that catches a real
   defect, with the control and the no-laundering case that make it a catch
   rather than a script.
3. **`2953966c`** — provider qualification keyed to the served model; an
   authoritative clash that fails a task rather than a tick; and the Wonderland
   slot view.
4. **`49b42a3e`** — the runtime API mounted read-only on the bridge over the
   same PostgreSQL store the job writes through; **`102c302a`** — the MVP
   qualification suite organised by the founder's four categories.
5. **`fc8c67c7`** — mission CREATION over the bridge (`POST
   /relay-api/julius/missions`, bootstrap only, `dispatched: false` on the
   wire), the contract parser and compiler moved into a library module because
   importing them from the job's entry file made the server bundle run the
   job's entry guard, and the readiness addition corrected.
6. **`81a910c2`** — the Wonderland seam proven against a real PostgreSQL, in
   process and from the built bridge over HTTP.
7. **The commit carrying this revision of the page** — the whole-chain suite,
   dead on main since the charged-findings rule and run by no workflow, revived
   and put in the real-infra workflow; the persistence real-PostgreSQL suites
   run locally for the first time.

## The honest state of the suite on this platform

**AND THEY CAN NO LONGER TOUCH THE LIVE STORE.** Every real-PostgreSQL suite
in the repository now reads `JULIUS_TEST_DATABASE_URL` — a variable no profile
exports and nothing else sets — and not `DATABASE_URL`, which on this
workstation is inherited by every shell and points at the persistent Julius
database holding real mission history. A sweep test (`julius-test-database.test.ts`)
walks `git ls-files` and fails if any test file reads `DATABASE_URL` again.
Proven both ways on this machine: with the inherited variable and
`JULIUS_REAL_POSTGRES=1` (which used to be the gate) the suites are 8 `todo` and the live database still has
no `relay_wonderland` schema; with a stated throwaway database they are 8
passed. The runtime keeps its own variables (`JULIUS_DATABASE_URL`, then
`DATABASE_URL`) because database configuration belongs to whatever launches the
bridge and the job.

**THE REAL-POSTGRESQL SUITES NOW HAVE A LOCAL RESULT.** A `julius-postgres`
container (postgres:16) was found running on this machine; against fresh
databases in it, the six persistence real-PostgreSQL suites pass — 35 cases, 2
`todo` for the Docker halves — and the new Wonderland seam suite passes 3/3.
The seventh, `julius-live-chain.e2e.test.ts` — the WHOLE chain on a real
database with a repair round, dumped by the shipping queries and read by the
Beta Gate — **was failing on `origin/main` and on this branch identically**
(proved by running it in a probe worktree at `a384b215`): its scripted
re-review never answered the finding it was charged with, so the
charged-findings rule from #277 HALTed the run as `FINDINGS_UNRESOLVED`, and
no workflow ran the suite to say so. The fixture now reads its packet from the
same handoffs the job composes and answers the finding; the run reaches
COMPLETED with six SUCCEEDED tasks including `repair:build` and its re-review,
read back from PostgreSQL. The dump-and-gate half needs a `psql` binary this
host does not have, so that half is CI's: the suite is added to the real-infra
workflow beside the others. A suite that is not run is not a proof.

`npm test` on Windows is **not green, before or after this work**. The baseline at
`a384b215` was 194 failing cases across 56 files; the failures are dominated by
platform-specific paths — the MCP stdio proofs (13, fixed on an unlanded branch),
spawned-process and path handling in `ship-runner`, `repository-target-observer`
and the Hermes adapter. CI runs on Linux and is the authority on green.

THE SAME CAUSE REACHES A THIRD GATE. `relay:claude:contract-verify` fails here
with five steps and `exit=5`, because it drives the same POSIX fake executable.
It is NOT fixed in this change — it is outside the Julius lane — and it is named
here so the next person to see those five lines has the cause in one grep rather
than an afternoon. `relay-repository-boundary`, `relay-parity-gate`,
`relay:surface-parity:check:strict`, `relay:yc-demo:check`,
`relay:cli:contract-verify`, `relay:workspace:verify`, `git diff --check`, both
typecheck passes and all six esbuild bundles pass on this host.

**AND A WHOLE-SUITE FIGURE COULD NOT BE OBTAINED ON THIS HOST AT ALL.** Two full
runs were killed for low memory: 16 GB total with 6.9 GB free, because a
Wonderland Unreal editor session held the machine throughout. A third completed
only while the working tree was being edited under it, which makes its numbers
worthless — several of the gates it runs read `git ls-files` and the working tree.
So the honest measurement is per directory at constrained concurrency
(`--maxWorkers=2`), which fits in the available memory and removes the CPU
contention that was producing most of the intermittent failures:

| Scope | Result |
|---|---|
| `src/relay/mission/julius` + `src/relay/mission/role-slots` | **97 files, 1,894 tests, 0 failures** |
| `relay-bridge/julius` + `src/relay/persistence` + the four affected `scripts/` suites | 63 files, 916 passed, **11 failed — the same five files and the same five counts as the baseline** |

The eleven are `persistence` (4), `lock-reclaim` (2), `beta-enrollment-node` (3),
`durable-mission-node` (1) and `julius-research-authority` (1); every one of them
fails identically on the unmodified base, and the first four share the POSIX
fake-executable cause described above. **Zero new failures across everything this
session touched** — and `julius-slot-envelope.e2e`, the one case the earlier
contaminated runs showed failing, passes at constrained concurrency, which
identifies it as contention rather than a defect.

What this session can honestly claim about its own delta is measured per
directory, where the signal is clean: `src/relay/mission/julius` was 1 failing
case at baseline (`julius-slot-envelope.e2e`, which also passes intermittently
here) and is 1 failing case after, with 1,830 passing and ~120 of them new.
`relay-bridge/julius/julius-live-composition.test.ts` is 161/161.

## The fastest path to 95%

In order, and each is runnable by an engineering session except where marked:

1. **Land PR #286** (founder-gated: it is frozen for review). It closes the
   artifact exchange, which is the single dependency shared by rows 1, 4 and 6.
   Worth roughly +5 points.
2. ~~**A claim store**~~ — **DONE at the minimum this item described** (rows
   4, 5, 9: +1.1 in total, inside the +2.5 estimate; the rest of that estimate
   is the lineage nobody asserts). The estimate below is CORRECTED DOWNWARD from
   the +6 this document first carried. One table and one port would make standing
   durable per entry and give the Learning Loop's promotion somewhere to land.
   It would NOT, on its own, make lineage appear: `supersedes` and `contradicts`
   need somebody to ASSERT them, and nothing in the runtime detects that two
   brain entries contradict — that is a semantic judgement, and the realistic
   asserter is a reviewer. So the fail-closed path stays reachable only through
   its seam until an asserter exists, and the marginal gain over the derivation
   already in place (standing from `entry_kind` plus `evidence_ids`) is promotion
   HISTORY and explicit supersession. Rows 4, 5 and 9. **Roughly +2.5, not +6.**
3. **One paid run whose bundle records every served model.** The diagnostics that
   carry it are already populated on the success path; what is missing is that the
   evidence dump selects on `diag_transport IS NOT NULL`. Fixing the selection is
   small; the run costs money and is a founder act. It converts two COMPATIBLE
   legs to VERIFIED — row 10, roughly +3.5 — and closes row 3's challenge
   disposition if the mission is chosen to exercise it.
4. ~~Mount `JuliusRuntimeApi`~~ — **DONE.** The founder made the deployment
   decision (a database-connected bridge is in scope for the MVP), so the bridge
   now holds a read connection to Julius's store when `DATABASE_URL` is set and
   refuses by name when it is not — and, since the third pass, CREATES a mission
   through the same bootstrap the job uses. What remains is exercising both from
   a running bridge against a real PostgreSQL, which is the paid-run
   environment, and the separate deployment decision of whether a client may
   DRIVE a run (where money is spent), which is not taken.
5. **Run the persistence gates and the three Julius drills on POSIX** (they are
   unrunnable on the Windows machine this session used, for a reason now printed
   rather than discovered) and commit the output. Row 8, roughly +1.
6. ~~**A CONTENT-refusal class**, distinct from `AUTH_CONFIGURATION`~~ —
   **DONE for the Coding Agent and the Prompt Architect** (`CONTENT_REFUSED` →
   `INVALID_REQUEST`, never retried; row 11, 85 → 86). What remains is the
   Independent Reviewer's provider, which cannot report one, and ROUTING a
   refusal to a re-plan rather than a truthful failure.

That is ≈ 88%, not the 91-92% this document first claimed — the correction is
the claim store's lower marginal value, and it is recorded rather than quietly
re-totalled. The remaining distance to 95% is row 13 (a multi-mission concurrency
proof and one load measurement) plus the second paid run that converts two
COMPATIBLE provider legs to VERIFIED.

**TWO OF THE SIX ITEMS ARE FOUNDER-GATED**, which is the single most useful
sentence on this page: PR #286 is frozen for review and the paid run costs money.
(The third, mounting the runtime API, was founder-gated on a deployment decision
the founder has since made; it is done, and creation is served beside it.) An
engineering session can do the claim store, the POSIX gate run and the
content-refusal class, and those three together are worth about +4.

## The fastest path to 100%, and what 100% would have to mean

100% is **RELEASE QUALIFIED in every row**, which requires, beyond the above:

- **A representative final beta mission, paid, that exercises the whole
  lifecycle including a reviewer catch and a repair.** This is the one item
  nothing in this repository can substitute for. Everything else on this page is
  a proof that the machinery can do it; only the run proves it did.
- **A paid matched pair for the Learning Loop** — the same mission twice, with
  and without a prior learning artifact, against real models, where the
  improvement is measured rather than premised.
- **A load and multi-mission concurrency measurement**, because "bounded" is a
  property of the code and "fast enough for a beta" is a property of a machine.

## Why Julius must not be called beta-ready today

Two of the three intelligence legs in the reference trio cannot be pinned to a
model by any evidence that exists. The memory a mission learns from has no
durable notion of which claim replaced which. The one surface a client is meant
to read is served by nothing. And the final qualification mission has not been
run. Each of those is a sentence a founder would want to have read before a beta,
and none of them is a sentence about test counts.

---

# The 2026-08-30 assessment (superseded)

**Assessment date:** 2026-08-30 UTC. **Base reviewed:** PR #202 / current main `96451fc0c8da59de792d973113c4e203ddab6f01`. **Working branch:** `codex/julius-beta-hardening`. Julius is **not beta-ready**.

States are strictly cumulative: `ABSENT`, `DOMAIN_ONLY`, `IMPLEMENTED`, `WIRED`, `DURABLE`, `REAL_INFRA_PROVEN`, `BETA_READY`. Tests of an exported class do not make it wired; SQL-text fakes do not make it durable or infrastructure-proven.

## Re-audit

- GitHub currently has PR #202 as the only open PR numbered 202 or later. It remains open, clean, and unmerged at `5359b3036a0ae917372a2a2721c5b5182b57d748`. No old PR was merged or closed.
- The supplied checkout contained a squash-equivalent consolidation commit `90c427721d13557b36243bc42eb09583622df471`, based on current main. Its tree contains the effective #198, #185, and #201 changes. Work continues without rewriting the historical branches.
- Migrations 001–018 were present. This hardening adds 019 for tool invocations, dispatch intent, and artifact metadata. Migration-chain tests enumerate the directory, so an unregistered file fails.
- The #198 boundary remains: feature code consumes generic Julius interfaces; Julius has no feature runtime, API, event, trajectory kind, policy field, or namespaced feature table.
- PR #202 review found five concrete issues. Shell-expanded Git arguments, unbounded listings, and missing creation ancestors are fixed. Production approval gating now has an atomic store operation. Production sub-agent task/grant creation now rechecks limits under a per-run transaction lock.

## Capability matrix

| Capability | State | Evidence / blocker |
|---|---|---|
| Effective #202 architecture | IMPLEMENTED | Consolidated tree exists; founder has not authorized merge. |
| #198 dependency boundary | IMPLEMENTED | Structural boundary suite remains authoritative. |
| Sandbox domain port | IMPLEMENTED | Provider-neutral create/prepare/execute/cancel/destroy/inspect/collect contract includes tenant, run, task, lease, policy, expiry, and resource ceilings. |
| Docker sandbox adapter | REAL_INFRA_PROVEN | Digest-addressed image, no shell in host launcher, read-only root, dropped capabilities, no-new-privileges, unprivileged user, controlled bind mount/network, CPU/memory/PID/nofile/tmpfs/wall/output limits. GitHub run `33327055137` passed with the real Docker engine and PostgreSQL service; the adversarial matrix remains incomplete. |
| Production host-shell prevention | IMPLEMENTED | Production adapter is explicitly disabled unless trusted composition enables it. The old Node adapter remains development-only and is not a hostile-code boundary. |
| OS filesystem/network isolation | IMPLEMENTED | Docker flags compile policy into mounts and `--network none`; the basic real Docker path passed in GitHub run `33327055137`, while the complete adversarial matrix remains open. |
| Durable invocation lifecycle | IMPLEMENTED | Migration 019 and PostgreSQL repository persist the lifecycle and real PostgreSQL tests pass, but crash-after-effect result recovery and atomic budget/evidence settlement are not solved. |
| Transactional dispatch intent | IMPLEMENTED | Invocation and dispatch intent share a transaction and real `SKIP LOCKED` claims pass. Expired `DISPATCHING`/`RUNNING` recovery deliberately does not replay destructive work and currently requires reconciliation; it is not recoverable yet. |
| Durable artifact metadata | DOMAIN_ONLY | Migration 019 defines composite-scoped metadata and references, but no production metadata repository/atomic completion integration exists. |
| Artifact bytes | IMPLEMENTED | Local adapter atomically stores 0600 content and metadata, validates tenant/project scope and hash, and keeps blobs outside hot DB rows. Production object storage is absent. |
| Provider-neutral turn loop | IMPLEMENTED | Bounded model-turn/tool-call/runtime/observation loop supports interchangeable adapters. No provider adapter is wired to it. |
| Live Prompt Architect | DOMAIN_ONLY | Existing provider path exists elsewhere; not composed into this durable tool loop. |
| Live Coding Agent tools | IMPLEMENTED | Protocol and bounded loop exist; no configured live provider credential is present. |
| Live Independent Reviewer | DOMAIN_ONLY | Existing reviewer harness exists; no real three-worker Julius mission has run. |
| Real PostgreSQL proof | REAL_INFRA_PROVEN | Installed a disposable PostgreSQL 16 cluster locally; migrations 001–019, concurrent invocation identity, digest conflict, stale tool lease, SKIP LOCKED dispatch, concurrent task claims, heartbeat and completion fencing passed. Docker proof remains pending CI. |
| First real Julius mission | ABSENT | No durable Prompt Architect → Coding Agent → Reviewer → repair → completion run yet. |
| Restart/chaos proof for tools | DOMAIN_ONLY | Existing Julius chaos tests do not cover the new real sandbox/outbox result boundary. |
| Live Terminal tool projection | DOMAIN_ONLY | Generic projection exists; durable tool events are not composed into the deployed bridge. |
| Beta eval pack | ABSENT | Must follow real provider and infrastructure composition. |

## Host capability discovery

Available executables: `unshare`, `systemd-run`, `systemctl`, `prlimit`, and `setpriv`. PostgreSQL 16 was installed into this disposable environment and the real integration suite passed. Missing sandbox executables remain: Docker, Podman, containerd/ctr, nerdctl, Bubblewrap, nsjail, Firejail, and cgexec. The cgroup v2 filesystem is not writable. This host therefore cannot honestly prove the Docker boundary or establish a safe alternative. Production execution stays disabled here.

The repository now includes a GitHub Actions job with another disposable PostgreSQL 16 service and Docker engine. It builds a content-addressed local sandbox image and runs the real-infrastructure suite. GitHub run `33327055137` passed this basic path; the broader security/chaos exit criteria remain open.

## Credentials and provider status

No `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, Relay operator token, or safe provider-specific credential is present. `OPENAI_BASE_URL`/cluster routing variables alone do not authorize a live call. A live beta proof requires an explicitly scoped credential and configured worker route for each role; no fake pass is recorded.

## Independent hardening review

A separate reviewer found Critical/High gaps after the first infrastructure commit. This follow-up enforces `READ_FILESYSTEM=false` with no workspace bind, rejects unsupported mediated networking, checks sandbox expiry/cwd/invocation-specific cancellation, validates current tenant membership/worker/lease expiry/policy on durable requests, validates completion references, makes artifact scope run/task/invocation-specific, and repairs approval/sub-agent duplicate behavior. The reviewer also confirmed that destructive dispatch recovery, fully transactional budget/evidence completion, persistent sandbox ownership, workspace disk accounting, production artifact metadata, and real-provider composition remain open.

## Blockers remaining

1. Extend the passing real-infrastructure CI run to independently attack its container boundary, including parent/child/grandchild survival and disk/PID exhaustion.
2. Replace the development Node executor in every production composition with the sandbox port; keep the enable switch fail-closed.
3. Add production object-store artifact bytes and transactional linkage between artifact metadata, invocation completion, budget settlement, evidence, and events.
4. Wire a real provider adapter into the bounded turn loop, then wire Prompt Architect, Coding Agent, and Independent Reviewer through the durable runtime.
5. Execute the intentionally failing first mission, repair, restart/chaos matrix, terminal projection, Project Brain write, and beta eval pack.
6. Run another independent Critical/High security review. Beta requires zero open Critical or High findings.

## Exit decision

**NOT BETA-READY.** This change materially closes architecture and durability gaps and creates a real-infrastructure proof path, with real PostgreSQL and basic Docker proof, but no live provider mission or complete hostile-code/chaos proof exists.

## PR #203 follow-on closure checkpoint (2026-08-30)

The follow-on branch `codex/julius-beta-closure` adds migration 020 rather than rewriting published migration 019. It introduces explicit effect classes, durable executor-receipt and sandbox-ownership schemas, a fail-closed reconciliation decision, recovery claims for expired `DISPATCHING`/`RUNNING` work, opaque Docker discovery labels, and physical sandbox discovery/quarantine operations. Dispatch and completion now revalidate the live task lease and C.A.R.D. revision; completion rejects mismatched invocation and artifact references. The bounded provider loop now enforces a real wall-clock abort rather than checking time only between turns.

These changes move crash-after-effect handling from **ABSENT** to **IMPLEMENTED**, not `DURABLE` or `REAL_INFRA_PROVEN`. In particular, arbitrary shell work with an unknown outcome is blocked from automatic replay, but the Docker executor does not yet write terminal receipts independently of the orchestrator process. Persistent sandbox rows and physical discovery exist, but deployment composition does not yet run the complete DB↔Docker reconciler. Migration 020's settlement ledger establishes exactly-once schema identity, but a single transaction that commits budget, evidence, trajectory, event, task outcome, and artifact metadata is still open.

No live provider credential is present in this environment. `OPENAI_BASE_URL` and `OPENAI_CLUSTER` without `OPENAI_API_KEY` do not authorize a request; no Anthropic/xAI credential is present. Therefore no first real provider mission, reviewer-triggered repair, or honest beta claim is recorded here.

### Fresh validation on this follow-on

A fresh full repository run with one worker completed 462 files: 460 passed, 1 infrastructure-only suite remained skipped/todo without credentials, and `relay-bridge/loop-routes.test.ts` had one 5-second timeout (8,727 passed, 1 failed, 4 todo). The failed file immediately passed in isolation (39/39), classifying it as suite-load/resource contention rather than a Julius regression. An earlier parallel full run also exposed the newly added migration/test-accounting updates plus a boundary-scanner timeout; the migration/accounting defects were fixed, and the boundary scanner then passed alone (209/209). The full matrix is therefore not represented as unconditionally green and Julius remains not beta-ready.

### Independent security review

A genuinely separate reviewing agent audited the effective follow-on diff and its revisions. Final review found **0 Critical** findings. The revision closed DB-clock lease fencing, pre-execution stale authority, scoped receipt/sandbox constraints, terminal-result integrity, hard provider deadlines, and exclusive generation-fenced recovery claims. Remaining High findings are explicitly blocking: executor-side before/after receipts plus a composed recovery worker; one atomic budget/evidence/artifact/event/trajectory/task settlement; and composition of the durable sandbox repository into Docker lifecycle/restart handling. No beta-readiness claim is made.

## Phase II correctness checkpoint (2026-08-31)

The stacked branch `codex/julius-beta-phase2` closes the three previously open High findings in code and focused tests without changing the #198 boundary:

- **Executor witness:** the Docker adapter mounts a root-owned receipt directory outside the disposable container layer. A trusted wrapper writes immutable, identity-bound `BEFORE` and `AFTER` receipts around an unprivileged process. Receipt consumption validates scope, manifest and payload digests; `BEFORE` without a valid terminal receipt is `UNKNOWN_EFFECT` and is never replayed automatically.
- **Exactly-once settlement:** one serializable PostgreSQL operation validates the terminal executor receipt and finalized artifact bytes, commits the scoped budget reservation, invocation result, artifact metadata, evidence, trajectory, operational event, task outcome, outbox, and settlement identity. Same identity/digest is idempotent; a changed digest conflicts. Task success additionally requires a persisted accepting verification decision whose passed evidence is included in the settlement.
- **Durable Docker ownership:** create, physical binding, execution authorization, heartbeat, destroy and restart reconciliation use the PostgreSQL sandbox owner/generation. Reconciliation compares DB records with Docker IDs, images and opaque labels, consumes receipts before declaring loss, and quarantines mismatches and orphans.

A genuinely separate final reviewer reported **Critical 0 / High 0 for these three targets**. That verdict is scoped to the Phase II diff and does not make Julius beta-ready. This machine still has no Docker/PostgreSQL executables for a local real-infrastructure rerun, and no `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or configured remote Hermes credential. The GitHub PostgreSQL+Docker job and first live three-provider mission must pass before the states advance to `REAL_INFRA_PROVEN` or `BETA_READY`.

Remaining beta blockers are the real CI run, a production object-store adapter, live Prompt Architect/Coding Agent/Independent Reviewer routes, the genuine reviewer-failure/repair mission, Project Brain/terminal/restart proof, the full resource/chaos/eval matrix. The Phase II checkout completed a fresh single-worker run with 464 files and 8,741 tests passing (5 todo), plus typecheck, builds and repository/parity gates; the environment-gated real-infrastructure proof remains pending.

### Real-infrastructure CI result

GitHub Actions run `33349662781` proved migrations through 021, serializable invocation retry, stale lease fencing, `SKIP LOCKED`, concurrent task claims, and orphan-container quarantine. The crash-after-effect case failed because the container produced a `BEFORE` receipt but no terminal `AFTER` receipt or effect. Julius correctly kept the outcome unknown rather than replaying it. This is a **REAL REGRESSION / unresolved executor-image integration failure**, not a pass; consequently HIGH-1 is not infrastructure-proven and the live mission must not start.

## Real executor closure checkpoint (2026-08-31)

The BEFORE-only CI failure was traced, not waived. The host receipt directory is owned by the Actions runner. The container had `--cap-drop=ALL`; therefore its trusted uid-0 executor lacked `DAC_OVERRIDE` and could create neither the staged receipt nor command-output files on the bind mount. Its attempted identity drop also required `SETUID`/`SETGID`. The inline Docker argument made this failure unnecessarily opaque.

PR #206 installs a fixed executor program into the digest-addressed sandbox image. The container grants only `DAC_OVERRIDE`, `SETUID`, `SETGID`, and `KILL` to that trusted program; `setpriv` changes the worker to uid/gid 65532 while clearing its bounding, inheritable, and ambient capability sets. The executor fsyncs and atomically publishes BEFORE, runs the requested effect unprivileged, reaps every uid-65532 descendant, proves none remain, measures the workspace, and then fsyncs and publishes AFTER. The orchestrator only consumes the resulting files.

GitHub Actions run `33354964563` passed the real PostgreSQL 16 and Docker scenario. It proved migrations 001–021, serializable request retry, stale-lease fencing, `SKIP LOCKED`, unprivileged network-denied mutation, executor BEFORE/effect/AFTER integrity, crash-after-effect recovery without re-execution, exactly one settlement/budget/evidence record, stale sandbox-owner refusal, cleanup, and orphan quarantine. The fixture also starts a delayed background writer; the executor kills it before AFTER and the test proves no late mutation appears.

Live-provider authorization remains absent: `OPENAI_API_KEY`, `OPENAI_PROMPT_ARCHITECT_MODEL`, `RELAY_PROMPT_ARCHITECT_MODE`, `ANTHROPIC_API_KEY`, `RELAY_HERMES_MODE`, `RELAY_HERMES_SERVICE_URL`, and `RELAY_HERMES_SERVICE_TOKEN` are unset. Consequently the real three-role mission remains `BLOCKED_EXTERNAL_CREDENTIAL`, not passed.

The independent re-review still controls the security verdict. In particular, a direct-Docker orchestrator can access the host receipt store and Docker control plane; cryptographic independence from a malicious orchestrator requires a separately privileged executor/receipt service or attestation boundary. Julius remains **not beta-ready** until that deployment boundary, live provider mission, provider-triggered repair, broader real resource/authorization evals, and final zero-Critical/zero-High review are complete.

### Final validation and independent review for PR #206

The fresh single-worker repository run completed 463 passing files, one environment-gated skipped file, 8,740 passing tests, five todo, and one unrelated five-second timeout in `src/relay/persistence/persistence.test.ts`. The timed-out file immediately passed alone (22/22), classifying the full-run failure as resource contention rather than an executor regression. Typecheck, application/Relay/bridge builds, strict surface parity, repository boundary, parity gate, and diff check passed.

A genuinely separate re-review closed the background-descendant High after the real delayed-daemon proof. Its final scoped verdict is **Critical 0 / High 1**. The remaining High is independent receipt authenticity against a malicious orchestrator that itself owns the Docker API and host receipt directory. No file-permission or local signing change can establish that trust separation while Julius retains direct Docker authority. Production hostile-orchestrator clearance requires a separate executor/control-plane service with an executor-only signing/attestation key or append-only receipt credential, and Julius settlement must verify that attestation. The direct Docker adapter is therefore limited to deployments that explicitly trust the Julius orchestrator.

## Live composition checkpoint (2026-09-01, post-#208)

The missing production composition between the durable Julius runtime and the
three existing live provider implementations now exists, on the branch
`relay/julius-live-validation`. States are claimed per this document's own
definitions and no further.

**Live three-role composition: IMPLEMENTED and WIRED, not REAL_INFRA_PROVEN.**
`relay-bridge/julius/` adds three `JuliusProviderAdapter` factories that wrap
the existing engines without duplicating a provider client — `runGptArchitect`
(OpenAI Responses, plan validated by `validateArchitectPlan`),
`runHostedCodingAgent` (Claude Agent SDK, edits inside its pinned envelope),
`runHermesReview` (local Hermes, parsed findings) — plus the first production
implementation of `JuliusBootstrapPort` (run + criteria + Project Brain +
plan→build task graph + transitions to READY, idempotent per contract digest),
a PostgreSQL runtime-store composition mirroring the conformance suite, and an
executor-routed shell port that carries every workspace effect (base revision,
diff, deterministic test) through the PR #208 control plane's durable
request→authorize→claim→execute→settle path. One supported entrypoint exists
and only one: `npm run relay:julius:mission -- run --contract <file>
[--confirm-live]`, which fails closed naming every missing variable, prints
SET/MISSING only, and starts nothing without the explicit flag. It lives in
the bridge tree because the CLI is boundary-tested never to reference
`relay-bridge`, where two of the three live engines live.

Fourteen offline tests (`relay-bridge/julius/julius-live-composition.test.ts`)
prove the wiring with zero network: C.A.R.D. role→adapter resolution including
the requested models; fail-closed refusal per missing variable before any
adapter is constructed; refusal of a reviewer sharing the coder's vendor;
refusal of a coding agent without the executor port (no local fallback); the
scripted fixtures unreachable from every live module; the full
architect→coder→reviewer drive on the in-memory model with Julius sequencing,
executor-routed effects, reviewer packets fed from Julius-owned artifacts, a
real repair cycle on a blocking verdict, completion granted only by the
verification gate and withheld while a decision is not ACCEPT; and no provider
payload, plan body, or secret-shaped string reaching durable state. Typecheck
(all four projects), the repository boundary, the parity gate and strict
surface parity pass; the parity registry is untouched.

**Findings recorded while wiring, not fixed silently.** (1) The verification
evaluator checks each acceptance criterion's `requiredEvidenceTypes` against
EVERY verified task, so a TEST-typed criterion can never accept the plan task
and a three-role run parks in VERIFYING forever — the composition therefore
stores criteria with empty type lists and carries the machine-testable TEST
requirement on the build task's own `requiredEvidenceTypes`, which `verifyTask`
HALTs without. (2) `runHermesReview` spawns Hermes with env `{PATH, HOME}`
only: the xAI credential reaches the model through the operator's own Hermes
profile, not the process environment; the entrypoint reports `XAI_API_KEY`
presence for the record and says so. (3) The dispatch-path
`JuliusBudgetPort` is an in-process ceiling seeded from the mission spend
limit; durable per-invocation budget rows exist only on the executor
settlement path. (4) Compiled context packets and task-claim lease
generations reach adapters through same-process handoffs, because PostgreSQL
deliberately stores context metadata without packet text; a restart resumes
through the idempotent bootstrap and fresh claims recompile context.

**First real Julius mission: still ABSENT.** Nothing here has executed against
a real provider, a real PostgreSQL, or the real executor service. On the
development machine the entrypoint was executed and correctly reported BLOCKED
(missing `DATABASE_URL` and the five executor variables) with exit 1 and zero
provider contact. Executing the first mission requires a host or CI
environment with PostgreSQL 16, the Docker executor control plane from
`.github/workflows/julius-real-infra.yml`, the three provider credentials, and
an operator running the entrypoint above with `--confirm-live`.

### Independent review of PR #209 (2026-09-01)

A genuinely separate reviewer audited the full diff against source, proving two
findings by executing probes against the composition's own exports. Verdict:
**Critical 0 / High 2 / Medium 7 / Low 3 / Informational 3.** One High and
the trivially-fixable items were repaired in one bounded iteration; the
second High was resolved at its root by PR #210 on main:

- **F1 (High, fixed):** on the resume path the same-process artifact exchange
  is empty, and the probe proved an Independent Reviewer dispatched with an
  empty diff could COMPLETE the mission. The reviewer now refuses a dispatch
  when neither the plan nor the diff artifact is available, and the coder
  refuses without the plan — a resumed run fails visibly instead of
  completing falsely. The durable artifact store remains the real fix and is
  open debt.
- **F2 (High, core-rooted — RESOLVED at the root by PR #210 on main,
  2026-09-01):** the completion rule required EVERY durable verification
  decision to be ACCEPT, so any repair round parked the run in VERIFYING even
  after a successful repair and an approving re-review — proven by probe.
  Main now reads per-task CURRENT effective verification state with
  planner-contract repair-lineage supersession (history immutable, HALT
  fail-closed). After rebasing this branch onto that main, the composition's
  own drive test proves the closure end-to-end: architect → coder → blocking
  review → Julius-planned repair → accepting re-review → **COMPLETED**, with
  the admitting REPAIR still in durable history and completion emitted by the
  run loop's own advance (`julius-live-composition.test.ts`, "a repaired and
  re-approved run reaches COMPLETED"). The driver's `haltCause` reporting
  remains for the cases that still honestly park: a HALT, or a repair lineage
  that never reached acceptance.
- **F3 (Medium, fixed):** `repair:plan` is no longer registered on the coding
  agent — a routed `repair:plan` inherited the plan task's ARTIFACT evidence
  requirement the coder cannot produce, making it a paid dispatch guaranteed
  to HALT. An immediate routing refusal is the honest failure.
- **F8 (Medium, fixed):** a non-approved verdict without blocking-severity
  findings now maps to FAILED review evidence (matching the engine's own
  `hasBlockingFinding` semantics) and `unable_to_review` fails the dispatch,
  instead of parking the run on inconclusive evidence.
- **F4 (Medium, fixed):** a malformed `JULIUS_SCOPED_CREDENTIALS` no longer
  reaches `JSON.parse`'s own error message (which quotes the input — a
  credential map); the refusal is composed and echoes nothing.
- **F10/F11/F12 (Low, fixed):** the bootstrap replay branch matches the
  string the runtime actually throws and reports the run's ACTUAL durable
  state instead of asserting READY; provider-authored model/response
  identifiers are bounded by `safeClaim` before entering durable summaries;
  the phantom `JULIUS_MISSION_WORKSPACE` variable name is gone.

**Open findings carried as debt, in the reviewer's words, unfixed here:**
F5 — the preflight verifies environment variables but probes neither the
hermes binary nor the Agent SDK runtime, so a missing binary surfaces only
after upstream roles were paid (`hermesPreflight` and `probeHostedReadiness`
exist and are not yet called; note `hermesPreflight` performs a tiny real
generation and so belongs behind `--confirm-live`). F6 — the drive loop
claims ANY runnable task in the project, so a leftover non-terminal run in
the same project would be driven by this process's adapters and budget;
scope-to-run filtering is not yet built. F7 — a tolerated base/diff executor
failure still settles durable FAILED command evidence on the task, which
manufactures a repair round the adapter itself meant to absorb. F9 — on
PostgreSQL `repairRoundsFor` reads `julius_repair_cycles`, which nothing on
this path writes, so the contract's `repairCycles` ceiling is not durably
enforced (bounded in practice by idempotent repair task ids and unroutable
`repair:repair:*` types). F14 — the worst-case adapter chain can exceed the
600s lease with no heartbeat during dispatch; safe single-process today,
flagged for the first live run. (Closed in PR 5: the live lease is derived from
the registered workers' deadlines and renewed from admission up to a hold bound;
see `docs/JULIUS_CODING_AGENT_AUDIT.md` section D.)

## First live mission rig (2026-09-02)

`.github/workflows/julius-first-live-mission.yml` is the only workflow in this
repository that may spend provider money. It is `workflow_dispatch`-only —
there is deliberately no `push`, `pull_request` or `schedule` trigger — runs in
the `julius-live-validation` GitHub Environment, and reaches the paid stage
only when a human types `RUN LIVE MISSION` at dispatch AND the entrypoint's own
`--confirm-live` flag is passed. `scripts/julius-first-live-mission.test.ts`
holds that arrangement in place offline.

**Preflight spends nothing and is the supported dry run.** Dispatching with an
empty `confirm_live` proves the whole rig: PostgreSQL reachable and migrated
with the Julius tables verified present, the independent executor answering,
receipts verifying against the ephemeral signing key, the scoped `execute`
credential authorizing a real operation, the 4 MiB workspace ceiling actually
enforceable, and — the reason `scripts/julius-live-preflight.ts` exists —
`git rev-parse HEAD` succeeding *inside* the sandbox. Commands there run as uid
65532, so a workspace git refuses would yield an empty diff and hand the
Independent Reviewer nothing to review, after the mission had already paid an
architect and a coding agent. The entrypoint is then run without
`--confirm-live` and must exit **5** — which is what proves all three roles
resolved into real adapters — and the configured models are pinned to
`gpt-5.6-sol`, `claude-fable-5` and `xai/grok-build-0.1`. The model a provider
actually serves is a separate fact, observed during the run as
`actualModel` / `servedModel`; no preflight can know it.

**The mission is disposable by construction.** `workspacePath` is a 4 MiB tmpfs
holding a four-file throwaway git repository, never this checkout —
`scripts/julius-live-contract-check.mjs` refuses a contract whose workspace
resolves inside the repository, and refuses `spendUsd > 5` or
`repairCycles > 1`. The sandbox keeps `network: DENY`, so the declared test
command must run with no network and no `node_modules`; `node --test` on plain
CommonJS is what that leaves.

**The deliverables are seeded, tracked, and edited — not created.** An
independent review of the first draft caught two defects that would have made
the paid run fail with certainty. The hosted coding agent is allowed
`Read/Glob/Grep/Edit` and expressly denied `Write`
(`relay-bridge/hosted-coding-agent/hosted-envelope.ts`), so it cannot bring a
new file into existence; and `git diff` — how the mission captures the change
for the reviewer — never reports an untracked file, so even a created file
would have reached the Independent Reviewer as zero bytes. Both vanish when the
deliverables are committed stubs the agent edits. The preflight now also writes
a marker on the host and requires it to appear in the diff captured inside the
sandbox, so that hand-off is proven rather than assumed.

**The reviewer's credential is redirected for the reviewer alone.** Pointing the
job's `HOME` at the profile would also hand it to the live Claude coding agent,
a child of the same process holding `Read/Glob/Grep`. Instead
`RELAY_HERMES_EXECUTABLE` points at a wrapper that sets `HOME` at exec time for
the Hermes child only, and the credential is written to
`$HOME/.hermes/.env` — Hermes's own first lookup for an api-key provider
(`get_env_value_prefer_dotenv`), which needs no TTY and makes no network call.
Its resolvability is then proven through Hermes's own resolver with
`HERMES_HOME` unset, exactly as Julius spawns it.

**Ephemeral by default.** The executor credential root, the database password
and the Hermes profile are generated inside the job and destroyed by an
`if: always()` cleanup step; the Ed25519 signing key is minted by the executor
itself, inside its container. No durable executor secret is provisioned, so
there is nothing to rotate or revoke afterwards. The three provider credentials
are the only stored secrets, and they are referenced by name only.

**The reviewer credential boundary is unchanged.** `runHermesReview` forwards
`{PATH, HOME}` and nothing else to the Hermes child, so the workflow hands the
reviewer its credential by pointing `HOME` at an ephemeral profile written by
`hermes auth add` — the tool's own supported mechanism. `XAI_API_KEY` is
deliberately *not* set on the live step: it would not reach the child, and
setting it would suggest the credential flows through Julius. Julius was not
modified to make any of this easier.

**Open, and why this is not yet proven end to end.** No live mission has run.
Two things are outside this repository: the three provider secrets must be
added to the `julius-live-validation` environment, and Hermes must install on
the runner from `NousResearch/hermes-agent` at the pinned `hermes_ref` — the
proven local build reports a carried commit, so the upstream ref is not known
to be byte-identical to it. The `edit on host → diff via executor` choreography
is production code proven only against an offline fake shell; this preflight is
its first real-infrastructure exercise, which is exactly why it runs before
anything is paid for.

## Final pre-live hardening (2026-09-02)

The independent review's Medium findings, accepted under the one-iteration rule
at the time, are now closed — each with a mutation-proven test.

**F4 — the executor owns its signing key, against every file-reading path.**
The key used to be minted on the runner by the same user that runs Julius, so
any file read could take it — including a `Read` from the live coding agent.
It is now generated inside the executor container by
`.github/julius-executor-entrypoint.sh`, under `/executor-private` — the
container's own writable layer, deliberately not bind-mounted — beside the
ledger. (The receipt store moved to a root-owned host transport after dry run #2;
see below.) What leaves the container is the public key, read
out once over `docker exec`. A preflight step asserts exactly what that
arrangement establishes: the host paths do not exist, the private root is not
among the container's mounts, the executor does hold its key, and what Julius
holds contains a public key and no private material. Stated plainly rather
than implied away: this is a FILESYSTEM boundary, and its adversary is the
file-reading coding agent. The runner user itself holds the Docker socket and
sudo, so a process acting as that user could still `docker exec` the key out —
the same channel this job uses for the public half. Full #208-grade separation
(Julius in its own container, no socket) remains the reference architecture;
here the secret moved instead of Julius, because the coding agent and Hermes
both live host-side. No loopback, network or containment guard changed.

**F5 — evidence is built by allowlist, never by redaction.** Raw `tee`'d logs
are no longer copied into the artifact. `scripts/julius-live-evidence.mjs`
re-emits only lines matching the entrypoint's known shapes — the failure
outcomes (`RESULT: BLOCKED …`, `crashed: …`) included, because the runs that
most need evidence are the ones that went wrong — then drops any survivor
carrying key-shaped or opaque mixed-case material, and reports how many lines
it withheld. Behind it, the workflow greps the evidence for the
JOB'S OWN exact values — provider keys, credential root, database password and
every derived scoped credential — via a needle file deleted before the upload
step exists; a hit deletes the evidence and fails the job without naming which
value matched. Masking is still applied but nothing relies on it.

**F8 — Hermes is pinned to `2ea39daeb1f675d72e5c21c9400f2d58d7e6d71a`.** That
is the exact commit the proven local build runs, and it is public upstream:
the install banner's "+1 carried commit" was bookkeeping against a stale
origin ref in a shallow clone, not a local-only patch. The commit's whole
delta is `gateway/run.py` plus one gateway test — the messaging gateway, which
the reviewer's one-shot CLI path never touches. `pyproject.toml` at that
commit declares `requires-python >=3.11,<3.14` (the runner's 3.12 is in
range) and the `hermes` console script. A mutable ref is refused twice, in
the dispatch gate and again in the install script, before pip runs.

**F9 — dispatch inputs are validated first.** A gate step runs before any
build, container or credential exists: `max_ticks` must be an integer in
[8, 32] — the floor because the six-task graph cannot complete much under
eight ticks, so less would buy a paid run guaranteed to be cut off; the
ceiling because 32 is the entrypoint's own default, so the input can tighten
Julius's bound but never loosen it. A near-miss `confirm_live` phrase is
refused outright rather than silently downgraded to a dry run, and a
non-40-hex `hermes_ref` is refused here too. The gate's bash is executed by
the offline tests with well-formed, malformed, out-of-range and boundary
values.

**F6 — a paid mission cannot repeat by accident.** Live dispatches share one
concurrency group (never cancelled in flight); dry runs get a per-run group,
so proving the rig stays unlimited and free. TWO durable markers, and the
distinction is what the first paid attempt taught:

- `julius-first-live-attempted` is uploaded after every free gate has passed
  and BEFORE the provider-capable entrypoint is invoked. It means a paid run
  was AUTHORIZED AND ENTERED — the strongest claim this job can honestly make,
  since whether a provider was billed is not observable from the runner. It
  carries provenance fields and the Mission Contract's sha256, never its text.
- `julius-first-live-completed` is uploaded only when Julius itself reached
  legitimate completion, exactly as before.

A live dispatch that finds EITHER marker refuses unless the operator typed
`RERUN PAID MISSION`. Run 33697109210 is why: it crossed the live boundary,
failed at its `plan` task and left no marker at all, so an ordinary
re-dispatch would have been treated as the first paid run. THAT RUN IS ALSO
COVERED, not merely explained: markers only exist from now on, so the attempt
itself is recorded in the gate as `RECORDED_PAID_ATTEMPTS=1`, naming the run.
The next paid dispatch therefore needs the acknowledgement even though the
artifact list is empty, which is the whole point. THAT NUMBER ONLY EVER GOES UP:
increment it when another paid run is entered that the file does not already
count, and never reduce it. Markers carry ninety-day retention and the guard
ignores expired ones, so zeroing it would hand the gap back on a fuse. A marker list that
answers with something other than a count is now routed to the same refusal an
unreadable list gets, because a default-to-zero is the one answer that lets a
second paid run through.

Both marker steps and the live entrypoint now write `success()` into their
conditions. That guard was already there implicitly — GitHub applies a default
`success()` to a step whose `if:` names no status function, and runs
33625851653 and 33635375764 show it, where a failed preflight skipped every
custom-`if:` step below it. Writing it out is defence in depth, not a repair: a
paid step later given `always()` or `!cancelled()` WOULD reach the entrypoint
that spends, and the contract test now refuses that.

Stated limit, not papered over: artifacts expire and can be deleted, so this
guards against accident — a second dispatch of a mission already entered — and
sits behind the typed phrase and the environment's own approval, not in place
of them. Julius's contract-digest idempotency remains inert across dispatches
because PostgreSQL is per-job; that is a documented property rather than an
implied protection.

**F10 — a failed paid run says why, safely.** The first paid attempt failed at
its Prompt Architect task and the uploaded evidence could not say why: the
normalized `JuliusErrorCode` lived only in the operational event stream and
the trajectory row, neither of which was dumped, and the job destroys its
database. Two repairs, both provider-free:

- The connector's own classification now travels with the code.
  `JuliusDispatchError` carries a `failureClass`, narrowed by
  `safeFailureClass` to `/^[a-z][a-z0-9_]{0,63}$/`, so a provider exception,
  a URL or an `Authorization:` header cannot survive into a durable row even if
  an adapter passes one. The rule is `[a-z]` then up to 63 of `[a-z0-9_]`, so
  it refuses an upper-case letter, a leading digit or underscore, every
  punctuation mark but a non-leading `_`, and anything longer — but a token
  already in that alphabet, such as a hex digest beginning `a`–`f`, would pass. It is the first layer and the pre-publication credential
  scan is the second; neither is claimed to be the only one. Nine
  coarse codes cannot separate a refusal from a malformed response from a 500;
  the class can.
- The evidence bundle gains `failures.tsv`: task, role, event type, Julius
  code, failure class, `errorRetryable`, the continuation reason and timestamp,
  read from named fact keys and never from a whole payload. Every worker-failure
  row names its task, and the role is joined from the task, so the artifact says
  which of the three C.A.R.D. roles stopped — including on the non-retryable
  path, where the execution coordinator writes the only task-ending row. That path is the
  shape the first paid attempt failed in, and its events used to carry no task
  id at all. The one row that names no task is the run loop's own `run.failed`, written
  when the run itself reaches FAILED; its task and role columns are blank
  because a run ending is not a worker's failure. The pipeline also writes
  `run.failed` — for a role it cannot resolve, a policy denial, or a repair it
  cannot plan — and those name the task they are about. So a blank task always
  means the run's ending, but a `run.failed` is not always blank.

A run whose only remaining tasks are blocked behind a terminally failed
dependency now reports FAILED rather than WAITING. A claim is offered only when
every dependency is SUCCEEDED or SKIPPED and nothing revives a FAILED task, so
"waiting" was describing a run that could never move.

**F11 — a scheduling yield no longer spends a provider retry.** Both stores
incremented `attempt` on every CLAIM, and the run loop claims before it decides:
it resolves policy, compares the run's C.A.R.D. concurrency allowance against
what is in flight, and hands back what it cannot run. The live configuration
reaches that on every mission — a claim limit of 4 against a concurrency of 1,
with `build` and the plan's review task both claimable on the tick after `plan`
succeeds, because a review task is created BLOCKED on the task it reviews and
the claim query offers a BLOCKED task whose dependencies are all SUCCEEDED. A
task yielded twice arrived at its FIRST genuine dispatch carrying attempt 3 of
3, where a rate limit is refused as `RETRY_ATTEMPTS_EXHAUSTED` — with no
provider call having been made, after the plan had already been paid for.

Three counters now, each meaning one thing:

| Counter | Raised by | Bounds |
|---|---|---|
| `lease_generation` | every claim, hand-backs included | nothing; it is the ownership token authority is checked against |
| `attempt` | `admitTask` only, once the scheduler has decided to run the task | `MAX_TASK_ATTEMPTS` — the provider/execution retry budget |
| `recoveries` | the recovery sweep, when it requeues an expired lease | `MAX_TASK_RECOVERIES` — crash churn reclaimed by the sweep |

`admitTask` is one atomic statement conditioned on the caller's own lease, and
it runs immediately before provider-capable work begins. That is what makes the
crash semantics honest in both directions: a crash after it has spent an
attempt, because a worker may genuinely have been dispatched; a crash before it
has spent none, because nothing could have been. A caller whose lease moved
while it decided is told so and runs nothing.

The recovery counter exists because the execution counter stopped being able to
bound recovery: a task claimed, crashed before admission and recovered leaves
`attempt` untouched — correctly — so bounded only by it, that loop would never
terminate. Both ceilings are checked, execution first, and `failures.tsv` now
selects `julius.recovery.action` as well, so the reason that ended such a task
(`RECOVERY_LIMIT_REACHED`) reaches the artifact instead of dying with the
database.

WHAT IS NOT BOUNDED, stated rather than implied: a scheduling hand-back. The
fairness and concurrency yields return the task to RUNNABLE with no lease, and
the sweep only ever selects an ACTIVE task whose lease expired, so a yield is
never counted by anything. That churn is deliberate and free — no provider is
called and no money is spent — and a run whose allowance is narrower than its
claim limit simply takes more ticks.

AN EXPIRED LEASE HAS EXACTLY ONE WAY BACK. `recoverExpired` was written and
never called, and the runtime worked anyway because the claim query ALSO
offered an ACTIVE task whose lease had expired — a reclaim that raised only
`lease_generation`, so a task claimed by a worker that died before admission
could be retaken forever, past the ceiling, with no `recovery.action` row and
no terminal behaviour. That branch is gone from both claim queries. The sweep
counts the reclaim, bounds it, records it, and hands the task back RUNNABLE for
an ordinary claim.

AND THE SWEEP BELONGS TO THE KERNEL. `JuliusRunLoop.tick` runs it before it
claims, so a future driver cannot bypass the invariant by ticking differently —
the store contract now includes the recovery driver for exactly that reason. A
runtime whose recovery somehow never runs stalls such a task instead of
reclaiming it uncounted, which is the safe direction.

A PRE-EXECUTION REFUSAL IS NOT AN EXECUTION EITHER. Admission ran before the
task-level gates, so a C.A.R.D. that denied the capability, an approval nobody
had given, an unresolvable role, a task that had vanished, or a run outside the
caller's scope each spent one of the task's three attempts on work Julius had
just decided not to do. Those gates live in `prepareClaimedTask`, evaluated
once, and the run loop admits only an `ELIGIBLE` result — it reads the verdict
off the type rather than re-deciding policy.

## Dry run #1 (2026-09-02) — the executor refused the live output ceiling

The first free dispatch of the first-live workflow (run 33625851653 on main
2335c08) passed the input gate, the disposable workspace, PostgreSQL, the
migrations, the executor start and the key-boundary check, then failed on the
very first `createSandbox`: `executor_operation_invalid:limits.outputBytes`.
The live composition asked for 262,144 bytes of output, a literal chosen in
#209; the executor's validator caps that field at `MAX_SANDBOX_OUTPUT_BYTES`,
derived in #208 from the 4 MiB response envelope (257,377 at the current
constants). The preflight carried the same literal on purpose, which is why it
failed exactly as the paid mission would have, after paying an architect and a
coding agent. No sandbox, receipt or diff existed; Hermes, the contract check
and role resolution were skipped; no provider was contacted.


## Dry run #2 (2026-09-02) — the preflight's identity, and the receipt transport

The second free dispatch (run 33635375764, main 168105b) got past the output
ceiling and failed at its first `createSandbox` with a masked
`executor_failure`. PR #214 made the executor record one safe diagnostic line
per refusal — operation, safe code or `masked`, the error's own class, status —
and reproduced the mission's exact executor on real Docker in a
`first-live-topology` job. The class was 23503, PostgreSQL's foreign-key
violation: the preflight probe had invented a project, run, task and invocation
and seeded none of the rows `julius_sandboxes` references. The probe now seeds a
nonce-scoped, disposable identity in foreign-key order, records each invocation
through the production tool repository with its dispatch claimed for that
invocation alone, and removes exactly what it created; a PostgreSQL-backed
regression holds all of it through the executor's own repository.

With a legitimate identity the matrix then decided the receipt question. The
#212 hardening had placed the receipt root at `/executor-private/receipts`,
inside the executor container's own layer, but the executor asks the HOST
Docker daemon to bind-mount each sandbox's scoped receipt directory and the
daemon resolves bind sources on the host: every sandbox stopped at
`prepareWorkspace` with `sandbox_create_failed class=bind_source_missing`. A
root:root 0700 host directory, `/tmp/julius-executor/receipts`, mounted into
the executor at the same path, carried the whole provider-free preflight to a
pass — create, prepare, execute, signed receipts verified, the host-written
change visible in the sandbox diff, destroy, fixture cleanup. That is now the
mission's transport (`JULIUS_RECEIPT_HOST_ROOT` in the workflow, applied by the
shared launcher). Stated precisely: the receipt root is unreadable by the
runner user, which is the file-reading coding agent's user; a sudo or
Docker-socket holder can still read it. The signing key and the ledger stay
under `/executor-private` and are never bind-mounted anywhere; each sandbox is
handed only `<root>/<sha256(sandboxId)>` at `/julius-receipts-root`: the preflight
reads that from the daemon's own mount table while the sandbox running its
receipt-scope probe exists, and
proves from inside that the workload, uid 65532, cannot even list the root-owned
receipt mount. The executor-private shape is kept
in the topology job as an expected-failure regression: green only when the
host daemon refuses it at exactly that point with exactly that class.

Repair: `relay-bridge/julius/sandbox-limits.ts` is now the single place Julius
states its request. `outputBytes` IS the executor's ceiling, imported from the
validator's own module, and both the live composition and the preflight import
those same frozen objects, so parity is identity rather than a maintained copy.
`sandbox-limits.test.ts` runs the live limits through the real validator,
accepts the ceiling and refuses one byte more, and reads the three files that
could hold a second number. No executor limit, guard or validator changed, and
the envelope was not raised. Free dry run #3 (run 33695712645, main
`fb4f21f`) then passed every stage, and the first paid attempt (run
33697109210) followed — it failed at its `plan` task, which is what F10 above
is the repair for.
