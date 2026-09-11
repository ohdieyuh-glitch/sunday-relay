# ADR-021 — The continuous three-worker lifecycle

**Status:** Accepted and implemented in the kernel (2026-09-10). The live
provider half is deliberately **not armed** — see *Consequences*.

## Context

Julius dispatched its three canonical slots in a near-straight line. The Prompt
Architect planned once, the Independent Reviewer graded once, and the Coding
Agent performed every remaining minute of agentic work alone.

A full map of the runtime established that this was not a tuning problem but a
structural absence:

- The event catalogue's 41 types were **all boundary transitions**. Nothing
  existed between `worker.dispatched` and `worker.completed`.
- One dispatch is a single un-instrumented `await`, and the adapter port is
  `dispatch(input) => Promise<result>` — one promise in, one result out, with no
  callback channel.
- `runJuliusAgentTurnLoop` takes no ledger and emits nothing; Julius cannot see
  turn 3 of 12.
- A worker's context is compiled **once**, before dispatch. The only thing that
  can enter a running worker mid-flight is its own tool results.
- The Prompt Architect has **no tool use and no research capability**: the live
  call sends no `tools`, and a test pins that it never will by accident.

So a mission's whole middle was unwritten, and the two slots that were not the
coder had no way to participate in it.

## Decision

**1. Julius's unit of participation stays the TASK.** Continuous participation
is expressed in tasks rather than beside them. A task is claimed under a lease,
admitted against an attempt, dispatched under a locked contract, banked as
evidence, reviewed and decided. Budget, provenance, the contract gate, the
repair loop and recovery all key off that one primitive; a parallel channel
would have had to re-earn every one of those properties.

**2. The adapter seam does not change.** Two optional result fields
(`guidanceRequest`, `guidance`) are the entire new surface, mirroring
`contractProposal`. A running worker still cannot be interrupted. What changes
is that a mission now has many more moments at which one may be *asked*.

**3. Three primitives, in one pure-domain module**
(`julius-continuous-lifecycle.ts`):

- **CHECKPOINT** — a typed record that something worth a decision happened. Ten
  closed triggers, every one an event that occurred. There is no timer, no token
  count and no polling: a cadence measured in intervals fails twice at once, by
  asking when nothing happened and staying silent through the turn that
  mattered.
- **GUIDANCE** — what the architect may say after LOCK. Bound to the exact
  contract revision it was written under, versioned per subject, and
  structurally incapable of carrying a contract term.
- **VERDICT** — `CONTINUE`, `WARNING`, `CHALLENGE`, `REPAIR_REQUIRED`, `BLOCK`.

**4. Guidance cannot amend a contract, structurally.** The packet has no
`objective`, no `inScope`, no `blockingAcceptanceCriteria`, no `budget` and no
`permittedPaths`; the sanitizer refuses any proposal naming a contract-owned key;
and a test reads the contract's own field list out of its source and fails if a
term exists there that guidance is not forbidden. `affectedCriterionIds` may
*name* a criterion the contract already has and is refused for inventing one.
A genuine change uses the existing revision model: a new immutable revision, a
reviewer challenge, and a re-lock with a new digest.

**5. Verdicts are not decisions.** `juliusDecisionForVerdict` is partial on
purpose — only `REPAIR_REQUIRED` and `BLOCK` map to an action, and **no verdict
maps to an accepting one**, so the checkpoint path can never complete a mission
the verification path never verified. `routeJuliusCheckpoint` returns a *named
intention*; Julius performs it. The strongest thing a reviewer can do is cause
that function to return `HALT`, and Julius still decides whether to halt.

**6. Two review stages join the existing vocabulary** (`guidance`,
`repair:guidance`) rather than a second review path, so guidance inherits the
contract binding, the shared-binding guard, findings, the repair round and the
round ceiling.

**7. One line binds guidance to the agreement.**
`juliusContractSubjectTaskId` resolves a guidance task to its subject's
contract. The architect that *drafts* the terms is bound by none — it is writing
them; the architect that *advises* under terms already locked is bound by
exactly those. The dispatch gate, the claim's binding record and the reviewer's
shared-binding guard then all apply without being rebuilt.

**8. Julius refuses to mint a task nothing can route.** The same preflight
`scheduleRepair` uses. A task minted for a role nothing serves does not fail, it
sits `RUNNABLE` forever with the mission unable to complete around it.

## Consequences

- The reviewer sees the plan, the guidance and the build within one mission
  instead of the final output alone, and can force a repair or a halt during
  execution — through Julius, never around it.
- The architect is callable after LOCK without the contract moving.
- A failed guidance task or a failed guidance review leaves the mission
  incomplete rather than proceeding as if advised: `reviewCompletedFor` counts
  only a `SUCCEEDED` reviewer child.
- Four new event types end the boundary-only ledger. They carry counts, digests
  and identifiers — never the advice itself, which travels to the coder the way
  the plan does.
- **The live half is not armed.** No live worker registers `guidance` yet,
  because the live architect adapter has no guidance charter or output schema,
  and giving the architect real research/tool use is a provider-side change that
  needs its own paid proof. Until a worker registers the task type, Julius
  records that it *would* have asked and carries on. Arming it later is a
  registration plus an adapter, with no change to anything decided here.
- External research is designed for and not enabled. `JuliusGuidanceReference`
  records **where** something was read and how well it was corroborated, never
  the retrieved text: external content is attacker-controlled by assumption, and
  nothing in this module admits a fetched document into the record.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| A callback/streaming channel on the adapter port | Re-earns budget, lease, contract-gate, provenance and recovery from scratch, and makes every adapter responsible for them |
| Interval or token-count cadence | Asks when nothing happened and is silent when it matters; the directive asked for event-driven explicitly |
| Guidance as a contract amendment | Silently mutates a locked agreement, which is the one thing the contract stack exists to prevent |
| A `WARNING` verdict that interrupts | Then it is a `CHALLENGE`; a reviewer that wants to stop the run has to say so |
| Verdicts mapped onto `JuliusDecisionAction` directly | Lets a reviewer mint an `ACCEPT` and complete a mission nothing verified |

## Proof

27 provider-free deterministic proofs numbered against the directive's twelve,
plus 42 domain cases. Mutation-tested fifteen ways on the authorization, lock
and checkpoint paths, 15 of 15 caught — two of the proofs exist because a
mutation escaped the first pass.
