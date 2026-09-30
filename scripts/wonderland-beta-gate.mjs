#!/usr/bin/env node
/**
 * THE WONDERLAND BETA GATE.
 *
 * Sixteen capabilities. The gate answers TWO questions about each of them, and
 * keeps the answers apart, because collapsing them is how a readiness document
 * starts lying:
 *
 *   1. WHAT DID THIS RUN PROVE?   — MISSION PROOF. Did the mission whose
 *      evidence bundle this is actually exercise the behaviour, and did it
 *      work? Read only from that run's durable rows.
 *   2. WHAT IS JULIUS READY TO DO? — CAPABILITY PROOF. Was the behaviour
 *      proven by an authoritative drill that drove the real production path?
 *      Read only from a recorded drill attestation.
 *
 * WHY BOTH. A flawless mission never crashes, so it never exercises recovery.
 * A gate with one boolean must then either report recovery as unproven — which
 * is false, the drill proves it — or demand that a healthy paid run crash on
 * purpose to score a point, which is worse. Neither is acceptable, so the row
 * says the true thing: CAPABILITY PROVEN, NOT EXERCISED THIS MISSION. The
 * mission axis stays intact underneath, so a run that DID crash and recover is
 * still reported as having done so, and is still distinguishable from one that
 * did not.
 *
 * THE FOUR VERDICTS, stated so none can be misread:
 *
 *   NOT BUILT          No production implementation exists in this repository.
 *                      The probe looked for named files and did not find them.
 *   FAIL               An implementation exists and nothing shows it works:
 *                      this run did not exercise it (or exercised it and it
 *                      broke, or cannot say), and no authoritative drill may
 *                      stand in for it either. "We have the code" is not a pass
 *                      at a beta gate; neither is a green unit test.
 *   CAPABILITY PROVEN  This run's readable rows show it GENUINELY did not reach
 *                      the behaviour, and a recorded drill did, against the real
 *                      production path, and nothing that drill drove has changed
 *                      since. Never available where the mission itself must walk
 *                      the capability (see MISSION-REQUIRED).
 *   PASS               This run exercised it, it worked, and the run is bound to
 *                      this checkout. Mission proof is the strongest answer and
 *                      needs no drill.
 *
 * SIX RULES KEEP THE VERDICTS FROM BECOMING A LAUNDRY:
 *
 *   A FAILED MISSION IS NEVER RESCUED. If the run exercised the capability and
 *   it broke, the verdict is FAIL whatever any drill says. A drill proves the
 *   path works; it cannot un-break what this run did.
 *
 *   MISSION-REQUIRED CAPABILITIES CANNOT BE DRILLED PAST. The nine a mission
 *   must itself walk and account for — creation, start, plan, build, contract
 *   lock, review, verification, completion, settlement — admit no capability
 *   proof at all. No drill makes a mission that never completed into one that
 *   did.
 *
 *   A DRILL STANDS IN ONLY FOR WHAT GENUINELY DID NOT HAPPEN. NOT EXERCISED is
 *   a claim the run's readable rows must support: no REPAIR decision, no
 *   retryable failure, no recovery action. A bundle that cannot say (UNKNOWN)
 *   is never rescued, because "nobody could look" is not "nothing happened".
 *
 *   A BUNDLE PROVES NOTHING ABOUT CODE IT DID NOT RUN. Its `bundle-manifest.txt`
 *   must name the commit this checkout is at, `mode=paid`, and the one Julius
 *   run it is about; every table is then scoped to that run. A bundle that
 *   cannot be bound keeps its FAILURES and loses everything else to UNKNOWN.
 *
 *   A ROLE IS CREDITED ONLY FOR WORK A REAL PROVIDER DID. The architect, the
 *   coder and the reviewer (and so a verified completion, and a repair) pass
 *   only on a worker-diagnostics row naming a real transport, provider and
 *   served model — and a response id where the role has one. A drill's
 *   scripted provider, a fake or a stub reads NOT A REAL PROVIDER; a missing
 *   identity reads UNKNOWN.
 *
 *   A CAPABILITY PROOF IS EVIDENCE, NOT AN ASSERTION. It is admissible only if
 *   a drill attestation names EVERY file the drill drives (read from the tree,
 *   `julius-drill-closure.mjs`) AND their content digests still match this
 *   repository AND those files include the very probe this row is built on AND
 *   the drill's own transcript is present with every declared step passing. A
 *   drill that has gone stale against the code it drove reports CAPABILITY
 *   STALE and passes nothing.
 *
 * WHY IT CANNOT FLATTER ITSELF. No verdict above FAIL is reachable from
 * repository state. Mission proof needs a LIVE MISSION EVIDENCE BUNDLE — the
 * artifact `.github/workflows/julius-first-live-mission.yml` uploads,
 * downloaded with `gh run download <id>`. Capability proof needs a drill that
 * RAN, and the source of a drill sitting in the tree is not that. Run this gate
 * against a fully built, fully green repository and every runtime row reads
 * FAIL, structurally.
 *
 * REPEATABLE, AND POINTABLE AT ANY RUN:
 *
 *   node scripts/wonderland-beta-gate.mjs
 *   node scripts/wonderland-beta-gate.mjs --evidence <dir> [--capability <dir>] [--json]
 *
 * where <dir> is a downloaded run artifact directory (the gate finds the
 * `julius-live-evidence` folder inside it, or accepts that folder directly),
 * and --capability points at a directory holding `capability-proofs.tsv` and
 * its transcripts when they did not travel inside the bundle. Read a bundle at
 * the commit it was produced at: anywhere else it is UNBOUND.
 *
 * Exit 0 only when every capability is PASS or CAPABILITY PROVEN. Anything
 * else exits 1, which is the honest answer to "are we ready for beta".
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JULIUS_CAPABILITY_DRILLS, capabilityDrill, drillDrivenFiles } from './julius-drill-closure.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : null;
};

/* ------------------------------------------------------ repository probes */

/** The files a capability is implemented by. A test file is never one of them. */
const present = (relativePath) => existsSync(join(REPO, relativePath));

/**
 * Built = every named production file is present, or — for a capability with
 * no implementation yet — ANY of the named candidates is.
 *
 * A `build` that returns a hard-coded `false` is not a probe, it is a verdict
 * someone typed: it cannot notice the day the thing gets written. Naming the
 * candidate locations instead means the row flips on its own AND tells whoever
 * builds it where this gate will look.
 */
function probe(capability) {
  if (capability.anyOf !== undefined) {
    const found = capability.anyOf.filter(present);
    return {
      built: found.length > 0,
      files: found,
      where: found.length > 0 ? found.join(', ') : `none of: ${capability.anyOf.join(', ')}`,
    };
  }
  const missing = capability.files.filter((path) => !present(path));
  return {
    built: missing.length === 0,
    files: capability.files,
    where: missing.length === 0 ? capability.files.join(', ') : `missing: ${missing.join(', ')}`,
  };
}

/* --------------------------------------------------------- evidence bundle */

/**
 * READS A REAL RUN, OR ADMITS IT HAS NONE.
 *
 * Every accessor answers `null` for "this bundle does not say", never a
 * default. A capability that reads `null` cannot pass, which is the same rule
 * the product applies to its own Unknown values.
 */
function loadEvidence(dir) {
  const empty = { present: false, source: null, root: null, file: () => null, rows: () => [], header: () => null };
  if (dir === null || dir === undefined) return empty;
  let root = resolve(dir);
  if (!existsSync(root)) return { ...empty, source: `absent: ${root}` };
  if (!existsSync(join(root, 'runs.tsv'))) {
    // Accept the parent directory `gh run download` produces.
    const nested = readdirSync(root)
      .map((entry) => join(root, entry))
      .filter((entry) => statSync(entry).isDirectory() && existsSync(join(entry, 'runs.tsv')));
    if (nested.length !== 1) return { ...empty, source: `no julius-live-evidence bundle under ${root}` };
    root = nested[0];
  }
  return { present: true, source: root, root, ...readers(root, { dumped: true }) };
}

/**
 * `null` MEANS THE BUNDLE DOES NOT SAY, and there are three ways a file can
 * not say while looking as though it does.
 *
 * `julius-live-evidence-dump.sh` writes the literal `unavailable` into a file
 * whose query it could not run — that is how free dry runs #1 and #2 shipped
 * an `evidence.tsv` reading `unavailable` after naming a column the migrations
 * never created. Read as text it is a one-line file, and a one-line file has
 * no rows, so a table that could not be READ would arrive here as a table that
 * was EMPTY. An empty Project Brain and an unreadable one are opposite facts,
 * and reporting the first for the second is exactly the substitution this
 * product exists to refuse.
 *
 * ZERO BYTES IS NOT EMPTY. `dump` redirects psql into the file before psql has
 * said anything, so a dump killed at that moment (a cancelled job, a full disk,
 * a runner torn down) leaves a file of zero bytes, and so does a listing whose
 * command failed behind `|| true`. It used to read as a table with no rows: a
 * zero-byte `settlement-integrity.tsv` read SETTLEMENT INTEGRITY PASS, a
 * zero-byte `failures.tsv` read the three drill rows NOT EXERCISED (so a drill
 * stood in) and PERMISSIONS PASS. A file that holds nothing — zero bytes, or
 * only whitespace — is UNREADABLE, never empty.
 *
 * AND A TABLE IS EMPTY ONLY WHEN THE DUMP SAYS SO. psql ends every result it
 * finishes writing with its own footer, `(N rows)`, and writes it last, so the
 * footer is the dump's statement that the table is complete and how many rows
 * it holds. The rule, for every table the dump writes (`dumped`):
 *
 *   header, rows, `(N rows)`   read, when it holds at least N rows. A cell of
 *                              free text can carry a newline, which only ever
 *                              adds lines; fewer rows than the dump said it
 *                              wrote is a table cut short.
 *   header, `(0 rows)`         the dump's own ZERO, read as the fact it is.
 *                              What a zero means is then each row's question,
 *                              and no row passes on a zero it needs rows from:
 *                              no settlement listed twice is SETTLEMENT
 *                              INTEGRITY's healthy answer, while zero tool
 *                              invocations is PERMISSIONS UNKNOWN, zero runs is
 *                              no run, zero tasks is a run created with none.
 *   anything else              UNREADABLE: no footer (the dump never finished
 *                              the file — a header with nothing after it is
 *                              exactly what a killed dump leaves), a footer
 *                              that is not the last line, or rows after
 *                              `(0 rows)`.
 *
 * A drill's attestation ledger is not a dump; it is read with the zero-byte
 * rule and without the footer rule.
 */
const FOOTER = /^\((\d+) rows?\)$/u;
function readers(root, { dumped = false } = {}) {
  const raw = (name) => {
    if (root === null || !/^[A-Za-z0-9._-]+$/u.test(name)) return null;
    const path = join(root, name);
    if (!existsSync(path) || !statSync(path).isFile()) return null;
    const text = readFileSync(path, 'utf8');
    const trimmed = text.trim();
    return trimmed === '' || trimmed === 'unavailable' ? null : text;
  };
  const parsed = new Map();
  /** Header and rows, or null when the table is not readable by the rule above. */
  const table = (name) => {
    if (parsed.has(name)) return parsed.get(name);
    const text = raw(name);
    let result = null;
    if (text !== null) {
      const lines = text.split('\n').map((line) => line.replace(/\r$/u, '')).filter((line) => line.length > 0);
      let body = null;
      if (!dumped) {
        body = lines.filter((line) => !FOOTER.test(line));
      } else {
        const footer = FOOTER.exec(lines.at(-1) ?? '');
        const before = lines.slice(0, -1);
        if (footer !== null && !before.some((line) => FOOTER.test(line)) && before.length > 0) {
          const stated = Number(footer[1]);
          const held = before.length - 1;
          if (stated === 0 ? held === 0 : held >= stated) body = before;
        }
      }
      if (body !== null && body.length > 0) {
        const header = body[0].split('\t');
        result = {
          header,
          rows: body.slice(1).map((line) => {
            const cells = line.split('\t');
            return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']));
          }),
        };
      }
    }
    parsed.set(name, result);
    return result;
  };
  /** The text of a readable file; a dumped TABLE that is not readable by the rule above is not readable as text either. */
  const file = (name) => {
    const text = raw(name);
    if (text === null) return null;
    return dumped && name.endsWith('.tsv') && table(name) === null ? null : text;
  };
  const rows = (name) => table(name)?.rows ?? [];
  /** The column names a readable table was dumped with, or null when it is not readable. */
  const header = (name) => table(name)?.header ?? null;
  return { file, rows, header };
}

/* ------------------------------------------------------------- provenance */

/**
 * WHICH CODE, WHICH MODE, WHICH RUN — or the bundle is UNBOUND.
 *
 * Paid run 36568129865's bundle was produced at main. Read at a stack whose
 * run loop, task pipeline and repositories had all moved, it still scored
 * JULIUS MISSION START a PASS for code it never ran. Nothing in the bundle said
 * which commit it came from, whether it was a paid mission or a free dry run,
 * or which of the runs in its database it was about — so the gate scored every
 * bundle against whatever tree read it, a dry run's receipts as a mission's,
 * and an older completed run in the same database as this run's completion.
 *
 * `.github/julius-live-evidence-dump.sh` now writes `bundle-manifest.txt`
 * first. A bundle is BOUND only when that manifest names the commit this
 * checkout is at, `mode=paid`, and one Julius run that `runs.tsv` holds (and
 * that the entrypoint's own accepted line, where there is one, agrees with),
 * and every table the gate reads carries the `run_id` column it is scoped by.
 *
 * AN UNBOUND BUNDLE KEEPS ITS FAILURES. What it cannot do is vouch for
 * anything: a row it would have read as exercised, or as not exercised, reads
 * UNKNOWN instead — so it can neither PASS nor be stood in for by a drill. A
 * failure is still a failure: a broken run does not become sound by being read
 * at the wrong commit.
 */
export const BUNDLE_MANIFEST = 'bundle-manifest.txt';

