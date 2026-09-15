# Project Brain ↔ Formal lane: the archive export

**For the Formal lane. As of 2026-09-15.** From the Project Brain lane (local
branch `local/project-brain-python`, not landed).

## In short

1. **The physical shape changed under the `julius-paid-run-archive.v1` label.**
   That is fine, and **no redesign of the archive is asked for**. It does mean
   the label cannot tell a reader what shape it holds.
2. **Before live integration, the Formal lane provides — or freezes — an
   exporter that emits `julius-paid-run-archive-export.v1`**: typed JSON, with
   explicit nulls. Project Brain reads that document and nothing else. It never
   reads the archive's tables.
3. **Historical attempts may truthfully export Unknown.** Where the archive
   never recorded a fact, the export says Unknown, and the import keeps it
   Unknown. Nothing is back-filled by inference.

## What changed under the label

Read-only, from the local `julius_archive` database (five attempts), by the
shape-drift diagnostic:

| Dump | Columns, in run order |
|---|---|
| `research.tsv` | 17 (34753589938/1, 34757974058/1) → 21 (34766115321/1, 34774471909/1) → 34 (34995797200/1) |
| `worker-diagnostics.tsv` | 86 (34753589938/1) → 87 (34757974058/1, 34766115321/1) → 90 (34774471909/1, 34995797200/1) |
| `participation.tsv` | 23 (first four) → 28 (34995797200/1) |

Every change so far adds columns; none removes one. Every run carries the same
`archive_version`.

The archive also records, truthfully, that its dumps cannot tell NULL from an
empty string (`psql -A -F tab`). Across the five attempts that leaves
**11,036 cells ambiguous**.

To see it yourself (read-only; every query runs inside
`BEGIN TRANSACTION READ ONLY` and is rolled back):

```
JULIUS_ARCHIVE_CONTAINER=julius-postgres npm run julius:archive:shape-drift -- --known scripts/julius-archive-known-shapes.json
```

Its first line is always `COMPATIBILITY: NOT ESTABLISHED`. A matching shape is
not a contract; only a conforming export is.

## What the exporter must produce

One JSON document per workflow attempt: `julius-paid-run-archive-export.v1`.
The contract is `src/relay/mission/julius/julius-brain-archive-import.ts`. The
sections and their fields are tabled in `docs/JULIUS_PROJECT_BRAIN_V2.md`
("The contract").

- **Identity is the workflow run and attempt.** The Julius run id is provenance
  only.
- **No empty strings.** A field is a value, or null.
- **Every null is explained.** A nullable field that was not recorded is null
  **and** named in that item's `unknown` list. A null not listed means
  "recorded as absent". A list recorded as empty is `[]`; an unrecorded list is
  null and listed.
- **ISO timestamps.**
- **`accounting`** states the run's cost totals; they must equal what the usage
  items sum to.
- **Integrity:** the exporter seals the document
  (`sealJuliusPaidRunArchiveExport`, or the same canonical-JSON SHA-256 hashes
  computed on its side).

**Refused at the boundary, with the location of each error:**
- another format, or another version of this one;
- missing, extra, mistyped or empty fields;
- a malformed `unknown` list;
- a hash that does not match;
- duplicate ids, references that do not resolve, or a reference to another
  workflow run or attempt;
- cost that does not add up, or a reported basis without an amount;
- an outcome contradicted by the run's own ending event, a run ending before it
  starts, a refused request that records delivered bytes;
- credential-shaped content.

**Accepted, and flagged:** an evidence type no runtime vocabulary names. It is
imported as an observation with its source type kept.

## The ambiguous cells

For a cell the archive cannot resolve, the exporter decides from what it
actually knows, and never guesses:

- **Where the original source can be re-read** with NULL rendered distinctly,
  export what it says.
- **Where the column's type excludes an empty string** (a number, a timestamp,
  a boolean), the cell was NULL. Whether that NULL means "recorded as absent"
  or "Unknown" is the column's own semantics: decide it once per column, and
  write the decision down.
- **Otherwise**, export null and list the field as Unknown.

## Proving an export before anyone imports it

The conformance kit reads only the document, so it runs on the Formal lane's
side:

```
npm run julius:archive:conformance -- <export.json> [--artifact <artifactId>=<file>]... --cases
```

- **Verdict:** CONFORMANT, NOT_CONFORMANT, UNSUPPORTED_VERSION or NOT_AN_EXPORT,
  with categorised findings.
- **Artifact bytes:** checked against their digests when supplied.
- **`--cases`:** applies 33 catalogued cases to *your* export and checks each
  outcome: 31 corruptions that must be refused, and 2 unusual but valid values
  that must be accepted. That proves the checks bite on real output, not only
  on Project Brain's fixture.
- **`--self-test`** does the same on the built-in fixture.
- **Exit codes:** 0 conformant, 1 not, 2 unreadable.

## What Project Brain commits to on its side

- **It reads only the export.** Never the archive's tables, and never its label.
- **Every attempt is judged against what the live run already recorded:**
  - an attempt the live run preserved is refused;
  - a partially preserved one is reconciled without duplicating any fact;
  - one never preserved is reconstructed.
- **A history that contradicts the live run is refused, never merged.** That
  covers mission, accepted main, Julius run, seal count, an unlisted entry, and
  the same entry id with a different kind or task.
- **Unknown stays Unknown**, through import and in every later view.
- **Retention is not retrieval.** An imported attempt is visible to a later run
  only under the state mode that run declared.

## Asked of the Formal lane

1. Say when the exporter exists, or when the archive is frozen and against
   which shape.
2. Run the conformance kit with `--cases` on at least one export per archived
   shape.
3. Write down the per-column decision for ambiguous cells.

Nothing else is asked. Not a table change, not a new column, and not a
re-run of any paid attempt.
