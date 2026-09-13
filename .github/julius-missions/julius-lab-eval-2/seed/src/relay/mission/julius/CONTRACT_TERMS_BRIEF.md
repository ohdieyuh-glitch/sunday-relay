# Brief — assumptions and open questions in the task contract

## The request

Every Prompt Architect plan states two things the task contract never
receives: the **assumptions** the plan rests on, and the **questions it could
not resolve**. The contract is the document a Coding Agent is bound to and an
Independent Reviewer grades against, so today:

- a coder can be bound to an agreement that silently depends on premises
  nobody wrote into it;
- a reviewer has no way to check the work against those premises;
- a contract can lock while its own author said a question was still open,
  and the coder then resolves the ambiguity by guessing.

Add both as contract terms. An agreement with an open question is not an
agreement: it may be drafted, challenged and revised, but it must not lock —
neither through the domain gate nor at the store — until a revision answers
the question. The answer can then be kept as an assumption, and the reviewer
is charged with the assumptions.

## Where the work is

- `julius-task-contract.ts` — the contract, its binding digest, the lock gate,
  the review charge and the proposal sanitiser.
- `julius-memory-store.ts` — the store's reference model. It locks a stored
  revision when the caller's digest matches the terms; it is the store, not the
  caller, that refuses a second lock, and it must be the store that refuses to
  lock an open question too.

The other sliced files are dependencies of the store and are not part of the
work.

## What a contract is, operationally

Contracts are durable. Every revision is kept, and the production store is a
PostgreSQL table that holds each revision's terms as a JSON document beside the
binding digest that was computed when it was written. On every read the store
re-derives the digest from the stored terms and refuses a row whose terms no
longer hash to it. A run that is resumed replays its bootstrap, which re-seeds
revision 1 from the mission and hands it to the store; the store compares
digests to decide whether that is a replay or a conflict. The reference model in
this workspace does all of this the same way.

A deploy does not wait for runs to finish. When this change ships, runs in
flight hold contracts written by the code as it is now.

## What must survive

`julius-task-contract.existing.test.ts` is green today and must be green when
you finish. Its first half is about `julius-task-contract.stored-rows.json`:
contract rows exactly as the store held them before this change, with the
digests the code that wrote them computed. Its second half is the contract's
existing semantics.

## What "done" means

Both specifications pass under the mission's test command. A change that makes
every new case pass and one existing case fail has not added a feature; it has
stopped a run that was already underway.
