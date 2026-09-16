# Julius PR 3: the Coding Agent is a governed, provider-neutral peer — and three peers complete one mission under any Coding Agent

PR #270 and #271 made the Prompt Architect and the Independent Reviewer
sustained peers. The Coding Agent was still a Claude Code integration with a
Julius half inside it. This PR makes it a ROLE: a typed provider port, a result
contract that cannot author another role's facts, a failure taxonomy the domain
disposes of, the locked scope enforced from what the executor saw, guaranteed
delivery of the guidance Julius accepted, a state the record establishes, a way
to tell Julius the design failed without changing it — and a whole three-peer
mission proven identical under three differently-shaped Coding Agents.

Six commits, all authored and committed by julius-worker[bot], provider-free
throughout. No provider call was made, no credential was read, and there was no
Anthropic, OpenAI or xAI spend of any kind.

The current-state audit, the gap list with severities, the PR boundary and the
proof and mutation plan are committed as `docs/JULIUS_CODING_AGENT_AUDIT.md`.

---

## 1 · A role with a provider port, a failure taxonomy, and results that cannot author another role's facts

**Reproduced first:** a coder could hand back `USER_APPROVAL` or `REVIEW_FINDING`
PASSED evidence and it counted toward acceptance criteria; any `evidenceId` was
kept, so a coder could pre-empt the id a later review needed; a worker-reported
FAILED status stalled the run in READY; foreign-role channels vanished with no
record; a 429 or an overload after launch ended the mission; credit exhaustion
landed as `provider_bad_request`; a paid session followed by an executor refusal
settled at $0.

- `julius-worker-authority.ts`: evidence types each role may author (no worker
  authors `USER_APPROVAL`, `PROVIDER_RECEIPT` or `TOOL_RECEIPT`); evidence ids
  minted by Julius from task, lease and index; result channels owned by role,
  and a foreign channel refused as `worker.channel.refused`.
- A worker-reported FAILED status is a failed attempt, decided like one.
- `julius-coding-agent.ts`: the provider-neutral governed request (identity,
  workspace, locked contract, plan, packet sorted into accepted guidance /
  architecture / findings / continuation / mission context, permissions,
  required evidence, budget, protocol) and a strict outcome with seventeen
  typed failures, each with a domain disposition — transient ones retryable,
  credit and authentication needing an operator, none a success.
- `createJuliusCodingAgentAdapter` is the Julius half; Claude Code is one
  provider behind the port (`claude-code-coding-provider.ts`).

## 2 · The locked scope is enforced from what the executor saw

The contract's permitted and out-of-scope paths were told to the coder and
checked by nothing. Julius now reads the executor's change set (tracked AND
untracked), recomputes scope against the locked contract, records
`coder.scope.violated` per path and authors FAILED `DIFF` evidence. An empty
change set is not PASSED evidence of a change; an uncaptured one is recorded as
uncaptured, never as empty; a failed diff capture leaves no stale diff for the
reviewer. The coder's own report is recorded beside what was observed, claims
compared to observations, and a report that claims completion is refused.

## 3 · The coder is guaranteed the guidance Julius accepted

Four defects, each reproduced by a failing test first: a crash between the
accepting decision and delivery released the continuation without its answer,
permanently; a question past the segment ceiling still bought an architect and
a review; a repair could not see the guidance its work was built on; a paused
repair lost its findings. Delivery now also happens at the continuation's own
claim, keyed on the packet so it is written once; the ceiling is checked before
anything is created; accepted guidance is carried into every repair of the unit;
a paused repair resolves the repair it continues. `guidance.consumed` names the
accepted entries each dispatch's packet held, and a packet the budget would drop
fails the dispatch as `accepted_guidance_dropped`.

## 4 · The sustained coder

- `projectJuliusCodingAgentState`: STANDBY, IMPLEMENTING, RESEARCHING,
  WAITING_ON_GUIDANCE, REPAIRING, HANDING_OFF, WAITING_ON_DEPENDENCY, BLOCKED —
  from task rows and peer requests alone, and carried on the peer channel view.
  TESTING and CHECKPOINTING are deliberately absent: no durable fact says either
  is in progress.
- `architectureObservations`, owned by CODING_AGENT alone:
  ASSUMPTION_INVALIDATED, DEPENDENCY_CHANGED, BOUNDARY_CROSSED,
  ARCHITECTURE_UNSATISFIABLE, REPLAN_SUGGESTED, each evidenced. Guarded, refused
  by name when unevidenced or about an assumption the design never made, and fed
  into PR #271's consultation triggers — the coder raises a consultation and
  never writes architecture.