/** Every table the gate reads whose rows belong to one run and say which. */
const RUN_SCOPED_FILES = [
  'runs.tsv', 'tasks.tsv', 'evidence.tsv', 'decisions.tsv', 'findings.tsv', 'tool-invocations.tsv',
  'failures.tsv', 'budget.tsv', 'settlement-integrity.tsv', 'worker-diagnostics.tsv', 'project-brain.tsv',
  'task-contracts.tsv', 'contract-events.tsv', 'trajectory.tsv', 'scope.tsv',
  // Read by WONDER WEB OUTPUT; nothing produces it yet, and a hand-added one
  // with no run_id once fed that row (G2).
  'wonder-web.tsv',
];

const ACCEPTED_LINE = /^Run (\S+) accepted in state READY; driving the Julius run loop\.$/gmu;
const acceptedRuns = (ev) => {
  const text = ev.file('live-mission.evidence.txt');
  return text === null ? [] : [...new Set([...text.matchAll(ACCEPTED_LINE)].map((match) => match[1]))];
};

/**
 * THE ENTRYPOINT'S OWN WORD ON HOW A RUN ENDED: `RESULT: <state>[ (stalled …)]
 * after N ticks`, followed by `  run: <id>` (relay-bridge/julius-live-mission.ts
 * prints the `run:` line two lines below, after at most `cause:` and `ticks:`).
 *
 * ONE ANSWER OR NONE. A named `RESULT: COMPLETED` beside an unattributed
 * `RESULT: FAILED` used to read VERIFIED COMPLETION PASS: the unattributed line
 * was simply not counted. A line that says `RESULT:` and names no run could be
 * about this run, so a bundle carrying one cannot say how this run ended — and
 * neither can one carrying two answers for it that disagree. Both are
 * AMBIGUOUS, read as no answer (`null`), never as the one that flatters. A
 * `run:` line belongs to the nearest RESULT above it, never to one further up.
 */
const RESULT_LINE = /^RESULT: ([A-Z_]+)( \(stalled before terminal state\))?( after \d+ ticks)?$/u;
function resultsOf(ev) {
  const text = ev.file('live-mission.evidence.txt');
  if (text === null) return [];
  const lines = text.split('\n').map((line) => line.replace(/\r$/u, ''));
  const found = [];
  lines.forEach((line, index) => {
    if (!line.startsWith('RESULT:')) return;
    const match = RESULT_LINE.exec(line);
    let run = null;
    for (const next of lines.slice(index + 1, index + 4)) {
      if (next.startsWith('RESULT:')) break;
      const named = /^\s+run: (\S+)$/u.exec(next);
      if (named !== null) { run = named[1]; break; }
    }
    // A RESULT line of another shape (`RESULT: BLOCKED — …`) is still a RESULT
    // line: it has no terminal state to read, and it is never attributed.
    found.push(match === null
      ? { state: null, stalled: false, run: null, line }
      : { state: match[1], stalled: match[2] !== undefined, run, line });
  });
  return found;
}
/** This run's one RESULT, or null when there is none or the bundle's RESULT lines are ambiguous about it. */
function resultFor(ev, runId) {
  const results = resultsOf(ev);
  if (results.some((result) => result.run === null)) return null;
  const named = results.filter((result) => result.run === runId);
  if (named.length === 0) return null;
  const agreed = named.every((result) => result.state === named[0].state && result.stalled === named[0].stalled);
  return agreed ? named[0] : null;
}

function readManifest(ev) {
  const text = ev.file(BUNDLE_MANIFEST);
  if (text === null) return null;
  const fields = {};
  for (const line of text.split('\n')) {
    const match = /^([a-z_]+)=(.*)$/u.exec(line.trim());
    if (match !== null && !(match[1] in fields)) fields[match[1]] = match[2];
  }
  return fields;
}

let readingCommitMemo;
/** The commit of the checkout this gate is reading from, or null when git cannot say. */
function readingCommit() {
  if (readingCommitMemo !== undefined) return readingCommitMemo;
  try {
    // A literal command (the repository boundary scan reads every command this
    // file can run); the checkout is chosen by `cwd`.
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    readingCommitMemo = /^[0-9a-f]{40}$/u.test(head) ? head : null;
  } catch {
    readingCommitMemo = null;
  }
  return readingCommitMemo;
}

function bindingOf(ev) {
  if (!ev.present) return { bound: false, reason: 'no live evidence bundle was read', manifest: null, run: null };
  const manifest = readManifest(ev);
  const runs = ev.rows('runs.tsv');
  const accepted = acceptedRuns(ev);
  // THE RUN THIS BUNDLE IS ABOUT: the manifest's; for a bundle from before
  // manifests, the entrypoint's one accepted line, or else the only run. Never
  // the first of several, which is how an older completed run once decided
  // this run's VERIFIED COMPLETION.
  const named = manifest?.julius_run_id && manifest.julius_run_id !== 'none' ? manifest.julius_run_id
    : accepted.length === 1 ? accepted[0]
      : runs.length === 1 ? runs[0].run_id : null;
  const run = named === null ? null : runs.find((row) => row.run_id === named) ?? null;
  const unbound = (reason) => ({ bound: false, reason, manifest, run });
  if (manifest === null) return unbound(`the bundle carries no ${BUNDLE_MANIFEST}, so the commit, the workflow run and the mode it was produced in are unknown`);
  if (manifest.manifest_version !== '1') return unbound(`${BUNDLE_MANIFEST} is version ${manifest.manifest_version ?? '(none)'}, which this gate cannot read`);
  if (!/^[0-9a-f]{40}$/u.test(manifest.commit ?? '')) return unbound(`${BUNDLE_MANIFEST} names no commit (${manifest.commit ?? 'absent'})`);
  const reading = readingCommit();
  if (reading === null) return unbound('the commit of the checkout reading this bundle is unknown (git could not say), so nothing ties the bundle to it');
  if (manifest.commit !== reading) {
    return unbound(`it was produced at ${manifest.commit.slice(0, 12)} and is being read at ${reading.slice(0, 12)}, so its rows describe code this checkout does not hold`);
  }
  if (manifest.mode !== 'paid') {
    return unbound(`it is mode=${manifest.mode ?? '(absent)'} (${manifest.mode_basis ?? 'no basis'}), and only a paid mission's rows can prove what a paid mission does`);
  }
  if (!manifest.julius_run_id || manifest.julius_run_id === 'none') return unbound('its manifest names no Julius run, so no row can be scoped to one');
  if (run === null) return unbound(`its manifest names run ${manifest.julius_run_id}, which runs.tsv does not hold`);
  const stray = accepted.filter((id) => id !== run.run_id);
  if (stray.length > 0) return unbound(`the entrypoint accepted ${stray.join(', ')} while the manifest names ${run.run_id}`);
  const elsewhere = resultsOf(ev).filter((result) => result.run !== null && result.run !== run.run_id);
  if (elsewhere.length > 0) return unbound(`the entrypoint's RESULT names ${elsewhere.map((result) => result.run).join(', ')} while the manifest names ${run.run_id}`);
  // A table the bundle cannot read (absent, `unavailable`, zero bytes, cut
  // short) has no rows to mis-scope, and every row that needs it reads UNKNOWN
  // on its own; a READABLE one must name its run.
  const unscoped = RUN_SCOPED_FILES.filter((name) => {
    const header = ev.header(name);
    return header !== null && !header.includes('run_id');
  });
  if (unscoped.length > 0) {
    return unbound(`${unscoped.join(', ')} ${unscoped.length === 1 ? 'carries' : 'carry'} no run_id column, so ${unscoped.length === 1 ? 'its' : 'their'} rows cannot be tied to run ${run.run_id}`);
  }
  return { bound: true, reason: null, manifest, run };
}

/**
 * EVERY TABLE, SCOPED TO THE ONE RUN. A table that names its run is filtered
 * to it; sessions are scoped by the run's mission; a table from a bundle older
 * than the `run_id` column is read whole, and the binding above has already
 * refused to let such a bundle vouch for anything.
 */
function scoped(ev, binding) {
  const run = binding.run ?? null;
  const runId = run?.run_id ?? null;
  const rows = (name) => {
    const all = ev.rows(name);
    if (runId === null) return all;
    if (name === 'sessions.tsv') return run.mission_id ? all.filter((row) => row.mission_id === run.mission_id) : all;
    return (ev.header(name) ?? []).includes('run_id') ? all.filter((row) => row.run_id === runId) : all;
  };
  return { ...ev, rows, allRows: ev.rows, run, runId };
}

/* ------------------------------------------------------- provider identity */

/**
 * WHO DID THE WORK — A REAL PROVIDER, OR A STAND-IN.
 *
 * The bundle has always carried the provider, the served model, the transport
 * and the response id; no row read them. So the repair drill's own database,
 * dumped in the mission's shape — three scripted adapters, `providerId: 'drill'`
 * — read PASS for the architect, the coder, the reviewer and the completion.
 *
 * A role's task is credited only on a worker-diagnostics row for THAT task
 * naming a transport this runtime has, the provider the live composition gives
 * that role, a served model (for the coder, one the `served_model_basis` column
 * attests where the bundle has it), and — for the architect and the coder,
 * whose providers answer with one — a response id; and on the trajectory's own
 * record of the dispatch: the role's live worker and adapter, routed to that
 * same provider.
 *
 * AN ALLOWLIST, READ FROM THE COMPOSITION THAT RUNS THE MISSION. This used to
 * be a denylist of stand-in words, so `FakeOpenAI`, `MockProvider`, `test` and
 * an adapter named `stubbed-live` all passed, and the adapter rule was skipped
 * whenever the trajectory could not be read. The real identities are now read
 * from this checkout — the one the bundle is bound to — rather than retyped:
 * each role's worker, adapter and provider from `live-composition.ts`
 * (`architectWorker`, `CODER_WORKER`, `reviewerWorker`); the reviewer's
 * provider from the launchers that set `RELAY_HERMES_PROVIDER`, because the
 * composition takes it from there; the transports from the runtime's own enum
 * in `julius-router.ts`. Anything else is NOT A REAL PROVIDER, and a record
 * that cannot be read is UNKNOWN. Stand-in words are still refused in the
 * served model and the response id, which no allowlist can close.
 */
export const NOT_A_PROVIDER_TOKENS = Object.freeze([
  'drill', 'fake', 'stub', 'mock', 'sim', 'simulated', 'scripted', 'fixture', 'dummy', 'placeholder', 'recorded', 'replay', 'noop',
]);
const RESPONSE_ID_ROLES = new Set(['PROMPT_ARCHITECT', 'CODING_AGENT']);
const standIn = (value) => typeof value === 'string' && value !== ''
  && value.toLowerCase().split(/[^a-z0-9]+/u).some((token) => NOT_A_PROVIDER_TOKENS.includes(token));
const adapterOf = (facts) => {
  try {
    const parsed = JSON.parse(facts);
    return typeof parsed?.adapterId === 'string' ? parsed.adapterId : null;
  } catch {
    return null;
  }
};

/** A repository file's text, or null when this checkout does not hold it. */
const repoText = (relativePath) => {
  try {
    return readFileSync(join(REPO, relativePath), 'utf8');
  } catch {
    return null;
  }
};

export const EVIDENCE_DUMP = '.github/julius-live-evidence-dump.sh';
/** Whether this checkout's evidence dump has a query that writes `name` (a `dump "SELECT …" <name>` line). */
const dumpWrites = (name) => (repoText(EVIDENCE_DUMP) ?? '').split('\n')
  .some((line) => line.startsWith('dump "') && line.trimEnd().endsWith(`" ${name}`));

export const LIVE_COMPOSITION = 'relay-bridge/julius/live-composition.ts';
export const LIVE_LAUNCHERS = Object.freeze(['.github/workflows/julius-first-live-mission.yml', 'scripts/julius-local-qualification.sh']);
export const RUNTIME_TRANSPORTS = 'src/relay/mission/julius/julius-router.ts';

let liveMemo;
/**
 * The live identity of each role, as the composition this checkout runs
 * declares it: `{ roles: { ROLE: { workerId, adapterId, providers } }, transports }`,
 * or `{ error }` when it cannot be read — and then no role is credited.
 */
