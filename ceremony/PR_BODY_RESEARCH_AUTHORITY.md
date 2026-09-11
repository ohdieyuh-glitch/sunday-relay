# Julius: a mission could not be granted research, and the plumbing said otherwise

## 1. What was actually broken

The governed-research machinery has been complete for three landings. There is a
sealed per-mission policy (`julius-research-policy.ts`), a mediator
(`relay-bridge/julius/research-mediator.ts`), a Live Reach service, a durable
retrieval ledger projected from the run's own rows, and a qualification suite
that drives all of it with no network.

It has never been reachable. `assembleLiveJuliusRuntime` accepts
`researchPolicyFor` and `researchProbes`; the live entrypoint
(`relay-bridge/julius-live-mission.ts`) passed neither. Every paid mission so
far has therefore run under `noJuliusResearch` — allowlist empty, no slot
authorised, retrieval budget zero — whatever its mission document said. Nothing
reported that, because the only thing that ever exercised the seam was the
qualification test, which supplies both halves itself.

Grepping the entrypoint for the word `research` returned nothing.

## 2. Three facts, and the point is that they stay apart

| fact | whose it is | where it lives now |
|---|---|---|
| what this mission is AUTHORISED to read | the mission document's | the contract's `research` clause, bounded by a deployment grant |
| what an operator has OBSERVED a backend serve | the operator's | `JULIUS_RESEARCH_OBSERVED_BACKENDS` |
| whether anything is actually retrieved | neither | decided at request time by the mediator, from both |

A contract asserting its own reachability would be the mission vouching for the
one thing it is not in a position to know, and Live Reach's readiness gate would
become decorative. So observation arrives through the environment instead, and
the default of every one of the three is nothing.

## 3. The clause is sealed where it is read

`parseLiveMissionContract` hands the clause to `sealJuliusResearchPolicy` and
refuses the whole contract with the domain's own reason code. Twelve spellings
are proven: an unknown source, an action verb in a read allowlist, an unknown
capability, no capability, no host, `*`, `*.com`, a URL in a host slot, a
duplicated source, an unknown role, a negative budget, a fractional budget.

Sealing first at dispatch would be a contract that looked valid right up until
it had already been paid for.

This adds no second opinion about the vocabulary: the domain owns what a valid
policy is, and a second opinion about an allowlist is how allowlists get holes.

## 4. The observation is checked against the registry, and refuses

`resolveReadiness` consults a probe only when its `backendId` **and** its
`capability` both match a real candidate. So a mistyped claim is not a weaker
observation — it is **no** observation, and the mission runs with research
silently inert while whoever set the variable believes it is armed.

Every claim is therefore checked against the Live Reach registry, and a bad one
refuses the run: an unknown backend, a capability that backend does not
implement, an action verb, a malformed entry, a duplicate.

There is no partial list. Dropping the bad entry and keeping the good one is how
an operator ends up believing they armed two backends and running with one.

It is read **before `bootstrap.submit`**, not at assembly: after submission there
is a durable run to reconcile, and refusing then would leave one behind for a
typo.

`probedAt` is `null`, not the current instant. The operator asserts they have
seen it; Relay probed nothing in this process, and stamping now would date an
observation nobody made here.

## 5. A contract may not grant itself research

The domain checks a clause is WELL FORMED, which is a different question from
whether this mission was ever authorised to read the outside world at all.
Without a deployment grant, a mission document could hand itself the internet by
editing its own file — the exact mistake the spend ceilings prevent, and the one
run 34396331071 refused when mission 3 declared its own 20/3.

`scripts/julius-live-contract-check.mjs` now carries a research grant table
beside the spend table, with the same shape and the same posture: the contract
states what it wants, the grant is a ceiling, and anything the grant does not
cover is refused by name — a role, a source, a capability, a host, or a
retrieval budget.

**The table is empty.** No mission has been granted research; a contract
declaring a research clause is refused today; and a proof asserts the emptiness,
so authorising the first mission is a deliberate, reviewable edit a human sees
rather than a side effect of shipping the plumbing.

## 6. What the run says before it starts

    research: NOT AUTHORISED (no contract clause) — every ask is refused research_not_authorized

or, when a clause is present:

    research: authorised for PROMPT_ARCHITECT across 1 allowance(s); 1 observed backend(s)
        web/read_item: ready

Every authorised `(source, capability)` pair is reported with the readiness
`resolveReadiness` will actually give it, so "authorised but unreachable" is
stated up front rather than discovered one refusal at a time in the evidence.
It is **reported, never enforced**: a mission may legitimately authorise more
than Relay can currently reach, and Live Reach refuses the unreachable part
honestly at request time.

## 7. Proofs

`relay-bridge/julius-research-authority.test.ts` — 44 cases in five sections:

* **A (1–8)** the clause: parsed, carried verbatim, sealed at parse time with
  the domain's reason code for twelve malformed spellings, bound to the
  contract's own mission id, normalised so two spellings share a fingerprint,
  authorising exactly what it said and nothing adjacent (a neighbouring host, an
  unlisted slot, an ungranted capability), and the default refusing by name.
* **B (9–14)** the observation: absent means none; a well-formed claim becomes an
  observed probe with `probedAt: null`; eight malformed or unserveable claims
  each refuse; a bad claim refuses the whole list.
* **C (15–18)** reach: ready with an observation, not ready without one, every
  pair reported, and reporting reach never widens the allowlist.
* **D (19–22)** the wire: both options reach `assembleLiveJuliusRuntime`, both sit
  behind the clause guard, the clause type carries no observation field, and a
  mistyped observation refuses **the built bundle** before the preflight banner
  is printed.
* **E (23–26)** the grant: a contract with no clause passes as before, one that
  declares research is refused, the grant table is empty, and no mission
  contract in the repository asks for research today.

## 8. Adversarial mutations

Twenty applied, twenty killed, no survivors: the observation parser tolerating
each of its five refusals in turn and returning a partial list; `probedAt`
stamped with the current instant; the probe result weakened; the parse-time seal
removed and its error swallowed; a non-object research field accepted; each half
of the wire dropped; the wire moved out from behind the clause guard; the
refusal no longer stopping the run; the sealed policy bound to a fixed mission;
the reach summary reporting only the first capability; the grant gate removed;
the report line removed; and a mission quietly granted research.

**One survived its first run, and the weakness was in the proof.** "The
observation refusal no longer stops the run" survived because a machine with no
database is refused a few lines later anyway, and the proof only looked for the
generic refusal. The preflight banner's ABSENCE is what proves the observation
check came first; the proof now asserts it, and the mutation dies.

## 9. Gate

Full gate green on this tree: `npm test` **10,379 passed / 0 failed** across 530
files, `typecheck` (all four passes), `build`, `relay:build`,
`relay:bridge:build`, `julius:harness:check`, repository boundary, parity gate,
surface parity (strict), YC demo check, CLI contract verify, persistence
contract verify, persistence recovery drill, workspace verify, Claude contract
verify, `git diff --check`.

`JULIUS_HARNESS_MANIFEST.md` is regenerated and records the entrypoint's two new
edges to the kernel: the policy it seals, and the Live Reach vocabulary it
checks an operator's claim against.

## 10. What this does not do

It does not authorise any research. It does not contact any provider. It does
not make any mission able to read anything — the grant table is empty, no
contract declares a clause, and no backend is observed anywhere. Every retrieval
in this repository is still refused, by the same two gates as before, for the
same reasons.

What changes is that granting research is now possible, bounded, visible in one
named table, and impossible for a mission to do for itself.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TqJcJuQiraGDnFnjA4gyUc
