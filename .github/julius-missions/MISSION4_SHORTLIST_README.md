# Diagnostic mission 4: SHORTLIST (three candidates, none registered)

Drafted by SECOND JULIUS in worktree `work\m4` (base dda2ed37). Unscored, lab, effort high. Every defect was found by READING production Relay code (surveyed by three
read-only agents plus my own reading, each repro re-run by me against the checkout). Nothing is planted. None touches capture, redaction, secrets, path containment or
the modules used by diagnostics 1-3. NOT registered in MISSION_LIMITS or the gate table: that is a later step once a candidate is chosen.

Each candidate directory holds `contract.json`, `slice.txt`, `seed/<spec>.test.ts`, `dryrun/` (reference fixes, `scenarios.txt`, the generic `dryrun.sh`).
Dry run (zero spend, light): `bash .github/julius-missions/<dir>/dryrun/dryrun.sh`. Each result below is a real run.

| Candidate | Directory | Defects | Run-time closure | Dry run |
|---|---|---|---|---|
| A usage | julius-diag-usage-1 | A1 `deriveUsageThresholdEvents` forgets a section's latch keys on an unknown reading and re-notifies; A2 `projectUsageBar` returns tone `idle` when only the weekly window is known and full | 3 files | unfixed fails 5/8, A alone fails, B alone fails, both pass 8/8 |
| B architect | julius-diag-architect-1 | B1 `buildArchitectContext` dedupe keeps the first block, so an optional duplicate evicts a REQUIRED block; B2 `validateArchitectPlan` never checks elements of 4 arrays (null throws, string becomes a blank non-blocking entry) | 2 files | unfixed fails 5/9, each alone fails, both pass 9/9 |
| C digest+evidence | julius-diag-digest-evidence-1 | C1 `sha256Hex` UTF-8 encoder mishandles unpaired surrogates (oracle: node:crypto); C2 `evidenceAge` tests "future" after rounding, so up to 30 s ahead is `live` | 2 files | unfixed fails 5/8, each alone fails, both pass 8/8 |

Known ambiguities, stated so the satisfiability review can attack them:
- B: `prompt-architect-context.ts` also holds redaction helpers (untouched, named read-only). Requirement A states WHICH copy is kept on a collision (the required one) so a
  "promote the first copy" fix is a legitimate reading only if it also keeps the required text; the spec asserts the required text.
- B2: arrays as elements are refused by the requirement (non-array object) but the spec does not test arrays; that wider invariant is a criterion.
- C1: lone surrogate -> U+FFFD is TextEncoder/Node behaviour, stated in the requirement. C2 sub-minute boundary: the spec pins any amount of future as unknown.
- A1: which keys belong to a section is stated (leading segment).

Survey leftovers that I did NOT use (real but weaker or out of rules): usage-bar/gauntlet double count of round usage (async, store double, 3+ files), command-dependencies
reassign omits dependents, shared-lock/duplicate-work superseded filter, loop-completion `onlyTrustIsMissing`, project-brain withdrawn-review deletion, ship-stage rollback
ordering, panelBox widths. Repros are in `%TEMP%\survey1..3`.