export function liveIdentities() {
  if (liveMemo === undefined) liveMemo = readLiveIdentities();
  return liveMemo;
}
function readLiveIdentities() {
  const composition = repoText(LIVE_COMPOSITION);
  if (composition === null) return { error: `${LIVE_COMPOSITION} is not in this checkout, so no live identity can be read` };
  const roles = {};
  const declared = /workerId: '([a-z0-9-]+)', role: '(PROMPT_ARCHITECT|CODING_AGENT|INDEPENDENT_REVIEWER)',\s*adapterId: '([a-z0-9-]+)', providerId(?:: '([a-z0-9-]+)')?,/gu;
  for (const match of composition.matchAll(declared)) {
    if (match[2] in roles) return { error: `${LIVE_COMPOSITION} declares ${match[2]} twice, so which worker is live is unknown` };
    roles[match[2]] = { workerId: match[1], adapterId: match[3], providers: match[4] === undefined ? null : [match[4]] };
  }
  const roleNames = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];
  const absent = roleNames.filter((role) => !(role in roles));
  if (absent.length > 0) return { error: `${LIVE_COMPOSITION} declares no live ${absent.join(', ')} worker this gate can read` };
  // `reviewerWorker(providerId)`: the composition takes the reviewer's provider
  // from RELAY_HERMES_PROVIDER, which the launchers set.
  const launched = new Set();
  for (const launcher of LIVE_LAUNCHERS) {
    for (const match of (repoText(launcher) ?? '').matchAll(/^\s*(?:export\s+)?RELAY_HERMES_PROVIDER\s*[:=]\s*['"]?([a-z0-9-]+)['"]?\s*$/gmu)) launched.add(match[1]);
  }
  for (const role of roleNames) {
    if (roles[role].providers !== null) continue;
    if (launched.size === 0) return { error: `no live launcher sets RELAY_HERMES_PROVIDER, so the ${role}'s provider is unknown` };
    roles[role].providers = [...launched].sort();
  }
  // The composition refuses a reviewer on the coder's own vendor; so does this reading.
  const shared = roles.INDEPENDENT_REVIEWER.providers.filter((provider) => roles.CODING_AGENT.providers.includes(provider));
  if (shared.length > 0) return { error: `the launchers give the reviewer the coder's own provider (${shared.join(', ')}), which the live composition refuses` };
  const router = repoText(RUNTIME_TRANSPORTS);
  const listed = router === null ? null : /transport:safeEnum\(v\.transport,\[([^\]]*)\]/u.exec(router);
  const transports = listed === null ? [] : [...listed[1].matchAll(/'([a-z]+)'/gu)].map((match) => match[1]);
  if (transports.length === 0) return { error: `${RUNTIME_TRANSPORTS} declares no transport this gate can read` };
  return { roles, transports };
}

function identityOf(ev, task) {
  const label = (detail) => `${task.task_id}: ${detail}`;
  const live = liveIdentities();
  if ('error' in live) return { state: 'UNKNOWN', detail: label(`the live composition's identities cannot be read (${live.error})`) };
  const expected = live.roles[task.role];
  if (expected === undefined) return { state: 'UNKNOWN', detail: label(`${task.role || '(no role)'} is no role the live composition declares`) };
  const notReal = [];
  const missing = [];
  const allowed = expected.providers.join(', ');

  // THE TRAJECTORY: the runtime's own record of where it sent the dispatch.
  if (ev.file('trajectory.tsv') === null) {
    missing.push('trajectory.tsv is unreadable, so the worker and adapter it was dispatched to cannot be checked');
  } else {
    const trail = ev.rows('trajectory.tsv').filter((row) => row.task_id === task.task_id);
    const routed = [...new Set(trail.map((row) => row.provider_id).filter((provider) => provider && !expected.providers.includes(provider)))];
    if (routed.length > 0) notReal.push(`the trajectory routed it to ${routed.join(', ')}, and the live composition routes ${task.role} only to ${allowed}`);
    const selected = trail.filter((row) => row.event_kind === 'WORKER_SELECTED');
    if (selected.length === 0) missing.push('the trajectory records no worker selection for it, so the adapter that answered cannot be checked');
    for (const row of selected) {
      const adapter = adapterOf(row.safe_facts);
      if (adapter === null) missing.push('its worker selection names no readable adapter');
      else if (adapter !== expected.adapterId) notReal.push(`it was dispatched to adapter ${adapter}, not the live ${expected.adapterId}`);
      if (row.worker_id && row.worker_id !== expected.workerId) notReal.push(`it was dispatched to worker ${row.worker_id}, not the live ${expected.workerId}`);
    }
  }

  // THE DIAGNOSTICS: who answered, over what, with which model — on EVERY
  // attempt of the task, and completely on the one that succeeded.
  let row = null;
  if (ev.file('worker-diagnostics.tsv') === null) {
    missing.push('worker-diagnostics.tsv is unreadable, so which provider answered is unknown');
  } else {
    const diagnostics = ev.rows('worker-diagnostics.tsv').filter((entry) => entry.task_id === task.task_id);
    for (const entry of diagnostics) {
      for (const column of ['served_model', 'requested_model', 'response_id']) {
        if (standIn(entry[column])) notReal.push(`its ${column} is ${entry[column]}`);
      }
      if (entry.transport && !live.transports.includes(entry.transport)) notReal.push(`its transport ${entry.transport} is none the runtime has (${live.transports.join(', ')})`);
      if (entry.provider && !expected.providers.includes(entry.provider)) notReal.push(`its provider ${entry.provider} is not the one the live composition gives ${task.role} (${allowed})`);
    }
    row = [...diagnostics].reverse().find((entry) => entry.outcome === 'succeeded' || entry.event_type === 'julius.worker.completed') ?? diagnostics.at(-1) ?? null;
    if (row === null) {
      missing.push('no worker-diagnostics row names it, so no provider identity was recorded');
    } else {
      if (!row.transport) missing.push('its diagnostics name no transport');
      if (!row.provider) missing.push('its diagnostics name no provider');
      if (task.role === 'CODING_AGENT') {
        // The column the coder's served model is attested in. A dump without
        // it cannot show the model was the one that served, and a bundle that
        // dropped it is not given the benefit of the doubt.
        if (!(ev.header('worker-diagnostics.tsv') ?? []).includes('served_model_basis')) {
          missing.push('worker-diagnostics.tsv carries no served_model_basis column, so the coder\'s served model cannot be shown attested');
        } else if (row.served_model_basis !== 'attested' || !row.served_model) {
          missing.push(`its served model is not attested (served_model_basis ${row.served_model_basis || 'empty'})`);
        }
      } else if (!row.served_model) {
        missing.push('its diagnostics name no served model');
      }
      if (RESPONSE_ID_ROLES.has(task.role) && !row.response_id) missing.push('its diagnostics carry no provider response id');
    }
  }
  if (notReal.length > 0) return { state: 'NOT REAL', detail: label([...new Set(notReal)].join('; ')) };
  if (missing.length > 0) return { state: 'UNKNOWN', detail: label([...new Set(missing)].join('; ')) };
  return { state: 'REAL', detail: `${row.provider}/${row.served_model} over ${row.transport}` };
}

/** Judges the identity of every task given, and says which way it fell. */
function identities(ev, tasks) {
  const judged = tasks.map((task) => identityOf(ev, task));
  return {
    notReal: judged.filter((entry) => entry.state === 'NOT REAL').map((entry) => entry.detail),
    unknown: judged.filter((entry) => entry.state === 'UNKNOWN').map((entry) => entry.detail),
    real: [...new Set(judged.filter((entry) => entry.state === 'REAL').map((entry) => entry.detail))],
  };
}

/* ------------------------------------------------------ capability proofs */

/**
 * A DRILL THAT RAN, NOT A DRILL THAT EXISTS.
 *
 * `capability-proofs.tsv` is the ledger a drill writes about itself: which
 * capability it claims, which command it was, how many steps it declared, what
 * infrastructure it drove, WHICH FILES it exercised with their content digests
 * at the moment it ran, and the transcript it left behind. One row per file;
 * the gate groups by (capability, drill).
 *
 * Six things are checked, and a proof that misses any of them is inadmissible
 * rather than merely quiet:
 *
 *   OUTCOME. The drill said VERIFIED. Anything else is a drill that did not
 *   pass, and a drill that did not pass proves nothing.
 *
 *   CURRENCY. Every attested file still exists and still hashes to the digest
 *   the drill recorded. A proof whose subject has been edited since is STALE:
 *   it describes code that is no longer here. This is why capability proofs
 *   expire on their own rather than accumulating as folklore.
 *
 *   THE WHOLE DRILL. The attested set contains EVERY file the drill's command
 *   builds and runs, read from the tree (`julius-drill-closure.mjs`), never
 *   from the ledger: the drill's own npm script, its esbuild entry, and every
 *   relative import from there. Attesting only the row's own files let a proof
 *   outlive the pipeline, repositories and composition it drove through.
 *
 *   ITS OWN DRILL. The attestation names the one drill `julius-drill-closure.mjs`
 *   declares for this capability (JULIUS_CAPABILITY_DRILLS). The three drills
 *   drive nearly the same pipeline, so coverage alone let one drill's proof be
 *   relabelled as another's.
 *
 *   COVERAGE. The attested set contains every file this row's own build probe
 *   names, and the drill really imports each of them.
 *
 *   TRANSCRIPT. That drill's own transcript file is present, carries exactly
 *   the declared number of `[PASS]` steps, carries no `[FAIL]`, and ends on the
 *   sentence only that drill writes when it passes (`<name> VERIFIED`). The gate
 *   reads the drill's words rather than a summary word about them.
 *
 * WHAT THIS STILL CANNOT CATCH, stated rather than implied: the digests are
 * recomputable from the tree, so a ledger typed by hand with every digest right
 * is indistinguishable from one a drill wrote. The attestation is unsigned.
 */
export const CAPABILITY_PROOF_COLUMNS = [
  'capability', 'drill', 'outcome', 'steps', 'infrastructure',
  'exercised_path', 'exercised_digest', 'transcript', 'recorded_at',
];

const digestOf = (relativePath) => {
  const path = join(REPO, relativePath);
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
};

/**
 * A path in an attestation names a file INSIDE this repository and nothing
 * else. An attestation is a text file that travelled here from a CI runner, so
 * `../` in it is either a mistake or an attempt, and both are refused the same
 * way.
 */
const containedPath = (relativePath) => {
  if (relativePath === '' || relativePath.startsWith('/')) return false;
  const target = resolve(REPO, relativePath);
  return target !== REPO && target.startsWith(REPO + sep);
};

function loadProofs(evidence, capabilityDir) {
  const source = capabilityDir === null || capabilityDir === undefined
    ? (evidence.root === null ? null : evidence.root)
    : resolve(capabilityDir);
  if (source === null || !existsSync(source)) return { source: null, rows: [], file: () => null };
  const read = readers(source);
  if (read.file('capability-proofs.tsv') === null) return { source, rows: [], file: read.file };
  return { source, rows: read.rows('capability-proofs.tsv'), file: read.file };
}

/**
 * The capability axis for ONE row: PROVEN, STALE, or UNPROVEN, always with the
 * reason it reached that answer.
 */
function capabilityProof(proofs, capability, probed) {
  const mine = proofs.rows.filter((row) => row.capability === capability.id);
  if (mine.length === 0) return { state: 'UNPROVEN', basis: 'no drill attestation names this capability' };
  if (CAPABILITY_PROOF_COLUMNS.some((column) => mine.every((row) => row[column] === undefined))) {
    return { state: 'UNPROVEN', basis: 'the attestation ledger is missing columns this gate reads' };
  }
  /**
   * ITS OWN DRILL, OR NONE. The three drills import almost the same code, so
   * the recovery drill's attestation, relabelled FAILURE RECOVERY or REPAIR
   * LOOP, covered those rows' files and "proved" them; and any npm script with
   * a build (the relay bridge server) passed as a drill. A row is proven only
   * by the one drill `julius-drill-closure.mjs` names for it, and only with that
   * drill's own transcript closing on the sentence no other drill writes.
   */
  const own = capabilityDrill(capability.id);
  if (own === null) {
    return { state: 'UNPROVEN', basis: `no Julius capability drill exercises ${capability.id}, so no attestation can prove it (the drills prove ${Object.keys(JULIUS_CAPABILITY_DRILLS).join(', ')})` };
  }
  const drills = [...new Set(mine.map((row) => row.drill))];
  const refusals = [];
  for (const drill of drills) {
    const claimed = mine.filter((row) => row.drill === drill);
    const refuse = (state, basis) => refusals.push({ state, basis: `${drill}: ${basis}` });

    if (drill !== own.command) { refuse('UNPROVEN', `it is not ${capability.id}'s drill (${own.command}), so it proves nothing about this row`); continue; }

    const failed = claimed.find((row) => row.outcome !== 'VERIFIED');
    if (failed !== undefined) { refuse('UNPROVEN', `the drill recorded ${failed.outcome || '(no outcome)'}, not VERIFIED`); continue; }

    const traversal = claimed.find((row) => !containedPath(row.exercised_path));
    if (traversal !== undefined) { refuse('UNPROVEN', `it names ${traversal.exercised_path || '(nothing)'}, which is not a file in this repository`); continue; }

    const moved = claimed.find((row) => digestOf(row.exercised_path) !== row.exercised_digest);
    if (moved !== undefined) {
      refuse('STALE', digestOf(moved.exercised_path) === null
        ? `${moved.exercised_path} is no longer in this repository, so the drill describes code that is not here`
        : `${moved.exercised_path} has changed since the drill ran, so the drill no longer describes the code that is here`);
      continue;
    }

    /**
     * ONE DRILL, ONE STORY. Every row of a drill describes the same run, so a
     * ledger whose rows disagree about when it ran, what it ran against, how
     * many steps it declared or which transcript it left is not one run's
     * testimony — and reading only the first row would let the rest say
     * anything at all.
     */
    const inconsistent = ['steps', 'infrastructure', 'transcript', 'recorded_at']
      .find((column) => new Set(claimed.map((row) => row[column])).size > 1);
    if (inconsistent !== undefined) { refuse('UNPROVEN', `its rows disagree about ${inconsistent}, so they do not describe one run`); continue; }

    const driven = drillDrivenFiles(REPO, drill);
    if ('error' in driven) { refuse('UNPROVEN', `${driven.error}, so the code this drill drives cannot be known and no attestation of it can cover it`); continue; }
    const exercised = new Set(claimed.map((row) => row.exercised_path));
    const unattested = driven.files.filter((path) => !exercised.has(path));
    if (unattested.length > 0) {
      refuse('UNPROVEN', `the drill drives ${driven.files.length} file(s) and ${unattested.length} of them are not attested (${unattested.slice(0, 3).join(', ')}${unattested.length > 3 ? ', …' : ''}), so the proof cannot show the code it drove is unchanged`);
      continue;
    }

    const uncovered = probed.files.filter((path) => !exercised.has(path));
    if (uncovered.length > 0) { refuse('UNPROVEN', `it did not exercise ${uncovered.join(', ')}`); continue; }
    const undriven = probed.files.filter((path) => !driven.files.includes(path));
    if (undriven.length > 0) { refuse('UNPROVEN', `the drill does not import ${undriven.join(', ')}, so it cannot have exercised ${undriven.length === 1 ? 'it' : 'them'}`); continue; }

    const transcriptName = claimed[0].transcript;
    if (transcriptName !== own.transcript) { refuse('UNPROVEN', `it names the transcript ${transcriptName || '(none)'}, and ${own.command} writes ${own.transcript}`); continue; }
    const transcript = proofs.file(transcriptName);
    if (transcript === null) { refuse('UNPROVEN', `its transcript ${transcriptName || '(unnamed)'} is not in this bundle`); continue; }
    const passes = (transcript.match(/^\s*\[PASS\] /gmu) ?? []).length;
    const failures = (transcript.match(/^\s*\[FAIL\] /gmu) ?? []).length;
    const declared = Number.parseInt(claimed[0].steps, 10);
    if (!Number.isInteger(declared) || declared < 1) { refuse('UNPROVEN', 'it declares no step count, so its transcript cannot be held to one'); continue; }
    if (failures > 0) { refuse('UNPROVEN', `its transcript records ${failures} failed step(s)`); continue; }
    if (passes !== declared) { refuse('UNPROVEN', `it declares ${declared} step(s) and its transcript shows ${passes}`); continue; }
    const verdictLine = transcript.split('\n').map((line) => line.trim()).filter((line) => line.length > 0).pop() ?? '';
    /**
     * THE DRILL'S OWN SENTENCE, EXACTLY. Any capitals ending in VERIFIED used to
     * pass once NOT and FAILED were refused, and so did `… CANNOT BE VERIFIED`,
     * `… NEVER VERIFIED` and `DRILL ABORTED BEFORE IT VERIFIED`. The drill seals
     * its transcript with `<name> VERIFIED` and nothing else (`DrillRecord.seal`),
     * so that line, whole, is the only verdict that reads verified — and it is
     * also the marker no other drill's transcript carries.
     */
    if (verdictLine !== `${own.name} VERIFIED`) {
      refuse('UNPROVEN', `its transcript does not end on ${own.name} VERIFIED, the line only ${own.command} writes when it passes`); continue;
    }

    return {
      state: 'PROVEN',
      basis: `${drill} drove every one of the ${driven.files.length} file(s) its build reaches, unchanged since, against what it names as ${claimed[0].infrastructure || '(unstated infrastructure)'}, and passed ${passes} step(s) on ${claimed[0].recorded_at || '(no recorded instant)'}`,
    };
  }
  const stale = refusals.find((row) => row.state === 'STALE');
  return stale ?? refusals[0] ?? { state: 'UNPROVEN', basis: 'no admissible drill attestation' };
}

/* ----------------------------------------------------------- capabilities */

/**
 * THE MISSION AXIS. Four answers, and the difference between the last two is
 * the whole reason this refactor exists.
 *
 *   EXERCISED      the run did it, and it worked
 *   FAILED         the run did it, and it did not work
 *   NOT EXERCISED  the run's READABLE rows show it never reached this
 *                  behaviour — a flawless mission never crashes, so it never
 *                  recovers, and saying it FAILED at recovery would be false
 *   UNKNOWN        the bundle cannot say. Never a default, never zero, never
 *                  inferred from the fact that something else is present, and
 *                  never something a drill may stand in for.
 */
const exercised = (basis) => ({ mission: 'EXERCISED', basis });
const failed = (basis) => ({ mission: 'FAILED', basis });
const notExercised = (basis) => ({ mission: 'NOT EXERCISED', basis });
const unknown = (basis) => ({ mission: 'UNKNOWN', basis });

const TERMINAL_TASK_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED']);
const TERMINAL_RUN_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const WORK_ROLES = new Set(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']);

/** The first of `names` this bundle cannot read, or null when every one is readable. */
const unreadable = (ev, ...names) => names.find((name) => ev.file(name) === null) ?? null;
const cannotRead = (name, what) => unknown(`${name} is unreadable (absent, empty, cut short, or the dump wrote \`unavailable\`), so ${what} is unknown`);
const count = (value) => (/^\d+$/u.test(value ?? '') ? Number(value) : null);
/** An instant the dump or the runtime wrote (`2026-09-29 12:33:45.141+00`, ISO), as milliseconds, or null. */
const instant = (value) => {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/u.exec((value ?? '').trim());
  if (match === null) return null;
  const zone = match[4] === undefined || match[4] === 'Z' ? 'Z'
    : match[4].length === 3 ? `${match[4]}:00` : match[4].includes(':') ? match[4] : `${match[4].slice(0, 3)}:${match[4].slice(3)}`;
  const parsed = Date.parse(`${match[1]}T${match[2]}${(match[3] ?? '').slice(0, 4)}${zone}`);
  return Number.isNaN(parsed) ? null : parsed;
};
const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');

/** The evidence rows a task produced: by `task_id` where the dump carries it, else by the `<task>:<attempt>:<n>` id. */
const evidenceOf = (ev, taskId) => {
  const rows = ev.rows('evidence.tsv');
  if ((ev.header('evidence.tsv') ?? []).includes('task_id')) return rows.filter((row) => row.task_id === taskId);
  return rows.filter((row) => row.evidence_id.startsWith(`${taskId}:`) && /^\d+:\d+$/u.test(row.evidence_id.slice(taskId.length + 1)));
};
/** Why a task failed, from the failure dump, or nothing. */
const why = (ev, taskId) => {
  const row = ev.rows('failures.tsv').filter((entry) => entry.task_id === taskId && (entry.julius_code || entry.failure_class)).pop();
  return row === undefined ? '' : ` (${row.julius_code || 'no code'}/${row.failure_class || 'no class'})`;
};
const runLabel = (ev) => (ev.run === null ? 'the run' : `run ${ev.run.run_id}`);
const noRun = (ev) => unknown(ev.allRows('runs.tsv').length === 0
  ? 'no run row in the evidence bundle'
  : `the bundle holds ${ev.allRows('runs.tsv').length} run(s) and names none of them as its own`);

/**
 * AN ACCOUNT IS WHAT THE ACCOUNT SYSTEM MINTS, NOT ANY NAME BUT TWO.
 *
 * Both bounded live missions declare `"tenantId": "tenant"`, and the session's
 * `player_id` is that contract field verbatim: the operator can type anything
 * there. The row used to refuse only `tenant` and `operator`, so a contract
 * naming its tenant `founder` read as a person who had signed up. The one way
 * this repository creates an account is GitHub sign-in, which mints the
 * participant id `ghu-<GitHub numeric id>` (`participantIdForIdentity`,
 * relay-bridge/github-auth-routes.ts; a test holds the two equal). Anything
 * else is the operator by another name. And the shape alone is not an account
 * either — the operator can type it too — so an account-shaped owner is only
 * a CANDIDATE, UNKNOWN until an account record corroborates it.
 */
export const ACCOUNT_PARTICIPANT_ID = /^ghu-\d+$/u;

/**
 * THE REFUSALS THAT END A REPAIR BEFORE IT EXISTS. The pipeline proves a repair
 * routable and affordable BEFORE creating it, and halts with `run.failed`
 * otherwise — "no reservation, no task, no attempt" — so the absence of a
 * repair task is exactly what a BROKEN loop leaves behind, and cannot be read
 * as "nothing was rejected". The planner's own refusals are lower-case tokens
 * (`repair_round_limit`, `repair_not_plannable`).
 */
const REPAIR_REFUSAL = /^(?:REPAIR_(?:UNROUTABLE|BUDGET_DENIED|ROUNDS_EXHAUSTED|NOT_PLANNABLE)|repair_[a-z0-9_]+)$/u;

/**
 * THE EXECUTOR REFUSALS THAT MEAN A WORKER REACHED PAST ITS AUTHORITY. The
 * others (unavailable, a malformed request, an unknown outcome) are
 * infrastructure, and an unknown outcome is judged by the invocation it left.
 */
const BOUNDARY_REFUSALS = new Set(['executor_scope_refused', 'executor_authorization_refused', 'executor_security_failure', 'executor_invocation_unauthorized']);
const OPEN_INVOCATION_STATES = new Set(['REQUESTED', 'AUTHORIZED', 'DISPATCHING', 'RUNNING']);
const EXECUTED_INVOCATION_STATES = new Set(['SUCCEEDED', 'FAILED', 'TIMED_OUT']);
/** Every state `julius_tool_invocations.state` may hold (migration 019): open, executed, DENIED and CANCELLED. */
const KNOWN_INVOCATION_STATES = new Set([...OPEN_INVOCATION_STATES, ...EXECUTED_INVOCATION_STATES, 'DENIED', 'CANCELLED']);

/**
 * `path: true` marks a capability on the creation path a mission must walk to
 * reach VERIFIED COMPLETION. The top-three ranking reads it, so the ordering is
 * a declared property rather than a judgement made at run time.
 *
 * `missionRequired: true` is the stronger statement, and it is what fences the
 * third verdict in: THIS capability must be exercised by the mission itself,
 * and no drill may stand in for it. The nine that carry it are the eight a run
 * physically walks between "a project exists" and "the run COMPLETED", and the
 * settlement of what it spent — a drill proving a coder can code does not make
 * a mission that never built anything into one that did.
 *
 * REPAIR LOOP, RESTART / RECOVERY and FAILURE RECOVERY deliberately do NOT
 * carry it. Each is reached only by something going wrong, and a beta gate that
 * demands a healthy paid mission go wrong on purpose is asking the product to
 * lie in the other direction.
 */
const CAPABILITIES = [
  {
    id: 'ACCOUNT / ONBOARDING', path: false, missionRequired: false,
    files: ['relay-bridge/github-oauth.ts', 'relay-bridge/github-auth-routes.ts', 'src/relay/ui/relay-experience/onboarding.ts'],
    prove: (ev) => {
      if (ev.file('sessions.tsv') === null) {
        return unknown('this bundle carries no readable execution-session dump, so the account the mission ran for is unknown');
      }
      const sessions = ev.rows('sessions.tsv');
      if (sessions.length === 0) return notExercised(`no execution session was recorded for ${runLabel(ev)}'s mission, so no account owns it`);
      const owners = [...new Set(sessions.map((row) => row.player_id))];
      const signedUp = owners.filter((owner) => ACCOUNT_PARTICIPANT_ID.test(owner));
      if (signedUp.length === 0) {
        return notExercised(`every session is owned by an operator-named tenant (${owners.join(', ')}), none of them an account GitHub sign-in minted, so no real account has started a mission`);
      }
      /**
       * THE SHAPE IS NOT THE ACCOUNT (X3, still open after the allowlist). The
       * session's `player_id` is the contract's `tenantId`, verbatim, so
       * `ghu-583231` is a spelling the operator can type into a contract and
       * this bundle cannot tell it from a sign-in. Only a record the account
       * system itself wrote could, and the evidence dump carries none: GitHub
       * sign-in mints a session, not a durable account row. Until an account
       * source is dumped, an account-shaped owner is UNKNOWN, never a sign-up.
       */
      return unknown(`a session is owned by ${signedUp.join(', ')}, the shape GitHub sign-in mints, but player_id is the contract's tenantId, which the operator types, and this bundle carries no account record the sign-in itself wrote, so whether a real account started this mission is unknown`);
    },
  },
  {
    id: 'PROJECT CREATION', path: true, missionRequired: true,
    files: ['relay-bridge/julius/bootstrap.ts', 'relay-bridge/julius/mission-seed.ts'],
    prove: (ev) => {
      if (ev.file('runs.tsv') === null) return cannotRead('runs.tsv', 'whether a run was created');
      if (ev.run === null) return noRun(ev);
      if (ev.file('tasks.tsv') === null) return cannotRead('tasks.tsv', `whether ${runLabel(ev)} was created with its work`);
      if (!ev.run.mission_id) return failed(`${runLabel(ev)} names no mission`);
      const tasks = ev.rows('tasks.tsv');
      return tasks.length > 0
        ? exercised(`${runLabel(ev)} was created for mission ${ev.run.mission_id} with ${tasks.length} task(s)`)
        : failed(`${runLabel(ev)} was created for mission ${ev.run.mission_id} with no task in it`);
    },
  },
  {
    id: 'JULIUS MISSION START', path: true, missionRequired: true,
    files: ['relay-bridge/julius-live-mission.ts', 'src/relay/mission/julius/julius-run-loop.ts'],
    prove: (ev) => {
      if (ev.file('live-mission.evidence.txt') === null) return unknown('this bundle carries no readable mission evidence, so how the run started is unknown');
      const accepted = acceptedRuns(ev);
      if (ev.runId === null) {
        return accepted.length > 0
          ? exercised(`the entrypoint recorded ${accepted.join(', ')} accepted in READY and drove the loop`)
          : failed('no accepted-and-driving line in the mission evidence');
      }
      return accepted.includes(ev.runId)
        ? exercised(`the entrypoint accepted ${runLabel(ev)} in READY and drove the loop`)
        : failed(`no accepted-and-driving line for ${runLabel(ev)} in the mission evidence${accepted.length > 0 ? ` (it names ${accepted.join(', ')})` : ''}`);
    },
  },
  {
    id: 'PROMPT ARCHITECT', path: true, missionRequired: true,
    files: ['src/relay/connectors/gpt-architect/index.ts', 'src/relay/mission/prompt-architect/prompt-architect-plan.ts'],
    prove: (ev) => {
      const gap = unreadable(ev, 'tasks.tsv', 'evidence.tsv');
      if (gap !== null) return cannotRead(gap, "what the architect's tasks did");
      const tasks = ev.rows('tasks.tsv').filter((row) => row.role === 'PROMPT_ARCHITECT');
      const ran = tasks.filter((row) => TERMINAL_TASK_STATES.has(row.state));
      if (ran.length === 0) {
        return notExercised(tasks.length === 0 ? 'no PROMPT_ARCHITECT task in the run' : `no architect task ran to an end (${tasks.map((row) => row.state).join(', ')})`);
      }
      // EVERY ARCHITECT TASK, and each plan's artifact must be ITS OWN: the
      // first task and any artifact in the bundle is how one good plan hid a
      // broken one.
      const broken = [];
      for (const task of ran) {
        if (task.state !== 'SUCCEEDED') { broken.push(`${task.task_id} is ${task.state}${why(ev, task.task_id)}`); continue; }
        if ((task.task_type === 'plan' || task.task_type === 'repair:plan')
          && !evidenceOf(ev, task.task_id).some((row) => row.evidence_type === 'ARTIFACT' && row.status === 'PASSED')) {
          broken.push(`${task.task_id} SUCCEEDED with no accepted plan artifact of its own`);
        }
      }
      if (broken.length > 0) return failed(broken.join('; '));
      const who = identities(ev, ran);
      if (who.notReal.length > 0) return failed(`NOT A REAL PROVIDER — ${who.notReal.join('; ')}`);
      if (who.unknown.length > 0) return unknown(`the architect's work SUCCEEDED, but which provider did it is unknown — ${who.unknown.join('; ')}`);
      return exercised(`${ran.length} architect task(s) SUCCEEDED on a real provider (${who.real.join(', ')}), each plan with its own validated artifact`);
    },
  },
  {
    id: 'CODING AGENT', path: true, missionRequired: true,
    // The third file is the one that governs what a Coding Agent dispatch may
    // spend. It was `relay-bridge/julius/coder-budget.ts` on the branch this
    // gate was written on; the landed answer is `julius-allocation.v1`, which
    // does the same job properly — mission budget → per-dispatch share →
    // reservation → adapter limit. Pointing a probe at a file that no longer
    // exists reports NOT BUILT for something that is built, which is the same
    // class of lie as reporting PASS for something that is not.
    files: ['relay-bridge/hosted-coding-agent/hosted-runner.ts', 'relay-bridge/julius/live-workers.ts', 'src/relay/mission/julius/julius-allocation-runtime.ts'],
    prove: (ev) => {
      if (ev.file('tasks.tsv') === null) return cannotRead('tasks.tsv', "what the coder's tasks did");
      const coder = ev.rows('tasks.tsv').filter((row) => row.role === 'CODING_AGENT');
      const broken = coder.filter((row) => row.state === 'FAILED');
      if (broken.length > 0) return failed(broken.map((row) => `${row.task_id} is FAILED${why(ev, row.task_id)}`).join('; '));
      const build = coder.find((row) => row.task_type === 'build');
      if (build === undefined) return notExercised('no build task in the run');
      if (!TERMINAL_TASK_STATES.has(build.state)) return notExercised(`${build.task_id} never ran to an end (${build.state})`);
      if (build.state !== 'SUCCEEDED') return failed(`${build.task_id} is ${build.state}`);
      const done = coder.filter((row) => row.state === 'SUCCEEDED');
      const who = identities(ev, done);
      if (who.notReal.length > 0) return failed(`NOT A REAL PROVIDER — ${who.notReal.join('; ')}`);
      if (who.unknown.length > 0) return unknown(`${build.task_id} SUCCEEDED, but which provider did the coding is unknown — ${who.unknown.join('; ')}`);
      return exercised(`${build.task_id} SUCCEEDED${done.length > 1 ? ` with ${done.length - 1} further coder task(s)` : ''} on a real provider (${who.real.join(', ')})`);
    },
  },
  {
    /**
     * THE AGREEMENT THE BUILD RAN UNDER.
     *
     * A row rather than a footnote because the failure it detects is invisible
     * in every other one: a mission can show a plan, a build, a review and a
     * completion while the reviewer graded against its own reading of prose.
     * PASS requires a LOCKED revision whose lock instant precedes the work —
     * "locked at some point" would pass a contract agreed after the fact, which
     * is the thing the ordering guarantee exists to prevent.
     */
    id: 'TASK CONTRACT LOCK', path: true, missionRequired: true,
    files: [
      'src/relay/mission/julius/julius-task-contract.ts',
      'src/relay/persistence/julius-contract-postgres.ts',
      'src/relay/persistence/wonderland-migrations/023_julius_task_contracts.sql',
    ],
    prove: (ev) => {
      if (ev.file('task-contracts.tsv') === null) {
        return unknown('this bundle carries no readable task-contract dump, so what the coder was charged with is unknown');
      }
      const contracts = ev.rows('task-contracts.tsv');
      if (contracts.length === 0) return notExercised('no task contract was authored for this run');
      const locked = contracts.filter((row) => row.state === 'LOCKED');
      if (locked.length === 0) {
        return failed(`${contracts.length} contract revision(s) exist and none was ever locked, so no build could be dispatched`);
      }
      if (ev.file('tasks.tsv') === null) return cannotRead('tasks.tsv', 'which build the locked contract governed');
      const build = ev.rows('tasks.tsv').find((row) => row.task_type === 'build');
      if (build === undefined) return notExercised('a contract is locked but the run has no build task to have been governed by it');
      const governing = locked.find((row) => row.task_id === build.task_id);
      if (governing === undefined) {
        return failed(`the locked contract governs ${locked.map((row) => row.task_id).join(', ')}, not the build task ${build.task_id}`);
      }
      // A lock with no instant cannot be ordered against anything, and the
      // migration's own CHECK forbids it — so reading one here means the dump,
      // not the run, is what is wrong. Unknown, never assumed to be early.
      if (!governing.locked_at) {
        return unknown(`${governing.contract_id} reads LOCKED with no lock instant, so it cannot be shown to precede the build`);
      }
      /**
       * LOCKED IS NOT THE SAME AS RUN UNDER. A contract can be locked, and
       * locked before the build, and the build can still have been claimed
       * under an OLDER revision — or its review under a NEWER one — and the
       * lock table alone cannot tell. The claim rows in `contract-events.tsv`
       * carry the revision and digest each bound task actually executed under,
       * and a `julius.contract.refused` row carrying a binding reason is the
       * runtime saying it refused to run one of them.
       *
       * A bundle without that dump used to keep "the weaker proof" and PASS on
       * the lock table alone. Without the claims, neither the binding the build
       * ran under nor whether the lock came BEFORE it can be shown, and a
       * contract agreed after the work is the thing this row exists to refuse,
       * so that is UNKNOWN now.
       */
      const contractEvents = ev.file('contract-events.tsv') === null ? null : ev.rows('contract-events.tsv');
      if (contractEvents === null) {
        return unknown(`${governing.contract_id} revision ${governing.contract_revision} reads locked at ${governing.locked_at}, but the bundle carries no readable contract-events dump, so the binding ${build.task_id} ran under, and whether the lock preceded it, are not measurable`);
      }
      const review = ev.rows('tasks.tsv').find((row) => row.role === 'INDEPENDENT_REVIEWER' && row.parent_task_id === build.task_id);
      const claimOf = (taskId) => contractEvents.filter((row) => row.event_type === 'julius.task.claimed' && row.task_id === taskId).pop();
      const bindingMismatch = (label, claim) => {
        if (claim === undefined) return `${label} carries no recorded contract binding on its claim`;
        if (claim.contract_revision !== governing.contract_revision) {
          return `${label} was claimed under revision ${claim.contract_revision} while revision ${governing.contract_revision} is the lock`;
        }
        if (claim.binding_digest !== governing.binding_digest) return `${label} was claimed under a digest that is not the lock's`;
        return null;
      };
      const refused = contractEvents.find((row) => row.event_type === 'julius.contract.refused'
        && (row.task_id === build.task_id || (review !== undefined && row.task_id === review.task_id))
        && /^(binding_|implementation_binding_absent)/.test(row.reason_code));
      if (refused !== undefined) {
        return failed(`the runtime refused ${refused.task_id} under this contract (${refused.reason_code}), so the build was not proven to run under its agreed terms`);
      }
      const buildMismatch = bindingMismatch(`build ${build.task_id}`, claimOf(build.task_id));
      if (buildMismatch !== null) return failed(buildMismatch);
      if (review !== undefined) {
        const reviewMismatch = bindingMismatch(`review ${review.task_id}`, claimOf(review.task_id));
        if (reviewMismatch !== null) return failed(reviewMismatch);
      }
      /**
       * THE LOCK CAME FIRST. Every claim of the build must follow the lock, by
       * the contract's own lock instant and by the ledger's order where the
       * lock event is dumped. A contract whose lock instant is later than a
       * claim of the work it governs was agreed after the fact.
       */
      const claims = contractEvents.filter((row) => row.event_type === 'julius.task.claimed' && row.task_id === build.task_id);
      const lockedAt = instant(governing.locked_at);
      const early = claims.find((row) => lockedAt !== null && instant(row.occurred_at) !== null && instant(row.occurred_at) < lockedAt);
      if (early !== undefined) {
        return failed(`${build.task_id} was claimed at ${early.occurred_at}, before ${governing.contract_id} revision ${governing.contract_revision} was locked at ${governing.locked_at}: the terms were agreed after the work began`);
      }
      const lockEvent = contractEvents.find((row) => row.event_type === 'julius.contract.locked' && row.contract_revision === governing.contract_revision);
      const sequenced = lockEvent !== undefined && count(lockEvent.sequence) !== null;
      const beforeLock = sequenced ? claims.find((row) => count(row.sequence) !== null && count(row.sequence) < count(lockEvent.sequence)) : undefined;
      if (beforeLock !== undefined) {
        return failed(`${build.task_id} was claimed at ledger position ${beforeLock.sequence}, before the lock at ${lockEvent.sequence}: the terms were agreed after the work began`);
      }
      const ordered = sequenced || (lockedAt !== null && claims.every((row) => instant(row.occurred_at) !== null));
      if (!ordered) {
        return unknown(`${governing.contract_id} is locked and ${build.task_id} was claimed under it, but neither the instants nor the ledger positions order the lock against the claim`);
      }
      return exercised(`${governing.contract_id} revision ${governing.contract_revision} locked at ${governing.locked_at} by ${governing.locked_by_evaluator_id || '(unrecorded)'}, governing ${build.task_id}; the build${review === undefined ? ' was' : ' and its review were'} claimed under that revision and digest`);
    },
  },
  {
    id: 'INDEPENDENT REVIEWER', path: true, missionRequired: true,
    files: ['relay-bridge/hermes-reviewer.ts', 'relay-bridge/hermes-remote-review.ts', 'src/relay/mission/reviewer-gate.ts'],
    prove: (ev) => {
      const gap = unreadable(ev, 'tasks.tsv', 'evidence.tsv');
      if (gap !== null) return cannotRead(gap, 'what the reviews did');
      const tasks = ev.rows('tasks.tsv');
      const reviews = tasks.filter((row) => row.role === 'INDEPENDENT_REVIEWER');
      const ran = reviews.filter((row) => row.state === 'SUCCEEDED' || row.state === 'FAILED');
      if (ran.length === 0) {
        return notExercised(reviews.length === 0 ? 'no INDEPENDENT_REVIEWER task in the run' : `no review ran to an end (${reviews.map((row) => row.state).join(', ')})`);
      }
      /**
       * A REVIEW THAT FOUND NOTHING IS THE BEST REVIEW, not a missing one.
       * What proves a reviewer worked is a REVIEW_FINDING evidence row OF ITS
       * OWN: the adapter writes one on the approve path (`status: PASSED`) and
       * one per finding on the changes-required path.
       *
       * AND EVERY REVIEW IS JUDGED. A successful plan review used to carry the
       * row while the build's review had FAILED. A failed review stands unless
       * a LATER review of the same work (the work itself, or its repair)
       * succeeded.
       */
      const byId = new Map(tasks.map((row) => [row.task_id, row]));
      const workOf = (taskId) => {
        const task = byId.get(taskId);
        return task !== undefined && task.task_type.startsWith('repair:') && task.parent_task_id ? task.parent_task_id : taskId;
      };
      const reviewed = (row) => evidenceOf(ev, row.task_id).filter((entry) => entry.evidence_type === 'REVIEW_FINDING');
      const broken = [];
      const good = [];
      for (const review of ran) {
        if (review.state === 'SUCCEEDED') {
          if (reviewed(review).length === 0) broken.push(`${review.task_id} SUCCEEDED with no review evidence of its own`);
          else good.push(review);
          continue;
        }
        const later = ran.find((other) => other.state === 'SUCCEEDED' && other.task_id !== review.task_id
          && workOf(other.parent_task_id) === workOf(review.parent_task_id)
          && count(other.ordinal) !== null && count(review.ordinal) !== null && count(other.ordinal) > count(review.ordinal)
          && reviewed(other).length > 0);
        if (later === undefined) {
          broken.push(`${review.task_id} FAILED${why(ev, review.task_id)} and no later review of ${workOf(review.parent_task_id) || 'its work'} succeeded`);
        }
      }
      if (broken.length > 0) return failed(broken.join('; '));
      const who = identities(ev, good);
      if (who.notReal.length > 0) return failed(`NOT A REAL PROVIDER — ${who.notReal.join('; ')}`);
      if (who.unknown.length > 0) return unknown(`the reviews SUCCEEDED, but which provider reviewed is unknown — ${who.unknown.join('; ')}`);
      const rows = good.reduce((sum, review) => sum + reviewed(review).length, 0);
      return exercised(`${good.length} review(s) SUCCEEDED, each with its own structured review (${rows} review evidence row(s), ${ev.rows('findings.tsv').length} finding(s)), on a real provider (${who.real.join(', ')})`);
    },
  },
  {
    /**
     * A MISSION THAT NEVER NEEDED A REPAIR HAS NOT FAILED AT REPAIRING — and a
     * mission whose repair could not even be created has.
     *
     * The row once read FAIL whenever no repair task existed, which made "the
     * reviewer approved the build first time" score identically to "the repair
     * loop is broken". It then read NOT EXERCISED whenever no repair task
     * existed, which made a REJECTED build whose repair was refused
     * (REPAIR_UNROUTABLE, REPAIR_BUDGET_DENIED: halted before any task exists)
     * read "no review rejected anything" — and a drill then rescued it. The
     * row is decided from what TRIGGERS a repair: a REPAIR decision is the
     * loop exercised, and it is FAILED unless a repair of that work SUCCEEDED
     * and was ACCEPTED on re-review.
     */
    id: 'REPAIR LOOP', path: true, missionRequired: false,
    files: ['src/relay/mission/julius/julius-repair-runtime.ts'],
    prove: (ev) => {
      const gap = unreadable(ev, 'tasks.tsv', 'decisions.tsv', 'failures.tsv');
      if (gap !== null) return cannotRead(gap, 'whether any review rejected work, and what became of it,');
      const tasks = ev.rows('tasks.tsv');
      const decisions = ev.rows('decisions.tsv');
      const byId = new Map(tasks.map((row) => [row.task_id, row]));
      const workOf = (taskId) => {
        const task = byId.get(taskId);
        return task !== undefined && task.task_type.startsWith('repair:') && task.parent_task_id ? task.parent_task_id : taskId;
      };
      const refusals = ev.rows('failures.tsv').filter((row) => row.event_type === 'julius.run.failed' && REPAIR_REFUSAL.test(row.reason_code ?? ''));
      if (refusals.length > 0) {
        return failed(`a review demanded a repair and the repair was refused: ${refusals.map((row) => `${row.reason_code}${row.task_id ? ` for ${row.task_id}` : ''}`).join(', ')} — no repair task, no attempt, no second review`);
      }
      const demanded = decisions.filter((row) => row.action === 'REPAIR');
      const repairs = tasks.filter((row) => row.task_type.startsWith('repair:'));
      if (demanded.length === 0 && repairs.length === 0) {
        return notExercised('decisions.tsv, tasks.tsv and failures.tsv are readable and hold no REPAIR decision, no repair task and no refused repair: no review rejected anything in this run');
      }
      const accepted = (task) => decisions.some((row) => row.task_id === task.task_id && (row.action === 'ACCEPT' || row.action === 'COMPLETE'));
      const subjects = [...new Set([...demanded.map((row) => workOf(row.task_id)), ...repairs.map((row) => row.parent_task_id)])];
      const broken = [];
      const repaired = [];
      for (const subject of subjects) {
        const mine = repairs.filter((row) => row.parent_task_id === subject);
        const good = mine.filter((row) => row.state === 'SUCCEEDED' && accepted(row));
        if (good.length === 0) {
          broken.push(mine.length === 0
            ? `${subject} was sent back for repair and no repair task exists`
            : `${subject}'s repair(s) ${mine.map((row) => `${row.task_id} ${row.state}${accepted(row) ? '' : ', not accepted'}`).join('; ')}: none SUCCEEDED and was ACCEPTED on re-review`);
          continue;
        }
        repaired.push(...good);
      }
      if (broken.length > 0) return failed(broken.join('; '));
      const who = identities(ev, repaired);
      if (who.notReal.length > 0) return failed(`NOT A REAL PROVIDER — ${who.notReal.join('; ')}`);
      if (who.unknown.length > 0) return unknown(`the repair(s) were accepted, but which provider made them is unknown — ${who.unknown.join('; ')}`);
      return exercised(`${subjects.length} piece(s) of work sent back for repair came back ACCEPTED on re-review (${repaired.map((row) => row.task_id).join(', ')}), repaired on a real provider (${who.real.join(', ')})`);
    },
  },
  {
    id: 'VERIFICATION', path: true, missionRequired: true,
    files: ['src/relay/mission/julius/julius-verification-runtime.ts'],
    prove: (ev) => {
      const gap = unreadable(ev, 'decisions.tsv', 'tasks.tsv');
      if (gap !== null) return cannotRead(gap, 'what verification decided');
      const decisions = ev.rows('decisions.tsv');
      if (decisions.length === 0) return notExercised('decisions.tsv is readable and verification recorded no decision in this run');
      // WORK THAT WAS REVIEWED MUST HAVE BEEN DECIDED. A successful review with
      // no decision about its work is verification that did not happen.
      const tasks = ev.rows('tasks.tsv');
      const byId = new Map(tasks.map((row) => [row.task_id, row]));
      const verifiable = (taskId) => ['plan', 'build', 'repair:plan', 'repair:build'].includes(byId.get(taskId)?.task_type ?? '');
      const reviewedWork = [...new Set(tasks
        .filter((row) => row.role === 'INDEPENDENT_REVIEWER' && row.state === 'SUCCEEDED' && verifiable(row.parent_task_id))
        .map((row) => row.parent_task_id))];
      const undecided = reviewedWork.filter((taskId) => !decisions.some((row) => row.task_id === taskId));
      if (undecided.length > 0) {
        return failed(`${undecided.join(', ')} ${undecided.length === 1 ? 'was' : 'were'} reviewed successfully and verification recorded no decision about ${undecided.length === 1 ? 'it' : 'them'}`);
      }
      return exercised(`verification recorded ${decisions.length} decision(s): ${decisions.map((row) => `${row.action}/${row.reason_code}`).join(', ')}`);
    },
  },
  {
    id: 'VERIFIED COMPLETION', path: true, missionRequired: true,
    files: ['src/relay/mission/julius/julius-lifecycle-runtime.ts'],
    prove: (ev) => {
      if (ev.file('runs.tsv') === null) return cannotRead('runs.tsv', 'how the run ended');
      if (ev.run === null) return noRun(ev);
      if (ev.run.state !== 'COMPLETED') return failed(`${runLabel(ev)} ended ${ev.run.state}`);
      /**
       * AND THE ENTRYPOINT MUST SAY SO TOO. A two-run bundle once printed BETA:
       * READY because the gate read the older, COMPLETED run's row while the
       * accepted run's own evidence said `RESULT: FAILED after 2 ticks`. The
       * accepted run's RESULT line is required and must agree: absent or
       * ambiguous is no completion, and a different word is a failure.
       */
      const result = resultFor(ev, ev.run.run_id);
      if (result === null) {
        const lines = resultsOf(ev);
        const why = lines.length === 0 ? 'absent or unreadable'
          : lines.some((line) => line.run === null) ? `ambiguous: ${lines.filter((line) => line.run === null).map((line) => `\`${line.line}\``).join(', ')} names no run, so it could be this run's`
            : lines.some((line) => line.run === ev.run.run_id) ? `ambiguous: its RESULT lines disagree (${lines.filter((line) => line.run === ev.run.run_id).map((line) => `\`${line.line}\``).join(', ')})`
              : 'absent (no RESULT line names it)';
        return unknown(`${runLabel(ev)} reads COMPLETED in runs.tsv, but the entrypoint's RESULT line for it is ${why}, so the job's own account of how it ended is missing`);
      }
      if (result.state !== 'COMPLETED' || result.stalled) {
        return failed(`the entrypoint reported RESULT: ${result.state}${result.stalled ? ' (stalled)' : ''} for ${runLabel(ev)}, while runs.tsv says COMPLETED`);
      }
      // COMPLETED BY REAL PROVIDERS, or it is not a verified completion: a run
      // a drill's scripted adapters drove to COMPLETED proves the pipeline, not
      // that Julius can deliver a mission.
      if (ev.file('tasks.tsv') === null) return cannotRead('tasks.tsv', `which providers did ${runLabel(ev)}'s work`);
      const done = ev.rows('tasks.tsv').filter((row) => WORK_ROLES.has(row.role) && row.state === 'SUCCEEDED');
      if (done.length === 0) return unknown(`${runLabel(ev)} reads COMPLETED with no role task that succeeded, so what it completed is unknown`);
      const who = identities(ev, done);
      if (who.notReal.length > 0) return failed(`${runLabel(ev)} reached COMPLETED, but NOT A REAL PROVIDER did its work — ${who.notReal.join('; ')}`);
      if (who.unknown.length > 0) return unknown(`${runLabel(ev)} reached COMPLETED, but which provider did its work is unknown — ${who.unknown.join('; ')}`);
      return exercised(`${runLabel(ev)} reached COMPLETED, and every one of its ${done.length} role task(s) ran on a real provider (${who.real.join(', ')})`);
    },
  },
  {
    id: 'WONDER WEB OUTPUT', path: false, missionRequired: false,
    anyOf: ['src/relay/mission/wonder-web/index.ts', 'src/relay/ui/wonder-web/index.ts', 'relay-bridge/wonder-web/index.ts'],
    prove: (ev) => {
      /**
       * Reached only once one of those modules exists — and it must be able to
       * PASS, or this row is the constant the ACCOUNT row used to be.
       *
       * A completed run is the precondition: Wonder Web opens what a mission
       * produced, so a mission that produced nothing has nothing to open. The
       * proof itself is `wonder-web.tsv`, the dump whoever builds this adds,
       * one row per mission output actually opened. Naming it here is the
       * contract: build the surface, dump what it opened, and the row flips.
       */
      if (ev.file('runs.tsv') === null) return cannotRead('runs.tsv', 'whether the run produced anything to open');
      if (ev.run === null && ev.allRows('runs.tsv').length > 0) return noRun(ev);
      if (ev.run === null || ev.run.state !== 'COMPLETED') {
        return notExercised('no completed run, so there is no mission output for Wonder Web to open');
      }
      /**
       * NO PRODUCER, NO PROOF. Nothing writes `wonder-web.tsv` yet, so the one
       * in a bundle was put there by hand: G2's, with no `run_id`, beside a
       * typed `ghu-` tenant and genuine drill ledgers, printed BETA: READY and
       * exited 0. The file is run-scoped now (a readable one must name its
       * run, or the bundle is unbound), and until this checkout's evidence dump
       * has a query that writes it, the row is UNKNOWN whatever the file says.
       */
      if (!dumpWrites('wonder-web.tsv')) {
        return unknown(`a completed run exists, and no query in this checkout's evidence dump (${EVIDENCE_DUMP}) writes wonder-web.tsv, so what Wonder Web opened is not on the record${ev.file('wonder-web.tsv') === null ? '' : ': the wonder-web.tsv in this bundle is no dump\'s output'}`);
      }
      if (ev.file('wonder-web.tsv') === null) {
        return unknown('a completed run exists, but this bundle carries no readable wonder-web dump');
      }
      const opened = ev.rows('wonder-web.tsv');
      return opened.length > 0
        ? exercised(`${opened.length} mission output(s) recorded as opened in Wonder Web`)
        : notExercised('a completed run exists and Wonder Web opened none of its output');
    },
  },
  {
    id: 'PROJECT BRAIN PERSISTENCE', path: false, missionRequired: false,
    files: ['src/relay/mission/julius/julius-context-snapshot.ts', 'src/relay/shared/llmops/brain-memory.ts'],
    prove: (ev) => {
      if (ev.file('project-brain.tsv') === null) {
        return unknown('this bundle carries no readable Project Brain dump, so no durable brain write is observable');
      }
      if (ev.file('tasks.tsv') === null) return cannotRead('tasks.tsv', 'whether any worker ran to write the brain');
      if (ev.run === null) return noRun(ev);
      /**
       * SEEDED IS NOT WRITTEN, and neither is a FAILURE TO WRITE the same as
       * never having had the chance. The bootstrap inserts the mission's
       * objective and constraints with `worker_id = 'relay-bootstrap'` and no
       * task id, before a worker exists. A Project Brain that only ever holds
       * those rows after a run that dispatched workers is a brain the run did
       * not write back to — the decisions, findings, repairs and handoffs that
       * migration 014 defines did not persist. That is a FAILED write, not an
       * unexercised path, because the workers ran.
       */
      const entries = ev.rows('project-brain.tsv');
      if (entries.length === 0) return failed(`the Project Brain is empty for ${runLabel(ev)}: not even the mission seed persisted`);
      const written = entries.filter((row) => row.worker_id !== 'relay-bootstrap' || row.task_id !== '');
      if (written.length > 0) {
        return exercised(`${written.length} of ${entries.length} Project Brain entries were written during the run (kinds: ${[...new Set(written.map((row) => row.entry_kind))].join(', ')})`);
      }
      const dispatched = ev.rows('tasks.tsv').some((row) => row.state === 'SUCCEEDED' || row.state === 'FAILED');
      return dispatched
        ? failed(`all ${entries.length} Project Brain entries are bootstrap seeds; the run wrote none back`)
        : notExercised(`all ${entries.length} Project Brain entries are bootstrap seeds, and no task ever reached a worker to write one`);
    },
  },
  {
    /**
     * THE ROW THE TWO AXES WERE BUILT FOR.
     *
     * A healthy mission does not crash, so it never recovers, and demanding
     * that it crash to score this row would be asking the product to break
     * itself for a number. The mission axis reports honestly that nothing
     * restarted; the capability axis reports whether the real production
     * recovery path — the expired-lease sweep, the requeue, a FRESH process
     * picking the run back up out of PostgreSQL — has been driven for real by a
     * drill whose attestation is current against this tree.
     *
     * ONLY A RECOVERY THAT RECOVERED IS ONE. Any recovery action used to read
     * as proof, including the sweep FAILING a task (RETRIES_EXHAUSTED,
     * RECOVERY_LIMIT_REACHED) and the terminal sweep closing an invocation the
     * run left unsettled — which is an INTEGRITY failure, not a recovery. A
     * REQUEUE counts only when its task then SUCCEEDED.
     */
    id: 'RESTART / RECOVERY', path: false, missionRequired: false,
    // THE TWO FILES THAT ARE THE CAPABILITY, and not the barrel beside them.
    // `src/relay/persistence/index.ts` stood here as a token for "durable
    // persistence exists"; now that this list decides what a drill must have
    // driven to cover the row, naming a re-export would let an attestation
    // claim a file it never exercised. What recovery IS: the deterministic
    // plan, and the transactional sweep that reclaims an expired lease.
    files: ['src/relay/mission/julius/julius-recovery.ts', 'src/relay/persistence/julius-recovery-postgres.ts'],
    prove: (ev) => {
      const gap = unreadable(ev, 'failures.tsv', 'tasks.tsv');
      if (gap !== null) return cannotRead(gap, 'whether anything was interrupted and recovered');
      const failures = ev.rows('failures.tsv');
      const integrity = failures.filter((row) => row.recovery_action === 'CLOSE_UNSETTLED_TOOL_INVOCATION'
        || row.julius_code === 'TOOL_INVOCATION_UNRESOLVED' || row.failure_class === 'infrastructure_evidence_integrity');
      if (integrity.length > 0) {
        return failed(`INTEGRITY FAILURE — ${integrity.length} tool invocation(s) of ${[...new Set(integrity.map((row) => row.task_id || 'the run'))].join(', ')} outlived the run and were closed unresolved (TOOL_INVOCATION_UNRESOLVED): an unsettled effect is never a recovery`);
      }
      const actions = failures.filter((row) => row.event_type === 'julius.recovery.action' || row.recovery_action);
      const gaveUp = actions.filter((row) => row.recovery_action === 'FAIL_TASK');
      if (gaveUp.length > 0) {
        return failed(`the recovery sweep FAILED ${gaveUp.map((row) => `${row.task_id || 'a task'} (${row.reason_code || 'no reason'})`).join(', ')}: recovery gave up on the work it reclaimed`);
      }
      const tasks = new Map(ev.rows('tasks.tsv').map((row) => [row.task_id, row]));
      const broken = [];
      const pending = [];
      const recovered = [];
      for (const taskId of new Set(actions.filter((row) => row.recovery_action === 'REQUEUE').map((row) => row.task_id))) {
        const task = tasks.get(taskId);
        if (task === undefined) pending.push(`${taskId} was requeued and is not in tasks.tsv`);
        else if (task.state === 'SUCCEEDED') recovered.push(taskId);
        else if (TERMINAL_TASK_STATES.has(task.state)) broken.push(`${taskId} was requeued and then ended ${task.state}`);
        else pending.push(`${taskId} was requeued and is still ${task.state}`);
      }
      if (broken.length > 0) return failed(broken.join('; '));
      if (pending.length > 0) return unknown(`recovery requeued work whose outcome this bundle does not show: ${pending.join('; ')}`);
      if (recovered.length > 0) {
        return exercised(`${recovered.length} task(s) whose lease expired were reclaimed, requeued and then SUCCEEDED (${recovered.join(', ')})`);
      }
      if (actions.length > 0) {
        return unknown(`recovery acted (${[...new Set(actions.map((row) => row.recovery_action || row.event_type))].join(', ')}) and no reclaimed task shows whether it recovered anything`);
      }
      const held = [...tasks.values()].filter((row) => row.state === 'ACTIVE');
      if (ev.run !== null && TERMINAL_RUN_STATES.has(ev.run.state) && held.length > 0) {
        return unknown(`${held.map((row) => row.task_id).join(', ')} ${held.length === 1 ? 'was' : 'were'} left ACTIVE by a run that ended ${ev.run.state}: whether a lease expired and was never reclaimed is not in this bundle`);
      }
      return notExercised('failures.tsv and tasks.tsv are readable, and show no recovery action and no task left holding a lease: nothing was interrupted in this run');
    },
  },
  {
    /**
     * A RETRYABLE FAILURE IS WHAT TRIGGERS RECOVERY, and the absence of a
     * `retry.scheduled` row is not its absence: the row used to read "nothing
     * failed retryably" while a task had FAILED with `errorRetryable=true`.
     *
     * AND A SCHEDULED RETRY IS NOT A RETRY. The coordinator writes
     * `retry.scheduled` when it classifies a failure retryable; the pipeline
     * then asks the run's policy, which may decline — a SUPERVISED run stops
     * and waits for a person (`SUPERVISED_STOP`), a review's ceiling is one
     * attempt — and writes the `task.failed` that ends the task. With automatic
     * retry off the coordinator writes that `task.failed` itself and schedules
     * nothing. Those are the run's policy working, not recovery failing, and a
     * reading that called them FAILED would fail correct supervised runs. So
     * every task that failed retryably is judged by what actually happened: it
     * recovered if it then SUCCEEDED; recovery failed if it WAS retried and
     * still ended FAILED; and recovery was not exercised if no retry ever ran.
     */
    id: 'FAILURE RECOVERY', path: false, missionRequired: false,
    files: ['src/relay/mission/julius/julius-execution-coordinator.ts', 'src/relay/mission/julius/julius-continuation.ts'],
    prove: (ev) => {
      const gap = unreadable(ev, 'failures.tsv', 'tasks.tsv');
      if (gap !== null) return cannotRead(gap, 'whether anything failed retryably and was recovered');
      const failures = ev.rows('failures.tsv');
      const triggers = failures.filter((row) => row.task_id && (row.error_retryable === 'true' || row.event_type === 'julius.retry.scheduled'));
      if (triggers.length === 0) {
        return notExercised('failures.tsv and tasks.tsv are readable and no failure in this run was retryable, so there was nothing to recover from');
      }
      const tasks = new Map(ev.rows('tasks.tsv').map((row) => [row.task_id, row]));
      const broken = [];
      const pending = [];
      const recovered = [];
      const stopped = [];
      for (const taskId of new Set(triggers.map((row) => row.task_id))) {
        const cause = triggers.filter((row) => row.task_id === taskId).map((row) => row.failure_class || row.julius_code).find(Boolean) ?? 'retryable';
        const task = tasks.get(taskId);
        if (task === undefined) { pending.push(`${taskId} (${cause}) is not in tasks.tsv`); continue; }
        if (task.state === 'SUCCEEDED') { recovered.push(`${taskId} (${cause})`); continue; }
        if (task.state !== 'FAILED') { pending.push(`${taskId} (${cause}) is ${task.state}`); continue; }
        // Each `retry.scheduled` the run went on from is a retry that ran. The
        // last one is declined when the ending `task.failed` is the retryable
        // decline the pipeline writes.
        const scheduled = failures.filter((row) => row.task_id === taskId && row.event_type === 'julius.retry.scheduled').length;
        const end = failures.filter((row) => row.task_id === taskId && row.event_type === 'julius.task.failed').pop();
        const declined = end !== undefined && end.error_retryable === 'true';
        const ran = Math.max(0, scheduled - (declined && scheduled > 0 ? 1 : 0));
        const reason = end?.reason_code ? ` (${end.reason_code})` : '';
        if (ran > 0) broken.push(`${taskId} failed retryably (${cause}), was retried ${ran} time(s), and still ended FAILED${reason}`);
        else stopped.push(`${taskId} failed retryably (${cause}) and no retry ran${reason || ' (none was scheduled: the run does not retry automatically)'}`);
      }
      if (broken.length > 0) return failed(broken.join('; '));
      if (pending.length > 0) return unknown(`a retryable failure's outcome is not in this bundle: ${pending.join('; ')}`);
      if (recovered.length > 0) return exercised(`${recovered.length} task(s) failed retryably and then SUCCEEDED (${recovered.join(', ')})`);
      return notExercised(`${stopped.join('; ')}: the run's policy did not retry, so automatic recovery was never engaged — a policy stop, not a recovery that failed`);
    },
  },
  {
    /**
     * THE BOUNDARY, NOT THE TEST.
     *
     * This row judges whether the mission stayed inside its boundaries: a
     * permission denial, an executor refusing an effect as outside the
     * worker's authority, a change to a path the locked contract did not
     * allow, a tool effect left unsettled or closed with an unknown outcome,
     * or an effect Julius recorded that the independent executor holds no
     * receipt for.
     * It does NOT judge whether a command exited zero: the mission's own test
     * starts red by design, and a failing test that was run, receipted and
     * settled with its exit code is the repair loop's business, not a breach.
     *
     * AND IT PASSES ONLY ON SOMETHING CHECKED. Zero invocations, or a dump that
     * could not be read, used to read PASS ("0 tool invocation(s) all
     * SUCCEEDED") beside whatever receipts the executor root held — including a
     * preflight's. Receipts are now tied to THIS run's invocations (a receipt
     * scope is the sha256 of the invocation id the executor was handed) and
     * the others are only counted. `receipt-ids.txt` lists scope NAMES: the
     * receipts' signatures are not in the bundle, and this row says so rather
     * than calling them signed.
     */
    id: 'PERMISSIONS / MISSION BOUNDARIES', path: false, missionRequired: false,
    files: ['relay-bridge/hosted-coding-agent/hosted-envelope.ts', 'relay-bridge/julius/sandbox-limits.ts', 'src/relay/workspace/julius-tools/executor-operation-request.ts'],
    prove: (ev) => {
      if (ev.file('tool-invocations.tsv') === null) return cannotRead('tool-invocations.tsv', 'what ran inside the boundary');
      // FAILURES FIRST: each is a breach whatever else the bundle cannot say.
      if (ev.file('worker-diagnostics.tsv') !== null) {
        const denied = ev.rows('worker-diagnostics.tsv').filter((row) => row.permission_denials && row.permission_denials !== '0');
        if (denied.length > 0) return failed(`${denied.length} worker run(s) reported a permission denial (${[...new Set(denied.map((row) => row.task_id))].join(', ')})`);
        const refused = ev.rows('worker-diagnostics.tsv').filter((row) => BOUNDARY_REFUSALS.has(row.executor_refusal));
        if (refused.length > 0) return failed(`the executor refused ${refused.length} effect(s) as outside the worker's authority (${[...new Set(refused.map((row) => `${row.task_id}: ${row.executor_refusal}`))].join(', ')})`);
      }
      const scope = ev.file('scope.tsv') === null ? [] : ev.rows('scope.tsv');
      const violations = scope.filter((row) => row.event_type === 'julius.coder.scope.violated'
        || (count(row.scope_violations) ?? 0) > 0 || (count(row.own_scope_violations) ?? 0) > 0);
      const scopeEvidence = ev.file('evidence.tsv') === null ? [] : ev.rows('evidence.tsv')
        .filter((row) => /:scope$/u.test(row.evidence_id) && row.evidence_type === 'DIFF' && row.status === 'FAILED');
      if (violations.length > 0 || scopeEvidence.length > 0) {
        const named = [...new Set([...violations.map((row) => `${row.task_id}${row.rule ? ` ${row.rule}` : ''}`), ...scopeEvidence.map((row) => row.evidence_id)])];
        return failed(`the coder changed what its locked contract did not allow (${named.join(', ')})`);
      }
      const invocations = ev.rows('tool-invocations.tsv');
      const open = invocations.filter((row) => OPEN_INVOCATION_STATES.has(row.state));
      if (open.length > 0) {
        return failed(`${open.length} tool invocation(s) were left unsettled (${open.map((row) => `${row.invocation_id} ${row.state}`).join(', ')}): an effect whose outcome nobody recorded is a boundary nobody can vouch for`);
      }
      const unknownOutcome = invocations.filter((row) => row.recovery_state === 'UNKNOWN_OUTCOME');
      const closed = ev.rows('failures.tsv').filter((row) => row.recovery_action === 'CLOSE_UNSETTLED_TOOL_INVOCATION');
      if (unknownOutcome.length > 0 || closed.length > 0) {
        return failed(`${Math.max(unknownOutcome.length, closed.length)} tool invocation(s) were closed with an UNKNOWN outcome (${[...new Set([...unknownOutcome.map((row) => row.invocation_id), ...closed.map((row) => row.task_id)])].join(', ')}): whether the executor ran them is unknown to Julius`);
      }
      const policyDenied = invocations.filter((row) => row.state === 'DENIED');
      if (policyDenied.length > 0) return failed(`${policyDenied.length} tool invocation(s) were DENIED by policy: a worker asked for an effect outside its boundary`);
      const receiptFile = ev.file('receipt-ids.txt');
      const receipts = new Set((receiptFile ?? '').split('\n').map((line) => line.trim()).filter((line) => /^[0-9a-f]{64}$/u.test(line)));
      const executed = invocations.filter((row) => EXECUTED_INVOCATION_STATES.has(row.state));
      if (receiptFile !== null) {
        const unsigned = executed.filter((row) => !receipts.has(sha256Hex(row.invocation_id)));
        if (unsigned.length > 0) {
          return failed(`${unsigned.length} tool invocation(s) settled with no executor receipt scope of their own (${unsigned.map((row) => `${row.invocation_id} ${row.state}`).join(', ')}): Julius recorded an effect the independent executor holds no receipt for`);
        }
      }
      /**
       * THEN WHAT THE BUNDLE CANNOT SAY, which is never a pass. Every input a
       * FAILURE above is read from is on this list: an unreadable
       * `failures.tsv` hid the terminal sweep's UNKNOWN_OUTCOME closure and
       * read PASS where the readable one reads FAIL. `tasks.tsv` says which
       * coder tasks must have had their change sets checked.
       */
      const gap = unreadable(ev, 'worker-diagnostics.tsv', 'receipt-ids.txt', 'scope.tsv', 'evidence.tsv', 'failures.tsv', 'tasks.tsv');
      if (gap !== null) return cannotRead(gap, 'whether the boundary held');
      /**
       * SOMETHING MUST HAVE RUN INSIDE THE BOUNDARY. Zero invocations, or only
       * invocations that never executed (CANCELLED before dispatch, the
       * sweep's closures), used to read "0 tool invocation(s) … ran under an
       * executor receipt scope": a pass on nothing. And a state the migration
       * does not define is not one this row can vouch for.
       */
      const strange = invocations.filter((row) => !KNOWN_INVOCATION_STATES.has(row.state));
      if (strange.length > 0) {
        return unknown(`${strange.map((row) => `${row.invocation_id} ${row.state || '(no state)'}`).join(', ')} ${strange.length === 1 ? 'is in a state' : 'are in states'} no tool invocation can be in, so what ${strange.length === 1 ? 'it' : 'they'} did is unknown`);
      }
      if (executed.length === 0) {
        return unknown(invocations.length === 0
          ? `no tool invocation of ${runLabel(ev)} is recorded, so no effect was shown to run inside the boundary — a bundle that checked nothing cannot pass`
          : `none of the ${invocations.length} tool invocation(s) of ${runLabel(ev)} executed (${[...new Set(invocations.map((row) => row.state))].join(', ')}), so no effect was shown to run inside the boundary — a bundle that checked nothing cannot pass`);
      }
      /**
       * EVERY CHANGE SET THE CODER LEFT WAS CHECKED AGAINST A SCOPE — shown, not
       * assumed. "Unchecked" used to fire only on an explicit
       * `scope_checked=false`, so a `scope.tsv` holding no row at all read PASS
       * beside a coder that changed the workspace, and so did the path where
       * Julius could not read the coder's implementation
       * (`coder.report.refused`), which writes no implementation row. Now a
       * coder task that SUCCEEDED must carry an implementation row whose change
       * set was captured and checked; a coder task whose implementation could
       * not be read, or whose attempt's workspace could not be captured, is
       * unknown. A FAILED coder task that reported no implementation at all
       * changed nothing Julius could have checked.
       */
      const coders = ev.rows('tasks.tsv').filter((row) => row.role === 'CODING_AGENT' && (row.state === 'SUCCEEDED' || row.state === 'FAILED'));
      const uncheckable = [];
      for (const coder of coders) {
        const mine = scope.filter((row) => row.task_id === coder.task_id);
        const implementations = mine.filter((row) => row.event_type === 'julius.coder.implementation.recorded');
        if (mine.some((row) => row.event_type === 'julius.coder.report.refused') && implementations.length === 0) {
          uncheckable.push(`${coder.task_id}'s implementation could not be read (coder.report.refused), so what it changed was never checked`);
        } else if (coder.state === 'SUCCEEDED' && implementations.length === 0) {
          uncheckable.push(`${coder.task_id} SUCCEEDED with no implementation record in scope.tsv, so its change set was never shown checked against a scope`);
        } else if (implementations.some((row) => row.scope_checked !== 'true')) {
          uncheckable.push(`${coder.task_id}'s change set was not checked against a scope (scope_checked ${implementations.map((row) => row.scope_checked || 'empty').join(', ')})`);
        } else if (implementations.some((row) => row.workspace_captured === 'false')) {
          uncheckable.push(`${coder.task_id}'s workspace was not captured, so its change set is unknown rather than clean`);
        } else if (mine.some((row) => row.event_type === 'julius.coder.attempt.workspace' && row.attempt_captured === 'false') && implementations.length === 0) {
          uncheckable.push(`${coder.task_id}'s attempt left a workspace nobody captured, so what it changed is unknown`);
        }
      }
      if (uncheckable.length > 0) {
        return unknown(`${uncheckable.join('; ')}: a forbidden edit could not have been seen`);
      }
      const unfinished = executed.filter((row) => row.state !== 'SUCCEEDED');
      if (unfinished.length > 0 && !(ev.header('tool-invocations.tsv') ?? []).includes('exit_code')) {
        return unknown(`${unfinished.length} invocation(s) ended ${[...new Set(unfinished.map((row) => row.state))].join(', ')} and this bundle carries no exit codes, so a test that ran and failed cannot be told from an effect that never settled`);
      }
      const exitless = unfinished.filter((row) => row.exit_code === '');
      if (exitless.length > 0) {
        return unknown(`${exitless.map((row) => `${row.invocation_id} ${row.state}`).join(', ')} ended with no exit code, so whether the executor ran ${exitless.length === 1 ? 'it' : 'them'} to an end is unknown`);
      }
      const evidenced = new Set(ev.rows('evidence.tsv').map((row) => row.evidence_id));
      const unevidenced = executed.filter((row) => !evidenced.has(`tool:${row.invocation_id}`));
      if (unevidenced.length > 0) {
        return unknown(`${unevidenced.map((row) => row.invocation_id).join(', ')} settled with no evidence row of its own, so what ${unevidenced.length === 1 ? 'it' : 'they'} did is not on the record`);
      }
      const mine = new Set(executed.map((row) => sha256Hex(row.invocation_id)));
      const others = [...receipts].filter((scope) => !mine.has(scope)).length;
      const nonZero = unfinished.length;
      return exercised(`${executed.length} tool invocation(s) of ${runLabel(ev)} ran under an executor receipt scope of their own (its name only: the receipt's signature is the executor's to verify, not this gate's) and settled with evidence (${executed.length - nonZero} SUCCEEDED, ${nonZero} ended non-zero with an exit code recorded: a failing test is the repair loop's business, not a breach); none left open; no permission denial; no scope violation${others > 0 ? `; ${others} other receipt scope(s) in the executor root belong to no invocation of this run and are not counted` : ''}`);
    },
  },
  {
    /**
     * EVERY RESERVATION SETTLED AT MOST ONCE, read from the run itself.
     *
     * `cost-accounting.tsv` sums every `budget.settled` row per role, and
     * deliberately does not deduplicate. A reservation settled twice therefore
     * counts twice, which is the defect a release after a commit used to cause
     * (#297). The dump lists every reservation with more than one settled row in
     * `settlement-integrity.tsv`. Any row there FAILS this capability, and names
     * the reservation.
     *
     * An unreadable file (absent, the dump's `unavailable`, zero bytes, or a
     * header the dump never finished with its `(N rows)` footer) is UNKNOWN,
     * never a pass: "no duplicate was found" and "nobody looked" are opposite
     * facts. A header and `(0 rows)` is the dump saying it looked and found
     * none, and is the healthy answer.
     * A drill cannot stand in for it (`missionRequired`), because the question is
     * what THIS run's ledger says. The drill ledger's own rows are untouched: this
     * is a row of its own, and a drill evaluation reads it as UNKNOWN, like every
     * other mission row.
     */
    id: 'SETTLEMENT INTEGRITY', path: false, missionRequired: true,
    files: ['src/relay/mission/julius/julius-execution-coordinator.ts', 'src/relay/mission/julius/julius-task-pipeline.ts', 'src/relay/mission/julius/julius-cost-accounting.ts'],
    prove: (ev) => {
      if (ev.file('settlement-integrity.tsv') === null) {
        return unknown('this bundle carries no readable settlement-integrity dump (absent, empty, cut short, or the dump wrote `unavailable`), so whether any reservation was settled twice is unknown');
      }
      const duplicates = ev.rows('settlement-integrity.tsv');
      if (duplicates.length > 0) {
        return failed(`${duplicates.length} reservation(s) settled more than once, so cost-accounting.tsv overstates the spend: ${duplicates.map((row) => `${row.reservation_id} (${row.role}) x${row.settled_rows}`).join(', ')}`);
      }
      if (ev.file('budget.tsv') === null) {
        return unknown('no reservation is listed as settled twice, but the budget dump is unreadable, so there is no settlement it was checked against');
      }
      const settled = ev.rows('budget.tsv').filter((row) => row.event_type === 'julius.budget.settled');
      return settled.length === 0
        ? notExercised('no reservation was settled, so none could be settled twice')
        : exercised(`${settled.length} settlement(s) across ${new Set(settled.map((row) => row.reservation_id)).size} reservation(s), none settled twice`);
    },
  },
];

