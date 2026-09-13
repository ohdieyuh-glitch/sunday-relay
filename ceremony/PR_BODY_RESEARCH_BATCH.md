# Julius research batch: every refusal says why, anchored docs are fetched, every worker knows its research authority (plus the task-ID blocker repair)

Frozen candidate `relay/julius-research-batch`, 4 commit(s) over trusted main `2110e2c5`, authored and committed by `julius-worker[bot]`.

Supersedes #266. One critical blocker exception (commit 1) plus the founder's three-improvement research batch (commits 2–4).

This PR has four worker-authored commits on main 2110e2c5. The first is a critical blocker exception and is not one of the batch's three improvements. The other three are the research batch the founder set, and all four trace to paid qualification attempt 2.

Attempt 2 was GitHub run 34757974058. It was valid paid evidence: all three workers made real calls, 31 requests in total, about $2.71. The mission itself failed, at tick 13.

CRITICAL EXCEPTION: executor task-ID repair (commit 1)
- What was wrong: the second coder repair was `repair:repair:run:…:build:1:task:2:task`. Its tool-effect invocation id was 70 characters, and the executor composes `invocationId:dispatchGeneration:sandboxId` from it, which comes to 143. The executor's limit is 128, so it refused the envelope with `execution_envelope_invalid:executionIdentity`. The task died before a provider was asked. Task ids grow with every repair, so every mission that needs a second coder repair died the same way. This is what ended attempt 2.
- Fix: `executorInvocationId`. Ids that fit the derived 58-character bound are unchanged. Longer ids become a deterministic 128-bit SHA-256 form. The executor's limit is not raised, and the full task id stays bound in the durable row and in the signed request.
- Proof: the real executor client and shell port run against the real envelope validator. The paid run's exact old id is refused, and the new id is accepted for chains deeper than any mission allows. Three mutations are killed.

IMPROVEMENT 1: research refusal truth (commit 2)
- What was wrong: all four research asks were `policy_refused` within 6–13 ms, with an empty reason and no target. The mediator knew the reason, and the port dropped it.
- Fix: the durable research row carries four structured fields. The query string, fragment, path and the worker's stated purpose are never recorded.
  - Relay's refusal code
  - Live Reach's own refusal code
  - the requested source and capability
  - the requested host name, and nothing else of the URL
- Proof: every refusal path runs through the real mediator and port. The pipeline rows are checked, with leak tests for path, query and purpose. Eight mutations are killed.

IMPROVEMENT 2: authorized URL normalization (commit 3)
- What was wrong: a granted page cited with an anchor, such as `…/app-psql.html#section`, was refused as unauthorized. Live Reach's URL policy refuses any URL carrying a fragment. The refusal opens no socket and takes milliseconds, which matches all four of attempt 2's refusals.
- Fix: the fragment is dropped from the authorized fetch URL only. The query is kept, the host check is unchanged, and the observation keeps the worker's reference.
- Controls re-proven with an anchor: each still refuses exactly as before.
  - private address: a granted name resolving to 10.0.0.5
  - redirect to the metadata IP
  - plain http
  - inline credentials
  - loopback address
  - lookalike host
  - an allowed host that appears only inside the fragment
- Known residual, unchanged: a redirect whose Location header carries a fragment is still refused.

IMPROVEMENT 3: worker-visible research authority (commit 4)
- What was wrong: no worker was ever told what the mission grants. The prompts listed all nine sources and every capability, but not the contract's allowance. A worker asking for a host the mission never granted was refused without knowing why.
- Fix: `renderJuliusResearchAuthority` builds the text from the SEALED policy only. It is added to the Prompt Architect's instructions, the Coding Agent's prompt and the Reviewer's packet.
  - It names the granted source, capability and hosts (at most 12 per source, the rest counted), the host-matching rule and the role and mission budgets.
  - It tells each slot whether it may ask.
  - A mission with no grant says NONE.
  - A tampered policy renders as NONE and names no host.
  - The reviewer keeps its no-tools line.
- It grants nothing. Asks outside the grant get identical verdicts before and after the change, and the forbidden-field sanitizer is unchanged.
- The ask-field wording no longer contradicts a prompt that lists hosts.
- Proof: covered through resolveLiveWorkers and a real drive to COMPLETED. Twelve mutations are killed.

PROOF
- Each research improvement alone was proven on 709ec254. Improvement 2 alone and improvement 3 alone each needed a one-hunk resolution in a proof-only commit; those proof commits are not landed.
  - Improvement 1 alone: 619/620 tests.
  - Improvement 2 alone: 603/605.
  - Improvement 3 alone: 606/607.
  - Improvements 1+2: 629/630.
  - All three: 641/642.
  - Each position also passed typecheck of all 4 projects, the repository boundary scan and `git diff --check`.
- Frozen head, the critical fix plus all three improvements, checked independently: typecheck 0, boundary PASS, diff-check clean, and 658/659 across 14 research and qualification suites. The one failure is `julius-research-authority` 22, which fails the same way on clean main 2110e2c5 on the Windows host. There are no new failures.
- Semantics that change: anchored URLs on granted hosts are now fetched and charged, and prompts now state the existing research grant. The executor-identity and refusal-truth commits change records only.
- Migration or config: none.
- Rollback: revert the commit.

No provider, Docker daemon or database was contacted by these proofs.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
