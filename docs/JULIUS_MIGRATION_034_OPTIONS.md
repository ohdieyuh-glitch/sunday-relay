# Migration 034 ("Project Brain"): what it could be, and what each choice unblocks

**Status:** evidence for the founder and SECOND, who own 034's content. **Nothing here chooses it.**
- No migration is added, renumbered or applied by this document.
- `DATABASE_URL` stays parked.

## Why 034 is now on the critical path of both lanes

The founder's migration order is **031 → 032 → 033 social → 034 Project Brain → 035 voice**. The material order puts Decision C after 035: `#321 → 033 → 034 → 035 → C + corrected carry → freeze → four C runs → Alpha streak`.

- **034 has no specification anywhere.** Nothing on any branch goes past 029, the Project Brain's first migration, which landed in #309. No `relay/*project-brain*` branch adds a migration beyond 029.
- **035 (voice) is staged behind it by its own guard.** `docs/julius-migrations/035/035_wonderland_voice.sql` (#325) refuses unless 033 is applied **and** a `034_*` stamp is in the ledger (`migration_035_requires_034`). That makes applying 035 early impossible rather than discouraged.
- So **final R16's EOS voice** waits for 035, which waits for 034. Voice needs `voice_identities` and `voice_issuances` on the hosted store.
- And so **Decision C** waits too, by the material order: C comes after 035.
- **Feasibility is already proven.** With *any* `034_*` stamp in the ledger, 035 applies, and the voice store works on real PostgreSQL. `src/relay/persistence/wonderland-voice.real-postgres.test.ts` (#325) does exactly that with a test-only stamp, `034_test_placeholder_not_a_migration`, and also proves the guard refuses without one.

## What the Project Brain already has (029) and what its own design leaves open

029 adds only what had no home: what a person or companion **states** to a project.
- `project_brain_records`: the current version of each statement, guarded to move one version at a time.
- `project_brain_record_versions`, `project_brain_links` and `project_brain_mutations`: each append-only, by trigger.
- A `pg_notify` on every `events` insert, delivered on COMMIT.

Everything Julius already records (brain entries, criteria, findings, evidence, decisions, repairs, approvals, contracts, the trajectory, standings, context snapshots, sub-agents, events) *is* the Brain, read in place and never copied (`docs/relay/PROJECT_BRAIN.md` §1).

The design names its own open items:

| Item | Where | Priority | Needs a migration? |
|---|---|---|---|
| A prior mission's **UNRESOLVED findings** and a **summary of the project's mission history**, carried to later missions | §3 | P2 | Likely: a durable, typed project-level summary does not exist |
| Whether **ship results become Brain activity** (today a file-backed LLMOps memory, `brain-memory-node.ts` + `ship-brain-feed.ts`) | §8 | P2 | Yes if they become rows; no if the Brain only links what Julius already stores |
| Point the web workspace at `/project-brain` (today the demo adapter) | §8 | P2 | No (UI) |
| Battle lessons: remove the in-memory battle brain, or route its lessons into the canonical Brain | §8 | P3 | Possibly: a new record domain is a CHECK change |
| Retire the standalone `local/project-brain-*` designs | §8 | P3 | No |

## The options

| | 034 is… | It unblocks 035 and C | What it costs | Risk and interactions |
|---|---|---|---|---|
| **1** | **Project memory across missions** (§3, P2): a durable, typed, append-only project-level record of each finished mission. That means its outcome, criteria met, and UNRESOLVED findings with provenance, written at run completion and read by later missions under the existing context-integrity layer | when it lands | Larger: a table or two, a writer at completion, a reader in `brainEntriesForRun`, and the context packet's provenance rules. **It changes the context of every later mission in a project, a paid one included, so by §3's own rule it lands only with its own qualification** | **It interacts with Decision C.** C's canon carries only verified reviewer findings and accepted, in-force decisions; this would put UNRESOLVED findings into later missions' context through another channel. **On C's paid venue it is inert**: each paid job's database is fresh, and the carry export (#326) moves only the named run's reviewer findings and their `finding.*` rows, so nothing of this would travel. Anywhere a project's missions share a store, a WITH arm's packet would hold more than the carry. If chosen, C's registration should state that, or the channel should be off for C's missions |
| **2** | **Ship results as Brain activity** (§8, P2): a link or record per shipped run (commit, PR, deploy and verdict), so the Brain shows what was shipped from what was said | when it lands | Small to medium: one append-only table, or links in `project_brain_links` with no new table, plus a writer at the ship runner's end | **No context change if it is never fed to workers.** It decides the fate of the separate LLMOps memory, which is the P2 question itself |
| **3** | **Battle lessons in the canonical Brain** (§8, P3): a record domain for them, and the in-memory battle brain retired | when it lands | Small: widen a CHECK, write from the battle path | Wonderland battle code changes, and the battle backend is not on the R16 path |
| **4** | **A reserved stamp**: `034_project_brain_reserved` writes only its ledger row, so the number belongs to the Project Brain while its v2 content is designed and lands later (036 or after). Precedent: 027 is reserved by agreement | **at once**: 035's guard is satisfied, and C's place in the order is free | Tiny: one SQL file that stamps after checking 033, its chain registration, and the chain test | The canon's "034 Project Brain" becomes "034 reserved for the Project Brain". Project Brain v2 takes a later number. No schema changes, and nothing to roll back but a ledger row |
| **5** | **Re-order**: voice becomes 034, and the Project Brain takes the next number when it is specified | at once | Small but wide: 035's files, stamp, guard and runbook are renumbered, along with the readiness constants (`WONDERLAND_VOICE_STAMP`) and their tests | It changes the founder's order rather than honouring it. 033's own header comment records the order |

**Every option except 5 needs the same next step for voice:** 035 moves from `docs/julius-migrations/035/` into the chain after 034. Then the hosted-store procedure (#332) applies 034 and 035 to a store at 033 as "pending". That work is the same whichever 034 is chosen.

## What the founder and SECOND are asked

1. **Is there a concrete 034 already in mind?** If so, name its scope (options 1–3 are the design's own candidates, but the founder's intent may be something else). JUJU specifies, builds and rehearses it.
2. **If not, choose between 4 (reserve the number) and 5 (re-order).** Both unblock voice and C at once.
   - 4 keeps the founder's order and numbering.
   - 5 keeps no placeholder in the ledger.
3. **If option 1 is wanted at all**, decide its relation to Decision C before C's registration is frozen: off for C's missions, or stated in C's registration.

**JUJU's recommendation, for the founder to accept or not: option 4 now; option 1 or 2 as Project Brain v2 later, each with its own qualification.**
- Option 4 costs a ledger row, keeps the founder's order and number, and unblocks EOS voice (final R16) and Decision C (a potential +1.10, if fully earned) at once.
- Option 1 is the design's most valuable open item, and also the one that touches every later mission's context. That is exactly the change that should not ride in front of C's paid runs.

## Rollback

This document changes nothing. Each option's own change carries its rollback. Option 4's is deleting one ledger row on a store where nothing depends on it, before 035 is applied there.