/* ------------------------------------------------------------- evaluation */

/**
 * The verdict, derived from the two axes and nothing else.
 *
 * EXERCISED wins outright — mission proof is the strongest thing a gate can
 * hold and needs no drill. FAILED loses outright, and this is the line that
 * stops the third verdict becoming a laundry: a run that exercised a capability
 * and broke it reads FAIL even where a drill proves the path works. And a drill
 * speaks only where the mission's READABLE rows say it genuinely did not reach
 * the behaviour: UNKNOWN is a bundle that cannot say, and a drill proving the
 * path cannot say what this run did either.
 */
function verdictOf(mission, capability, admissible) {
  if (mission === 'EXERCISED') return 'PASS';
  if (mission === 'FAILED') return 'FAIL';
  return admissible && mission === 'NOT EXERCISED' && capability === 'PROVEN' ? 'CAPABILITY PROVEN' : 'FAIL';
}

export function evaluate(evidenceDir, options = {}) {
  const loaded = loadEvidence(evidenceDir);
  const binding = bindingOf(loaded);
  const ev = scoped(loaded, binding);
  const proofs = loadProofs(loaded, options.capabilityDir ?? null);
  const results = CAPABILITIES.map((capability) => {
    const probed = probe(capability);
    // `implementedBy` is reported, not merely used: a drill has to exercise
    // exactly these files for its attestation to cover this row, and leaving
    // whoever writes one to guess the list from the gate's source is how a
    // drill comes to prove something adjacent to the capability it claims.
    const common = {
      id: capability.id, path: capability.path, missionRequired: capability.missionRequired,
      implementedBy: probed.files,
    };
    if (!probed.built) {
      return {
        ...common, verdict: 'NOT BUILT', mission: 'NOT BUILT', capability: 'NOT BUILT',
        basis: probed.where, capabilityBasis: 'nothing is built to have been drilled',
      };
    }
    let { mission, basis } = loaded.present
      ? capability.prove(ev)
      : unknown('no live evidence bundle was read, so this run cannot say');
    // AN UNBOUND BUNDLE KEEPS ITS FAILURES AND VOUCHES FOR NOTHING ELSE.
    if (loaded.present && !binding.bound && (mission === 'EXERCISED' || mission === 'NOT EXERCISED')) {
      basis = `UNBOUND — ${binding.reason}. Its rows alone would say: ${basis}`;
      mission = 'UNKNOWN';
    }
    // The proof is looked up even where it is inadmissible, so a ledger that
    // claims a mission-required capability is REPORTED as inadmissible rather
    // than silently ignored. A gate that quietly drops evidence teaches whoever
    // wrote it that the evidence was accepted.
    const proof = capabilityProof(proofs, capability, probed);
    const admissible = !capability.missionRequired;
    const verdict = verdictOf(mission, proof.state, admissible);
    const capabilityBasis = admissible
      ? proof.basis
      : `a drill cannot stand in for this capability: a mission must walk it itself${proof.state === 'UNPROVEN' && proof.basis.startsWith('no drill') ? '' : ` (an attestation is present and inadmissible: ${proof.basis})`}`;
    let rowBasis = basis;
    if (verdict === 'CAPABILITY PROVEN') {
      rowBasis = `NOT EXERCISED THIS MISSION — ${basis}; proven instead by a drill: ${proof.basis}`;
    } else if (admissible && mission === 'UNKNOWN' && proof.state === 'PROVEN') {
      rowBasis = `THIS MISSION CANNOT SAY WHETHER IT WAS EXERCISED — ${basis}; a drill proves the path (${proof.basis}), but a drill stands in only for a mission whose readable rows show it did not happen, never for one that cannot say`;
    } else if (admissible && proof.state === 'STALE') {
      rowBasis = `${basis}; the drill that once proved it is stale: ${proof.basis}`;
    }
    return {
      ...common, verdict, mission,
      capability: admissible ? proof.state : 'NOT ADMISSIBLE',
      capabilityBasis,
      basis: rowBasis,
    };
  });
  /**
   * THE TOP THREE, DETERMINISTICALLY. Creation-path capabilities that are
   * neither exercised nor proven come first, in path order — a mission cannot
   * reach a completion it cannot walk to — then everything else in declared
   * order.
   */
  const open = (row) => row.verdict !== 'PASS' && row.verdict !== 'CAPABILITY PROVEN';
  const gaps = [
    ...results.filter((row) => row.path && open(row)),
    ...results.filter((row) => !row.path && open(row)),
  ].slice(0, 3);
  const tally = (key, ...values) => results.filter((row) => values.includes(row[key])).length;
  return {
    evidence: loaded.present ? loaded.source : null,
    evidenceNote: loaded.source,
    capabilitySource: proofs.rows.length > 0 ? proofs.source : null,
    binding: {
      bound: binding.bound,
      reason: binding.reason,
      runId: binding.run?.run_id ?? null,
      runState: binding.run?.state ?? null,
      commit: binding.manifest?.commit ?? null,
      readingCommit: readingCommit(),
      mode: binding.manifest?.mode ?? null,
      workflowRunId: binding.manifest?.workflow_run_id ?? null,
    },
    results,
    gaps,
    summary: {
      total: results.length,
      exercised: tally('mission', 'EXERCISED'),
      failed: tally('mission', 'FAILED'),
      notExercised: tally('mission', 'NOT EXERCISED'),
      unknown: tally('mission', 'UNKNOWN'),
      provenByMission: tally('verdict', 'PASS'),
      provenByDrill: tally('verdict', 'CAPABILITY PROVEN'),
      unproven: tally('verdict', 'FAIL'),
      notBuilt: tally('verdict', 'NOT BUILT'),
    },
  };
}

