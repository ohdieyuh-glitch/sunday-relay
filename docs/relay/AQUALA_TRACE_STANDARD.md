# Aquala Trace Standard — Mission Operations Milestone 4

Status: implemented (deterministic, browser-safe, **no live cross-product
integration, no database persistence, no digital signatures**)
Module: `src/relay/mission/trace/`
Tests: one `*.test.ts` per module, plus `trace-scenarios.test.ts` (the twelve
required fixtures A–L end-to-end) and `trace-boundary.test.ts` (zero external
activity, asserted at the source level)

## Why one shared trace

Every Aquala product answers a different part of the same question, and today
each answers it in its own log. A trace is the single spine that connects user
intent → routing → mission contract → commands → task ownership → execution
capsules → prompts, tools, permissions, workspaces, commands, processes, files,
tests, builds → agent reports → review findings → repairs → evidence →
approvals → outcome verification → release decisions → economics.

It is append-only and tamper-evident because the whole point is to be able to
say later, with proof, what actually happened — including when what happened
was that an agent did not run, or that something else ran instead.

## Manifest

`AqualaTraceManifest` fixes trace identity at creation: trace id, schema
version, project/mission/task scope, creator, creation time, canonicalization
version, hash algorithm, genesis event id and hash, retention classification.
None of that can change afterwards. The ledger updates only
`lifecycleStatus` and the growing `sourceProducts` set; there is no generic
manifest mutation API.

## Lifecycle

| status | meaning |
| --- | --- |
| `open` | accepts valid new events |
| `completed` | operational execution ended; permitted late events still arrive |
| `sealed` | finalized; accepts nothing further |
| `integrity_failed` | verification found a break; preserved for inspection |

Completion and sealing are DIFFERENT. Mission completion never seals a trace,
and trace completion never means the mission was verified. A completed trace
still accepts late cost receipts, human approval, the release decision,
evidence/review links, and integrity results — anything else is refused.
Sealing is explicit, verified before and after, and irreversible: there is no
operation that returns a sealed trace to open.

## Event envelope and versioning

Every event carries `schemaVersion`, `canonicalizationVersion`, and
`hashAlgorithm` explicitly, plus identity (`traceId`, `projectId`, and the
optional mission/task/command/capsule/run references), revisions, `sequence`,
family and exact type, source product and service, actor and actor type,
source trust, timestamp, redacted metadata, redaction status,
`previousEventHash`, and `eventHash`.

Unsupported versions are rejected at creation AND during verification. Existing
events are never rewritten because a newer version appeared — a future schema
change creates a new representation or an explicit migration record. No
migration framework exists yet; that boundary is deliberately future work.

## Genesis

Exactly one per trace: `trace_created`, sequence 1, `previousEventHash` null.
No other event may carry a null previous hash, and a second genesis fails
verification with `invalid_genesis`.

## Canonicalization (version "1")

Keys sorted recursively; array order preserved; explicit `null` preserved;
`undefined` object properties omitted (absent and explicitly-undefined
canonicalize identically) while `undefined` inside an ARRAY is rejected;
functions, symbols, `NaN`, `Infinity`, `-Infinity`, and BigInt rejected;
non-plain objects (class instances, `Date`, `Map`, `Set`) rejected, so
timestamps must already be normalized ISO strings; `-0` normalized to `0`.
Insertion order is never trusted. Rejections name the exact failing path.

## Hashing

SHA-256, synchronous, over UTF-8 bytes:

```
eventHash = SHA-256( canonicalSerialize( event minus eventHash ) )
```

The hash input includes `previousEventHash`, `sequence`, actor, source trust,
every identity/revision reference, and the redacted metadata — everything
except the hash field itself.

The implementation is hand-written FIPS 180-4 in `trace-hashing.ts`, and that
is a deliberate constraint, not a preference: the repo-wide mission-layer
boundary test forbids any `node:` import under `src/relay/mission/**` (the
domain must stay browser-safe), `crypto.subtle` is asynchronous, and the repo's
existing `stableDigest` is a 64-bit NON-cryptographic checksum that would make
the chain forgeable. Weakening the boundary test was not acceptable, so the
milestone ships a real SHA-256 with published known-answer vectors (including
the one-million-character case) instead of borrowing or inventing one.

**Callers never supply `sequence`, `previousEventHash`, or `eventHash`** —
they are not part of the draft type, and the ledger computes them. That is what
stops an agent from choosing its own place in the chain or forging its own
audit history.

## Hash chain and integrity

Verification walks from genesis and stops at the FIRST failure, reporting
`verifiedThroughSequence`, the first invalid sequence/event id, a typed
`reason`, and expected vs actual hashes. It never repairs anything and never
reports a partially valid trace as verified.

Because each hash covers its own previous hash and sequence, all of these break
the walk: tampered metadata, a removed middle event, reordered events, a
replaced event, an inserted unhashed event, a duplicate id or sequence, a
broken link, a scope or identity mismatch, an unsupported version, and a
timestamp regression.

## Concurrency and batches

An appender may pass `expectedHead` (hash, optionally with sequence). A stale
head is refused with `STALE_TRACE_HEAD` and changes nothing; the caller
re-reads the head and retries. There is no distributed locking.