## 5 · Three peers, one mission, any Coding Agent

Through `assembleLiveJuliusRuntime` with the production registrations and the
production Coding Agent adapter, under the Claude Code provider (real module,
injected hosted runner), a Codex-shaped task API and a generic provider:

- the whole lifecycle in exact ledger order — design, plan accepted, coder asks,
  architect consulted on the design and answers the question, reviewer checks
  the answer, Julius accepts and delivers, coder resumes and consumes it,
  reviewer requires a repair, coder repairs with the finding and the carried
  guidance, finding addressed then resolved by identity, final consistency
  check ALIGNED, Julius completes;
- one identical semantic trace under all three providers;
- a mission where every peer reaches for another's authority: each reach
  refused by name, the same Julius decisions as for honest peers;
- a rate limit during the repair retried with nothing fabricated; credit
  exhaustion during the repair: no evidence, no review, no resolution, no
  completion, `operatorActionRequired`;
- effort parity observed, never enforced — and a tool count a provider did not
  report is Unknown, not zero (a defect found building this proof, fixed).

## 6 · What the mutants found

Four of the first run's survivors were gaps in the proofs, and one hid a defect:

- **A paused repair was linked by its pause.** The finding a paused repair
  answered moved to ADDRESSED naming `segment:repair:…` as its repair. It now
  names the repair (reproduced first on a second-round repair that paused).
- A continuation is handed the answer to **its own** question, never another
  unit's (two coders, two questions).
- A replayed result records the coder's implementation and observations once.
- Evidence ids carry the lease that produced them; a retried repair's evidence
  names the retry's lease.

---

## Founder directive, item by item

