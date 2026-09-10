# The test Julius must pass before private beta

**Question asked:** what test does Julius need to execute before it is deemed
ready for private beta?

**Answered:** 2026-09-10, against `origin/main` = `5be73c56` (#247).
**Method and provenance:** §10. Everything marked VERIFIED HERE was reproduced
in this checkout; everything marked TRANSCRIBED was read from a record and not
re-run, and is labelled as such at each use.

---

## 1. The answer

The test is the **Wonderland Beta Gate**, `scripts/wonderland-beta-gate.mjs`
(846 lines), aliased `relay:beta-gate` at `package.json:42`:

```
node scripts/wonderland-beta-gate.mjs --evidence <dir> [--capability <dir>] [--json]
```

It scores fifteen capabilities and its pass condition is absolute. There is no
threshold flag, no severity weighting and no exemption mechanism anywhere in the
file (`scripts/wonderland-beta-gate.mjs:843`):

```js
return report.results.every((row) => row.verdict === 'PASS' || row.verdict === 'CAPABILITY PROVEN') ? 0 : 1;
```

Its own header states the contract (`:78-79`): *"Exit 0 only when every
capability is PASS or CAPABILITY PROVEN. Anything else exits 1, which is the
honest answer to 'are we ready for beta'."*

## 2. Running the gate is not the task

The gate is a scorer. It reads evidence it cannot itself generate, and it says
so (`:60-66`):

> No verdict above FAIL is reachable from repository state. Mission proof needs
> a LIVE MISSION EVIDENCE BUNDLE — the artifact
> `.github/workflows/julius-first-live-mission.yml` uploads, downloaded with
> `gh run download <id>`. Capability proof needs a drill that RAN, and the
> source of a drill sitting in the tree is not that. Run this gate against a
> fully built, fully green repository and every runtime row reads FAIL,
> structurally.

VERIFIED HERE: run bare at `5be73c56` it prints fifteen rows — fourteen `FAIL`,
one `NOT BUILT` — and returns exit 1. A green repository scores nothing.

So **three** things must execute, in dependency order:

1. **A paid live mission.** `.github/workflows/julius-first-live-mission.yml`,
   `workflow_dispatch`, with `confirm_live` typed exactly `RUN LIVE MISSION`
   (`:33`, gated at `:273` and `:321`). It must reach `COMPLETED`, and it
   uploads the `julius-live-evidence` bundle.
2. **Three capability drills.** Run post-mission inside that same workflow
   (`:750-754`, `for drill in recovery-drill failure-recovery-drill
   repair-loop-drill`), their merged ledger and transcripts copied into the
   bundle at `:758-760`. The three drill scripts are the only ones that write a
   capability attestation: `scripts/julius-recovery-drill.ts:332`,
   `scripts/julius-failure-recovery-drill.ts:163`,
   `scripts/julius-repair-loop-drill.ts:91`.
3. **The gate**, pointed at the downloaded bundle.

## 3. Two axes, four verdicts, and the eight rows a drill cannot reach

The gate keeps two questions apart because collapsing them is how a readiness
document starts lying (`:5-14`): **mission proof** ("did the mission whose
bundle this is exercise the behaviour, and did it work") and **capability
proof** ("was it proven by an authoritative drill that drove the real production
path"). The rationale is at `:16-23`: a flawless mission never crashes, so it
never exercises recovery; a gate with one boolean would have to either call
recovery unproven, which is false, or demand a healthy paid run crash on purpose.

| Verdict | Meaning |
|---|---|
| `NOT BUILT` | No production implementation exists. The probe looked for named files and did not find them. |
| `FAIL` | An implementation exists and nothing shows it works. "We have the code" is not a pass; neither is a green unit test. |
| `CAPABILITY PROVEN` | This run did not exercise it; a recorded drill did, against the real production path, and the code it drove has not changed since. |
| `PASS` | This run exercised it and it worked. |

Three rules keep the third verdict from becoming a laundry (`:42-64`): a failed
mission is never rescued by a drill; mission-required capabilities admit no
capability proof at all; and an attestation is admissible only if it names the
production files it drove, their digests still match, they cover the very probe
the row is built on, and the transcript is present with every step passing. A
drill gone stale against the code it proved reports `CAPABILITY STALE` and
passes nothing.

**Eight of the fifteen carry `missionRequired: true`** and cannot be drilled
past — `:763`, `const admissible = !capability.missionRequired;`

| Row | Line | Mission-required |
|---|---|---|
| ACCOUNT / ONBOARDING | 369 | no |
| PROJECT CREATION | 385 | **yes** |
| JULIUS MISSION START | 397 | **yes** |
| PROMPT ARCHITECT | 408 | **yes** |
| CODING AGENT | 420 | **yes** |
| TASK CONTRACT LOCK | 448 | **yes** |
| INDEPENDENT REVIEWER | 517 | **yes** |
| REPAIR LOOP | 548 | no |
| VERIFICATION | 560 | **yes** |
| VERIFIED COMPLETION | 570 | **yes** |
| WONDER WEB OUTPUT | 581 | no |
| PROJECT BRAIN PERSISTENCE | 608 | no |
| RESTART / RECOVERY | 652 | no |
| FAILURE RECOVERY | 671 | no |
| PERMISSIONS / MISSION BOUNDARIES | 687 | no |

No drill makes a mission that never completed into one that did.

## 4. Exit 0 is unreachable at this commit, and not because of Julius

**`WONDER WEB OUTPUT` is `NOT BUILT`.** Its probe accepts any of three modules
(`:581-582`): `src/relay/mission/wonder-web/index.ts`,
`src/relay/ui/wonder-web/index.ts`, `relay-bridge/wonder-web/index.ts`.

VERIFIED HERE: none of the three exists on disk; `git ls-files | grep -i
wonder-web` returns nothing; and the string `wonder-web` appears in **exactly
one file in the entire tree — the gate itself**. The probe sets `built` from
whether any named file was found, and the row short-circuits to `NOT BUILT`
*before* `prove()` or any attestation is consulted, so it is unreachable on
both axes at once.

The gate's own test already records this as the known ceiling:
`scripts/wonderland-beta-gate.test.ts:278` is titled *"every capability that is
built can be reached: one good run passes all fourteen"*, and `:335` asserts the
sole remaining gap is `['WONDER WEB OUTPUT']`.

Closing it needs two things a mission cannot supply on its own: one of those
modules built, **and** a `wonder-web.tsv` in the bundle with at least one opened
output. VERIFIED HERE: `.github/julius-live-evidence-dump.sh` writes
`project-brain.tsv` (`:129`), `sessions.tsv` (`:130`) and `task-contracts.tsv`
(`:143`), and no `wonder-web.tsv`.

**`ACCOUNT / ONBOARDING` is unearnable with the current fixtures.** The gate
flips the row only for a `player_id` outside `{'tenant','operator'}` (`:348`,
`:378-382`). VERIFIED HERE: all four mission contracts declare `"tenantId":
"tenant"` at line 5 —
`.github/julius-missions/{julius-first-live,julius-live-mission-2,julius-live-mission-3,julius-live-mission-4}/contract.json`
— and `relay-bridge/julius/mission-seed.ts:61` writes `seed.tenantId` straight
into `execution_sessions.player_id`.

This one is a **fixture fact, not a gate property**. The row is
`missionRequired: false`, so a fourth drill is admissible, and the gate's own
ideal-bundle test passes the row with `player:ada`. No such drill exists.

## 5. The ceiling

TRANSCRIBED from `docs/handoffs/JULIUS_CURRENT.md:1262-1265` — the score a
successful paid mission can actually reach:

| Mission quality | Score |
|---|---|
| flawless (no rejection, no retry, no crash) | 10/15 |
| with a rejected review and a repair round | 11/15 |
| plus one transient provider failure that retried and succeeded | 12/15 |
| plus a crash whose lease was reclaimed | **13/15 — the ceiling** |

The record states this ceiling holds *"until Wonder Web is built and a real
account starts a mission"*. §00l of that document exists precisely so that a
paid run coming back at 11/15 is not mistaken for a failure.

## 6. Where it stands: Unknown, and that is the finding

**No gate score exists for the current main, and none exists for the one
mission that actually completed.**

TRANSCRIBED readings, all hand-run and recorded in
`docs/handoffs/JULIUS_CURRENT.md`:

| Reading | Bundle | Cite | Note |
|---|---|---|---|
| 0/15 | none | `:764` | correct answer with no evidence |
| 3/15, exit 1 | run `34186711214` | `:301` | that run FAILED at the Prompt Architect |
| 7/14 | run `34037313976` | `:1989` | a **14-row** gate; not comparable to /15 |
| 11/15 | run `34306850331` | §00r, `:2598` | read on a landing candidate branch, not main |
| 6/15 | run `34311556047` | §00r, `:2598` | same |

The two most recent paid runs have **no gate reading at all**:

- **Live Run 3** (`34414726976`) reached `COMPLETED` after 4 ticks on trusted
  main `4ce61f98` (`docs/JULIUS_PAID_RUN_34414726976_LIVE_RUN_3.md:21,27`).
  VERIFIED HERE: `grep -i 'beta\|gate'` over that 285-line record returns zero
  hits. Nobody scored the one mission that finished.
- **Mission 4, attempt one** (`34459684814`, 2026-09-10) failed after 1 tick on
  `WORKER_EXECUTION_FAILURE` / `incomplete_response`, $0.30 reserved and never
  settled (TRANSCRIBED, handoff `:2976-3000`).

**The gate gates nothing.** VERIFIED HERE: the only reference under `.github/`
is `julius-real-infra.yml:336`, which imports `evaluate` and calls it with
evidence deliberately `null`, checking three rows. No merge and no deploy can
fail on the fifteen-row exit code. It is a manual instrument an operator must
point at a downloaded bundle, and the repository records no instance of that
having been done against current main.

## 7. The critical path to exit 0

Ordered. **[F]** marks founder-only — money, credentials, or approval.

1. **Build Wonder Web** — one of the three named modules. Hard blocker; until
   it exists no mission, however perfect, can move the exit code.
2. **Emit `wonder-web.tsv`** from `.github/julius-live-evidence-dump.sh`, one
   row per mission output opened.
3. **Close `ACCOUNT / ONBOARDING`** — either a fourth drill attesting it, or a
   real non-operator account that starts a mission. **[F]** on the honest route.
4. **Diagnose the architect failure** that killed Mission 4's first attempt.
   Commit `5be73c56`'s own message states capacity exhaustion *"remains the
   LEADING HYPOTHESIS and is not demonstrated."*
5. **Dispatch the paid mission** **[F]** — `confirm_live: RUN LIVE MISSION`,
   plus `acknowledge_rerun: RERUN PAID MISSION` (`:37`) because attempt one
   already wrote the marker. Requires the live-validation credentials **[F]**.
6. **The mission must reach `COMPLETED`** and exercise a real repair round —
   otherwise `REPAIR LOOP` depends on a drill, and the reviewer row passes
   without the reviewer ever having rejected anything (§9).
7. **Download the bundle** (`gh run download <id>`) and run the gate.
8. **A fresh independent Critical/High security review** **[F]** — a written
   precondition at `docs/JULIUS_BETA_READINESS.md:60` (*"Beta requires zero open
   Critical or High findings"*) that the gate does not score at all.

## 8. Where the repository's documents disagree

- **`docs/JULIUS_BETA_READINESS.md` is not a current status source.** Its header
  at line 3 still reads *"Assessment date: 2026-08-30 UTC… Base reviewed: PR
  #202 / current main `96451fc0`"*, roughly 45 merged PRs behind. It describes a
  different instrument entirely — a seven-state `ABSENT`→`BETA_READY` matrix —
  and never mentions the gate. Its matrix rows *"First real Julius mission |
  ABSENT"* (`:34`) and *"Beta eval pack | ABSENT"* (`:37`) are superseded by
  Live Run 3. Its blockers 5 (a mission-exercised repair) and 6 (the security
  review) still stand.
- **`docs/handoffs/JULIUS_CURRENT.md:1619` asserts the gate does not exist on
  main.** It landed in `8e4b21d0` (#238, 2026-09-09). That line is now false.
- **The 3/15 table's "no dump" category** (`:314`) is the author's label, not a
  gate verdict; `verdictOf` has no such state and those rows print `FAIL`.
- **The 3/15 run's "trusted main writes none of the three TSVs" explanation**
  (`:317-321`) is stale: main's dump now writes all three (`55f3068d`, #244).

## 9. What this research did not establish

Stated as Unknown rather than inferred, per this repository's own rule.

- **The gate score for Live Run 3 or Mission 4.** Both bundles exist only as
  GitHub Actions artifacts, not reachable from this checkout. Live Run 3's would
  plausibly be high — it locked contract revision 2 and completed — but nothing
  confirms it, and putting a number here would be inventing one.
- **Any plan, stub, design note, issue or owner for Wonder Web.** Its size and
  schedule are Unknown. It is the hard blocker and the repository says nothing
  about it beyond the gate's three candidate paths.
- **Any founder decision that a score below 15/15 constitutes readiness.** The
  analogous question was raised for `RESTART / RECOVERY` (`:1274-1283`) and
  explicitly deferred as *"a product decision"*. Because 15/15 is unreachable
  while Wonder Web is unbuilt, someone must either build it or rule that 13/15
  ships. That ruling does not exist.
- **Whether "private beta" is a bar distinct from this gate.** `grep -rn -i
  'private beta'` hits only unrelated Relay surfaces. The two were treated as
  the same bar because no other candidate exists; that mapping could not be
  confirmed from any document.
- **Reviewer catching power.** Live Run 3's own qualification 2 records that the
  reviewer *"never had a defect in front of it"*. `INDEPENDENT REVIEWER` can
  read `PASS` on a run where nothing was ever rejected. The gate does not
  distinguish these, and no document claims it should.
- **Whether Live Run 3's bundle carried drill attestations, and whether they
  would still be admissible.** Its provenance section names "26 files" without
  enumerating them. If it did carry them, at least one would now be
  `CAPABILITY STALE`: `1fded10d` (#243) edited `julius-execution-coordinator.ts`
  after Live Run 3's commit `4ce61f98`, and that file appears in `FAILURE
  RECOVERY`'s probe. Not verified.
- **`docs/JULIUS_BETA_READINESS.md` blockers 1–3** (`:55-57`) were not dated
  against merged PRs. Their state is Unknown here, not closed.

## 10. Method and provenance

Five parallel investigators over distinct angles (the gate mechanism, the
recorded scores, the ceiling, the latest paid runs, and the rival definitions of
readiness), then three adversarial verifiers voting on every claim under
distinct lenses — literal truth against the cited file, currency against
`5be73c56`, and whether the claim actually gates beta. Thirty distinct claims
after dedup; twenty-five survived, five were refuted by two or more lenses and
are not repeated here as fact.

Verified independently in this checkout afterwards, not taken from any agent:
the gate executed and its fifteen rows and exit code observed; the three Wonder
Web paths confirmed absent, in the working tree and in `git ls-files`; the test
assertions at `:278` and `:335`; the `tenantId` value in all four mission
contracts and its path into `player_id`; the CI wiring; the drill loop in the
live-mission workflow; and the TSVs the evidence dump actually writes.

Scores in §6 are transcribed from `docs/handoffs/JULIUS_CURRENT.md` and were not
reproduced — no evidence bundle is tracked in this checkout. No drill, no
mission and no full `npm test` was run.