Batch append is atomic: every draft is validated, redacted, chained, and hashed
BEFORE anything is stored, so one bad draft rejects the whole batch and leaves
the ledger byte-for-byte unchanged.

## Source products, families, and event types

Seven source products are modelled; only `sunday_relay` and `manual` events are
emitted here. Twenty-seven families exist, but a family is a bucket, never the
meaning — `trace-event-types.ts` pins each exact Relay event type to its family
and rejects unknown types and mis-filed ones.

## Actor identity and source trust

Four levels: `claim` (the actor reported on itself), `observed` (a supervisory
system saw it), `attested` (a trusted supervisory source or adapter attested),
`verified` (an authorized verification system validated evidence).

Rules the ledger enforces: an agent or reviewer reporting on its own work is
capped at `claim`; any actor that is the SUBJECT of the event cannot attest
about itself; `attested` requires a trusted supervisory service; `verified`
requires an authorized verification service. A wrapper cannot claim the
identity of an unavailable external agent. Requested and actual identity stay
separate — a requested agent earns no credit, an unauthorized substitution is
recorded as OBSERVED and files under the `security` family, and an authorized
fallback keeps both identities visible.

## Redaction before hashing

Order is REDACT → CANONICALIZE → HASH → STORE, reusing the shared redactors
rather than adding another. Protected: API keys, authorization headers, tokens,
cookies, provider and database credentials, private keys, webhook secrets,
signed URLs carrying credentials, and secret environment-variable VALUES —
environment-variable NAMES may remain as useful evidence. Metadata that still
looks credential-shaped after redaction is REJECTED rather than stored.
Redaction never mutates the caller's object, the status is recorded on the
event, and verification works from the stored redacted form alone, so a trace
can be exported without carrying secrets.

## Reconstruction and the AqualaTrace summary

`reconstructTrace` folds the ledger into an `AqualaTrace` read model: identity,
source products, request and context, routing, policy, execution ids and
per-capsule identity summaries, review/finding/repair/evidence ids, the
four-status model (replayed through the REAL Milestone 1 engine, so an
impossible history fails deterministically), event counts by family, integrity,
lifecycle, and timestamps.

It refuses to infer: execution completion is not outcome satisfaction, a
reviewer process finishing is not verification, verification is not release,
and a requested agent is never an actual agent.

**Economics stays empty.** Every cost field is `null` and the status is
`not_available` (or `partial` once receipt IDs exist). Absent cost never
becomes zero. No pricing lookup, no aggregation, no estimation — Milestone 5
owns all of it.

## Adapters

- **Milestone 1** — an ACCEPTED status transition becomes one trace event with
  dimension, previous/next status, reason, actor, mission and artifact
  revisions preserved. A rejected transition produces no event at all, so a
  refusal can never be recorded as an applied change.
- **Milestone 2** — command events map to explicit trace types; the command's
  own sequence is preserved in metadata while the LEDGER allocates global trace
  order. Rejections, checkpoints, approvals, and failures all stay inspectable.
  The adapter executes nothing.
- **Milestone 3** — capsule preparation, launch requested/verified/failed,
  authorized fallback, unauthorized fallback (as a `security` event), status
  changes, heartbeat, partial output, final report, completion claim, evidence
  links, and cost-receipt links. Which event type and trust level a launch
  produces is decided entirely by the capsule's identity state, so nothing can
  promote a failed or unauthorized launch into a verified one. Final reports
  and completion claims stay `claim`.
- **TraceReference** — converts a stored event into the Milestone 3
  `TraceReference` shape. Integrity is EARNED: a stored event alone is
  `trusted_source`; `verified` requires a full-chain verification that reached
  that event's sequence; an agent claim stays `unverified` regardless. Existing
  Milestone 1–3 modules are not modified.

## Cross-product boundaries (documented, NOT implemented)

- **Sunday Alcatraz** will record user intent, model and agent selection,
  routing rationale, retrieved knowledge references, claims, conflicting
  answers, verification routes, synthesis decisions.
- **Sunday Relay** records mission contracts, tasks, responsibilities,
  handoffs, commands, agent runs, reviews, repairs, approvals, evidence, and
  completion decisions — the only product emitting today.
- **Ophiuchus** will record workspaces, worktrees, branches, file edits,
  commands, tests, builds, commits, merges, rollbacks.
- **Aladiah** will record policy and identity findings, permission anomalies,
  unsafe actions, unsupported claims, compliance results, trace-integrity
  results.
- **Ship on Sunday** will reference PSP version, trace policy, evaluation
  suite, verified missions, economics profile, security history.

None of these adapters is live.

## Current limitations, stated plainly

- the repository is **in-memory and non-production**; no database persistence;
- there are **no digital signatures** — a future regulated-trace capability;
- **no production trace is written** anywhere, and no production attestation is
  created;
- only **Sunday Relay and manual** events are emitted.

## Future boundaries

- **Milestone 5 — Mission Economics**: cost receipts gain real amounts and
  aggregation; the `economics` block stops being all-null.
- **Milestone 6 — Mission Operations interface**: renders the trace timeline
  and the `AqualaTrace` summary. No UI ships here.
- **Milestone 8 — Adapter integration**: adapters emit real trace events from
  live runs.
- **Schema migration**: a versioned migration record, never a silent rewrite of
  stored events.