| # | Directive | In this PR |
|---|---|---|
| 1 | Typed Coding Agent provider contract | `JuliusCodingAgentRequest` — the governed request only (commit 1) |
| 2 | Strict result contract; the coder cannot declare completion, VERIFIED, contract, budget, permission, security or reviewer outcomes | Evidence authority by role, Julius-minted ids, channel ownership, authority guard on the report and observations, FAILED status decided (commits 1, 2, 4) |
| 3 | Accepted guidance only, proven on the coder side, through the actual adapter | Claim-time delivery across a crash, once per packet, carried into repairs, `guidance.consumed` by name, dropped packet refused; sections by authority in the provider request; end to end through the production adapter (commits 3, 5) |
| 4 | Sustained coder, state in Julius's record | Continuation, repair and guidance lineage in the ledger; the provider holds nothing Julius needs (commits 3, 4) |
| 5 | Guidance questions Coding Agent → Julius → Architect | Mediated, scoped, paused, reviewed, accepted-only, resumed, replay-safe, cross-unit safe (commits 3, 5, 6) |
| 6 | Coder → reviewer boundary | No self-verification, no skipped review, no forged reviewer evidence, no self-resolution, no self-release — proven per provider (commits 1, 5) |
| 7 | Repair loop | First, second and paused repairs; findings addressed by the repair and resolved by identity; provider failure during a repair; lease-scoped evidence on retry (commits 3, 5, 6; with PR #271's finding lifecycle) |
| 8 | Architecture drift from the coder | `architectureObservations` → PR #271's consultation triggers; the coder writes no architecture (commit 4) |
| 9 | Tool, file and worktree authority | Executor-observed change set checked against the locked scope; permissions in the request are fixed by Julius. Hosted-session confinement is deliberately deferred (see below) |
| 10 | Provider failure model | Seventeen typed failures with domain dispositions; none fabricates success, evidence, review or completion (commits 1, 5) |
| 11 | Swappability fixtures | Claude-Code-shaped (real module), Codex-shaped, generic — one semantic trace (commit 5) |
| 12 | Derived Coding Agent states | `projectJuliusCodingAgentState`, facts only (commit 4) |
| 13 | Project Brain preparation without coupling | Ledger events and brain entries only; no second memory system |
| 14 | Mutation testing, survivors classified honestly | Below |
| 15 | Three-peer provider-free end to end | P29–P32 (commit 5) |
| 16 | Effort parity diagnostic | Observed per provider, never enforced; Unknown tool counts stay Unknown (commit 5) |

## Mutation testing

Every mutant is applied to the frozen tree, the named proofs run, and the file
is restored byte-for-byte; results are recorded per mutant.

| Set | Run | Killed | Survived |
|---|---|---|---|
| PR 3 — the founder's fifteen targets | 39 | 38 | 1 equivalent |
| PR 1 regression, at this head | 53 | 52 | 1 equivalent (C3-M16, documented at #270) |
| PR 2 regression, at this head | 41 | 41 | 0 |
| **Total** | **133** | **131** | **2 equivalent** |

Targets covered by the PR 3 set: coder self-verification, rejected-guidance
leakage, lost accepted guidance, bypassed review, wrong repair lineage,
unauthorised task creation, provider failure becoming success or a retry,
architecture mutation by the coder, peer-channel bypass, stale continuation,
duplicate replay, evidence identity collision, cross-unit leakage, permission
and scope expansion, provider behaviour leaking into kernel authority, and role
impersonation in the derived state.

The first PR 3 run killed 34 of 39. Four survivors were closed by the proofs in
commit 6 (M03, M08, M16, M23) and re-run killed.

Three PR 2 mutants no longer applied verbatim because this PR changed their
code sites (two anchors became two sites, one line was rewritten). They were
re-anchored to the current code rather than skipped, and all three were killed
— including disabling delivery at the accepting decision alone, where the new
claim-time delivery could have hidden it.

**P3-M15 — equivalent, documented.** Filtering the claim-time delivery on
ACCEPT/COMPLETE cannot change its choice on any reachable ledger: a continuation
waiting on guidance leaves BLOCKED only through `evaluateJuliusRelease`, which
requires the guidance unit to be effectively accepted, and nothing in the kernel
writes SKIPPED — so the latest decision in that unit at the claim is always the
acceptance that released it. The filter stays as defence in depth.

## Gates at the frozen head

Frozen head `42487c257fb5a6559245e599d8763009ce4a021e`, tree
`18797a27f2efd4347b2aa478bab0e3f9df05f234`, six julius-worker[bot] commits on
trusted main `b0c94152569f0eaf959d4d54899a84da4f46f815` (#274).

At the frozen head:

- `npm run typecheck` (all four passes) — exit 0
- Julius kernel, bridge, hosted Coding Agent and harness suites — 107 files,
  2366 tests passed, 0 failed
- `julius:harness:check` — OK (manifest unchanged); `git diff --check` — clean
- `relay-repository-boundary.mjs` — exit 0

At the same tree before the rebase over #274 (the only difference is #274's
test file, re-run above):

- `build`, `relay:build`, `relay:bridge:build`, `relay:hermes:build`,
  `relay-parity-gate.mjs`, `relay:surface-parity:check` and `:strict`,
  `relay:yc-demo:check`, `relay:cli:contract-verify` — all exit 0
- Broad `vitest run`, in twelve shards on this Windows workstation, compared
  failure by failure against trusted main at `237c32a2` in a separate worktree:
  11 689 tests, 149 failing on the branch against 140 on main, all 140 of main's
  also failing on the branch. The nine branch-only failures:
  - two were real and are fixed in this PR: the live evidence dump did not
    export the new Coding Agent diagnostics or the new checkpoint facts, which
    `scripts/julius-first-live-mission.test.ts` refuses. Each column is added in
    the commit that introduced its fact, and every one of the six commits passes
    that suite (170/170);
  - two are `relay-hermes-service/signal-lifecycle.test.ts`, which only runs its
    built-service cases when `dist-relay-hermes` exists — this worktree had just
    built it for the gates. With the same build, trusted main fails identically
    (`ps: unknown option -- o`, Windows `ps`);
  - five are load-sensitive git and process tests
    (`repository-remote-transport`, `ship-route`, `workspace`). Run in
    isolation, `repository-remote-transport` and `workspace` pass on both trees
    and `ship-route` fails identically on both.

CI on Linux is the authority for the rest of the suite.

## Deliberately not in this PR

- **Hosted-session confinement** (`tools`, `canUseTool`, `strictMcpConfig`,
  `HOME`) and the adapter-internal deadline, abort and workspace reset. These
  change what the real Claude Agent SDK may do and can only be proven against
  the real runtime; they belong in an adapter-hardening PR gated on a live
  smoke check. Until then the Julius-side scope check is the backstop.
- **A durable artifact store** for plan, diff and test output.
- **Telling the next packet that a pause did not continue.**
- **Project Brain coupling.** Coder facts are ledger events and brain entries
  Project Brain can adopt; no second memory system is introduced.
- No paid qualification was started and no official qualification setting was
  changed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
