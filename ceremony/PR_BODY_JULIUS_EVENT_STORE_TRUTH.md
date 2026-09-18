# Julius PR 7: durable event truth — one append contract, in every store, and key order is not meaning

The small boundary PR #279 surfaced, on trusted main `8db97f9b`. Audited and
**reproduced there** before it was fixed.

No provider was called and no credential was read. There was no Anthropic,
OpenAI or xAI spend of any kind. The attempt ceiling is untouched, and no
paid-qualification parameter moved.

---

## The defect: one port, two behaviours, in opposite directions

`JuliusEventWriter.appendEvent` answers `true` for "recorded" and `false` for
"already there". The two implementations disagreed about what "already there"
meant, and neither did what the ledger claims:

- **In memory** a repeated event id was compared **by id alone**. A second event
  carrying DIFFERENT facts under a used id was dropped, its facts lost, and
  `false` returned as though it had been a replay.
- **On PostgreSQL** the stored payload was compared with the one just built via
  `JSON.stringify`. **`jsonb` does not preserve key order**, so a genuine replay
  compared unequal and was refused `julius_event_id_conflict`. PR #279's
  real-PostgreSQL proof asserted the port's own claim and was refused by the
  store — which is how this was found.

No suite compared the two, so neither behaviour was visible as wrong.

## The contract, stated once

Declared in `julius-events.ts` and documented on the port:

| write | answer |
|---|---|
| a new id | recorded, `true` |
| the same id, the same event | **idempotent**: no duplicate, no error, `false` |
| the same id, a different event | `JuliusEventIdConflict`, **nothing written** |

`canonicalJuliusEventIdentity` decides sameness:

- the subject (run, project, type, task, worker, correlation, causation) and the
  facts;
- **sorted at every depth**, so a payload that has been through `jsonb`
  compares equal to the one that produced it;
- **not `occurredAt`** — a replay after a restart reads a later clock and is
  still the same event. The ledger keeps the instant of the first write.

Both stores implement exactly that, and the conflict they raise is one typed
error naming the event.

## Proven against both stores, from one set of cases

`julius-event-append-conformance.ts` holds the cases. They run against the
in-memory store and, in CI, against real PostgreSQL:

- a new event records once;
- the same event replayed is idempotent;
- key order is not meaning;
- a later instant is not a different event;
- different facts under a used id are a typed conflict, and the recorded facts
  stand;
- a different task or type under a used id is a conflict too;
- two different events both record.

The PostgreSQL suite adds what only it can show: a replay through a **new
repository — a restarted process** — is still idempotent, and the stored payload
**really has been reordered by `jsonb`**, so the divergence this closes was not
hypothetical.

`sameStoredJuliusEvent` — the decision the writer makes — is now an exported
function, so the rule is provable without a database as well as through one.

**Found while fixing it:** the test id factory counts, so a harness resuming a
store re-minted ids a previous harness had used — different events under one id,
which the old memory store dropped silently and the contract now refuses. A
resumed harness gets its own run of the counter, which is what a real restart
(UUID ids) has.

---

## Proofs

Three commits, all authored and committed by julius-worker[bot]:

1. **The contract** — canonical identity, the typed conflict, both stores, the
   port's documentation, the restart-aware fixture.
2. **The conformance suite** — the cases, the in-memory run, the
   real-PostgreSQL run and its CI step, the audit entry.
3. **What the mutants found** — the decision extracted so it is provable without
   a database, and the cases proven able to fail.

**New proofs (30)**

- `julius-event-append.test.ts` (12) — the seven contract cases on the in-memory
  store; the typed conflict names the event; what makes two writes the same
  event (key order at any depth, not the instant, not the id) and what makes
  them different.
- `julius-event-append-decision.test.ts` (8) — `sameStoredJuliusEvent` against a
  payload reordered exactly as `jsonb` reorders it, a later instant, every field
  that makes an event different, an unreadable row, and a difference nested
  inside a fact; a structural check that the writer acts on that decision with
  one comparison and one typed throw; and the contract cases run against a
  permissive store and a wrong-error store, because a case that cannot fail
  proves nothing.
- `julius-event-append.real-postgres.test.ts` (10, CI `first-live-topology`) —
  the same seven cases on the real schema, the typed conflict, idempotency
  through a restarted repository, and the `jsonb` reordering itself.

## Mutation testing

| Set | Run | Killed | Equivalent |
|---|---|---|---|
| PR 7 — identity, both stores, the fixture, the cases | 14 | 14 | 0 |
| PR 1 – PR 6 regression, at this head (none skipped) | 229 | 227 | 2 |
| **Total** | **243** | **241** | **2** |

- First run of the PR 7 set: 9 of 14 killed. Four survivors were the same gap —
  the PostgreSQL half was reachable only through a database, and the contract
  cases were unguarded — closed by the third commit; the fifth was a canonical
  form that stopped at the top level.
- Regression: C2-M17 is killed by the PR 4 proof that closed it at #277.
  **C3-M16 and P3-M15** are the equivalents documented at #270 and #275.

## Gates at the frozen head

Frozen head `6e09687124b8c27628ba3f9002944edb2f68f607`, tree `d7c81ba25ea9a648d58b6819e09374689d7fd676`, on trusted main
`8db97f9b0d991133f061f0891a15ddffe4733219`.

- `npm run typecheck` (four passes) — exit 0
- `julius:harness:check` — OK; `git diff --check` — clean
- `relay-repository-boundary.mjs`, `build`, `relay:build`, `relay:bridge:build`,
  `relay:hermes:build`, `relay-parity-gate.mjs`, `relay:surface-parity:check`
  and `:strict`, `relay:yc-demo:check`, `relay:cli:contract-verify` — all exit 0
- Julius kernel suite — 85 files, 1 698 tests, 0 failed
- Broad `vitest run` in twelve shards, compared failure by failure against
  trusted main in a separate worktree: 11 969 tests; 145 failing on the branch
  against 143 on main, and no main-only failures. The two branch-only failures
  (`repository-remote-transport` push refusal, `workspace` worktree lifecycle)
  are the load-sensitive git tests seen before: both pass when rerun alone.
  Everything else fails identically on both.

CI at this head: running when this PR opens; this section is updated with its result.

## Not in this PR

- **Live event ids are random UUIDs**, so a replayed operation writes a NEW row
  rather than reaching the idempotent path at all. The ledger's idempotency is
  available to deterministic ids only. Making Julius's operational event ids
  deterministic changes every event's identity and is a boundary of its own —
  reported, not hidden.
- The attempt ceiling (2 declared vs 3 operative) remains the founder's
  decision.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
