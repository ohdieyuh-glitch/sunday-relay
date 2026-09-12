# Julius: a live Coding Agent had no way to ask, so the continuous lifecycle could not start

## 1. The finding

The three-worker continuous lifecycle — checkpoints, guidance, governed
research, segment continuation — is complete in the domain and was
**unreachable in production**.

`driveContinuousLifecycle` runs only when a dispatch result carries
`guidanceRequest`, `guidance` or `researchAsks`. On trusted main `9f155b91`
those three strings appear nowhere in `relay-bridge`: no live adapter carried
any of them, and `segmentResume` likewise. The architect *can* answer a guidance
task; a guidance task is minted only from a coder's `guidanceRequest`; no coder
could make one. The loop had no way to start.

So on every paid mission so far the Coding Agent's only way to be stuck was to
finish anyway. And a mission granted research authority would have sealed a
policy that nothing could ever consult, because nothing could ask.

This was found while specifying the first continuous paid qualification, whose
whole shape is *ask rather than guess*. Buying that run against this main would
have bought a predictable failure.

## 2. Why the channel is a block of text

The Prompt Architect answers with one JSON object against a schema, so its
channels are fields — `contractProposal` and `guidance` already work that way.

The Coding Agent is an agentic session. It holds tools, edits files across many
turns, and its only structured return is the text of its final message. It
cannot create a file (`HOSTED_DISALLOWED_TOOLS` denies `Write`), and a channel
through the workspace would put the worker's request inside the candidate diff.
Its final message is what it has.

`src/relay/mission/julius/julius-worker-participation.ts` is the discipline for
reading one request out of one message: a marker on its own line, one JSON
object, a balanced-brace scan so trailing prose is harmless and no truncation
happens near it. That is the discipline the Agent Execution Report established;
the domain may not import a connector, so the scan is written again rather than
shared, and the two never need to agree — different markers, different
protocols, each held by its own cases.

## 3. The four properties that make it safe

**The transport decides nothing.** Every channel is handed on exactly as the
worker wrote it, typed `unknown`, for `sanitizeJuliusGuidanceRequest`,
`sanitizeJuliusResearchAsks` and `sanitizeJuliusSegmentState` to refuse. That is
the rule `contractProposal` already follows one function above, for the reason
its comment gives: an adapter that pre-cleaned a request would be deciding what
the domain is allowed to refuse, and a request refused before the pipeline saw
it leaves no `RESEARCH_ASK_UNREADABLE` row behind. A case sends
`researchAsks: 'please look this up'` through the real adapter and watches it
arrive unchanged.

**Ambiguity is refused, never resolved.** Two markers in one message is a worker
that said two things, and the later one does not win. An unrecognised key
refuses the whole block rather than being dropped beside the channels it came
with. A list wrapping the object is refused rather than having its first element
read. The one wrapper tolerated is a code fence, and it is named: a fence is
punctuation around the same one object, not a second reading of intent.

**An unreadable block never fails the dispatch.** The work is in the diff and
the tests have already run; failing a run over the shape of its closing message
would throw away what it paid for. The refusal lands on the diagnostics instead
— `participationRefusal`, from a closed vocabulary — and is exported.

**Unknown stays unknown.** A run whose runtime produced no final message gave
the worker nowhere to ask, so all six participation facts read `null`, not
`false`. "Did not ask" and "had no way to" are different facts, and one column
for both would erase the second.

## 4. What reaches the bundle

Six keys through `safeReviewDiagnostics` and six columns in
`worker-diagnostics.tsv`: `participation_present`, `participation_readable`,
`participation_refusal`, and one flag per channel. One flag per channel rather
than a joined list, held equal to `JULIUS_PARTICIPATION_CHANNELS` by test, so a
channel added without a column fails rather than exporting silently. The
completeness guard added by #254 is what makes that a rule rather than a habit.

No transcript, prompt, final text or provider body is among them, and a case
proves no fragment of the worker's own prose reaches a durable value.

## 5. How it is proven

**The domain module** — 32 cases over the marker discipline, every refusal, the
channels that cross untouched, and the protocol text. The protocol is built from
the constants the sanitizers actually use, and the cases read each bound *out of
the sentence it is in* rather than asking whether the text contains that digit
somewhere: `toContain('3')` is satisfied by the `300` in a different bound.

**The adapter seam** — through the real `createLiveHostedCodingAdapter`: the
prompt carries the protocol, a request crosses untouched, an unreadable one
neither fails the dispatch nor vanishes, a failed dispatch carries the same
facts a successful one does, and the worker's prose reaches nothing durable.

**Q8 of the zero-spend qualification** — the join, and the reason this is not
two halves asserted separately. The production composition
(`assembleLiveJuliusRuntime`, the production worker registrations) is driven
with the **real hosted coder adapter** wired in through the same `entries` the
other slots use; the only fake supplies the one thing a real session supplies,
the text of its final message. A question written there becomes a checkpoint, a
guidance task claimed and dispatched on the Prompt Architect, an answer issued
under the contract revision in force — and independently reviewed, which is what
makes it a unit of work rather than a side channel. A research ask written there
is governed by the mission policy and served by Live Reach. A coder that says
nothing starts nothing.

**Eighteen mutations, all killed.** Including: the repeated-marker refusal never
fires; an unknown channel is ignored; the object may be found anywhere after the
marker; the worker is never told the channel exists; the channels never reach
the pipeline; a run with no final message reports "did not ask"; the refusal
code is dropped from the allowlist; one column is missing from the bundle; and
five against the protocol text itself.

## 6. What this does NOT do

- **The architect and the reviewer still cannot ask.** Their outputs are strict
  schemas, and adding a channel there is a schema change with its own blast
  radius. Only the Coding Agent gains the channel here. A mission granting
  research to all three roles would therefore over-grant, and the grant it is
  written for should name `CODING_AGENT`.
- **It authorises nothing.** No research grant exists on this base, no contract
  declares a research clause, and every retrieval is still refused by the same
  gates for the same reasons. What changes is that a worker can now ask, and be
  refused on the record instead of silently.
- **It does not change what a worker may see.** The coder's packet, plan and
  contract brief are untouched; one section is appended to the charter telling
  it the channel exists.

## 7. Provenance

| | |
|---|---|
| branch | `relay/julius-coder-participation` |
| base | `9f155b919b0243e20fc3af132e9ea9176fd470ba` |
| head | `1519cae3d67febb2a45ddf7a5dca078d32567116` |
| tree | `e94857d87ef6ba8179ab6370e392cf259b24dff9` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

Full gate green on the frozen head: `npm test` 10,381 passing across 530 files,
0 failed; `typecheck`, `build`, `relay:build`, `relay:bridge:build`,
`relay-repository-boundary.mjs`, `relay-parity-gate.mjs`,
`relay:surface-parity:check:strict`, `relay:yc-demo:check`,
`relay:cli:contract-verify`, `git diff --check`, and the four drills
(`relay:persistence:contract-verify`, `relay:persistence:recovery-drill`,
`relay:workspace:verify`, `relay:claude:contract-verify`) all exit 0.
`julius:harness:check` reports OK.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01TqJcJuQiraGDnFnjA4gyUc