/* ----------------------------------------------------------------- output */

function main() {
  const report = evaluate(option('evidence'), { capabilityDir: option('capability') });
  if (flag('json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const out = (line) => process.stdout.write(`${line}\n`);
    const s = report.summary;
    const b = report.binding;
    out('WONDERLAND BETA GATE');
    out(`  evidence:   ${report.evidence ?? `NONE (${report.evidenceNote ?? 'no --evidence given'})`}`);
    out(`  binding:    ${b.bound
      ? `BOUND — run ${b.runId} (ended ${b.runState}), mode=${b.mode}, commit ${String(b.commit).slice(0, 12)}, workflow run ${b.workflowRunId}`
      : `UNBOUND — ${b.reason}`}`);
    out(`  capability: ${report.capabilitySource ?? 'NONE (no drill attestation was supplied)'}`);
    out('  PASS = this run exercised it and it worked. CAPABILITY PROVEN = this run genuinely did not reach it,');
    out('  a drill on the real production path did. FAIL = neither. NOT BUILT = no implementation exists.');
    out('');
    const width = Math.max(...report.results.map((row) => row.id.length));
    for (const row of report.results) {
      out(`  ${row.id.padEnd(width)}  ${row.verdict.padEnd(17)}  ${row.mission.padEnd(13)}  ${row.basis}`);
    }
    out('');
    out('TOP THREE BETA GAPS');
    if (report.gaps.length === 0) out('  none — every capability is proven, by this mission or by a drill');
    for (const [index, gap] of report.gaps.entries()) out(`  ${index + 1}. ${gap.id} — ${gap.verdict}: ${gap.basis}`);
    out('');
    out('RESULT');
    out(`  THE RUN:                    ${b.runId === null ? 'none named' : `${b.runId} ended ${b.runState}`}; ${b.bound ? 'bound to this checkout as a paid mission' : 'UNBOUND, so it can prove nothing but its failures'}.`);
    out(`  WHAT THIS RUN PROVED:       ${s.exercised} of ${s.total} exercised and working; ${s.failed} exercised and broken; ${s.notExercised} never reached; ${s.unknown} the bundle cannot say.`);
    out(`  WHAT JULIUS IS READY TO DO: ${s.provenByMission + s.provenByDrill} of ${s.total} proven — ${s.provenByMission} by this mission, ${s.provenByDrill} by drill; ${s.unproven} unproven; ${s.notBuilt} not built.`);
    out(`  BETA: ${s.provenByMission + s.provenByDrill === s.total ? 'READY' : 'NOT READY'}`);
  }
  return report.results.every((row) => row.verdict === 'PASS' || row.verdict === 'CAPABILITY PROVEN') ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
