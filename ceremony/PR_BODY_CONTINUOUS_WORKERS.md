Julius dispatched its three canonical slots in a near-straight line: the Prompt
Architect planned once, the Independent Reviewer graded once, and the Coding
Agent did every remaining minute of agentic work alone.

**The map came first, and it found the cause was structural, not tuning.**

| what was checked | what was there |
|---|---|
| the event catalogue | 41 types, **every one a boundary transition** |
| one dispatch | a single un-instrumented `await` |
| the adapter port | `dispatch(input) => result` — no callback channel |
| `runJuliusAgentTurnLoop` | no ledger, no emit; Julius cannot see turn 3 of 12 |
| worker context | compiled **once**, before dispatch |
| the Prompt Architect | **no tools, no research** — pinned by its own test |

A mission's whole middle was unwritten, and the two slots that were not the
coder had no way to participate in it.

Base `ed81b12e834ce60015926dfc56500dd4b09d4c72` · Head `ce543849459eda7587d448a00bc175c4585a6775` · Tree `3583ff65277a3e706024b980c8688d00c762b684` · 3 commits

## The decision

**Julius's unit of participation stays the TASK.** Continuous participation is
expressed in tasks rather than beside them, so it inherits the lease, the
attempt, the contract gate, evidence, review, repair and recovery instead of
re-earning them. A coder's `guidanceRequest` becomes a checkpoint, a route, and
a **real task on the architect** — not a message, not a side channel.

**The adapter seam does not change.** `dispatch(input) => result` is still one
promise in and one result out, plus two optional result fields mirroring
`contractProposal`. A running worker still cannot be interrupted; what changes
is that a mission now has many more moments at which one may be *asked*.

Three primitives, in one pure-domain module:

- **CHECKPOINT** — ten closed, event-driven triggers. No timer, no token count,
  no polling: a cadence measured in intervals fails twice at once, by asking
  when nothing happened and staying silent through the turn that mattered.
- **GUIDANCE** — what the architect may say after LOCK, bound to the exact
  revision it was written under and structurally unable to carry a contract term.
- **VERDICT** — `CONTINUE` / `WARNING` / `CHALLENGE` / `REPAIR_REQUIRED` / `BLOCK`.

## One line bought three guards

`juliusContractSubjectTaskId` now resolves a guidance task to its subject's
contract. The architect that **drafts** the terms is bound by none — it is
writing them; the architect that **advises** under terms already locked is bound
by exactly those. So a guidance task passes the ordinary dispatch gate (refused
unless LOCKED), records the ordinary binding on its claim, and its own review
passes the ordinary shared-binding guard. Requirements 1, 3, 4 and 9 fell out of
guards that already existed.

## Guidance cannot amend a contract, structurally

The packet has no `objective`, no `inScope`, no `blockingAcceptanceCriteria`, no
`budget`, no `permittedPaths`. The sanitizer refuses any proposal naming a
contract-owned key. And a test **reads the contract's own field list out of its
source** and fails if a term exists there that guidance is not forbidden.

That test earned its place immediately: my first draft named a guidance field
`prohibitedActions`, colliding with the contract term of the same name. It is
now `additionalProhibitions` — **narrower than the contract and never wider**,
since a prohibition can only restrict what the coder may do and can never grant
permission the agreement withheld.

`juliusDecisionForVerdict` is partial on purpose: only `REPAIR_REQUIRED` and
`BLOCK` map to an action, and **no verdict maps to an accepting one**, so the
checkpoint path can never complete a mission the verification path never
verified.

## Deliberately not armed

**No live worker registers `guidance`.** The live architect adapter has no
guidance charter or output schema, and giving the architect real research or
tool use is a provider-side change (`gpt-runner.ts` sends no `tools`, and a test
pins that) which owes its own paid proof.

So Julius applies the same routability preflight `scheduleRepair` uses: until a
worker registers the task type, it records that it **would** have asked and
carries on. A task minted for a role nothing serves does not fail — it sits
`RUNNABLE` forever with the mission unable to complete around it, which is what
paid run 34037313976 taught. The mechanism is inert rather than hazardous.

## Proof

**27 provider-free deterministic proofs**, numbered against the directive's
twelve, driving the real runtime — the real claim, the real contract gate, the
real binding currency, the real budget reservation, the real verification
evaluator, the real repair planner. Plus **42 domain cases**.

**Mutation-tested fifteen ways, 15 of 15 caught**: guidance dispatching unbound,
the sanitizer admitting a contract term, an invented acceptance criterion, a
verdict minting an `ACCEPT`, an uncited accusation, a reviewer judging itself,
the anti-spam rule ignored, guidance asked before LOCK, a digest that forgets
its agreement, a `BLOCK` that does not halt, a `CHALLENGE` that amends, an
unknown trigger admitted, a task minted against the route, a silent refusal, and
a guidance review demanding a diff.

Two of those proofs exist **because a mutation escaped the first pass** — Julius
honouring a route it computed, and never declining in silence. The second is
structural: a bare `return` in the issuer is now forbidden, because a refusal
the record cannot show is the same failure as Mission 5's missing coder
diagnostics.

`npm test` **516 files / 10,016 passed / 0 failed** (3 skipped, 30 todo) ·
four-pass typecheck · `build`, `relay:build`, `relay:bridge:build` · repository
boundary PASS · parity gate PASS · surface-parity strict · yc-demo · CLI
contract-verify · harness `--check` current · `git diff --check` clean · four
drills PASS. Each of the three commits was verified green on its own tree.

**No paid run was dispatched.** The Anthropic account is unfunded and the
directive forbade it.

Immutable Task/Mission Contract semantics, Project Brain trust rules, the
no-hidden-reasoning guarantee, bounded budgets, provider-independent worker
slots, reviewer independence, the disposable sandbox, candidate-diff-only and
the provenance ceremony are all **preserved and asserted**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TqJcJuQiraGDnFnjA4gyUc
