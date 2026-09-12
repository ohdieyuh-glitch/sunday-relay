> **This PR targets Sunday Relay only.**
> **This PR must be squash-merged.**
> **Do not merge without founder authorization.**

Base SHA: `7982593526ffe9c86676991715201d84a096cfa2`
Head SHA: `03d79b92334be277d4d6f4053e11b944f278bc26`
Tree: `487a25f783ddddc60df994e554efdd8b48f25fb4`

## Relay Product Scope

Public-facing positioning only. The README is rewritten around the current
identity — **Julius 3.3**, i.Wonder Laboratories' Compound AI Agent, and
**Wonderland**, the platform it powers — replacing "Sunday Relay, a product of
Aquala Technologies", the Sunday Alcatraz positioning and the YC demo framing.

No Alcatraz/Fusion implementation is included. No source, no behaviour, no
dependency and no deployment config changed. `relay` remains exactly where it
is as a legacy implementation namespace (source tree, CLI command, npm scripts,
branch prefix, repository name); this PR explains it rather than renaming it.
No repository-name or `src/relay` namespace migration is begun here.

## Milestone / Capability

Brand and public-documentation truth cleanup. Sixteen sections: what Julius 3.3
is, the three persistent peer workers, Mission Contracts, Project Brain, the
continuous worker lifecycle, causal checkpoints and barriers, governed research,
verification/evidence/repair, repository execution, Wonderland, a PROVEN /
PRIVATE BETA / ROADMAP ledger, the source map, getting started, documentation,
contributing and provenance, licence.

## Website Impact

None. No UI file is touched.

## CLI Impact

None. No CLI source is touched. The README documents `relay <command>` as the
legacy command name and drops `npm run julius:harness:check` from its list of
offline drills, because that gate exits 1 on trusted main (verified by stashing
and re-running on a clean tree) and documenting a failing gate as a passing
drill would be untrue.

## Website/CLI Parity Impact

Unaffected — no capability changed. `npm run relay:surface-parity:check` and
`:strict` both PASS (42/51 website entry points reachable, unchanged).

## Mission Operations Impact

None functionally. Terminology only: the README uses **C.A.R.D.** as the
participant-facing configuration name and does not use PSP, matching
`docs/relay/CARD_SINGLE_SOURCE.md` ("C.A.R.D. is the only user-facing name;
`psp` survives as an internal wire name"). No wire name, route or identifier is
changed.

## Requested vs Actual Agent Identity

Requested and performed by a Claude Code session acting as the brand and public
documentation worker. Commits are authored **and** committed by
`julius-worker[bot]`, per the provenance route. No substitution.

## Files Changed

2 files changed, **+539 / −276**:

- `README.md` — full rewrite (+479 / −270)
- `docs/documentation-contract.test.ts` — two stale pins replaced, one check
  widened (+60 / −6)

## Tests

`npm test` — **10,378 passed, 0 failed**, 530 files passed, 3 skipped, 30 todo.
`docs/documentation-contract.test.ts` re-run after `npm run relay:build`:
**47 passed, 0 failed**.

## Typechecks

`npm run typecheck` — all four passes clean (app, bridge, hermes service, scripts).

## Builds

`npm run build` PASS · `npm run relay:build` PASS · `npm run relay:bridge:build`
PASS · `npm run relay:hermes:build` PASS.

## Security

No credential, token or secret appears in the diff.
`node scripts/relay-repository-boundary.mjs` PASS — it reads every tracked file
including this README for credential- and PSP-Agent-ID-shaped literals.

## External Calls

**None.** Documentation only. Nothing in this change can make a provider or
network call.

## Database / Migration Changes

None.

## Environment Changes

None.

## Deployment Changes

None. **The GitHub repository description is deliberately NOT part of this
squash** — it is repository metadata, and changing it before this lands would
make public metadata disagree with trusted main. It is updated immediately
after merge, once `julius:main-provenance` reads `provenant`.

## Independent Review

Not yet performed. The implementing session did not review its own work, and
the worker App will not approve or merge this pull request. Founder exact-head
approval is required and is a separate identity.

## Blocking Findings

None open.

Two stale documentation tests were changed rather than satisfied, with reasons
recorded in the test file itself:

1. `still positions Relay as an independent product` required the literal
   strings `Sunday Relay turns separate AI tools` and `Aquala Technologies`.
   That pin had become false, and it would have **failed the rewrite that made
   the README true** — the one change it should have permitted. Replaced by a
   pin on the current identity, plus the guard the old one could not be:
   retired branding must not return.
2. The doc-name existence check was widened from `docs/relay/` to `docs/`, so
   the engineering record can no longer be linked from the README and rot
   unnoticed.

## Rollback

`git revert` the squash. Nothing depends on it: no source, no schema, no
runtime behaviour. If the repository description was already updated, restore
the previous string:

> Relay is a customizable Compound AI Agent platform where AI agents build,
> verify, repair, ship, and launch real software live inside Wonderland, a
> persistent multiplayer world where projects, agents, GVEs, skills,
> competition, and repositories become living experiences.

## Founder Merge Authorization

- [ ] The founder has explicitly authorized this merge.

---

### Truth audits run on this head

- **Deprecated terms: zero.** Aquala, Aquala Technologies, Sunday Alcatraz,
  Alcatraz, Sunday Relay, Y Combinator, `\bYC\b`, `YC_`, `\bPSP\b`, Ship on
  Sunday, GVE, Harnessing Reviewer.
- **Legacy `relay` occurrences: 44 lines, 0 unclassified** — 27 LEGACY_PATH,
  13 LEGACY_COMMAND, 1 LEGACY_IDENTIFIER (`relay/*` branch namespace),
  3 HISTORICAL_PROVENANCE. No current-product use.
- **Links: 24, zero broken.** Doc names: 24, all resolve. npm scripts: 15, all real.
- **Status tiers assigned from evidence on this main**, not from intention.
  The repository-execution claim is scoped to the Julius repository-target
  provider — it has not performed a real customer-repository push, PR creation
  or merge — explicitly distinguished from this repository's own worker-App
  provenance pull requests, which are real.
- Replayed onto `79825935` (#256) rather than merged from an older base, and
  re-checked against it. The documentation table records the sixth blocker the
  zero-spend follow-up found one layer further out, added by #254.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01F1nvKxBqrE7Zbh7ydL5bYt
